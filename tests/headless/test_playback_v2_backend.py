"""playback-rebuild-v2 — backend acceptance tests.

These are the contract for M1. They reproduce v1 failure modes that
were verified live before v1 was deleted.

Synthetic H5s are built with `_make_synth_h5` so CI without the real
dataset still runs every test except `test_real_h5_*`.
"""

from __future__ import annotations

import time
from pathlib import Path

import h5py
import numpy as np
import pytest

from mantisanalysis.playback import (
    DarkFrame,
    Event,
    EventBus,
    Library,
    View,
    Workspace,
    h5io,
)


# ---------------------------------------------------------------------------
# Real H5 dataset — present on the lab workstation, absent on CI.
# ---------------------------------------------------------------------------

REAL_H5_DIR = Path("/Users/zz4/Desktop/day5_breast_subject_1")


def _real_h5(name: str) -> Path:
    p = REAL_H5_DIR / name
    if not p.exists():
        pytest.skip(f"real H5 dataset not present at {REAL_H5_DIR}")
    return p


# ---------------------------------------------------------------------------
# Synthetic H5 fixture
# ---------------------------------------------------------------------------


def _make_synth_h5(
    path: Path,
    *,
    n_frames: int = 4,
    h: int = 32,
    w: int = 64,
    exposure_us: float = 25_000.0,
    timestamp_start: float = 1_000_000.0,
    monotonic_ts: bool = True,
    leak_sensitive: bool = True,
) -> Path:
    """Write a tiny but structurally faithful MantisCam-style H5."""

    rng = np.random.default_rng(seed=hash(path.name) & 0xFFFFFFFF)
    frames = (rng.integers(0, 2**12, size=(n_frames, h, w, 1))).astype(np.uint16)

    if monotonic_ts:
        ts = np.linspace(
            timestamp_start, timestamp_start + (n_frames - 1) * 0.033, n_frames
        )
    else:
        ts = np.array([timestamp_start + i * 0.033 for i in range(n_frames)])
        if n_frames > 2:
            ts[1], ts[2] = ts[2], ts[1]

    int_time = np.full(n_frames, exposure_us, dtype=np.float64)

    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=int_time)
        cam.create_dataset("integration-time-expected", data=int_time)
        cam.attrs["model-name"] = "Synth GSense"
        cam.attrs["fw-version"] = "v0.test"
        f.attrs["sw-version"] = "test"
        if leak_sensitive:
            f.attrs["network-info"] = '{"hostname": "secret.host"}'
            f.attrs["os-info"] = '{"hostname": "secret.host"}'
            f.attrs["hardware-info"] = '{"processor": "secret"}'
            f.attrs["python-info"] = '{"python": "x.y.z"}'
    return path


# ---------------------------------------------------------------------------
# h5io
# ---------------------------------------------------------------------------


def test_inspect_synthetic_returns_expected_meta(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "synth.h5", n_frames=5, h=16, w=32)
    meta = h5io.inspect(p)
    assert meta.n_frames == 5
    assert meta.raw_shape == (16, 32)
    assert meta.dtype == "uint16"
    assert meta.timestamps_s is not None and meta.timestamps_s.size == 5
    assert meta.integration_times_us is not None
    assert meta.exposure_min_us == meta.exposure_max_us == 25_000.0


def test_inspect_strips_sensitive_root_attrs(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "leaky.h5", leak_sensitive=True)
    meta = h5io.inspect(p)
    blocked = {"network-info", "os-info", "hardware-info", "python-info"}
    leaked = blocked & set(meta.root_attrs.keys())
    assert not leaked, f"sensitive attrs leaked: {leaked}"
    assert "sw-version" in meta.root_attrs


def test_inspect_emits_warning_on_missing_timestamp(tmp_path: Path) -> None:
    p = tmp_path / "no_ts.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset(
            "/camera/frames", data=np.zeros((2, 4, 4, 1), dtype=np.uint16)
        )
    meta = h5io.inspect(p)
    assert "W-META-TS" in meta.warnings
    assert "W-META-EXP" in meta.warnings


