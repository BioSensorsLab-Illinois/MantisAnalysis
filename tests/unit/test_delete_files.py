"""POST /api/sources/delete-files round-trip.

The route deletes files from disk after the frontend has shown a
confirmation dialog. These tests use temp paths and synthetic H5
fixtures so they never touch real recordings.

Hardened contract (post B-0010 polish sweep):
  * Only paths matching a registered ``LoadedSource.path`` (or its
    owned tempfile) are eligible for deletion. Untracked paths are
    rejected per-row with ``status=error``.
  * Path extension must be in the recording allow-list (.h5, .hdf5,
    .tif, .tiff, .png, .jpg, .jpeg). Other extensions are rejected.
  * The body's ``paths`` list is capped at 50 entries; oversized
    bodies fail Pydantic validation (422).
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mantisanalysis.server import app
from mantisanalysis.session import STORE, LoadedSource
from tests.unit.test_session_frames import _make_synthetic_h5


@pytest.fixture
def client(tmp_path: Path):
    STORE.clear()
    yield TestClient(app)
    STORE.clear()


def _load_h5(client: TestClient, tmp_path: Path, name: str = "rec.h5") -> tuple[Path, str]:
    p = tmp_path / name
    _make_synthetic_h5(p, n_frames=2, exposure_s=0.1)
    sid = client.post("/api/sources/load-path", json={"path": str(p)}).json()["source_id"]
    return p, sid


def test_delete_files_unlinks_a_tracked_h5(client, tmp_path):
    p, _ = _load_h5(client, tmp_path)
    assert p.exists()
    r = client.post("/api/sources/delete-files", json={"paths": [str(p)]})
    assert r.status_code == 200
    body = r.json()
    assert len(body["results"]) == 1
    assert body["results"][0]["status"] == "deleted"
    assert not p.exists()


def test_delete_files_partial_failure_other_paths_still_processed(client, tmp_path):
    good, _ = _load_h5(client, tmp_path, name="good.h5")
    missing = tmp_path / "never_existed.h5"
    direc = tmp_path / "subdir.h5"  # extension matches but it's a directory
    direc.mkdir()
    # Register the directory + missing path as sources so they pass the
    # tracked-path gate; the route should still refuse the directory and
    # report the missing path as 'missing'.
    STORE._items["dir_sid"] = LoadedSource(
        source_id="dir_sid", name="dir.h5", source_kind="h5",
        channels={}, attrs={}, shape_hw=(1, 1), path=str(direc),
    )
    STORE._items["miss_sid"] = LoadedSource(
        source_id="miss_sid", name="miss.h5", source_kind="h5",
        channels={}, attrs={}, shape_hw=(1, 1), path=str(missing),
    )
    r = client.post(
        "/api/sources/delete-files",
        json={"paths": [str(good), str(missing), str(direc)]},
    )
    assert r.status_code == 200
    rows = r.json()["results"]
    assert any(row["status"] == "deleted" for row in rows)
    assert any(row["status"] == "missing" for row in rows)
    assert any(
        row["status"] == "error" and "directory" in row.get("detail", "")
        for row in rows
    )
    assert not good.exists()
    assert direc.exists()


def test_delete_files_drops_loaded_source_first(client, tmp_path):
    """When a loaded source is bound to one of the deleted paths, the
    backend must close its frame reader and drop it from STORE before
    unlinking — otherwise on Windows the file would be held open."""
    p, sid = _load_h5(client, tmp_path)
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
    """A path that can't be resolved (e.g. NUL byte) shouldn't blow up
    the whole batch — it gets a per-row error. The good path passes
    because it's a tracked .h5; the bad path fails resolve."""
    good, _ = _load_h5(client, tmp_path)
    bad = "/tmp/with\x00nul.h5"
    r = client.post(
        "/api/sources/delete-files", json={"paths": [str(good), bad]}
    )
    assert r.status_code == 200
    statuses = [row["status"] for row in r.json()["results"]]
    assert "deleted" in statuses
    assert "error" in statuses
    assert not good.exists()


def test_delete_files_refuses_untracked_path(client, tmp_path):
    """Real .h5 file with right extension but NOT registered as a
    source — the new contract refuses to delete it."""
    p = tmp_path / "rogue.h5"
    p.write_bytes(b"\x89HDF\r\n\x1a\n" + b"\x00" * 16)  # bare HDF5 magic
    r = client.post("/api/sources/delete-files", json={"paths": [str(p)]})
    assert r.status_code == 200
    row = r.json()["results"][0]
    assert row["status"] == "error"
    assert "not tracked" in row["detail"]
    assert p.exists()


def test_delete_files_refuses_disallowed_extension(client, tmp_path):
    """A non-recording extension is refused even if (impossibly)
    tracked. Belt-and-braces: a malicious or corrupted STORE entry
    pointing at /etc/passwd cannot leak through this route."""
    p = tmp_path / "secret.txt"
    p.write_text("x")
    r = client.post("/api/sources/delete-files", json={"paths": [str(p)]})
    assert r.status_code == 200
    row = r.json()["results"][0]
    assert row["status"] == "error"
    assert "extension" in row["detail"]
    assert p.exists()


def test_delete_files_rejects_oversized_batch(client):
    """Body capped at 50 paths — Pydantic validation (422)."""
    r = client.post(
        "/api/sources/delete-files",
        json={"paths": [f"/tmp/x{i}.h5" for i in range(51)]},
    )
    assert r.status_code == 422
