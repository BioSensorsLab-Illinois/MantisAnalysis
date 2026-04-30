"""HTTP round-trip tests for the playback presets store.

play-tab-recording-inspection-rescue-v1 M28. Atomic file writes,
GET/PUT/DELETE round-trip, mode 0600 on the persisted file, malformed
file is treated as fresh-start.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mantisanalysis.server import app


@pytest.fixture
def presets_client(tmp_path: Path, monkeypatch):
    """Spin up the FastAPI test client with the presets file pointed at
    a tmp_path location so each test gets its own clean store."""
    presets_path = tmp_path / "playback-presets.json"
    monkeypatch.setenv("MANTIS_PRESETS_PATH", str(presets_path))
    yield TestClient(app), presets_path


# ---------------------------------------------------------------------------
# GET
# ---------------------------------------------------------------------------


def test_presets_get_empty_when_file_missing(presets_client):
    client, _ = presets_client
    r = client.get("/api/playback/presets")
    assert r.status_code == 200
    assert r.json() == {"presets": []}


def test_presets_get_returns_persisted_list(presets_client):
    client, presets_path = presets_client
    presets_path.parent.mkdir(parents=True, exist_ok=True)
    presets_path.write_text(
        json.dumps(
            {
                "presets": [
                    {
                        "id": "p1",
                        "name": "high-contrast NIR",
                        "view_type": "nir_hg",
                        "fields": {"vmin": 200, "vmax": 12000, "colormap": "inferno"},
                        "created_at": 1234567890.0,
                    },
                ]
            }
        )
    )
    r = client.get("/api/playback/presets")
    assert r.status_code == 200
    body = r.json()
    assert len(body["presets"]) == 1
    p = body["presets"][0]
    assert p["id"] == "p1"
    assert p["name"] == "high-contrast NIR"
    assert p["view_type"] == "nir_hg"
    assert p["fields"]["colormap"] == "inferno"


def test_presets_get_skips_malformed_rows(presets_client):
    """One bad entry doesn't kill the whole list — it's quietly dropped."""
    client, presets_path = presets_client
    presets_path.parent.mkdir(parents=True, exist_ok=True)
    presets_path.write_text(
        json.dumps(
            {
                "presets": [
                    {"id": "good", "name": "ok", "view_type": "rgb_hg", "fields": {}},
                    {"missing-required": "yes"},
                ]
            }
        )
    )
    r = client.get("/api/playback/presets")
    assert r.status_code == 200
    ids = [p["id"] for p in r.json()["presets"]]
    assert ids == ["good"]


def test_presets_get_corrupt_file_returns_empty(presets_client):
    """Malformed JSON is treated as a fresh start."""
    client, presets_path = presets_client
    presets_path.parent.mkdir(parents=True, exist_ok=True)
    presets_path.write_text("not valid json {{{")
    r = client.get("/api/playback/presets")
    assert r.status_code == 200
    assert r.json() == {"presets": []}


# ---------------------------------------------------------------------------
# PUT
# ---------------------------------------------------------------------------


def test_presets_put_creates_file(presets_client):
    client, presets_path = presets_client
    payload = {
        "presets": [
            {
                "id": "p1",
                "name": "p1 name",
                "view_type": "rgb_hg",
                "fields": {"colormap": "viridis"},
                "created_at": 1.0,
            },
        ]
    }
    r = client.put("/api/playback/presets", json=payload)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 1}
    assert presets_path.exists()


def test_presets_put_then_get_roundtrips(presets_client):
    client, _ = presets_client
    payload = {
        "presets": [
            {
                "id": "a",
                "name": "alpha",
                "view_type": "rgb_hg",
                "fields": {"vmin": 100, "vmax": 5000},
                "created_at": 1.0,
            },
            {
                "id": "b",
                "name": "beta",
                "view_type": "nir_hg",
                "fields": {"colormap": "inferno"},
                "created_at": 2.0,
            },
        ]
    }
    client.put("/api/playback/presets", json=payload)
    r = client.get("/api/playback/presets")
    body = r.json()
    assert [p["id"] for p in body["presets"]] == ["a", "b"]
    assert body["presets"][0]["fields"]["vmin"] == 100


def test_presets_put_replaces_existing(presets_client):
    """PUT semantics: full replace, not merge."""
    client, _ = presets_client
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {
                    "id": "old",
                    "name": "to-be-removed",
                    "view_type": "rgb_hg",
                    "fields": {},
                    "created_at": 1.0,
                },
            ]
        },
    )
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {
                    "id": "new",
                    "name": "fresh",
                    "view_type": "nir_hg",
                    "fields": {},
                    "created_at": 2.0,
                },
            ]
        },
    )
    body = client.get("/api/playback/presets").json()
    assert [p["id"] for p in body["presets"]] == ["new"]


def test_presets_put_persists_mode_0600(presets_client):
    """Saved file must be readable+writable only by owner. Skipped on
    Windows where mode bits don't carry POSIX semantics."""
    client, presets_path = presets_client
    if os.name != "posix":
        pytest.skip("POSIX mode bits required")
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {"id": "x", "name": "x", "view_type": "rgb_hg", "fields": {}, "created_at": 0.0},
            ]
        },
    )
    mode = stat.S_IMODE(presets_path.stat().st_mode)
    assert mode == 0o600, f"expected mode 0600, got {oct(mode)}"


