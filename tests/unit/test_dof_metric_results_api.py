from __future__ import annotations

from fastapi.testclient import TestClient

from mantisanalysis.dof_analysis import FOCUS_METRICS
from mantisanalysis.server import app
from mantisanalysis.session import STORE


def test_dof_analyze_all_metrics_returns_full_metric_snapshots():
    STORE.clear()
    client = TestClient(app)
    src = client.post("/api/sources/load-sample").json()
    sid = src["source_id"]
    ch = "HG-G" if "HG-G" in src["channels"] else src["channels"][0]

    r = client.post(
        "/api/dof/analyze",
        json={
            "source_id": sid,
            "channels": [ch],
            "points": [{"x": 80, "y": 80, "label": "a"}],
            "lines": [{"p0": [40, 120], "p1": [300, 120]}],
            "metric": "tenengrad",
            "half_window": 16,
            "threshold": 0.5,
            "compute_all_metrics": True,
            "bootstrap": False,
            "fit_tilt_plane": False,
            "include_pngs": False,
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body["metric_results"]) == set(FOCUS_METRICS)
    assert body["settings"]["metric"] == "tenengrad"
    assert body["results"][ch]["metric"] == "tenengrad"

    for metric in FOCUS_METRICS:
        snap = body["metric_results"][metric]
        assert snap["settings"]["metric"] == metric
        assert snap["results"][ch]["metric"] == metric
        line = snap["results"][ch]["lines"][0]
        assert "gaussian" in line
        assert "intensity_profile" in line
        assert "profile_contrast_norm" in line
        assert set(line["metric_sweep"]) == set(FOCUS_METRICS)


def test_dof_analyze_single_metric_omits_metric_snapshots():
    STORE.clear()
    client = TestClient(app)
    src = client.post("/api/sources/load-sample").json()
    sid = src["source_id"]
    ch = "HG-G" if "HG-G" in src["channels"] else src["channels"][0]

    r = client.post(
        "/api/dof/analyze",
        json={
            "source_id": sid,
            "channels": [ch],
            "points": [],
            "lines": [{"p0": [40, 120], "p1": [300, 120]}],
            "metric": "laplacian",
            "compute_all_metrics": False,
            "include_pngs": False,
        },
    )

    assert r.status_code == 200, r.text
    body = r.json()
    assert "metric_results" not in body
    assert body["results"][ch]["metric"] == "laplacian"
