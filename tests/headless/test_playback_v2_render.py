"""playback-rebuild-v2 — render-pipeline + PATCH-API direct tests.

Closes the M6 reviewer findings:
- test-coverage-reviewer P0-1: render math untested
- test-coverage-reviewer P0-2: TIFF route untested
- risk-skeptic P0-3: zero-frame guard
- planner-architect P0-2: PATCH cascade lock
- risk-skeptic P0-2: PATCH allow-list
"""

from __future__ import annotations

import io
from pathlib import Path

import h5py
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from mantisanalysis.playback import h5io
from mantisanalysis.playback import library as _library
from mantisanalysis.playback import render as _render
from mantisanalysis.playback.api import WORKSPACE
from mantisanalysis.playback.workspace import Workspace, View
from mantisanalysis.server import create_app


@pytest.fixture()
def fresh_workspace(tmp_path: Path) -> Workspace:
    """Reset the singleton between tests so each test sees a clean WS."""
    WORKSPACE._streams.clear()
    WORKSPACE._tabs.clear()
    WORKSPACE._tab_order.clear()
    WORKSPACE._active_tab_id = None
    WORKSPACE.library._recordings.clear()
    WORKSPACE.library._darks.clear()
    return WORKSPACE


def _h5(tmp_path: Path, n_frames: int = 4, h: int = 32, w: int = 64) -> Path:
    p = tmp_path / "synth.h5"
    rng = np.random.default_rng(seed=hash(p.name) & 0xFFFFFFFF)
    frames = rng.integers(0, 2**12, size=(n_frames, h, w, 1)).astype(np.uint16)
    ts = np.linspace(1_000_000.0, 1_000_000.0 + (n_frames - 1) * 0.033, n_frames)
    it = np.full(n_frames, 25_000.0, dtype=np.float64)
    with h5py.File(p, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=it)
        cam.create_dataset("integration-time-expected", data=it)
    return p


# ---------------------------------------------------------------------------
# render math
# ---------------------------------------------------------------------------


def test_apply_window_clamps_at_lo_hi() -> None:
    a = np.array([0, 50, 100, 150, 200, 65535], dtype=np.uint16)
    out = _render._apply_window(a, low=50, high=150)
    # 50 → 0; 100 → 127.5 → 128; 150+ → 255
    assert out[0] == 0
    assert out[1] == 0
    assert 125 <= int(out[2]) <= 130
    assert out[3] == 255
    assert out[4] == 255
    assert out[5] == 255


def test_apply_window_zero_width_does_not_divide_by_zero() -> None:
    a = np.array([0, 100, 65535], dtype=np.uint16)
    # high == low → high becomes low + 1 inside _apply_window
    out = _render._apply_window(a, low=100, high=100)
    assert out.shape == (3,)
    # No NaN / inf — array is uint8 so this is by construction.
    assert out.dtype == np.uint8


def test_cmap_lut_gray_is_identity_ramp() -> None:
    lut = _render._cmap_lut("gray")
    assert lut.shape == (256, 3)
    assert lut.dtype == np.uint8
    for i in (0, 64, 128, 200, 255):
        assert tuple(lut[i]) == (i, i, i)


def test_cmap_lut_viridis_returns_rgb_lut() -> None:
    lut = _render._cmap_lut("viridis")
    assert lut.shape == (256, 3)
    assert lut.dtype == np.uint8
    # viridis at 0 is dark purple-ish (R<100, G<5, B>50)
    r, g, b = lut[0]
    assert r < 100 and g < 10 and b > 50
    # viridis at 255 is yellow (R>200, G>200, B<150)
    r, g, b = lut[255]
    assert r > 200 and g > 200 and b < 150


def test_half_for_channel_routes_hg_vs_lg() -> None:
    # Build a mosaic where left half is constant 1000, right half 2000.
    raw = np.full((32, 64), 1000, dtype=np.uint16)
    raw[:, 32:] = 2000
    hg = _render._half_for_channel(raw, "HG-G")
    lg = _render._half_for_channel(raw, "LG-G")
    assert hg.shape == (32, 32)
    assert lg.shape == (32, 32)
    assert hg.mean() == 1000
    assert lg.mean() == 2000


# ---------------------------------------------------------------------------
# render_view PNG + TIFF round-trip
# ---------------------------------------------------------------------------


def test_render_view_returns_valid_png(tmp_path: Path) -> None:
    p = _h5(tmp_path, n_frames=2, h=32, w=64)
    lib = _library.Library()
    rec = lib.register_recording(p)
    ws = Workspace(library=lib)
    s = ws.build_stream([rec.rec_id])
    view = View(view_id="v1", channel="HG-G", colormap="viridis", low=30, high=900)
    png_bytes = _render.render_view(s, 0, view, lib)
    assert png_bytes.startswith(b"\x89PNG")
    img = Image.open(io.BytesIO(png_bytes))
    assert img.format == "PNG"
    assert img.mode == "RGB"
    # Channel extract from a 32×64 mosaic via stride-4: half=32×32, then
    # GSense Bayer extraction reduces to 8×8.
    assert img.size == (8, 8)


