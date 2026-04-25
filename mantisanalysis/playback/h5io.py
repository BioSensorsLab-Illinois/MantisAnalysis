"""H5 inspection + per-frame extraction for Playback recordings.

Real MantisCam GSense H5 layout (verified against
``/Users/zz4/Desktop/day5_breast_subject_1/``):

::

    /camera/frames                       (N, 2048, 4096, 1) uint16
    /camera/integration-time             (N,)              float64  µs (actual)
    /camera/integration-time-expected    (N,)              float64  µs (target)
    /camera/timestamp                    (N,)              float64  UTC seconds

The recorder stores frames as ``(N, H, W, 1)`` to keep the channel axis
consistent with multi-band sensors. We squeeze the trailing 1 so callers
get a clean 2-D mosaic per frame.

Root attrs include ``hardware-info``, ``network-info``, ``os-info``,
``python-info`` (JSON strings) and ``sw-version``, ``time-info``. The
sensitive subset is stripped before any value leaves this module —
they leak the recorder's hostname, IPs, and user environment without
serving any analysis purpose.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import h5py
import numpy as np


FRAMES_DATASET = "/camera/frames"
TIMESTAMP_DATASET = "/camera/timestamp"
INT_TIME_DATASET = "/camera/integration-time"
INT_TIME_TARGET_DATASET = "/camera/integration-time-expected"

# Root attrs that leak the recorder's identity — never expose.
_BLOCKED_ROOT_ATTRS = frozenset(
    {"network-info", "os-info", "hardware-info", "python-info"}
)


@dataclass(frozen=True)
class H5Meta:
    """What we learn about a single H5 without reading the frames."""

    path: Path
    n_frames: int
    raw_shape: Tuple[int, int]  # (H, W) — full Bayer mosaic, HG+LG side-by-side
    dtype: str
    timestamps_s: Optional[np.ndarray]                 # (N,) UTC seconds
    integration_times_us: Optional[np.ndarray]         # (N,) actual µs
    integration_times_target_us: Optional[np.ndarray]  # (N,) target µs
    camera_attrs: Dict[str, Any] = field(default_factory=dict)
    root_attrs: Dict[str, Any] = field(default_factory=dict)
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


def _strip_sensitive(attrs: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in attrs.items() if k not in _BLOCKED_ROOT_ATTRS}


def _decode_attr(v: Any) -> Any:
    """h5py returns bytes for fixed-length string attrs; decode for JSON-friendliness."""
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            return v.hex()
    if isinstance(v, np.ndarray) and v.dtype.kind in ("S", "O"):
        return [_decode_attr(x) for x in v.tolist()]
    if isinstance(v, np.generic):
        return v.item()
    return v


def _read_attrs(obj: h5py.HLObject) -> Dict[str, Any]:
    return {k: _decode_attr(v) for k, v in obj.attrs.items()}


def _read_optional_dataset(f: h5py.File, path: str) -> Optional[np.ndarray]:
    if path not in f:
        return None
    return np.asarray(f[path])


def inspect(path: str | Path) -> H5Meta:
    """Read metadata only. No frame I/O.

    Raises FileNotFoundError if the path doesn't exist; ValueError if
    the file isn't a recognizable MantisCam recording (no /camera/frames).
    """

    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"H5 not found: {p}")

    warnings: List[str] = []

    with h5py.File(p, "r") as f:
        if FRAMES_DATASET not in f:
            raise ValueError(
                f"{p.name}: missing required dataset {FRAMES_DATASET}"
            )
        ds = f[FRAMES_DATASET]
        shape = tuple(ds.shape)
        dtype = str(ds.dtype)

        # Accept (N, H, W) or (N, H, W, 1). Anything else is unsupported.
        if len(shape) == 4 and shape[-1] == 1:
            n_frames, h, w, _ = shape
        elif len(shape) == 3:
            n_frames, h, w = shape
        else:
            raise ValueError(
                f"{p.name}: unsupported /camera/frames shape {shape}; "
                "expected (N, H, W) or (N, H, W, 1)"
            )

        ts = _read_optional_dataset(f, TIMESTAMP_DATASET)
        it_actual = _read_optional_dataset(f, INT_TIME_DATASET)
        it_target = _read_optional_dataset(f, INT_TIME_TARGET_DATASET)

        if ts is None:
            warnings.append("W-META-TS")
        elif ts.size >= 2 and not np.all(np.diff(ts) >= 0):
            warnings.append("W-TS-DISORDER")

        if it_actual is None:
            warnings.append("W-META-EXP")

        camera_attrs = _read_attrs(f["/camera"]) if "/camera" in f else {}
        root_attrs = _strip_sensitive(_read_attrs(f))

    return H5Meta(
        path=p,
        n_frames=int(n_frames),
        raw_shape=(int(h), int(w)),
        dtype=dtype,
        timestamps_s=ts,
        integration_times_us=it_actual,
        integration_times_target_us=it_target,
        camera_attrs=camera_attrs,
        root_attrs=root_attrs,
        warnings=warnings,
    )


def read_frame(path: str | Path, frame_idx: int) -> np.ndarray:
    """Read a single full-Bayer frame as ``uint16`` array of shape (H, W)."""

    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"H5 not found: {p}")

    with h5py.File(p, "r") as f:
        if FRAMES_DATASET not in f:
            raise ValueError(
                f"{p.name}: missing required dataset {FRAMES_DATASET}"
            )
        ds = f[FRAMES_DATASET]
        shape = tuple(ds.shape)
        n = shape[0]
        if not 0 <= frame_idx < n:
            raise IndexError(
                f"frame_idx {frame_idx} out of range [0, {n})"
            )
        if len(shape) == 4 and shape[-1] == 1:
            arr = np.asarray(ds[frame_idx, :, :, 0])
        elif len(shape) == 3:
            arr = np.asarray(ds[frame_idx])
        else:
            raise ValueError(f"unsupported frames shape {shape}")

    if arr.dtype != np.uint16:
        arr = arr.astype(np.uint16, copy=False)
    return arr
