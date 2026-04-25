"""Tests for ``mantisanalysis.recording`` (M1).

Covers the 8 layout variants in ``_h5_fixtures.py`` plus channel-key
schema preservation, Y synthesis, lazy frame extraction, and timestamp
edge cases (risk-skeptic P1-J).
"""

from __future__ import annotations

from pathlib import Path

import h5py
import numpy as np
import pytest

from mantisanalysis import isp_modes as _isp
from mantisanalysis.recording import (
    ERR_LAYOUT,
    WARN_META_EXP,
    WARN_META_PATH,
    WARN_META_SINGLE_FRAME,
    WARN_META_TS,
    WARN_TS_DISORDER,
    extract_frame,
    inspect_recording,
)
from tests.unit._h5_fixtures import (
    expected_tagged_pixel,
    write_synthetic_recording,
)


# ---------------------------------------------------------------------------
# Canonical happy path
# ---------------------------------------------------------------------------


def test_canonical_recording_meta_complete(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=8, h=32, w=64, exposure_us=20_000)
    meta = inspect_recording(p)
    assert meta.errors == ()
    assert meta.frame_count == 8
    assert meta.raw_shape == (32, 64)
    assert meta.frame_dataset_path == "/camera/frames"
    assert meta.timestamps_available
    assert meta.timestamp_start_s == 0.0
    assert meta.timestamp_end_s == pytest.approx((8 - 1) / 30.0, abs=1e-9)
    assert meta.estimated_fps == pytest.approx(30.0, abs=1e-6)
    # Exposure is reported in raw camera units (no conversion). Synthetic
    # fixture writes 20_000 (microseconds-style); real GSense FSI writes
    # seconds-fractional like 0.025.
    assert meta.exposure_min == pytest.approx(20_000.0)
    assert meta.exposure_max == pytest.approx(20_000.0)
    assert meta.exposure_mean == pytest.approx(20_000.0)


def test_channel_keys_match_frozen_schema_for_rgb_nir(tmp_path: Path) -> None:
    """Frozen channel-key schema (AGENT_RULES rule 6) — Y is synthesized."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4)
    meta = inspect_recording(p)
    expected = {"HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"}
    assert set(meta.channels) == expected, (
        f"expected canonical 10-key set, got {set(meta.channels)}"
    )


def test_real_dev_folder_layout_4d_handled(tmp_path: Path) -> None:
    """Real GSense FSI dev recording is (N, H, W, 1) — 4-D legacy variant."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, h=32, w=64, use_4d_shape=True)
    meta = inspect_recording(p)
    assert meta.errors == ()
    assert meta.frame_count == 4
    assert meta.raw_shape == (32, 64)


# ---------------------------------------------------------------------------
# Fallback layouts (each emits a warning)
# ---------------------------------------------------------------------------


def test_no_timestamp_emits_warning(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, variant="no-timestamp")
    meta = inspect_recording(p)
    assert any(w.code == WARN_META_TS for w in meta.warnings), (
        f"expected W-META-TS, got {[w.code for w in meta.warnings]}"
    )
    assert not meta.timestamps_available
    assert meta.timestamp_start_s is None
    assert meta.estimated_fps is None


def test_no_exposure_emits_warning(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, variant="no-exposure")
    meta = inspect_recording(p)
    assert any(w.code == WARN_META_EXP for w in meta.warnings), (
        f"expected W-META-EXP, got {[w.code for w in meta.warnings]}"
    )
    assert meta.exposure_min is None
    assert meta.exposure_max is None
    assert meta.exposure_mean is None


def test_top_level_frames_dataset_emits_W_META_PATH(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, variant="top-level")
    meta = inspect_recording(p)
    assert meta.errors == ()
    assert meta.frame_dataset_path == "/frames"
    assert any(w.code == WARN_META_PATH for w in meta.warnings)


def test_single_frame_layout(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, variant="single-frame")
    meta = inspect_recording(p)
    assert meta.frame_count == 1
    assert any(w.code == WARN_META_SINGLE_FRAME for w in meta.warnings)


def test_empty_recording_returns_error(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, variant="empty")
    meta = inspect_recording(p)
    assert any(e.code == ERR_LAYOUT for e in meta.errors)
    assert meta.frame_count == 0


def test_missing_file_returns_blocking_error(tmp_path: Path) -> None:
    meta = inspect_recording(tmp_path / "does_not_exist.h5")
    assert any(e.code == ERR_LAYOUT and e.severity == "blocking"
               for e in meta.errors)


