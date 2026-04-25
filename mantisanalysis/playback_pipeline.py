"""Single render entry point for Playback (preview + export).

Pure NumPy / matplotlib / PIL — same purity invariants as the rest of
the Playback backend (AGENT_RULES rule 7). The only render entry point
in the system; both the FastAPI preview endpoint
(``GET /api/playback/streams/{sid}/frame/{n}.png``) and the export
modules call ``render_frame``. WYSIWYG by construction.

Pipeline stages, in order (DATA_MODEL §3.3):

  1.  Pick channel(s) from the channel dict.
  2.  Cast to float64.
  3.  Dark subtract (clamped to ≥ 0).
  4.  Gain / offset.
  5.  Normalize (percentile p1..p99.5) or threshold (low/high).
  6.  RGB grading (only when view.type == 'rgb'):
         - per-channel gain / offset
         - gamma
         - brightness / contrast
         - saturation (HSL)
         - white balance (k or patch)
         - CCM (3×3, |det| guard)
  7.  Single-channel: matplotlib colormap LUT.
  8.  Invert (mirror LUT).
  9.  Show clipped pixels (magenta overlay).
  10. Compose overlay layer per blend mode.
  11. Burn-in labels (PIL ImageDraw).
  12. Downsample to max_dim.
  13. Return uint8 (H, W, 3).

Frozen invariants:
  * No analysis-side imports — purity test in
    `tests/unit/test_playback_pipeline.py::test_pure_imports` asserts
    `mantisanalysis.{session, server} not in sys.modules and
     fastapi not in sys.modules` after this module loads.
  * `subtract_dark` is inlined (4 lines) — never imported from
    `mantisanalysis.session`.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# CCM target catalog (X-Rite ColorChecker 24 white reference)
# ---------------------------------------------------------------------------


# Just the white-patch (#19) for now; full 24-patch CCM solver lands at M8
# (CCM editor in the inspector). The catalog ID is referenced from the wire
# in ViewState.wb_target_id; "d65_white" is the safe default.
CCM_TARGETS: Dict[str, Dict[str, Any]] = {
    "d65_white": {
        "name": "D65 white (X-Rite #19)",
        "white_rgb": (243.0 / 255.0, 243.0 / 255.0, 242.0 / 255.0),
    },
    "d50_white": {
        "name": "D50 white (warm)",
        "white_rgb": (255.0 / 255.0, 247.0 / 255.0, 232.0 / 255.0),
    },
}


# ---------------------------------------------------------------------------
# ViewState dataclass (subset rendered server-side; mirror of
# DATA_MODEL.md §3.3)
# ---------------------------------------------------------------------------


ViewType = Literal["single", "rgb"]
BlendMode = Literal["alpha", "additive", "screen", "masked"]
WBMode = Literal["k", "patch"]


@dataclass(frozen=True)
class ViewState:
    """Per-view processing config consumed by ``render_frame``.

    Mirrors the React state shape; field names are snake_case.
    """

    view_id: str = "v1"
    name: str = "view"
    type: ViewType = "single"
    channel: str = "HG-G"
    channels: Tuple[str, str, str] = ("HG-R", "HG-G", "HG-B")  # RGB triplet

    # Corrections
    dark_on: bool = False
    gain: float = 1.0
    offset: float = 0.0
    normalize: bool = False

    # Display
    low: float = 30.0
    high: float = 900.0
    colormap: str = "viridis"
    invert: bool = False
    show_clipped: bool = False

    # RGB grading
    rgb_gain: Tuple[float, float, float] = (1.0, 1.0, 1.0)
    rgb_offset: Tuple[float, float, float] = (0.0, 0.0, 0.0)
    gamma: float = 1.0
    brightness: float = 0.0
    contrast: float = 1.0
    saturation: float = 1.0
    wb_k: int = 5500
    wb_mode: WBMode = "k"
    wb_patch_uv: Optional[Tuple[float, float]] = None
    wb_target_id: Optional[str] = None
    ccm_on: bool = False
    ccm: Tuple[Tuple[float, ...], ...] = (
        (1.0, 0.0, 0.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )

    # Overlay
    overlay_on: bool = False
    overlay_channel: str = "HG-NIR"
    overlay_low: float = 300.0
    overlay_high: float = 900.0
    overlay_blend: BlendMode = "alpha"
    overlay_strength: float = 0.65
    overlay_cmap: str = "inferno"
    overlay_below: Literal["hide", "clamp"] = "hide"
    overlay_above: Literal["saturate", "clamp"] = "saturate"

    # Labels (burn-in)
    labels_timestamp: bool = True
    labels_frame: bool = True
    labels_channel: bool = False
    labels_source: bool = False
    labels_scale_bar: bool = False
    labels_badges: bool = True
    labels_legend: bool = True


@dataclass(frozen=True)
class BurnInContext:
    """Optional context for label burn-in (timestamps, source filename, etc.).

    Exists so render_frame can stay channel-dict-only when the caller
    doesn't need labels.
    """

    frame_index: int = 0
    timestamp_s: Optional[float] = None
    source_filename: Optional[str] = None
    badges: Tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Math primitives — all pure-NumPy
# ---------------------------------------------------------------------------


def subtract_dark(image: np.ndarray, dark: Optional[np.ndarray]) -> np.ndarray:
    """Per-pixel dark subtract clamped to [0, ∞), float64.

    Inlined here (not imported from `session.py`) so the purity test
    can prove this module never reaches across to the analysis layer.
    Mirrors `mantisanalysis.session.subtract_dark` semantics.
    """
    a = np.asarray(image, dtype=np.float64)
    if dark is None:
        return a
    if dark.shape != image.shape:
        return a  # defensive — caller should validate
    a = a - np.asarray(dark, dtype=np.float64)
    np.maximum(a, 0.0, out=a)
    return a


def _normalize_or_threshold(arr: np.ndarray, view: ViewState) -> np.ndarray:
    """Convert raw float64 to a clipped [0, 1] display image."""
    if view.normalize:
        lo = float(np.percentile(arr, 1.0))
        hi = float(np.percentile(arr, 99.5))
    else:
        lo = float(view.low)
        hi = float(view.high)
    if hi <= lo:
        hi = lo + 1.0
    out = (arr - lo) / (hi - lo)
    return np.clip(out, 0.0, 1.0)


def _apply_colormap(norm: np.ndarray, name: str, invert: bool) -> np.ndarray:
    """Map [0, 1] grayscale → uint8 (H, W, 3) RGB via matplotlib LUT.

    Lazy-import matplotlib so the module loads without a display.
    """
    cmap_name = (name or "gray").lower()
    if invert:
        norm = 1.0 - norm
    if cmap_name in ("gray", "grey", "l", "mono", "none"):
        n8 = (norm * 255.0).astype(np.uint8)
        return np.repeat(n8[..., None], 3, axis=-1)
    matplotlib = importlib.import_module("matplotlib")
    matplotlib.use("Agg")
    # `matplotlib.colormaps` is a registry attribute, not a submodule
    # (matplotlib >= 3.5).  Fall back to the older `matplotlib.cm.get_cmap`
    # API on older versions.
    cmap = None
    try:
        registry = getattr(matplotlib, "colormaps")
        cmap = registry[cmap_name]
    except (AttributeError, KeyError):
        try:
            cm_pkg = importlib.import_module("matplotlib.cm")
            cmap = cm_pkg.get_cmap(cmap_name)
        except (KeyError, ValueError, AttributeError):
            cmap = None
    if cmap is None:
        n8 = (norm * 255.0).astype(np.uint8)
        return np.repeat(n8[..., None], 3, axis=-1)
    rgba = cmap(norm, bytes=True)
    return rgba[..., :3]


def _highlight_clipped(rgb: np.ndarray, raw_norm: np.ndarray) -> np.ndarray:
    """Paint magenta over saturated pixels (norm == 1)."""
    out = rgb.copy()
    mask = raw_norm >= 1.0 - 1e-6
    if mask.any():
        out[mask] = (255, 0, 255)
    return out


def _apply_rgb_grading(rgb: np.ndarray, view: ViewState) -> np.ndarray:
    """Apply RGB-mode display grading. ``rgb`` is float64 [0, 1] (H, W, 3)."""
    out = np.asarray(rgb, dtype=np.float64).copy()
    # Per-channel gain and offset.
    g = np.asarray(view.rgb_gain, dtype=np.float64)
    o = np.asarray(view.rgb_offset, dtype=np.float64)
    out = out * g + o
    # Brightness / contrast (channel-broadcast scalars).
    out = (out - 0.5) * float(view.contrast) + 0.5 + float(view.brightness)
    out = np.clip(out, 0.0, 1.0)
    # Gamma (apply after clip to avoid sign issues).
    out = out ** (1.0 / max(1e-6, float(view.gamma)))
    # Saturation via grayscale lerp (cheaper than HSL round-trip).
    if not np.isclose(view.saturation, 1.0):
        gray = (0.299 * out[..., 0] + 0.587 * out[..., 1]
                + 0.114 * out[..., 2])[..., None]
        out = gray + (out - gray) * float(view.saturation)
        out = np.clip(out, 0.0, 1.0)
    # White balance.
    out = _apply_wb(out, view)
    # CCM.
    if view.ccm_on:
        ccm = np.asarray(view.ccm, dtype=np.float64)
        # |det| guard — refuse near-singular matrices.
        det = abs(float(np.linalg.det(ccm)))
        if det >= 1e-3:
            shape = out.shape
            flat = out.reshape(-1, 3) @ ccm.T
            out = flat.reshape(shape)
    out = np.clip(out, 0.0, 1.0)
    return out


def _kelvin_gain(k: float) -> Tuple[float, float, float]:
    """Toy Kelvin→(R, G, B) gain LUT, monotonic over 2500–9500 K.

    Not color-calibrated; a small smooth curve good enough that pulling
    K from 5500 to 6500 desaturates yellow as users expect. The CCM
    editor is the calibrated path.
    """
    k = float(np.clip(k, 2500.0, 9500.0))
    # Linear-piecewise; intentional simplicity.
    t = (k - 2500.0) / (9500.0 - 2500.0)         # 0..1
    r_gain = 1.4 - 0.6 * t                        # warm → 0.8
    g_gain = 1.0
    b_gain = 0.7 + 0.6 * t                        # 0.7 → 1.3
    return float(r_gain), float(g_gain), float(b_gain)


def _apply_wb(rgb: np.ndarray, view: ViewState) -> np.ndarray:
    if view.wb_mode == "k":
        gr, gg, gb = _kelvin_gain(view.wb_k)
        return np.clip(rgb * np.array([gr, gg, gb]), 0.0, 1.0)
    # patch mode (calibrated): use target white / observed RGB at uv.
    if view.wb_patch_uv is None:
        return rgb
    h, w = rgb.shape[0], rgb.shape[1]
    u, v = view.wb_patch_uv
    x = int(np.clip(u * (w - 1), 0, w - 1))
    y = int(np.clip(v * (h - 1), 0, h - 1))
    observed = rgb[y, x]
    if not np.all(observed > 1e-6):
        return rgb
    target = CCM_TARGETS.get(view.wb_target_id or "d65_white",
                              CCM_TARGETS["d65_white"])["white_rgb"]
    gain = np.asarray(target, dtype=np.float64) / observed
    return np.clip(rgb * gain, 0.0, 1.0)


def _compose_overlay(base_rgb: np.ndarray,
                     overlay_channel: np.ndarray,
                     view: ViewState,
                     ) -> np.ndarray:
    """Compose a single-channel overlay onto a base RGB display."""
    arr = np.asarray(overlay_channel, dtype=np.float64)
    lo, hi = float(view.overlay_low), float(view.overlay_high)
    if hi <= lo:
        hi = lo + 1.0
    norm = (arr - lo) / (hi - lo)
    # Below / above thresholds.
    below = arr < lo
    above = arr > hi
    if view.overlay_above == "saturate":
        norm = np.where(above, 1.0, norm)
    else:  # clamp
        norm = np.where(above, 1.0, np.clip(norm, 0.0, 1.0))
    norm = np.clip(norm, 0.0, 1.0)
    # Map through overlay colormap.
    over_rgb = _apply_colormap(norm, view.overlay_cmap, invert=False)
    over_rgb = over_rgb.astype(np.float64) / 255.0

    # Alpha mask honors below-threshold policy.
    if view.overlay_below == "hide":
        alpha = np.where(below, 0.0, 1.0)
    else:  # clamp
        alpha = np.ones_like(norm)
    alpha = (alpha * float(view.overlay_strength))[..., None]

    base = base_rgb.astype(np.float64) / 255.0

    if view.overlay_blend == "alpha":
        out = base * (1.0 - alpha) + over_rgb * alpha
    elif view.overlay_blend == "additive":
        out = np.clip(base + over_rgb * alpha, 0.0, 1.0)
    elif view.overlay_blend == "screen":
        out = 1.0 - (1.0 - base) * (1.0 - over_rgb * alpha)
    elif view.overlay_blend == "masked":
        out = np.where(over_rgb > 0, over_rgb * alpha + base * (1 - alpha),
                       base)
    else:
        out = base
    return np.clip(out * 255.0, 0.0, 255.0).astype(np.uint8)


def _downscale(rgb: np.ndarray, max_dim: int) -> np.ndarray:
    """Bilinear down-scale via PIL when ``max(H, W) > max_dim``."""
    h, w = rgb.shape[0], rgb.shape[1]
    if max(h, w) <= max_dim:
        return rgb
    PIL_Image = importlib.import_module("PIL.Image")
    im = PIL_Image.fromarray(rgb)
    scale = max_dim / float(max(h, w))
    new_size = (max(1, int(w * scale)), max(1, int(h * scale)))
    im = im.resize(new_size, PIL_Image.Resampling.BILINEAR)
    return np.asarray(im)


def _burn_labels(rgb: np.ndarray,
                 view: ViewState,
                 ctx: BurnInContext) -> np.ndarray:
    """PIL ImageDraw burn-in for timestamp / frame / channel / source.

    Falls back to a no-op when PIL or the default font isn't available
    (e.g. in a CI image without DejaVu).
    """
    if not (view.labels_timestamp or view.labels_frame or view.labels_channel
            or view.labels_source or view.labels_badges):
        return rgb
    try:
        PIL_Image = importlib.import_module("PIL.Image")
        PIL_ImageDraw = importlib.import_module("PIL.ImageDraw")
        PIL_ImageFont = importlib.import_module("PIL.ImageFont")
    except ImportError:
        return rgb
    im = PIL_Image.fromarray(rgb).convert("RGB")
    draw = PIL_ImageDraw.Draw(im, "RGBA")
    try:
        font = PIL_ImageFont.load_default()
    except Exception:
        return rgb

    # Bottom-left: timestamp + frame
    parts: List[str] = []
    if view.labels_frame:
        parts.append(f"f{ctx.frame_index:04d}")
    if view.labels_timestamp and ctx.timestamp_s is not None:
        m = int(ctx.timestamp_s // 60)
        s = ctx.timestamp_s % 60
        parts.append(f"{m:02d}:{s:06.3f}")
    if view.labels_channel:
        parts.append(view.channel if view.type == "single" else "RGB")
    if parts:
        text = " · ".join(parts)
        x, y = 6, im.height - 18
        draw.rectangle((x - 3, y - 2, x + len(text) * 6 + 4, y + 14),
                       fill=(0, 0, 0, 160))
        draw.text((x, y), text, fill=(232, 234, 237, 255), font=font)

    # Top-right: source filename
    if view.labels_source and ctx.source_filename:
        text = ctx.source_filename
        x = im.width - len(text) * 6 - 8
        y = 4
        draw.rectangle((x - 3, y - 2, x + len(text) * 6 + 3, y + 14),
                       fill=(0, 0, 0, 160))
        draw.text((x, y), text, fill=(176, 184, 196, 255), font=font)

    # Top-left badges
    if view.labels_badges and ctx.badges:
        text = " ".join(ctx.badges)
        x, y = 4, 4
        draw.rectangle((x - 2, y - 2, x + len(text) * 6 + 2, y + 14),
                       fill=(0, 0, 0, 160))
        draw.text((x, y), text, fill=(180, 220, 180, 255), font=font)

    return np.asarray(im)


# ---------------------------------------------------------------------------
# Public render entry point — single source of WYSIWYG truth
# ---------------------------------------------------------------------------


def render_frame(channels: Dict[str, np.ndarray],
                 view: ViewState,
                 dark: Optional[Dict[str, np.ndarray]] = None,
                 *,
                 max_dim: int = 1024,
                 burn_ctx: Optional[BurnInContext] = None,
                 ) -> np.ndarray:
    """Render one frame to a uint8 (H, W, 3) RGB array.

    Parameters
    ----------
    channels :
        Dict ``{channel_key: ndarray (H, W)}`` from
        ``recording.extract_frame`` or ``PlaybackStore.get_frame``.
        Keys must include ``view.channel`` (single) or all of
        ``view.channels`` (rgb), plus ``view.overlay_channel`` when
        ``view.overlay_on`` is True.
    view :
        Per-view processing config.
    dark :
        Optional per-channel dark dict (typically
        ``master.channels`` from a ``MasterDark``). Subtracted only
        when ``view.dark_on`` and the matching channel exists in
        ``dark``.
    max_dim :
        Maximum dimension cap for the output; bilinear downscaling
        when the rendered image exceeds it.
    burn_ctx :
        Optional label-burn-in context (frame_index / timestamp /
        source / badges).

    Returns
    -------
    np.ndarray
        ``(H, W, 3) uint8`` RGB. Never mutates inputs.
    """
    # 1. Pick channel(s) + cast to float64.
    if view.type == "rgb":
        triplet = view.channels
        if any(k not in channels for k in triplet):
            raise KeyError(
                f"RGB view requires channels {triplet}; available: "
                f"{sorted(channels.keys())}"
            )
        r = subtract_dark(channels[triplet[0]],
                          dark.get(triplet[0]) if (dark and view.dark_on) else None)
        g = subtract_dark(channels[triplet[1]],
                          dark.get(triplet[1]) if (dark and view.dark_on) else None)
        b = subtract_dark(channels[triplet[2]],
                          dark.get(triplet[2]) if (dark and view.dark_on) else None)
        # Gain / offset before normalization.
        r = r * view.gain + view.offset
        g = g * view.gain + view.offset
        b = b * view.gain + view.offset
        # Per-plane normalize / threshold then stack.
        r_n = _normalize_or_threshold(r, view)
        g_n = _normalize_or_threshold(g, view)
        b_n = _normalize_or_threshold(b, view)
        rgb01 = np.stack([r_n, g_n, b_n], axis=-1)
        rgb01 = _apply_rgb_grading(rgb01, view)
        rgb = (rgb01 * 255.0).astype(np.uint8)
        # Clipping highlight uses the max plane.
        if view.show_clipped:
            rgb = _highlight_clipped(rgb, np.max(rgb01, axis=-1))
    else:
        if view.channel not in channels:
            raise KeyError(
                f"single-channel view requires {view.channel!r}; available: "
                f"{sorted(channels.keys())}"
            )
        arr = subtract_dark(channels[view.channel],
                            dark.get(view.channel) if (dark and view.dark_on) else None)
        arr = arr * view.gain + view.offset
        norm = _normalize_or_threshold(arr, view)
        rgb = _apply_colormap(norm, view.colormap, view.invert)
        if view.show_clipped:
            rgb = _highlight_clipped(rgb, norm)

    # 10. Overlay (works on both single + rgb base views).
    if view.overlay_on and view.overlay_channel in channels:
        rgb = _compose_overlay(rgb, channels[view.overlay_channel], view)

    # 11. Labels.
    if burn_ctx is not None:
        rgb = _burn_labels(rgb, view, burn_ctx)

    # 12. Downscale.
    rgb = _downscale(rgb, max_dim)

    return rgb.astype(np.uint8, copy=False)


# ---------------------------------------------------------------------------
# Helpers used by server.py + export modules
# ---------------------------------------------------------------------------


def render_frame_to_png(channels: Dict[str, np.ndarray],
                        view: ViewState,
                        dark: Optional[Dict[str, np.ndarray]] = None,
                        *,
                        max_dim: int = 1024,
                        burn_ctx: Optional[BurnInContext] = None,
                        ) -> bytes:
    """Render → PIL Image → PNG bytes. The ``GET frame.png`` endpoint
    calls this directly."""
    import io
    PIL_Image = importlib.import_module("PIL.Image")
    rgb = render_frame(channels, view, dark, max_dim=max_dim, burn_ctx=burn_ctx)
    im = PIL_Image.fromarray(rgb, mode="RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


__all__ = [
    "ViewState",
    "BurnInContext",
    "ViewType",
    "BlendMode",
    "WBMode",
    "CCM_TARGETS",
    "subtract_dark",
    "render_frame",
    "render_frame_to_png",
]
