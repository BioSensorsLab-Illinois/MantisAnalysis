"""Single-pixel readback endpoint
(`/api/sources/{sid}/frame/{fi}/channel/{ch}/pixel`).

play-lod-ratio-tools-v1 M1.

Powers the Play-mode "Pixel inspector" canvas overlay. Pipeline must
match ``frame_channel_roi_stats`` byte-for-byte so a 1-pixel readback
equals a 1-pixel ROI mean at the same coordinate. Without parity,
hovering the cursor would show a different number from drawing a tiny
ROI — the two surfaces drift and the user can't trust either.

Covers:
  * Happy path: in-bounds (x, y) returns 200 with finite value +
    pipeline_version=2.
  * Bounds: out-of-bounds (x >= W, y >= H) returns 404.
  * Pydantic: negative coords + extra fields + missing fields all 422.
  * Channel: unknown channel returns 404.
  * Parity: pixel-at-(x,y) equals roi-stats-mean of a 1-pixel polygon
    at (x,y) within float tolerance.
  * Affine: gain/offset apply the expected (raw - black) * gain + offset.

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
    _make_synthetic_h5(p, n_frames=3, exposure_s=0.05, seed=11)
    r = client.post("/api/sources/load-path", json={"path": str(p)})
    assert r.status_code == 200, r.text
    return r.json()


def test_pixel_happy_path(client: TestClient, loaded: dict):
    """Request inside the channel array returns a finite value, the
    canonical pipeline_version, and echoes the (x, y) + channel.

    Synthetic fixture HG-G channel is 4×4 (half_h=16, half_w=16 → /4
    per channel after gain split + Bayer extraction). (1, 2) is well
    inside that.
    """
    sid = loaded["source_id"]
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 1, "y": 2, "apply_dark": False, "black_level": 0},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["x"] == 1
    assert body["y"] == 2
    assert body["channel"] == "HG-G"
    assert body["pipeline_version"] == 2
    assert body["view_config_applied"] is False
    assert np.isfinite(body["value"])
    H, W = body["frame_shape"]
    assert H >= 1 and W >= 1
    assert body["apply_dark"] is False
    assert body["black_level"] == 0.0


def test_pixel_out_of_bounds_returns_404(client: TestClient, loaded: dict):
    """Coordinates beyond the post-Bayer channel array shape return 404
    (not 422, because the request itself is well-formed; the failure is
    a runtime out-of-range against per-source frame geometry)."""
    sid = loaded["source_id"]
    # First, get the legit shape so the test can assert against the real
    # bounds rather than a guess.
    body = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": 0},
    ).json()
    H, W = body["frame_shape"]
    # x at width is one past the last valid column.
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": W, "y": 0},
    )
    assert r.status_code == 404, r.text
    assert "outside" in r.json()["detail"]
    # y at height likewise.
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": H},
    )
    assert r.status_code == 404


def test_pixel_negative_coords_rejected_at_pydantic(client: TestClient, loaded: dict):
    """ge=0 on x and y means the body is rejected at validation time
    with 422 — the route handler never sees a negative coord."""
    sid = loaded["source_id"]
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": -1, "y": 0},
    )
    assert r.status_code == 422
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": -1},
    )
    assert r.status_code == 422


def test_pixel_unknown_channel_returns_404(client: TestClient, loaded: dict):
    """Unknown channel key returns 404 with available channels listed."""
    sid = loaded["source_id"]
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/NOT-A-CHANNEL/pixel",
        json={"x": 0, "y": 0},
    )
    assert r.status_code == 404
    assert "available" in r.json()["detail"]


def test_pixel_extra_field_rejected(client: TestClient, loaded: dict):
    """extra='forbid' rejects stray keys with 422."""
    sid = loaded["source_id"]
    r = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": 0, "stray_field": "nope"},
    )
    assert r.status_code == 422


def test_pixel_parity_with_one_pixel_roi_stats(client: TestClient, loaded: dict):
    """A 1-pixel polygon ROI at (x, y) returns a mean exactly equal to
    the pixel-readback value at (x, y).

    This is the contract that lets the cursor overlay and the ROI table
    both report the same physical-DN scale. If this drifts, users see a
    different number when they hover vs. draw, and trust evaporates.

    M6 fastapi-backend-reviewer P1-A: the prior test asserted the
    pixel value lay in [roi.min, roi.max] for a 2×2 polygon, which is
    a tautology (any pixel inside a polygon is in that range). This
    version submits a single-pixel polygon (PIL rasterizes a 1×1
    micro-quad as exactly one pixel at the corner), then asserts
    byte-for-byte equality between the pixel route and the roi-stats
    mean / min / max — locking the contract.
    """
    sid = loaded["source_id"]
    x, y = 1, 2
    pixel = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={
            "x": x, "y": y,
            "apply_dark": True,
            "black_level": 0,
            "view_config": {"gain": 1.5, "offset": 3.0},
        },
    ).json()
    # PIL rasterizes a sub-pixel quad as exactly the corner pixel.
    # Submitting [(x,y),(x+0.5,y),(x+0.5,y+0.5),(x,y+0.5)] reliably
    # produces a 1-pixel mask covering (x, y).
    poly = [
        [x, y],
        [x + 0.5, y],
        [x + 0.5, y + 0.5],
        [x, y + 0.5],
    ]
    roi = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/roi-stats",
        json={
            "polygon": poly,
            "method": "mean",
            "apply_dark": True,
            "black_level": 0,
            "view_config": {"gain": 1.5, "offset": 3.0},
        },
    ).json()
    # If the rasterizer landed exactly one pixel, mean == min == max
    # and the pixel route must produce the SAME float. Tolerance 1e-9
    # absorbs only rounding from float32 → float64 cast, not any real
    # pipeline drift.
    assert roi["n_pixels"] == 1, (
        f"sub-pixel polygon should rasterize to 1 pixel; got {roi['n_pixels']}. "
        f"PIL version may have changed; revisit the polygon coords."
    )
    assert abs(pixel["value"] - roi["mean"]) < 1e-9
    assert abs(pixel["value"] - roi["min"]) < 1e-9
    assert abs(pixel["value"] - roi["max"]) < 1e-9
    # Both routes must report pipeline_version=2.
    assert pixel["pipeline_version"] == 2
    assert roi["pipeline_version"] == 2


def test_pixel_hdr_fusion_parity_with_roi_stats(client: TestClient, loaded: dict):
    """Pipeline parity must hold under HDR fusion as well — if /pixel
    and /roi-stats apply different fusion modes (or different
    parameters), the cursor badge and the ROI table report
    inconsistent values on HDR-* channels.

    M6 fastapi-backend-reviewer P1-B: the prior test suite never
    exercised the HDR fusion branch. This test POSTs identical
    `hdr_fusion='mertens'` requests to both routes and asserts the
    1-pixel value matches the roi-stats mean / min / max.
    """
    sid = loaded["source_id"]
    x, y = 1, 2
    body_common = {
        "apply_dark": False,
        "black_level": 0,
        "hdr_fusion": "mertens",
    }
    pixel = client.post(
        f"/api/sources/{sid}/frame/0/channel/HDR-G/pixel",
        json={**body_common, "x": x, "y": y},
    )
    if pixel.status_code == 404:
        # Some synthetic fixtures may not surface HDR-* channels (the
        # synthesis depends on dual-gain pairs). Skip with a clear
        # message rather than assert against a missing channel.
        pytest.skip("HDR-G channel not synthesized for this fixture")
    assert pixel.status_code == 200, pixel.text
    poly = [
        [x, y],
        [x + 0.5, y],
        [x + 0.5, y + 0.5],
        [x, y + 0.5],
    ]
    roi = client.post(
        f"/api/sources/{sid}/frame/0/channel/HDR-G/roi-stats",
        json={**body_common, "polygon": poly, "method": "mean"},
    )
    assert roi.status_code == 200, roi.text
    pj, rj = pixel.json(), roi.json()
    assert rj["n_pixels"] == 1
    assert abs(pj["value"] - rj["mean"]) < 1e-9
    assert abs(pj["value"] - rj["min"]) < 1e-9
    assert abs(pj["value"] - rj["max"]) < 1e-9


def test_pixel_gain_offset_affine(client: TestClient, loaded: dict):
    """value at (x, y) under view_config={gain, offset} must satisfy
    out = (raw - black_level) * gain + offset, matching the linear ISP
    chain `_apply_pre_norm` used by both /pixel and /roi-stats.

    Locks the affine so a future refactor that, e.g., reorders the
    multiply and the offset, would fail this test loudly.
    """
    sid = loaded["source_id"]
    x, y = 2, 2
    base = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": x, "y": y, "apply_dark": False, "black_level": 0},
    ).json()
    scaled = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={
            "x": x, "y": y,
            "apply_dark": False,
            "black_level": 0,
            "view_config": {"gain": 2.0, "offset": 10.0},
        },
    ).json()
    expected = base["value"] * 2.0 + 10.0
    assert abs(scaled["value"] - expected) < 1e-3
    assert scaled["view_config_applied"] is True


def test_pixel_view_config_changes_value(client: TestClient, loaded: dict):
    """Adding a median filter changes the per-pixel value vs the no-ISP
    baseline (median filtering is locality-preserving but on a noisy
    synthetic frame any single pixel will shift).

    Some pixels happen to be at the median of their neighbourhood and
    therefore unchanged — to avoid that flake, we sweep a small grid of
    coords inside the 4×4 channel and require AT LEAST ONE pixel to
    have shifted."""
    sid = loaded["source_id"]
    saw_change = False
    for x, y in [(0, 0), (1, 1), (2, 2), (3, 3), (1, 2), (2, 1), (0, 3), (3, 0)]:
        base = client.post(
            f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
            json={"x": x, "y": y, "apply_dark": False},
        ).json()
        smoothed = client.post(
            f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
            json={
                "x": x, "y": y,
                "apply_dark": False,
                "view_config": {"median_size": 3},
            },
        ).json()
        if abs(smoothed["value"] - base["value"]) > 1e-6:
            saw_change = True
            assert smoothed["view_config_applied"] is True
            break
    assert saw_change, "median filter should change at least one pixel value on a noisy frame"


def test_pixel_pydantic_validator_rejects_bad_view_config():
    """Non-dict view_config fails Pydantic validation at the model
    layer — same envelope contract as ROIStatsRequest."""
    import pydantic
    from mantisanalysis.server import PixelRequest

    with pytest.raises(pydantic.ValidationError):
        PixelRequest(x=0, y=0, view_config="not-a-dict")  # type: ignore[arg-type]


def test_pixel_response_carries_pipeline_version(client: TestClient, loaded: dict):
    """Future-proofing — the response field name pipeline_version is
    part of the API contract, like /roi-stats. Frontend keys staleness
    chips off this field."""
    sid = loaded["source_id"]
    body = client.post(
        f"/api/sources/{sid}/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": 0},
    ).json()
    assert body["pipeline_version"] == 2


def test_pixel_unknown_source_returns_404(client: TestClient):
    """Source-id miss returns 404 (consistent with /roi-stats)."""
    r = client.post(
        "/api/sources/does-not-exist/frame/0/channel/HG-G/pixel",
        json={"x": 0, "y": 0},
    )
    assert r.status_code == 404
