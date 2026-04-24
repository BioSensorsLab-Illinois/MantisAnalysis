"""ISP-mode registry + extraction correctness per mode (isp-modes-v1).

Every mode in ``isp_modes.ALL_MODES`` gets a parametric test that:
  * builds a tagged synthetic half-frame using the same trick as
    tests/unit/test_bayer.py (pixel value = row*100 + col),
  * runs ``extract.extract_by_spec`` using the mode's declared locs /
    defaults,
  * asserts each slot's first sample matches the expected pixel
    coordinate computed from the mode geometry.

The existing rgb_nir mode is covered twice — once here (mode-driven
path) and once in tests/unit/test_bayer.py (legacy path) — to catch
drift between them.
"""
from __future__ import annotations

import numpy as np
import pytest

from mantisanalysis import isp_modes
from mantisanalysis.extract import extract_by_spec


def _synthetic_half(h: int = 32, w: int = 32) -> np.ndarray:
    """Pixel value encodes its (row, col) for round-trip assertions."""
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    return (rr * 100 + cc).astype(np.uint16)


@pytest.mark.parametrize("mode", sorted(isp_modes.ALL_MODES.values(),
                                        key=lambda m: m.id))
def test_mode_extraction_matches_declared_locs(mode: isp_modes.ISPMode) -> None:
    """Every channel's first-sample pixel matches the formula."""
    h = max(16, mode.default_outer_stride[0] * 4)
    w = max(16, mode.default_outer_stride[1] * 4)
    half = _synthetic_half(h, w)
    for spec in mode.channels:
        arr = extract_by_spec(half, spec.loc,
                              mode.default_origin,
                              mode.default_sub_step,
                              mode.default_outer_stride)
        r = spec.loc[0] * mode.default_sub_step[0] + mode.default_origin[0]
        c = spec.loc[1] * mode.default_sub_step[1] + mode.default_origin[1]
        assert arr.shape[0] > 0 and arr.shape[1] > 0, (
            f"{mode.id}/{spec.slot_id}: empty extraction at "
            f"origin={mode.default_origin} step={mode.default_sub_step}"
        )
        assert int(arr[0, 0]) == int(half[r, c]), (
            f"{mode.id}/{spec.slot_id}: expected first sample at "
            f"({r},{c}); got {int(arr[0, 0])} vs {int(half[r, c])}"
        )


def test_rgb_nir_matches_legacy_extract_by_spec() -> None:
    """Extraction under rgb_nir defaults matches legacy extract_rgb_nir.

    Guards against future drift if someone changes rgb_nir defaults in
    isp_modes.py without updating extract.py (or vice versa).
    """
    from mantisanalysis.extract import extract_rgb_nir
    half = _synthetic_half(16, 16)
    mode = isp_modes.get_mode("rgb_nir")
    legacy = extract_rgb_nir(half)
    for spec in mode.channels:
        via_spec = extract_by_spec(half, spec.loc,
                                   mode.default_origin,
                                   mode.default_sub_step,
                                   mode.default_outer_stride)
        assert np.array_equal(via_spec, legacy[spec.default_name]), (
            f"rgb_nir slot {spec.slot_id}: by-spec ≠ legacy extract_rgb_nir"
        )


def test_normalize_config_rejects_invalid_geometry() -> None:
    mode = isp_modes.get_mode("rgb_nir")
    with pytest.raises(ValueError):
        isp_modes.normalize_config(mode, {"outer_stride": [0, 4]})
    with pytest.raises(ValueError):
        isp_modes.normalize_config(mode, {"sub_step": [0, 2]})
    with pytest.raises(ValueError):
        isp_modes.normalize_config(mode, {"origin": [-1, 0]})


def test_normalize_config_drops_non_renameable_slots() -> None:
    """Stale rename entries for non-renameable slots must be silently dropped.

    Prevents a rogue localStorage state on the frontend from pushing a
    rename for, say, the ``b`` slot (which is not renameable in v1).
    """
    mode = isp_modes.get_mode("rgb_nir")
    cfg = isp_modes.normalize_config(mode, {
        "channel_name_overrides": {"nir": "UV-650", "b": "NOPE", "r": "also-nope"},
    })
    assert cfg["channel_name_overrides"] == {"nir": "UV-650"}


def test_build_channel_keys_respects_rename() -> None:
    mode = isp_modes.get_mode("rgb_nir")
    keys = isp_modes.build_channel_keys(
        mode, {"nir": "UV-650"}, include_luminance=True,
    )
    assert "HG-UV-650" in keys and "LG-UV-650" in keys
    assert "HG-NIR" not in keys and "LG-NIR" not in keys
    assert "HG-Y" in keys and "LG-Y" in keys


def test_polarization_dual_emits_hg_lg_prefixed_keys() -> None:
    mode = isp_modes.get_mode("polarization_dual")
    keys = isp_modes.build_channel_keys(mode, {}, include_luminance=False)
    assert set(keys) == {
        "HG-I0", "HG-I45", "HG-I90", "HG-I135",
        "LG-I0", "LG-I45", "LG-I90", "LG-I135",
    }


def test_bare_single_has_one_channel() -> None:
    mode = isp_modes.get_mode("bare_single")
    assert not mode.dual_gain
    assert mode.slot_default_names() == ("L",)
