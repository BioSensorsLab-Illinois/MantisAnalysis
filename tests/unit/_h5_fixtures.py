"""Synthetic H5 fixtures for the recording-inspection-implementation-v1
initiative (M1+).

This module is the single source of truth for synthetic recording H5
files used by `tests/unit/test_recording_inspect.py`,
`tests/unit/test_dark_frame.py`, and `tests/unit/test_playback_stream.py`.
We deliberately ship NO real H5 binaries (AGENT_RULES rule 11);
every fixture is generated in a tmp_path at test time.

Each frame's pixel value encodes (frame_idx, row, col) so tests can
verify "the pixel I extracted came from the frame I asked for" without
trusting any other layer.

Variants (per .agent/runs/recording-inspection-implementation-v1/DATA_MODEL.md §2.2):
  * canonical       — /camera/{frames,timestamp,integration-time,integration-time-expected}
  * no-timestamp    — drop /camera/timestamp                  → W-META-TS
  * no-exposure     — drop /camera/integration-time           → W-META-EXP
  * top-level       — frames at top level instead of /camera/ → W-META-PATH
  * single-frame    — 2-D dataset (one frame), no leading axis → W-META-SINGLE-FRAME
  * four-d          — (N, H, W, 1) legacy shape (real GSense FSI uses this)
  * empty           — n_frames=0
  * non-monotonic-ts — timestamps decrease mid-file           → W-TS-DISORDER
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import h5py
import numpy as np


CANONICAL_FRAMES_PATH = "/camera/frames"
TOP_LEVEL_FRAMES_PATH = "/frames"


def _tagged_frame(frame_idx: int, h: int, w: int, dtype: np.dtype = np.uint16
                  ) -> np.ndarray:
    """Build one frame whose pixel value encodes (frame_idx, row, col).

    Pixel value = (frame_idx * 1_000_000) + (row * 1_000) + col, clamped
    to dtype bounds. Lets tests assert the right pixel was extracted.
    """
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    arr = (np.int64(frame_idx) * 1_000_000
           + rr.astype(np.int64) * 1_000
           + cc.astype(np.int64))
    info = np.iinfo(dtype)
    arr = np.clip(arr, info.min, info.max)
    return arr.astype(dtype, copy=False)


def write_synthetic_recording(
    path: Path,
    *,
    n_frames: int = 8,
    h: int = 32,
    w: int = 64,
    exposure_us: int = 20_000,
    fps: float = 30.0,
    ts_start_s: float = 0.0,
    variant: str = "canonical",
    camera_attrs: Optional[dict] = None,
    use_4d_shape: bool = False,
) -> None:
    """Build a Mantis-style dual-gain H5 with tagged pixel values.

    Parameters
    ----------
    path : pathlib.Path
        Where to write the H5. Caller owns lifecycle (typically a
        ``tmp_path`` fixture).
    n_frames, h, w :
        Frame dataset shape. ``w`` defaults to twice ``h`` so the
        dual-gain split (left=HG, right=LG) lands cleanly.
    exposure_us :
        Recorded integration time in microseconds (broadcast to all
        frames).
    fps, ts_start_s :
        Drives the synthesized ``/camera/timestamp`` array. Each frame's
        timestamp is ``ts_start_s + frame_idx / fps``.
    variant :
        See module docstring. Selects the layout shape.
    camera_attrs :
        Extra ``/camera`` attrs. Defaults to a representative subset
        (mirrors the real dev-folder file metadata).
    use_4d_shape :
        When True, the frames dataset is ``(N, H, W, 1)`` to match the
        real GSense FSI dev recording legacy layout. Independent of
        ``variant``.
    """
    if variant == "empty":
        n_frames = 0

    if camera_attrs is None:
        camera_attrs = {
            "fw-version": "v3.0",
            "imager-filter-array": "GSense FSI Dual-Gain (synthetic)",
            "model-name": "Synthetic GSense",
            "vendor": "MantisAnalysis test fixture",
        }

    # Build frame data.
    frames = np.stack(
        [_tagged_frame(i, h, w) for i in range(n_frames)],
        axis=0,
    ) if n_frames > 0 else np.zeros((0, h, w), dtype=np.uint16)

    if use_4d_shape and n_frames > 0:
        frames = frames[..., None]
    elif use_4d_shape and n_frames == 0:
        frames = np.zeros((0, h, w, 1), dtype=np.uint16)

    # Build timestamps and exposure arrays.
    ts = np.asarray(
        [ts_start_s + i / fps for i in range(n_frames)],
        dtype=np.float64,
    )

    if variant == "non-monotonic-ts" and n_frames >= 4:
        # Swap two adjacent timestamps mid-file.
        i = n_frames // 2
        ts[i], ts[i + 1] = ts[i + 1], ts[i]

    it = np.full((n_frames,), float(exposure_us), dtype=np.float64)
    ite = it.copy()

    with h5py.File(path, "w") as f:
        if variant == "single-frame":
            # 2-D dataset, no leading axis.
            single = frames[0] if n_frames else np.zeros((h, w), dtype=np.uint16)
            cam = f.create_group("camera")
            cam.create_dataset("frames", data=single)
            cam.create_dataset("timestamp", data=np.asarray([ts_start_s], dtype=np.float64))
            cam.create_dataset("integration-time", data=np.asarray([float(exposure_us)], dtype=np.float64))
            cam.create_dataset("integration-time-expected",
                               data=np.asarray([float(exposure_us)], dtype=np.float64))
            for k, v in camera_attrs.items():
                cam.attrs[k] = v
            return

        if variant == "top-level":
            # frames at top-level instead of inside /camera/.
            f.create_dataset("frames", data=frames)
            f.create_dataset("timestamp", data=ts)
            f.create_dataset("integration-time", data=it)
            for k, v in camera_attrs.items():
                f.attrs[k] = v
            return

        # All other variants share /camera group structure.
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)

        if variant != "no-timestamp":
            cam.create_dataset("timestamp", data=ts)
        if variant != "no-exposure":
            cam.create_dataset("integration-time", data=it)
            cam.create_dataset("integration-time-expected", data=ite)

        for k, v in camera_attrs.items():
            cam.attrs[k] = v


def write_synthetic_dark(
    path: Path,
    *,
    n_frames: int = 16,
    h: int = 32,
    w: int = 64,
    exposure_us: int = 20_000,
    pedestal: int = 140,
    shot_noise: int = 12,
    seed: int = 42,
    use_4d_shape: bool = False,
) -> None:
    """Build a dark-stack H5 with a known mean-of-pedestal (± noise).

    Each frame is `pedestal + uniform(-noise, +noise)`; averaging the
    stack converges to ~pedestal. Tests assert the averaged dark frame's
    pixel mean matches `pedestal` to within ~1 LSB at default n_frames.
    """
    rng = np.random.default_rng(seed)
    base = np.full((n_frames, h, w), pedestal, dtype=np.int32)
    noise = rng.integers(-shot_noise, shot_noise + 1, size=base.shape)
    frames = np.clip(base + noise, 0, np.iinfo(np.uint16).max).astype(np.uint16)
    if use_4d_shape:
        frames = frames[..., None]

    ts = np.arange(n_frames, dtype=np.float64) / 30.0
    it = np.full((n_frames,), float(exposure_us), dtype=np.float64)

    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=it)
        cam.create_dataset("integration-time-expected", data=it)
        cam.attrs["fw-version"] = "v3.0"
        cam.attrs["imager-filter-array"] = "GSense FSI Dual-Gain (synthetic dark)"
        cam.attrs["model-name"] = "Synthetic GSense Dark"


def expected_tagged_pixel(frame_idx: int, row: int, col: int,
                          dtype: np.dtype = np.uint16) -> int:
    """Mirror of `_tagged_frame`'s formula. Tests use this to assert
    extraction picked the right pixel."""
    info = np.iinfo(dtype)
    val = (int(frame_idx) * 1_000_000
           + int(row) * 1_000
           + int(col))
    return int(np.clip(val, info.min, info.max))


__all__ = [
    "CANONICAL_FRAMES_PATH",
    "TOP_LEVEL_FRAMES_PATH",
    "write_synthetic_recording",
    "write_synthetic_dark",
    "expected_tagged_pixel",
]
