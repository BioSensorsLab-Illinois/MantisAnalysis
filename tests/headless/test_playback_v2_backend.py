"""playback-rebuild-v2 — failing reproduction tests for the backend.

These tests are the **acceptance contract** for M1. They MUST fail at
M0 (because the backend isn't implemented yet) and MUST turn green by
the end of M1, for the right reason.

Each failure mode here was reproduced live against playback v1 before
v1 was deleted. See ExecPlan.md "Reproduced failures" for the lab notes.
"""

from __future__ import annotations

from pathlib import Path

import pytest


# Real H5 dataset the user pointed at for testing. Skip if absent so CI
# without the dataset still passes lint/import.
REAL_H5_DIR = Path("/Users/zz4/Desktop/day5_breast_subject_1")


def _real_h5(name: str) -> Path:
    p = REAL_H5_DIR / name
    if not p.exists():
        pytest.skip(f"real H5 dataset not present at {REAL_H5_DIR}")
    return p


def _new_workspace():
    """Build a fresh Library + Workspace for one test."""

    from mantisanalysis.playback import Library, Workspace

    return Library(), Workspace()


# ---------------------------------------------------------------------------
# Reproduction tests — each one is a v1 bug we will not re-introduce.
# ---------------------------------------------------------------------------


def test_delete_recording_deletes_single_rec_stream_and_emits_event() -> None:
    """v1 bug: DELETE recording flipped stream.invalidated=True but never
    deleted the stream → frontend kept showing it → frame fetch returned
    HTTP 500 → "Frame not decoded" forever.

    v2 contract: deleting a recording removes any stream that becomes
    empty, closes any tab pointing at it, and emits one
    `library.recording.deleted` event listing the cascade.
    """

    pytest.fail("M1: implement Library.delete_recording cascade + EventBus emit")


def test_delete_recording_shrinks_multi_rec_stream_and_clamps_frame() -> None:
    """v2 contract: deleting one recording from a multi-recording stream
    drops just that recording, rebuilds boundaries, clamps active_frame
    to new total_frames - 1, keeps the tab alive."""

    pytest.fail("M1: implement multi-recording shrink path")


def test_delete_dark_clears_view_dark_refs_and_emits_event() -> None:
    """v2 contract: deleting a dark frame walks every view that
    references it, sets dark_on=False + dark_id=None on each, emits one
    `library.dark.deleted` event with the cleared_views list."""

    pytest.fail("M1: implement Library.delete_dark cascade")


def test_register_recording_after_delete_lands_in_library() -> None:
    """v1 bug: after deleting recording R1 and adding R2, R2 was orphaned
    (registered but no auto-stream + no active tab pointed at it).

    v2 contract: register_recording always lands in the Library;
    no implicit stream creation. Stream creation is an explicit user
    action via POST /api/playback/streams.
    """

    pytest.fail("M1: implement Library.register_recording")


def test_real_h5_loads_under_2s() -> None:
    """v2 contract: inspecting a real MantisCam H5 (10 frames, 2048×4096)
    completes in under 2 seconds. Reads metadata only — no frame I/O."""

    import time

    from mantisanalysis.playback import h5io

    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    t0 = time.monotonic()
    meta = h5io.inspect(h5)
    elapsed = time.monotonic() - t0

    assert meta.n_frames == 10
    assert meta.raw_shape == (2048, 4096)
    assert elapsed < 2.0, f"inspect took {elapsed:.2f}s, budget 2.0s"


def test_real_h5_strips_sensitive_root_attrs() -> None:
    """Real H5s carry network-info, os-info, hardware-info, python-info
    in root attrs. v2 contract: these are stripped before any value
    leaves the inspect() boundary so the API response can't leak the
    recorder's hostname / IPs / user-agent.
    """

    from mantisanalysis.playback import h5io

    h5 = _real_h5("sample_1_view_0_exp_0.025.h5")
    meta = h5io.inspect(h5)

    blocked = {"network-info", "os-info", "hardware-info", "python-info"}
    leaked = blocked & set(meta.camera_attrs.keys())
    assert not leaked, f"sensitive attrs leaked: {leaked}"
