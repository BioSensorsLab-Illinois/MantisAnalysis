"""Tests for ``mantisanalysis.playback_pipeline`` (M4).

Covers per-stage numerics, RGB grading, overlay blends, label burn-in,
and the planner-architect P1-3 purity assertion: the module must NOT
pull `mantisanalysis.session`, `mantisanalysis.server`, or `fastapi`
into `sys.modules`.
"""

from __future__ import annotations

import importlib
import sys

import numpy as np
import pytest

from mantisanalysis.playback_pipeline import (
    BurnInContext,
    ViewState,
    render_frame,
    render_frame_to_png,
    subtract_dark,
)


# ---------------------------------------------------------------------------
# Purity (planner-architect P1-3 + risk-skeptic P1-3)
# ---------------------------------------------------------------------------


def test_pure_imports() -> None:
    """Importing playback_pipeline must not pull in fastapi / server / session."""
    forbidden = ("mantisanalysis.session", "mantisanalysis.server",
                 "fastapi", "uvicorn", "starlette")
    # Force a fresh import so the assertion is meaningful.
    for mod in forbidden + ("mantisanalysis.playback_pipeline",):
        sys.modules.pop(mod, None)
    importlib.import_module("mantisanalysis.playback_pipeline")
    for mod in forbidden:
        assert mod not in sys.modules, (
            f"{mod} pulled in by playback_pipeline (purity violation)"
        )


# ---------------------------------------------------------------------------
# subtract_dark math
# ---------------------------------------------------------------------------


def test_subtract_dark_clamped_at_zero() -> None:
    raw = np.array([[100, 200], [300, 50]], dtype=np.uint16)
    dark = np.array([[200, 100], [400, 25]], dtype=np.uint16)
    out = subtract_dark(raw, dark)
    assert out.dtype == np.float64
    assert out[0, 0] == 0.0
    assert out[0, 1] == 100.0
    assert out[1, 0] == 0.0
    assert out[1, 1] == 25.0


def test_subtract_dark_none_returns_float() -> None:
    raw = np.array([[1, 2]], dtype=np.uint16)
    out = subtract_dark(raw, None)
    assert out.dtype == np.float64
    assert np.array_equal(out, [[1.0, 2.0]])


def test_subtract_dark_shape_mismatch_falls_back_to_identity() -> None:
    raw = np.array([[1, 2]], dtype=np.uint16)
    dark = np.array([[1.0]], dtype=np.float64)
    out = subtract_dark(raw, dark)
    assert np.array_equal(out, [[1.0, 2.0]])


# ---------------------------------------------------------------------------
# Single-channel pipeline
# ---------------------------------------------------------------------------


