"""B-0006 — smoke coverage for the legacy Workflow A pipeline.

`scripts/run_usaf_resolution.py` + `mantisanalysis/resolution.py` are the
auto-strip FFT MTF pipeline documented in the README (Workflow A).
Without coverage, refactors have no safety net and the README pointer
could silently bitrot. These tests pin the public surface.
"""

from __future__ import annotations

import numpy as np

from mantisanalysis.resolution import (
    ChannelResult,
    DirectionResult,
    analyze_channel,
    rotate_180,
)


def _synthetic_chart_channel(h: int = 128, w: int = 128, period: int = 8) -> np.ndarray:
    """Build a synthetic USAF-like channel: periodic stripes over a
    slow illumination gradient. Enough structure that `analyze_channel`
    should produce a non-trivial spectrum + a detectable cutoff.
    """
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    # Low-frequency illumination roll-off
    illum = 1500 + 500 * np.sin(2 * np.pi * cc / (2 * w))
    # High-frequency bars
    bars = 800 * np.sign(np.sin(2 * np.pi * cc / period))
    return (illum + bars).astype(np.float32)


def test_rotate_180_is_both_flips():
    """180-degree rotate == flip-h + flip-v composition, per the
    module docstring's methodology §1."""
    img = np.arange(24).reshape(4, 6).astype(np.float32)
    manual = img[::-1, ::-1]
    np.testing.assert_array_equal(rotate_180(img), manual)


def test_analyze_channel_returns_well_formed_result():
    """analyze_channel on a synthetic striped image returns a
    ChannelResult whose horizontal / vertical DirectionResults each
    carry non-empty profile, freqs, spectrum, and a finite noise_floor.
    """
    img = _synthetic_chart_channel(h=128, w=128, period=8)
    res = analyze_channel(img, gain="HG", channel="G")
    assert isinstance(res, ChannelResult)
    assert res.gain == "HG"
    assert res.channel == "G"
    assert isinstance(res.horizontal, DirectionResult)
    assert isinstance(res.vertical, DirectionResult)
    for d in (res.horizontal, res.vertical):
        assert d.profile.size > 0
        assert d.freqs.size > 0
        assert d.spectrum.size == d.freqs.size
        assert d.spectrum_smoothed.size == d.freqs.size
        assert np.isfinite(d.noise_floor)
        # cutoffs dict holds optional thresholds (MTF50/20/10 etc) —
        # may be None but the dict itself exists.
        assert isinstance(d.cutoffs, dict)


def test_analyze_channel_image_is_rotated_or_cropped():
    """analyze_channel rotates internally; the stored `image` is
    derived from the rotated input (may be cropped to the chart bbox
    or returned in full). Assert shape is compatible, not byte-exact.
    """
    img = _synthetic_chart_channel(h=64, w=64, period=4)
    res = analyze_channel(img, gain="LG", channel="R")
    assert res.image.ndim == 2
    # Stored image dims never exceed the input.
    assert res.image.shape[0] <= img.shape[0]
    assert res.image.shape[1] <= img.shape[1]


def test_spectrum_is_nonnegative():
    """Spectrum amplitudes are normalised magnitudes — must be ≥ 0."""
    img = _synthetic_chart_channel()
    res = analyze_channel(img, gain="HG", channel="B")
    for d in (res.horizontal, res.vertical):
        assert (d.spectrum >= 0).all()
        assert (d.spectrum_smoothed >= 0).all()
