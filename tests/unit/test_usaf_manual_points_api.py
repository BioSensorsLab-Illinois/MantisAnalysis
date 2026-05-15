"""Regression tests for channel-scoped USAF manual extrema."""
from __future__ import annotations

from fastapi.testclient import TestClient

from mantisanalysis.server import app
from mantisanalysis.session import STORE


def test_usaf_analyze_uses_manual_points_for_matching_channel_only() -> None:
    """A manual correction on LG-G must not be reused for LG-R, and vice versa."""
    STORE.clear()
    client = TestClient(app)

    src = client.post("/api/sources/load-sample").json()
    sid = src["source_id"]
    channels = src["channels"]
    assert "HG-G" in channels
    assert "LG-G" in channels

    hg_manual = {"bar_indices": [8, 28, 48], "gap_indices": [18, 38]}
    lg_manual = {"bar_indices": [11, 31, 51], "gap_indices": [21, 41]}

    r = client.post(
        "/api/usaf/analyze",
        json={
            "source_id": sid,
            "channels": ["HG-G", "LG-G"],
            "threshold": 0.2,
            "lines": [
                {
                    "group": 2,
                    "element": 3,
                    "direction": "H",
                    "p0": [80, 80],
                    "p1": [150, 80],
                    "manual_points_by_channel": {
                        "HG-G": hg_manual,
                        "LG-G": lg_manual,
                    },
                }
            ],
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    hg = body["measurements"]["HG-G"][0]
    lg = body["measurements"]["LG-G"][0]
    assert hg["bar_indices"] == hg_manual["bar_indices"]
    assert hg["gap_indices"] == hg_manual["gap_indices"]
    assert lg["bar_indices"] == lg_manual["bar_indices"]
    assert lg["gap_indices"] == lg_manual["gap_indices"]

