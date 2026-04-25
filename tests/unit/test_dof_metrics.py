"""Verify DoF focus metrics order as expected with increasing blur."""

from __future__ import annotations

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter

from mantisanalysis.dof_analysis import (
    FOCUS_METRICS,
    measure_focus,
)


def _bar_pattern_window(n: int = 64) -> np.ndarray:
    xs = np.arange(n, dtype=np.float64)
    col = np.sign(np.sin(2 * np.pi * 6 * xs / n)) * 40 + 120
    return np.tile(col.reshape(1, -1), (n, 1))


@pytest.mark.parametrize("metric", FOCUS_METRICS)
def test_metric_decreases_with_blur(metric: str) -> None:
    """A sharp bar pattern should score higher focus than its blurred twin."""
    sharp = _bar_pattern_window(64)
    blurred = gaussian_filter(sharp, sigma=4.0)

    # Embed each into a larger image so `_window` extracts cleanly.
    def _embed(a: np.ndarray) -> np.ndarray:
        H = a.shape[0] + 40
        out = np.full((H, H), 120.0, dtype=np.float64)
        out[20 : 20 + a.shape[0], 20 : 20 + a.shape[1]] = a
        return out

    sharp_img = _embed(sharp)
    blurred_img = _embed(blurred)
    center = (sharp_img.shape[0] // 2, sharp_img.shape[1] // 2)
    f_sharp = measure_focus(sharp_img, cx=center[1], cy=center[0], half_window=30, metric=metric)
    f_blur = measure_focus(blurred_img, cx=center[1], cy=center[0], half_window=30, metric=metric)
    assert f_sharp > f_blur, f"{metric}: sharp={f_sharp:.3g} should exceed blur={f_blur:.3g}"


def test_unknown_metric_raises() -> None:
    with pytest.raises(ValueError):
        measure_focus(np.zeros((64, 64)), cx=32, cy=32, half_window=16, metric="not-a-metric")


def test_empty_window_focus_is_zero() -> None:
    # Pick a center outside the image → window is None → 0.0
    img = np.zeros((64, 64), dtype=np.float64)
    for metric in FOCUS_METRICS:
        f = measure_focus(img, cx=-50, cy=-50, half_window=4, metric=metric)
        assert f == 0.0
