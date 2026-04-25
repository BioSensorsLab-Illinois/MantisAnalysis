"""Compatibility reader for legacy gsbsi-prefix GSense BSI H5 recordings.

Used **only by the Play / Recording Inspection mode**. Lives outside
``image_io.py`` / ``extract.py`` so the canonical loader stays byte-identical
to current behaviour — the Play loader dispatches here when it detects the
legacy container layout, and the analysis modes (USAF / FPN / DoF) never see
this code.

Legacy file shape (e.g. ``gsbsi_2019-02-22-T053025_003.h5``)::

    /dset           uint16 (H*W, N)   — each column is one frame's pixels
                                        in row-major order
    /exposure       int32  (16, 2)    — sparse table; rows 0–1 carry the
                                        configured HG / LG exposures
    /exposure_us    float32 (2, N)    — per-frame HG / LG integration time
                                        in microseconds (row 0 = HG short,
                                        row 1 = LG long)
    /frameNumbers   int32  (2, N)     — per-frame counter (often all zero in
                                        early firmware; we synthesize a
                                        running index when so)

Frame layout after ``column.reshape(H, W)`` (verified empirically on the
2019-02-22 dataset; H = 2048, W = 1024):

  * Rows interleave HG and LG with period 4. Within each gain pair the two
    color rows split the Bayer super-pixel into two halves::

        row 0 (mod 4) — LG color row A   (columns hold one half-pixel pair)
        row 1 (mod 4) — HG color row A
        row 2 (mod 4) — LG color row B
        row 3 (mod 4) — HG color row B

  * Columns alternate (period 2) between the two color positions inside a
    super-pixel. The mapping below mirrors the canonical channel-key schema
    (HG-R, HG-G, HG-B, HG-NIR, LG-R, LG-G, LG-B, LG-NIR), then synthesizes
    HG-Y / LG-Y via Rec.601 luminance and HDR-{R,G,B,NIR,Y} via the standard
    saturation-aware fusion. From the Play frontend's point of view, a legacy
    source is indistinguishable from a current MantisCam recording.

Pure NumPy + h5py — no FastAPI / React / Qt imports, per AGENT_RULES rule 7.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional, Tuple

import h5py
import numpy as np


LEGACY_FRAME_HW: Tuple[int, int] = (2048, 1024)
LEGACY_PIXELS_PER_FRAME: int = LEGACY_FRAME_HW[0] * LEGACY_FRAME_HW[1]


def is_legacy_gsbsi_h5(path: str | Path) -> bool:
    """True iff `path` looks like the legacy gsbsi container layout.

    Detection is structural — HDF5 magic bytes plus a top-level ``/dset``
    of the right shape and dtype, plus ``/exposure_us``, plus *no*
    ``/camera`` group (the modern MantisCam path always has one). Returns
    False on any error so callers can fall through to the modern loader.
    """
    p = Path(path)
    if not p.exists():
        return False
    try:
        with open(p, "rb") as fh:
            if fh.read(8) != b"\x89HDF\r\n\x1a\n":
                return False
    except OSError:
        return False
    try:
        with h5py.File(p, "r") as f:
            if "camera" in f:
                return False
            if "dset" not in f or "exposure_us" not in f:
                return False
            ds = f["dset"]
            if ds.ndim != 2:
                return False
            if int(ds.shape[0]) != LEGACY_PIXELS_PER_FRAME:
                return False
            return True
    except (OSError, KeyError):
        return False


def legacy_inspect(path: str | Path) -> Dict[str, object]:
    """Return frame_count, per-frame exposures (s), per-frame timestamps.

    Timestamps are synthesized as ``arange(N)`` because the legacy container
    doesn't record wall-clock time — the Play loader emits a ``W-META-TS``
    warning so the user sees that frame indexing is a stand-in.
    """
    p = Path(path)
    with h5py.File(p, "r") as f:
        ds = f["dset"]
        n_frames = int(ds.shape[1])
        exp_us_obj = f.get("exposure_us")
        if exp_us_obj is not None:
            exp_us = np.asarray(exp_us_obj)
        else:
            exp_us = np.zeros((2, n_frames), dtype=np.float32)
        if exp_us.ndim == 2 and exp_us.shape[1] == n_frames and exp_us.shape[0] >= 2:
            primary = exp_us[1]
        elif exp_us.ndim == 2 and exp_us.shape[1] == n_frames:
            primary = exp_us[0]
        elif exp_us.ndim == 1 and exp_us.shape[0] == n_frames:
            primary = exp_us
        else:
            primary = np.zeros(n_frames, dtype=np.float32)
        exposures_s = np.asarray(primary, dtype=np.float64) * 1e-6
        timestamps = np.arange(n_frames, dtype=np.float64)
    return {
        "n_frames": n_frames,
        "exposures_s": exposures_s,
        "timestamps": timestamps,
        "frame_hw": LEGACY_FRAME_HW,
    }


LEGACY_BIT_DEPTH: int = 12
LEGACY_TO_UINT16_SHIFT: int = 16 - LEGACY_BIT_DEPTH  # 4


def legacy_read_frame(dset, idx: int) -> np.ndarray:
    """Read frame ``idx`` from a ``/dset`` handle and reshape to (H, W) uint16.

    ``dset`` may be either an ``h5py.Dataset`` or an in-memory ``np.ndarray``
    of the same ``(H*W, N)`` shape. The latter is what
    ``LegacyFrameReader`` builds at open time so subsequent reads avoid
    the per-column scattered-stride h5py read on the un-chunked legacy
    container (which on a 537 MB file produces ~1 fps playback, since
    every column is 4 MB strided across the entire file).

    Legacy gsbsi-prefix recordings are **12-bit** (raw values run 0–4095);
    the modern Play display pipeline normalizes against the dtype max
    (65535 for uint16) so a 12-bit frame would appear ~16× too dim. We
    left-shift by 4 here so a saturated 12-bit pixel (0x0FFF) maps to a
    saturated 16-bit pixel (0xFFF0). Doing the shift at the read boundary
    keeps every downstream code path (frame 0 channel snapshot, per-frame
    extraction, dark-frame averaging) byte-identical to a current uint16
    recording — no callers need to know the source was 12-bit.
    """
    n_frames = int(dset.shape[1])
    if not (0 <= idx < n_frames):
        raise IndexError(f"frame {idx} out of range [0, {n_frames})")
    col = np.asarray(dset[:, int(idx)])
    H, W = LEGACY_FRAME_HW
    raw = col.reshape(H, W).astype(np.uint16, copy=False)
    return np.left_shift(raw, LEGACY_TO_UINT16_SHIFT)


def _luminance_rec601(rgb: Dict[str, np.ndarray]) -> np.ndarray:
    """Rec.601 luminance over R/G/B in the source dtype (clipped to dtype range)."""
    r = rgb["R"].astype(np.float64)
    g = rgb["G"].astype(np.float64)
    b = rgb["B"].astype(np.float64)
    y = 0.299 * r + 0.587 * g + 0.114 * b
    out_dtype = rgb["R"].dtype
    if np.issubdtype(out_dtype, np.integer):
        info = np.iinfo(out_dtype)
        y = np.clip(y, info.min, info.max)
    return y.astype(out_dtype, copy=False)


def extract_legacy_channels(frame: np.ndarray) -> Dict[str, np.ndarray]:
    """Demosaic a (2048, 1024) legacy gsbsi frame into 10 base channels.

    Emits the canonical schema (``HG-R, HG-G, HG-B, HG-NIR, HG-Y, LG-R,
    LG-G, LG-B, LG-NIR, LG-Y``). Channel shapes are (H/4, W/2) — i.e.
    (512, 512) for the canonical 2048×1024 legacy frame. Callers add the
    HDR-* channels via ``hdr_fusion.add_hdr_channels`` to match the modern
    Play pipeline.
    """
    if frame.ndim == 3 and frame.shape[-1] == 1:
        frame = frame[..., 0]
    if frame.shape != LEGACY_FRAME_HW:
        raise ValueError(
            f"expected legacy frame shape {LEGACY_FRAME_HW}, got {frame.shape}"
        )
    f = frame
    channels: Dict[str, np.ndarray] = {
        "LG-B":   np.ascontiguousarray(f[0::4, 0::2]),
        "LG-R":   np.ascontiguousarray(f[0::4, 1::2]),
        "HG-B":   np.ascontiguousarray(f[1::4, 0::2]),
        "HG-R":   np.ascontiguousarray(f[1::4, 1::2]),
        "LG-G":   np.ascontiguousarray(f[2::4, 0::2]),
        "LG-NIR": np.ascontiguousarray(f[2::4, 1::2]),
        "HG-G":   np.ascontiguousarray(f[3::4, 0::2]),
        "HG-NIR": np.ascontiguousarray(f[3::4, 1::2]),
    }
    channels["HG-Y"] = _luminance_rec601(
        {"R": channels["HG-R"], "G": channels["HG-G"], "B": channels["HG-B"]}
    )
    channels["LG-Y"] = _luminance_rec601(
        {"R": channels["LG-R"], "G": channels["LG-G"], "B": channels["LG-B"]}
    )
    return channels


class LegacyFrameReader:
    """Drop-in replacement for ``session.FrameReader`` on legacy gsbsi files.

    Same public interface (``n_frames``, ``exposures_s``, ``timestamps``,
    ``read_frame(idx)``, ``close()``) so ``LoadedSource.extract_frame`` can
    swap one for the other. Holds the h5py handle open across calls; closed
    on session eviction.
    """

    def __init__(self, path: str | Path):
        self.path: Path = Path(path)
        self._h5: Optional[h5py.File] = None
        # _dset starts as the h5py handle and is replaced by an in-memory
        # numpy array after the first read, since the legacy ``/dset`` is
        # un-chunked contiguous storage. Per-column reads on un-chunked
        # data are O(file size) (scattered seeks across the entire 537 MB
        # file), so caching the whole dataset once trades a one-time load
        # cost for O(1) per-frame slicing afterwards. This is what makes
        # the difference between ~1 fps playback and the target 10+ fps.
        self._dset: Optional[h5py.Dataset] = None
        self._mem: Optional[np.ndarray] = None
        self._n: Optional[int] = None
        self._exposures_s: Optional[np.ndarray] = None
        self._timestamps: Optional[np.ndarray] = None

    def _ensure_open(self) -> None:
        if self._h5 is not None:
            return
        h5 = h5py.File(self.path, "r")
        try:
            ds = h5["dset"]
            self._dset = ds  # type: ignore[assignment]
            # Slurp the whole un-chunked /dset into RAM once. ds[...] does
            # a single contiguous read of the dataset's storage region;
            # subsequent ``self._mem[:, idx]`` slices are pure NumPy
            # views and run in microseconds. Memory cost is the dataset
            # size (typically 256-540 MB for legacy files) — well within
            # what this Play loader is expected to budget.
            self._mem = np.asarray(ds[...])
            info = legacy_inspect(self.path)
            self._n = int(info["n_frames"])
            self._exposures_s = np.asarray(info["exposures_s"], dtype=np.float64)
            self._timestamps = np.asarray(info["timestamps"], dtype=np.float64)
        except Exception:
            h5.close()
            raise
        self._h5 = h5

    @property
    def n_frames(self) -> int:
        self._ensure_open()
        assert self._n is not None
        return self._n

    @property
    def exposures_s(self) -> np.ndarray:
        self._ensure_open()
        assert self._exposures_s is not None
        return self._exposures_s.copy()

    @property
    def timestamps(self) -> np.ndarray:
        self._ensure_open()
        assert self._timestamps is not None
        return self._timestamps.copy()

    def read_frame(self, idx: int) -> np.ndarray:
        self._ensure_open()
        # Prefer the in-memory cache; fall back to the h5py dataset only
        # if the eager-load somehow didn't run.
        src = self._mem if self._mem is not None else self._dset
        assert src is not None
        return legacy_read_frame(src, idx)

    def close(self) -> None:
        if self._h5 is not None:
            try:
                self._h5.close()
            finally:
                self._h5 = None
                self._dset = None
                self._mem = None
