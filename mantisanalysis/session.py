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
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple  # noqa: F401

import h5py
import numpy as np

from . import isp_modes as _isp
from .extract import load_recording
from .image_io import extract_with_mode, load_any_detail, luminance_from_rgb


# Per-source LRU bound for the frame extraction cache. Each entry is a
# dict of channel arrays — for the GSense RGB-NIR mode, ~10 channels of
# 1024×1024 uint16 ≈ 20 MB per frame. 16 entries ≈ 320 MB ceiling per source
# at full saturation. In practice playback hits a small working set.
# play-tab-recording-inspection-rescue-v1 M1.
PLAYBACK_CACHE_SIZE = 16


class FrameReader:
    """Lazy h5py reader for per-frame access in Play mode.

    Holds a path; opens the h5 handle on first use and keeps it open for
    the lifetime of the LoadedSource so playback / scrub doesn't pay the
    open() cost on every frame. The handle is closed in ``close()``,
    which the SessionStore calls during eviction.

    Not thread-safe across multiple writers, but safe for the
    single-worker FastAPI / uvicorn topology used by this app. h5py's
    GIL release on read is fine for many concurrent reads.

    play-tab-recording-inspection-rescue-v1 M1.
    """

    def __init__(self, path: Path):
        self.path: Path = path
        self._h5: Optional[h5py.File] = None
        self._frames_ds: Optional[h5py.Dataset] = None
        self._n: Optional[int] = None
        self._exposures_s: Optional[np.ndarray] = None
        self._timestamps: Optional[np.ndarray] = None

    def _ensure_open(self) -> None:
        if self._h5 is not None:
            return
        h5 = h5py.File(self.path, "r")
        try:
            cam = h5["camera"]
            ds = cam["frames"]
            self._n = int(ds.shape[0])
            # Cache scalar metadata as ndarrays so callers get a defensive
            # copy on every property access — the underlying h5 dataset
            # closes when the handle is released.
            it = cam["integration-time"][...] if "integration-time" in cam else np.zeros(self._n)
            ts = cam["timestamp"][...] if "timestamp" in cam else np.arange(self._n, dtype=np.float64)
            self._exposures_s = np.asarray(it, dtype=np.float64)
            self._timestamps = np.asarray(ts, dtype=np.float64)
            self._frames_ds = ds  # type: ignore[assignment]
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
        """Read one raw frame as 2-D uint16 (drops trailing length-1 axis)."""
        self._ensure_open()
        assert self._n is not None and self._frames_ds is not None
        if not (0 <= idx < self._n):
            raise IndexError(f"frame {idx} out of range [0, {self._n})")
        f = np.asarray(self._frames_ds[idx])
        if f.ndim == 3 and f.shape[-1] == 1:
            f = f[..., 0]
        # The on-disk dtype is uint16 already; copy=False keeps it cheap.
        return f.astype(np.uint16, copy=False)

    def close(self) -> None:
        if self._h5 is not None:
            try:
                self._h5.close()
            finally:
                self._h5 = None
                self._frames_ds = None


def _hash_isp_config(cfg: Optional[Dict[str, object]]) -> str:
    """Stable fingerprint of an ISP config for cache keys.

    The config is small and JSON-shaped (lists/dicts/scalars + tuples
    produced by ``normalize_config``), so a sorted-repr key is correct
    and fast enough.
    """
    if not cfg:
        return ""
    # ``sort_keys`` works for nested dicts; tuples become lists in repr.
    import json
    try:
        return json.dumps(cfg, sort_keys=True, default=lambda x: list(x))
    except TypeError:
        return repr(sorted(cfg.items()))


