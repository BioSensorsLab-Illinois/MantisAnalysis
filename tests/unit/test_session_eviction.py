"""R-0009 regression — evicted source_id returns 410 Gone (not 404)."""

from __future__ import annotations

import numpy as np

from mantisanalysis.session import LoadedSource, SessionStore


def _fake_source(sid: str) -> LoadedSource:
    return LoadedSource(
        source_id=sid,
        name="fake",
        source_kind="image",
        channels={"L": np.zeros((2, 2), dtype=np.uint8)},
        attrs={},
        shape_hw=(2, 2),
    )


def test_eviction_is_tracked():
    """Evicting a source makes was_evicted(sid) return True."""
    store = SessionStore(max_entries=2)
    # Manually push 3 sources past the cap; first should evict.
    s1, s2, s3 = _fake_source("aaa"), _fake_source("bbb"), _fake_source("ccc")
    with store._lock:
        store._items["aaa"] = s1
        store._items["bbb"] = s2
        store._items["ccc"] = s3
        store._evict_locked()
    assert store.was_evicted("aaa") is True
    assert store.was_evicted("bbb") is False  # still present
    assert store.was_evicted("ccc") is False  # still present
    assert store.was_evicted("never-existed") is False


def test_server_returns_410_for_evicted_source():
    """Through the FastAPI layer: a known-evicted id → 410, an
    unknown id → 404."""
    from fastapi.testclient import TestClient

    from mantisanalysis.server import app
    from mantisanalysis.session import STORE

    STORE.clear()
    # Spoof an eviction without actually LRU-pushing: use the internal
    # _remember_evicted_locked helper under the lock.
    with STORE._lock:
        STORE._remember_evicted_locked("evicted-id")

    client = TestClient(app)
    # Endpoints that route through _must_get — pick a read-only one.
    # Use a route that just does source lookup; the USAF measure is
    # one of the cheapest.
    r_evicted = client.post(
        "/api/usaf/measure",
        json={
            "source_id": "evicted-id",
            "channel": "L",
            "line": {"group": 2, "element": 3, "direction": "H", "p0": [0, 0], "p1": [1, 1]},
        },
    )
    assert r_evicted.status_code == 410
    assert "evicted" in r_evicted.json().get("detail", "").lower()

    r_never = client.post(
        "/api/usaf/measure",
        json={
            "source_id": "never-existed-id",
            "channel": "L",
            "line": {"group": 2, "element": 3, "direction": "H", "p0": [0, 0], "p1": [1, 1]},
        },
    )
    assert r_never.status_code == 404
    assert "unknown source" in r_never.json().get("detail", "").lower()


def test_evicted_memory_cap_trims_oldest():
    """The evicted-id ring buffer has a fixed cap; oldest drop first."""
    store = SessionStore(max_entries=1, evicted_memory=3)
    with store._lock:
        for sid in ("a", "b", "c", "d"):
            store._remember_evicted_locked(sid)
    # Cap=3 → "a" dropped, ("b","c","d") retained.
    assert store.was_evicted("a") is False
    assert store.was_evicted("b") is True
    assert store.was_evicted("c") is True
    assert store.was_evicted("d") is True
