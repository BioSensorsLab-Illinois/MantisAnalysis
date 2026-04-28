"""POST /api/playback/handoff round-trip."""
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


@pytest.fixture
def loaded_h5(client, tmp_path):
    p = tmp_path / "rec.h5"
    _make_synthetic_h5(p, n_frames=5, exposure_s=0.1, seed=7)
    r = client.post("/api/sources/load-path", json={"path": str(p)})
    assert r.status_code == 200, r.text
    return r.json()


def test_handoff_creates_transient_with_frame_count_1(client, loaded_h5):
    r = client.post("/api/playback/handoff", json={
        "source_id": loaded_h5["source_id"],
        "frame_index": 2,
        "target_mode": "usaf",
    })
    assert r.status_code == 200, r.text
    transient = r.json()
    assert transient["source_id"] != loaded_h5["source_id"]
    assert transient["frame_count"] == 1
    assert transient["kind"] == "image"
    # Channel set inherits from parent (modern h5 → HG/LG/HDR + Y).
    for k in ("HG-R", "HG-G", "HG-B", "LG-R", "HG-Y"):
        assert k in transient["channels"], k


def test_handoff_404_on_unknown_source(client):
    r = client.post("/api/playback/handoff", json={
        "source_id": "does-not-exist", "frame_index": 0, "target_mode": "usaf",
    })
    assert r.status_code == 404


def test_handoff_404_on_out_of_range_frame(client, loaded_h5):
    r = client.post("/api/playback/handoff", json={
        "source_id": loaded_h5["source_id"], "frame_index": 999, "target_mode": "usaf",
    })
    assert r.status_code == 404


def test_handoff_parent_stays_loaded(client, loaded_h5):
    """Parent source must remain in the store after handoff (the
    user's Play recording shouldn't disappear when they spin off
    a USAF analysis)."""
    sid = loaded_h5["source_id"]
    r = client.post("/api/playback/handoff", json={
        "source_id": sid, "frame_index": 0, "target_mode": "fpn",
    })
    assert r.status_code == 200
    list_r = client.get("/api/sources").json()
    ids = [s["source_id"] for s in list_r]
    assert sid in ids, "parent removed unexpectedly"
    assert r.json()["source_id"] in ids, "transient not registered"
    assert len(ids) == 2


def test_handoff_transient_is_independent(client, loaded_h5):
    """Removing the transient must not touch the parent."""
    sid = loaded_h5["source_id"]
    r = client.post("/api/playback/handoff", json={
        "source_id": sid, "frame_index": 1, "target_mode": "dof",
    })
    tid = r.json()["source_id"]
    client.delete(f"/api/sources/{tid}")
    assert client.get(f"/api/sources/{sid}/frames").status_code == 200
    assert client.get(f"/api/sources/{tid}").status_code == 404


def test_handoff_transient_is_pinned_against_lru(client, loaded_h5, tmp_path):
    """Polish-sweep hardening: transient handoff sources are flagged
    ``pinned=True`` so the LRU never silently boots them under
    pressure. Without this, 65 right-clicks on a 64-cap STORE would
    evict the user's actual recordings to make room for throwaways.

    Approach: temporarily shrink ``STORE._max`` to 2, load the parent
    + create one transient, then load several more H5s. Without the
    pin the transient would be the oldest entry and would be the
    first evicted; with the pin it stays.
    """
    sid = loaded_h5["source_id"]
    transient_id = client.post(
        "/api/playback/handoff",
        json={"source_id": sid, "frame_index": 0, "target_mode": "usaf"},
    ).json()["source_id"]
    # Shrink the cap so the next load triggers eviction.
    original_max = STORE._max
    try:
        STORE._max = 2  # already have parent + transient = 2
        # Load a 3rd H5 — this should evict the parent (oldest unpinned),
        # NOT the transient.
        for i in range(3):
            extra = tmp_path / f"extra{i}.h5"
            _make_synthetic_h5(extra, n_frames=2, exposure_s=0.1, seed=10 + i)
            client.post("/api/sources/load-path", json={"path": str(extra)})
        list_ids = {s["source_id"] for s in client.get("/api/sources").json()}
        assert transient_id in list_ids, (
            "pinned transient was evicted by LRU pressure"
        )
    finally:
        STORE._max = original_max
