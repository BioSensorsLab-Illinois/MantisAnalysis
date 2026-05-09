"""Unified image loader: GSense raw H5 + standard 2-D image files (PNG/TIFF/JPG).

ISP-mode aware as of isp-modes-v1. The legacy no-args ``load_any(path)``
call path produces byte-identical output (``HG/LG × {R,G,B,NIR,Y}`` for
H5, ``R/G/B/Y`` for RGB images, ``L`` for grayscale). Callers that want
to override can pass ``isp_mode_id`` + ``isp_config`` to dispatch through
``isp_modes.extract_by_spec``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np

from . import isp_modes as _isp
from .extract import (
    extract_by_spec,
    load_recording,
    split_dual_gain,
)

H5_EXTS = {".h5", ".hdf5"}
IMAGE_EXTS = {".png", ".tif", ".tiff", ".jpg", ".jpeg", ".bmp"}


def looks_like_image(path: Path) -> bool:
    return path.suffix.lower() in IMAGE_EXTS


def is_h5_recording(path: Path) -> bool:
    """H5 detection by magic-bytes (recordings often have no extension)."""
    if path.suffix.lower() in H5_EXTS:
        return True
    try:
        with open(path, "rb") as f:
            return f.read(8) == b"\x89HDF\r\n\x1a\n"
    except OSError:
        return False


def luminance_from_rgb(rgb: dict[str, np.ndarray]) -> np.ndarray:
    """Rec.601 luminance Y = 0.299·R + 0.587·G + 0.114·B (in source dtype)."""
    r = rgb["R"].astype(np.float64)
    g = rgb["G"].astype(np.float64)
    b = rgb["B"].astype(np.float64)
    y = 0.299 * r + 0.587 * g + 0.114 * b
    out_dtype = rgb["R"].dtype
    if np.issubdtype(out_dtype, np.integer):
        info = np.iinfo(out_dtype)
        y = np.clip(y, info.min, info.max)
    return y.astype(out_dtype, copy=False)


def rgb_composite(
    channels: dict[str, np.ndarray], mapping: dict[str, str] | None = None
) -> np.ndarray:
    """Stack three named grayscale channels into an H×W×3 array.

    ``mapping`` picks which channel keys play R, G, B. Default maps each
    primary to itself (``R→R, G→G, B→B``); pass e.g.
    ``{"R":"HG-R","G":"HG-G","B":"HG-B"}`` on a dual-gain source to pin
    the composite to one gain. Caller is responsible for providing keys
    that exist in ``channels``; missing keys raise KeyError.
    """
    mp = mapping or {"R": "R", "G": "G", "B": "B"}
    return np.dstack([channels[mp["R"]], channels[mp["G"]], channels[mp["B"]]])


# ---------------------------------------------------------------------------
# Mode-driven extraction
# ---------------------------------------------------------------------------


def _crop_channels_to_common_shape(channels: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """Trim every channel to the minimum (H, W) across the dict.

    Needed because ``half[r::s, c::s]`` can yield slightly different
    shapes per channel when the half-frame dims aren't clean multiples
    of the stride (e.g. a 2046-row half with stride 4 → some channels
    1024 rows, others 1023). Downstream math (luminance synthesis,
    multi-channel overlays, dark subtraction) requires a common shape,
    so crop here once at the extraction boundary.
    """
    if not channels:
        return channels
    min_h = min(a.shape[0] for a in channels.values())
    min_w = min(a.shape[1] for a in channels.values())
    same = all(a.shape[0] == min_h and a.shape[1] == min_w for a in channels.values())
    if same:
        return channels
    return {
        k: (v if (v.shape[0] == min_h and v.shape[1] == min_w) else v[:min_h, :min_w])
        for k, v in channels.items()
    }


def _apply_mode_to_half(
    half: np.ndarray, mode: _isp.ISPMode, config: dict[str, Any]
) -> dict[str, np.ndarray]:
    """Run ``extract_by_spec`` for every slot in ``mode`` against one half.

    ``config`` is the output of ``isp_modes.normalize_config``. Channel
    names reflect any rename overrides. Per-channel loc overrides from
    ``config["channel_loc_overrides"]`` take precedence over the mode's
    declared default loc. For bare modes (``sub_step=(1,1)``,
    ``outer_stride=(1,1)``), the extraction is effectively ``half[::1, ::1]``
    i.e. an array view equal to the input half.
    """
    names = config["channel_name_overrides"]
    loc_overrides = config.get("channel_loc_overrides") or {}
    origin = config["origin"]
    sub_step = config["sub_step"]
    outer_stride = config["outer_stride"]
    out: dict[str, np.ndarray] = {}
    for spec in mode.channels:
        name = _isp.resolved_channel_name(mode, spec, names)
        loc = tuple(loc_overrides.get(spec.slot_id, spec.loc))
        out[name] = extract_by_spec(half, loc, origin, sub_step, outer_stride)
    return _crop_channels_to_common_shape(out)


def extract_with_mode(
    raw_frame: np.ndarray, mode: _isp.ISPMode, config: dict[str, Any]
) -> dict[str, np.ndarray]:
    """Top-level extraction entry point for ISP-aware loaders.

    For dual-gain modes the frame is split into HG / LG halves first
    and channel dicts are emitted with ``HG-`` / ``LG-`` prefixes;
    otherwise the whole frame is treated as one half. The final dict
    is shape-normalized: every channel is cropped to the common
    (min H, min W) so downstream math (luminance synthesis, multi-
    channel overlays, dark subtraction) sees consistent arrays even
    when the raw half dims aren't clean multiples of the stride.
    """
    if mode.dual_gain:
        # Most modes split HG (left half) | LG (right half). The legacy
        # gsbsi RGB-NIR layout interleaves HG / LG by row (period 4)
        # instead — so flagged via the mode's ``split_kind``. Same R/G/B/NIR
        # locs apply to both halves; the split happens before extraction.
        split_kind = getattr(mode, "split_kind", "horizontal") or "horizontal"
        if split_kind == "row_interleaved_period_4":
            arr = raw_frame
            if arr.ndim == 3 and arr.shape[-1] == 1:
                arr = arr[..., 0]
            # Rows 0,2 mod 4 = LG; rows 1,3 mod 4 = HG. Stack the two
            # surviving rows of each half so the 2x2 sub-tile pattern
            # (B@(0,0), R@(0,1), G@(1,0), NIR@(1,1)) lands at the same
            # (loc[0]*2, loc[1]) positions used by the modern mode.
            lg_half = np.empty((arr.shape[0] // 2, arr.shape[1]), dtype=arr.dtype)
            lg_half[0::2] = arr[0::4]
            lg_half[1::2] = arr[2::4]
            hg_half = np.empty((arr.shape[0] // 2, arr.shape[1]), dtype=arr.dtype)
            hg_half[0::2] = arr[1::4]
            hg_half[1::2] = arr[3::4]
        else:
            hg_half, lg_half = split_dual_gain(raw_frame)
        hg = _apply_mode_to_half(hg_half, mode, config)
        lg = _apply_mode_to_half(lg_half, mode, config)
        out: dict[str, np.ndarray] = {}
        for k, v in hg.items():
            out[f"HG-{k}"] = v
        for k, v in lg.items():
            out[f"LG-{k}"] = v
        # split_dual_gain uses ``W//2`` so odd-width frames produce HG and
        # LG halves that differ in width by one pixel; the second crop
        # normalizes across that boundary too.
        return _crop_channels_to_common_shape(out)
    # Single-gain mode — treat the whole frame as one half. The array may
    # arrive 3-D from PIL/tifffile; _apply_mode_to_half squeezes a trailing
    # length-1 axis via extract_by_spec itself.
    if raw_frame.ndim == 3 and raw_frame.shape[-1] == 1:
        raw_frame = raw_frame[..., 0]
    return _apply_mode_to_half(raw_frame, mode, config)


# ---------------------------------------------------------------------------
# Source-kind loaders
# ---------------------------------------------------------------------------


def load_h5_channels(
    path: Path,
    frame_index: int = 0,
    isp_mode_id: str | None = None,
    isp_config: dict[str, Any] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, str], np.ndarray, str, dict[str, Any]]:
    """Load an H5 dual-gain recording and extract channels.

    Returns ``(channels, attrs, raw_frame, mode_id, resolved_config)``.
    The raw frame is returned so the session store can cache it and
    re-extract when the user switches ISP mode without touching disk.

    Backward compat: when ``isp_mode_id`` is ``None`` we default to
    ``rgb_nir`` — the only H5 mode that existed pre-isp-modes-v1 — and
    the emitted channel dict is byte-identical to the prior loader
    (``HG/LG × {R,G,B,NIR,Y}``).
    """
    rec = load_recording(path, frame_slice=slice(frame_index, frame_index + 1))
    frame = rec.frames[0]
    mode_id = isp_mode_id or _isp.default_mode_id_for_source_kind("h5", is_dual_gain=True)
    mode = _isp.get_mode(mode_id)
    cfg = _isp.normalize_config(mode, isp_config)
    channels = extract_with_mode(frame, mode, cfg)
    # Only the RGB-NIR path carries a synthesized luminance channel — a
    # frozen invariant (ARCHITECTURE.md Key invariants #3) that downstream
    # analysis + UI assume. Other dual-gain modes don't get Y.
    if mode.id == _isp.RGB_NIR.id:
        hg = {"R": channels["HG-R"], "G": channels["HG-G"], "B": channels["HG-B"]}
        lg = {"R": channels["LG-R"], "G": channels["LG-G"], "B": channels["LG-B"]}
        channels["HG-Y"] = luminance_from_rgb(hg)
        channels["LG-Y"] = luminance_from_rgb(lg)
        # M25 — synthesize HDR-{R,G,B,NIR,Y} via saturation-aware fusion.
        from .hdr_fusion import add_hdr_channels

        add_hdr_channels(channels)
    return channels, dict(rec.attrs), frame, mode.id, cfg


def load_image_channels(
    path: Path,
    isp_mode_id: str | None = None,
    isp_config: dict[str, Any] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, str], np.ndarray, str, dict[str, Any]]:
    """Load a PNG/TIFF/JPG and return per-channel dict + raw array.

    For backward compat, the default path emits ``R/G/B/Y`` for 3-channel
    images and ``L`` for 1-channel ones. Explicit ``isp_mode_id`` (e.g.
    ``bare_single``) is supported but rarely useful for image files.
    """
    suf = path.suffix.lower()
    arr: np.ndarray
    if suf in (".tif", ".tiff"):
        import tifffile

        arr = np.asarray(tifffile.imread(str(path)))
    else:
        from PIL import Image

        with Image.open(path) as im:
            arr = np.asarray(im)
    attrs = {"source": str(path), "shape": str(arr.shape)}
    if arr.ndim == 2:
        # Grayscale source. If the caller didn't pin a mode, use
        # grayscale_image; mode-level extraction is a trivial identity.
        mode = _isp.get_mode(isp_mode_id or _isp.GRAYSCALE_IMAGE.id)
        cfg = _isp.normalize_config(mode, isp_config)
        channels = extract_with_mode(arr, mode, cfg)
        return channels, attrs, arr, mode.id, cfg
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):
        if arr.shape[-1] == 4:
            arr = arr[..., :3]
        # RGB image default — each primary lives in a separate plane,
        # so the ISP-mode machinery's extract-by-stride pattern doesn't
        # quite fit. Keep the legacy plane-split for the default path
        # to preserve byte-identical outputs, but still declare the mode
        # so downstream state has a valid handle.
        mode = _isp.get_mode(isp_mode_id or _isp.RGB_IMAGE.id)
        cfg = _isp.normalize_config(mode, isp_config)
        if mode.id == _isp.RGB_IMAGE.id:
            channels = {"R": arr[..., 0], "G": arr[..., 1], "B": arr[..., 2]}
            channels["Y"] = luminance_from_rgb(channels)
            return channels, attrs, arr, mode.id, cfg
        # Exotic override: run the generic mode path on the flattened
        # red plane. Unsupported combinations (3-D image through a Bayer
        # mode) will produce surprising output; that's the caller's call.
        channels = extract_with_mode(arr[..., 0], mode, cfg)
        return channels, attrs, arr, mode.id, cfg
    raise ValueError(f"unsupported image shape: {arr.shape}")


def load_any(
    path: str | Path,
    isp_mode_id: str | None = None,
    isp_config: dict[str, Any] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, str], str]:
    """Returns (channel_dict, attrs, source_kind in {"h5", "image"}).

    Backward-compatible signature — ``load_any(path)`` keeps working
    unchanged. Pass ``isp_mode_id`` / ``isp_config`` to request a
    non-default ISP layout at load time. Callers that need the cached
    raw frame (for later reconfiguration) should hit ``load_any_detail``.
    """
    channels, attrs, _raw, _mode_id, _cfg, kind = load_any_detail(
        path,
        isp_mode_id=isp_mode_id,
        isp_config=isp_config,
    )
    return channels, attrs, kind


def load_any_detail(
    path: str | Path,
    isp_mode_id: str | None = None,
    isp_config: dict[str, Any] | None = None,
) -> tuple[dict[str, np.ndarray], dict[str, str], np.ndarray, str, dict[str, Any], str]:
    """Like ``load_any`` but also returns the raw frame + resolved mode.

    Session store uses this so it can cache the raw frame for
    ``reconfigure_isp`` without re-reading from disk.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)
    if looks_like_image(p):
        channels, attrs, raw, mode_id, cfg = load_image_channels(
            p,
            isp_mode_id=isp_mode_id,
            isp_config=isp_config,
        )
        return channels, attrs, raw, mode_id, cfg, "image"
    if is_h5_recording(p):
        channels, attrs, raw, mode_id, cfg = load_h5_channels(
            p,
            frame_index=0,
            isp_mode_id=isp_mode_id,
            isp_config=isp_config,
        )
        return channels, attrs, raw, mode_id, cfg, "h5"
    raise ValueError(f"unrecognized file type: {p}")
