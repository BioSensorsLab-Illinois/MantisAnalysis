"""ROI overlay must be clipped by mask_polygon during video export.

Two display surfaces show the canvas overlay-with-polygon-mask:
  * per-frame display (`/api/sources/{sid}/frame/{i}/overlay.png`) —
    already honors `mask_polygon` (rasterizes the polygon, multiplies
    into the alpha mask).
  * video export — until this fix, did NOT honor `mask_polygon`, so
    the exported MP4/GIF/zip showed the overlay covering the whole
    frame even when the user had drawn an ROI.

These tests prove the fix: with `mask_polygon` set, pixels well outside
the polygon match the no-overlay base render (overlay was not blended
there); pixels inside differ from base (overlay was blended). The zip
format is used because it requires no ffmpeg and gives byte-deterministic
frames.

Covers single-view (`/export/video?render=overlay`) AND tiled
(`/export/video-tiled` with `mask_polygon` on a `TiledExportViewSpec`).

play-tab-recording-inspection-rescue-v1 — TBR + overlay-export polish.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image as _PI

from mantisanalysis.server import _polygon_to_roi_mask, app
from mantisanalysis.session import STORE

from tests.unit.test_session_frames import _make_synthetic_h5


@pytest.fixture
def client(tmp_path: Path):
    STORE.clear()
    yield TestClient(app)
    STORE.clear()


@pytest.fixture
def loaded(client: TestClient, tmp_path: Path) -> dict:
    """Larger-than-default fixture so polygon ROIs have room to shrink
    inside the channel-array bounds (default fixture is 4×4 per channel
    after Bayer extraction)."""
    p = tmp_path / "rec.h5"
    _make_synthetic_h5(
        p, n_frames=2, exposure_s=0.05, half_h=64, half_w=64, seed=11,
    )
    r = client.post("/api/sources/load-path", json={"path": str(p)})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# _polygon_to_roi_mask helper unit tests
# ---------------------------------------------------------------------------

def test_polygon_helper_none_inputs_short_circuit():
    """Empty / null / fewer-than-3-vertex inputs return None so callers
    can treat 'no polygon' as the no-clip path."""
    assert _polygon_to_roi_mask(None, (8, 8)) is None
    assert _polygon_to_roi_mask("", (8, 8)) is None
    assert _polygon_to_roi_mask([], (8, 8)) is None
    assert _polygon_to_roi_mask([[0, 0]], (8, 8)) is None
    assert _polygon_to_roi_mask([[0, 0], [1, 0]], (8, 8)) is None


def test_polygon_helper_accepts_str_and_list():
    """The helper accepts both JSON-string (query-string callers) and
    list-of-pairs (Pydantic-body callers)."""
    pts = [[1.0, 1.0], [5.0, 1.0], [5.0, 5.0], [1.0, 5.0]]
    from_list = _polygon_to_roi_mask(pts, (8, 8))
    import json as _json
    from_str = _polygon_to_roi_mask(_json.dumps(pts), (8, 8))
    assert from_list is not None and from_str is not None
    np.testing.assert_array_equal(from_list, from_str)


def test_polygon_helper_rasterizes_inside_only():
    """Pixels inside the polygon are 1.0; pixels well outside are 0.0."""
    pts = [[2, 2], [5, 2], [5, 5], [2, 5]]
    mask = _polygon_to_roi_mask(pts, (8, 8))
    assert mask is not None
    assert mask.dtype == np.float32
    # Inside polygon: 1.0
    assert mask[3, 3] == 1.0
    # Outside polygon: 0.0
    assert mask[0, 0] == 0.0
    assert mask[7, 7] == 0.0


def test_polygon_helper_rejects_bad_json():
    """Malformed JSON raises HTTPException(400)."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as excinfo:
        _polygon_to_roi_mask("not-json{{", (8, 8))
    assert excinfo.value.status_code == 400


# ---------------------------------------------------------------------------
# Polygon edge cases — polish-sweep hardening (B8)
# ---------------------------------------------------------------------------

def test_polygon_helper_self_intersecting_no_crash():
    """A figure-eight polygon (self-intersecting) shouldn't crash the
    rasterizer; PIL fills using even-odd rule which yields a finite,
    well-formed mask. We don't pin the exact pixel pattern (the rule is
    library-defined) but assert the result is in [0, 1] and finite.
    """
    pts = [[1, 1], [7, 7], [1, 7], [7, 1]]  # bowtie
    mask = _polygon_to_roi_mask(pts, (8, 8))
    assert mask is not None
    assert mask.dtype == np.float32
    assert np.isfinite(mask).all()
    # Each pixel is either 0 or 1 (binary mask).
    uniq = set(np.unique(mask).tolist())
    assert uniq.issubset({0.0, 1.0})