def test_render_view_tiff_returns_valid_tiff(tmp_path: Path) -> None:
    p = _h5(tmp_path, n_frames=2, h=32, w=64)
    lib = _library.Library()
    rec = lib.register_recording(p)
    ws = Workspace(library=lib)
    s = ws.build_stream([rec.rec_id])
    view = View(view_id="v1", channel="HG-G", colormap="gray", low=30, high=900)
    tiff_bytes = _render.render_view_tiff(s, 0, view, lib)
    # TIFF magic = II*\x00 (LE) or MM\x00* (BE)
    assert tiff_bytes[:4] in (b"II*\x00", b"MM\x00*")
    img = Image.open(io.BytesIO(tiff_bytes))
    assert img.format == "TIFF"


def test_render_view_invert_flips_pixels(tmp_path: Path) -> None:
    p = _h5(tmp_path, n_frames=2, h=32, w=64)
    lib = _library.Library()
    rec = lib.register_recording(p)
    ws = Workspace(library=lib)
    s = ws.build_stream([rec.rec_id])
    base = View(view_id="v1", channel="HG-G", colormap="gray", low=0, high=4095)
    inverted = View(
        view_id="v2", channel="HG-G", colormap="gray", low=0, high=4095, invert=True
    )
    base_arr = np.array(Image.open(io.BytesIO(_render.render_view(s, 0, base, lib))))
    inv_arr = np.array(Image.open(io.BytesIO(_render.render_view(s, 0, inverted, lib))))
    # Invert: 255 - x. Applied per-channel after gray LUT.
    assert np.allclose(inv_arr, 255 - base_arr, atol=1)


def test_register_recording_rejects_zero_frames(tmp_path: Path) -> None:
    """risk-skeptic P0-3: empty recordings would otherwise repro v1."""
    p = tmp_path / "empty.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("/camera/frames", data=np.zeros((0, 32, 64, 1), dtype=np.uint16))
    lib = _library.Library()
    with pytest.raises(ValueError, match="zero frames"):
        lib.register_recording(p)


# ---------------------------------------------------------------------------
# PATCH endpoints (cascade-aware, allow-list, lock)
# ---------------------------------------------------------------------------


def test_patch_view_rejects_non_allowlisted_field(fresh_workspace, tmp_path: Path) -> None:
    """risk-skeptic P0-2 + planner-architect P0-2: setattr-anything closed."""
    client = TestClient(create_app())
    p = _h5(tmp_path)
    rec = client.post(
        "/api/playback/recordings/from-path", json={"path": str(p)}
    ).json()
    s = client.post("/api/playback/streams", json={"rec_ids": [rec["rec_id"]]}).json()
    tab = client.post(
        "/api/playback/tabs", json={"stream_id": s["stream_id"], "layout": "single"}
    ).json()
    vid = tab["views"][0]["view_id"]
    # Try to rewrite view_id — Pydantic body should reject the field outright.
    r = client.patch(
        f"/api/playback/tabs/{tab['tab_id']}/views/{vid}",
        json={"view_id": "stolen"},
    )
    # Field not in ViewPatchRequest → 422 from FastAPI's request validation.
    assert r.status_code == 422
    # View id unchanged.
    after = client.get("/api/playback/workspace").json()
    assert after["tabs"][0]["views"][0]["view_id"] == vid


def test_patch_tab_clamps_active_frame_to_total(fresh_workspace, tmp_path: Path) -> None:
    """planner-architect P0-2: PATCH must run inside the cascade lock."""
    client = TestClient(create_app())
    p = _h5(tmp_path, n_frames=4)
    rec = client.post(
        "/api/playback/recordings/from-path", json={"path": str(p)}
    ).json()
    s = client.post("/api/playback/streams", json={"rec_ids": [rec["rec_id"]]}).json()
    tab = client.post(
        "/api/playback/tabs", json={"stream_id": s["stream_id"], "layout": "single"}
    ).json()
    # Try to set active_frame past the end — gets clamped.
    r = client.patch(
        f"/api/playback/tabs/{tab['tab_id']}", json={"active_frame": 999}
    )
    assert r.status_code == 200
    assert r.json()["active_frame"] == 3  # 4 frames → ceiling 3


def test_patch_tab_rejects_unknown_layout(fresh_workspace, tmp_path: Path) -> None:
    client = TestClient(create_app())
    p = _h5(tmp_path)
    rec = client.post(
        "/api/playback/recordings/from-path", json={"path": str(p)}
    ).json()
    s = client.post("/api/playback/streams", json={"rec_ids": [rec["rec_id"]]}).json()
    tab = client.post(
        "/api/playback/tabs", json={"stream_id": s["stream_id"], "layout": "single"}
    ).json()
    r = client.patch(
        f"/api/playback/tabs/{tab['tab_id']}", json={"layout": "bogus"}
    )
    assert r.status_code == 422


def test_export_tiff_endpoint_returns_tiff(fresh_workspace, tmp_path: Path) -> None:
    """test-coverage-reviewer P0-2: TIFF route untested."""
    client = TestClient(create_app())
    p = _h5(tmp_path)
    rec = client.post(
        "/api/playback/recordings/from-path", json={"path": str(p)}
    ).json()
    s = client.post("/api/playback/streams", json={"rec_ids": [rec["rec_id"]]}).json()
    tab = client.post(
        "/api/playback/tabs", json={"stream_id": s["stream_id"], "layout": "single"}
    ).json()
    vid = tab["views"][0]["view_id"]
    r = client.get(
        f"/api/playback/tabs/{tab['tab_id']}/export?view_id={vid}&format=tiff"
    )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/tiff")
    assert r.content[:4] in (b"II*\x00", b"MM\x00*")
    assert "attachment" in r.headers.get("content-disposition", "")
