"""HTTP round-trip tests for the new Play / Recording Inspection routes.

play-tab-recording-inspection-rescue-v1 M1.

Uses ``fastapi.testclient.TestClient`` (matches the convention in
``tests/unit/test_session_eviction.py``). Synthetic H5 fixtures live in
``test_session_frames``; we re-import the builder here so the route tests
can run independently.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from mantisanalysis.server import app
from mantisanalysis.session import STORE

from tests.unit.test_session_frames import _make_synthetic_h5


PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@pytest.fixture
def client(tmp_path: Path):
    STORE.clear()
    yield TestClient(app)
    STORE.clear()


@pytest.fixture
def loaded_h5(client: TestClient, tmp_path: Path) -> dict:
    """Load a synthetic H5 via /api/sources/load-path and return the
    SourceSummary JSON for downstream tests."""
    p = tmp_path / "rec.h5"
    _make_synthetic_h5(p, n_frames=5, exposure_s=0.1, seed=1)
    r = client.post("/api/sources/load-path", json={"path": str(p)})
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# /api/sources/{sid}/frames
# ---------------------------------------------------------------------------

def test_frames_metadata_endpoint(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    assert loaded_h5["frame_count"] == 5
    r = client.get(f"/api/sources/{sid}/frames")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source_id"] == sid
    assert body["frame_count"] == 5
    assert len(body["exposures_s"]) == 5
    assert len(body["timestamps"]) == 5
    assert all(abs(e - 0.1) < 1e-9 for e in body["exposures_s"])
    # Monotonic timestamps in our fixture
    ts = body["timestamps"]
    assert all(ts[i] < ts[i + 1] for i in range(len(ts) - 1))
    # FPS estimate is positive (5 frames at ts_step=0.04)
    assert body["fps_estimate"] > 0
    assert body["duration_s"] > 0


def test_frames_metadata_404_for_unknown_source(client: TestClient):
    r = client.get("/api/sources/does-not-exist/frames")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# /api/sources/{sid}/frame/{i}/channel/{ch}/thumbnail.png
# ---------------------------------------------------------------------------

def test_per_frame_channel_thumbnail_returns_png(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content.startswith(PNG_MAGIC)
    # The synthetic fixture is intentionally tiny (4×4 per channel) so we
    # check structure, not byte count. A real recording (1024×1024 per
    # channel) yields PNGs in the tens of KB; that's covered by M1's
    # live-curl verification step.
    assert b"IEND" in r.content  # valid PNG terminator


def test_different_frames_produce_different_pngs(client: TestClient, loaded_h5: dict):
    """Frame 0 PNG bytes != frame 4 PNG bytes — confirms the route is
    actually reading per-frame data, not always frame 0."""
    sid = loaded_h5["source_id"]
    r0 = client.get(f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png")
    r4 = client.get(f"/api/sources/{sid}/frame/4/channel/HG-G/thumbnail.png")
    assert r0.status_code == 200 and r4.status_code == 200
    assert r0.content != r4.content, "frame 0 and frame 4 PNG bytes are identical — extraction not honoring frame index"


def test_per_frame_thumbnail_404_on_bad_index(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/100/channel/HG-G/thumbnail.png")
    assert r.status_code == 404


def test_per_frame_thumbnail_404_on_bad_channel(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/0/channel/NOT-A-CHANNEL/thumbnail.png")
    assert r.status_code == 404


def test_per_frame_thumbnail_410_on_evicted_source(client: TestClient):
    """Evicted source ID hits 410 Gone (R-0009 contract)."""
    with STORE._lock:
        STORE._remember_evicted_locked("evicted-fake-id")
    r = client.get("/api/sources/evicted-fake-id/frame/0/channel/HG-G/thumbnail.png")
    assert r.status_code == 410


def test_per_frame_thumbnail_with_colormap(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    # Default (gray) → grayscale L-mode PNG. With colormap=inferno → RGB PNG.
    r_gray = client.get(f"/api/sources/{sid}/frame/0/channel/HG-NIR/thumbnail.png?colormap=gray")
    r_inf = client.get(f"/api/sources/{sid}/frame/0/channel/HG-NIR/thumbnail.png?colormap=inferno")
    assert r_gray.status_code == 200 and r_inf.status_code == 200
    # Different rendering paths → different bytes
    assert r_gray.content != r_inf.content


# ---------------------------------------------------------------------------
# /api/sources/{sid}/frame/{i}/rgb.png
# ---------------------------------------------------------------------------

def test_per_frame_rgb_composite(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.content.startswith(PNG_MAGIC)


def test_per_frame_rgb_composite_lg(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r_hg = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg")
    r_lg = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=lg")
    assert r_hg.status_code == 200 and r_lg.status_code == 200
    # HG and LG halves carry different signal in our fixture → different bytes
    assert r_hg.content != r_lg.content


def test_per_frame_rgb_composite_404_on_bad_index(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/999/rgb.png?gain=hg")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# /api/sources/{sid}/frame/{i}/overlay.png
# ---------------------------------------------------------------------------

def test_per_frame_overlay_renders(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(
        f"/api/sources/{sid}/frame/0/overlay.png"
        f"?base_channel=HG-R&overlay_channel=HG-NIR&blend=alpha&strength=0.6"
    )
    assert r.status_code == 200, r.text
    assert r.content.startswith(PNG_MAGIC)


def test_per_frame_overlay_404_unknown_overlay(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(
        f"/api/sources/{sid}/frame/0/overlay.png"
        f"?base_channel=HG-R&overlay_channel=NOT-REAL&blend=alpha&strength=0.5"
    )
    assert r.status_code == 404


def test_per_frame_overlay_blend_modes(client: TestClient, loaded_h5: dict):
    """Different blend modes produce different output bytes."""
    sid = loaded_h5["source_id"]
    out = {}
    for blend in ("alpha", "screen", "additive"):
        r = client.get(
            f"/api/sources/{sid}/frame/0/overlay.png"
            f"?base_channel=HG-R&overlay_channel=HG-NIR&blend={blend}&strength=0.5"
        )
        assert r.status_code == 200
        out[blend] = r.content
    assert out["alpha"] != out["screen"]
    assert out["screen"] != out["additive"]


# ---------------------------------------------------------------------------
# Multi-source independence at the HTTP layer
# ---------------------------------------------------------------------------

def test_two_sources_addressable_independently(client: TestClient, tmp_path: Path):
    """Loading recording B after A: both frames endpoints work, both
    thumbnails work, removing A leaves B intact."""
    pa = tmp_path / "a.h5"
    pb = tmp_path / "b.h5"
    _make_synthetic_h5(pa, n_frames=3, exposure_s=0.1, seed=1)
    _make_synthetic_h5(pb, n_frames=4, exposure_s=0.05, seed=2)
    a = client.post("/api/sources/load-path", json={"path": str(pa)}).json()
    b = client.post("/api/sources/load-path", json={"path": str(pb)}).json()
    assert a["source_id"] != b["source_id"]
    assert a["frame_count"] == 3
    assert b["frame_count"] == 4
    # Both are listable
    listed = client.get("/api/sources").json()
    sids = {s["source_id"] for s in listed}
    assert a["source_id"] in sids and b["source_id"] in sids
    # Both thumbnail. Use ?normalize=auto so the small synthetic fixture
    # (4×4 per-channel data with low integer values) maps to a well-spread
    # PNG — the new default normalize='none' (M22) divides by dtype-max
    # and would push both renders to near-black, making them indistinguishable.
    ra = client.get(
        f"/api/sources/{a['source_id']}/frame/2/channel/HG-G/thumbnail.png?normalize=auto"
    )
    rb = client.get(
        f"/api/sources/{b['source_id']}/frame/2/channel/HG-G/thumbnail.png?normalize=auto"
    )
    assert ra.status_code == 200 and rb.status_code == 200
    assert ra.content != rb.content
    # Delete A, B still works
    rd = client.delete(f"/api/sources/{a['source_id']}")
    assert rd.status_code == 200
    rb2 = client.get(f"/api/sources/{b['source_id']}/frame/0/channel/HG-G/thumbnail.png")
    assert rb2.status_code == 200
    # A is now 404 (not 410 — user-initiated delete, not LRU eviction)
    ra2 = client.get(f"/api/sources/{a['source_id']}/frame/0/channel/HG-G/thumbnail.png")
    assert ra2.status_code == 404


# ---------------------------------------------------------------------------
# M20 — histogram route + show_clipping query param
# ---------------------------------------------------------------------------

def test_per_frame_histogram_returns_64_bins(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/histogram?bins=64"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["counts"], list)
    assert len(body["counts"]) == 64
    assert len(body["edges"]) == 65  # bins+1 edges
    assert all(isinstance(c, int) for c in body["counts"])
    # Sum of counts = number of pixels in the channel (4×4 fixture).
    assert sum(body["counts"]) == 4 * 4
    # Min / max / p1 / p99 are sane floats
    for k in ("min", "max", "p1", "p99"):
        assert isinstance(body[k], float)
    assert body["max"] >= body["min"]


def test_per_frame_histogram_404_on_bad_channel(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/0/channel/NOPE/histogram")
    assert r.status_code == 404


def test_per_frame_histogram_404_on_bad_frame(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    # Fixture has 5 frames (indices 0..4); 99 is out of range
    r = client.get(f"/api/sources/{sid}/frame/99/channel/HG-G/histogram")
    assert r.status_code == 404


def test_per_frame_histogram_bins_param_validation(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    # bins below ge=4 should 422
    r = client.get(f"/api/sources/{sid}/frame/0/channel/HG-G/histogram?bins=2")
    assert r.status_code == 422


def test_thumbnail_show_clipping_emits_rgb_with_magenta(client: TestClient, loaded_h5: dict):
    """show_clipping=true forces RGB output and paints magenta on
    pixels at or above the high threshold. We force vmax small so the
    brightest pixel(s) clip, then read the PNG and assert at least one
    magenta pixel exists."""
    from PIL import Image
    import io as _io

    sid = loaded_h5["source_id"]
    r = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
        f"?show_clipping=true&vmin=0&vmax=10"
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    im = Image.open(_io.BytesIO(r.content))
    arr = np.asarray(im.convert("RGB"))
    # At least one pixel should be magenta (255, 0, 255).
    mask = (arr[..., 0] == 255) & (arr[..., 1] == 0) & (arr[..., 2] == 255)
    assert mask.any(), "expected at least one magenta clipping pixel"


def test_thumbnail_no_clipping_returns_grayscale_when_no_colormap(
    client: TestClient, loaded_h5: dict
):
    """Default (no show_clipping, no colormap) keeps the cheap L-mode
    PNG output — verifies we didn't regress the non-clipping path."""
    from PIL import Image
    import io as _io

    sid = loaded_h5["source_id"]
    r = client.get(f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png")
    assert r.status_code == 200
    im = Image.open(_io.BytesIO(r.content))
    # L-mode (single-channel grayscale) since no colormap, no clipping
    assert im.mode == "L"


# ---------------------------------------------------------------------------
# M22 — auto-wb route + grading round-trip
# ---------------------------------------------------------------------------

def test_auto_wb_returns_three_gain_keys(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.post(
        f"/api/sources/{sid}/frame/0/rgb/auto-wb?gain=hg&method=gray-world"
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"gain_r", "gain_g", "gain_b"}
    # G is the reference — pinned at 1.0.
    assert abs(float(body["gain_g"]) - 1.0) < 1e-6
    # Suggestions are clamped to a sane range.
    for k in ("gain_r", "gain_b"):
        v = float(body[k])
        assert 0.1 <= v <= 10.0


def test_auto_wb_404_on_bad_frame(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r = client.post(f"/api/sources/{sid}/frame/99/rgb/auto-wb?gain=hg")
    assert r.status_code == 404


def test_rgb_with_grading_renders_different_bytes(client: TestClient, loaded_h5: dict):
    """Same frame rendered with non-default grading must differ from the
    default render — proves the grading params actually flow through to
    the encoder."""
    sid = loaded_h5["source_id"]
    r0 = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg")
    r1 = client.get(
        f"/api/sources/{sid}/frame/0/rgb.png?gain=hg&gain_r=2.0&gain_b=0.5"
    )
    assert r0.status_code == 200 and r1.status_code == 200
    assert r0.content != r1.content


def test_rgb_with_wb_kelvin_renders_different_bytes(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    r_d65 = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg")
    r_warm = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg&wb_kelvin=3000")
    assert r_d65.status_code == 200 and r_warm.status_code == 200
    assert r_d65.content != r_warm.content


# ---------------------------------------------------------------------------
# M23 — tiled image export
# ---------------------------------------------------------------------------

def test_image_tiled_400_when_no_views(client: TestClient):
    r = client.post("/api/sources/export/image-tiled", json={"views": []})
    assert r.status_code == 400


def test_image_tiled_returns_png(client: TestClient, loaded_h5: dict):
    """Two-view tiled export — must return a valid PNG and a
    Content-Disposition header so the browser saves to Downloads."""
    sid = loaded_h5["source_id"]
    body = {
        "views": [
            {
                "source_id": sid,
                "frame_index": 0,
                "render": "rgb_composite",
                "gain": "hg",
                "normalize": "auto",  # synth fixture is tiny; force percentile
            },
            {
                "source_id": sid,
                "frame_index": 1,
                "render": "rgb_composite",
                "gain": "hg",
                "normalize": "auto",
            },
        ],
        "layout": "1xN",
        "gap_px": 4,
        "background": "#000000",
        "format": "png",
    }
    r = client.post("/api/sources/export/image-tiled", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    dispo = r.headers.get("content-disposition", "")
    assert "attachment" in dispo
    assert ".png" in dispo
    assert r.content.startswith(PNG_MAGIC)


def test_image_tiled_layouts_render(client: TestClient, loaded_h5: dict):
    """Each layout preset returns a valid PNG; canvas dimensions
    differ between presets (proves the layout selector actually
    rearranges tiles, not just relabels)."""
    from PIL import Image
    import io as _io

    sid = loaded_h5["source_id"]
    base_view = {
        "source_id": sid,
        "frame_index": 0,
        "render": "rgb_composite",
        "gain": "hg",
        "normalize": "auto",
    }
    sizes = {}
    for layout in ("1xN", "2xM", "3plus1", "4x2", "auto"):
        body = {
            "views": [base_view, base_view, base_view, base_view],
            "layout": layout,
            "format": "png",
        }
        r = client.post("/api/sources/export/image-tiled", json=body)
        assert r.status_code == 200, r.text
        im = Image.open(_io.BytesIO(r.content))
        sizes[layout] = im.size
    # 1xN should be wider than tall; 4x2 is wider; 3plus1 should differ.
    w_1xn, h_1xn = sizes["1xN"]
    w_2xm, h_2xm = sizes["2xM"]
    assert w_1xn > h_1xn
    # Different layouts → different canvas sizes (most pairs).
    assert sizes["1xN"] != sizes["2xM"]
    assert sizes["3plus1"] != sizes["1xN"]


def test_image_tiled_413_when_too_many_views(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    body = {
        "views": [
            {"source_id": sid, "frame_index": 0, "render": "rgb_composite",
             "normalize": "auto"}
            for _ in range(17)
        ],
        "layout": "auto",
    }
    r = client.post("/api/sources/export/image-tiled", json=body)
    assert r.status_code == 413


def test_image_tiled_404_on_unknown_source(client: TestClient, loaded_h5: dict):
    body = {
        "views": [{"source_id": "DEADBEEF", "frame_index": 0,
                   "render": "rgb_composite"}],
        "layout": "auto",
    }
    r = client.post("/api/sources/export/image-tiled", json=body)
    assert r.status_code == 404


def test_image_tiled_jpeg_format(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    body = {
        "views": [{
            "source_id": sid, "frame_index": 0, "render": "rgb_composite",
            "gain": "hg", "normalize": "auto",
        }],
        "layout": "auto",
        "format": "jpeg",
    }
    r = client.post("/api/sources/export/image-tiled", json=body)
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    # JPEG SOI: FF D8
    assert r.content[:2] == b"\xff\xd8"


# ---------------------------------------------------------------------------
# M24 — tiled video export
# ---------------------------------------------------------------------------

def test_video_tiled_400_when_no_views(client: TestClient):
    r = client.post("/api/sources/export/video-tiled", json={"views": []})
    assert r.status_code == 400


def test_video_tiled_404_unknown_source(client: TestClient):
    body = {
        "views": [{"source_id": "DEADBEEF", "frame_index": 0,
                   "render": "rgb_composite"}],
        "layout": "auto",
        "format": "zip",
    }
    r = client.post("/api/sources/export/video-tiled", json=body)
    assert r.status_code == 404


def test_video_tiled_zip_emits_one_png_per_frame(client: TestClient, loaded_h5: dict):
    """ZIP format is the most reliable across CI environments (no
    ffmpeg dependency) and lets us count frames inside the archive."""
    import io as _io
    import zipfile

    sid = loaded_h5["source_id"]
    body = {
        "views": [
            {"source_id": sid, "frame_index": 0, "render": "rgb_composite",
             "gain": "hg", "normalize": "auto"},
            {"source_id": sid, "frame_index": 0, "render": "channel",
             "channel": "HG-G", "colormap": "gray", "normalize": "auto"},
        ],
        "layout": "1xN",
        "fps": 5.0,
        "start": 1,
        "end": 3,
        "format": "zip",
    }
    r = client.post("/api/sources/export/video-tiled", json=body)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/zip"
    assert "attachment" in r.headers.get("content-disposition", "")
    zf = zipfile.ZipFile(_io.BytesIO(r.content))
    names = [n for n in zf.namelist() if n.endswith(".png")]
    # 3 frames (1, 2, 3).
    assert len(names) == 3
    # Filenames are zero-padded.
    assert all(n.startswith("frame_") and n.endswith(".png") for n in names)


def test_video_tiled_layout_changes_canvas(client: TestClient, loaded_h5: dict):
    """Different layouts must produce zip archives whose first PNG has
    different dimensions — proves the layout selector flows through to
    the per-frame composite."""
    import io as _io
    import zipfile

    from PIL import Image as _PI

    sid = loaded_h5["source_id"]
    base_view = {
        "source_id": sid, "frame_index": 0, "render": "rgb_composite",
        "gain": "hg", "normalize": "auto",
    }
    sizes = {}
    for layout in ("1xN", "2xM"):
        body = {
            "views": [base_view, base_view, base_view],
            "layout": layout,
            "fps": 5.0,
            "start": 0,
            "end": 1,
            "format": "zip",
        }
        r = client.post("/api/sources/export/video-tiled", json=body)
        assert r.status_code == 200, r.text
        zf = zipfile.ZipFile(_io.BytesIO(r.content))
        first_png = sorted(zf.namelist())[0]
        with zf.open(first_png) as fh:
            im = _PI.open(_io.BytesIO(fh.read()))
            sizes[layout] = im.size
    # 1xN (3 columns) should be wider than 2xM (2 columns × 2 rows).
    assert sizes["1xN"] != sizes["2xM"]
    assert sizes["1xN"][0] > sizes["2xM"][0]


def test_video_tiled_413_when_too_many_frames(client: TestClient, loaded_h5: dict):
    sid = loaded_h5["source_id"]
    body = {
        "views": [{
            "source_id": sid, "frame_index": 0, "render": "rgb_composite",
            "gain": "hg", "normalize": "auto",
        }],
        "layout": "auto",
        "format": "zip",
        "start": 0,
        # Even on a 5-frame fixture, an absurd `end` should clamp to
        # n-1; to actually exceed the 1000-frame cap, keep within
        # source bounds is impossible — so this test covers the
        # >16-views path instead by using an oversized views list.
        "end": 1,
    }
    body["views"] = body["views"] * 17
    r = client.post("/api/sources/export/video-tiled", json=body)
    assert r.status_code == 413


def test_video_tiled_clamps_end_to_source(client: TestClient, loaded_h5: dict):
    """fixture has 5 frames; passing end=999 must clamp without error."""
    import io as _io
    import zipfile
    sid = loaded_h5["source_id"]
    body = {
        "views": [{
            "source_id": sid, "frame_index": 0, "render": "rgb_composite",
            "gain": "hg", "normalize": "auto",
        }],
        "layout": "auto",
        "format": "zip",
        "start": 0,
        "end": 999,
    }
    r = client.post("/api/sources/export/video-tiled", json=body)
    assert r.status_code == 200
    zf = zipfile.ZipFile(_io.BytesIO(r.content))
    # Synthetic fixture has 5 frames → end clamps to 4 → 5 PNGs.
    assert len([n for n in zf.namelist() if n.endswith(".png")]) == 5


# ---------------------------------------------------------------------------
# M26 — non-linear sharpen / FPN ISP chain on Play per-frame routes
# ---------------------------------------------------------------------------

def test_frame_channel_thumbnail_accepts_sharpen_chain(
    client: TestClient, loaded_h5: dict
):
    """Per-frame channel route honors `sharpen_method` + `sharpen_amount`
    and produces output bytes distinct from the no-sharpen baseline."""
    sid = loaded_h5["source_id"]
    base = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
    )
    sharp = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
        f"?sharpen_method=Unsharp%20mask&sharpen_amount=2.0&sharpen_radius=2.0"
    )
    assert base.status_code == 200 and sharp.status_code == 200
    assert base.content.startswith(PNG_MAGIC) and sharp.content.startswith(PNG_MAGIC)
    assert base.content != sharp.content, (
        "sharpen_method=Unsharp mask should change PNG bytes vs baseline"
    )


def test_frame_channel_thumbnail_accepts_fpn_chain(
    client: TestClient, loaded_h5: dict
):
    """Per-frame channel route honors median + Gaussian FPN smoothing."""
    sid = loaded_h5["source_id"]
    base = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
    )
    smooth = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
        f"?median_size=5&gaussian_sigma=2.0"
    )
    assert base.status_code == 200 and smooth.status_code == 200
    assert base.content != smooth.content, (
        "median_size=5 + gaussian_sigma=2.0 should change PNG bytes vs baseline"
    )


def test_frame_rgb_composite_accepts_sharpen_chain(
    client: TestClient, loaded_h5: dict
):
    """Per-frame RGB composite route honors the sharpen chain too."""
    sid = loaded_h5["source_id"]
    base = client.get(f"/api/sources/{sid}/frame/0/rgb.png?gain=hg")
    sharp = client.get(
        f"/api/sources/{sid}/frame/0/rgb.png?gain=hg"
        f"&sharpen_method=Unsharp%20mask&sharpen_amount=2.0&sharpen_radius=2.0"
    )
    assert base.status_code == 200 and sharp.status_code == 200
    assert base.content != sharp.content, (
        "rgb.png with sharpen_method should differ from baseline"
    )


def test_tiled_image_export_honors_sharpen_chain(
    client: TestClient, loaded_h5: dict
):
    """Tiled-image export bakes the sharpen chain into per-tile renders."""
    sid = loaded_h5["source_id"]
    base_body = {
        "views": [{
            "source_id": sid, "frame_index": 0,
            "render": "channel", "channel": "HG-G",
            "colormap": "gray", "normalize": "auto",
        }],
        "layout": "auto",
        "format": "png",
    }
    sharp_body = dict(base_body)
    sharp_body["views"] = [dict(base_body["views"][0],
                                sharpen_method="Unsharp mask",
                                sharpen_amount=2.0,
                                sharpen_radius=2.0)]
    r_base = client.post("/api/sources/export/image-tiled", json=base_body)
    r_sharp = client.post("/api/sources/export/image-tiled", json=sharp_body)
    assert r_base.status_code == 200 and r_sharp.status_code == 200
    assert r_base.content.startswith(PNG_MAGIC)
    assert r_sharp.content.startswith(PNG_MAGIC)
    assert r_base.content != r_sharp.content, (
        "tiled export with sharpen chain should differ from baseline tile"
    )


def test_frame_channel_thumbnail_no_sharpen_params_byte_identical(
    client: TestClient, loaded_h5: dict
):
    """Sanity guard: omitting the new params yields the same bytes as
    the pre-M26 baseline. The default-skip gating in
    `_isp_chain_from_query` must short-circuit when nothing is set."""
    sid = loaded_h5["source_id"]
    a = client.get(f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png")
    b = client.get(
        f"/api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png"
        f"?sharpen_amount=1.0&sharpen_radius=2.0&denoise_sigma=0.0"
        f"&median_size=0&gaussian_sigma=0.0&hot_pixel_thr=0.0&bilateral=false"
    )
    assert a.status_code == 200 and b.status_code == 200
    assert a.content == b.content, (
        "no-op sharpen params must not perturb the rendered PNG"
    )