def test_inspect_emits_warning_on_non_monotonic_timestamps(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "disorder.h5", n_frames=4, monotonic_ts=False)
    meta = h5io.inspect(p)
    assert "W-TS-DISORDER" in meta.warnings


def test_inspect_rejects_unsupported_shape(tmp_path: Path) -> None:
    p = tmp_path / "bad.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset(
            "/camera/frames", data=np.zeros((4, 4), dtype=np.uint16)
        )
    with pytest.raises(ValueError):
        h5io.inspect(p)


def test_read_frame_returns_2d_uint16(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "synth.h5", n_frames=3, h=8, w=16)
    arr = h5io.read_frame(p, 1)
    assert arr.shape == (8, 16)
    assert arr.dtype == np.uint16


def test_read_frame_out_of_range_raises(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "synth.h5", n_frames=2)
    with pytest.raises(IndexError):
        h5io.read_frame(p, 99)


# ---------------------------------------------------------------------------
# Library
# ---------------------------------------------------------------------------


def test_register_recording_parses_structured_filename(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "sample_3_view_1_exp_0.05.h5")
    lib = Library()
    rec = lib.register_recording(p)
    assert rec.sample == 3
    assert rec.view == 1
    assert rec.exposure_s == 0.05
    assert rec.n_frames == 4
    assert rec.raw_shape == (32, 64)


def test_register_recording_unstructured_filename_yields_nones(tmp_path: Path) -> None:
    p = _make_synth_h5(tmp_path / "random_name.h5")
    lib = Library()
    rec = lib.register_recording(p)
    assert rec.sample is None
    assert rec.view is None
    assert rec.exposure_s is None


def test_library_round_trip_after_delete(tmp_path: Path) -> None:
    """v1 bug: after delete + re-add, second register orphaned.
    v2: register always returns a fresh entry visible in list_recordings.
    """
    lib = Library()
    p1 = _make_synth_h5(tmp_path / "a.h5")
    r1 = lib.register_recording(p1)
    lib.delete_recording(r1.rec_id)
    assert lib.list_recordings() == []

    p2 = _make_synth_h5(tmp_path / "b.h5")
    r2 = lib.register_recording(p2)
    assert lib.list_recordings() == [r2]
    assert r2.rec_id != r1.rec_id


# ---------------------------------------------------------------------------
# Workspace cascade rules
# ---------------------------------------------------------------------------


def _new_workspace(tmp_path: Path):
    ws = Workspace()
    p1 = _make_synth_h5(tmp_path / "rec1.h5", n_frames=10)
    p2 = _make_synth_h5(tmp_path / "rec2.h5", n_frames=20)
    r1 = ws.library.register_recording(p1)
    r2 = ws.library.register_recording(p2)
    return ws, r1, r2


def _capture_events(ws: Workspace) -> list[Event]:
    captured: list[Event] = []
    ws.events.subscribe(captured.append)
    return captured


def test_delete_recording_deletes_single_rec_stream_and_emits_event(tmp_path: Path) -> None:
    ws, r1, _ = _new_workspace(tmp_path)
    s = ws.build_stream([r1.rec_id])
    tab = ws.open_tab(s.stream_id)
    captured = _capture_events(ws)

    cascade = ws.delete_recording(r1.rec_id)

    assert cascade["deleted_streams"] == [s.stream_id]
    assert cascade["closed_tabs"] == [tab.tab_id]
    assert ws.list_streams() == []
    assert ws.list_tabs() == []
    assert ws.active_tab_id is None
    [evt] = [e for e in captured if e.type == "library.recording.deleted"]
    assert evt.payload["rec_id"] == r1.rec_id
    assert evt.payload["deleted_streams"] == [s.stream_id]
    assert evt.payload["closed_tabs"] == [tab.tab_id]


