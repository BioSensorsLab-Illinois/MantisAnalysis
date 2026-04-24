"""In-memory session store for the MantisAnalysis server.

The web GUI is stateless; the Python server keeps loaded recordings /
images under a session id so subsequent analysis requests can refer to
them without re-uploading. One process, one user — this is a local-only
tool, not multi-tenant. A dict keyed by session id with LRU eviction is
plenty.
"""
from __future__ import annotations

import io
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple  # noqa: F401

import numpy as np

from . import isp_modes as _isp
from .image_io import extract_with_mode, load_any_detail, luminance_from_rgb


@dataclass
class LoadedSource:
    """One loaded file with its extracted channel dict."""
    source_id: str
    name: str
    source_kind: str                    # "h5" or "image"
    channels: Dict[str, np.ndarray]
    attrs: Dict[str, str]
    shape_hw: Tuple[int, int]           # per-channel pixel dims (H, W)
    loaded_at: float = field(default_factory=time.time)
    path: Optional[str] = None          # absolute disk path when known
                                        # (None for browser uploads — the
                                        # tempfile path is gone after load)
    # Optional per-pixel dark frame attached to this source. Stored as a
    # parallel channel dict (same keys + shapes as `channels`), validated
    # at attach time. When set, server-side analysis subtracts this from
    # every channel before ISP / thumbnail / measurement.
    dark_channels: Optional[Dict[str, np.ndarray]] = None
    dark_name: Optional[str] = None
    dark_path: Optional[str] = None
    # ISP-modes-v1: cache the raw frame + active mode so the user can
    # reconfigure extraction geometry / channel renames without re-reading
    # from disk. ``raw_frame`` is the array *before* dual-gain split and
    # Bayer extraction — exactly what load_any_detail returned.
    raw_frame: Optional[np.ndarray] = None
    isp_mode_id: str = "rgb_nir"
    isp_config: Dict[str, object] = field(default_factory=dict)

    @property
    def channel_keys(self) -> list[str]:
        return sorted(self.channels.keys())

    @property
    def has_dark(self) -> bool:
        return self.dark_channels is not None and len(self.dark_channels) > 0


