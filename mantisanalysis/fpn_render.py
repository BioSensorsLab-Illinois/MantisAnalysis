"""FPN analysis figures + tabbed Qt viewer.

Tabs:
  1. Overview         — 2x2 panel: ROI image / FPN map / histogram /
                         summary stat table
  2. Row & Column FPN — line plots of row-mean and col-mean profiles +
                         std bands; reveals row/column-banding noise
  3. 2-D FPN map      — large divergent display of (image − mean), with
                         optional row/col profile sidebars
  4. Power spectrum   — log-magnitude 2-D FFT; periodic patterns appear
                         as bright lines / spots
  5. Multi-channel    — when more than one channel is selected, a side-
                         by-side comparison of headline metrics + maps
"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.figure import Figure

from .fpn_analysis import FPNResult


CHANNEL_COLORS = {
    "R":   "#d62728",
    "G":   "#2ca02c",
    "B":   "#1f77b4",
    "NIR": "#7f7f7f",
    "Y":   "#000000",
    "L":   "#000000",
}


def _ch(name: str) -> str:
    return name.split("-")[-1] if "-" in name else name


def _color(name: str) -> str:
    return CHANNEL_COLORS.get(_ch(name), "#444444")


# ---------------------------------------------------------------------------
# Per-channel figure builders
# ---------------------------------------------------------------------------

def build_overview_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 7.6), facecolor=fig_face)
    gs = fig.add_gridspec(2, 2, hspace=0.30, wspace=0.30,
                          width_ratios=[1.05, 1.0], height_ratios=[1.0, 0.85])

    # Top-left: ROI image with kept-mask overlay
    ax_img = fig.add_subplot(gs[0, 0])
    _imshow_kept(ax_img, r, fig_face=fig_face, text=text)
    ax_img.set_title(f"{r.name}  ROI  ({r.n_kept}/{r.n_total} kept)",
                     color=text, fontsize=11)

    # Top-right: FPN map
    ax_map = fig.add_subplot(gs[0, 1])
    _imshow_fpn_map(ax_map, r, fig_face=fig_face, text=text)
    ax_map.set_title("FPN map  (image − mean)", color=text, fontsize=11)

    # Bottom-left: histogram
    ax_h = fig.add_subplot(gs[1, 0])
    _hist_panel(ax_h, r, text=text, fig_face=fig_face)

    # Bottom-right: stat table
    ax_t = fig.add_subplot(gs[1, 1])
    _stat_table(ax_t, r, text=text)

    fig.suptitle(
        f"FPN overview — {r.name}   "
        f"DSNU = {r.dsnu_dn:.2f} DN,   PRNU = {r.prnu_pct:.2f}%",
        color=text, fontsize=12, y=0.995)
    return fig


def build_rowcol_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    gs = fig.add_gridspec(2, 1, hspace=0.45)

    color = _color(r.name)
    # Row mean profile
    ax_r = fig.add_subplot(gs[0])
    rows = np.arange(len(r.row_means))
    ax_r.fill_between(rows, r.row_means - r.row_stds, r.row_means + r.row_stds,
                      color=color, alpha=0.18, linewidth=0,
                      label="±1σ intra-row")
    ax_r.plot(rows, r.row_means, color=color, linewidth=1.2,
              label=f"row mean   (σ_rows = {r.row_noise_dn:.2f} DN)")
    ax_r.axhline(r.mean, color=text, linestyle=":", linewidth=0.8, alpha=0.6)
    ax_r.set_xlim(0, max(1, len(rows) - 1))
    ax_r.set_xlabel("Row index", color=text)
    ax_r.set_ylabel("DN", color=text)
    ax_r.set_title(f"Row-mean profile  ({r.name})", color=text)
    _style_axes(ax_r, fig_face, text)
    ax_r.legend(facecolor=fig_face, edgecolor=text, labelcolor=text,
                fontsize=9, loc="upper right", framealpha=0.85)

    # Column mean profile
    ax_c = fig.add_subplot(gs[1])
    cols = np.arange(len(r.col_means))
    ax_c.fill_between(cols, r.col_means - r.col_stds, r.col_means + r.col_stds,
                      color=color, alpha=0.18, linewidth=0,
                      label="±1σ intra-col")
    ax_c.plot(cols, r.col_means, color=color, linewidth=1.2,
              label=f"col mean   (σ_cols = {r.col_noise_dn:.2f} DN)")
    ax_c.axhline(r.mean, color=text, linestyle=":", linewidth=0.8, alpha=0.6)
    ax_c.set_xlim(0, max(1, len(cols) - 1))
    ax_c.set_xlabel("Column index", color=text)
    ax_c.set_ylabel("DN", color=text)
    ax_c.set_title(f"Column-mean profile  ({r.name})", color=text)
    _style_axes(ax_c, fig_face, text)
    ax_c.legend(facecolor=fig_face, edgecolor=text, labelcolor=text,
                fontsize=9, loc="upper right", framealpha=0.85)

    fig.suptitle(
        f"Row & Column FPN — {r.name}   "
        f"(after subtracting row + col structure: "
        f"residual pixel σ = {r.residual_pixel_noise_dn:.2f} DN)",
        color=text, fontsize=12, y=0.995)
    return fig


def build_map_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(10, 9), facecolor=fig_face)
    gs = fig.add_gridspec(
        2, 2, width_ratios=[4.0, 1.0], height_ratios=[1.0, 4.0],
        wspace=0.04, hspace=0.04)

    color = _color(r.name)
    # Top: column-mean profile (sharing X with the map)
    ax_top = fig.add_subplot(gs[0, 0])
    cols = np.arange(len(r.col_means))
    ax_top.plot(cols, r.col_means - r.mean, color=color, linewidth=1.0)
    ax_top.axhline(0, color=text, linestyle=":", linewidth=0.6, alpha=0.6)
    ax_top.set_ylabel("col − μ", color=text, fontsize=8)
    ax_top.set_xticks([])
    ax_top.set_xlim(0, max(1, len(cols) - 1))
    _style_axes(ax_top, fig_face, text)

    # Right: row-mean profile (shares Y with map, rotated)
    ax_right = fig.add_subplot(gs[1, 1])
    rows = np.arange(len(r.row_means))
    ax_right.plot(r.row_means - r.mean, rows, color=color, linewidth=1.0)
    ax_right.axvline(0, color=text, linestyle=":", linewidth=0.6, alpha=0.6)
    ax_right.set_xlabel("row − μ", color=text, fontsize=8)
    ax_right.set_yticks([])
    ax_right.set_ylim(max(1, len(rows) - 1), 0)  # match imshow Y
    _style_axes(ax_right, fig_face, text)

    # Center: 2-D FPN map
    ax_map = fig.add_subplot(gs[1, 0])
    _imshow_fpn_map(ax_map, r, fig_face=fig_face, text=text,
                    show_colorbar=True)
    ax_map.set_xlabel("Column", color=text)
    ax_map.set_ylabel("Row", color=text)

    fig.suptitle(
        f"2-D FPN map — {r.name}   (DSNU = {r.dsnu_dn:.2f} DN)",
        color=text, fontsize=12, y=0.995)
    return fig


def build_psd_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(8, 7), facecolor=fig_face)
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    psd = r.psd_log
    # Crop visualization to ignore the DC spike for contrast
    p_lo = float(np.percentile(psd, 1))
    p_hi = float(np.percentile(psd, 99.5))
    im = ax.imshow(psd, cmap="magma", origin="lower",
                   extent=r.psd_extent, vmin=p_lo, vmax=p_hi,
                   aspect="auto", interpolation="nearest")
    ax.set_xlabel("Spatial frequency  (cycles / pixel, x)", color=text)
    ax.set_ylabel("Spatial frequency  (cycles / pixel, y)", color=text)
    ax.set_title(
        f"FPN power spectrum — {r.name}\n"
        f"(bright vertical line = column-banding;  bright horizontal line = "
        f"row-banding;  point = periodic 2-D pattern)",
        color=text, fontsize=10)
    _style_axes(ax, fig_face, text)
    cb = fig.colorbar(im, ax=ax, shrink=0.85)
    cb.set_label("log10  |F(u, v)|² + 1", color=text)
    cb.ax.yaxis.set_tick_params(color=text)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
    return fig


def build_multi_channel_fig(results: List[FPNResult], *,
                            fig_face: str, text: str) -> Figure:
    """Side-by-side comparison: top row = FPN maps, bottom = bar chart."""
    n = len(results)
    fig = Figure(figsize=(3.6 * n + 1.0, 8.5), facecolor=fig_face)
    gs = fig.add_gridspec(2, n, height_ratios=[1.4, 1.0], hspace=0.30)

    # Top: per-channel FPN map
    last_im = None
    for i, r in enumerate(results):
        ax = fig.add_subplot(gs[0, i])
        _imshow_fpn_map(ax, r, fig_face=fig_face, text=text)
        ax.set_title(
            f"{r.name}   DSNU = {r.dsnu_dn:.2f} DN",
            color=_color(r.name), fontsize=10)

    # Bottom: grouped bar chart of headline metrics
    ax = fig.add_subplot(gs[1, :])
    ax.set_facecolor(fig_face)
    metrics = ["DSNU (DN)", "PRNU (%)", "σ_row (DN)", "σ_col (DN)",
               "Residual σ (DN)"]
    x = np.arange(len(metrics))
    width = 0.8 / max(1, n)
    for i, r in enumerate(results):
        vals = [r.dsnu_dn, r.prnu_pct, r.row_noise_dn,
                r.col_noise_dn, r.residual_pixel_noise_dn]
        col = _color(r.name)
        bars = ax.bar(x + (i - (n - 1) / 2) * width, vals, width=width,
                      label=r.name, color=col, alpha=0.85,
                      edgecolor="white", linewidth=0.6)
        for b, v in zip(bars, vals):
            ax.text(b.get_x() + b.get_width() / 2, v + abs(v) * 0.02 + 0.01,
                    f"{v:.2f}", ha="center", va="bottom",
                    fontsize=7.5, color=text)
    ax.set_xticks(x); ax.set_xticklabels(metrics, color=text)
    ax.set_ylabel("Value (units in label)", color=text)
    ax.legend(loc="upper right", facecolor=fig_face, edgecolor=text,
              labelcolor=text, framealpha=0.85)
    _style_axes(ax, fig_face, text)
    ax.set_title("Per-channel FPN summary", color=text, fontsize=11)
    return fig


# ---------------------------------------------------------------------------
# Sub-panel helpers
# ---------------------------------------------------------------------------

def _style_axes(ax, fig_face, text):
    ax.tick_params(colors=text)
    for sp in ax.spines.values():
        sp.set_color(text)
    ax.set_facecolor(fig_face)


def _imshow_kept(ax, r: FPNResult, *, fig_face, text):
    a = r.image
    vmin, vmax = float(np.percentile(a, 1)), float(np.percentile(a, 99.5))
    if vmax <= vmin:
        vmax = vmin + 1
    ax.imshow(a, cmap="gray", vmin=vmin, vmax=vmax, interpolation="nearest")
    # Overlay excluded pixels in red
    excluded = ~r.mask_kept
    if excluded.any():
        red = np.zeros((*a.shape, 4))
        red[..., 0] = 1.0  # R
        red[..., 3] = excluded.astype(float) * 0.55
        ax.imshow(red, interpolation="nearest")
    ax.set_xticks([]); ax.set_yticks([])
    _style_axes(ax, fig_face, text)


def _imshow_fpn_map(ax, r: FPNResult, *, fig_face, text,
                    show_colorbar: bool = False):
    m = r.fpn_map
    finite = m[np.isfinite(m)]
    if finite.size == 0:
        return
    s = float(np.percentile(np.abs(finite), 98))
    if s <= 0:
        s = 1.0
    im = ax.imshow(m, cmap="RdBu_r", vmin=-s, vmax=+s,
                   interpolation="nearest")
    ax.set_xticks([]); ax.set_yticks([])
    _style_axes(ax, fig_face, text)
    if show_colorbar:
        cb = ax.figure.colorbar(im, ax=ax, shrink=0.85)
        cb.set_label("DN − mean", color=text)
        cb.ax.yaxis.set_tick_params(color=text)
        plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)


def _hist_panel(ax, r: FPNResult, *, text, fig_face):
    color = _color(r.name)
    kept = r.image[r.mask_kept]
    bins = max(64, int(np.sqrt(len(kept))))
    ax.hist(r.image.ravel(), bins=bins, color="0.7", alpha=0.55,
            label="all pixels", histtype="stepfilled", linewidth=0)
    ax.hist(kept, bins=bins, color=color, alpha=0.85, label="kept",
            histtype="stepfilled", linewidth=0)
    ax.axvline(r.mean, color=text, linestyle="-", linewidth=1.0,
               label=f"μ = {r.mean:.2f}")
    ax.axvline(r.mean - r.std, color=text, linestyle=":", linewidth=0.8,
               label=f"μ ± σ ({r.std:.2f})")
    ax.axvline(r.mean + r.std, color=text, linestyle=":", linewidth=0.8)
    ax.set_xlabel("Pixel value (DN)", color=text)
    ax.set_ylabel("Count", color=text)
    ax.set_title("Pixel-value distribution", color=text, fontsize=10)
    ax.legend(fontsize=8, facecolor=fig_face, edgecolor=text,
              labelcolor=text, framealpha=0.85, loc="upper right")
    _style_axes(ax, fig_face, text)


def _stat_table(ax, r: FPNResult, *, text):
    ax.axis("off")
    rows = [
        ("Pixels (kept / total)",
         f"{r.n_kept:,} / {r.n_total:,}"),
        ("Mean (μ)",      f"{r.mean:.3f} DN"),
        ("Std (σ)  (DSNU)", f"{r.std:.3f} DN"),
        ("PRNU = σ/μ",    f"{r.prnu_pct:.3f} %"),
        ("Median",        f"{r.median:.3f} DN"),
        ("Min / Max",     f"{r.minv:.0f} / {r.maxv:.0f} DN"),
        ("p1 / p99",      f"{r.p1:.0f} / {r.p99:.0f} DN"),
        ("Row-mean σ",    f"{r.row_noise_dn:.3f} DN"),
        ("Col-mean σ",    f"{r.col_noise_dn:.3f} DN"),
        ("Residual pixel σ",
         f"{r.residual_pixel_noise_dn:.3f} DN"),
    ]
    settings = r.settings
    rows.append(("ISP", _isp_summary(settings)))
    rows.append(("Outlier cuts",
                 f"bottom {settings.lo_pct:.1f}% / top {settings.hi_pct:.1f}%"))
    table_text = "\n".join(f"  {k:<22}{v:>22}" for k, v in rows)
    ax.text(0.0, 1.0, "Statistics", color=text, fontsize=11,
            fontweight="bold", ha="left", va="top",
            transform=ax.transAxes)
    ax.text(0.0, 0.92, table_text, color=text,
            fontfamily="monospace", fontsize=9.5,
            ha="left", va="top",
            transform=ax.transAxes)


def _isp_summary(s) -> str:
    parts = []
    if s.median_size and s.median_size >= 3:
        parts.append(f"median {s.median_size}×{s.median_size}")
    if s.gaussian_sigma > 0.05:
        parts.append(f"gauss σ={s.gaussian_sigma:.1f}")
    if s.bilateral:
        parts.append("bilateral")
    if s.hot_pixel_thr > 0.5:
        parts.append(f"hot-pix > {s.hot_pixel_thr:.0f}σ")
    return ", ".join(parts) if parts else "none"


# ---------------------------------------------------------------------------
# Tk-style Qt window
# ---------------------------------------------------------------------------

def open_fpn_window(*, parent, results: List[FPNResult],
                    fig_face: str, text: str) -> None:
    from PySide6 import QtWidgets, QtCore
    from matplotlib.backends.backend_qtagg import (
        FigureCanvasQTAgg, NavigationToolbar2QT,
    )

    win = QtWidgets.QMainWindow(parent)
    win.setWindowTitle(f"FPN analysis — {len(results)} channel(s)")
    win.resize(1500, 920)
    if parent is not None:
        try:
            win.setStyleSheet(parent.styleSheet() or
                              QtWidgets.QApplication.instance().styleSheet())
        except Exception:
            pass

    central = QtWidgets.QWidget()
    win.setCentralWidget(central)
    main_layout = QtWidgets.QVBoxLayout(central)
    main_layout.setContentsMargins(6, 6, 6, 6); main_layout.setSpacing(6)
    tabs = QtWidgets.QTabWidget()
    main_layout.addWidget(tabs, stretch=1)

    figures: List[Tuple[str, Figure]] = []

    def _add_fig_tab(label: str, fig: Figure) -> None:
        page = QtWidgets.QWidget()
        pl = QtWidgets.QVBoxLayout(page)
        pl.setContentsMargins(0, 0, 0, 0); pl.setSpacing(0)
        cnv = FigureCanvasQTAgg(fig)
        tb = NavigationToolbar2QT(cnv, page)
        pl.addWidget(cnv, stretch=1)
        pl.addWidget(tb)
        tabs.addTab(page, label)
        figures.append((label.replace(" ", "_").lower(), fig))

    # Per-channel sub-tabs
    for r in results:
        sub_tabs = QtWidgets.QTabWidget()
        page_outer = QtWidgets.QWidget()
        pl = QtWidgets.QVBoxLayout(page_outer)
        pl.setContentsMargins(0, 0, 0, 0); pl.setSpacing(0)
        pl.addWidget(sub_tabs)
        for label, builder in (("Overview",       build_overview_fig),
                               ("Row & Col FPN",  build_rowcol_fig),
                               ("2-D FPN map",    build_map_fig),
                               ("Power spectrum", build_psd_fig)):
            fig = builder(r, fig_face=fig_face, text=text)
            inner = QtWidgets.QWidget()
            il = QtWidgets.QVBoxLayout(inner)
            il.setContentsMargins(0, 0, 0, 0); il.setSpacing(0)
            cnv = FigureCanvasQTAgg(fig)
            tb = NavigationToolbar2QT(cnv, inner)
            il.addWidget(cnv, stretch=1)
            il.addWidget(tb)
            sub_tabs.addTab(inner, label)
            figures.append(
                (f"{r.name.replace('-', '_').lower()}_{label.replace(' ', '_').lower()}",
                 fig))
        tabs.addTab(page_outer, r.name)

    # Multi-channel comparison tab (only if more than one channel)
    if len(results) > 1:
        cmp_fig = build_multi_channel_fig(results, fig_face=fig_face, text=text)
        _add_fig_tab("Compare channels", cmp_fig)

    # Bottom action row
    btn_row = QtWidgets.QHBoxLayout()
    btn_row.addStretch(1)
    btn_csv = QtWidgets.QPushButton("Export numerical results CSV…")
    btn_png = QtWidgets.QPushButton("Export all PNGs…")
    btn_row.addWidget(btn_csv); btn_row.addWidget(btn_png)
    main_layout.addLayout(btn_row)

    def do_export_pngs():
        out = QtWidgets.QFileDialog.getExistingDirectory(
            win, "Export figures to…")
        if not out:
            return
        out_p = Path(out); out_p.mkdir(parents=True, exist_ok=True)
        n = 0
        for label, fig in figures:
            fig.savefig(out_p / f"fpn_{label}.png", dpi=220,
                        bbox_inches="tight", facecolor=fig_face)
            n += 1
        QtWidgets.QMessageBox.information(win, "Export",
                                          f"Saved {n} PNG(s).")

    def do_export_csv():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            win, "Save FPN summary CSV", "fpn_summary.csv", "CSV (*.csv)")
        if not path:
            return
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["channel", "n_kept", "n_total",
                        "roi_y0", "roi_x0", "roi_y1", "roi_x1",
                        "mean_dn", "std_dn_dsnu", "prnu_pct",
                        "row_noise_dn", "col_noise_dn",
                        "residual_pixel_noise_dn",
                        "min_dn", "max_dn", "p1_dn", "p99_dn", "median_dn",
                        "median_size", "gaussian_sigma", "bilateral",
                        "hot_pixel_thr", "lo_pct", "hi_pct"])
            for r in results:
                s = r.settings
                w.writerow([r.name, r.n_kept, r.n_total,
                            r.roi[0], r.roi[1], r.roi[2], r.roi[3],
                            f"{r.mean:.4f}", f"{r.dsnu_dn:.4f}",
                            f"{r.prnu_pct:.4f}",
                            f"{r.row_noise_dn:.4f}",
                            f"{r.col_noise_dn:.4f}",
                            f"{r.residual_pixel_noise_dn:.4f}",
                            f"{r.minv:.2f}", f"{r.maxv:.2f}",
                            f"{r.p1:.2f}", f"{r.p99:.2f}",
                            f"{r.median:.2f}",
                            s.median_size, f"{s.gaussian_sigma:.2f}",
                            int(s.bilateral),
                            f"{s.hot_pixel_thr:.2f}",
                            f"{s.lo_pct:.2f}", f"{s.hi_pct:.2f}"])
        QtWidgets.QMessageBox.information(
            win, "Export", f"Wrote {len(results)} rows → {path}")

    btn_csv.clicked.connect(do_export_csv)
    btn_png.clicked.connect(do_export_pngs)

    if parent is not None:
        try:
            if not hasattr(parent, "_analysis_windows"):
                parent._analysis_windows = []
            parent._analysis_windows.append(win)
        except Exception:
            pass
    win.show()
