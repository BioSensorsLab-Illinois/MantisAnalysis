"""Depth-of-Field figures + tabbed Qt viewer.

Tabs (per the user's "find proper way to present this data"):

  1. Focus heatmap        — 2-D map of local focus metric over the
                             whole image; the brightest blob is the
                             in-focus region. Picked points + lines
                             overlaid.
  2. Line scan            — focus vs. position along each user-drawn
                             line, with peak + DoF band annotated;
                             multi-channel overlay when several
                             channels selected.
  3. Picked points        — bar chart + table of focus values at each
                             labeled point; if the user supplied Z-
                             calibration, scatter focus vs Z plus a
                             Gaussian fit and the Z range above
                             threshold.
  4. Window method comp.  — for one selected line, plot the four focus
                             metrics (laplacian / brenner / tenengrad /
                             fft_hf) side-by-side; sanity check that
                             the DoF estimate is metric-independent.
  5. Channel comparison   — when multiple channels are picked, side-by-
                             side line-scan curves with normalized
                             focus, plus DoF widths in a bar chart.
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.figure import Figure

from .dof_analysis import (
    DoFChannelResult, DoFLineResult, DoFPoint, DoFPointResult,
    FOCUS_METRICS, _scan_line, analyze_dof, measure_focus,
)
from .fpn_render import _color, _ch, _style_axes


# ---------------------------------------------------------------------------
# Per-channel figure builders
# ---------------------------------------------------------------------------

def build_heatmap_fig(r: DoFChannelResult, *, fig_face: str,
                      text: str) -> Figure:
    fig = Figure(figsize=(11, 7.6), facecolor=fig_face)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.0, 1.0], wspace=0.18)

    # Left: source image with overlays
    ax_img = fig.add_subplot(gs[0, 0])
    a = r.image
    vmin, vmax = float(np.percentile(a, 1)), float(np.percentile(a, 99.5))
    if vmax <= vmin:
        vmax = vmin + 1
    ax_img.imshow(a, cmap="gray", vmin=vmin, vmax=vmax,
                  interpolation="nearest")
    # Lines
    for line in r.lines:
        ax_img.plot([line.p0[0], line.p1[0]], [line.p0[1], line.p1[1]],
                    color="#ffd54f", linewidth=1.6, alpha=0.95)
        ax_img.plot(*line.p0, "o", color="#ffd54f", markersize=4)
        ax_img.plot(*line.p1, "o", color="#ffd54f", markersize=4)
    # Points
    for pt in r.points:
        col = "#1f77b4"
        ax_img.plot(pt.point.x, pt.point.y, "o", color=col,
                    markeredgecolor="white", markersize=8)
        if pt.point.label:
            ax_img.text(pt.point.x + 6, pt.point.y - 6, pt.point.label,
                        color="white", fontsize=8,
                        bbox=dict(facecolor=col, alpha=0.85,
                                  edgecolor="none",
                                  boxstyle="round,pad=0.2"))
    ax_img.set_xticks([]); ax_img.set_yticks([])
    ax_img.set_title(f"{r.name}  source + picks", color=text, fontsize=11)
    _style_axes(ax_img, fig_face, text)

    # Right: focus heatmap
    ax_h = fig.add_subplot(gs[0, 1])
    if r.heatmap is None:
        ax_h.text(0.5, 0.5, "Heatmap disabled", ha="center", va="center",
                  color=text)
    else:
        hm = r.heatmap
        # Robust scaling
        v99 = float(np.percentile(hm, 99))
        if v99 <= 0:
            v99 = 1.0
        im = ax_h.imshow(hm, cmap="viridis", vmin=0, vmax=v99,
                         origin="upper", interpolation="bilinear",
                         extent=[r.heatmap_step,
                                 r.heatmap_step + hm.shape[1] * r.heatmap_step,
                                 r.heatmap_step + hm.shape[0] * r.heatmap_step,
                                 r.heatmap_step])
        cb = fig.colorbar(im, ax=ax_h, shrink=0.85)
        cb.set_label(f"focus metric ({r.metric})", color=text)
        cb.ax.yaxis.set_tick_params(color=text)
        plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
        # Mark the global focus peak
        py, px = np.unravel_index(int(np.argmax(hm)), hm.shape)
        gx = r.heatmap_step + px * r.heatmap_step
        gy = r.heatmap_step + py * r.heatmap_step
        ax_h.plot(gx, gy, marker="x", color="white", markersize=14,
                  markeredgewidth=2.0)
    ax_h.set_xticks([]); ax_h.set_yticks([])
    ax_h.set_title(f"Focus heatmap  ({r.metric},  half-win = {r.half_window} px)",
                   color=text, fontsize=11)
    _style_axes(ax_h, fig_face, text)

    fig.suptitle(f"DoF — {r.name}   focus map + picks",
                 color=text, fontsize=12, y=0.995)
    return fig


def build_line_scan_fig(r: DoFChannelResult, *,
                        fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    if not r.lines:
        ax = fig.add_subplot(111)
        ax.text(0.5, 0.5, "Draw a line on the chart to see a DoF scan.",
                ha="center", va="center", color=text)
        ax.set_xticks([]); ax.set_yticks([])
        return fig
    n = len(r.lines)
    cols = min(2, n)
    rows = int(np.ceil(n / cols))
    fig.set_size_inches(6.0 * cols, 3.6 * rows + 0.4, forward=False)
    color = _color(r.name)
    use_unit = bool(r.is_calibrated)
    for i, ln in enumerate(r.lines):
        ax = fig.add_subplot(rows, cols, i + 1)
        ax.set_facecolor(fig_face)
        # Pick the X array + axis label to use
        if use_unit and ln.positions_unit is not None:
            xs = ln.positions_unit
            x_label = f"Position along line  ({ln.unit_name})"
            peak_val = ln.peak_position_unit
            lo_val, hi_val = ln.dof_low_unit, ln.dof_high_unit
            width_val = ln.dof_width_unit
            unit_suffix = f" {ln.unit_name}"
        else:
            xs = ln.positions
            x_label = "Position along line  (px)"
            peak_val = ln.peak_position_px
            lo_val, hi_val = ln.dof_low_px, ln.dof_high_px
            width_val = ln.dof_width_px
            unit_suffix = " px"

        ax.fill_between(xs, 0, ln.focus_norm, color=color,
                        alpha=0.18, linewidth=0)
        ax.plot(xs, ln.focus_norm, color=color, linewidth=1.6)
        ax.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7)
        if peak_val is not None:
            ax.axvline(peak_val, color="#ffd54f",
                       linestyle="-", linewidth=1.0, alpha=0.7)
        if lo_val is not None and hi_val is not None:
            ax.axvspan(lo_val, hi_val,
                       color="#1a7f37", alpha=0.12, linewidth=0)
            txt = f"DoF = {width_val:.3g}{unit_suffix}"
        else:
            txt = "DoF = (not bounded above threshold)"
        ax.set_xlim(0, max(1.0, float(xs[-1])))
        ax.set_ylim(0, 1.05)
        ax.set_xlabel(x_label, color=text)
        ax.set_ylabel("Normalized focus", color=text)
        peak_str = (f"{peak_val:.3g}{unit_suffix}"
                    if peak_val is not None else "—")
        ax.set_title(f"{r.name}  line {i + 1}  ({r.metric})\n"
                     f"peak @ {peak_str},   {txt}",
                     color=text, fontsize=10)
        _style_axes(ax, fig_face, text)
    fig.suptitle(
        f"DoF line scan — {r.name}   "
        f"(threshold = {r.threshold:.2f}, half-win = {r.half_window} px)",
        color=text, fontsize=12, y=0.995)
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    return fig


def build_points_fig(r: DoFChannelResult, *,
                     fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    if not r.points:
        ax = fig.add_subplot(111)
        ax.text(0.5, 0.5,
                "Pick points on the chart to populate the points-table.",
                ha="center", va="center", color=text)
        ax.set_xticks([]); ax.set_yticks([])
        return fig
    color = _color(r.name)
    has_z = any(p.point.z_um is not None for p in r.points)
    if has_z:
        gs = fig.add_gridspec(1, 2, width_ratios=[1.0, 1.0], wspace=0.25)
        ax_bar = fig.add_subplot(gs[0, 0])
        ax_z = fig.add_subplot(gs[0, 1])
    else:
        ax_bar = fig.add_subplot(111)
        ax_z = None

    # Bar chart of focus values
    labels = [p.point.label or f"#{i+1}"
              for i, p in enumerate(r.points)]
    vals = [p.focus_norm for p in r.points]
    bars = ax_bar.bar(range(len(vals)), vals, color=color, alpha=0.85,
                      edgecolor="white", linewidth=0.6)
    for b, v in zip(bars, vals):
        ax_bar.text(b.get_x() + b.get_width() / 2, v + 0.01,
                    f"{v:.2f}", ha="center", va="bottom",
                    fontsize=8, color=text)
    ax_bar.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7,
                   alpha=0.6)
    ax_bar.set_xticks(range(len(labels)))
    ax_bar.set_xticklabels(labels, rotation=30, ha="right", color=text)
    ax_bar.set_ylim(0, 1.05)
    ax_bar.set_ylabel("Normalized focus", color=text)
    ax_bar.set_title(f"Picked points — {r.name}  ({r.metric})",
                     color=text, fontsize=11)
    _style_axes(ax_bar, fig_face, text)

    # Z-scatter when calibration available
    if ax_z is not None:
        zs = np.array([p.point.z_um for p in r.points if p.point.z_um is not None],
                      dtype=np.float64)
        fs = np.array([p.focus_norm for p in r.points if p.point.z_um is not None],
                      dtype=np.float64)
        if zs.size >= 3:
            order = np.argsort(zs)
            zs_s, fs_s = zs[order], fs[order]
            ax_z.plot(zs_s, fs_s, "o-", color=color, linewidth=1.4,
                      markeredgecolor="white", markersize=6)
            # Optional Gaussian fit
            try:
                from scipy.optimize import curve_fit
                def _gauss(z, a, mu, sigma, b):
                    return a * np.exp(-((z - mu) ** 2) / (2 * sigma ** 2)) + b
                p0 = (1.0, float(zs_s[np.argmax(fs_s)]),
                      max(1e-3, (zs_s[-1] - zs_s[0]) / 4),
                      float(fs_s.min()))
                popt, _ = curve_fit(_gauss, zs_s, fs_s, p0=p0, maxfev=5000)
                zg = np.linspace(zs_s[0], zs_s[-1], 200)
                ax_z.plot(zg, _gauss(zg, *popt), "--", color="#ffd54f",
                          linewidth=1.2, label="Gaussian fit")
                # DoF range from fit at threshold of fit-amplitude (relative)
                a, mu, sigma, b = popt
                level = b + (a - b) * r.threshold / max(1e-9, fs_s.max())
                if a != 0 and (level - b) / a >= 1e-6:
                    arg = -2 * sigma ** 2 * np.log(max(1e-9, (level - b) / a))
                    if arg > 0:
                        half = np.sqrt(arg)
                        ax_z.axvspan(mu - half, mu + half,
                                     color="#1a7f37", alpha=0.12, linewidth=0)
                        ax_z.set_title(
                            f"Focus vs Z   peak μ = {mu:.2f} μm,   "
                            f"DoF ≈ {2*half:.2f} μm",
                            color=text, fontsize=11)
                ax_z.legend(facecolor=fig_face, edgecolor=text,
                            labelcolor=text, fontsize=8,
                            loc="upper right", framealpha=0.85)
            except Exception:
                ax_z.set_title("Focus vs Z   (need >=3 points; fit skipped)",
                               color=text, fontsize=11)
        else:
            ax_z.scatter(zs, fs, color=color)
            ax_z.set_title("Focus vs Z   (need >=3 points to fit)",
                           color=text, fontsize=11)
        ax_z.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7,
                     alpha=0.6)
        ax_z.set_xlabel("Z position (μm)", color=text)
        ax_z.set_ylabel("Normalized focus", color=text)
        ax_z.set_ylim(0, 1.05)
        _style_axes(ax_z, fig_face, text)
    fig.suptitle(f"Per-point focus — {r.name}",
                 color=text, fontsize=12, y=0.995)
    return fig


def build_metric_compare_fig(r: DoFChannelResult, image: np.ndarray, *,
                             fig_face: str, text: str) -> Figure:
    """Re-scan the FIRST line with all four focus metrics."""
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    if not r.lines:
        ax = fig.add_subplot(111)
        ax.text(0.5, 0.5,
                "Draw a line to compare focus metrics.",
                ha="center", va="center", color=text)
        ax.set_xticks([]); ax.set_yticks([])
        return fig
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    ln = r.lines[0]
    metric_colors = {"laplacian": "#1f77b4", "brenner": "#d62728",
                     "tenengrad": "#2ca02c", "fft_hf": "#9467bd"}
    cal = ({"unit": r.unit_name, "px_per_unit_h": r.px_per_unit_h,
            "px_per_unit_v": r.px_per_unit_v}
           if r.is_calibrated else None)
    use_unit = r.is_calibrated and ln.unit_name
    unit_suffix = f" {ln.unit_name}" if use_unit else " px"
    for m in FOCUS_METRICS:
        scan = _scan_line(image, ln.p0, ln.p1, step_px=4.0,
                          half_window=r.half_window, metric=m,
                          threshold=r.threshold, calibration=cal)
        if use_unit and scan.positions_unit is not None:
            xs = scan.positions_unit
            peak = scan.peak_position_unit
            width = scan.dof_width_unit
        else:
            xs = scan.positions
            peak = scan.peak_position_px
            width = scan.dof_width_px
        col = metric_colors[m]
        peak_txt = f"peak @ {peak:.3g}{unit_suffix}" if peak is not None else "peak @ —"
        width_txt = (f", DoF = {width:.3g}{unit_suffix}"
                     if width is not None else "")
        ax.plot(xs, scan.focus_norm, color=col,
                linewidth=1.4, alpha=0.85,
                label=f"{m}   ({peak_txt}{width_txt})")
    ax.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7)
    ax.set_xlabel(f"Position along line  ({ln.unit_name})" if use_unit
                  else "Position along line  (px)", color=text)
    ax.set_ylabel("Normalized focus", color=text)
    x_max_arr = ln.positions_unit if use_unit and ln.positions_unit is not None else ln.positions
    ax.set_xlim(0, float(x_max_arr[-1]))
    ax.set_ylim(0, 1.05)
    ax.set_title(f"{r.name}  line 1 — focus-metric comparison",
                 color=text, fontsize=11)
    ax.legend(facecolor=fig_face, edgecolor=text, labelcolor=text,
              fontsize=9, loc="upper right", framealpha=0.85)
    _style_axes(ax, fig_face, text)
    fig.suptitle("Focus-metric comparison along same line  "
                 "(if all curves agree, the DoF estimate is robust)",
                 color=text, fontsize=12, y=0.995)
    return fig


def build_channel_compare_fig(results: List[DoFChannelResult], *,
                              fig_face: str, text: str) -> Figure:
    """Side-by-side line-scan curves + DoF-width bar chart."""
    fig = Figure(figsize=(12, 6), facecolor=fig_face)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.4, 1.0], wspace=0.25)

    ax = fig.add_subplot(gs[0, 0])
    ax.set_facecolor(fig_face)
    any_line = False
    use_unit = any(r.is_calibrated and r.lines and r.lines[0].positions_unit is not None
                   for r in results)
    unit_name = next((r.lines[0].unit_name for r in results
                      if r.lines and r.lines[0].unit_name), None) if use_unit else None
    for r in results:
        if not r.lines:
            continue
        any_line = True
        ln = r.lines[0]
        col = _color(r.name)
        if use_unit and ln.positions_unit is not None:
            xs = ln.positions_unit
            lo, hi = ln.dof_low_unit, ln.dof_high_unit
        else:
            xs = ln.positions
            lo, hi = ln.dof_low_px, ln.dof_high_px
        ax.plot(xs, ln.focus_norm, color=col, linewidth=1.5,
                label=r.name)
        if lo is not None and hi is not None:
            ax.axvspan(lo, hi, color=col, alpha=0.07, linewidth=0)
    if not any_line:
        ax.text(0.5, 0.5, "Draw a line in the picker to compare channels.",
                ha="center", va="center", color=text)
    else:
        ax.axhline(results[0].threshold, color=text, linestyle=":",
                   linewidth=0.7)
        x_max = max(
            float((r.lines[0].positions_unit if use_unit and r.lines[0].positions_unit is not None
                   else r.lines[0].positions)[-1])
            for r in results if r.lines)
        ax.set_xlim(0, x_max)
        ax.set_ylim(0, 1.05)
        ax.set_xlabel(f"Position along line ({unit_name})" if use_unit
                      else "Position along line (px)", color=text)
        ax.set_ylabel("Normalized focus", color=text)
        ax.legend(facecolor=fig_face, edgecolor=text, labelcolor=text,
                  fontsize=9, loc="upper right", framealpha=0.85)
        ax.set_title("Focus profile per channel  (line 1)",
                     color=text, fontsize=11)
    _style_axes(ax, fig_face, text)

    # DoF width bar chart
    ax_b = fig.add_subplot(gs[0, 1])
    ax_b.set_facecolor(fig_face)
    names = [r.name for r in results]
    widths = []
    for r in results:
        if r.lines:
            ln0 = r.lines[0]
            if use_unit and ln0.dof_width_unit is not None:
                w = ln0.dof_width_unit
            elif ln0.dof_width_px is not None:
                w = ln0.dof_width_px
            else:
                w = 0.0
        else:
            w = 0.0
        widths.append(w)
    cols = [_color(r.name) for r in results]
    bars = ax_b.bar(range(len(names)), widths, color=cols, alpha=0.85,
                    edgecolor="white", linewidth=0.6)
    for b, v in zip(bars, widths):
        ax_b.text(b.get_x() + b.get_width() / 2, v + 0.5,
                  f"{v:.3g}" if v else "—", ha="center", va="bottom",
                  fontsize=8, color=text)
    ax_b.set_xticks(range(len(names)))
    ax_b.set_xticklabels(names, rotation=30, ha="right", color=text)
    ax_b.set_ylabel(f"DoF width ({unit_name})" if use_unit
                    else "DoF width (px)", color=text)
    ax_b.set_title("DoF width per channel", color=text, fontsize=11)
    _style_axes(ax_b, fig_face, text)

    fig.suptitle("Channel comparison — DoF",
                 color=text, fontsize=12, y=0.995)
    return fig


# ---------------------------------------------------------------------------
# Qt window
# ---------------------------------------------------------------------------

def open_dof_window(*, parent, results: List[DoFChannelResult],
                    raw_images: Dict[str, np.ndarray],
                    fig_face: str, text: str) -> None:
    from PySide6 import QtWidgets
    from matplotlib.backends.backend_qtagg import (
        FigureCanvasQTAgg, NavigationToolbar2QT,
    )

    win = QtWidgets.QMainWindow(parent)
    win.setWindowTitle(f"Depth-of-Field — {len(results)} channel(s)")
    win.resize(1500, 900)
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

    def add_figure(label: str, fig: Figure):
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
        for label, fig in (("Focus heatmap",
                            build_heatmap_fig(r, fig_face=fig_face,
                                              text=text)),
                           ("Line scan",
                            build_line_scan_fig(r, fig_face=fig_face,
                                                text=text)),
                           ("Picked points",
                            build_points_fig(r, fig_face=fig_face,
                                             text=text)),
                           ("Metric compare",
                            build_metric_compare_fig(r, raw_images.get(r.name, r.image),
                                                     fig_face=fig_face, text=text))):
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

    # Channel comparison
    if len(results) > 1:
        cmp_fig = build_channel_compare_fig(results, fig_face=fig_face,
                                            text=text)
        add_figure("Compare channels", cmp_fig)

    # Action row
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
            fig.savefig(out_p / f"dof_{label}.png", dpi=220,
                        bbox_inches="tight", facecolor=fig_face)
            n += 1
        QtWidgets.QMessageBox.information(win, "Export",
                                          f"Saved {n} PNG(s).")

    def do_export_csv():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            win, "Save DoF CSV", "dof_results.csv", "CSV (*.csv)")
        if not path:
            return
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["block", "channel", "metric", "half_window",
                        "label_or_index", "x", "y", "z_um",
                        "focus", "focus_norm",
                        "line_idx", "position_px", "peak_position_px",
                        "dof_low_px", "dof_high_px", "dof_width_px",
                        "unit",
                        "position_unit", "peak_position_unit",
                        "dof_low_unit", "dof_high_unit",
                        "dof_width_unit"])
            for r in results:
                for i, p in enumerate(r.points):
                    w.writerow(["point", r.name, r.metric, r.half_window,
                                p.point.label or f"#{i+1}",
                                f"{p.point.x:.2f}", f"{p.point.y:.2f}",
                                "" if p.point.z_um is None else f"{p.point.z_um:.4f}",
                                f"{p.focus:.6e}", f"{p.focus_norm:.6f}",
                                "", "", "", "", "", "",
                                "", "", "", "", "", ""])
                for li, ln in enumerate(r.lines):
                    has_u = ln.unit_name is not None
                    for j in range(len(ln.positions)):
                        pos_u = (f"{ln.positions_unit[j]:.4f}"
                                 if has_u and ln.positions_unit is not None
                                 else "")
                        w.writerow(["line", r.name, r.metric, r.half_window,
                                    "", "", "", "",
                                    f"{ln.focus[j]:.6e}",
                                    f"{ln.focus_norm[j]:.6f}",
                                    li, f"{ln.positions[j]:.3f}",
                                    f"{ln.peak_position_px:.3f}",
                                    "" if ln.dof_low_px is None else f"{ln.dof_low_px:.3f}",
                                    "" if ln.dof_high_px is None else f"{ln.dof_high_px:.3f}",
                                    "" if ln.dof_width_px is None else f"{ln.dof_width_px:.3f}",
                                    ln.unit_name or "",
                                    pos_u,
                                    "" if ln.peak_position_unit is None else f"{ln.peak_position_unit:.4f}",
                                    "" if ln.dof_low_unit is None else f"{ln.dof_low_unit:.4f}",
                                    "" if ln.dof_high_unit is None else f"{ln.dof_high_unit:.4f}",
                                    "" if ln.dof_width_unit is None else f"{ln.dof_width_unit:.4f}"])
        QtWidgets.QMessageBox.information(win, "Export",
                                          f"Wrote rows → {path}")

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
