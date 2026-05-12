"""Polarization DoLP/AoP and .polcal.h5 runtime support."""
from __future__ import annotations

from pathlib import Path
import io

import h5py
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from mantisanalysis import polarization as pol
from mantisanalysis.server import app
from mantisanalysis.session import STORE, SessionStore
from tests.unit.test_session_frames import _make_synthetic_h5


STOKES_MATRIX = np.array(
    [
        [1.0, 0.0, 1.0, 0.0],
        [1.0, 0.0, -1.0, 0.0],
        [0.0, 1.0, 0.0, -1.0],
    ],
    dtype=np.float32,
)


def _write_polcal(path: Path, shape=(4, 4), *, scale: float = 1.0) -> Path:
    gc = np.broadcast_to(STOKES_MATRIX * float(scale), shape + (3, 4)).astype(np.float32)
    with h5py.File(path, "w") as f:
        f.attrs["schema_name"] = "PolarMuellerCal"
        f.attrs["schema_version"] = "1.0"
        profiles = f.create_group("profiles")
        p = profiles.create_group("default")
        p.attrs["frame_shape_hw"] = np.asarray([shape[0] * 2, shape[1] * 2], dtype=np.int32)
        p.attrs["super_shape"] = np.asarray(shape, dtype=np.int32)
        p.create_dataset("Gc_map", data=gc)
        p.create_dataset("Gc_avg", data=STOKES_MATRIX.astype(np.float32))
        p.create_dataset("valid_mask", data=np.ones(shape, dtype=np.uint8))
    return path


def test_stokes_aop_dolp_math_matches_supplied_script_formula() -> None:
    stack = np.array([[[10.0, 8.0, 2.0, 4.0]]], dtype=np.float32)
    stokes = pol.stokes_from_analyzers(stack)
    assert np.allclose(stokes[0, 0], [12.0, 8.0, 4.0])

    aop, dolp = pol.compute_aop_dolp(stokes)
    assert float(aop[0, 0]) == pytest.approx(13.2825, rel=1e-4)
    assert float(dolp[0, 0]) == pytest.approx(np.sqrt(80.0) / 12.0, rel=1e-5)


def test_compute_virtual_channel_applies_dark_and_polcal_map(tmp_path: Path) -> None:
    profile = pol.load_polcal_profile(_write_polcal(tmp_path / "cal.polcal.h5", scale=2.0))
    channels = {
        "I0": np.full((4, 4), 10, dtype=np.uint16),
        "I45": np.full((4, 4), 8, dtype=np.uint16),
        "I90": np.full((4, 4), 2, dtype=np.uint16),
        "I135": np.full((4, 4), 4, dtype=np.uint16),
    }
    dark = {k: np.ones((4, 4), dtype=np.uint16) for k in channels}

    raw_s0 = pol.compute_virtual_channel(channels, "S0", dark_channels=dark)
    calibrated_s0 = pol.compute_virtual_channel(
        channels,
        "S0",
        dark_channels=dark,
        calibration=profile,
        calibration_enabled=True,
    )

    assert float(raw_s0[0, 0]) == pytest.approx(10.0)
    assert float(calibrated_s0[0, 0]) == pytest.approx(20.0)


def test_session_polarization_mode_exposes_virtual_channels_and_dark_gating(tmp_path: Path) -> None:
    rec = _make_synthetic_h5(tmp_path / "rec.h5", n_frames=2, half_h=8, half_w=8)
    dark = _make_synthetic_h5(tmp_path / "dark.h5", n_frames=2, half_h=8, half_w=8, seed=99)
    cal = _write_polcal(tmp_path / "cal.polcal.h5", shape=(4, 4))

    store = SessionStore()
    src = store.load_from_path(rec)
    src = store.reconfigure_isp(src.source_id, "polarization_dual")
    assert {"HG-DoLP", "HG-AoP", "LG-S0", "LG-AoP"}.issubset(src.channels)

    src = store.attach_polarization_calibration_from_path(src.source_id, cal)
    with pytest.raises(ValueError, match="dark frame"):
        store.set_polarization_calibration_enabled(src.source_id, True)

    src = store.attach_dark_from_path(src.source_id, dark)
    src = store.set_polarization_calibration_enabled(src.source_id, True)
    assert src.polarization_calibration_enabled is True
    assert src.has_dark is True
    # Dark compatibility ignores virtual derived channels; dark files do not
    # need nonsensical DoLP/AoP dark planes.
    assert src.dark_channels is not None
    assert "HG-DoLP" not in src.dark_channels


def test_polarization_calibration_api_routes_gate_on_dark(tmp_path: Path) -> None:
    STORE.clear()
    client = TestClient(app)
    rec = _make_synthetic_h5(tmp_path / "rec_api.h5", n_frames=2, half_h=8, half_w=8)
    dark = _make_synthetic_h5(tmp_path / "dark_api.h5", n_frames=2, half_h=8, half_w=8, seed=123)
    cal = _write_polcal(tmp_path / "cal_api.polcal.h5", shape=(4, 4))

    loaded = client.post("/api/sources/load-path", json={"path": str(rec)}).json()
    sid = loaded["source_id"]
    r = client.put(
        f"/api/sources/{sid}/isp",
        json={"mode_id": "polarization_dual"},
    )
    assert r.status_code == 200, r.text
    assert "LG-AoP" in r.json()["channels"]

    r = client.post(
        f"/api/sources/{sid}/polarization-cal/load-path",
        json={"path": str(cal)},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["has_polarization_calibration"] is True
    assert body["polarization_calibration_ready"] is False

    r = client.put(
        f"/api/sources/{sid}/polarization-cal/settings",
        json={"enabled": True},
    )
    assert r.status_code == 422
    assert "dark frame" in r.text

    r = client.post(
        f"/api/sources/{sid}/dark/load-path",
        json={"path": str(dark)},
    )
    assert r.status_code == 200, r.text
    r = client.put(
        f"/api/sources/{sid}/polarization-cal/settings",
        json={"enabled": True},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["polarization_calibration_enabled"] is True
    assert body["polarization_calibration_ready"] is True

    r = client.get(f"/api/sources/{sid}/channel/LG-DoLP/range")
    assert r.status_code == 200, r.text
    assert 0.0 <= r.json()["min"] <= r.json()["max"] <= 1.0

    r = client.get(f"/api/sources/{sid}/channel/LG-DoLP/thumbnail.png?max_dim=128")
    assert r.status_code == 200, r.text
    dolp_png = np.asarray(Image.open(io.BytesIO(r.content)))
    assert int(dolp_png.max()) > 0

    r = client.get(f"/api/sources/{sid}/channel/LG-AoP/thumbnail.png?max_dim=128")
    assert r.status_code == 200, r.text
    aop_png = np.asarray(Image.open(io.BytesIO(r.content)))
    assert int(aop_png.max()) > 0
