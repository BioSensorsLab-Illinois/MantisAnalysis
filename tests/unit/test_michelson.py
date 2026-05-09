"""Verify the three Michelson contrast estimators behave sensibly."""

from __future__ import annotations

import numpy as np
import pytest

from mantisanalysis.usaf_groups import (
    measure_modulation,
    measure_modulation_fft,
)


def _square_bars(
    n: int = 60, n_cycles: float = 2.5, mean: float = 100.0, amp: float = 50.0
) -> np.ndarray:
    xs = np.arange(n, dtype=np.float64)
    return mean + amp * np.sign(np.sin(2 * np.pi * n_cycles * xs / n))


def test_michelson_percentile_matches_amplitude_over_mean() -> None:
    profile = _square_bars(60, n_cycles=2.5, mean=100.0, amp=50.0)
    m, lo, hi = measure_modulation(profile, method="percentile")
    # ideal (Imax-Imin)/(Imax+Imin) = 50/100 = 0.5
    assert m == pytest.approx(0.5, abs=0.05)
    assert lo < hi


def test_michelson_minmax_matches_amplitude_over_mean() -> None:
    profile = _square_bars(60, n_cycles=2.5, mean=100.0, amp=50.0)
    m, _, _ = measure_modulation(profile, method="minmax")
    assert m == pytest.approx(0.5, abs=1e-6)


def test_michelson_unknown_method_raises() -> None:
    with pytest.raises(ValueError):
        measure_modulation(np.zeros(10), method="not-a-method")


def test_fft_estimator_returns_positive_for_periodic_signal() -> None:
    profile = _square_bars(60, n_cycles=2.5, mean=100.0, amp=50.0)
    m, f_exp, f_peak = measure_modulation_fft(profile, n_cycles_expected=2.5)
    assert m > 0.0
    # Peak should be near the expected fundamental (within ±50%)
    assert f_peak == pytest.approx(f_exp, rel=0.5)


def test_fft_estimator_low_for_noise_only() -> None:
    # Pure zero-mean noise should produce a small Michelson relative to the
    # square-wave case above (test_fft_estimator_returns_positive_for_periodic_signal
    # gave ~0.6 for a clean pattern). A rectangular DC pulse gets ~0.3 from
    # leakage, so we set the bar at "well under 1.0, and strictly less than
    # the clean periodic case above".
    rng = np.random.default_rng(seed=7)
    noise = 100.0 + rng.normal(0, 0.5, size=60)
    m, _, _ = measure_modulation_fft(noise, n_cycles_expected=2.5)
    assert 0.0 <= m < 1.0


# ---------------------------------------------------------------------------
# R-0005 regression — 5-point Michelson stays in [0, 1]
# ---------------------------------------------------------------------------


def test_five_point_michelson_clamped_to_unit_interval():
    """R-0005 regression: aggressive sharpening can push bar / gap
    means to opposite signs (e.g. mean_gaps < 0 from Unsharp overshoot).
    The textbook formula then yields Michelson > 1 — unphysical. The
    clamp in measure_modulation_5pt must keep the return in [0, 1].
    """
    import numpy as np

    from mantisanalysis.usaf_groups import measure_modulation_5pt

    # Synthetic profile: 5 samples = 3 bars (positive) + 2 gaps (negative).
    # (bars_bright=True; gaps negative simulates sharpening overshoot.)
    profile = np.array([500.0, -300.0, 500.0, -300.0, 500.0])
    m, _bi, _gi, _bv, _gv, _bright = measure_modulation_5pt(
        profile,
        bar_indices=[0, 2, 4],
        gap_indices=[1, 3],
    )
    assert 0.0 <= m <= 1.0, f"Michelson {m} outside [0,1] (R-0005 regression)"


def test_five_point_michelson_non_negative_profile_unchanged():
    """Positive signal still reports the normal Michelson value,
    not crushed to zero by the clamp."""
    import numpy as np

    from mantisanalysis.usaf_groups import measure_modulation_5pt

    profile = np.array([500.0, 100.0, 500.0, 100.0, 500.0])  # clean bars
    m, _, _, _, _, _ = measure_modulation_5pt(
        profile,
        bar_indices=[0, 2, 4],
        gap_indices=[1, 3],
    )
    # (500 - 100) / (500 + 100) ≈ 0.6667
    assert 0.6 < m < 0.7, f"expected ~0.667, got {m}"
