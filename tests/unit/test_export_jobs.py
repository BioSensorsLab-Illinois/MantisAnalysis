"""Unit tests for the multi-source export job pipeline.

Covers JobStore lifecycle (create → progress → done → result) and the
``/api/play/exports`` route surface (POST → GET poll → GET result →
DELETE cancel). Lives at ``tests/unit/`` because everything runs
in-process — no real ffmpeg required, the runner is a stub.

play-export-and-roi-fixes-v1 M4.
"""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

import mantisanalysis.export_jobs as export_jobs
from mantisanalysis.export_jobs import ExportJob, JobStore


def test_jobstore_create_and_run_to_completion():
    store = JobStore()
    try:

        def runner(job: ExportJob) -> None:
            for i in range(5):
                if job.cancel_event.is_set():
                    return
                job.current_frame = i + 1
                job.progress = (i + 1) / 5.0
                time.sleep(0.01)
            job.status = "done"
            job.progress = 1.0
            job.finished_at = time.time()

        job = store.create(kind="test", runner=runner, total_frames=5)
        # Wait for the executor to drain.
        for _ in range(100):
            time.sleep(0.02)
            if store.get(job.job_id).status == "done":
                break
        final = store.get(job.job_id)
        assert final is not None
        assert final.status == "done"
        assert final.progress == pytest.approx(1.0)
        assert final.current_frame == 5
        assert final.finished_at is not None
    finally:
        store.shutdown()


def test_jobstore_cancel_mid_run_yields_cancelled_status():
    store = JobStore()
    try:

        def runner(job: ExportJob) -> None:
            for i in range(50):
                if job.cancel_event.is_set():
                    job.status = "cancelled"
                    job.finished_at = time.time()
                    return
                job.current_frame = i + 1
                job.progress = (i + 1) / 50.0
                time.sleep(0.01)

        job = store.create(kind="test", runner=runner, total_frames=50)
        time.sleep(0.05)  # let it start
        ok = store.cancel(job.job_id)
        assert ok is True
        for _ in range(100):
            time.sleep(0.02)
            if store.get(job.job_id).status in ("cancelled", "done"):
                break
        final = store.get(job.job_id)
        assert final.status == "cancelled"
        assert final.current_frame < 50
    finally:
        store.shutdown()


def test_jobstore_cancel_after_done_returns_false():
    store = JobStore()
    try:

        def runner(job: ExportJob) -> None:
            job.status = "done"
            job.progress = 1.0
            job.finished_at = time.time()

        job = store.create(kind="test", runner=runner, total_frames=1)
        for _ in range(50):
            time.sleep(0.02)
            if store.get(job.job_id).status == "done":
                break
        # Cancel after completion is a no-op (returns False).
        assert store.cancel(job.job_id) is False
    finally:
        store.shutdown()


def test_jobstore_runner_exception_marks_error_status():
    store = JobStore()
    try:

        def bad_runner(job: ExportJob) -> None:
            raise ValueError("boom")

        job = store.create(kind="test", runner=bad_runner, total_frames=1)
        for _ in range(50):
            time.sleep(0.02)
            if store.get(job.job_id).status in ("error", "done"):
                break
        final = store.get(job.job_id)
        assert final.status == "error"
        assert "boom" in final.error
        assert final.finished_at is not None
    finally:
        store.shutdown()


def test_jobstore_public_snapshot_excludes_path():
    store = JobStore()
    try:

        def runner(job: ExportJob) -> None:
            job.status = "done"
            job.progress = 1.0
            job.finished_at = time.time()

        job = store.create(kind="test", runner=runner, total_frames=1)
        time.sleep(0.1)
        snap = store.get(job.job_id).public()
        assert "result_path" not in snap
        assert snap["job_id"] == job.job_id
        assert "has_result" in snap
        assert snap["status"] == "done"
    finally:
        store.shutdown()


# ---------------------------------------------------------------------------
# Route-level tests — POST → GET → GET /result → DELETE
# ---------------------------------------------------------------------------


