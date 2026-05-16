"""HDR fusion (saturation-aware switch + Mertens) tests.

play-tab-recording-inspection-rescue-v1 M25.

Covers:
  * `fuse_hdr` switch path: HG below threshold → HG; HG above → LG·R.
  * `fuse_hdr` mertens path: smooth blend; output between HG and LG·R.
  * Shape mismatch raises ValueError.
  * `add_hdr_channels` emits HDR-{R,G,B,NIR,Y} with correct shapes.
  * No-op when required HG-/LG- channels are missing.
  * `_make_synthetic_h5` fixtures load via SessionStore and produce
    HDR-* channels alongside HG-/LG-.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from mantisanalysis.hdr_fusion import add_hdr_channels, fuse_hdr

# ---------------------------------------------------------------------------
# fuse_hdr
# ---------------------------------------------------------------------------


def test_fuse_hdr_switch_keeps_hg_below_threshold():
    hg = np.full((4, 4), 30000.0, dtype=np.float32)  # below default threshold 60000
    lg = np.full((4, 4), 1500.0, dtype=np.float32)  # would scale to 24000
    out = fuse_hdr(
        hg,
        lg,
        params={"fusion": "switch", "hg_saturation_threshold": 60000, "hg_lg_gain_ratio": 16.0},
    )
    assert np.allclose(out, 30000.0)
    assert out.dtype == np.float32


def test_fuse_hdr_switch_replaces_hg_above_threshold():
    hg = np.full((4, 4), 65000.0, dtype=np.float32)  # at saturation
    lg = np.full((4, 4), 1500.0, dtype=np.float32)
    out = fuse_hdr(
        hg,
        lg,
        params={"fusion": "switch", "hg_saturation_threshold": 60000, "hg_lg_gain_ratio": 16.0},
    )
    # 1500 × 16 = 24000
    assert np.allclose(out, 24000.0)


def test_fuse_hdr_mertens_blends_smoothly():
    """At HG = threshold - knee/2, output should be a smooth blend
    between HG and LG·R, not a hard switch."""
    hg = np.full((4, 4), 58000.0, dtype=np.float32)
    lg = np.full((4, 4), 3000.0, dtype=np.float32)  # → 48000 scaled
    out = fuse_hdr(
        hg,
        lg,
        params={
            "fusion": "mertens",
            "hg_saturation_threshold": 60000,
            "hg_lg_gain_ratio": 16.0,
            "knee_width": 4000,
        },
    )
    # Output should be between LG·R and HG.
    assert 48000.0 < out.mean() < 58000.0


def test_fuse_hdr_mertens_at_threshold_close_to_lg_scaled():
    """Right at saturation, mertens weight ≈ 0 → output ≈ LG·R."""
    hg = np.full((4, 4), 60000.0, dtype=np.float32)
    lg = np.full((4, 4), 3000.0, dtype=np.float32)  # → 48000 scaled
    out = fuse_hdr(
        hg,
        lg,
        params={
            "fusion": "mertens",
            "hg_saturation_threshold": 60000,
            "knee_width": 4000,
        },
    )
    assert abs(float(out.mean()) - 48000.0) < 100.0


def test_fuse_hdr_default_params_use_switch():
    hg = np.full((2, 2), 30000.0, dtype=np.float32)
    lg = np.full((2, 2), 1500.0, dtype=np.float32)
    out = fuse_hdr(hg, lg)  # no params → switch defaults
    assert np.allclose(out, 30000.0)


def test_fuse_hdr_shape_mismatch_raises():
    hg = np.zeros((4, 4), dtype=np.float32)
    lg = np.zeros((4, 8), dtype=np.float32)
    with pytest.raises(ValueError, match="shape mismatch"):
        fuse_hdr(hg, lg)


def test_fuse_hdr_handles_uint16_input():
    """Real GSense data is uint16; fuse_hdr must accept it."""
    hg = np.full((4, 4), 65000, dtype=np.uint16)
    lg = np.full((4, 4), 1500, dtype=np.uint16)
    out = fuse_hdr(hg, lg)
    assert out.dtype == np.float32
    # Above default threshold → LG·R = 24000
    assert np.allclose(out, 24000.0)


# ---------------------------------------------------------------------------
# add_hdr_channels
# ---------------------------------------------------------------------------


def test_add_hdr_channels_emits_five_channels():
    chs = {}
    for c in ("R", "G", "B", "NIR"):
        chs[f"HG-{c}"] = np.full((4, 4), 30000.0, dtype=np.float32)
        chs[f"LG-{c}"] = np.full((4, 4), 1500.0, dtype=np.float32)
    add_hdr_channels(chs)
    for c in ("R", "G", "B", "NIR", "Y"):
        assert f"HDR-{c}" in chs, f"missing HDR-{c}"
        assert chs[f"HDR-{c}"].shape == (4, 4)


def test_add_hdr_channels_y_is_rec601_luma():
    chs = {}
    for c, val in (("R", 30000.0), ("G", 20000.0), ("B", 10000.0), ("NIR", 5000.0)):
        chs[f"HG-{c}"] = np.full((2, 2), val, dtype=np.float32)
        chs[f"LG-{c}"] = np.zeros((2, 2), dtype=np.float32)
    add_hdr_channels(chs)
    expected_y = 0.299 * 30000 + 0.587 * 20000 + 0.114 * 10000
    assert np.allclose(chs["HDR-Y"], expected_y, atol=1e-1)


def test_add_hdr_channels_no_op_when_missing_keys():
    """No HG-NIR → don't synthesize anything (idempotent on partial dicts)."""
    chs = {
        "HG-R": np.zeros((4, 4), dtype=np.float32),
        "HG-G": np.zeros((4, 4), dtype=np.float32),
        # HG-B + HG-NIR missing
        "LG-R": np.zeros((4, 4), dtype=np.float32),
    }
    before = set(chs.keys())
    add_hdr_channels(chs)
    after = set(chs.keys())
    assert before == after


