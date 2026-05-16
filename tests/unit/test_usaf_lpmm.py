"""Verify the USAF 1951 lp/mm table formula and the canonical values."""

from __future__ import annotations

import math

import pytest

from mantisanalysis.usaf_groups import (
    USAF_ELEMENTS,
    USAF_GROUPS,
    USAF_LP_MM,
    lp_mm,
)


def test_groups_and_elements_constants() -> None:
    assert USAF_GROUPS == (0, 1, 2, 3, 4, 5)
    assert USAF_ELEMENTS == (1, 2, 3, 4, 5, 6)


@pytest.mark.parametrize(
    "group, elt, expected",
    [
        (0, 1, 1.00),
        (0, 6, 1.78),
        (1, 1, 2.00),
        (1, 6, 3.56),
        (2, 1, 4.00),
        (2, 6, 7.13),
        (3, 1, 8.00),
        (3, 6, 14.30),
        (4, 1, 16.00),
        (4, 6, 28.51),
        (5, 1, 32.00),
        (5, 6, 57.02),
    ],
)
def test_canonical_lp_mm_values(group: int, elt: int, expected: float) -> None:
    """Values cited in README.md and shown in the chart sidebar."""
    assert lp_mm(group, elt) == pytest.approx(expected, rel=2e-2)


def test_formula_matches_table() -> None:
    for g in USAF_GROUPS:
        for e in USAF_ELEMENTS:
            expected = 2.0 ** (g + (e - 1) / 6.0)
            assert USAF_LP_MM[g][e - 1] == pytest.approx(expected, rel=1e-12)
            assert lp_mm(g, e) == pytest.approx(expected, rel=1e-12)


def test_each_step_is_octave_root_of_two() -> None:
    """Each successive element is 2^(1/6) times the previous one."""
    factor = math.pow(2.0, 1.0 / 6.0)
    for g in USAF_GROUPS:
        for e in range(1, 6):
            assert lp_mm(g, e + 1) / lp_mm(g, e) == pytest.approx(factor, rel=1e-12)