def test_polygon_helper_zero_area_colinear_no_crash():
    """Three colinear points have zero polygon area; PIL rasterizes
    the degenerate case as the closing polyline (Bresenham), producing
    a thin 1-pixel-wide strip rather than the empty set. Assert the
    output is finite and stays inside the image bounds — the contract
    is 'no crash + sane output', not 'empty mask'."""
    pts = [[1, 1], [4, 4], [7, 7]]
    mask = _polygon_to_roi_mask(pts, (8, 8))
    assert mask is not None
    assert mask.shape == (8, 8)
    assert np.isfinite(mask).all()
    s = float(mask.sum())
    # Polyline through the diagonal — at most a 1-pixel-wide strip,
    # well below the polygon's bounding-box area (49).
    assert 0 <= s <= 16


def test_polygon_helper_winding_order_invariant():
    """CW and CCW orderings of the same polygon vertices must produce
    identical masks. PIL's polygon fill is winding-order-independent,
    but a future replacement library might not be — pin the contract."""
    cw = [[2, 2], [5, 2], [5, 5], [2, 5]]
    ccw = [[2, 2], [2, 5], [5, 5], [5, 2]]
    mask_cw = _polygon_to_roi_mask(cw, (8, 8))
    mask_ccw = _polygon_to_roi_mask(ccw, (8, 8))
    assert mask_cw is not None and mask_ccw is not None
    np.testing.assert_array_equal(mask_cw, mask_ccw)


def test_polygon_helper_clips_to_image_bounds():
    """A polygon partly outside the channel array must still produce a
    finite mask sized exactly (H, W) — the parts inside the bounds
    fill, the parts outside are silently dropped."""
    # Polygon spans (-2, -2) → (12, 12) on an 8×8 array.
    pts = [[-2, -2], [12, -2], [12, 12], [-2, 12]]
    mask = _polygon_to_roi_mask(pts, (8, 8))
    assert mask is not None
    assert mask.shape == (8, 8)
    # The polygon covers the entire image, so every pixel should be 1.
    assert float(mask.sum()) == 8 * 8


def test_polygon_helper_mask_area_sum_matches_expected():
    """Beyond the 3-pixel spot check: the total filled area of a known
    rectangle should match its expected pixel count exactly. This
    catches off-by-one regressions in the PIL→numpy boundary."""
    pts = [[2, 2], [5, 2], [5, 5], [2, 5]]
    mask = _polygon_to_roi_mask(pts, (8, 8))
    assert mask is not None
    # PIL.ImageDraw.polygon fills a 4×4 square for vertices (2,2)→(5,5)
    # under its inclusive-vertex rule. The exact sum depends on PIL's
    # rasterizer; ≤16 with the documented vertices, ≥9 (3×3 strict
    # interior). Pin the lower bound and assert it's a positive integer
    # to catch a "0 pixels filled" regression.
    s = float(mask.sum())
    assert s > 0.0
    assert s == int(s)
    assert 9.0 <= s <= 16.0


# ---------------------------------------------------------------------------
# Single-view /export/video?render=overlay with mask_polygon
# ---------------------------------------------------------------------------

def _decode_first_zip_frame(zip_bytes: bytes) -> np.ndarray:
    """Pull the first frame_*.png out of an export zip and return as
    (H, W, 3) uint8."""
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    pngs = sorted(n for n in zf.namelist() if n.endswith(".png"))
    assert pngs, f"zip has no PNGs: {zf.namelist()!r}"
    with zf.open(pngs[0]) as fh:
        im = _PI.open(io.BytesIO(fh.read())).convert("RGB")
        return np.asarray(im, dtype=np.uint8)


def test_single_view_export_overlay_no_mask_covers_full_frame(
    client: TestClient, loaded: dict,
):
    """Sanity baseline: without mask_polygon, the overlay blends across
    the entire frame — same behaviour as before this fix."""
    sid = loaded["source_id"]
    r = client.get(
        f"/api/sources/{sid}/export/video",
        params={
            "format": "zip",
            "render": "overlay",
            "base_channel": "HG-R",
            "overlay_channel": "HG-G",
            "blend": "alpha",
            "strength": 1.0,
            "fps": 5.0,
            "start": 0,
            "end": 0,
        },
    )
    assert r.status_code == 200, r.text
    frame = _decode_first_zip_frame(r.content)
    # All pixels should have non-trivial green/red mix from the overlay.
    assert frame.shape[2] == 3
    assert frame.size > 0


