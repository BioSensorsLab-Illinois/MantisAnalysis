"""H5 inspection + per-frame extraction for Playback recordings.

Real MantisCam GSense H5 layout (verified against
``/Users/zz4/Desktop/day5_breast_subject_1/``):

::

    /camera/frames                       (N, 2048, 4096, 1) uint16
    /camera/integration-time             (N,)              float64  µs (actual)
    /camera/integration-time-expected    (N,)              float64  µs (target)
    /camera/timestamp                    (N,)              float64  UTC seconds

Root attrs include ``hardware-info``, ``network-info``, ``os-info``,
``python-info`` (JSON strings) and ``sw-version``, ``time-info``. The
network/host attrs are stripped before any value leaves this module —
they aren't useful for analysis and they leak the recorder's machine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import h5py
import numpy as np


_FRAMES_DATASETS = ("/camera/frames",)
_TIMESTAMP_DATASETS = ("/camera/timestamp",)
_INT_TIME_DATASETS = ("/camera/integration-time",)
_INT_TIME_EXPECTED_DATASETS = ("/camera/integration-time-expected",)


@dataclass(frozen=True)
class H5Meta:
    """What we learn about a single H5 without reading the frames."""

    path: Path
    n_frames: int
    raw_shape: Tuple[int, int]  # (H, W) — full Bayer mosaic, HG+LG side-by-side
    dtype: str
    timestamps_s: Optional[np.ndarray]            # (N,)
    integration_times_us: Optional[np.ndarray]    # (N,) actual
    integration_times_target_us: Optional[np.ndarray]  # (N,) target
    camera_attrs: Dict[str, Any] = field(default_factory=dict)
    sw_version: Optional[str] = None
    warnings: List[str] = field(default_factory=list)

    @property
    def exposure_min_us(self) -> Optional[float]:
        a = self.integration_times_us
        return float(a.min()) if a is not None and a.size else None

    @property
    def exposure_max_us(self) -> Optional[float]:
        a = self.integration_times_us
        return float(a.max()) if a is not None and a.size else None

    @property
    def exposure_mean_us(self) -> Optional[float]:
        a = self.integration_times_us
        return float(a.mean()) if a is not None and a.size else None


def inspect(path: str | Path) -> H5Meta:
    """Read metadata only. No frame I/O."""

    raise NotImplementedError("M1 will implement inspect()")


def read_frame(path: str | Path, frame_idx: int) -> np.ndarray:
    """Read a single full-Bayer frame as ``uint16`` array of shape (H, W)."""

    raise NotImplementedError("M1 will implement read_frame()")