class SessionStore:
    """Process-wide session store. Thread-safe for the single-user case."""

    def __init__(self, max_entries: int = 12):
        self._lock = threading.RLock()
        self._items: Dict[str, LoadedSource] = {}
        self._max = max_entries

    def load_from_path(self, path: str | Path, name: Optional[str] = None) -> LoadedSource:
        """Load a file from local disk and register it under a new source id."""
        channels, attrs, raw, mode_id, cfg, kind = load_any_detail(path)
        any_ch = next(iter(channels.values()))
        shape_hw = (int(any_ch.shape[0]), int(any_ch.shape[1]))
        src = LoadedSource(
            source_id=uuid.uuid4().hex[:12],
            name=name or Path(path).name,
            source_kind=kind,
            channels=channels,
            attrs=attrs,
            shape_hw=shape_hw,
            path=str(Path(path).expanduser().resolve()),
            raw_frame=raw,
            isp_mode_id=mode_id,
            isp_config=cfg,
        )
        with self._lock:
            self._items[src.source_id] = src
            self._evict_locked()
        return src

    def load_from_bytes(self, data: bytes, name: str) -> LoadedSource:
        """Persist uploaded bytes to a temp file and load via load_any.

        load_any hits the real loader (H5 magic bytes + image decoders), so
        we don't second-guess the format here — just put the bytes on disk.
        """
        import tempfile

        # Preserve suffix so image_io can pick the right codec; H5 has no
        # mandated extension, so the suffix drives the fast path for
        # PNG/TIFF/JPG and load_any falls back to HDF5 magic-byte sniffing.
        suffix = Path(name).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = Path(f.name)
        try:
            return self.load_from_path(tmp_path, name=name)
        finally:
            try:
                tmp_path.unlink()
            except OSError:
                pass

    def get(self, source_id: str) -> LoadedSource:
        with self._lock:
            if source_id not in self._items:
                raise KeyError(f"unknown source id: {source_id}")
            return self._items[source_id]

    def list(self) -> list[dict]:
        """Serializable summary of every loaded source."""
        with self._lock:
            return [_summary_dict(s) for s in
                    sorted(self._items.values(), key=lambda s: s.loaded_at, reverse=True)]

    # ---- Dark-frame attachment ------------------------------------------
    def attach_dark_from_path(self, source_id: str, path: str | Path,
                              name: Optional[str] = None) -> "LoadedSource":
        """Load a dark frame from disk and attach it to `source_id`.

        Loads the dark under the source's *currently active* ISP mode +
        config so the key set matches after any reconfigure_isp call.
        Validates that the dark file produces the same channel keys +
        shapes as the parent source. Raises `KeyError` on unknown source,
        `ValueError` on shape / key mismatch.
        """
        src = self.get(source_id)
        dark_channels, _attrs, _raw, _mode_id, _cfg, _kind = load_any_detail(
            path,
            isp_mode_id=src.isp_mode_id,
            isp_config=src.isp_config,
        )
        _validate_dark_shapes(src, dark_channels)
        with self._lock:
            src.dark_channels = dark_channels
            src.dark_name = name or Path(path).name
            src.dark_path = str(Path(path).expanduser().resolve())
        return src

    def attach_dark_from_bytes(self, source_id: str, data: bytes, name: str
                               ) -> "LoadedSource":
        """Persist uploaded dark bytes to a temp file and attach under the
        source's currently active ISP mode + config."""
        import tempfile
        suffix = Path(name).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = Path(f.name)
        try:
            src = self.get(source_id)
            dark_channels, _attrs, _raw, _mode_id, _cfg, _kind = load_any_detail(
                tmp_path,
                isp_mode_id=src.isp_mode_id,
                isp_config=src.isp_config,
            )
            _validate_dark_shapes(src, dark_channels)
            with self._lock:
                src.dark_channels = dark_channels
                src.dark_name = name
                src.dark_path = None  # uploads have no original path
            return src
        finally:
            try: tmp_path.unlink()
            except OSError: pass

    def clear_dark(self, source_id: str) -> "LoadedSource":
        src = self.get(source_id)
        with self._lock:
            src.dark_channels = None
            src.dark_name = None
            src.dark_path = None
        return src

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    # ---- ISP reconfigure -----------------------------------------------
    def reconfigure_isp(self, source_id: str, mode_id: str,
                        overrides: Optional[Dict[str, object]] = None
                        ) -> LoadedSource:
        """Swap the ISP mode + overrides on an already-loaded source.

        Re-runs channel extraction from the cached raw frame. The dark
        frame is detached if its channel dict no longer matches the new
        channel set — callers get a fresh source with ``has_dark=False``
        in that case, and should re-attach. Returns the updated source.

        Raises ``KeyError`` on unknown source_id or mode_id,
        ``ValueError`` on config validation failures, and
        ``RuntimeError`` when the source was created without a cached
        raw frame (e.g. the synthetic sample — reconfigure isn't
        meaningful there because the channels weren't derived from a
        raw frame to begin with).
        """
        src = self.get(source_id)
        if src.raw_frame is None:
            raise RuntimeError(
                f"source {source_id!r} has no cached raw frame; "
                "reconfigure is only supported for loaded recordings"
            )
        mode = _isp.get_mode(mode_id)
        cfg = _isp.normalize_config(mode, overrides)
        # RGB-image reconfigure needs plane-splitting, not the generic
        # stride-based extract_with_mode path — the raw frame is (H, W, 3)
        # and extract_by_spec's stride-1 slicing returns the whole 3-D
        # array three times (one per primary slot), which downstream
        # consumers reject (channel_to_png_bytes on 3-D raises; analysis
        # endpoints get the wrong shape). Mirror load_image_channels's
        # behaviour verbatim so reconfigure round-trips cleanly.
        # See bugfix bug_001.
        if (src.source_kind == "image"
                and mode.id == _isp.RGB_IMAGE.id
                and src.raw_frame is not None
                and src.raw_frame.ndim == 3
                and src.raw_frame.shape[-1] in (3, 4)):
            arr = src.raw_frame
            if arr.shape[-1] == 4:
                arr = arr[..., :3]
            new_channels = {
                "R": np.ascontiguousarray(arr[..., 0]),
                "G": np.ascontiguousarray(arr[..., 1]),
                "B": np.ascontiguousarray(arr[..., 2]),
            }
            new_channels["Y"] = luminance_from_rgb(new_channels)
        else:
            new_channels = extract_with_mode(src.raw_frame, mode, cfg)
            # Keep the HG-Y / LG-Y synthesized luminance invariant for rgb_nir,
            # matching load_h5_channels. Other modes don't carry Y.
            if mode.id == _isp.RGB_NIR.id:
                hg = {k: new_channels[f"HG-{k}"] for k in ("R", "G", "B")}
                lg = {k: new_channels[f"LG-{k}"] for k in ("R", "G", "B")}
                new_channels["HG-Y"] = luminance_from_rgb(hg)
                new_channels["LG-Y"] = luminance_from_rgb(lg)
            elif src.source_kind == "image" and mode.id == _isp.RGB_IMAGE.id:
                # RGB image path synthesizes Y too, for parity with
                # load_image_channels default behaviour. (This branch
                # handles exotic callers that force RGB_IMAGE on a
                # non-3-plane raw frame; the 3-plane fast path above
                # covers the common case.)
                new_channels["Y"] = luminance_from_rgb(
                    {k: new_channels[k] for k in ("R", "G", "B")}
                )
        any_ch = next(iter(new_channels.values()))
        new_shape = (int(any_ch.shape[0]), int(any_ch.shape[1]))
        # Dark-frame compatibility: if any current dark channel doesn't
        # exist under the new schema (or differs in shape), detach. The
        # user gets a SourceSummary with has_dark=False and can re-attach.
        drop_dark = False
        if src.has_dark:
            for k, v in src.dark_channels.items():
                if k not in new_channels or new_channels[k].shape != v.shape:
                    drop_dark = True
                    break
        with self._lock:
            src.channels = new_channels
            src.shape_hw = new_shape
            src.isp_mode_id = mode.id
            src.isp_config = cfg
            if drop_dark:
                src.dark_channels = None
                src.dark_name = None
                src.dark_path = None
        return src

    def _evict_locked(self) -> None:
        """Drop oldest sources until we're under the cap. Caller holds the lock."""
        if len(self._items) <= self._max:
            return
        ordered = sorted(self._items.values(), key=lambda s: s.loaded_at)
        for s in ordered[: len(self._items) - self._max]:
            del self._items[s.source_id]