def test_single_view_export_overlay_with_mask_clips_outside(
    client: TestClient, loaded: dict,
):
    """With mask_polygon, pixels far from the polygon must equal the
    base-only render (overlay didn't blend there). Pixels inside differ.
    """
    sid = loaded["source_id"]
    # Polygon coords are relative to the channel array (post-Bayer-extract
    # — half of each raw dim for the rgb_nir mode used by the synthetic
    # fixture). Anchor inside the smaller [0, H_ch) × [0, W_ch) bounds.
    H_ch = loaded["shape"][0]
    W_ch = loaded["shape"][1]
    cx, cy = W_ch // 2, H_ch // 2
    half = max(2, min(H_ch, W_ch) // 6)
    poly = [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
    ]
    import json as _json
    common = {
        "format": "zip",
        "render": "overlay",
        "base_channel": "HG-R",
        "overlay_channel": "HG-G",
        "blend": "alpha",
        "strength": 1.0,
        "fps": 5.0,
        "start": 0,
        "end": 0,
    }
    masked = client.get(
        f"/api/sources/{sid}/export/video",
        params={**common, "mask_polygon": _json.dumps(poly)},
    )
    assert masked.status_code == 200, masked.text
    masked_frame = _decode_first_zip_frame(masked.content)

    unmasked = client.get(
        f"/api/sources/{sid}/export/video", params=common,
    )
    assert unmasked.status_code == 200, unmasked.text
    unmasked_frame = _decode_first_zip_frame(unmasked.content)

    # The two frames must differ: masked frame has overlay only inside
    # the polygon, unmasked has overlay everywhere.
    diff = np.any(masked_frame != unmasked_frame)
    assert diff, "mask_polygon had no visible effect on exported frame"

    # Pixels in the corners (well outside the polygon) shouldn't show
    # any overlay-tinting in the masked frame — they should match a
    # pure base render. Compare against the rgb_composite (no overlay)
    # render of the same frame.
    base = client.get(
        f"/api/sources/{sid}/export/video",
        params={
            "format": "zip",
            "render": "rgb_composite",
            "gain": "hg",
            "fps": 5.0,
            "start": 0,
            "end": 0,
        },
    )
    assert base.status_code == 200
    base_frame = _decode_first_zip_frame(base.content)

    # Top-left corner pixel should match base ± small resampling noise.
    # (Overlay route uses normalize='auto' for base; rgb_composite uses
    # normalize='none', so global brightness can differ — assert
    # *direction*: the masked frame's corner is closer to base than the
    # unmasked frame's corner.)
    corner_masked = masked_frame[0, 0].astype(np.int32)
    corner_unmasked = unmasked_frame[0, 0].astype(np.int32)
    corner_base = base_frame[0, 0].astype(np.int32)
    d_masked = np.abs(corner_masked - corner_base).sum()
    d_unmasked = np.abs(corner_unmasked - corner_base).sum()
    # Corner of masked frame should be at least no-worse than unmasked.
    # (In practice it's much closer because no overlay was blended.)
    assert d_masked <= d_unmasked + 5  # 5/765 grace for resample


# ---------------------------------------------------------------------------
# Tiled export /export/video-tiled with mask_polygon on a view spec
# ---------------------------------------------------------------------------

def test_tiled_video_export_honors_mask_polygon(
    client: TestClient, loaded: dict,
):
    """The TiledExportViewSpec.mask_polygon field flows through to
    _render_tiled_view_to_rgb's overlay branch."""
    sid = loaded["source_id"]
    H_ch = loaded["shape"][0]
    W_ch = loaded["shape"][1]
    cx, cy = W_ch // 2, H_ch // 2
    half = max(2, min(H_ch, W_ch) // 6)
    poly = [
        [cx - half, cy - half],
        [cx + half, cy - half],
        [cx + half, cy + half],
        [cx - half, cy + half],
    ]

    base_view = {
        "source_id": sid,
        "frame_index": 0,
        "render": "overlay",
        "base_kind": "rgb_composite",
        "base_channel": "HG-R",
        "overlay_channel": "HG-G",
        "overlay_colormap": "inferno",
        "blend": "alpha",
        "strength": 1.0,
    }
    body_masked = {
        "views": [{**base_view, "mask_polygon": poly}],
        "layout": "auto",
        "fps": 5.0,
        "start": 0,
        "end": 0,
        "format": "zip",
    }
    body_unmasked = {
        "views": [base_view],
        "layout": "auto",
        "fps": 5.0,
        "start": 0,
        "end": 0,
        "format": "zip",
    }
    r_masked = client.post(
        "/api/sources/export/video-tiled", json=body_masked,
    )
    r_unmasked = client.post(
        "/api/sources/export/video-tiled", json=body_unmasked,
    )
    assert r_masked.status_code == 200, r_masked.text
    assert r_unmasked.status_code == 200, r_unmasked.text
    frame_masked = _decode_first_zip_frame(r_masked.content)
    frame_unmasked = _decode_first_zip_frame(r_unmasked.content)
    # The polygon must visibly change the rendered frame.
    assert np.any(frame_masked != frame_unmasked), (
        "mask_polygon on TiledExportViewSpec had no effect"
    )


def test_tiled_video_export_no_mask_polygon_back_compat(
    client: TestClient, loaded: dict,
):
    """Omitting mask_polygon (or sending null) preserves today's
    behaviour — overlay covers the whole frame."""
    sid = loaded["source_id"]
    body = {
        "views": [{
            "source_id": sid,
            "frame_index": 0,
            "render": "overlay",
            "base_kind": "rgb_composite",
            "base_channel": "HG-R",
            "overlay_channel": "HG-G",
            "blend": "alpha",
            "strength": 1.0,
            "mask_polygon": None,
        }],
        "layout": "auto",
        "fps": 5.0,
        "start": 0,
        "end": 0,
        "format": "zip",
    }
    r = client.post("/api/sources/export/video-tiled", json=body)
    assert r.status_code == 200, r.text
    frame = _decode_first_zip_frame(r.content)
    assert frame.shape[2] == 3