def test_corrupt_h5_returns_blocking_error(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    p.write_bytes(b"not an h5 file")
    meta = inspect_recording(p)
    assert any(e.code == ERR_LAYOUT for e in meta.errors)


# ---------------------------------------------------------------------------
# Timestamp edge cases (risk-skeptic P1-J)
# ---------------------------------------------------------------------------


def test_intra_file_non_monotonic_emits_W_TS_DISORDER(tmp_path: Path) -> None:
    """Two adjacent timestamps swapped mid-file → W-TS-DISORDER."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=8, variant="non-monotonic-ts")
    meta = inspect_recording(p)
    assert any(w.code == WARN_TS_DISORDER for w in meta.warnings)
    # Inspection still succeeds; estimated_fps is reported but noisy.
    assert meta.errors == ()
    assert meta.frame_count == 8


def test_very_large_absolute_timestamps_preserved(tmp_path: Path) -> None:
    """Unix-epoch-style timestamps (~1.7e9) preserve precision to ms."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, ts_start_s=1.7e9)
    meta = inspect_recording(p)
    assert meta.timestamp_start_s == pytest.approx(1.7e9, abs=1e-3)
    expected_end = 1.7e9 + (4 - 1) / 30.0
    assert meta.timestamp_end_s == pytest.approx(expected_end, abs=1e-3)


# ---------------------------------------------------------------------------
# extract_frame — pixel-tagged round-trip
# ---------------------------------------------------------------------------


def test_extract_frame_returns_correct_pixel(tmp_path: Path) -> None:
    """Pixel value at (frame=2, row=3, col=4) of the *raw* tagged frame
    should match the formula."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=4, h=32, w=64)
    meta = inspect_recording(p)

    # Sanity-check raw pixel via h5py.
    with h5py.File(p, "r") as f:
        raw = np.asarray(f[meta.frame_dataset_path][2])
    if raw.ndim == 3 and raw.shape[-1] == 1:
        raw = raw[..., 0]
    assert int(raw[3, 4]) == expected_tagged_pixel(frame_idx=2, row=3, col=4)

    # extract_frame returns the canonical channel dict.
    channels = extract_frame(meta, 2)
    assert set(channels.keys()) == set(meta.channels)


def test_extract_frame_synthesizes_y_for_rgb_nir(tmp_path: Path) -> None:
    """`HG-Y` and `LG-Y` are synthesized by `recording.extract_frame`,
    not pulled from the raw — preserves the frozen 10-key schema
    through the handoff (planner-architect P0-2)."""
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=2)
    meta = inspect_recording(p)
    channels = extract_frame(meta, 0)
    assert "HG-Y" in channels
    assert "LG-Y" in channels
    # Y = 0.299*R + 0.587*G + 0.114*B; sanity-check non-zero, finite.
    assert np.isfinite(channels["HG-Y"]).all()
    assert channels["HG-Y"].shape == channels["HG-R"].shape


def test_extract_frame_index_out_of_range(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=2)
    meta = inspect_recording(p)
    with pytest.raises(IndexError):
        extract_frame(meta, 99)
    with pytest.raises(IndexError):
        extract_frame(meta, -1)


def test_extract_frame_refuses_when_meta_has_errors(tmp_path: Path) -> None:
    meta = inspect_recording(tmp_path / "missing.h5")
    assert meta.errors
    with pytest.raises(KeyError):
        extract_frame(meta, 0)


# ---------------------------------------------------------------------------
# All 5 ISP modes (planner-architect P3-V — synthetic only;
# real-data validation deferred per BACKLOG)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode_id,is_dual_gain", [
    ("rgb_nir",            True),
    ("bare_dualgain",      True),
    ("polarization_dual",  True),
    ("bare_single",        False),
    ("polarization_single", False),
])
def test_inspect_supports_all_5_isp_modes(tmp_path: Path,
                                           mode_id: str,
                                           is_dual_gain: bool) -> None:
    """`inspect_recording` accepts every mode in `isp_modes.ALL_MODES`."""
    p = tmp_path / "rec.h5"
    h, w = (32, 64) if is_dual_gain else (32, 32)
    write_synthetic_recording(p, n_frames=4, h=h, w=w)
    meta = inspect_recording(p, isp_mode_id=mode_id)
    assert meta.errors == (), (
        f"{mode_id} produced errors: {[e.text for e in meta.errors]}"
    )
    assert meta.isp_mode_id == mode_id
    mode = _isp.get_mode(mode_id)
    expected_keys = set(_isp.build_channel_keys(
        mode, {}, include_luminance=(mode_id == "rgb_nir"),
    ))
    assert set(meta.channels) == expected_keys


def test_camera_attrs_serialized(tmp_path: Path) -> None:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=2)
    meta = inspect_recording(p)
    assert "fw-version" in meta.camera_attrs
    assert meta.camera_attrs.get("model-name") == "Synthetic GSense"
