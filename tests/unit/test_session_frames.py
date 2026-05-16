"""Per-frame extraction + multi-source independence + dark averaging.

play-tab-recording-inspection-rescue-v1 M1.

Uses tiny synthetic H5 fixtures shaped like real MantisCam recordings
(`camera/frames` shape (N, H, W, 1) uint16, dual-gain across W). No real
H5 binaries are committed; the fixture writes into ``tmp_path`` and the
file is GC'd at test teardown.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from mantisanalysis.session import (
    PLAYBACK_CACHE_SIZE,
    SessionStore,
    _hash_isp_config,
    _load_dark_channels,
)

# ---------------------------------------------------------------------------
# Synthetic H5 builder — emulates a MantisCam recording
# ---------------------------------------------------------------------------


def _make_synthetic_h5(
    path: Path,
    *,
    n_frames: int = 5,
    half_h: int = 16,
    half_w: int = 16,  # full width = 2 * half_w
    exposure_s: float = 0.1,
    ts0: float = 1_000_000.0,
    ts_step: float = 0.04,
    seed: int = 0,
) -> Path:
    """Write a small synthetic dual-gain H5 in MantisCam format.

    Each frame's pixel values encode (frame_index, row, col) so different
    frames are byte-distinguishable for cache / index tests.
    """
    rng = np.random.default_rng(seed)
    h, w = half_h, 2 * half_w
    frames = np.empty((n_frames, h, w, 1), dtype=np.uint16)
    for i in range(n_frames):
        # Distinct per-frame intensity ramps; HG side biased low, LG side biased high.
        base = (i + 1) * 100
        plane = np.full((h, w), base, dtype=np.uint16)
        plane[:, :half_w] += rng.integers(0, 200, size=(h, half_w), dtype=np.uint16)
        plane[:, half_w:] += rng.integers(500, 1000, size=(h, half_w), dtype=np.uint16) + i * 50
        frames[i, :, :, 0] = plane
    timestamps = ts0 + np.arange(n_frames, dtype=np.float64) * ts_step
    int_time = np.full(n_frames, exposure_s, dtype=np.float64)
    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames, chunks=(1, h, w, 1))
        cam.create_dataset("integration-time", data=int_time)
        cam.create_dataset("integration-time-expected", data=int_time)
        cam.create_dataset("timestamp", data=timestamps)
        f.attrs["sw-version"] = "test-fixture"
    return path


@pytest.fixture
def synth_h5(tmp_path: Path) -> Path:
    return _make_synthetic_h5(tmp_path / "rec_a.h5", n_frames=5, exposure_s=0.1)


@pytest.fixture
def synth_h5_b(tmp_path: Path) -> Path:
    return _make_synthetic_h5(
        tmp_path / "rec_b.h5", n_frames=4, exposure_s=0.05, ts0=2_000_000.0, seed=42
    )


@pytest.fixture
def synth_dark(tmp_path: Path) -> Path:
    """Synthetic dark frame H5 with the same shape as synth_h5 — uniform
    low values so the averaged-dark math is easy to assert."""
    return _make_synthetic_h5(
        tmp_path / "dark_a.h5",
        n_frames=4,
        exposure_s=0.1,
        ts0=999_000.0,
        seed=99,
    )


# ---------------------------------------------------------------------------
# M16 — synthetic H5 missing one or more `camera/*` metadata datasets.
# Used to prove load_from_path emits the canonical W-* warnings.
# ---------------------------------------------------------------------------


def _make_synthetic_h5_missing(
    path: Path,
    *,
    omit: tuple[str, ...],
    n_frames: int = 4,
    half_h: int = 16,
    half_w: int = 16,
    exposure_s: float = 0.1,
    seed: int = 7,
) -> Path:
    """Same shape as `_make_synthetic_h5` but skips listed `camera/*` datasets.

    `omit` may include ``"timestamp"`` and/or ``"integration-time"``.
    """
    rng = np.random.default_rng(seed)
    h, w = half_h, 2 * half_w
    frames = np.empty((n_frames, h, w, 1), dtype=np.uint16)
    for i in range(n_frames):
        plane = np.full((h, w), (i + 1) * 100, dtype=np.uint16)
        plane[:, :half_w] += rng.integers(0, 200, size=(h, half_w), dtype=np.uint16)
        plane[:, half_w:] += rng.integers(500, 1000, size=(h, half_w), dtype=np.uint16)
        frames[i, :, :, 0] = plane
    timestamps = 1_000_000.0 + np.arange(n_frames, dtype=np.float64) * 0.04
    int_time = np.full(n_frames, exposure_s, dtype=np.float64)
    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames, chunks=(1, h, w, 1))
        if "integration-time" not in omit:
            cam.create_dataset("integration-time", data=int_time)
            cam.create_dataset("integration-time-expected", data=int_time)
        if "timestamp" not in omit:
            cam.create_dataset("timestamp", data=timestamps)
        f.attrs["sw-version"] = "test-fixture"
    return path


# ---------------------------------------------------------------------------
# Frame metadata + count
# ---------------------------------------------------------------------------


def test_load_h5_populates_frame_metadata(synth_h5: Path):
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        assert src.source_kind == "h5"
        assert src.frame_count == 5
        assert src.per_frame_exposures_s is not None
        assert src.per_frame_exposures_s.shape == (5,)
        assert np.allclose(src.per_frame_exposures_s, 0.1)
        assert src.per_frame_timestamps is not None
        assert src.per_frame_timestamps.shape == (5,)
        # Monotonic timestamps
        assert np.all(np.diff(src.per_frame_timestamps) > 0)
    finally:
        store.clear()


def test_summary_dict_carries_frame_count(synth_h5: Path):
    from mantisanalysis.session import _summary_dict

    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        d = _summary_dict(src)
        assert d["frame_count"] == 5
        assert d["kind"] == "h5"
    finally:
        store.clear()


def test_image_source_has_frame_count_one(tmp_path: Path):
    from PIL import Image

    p = tmp_path / "rgb.png"
    Image.fromarray(np.zeros((8, 8, 3), dtype=np.uint8)).save(p)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        assert src.frame_count == 1
        assert src.per_frame_exposures_s is None
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# extract_frame correctness + caching
# ---------------------------------------------------------------------------


def test_extract_frame_returns_distinct_arrays_per_frame(synth_h5: Path):
    """Different frames must produce different channel arrays."""
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        chs0 = src.extract_frame(0)
        chs1 = src.extract_frame(1)
        chs4 = src.extract_frame(4)
        assert set(chs0.keys()) == set(chs1.keys()) == set(chs4.keys())
        # The synthetic builder ramps base intensity per frame, so HG-G
        # in frame 0 != HG-G in frame 1.
        assert not np.array_equal(chs0["HG-G"], chs1["HG-G"])
        assert not np.array_equal(chs1["HG-G"], chs4["HG-G"])
    finally:
        store.clear()


def test_extract_frame_caches(synth_h5: Path, monkeypatch):
    """A second extract_frame(idx) for the same idx returns the cached
    dict by reference and does NOT re-read the h5."""
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        first = src.extract_frame(2)
        # Spy: replace FrameReader.read_frame with a guard that fails on
        # the next call. If we hit the cache, read_frame won't be called.
        original = src._frame_reader.read_frame

        def explode(idx: int):
            raise AssertionError(f"read_frame should not be called on cache hit (idx={idx})")

        src._frame_reader.read_frame = explode  # type: ignore[assignment]
        try:
            second = src.extract_frame(2)
            assert second is first  # same object, by-reference
        finally:
            src._frame_reader.read_frame = original  # type: ignore[assignment]
    finally:
        store.clear()


def test_extract_frame_lru_bounds_at_playback_cache_size(synth_h5: Path):
    """Pumping > PLAYBACK_CACHE_SIZE frames must not grow the cache past it."""
    store = SessionStore(max_entries=4)
    # Build a larger fixture so we can exceed the cache size with distinct frames.
    big_path = synth_h5.parent / "big.h5"
    _make_synthetic_h5(big_path, n_frames=PLAYBACK_CACHE_SIZE + 5, exposure_s=0.05)
    src = store.load_from_path(big_path)
    try:
        for i in range(PLAYBACK_CACHE_SIZE + 5):
            src.extract_frame(i)
        assert len(src._frame_extract_cache) == PLAYBACK_CACHE_SIZE
        # Frame 0 should have been evicted; frame N-1 still present.
        # Cache key is (idx, isp_hash); we know the active hash didn't change.
        keys_idx = sorted(k[0] for k in src._frame_extract_cache.keys())
        assert 0 not in keys_idx
        assert (PLAYBACK_CACHE_SIZE + 4) in keys_idx
    finally:
        store.clear()


def test_extract_frame_out_of_range_raises(synth_h5: Path):
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        with pytest.raises(IndexError):
            src.extract_frame(100)
        with pytest.raises(IndexError):
            src.extract_frame(-1)
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# Multi-source independence (the prior "couldn't open second recording" failure)
# ---------------------------------------------------------------------------


def test_two_sources_load_independently(synth_h5: Path, synth_h5_b: Path):
    """Loading B after A leaves both retrievable and independent."""
    store = SessionStore(max_entries=4)
    a = store.load_from_path(synth_h5)
    b = store.load_from_path(synth_h5_b)
    try:
        assert a.source_id != b.source_id
        assert store.get(a.source_id) is a
        assert store.get(b.source_id) is b
        assert a.frame_count == 5
        assert b.frame_count == 4
        # Independent extract: a frame from each works without crosstalk
        a_chs = a.extract_frame(0)
        b_chs = b.extract_frame(0)
        # Different exposures and seeds → different content
        assert not np.array_equal(a_chs["HG-G"], b_chs["HG-G"])
    finally:
        store.clear()


def test_remove_source_keeps_others_intact(synth_h5: Path, synth_h5_b: Path):
    store = SessionStore(max_entries=4)
    a = store.load_from_path(synth_h5)
    b = store.load_from_path(synth_h5_b)
    try:
        store.remove(b.source_id)
        with pytest.raises(KeyError):
            store.get(b.source_id)
        # A still works end-to-end after B is gone
        assert store.get(a.source_id) is a
        chs = a.extract_frame(2)
        assert "HG-G" in chs
    finally:
        store.clear()


def test_remove_source_does_not_mark_evicted(synth_h5: Path):
    """User-initiated remove → 404 on follow-up, NOT 410. Evicted-memory
    is reserved for LRU drops."""
    store = SessionStore(max_entries=4)
    a = store.load_from_path(synth_h5)
    sid = a.source_id
    store.remove(sid)
    assert store.was_evicted(sid) is False


def test_lru_eviction_closes_frame_reader(synth_h5: Path, tmp_path: Path):
    """Pushing past the cap evicts the oldest source AND closes its h5 handle.

    Open the FrameReader BEFORE the third load so eviction has something
    to close. (Opening it after eviction would leak a fresh handle on a
    no-longer-tracked source — that's a separate concern, not what this
    test covers.)
    """
    store = SessionStore(max_entries=2)
    extra_paths = []
    for i in range(2):
        p = tmp_path / f"extra_{i}.h5"
        _make_synthetic_h5(p, n_frames=2, seed=10 + i)
        extra_paths.append(p)
    first = store.load_from_path(synth_h5)
    # Open the FrameReader on the first source (not yet evicted).
    first.extract_frame(0)
    assert first._frame_reader is not None
    assert first._frame_reader._h5 is not None
    # Now load two more — first will be evicted on the second of these
    # because max=2.
    store.load_from_path(extra_paths[0])
    third = store.load_from_path(extra_paths[1])  # noqa: F841 — just to trigger eviction
    try:
        assert store.was_evicted(first.source_id) is True
        # Evicted source's reader handle must be closed.
        assert first._frame_reader is None
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# Dark-frame averaging
# ---------------------------------------------------------------------------


def test_load_dark_channels_averages_h5(synth_dark: Path):
    """Averaged dark for an N-frame H5 differs from frame-0 alone."""
    chs = _load_dark_channels(synth_dark, isp_mode_id="rgb_nir", isp_config={})
    assert "HG-G" in chs and "LG-NIR" in chs
    # Averaging a synthetic dark with random per-frame noise: the averaged
    # array's std along all pixels is < the std of any single frame
    # (central limit theorem). Check that simply by re-extracting frame 0
    # and confirming arrays differ.
    from mantisanalysis.image_io import load_h5_channels

    single, _attrs, _raw, _mode_id, _cfg = load_h5_channels(synth_dark, frame_index=0)
    assert single["HG-G"].shape == chs["HG-G"].shape
    # Different — averaged is not equal to frame 0
    assert not np.array_equal(single["HG-G"], chs["HG-G"])


def test_attach_dark_uses_averaged_h5(synth_h5: Path, synth_dark: Path):
    store = SessionStore(max_entries=4)
    a = store.load_from_path(synth_h5)
    try:
        a2 = store.attach_dark_from_path(a.source_id, synth_dark, name="dark_a.h5")
        assert a2.has_dark is True
        assert a2.dark_channels is not None
        # Compare against the legacy frame-0-only loader output to confirm
        # we're NOT just storing frame 0.
        from mantisanalysis.image_io import load_h5_channels

        single, _, _, _, _ = load_h5_channels(synth_dark, frame_index=0)
        assert not np.array_equal(a2.dark_channels["HG-G"], single["HG-G"])
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# ISP reconfigure invalidates the per-frame extraction cache
# ---------------------------------------------------------------------------


def test_isp_reconfigure_clears_frame_cache(synth_h5: Path):
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        src.extract_frame(0)
        src.extract_frame(1)
        assert len(src._frame_extract_cache) == 2
        store.reconfigure_isp(src.source_id, "rgb_nir", overrides={})
        assert len(src._frame_extract_cache) == 0
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# Hash helper sanity
# ---------------------------------------------------------------------------


def test_hash_isp_config_stable_over_reorder():
    a = _hash_isp_config({"x": [1, 2], "y": 3})
    b = _hash_isp_config({"y": 3, "x": [1, 2]})
    assert a == b


def test_hash_isp_config_changes_with_value():
    a = _hash_isp_config({"x": 1})
    b = _hash_isp_config({"x": 2})
    assert a != b


# ---------------------------------------------------------------------------
# load_from_bytes — tempfile lifetime regression
# (post-M11: FileNotFoundError on per-frame extract because the upload
# tempfile got unlinked while the LoadedSource still pointed at it.)
# ---------------------------------------------------------------------------


def test_load_from_bytes_h5_keeps_tempfile_alive(synth_h5: Path):
    """An H5 uploaded via load_from_bytes must keep its backing file
    alive so per-frame access works AFTER load — frame 0 is cached but
    frame N requires re-opening the H5."""
    raw = synth_h5.read_bytes()
    store = SessionStore(max_entries=4)
    src = store.load_from_bytes(raw, "uploaded.h5")
    try:
        assert src.source_kind == "h5"
        assert src._owned_tempfile is not None, "tempfile must be owned by LoadedSource"
        assert Path(src._owned_tempfile).exists(), "tempfile must NOT be unlinked yet"
        # The fix: extract_frame(2) on an upload-flow H5 must succeed.
        chs2 = src.extract_frame(2)
        assert "HG-G" in chs2
        # And it must differ from frame 0 (proves the file was actually re-read)
        chs0 = src.extract_frame(0)
        assert not np.array_equal(chs0["HG-G"], chs2["HG-G"])
    finally:
        store.clear()


def test_load_from_bytes_close_unlinks_tempfile(synth_h5: Path):
    """When the LoadedSource is closed (eviction or remove), the
    tempfile we owned must get cleaned up."""
    raw = synth_h5.read_bytes()
    store = SessionStore(max_entries=4)
    src = store.load_from_bytes(raw, "uploaded.h5")
    tmp = src._owned_tempfile
    assert tmp is not None and Path(tmp).exists()
    store.remove(src.source_id)
    assert not Path(tmp).exists(), "tempfile must be unlinked after store.remove"


def test_load_from_bytes_image_unlinks_immediately(tmp_path: Path):
    """Image uploads have only frame 0; the tempfile can be unlinked
    right away (no per-frame access needed)."""
    from PIL import Image

    p = tmp_path / "rgb.png"
    Image.fromarray(np.zeros((4, 4, 3), dtype=np.uint8)).save(p)
    raw = p.read_bytes()
    store = SessionStore(max_entries=4)
    src = store.load_from_bytes(raw, "uploaded.png")
    try:
        assert src.source_kind == "image"
        assert src._owned_tempfile is None  # already unlinked
        assert src._h5_path is None
        # Frame 0 still works (channels cached)
        chs = src.extract_frame(0)
        assert "R" in chs
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# M16 — load-time warnings on missing metadata
# ---------------------------------------------------------------------------


def test_complete_h5_emits_no_warnings(synth_h5: Path):
    """Baseline: a normal H5 with timestamp + integration-time emits zero warnings."""
    store = SessionStore(max_entries=4)
    src = store.load_from_path(synth_h5)
    try:
        assert src.warnings == []
    finally:
        store.clear()


def test_h5_missing_timestamp_emits_w_meta_ts(tmp_path: Path):
    p = _make_synthetic_h5_missing(tmp_path / "no_ts.h5", omit=("timestamp",), n_frames=3)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        codes = {w["code"] for w in src.warnings}
        assert "W-META-TS" in codes
        assert "W-META-EXP" not in codes  # exposure dataset still present
        # Severity wired through
        ts = next(w for w in src.warnings if w["code"] == "W-META-TS")
        assert ts["severity"] == "warning"
        assert "no_ts.h5" in ts["detail"]
        # Source still loads cleanly
        assert src.frame_count == 3
        assert src.per_frame_timestamps is not None  # arange fallback
    finally:
        store.clear()


def test_h5_missing_integration_time_emits_w_meta_exp(tmp_path: Path):
    p = _make_synthetic_h5_missing(tmp_path / "no_exp.h5", omit=("integration-time",), n_frames=3)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        codes = {w["code"] for w in src.warnings}
        assert "W-META-EXP" in codes
        assert "W-META-TS" not in codes
        exp = next(w for w in src.warnings if w["code"] == "W-META-EXP")
        assert exp["severity"] == "warning"
        # Exposures defaulted to zeros
        assert src.per_frame_exposures_s is not None
        assert np.allclose(src.per_frame_exposures_s, 0.0)
    finally:
        store.clear()


def test_h5_missing_both_emits_both_warnings(tmp_path: Path):
    p = _make_synthetic_h5_missing(
        tmp_path / "no_meta.h5", omit=("timestamp", "integration-time"), n_frames=2
    )
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        codes = {w["code"] for w in src.warnings}
        assert codes == {"W-META-TS", "W-META-EXP"}
    finally:
        store.clear()


def test_summary_dict_includes_warnings(tmp_path: Path):
    """Round-trip: warnings populated on LoadedSource must show up in
    `_summary_dict` (and therefore in the API SourceSummary payload)."""
    from mantisanalysis.session import _summary_dict

    p = _make_synthetic_h5_missing(tmp_path / "no_ts.h5", omit=("timestamp",), n_frames=3)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        d = _summary_dict(src)
        assert "warnings" in d
        codes = {w["code"] for w in d["warnings"]}
        assert "W-META-TS" in codes
        # Each warning entry has the canonical fields
        w0 = d["warnings"][0]
        assert {"code", "severity", "detail"}.issubset(w0.keys())
    finally:
        store.clear()
