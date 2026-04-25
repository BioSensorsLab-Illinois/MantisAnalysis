"""POST /api/sources/delete-files round-trip.

The route deletes files from disk after the frontend has shown a
confirmation dialog. These tests use temp paths so they never touch
real recordings.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mantisanalysis.server import app
from mantisanalysis.session import STORE
from tests.unit.test_session_frames import _make_synthetic_h5


@pytest.fixture
def client(tmp_path: Path):
    STORE.clear()
    yield TestClient(app)
    STORE.clear()


def test_delete_files_unlinks_a_regular_file(client, tmp_path):
    p = tmp_path / "junk.txt"
    p.write_text("dummy")
    assert p.exists()
    r = client.post("/api/sources/delete-files", json={"paths": [str(p)]})
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["status"] == "deleted"
    assert not p.exists()


def test_delete_files_partial_failure_other_paths_still_processed(client, tmp_path):
    good = tmp_path / "good.txt"
    good.write_text("x")
    missing = tmp_path / "never_existed.txt"
    direc = tmp_path / "subdir"
    direc.mkdir()
    r = client.post(
        "/api/sources/delete-files",
        json={"paths": [str(good), str(missing), str(direc)]},
    )
    assert r.status_code == 200
    out = {row["path"]: row for row in r.json()["results"]}
    # `path` in the response is the resolved absolute path.
    assert any(row["status"] == "deleted" for row in r.json()["results"])
    assert any(row["status"] == "missing" for row in r.json()["results"])
    assert any(
        row["status"] == "error" and "directory" in row.get("detail", "")
        for row in r.json()["results"]
    )
    # Good file gone; directory still there.
    assert not good.exists()
    assert direc.exists()


def test_delete_files_drops_loaded_source_first(client, tmp_path):
    """When a loaded source is bound to one of the deleted paths, the
    backend must close its frame reader and drop it from STORE before
    unlinking — otherwise on Windows the file would be held open."""
    p = tmp_path / "rec.h5"
    _make_synthetic_h5(p, n_frames=2, exposure_s=0.1)
    load = client.post("/api/sources/load-path", json={"path": str(p)}).json()
    sid = load["source_id"]
    # Source is in the store; deletion should drop it.
    r = client.post("/api/sources/delete-files", json={"paths": [str(p)]})
    assert r.status_code == 200
    statuses = [row["status"] for row in r.json()["results"]]
    assert statuses == ["deleted"]
    assert not p.exists()
    # Subsequent GET on the source 404s (dropped from STORE).
    r2 = client.get(f"/api/sources/{sid}")
    assert r2.status_code == 404


def test_delete_files_empty_list_is_a_noop(client):
    r = client.post("/api/sources/delete-files", json={"paths": []})
    assert r.status_code == 200
    assert r.json()["results"] == []


def test_delete_files_path_resolve_failure_is_per_row(client, tmp_path):
    """A path that can't be resolved (e.g. extremely deep recursion via
    symlink) shouldn't blow up the whole batch — it just gets a per-row
    error status. Use a NUL byte to force a resolve failure."""
    good = tmp_path / "ok.txt"
    good.write_text("x")
    # NUL byte is rejected by os.path.realpath on POSIX.
    bad = "/tmp/with\x00nul.txt"
    r = client.post(
        "/api/sources/delete-files", json={"paths": [str(good), bad]}
    )
    assert r.status_code == 200
    statuses = [row["status"] for row in r.json()["results"]]
    assert "deleted" in statuses
    assert "error" in statuses
    assert not good.exists()
