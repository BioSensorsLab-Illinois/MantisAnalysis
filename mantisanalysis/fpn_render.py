"""FPN analysis figures — pure matplotlib builders.

Figure catalog (for PNG export / offline reporting):

  overview   — 2x2 panel: ROI image / FPN map / histogram / stat table
  rowcol     — line plots of row-mean and col-mean profiles + std bands
  map        — large divergent (image − mean) with row/col profile sidebars
  psd        — log-magnitude 2-D FFT; periodic patterns as bright lines
  autocorr   — 2-D autocorrelation heatmap (Wiener–Khinchin)
  psd1d      — 1-D row + col PSDs with peak markers
  hotpix     — ROI image with hot-pixel markers + sortable outlier list
  compare    — per-channel / per-ROI bar chart comparison

The web UI renders interactive native-vector charts directly from the
FPN result JSON; these matplotlib builders back the offline PNG exports
and tier-2 smoke coverage. The previous ``open_fpn_window`` Qt viewer
was deleted in B-0016 alongside the PyQt app.
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from .fpn_analysis import FPNResult
from .plotting import CHANNEL_COLORS, _ch, _color, _style_axes  # noqa: F401

# ---------------------------------------------------------------------------
# Per-channel figure builders
# ---------------------------------------------------------------------------


def build_overview_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 7.6), facecolor=fig_face)
    gs = fig.add_gridspec(
        2, 2, hspace=0.30, wspace=0.30, width_ratios=[1.05, 1.0], height_ratios=[1.0, 0.85]
    )

    # Top-left: ROI image with kept-mask overlay
    ax_img = fig.add_subplot(gs[0, 0])
    _imshow_kept(ax_img, r, fig_face=fig_face, text=text)
    ax_img.set_title(f"{r.name}  ROI  ({r.n_kept}/{r.n_total} kept)", color=text, fontsize=11)

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
        f"FPN overview — {r.name}   DSNU = {r.dsnu_dn:.2f} DN,   PRNU = {r.prnu_pct:.2f}%",
        color=text,
        fontsize=12,
        y=0.995,
    )
    return fig


def build_rowcol_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    gs = fig.add_gridspec(2, 1, hspace=0.45)

    color = _color(r.name)
    # Row mean profile
    ax_r = fig.add_subplot(gs[0])
    rows = np.arange(len(r.row_means))
    ax_r.fill_between(
        rows,
        r.row_means - r.row_stds,
        r.row_means + r.row_stds,
        color=color,
        alpha=0.18,
        linewidth=0,
        label="±1σ intra-row",
    )
    ax_r.plot(
        rows,
        r.row_means,
        color=color,
        linewidth=1.2,
        label=f"row mean   (σ_rows = {r.row_noise_dn:.2f} DN)",
    )
    ax_r.axhline(r.mean, color=text, linestyle=":", linewidth=0.8, alpha=0.6)
    ax_r.set_xlim(0, max(1, len(rows) - 1))
    ax_r.set_xlabel("Row index", color=text)
    ax_r.set_ylabel("DN", color=text)
    ax_r.set_title(f"Row-mean profile  ({r.name})", color=text)
    _style_axes(ax_r, fig_face, text)
    ax_r.legend(
        facecolor=fig_face,
        edgecolor=text,
        labelcolor=text,
        fontsize=9,
        loc="upper right",
        framealpha=0.85,
    )

    # Column mean profile
    ax_c = fig.add_subplot(gs[1])
    cols = np.arange(len(r.col_means))
    ax_c.fill_between(
        cols,
        r.col_means - r.col_stds,
        r.col_means + r.col_stds,
        color=color,
        alpha=0.18,
        linewidth=0,
        label="±1σ intra-col",
    )
    ax_c.plot(
        cols,
        r.col_means,
        color=color,
        linewidth=1.2,
        label=f"col mean   (σ_cols = {r.col_noise_dn:.2f} DN)",
    )
    ax_c.axhline(r.mean, color=text, linestyle=":", linewidth=0.8, alpha=0.6)
    ax_c.set_xlim(0, max(1, len(cols) - 1))
    ax_c.set_xlabel("Column index", color=text)
    ax_c.set_ylabel("DN", color=text)
    ax_c.set_title(f"Column-mean profile  ({r.name})", color=text)
    _style_axes(ax_c, fig_face, text)
    ax_c.legend(
        facecolor=fig_face,
        edgecolor=text,
        labelcolor=text,
        fontsize=9,
        loc="upper right",
        framealpha=0.85,
    )

    fig.suptitle(
        f"Row & Column FPN — {r.name}   "
        f"(after subtracting row + col structure: "
        f"residual pixel σ = {r.residual_pixel_noise_dn:.2f} DN)",
        color=text,
        fontsize=12,
        y=0.995,
    )
    return fig


def build_map_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(10, 9), facecolor=fig_face)
    gs = fig.add_gridspec(
        2, 2, width_ratios=[4.0, 1.0], height_ratios=[1.0, 4.0], wspace=0.04, hspace=0.04
    )

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
    _imshow_fpn_map(ax_map, r, fig_face=fig_face, text=text, show_colorbar=True)
    ax_map.set_xlabel("Column", color=text)
    ax_map.set_ylabel("Row", color=text)

    fig.suptitle(
        f"2-D FPN map — {r.name}   (DSNU = {r.dsnu_dn:.2f} DN)", color=text, fontsize=12, y=0.995
    )
    return fig


def build_psd_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    fig = Figure(figsize=(8, 7), facecolor=fig_face)
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    psd = r.psd_log
    # Crop visualization to ignore the DC spike for contrast
    p_lo = float(np.percentile(psd, 1))
    p_hi = float(np.percentile(psd, 99.5))
    im = ax.imshow(
        psd,
        cmap="magma",
        origin="lower",
        extent=r.psd_extent,
        vmin=p_lo,
        vmax=p_hi,
        aspect="auto",
        interpolation="nearest",
    )
    ax.set_xlabel("Spatial frequency  (cycles / pixel, x)", color=text)
    ax.set_ylabel("Spatial frequency  (cycles / pixel, y)", color=text)
    ax.set_title(
        f"FPN power spectrum — {r.name}\n"
        f"(bright vertical line = column-banding;  bright horizontal line = "
        f"row-banding;  point = periodic 2-D pattern)",
        color=text,
        fontsize=10,
    )
    _style_axes(ax, fig_face, text)
    cb = fig.colorbar(im, ax=ax, shrink=0.85)
    cb.set_label("log10  |F(u, v)|² + 1", color=text)
    cb.ax.yaxis.set_tick_params(color=text)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
    return fig


def build_autocorr_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    """2-D autocorrelation heatmap (Wiener–Khinchin). Lag 0 is at the
    center; symmetric about both axes. Regular peaks at non-zero lag
    indicate periodic spatial structure (e.g. every N rows → horizontal
    banding; every M cols → vertical banding; an (a, b) pair → tiled
    fabric pattern). The center-cell ratio we clip against avoids the
    DC spike washing out the rest of the heatmap."""
    fig = Figure(figsize=(8, 7), facecolor=fig_face)
    ax = fig.add_subplot(111)
    ax.set_facecolor(fig_face)
    ac = r.autocorr_2d
    if ac.size == 0:
        ax.text(
            0.5,
            0.5,
            "no autocorrelation",
            ha="center",
            va="center",
            color=text,
            transform=ax.transAxes,
        )
        return fig
    # Clip the center ±1 cells so the surrounding structure is visible.
    cy, cx = ac.shape[0] // 2, ac.shape[1] // 2
    ac_disp = ac.copy()
    # Center the dynamic range on the off-center structure:
    off_center = np.delete(ac_disp.ravel(), cy * ac.shape[1] + cx)
    s = float(np.percentile(np.abs(off_center), 99.5)) if off_center.size else 1.0
    s = max(s, 1e-4)
    im = ax.imshow(
        ac_disp,
        cmap="RdBu_r",
        vmin=-s,
        vmax=+s,
        origin="lower",
        extent=r.autocorr_extent,
        aspect="auto",
        interpolation="nearest",
    )
    ax.axhline(0, color=text, linewidth=0.5, alpha=0.4)
    ax.axvline(0, color=text, linewidth=0.5, alpha=0.4)
    ax.set_xlabel("Lag x (pixels)", color=text)
    ax.set_ylabel("Lag y (pixels)", color=text)
    ax.set_title(
        f"FPN autocorrelation — {r.name}\n"
        "(normalized; center = 1. Off-center peaks → periodic spatial structure.)",
        color=text,
        fontsize=10,
    )
    _style_axes(ax, fig_face, text)
    cb = fig.colorbar(im, ax=ax, shrink=0.85)
    cb.set_label("normalized autocorr", color=text)
    cb.ax.yaxis.set_tick_params(color=text)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
    return fig


def build_psd1d_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    """Stacked 1-D PSDs of row-mean and col-mean series. Peaks away from
    DC indicate periodic row/column banding — common causes include ADC
    clocking, column-parallel readout phase mismatch, or 60 Hz AC pickup
    (at long integration times)."""
    fig = Figure(figsize=(11, 6.5), facecolor=fig_face)
    gs = fig.add_gridspec(2, 1, hspace=0.40)
    color = _color(r.name)

    def _plot(ax, freq, psd, peak_f, peak_a, title, xlab):
        if freq.size == 0:
            ax.text(
                0.5, 0.5, "no data", ha="center", va="center", color=text, transform=ax.transAxes
            )
            return
        # Drop DC for display (the DC line is typically huge and drowns
        # out the interesting peaks).
        if freq.size > 1:
            ax.semilogy(freq[1:], psd[1:] + 1e-9, color=color, linewidth=1.2)
        ax.axvline(
            peak_f, color="#ffd54f", linewidth=1.0, linestyle="--", label=f"peak @ {peak_f:.4f} cy"
        )
        ax.set_xlabel(xlab, color=text)
        ax.set_ylabel("PSD (log)", color=text)
        ax.set_title(title, color=text, fontsize=10)
        _style_axes(ax, fig_face, text)
        ax.legend(
            facecolor=fig_face,
            edgecolor=text,
            labelcolor=text,
            fontsize=9,
            loc="upper right",
            framealpha=0.85,
        )

    ax_r = fig.add_subplot(gs[0])
    _plot(
        ax_r,
        r.row_freq,
        r.row_psd,
        r.row_peak_freq,
        r.row_peak_amp,
        f"Row-mean 1-D PSD  ({r.name})",
        "Frequency  (cycles / row)",
    )
    ax_c = fig.add_subplot(gs[1])
    _plot(
        ax_c,
        r.col_freq,
        r.col_psd,
        r.col_peak_freq,
        r.col_peak_amp,
        f"Column-mean 1-D PSD  ({r.name})",
        "Frequency  (cycles / column)",
    )
    fig.suptitle(f"Row / Column banding spectra — {r.name}", color=text, fontsize=12, y=0.995)
    return fig


def build_hotpix_fig(r: FPNResult, *, fig_face: str, text: str) -> Figure:
    """ROI image underlay with hot (red) and cold (blue) pixel markers.
    Uses the `top_hot` / `top_cold` lists from the result (up to 50 of
    each) so the plot stays legible even when thousands of pixels flag."""
    fig = Figure(figsize=(10, 7), facecolor=fig_face)
    ax = fig.add_subplot(111)
    a = r.raw_image
    vmin = float(np.percentile(a, 1))
    vmax = float(np.percentile(a, 99.5))
    if vmax <= vmin:
        vmax = vmin + 1
    ax.imshow(a, cmap="gray", vmin=vmin, vmax=vmax, interpolation="nearest")
    for yy, xx, _val, _z in r.top_hot:
        ax.plot(
            xx,
            yy,
            marker="o",
            markersize=7,
            markerfacecolor="none",
            markeredgecolor="#f44336",
            markeredgewidth=1.3,
        )
    for yy, xx, _val, _z in r.top_cold:
        ax.plot(
            xx,
            yy,
            marker="s",
            markersize=7,
            markerfacecolor="none",
            markeredgecolor="#3b82f6",
            markeredgewidth=1.3,
        )
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_title(
        f"Hot / cold pixels — {r.name}  "
        f"(hot {r.hot_pixel_count}, cold {r.cold_pixel_count},  |z| > "
        f"{r.settings.hot_sigma:.1f})",
        color=text,
        fontsize=11,
    )
    _style_axes(ax, fig_face, text)
    return fig


def build_multi_channel_fig(results: list[FPNResult], *, fig_face: str, text: str) -> Figure:
    """Side-by-side comparison: top row = FPN maps, bottom = bar chart."""
    n = len(results)
    fig = Figure(figsize=(3.6 * n + 1.0, 8.5), facecolor=fig_face)
    gs = fig.add_gridspec(2, n, height_ratios=[1.4, 1.0], hspace=0.30)

    # Top: per-channel FPN map
    for i, r in enumerate(results):
        ax = fig.add_subplot(gs[0, i])
        _imshow_fpn_map(ax, r, fig_face=fig_face, text=text)
        ax.set_title(f"{r.name}   DSNU = {r.dsnu_dn:.2f} DN", color=_color(r.name), fontsize=10)

    # Bottom: grouped bar chart of headline metrics
    ax = fig.add_subplot(gs[1, :])
    ax.set_facecolor(fig_face)
    metrics = ["DSNU (DN)", "PRNU (%)", "σ_row (DN)", "σ_col (DN)", "Residual σ (DN)"]
    x = np.arange(len(metrics))
    width = 0.8 / max(1, n)
    for i, r in enumerate(results):
        vals = [r.dsnu_dn, r.prnu_pct, r.row_noise_dn, r.col_noise_dn, r.residual_pixel_noise_dn]
        col = _color(r.name)
        bars = ax.bar(
            x + (i - (n - 1) / 2) * width,
            vals,
            width=width,
            label=r.name,
            color=col,
            alpha=0.85,
            edgecolor="white",
            linewidth=0.6,
        )
        for b, v in zip(bars, vals, strict=False):
            ax.text(
                b.get_x() + b.get_width() / 2,
                v + abs(v) * 0.02 + 0.01,
                f"{v:.2f}",
                ha="center",
                va="bottom",
                fontsize=7.5,
                color=text,
            )
    ax.set_xticks(x)
    ax.set_xticklabels(metrics, color=text)
    ax.set_ylabel("Value (units in label)", color=text)
    ax.legend(
        loc="upper right", facecolor=fig_face, edgecolor=text, labelcolor=text, framealpha=0.85
    )
    _style_axes(ax, fig_face, text)
    ax.set_title("Per-channel FPN summary", color=text, fontsize=11)
    return fig


# ---------------------------------------------------------------------------
# Sub-panel helpers
# ---------------------------------------------------------------------------


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
    ax.set_xticks([])
    ax.set_yticks([])
    _style_axes(ax, fig_face, text)


def _imshow_fpn_map(ax, r: FPNResult, *, fig_face, text, show_colorbar: bool = False):
    m = r.fpn_map
    finite = m[np.isfinite(m)]
    if finite.size == 0:
        return
    s = float(np.percentile(np.abs(finite), 98))
    if s <= 0:
        s = 1.0
    im = ax.imshow(m, cmap="RdBu_r", vmin=-s, vmax=+s, interpolation="nearest")
    ax.set_xticks([])
    ax.set_yticks([])
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
    ax.hist(
        r.image.ravel(),
        bins=bins,
        color="0.7",
        alpha=0.55,
        label="all pixels",
        histtype="stepfilled",
        linewidth=0,
    )
    ax.hist(
        kept, bins=bins, color=color, alpha=0.85, label="kept", histtype="stepfilled", linewidth=0
    )
    ax.axvline(r.mean, color=text, linestyle="-", linewidth=1.0, label=f"μ = {r.mean:.2f}")
    ax.axvline(
        r.mean - r.std, color=text, linestyle=":", linewidth=0.8, label=f"μ ± σ ({r.std:.2f})"
    )
    ax.axvline(r.mean + r.std, color=text, linestyle=":", linewidth=0.8)
    ax.set_xlabel("Pixel value (DN)", color=text)
    ax.set_ylabel("Count", color=text)
    ax.set_title("Pixel-value distribution", color=text, fontsize=10)
    ax.legend(
        fontsize=8,
        facecolor=fig_face,
        edgecolor=text,
        labelcolor=text,
        framealpha=0.85,
        loc="upper right",
    )
    _style_axes(ax, fig_face, text)


def _stat_table(ax, r: FPNResult, *, text):
    ax.axis("off")
    rows = [
        ("Pixels (kept / total)", f"{r.n_kept:,} / {r.n_total:,}"),
        ("Signal mean (μ)", f"{r.mean_signal:.3f} DN"),
        ("Residual mean", f"{r.mean:.3f} DN"),
        ("Std (σ) = DSNU", f"{r.std:.3f} DN"),
        ("PRNU = σ / μ", f"{r.prnu_pct:.3f} %"),
        ("Median", f"{r.median:.3f} DN"),
        ("Min / Max", f"{r.minv:.1f} / {r.maxv:.1f} DN"),
        ("p1 / p99", f"{r.p1:.1f} / {r.p99:.1f} DN"),
        ("Row-mean σ", f"{r.row_noise_dn:.3f} DN"),
        ("Col-mean σ", f"{r.col_noise_dn:.3f} DN"),
        ("σ after row strip", f"{r.dsnu_row_only_dn:.3f} DN"),
        ("σ after col strip", f"{r.dsnu_col_only_dn:.3f} DN"),
        ("σ after row+col", f"{r.residual_pixel_noise_dn:.3f} DN"),
        ("Row 1-D peak freq", f"{r.row_peak_freq:.4f} cy/row"),
        ("Col 1-D peak freq", f"{r.col_peak_freq:.4f} cy/col"),
        ("Hot / cold pixels", f"{r.hot_pixel_count} / {r.cold_pixel_count}"),
        ("Drift plane", r.drift_order),
    ]
    settings = r.settings
    rows.append(("ISP", _isp_summary(settings)))
    rows.append(("Outlier cuts", f"bottom {settings.lo_pct:.1f}% / top {settings.hi_pct:.1f}%"))
    table_text = "\n".join(f"  {k:<22}{v:>22}" for k, v in rows)
    ax.text(
        0.0,
        1.0,
        "Statistics",
        color=text,
        fontsize=11,
        fontweight="bold",
        ha="left",
        va="top",
        transform=ax.transAxes,
    )
    ax.text(
        0.0,
        0.92,
        table_text,
        color=text,
        fontfamily="monospace",
        fontsize=9.5,
        ha="left",
        va="top",
        transform=ax.transAxes,
    )


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