# ---------------------------------------------------------------------------
# Integration: SessionStore extract_frame produces HDR-* keys
# ---------------------------------------------------------------------------


def test_session_extract_frame_emits_hdr_channels(tmp_path: Path):
    from mantisanalysis.session import SessionStore
    from tests.unit.test_session_frames import _make_synthetic_h5

    p = _make_synthetic_h5(tmp_path / "rec.h5", n_frames=2, exposure_s=0.1)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        chs = src.extract_frame(0)
        for c in ("R", "G", "B", "NIR", "Y"):
            assert f"HDR-{c}" in chs, f"extract_frame missing HDR-{c}"
        # Same shape as the corresponding HG channel.
        assert chs["HDR-R"].shape == chs["HG-R"].shape
    finally:
        store.clear()


def test_summary_dict_lists_hdr_channels(tmp_path: Path):
    """The frontend dropdown reads from `recording.channels`; HDR-* must
    appear in the SourceSummary so the source-mode dropdown lights up."""
    from mantisanalysis.session import SessionStore, _summary_dict
    from tests.unit.test_session_frames import _make_synthetic_h5

    p = _make_synthetic_h5(tmp_path / "rec.h5", n_frames=2, exposure_s=0.1)
    store = SessionStore(max_entries=4)
    src = store.load_from_path(p)
    try:
        summary = _summary_dict(src)
        chs = set(summary["channels"])
        for c in ("R", "G", "B", "NIR", "Y"):
            assert f"HDR-{c}" in chs, f"summary['channels'] missing HDR-{c}"
    finally:
        store.clear()


# ---------------------------------------------------------------------------
# M27 — HDR baseline integration: mixed-saturation patch
# ---------------------------------------------------------------------------


