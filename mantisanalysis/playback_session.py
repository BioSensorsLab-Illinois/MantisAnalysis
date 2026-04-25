"""Process-global session store for the Playback (Recording Inspection) mode.

Holds RecordingHandle / DarkHandle / StreamHandle / ExportJob / Preset /
LiveStreamHandle dataclasses + the process-global frame-LRU cache.

Pure NumPy / h5py module — no FastAPI, no React. Per AGENT_RULES rule 7
the analysis-purity invariant is upheld: imports only from numpy /
h5py / typing + the sibling pure modules
``mantisanalysis.{recording,dark_frame,isp_modes,image_io,extract}``.

Frozen contracts (DATA_MODEL §1):
  * Channel-key schema (rule 6) is preserved.
  * Frame LRU is **process-global byte-capped** (default 2 GB,
    [256 MB..8 GB]). Single OrderedDict keyed by
    ``(stream_id, recording_id, local_frame)``.
  * ExportJob.cancel_event is a ``multiprocessing.Event`` so cancel
    crosses ProcessPoolExecutor worker boundaries.
  * Eviction events surface via the ``mantis:source-evicted`` window
    event with ``detail.kind`` field. Server emits HTTP 410 with the
    same ``kind`` payload.
  * RecordingHandle has no ``bytes_cache`` — uploads always persist
    to disk under ``outputs/playback/uploads/<recording_id>.h5`` so
    two-tab uploads can't duplicate 16 GB in RAM.
"""

from __future__ import annotations

import multiprocessing
import multiprocessing.synchronize
import threading
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import isp_modes as _isp
from .dark_frame import MasterDark
from .recording import (
    Warning,
    RecordingMeta,
    extract_frame,
    inspect_recording,
)


# ---------------------------------------------------------------------------
# Warning codes new to this module
# ---------------------------------------------------------------------------


WARN_GAP = "W-GAP"
WARN_OVERLAP = "W-OVERLAP"
WARN_EXP_MISMATCH = "W-EXP-MISMATCH"
WARN_SHAPE = "W-SHAPE"
WARN_CHAN = "W-CHAN"
WARN_TS_DISORDER = "W-TS-DISORDER"


# ---------------------------------------------------------------------------
# Handle dataclasses
# ---------------------------------------------------------------------------


@dataclass
class RecordingHandle:
    """One registered recording in the PlaybackStore.

    Per risk-skeptic P1-H, ``path`` is non-Optional; uploads persist to
    disk before registering. There is no bytes_cache.
    """

    recording_id: str
    meta: RecordingMeta
    path: Path
    isp_mode_id: str
    isp_config: Dict[str, Any]
    loaded_at: float = field(default_factory=time.time)


@dataclass
class DarkHandle:
    """One registered MasterDark in the PlaybackStore."""

    dark_id: str
    master: MasterDark
    loaded_at: float = field(default_factory=time.time)


@dataclass
class StreamBoundary:
    """One file's contribution to a stream's global frame range."""

    recording_id: str
    start_frame: int       # global frame index, inclusive
    end_frame: int         # global frame index, exclusive
    ts_start_s: float
    ts_end_s: float
    exposure: Optional[float]
    gap_to_prev_s: Optional[float]


@dataclass
class StreamHandle:
    """One logical stream — ordered list of recordings + boundaries.

    Created by ``PlaybackStore.build_stream``; mutated only via
    ``PlaybackStore.update_stream``.
    """

    stream_id: str
    name: str
    isp_mode_id: str
    isp_config: Dict[str, Any]
    recording_ids: Tuple[str, ...]
    quarantined_recording_ids: Tuple[str, ...]
    continuity_threshold_s: float
    boundaries: Tuple[StreamBoundary, ...]
    total_frames: int
    total_duration_s: float
    fps: float
    shape: Tuple[int, int]
    available_channels: Tuple[str, ...]
    issues: Dict[str, int]
    warnings: Tuple[Warning, ...]
    loaded_at: float = field(default_factory=time.time)
    invalidated: bool = False