@dataclass
class LoadedSource:
    """One loaded file with its extracted channel dict."""
    source_id: str
    name: str
    source_kind: str                    # "h5" or "image"
    channels: Dict[str, np.ndarray]
    attrs: Dict[str, str]
    shape_hw: Tuple[int, int]           # per-channel pixel dims (H, W)
    # Raw mosaic dimensions of one frame BEFORE channel-split. For modern
    # MantisCam recordings this is the full ``camera/frames`` H × W
    # (typically 2048 × 4096); for legacy gsbsi files it's
    # ``LEGACY_FRAME_HW`` (2048 × 1024); for image sources it's the image
    # shape. Surfaced on the SourceSummary so the FilePill can display
    # "raw file resolution" alongside the per-channel ``shape_hw``.
    raw_shape: Tuple[int, int] = (0, 0)
    # Raw bit depth of the underlying sensor data. 12 for legacy gsbsi
    # (raw values 0–4095, normalized to uint16 at the read boundary by a
    # 4-bit left shift), 16 for modern MantisCam recordings, 8 for PNG /
    # JPEG image sources. Honest reporting — the user wants to know
    # whether their highlights are clipping at 4095 or 65535.
    raw_bit_depth: int = 16
    raw_dtype: str = "uint16"
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

    # play-tab-recording-inspection-rescue-v1 M1: per-frame access for
    # the new Play mode. ``frame_count`` is 1 for image sources, ≥1 for H5.
    # ``per_frame_exposures_s`` and ``per_frame_timestamps`` are only
    # populated for H5 (None for images). ``_h5_path`` lets the lazy
    # FrameReader open the file on first frame request.
    frame_count: int = 1
    per_frame_exposures_s: Optional[np.ndarray] = None
    per_frame_timestamps: Optional[np.ndarray] = None
    # M16: per-source warnings emitted at load time (missing metadata,
    # partial reads, etc.). Each entry is a dict ``{code, severity, detail}``
    # with code ∈ canonical W-* IDs (W-META-TS, W-META-EXP, W-FRAME-FAIL,
    # ...). Frontend renders chips on the FilePill and aggregates the same
    # entries into the Warning Center modal.
    warnings: List[Dict[str, str]] = field(default_factory=list)
    _h5_path: Optional[Path] = field(default=None, repr=False)
    # M11 hardening: when load_from_bytes wrote the upload to a temp
    # file, we hold on to that path here so per-frame access (which
    # reopens the H5 lazily) doesn't FileNotFoundError after the
    # tempfile would have otherwise been unlinked. close_frame_reader
    # cleans it up on eviction / removal.
    _owned_tempfile: Optional[Path] = field(default=None, repr=False)
    _frame_reader: Optional[FrameReader] = field(default=None, repr=False)
    # Per-source LRU of extracted channel dicts keyed by (frame_idx, isp_hash).
    # Bounded to PLAYBACK_CACHE_SIZE entries.
    _frame_extract_cache: "OrderedDict[Tuple[int, str], Dict[str, np.ndarray]]" = field(
        default_factory=OrderedDict, repr=False
    )
    # M11 reviewer P0: FastAPI runs sync handlers in a threadpool, so two
    # parallel /frame/{i}/... requests on the same source can race the
    # FrameReader init AND the OrderedDict mutation. Per-source RLock
    # serializes the cache + reader-open critical section. This is finer-
    # grained than STORE._lock (which would serialise ALL playback).
    _lock: "threading.RLock" = field(default_factory=threading.RLock, repr=False)
    # Play-only compatibility shim for the legacy gsbsi-prefix H5 container
    # (see ``legacy_h5.py``). When True, ``extract_frame`` swaps in a
    # ``LegacyFrameReader`` + ``extract_legacy_channels`` pipeline instead
    # of the modern ``FrameReader`` + ``extract_with_mode`` path. Default
    # False; set only by the Play loader's legacy dispatch.
    _legacy: bool = field(default=False, repr=False)

    @property
    def channel_keys(self) -> list[str]:
        return sorted(self.channels.keys())

    @property
    def has_dark(self) -> bool:
        return self.dark_channels is not None and len(self.dark_channels) > 0

    def extract_frame(self, idx: int) -> Dict[str, np.ndarray]:
        """Extract per-channel arrays for frame ``idx``.

        Frame 0 of an H5 source is byte-identical to ``self.channels``
        when the active ISP config matches the load-time config, but we
        don't optimize for that — the cache makes the round-trip free
        on the second request and the code path stays uniform.

        Non-H5 sources only support ``idx == 0``; raises ``IndexError``
        otherwise. ``idx`` out-of-range for an H5 source raises
        ``IndexError``. Cache hits return the cached dict by reference;
        callers must NOT mutate the returned arrays.
        """
        if self.source_kind != "h5":
            if idx != 0:
                raise IndexError(
                    f"frame index {idx} not supported for {self.source_kind!r} source"
                )
            return self.channels
        # All H5 paths grab the per-source lock so concurrent FastAPI
        # threadpool workers don't race the FrameReader init or the
        # cache mutation (M11 P0 fix).
        with self._lock:
            if self._frame_reader is None:
                if self._h5_path is None:
                    # Source was loaded from bytes (upload) and the temp
                    # file was unlinked. Frame 0 channels are still in
                    # self.channels; other frames are not retrievable.
                    if idx == 0:
                        return self.channels
                    raise RuntimeError(
                        f"source {self.source_id!r} has no h5 path; only frame 0 is "
                        f"available (re-load from path to enable per-frame access)"
                    )
                if self._legacy:
                    from .legacy_h5 import LegacyFrameReader
                    self._frame_reader = LegacyFrameReader(self._h5_path)
                else:
                    self._frame_reader = FrameReader(self._h5_path)
            # Cache key depends on idx + active ISP geometry hash so
            # reconfigure invalidates cleanly. (As of M29 the legacy path
            # also runs through extract_with_mode so the same hashing
            # works for modern + legacy sources alike.)
            cache_key = (int(idx), _hash_isp_config(self.isp_config) + "::" + self.isp_mode_id)
            cache = self._frame_extract_cache
            if cache_key in cache:
                cache.move_to_end(cache_key)
                return cache[cache_key]
            raw = self._frame_reader.read_frame(int(idx))
            mode = _isp.get_mode(self.isp_mode_id)
            cfg = _isp.normalize_config(mode, self.isp_config)
            chs = extract_with_mode(raw, mode, cfg)
            # Synthesize HG-Y / LG-Y + HDR-{R,G,B,NIR,Y} for any RGB-NIR
            # mode (modern or legacy). Both produce the same channel
            # naming convention; the only thing that differs is the
            # underlying mosaic geometry encoded in the mode's specs.
            if mode.id in (_isp.RGB_NIR.id, "legacy_gsbsi_rgb_nir"):
                hg = {k: chs[f"HG-{k}"] for k in ("R", "G", "B")}
                lg = {k: chs[f"LG-{k}"] for k in ("R", "G", "B")}
                chs["HG-Y"] = luminance_from_rgb(hg)
                chs["LG-Y"] = luminance_from_rgb(lg)
                # M25 — synthesize HDR-{R,G,B,NIR,Y} alongside.
                from .hdr_fusion import add_hdr_channels
                add_hdr_channels(chs)
            cache[cache_key] = chs
            while len(cache) > PLAYBACK_CACHE_SIZE:
                cache.popitem(last=False)
            return chs

    def invalidate_frame_cache(self) -> None:
        """Drop the per-frame extraction cache. Call after ISP reconfigure
        so future ``extract_frame`` calls pick up the new mode."""
        with self._lock:
            self._frame_extract_cache.clear()

    def close_frame_reader(self) -> None:
        """Release the h5py handle. Called by SessionStore on eviction."""
        with self._lock:
            if self._frame_reader is not None:
                self._frame_reader.close()
                self._frame_reader = None
            # If we own a tempfile (from load_from_bytes), unlink it now
            # that we're done with the source. Idempotent on repeated close.
            if self._owned_tempfile is not None:
                try:
                    Path(self._owned_tempfile).unlink()
                except OSError:
                    pass
                self._owned_tempfile = None
                # Clear _h5_path too so a stale reference doesn't survive.
                self._h5_path = None


