"""Tests for ``mantisanalysis.dark_frame`` (M2).

Covers all 3 averaging strategies, exposure matching with ties,
shape-mismatch rejection at the H5 level, and the ``bench_dark``
synthetic helper.
"""

from __future__ import annotations

import time
from pathlib import Path

import numpy as np
import pytest

from mantisanalysis import isp_modes as _isp
from mantisanalysis.dark_frame import (
    DarkMatch,
    MasterDark,
    average_dark_h5,
    bench_dark,
    match_dark_by_exposure,
)
from tests.unit._h5_fixtures import write_synthetic_dark


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------


def test_average_dark_mean_returns_expected_pedestal(tmp_path: Path) -> None:
    """Stack of (pedestal=140 ± noise=12) → mean ≈ 140 ± 1 LSB.

    Channels are extracted via the ISP mode (rgb_nir), so the pedestal
    survives the Bayer split.
    """
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=64, h=32, w=64,
                         pedestal=140, shot_noise=12, seed=42)
    dark = average_dark_h5(p, max_frames=64, strategy="mean")
    assert dark.frames_averaged == 64
    assert dark.frame_count_total == 64
    assert dark.strategy == "mean"
    for ch, arr in dark.channels.items():
        assert arr.shape == dark.shape
        assert np.isfinite(arr).all()
        # 64-frame mean of uniform(-12, +12) is std ~12/sqrt(64) ~ 1.5 LSB.
        assert np.abs(arr - 140.0).mean() < 2.0, (
            f"channel {ch} mean diverges from pedestal: "
            f"{np.abs(arr - 140.0).mean():.3f}"
        )


def test_average_dark_median_robust_to_outliers(tmp_path: Path) -> None:
    """Median ignores cosmic-ray-style outliers."""
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=32, pedestal=140, shot_noise=8, seed=1)
    dark = average_dark_h5(p, strategy="median")
    assert dark.strategy == "median"
    for arr in dark.channels.values():
        # Median is exactly an integer in (140 ± 8) clipped uint16 stack;
        # |arr - 140| should be tiny.
        assert np.abs(arr - 140.0).mean() < 2.0


def test_average_dark_sigma_clipped_3sigma(tmp_path: Path) -> None:
    """Sigma-clipped converges and rejects outliers."""
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=32, pedestal=140, shot_noise=8, seed=2)
    dark = average_dark_h5(p, strategy="sigma_clipped", sigma_threshold=3.0)
    assert dark.strategy == "sigma_clipped"
    assert dark.sigma_threshold == 3.0
    for arr in dark.channels.values():
        assert np.abs(arr - 140.0).mean() < 2.0


def test_average_dark_unknown_strategy_raises(tmp_path: Path) -> None:
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=8)
    with pytest.raises(ValueError, match="unknown strategy"):
        average_dark_h5(p, strategy="bogus")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Stack-shape and metadata
# ---------------------------------------------------------------------------


def test_average_dark_respects_max_frames(tmp_path: Path) -> None:
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=32)
    dark = average_dark_h5(p, max_frames=8)
    assert dark.frames_averaged == 8
    assert dark.frame_count_total == 32


def test_average_dark_short_stack_warns(tmp_path: Path) -> None:
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=2)
    dark = average_dark_h5(p)
    assert any(w.code == "W-DARK-SHORT" for w in dark.warnings)


def test_average_dark_records_exposure(tmp_path: Path) -> None:
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=8, exposure_us=20_000)
    dark = average_dark_h5(p)
    assert dark.exposure == pytest.approx(20_000.0)


def test_average_dark_4d_legacy_shape(tmp_path: Path) -> None:
    """Real GSense FSI-style (N, H, W, 1) frames work."""
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=8, use_4d_shape=True)
    dark = average_dark_h5(p)
    assert dark.frames_averaged == 8
    assert dark.shape != (0, 0)


def test_average_dark_channels_match_rgb_nir_schema(tmp_path: Path) -> None:
    """Channel-key schema preserved (frozen invariant)."""
    p = tmp_path / "dark.h5"
    write_synthetic_dark(p, n_frames=8)
    dark = average_dark_h5(p)
    expected = {"HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"}
    assert set(dark.channels.keys()) == expected