@dataclass
class ExportJob:
    """One running or completed export job.

    Per risk-skeptic P0-A, ``cancel_event`` is a
    :class:`multiprocessing.Event` (not :class:`threading.Event`) so a
    parent-process ``set()`` is observable in worker processes spawned
    via :class:`concurrent.futures.ProcessPoolExecutor`. Cancel
    granularity is one batch.
    """

    job_id: str
    kind: str                                   # 'image' | 'video'
    request: Dict[str, Any]
    status: str = "queued"                      # queued|rendering|done|failed|cancelled
    progress: float = 0.0
    current_frame: int = 0
    total_frames: int = 0
    elapsed_s: float = 0.0
    eta_s: float = 0.0
    decode_ms_per_frame: float = 0.0
    encode_ms_per_frame: float = 0.0
    worker_count: int = 1
    output_path: Optional[Path] = None
    sidecar_path: Optional[Path] = None
    error: Optional[str] = None
    submitted_at: float = field(default_factory=time.time)
    cancel_event: "multiprocessing.synchronize.Event | None" = None
    pinned_recording_ids: Tuple[str, ...] = ()
    pinned_stream_id: Optional[str] = None


@dataclass(frozen=True)
class Preset:
    """One saved per-view / dark / CCM preset."""

    preset_id: str
    kind: str                  # 'view' | 'dark' | 'ccm'
    name: str
    payload: Dict[str, Any]
    created_at: float


@dataclass
class LiveStreamHandle:
    """Reserved no-op for the future realtime camera feed.

    Plays no role in this initiative; the field exists so future feed
    integration is purely additive.
    """

    stream_id: str
    camera_id: str
    isp_mode_id: str
    is_live: bool
    last_frame_index: int
    started_at: float


# ---------------------------------------------------------------------------
# Stream-building math (recording.build_stream lives here, not in
# recording.py, because Stream depends on the in-memory RecordingHandle
# registry — recording.py stays at the H5-layer concern)
# ---------------------------------------------------------------------------


def _shape_match(a_meta: RecordingMeta, b_meta: RecordingMeta) -> bool:
    return a_meta.frame_shape == b_meta.frame_shape and (
        a_meta.raw_shape == b_meta.raw_shape
    )