def test_presets_put_writes_pretty_json(presets_client):
    """Sanity: file is human-readable JSON, not a one-liner. Lets the
    user diff their preset file by hand if they ever care."""
    client, presets_path = presets_client
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {
                    "id": "p",
                    "name": "n",
                    "view_type": "rgb_hg",
                    "fields": {"a": 1},
                    "created_at": 0.0,
                },
            ]
        },
    )
    raw = presets_path.read_text()
    assert "\n" in raw  # not a single line
    assert "  " in raw  # indented


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


def test_presets_delete_removes_one_by_id(presets_client):
    client, _ = presets_client
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {"id": "a", "name": "a", "view_type": "rgb_hg", "fields": {}, "created_at": 1.0},
                {"id": "b", "name": "b", "view_type": "rgb_hg", "fields": {}, "created_at": 2.0},
            ]
        },
    )
    r = client.delete("/api/playback/presets/a")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 1}
    body = client.get("/api/playback/presets").json()
    assert [p["id"] for p in body["presets"]] == ["b"]


def test_presets_delete_unknown_id_is_idempotent(presets_client):
    client, _ = presets_client
    client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {
                    "id": "only",
                    "name": "only",
                    "view_type": "rgb_hg",
                    "fields": {},
                    "created_at": 1.0,
                },
            ]
        },
    )
    r = client.delete("/api/playback/presets/never-existed")
    assert r.status_code == 200
    body = client.get("/api/playback/presets").json()
    assert [p["id"] for p in body["presets"]] == ["only"]


def test_presets_delete_on_empty_store(presets_client):
    """No file at all → DELETE still 200 + count 0."""
    client, _ = presets_client
    r = client.delete("/api/playback/presets/anything")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 0}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_presets_put_rejects_missing_required_field(presets_client):
    client, _ = presets_client
    r = client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {"id": "p"},
            ]
        },
    )
    assert r.status_code == 422


def test_presets_put_accepts_arbitrary_fields_json(presets_client):
    """`fields` is opaque to the backend — any JSON-serialisable dict is fine."""
    client, _ = presets_client
    fields = {
        "colormap": "magma",
        "vmin": 100,
        "vmax": 5000,
        "invert": True,
        "isp": {"sharpen_method": "Unsharp mask", "sharpen_amount": 2.0},
        "grading": {"gain_r": 1.1, "wb_kelvin": 5500},
        "labels": {"timestamp": True, "frame": True},
        "nested": {"deeply": {"nested": [1, 2, 3]}},
    }
    r = client.put(
        "/api/playback/presets",
        json={
            "presets": [
                {
                    "id": "kitchen-sink",
                    "name": "Everything",
                    "view_type": "rgb_hg",
                    "fields": fields,
                    "created_at": 0.0,
                },
            ]
        },
    )
    assert r.status_code == 200
    body = client.get("/api/playback/presets").json()
    out = body["presets"][0]["fields"]
    assert out["isp"]["sharpen_method"] == "Unsharp mask"
    assert out["nested"]["deeply"]["nested"] == [1, 2, 3]
