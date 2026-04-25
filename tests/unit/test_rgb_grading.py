"""Tests for the per-channel RGB grading pipeline.

play-tab-recording-inspection-rescue-v1 M22.

Covers:
  * apply_grading no-op semantics (defaults yield byte-identical output).
  * Per-channel gain shifts the matching channel only.
  * Gamma > 1 lifts mid-tones (output > input on a 0.5 patch).
  * WB Kelvin shift moves the R/B ratio in the right direction.
  * Saturation = 0 collapses to luma; > 1 boosts chroma.
  * auto_white_balance produces gray after applying its suggestion.
  * Helper kelvin_to_rgb_multipliers ≈ (1, 1, 1) at D65.
"""
from __future__ import annotations

import numpy as np
import pytest

from mantisanalysis.rgb_grading import (
    apply_grading,
    auto_white_balance,
    kelvin_to_rgb_multipliers,
)


# ---------------------------------------------------------------------------
# No-op + shape preservation
# ---------------------------------------------------------------------------

def test_no_op_when_params_none():
    a = np.full((8, 8, 3), 0.5, dtype=np.float32)
    out = apply_grading(a, None)
    assert out is a or np.array_equal(out, a)


def test_no_op_when_all_defaults():
    a = np.full((8, 8, 3), 0.5, dtype=np.float32)
    out = apply_grading(a, {
        "gain_r": 1.0, "gain_g": 1.0, "gain_b": 1.0,
        "offset_r": 0.0, "offset_g": 0.0, "offset_b": 0.0,
        "gamma": 1.0, "brightness": 0.0, "contrast": 1.0,
        "saturation": 1.0, "wb_kelvin": None,
    })
    assert np.array_equal(out, a)


def test_returns_float32_for_rgb_input():
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    out = apply_grading(a, {"gain_r": 2.0})
    assert out.dtype == np.float32
    assert out.shape == a.shape


def test_handles_rgba_input():
    a = np.full((4, 4, 4), 0.5, dtype=np.float32)
    a[..., 3] = 0.7
    out = apply_grading(a, {"gain_r": 2.0})
    # Alpha preserved.
    assert np.allclose(out[..., 3], 0.7)


# ---------------------------------------------------------------------------
# Per-channel operations
# ---------------------------------------------------------------------------

def test_gain_r_only_lifts_red():
    a = np.full((4, 4, 3), 0.3, dtype=np.float32)
    out = apply_grading(a, {"gain_r": 2.0})
    # R doubles, G and B untouched.
    assert np.allclose(out[..., 0], 0.6)
    assert np.allclose(out[..., 1], 0.3)
    assert np.allclose(out[..., 2], 0.3)


def test_offset_g_only_shifts_green():
    a = np.full((4, 4, 3), 0.3, dtype=np.float32)
    out = apply_grading(a, {"offset_g": 0.2})
    assert np.allclose(out[..., 0], 0.3)
    assert np.allclose(out[..., 1], 0.5)
    assert np.allclose(out[..., 2], 0.3)


def test_gamma_lt_one_darkens_midtones():
    """Gamma < 1 with the convention `out = pow(in, 1/gamma)` darkens mid-tones."""
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    out = apply_grading(a, {"gamma": 0.5})
    # 0.5**(1/0.5) = 0.25 — mid-tones drop.
    assert np.all(out < 0.5 - 1e-3)


def test_gamma_gt_one_lifts_midtones():
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    out = apply_grading(a, {"gamma": 2.2})
    # 0.5**(1/2.2) ≈ 0.73
    assert np.all(out > 0.5 + 1e-3)


def test_saturation_zero_collapses_to_luma():
    """Saturation = 0 should make all 3 channels equal (Rec. 601 luma)."""
    a = np.zeros((4, 4, 3), dtype=np.float32)
    a[..., 0] = 0.8
    a[..., 1] = 0.4
    a[..., 2] = 0.1
    out = apply_grading(a, {"saturation": 0.0})
    # All channels should be ~equal (luma).
    expected_luma = 0.299 * 0.8 + 0.587 * 0.4 + 0.114 * 0.1
    assert np.allclose(out[..., 0], expected_luma, atol=1e-4)
    assert np.allclose(out[..., 1], expected_luma, atol=1e-4)
    assert np.allclose(out[..., 2], expected_luma, atol=1e-4)


def test_brightness_lifts_all_channels():
    a = np.full((4, 4, 3), 0.3, dtype=np.float32)
    out = apply_grading(a, {"brightness": 0.2})
    assert np.allclose(out, 0.5)


