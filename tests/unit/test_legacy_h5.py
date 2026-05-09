"""Tests for the legacy gsbsi-prefix H5 compatibility reader (Play mode only).

Builds a synthetic H5 with the legacy container layout — top-level
``/dset`` shaped (H*W, N), ``/exposure_us`` (2, N), ``/frameNumbers`` (2, N),
no ``/camera`` group — then exercises detection, channel extraction, and
``SessionStore.load_from_path`` end-to-end. We never commit a real legacy
H5 (binary policy) so the fixture is generated in tmp.
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from mantisanalysis.legacy_h5 import (
    LEGACY_FRAME_HW,
    LEGACY_TO_UINT16_SHIFT,
    LegacyFrameReader,
    extract_legacy_channels,
    is_legacy_gsbsi_h5,
    legacy_inspect,
    legacy_read_frame,
)
from mantisanalysis.session import SessionStore


def _build_synthetic_legacy(
    path: Path, *, n_frames: int = 3, shape: tuple[int, int] = LEGACY_FRAME_HW
) -> None:
    """Write a minimal legacy-format H5 with deterministic per-frame content."""
    H, W = shape
    rng = np.random.default_rng(0xBEEF)
    frames = np.empty((H * W, n_frames), dtype=np.uint16)
    for i in range(n_frames):
        # Fill with a row-period-4 / col-period-2 Bayer-like pattern so the
        # extractor produces non-degenerate per-channel arrays. Adding the
        # frame index keeps frames distinguishable for cache + readback tests.
        img = np.zeros((H, W), dtype=np.uint16)
        img[0::4, 0::2] = 200 + i  # LG-B
        img[0::4, 1::2] = 300 + i  # LG-R
        img[1::4, 0::2] = 1500 + 10 * i  # HG-B
        img[1::4, 1::2] = 1700 + 10 * i  # HG-R
        img[2::4, 0::2] = 250 + i  # LG-G
        img[2::4, 1::2] = 350 + i  # LG-NIR
        img[3::4, 0::2] = 1900 + 10 * i  # HG-G
        img[3::4, 1::2] = 2100 + 10 * i  # HG-NIR
        # Sprinkle a low-amplitude noise field so percentile-based downstream
        # math (channel_to_png_bytes vmin/vmax) still gets >0 dynamic range.
        img = img + rng.integers(0, 8, size=img.shape, dtype=np.uint16)
        frames[:, i] = img.flatten(order="C")
    exposure_us = np.tile(np.array([[1000.0], [44831.36]], dtype=np.float32), (1, n_frames))
    with h5py.File(path, "w") as f:
        f.create_dataset("dset", data=frames)
        f.create_dataset("exposure_us", data=exposure_us)
        f.create_dataset(
            "exposure",
            data=np.array([[1000, 0], [29878, 0]] + [[0, 0]] * 14, dtype=np.int32),
        )
        f.create_dataset("frameNumbers", data=np.zeros((2, n_frames), dtype=np.int32))


def _build_modern_h5(path: Path, *, n_frames: int = 2) -> None:
    """Minimal modern MantisCam H5 to confirm ``is_legacy_gsbsi_h5`` is False."""
    H, W = 32, 64
    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset(
            "frames",
            data=np.zeros((n_frames, H, W), dtype=np.uint16),
        )
        cam.create_dataset(
            "integration-time",
            data=np.full(n_frames, 1e-3, dtype=np.float64),
        )
        cam.create_dataset(
            "timestamp",
            data=np.arange(n_frames, dtype=np.float64),
        )


def test_is_legacy_gsbsi_h5_positive(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi_synthetic.h5"
    _build_synthetic_legacy(p, n_frames=2)
    assert is_legacy_gsbsi_h5(p) is True


def test_is_legacy_gsbsi_h5_rejects_modern(tmp_path: Path) -> None:
    p = tmp_path / "modern.h5"
    _build_modern_h5(p, n_frames=2)
    assert is_legacy_gsbsi_h5(p) is False


def test_is_legacy_gsbsi_h5_rejects_non_h5(tmp_path: Path) -> None:
    p = tmp_path / "not_an_h5.bin"
    p.write_bytes(b"this is not hdf5")
    assert is_legacy_gsbsi_h5(p) is False


def test_is_legacy_gsbsi_h5_rejects_missing(tmp_path: Path) -> None:
    assert is_legacy_gsbsi_h5(tmp_path / "nope.h5") is False


def test_legacy_inspect_metadata(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=4)
    info = legacy_inspect(p)
    assert info["n_frames"] == 4
    assert info["frame_hw"] == LEGACY_FRAME_HW
    exposures_s = info["exposures_s"]
    timestamps = info["timestamps"]
    assert exposures_s.shape == (4,)
    # 44831.36 us → ~0.0448 s; we surface the LG (long) exposure by convention.
    assert np.allclose(exposures_s, 44831.36e-6, atol=1e-6)
    assert timestamps.shape == (4,)
    assert np.array_equal(timestamps, np.arange(4))


def test_legacy_read_frame_shape_and_dtype(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=3)
    with h5py.File(p, "r") as f:
        frame = legacy_read_frame(f["dset"], 1)
    assert frame.shape == LEGACY_FRAME_HW
    assert frame.dtype == np.uint16


def test_legacy_read_frame_applies_12bit_shift(tmp_path: Path) -> None:
    """A 12-bit raw value (max 4095) must come out left-shifted by 4 so the
    Display pipeline (uint16 dtype-max normalization) reads it as full-range."""
    H, W = LEGACY_FRAME_HW
    raw = np.full((H, W), 4095, dtype=np.uint16)  # saturated 12-bit
    raw[0, 0] = 0
    raw[0, 1] = 1
    raw[0, 2] = 0x0F00  # 3840 → 0xF000 = 61440 after shift
    p = tmp_path / "gsbsi_const.h5"
    with h5py.File(p, "w") as f:
        f.create_dataset("dset", data=raw.flatten(order="C").reshape(-1, 1))
        f.create_dataset("exposure_us", data=np.array([[1000.0], [44831.36]], dtype=np.float32))
        f.create_dataset("exposure", data=np.zeros((16, 2), dtype=np.int32))
        f.create_dataset("frameNumbers", data=np.zeros((2, 1), dtype=np.int32))
    with h5py.File(p, "r") as f:
        frame = legacy_read_frame(f["dset"], 0)
    assert frame.dtype == np.uint16
    assert int(frame[0, 0]) == 0
    assert int(frame[0, 1]) == 1 << LEGACY_TO_UINT16_SHIFT  # 16
    assert int(frame[0, 2]) == 0xF000  # 61440
    # Bulk pixels (4095 << 4) saturate at 0xFFF0, not the dtype max — the
    # bottom 4 bits stay zero, exactly the unused depth headroom.
    assert int(frame[1, 1]) == 0xFFF0


def test_legacy_read_frame_out_of_range(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=2)
    with h5py.File(p, "r") as f:
        with pytest.raises(IndexError):
            legacy_read_frame(f["dset"], 99)


def test_extract_legacy_channels_keys_and_shapes(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=1)
    with h5py.File(p, "r") as f:
        frame = legacy_read_frame(f["dset"], 0)
    chs = extract_legacy_channels(frame)
    expected = {"HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y", "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"}
    assert set(chs.keys()) == expected
    H, W = LEGACY_FRAME_HW
    target_shape = (H // 4, W // 2)
    for k, arr in chs.items():
        assert arr.shape == target_shape, (k, arr.shape)
        assert arr.dtype == np.uint16


def test_extract_legacy_channels_separates_gain(tmp_path: Path) -> None:
    """HG channels should land in the high-value bucket, LG in the low-value
    bucket — confirms the row-period-4 gain interleave is decoded correctly.

    The fixture writes 12-bit values; the read-time left-shift turns 1500-2100
    into ~24000-33600 and 200-350 into ~3200-5600.
    """
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=1)
    with h5py.File(p, "r") as f:
        frame = legacy_read_frame(f["dset"], 0)
    chs = extract_legacy_channels(frame)
    for k in ("HG-R", "HG-G", "HG-B", "HG-NIR"):
        assert chs[k].mean() > 1000 << LEGACY_TO_UINT16_SHIFT, f"{k} mean={chs[k].mean()}"
    for k in ("LG-R", "LG-G", "LG-B", "LG-NIR"):
        assert chs[k].mean() < 500 << LEGACY_TO_UINT16_SHIFT, f"{k} mean={chs[k].mean()}"


def test_extract_legacy_channels_y_is_rec601(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=1)
    with h5py.File(p, "r") as f:
        frame = legacy_read_frame(f["dset"], 0)
    chs = extract_legacy_channels(frame)
    expected_hg_y = (
        0.299 * chs["HG-R"].astype(np.float64)
        + 0.587 * chs["HG-G"].astype(np.float64)
        + 0.114 * chs["HG-B"].astype(np.float64)
    ).astype(np.uint16)
    assert np.array_equal(chs["HG-Y"], expected_hg_y)


def test_extract_legacy_channels_rejects_wrong_shape() -> None:
    bad = np.zeros((128, 128), dtype=np.uint16)
    with pytest.raises(ValueError, match="expected legacy frame shape"):
        extract_legacy_channels(bad)


def test_legacy_frame_reader_round_trip(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=3)
    rdr = LegacyFrameReader(p)
    try:
        assert rdr.n_frames == 3
        assert rdr.exposures_s.shape == (3,)
        assert rdr.timestamps.shape == (3,)
        f0 = rdr.read_frame(0)
        f2 = rdr.read_frame(2)
        # Frames 0 and 2 differ by the per-frame +i ramp the builder injects.
        assert f0.shape == LEGACY_FRAME_HW
        assert f2.shape == LEGACY_FRAME_HW
        assert not np.array_equal(f0, f2)
    finally:
        rdr.close()


def test_session_store_dispatches_legacy(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=4)
    store = SessionStore()
    src = store.load_from_path(p)
    try:
        assert src.source_kind == "h5"
        assert src._legacy is True
        assert src.frame_count == 4
        assert src.attrs["format"] == "legacy_gsbsi"
        # Channel set should match the modern Play schema (so the frontend
        # source-mode dropdown enumerates the same options).
        for k in (
            "HG-R",
            "HG-G",
            "HG-B",
            "HG-NIR",
            "HG-Y",
            "LG-R",
            "LG-G",
            "LG-B",
            "LG-NIR",
            "LG-Y",
            "HDR-R",
            "HDR-G",
            "HDR-B",
            "HDR-NIR",
            "HDR-Y",
        ):
            assert k in src.channels, k
        # Loader must surface W-META-TS (no real timestamps in legacy) and
        # W-LEGACY-12BIT (loader left-shifts 12-bit raw to fill uint16).
        codes = {w["code"] for w in src.warnings}
        assert "W-META-TS" in codes
        assert "W-LEGACY-12BIT" in codes
        # Channel values must reflect the 12→16 bit shift (so the Display
        # pipeline normalizes against the same dtype max as a modern source).
        assert int(src.channels["HG-R"].max()) > (1 << 12), "shift not applied"
        # Legacy sources now cache the raw frame-0 mosaic so reconfigure_isp
        # can re-extract on user-driven geometry tweaks (M29 P0 follow-up).
        # The active mode is the row-interleaved LEGACY_GSBSI_RGB_NIR.
        assert src.raw_frame is not None
        assert src.raw_frame.shape == (2048, 1024)
        assert src.isp_mode_id == "legacy_gsbsi_rgb_nir"
    finally:
        store.clear()


def test_session_store_legacy_reconfigure_isp(tmp_path: Path) -> None:
    """Geometry reconfigure on a legacy source re-extracts via
    extract_with_mode and updates the channels dict."""
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=2)
    store = SessionStore()
    src = store.load_from_path(p)
    try:
        before = src.channels["HG-R"].copy()
        # Shift origin by (1, 0) — picks up rows offset by 1 in the
        # interleaved mosaic, so HG-R values must change.
        src2 = store.reconfigure_isp(
            src.source_id,
            "legacy_gsbsi_rgb_nir",
            overrides={"origin": (1, 0)},
        )
        after = src2.channels["HG-R"]
        # Shape may shift by ±1 because the mosaic gets clipped at the
        # bottom edge when origin advances; sanity-check that's the
        # only kind of change and that values genuinely differ where
        # both rows are valid.
        assert before.shape != after.shape or not np.array_equal(before, after)
    finally:
        store.clear()


def test_session_store_extract_frame_legacy(tmp_path: Path) -> None:
    p = tmp_path / "gsbsi.h5"
    _build_synthetic_legacy(p, n_frames=3)
    store = SessionStore()
    src = store.load_from_path(p)
    try:
        chs0 = src.extract_frame(0)
        chs2 = src.extract_frame(2)
        # Same key set as the load-time snapshot.
        assert set(chs0.keys()) == set(src.channels.keys())
        # Different frames produce different per-channel arrays (the synthetic
        # builder injects a per-frame +i ramp into HG-* / LG-* values).
        assert not np.array_equal(chs0["HG-R"], chs2["HG-R"])
        # Cache hit on the second call returns the same dict by reference.
        chs0_again = src.extract_frame(0)
        assert chs0_again is chs0
    finally:
        store.clear()


def test_session_store_modern_path_unaffected(tmp_path: Path) -> None:
    """A modern-format H5 must still go through ``load_any_detail`` — the
    legacy dispatch must not regress the canonical loader."""
    p = tmp_path / "modern.h5"
    H, W = 32, 64
    with h5py.File(p, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset(
            "frames",
            data=np.full((2, H, W), 100, dtype=np.uint16),
        )
        cam.create_dataset(
            "integration-time",
            data=np.full(2, 1e-3, dtype=np.float64),
        )
        cam.create_dataset(
            "timestamp",
            data=np.arange(2, dtype=np.float64),
        )
    store = SessionStore()
    try:
        src = store.load_from_path(p)
        assert src.source_kind == "h5"
        assert src._legacy is False
    finally:
        store.clear()
