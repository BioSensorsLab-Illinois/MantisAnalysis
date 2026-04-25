"""Single render entry — used by both preview-PNG and image/video export.

WYSIWYG invariant: ``render_view(stream, frame, view, library)``
returns the PNG bytes that the export pipeline will burn into the
output file. There is no second code path.

M4 supports single-channel views (`view.type == "single"`). RGB
composites + overlays land in M5.
"""

from __future__ import annotations

import io
from functools import lru_cache
from typing import TYPE_CHECKING

import numpy as np
from PIL import Image

from .. import extract as _extract
from . import h5io


if TYPE_CHECKING:
    from .library import Library
    from .workspace import Stream, View


def _resolve_local(stream: "Stream", frame: int, library: "Library"):
    """Map global frame index → (recording, local_frame_idx)."""
    cursor = 0
    for rid in stream.rec_ids:
        rec = library.get_recording(rid)
        if frame < cursor + rec.n_frames:
            return rec, frame - cursor
        cursor += rec.n_frames
    raise IndexError(f"frame {frame} out of range for stream {stream.stream_id}")


def _half_for_channel(raw: np.ndarray, channel: str) -> np.ndarray:
    """Return the HG or LG half of a dual-gain mosaic."""
    hg, lg = _extract.split_dual_gain(raw)
    return lg if channel.startswith("LG") else hg


def _band_of(channel: str) -> str:
    parts = channel.split("-", 1)
    return parts[1] if len(parts) == 2 else channel


def _apply_window(arr: np.ndarray, low: int, high: int) -> np.ndarray:
    """Window a uint16 array into uint8 [0, 255]."""
    lo, hi = float(low), float(max(high, low + 1))
    a = arr.astype(np.float32)
    a = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    return (a * 255.0 + 0.5).astype(np.uint8)


@lru_cache(maxsize=16)
def _cmap_lut(name: str) -> np.ndarray:
    """Return a 256×3 uint8 LUT for the named colormap."""
    if name == "gray":
        ramp = np.arange(256, dtype=np.uint8)
        return np.stack([ramp, ramp, ramp], axis=-1)
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    cm = plt.get_cmap(name)
    samples = cm(np.linspace(0.0, 1.0, 256))[:, :3]  # (256, 3) RGBA → RGB
    return (samples * 255.0 + 0.5).astype(np.uint8)


def _to_rgb(window: np.ndarray, colormap: str) -> np.ndarray:
    """Apply a colormap LUT to a windowed uint8 image. Returns (H, W, 3)."""
    lut = _cmap_lut(colormap)
    return lut[window]


def _png_bytes(arr_rgb: np.ndarray) -> bytes:
    """Encode an (H, W, 3) uint8 array as PNG."""
    img = Image.fromarray(arr_rgb, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=4)
    return buf.getvalue()


def render_view(
    stream: "Stream",
    frame: int,
    view: "View",
    library: "Library",
) -> bytes:
    """Return PNG bytes for the rendered view.

    M4 supports `view.type == 'single'` only. Dark correction is
    skipped at this milestone (added in M5 with the dark-frame UI).
    Colormap + low/high windowing + invert are honored.
    """

    rec, local = _resolve_local(stream, frame, library)
    raw = h5io.read_frame(rec.path, local)
    half = _half_for_channel(raw, view.channel)
    band = _band_of(view.channel)

    # Single-channel extract via the legacy GSense Bayer constants.
    plane = _extract.extract_channel(half, band)

    # Optional gain + offset before windowing.
    if view.gain != 1.0 or view.offset != 0.0:
        plane32 = plane.astype(np.float32) * float(view.gain) + float(view.offset)
        plane32 = np.clip(plane32, 0.0, 65535.0)
        plane = plane32.astype(np.uint16)

    if view.normalize:
        # Auto-stretch min..max into the user's window.
        pmin = int(plane.min())
        pmax = int(plane.max())
        win = _apply_window(plane, pmin, pmax if pmax > pmin else pmin + 1)
    else:
        win = _apply_window(plane, view.low, view.high)

    if view.invert:
        win = 255 - win

    rgb = _to_rgb(win, view.colormap)
    return _png_bytes(rgb)
