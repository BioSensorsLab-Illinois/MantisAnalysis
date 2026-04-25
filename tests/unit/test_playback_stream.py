"""Tests for ``mantisanalysis.playback_session`` (M3).

Stream building, continuity / gap / overlap / exposure-mismatch /
shape-mismatch / channel-intersection detection, global ↔ local frame
mapping, byte-LRU, eviction semantics, and active-job pinning.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

from mantisanalysis import isp_modes as _isp
from mantisanalysis.playback_session import (
    ExportJob,
    PlaybackStore,
    StreamBoundary,
    StreamHandle,
    WARN_CHAN,
    WARN_EXP_MISMATCH,
    WARN_GAP,
    WARN_OVERLAP,
    WARN_SHAPE,
    build_stream,
    frame_lookup,
    _FrameLRU,
)
from mantisanalysis.recording import RecordingMeta, Warning
from tests.unit._h5_fixtures import write_synthetic_recording


# ---------------------------------------------------------------------------
# Stream construction helpers
# ---------------------------------------------------------------------------


def _register_synth(store: PlaybackStore, tmp_path: Path,
                    *, fname: str, n_frames: int = 4,
                    h: int = 32, w: int = 64,
                    exposure_us: int = 20_000,
                    fps: float = 30.0,
                    ts_start_s: float = 0.0,
                    variant: str = "canonical",
                    use_4d_shape: bool = False):
    """Helper: write a synth recording, register it with the store."""
    p = tmp_path / fname
    write_synthetic_recording(p,
                              n_frames=n_frames, h=h, w=w,
                              exposure_us=exposure_us,
                              fps=fps, ts_start_s=ts_start_s,
                              variant=variant,
                              use_4d_shape=use_4d_shape)
    return store.register_recording(p)


# ---------------------------------------------------------------------------
# Single-recording stream
# ---------------------------------------------------------------------------


def test_single_recording_stream(tmp_path: Path) -> None:
    store = PlaybackStore()
    h = _register_synth(store, tmp_path, fname="r1.h5", n_frames=8)
    stream = store.build_stream([h.recording_id], name="single")
    assert stream.total_frames == 8
    assert len(stream.boundaries) == 1
    assert stream.boundaries[0].start_frame == 0
    assert stream.boundaries[0].end_frame == 8
    assert stream.recording_ids == (h.recording_id,)
    assert stream.quarantined_recording_ids == ()
    assert stream.warnings == ()


# ---------------------------------------------------------------------------
# Multi-recording continuity
# ---------------------------------------------------------------------------


def test_three_synthetic_recordings_with_canonical_layout(tmp_path: Path
                                                           ) -> None:
    """Per planner-architect P1-2 + risk-skeptic P1-J: three (N, 2048, 4096, 1)
    GSense FSI legacy-shape H5s build into a continuous stream.

    Uses smaller (N, 32, 64, 1) shapes for test speed but the same
    4-D layout the dev folder uses.
    """
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="r1.h5", n_frames=4,
                         use_4d_shape=True, ts_start_s=0.0, fps=30.0)
    h2 = _register_synth(store, tmp_path, fname="r2.h5", n_frames=4,
                         use_4d_shape=True, ts_start_s=4.0 / 30.0, fps=30.0)
    h3 = _register_synth(store, tmp_path, fname="r3.h5", n_frames=4,
                         use_4d_shape=True, ts_start_s=8.0 / 30.0, fps=30.0)
    stream = store.build_stream([h1.recording_id, h2.recording_id,
                                 h3.recording_id])
    assert stream.total_frames == 12
    assert [b.start_frame for b in stream.boundaries] == [0, 4, 8]
    assert [b.end_frame for b in stream.boundaries] == [4, 8, 12]
    # No gap warnings — continuous.
    gap_warns = [w for w in stream.warnings if w.code == WARN_GAP]
    assert gap_warns == []
    assert stream.issues["gap_count"] == 0


def test_gap_detected_above_threshold(tmp_path: Path) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4)
    # Insert a 0.8 s gap.
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         ts_start_s=4.0 / 30.0 + 0.8)
    stream = store.build_stream([h1.recording_id, h2.recording_id],
                                continuity_threshold_s=0.5)
    assert any(w.code == WARN_GAP for w in stream.warnings)
    assert stream.issues["gap_count"] == 1


def test_gap_silenced_below_threshold(tmp_path: Path) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         ts_start_s=4.0 / 30.0 + 0.8)
    stream = store.build_stream([h1.recording_id, h2.recording_id],
                                continuity_threshold_s=1.0)
    assert not any(w.code == WARN_GAP for w in stream.warnings)
    assert stream.issues["gap_count"] == 0


def test_overlap_detected(tmp_path: Path) -> None:
    """ts_start of file 2 < ts_end of file 1 → W-OVERLAP."""
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         fps=30.0, ts_start_s=0.0)
    # File 2 starts at 0.05 s before file 1 ends.
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         fps=30.0, ts_start_s=4.0 / 30.0 - 0.05)
    stream = store.build_stream([h1.recording_id, h2.recording_id])
    assert any(w.code == WARN_OVERLAP for w in stream.warnings)
    assert stream.issues["overlap_count"] == 1


def test_exposure_mismatch_detected(tmp_path: Path) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         exposure_us=20_000)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         exposure_us=40_000, ts_start_s=4.0 / 30.0)
    stream = store.build_stream([h1.recording_id, h2.recording_id])
    assert any(w.code == WARN_EXP_MISMATCH for w in stream.warnings)
    assert stream.issues["exposure_mismatch_count"] == 1


def test_shape_mismatch_quarantines(tmp_path: Path) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         h=32, w=64)
    # Different H/W → quarantined.
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         h=16, w=32)
    stream = store.build_stream([h1.recording_id, h2.recording_id])
    assert h2.recording_id in stream.quarantined_recording_ids
    assert h1.recording_id in stream.recording_ids
    assert stream.issues["shape_mismatch_count"] == 1
    assert any(w.code == WARN_SHAPE for w in stream.warnings)


# ---------------------------------------------------------------------------
# Timestamp edge cases (risk-skeptic P1-J)
# ---------------------------------------------------------------------------


def test_identical_first_timestamps_caller_order_wins(tmp_path: Path
                                                       ) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         ts_start_s=100.0)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         ts_start_s=100.0)
    stream = store.build_stream([h1.recording_id, h2.recording_id])
    # Caller order wins.
    assert stream.recording_ids == (h1.recording_id, h2.recording_id)


def test_exact_zero_gap_no_warning(tmp_path: Path) -> None:
    """ts_start of file 2 == ts_end of file 1 exactly → no W-GAP, no overlap."""
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         fps=30.0, ts_start_s=0.0)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=4,
                         fps=30.0, ts_start_s=(4 - 1) / 30.0)
    stream = store.build_stream([h1.recording_id, h2.recording_id],
                                continuity_threshold_s=1.0)
    assert not any(w.code == WARN_GAP for w in stream.warnings)
    assert not any(w.code == WARN_OVERLAP for w in stream.warnings)


def test_very_large_absolute_timestamps_preserved(tmp_path: Path) -> None:
    """Unix-epoch-style timestamps preserve precision."""
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=4,
                         ts_start_s=1.7e9)
    stream = store.build_stream([h1.recording_id])
    assert stream.boundaries[0].ts_start_s == pytest.approx(0.0)
    assert stream.boundaries[0].ts_end_s == pytest.approx((4 - 1) / 30.0,
                                                            abs=1e-3)


def test_intra_file_non_monotonic_propagates_W_TS_DISORDER(tmp_path: Path
                                                            ) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=8,
                         variant="non-monotonic-ts")
    stream = store.build_stream([h1.recording_id])
    # The recording-level W-TS-DISORDER shows up on the stream's warning list.
    assert any(w.code == "W-TS-DISORDER" for w in stream.warnings)


# ---------------------------------------------------------------------------
# Frame lookup
# ---------------------------------------------------------------------------


def _stream_with_three_recordings(store: PlaybackStore, tmp_path: Path
                                  ) -> StreamHandle:
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=10)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=10,
                         ts_start_s=10.0 / 30.0)
    h3 = _register_synth(store, tmp_path, fname="c.h5", n_frames=10,
                         ts_start_s=20.0 / 30.0)
    return store.build_stream([h1.recording_id, h2.recording_id,
                                h3.recording_id])


def test_frame_lookup_first_frame(tmp_path: Path) -> None:
    store = PlaybackStore()
    stream = _stream_with_three_recordings(store, tmp_path)
    boundary, rec_id, local = frame_lookup(stream, 0)
    assert boundary.start_frame == 0
    assert local == 0


def test_frame_lookup_last_frame(tmp_path: Path) -> None:
    store = PlaybackStore()
    stream = _stream_with_three_recordings(store, tmp_path)
    boundary, rec_id, local = frame_lookup(stream, stream.total_frames - 1)
    assert boundary.end_frame == stream.total_frames
    assert local == stream.total_frames - 1 - boundary.start_frame


def test_frame_lookup_global_to_local_middle_recording(tmp_path: Path) -> None:
    store = PlaybackStore()
    stream = _stream_with_three_recordings(store, tmp_path)
    # Frame 15 → recording_2 (10–20), local frame 5.
    boundary, rec_id, local = frame_lookup(stream, 15)
    assert boundary.start_frame == 10
    assert local == 5


def test_frame_lookup_out_of_range(tmp_path: Path) -> None:
    store = PlaybackStore()
    stream = _stream_with_three_recordings(store, tmp_path)
    with pytest.raises(IndexError):
        frame_lookup(stream, 99)
    with pytest.raises(IndexError):
        frame_lookup(stream, -1)


def test_get_frame_via_store_uses_lru(tmp_path: Path) -> None:
    """Repeat reads of the same global frame hit the LRU."""
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="r.h5", n_frames=4)
    stream = store.build_stream([h1.recording_id])

    initial_bytes, _, initial_n = store.frame_lru_bytes()
    assert initial_n == 0

    ch1 = store.get_frame(stream.stream_id, 0)
    after_first_bytes, cap, after_first_n = store.frame_lru_bytes()
    assert after_first_n == 1
    assert after_first_bytes > 0

    ch2 = store.get_frame(stream.stream_id, 0)
    # Same dict from the cache.
    assert ch1 is ch2
    _, _, after_second_n = store.frame_lru_bytes()
    assert after_second_n == 1


# ---------------------------------------------------------------------------
# Process-global byte-LRU
# ---------------------------------------------------------------------------


def test_lru_byte_cap_evicts_oldest() -> None:
    import numpy as np

    cap = _FrameLRU.MIN_BYTES  # 256 MB cap
    lru = _FrameLRU(cap_bytes=cap)
    # 64 MB per frame.
    big = np.zeros((4096, 4096), dtype=np.float64)
    payload = {"HG-G": big}
    n_per_frame = big.nbytes
    for i in range(6):  # 6 × 64 MB = 384 MB > 256 MB cap
        lru.put(("s", "r", i), {"HG-G": big.copy()})
    assert lru.current_bytes <= cap
    # Oldest frames evicted.
    assert lru.get(("s", "r", 0)) is None
    assert lru.get(("s", "r", 5)) is not None


def test_lru_clamp_to_min_max() -> None:
    lru = _FrameLRU()
    lru.set_cap(1)  # tiny — clamped up to MIN_BYTES
    assert lru.cap_bytes == _FrameLRU.MIN_BYTES
    lru.set_cap(10**12)  # huge — clamped down to MAX_BYTES
    assert lru.cap_bytes == _FrameLRU.MAX_BYTES


def test_lru_drop_recording() -> None:
    import numpy as np

    lru = _FrameLRU(cap_bytes=_FrameLRU.MIN_BYTES)
    lru.put(("s1", "rA", 0), {"x": np.zeros((10, 10))})
    lru.put(("s1", "rB", 0), {"x": np.zeros((10, 10))})
    lru.put(("s2", "rA", 1), {"x": np.zeros((10, 10))})
    lru.drop_recording("rA")
    assert lru.get(("s1", "rA", 0)) is None
    assert lru.get(("s2", "rA", 1)) is None
    assert lru.get(("s1", "rB", 0)) is not None


def test_lru_drop_stream() -> None:
    import numpy as np

    lru = _FrameLRU(cap_bytes=_FrameLRU.MIN_BYTES)
    lru.put(("s1", "rA", 0), {"x": np.zeros((10, 10))})
    lru.put(("s2", "rA", 0), {"x": np.zeros((10, 10))})
    lru.drop_stream("s1")
    assert lru.get(("s1", "rA", 0)) is None
    assert lru.get(("s2", "rA", 0)) is not None


# ---------------------------------------------------------------------------
# Eviction + active-job pinning
# ---------------------------------------------------------------------------


def test_recording_eviction_invalidates_streams(tmp_path: Path) -> None:
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="r.h5", n_frames=4)
    stream = store.build_stream([h1.recording_id])
    invalidated = store.delete_recording(h1.recording_id)
    assert stream.stream_id in invalidated
    assert store.get_stream(stream.stream_id).invalidated is True


def test_delete_stream_with_active_job_raises(tmp_path: Path) -> None:
    """Per risk-skeptic P2-P: cannot delete a stream while an active job pins it."""
    store = PlaybackStore()
    h1 = _register_synth(store, tmp_path, fname="r.h5", n_frames=4)
    stream = store.build_stream([h1.recording_id])
    job = ExportJob(
        job_id="job1", kind="video",
        request={"stream_id": stream.stream_id},
        status="rendering", total_frames=4,
        pinned_stream_id=stream.stream_id,
    )
    store.submit_export(job)
    with pytest.raises(RuntimeError, match="active export job"):
        store.delete_stream(stream.stream_id)
    # Cancel the job; delete now succeeds.
    store.cancel_job("job1")
    store.delete_stream(stream.stream_id)


def test_recording_lru_eviction_uses_oldest(tmp_path: Path) -> None:
    """Cap = 2; loading 3 evicts the first."""
    store = PlaybackStore(max_recordings=2)
    h1 = _register_synth(store, tmp_path, fname="a.h5", n_frames=2)
    h2 = _register_synth(store, tmp_path, fname="b.h5", n_frames=2)
    h3 = _register_synth(store, tmp_path, fname="c.h5", n_frames=2)
    with pytest.raises(KeyError):
        store.get_recording(h1.recording_id)
    assert store.was_evicted("recording", h1.recording_id)
    # h2, h3 still present.
    assert store.get_recording(h2.recording_id) is not None
    assert store.get_recording(h3.recording_id) is not None


# ---------------------------------------------------------------------------
# Presets
# ---------------------------------------------------------------------------


def test_preset_save_and_list() -> None:
    store = PlaybackStore()
    p = store.save_preset("view", "NIR diagnostic",
                           {"channel": "HG-NIR", "low": 100})
    presets = store.list_presets("view")
    assert any(x.preset_id == p.preset_id for x in presets)


def test_preset_unknown_kind_raises() -> None:
    store = PlaybackStore()
    with pytest.raises(KeyError):
        store.save_preset("unknown", "bogus", {})


def test_preset_per_kind_cap_evicts_oldest() -> None:
    store = PlaybackStore(max_presets_per_kind=3)
    ids = []
    for i in range(5):
        ids.append(store.save_preset("view", f"p{i}", {"i": i}).preset_id)
        time.sleep(0.001)
    presets = store.list_presets("view")
    assert len(presets) == 3
    # First two should be evicted.
    remaining = {p.preset_id for p in presets}
    assert ids[0] not in remaining
    assert ids[1] not in remaining