def build_stream(handles: Sequence[RecordingHandle],
                 *,
                 stream_id: str,
                 name: str,
                 continuity_threshold_s: float = 1.0,
                 isp_mode_id: Optional[str] = None,
                 isp_config: Optional[Dict[str, Any]] = None,
                 ) -> StreamHandle:
    """Compose a logical stream from ordered recording handles.

    Raises
    ------
    ValueError
        Empty handle list.
    """
    if not handles:
        raise ValueError("build_stream requires at least one recording")

    # Determine ISP mode + config (default: take from first handle).
    base = handles[0]
    mode_id = isp_mode_id or base.isp_mode_id
    cfg = isp_config or base.isp_config

    warnings: List[Warning] = []
    quarantined: List[str] = []

    # Quarantine: shape mismatches relative to base.
    keep: List[RecordingHandle] = [base]
    for h in handles[1:]:
        if not _shape_match(base.meta, h.meta):
            warnings.append(Warning(
                code=WARN_SHAPE,
                severity="error",
                text=(f"{h.meta.name} shape {h.meta.frame_shape} differs from "
                      f"stream base {base.meta.frame_shape}; quarantined"),
            ))
            quarantined.append(h.recording_id)
            continue
        keep.append(h)

    # Channel-intersection diagnostics (P1-12 from planner-architect).
    base_channels = set(base.meta.channels)
    available = set(base_channels)
    for h in keep[1:]:
        h_channels = set(h.meta.channels)
        available &= h_channels
        for missing in sorted(base_channels - h_channels):
            warnings.append(Warning(
                code=WARN_CHAN,
                severity="error",
                text=(f"{h.meta.name} is missing channel {missing!r}; "
                      "channel removed from stream's available set"),
            ))

    # Build boundaries; emit gap / overlap / exposure-mismatch warnings.
    boundaries: List[StreamBoundary] = []
    offset = 0
    last_ts_end: Optional[float] = None
    base_exposure = base.meta.exposure_mean
    issues = {
        "gap_count": 0,
        "overlap_count": 0,
        "exposure_mismatch_count": 0,
        "shape_mismatch_count": len(quarantined),
        "channel_mismatch_count": sum(
            1 for w in warnings if w.code == WARN_CHAN
        ),
    }

    base_ts = handles[0].meta.timestamp_start_s or 0.0  # for relative reporting

    for h in keep:
        m = h.meta
        ts_start = (m.timestamp_start_s or 0.0) - base_ts
        ts_end = (m.timestamp_end_s or m.timestamp_start_s or 0.0) - base_ts
        gap: Optional[float] = None
        if last_ts_end is not None:
            gap = ts_start - last_ts_end
            if gap > continuity_threshold_s:
                warnings.append(Warning(
                    code=WARN_GAP,
                    severity="warning",
                    text=(f"{m.name}: {gap:.3f}s gap from previous file "
                          f"(threshold {continuity_threshold_s:.3f}s)"),
                ))
                issues["gap_count"] += 1
            elif gap < -1e-6:
                warnings.append(Warning(
                    code=WARN_OVERLAP,
                    severity="warning",
                    text=(f"{m.name} overlaps previous file by "
                          f"{-gap:.3f}s"),
                ))
                issues["overlap_count"] += 1
        if (base_exposure is not None and m.exposure_mean is not None
                and not np.isclose(base_exposure, m.exposure_mean,
                                   rtol=1e-6, atol=1e-9)):
            warnings.append(Warning(
                code=WARN_EXP_MISMATCH,
                severity="warning",
                text=(f"{m.name} exposure {m.exposure_mean} differs from "
                      f"stream base {base_exposure}"),
            ))
            issues["exposure_mismatch_count"] += 1

        # Forward intra-file W-TS-DISORDER warnings from the meta layer.
        for w in m.warnings:
            if w.code == WARN_TS_DISORDER:
                warnings.append(w)

        boundaries.append(StreamBoundary(
            recording_id=h.recording_id,
            start_frame=offset,
            end_frame=offset + m.frame_count,
            ts_start_s=ts_start,
            ts_end_s=ts_end,
            exposure=m.exposure_mean,
            gap_to_prev_s=gap,
        ))
        offset += m.frame_count
        last_ts_end = ts_end

    total_frames = offset
    total_duration = sum(b.ts_end_s - b.ts_start_s for b in boundaries) if boundaries else 0.0
    # FPS: derive from total frames / total duration when both present.
    fps = 30.0
    if total_duration > 0:
        fps = float(total_frames / total_duration)

    return StreamHandle(
        stream_id=stream_id,
        name=name,
        isp_mode_id=mode_id,
        isp_config=cfg,
        recording_ids=tuple(h.recording_id for h in keep),
        quarantined_recording_ids=tuple(quarantined),
        continuity_threshold_s=float(continuity_threshold_s),
        boundaries=tuple(boundaries),
        total_frames=total_frames,
        total_duration_s=total_duration,
        fps=fps,
        shape=base.meta.frame_shape,
        available_channels=tuple(sorted(available)),
        issues=issues,
        warnings=tuple(warnings),
    )


def frame_lookup(stream: StreamHandle, frame: int
                 ) -> Tuple[StreamBoundary, str, int]:
    """Resolve a global frame index to ``(boundary, recording_id, local_frame)``.

    Raises ``IndexError`` when frame is out of stream range.
    """
    if frame < 0 or frame >= stream.total_frames:
        raise IndexError(
            f"frame {frame} out of stream range [0, {stream.total_frames})"
        )
    for b in stream.boundaries:
        if b.start_frame <= frame < b.end_frame:
            return b, b.recording_id, frame - b.start_frame
    # Should be unreachable given the bounds check above.
    raise IndexError(f"frame {frame} did not match any boundary")


# ---------------------------------------------------------------------------
# Process-global byte-capped frame LRU
# ---------------------------------------------------------------------------


