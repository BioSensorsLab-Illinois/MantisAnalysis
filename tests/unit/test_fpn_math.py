"""FPN metric sanity checks."""

from __future__ import annotations

import numpy as np
import pytest

from mantisanalysis.fpn_analysis import FPNSettings, compute_fpn, percentile_mask


def test_compute_fpn_on_uniform_image_gives_near_zero_noise() -> None:
    img = np.full((64, 64), 1000.0)
    res = compute_fpn(img, name="flat", settings=FPNSettings())
    assert res.mean == pytest.approx(1000.0, abs=1e-9)
    assert res.dsnu_dn == pytest.approx(0.0, abs=1e-9)
    assert res.row_noise_dn == pytest.approx(0.0, abs=1e-9)
    assert res.col_noise_dn == pytest.approx(0.0, abs=1e-9)


def test_compute_fpn_on_noisy_image_reports_positive_dsnu() -> None:
    rng = np.random.default_rng(seed=0)
    img = (1000 + rng.normal(0, 25, size=(64, 64))).astype(np.float64)
    res = compute_fpn(img, name="noisy", settings=FPNSettings())
    assert res.dsnu_dn > 10.0  # rough — should be ~25
    assert res.prnu_pct > 0.5


def test_percentile_mask_excludes_right_number_of_pixels() -> None:
    img = np.arange(100, dtype=np.float64)
    mask = percentile_mask(img, lo_pct=10, hi_pct=10)
    # With lo=10% and hi=10%, the mask keeps values in [p10, p90] inclusive.
    # For 100 unique increasing values, that's ~80 pixels.
    kept = int(mask.sum())
    assert 75 <= kept <= 85, f"kept {kept} expected ~80"


def test_compute_fpn_raises_if_all_pixels_excluded() -> None:
    # A non-uniform image so percentile cuts can actually separate values.
    rng = np.random.default_rng(seed=3)
    img = rng.normal(1000, 50, size=(32, 32)).astype(np.float64)
    # lo_pct + hi_pct > 100 should drop below 2 kept pixels.
    with pytest.raises(ValueError):
        compute_fpn(img, name="all-out", settings=FPNSettings(lo_pct=60, hi_pct=45))