def test_average_dark_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        average_dark_h5(tmp_path / "nope.h5")


# ---------------------------------------------------------------------------
# bench_dark
# ---------------------------------------------------------------------------


def test_bench_dark_flat_pedestal() -> None:
    d = bench_dark(shape=(8, 16), channels=("HG-R", "HG-G"), pedestal=42.0)
    assert set(d.channels.keys()) == {"HG-R", "HG-G"}
    for arr in d.channels.values():
        assert arr.shape == (8, 16)
        assert np.all(arr == 42.0)
    # Synthetic warning marks the master as fabricated.
    assert any(w.code == "W-DARK-SYNTHETIC" for w in d.warnings)


# ---------------------------------------------------------------------------
# Exposure matching
# ---------------------------------------------------------------------------


def _make_master(exposure: float, *, name: str = "d", loaded_at: float = 0.0
                 ) -> MasterDark:
    """Helper: build a tiny MasterDark for matching tests."""
    return MasterDark(
        name=name, path=None, isp_mode_id="rgb_nir",
        channels={"HG-G": np.zeros((4, 4))},
        frame_count_total=8, frames_averaged=8,
        exposure=exposure,
        shape=(4, 4),
        strategy="mean", sigma_threshold=None,
        loaded_at=loaded_at,
    )


def test_match_dark_exact_match() -> None:
    pool = [_make_master(20_000.0, name="d20"),
            _make_master(40_000.0, name="d40")]
    best, alts = match_dark_by_exposure(20_000.0, pool, tolerance=0.10)
    assert best is not None
    assert best.name == "d20"
    assert alts[0].delta_pct == pytest.approx(0.0)
    # Sorted: closest first.
    assert alts[1].dark.name == "d40"


def test_match_dark_within_tolerance() -> None:
    """22 ms vs 20 ms target = 10% delta; tolerance=0.10 → match."""
    pool = [_make_master(22_000.0, name="d22")]
    best, alts = match_dark_by_exposure(20_000.0, pool, tolerance=0.10)
    assert best is not None
    assert best.name == "d22"
    assert alts[0].delta_pct == pytest.approx(0.10, abs=1e-9)


def test_match_dark_outside_tolerance_returns_none_with_alternatives() -> None:
    """30 ms vs 20 ms = 50%; tolerance=0.10 → no match but alternatives present."""
    pool = [_make_master(30_000.0, name="d30")]
    best, alts = match_dark_by_exposure(20_000.0, pool, tolerance=0.10)
    assert best is None
    assert len(alts) == 1
    assert alts[0].delta_pct == pytest.approx(0.5, abs=1e-9)


def test_match_dark_ambiguous_picks_most_recent() -> None:
    """Two masters at the same exposure → most-recent wins (per user)."""
    older = _make_master(20_000.0, name="older", loaded_at=100.0)
    newer = _make_master(20_000.0, name="newer", loaded_at=200.0)
    best, _ = match_dark_by_exposure(20_000.0, [older, newer], tolerance=0.10)
    assert best is not None
    assert best.name == "newer"


def test_match_dark_empty_pool() -> None:
    best, alts = match_dark_by_exposure(20_000.0, [], tolerance=0.10)
    assert best is None
    assert alts == []


def test_match_dark_skips_masters_without_exposure() -> None:
    """A master with `exposure=None` cannot be matched."""
    pool = [
        _make_master(0.0, name="bogus"),  # placeholder
        MasterDark(name="no_exp", path=None, isp_mode_id="rgb_nir",
                   channels={"HG-G": np.zeros((4, 4))},
                   frame_count_total=0, frames_averaged=0,
                   exposure=None, shape=(4, 4),
                   strategy="mean", sigma_threshold=None),
    ]
    # Override pool[0] to have a real exposure
    pool[0] = _make_master(20_000.0, name="d20")
    best, alts = match_dark_by_exposure(20_000.0, pool, tolerance=0.10)
    assert best is not None and best.name == "d20"
    # Only the master with exposure shows up in alternatives.
    assert all(m.dark.exposure is not None for m in alts)