# Process-global singleton. The server and the test harness share this.
STORE = SessionStore()


# ---------------------------------------------------------------------------
# Dark-frame helpers (validation + subtraction math)
# ---------------------------------------------------------------------------

def _validate_dark_shapes(src: LoadedSource,
                          dark_channels: Dict[str, np.ndarray]) -> None:
    """Raise ValueError if the dark dict isn't compatible with the source.

    Requires:
      * Every source channel has a matching dark channel of the same shape
        (extra dark channels are tolerated and ignored).
      * No channel-key overlap implies a wholly-different recording — bail
        out with a clear message instead of silently doing nothing.
    """
    overlap = set(src.channels) & set(dark_channels)
    if not overlap:
        raise ValueError(
            f"dark frame channels {sorted(dark_channels)!r} do not overlap "
            f"with source channels {sorted(src.channels)!r}"
        )
    mismatched = []
    for k in src.channels:
        if k not in dark_channels:
            mismatched.append(f"  · {k}: missing in dark frame")
            continue
        ds = dark_channels[k].shape
        ss = src.channels[k].shape
        if ds != ss:
            mismatched.append(f"  · {k}: source shape {ss} ≠ dark shape {ds}")
    if mismatched:
        raise ValueError(
            "dark frame is incompatible with source:\n" + "\n".join(mismatched)
        )


def subtract_dark(image: np.ndarray, dark: Optional[np.ndarray]) -> np.ndarray:
    """Per-pixel dark subtraction with hard guards.

    All math runs in float64 so there's no risk of integer wrap-around or
    overflow on uint16 → uint16 subtraction (e.g. 1000 − 1100 wrapping to
    65436). The result is clamped to ``[0, ∞)`` so a pixel where dark > raw
    (which can happen with shot noise or a slightly-misaligned dark) stays
    physically meaningful at zero rather than going negative.

    Returns a new float64 array. The input arrays are never mutated.
    Returns the input unchanged (cast to float64) if `dark is None`.
    """
    a = np.asarray(image, dtype=np.float64)  # always copy via cast
    if dark is None:
        return a
    if dark.shape != image.shape:
        # Defensive — caller should have validated already, but if shapes
        # diverged after attachment (shouldn't happen) bail to identity.
        return a
    a = a - np.asarray(dark, dtype=np.float64)
    np.maximum(a, 0.0, out=a)
    return a


