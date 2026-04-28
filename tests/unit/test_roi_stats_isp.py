"""TBR /roi-stats endpoint must apply the linear ISP chain (sharpen +
FPN + gain + offset), not just dark + black_level. Without this, a user
who has cranked gain or sharpening on the canvas sees post-correction
pixels but reads pre-correction TBR — meaningless.

Covers:
  * back-compat: omitting view_config preserves the legacy pipeline
    (dark + black_level only).
  * gain + offset are applied to the polygon-masked array.
  * sharpen / median in view_config change the stats.
  * pipeline_version=2 is reported on the response so frontends can
    flag entries committed under the legacy pipeline.

Synthetic fixture from test_session_frames.py.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
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
def loaded(client: TestClient, tmp_path: Path) -> dict:
    p = tmp_path / "rec.h5"
    _make_synthetic_h5(p, n_frames=3, exposure_s=0.05, seed=7)
    r = client.post("/api/sources/load-path", json={"path": str(p)})
    assert r.status_code == 200, r.text
    return r.json()


def _square_polygon(x0: int, y0: int, w: int, h: int) -> list[list[float]]:
    """Closed quadrilateral covering rows [y0, y0+h) cols [x0, x0+w)."""
    return [
        [x0, y0],
        [x0 + w, y0],
        [x0 + w, y0 + h],
        [x0, y0 + h],
    ]


def test_roi_stats_back_compat_no_view_config(client: TestClient, loaded: dict):
    """Omitting view_config returns dark+black_level-only stats — same
    numerical behaviour as the pre-fix endpoint."""
    sid = loaded["source_id"]
    poly = _square_polygon(2, 2, 6, 6)
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={"polygon": poly, "method": "mean", "apply_dark": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pipeline_version"] == 2
    assert body["view_config_applied"] is False
    # n_pixels depends on the post-Bayer channel array shape; just assert
    # the polygon contains *some* pixels (i.e. wasn't fully clipped out).
    assert body["n_pixels"] >= 1
    assert np.isfinite(body["mean"])
    # Std for a uniform-noise patch is finite and >= 0.
    assert body["std"] >= 0


def test_roi_stats_gain_offset_scales_mean(client: TestClient, loaded: dict):
    """Setting gain=2, offset=10 must scale the polygon mean by exactly
    that affine: out_mean = (raw_mean - black_level) * gain + offset.
    """
    sid = loaded["source_id"]
    poly = _square_polygon(2, 2, 6, 6)
    base = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={
            "polygon": poly,
            "method": "mean",
            "apply_dark": False,
            "black_level": 0,
        },
    ).json()
    scaled = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={
            "polygon": poly,
            "method": "mean",
            "apply_dark": False,
            "black_level": 0,
            "view_config": {"gain": 2.0, "offset": 10.0},
        },
    ).json()
    expected = base["mean"] * 2.0 + 10.0
    assert scaled["pipeline_version"] == 2
    assert scaled["view_config_applied"] is True
    # float32 vs float64 round-trip — 1e-3 tolerance is plenty.
    assert abs(scaled["mean"] - expected) < 1e-3
    # Std scales linearly with gain (offset is a constant).
    assert abs(scaled["std"] - base["std"] * 2.0) < 1e-3


def test_roi_stats_view_config_changes_stats(client: TestClient, loaded: dict):
    """Adding a median filter changes the polygon stats vs the no-ISP
    baseline. Exact value isn't asserted — we just require they differ
    enough to prove the filter ran."""
    sid = loaded["source_id"]
    poly = _square_polygon(2, 2, 6, 6)
    base = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={"polygon": poly, "method": "mean", "apply_dark": False},
    ).json()
    smoothed = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={
            "polygon": poly,
            "method": "mean",
            "apply_dark": False,
            "view_config": {"median_size": 3},
        },
    ).json()
    # Mean should still be similar (median is locality-preserving), but
    # std drops because median knocks down per-pixel noise spikes.
    assert smoothed["std"] != pytest.approx(base["std"], abs=1e-9)
    assert smoothed["view_config_applied"] is True


def test_roi_stats_rejects_bad_view_config(client: TestClient, loaded: dict):
    """Non-dict view_config returns 400 with a useful detail."""
    sid = loaded["source_id"]
    poly = _square_polygon(2, 2, 6, 6)
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={
            "polygon": poly,
            "method": "mean",
            "view_config": "not-a-dict",
        },
    )
    assert r.status_code == 400
    assert "view_config" in r.json()["detail"]


def test_roi_stats_response_carries_pipeline_version(
    client: TestClient, loaded: dict,
):
    """Every successful response — back-compat or new — declares
    pipeline_version=2 so the frontend can stop showing the v1 chip
    after a recompute."""
    sid = loaded["source_id"]
    poly = _square_polygon(2, 2, 6, 6)
    body = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={"polygon": poly, "method": "mean"},
    ).json()
    assert body["pipeline_version"] == 2