def test_contrast_pivots_around_half():
    """Contrast > 1 pushes 0.7 toward 1, 0.3 toward 0."""
    a = np.zeros((1, 4, 3), dtype=np.float32)
    a[0, 0, :] = 0.7
    a[0, 1, :] = 0.3
    a[0, 2, :] = 0.5  # mid stays put
    a[0, 3, :] = 0.0
    out = apply_grading(a, {"contrast": 2.0})
    assert out[0, 0, 0] > 0.7
    assert out[0, 1, 0] < 0.3
    assert np.isclose(out[0, 2, 0], 0.5, atol=1e-4)


# ---------------------------------------------------------------------------
# WB Kelvin
# ---------------------------------------------------------------------------

def test_kelvin_at_d65_is_no_op():
    rm, gm, bm = kelvin_to_rgb_multipliers(6500)
    assert abs(rm - 1.0) < 1e-3
    assert abs(gm - 1.0) < 1e-3
    assert abs(bm - 1.0) < 1e-3


def test_warm_kelvin_increases_red_relative_to_blue():
    """3000 K (warm) → R/B multiplier ratio increases (R held high while
    B drops). Tanner Helland's curve clamps R at 255 below 6600 K so
    `rm` saturates at 1.0; the meaningful signal is the ratio shift."""
    rm, gm, bm = kelvin_to_rgb_multipliers(3000)
    assert rm / bm > 1.5
    assert bm < gm < rm


def test_cool_kelvin_increases_blue_relative_to_red():
    """10000 K (cool) → B/R multiplier ratio increases (B held high
    while R drops). At extreme-cool `bm` saturates near 1.0; the
    meaningful signal is the ratio shift."""
    rm, gm, bm = kelvin_to_rgb_multipliers(10000)
    assert bm / rm > 1.1
    assert rm < gm < bm


def test_apply_grading_respects_wb_kelvin():
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    out_warm = apply_grading(a.copy(), {"wb_kelvin": 3000})
    out_d65 = apply_grading(a.copy(), {"wb_kelvin": 6500})
    # Warm shift increases R/B ratio.
    rb_warm = out_warm[..., 0].mean() / max(1e-6, out_warm[..., 2].mean())
    rb_d65 = out_d65[..., 0].mean() / max(1e-6, out_d65[..., 2].mean())
    assert rb_warm > rb_d65


# ---------------------------------------------------------------------------
# Auto white balance
# ---------------------------------------------------------------------------

def test_gray_world_returns_unit_when_already_gray():
    a = np.full((8, 8, 3), 0.5, dtype=np.float32)
    sug = auto_white_balance(a, method="gray-world")
    assert abs(sug["gain_r"] - 1.0) < 1e-3
    assert abs(sug["gain_g"] - 1.0) < 1e-3
    assert abs(sug["gain_b"] - 1.0) < 1e-3


def test_gray_world_neutralizes_red_cast():
    a = np.full((8, 8, 3), 0.5, dtype=np.float32)
    a[..., 0] = 0.8  # red-cast
    sug = auto_white_balance(a, method="gray-world")
    # Suggested gain_r should be < 1 (pull red down).
    assert sug["gain_r"] < 1.0
    # G is the reference — pinned at 1.0.
    assert abs(sug["gain_g"] - 1.0) < 1e-3
    # Apply the suggestion and confirm the result is closer to gray.
    out = apply_grading(a, sug)
    means = out.mean(axis=(0, 1))
    assert abs(means[0] - means[1]) < 0.02
    assert abs(means[2] - means[1]) < 0.02


def test_max_rgb_method_handles_empty_signal():
    """Edge case: a frame with one channel = 0 throughout shouldn't crash."""
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    a[..., 2] = 0.0  # B = 0
    sug = auto_white_balance(a, method="max-rgb")
    # gain_b clamps to 10.0 (since max_b=0 → 1e-6 floor), G/R sane.
    assert 0.1 <= sug["gain_b"] <= 10.0
    assert sug["gain_g"] == 1.0


@pytest.mark.parametrize("method", ["gray-world", "max-rgb"])
def test_auto_wb_clamps_to_safe_range(method):
    a = np.full((4, 4, 3), 0.5, dtype=np.float32)
    a[..., 0] = 1e-9  # R nearly zero
    sug = auto_white_balance(a, method=method)
    assert 0.1 <= sug["gain_r"] <= 10.0