def _summary_dict(s: LoadedSource) -> dict:
    """JSON-serializable summary of a LoadedSource (used by API + STORE.list)."""
    try:
        mode = _isp.get_mode(s.isp_mode_id)
    except KeyError:
        mode = _isp.get_mode(_isp.RGB_NIR.id)
    # Build slot → active display name map so the UI can tell what the
    # rename-eligible slots resolved to (e.g. "nir" → "UV-650").
    names = dict((s.isp_config or {}).get("channel_name_overrides") or {})
    isp_channel_map = {
        spec.slot_id: _isp.resolved_channel_name(mode, spec, names)
        for spec in mode.channels
    }
    # Serialize any per-slot loc overrides as plain [r, c] lists so the
    # JSON payload stays strict-JSON (tuples from normalize_config would
    # round-trip as lists anyway; being explicit here saves a surprise).
    raw_loc_overrides = (s.isp_config or {}).get("channel_loc_overrides") or {}
    loc_overrides = {k: list(v) for k, v in raw_loc_overrides.items()}
    return {
        "source_id": s.source_id,
        "name": s.name,
        "kind": s.source_kind,
        "channels": s.channel_keys,
        "shape": list(s.shape_hw),
        "loaded_at": s.loaded_at,
        "path": s.path,
        "has_dark": s.has_dark,
        "dark_name": s.dark_name,
        "dark_path": s.dark_path,
        # ISP state — consumed by the React frontend to drive the ISP
        # settings window and RGB-composite toggle.
        "isp_mode_id": mode.id,
        "isp_config": {
            "origin": list(s.isp_config.get("origin",
                                             mode.default_origin)),
            "sub_step": list(s.isp_config.get("sub_step",
                                               mode.default_sub_step)),
            "outer_stride": list(s.isp_config.get("outer_stride",
                                                    mode.default_outer_stride)),
            "channel_name_overrides": names,
            "channel_loc_overrides": loc_overrides,
        },
        "isp_channel_map": isp_channel_map,
        "rgb_composite_available": bool(mode.supports_rgb_composite),
    }


# ---------------------------------------------------------------------------
# Helpers used by both server and test harness
# ---------------------------------------------------------------------------

def channel_to_png_bytes(
    image: np.ndarray,
    *,
    clip_lo_pct: float = 1.0,
    clip_hi_pct: float = 99.5,
    max_dim: int = 1600,
    colormap: str = "gray",
    vmin: Optional[float] = None,
    vmax: Optional[float] = None,
) -> bytes:
    """Downscale a 2-D channel to a display-ready PNG.

    Normalization order of preference:
      1. Explicit ``vmin``/``vmax`` (when *both* are provided) — used as-is.
      2. Otherwise, percentile clip via ``clip_lo_pct`` / ``clip_hi_pct``
         so a single saturated pixel doesn't crush the visible range.

    ``colormap`` accepts any matplotlib colormap name ("gray" / "jet" /
    "viridis" / "magma" / "inferno" / "plasma" / "cividis" / "turbo" / etc.);
    unknown names fall back to grayscale. Max dim keeps browser memory +
    bandwidth sane for 4K recordings.
    """
    from PIL import Image

    a = image.astype(np.float32, copy=False)
    if vmin is not None and vmax is not None:
        lo = float(vmin)
        hi = float(vmax)
    else:
        lo = float(np.percentile(a, clip_lo_pct))
        hi = float(np.percentile(a, clip_hi_pct))
    if hi <= lo:
        hi = lo + 1.0
    norm = np.clip((a - lo) / (hi - lo), 0.0, 1.0)

    cmap_name = (colormap or "gray").lower()
    if cmap_name in ("gray", "grey", "l", "mono", "none"):
        n8 = (norm * 255.0).astype(np.uint8)
        im = Image.fromarray(n8, mode="L")
    else:
        import matplotlib
        matplotlib.use("Agg")
        from matplotlib import colormaps
        try:
            cmap = colormaps[cmap_name]
        except KeyError:
            # Fallback: grayscale.
            n8 = (norm * 255.0).astype(np.uint8)
            im = Image.fromarray(n8, mode="L")
        else:
            rgba = cmap(norm, bytes=True)  # (H, W, 4) uint8
            im = Image.fromarray(rgba[..., :3], mode="RGB")

    if max(im.size) > max_dim:
        scale = max_dim / float(max(im.size))
        new_size = (int(im.size[0] * scale), int(im.size[1] * scale))
        im = im.resize(new_size, Image.Resampling.BILINEAR)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()