def test_delete_recording_shrinks_multi_rec_stream_and_clamps_frame(tmp_path: Path) -> None:
    ws, r1, r2 = _new_workspace(tmp_path)
    s = ws.build_stream([r1.rec_id, r2.rec_id])
    tab = ws.open_tab(s.stream_id)
    tab.active_frame = 25  # past r1+r2-1 = 29 but inside the combined range
    captured = _capture_events(ws)

    cascade = ws.delete_recording(r2.rec_id)

    assert cascade["shrunk_streams"] == [s.stream_id]
    assert cascade["deleted_streams"] == []
    assert cascade["closed_tabs"] == []
    s_now = ws.get_stream(s.stream_id)
    assert s_now.rec_ids == [r1.rec_id]
    assert ws.stream_total_frames(s.stream_id) == 10
    tab_now = ws.get_tab(tab.tab_id)
    assert tab_now.active_frame == 9, "active_frame clamped to new total - 1"
    [evt] = [e for e in captured if e.type == "library.recording.deleted"]
    assert evt.payload["shrunk_streams"] == [s.stream_id]


def test_delete_dark_clears_view_dark_refs_and_emits_event(tmp_path: Path) -> None:
    ws, r1, _ = _new_workspace(tmp_path)
    dark = DarkFrame(
        dark_id="dk_test",
        name="dark_25ms",
        exposure_s=0.025,
        n_source_frames=8,
        strategy="mean",
        master=np.zeros((32, 64), dtype=np.uint16),
    )
    ws.library.register_dark(dark)
    s = ws.build_stream([r1.rec_id])
    v = View(view_id="v_test", dark_on=True, dark_id=dark.dark_id)
    tab = ws.open_tab(s.stream_id, views=[v])
    captured = _capture_events(ws)

    cleared = ws.delete_dark(dark.dark_id)

    assert cleared == [v.view_id]
    tab_now = ws.get_tab(tab.tab_id)
    assert tab_now.views[0].dark_on is False
    assert tab_now.views[0].dark_id is None
    [evt] = [e for e in captured if e.type == "library.dark.deleted"]
    assert evt.payload["cleared_views"] == [v.view_id]


def test_register_recording_after_delete_lands_in_library(tmp_path: Path) -> None:
    ws, r1, r2 = _new_workspace(tmp_path)
    s = ws.build_stream([r1.rec_id])
    ws.open_tab(s.stream_id)
    ws.delete_recording(r1.rec_id)
    assert ws.list_streams() == []
    assert ws.list_tabs() == []

    p3 = _make_synth_h5(tmp_path / "rec3.h5", n_frames=5)
    r3 = ws.library.register_recording(p3)
    rec_ids = {r.rec_id for r in ws.library.list_recordings()}
    assert rec_ids == {r2.rec_id, r3.rec_id}, "r2 untouched, r3 added, r1 gone"
    # No implicit stream creation — explicit user action only.
    assert ws.list_streams() == []


# ---------------------------------------------------------------------------
# Real H5 dataset — perf budget + sensitive attr scrub
# ---------------------------------------------------------------------------


def test_real_h5_loads_under_2s() -> None:
    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    t0 = time.monotonic()
    meta = h5io.inspect(h5)
    elapsed = time.monotonic() - t0

    assert meta.n_frames == 10
    assert meta.raw_shape == (2048, 4096)
    assert elapsed < 2.0, f"inspect took {elapsed:.2f}s, budget 2.0s"


def test_real_h5_strips_sensitive_root_attrs() -> None:
    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    meta = h5io.inspect(h5)
    blocked = {"network-info", "os-info", "hardware-info", "python-info"}
    leaked = blocked & set(meta.root_attrs.keys())
    assert not leaked, f"sensitive attrs leaked: {leaked}"


def test_real_h5_register_via_library() -> None:
    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    lib = Library()
    rec = lib.register_recording(h5)
    assert rec.sample == 1
    assert rec.view == 0
    assert rec.exposure_s == 0.025
    assert rec.n_frames == 10
    assert rec.raw_shape == (2048, 4096)


def test_real_h5_read_frame_yields_2048x4096_uint16() -> None:
    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    arr = h5io.read_frame(h5, 0)
    assert arr.shape == (2048, 4096)
    assert arr.dtype == np.uint16
