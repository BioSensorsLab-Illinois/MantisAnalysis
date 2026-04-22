"""Verify GSense dual-gain Bayer extraction invariants (README.md:20-27)."""
from __future__ import annotations

import numpy as np
import pytest

from mantisanalysis.extract import (
    LOC,
    ORIGIN,
    extract_channel,
    extract_rgb_nir,
    split_and_extract,
    split_dual_gain,
)


def _synthetic_half(h: int = 16, w: int = 16) -> np.ndarray:
    """Tag each pixel with an int that lets us read back its (row, col)."""
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    return (rr * 100 + cc).astype(np.uint16)


def test_origin_and_loc_constants_match_spec() -> None:
    """LOC + ORIGIN are the numbers documented in README.md."""
    assert ORIGIN == (0, 0)
    assert LOC == {"B": (0, 0), "R": (0, 1), "G": (1, 0), "NIR": (1, 1)}


def test_split_dual_gain_halves() -> None:
    full = np.zeros((8, 16), dtype=np.uint16)
    full[:, 8:] = 1
    hg, lg = split_dual_gain(full)
    assert hg.shape == (8, 8) and lg.shape == (8, 8)
    assert hg.max() == 0
    assert lg.min() == 1


def test_extract_channel_offsets_match_readme() -> None:
    half = _synthetic_half(16, 16)
    # B @ (0,0): img[0::4, 0::4] — first sample at pixel (0, 0)
    assert extract_channel(half, "B")[0, 0] == half[0, 0]
    # R @ (0,1): img[0::4, 2::4] — first sample at pixel (0, 2)
    assert extract_channel(half, "R")[0, 0] == half[0, 2]
    # G @ (1,0): img[2::4, 0::4] — first sample at pixel (2, 0)
    assert extract_channel(half, "G")[0, 0] == half[2, 0]
    # NIR @ (1,1): img[2::4, 2::4] — first sample at pixel (2, 2)
    assert extract_channel(half, "NIR")[0, 0] == half[2, 2]


def test_extract_rgb_nir_returns_all_channels_with_quarter_size() -> None:
    half = _synthetic_half(32, 32)
    out = extract_rgb_nir(half)
    assert set(out.keys()) == {"R", "G", "B", "NIR"}
    for ch_img in out.values():
        assert ch_img.shape == (8, 8)


def test_split_and_extract_returns_hg_lg_tuple() -> None:
    full = _synthetic_half(32, 64)  # 32 rows, 64 cols (halves are 32×32)
    hg, lg = split_and_extract(full)
    assert set(hg.keys()) == set(lg.keys()) == {"R", "G", "B", "NIR"}


def test_unknown_channel_raises() -> None:
    half = _synthetic_half(8, 8)
    with pytest.raises(KeyError):
        extract_channel(half, "does-not-exist")