class _FrameLRU:
    """Process-global byte-capped LRU of channel dicts.

    Per risk-skeptic P0-C, the cap is across all streams, not
    per-stream. Setting a smaller cap evicts oldest entries down to fit.
    """

    DEFAULT_BYTES = 2 * 1024 * 1024 * 1024     # 2 GB
    MIN_BYTES = 256 * 1024 * 1024              # 256 MB
    MAX_BYTES = 8 * 1024 * 1024 * 1024         # 8 GB

    def __init__(self, cap_bytes: int = DEFAULT_BYTES) -> None:
        self._cap = self._clamp(cap_bytes)
        self._lock = threading.RLock()
        self._items: "OrderedDict[Tuple[str, str, int], Dict[str, np.ndarray]]" = OrderedDict()
        self._sizes: Dict[Tuple[str, str, int], int] = {}
        self._current_bytes = 0

    @classmethod
    def _clamp(cls, n: int) -> int:
        return max(cls.MIN_BYTES, min(cls.MAX_BYTES, int(n)))

    @property
    def cap_bytes(self) -> int:
        return self._cap

    @property
    def current_bytes(self) -> int:
        return self._current_bytes

    def __len__(self) -> int:
        return len(self._items)

    def set_cap(self, cap_bytes: int) -> None:
        with self._lock:
            self._cap = self._clamp(cap_bytes)
            self._evict_locked()

    def get(self, key: Tuple[str, str, int]) -> Optional[Dict[str, np.ndarray]]:
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: Tuple[str, str, int],
            value: Dict[str, np.ndarray]) -> None:
        size = sum(int(arr.nbytes) for arr in value.values())
        with self._lock:
            if key in self._items:
                self._current_bytes -= self._sizes.pop(key)
                del self._items[key]
            self._items[key] = value
            self._sizes[key] = size
            self._current_bytes += size
            self._evict_locked()

    def drop_recording(self, recording_id: str) -> None:
        """Evict all entries for a recording (used when the recording is dropped)."""
        with self._lock:
            keys = [k for k in self._items.keys() if k[1] == recording_id]
            for k in keys:
                self._current_bytes -= self._sizes.pop(k)
                del self._items[k]

    def drop_stream(self, stream_id: str) -> None:
        with self._lock:
            keys = [k for k in self._items.keys() if k[0] == stream_id]
            for k in keys:
                self._current_bytes -= self._sizes.pop(k)
                del self._items[k]

    def clear(self) -> None:
        with self._lock:
            self._items.clear()
            self._sizes.clear()
            self._current_bytes = 0

    def _evict_locked(self) -> None:
        while self._current_bytes > self._cap and self._items:
            k, _ = self._items.popitem(last=False)
            self._current_bytes -= self._sizes.pop(k)


# ---------------------------------------------------------------------------
# PlaybackStore
# ---------------------------------------------------------------------------


