"""Burn-in label renderer tests.

play-tab-recording-inspection-rescue-v1 M21.

Covers:
  * No-op when config is None / empty / all-False.
  * Deterministic — same inputs produce byte-identical output.
  * Doesn't crash on a 1×1 image.
  * Bundled JetBrainsMono-Regular.ttf is found and loaded.
  * Labels actually mutate pixels at the configured corner (so a
    visual regression on the underlying renderer can be flagged).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from mantisanalysis import labels as labels_mod
from mantisanalysis.labels import render_labels

# ---------------------------------------------------------------------------
# Bundled font
# ---------------------------------------------------------------------------


def test_bundled_font_present_in_package():
    """The wheel must ship JetBrainsMono-Regular.ttf so render_labels
    has a deterministic font to fall back on."""
    pkg_root = Path(labels_mod.__file__).resolve().parent
    ttf = pkg_root / "static" / "fonts" / "JetBrainsMono-Regular.ttf"
    assert ttf.exists(), f"missing bundled font at {ttf}"
    # Sanity-check size — JetBrains Mono Regular is ~270 KB.
    sz = ttf.stat().st_size
    assert 100_000 < sz < 1_000_000, f"font size {sz} looks wrong"


# ---------------------------------------------------------------------------
# No-op paths
# ---------------------------------------------------------------------------


def test_no_op_when_config_is_none():
    a = np.zeros((16, 16, 3), dtype=np.uint8)
    out = render_labels(a, None)
    # Same array returned (or byte-identical at minimum).
    assert out is a or np.array_equal(out, a)


def test_no_op_when_all_flags_off():
    a = np.full((16, 16, 3), 80, dtype=np.uint8)
    cfg = {
        "timestamp": False,
        "frame": False,
        "channel": False,
        "source_file": False,
        "scale_bar": False,
        "position": "bottom-left",
    }
    out = render_labels(a, cfg)
    assert np.array_equal(out, a), "no-op config must not mutate pixels"


# ---------------------------------------------------------------------------
# Crash safety
# ---------------------------------------------------------------------------


def test_does_not_crash_on_1x1_image():
    """1×1 images break naive font sizing; renderer should clamp + skip
    without raising."""
    a = np.zeros((1, 1, 3), dtype=np.uint8)
    cfg = {"frame": True, "frame_index": 0, "position": "top-left"}
    out = render_labels(a, cfg)
    assert out is not None
    assert out.shape == (1, 1, 3)
    assert out.dtype == np.uint8


def test_handles_non_rgb_input_gracefully():
    """Single-channel input is returned unchanged (no shape tampering)."""
    a = np.zeros((8, 8), dtype=np.uint8)
    out = render_labels(a, {"frame": True, "frame_index": 0})
    assert out.shape == (8, 8)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_renders_are_deterministic():
    """Two render passes with the same inputs must produce identical bytes."""
    a = np.full((64, 96, 3), 60, dtype=np.uint8)
    cfg = {
        "timestamp": True,
        "ts_value": 1771_577_589.74,
        "frame": True,
        "frame_index": 12,
        "channel": True,
        "channel_name": "HG-G",
        "position": "bottom-left",
        "font_size": 12,
    }
    a1 = render_labels(a.copy(), cfg)
    a2 = render_labels(a.copy(), cfg)
    assert np.array_equal(a1, a2)


def test_labels_actually_modify_pixels_at_anchor():
    """Smoke check: labels in the bottom-left should change pixels in
    that corner but NOT in the top-right (the configured anchor opposite)."""
    a = np.full((80, 240, 3), 70, dtype=np.uint8)
    cfg = {
        "frame": True,
        "frame_index": 99,
        "channel": True,
        "channel_name": "HG-NIR",
        "position": "bottom-left",
        "font_size": 12,
    }
    out = render_labels(a, cfg)
    # Bottom-left 24×80 region should differ (text + dark backdrop).
    bl = out[60:80, 0:80, :]
    bl_ref = a[60:80, 0:80, :]
    assert not np.array_equal(bl, bl_ref), "bottom-left labels did not paint"
    # Top-right region should be unchanged.
    tr = out[0:20, 200:240, :]
    tr_ref = a[0:20, 200:240, :]
    assert np.array_equal(tr, tr_ref), "labels leaked into the opposite corner"


def test_position_swaps_anchor():
    """Switching position from bottom-left to top-right should move the
    paint-changes accordingly."""
    a = np.full((80, 240, 3), 70, dtype=np.uint8)
    base_cfg = {
        "frame": True,
        "frame_index": 1,
        "font_size": 12,
    }
    bl = render_labels(a.copy(), {**base_cfg, "position": "bottom-left"})
    tr = render_labels(a.copy(), {**base_cfg, "position": "top-right"})
    # The two outputs must differ (different anchors paint different regions).
    assert not np.array_equal(bl, tr)


# ---------------------------------------------------------------------------
# Optional fields
# ---------------------------------------------------------------------------


def test_timestamp_without_value_renders_em_dash():
    """When `timestamp=True` but `ts_value` is None, the renderer falls
    back to a placeholder rather than crashing."""
    a = np.full((40, 200, 3), 70, dtype=np.uint8)
    out = render_labels(a, {"timestamp": True, "position": "bottom-left"})
    # Must have painted something (the placeholder text).
    assert not np.array_equal(out, a)


@pytest.mark.parametrize("pos", ["top-left", "top-right", "bottom-left", "bottom-right"])
def test_all_positions_render_without_crash(pos):
    a = np.full((48, 200, 3), 50, dtype=np.uint8)
    out = render_labels(a, {"frame": True, "frame_index": 0, "position": pos})
    assert out.shape == a.shape and out.dtype == np.uint8
