"""Headless figure-builder smoke tests (Agg backend)."""
from __future__ import annotations

import numpy as np
import pytest
from matplotlib.figure import Figure


@pytest.fixture
def synthetic_half() -> np.ndarray:
    rng = np.random.default_rng(seed=1)
    h = 128
    base = 5000 + 2000 * np.sin(np.linspace(0, 8 * np.pi, h * h)).reshape(h, h)
    noise = rng.integers(-80, 80, size=(h, h))
    return (base + noise).astype(np.uint16)


@pytest.mark.headless
def test_build_usaf_figures_returns_figure_list(synthetic_half: np.ndarray) -> None:
    from mantisanalysis.usaf_groups import LineSpec
    from mantisanalysis.usaf_render import build_analysis_figures

    # Use a single-channel dict (`Y`) so the render sticks to one gain pane
    imgs = {"Y": synthetic_half}
    specs = [
        LineSpec(group=2, element=2, direction="H", p0=(40, 40), p1=(80, 40)),
        LineSpec(group=2, element=2, direction="V", p0=(50, 40), p1=(50, 80)),
    ]
    figs = build_analysis_figures(imgs, specs, mode="luminance",
                                  transform={"rotation": 0, "flip_h": False, "flip_v": False},
                                  threshold=0.2)
    assert len(figs) >= 1
    assert all(isinstance(f, Figure) for f in figs)


@pytest.mark.headless
def test_fpn_overview_figure(synthetic_half: np.ndarray) -> None:
    from mantisanalysis.fpn_analysis import FPNSettings, compute_fpn
    from mantisanalysis.fpn_render import build_overview_fig

    res = compute_fpn(synthetic_half, name="Y",
                      roi=(20, 20, 100, 100),
                      settings=FPNSettings())
    fig = build_overview_fig(res, fig_face="#ffffff", text="#1f2328")
    assert isinstance(fig, Figure)
    # Must contain multiple axes (2×2 grid)
    assert len(fig.axes) >= 4


@pytest.mark.headless
def test_dof_line_scan_figure(synthetic_half: np.ndarray) -> None:
    from mantisanalysis.dof_analysis import DoFPoint, analyze_dof
    from mantisanalysis.dof_render import build_line_scan_fig

    res = analyze_dof(synthetic_half, name="Y",
                      points=[DoFPoint(x=30, y=30)],
                      lines=[((10, 64), (120, 64))],
                      metric="laplacian", half_window=12,
                      build_heatmap=False)
    fig = build_line_scan_fig(res, fig_face="#ffffff", text="#1f2328")
    assert isinstance(fig, Figure)
