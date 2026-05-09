"""Depth-of-Field matplotlib figure builders.

Each ``build_*_fig`` function returns a ``matplotlib.figure.Figure`` for
offline PNG export or the HTTP figure adapter in
``mantisanalysis.figures``:

  build_heatmap_fig         — source image + 2-D focus heatmap
  build_line_scan_fig       — focus vs. position along each picked line
  build_points_fig          — bar chart / table of per-point focus
  build_metric_compare_fig  — 4 focus metrics side-by-side on one line
  build_channel_compare_fig — multi-channel line-scan + DoF-width bars
  build_gaussian_fit_fig    — gaussian fit overlay with ±95% CI band
  build_chromatic_shift_fig — cross-channel peak offsets
  build_tilt_plane_fig      — bilinear-plane sensor-tilt diagnostic

The previous ``open_dof_window`` Qt viewer was deleted in B-0016.
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from .dof_analysis import (
    FOCUS_METRICS,
    DoFChannelResult,
    _scan_line,
)
from .plotting import _color, _style_axes

# ---------------------------------------------------------------------------
# Per-channel figure builders
# ---------------------------------------------------------------------------


def build_heatmap_fig(r: DoFChannelResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 7.6), facecolor=fig_face)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.0, 1.0], wspace=0.18)

    # Left: source image with overlays
    ax_img = fig.add_subplot(gs[0, 0])
    a = r.image
    vmin, vmax = float(np.percentile(a, 1)), float(np.percentile(a, 99.5))
    if vmax <= vmin:
        vmax = vmin + 1
    ax_img.imshow(a, cmap="gray", vmin=vmin, vmax=vmax, interpolation="nearest")
    # Lines
    for line in r.lines:
        ax_img.plot(
            [line.p0[0], line.p1[0]],
            [line.p0[1], line.p1[1]],
            color="#ffd54f",
            linewidth=1.6,
            alpha=0.95,
        )
        ax_img.plot(*line.p0, "o", color="#ffd54f", markersize=4)
        ax_img.plot(*line.p1, "o", color="#ffd54f", markersize=4)
    # Points
    for pt in r.points:
        col = "#1f77b4"
        ax_img.plot(pt.point.x, pt.point.y, "o", color=col, markeredgecolor="white", markersize=8)
        if pt.point.label:
            ax_img.text(
                pt.point.x + 6,
                pt.point.y - 6,
                pt.point.label,
                color="white",
                fontsize=8,
                bbox=dict(facecolor=col, alpha=0.85, edgecolor="none", boxstyle="round,pad=0.2"),
            )
    ax_img.set_xticks([])
    ax_img.set_yticks([])
    ax_img.set_title(f"{r.name}  source + picks", color=text, fontsize=11)
    _style_axes(ax_img, fig_face, text)

    # Right: focus heatmap
    ax_h = fig.add_subplot(gs[0, 1])
    if r.heatmap is None:
        ax_h.text(0.5, 0.5, "Heatmap disabled", ha="center", va="center", color=text)
    else:
        hm = r.heatmap
        # Robust scaling
        v99 = float(np.percentile(hm, 99))
        if v99 <= 0:
            v99 = 1.0
        im = ax_h.imshow(
            hm,
            cmap="viridis",
            vmin=0,
            vmax=v99,
            origin="upper",
            interpolation="bilinear",
            extent=[
                r.heatmap_step,
                r.heatmap_step + hm.shape[1] * r.heatmap_step,
                r.heatmap_step + hm.shape[0] * r.heatmap_step,
                r.heatmap_step,
            ],
        )
        cb = fig.colorbar(im, ax=ax_h, shrink=0.85)
        cb.set_label(f"focus metric ({r.metric})", color=text)
        cb.ax.yaxis.set_tick_params(color=text)
        plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
        # Mark the global focus peak
        py, px = np.unravel_index(int(np.argmax(hm)), hm.shape)
        gx = r.heatmap_step + px * r.heatmap_step
        gy = r.heatmap_step + py * r.heatmap_step
        ax_h.plot(gx, gy, marker="x", color="white", markersize=14, markeredgewidth=2.0)
    ax_h.set_xticks([])
    ax_h.set_yticks([])
    ax_h.set_title(
        f"Focus heatmap  ({r.metric},  half-win = {r.half_window} px)", color=text, fontsize=11
    )
    _style_axes(ax_h, fig_face, text)

    fig.suptitle(f"DoF — {r.name}   focus map + picks", color=text, fontsize=12, y=0.995)
    return fig


def build_line_scan_fig(r: DoFChannelResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    if not r.lines:
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "Draw a line on the chart to see a DoF scan.",
            ha="center",
            va="center",
            color=text,
        )
        ax.set_xticks([])
        ax.set_yticks([])
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

        ax.fill_between(xs, 0, ln.focus_norm, color=color, alpha=0.18, linewidth=0)
        ax.plot(xs, ln.focus_norm, color=color, linewidth=1.6)
        ax.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7)
        if peak_val is not None:
            ax.axvline(peak_val, color="#ffd54f", linestyle="-", linewidth=1.0, alpha=0.7)
        if lo_val is not None and hi_val is not None:
            ax.axvspan(lo_val, hi_val, color="#1a7f37", alpha=0.12, linewidth=0)
            txt = f"DoF = {width_val:.3g}{unit_suffix}"
        else:
            txt = "DoF = (not bounded above threshold)"
        ax.set_xlim(0, max(1.0, float(xs[-1])))
        ax.set_ylim(0, 1.05)
        ax.set_xlabel(x_label, color=text)
        ax.set_ylabel("Normalized focus", color=text)
        peak_str = f"{peak_val:.3g}{unit_suffix}" if peak_val is not None else "—"
        ax.set_title(
            f"{r.name}  line {i + 1}  ({r.metric})\npeak @ {peak_str},   {txt}",
            color=text,
            fontsize=10,
        )
        _style_axes(ax, fig_face, text)
    fig.suptitle(
        f"DoF line scan — {r.name}   "
        f"(threshold = {r.threshold:.2f}, half-win = {r.half_window} px)",
        color=text,
        fontsize=12,
        y=0.995,
    )
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    return fig


def build_points_fig(r: DoFChannelResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    if not r.points:
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "Pick points on the chart to populate the points-table.",
            ha="center",
            va="center",
            color=text,
        )
        ax.set_xticks([])
        ax.set_yticks([])
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
    labels = [p.point.label or f"#{i + 1}" for i, p in enumerate(r.points)]
    vals = [p.focus_norm for p in r.points]
    bars = ax_bar.bar(
        range(len(vals)), vals, color=color, alpha=0.85, edgecolor="white", linewidth=0.6
    )
    for b, v in zip(bars, vals, strict=False):
        ax_bar.text(
            b.get_x() + b.get_width() / 2,
            v + 0.01,
            f"{v:.2f}",
            ha="center",
            va="bottom",
            fontsize=8,
            color=text,
        )
    ax_bar.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7, alpha=0.6)
    ax_bar.set_xticks(range(len(labels)))
    ax_bar.set_xticklabels(labels, rotation=30, ha="right", color=text)
    ax_bar.set_ylim(0, 1.05)
    ax_bar.set_ylabel("Normalized focus", color=text)
    ax_bar.set_title(f"Picked points — {r.name}  ({r.metric})", color=text, fontsize=11)
    _style_axes(ax_bar, fig_face, text)

    # Z-scatter when calibration available
    if ax_z is not None:
        zs = np.array(
            [p.point.z_um for p in r.points if p.point.z_um is not None], dtype=np.float64
        )
        fs = np.array(
            [p.focus_norm for p in r.points if p.point.z_um is not None], dtype=np.float64
        )
        if zs.size >= 3:
            order = np.argsort(zs)
            zs_s, fs_s = zs[order], fs[order]
            ax_z.plot(
                zs_s, fs_s, "o-", color=color, linewidth=1.4, markeredgecolor="white", markersize=6
            )
            # Optional Gaussian fit
            try:
                from scipy.optimize import curve_fit

                def _gauss(z, a, mu, sigma, b):
                    return a * np.exp(-((z - mu) ** 2) / (2 * sigma**2)) + b

                p0 = (
                    1.0,
                    float(zs_s[np.argmax(fs_s)]),
                    max(1e-3, (zs_s[-1] - zs_s[0]) / 4),
                    float(fs_s.min()),
                )
                popt, _ = curve_fit(_gauss, zs_s, fs_s, p0=p0, maxfev=5000)
                zg = np.linspace(zs_s[0], zs_s[-1], 200)
                ax_z.plot(
                    zg,
                    _gauss(zg, *popt),
                    "--",
                    color="#ffd54f",
                    linewidth=1.2,
                    label="Gaussian fit",
                )
                # DoF range from fit at threshold of fit-amplitude (relative)
                a, mu, sigma, b = popt
                level = b + (a - b) * r.threshold / max(1e-9, fs_s.max())
                if a != 0 and (level - b) / a >= 1e-6:
                    arg = -2 * sigma**2 * np.log(max(1e-9, (level - b) / a))
                    if arg > 0:
                        half = np.sqrt(arg)
                        ax_z.axvspan(mu - half, mu + half, color="#1a7f37", alpha=0.12, linewidth=0)
                        ax_z.set_title(
                            f"Focus vs Z   peak μ = {mu:.2f} μm,   DoF ≈ {2 * half:.2f} μm",
                            color=text,
                            fontsize=11,
                        )
                ax_z.legend(
                    facecolor=fig_face,
                    edgecolor=text,
                    labelcolor=text,
                    fontsize=8,
                    loc="upper right",
                    framealpha=0.85,
                )
            except Exception:
                ax_z.set_title(
                    "Focus vs Z   (need >=3 points; fit skipped)", color=text, fontsize=11
                )
        else:
            ax_z.scatter(zs, fs, color=color)
            ax_z.set_title("Focus vs Z   (need >=3 points to fit)", color=text, fontsize=11)
        ax_z.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7, alpha=0.6)
        ax_z.set_xlabel("Z position (μm)", color=text)
        ax_z.set_ylabel("Normalized focus", color=text)
        ax_z.set_ylim(0, 1.05)
        _style_axes(ax_z, fig_face, text)
    fig.suptitle(f"Per-point focus — {r.name}", color=text, fontsize=12, y=0.995)
    return fig


def build_metric_compare_fig(
    r: DoFChannelResult, image: np.ndarray, *, fig_face: str, text: str
) -> Figure:
    """Re-scan the FIRST line with all four focus metrics."""
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    if not r.lines:
        ax = fig.add_subplot(111)
        ax.text(
            0.5, 0.5, "Draw a line to compare focus metrics.", ha="center", va="center", color=text
        )
        ax.set_xticks([])
        ax.set_yticks([])
        return fig
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    ln = r.lines[0]
    metric_colors = {
        "laplacian": "#1f77b4",
        "brenner": "#d62728",
        "tenengrad": "#2ca02c",
        "fft_hf": "#9467bd",
    }
    cal = (
        {"unit": r.unit_name, "px_per_unit_h": r.px_per_unit_h, "px_per_unit_v": r.px_per_unit_v}
        if r.is_calibrated
        else None
    )
    use_unit = r.is_calibrated and ln.unit_name
    unit_suffix = f" {ln.unit_name}" if use_unit else " px"
    for m in FOCUS_METRICS:
        scan = _scan_line(
            image,
            ln.p0,
            ln.p1,
            step_px=4.0,
            half_window=r.half_window,
            metric=m,
            threshold=r.threshold,
            calibration=cal,
        )
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
        width_txt = f", DoF = {width:.3g}{unit_suffix}" if width is not None else ""
        ax.plot(
            xs,
            scan.focus_norm,
            color=col,
            linewidth=1.4,
            alpha=0.85,
            label=f"{m}   ({peak_txt}{width_txt})",
        )
    ax.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7)
    ax.set_xlabel(
        f"Position along line  ({ln.unit_name})" if use_unit else "Position along line  (px)",
        color=text,
    )
    ax.set_ylabel("Normalized focus", color=text)
    x_max_arr = ln.positions_unit if use_unit and ln.positions_unit is not None else ln.positions
    ax.set_xlim(0, float(x_max_arr[-1]))
    ax.set_ylim(0, 1.05)
    ax.set_title(f"{r.name}  line 1 — focus-metric comparison", color=text, fontsize=11)
    ax.legend(
        facecolor=fig_face,
        edgecolor=text,
        labelcolor=text,
        fontsize=9,
        loc="upper right",
        framealpha=0.85,
    )
    _style_axes(ax, fig_face, text)
    fig.suptitle(
        "Focus-metric comparison along same line  "
        "(if all curves agree, the DoF estimate is robust)",
        color=text,
        fontsize=12,
        y=0.995,
    )
    return fig


def build_channel_compare_fig(
    results: list[DoFChannelResult], *, fig_face: str, text: str
) -> Figure:
    """Side-by-side line-scan curves + DoF-width bar chart."""
    fig = Figure(figsize=(12, 6), facecolor=fig_face)
    gs = fig.add_gridspec(1, 2, width_ratios=[1.4, 1.0], wspace=0.25)

    ax = fig.add_subplot(gs[0, 0])
    ax.set_facecolor(fig_face)
    any_line = False
    use_unit = any(
        r.is_calibrated and r.lines and r.lines[0].positions_unit is not None for r in results
    )
    unit_name = (
        next((r.lines[0].unit_name for r in results if r.lines and r.lines[0].unit_name), None)
        if use_unit
        else None
    )
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
        ax.plot(xs, ln.focus_norm, color=col, linewidth=1.5, label=r.name)
        if lo is not None and hi is not None:
            ax.axvspan(lo, hi, color=col, alpha=0.07, linewidth=0)
    if not any_line:
        ax.text(
            0.5,
            0.5,
            "Draw a line in the picker to compare channels.",
            ha="center",
            va="center",
            color=text,
        )
    else:
        ax.axhline(results[0].threshold, color=text, linestyle=":", linewidth=0.7)
        x_max = max(
            float(
                (
                    r.lines[0].positions_unit
                    if use_unit and r.lines[0].positions_unit is not None
                    else r.lines[0].positions
                )[-1]
            )
            for r in results
            if r.lines
        )
        ax.set_xlim(0, x_max)
        ax.set_ylim(0, 1.05)
        ax.set_xlabel(
            f"Position along line ({unit_name})" if use_unit else "Position along line (px)",
            color=text,
        )
        ax.set_ylabel("Normalized focus", color=text)
        ax.legend(
            facecolor=fig_face,
            edgecolor=text,
            labelcolor=text,
            fontsize=9,
            loc="upper right",
            framealpha=0.85,
        )
        ax.set_title("Focus profile per channel  (line 1)", color=text, fontsize=11)
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
    bars = ax_b.bar(
        range(len(names)), widths, color=cols, alpha=0.85, edgecolor="white", linewidth=0.6
    )
    for b, v in zip(bars, widths, strict=False):
        ax_b.text(
            b.get_x() + b.get_width() / 2,
            v + 0.5,
            f"{v:.3g}" if v else "—",
            ha="center",
            va="bottom",
            fontsize=8,
            color=text,
        )
    ax_b.set_xticks(range(len(names)))
    ax_b.set_xticklabels(names, rotation=30, ha="right", color=text)
    ax_b.set_ylabel(f"DoF width ({unit_name})" if use_unit else "DoF width (px)", color=text)
    ax_b.set_title("DoF width per channel", color=text, fontsize=11)
    _style_axes(ax_b, fig_face, text)

    fig.suptitle("Channel comparison — DoF", color=text, fontsize=12, y=0.995)
    return fig


# ---------------------------------------------------------------------------
# dof-rewrite-v1 — Gaussian fit / chromatic shift / tilt plane builders
# ---------------------------------------------------------------------------


def build_gaussian_fit_fig(r: DoFChannelResult, *, fig_face: str, text: str) -> Figure:
    """One panel per user-drawn line: focus curve + Gaussian fit overlay.

    Annotates μ (peak) + σ (CoC proxy) + FWHM (robust DoF) + R². When
    the fit failed (flat / degenerate profile) the panel falls back to
    the argmax + threshold band."""
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    if not r.lines:
        ax = fig.add_subplot(111)
        ax.text(
            0.5, 0.5, "Draw a line to see a Gaussian fit.", ha="center", va="center", color=text
        )
        return fig
    n = len(r.lines)
    cols = min(2, n)
    rows = int(np.ceil(n / cols))
    fig.set_size_inches(6.0 * cols, 3.6 * rows + 0.4, forward=False)
    color = _color(r.name)
    for i, ln in enumerate(r.lines):
        ax = fig.add_subplot(rows, cols, i + 1)
        ax.set_facecolor(fig_face)
        xs = ln.positions
        ax.fill_between(xs, 0, ln.focus_norm, color=color, alpha=0.15, linewidth=0)
        ax.plot(xs, ln.focus_norm, color=color, linewidth=1.5, label="measured")
        fit = ln.gaussian
        if fit.converged and fit.amp > 0:
            # Normalize the fit amplitude against the measured peak so
            # both curves share the 0..1 Y scale.
            y_peak_actual = float(ln.focus.max()) or 1.0
            ys_model = fit.amp * np.exp(-((xs - fit.mu) ** 2) / (2.0 * fit.sigma**2)) + fit.baseline
            ax.plot(
                xs,
                ys_model / y_peak_actual,
                "--",
                color="#ffd54f",
                linewidth=1.3,
                label=f"Gaussian fit (R² = {fit.r_squared:.3f})",
            )
            fwhm_lo = fit.mu - fit.fwhm / 2
            fwhm_hi = fit.mu + fit.fwhm / 2
            ax.axvspan(fwhm_lo, fwhm_hi, color="#ffd54f", alpha=0.1, linewidth=0)
            ax.axvline(fit.mu, color="#ffd54f", linewidth=0.9, alpha=0.85)
            ax.set_title(
                f"{r.name}  line {i + 1}  — Gaussian fit\n"
                f"μ = {fit.mu:.2f} px,   σ = {fit.sigma:.2f} px,   "
                f"FWHM = {fit.fwhm:.2f} px",
                color=text,
                fontsize=10,
            )
        else:
            ax.axvline(ln.peak_position_px, color="#ffd54f", linewidth=0.9, alpha=0.85)
            ax.set_title(
                f"{r.name}  line {i + 1}  — fit degenerate (showing argmax fallback)",
                color=text,
                fontsize=10,
            )
        ax.axhline(r.threshold, color=text, linestyle=":", linewidth=0.7)
        ax.set_xlim(0, float(xs[-1]) if xs.size else 1.0)
        ax.set_ylim(0, 1.10)
        ax.set_xlabel("Position along line (px)", color=text)
        ax.set_ylabel("Normalized focus", color=text)
        ax.legend(
            facecolor=fig_face,
            edgecolor=text,
            labelcolor=text,
            fontsize=9,
            loc="upper right",
            framealpha=0.85,
        )
        _style_axes(ax, fig_face, text)
    fig.suptitle(
        f"Gaussian-fit DoF — {r.name}   (parametric peak + FWHM is more "
        "noise-tolerant than argmax + threshold)",
        color=text,
        fontsize=12,
        y=0.995,
    )
    fig.tight_layout(rect=[0, 0, 1, 0.94])
    return fig


def build_chromatic_shift_fig(
    results: list[DoFChannelResult], *, fig_face: str, text: str
) -> Figure:
    """Per-channel peak-position comparison for each line. Used to
    diagnose chromatic aberration — ideally the four channels have
    near-identical peak positions; divergence = longitudinal CA."""
    fig = Figure(figsize=(11, 5.5), facecolor=fig_face)
    # Build the matrix: rows = lines (max across channels), cols = channel,
    # value = peak position in px (or unit if calibrated).
    max_lines = max((len(r.lines) for r in results), default=0)
    if max_lines == 0:
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "Draw a line on the picker to compare channels.",
            ha="center",
            va="center",
            color=text,
        )
        return fig
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    # Scatter: x = line index, y = peak position (μ if Gaussian converged,
    # else argmax). Error bars from the bootstrap CI where available.
    np.arange(max_lines, dtype=np.float64)
    offset_step = 0.10
    use_unit = any(
        r.is_calibrated and r.lines and r.lines[0].positions_unit is not None for r in results
    )
    unit_name = None
    if use_unit:
        for r in results:
            if r.is_calibrated and r.lines and r.lines[0].unit_name:
                unit_name = r.lines[0].unit_name
                break
    for ci, r in enumerate(results):
        xs = []
        ys = []
        err_lo = []
        err_hi = []
        col = _color(r.name)
        for i in range(max_lines):
            if i >= len(r.lines):
                continue
            ln = r.lines[i]
            peak_px = ln.gaussian.mu if ln.gaussian.converged else ln.peak_position_px
            if use_unit and ln.px_per_unit:
                peak = peak_px / ln.px_per_unit
            else:
                peak = peak_px
            xs.append(i + (ci - (len(results) - 1) / 2) * offset_step)
            ys.append(peak)
            # Use the bootstrap CI if available.
            ci95 = ln.peak_ci95_px
            if ci95 is not None:
                lo, hi = ci95
                if use_unit and ln.px_per_unit:
                    lo /= ln.px_per_unit
                    hi /= ln.px_per_unit
                err_lo.append(peak - lo)
                err_hi.append(hi - peak)
            else:
                err_lo.append(0.0)
                err_hi.append(0.0)
        if xs:
            ax.errorbar(
                xs,
                ys,
                yerr=[err_lo, err_hi],
                fmt="o",
                color=col,
                capsize=3,
                linewidth=1.4,
                markersize=7,
                markeredgecolor="white",
                markeredgewidth=0.6,
                label=r.name,
            )
    # Quantify the chromatic span: max peak - min peak per line (in px/unit).
    span_lines: list[float] = []
    for i in range(max_lines):
        peaks = []
        for r in results:
            if i < len(r.lines):
                ln = r.lines[i]
                p = ln.gaussian.mu if ln.gaussian.converged else ln.peak_position_px
                if use_unit and ln.px_per_unit:
                    p /= ln.px_per_unit
                peaks.append(p)
        if peaks:
            span_lines.append(max(peaks) - min(peaks))
    if span_lines:
        span_txt = " · ".join(f"L{i + 1}: {s:.2g}" for i, s in enumerate(span_lines))
    else:
        span_txt = "—"
    ax.set_xticks(list(range(max_lines)))
    ax.set_xticklabels([f"L{i + 1}" for i in range(max_lines)])
    ax.set_xlabel("Line #", color=text)
    ax.set_ylabel(f"Peak position ({unit_name})" if use_unit else "Peak position (px)", color=text)
    ax.set_title(
        f"Chromatic focus shift — peak position by channel  (range per line: {span_txt})",
        color=text,
        fontsize=11,
    )
    ax.legend(
        facecolor=fig_face,
        edgecolor=text,
        labelcolor=text,
        fontsize=9,
        loc="upper right",
        framealpha=0.85,
    )
    _style_axes(ax, fig_face, text)
    fig.suptitle(
        "Chromatic shift (error bars = 95% bootstrap CI when available)",
        color=text,
        fontsize=12,
        y=0.995,
    )
    return fig


def build_tilt_plane_fig(r: DoFChannelResult, *, fig_face: str, text: str) -> Figure:
    """Visualize the bilinear tilt-plane fit on the channel image.

    Top: original image with picked points annotated.
    Bottom: evaluated plane heatmap + residuals at each point.
    """
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    if r.tilt_plane is None or len(r.points) < 3:
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "Pick ≥3 points (with focus values) to fit a tilt plane.",
            ha="center",
            va="center",
            color=text,
        )
        return fig
    plane = r.tilt_plane
    a, b, c = plane["a"], plane["b"], plane["c"]
    gs = fig.add_gridspec(1, 2, width_ratios=[1.0, 1.0], wspace=0.22)

    # Left panel: image + picked points + residuals as colored dots.
    ax_img = fig.add_subplot(gs[0, 0])
    im = r.image
    vmin = float(np.percentile(im, 1))
    vmax = float(np.percentile(im, 99.5))
    if vmax <= vmin:
        vmax = vmin + 1
    ax_img.imshow(im, cmap="gray", vmin=vmin, vmax=vmax, interpolation="nearest")
    residuals = plane.get("residuals", [])
    for i, p in enumerate(r.points):
        resid = residuals[i] if i < len(residuals) else 0.0
        color = "#22c55e" if resid >= 0 else "#ef4444"
        size = 8 + abs(resid) * 10
        ax_img.plot(
            p.point.x,
            p.point.y,
            "o",
            color=color,
            markersize=min(size, 22),
            markeredgecolor="white",
            markeredgewidth=1.0,
        )
        ax_img.text(
            p.point.x + 6,
            p.point.y - 6,
            f"{p.point.label or ('#' + str(i + 1))}: {resid:+.3f}",
            color="white",
            fontsize=8,
            bbox=dict(facecolor="black", alpha=0.6, edgecolor="none", boxstyle="round,pad=0.2"),
        )
    ax_img.set_xticks([])
    ax_img.set_yticks([])
    ax_img.set_title(
        f"{r.name}  picks + residuals  (green = above plane, red = below)", color=text, fontsize=11
    )
    _style_axes(ax_img, fig_face, text)

    # Right panel: evaluated plane over the image bounding box.
    ax_p = fig.add_subplot(gs[0, 1])
    h, w = im.shape[:2]
    # Downsample grid to keep the render quick even on 4k images.
    step = max(1, min(h, w) // 120)
    yy, xx = np.mgrid[0:h:step, 0:w:step].astype(np.float64)
    plane_vals = a + b * xx + c * yy
    pvmin, pvmax = float(plane_vals.min()), float(plane_vals.max())
    if pvmax == pvmin:
        pvmax = pvmin + 1e-6
    im2 = ax_p.imshow(
        plane_vals,
        cmap="RdBu_r",
        vmin=pvmin,
        vmax=pvmax,
        extent=[0, w, h, 0],
        origin="upper",
        aspect="auto",
        interpolation="bilinear",
    )
    cb = fig.colorbar(im2, ax=ax_p, shrink=0.85)
    cb.set_label("Fit focus_norm", color=text)
    cb.ax.yaxis.set_tick_params(color=text)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
    for p in r.points:
        ax_p.plot(
            p.point.x,
            p.point.y,
            "o",
            color="white",
            markersize=5,
            markeredgecolor="black",
            markeredgewidth=1.0,
        )
    # Arrow pointing uphill — length scaled so it's visible.
    cx, cy = w / 2, h / 2
    slope = plane.get("slope_mag_per_px", 0.0)
    if slope > 1e-9:
        # Normalize (b, c) direction and draw from center.
        nx = b / slope
        ny = c / slope
        arrow_len = min(w, h) * 0.20
        ax_p.annotate(
            "",
            xy=(cx + nx * arrow_len, cy + ny * arrow_len),
            xytext=(cx, cy),
            arrowprops=dict(arrowstyle="->", color="black", linewidth=1.6),
        )
    ax_p.set_xticks([])
    ax_p.set_yticks([])
    ax_p.set_title(
        f"Bilinear tilt plane  R² = {plane.get('r_squared', 0):.3f}   "
        f"slope = {slope:.2e}/px   dir = {plane.get('tilt_direction_deg', 0):.1f}°",
        color=text,
        fontsize=10,
    )
    _style_axes(ax_p, fig_face, text)
    fig.suptitle(
        f"Field-curvature / sensor-tilt diagnostic — {r.name}", color=text, fontsize=12, y=0.995
    )
    return fig