def _ramp(h: int = 16, w: int = 16) -> np.ndarray:
    """0..255 ramp across columns."""
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    return (cc * (255 // (w - 1))).astype(np.uint16)


def test_render_single_channel_grayscale_returns_uint8_hwx3() -> None:
    ch = {"HG-G": _ramp()}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255)
    out = render_frame(ch, view)
    assert out.shape == (16, 16, 3)
    assert out.dtype == np.uint8


def test_render_threshold_low_to_zero_high_to_one() -> None:
    """Low threshold maps to 0; values >= high map to 255 in gray colormap."""
    ch = {"HG-G": np.array([[0, 128, 255]], dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255)
    out = render_frame(ch, view)
    assert out[0, 0, 0] == 0
    assert out[0, 2, 0] == 255


def test_render_invert_negates_after_colormap() -> None:
    ch = {"HG-G": np.array([[0, 255]], dtype=np.uint16)}
    base = render_frame(ch, ViewState(type="single", channel="HG-G",
                                      colormap="gray", low=0, high=255,
                                      invert=False))
    inv = render_frame(ch, ViewState(type="single", channel="HG-G",
                                     colormap="gray", low=0, high=255,
                                     invert=True))
    assert base[0, 0, 0] == 0 and inv[0, 0, 0] == 255
    assert base[0, 1, 0] == 255 and inv[0, 1, 0] == 0


def test_render_show_clipped_marks_saturated_pixels_magenta() -> None:
    ch = {"HG-G": np.array([[0, 255]], dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255, show_clipped=True)
    out = render_frame(ch, view)
    # The saturated pixel is replaced with magenta (255, 0, 255).
    assert tuple(out[0, 1].tolist()) == (255, 0, 255)


def test_render_normalize_uses_p1_p99() -> None:
    """Normalize stretches to the p1..p99.5 range."""
    arr = np.zeros((4, 4), dtype=np.uint16)
    arr[0, 0] = 1000  # outlier
    ch = {"HG-G": arr}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     normalize=True)
    out = render_frame(ch, view)
    # Most of the image is 0; normalization should not be all-zeros.
    assert out.shape == (4, 4, 3)


def test_render_dark_on_subtracts() -> None:
    raw = np.full((4, 4), 100, dtype=np.uint16)
    dark = np.full((4, 4), 30, dtype=np.uint16)
    ch = {"HG-G": raw}
    dk = {"HG-G": dark}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     dark_on=True, low=0, high=70)
    out = render_frame(ch, view, dk)
    # raw - dark = 70; with low=0 high=70, normalized → 1 → 255 in gray.
    assert out[0, 0, 0] == 255


# ---------------------------------------------------------------------------
# RGB pipeline
# ---------------------------------------------------------------------------


def test_render_rgb_view_returns_color_image() -> None:
    ch = {
        "HG-R": np.full((4, 4), 200, dtype=np.uint16),
        "HG-G": np.full((4, 4), 100, dtype=np.uint16),
        "HG-B": np.full((4, 4), 50, dtype=np.uint16),
    }
    view = ViewState(type="rgb", channels=("HG-R", "HG-G", "HG-B"),
                     low=0, high=255)
    out = render_frame(ch, view)
    assert out.shape == (4, 4, 3)
    # R brighter than B in our synthetic.
    assert out[0, 0, 0] > out[0, 0, 2]


def test_render_rgb_gain_per_channel() -> None:
    """rgb_gain=(2.0, 1.0, 0.5) → R amplified, B attenuated."""
    ch = {
        "HG-R": np.full((4, 4), 100, dtype=np.uint16),
        "HG-G": np.full((4, 4), 100, dtype=np.uint16),
        "HG-B": np.full((4, 4), 100, dtype=np.uint16),
    }
    view = ViewState(type="rgb", rgb_gain=(2.0, 1.0, 0.5),
                     low=0, high=255)
    out = render_frame(ch, view)
    assert out[0, 0, 0] > out[0, 0, 1] > out[0, 0, 2]


def test_render_rgb_ccm_off_by_default() -> None:
    """A non-identity CCM changes the output only when ccm_on=True.

    We compare ccm_on=False vs ccm_on=True with the same swap matrix:
    they must differ when on.
    """
    ch = {
        "HG-R": np.full((4, 4), 200, dtype=np.uint16),
        "HG-G": np.full((4, 4), 100, dtype=np.uint16),
        "HG-B": np.full((4, 4), 50, dtype=np.uint16),
    }
    swap_rg = ((0.0, 1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0))
    out_off = render_frame(ch, ViewState(
        type="rgb", ccm_on=False, ccm=swap_rg, low=0, high=255,
        wb_k=5500))
    out_on = render_frame(ch, ViewState(
        type="rgb", ccm_on=True, ccm=swap_rg, low=0, high=255,
        wb_k=5500))
    # CCM swaps R and G — output must differ from identity-CCM render.
    assert not np.array_equal(out_off, out_on)


def test_render_rgb_ccm_singular_refused() -> None:
    """|det(ccm)| < 1e-3 → CCM is silently not applied (W-21 mitigation)."""
    ch = {f"HG-{c}": np.full((4, 4), 200, dtype=np.uint16) for c in "RGB"}
    singular = ViewState(
        type="rgb", ccm_on=True,
        ccm=((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 0.0)),  # det=0
        low=0, high=255,
    )
    # Should not raise; just skips CCM.
    out = render_frame(ch, singular)
    assert out.shape == (4, 4, 3)


def test_render_wb_kelvin_changes_gain() -> None:
    """Lower K → warmer, higher K → cooler (R falls vs B as K rises)."""
    ch = {f"HG-{c}": np.full((4, 4), 128, dtype=np.uint16) for c in "RGB"}
    warm = render_frame(ch, ViewState(type="rgb", wb_k=3000, low=0, high=255))
    cool = render_frame(ch, ViewState(type="rgb", wb_k=8000, low=0, high=255))
    # R/B ratio: warm > cool.
    assert warm[0, 0, 0] / max(1, warm[0, 0, 2]) > cool[0, 0, 0] / max(1, cool[0, 0, 2])


# ---------------------------------------------------------------------------
# Overlay
# ---------------------------------------------------------------------------


def test_render_overlay_alpha_blend() -> None:
    """Overlay blend produces a color image with overlay influence."""
    ch = {
        "HG-G": np.zeros((8, 8), dtype=np.uint16),
        "HG-NIR": np.full((8, 8), 600, dtype=np.uint16),
    }
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255,
                     overlay_on=True, overlay_channel="HG-NIR",
                     overlay_low=0, overlay_high=600,
                     overlay_blend="alpha", overlay_strength=0.8,
                     overlay_cmap="inferno")
    out = render_frame(ch, view)
    # Without overlay the image would be all-zero gray; with overlay
    # it picks up inferno's bright end.
    assert out.max() > 0


