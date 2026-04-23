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

from .image_io import load_any


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
        channels, attrs, kind = load_any(path)
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

        Validates that the dark file produces the same channel keys + shapes
        as the parent source. Returns the updated `LoadedSource`. Raises
        `KeyError` if the source id is unknown, `ValueError` on shape mismatch.
        """
        src = self.get(source_id)
        dark_channels, _attrs, _kind = load_any(path)
        _validate_dark_shapes(src, dark_channels)
        with self._lock:
            src.dark_channels = dark_channels
            src.dark_name = name or Path(path).name
            src.dark_path = str(Path(path).expanduser().resolve())
        return src

    def attach_dark_from_bytes(self, source_id: str, data: bytes, name: str
                               ) -> "LoadedSource":
        """Persist uploaded dark bytes to a temp file and attach via load_any."""
        import tempfile
        suffix = Path(name).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = Path(f.name)
        try:
            src = self.get(source_id)
            dark_channels, _attrs, _kind = load_any(tmp_path)
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
