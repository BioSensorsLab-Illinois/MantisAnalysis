"""Thin matplotlib-only figure helpers used by the web server.

The existing `*_render.py` modules carry Qt wrapper factories that stitch
multiple figures into a QMainWindow. For the web GUI we only need the
underlying figure builders plus a "to PNG bytes" helper. This module
provides both without pulling in Qt.

Import cost: matplotlib with the Agg backend. No Qt anywhere.
"""

from __future__ import annotations

import io

import matplotlib

matplotlib.use("Agg")  # must precede any pyplot import

import matplotlib.pyplot as plt  # noqa: F401 — forces Agg binding to stick
from matplotlib.figure import Figure

# Light / dark theme tokens, matching the web UI palette (see web/src/shared.jsx).
THEMES = {
    "light": {"fig_face": "#ffffff", "text": "#14181f"},
    "dark": {"fig_face": "#181b21", "text": "#e8eaed"},
}


def figure_to_png(fig: Figure, *, dpi: int = 110) -> bytes:
    """Render a matplotlib Figure to a PNG blob."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return buf.getvalue()


def theme_tokens(theme: str) -> tuple[str, str]:
    """Return (fig_face, text) for a named theme; falls back to light."""
    t = THEMES.get(theme, THEMES["light"])
    return t["fig_face"], t["text"]


# ---------------------------------------------------------------------------
# USAF figures
# ---------------------------------------------------------------------------


def build_usaf_pngs(
    channel_images,
    specs,
    *,
    mode: str = "rgb",
    transform=None,
    threshold: float = 0.2,
    theme: str = "light",
) -> list[bytes]:
    """Delegates to `mantisanalysis.usaf_render.build_analysis_figures` and
    returns one PNG per figure. Args mirror that function exactly so the
    server passes them through."""
    from .usaf_render import build_analysis_figures

    transform = transform or {"rotation": 0, "flip_h": False, "flip_v": False}
    figs = build_analysis_figures(
        channel_images,
        specs,
        mode=mode,
        transform=transform,
        threshold=float(threshold),
    )
    return [figure_to_png(f) for f in figs]


# ---------------------------------------------------------------------------
# FPN figures
# ---------------------------------------------------------------------------


def build_fpn_pngs(result, *, theme: str = "light") -> dict[str, bytes]:
    """Produce every FPN panel as a PNG blob. Extras (autocorr / 1-D
    PSDs / hot-pixel map) are appended so offline PDF exports include
    them alongside the classic overview / rowcol / map / PSD."""
    from .fpn_render import (
        build_autocorr_fig,
        build_hotpix_fig,
        build_map_fig,
        build_overview_fig,
        build_psd1d_fig,
        build_psd_fig,
        build_rowcol_fig,
    )

    fig_face, text = theme_tokens(theme)
    out: dict[str, bytes] = {}
    for name, fn in (
        ("overview", build_overview_fig),
        ("rowcol", build_rowcol_fig),
        ("map", build_map_fig),
        ("psd", build_psd_fig),
        ("autocorr", build_autocorr_fig),
        ("psd1d", build_psd1d_fig),
        ("hotpix", build_hotpix_fig),
    ):
        fig = fn(result, fig_face=fig_face, text=text)
        out[name] = figure_to_png(fig)
    return out


# ---------------------------------------------------------------------------
# DoF figures
# ---------------------------------------------------------------------------


def build_dof_pngs(result, *, theme: str = "light") -> dict[str, bytes]:
    """Every DoF panel as a PNG. Adds the Gaussian-fit, tilt-plane, and
    metric-compare figures on top of the historical 3 (heatmap / line
    scan / points) for offline PDF-style reports."""
    from .dof_render import (
        build_gaussian_fit_fig,
        build_heatmap_fig,
        build_line_scan_fig,
        build_metric_compare_fig,
        build_points_fig,
        build_tilt_plane_fig,
    )

    fig_face, text = theme_tokens(theme)
    out: dict[str, bytes] = {}
    for name, fn in (
        ("heatmap", build_heatmap_fig),
        ("linescan", build_line_scan_fig),
        ("points", build_points_fig),
        ("gaussian", build_gaussian_fit_fig),
        ("tilt", build_tilt_plane_fig),
    ):
        fig = fn(result, fig_face=fig_face, text=text)
        out[name] = figure_to_png(fig)
    # metric_compare needs the raw image; use result.image (the analysis frame)
    fig = build_metric_compare_fig(result, result.image, fig_face=fig_face, text=text)
    out["metric_compare"] = figure_to_png(fig)
    return out


def build_dof_multi_chromatic_png(results, *, theme: str = "light") -> bytes:
    """Single chromatic-shift figure over several channels' results."""
    from .dof_render import build_chromatic_shift_fig

    fig_face, text = theme_tokens(theme)
    fig = build_chromatic_shift_fig(list(results), fig_face=fig_face, text=text)
    return figure_to_png(fig)