@pytest.fixture
def app_client():
    from mantisanalysis.server import create_app

    app = create_app()
    return TestClient(app)


def _load_sample_source(client: TestClient) -> str:
    r = client.post("/api/sources/load-sample")
    r.raise_for_status()
    return r.json()["source_id"]


def test_play_export_post_returns_job_id_and_polls_to_done(app_client):
    sid = _load_sample_source(app_client)
    body = {
        "sources": [
            {
                "source_id": sid,
                "start": 0,
                "end": 0,
                "render": "channel",
                "channel": "HG-G",
                "colormap": "gray",
            }
        ],
        "fps": 10.0,
        "max_dim": 256,
        "crf": 28,
        "preset": "ultrafast",
        "format": "mp4",
    }
    r = app_client.post("/api/play/exports", json=body)
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert isinstance(job_id, str) and len(job_id) >= 6
    # Poll until done or timeout. Tier-2 uses synthetic 1-frame source
    # so the encode is sub-second on any dev box; 30 s ceiling is for
    # a slow CI runner.
    deadline = time.time() + 30
    final = None
    while time.time() < deadline:
        s = app_client.get(f"/api/play/exports/{job_id}").json()
        if s["status"] in ("done", "error", "cancelled"):
            final = s
            break
        time.sleep(0.1)
    assert final is not None, "job did not finish within 30 s"
    assert final["status"] == "done", final
    # Pull the bytes.
    r = app_client.get(f"/api/play/exports/{job_id}/result")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("video/mp4")
    assert len(r.content) > 100  # plausible MP4
    # MP4 magic: ftyp box near the start of the file.
    assert b"ftyp" in r.content[:64]


def test_play_export_unknown_source_returns_400_or_404(app_client):
    body = {
        "sources": [{"source_id": "doesnotexist", "render": "channel", "channel": "HG-G"}],
    }
    r = app_client.post("/api/play/exports", json=body)
    # Must be a 4xx — exact code is _must_get's choice (404).
    assert 400 <= r.status_code < 500


def test_play_export_empty_sources_rejected(app_client):
    body = {"sources": []}
    r = app_client.post("/api/play/exports", json=body)
    assert r.status_code == 400


def test_play_export_get_unknown_job_returns_404(app_client):
    r = app_client.get("/api/play/exports/notarealjob")
    assert r.status_code == 404


def test_play_export_result_before_done_returns_409(app_client):
    # Build a fake stuck-running job in the global store directly so we
    # don't have to race a real export.
    job = export_jobs.JOBS.create(
        kind="test_stuck",
        runner=lambda j: time.sleep(5),  # leaves status='running'
        total_frames=1,
    )
    # Sample once to ensure the runner has started.
    time.sleep(0.05)
    r = app_client.get(f"/api/play/exports/{job.job_id}/result")
    assert r.status_code == 409
    # Cancel to clean up.
    app_client.delete(f"/api/play/exports/{job.job_id}")


def test_play_export_delete_cancels_running_job(app_client):
    # Use a stuck runner again — we can verify cancellation flips state.
    def stuck(job: ExportJob) -> None:
        # Loop checking the cancel_event so it actually stops.
        for _ in range(500):
            if job.cancel_event.is_set():
                job.status = "cancelled"
                job.finished_at = time.time()
                return
            time.sleep(0.01)

    job = export_jobs.JOBS.create(
        kind="test_cancel",
        runner=stuck,
        total_frames=500,
    )
    time.sleep(0.05)
    r = app_client.delete(f"/api/play/exports/{job.job_id}")
    assert r.status_code == 200
    # Wait for the runner to react.
    deadline = time.time() + 5
    while time.time() < deadline:
        s = app_client.get(f"/api/play/exports/{job.job_id}").json()
        if s["status"] == "cancelled":
            return
        time.sleep(0.05)
    pytest.fail(f"job did not transition to cancelled in time: {s}")