class SessionStore:
    """Process-wide session store. Thread-safe for the single-user case."""

    def __init__(self, max_entries: int = 12, evicted_memory: int = 64):
        self._lock = threading.RLock()
        self._items: Dict[str, LoadedSource] = {}
        self._max = max_entries
        # Remember recently-evicted source IDs (FIFO) so we can surface
        # 410 Gone instead of 404 when the frontend holds a stale
        # cached id. Capped to a fixed size so memory stays bounded.
        # See R-0009.
        self._evicted: "list[str]" = []
        self._evicted_max = evicted_memory

    def was_evicted(self, source_id: str) -> bool:
        """True if `source_id` was once loaded here but got LRU-evicted."""
        with self._lock:
            return source_id in self._evicted

    def _remember_evicted_locked(self, source_id: str) -> None:
        """Record an eviction. Caller holds the lock."""
        if source_id in self._evicted:
            self._evicted.remove(source_id)
        self._evicted.append(source_id)
        if len(self._evicted) > self._evicted_max:
            self._evicted = self._evicted[-self._evicted_max:]

    def load_from_path(self, path: str | Path, name: Optional[str] = None) -> LoadedSource:
        """Load a file from local disk and register it under a new source id."""
        resolved = Path(path).expanduser().resolve()
        # Play-only compatibility: legacy gsbsi-prefix H5 files use a different
        # top-level container (``/dset`` instead of ``/camera/frames``) and
        # never round-trip through ``image_io.load_any_detail``. Detect early
        # and dispatch to a self-contained loader so the modern path stays
        # byte-identical.
        from .legacy_h5 import is_legacy_gsbsi_h5
        if is_legacy_gsbsi_h5(resolved):
            return self._load_legacy_gsbsi(resolved, name=name)
        channels, attrs, raw, mode_id, cfg, kind = load_any_detail(resolved)
        any_ch = next(iter(channels.values()))
        shape_hw = (int(any_ch.shape[0]), int(any_ch.shape[1]))
        # Surface the raw mosaic dimensions so the FilePill can show
        # "raw file resolution" alongside the per-channel shape. For
        # modern MantisCam recordings the raw frame is the un-split
        # ``camera/frames`` array; ``raw`` here is what
        # ``load_any_detail`` returned (the array before channel split).
        if raw is not None and getattr(raw, "ndim", 0) >= 2:
            r_shape = raw.shape
            if len(r_shape) == 4 and r_shape[-1] == 1:
                # (N, H, W, 1) → (H, W)
                raw_shape = (int(r_shape[1]), int(r_shape[2]))
            elif len(r_shape) == 3 and r_shape[-1] in (1, 3, 4):
                # (H, W, C) → (H, W)
                raw_shape = (int(r_shape[0]), int(r_shape[1]))
            elif len(r_shape) == 3:
                # (N, H, W) → (H, W)
                raw_shape = (int(r_shape[1]), int(r_shape[2]))
            else:
                # 2-D mosaic frame
                raw_shape = (int(r_shape[0]), int(r_shape[1]))
            raw_dtype = str(raw.dtype)
        else:
            raw_shape = shape_hw
            raw_dtype = str(any_ch.dtype)
        # Modern MantisCam recordings are uint16 (16-bit); image sources
        # are dtype-derived. Bit-depth inference: 8 for uint8, otherwise
        # 16 (no metadata in modern files declares actual sensor bit depth).
        raw_bit_depth = 8 if "uint8" in raw_dtype else 16
        # Per-frame metadata for H5 sources — Play mode needs frame count,
        # exposures, and timestamps without re-opening the file.
        frame_count = 1
        per_frame_exposures: Optional[np.ndarray] = None
        per_frame_timestamps: Optional[np.ndarray] = None
        h5_path: Optional[Path] = None
        # M16: collect any soft-warnings emitted at load time. These get
        # serialized into the SourceSummary so the frontend can chip them
        # on the FilePill + the Warning Center.
        load_warnings: List[Dict[str, str]] = []
        if kind == "h5":
            try:
                with h5py.File(resolved, "r") as f:
                    cam = f["camera"]
                    frame_count = int(cam["frames"].shape[0])
                    if "integration-time" in cam:
                        per_frame_exposures = np.asarray(cam["integration-time"][...], dtype=np.float64)
                    else:
                        per_frame_exposures = np.zeros(frame_count, dtype=np.float64)
                        load_warnings.append({
                            "code": "W-META-EXP",
                            "severity": "warning",
                            "detail": (
                                f"{resolved.name} is missing the 'camera/integration-time' "
                                "dataset; per-frame exposure shows as 0 s."
                            ),
                        })
                    if "timestamp" in cam:
                        per_frame_timestamps = np.asarray(cam["timestamp"][...], dtype=np.float64)
                    else:
                        per_frame_timestamps = np.arange(frame_count, dtype=np.float64)
                        load_warnings.append({
                            "code": "W-META-TS",
                            "severity": "warning",
                            "detail": (
                                f"{resolved.name} is missing the 'camera/timestamp' "
                                "dataset; frame index is used as a stand-in (1 s spacing)."
                            ),
                        })
                h5_path = resolved
            except Exception as exc:
                # Fall back to single-frame view if metadata read fails;
                # the existing load_any_detail succeeded so frame 0 is fine.
                # M16: surface as W-FRAME-FAIL so the user knows the H5 was
                # readable but the per-frame metadata wasn't.
                frame_count = 1
                per_frame_exposures = None
                per_frame_timestamps = None
                h5_path = None
                load_warnings.append({
                    "code": "W-FRAME-FAIL",
                    "severity": "warning",
                    "detail": (
                        f"{resolved.name} per-frame metadata read failed "
                        f"({type(exc).__name__}); only frame 0 is available."
                    ),
                })
        src = LoadedSource(
            source_id=uuid.uuid4().hex[:12],
            name=name or Path(path).name,
            source_kind=kind,
            channels=channels,
            attrs=attrs,
            shape_hw=shape_hw,
            raw_shape=raw_shape,
            raw_bit_depth=raw_bit_depth,
            raw_dtype=raw_dtype,
            path=str(resolved),
            raw_frame=raw,
            isp_mode_id=mode_id,
            isp_config=cfg,
            frame_count=frame_count,
            per_frame_exposures_s=per_frame_exposures,
            per_frame_timestamps=per_frame_timestamps,
            warnings=load_warnings,
            _h5_path=h5_path,
        )
        with self._lock:
            self._items[src.source_id] = src
            self._evict_locked()
        return src

    def _load_legacy_gsbsi(self, resolved: Path, *, name: Optional[str]) -> LoadedSource:
        """Build a ``LoadedSource`` from a legacy gsbsi H5 (Play mode only).

        Mirrors ``load_from_path`` for a modern H5: extracts frame 0 channels
        (so the frontend's load-time ``channels`` snapshot is populated),
        captures per-frame exposures + frame_count, and emits a ``W-META-TS``
        warning since the legacy container has no real timestamp dataset.

        As of the M29 P0 sweep, ``raw_frame`` is now the cached frame-0
        mosaic (full 2048 × 1024 uint16 array, post-shift); the active
        ISP mode is ``LEGACY_GSBSI_RGB_NIR`` (a single-half mode that
        encodes the row-interleaved layout in its slot locs). This makes
        ``reconfigure_isp`` work end-to-end on legacy sources — geometry
        tweaks (origin / sub_step / outer_stride) re-extract cleanly via
        ``extract_with_mode``.
        """
        from .hdr_fusion import add_hdr_channels
        from .legacy_h5 import (
            LEGACY_FRAME_HW,
            legacy_inspect,
            legacy_read_frame,
        )

        info = legacy_inspect(resolved)
        n_frames = int(info["n_frames"])
        exposures_s = np.asarray(info["exposures_s"], dtype=np.float64)
        timestamps = np.asarray(info["timestamps"], dtype=np.float64)
        with h5py.File(resolved, "r") as fh:
            frame0 = legacy_read_frame(fh["dset"], 0)
        # Use the new LEGACY_GSBSI_RGB_NIR mode (single-half + row-interleaved
        # locs) so extract_with_mode produces HG/LG channels directly. This
        # is byte-identical to extract_legacy_channels with default config,
        # but supports user-driven origin/sub_step/outer_stride changes too.
        legacy_mode = _isp.get_mode("legacy_gsbsi_rgb_nir")
        legacy_cfg = _isp.normalize_config(legacy_mode, None)
        channels = extract_with_mode(frame0, legacy_mode, legacy_cfg)
        # Mirror the modern RGB-NIR path: synthesize HG-Y / LG-Y luminance
        # plus HDR-{R,G,B,NIR,Y} fusion so downstream display + analysis
        # paths see the same channel set regardless of source format.
        hg = {"R": channels["HG-R"], "G": channels["HG-G"], "B": channels["HG-B"]}
        lg = {"R": channels["LG-R"], "G": channels["LG-G"], "B": channels["LG-B"]}
        channels["HG-Y"] = luminance_from_rgb(hg)
        channels["LG-Y"] = luminance_from_rgb(lg)
        add_hdr_channels(channels)
        any_ch = next(iter(channels.values()))
        shape_hw = (int(any_ch.shape[0]), int(any_ch.shape[1]))
        attrs: Dict[str, str] = {
            "format": "legacy_gsbsi",
            "frame_hw": f"{LEGACY_FRAME_HW[0]}x{LEGACY_FRAME_HW[1]}",
            "frame_count": str(n_frames),
        }
        warnings: List[Dict[str, str]] = [
            {
                "code": "W-META-TS",
                "severity": "warning",
                "detail": (
                    f"{resolved.name} is a legacy gsbsi recording without a "
                    "/camera/timestamp dataset; frame index used as a stand-in "
                    "(1 s spacing)."
                ),
            },
            {
                "code": "W-LEGACY-12BIT",
                "severity": "info",
                "detail": (
                    f"{resolved.name} is a 12-bit legacy gsbsi recording; raw "
                    "values are left-shifted by 4 at load time so a saturated "
                    "0x0FFF pixel maps to 0xFFF0 in uint16, keeping the Display "
                    "pipeline (which normalizes against the dtype max) consistent "
                    "with current 16-bit recordings."
                ),
            },
        ]
        src = LoadedSource(
            source_id=uuid.uuid4().hex[:12],
            name=name or resolved.name,
            source_kind="h5",
            channels=channels,
            attrs=attrs,
            shape_hw=shape_hw,
            # Raw mosaic dimensions for legacy gsbsi files are the canonical
            # 2048 × 1024 super-frame; bit depth is 12-bit even though the
            # post-shift array is uint16 (we shift at the read boundary so
            # the Display pipeline sees uint16 numbers like a modern file).
            raw_shape=(int(LEGACY_FRAME_HW[0]), int(LEGACY_FRAME_HW[1])),
            raw_bit_depth=12,
            raw_dtype="uint16",
            path=str(resolved),
            # Cache frame 0's full mosaic so ``reconfigure_isp`` can re-
            # extract on user-driven geometry tweaks without touching disk.
            raw_frame=frame0,
            isp_mode_id=legacy_mode.id,
            isp_config=legacy_cfg,
            frame_count=n_frames,
            per_frame_exposures_s=exposures_s,
            per_frame_timestamps=timestamps,
            warnings=warnings,
            _h5_path=resolved,
            _legacy=True,
        )
        with self._lock:
            self._items[src.source_id] = src
            self._evict_locked()
        return src

    def load_from_bytes(self, data: bytes, name: str) -> LoadedSource:
        """Persist uploaded bytes to a temp file and load via load_any.

        For H5 sources we KEEP the tempfile alive for the session — the
        Play mode's per-frame extraction needs to reopen the file lazily
        (see ``LoadedSource.extract_frame``), so unlinking here would
        cause FileNotFoundError on every frame after the first. The
        tempfile is unlinked in ``close_frame_reader`` (called on
        eviction / explicit remove). For image sources, frame 0 is the
        only frame and it's already cached on ``LoadedSource.channels``,
        so we can unlink immediately.
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
            src = self.load_from_path(tmp_path, name=name)
            # If this is an H5 source, we held on to the tempfile path —
            # transfer ownership to the LoadedSource so close_frame_reader
            # can clean it up on eviction. Replace `path` with the user-
            # facing original name (the tempfile path is an implementation
            # detail).
            if src.source_kind == "h5":
                with self._lock:
                    src._owned_tempfile = tmp_path
                    src.path = None  # don't expose the tempfile path to the UI
                return src
            # Image source — frame 0 is the only frame, already in
            # src.channels. Safe to unlink the upload now.
            try:
                tmp_path.unlink()
            except OSError:
                pass
            with self._lock:
                src._h5_path = None
                src.path = None
            return src
        except Exception:
            # Load failed — clean up the tempfile and re-raise.
            try:
                tmp_path.unlink()
            except OSError:
                pass
            raise

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

        For H5 dark files, averages all frames into a single master dark
        before extraction (better noise floor than using frame 0 alone).
        For image dark files, falls through to the standard single-image
        loader. Loads under the source's *currently active* ISP mode +
        config so the key set matches after any reconfigure_isp call.
        Raises `KeyError` on unknown source, `ValueError` on shape /
        key mismatch.

        play-tab-recording-inspection-rescue-v1 M1 — dark averaging.
        """
        src = self.get(source_id)
        dark_channels = _load_dark_channels(
            path,
            isp_mode_id=src.isp_mode_id,
            isp_config=src.isp_config,
        )
        _validate_dark_shapes(src, dark_channels)
        with self._lock:
            src.dark_channels = dark_channels
            src.dark_name = name or Path(path).name
            src.dark_path = str(Path(path).expanduser().resolve())
            # Per-frame extraction cache holds dark-untouched channel
            # dicts; downstream `_channel_image` applies dark correction
            # when serving thumbnails, so cache stays valid. No invalidation.
        return src

    def attach_dark_from_bytes(self, source_id: str, data: bytes, name: str
                               ) -> "LoadedSource":
        """Persist uploaded dark bytes to a temp file and attach under the
        source's currently active ISP mode + config. Averaging applies
        for H5 darks (see ``attach_dark_from_path``)."""
        import tempfile
        suffix = Path(name).suffix
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            tmp_path = Path(f.name)
        try:
            src = self.get(source_id)
            dark_channels = _load_dark_channels(
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

    def create_transient_from_frame(self, parent_sid: str, frame_index: int,
                                    name_suffix: str = "") -> "LoadedSource":
        """Materialize one frame of a parent source as a standalone image
        source. Used by the M30 right-click handoff: the user picks a frame
        in Play and sends it to USAF / FPN / DoF, which expect single-frame
        sources.

        The new source inherits the parent's ISP mode + config + dark
        channels (so e.g. dark correction stays applied) but is otherwise
        independent — its ``frame_count`` is 1 and it has no ``_h5_path``
        so per-frame extraction always returns the cached frame. The
        source_id is fresh so the parent recording stays alive in Play.

        Raises ``KeyError`` on unknown ``parent_sid``, ``IndexError`` /
        ``RuntimeError`` from the parent's ``extract_frame`` if the index
        is out of range or the parent has no h5 path.
        """
        parent = self.get(parent_sid)
        chs = parent.extract_frame(int(frame_index))
        any_ch = next(iter(chs.values()))
        new_id = uuid.uuid4().hex[:12]
        suffix = name_suffix or f" · frame {int(frame_index)}"
        # Snapshot dark channels so the transient stays dark-corrected
        # without holding a reference to the parent's mutable dict.
        dark_snapshot = (
            {k: v.copy() for k, v in parent.dark_channels.items()}
            if parent.dark_channels is not None else None
        )
        # Reconstruct a raw_frame so reconfigure_isp on the transient
        # works the same way as on its parent. For modern + legacy h5
        # parents the parent's `read_frame(frame_index)` returns the raw
        # mosaic; pull it directly via the FrameReader if available so
        # we cache the right thing.
        raw_for_transient: Optional[np.ndarray] = None
        with parent._lock:
            if parent._frame_reader is not None:
                try:
                    raw_for_transient = parent._frame_reader.read_frame(int(frame_index))
                except Exception:
                    raw_for_transient = None
        if raw_for_transient is None:
            raw_for_transient = parent.raw_frame
        transient = LoadedSource(
            source_id=new_id,
            name=(parent.name or "frame") + suffix,
            source_kind="image",
            channels={k: v.copy() for k, v in chs.items()},
            attrs=dict(parent.attrs),
            shape_hw=(int(any_ch.shape[0]), int(any_ch.shape[1])),
            raw_shape=tuple(parent.raw_shape) if any(parent.raw_shape) else (
                int(any_ch.shape[0]), int(any_ch.shape[1])),
            raw_dtype=parent.raw_dtype,
            raw_bit_depth=int(parent.raw_bit_depth),
            raw_frame=raw_for_transient,
            isp_mode_id=parent.isp_mode_id,
            isp_config=dict(parent.isp_config or {}),
            frame_count=1,
            per_frame_exposures_s=None,
            per_frame_timestamps=None,
            warnings=[],
            dark_channels=dark_snapshot,
            dark_name=parent.dark_name,
            dark_path=parent.dark_path,
        )
        with self._lock:
            self._items[transient.source_id] = transient
            self._evict_locked()
        return transient

    def remove(self, source_id: str) -> None:
        """Drop a single source by id and release its h5 handle.

        Does not record the removal in the evicted-id memory; the user
        intentionally chose to remove this source, so a follow-up GET
        for the id should be a 404 (never-existed semantics) rather than
        a 410 Gone (auto-recovery semantics).
        """
        with self._lock:
            src = self._items.pop(source_id, None)
        if src is not None:
            try:
                src.close_frame_reader()
            except Exception:
                pass

    def clear(self) -> None:
        with self._lock:
            for src in self._items.values():
                try:
                    src.close_frame_reader()
                except Exception:
                    pass
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
            # Keep the HG-Y / LG-Y synthesized luminance invariant for any
            # RGB-NIR mode (modern ``rgb_nir`` and ``legacy_gsbsi_rgb_nir``),
            # matching load_h5_channels and the legacy loader. Other modes
            # don't carry Y.
            if mode.id in (_isp.RGB_NIR.id, "legacy_gsbsi_rgb_nir"):
                hg = {k: new_channels[f"HG-{k}"] for k in ("R", "G", "B")}
                lg = {k: new_channels[f"LG-{k}"] for k in ("R", "G", "B")}
                new_channels["HG-Y"] = luminance_from_rgb(hg)
                new_channels["LG-Y"] = luminance_from_rgb(lg)
                # M25 — keep HDR channels in sync after ISP reconfig.
                from .hdr_fusion import add_hdr_channels
                add_hdr_channels(new_channels)
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
            # ISP geometry / channel set changed → cached extracted frames
            # are stale; drop them so the next extract_frame re-extracts
            # under the new mode.
            src.invalidate_frame_cache()
        return src

    def _evict_locked(self) -> None:
        """Drop oldest sources until we're under the cap. Caller holds the lock.

        Records each dropped id in ``self._evicted`` so a follow-up
        ``was_evicted(sid)`` lets the server return 410 Gone (distinct
        from 404 for never-existed ids). See R-0009. Also closes any
        open h5 handle held by a Play-mode FrameReader.
        """
        if len(self._items) <= self._max:
            return
        ordered = sorted(self._items.values(), key=lambda s: s.loaded_at)
        for s in ordered[: len(self._items) - self._max]:
            self._remember_evicted_locked(s.source_id)
            try:
                s.close_frame_reader()
            except Exception:
                pass
            del self._items[s.source_id]


# Process-global singleton. The server and the test harness share this.
STORE = SessionStore()


# ---------------------------------------------------------------------------
# Dark-frame helpers (validation + subtraction math)
# ---------------------------------------------------------------------------

def _load_dark_channels(path: str | Path,
                        *,
                        isp_mode_id: str,
                        isp_config: Optional[Dict[str, object]],
                        ) -> Dict[str, np.ndarray]:
    """Load a dark file and return per-channel arrays.

    For H5 dark files, **averages all frames** along axis 0 before running
    Bayer extraction — this matches lab convention (a "dark frame" is the
    expectation of dark-current + read-noise across the captured sequence,
    not any single frame). For image dark files, falls through to the
    standard single-image path.

    play-tab-recording-inspection-rescue-v1 M1.
    """
    p = Path(path).expanduser().resolve()
    suf = p.suffix.lower()
    # Image dark — single-frame, fall through to the existing loader.
    if suf in {".png", ".tif", ".tiff", ".jpg", ".jpeg", ".bmp"}:
        chs, _attrs, _raw, _mode_id, _cfg, _kind = load_any_detail(
            p, isp_mode_id=isp_mode_id, isp_config=isp_config,
        )
        return chs
    # H5 dark — open, read all frames, average.
    if not p.exists():
        raise FileNotFoundError(p)
    rec = load_recording(p, frame_slice=None)
    # rec.frames shape (N, H, W) uint16 after load_recording squeezes
    # any trailing length-1 axis.
    if rec.frames.ndim != 3:
        raise ValueError(
            f"dark file {p.name}: expected (N, H, W) frames, got shape {rec.frames.shape}"
        )
    avg = np.mean(rec.frames, axis=0)
    # Round and cast back to uint16 so the dark looks like a sensor frame
    # to the existing extractor (which assumes uint16-shaped input). The
    # downstream subtract_dark casts to float64 anyway, so precision is
    # not lost where it matters.
    avg = np.clip(avg, 0, np.iinfo(np.uint16).max)
    avg_uint = avg.round().astype(np.uint16, copy=False)
    mode = _isp.get_mode(isp_mode_id)
    cfg = _isp.normalize_config(mode, isp_config)
    chs = extract_with_mode(avg_uint, mode, cfg)
    if mode.id == _isp.RGB_NIR.id:
        hg = {k: chs[f"HG-{k}"] for k in ("R", "G", "B")}
        lg = {k: chs[f"LG-{k}"] for k in ("R", "G", "B")}
        chs["HG-Y"] = luminance_from_rgb(hg)
        chs["LG-Y"] = luminance_from_rgb(lg)
        # M25 — dark frames also produce HDR channels so dark
        # subtraction can target the HDR-* keys when the user is
        # rendering an HDR view.
        from .hdr_fusion import add_hdr_channels
        add_hdr_channels(chs)
    return chs


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
        # Raw mosaic dimensions of one frame BEFORE channel-split. For the
        # FilePill's "raw file resolution" caption — distinguishes a 2048
        # × 4096 modern recording from a 2048 × 1024 legacy gsbsi from a
        # 512 × 512 image source.
        "raw_shape": list(s.raw_shape) if any(s.raw_shape) else list(s.shape_hw),
        "raw_dtype": s.raw_dtype,
        "raw_bit_depth": int(s.raw_bit_depth),
        # Legacy gsbsi-prefix container indicator. When True, the source
        # has no cached raw frame (legacy frames don't share the modern
        # ISP geometry, so re-running the modern extractor would produce
        # garbage), and `PUT /api/sources/{sid}/isp` will reject. The
        # frontend uses this to disable the ISP reconfigure dialog
        # rather than letting the user hit a 400 mid-flow.
        "is_legacy": bool(getattr(s, "_legacy", False)),
        "loaded_at": s.loaded_at,
        "path": s.path,
        "has_dark": s.has_dark,
        "dark_name": s.dark_name,
        "dark_path": s.dark_path,
        # Play mode (play-tab-recording-inspection-rescue-v1 M1):
        # frame_count is 1 for image sources, ≥ 1 for H5. Per-frame
        # exposures / timestamps are H5-only (None for image).
        "frame_count": int(s.frame_count),
        # M16: per-source warnings collected at load time
        # (W-META-TS, W-META-EXP, W-FRAME-FAIL, ...). Frontend renders
        # one chip per entry on the FilePill and aggregates them into
        # the Warning Center modal.
        "warnings": [dict(w) for w in (s.warnings or [])],
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
    show_clipping: bool = False,
    normalize_mode: str = "none",
    brightness: float = 0.0,
    contrast: float = 1.0,
    gamma: float = 1.0,
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

    ``show_clipping`` (M20): when true, paints magenta (#FF00FF) on every
    pixel where the underlying value is at or above the high threshold
    (``hi``) — i.e. clipped to white in the live render. Useful for
    spotting saturated regions before exposure / threshold tuning. The
    forced-RGB output adds a few KB to the PNG; default off.
    """
    from PIL import Image

    a = image.astype(np.float32, copy=False)
    # M22 — unified normalize. The mode chooses the *default* bounds
    # (dtype-max for 'none', percentile for 'auto'/'manual'); user-
    # supplied vmin/vmax always override on that side. This keeps the
    # Display Low/High threshold sliders effective regardless of mode.
    if normalize_mode == "none":
        try:
            dtype_max = float(np.iinfo(image.dtype).max)
        except (ValueError, TypeError):
            dtype_max = 65535.0
        default_lo = 0.0
        default_hi = max(1.0, dtype_max)
    else:
        default_lo = float(np.percentile(a, clip_lo_pct))
        default_hi = float(np.percentile(a, clip_hi_pct))
    lo = float(vmin) if vmin is not None else default_lo
    hi = float(vmax) if vmax is not None else default_hi
    if hi <= lo:
        hi = lo + 1.0
    norm = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    # M20: identify clipped pixels BEFORE the post-norm ISP curve so the
    # mask reflects the *underlying data* relative to the high threshold,
    # not the post-curve plateau.
    clip_mask = (a >= hi) if show_clipping else None
    # M20.1: post-normalize ISP curve — contrast (around 0.5), then
    # additive brightness, then gamma. No-op when defaults are passed.
    if abs(contrast - 1.0) > 1e-6:
        norm = (norm - 0.5) * float(contrast) + 0.5
    if abs(brightness) > 1e-6:
        norm = norm + float(brightness)
    if abs(contrast - 1.0) > 1e-6 or abs(brightness) > 1e-6:
        norm = np.clip(norm, 0.0, 1.0)
    if abs(gamma - 1.0) > 1e-6 and float(gamma) > 0:
        norm = np.power(norm, 1.0 / float(gamma))

    cmap_name = (colormap or "gray").lower()
    if cmap_name in ("gray", "grey", "l", "mono", "none"):
        n8 = (norm * 255.0).astype(np.uint8)
        if show_clipping:
            # Lift to RGB so we can paint magenta on the clip mask.
            rgb = np.stack([n8, n8, n8], axis=-1)
            rgb[clip_mask] = (255, 0, 255)
            im = Image.fromarray(rgb, mode="RGB")
        else:
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
            if show_clipping:
                rgb = np.stack([n8, n8, n8], axis=-1)
                rgb[clip_mask] = (255, 0, 255)
                im = Image.fromarray(rgb, mode="RGB")
            else:
                im = Image.fromarray(n8, mode="L")
        else:
            rgba = cmap(norm, bytes=True)  # (H, W, 4) uint8
            rgb = rgba[..., :3]
            if show_clipping:
                rgb = rgb.copy()
                rgb[clip_mask] = (255, 0, 255)
            im = Image.fromarray(rgb, mode="RGB")

    if max(im.size) > max_dim:
        scale = max_dim / float(max(im.size))
        new_size = (int(im.size[0] * scale), int(im.size[1] * scale))
        im = im.resize(new_size, Image.Resampling.BILINEAR)

    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def channel_histogram(
    image: np.ndarray,
    *,
    bins: int = 64,
) -> Dict[str, Any]:
    """Compute a 64-bin (default) histogram of a channel array.

    Returned dict has:
      * ``counts``: list of ``bins`` ints
      * ``edges``:  list of ``bins+1`` floats (left edges + final right edge)
      * ``min`` / ``max``: float bounds of the data
      * ``p1`` / ``p99``: 1st / 99th percentiles (helpful seeds for vmin/vmax)

    play-tab-recording-inspection-rescue-v1 M20.
    """
    a = image.astype(np.float32, copy=False)
    if a.size == 0:
        return {
            "counts": [0] * int(bins),
            "edges": [0.0] * (int(bins) + 1),
            "min": 0.0, "max": 0.0, "p1": 0.0, "p99": 0.0,
        }
    lo = float(np.min(a))
    hi = float(np.max(a))
    if hi <= lo:
        hi = lo + 1.0
    counts, edges = np.histogram(a, bins=int(bins), range=(lo, hi))
    return {
        "counts": [int(c) for c in counts],
        "edges": [float(e) for e in edges],
        "min": float(np.min(a)),
        "max": float(np.max(a)),
        "p1": float(np.percentile(a, 1.0)),
        "p99": float(np.percentile(a, 99.0)),
    }
