"""H5 loader and 4-pixel-stride channel extractor for GSense RGB-NIR recordings.

Matches cameras/isp/gs_rgb_nir/serializer.py exactly:
    - dual-gain frame is split horizontally into HG (left) and LG (right) halves
    - each half holds a 4x4 super-pixel mosaic
    - per-channel pixel = img[loc_row*2 + origin_row :: 4, loc_col*2 + origin_col :: 4]

User-fixed pattern for this study (origin=(0,0)):
    B   = (0, 0) -> img[0::4, 0::4]
    R   = (0, 1) -> img[0::4, 2::4]
    G   = (1, 0) -> img[2::4, 0::4]
    NIR = (1, 1) -> img[2::4, 2::4]
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import h5py
import numpy as np


ORIGIN = (0, 0)
LOC = {"B": (0, 0), "R": (0, 1), "G": (1, 0), "NIR": (1, 1)}


@dataclass
class Recording:
    path: Path
    frames: np.ndarray          # (N, H, W) uint16, full dual-gain frame
    timestamp: np.ndarray       # (N,)
    int_time: np.ndarray        # (N,) actual integration time, microseconds
    int_time_set: np.ndarray    # (N,) requested integration time
    attrs: Dict[str, str]

    @property
    def n_frames(self) -> int:
        return int(self.frames.shape[0])

    @property
    def shape(self) -> Tuple[int, int]:
        return int(self.frames.shape[1]), int(self.frames.shape[2])


def load_recording(path: str | Path, frame_slice: Optional[slice] = None) -> Recording:
    """Load a MantisCam raw_h5 recording into memory.

    Files written by `cameras/cam/save.py:upon_create` may not have a `.h5`
    extension; HDF5 format is detected by content, not name.
    """
    p = Path(path)
    with h5py.File(p, "r") as f:
        if "camera" not in f:
            raise ValueError(f"{p}: missing /camera group")
        cam = f["camera"]
        ds = cam["frames"]
        sl = frame_slice if frame_slice is not None else slice(None)
        frames = np.asarray(ds[sl])
        if frames.ndim == 4 and frames.shape[-1] == 1:
            frames = frames[..., 0]
        ts = np.asarray(cam["timestamp"][sl]) if "timestamp" in cam else np.zeros(frames.shape[0])
        it = np.asarray(cam["integration-time"][sl]) if "integration-time" in cam else np.zeros(frames.shape[0])
        ite = np.asarray(cam["integration-time-expected"][sl]) if "integration-time-expected" in cam else it.copy()
        attrs = {}
        for k in cam.attrs.keys():
            v = cam.attrs[k]
            try:
                attrs[k] = v.decode() if isinstance(v, (bytes, bytearray)) else str(v)
            except Exception:
                attrs[k] = repr(v)
    return Recording(path=p, frames=frames.astype(np.uint16, copy=False),
                     timestamp=ts, int_time=it, int_time_set=ite, attrs=attrs)


def split_dual_gain(frame: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Split a single dual-gain frame into (HG_left, LG_right)."""
    if frame.ndim == 3 and frame.shape[-1] == 1:
        frame = frame[..., 0]
    if frame.ndim != 2:
        raise ValueError(f"expected 2D frame, got shape {frame.shape}")
    half = frame.shape[1] // 2
    return frame[:, :half], frame[:, half:]


def extract_channel(half: np.ndarray, channel: str,
                    origin: Tuple[int, int] = ORIGIN) -> np.ndarray:
    """Extract one channel (R/G/B/NIR) from a single half-frame.

    Mirrors cameras/isp/gs_rgb_nir/serializer.py:__extract_channel.
    """
    if channel not in LOC:
        raise KeyError(f"unknown channel {channel!r}; expected one of {list(LOC)}")
    loc_r, loc_c = LOC[channel]
    row = loc_r * 2 + int(origin[0])
    col = loc_c * 2 + int(origin[1])
    return half[row::4, col::4]


def extract_by_spec(half: np.ndarray,
                    loc: Tuple[int, int],
                    origin: Tuple[int, int],
                    sub_step: Tuple[int, int],
                    outer_stride: Tuple[int, int]) -> np.ndarray:
    """Generalized extractor used by the ISP-mode registry.

    Formula (mirrors the legacy GS-RGB-NIR math when ``sub_step=(2,2)``
    and ``outer_stride=(4,4)``)::

        row = loc[0] * sub_step[0] + origin[0]
        col = loc[1] * sub_step[1] + origin[1]
        return half[row::outer_stride[0], col::outer_stride[1]]

    Origin + sub-step + outer-stride are separate so a caller can describe
    any super-pixel geometry: 1×1 bare, 2×2 classic Bayer, 4×4 GSense
    dense, larger polarization / spectral blocks. Callers pass the raw
    tuples from ``isp_modes.normalize_config``; validation lives there.
    """
    if half.ndim == 3 and half.shape[-1] == 1:
        half = half[..., 0]
    row = int(loc[0]) * int(sub_step[0]) + int(origin[0])
    col = int(loc[1]) * int(sub_step[1]) + int(origin[1])
    return half[row::int(outer_stride[0]), col::int(outer_stride[1])]


def extract_rgb_nir(half: np.ndarray,
                    origin: Tuple[int, int] = ORIGIN) -> Dict[str, np.ndarray]:
    """Return {'R','G','B','NIR'} from one HG or LG half-frame."""
    return {ch: extract_channel(half, ch, origin) for ch in ("R", "G", "B", "NIR")}


def make_rgb_image(channels: Dict[str, np.ndarray]) -> np.ndarray:
    """Stack R/G/B channels into an (H,W,3) uint16 image."""
    return np.dstack([channels["R"], channels["G"], channels["B"]])