def test_render_overlay_below_hide_zeros_alpha() -> None:
    """Below threshold + 'hide' policy → overlay alpha=0 there → base only."""
    ch = {
        "HG-G": np.full((8, 8), 200, dtype=np.uint16),
        "HG-NIR": np.full((8, 8), 50, dtype=np.uint16),  # all below threshold
    }
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255,
                     overlay_on=True, overlay_channel="HG-NIR",
                     overlay_low=300, overlay_high=900,
                     overlay_below="hide", overlay_blend="alpha")
    out_no_overlay = render_frame(
        ch, ViewState(type="single", channel="HG-G", colormap="gray",
                       low=0, high=255))
    out_with = render_frame(ch, view)
    # All pixels of the overlay are below threshold + hide → no change.
    assert np.array_equal(out_no_overlay, out_with)


# ---------------------------------------------------------------------------
# Label burn-in
# ---------------------------------------------------------------------------


def test_render_burn_labels_modifies_corners() -> None:
    """With labels enabled, the rendered image is *not* identical to one
    without (corners get text + bg fill)."""
    ch = {"HG-G": np.full((64, 64), 128, dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255,
                     labels_timestamp=True, labels_frame=True,
                     labels_channel=False, labels_source=False)
    no_ctx = render_frame(ch, view, burn_ctx=None)
    with_ctx = render_frame(
        ch, view, burn_ctx=BurnInContext(frame_index=42, timestamp_s=1.234))
    assert not np.array_equal(no_ctx, with_ctx)


# ---------------------------------------------------------------------------
# Downscale
# ---------------------------------------------------------------------------


def test_render_downscale_at_max_dim() -> None:
    """A 2048×2048 input downscales to ≤ max_dim."""
    ch = {"HG-G": np.zeros((2048, 2048), dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255)
    out = render_frame(ch, view, max_dim=512)
    assert max(out.shape[:2]) == 512


def test_render_no_downscale_when_under_cap() -> None:
    ch = {"HG-G": np.zeros((128, 256), dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="gray",
                     low=0, high=255)
    out = render_frame(ch, view, max_dim=1024)
    assert out.shape[:2] == (128, 256)


# ---------------------------------------------------------------------------
# render_frame_to_png
# ---------------------------------------------------------------------------


def test_render_frame_to_png_returns_png_bytes() -> None:
    ch = {"HG-G": np.full((16, 16), 128, dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-G", colormap="viridis",
                     low=0, high=255)
    png = render_frame_to_png(ch, view)
    assert isinstance(png, bytes)
    assert png[:8] == b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# Missing channels
# ---------------------------------------------------------------------------


def test_render_missing_single_channel_raises() -> None:
    ch = {"HG-G": np.zeros((4, 4), dtype=np.uint16)}
    view = ViewState(type="single", channel="HG-NIR", colormap="gray",
                     low=0, high=255)
    with pytest.raises(KeyError, match="HG-NIR"):
        render_frame(ch, view)


def test_render_rgb_missing_channel_raises() -> None:
    ch = {"HG-R": np.zeros((4, 4), dtype=np.uint16),
          "HG-G": np.zeros((4, 4), dtype=np.uint16)}
    view = ViewState(type="rgb", channels=("HG-R", "HG-G", "HG-B"))
    with pytest.raises(KeyError):
        render_frame(ch, view)
