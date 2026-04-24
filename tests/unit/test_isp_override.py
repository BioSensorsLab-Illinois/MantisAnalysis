"""ISP reconfigure round-trip (isp-modes-v1).

Covers the session-store path the HTTP API uses:
  * load a synthetic dual-gain-shaped H5 → source with ``isp_mode_id``
    seeded to ``rgb_nir``.
  * call ``reconfigure_isp`` to swap mode / override origin.
  * assert channel dict reflects the new mode.
  * confirm resulting channel extractions match the override geometry
    byte-for-byte (using a tagged pattern).

We build the H5 via h5py in a tempfile rather than shipping a binary
fixture.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import h5py
import numpy as np
import pytest

from mantisanalysis.session import SessionStore


def _write_synthetic_h5(path: Path, h: int = 32, w: int = 64) -> None:
    """Build a one-frame dual-gain H5 with tagged pixel values.

    Dual-gain frame shape is (H, W) with HG in the left half and LG in
    the right half, matching the GSense ISP convention.
    """
    # Tag each pixel with row*1000 + col so extraction offsets are
    # easy to verify by inspection after reconfigure.
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    frame = (rr * 1000 + cc).astype(np.uint16)
    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frame[None, ...])
        cam.create_dataset("timestamp", data=np.asarray([0.0], dtype=np.float64))
        cam.create_dataset("integration-time",
                           data=np.asarray([0.0], dtype=np.float64))


@pytest.fixture
def synthetic_h5_path(tmp_path: Path) -> Path:
    p = tmp_path / "synthetic_dualgain.h5"
    _write_synthetic_h5(p)
    return p


def test_load_defaults_to_rgb_nir_with_current_channel_keys(synthetic_h5_path) -> None:
    """Backward compat: no-args load emits the pre-isp-modes-v1 schema."""
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    assert src.isp_mode_id == "rgb_nir"
    # Frozen channel-key schema preserved (ARCHITECTURE.md invariant #3).
    expected = {"HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"}
    assert expected.issubset(set(src.channels.keys()))
    assert src.raw_frame is not None  # cached for reconfigure


def test_reconfigure_to_bare_dualgain(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    src2 = store.reconfigure_isp(src.source_id, "bare_dualgain")
    assert src2.isp_mode_id == "bare_dualgain"
    assert set(src2.channels.keys()) == {"HG-RAW", "LG-RAW"}
    # Each bare channel equals the full half (no Bayer extraction).
    assert src2.channels["HG-RAW"].shape == (32, 32)
    assert src2.channels["LG-RAW"].shape == (32, 32)


def test_reconfigure_back_to_rgb_nir_restores_schema(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    store.reconfigure_isp(src.source_id, "bare_dualgain")
    src3 = store.reconfigure_isp(src.source_id, "rgb_nir")
    assert "HG-R" in src3.channels
    assert "LG-NIR" in src3.channels
    assert "HG-Y" in src3.channels  # Y re-synthesized


def test_origin_override_shifts_extraction(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    default_r = src.channels["HG-R"].copy()
    # Shift origin (0,0) → (1,0). Every channel's first row should now
    # be one deeper into the half-frame.
    src2 = store.reconfigure_isp(src.source_id, "rgb_nir",
                                 overrides={"origin": [1, 0]})
    assert src2.isp_config["origin"] == (1, 0)
    # Pick the first column-0 sample — must differ from the default
    # origin because the row offset has increased by 1.
    assert int(src2.channels["HG-R"][0, 0]) != int(default_r[0, 0])


def test_rename_4th_channel(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    src2 = store.reconfigure_isp(src.source_id, "rgb_nir",
                                 overrides={"channel_name_overrides":
                                            {"nir": "UV-650"}})
    assert "HG-UV-650" in src2.channels
    assert "LG-UV-650" in src2.channels
    assert "HG-NIR" not in src2.channels


def test_reconfigure_on_synthetic_source_rejects(synthetic_h5_path) -> None:
    """Synthetic sources without a cached raw frame can't reconfigure.

    Defensive — the sample source uses channels directly and has no
    raw_frame set. reconfigure_isp must raise a clear RuntimeError
    instead of silently producing an inconsistent source.
    """
    from mantisanalysis.session import LoadedSource
    store = SessionStore()
    src = LoadedSource(
        source_id="aaaaaaaaaaaa",
        name="synth",
        source_kind="synthetic",
        channels={"HG-R": np.zeros((4, 4), np.uint16)},
        attrs={},
        shape_hw=(4, 4),
        raw_frame=None,
    )
    with store._lock:
        store._items[src.source_id] = src
    with pytest.raises(RuntimeError):
        store.reconfigure_isp(src.source_id, "bare_dualgain")


def test_unknown_mode_id_rejects(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    with pytest.raises(KeyError):
        store.reconfigure_isp(src.source_id, "not_a_real_mode")


def test_channel_loc_override_points_at_different_subtile(synthetic_h5_path) -> None:
    """Per-channel loc override points one slot at a different sub-tile.

    Reproduces the user feature request: RGB-NIR's R slot pointed at
    (1,1) instead of the default (0,1). Verified by a round-trip:
    after override, the first sample of HG-R equals the first sample
    of HG-NIR under the *default* configuration (same raw-frame pixel).
    """
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    # Stash default HG-NIR first sample — the pixel R should now point at.
    default_hg_nir_00 = int(src.channels["HG-NIR"][0, 0])
    src2 = store.reconfigure_isp(
        src.source_id, "rgb_nir",
        overrides={"channel_loc_overrides": {"r": [1, 1]}},
    )
    assert src2.isp_config["channel_loc_overrides"]["r"] == (1, 1)
    assert int(src2.channels["HG-R"][0, 0]) == default_hg_nir_00


def test_channel_loc_override_drops_unknown_slots(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    # ``i0`` is not a slot on rgb_nir; it must be silently dropped
    # rather than surfacing as a silent re-route.
    src2 = store.reconfigure_isp(
        src.source_id, "rgb_nir",
        overrides={"channel_loc_overrides": {"r": [1, 1], "i0": [0, 0]}},
    )
    assert "r" in src2.isp_config["channel_loc_overrides"]
    assert "i0" not in src2.isp_config["channel_loc_overrides"]


def test_channel_loc_override_negative_rejects(synthetic_h5_path) -> None:
    store = SessionStore()
    src = store.load_from_path(synthetic_h5_path)
    with pytest.raises(ValueError):
        store.reconfigure_isp(
            src.source_id, "rgb_nir",
            overrides={"channel_loc_overrides": {"r": [-1, 0]}},
        )


def test_odd_half_dimensions_crop_to_common_shape(tmp_path: Path) -> None:
    """Reproduces the 422 broadcast crash the user hit on a real H5.

    When the half-frame dims aren't clean multiples of outer_stride,
    per-channel extractions produce slightly different shapes. Without
    a normalizing crop, ``luminance_from_rgb`` fails with "operands
    could not be broadcast together". The crop in ``extract_with_mode``
    should paper over it — every channel must share the same (H, W).
    """
    # Build a dual-gain frame whose half-width is 4094 (not a clean
    # multiple of 4 under stride=4). Full frame width = 8188 → halves
    # each 4094 columns wide.
    h, w = 16, 8188
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    frame = (rr * 1000 + cc).astype(np.uint16)
    p = tmp_path / "odd_dims.h5"
    import h5py
    with h5py.File(p, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frame[None, ...])
        cam.create_dataset("timestamp", data=np.asarray([0.0], dtype=np.float64))
        cam.create_dataset("integration-time",
                           data=np.asarray([0.0], dtype=np.float64))

    store = SessionStore()
    src = store.load_from_path(p)
    # Every channel under rgb_nir must share the exact same shape.
    shapes = {k: v.shape for k, v in src.channels.items()}
    assert len(set(shapes.values())) == 1, (
        f"channels ended up with mismatched shapes: {shapes}"
    )
    # Reconfigure (even to the same mode) must also keep them consistent.
    src2 = store.reconfigure_isp(src.source_id, "rgb_nir",
                                 overrides={"origin": [1, 1]})
    shapes2 = {k: v.shape for k, v in src2.channels.items()}
    assert len(set(shapes2.values())) == 1, (
        f"channels after reconfigure had mismatched shapes: {shapes2}"
    )


# ---------------------------------------------------------------------------
# Regression tests for isp-modes-v1-bugfixes-v1
# ---------------------------------------------------------------------------


def _write_rgb_png(path: Path, h: int = 8, w: int = 10) -> None:
    """Build a deterministic RGB PNG with tagged per-channel values.

    Channel R is filled with 100, G with 150, B with 200. Tests can
    assert specific per-channel means after reconfigure to catch
    cross-channel contamination (bug_001 + bug_004).
    """
    from PIL import Image

    arr = np.zeros((h, w, 3), dtype=np.uint8)
    arr[..., 0] = 100  # R
    arr[..., 1] = 150  # G
    arr[..., 2] = 200  # B
    Image.fromarray(arr, mode="RGB").save(path)


def test_rgb_image_reconfigure_produces_2d_channels(tmp_path: Path) -> None:
    """bug_001 regression.

    Before the fix: ``reconfigure_isp`` on an RGB PNG went through
    ``extract_with_mode`` with a 3-D ``(H, W, 3)`` raw frame. All
    three primary slots had ``loc=(0,0)`` and stride=(1,1), so
    ``extract_by_spec`` returned the whole 3-D array three times;
    R/G/B aliased to the same buffer.
    """
    p = tmp_path / "rgb.png"
    _write_rgb_png(p, h=8, w=10)

    store = SessionStore()
    src = store.load_from_path(p)
    # Sanity on the initial load.
    assert src.isp_mode_id == "rgb_image"
    assert src.source_kind == "image"
    for key in ("R", "G", "B", "Y"):
        assert src.channels[key].ndim == 2, f"initial {key} should be 2-D"

    # Reconfigure to the same mode with no overrides. This must
    # preserve the 2-D plane-split structure + the per-channel values.
    src2 = store.reconfigure_isp(src.source_id, "rgb_image")
    for key in ("R", "G", "B", "Y"):
        assert key in src2.channels, f"{key} missing after reconfigure"
        assert src2.channels[key].ndim == 2, (
            f"{key} is {src2.channels[key].ndim}-D after reconfigure "
            f"(shape={src2.channels[key].shape}); bug_001 regression"
        )
    # Per-primary means must match the seeded fill values — if R/G/B
    # aliased to the same buffer they'd all have the same mean.
    assert int(src2.channels["R"].mean()) == 100
    assert int(src2.channels["G"].mean()) == 150
    assert int(src2.channels["B"].mean()) == 200
    # R / G / B must be distinct arrays, not three views of the same buffer.
    assert src2.channels["R"] is not src2.channels["G"]
    assert src2.channels["G"] is not src2.channels["B"]
    # Shape matches the input image (H, W).
    assert src2.channels["R"].shape == (8, 10)
    assert src2.shape_hw == (8, 10)


def test_attach_dark_from_path_after_reconfigure_works(tmp_path: Path) -> None:
    """merged_bug_002 regression.

    Before the fix: ``attach_dark_from_path`` called ``load_any`` which
    had been removed from the imports, so every attach raised
    ``NameError: name 'load_any' is not defined``. The fix routes the
    call through ``load_any_detail`` with the source's current ISP
    mode + config so the dark's channel key set matches the source
    even after a reconfigure.
    """
    p_src = tmp_path / "src.png"
    p_dark = tmp_path / "dark.png"
    _write_rgb_png(p_src, h=8, w=10)
    _write_rgb_png(p_dark, h=8, w=10)

    store = SessionStore()
    src = store.load_from_path(p_src)
    # Attach pre-reconfigure — must succeed (this was the NameError path).
    out = store.attach_dark_from_path(src.source_id, p_dark, name="dark.png")
    assert out.has_dark is True
    assert out.dark_name == "dark.png"
    assert set(out.dark_channels.keys()) >= {"R", "G", "B", "Y"}
    for key in ("R", "G", "B"):
        assert out.dark_channels[key].shape == out.channels[key].shape

    # Reconfigure, then attach again — must succeed (sibling gap in
    # merged_bug_002: dark was always loaded under the source-kind
    # default mode, so post-reconfigure channel keys could diverge).
    store.reconfigure_isp(src.source_id, "rgb_image")
    out2 = store.attach_dark_from_path(src.source_id, p_dark)
    assert out2.has_dark is True


def test_attach_dark_from_bytes_works(tmp_path: Path) -> None:
    """merged_bug_002 regression — bytes path parallel to the path one."""
    p_src = tmp_path / "src.png"
    _write_rgb_png(p_src, h=8, w=10)
    dark_bytes = (tmp_path / "src.png").read_bytes()

    store = SessionStore()
    src = store.load_from_path(p_src)
    out = store.attach_dark_from_bytes(src.source_id, dark_bytes, "upload-dark.png")
    assert out.has_dark is True
    assert out.dark_name == "upload-dark.png"
    # Upload bytes have no original disk path.
    assert out.dark_path is None