class PlaybackStore:
    """Process-global session store for Playback artifacts.

    Thread-safe via a single RLock. Eviction is oldest-first by
    ``loaded_at``. Active export jobs pin their recording / stream ids.
    """

    DEFAULT_MAX_RECORDINGS = 12
    DEFAULT_MAX_DARKS = 8
    DEFAULT_MAX_STREAMS = 4
    DEFAULT_MAX_JOBS = 8
    DEFAULT_MAX_PRESETS_PER_KIND = 64

    def __init__(self,
                 *,
                 max_recordings: int = DEFAULT_MAX_RECORDINGS,
                 max_darks: int = DEFAULT_MAX_DARKS,
                 max_streams: int = DEFAULT_MAX_STREAMS,
                 max_jobs: int = DEFAULT_MAX_JOBS,
                 max_presets_per_kind: int = DEFAULT_MAX_PRESETS_PER_KIND,
                 frame_lru_bytes: int = _FrameLRU.DEFAULT_BYTES,
                 ) -> None:
        self._lock = threading.RLock()
        self._recordings: Dict[str, RecordingHandle] = {}
        self._darks: Dict[str, DarkHandle] = {}
        self._streams: Dict[str, StreamHandle] = {}
        self._jobs: Dict[str, ExportJob] = {}
        self._presets: Dict[str, Dict[str, Preset]] = {
            "view": {}, "dark": {}, "ccm": {},
        }
        # Eviction memory per kind — surfaces 410 in server.
        self._evicted: Dict[str, List[str]] = {
            "recording": [], "dark": [], "stream": [], "job": [],
        }
        self._evict_max = 64
        self._max_recordings = int(max_recordings)
        self._max_darks = int(max_darks)
        self._max_streams = int(max_streams)
        self._max_jobs = int(max_jobs)
        self._max_presets_per_kind = int(max_presets_per_kind)
        self._frame_lru = _FrameLRU(cap_bytes=frame_lru_bytes)

    # ---- ID helpers ----------------------------------------------------
    @staticmethod
    def _new_id() -> str:
        return uuid.uuid4().hex[:12]

    def was_evicted(self, kind: str, item_id: str) -> bool:
        with self._lock:
            return item_id in self._evicted.get(kind, [])

    # ---- Recording -----------------------------------------------------
    def register_recording(self,
                            path: str | Path,
                            *,
                            name: Optional[str] = None,
                            isp_mode_id: Optional[str] = None,
                            isp_config: Optional[Dict[str, Any]] = None,
                            ) -> RecordingHandle:
        meta = inspect_recording(path, isp_mode_id=isp_mode_id, isp_config=isp_config)
        if meta.errors:
            raise ValueError(
                f"cannot register {meta.name}: "
                + "; ".join(e.text for e in meta.errors)
            )
        if name is not None:
            object.__setattr__(meta, "name", name)
        h = RecordingHandle(
            recording_id=self._new_id(),
            meta=meta,
            path=Path(meta.path) if meta.path else Path(path),
            isp_mode_id=meta.isp_mode_id,
            isp_config=isp_config or {},
        )
        with self._lock:
            self._recordings[h.recording_id] = h
            self._evict_recordings_locked()
        return h

    def get_recording(self, recording_id: str) -> RecordingHandle:
        with self._lock:
            if recording_id not in self._recordings:
                raise KeyError(f"unknown recording id: {recording_id}")
            return self._recordings[recording_id]

    def list_recordings(self) -> List[RecordingHandle]:
        with self._lock:
            return sorted(self._recordings.values(),
                          key=lambda h: h.loaded_at, reverse=True)

    def delete_recording(self, recording_id: str) -> List[str]:
        """Drop a recording. Returns the list of stream ids invalidated."""
        with self._lock:
            if recording_id not in self._recordings:
                raise KeyError(f"unknown recording id: {recording_id}")
            del self._recordings[recording_id]
            self._remember_evicted_locked("recording", recording_id)
            invalidated: List[str] = []
            for sid, s in self._streams.items():
                if recording_id in s.recording_ids:
                    s.invalidated = True
                    invalidated.append(sid)
            self._frame_lru.drop_recording(recording_id)
            return invalidated

    # ---- Dark ----------------------------------------------------------
    def register_dark(self, master: MasterDark) -> DarkHandle:
        h = DarkHandle(dark_id=self._new_id(), master=master)
        with self._lock:
            self._darks[h.dark_id] = h
            self._evict_darks_locked()
        return h

    def get_dark(self, dark_id: str) -> DarkHandle:
        with self._lock:
            if dark_id not in self._darks:
                raise KeyError(f"unknown dark id: {dark_id}")
            return self._darks[dark_id]

    def list_darks(self) -> List[DarkHandle]:
        with self._lock:
            return sorted(self._darks.values(),
                          key=lambda h: h.loaded_at, reverse=True)

    def delete_dark(self, dark_id: str) -> None:
        with self._lock:
            if dark_id not in self._darks:
                raise KeyError(f"unknown dark id: {dark_id}")
            del self._darks[dark_id]
            self._remember_evicted_locked("dark", dark_id)

    # ---- Stream --------------------------------------------------------
    def build_stream(self,
                     recording_ids: Sequence[str],
                     *,
                     name: Optional[str] = None,
                     continuity_threshold_s: float = 1.0,
                     isp_mode_id: Optional[str] = None,
                     isp_config: Optional[Dict[str, Any]] = None,
                     ) -> StreamHandle:
        with self._lock:
            handles = [self.get_recording(rid) for rid in recording_ids]
        sid = self._new_id()
        nm = name or f"Stream · {time.strftime('%Y-%m-%d %H:%M:%S')}"
        stream = build_stream(
            handles,
            stream_id=sid,
            name=nm,
            continuity_threshold_s=continuity_threshold_s,
            isp_mode_id=isp_mode_id,
            isp_config=isp_config,
        )
        with self._lock:
            self._streams[sid] = stream
            self._evict_streams_locked()
        return stream

    def get_stream(self, stream_id: str) -> StreamHandle:
        with self._lock:
            if stream_id not in self._streams:
                raise KeyError(f"unknown stream id: {stream_id}")
            return self._streams[stream_id]

    def list_streams(self) -> List[StreamHandle]:
        with self._lock:
            return sorted(self._streams.values(),
                          key=lambda s: s.loaded_at, reverse=True)

    def delete_stream(self, stream_id: str) -> None:
        """Drop a stream. Raises ``RuntimeError`` if an active job pins it."""
        with self._lock:
            if stream_id not in self._streams:
                raise KeyError(f"unknown stream id: {stream_id}")
            for job in self._jobs.values():
                if (job.pinned_stream_id == stream_id
                        and job.status in ("queued", "rendering")):
                    raise RuntimeError(
                        f"stream {stream_id} has active export job "
                        f"{job.job_id}; cancel it first"
                    )
            del self._streams[stream_id]
            self._remember_evicted_locked("stream", stream_id)
            self._frame_lru.drop_stream(stream_id)

    # ---- Frame access (cached) ----------------------------------------
    def get_frame(self, stream_id: str, frame: int
                  ) -> Dict[str, np.ndarray]:
        """Resolve global ``frame`` to its source recording, extract via the
        stream's ISP mode + config, return the channel dict.

        Hits the process-global byte-LRU on repeat reads.
        """
        with self._lock:
            stream = self.get_stream(stream_id)
        _, rec_id, local = frame_lookup(stream, frame)
        key = (stream_id, rec_id, local)
        cached = self._frame_lru.get(key)
        if cached is not None:
            return cached
        rec = self.get_recording(rec_id)
        mode = _isp.get_mode(stream.isp_mode_id)
        cfg = _isp.normalize_config(mode, stream.isp_config or {})
        channels = extract_frame(rec.meta, local, isp_mode=mode, isp_config=cfg)
        self._frame_lru.put(key, channels)
        return channels

    # ---- Frame-LRU controls -------------------------------------------
    def set_frame_lru_bytes(self, n_bytes: int) -> int:
        """User-adjustable cap (P0-C). Returns the clamped cap."""
        self._frame_lru.set_cap(n_bytes)
        return self._frame_lru.cap_bytes

    def frame_lru_bytes(self) -> Tuple[int, int, int]:
        """Return ``(current_bytes, cap_bytes, n_frames)``."""
        return (self._frame_lru.current_bytes,
                self._frame_lru.cap_bytes,
                len(self._frame_lru))

    # ---- Job tracking --------------------------------------------------
    def submit_export(self, job: ExportJob) -> ExportJob:
        with self._lock:
            self._jobs[job.job_id] = job
            self._evict_jobs_locked()
        return job

    def get_job(self, job_id: str) -> ExportJob:
        with self._lock:
            if job_id not in self._jobs:
                raise KeyError(f"unknown job id: {job_id}")
            return self._jobs[job_id]

    def list_jobs(self) -> List[ExportJob]:
        with self._lock:
            return sorted(self._jobs.values(),
                          key=lambda j: j.submitted_at, reverse=True)

    def cancel_job(self, job_id: str) -> ExportJob:
        with self._lock:
            j = self.get_job(job_id)
            if j.cancel_event is not None:
                j.cancel_event.set()
            j.status = "cancelled"
            return j

    # ---- Preset --------------------------------------------------------
    def save_preset(self, kind: str, name: str, payload: Dict[str, Any]
                    ) -> Preset:
        if kind not in self._presets:
            raise KeyError(f"unknown preset kind: {kind}")
        p = Preset(preset_id=self._new_id(), kind=kind, name=name,
                   payload=dict(payload), created_at=time.time())
        with self._lock:
            self._presets[kind][p.preset_id] = p
            # Cap per kind, oldest-first eviction.
            if len(self._presets[kind]) > self._max_presets_per_kind:
                ordered = sorted(self._presets[kind].values(),
                                 key=lambda r: r.created_at)
                for old in ordered[:len(self._presets[kind]) - self._max_presets_per_kind]:
                    del self._presets[kind][old.preset_id]
        return p

    def list_presets(self, kind: str) -> List[Preset]:
        if kind not in self._presets:
            raise KeyError(f"unknown preset kind: {kind}")
        with self._lock:
            return sorted(self._presets[kind].values(),
                          key=lambda r: r.created_at, reverse=True)

    def delete_preset(self, kind: str, preset_id: str) -> None:
        if kind not in self._presets:
            raise KeyError(f"unknown preset kind: {kind}")
        with self._lock:
            if preset_id not in self._presets[kind]:
                raise KeyError(f"unknown preset id: {preset_id}")
            del self._presets[kind][preset_id]

    # ---- Eviction ------------------------------------------------------
    def _remember_evicted_locked(self, kind: str, item_id: str) -> None:
        bucket = self._evicted.setdefault(kind, [])
        if item_id in bucket:
            bucket.remove(item_id)
        bucket.append(item_id)
        if len(bucket) > self._evict_max:
            self._evicted[kind] = bucket[-self._evict_max:]

    def _evict_recordings_locked(self) -> None:
        if len(self._recordings) <= self._max_recordings:
            return
        ordered = sorted(self._recordings.values(), key=lambda h: h.loaded_at)
        for h in ordered[:len(self._recordings) - self._max_recordings]:
            self._remember_evicted_locked("recording", h.recording_id)
            del self._recordings[h.recording_id]
            self._frame_lru.drop_recording(h.recording_id)

    def _evict_darks_locked(self) -> None:
        if len(self._darks) <= self._max_darks:
            return
        ordered = sorted(self._darks.values(), key=lambda h: h.loaded_at)
        for h in ordered[:len(self._darks) - self._max_darks]:
            self._remember_evicted_locked("dark", h.dark_id)
            del self._darks[h.dark_id]

    def _evict_streams_locked(self) -> None:
        if len(self._streams) <= self._max_streams:
            return
        # Don't evict streams pinned by a running job.
        pinned = {j.pinned_stream_id for j in self._jobs.values()
                  if j.pinned_stream_id is not None
                  and j.status in ("queued", "rendering")}
        ordered = sorted(self._streams.values(),
                         key=lambda s: s.loaded_at)
        for s in ordered[:len(self._streams) - self._max_streams]:
            if s.stream_id in pinned:
                continue
            self._remember_evicted_locked("stream", s.stream_id)
            del self._streams[s.stream_id]
            self._frame_lru.drop_stream(s.stream_id)

    def _evict_jobs_locked(self) -> None:
        if len(self._jobs) <= self._max_jobs:
            return
        # Never evict an active job; oldest completed first.
        ordered = sorted(
            self._jobs.values(),
            key=lambda j: (j.status in ("queued", "rendering"), j.submitted_at),
        )
        for j in ordered:
            if len(self._jobs) <= self._max_jobs:
                return
            if j.status in ("queued", "rendering"):
                continue
            self._remember_evicted_locked("job", j.job_id)
            del self._jobs[j.job_id]


# Process-global singleton — server.py + tests use this.
PLAYBACK_STORE = PlaybackStore()


__all__ = [
    "WARN_GAP", "WARN_OVERLAP", "WARN_EXP_MISMATCH",
    "WARN_SHAPE", "WARN_CHAN", "WARN_TS_DISORDER",
    "RecordingHandle", "DarkHandle",
    "StreamBoundary", "StreamHandle",
    "ExportJob", "Preset", "LiveStreamHandle",
    "build_stream", "frame_lookup",
    "PlaybackStore", "PLAYBACK_STORE",
]