def test_hdr_y_over_mixed_saturation_patch_matches_switch_expectation():
    """A 32×32 fixture with one corner clipped at HG saturation and one
    corner well below. Switch fusion must match HG·Y where HG is unclipped
    and LG·R·Y where HG is clipped. Validates the full HG → switch → HDR-Y
    pipeline at integration scope."""
    h, w = 32, 32
    threshold = 60000.0
    ratio = 16.0
    # Build per-channel HG/LG inputs where the right half of HG saturates
    # at 65000 and the left half holds a low value of 1000.
    chs: Dict[str, np.ndarray] = {}
    for c, base in (("R", 32000.0), ("G", 28000.0), ("B", 18000.0), ("NIR", 9000.0)):
        hg = np.full((h, w), base, dtype=np.float32)
        hg[:, w // 2 :] = 65000.0
        lg = np.where(
            hg < threshold,
            hg / ratio,
            (hg / ratio) + 200.0,
        ).astype(np.float32)
        chs[f"HG-{c}"] = hg
        chs[f"LG-{c}"] = lg
    add_hdr_channels(chs)
    # Unclipped half (left) → HDR ≈ HG → HDR-Y ≈ Rec.601 over HG-{R,G,B}.
    expected_unclipped = 0.299 * 32000.0 + 0.587 * 28000.0 + 0.114 * 18000.0
    assert np.allclose(chs["HDR-Y"][:, : w // 2], expected_unclipped, atol=1e-1)
    # Clipped half (right) → HDR ≈ LG·R → HDR-Y ≈ Rec.601 over LG-{R,G,B} · ratio.
    saturated_lg_r = (65000.0 / ratio) + 200.0  # same for R/G/B
    expected_clipped = (0.299 + 0.587 + 0.114) * (saturated_lg_r * ratio)
    assert np.allclose(chs["HDR-Y"][:, w // 2 :], expected_clipped, atol=1e-1)
    # Sanity: the two halves differ by the recovery margin (otherwise the
    # fixture wouldn't actually exercise the switch boundary).
    assert abs(expected_unclipped - expected_clipped) > 1.0


# ---------------------------------------------------------------------------
# B-0040 — per-render HDR fusion override (route-level)
# ---------------------------------------------------------------------------


def test_resolve_hdr_channels_no_op_for_switch():
    """The default 'switch' fusion is what the cache holds; the helper
    must return the input dict unchanged so we don't burn CPU re-fusing
    on every frame request."""
    from mantisanalysis.server import _resolve_hdr_channels

    chs = {
        "HG-R": np.zeros((4, 4), dtype=np.uint16),
        "LG-R": np.zeros((4, 4), dtype=np.uint16),
        "HG-G": np.zeros((4, 4), dtype=np.uint16),
        "LG-G": np.zeros((4, 4), dtype=np.uint16),
        "HG-B": np.zeros((4, 4), dtype=np.uint16),
        "LG-B": np.zeros((4, 4), dtype=np.uint16),
        "HG-NIR": np.zeros((4, 4), dtype=np.uint16),
        "LG-NIR": np.zeros((4, 4), dtype=np.uint16),
        "HDR-R": np.full((4, 4), 99.0, dtype=np.float32),
    }
    out = _resolve_hdr_channels(chs, "switch")
    assert out is chs
    assert out["HDR-R"][0, 0] == 99.0


def test_resolve_hdr_channels_mertens_re_fuses():
    """When fusion='mertens' the helper rebuilds HDR-R/G/B/NIR + HDR-Y
    from the cached HG/LG pairs; near-saturation pixels differ from the
    hard-switch result."""
    from mantisanalysis.server import _resolve_hdr_channels

    # HG near saturation → mertens blends with LG*ratio; switch picks
    # one or the other based on threshold. Use a value close to 60000.
    hg = np.full((2, 2), 59000.0, dtype=np.float32)
    lg = np.full((2, 2), 4000.0, dtype=np.float32)
    chs = {f"HG-{c}": hg.copy() for c in ("R", "G", "B", "NIR")}
    chs.update({f"LG-{c}": lg.copy() for c in ("R", "G", "B", "NIR")})
    # Pre-seed HDR-* with the hard-switch result.
    chs["HDR-R"] = hg.copy()
    chs["HDR-G"] = hg.copy()
    chs["HDR-B"] = hg.copy()
    chs["HDR-NIR"] = hg.copy()
    chs["HDR-Y"] = hg.copy()
    out = _resolve_hdr_channels(chs, "mertens")
    # HDR-R changed (smoothstep blend)
    assert not np.array_equal(out["HDR-R"], hg)
    # Re-computed Y is consistent with R/G/B (Rec 601 luma).
    expected_y = (0.299 * out["HDR-R"] + 0.587 * out["HDR-G"] + 0.114 * out["HDR-B"]).astype(
        np.float32
    )
    np.testing.assert_allclose(out["HDR-Y"], expected_y, rtol=1e-5)


def test_resolve_hdr_channels_skips_when_pairs_missing():
    """Sources that don't carry HG-/LG- pairs (e.g. image sources) just
    return the input unchanged, even with fusion='mertens'."""
    from mantisanalysis.server import _resolve_hdr_channels

    chs = {"R": np.zeros((4, 4)), "G": np.zeros((4, 4)), "B": np.zeros((4, 4))}
    out = _resolve_hdr_channels(chs, "mertens")
    assert out is chs
