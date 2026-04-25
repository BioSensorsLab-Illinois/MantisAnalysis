"""Matplotlib figure builders for the USAF analysis modal.

Each builder takes:
  * ``channel_measurements``: dict ``{channel_name: [LineMeasurement, ...]}``
    where the list is parallel to ``specs`` (i.e. same order).
  * ``specs``: the picked line specs.
  * ``channel_images``: dict ``{channel_name: np.ndarray}`` (post-ISP, already
    transformed). Used for the detection-overlay figure.
  * ``threshold``: Michelson pass/fail threshold in [0, 1].
  * ``theme``: ``"light"`` | ``"dark"``.

Returns a ``matplotlib.Figure`` that can be serialized via
``mantisanalysis.figures.figure_to_png``.

Design intent: dense, readable, publication-grade output that doesn't rely
on any Qt. Uses one consistent style across all figures — neutral
backgrounds, medium contrast grid lines, channel-colored data.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import matplotlib

matplotlib.use("Agg")  # must be before pyplot

import matplotlib.patches as mpatches
import matplotlib.pyplot as plt  # noqa: F401 — force Agg binding
import numpy as np
from matplotlib.figure import Figure

from .usaf_groups import LineMeasurement, LineSpec, detection_limit_lp_mm

# ---------------------------------------------------------------------------
# Colors + style tokens — mirror the web theme
# ---------------------------------------------------------------------------

CHANNEL_COLORS = {
    "R": "#f04b4b",
    "G": "#3aba5e",
    "B": "#4a9eff",
    "NIR": "#b06bff",
    "Y": "#d0d4da",
    "L": "#d0d4da",
}

DIR_STYLES = {
    "H": {"linestyle": "-", "marker": "o", "markersize": 5.0},
    "V": {"linestyle": "--", "marker": "s", "markersize": 4.6},
}

LIGHT = {
    "fig_face": "#ffffff",
    "ax_face": "#ffffff",
    "text": "#14181f",
    "text_muted": "#5d6773",
    "grid": "#e4e7ec",
    "table_alt": "#f6f7f9",
    "ok": "#1a7f37",
    "warn": "#b87b00",
    "fail": "#cf222e",
    "nyq": "#d97706",
}
DARK = {
    "fig_face": "#181b21",
    "ax_face": "#1e2128",
    "text": "#e8eaed",
    "text_muted": "#9aa3af",
    "grid": "#272b33",
    "table_alt": "#23262d",
    "ok": "#3fb950",
    "warn": "#e5a13a",
    "fail": "#ff6b6b",
    "nyq": "#d97706",
}


def _theme(theme: str) -> dict:
    return DARK if theme == "dark" else LIGHT


def _channel_color(name: str) -> str:
    """`HG-R` → R color, `L` → grayscale. Default gray for unknown."""
    band = name.split("-")[-1] if "-" in name else name
    return CHANNEL_COLORS.get(band, "#888888")


def _style_axes(ax, th: dict, *, grid: bool = True) -> None:
    ax.set_facecolor(th["ax_face"])
    for spine in ax.spines.values():
        spine.set_edgecolor(th["grid"])
        spine.set_linewidth(0.8)
    ax.tick_params(colors=th["text_muted"], which="both", labelsize=9)
    ax.xaxis.label.set_color(th["text_muted"])
    ax.yaxis.label.set_color(th["text_muted"])
    ax.title.set_color(th["text"])
    if grid:
        ax.grid(True, color=th["grid"], linestyle="-", linewidth=0.6, alpha=0.7)
        ax.set_axisbelow(True)


def _stretch(img: np.ndarray, lo_pct: float = 1.0, hi_pct: float = 99.5) -> tuple[float, float]:
    a = img.astype(np.float32, copy=False)
    vmin, vmax = np.percentile(a, [lo_pct, hi_pct])
    if vmax <= vmin:
        vmax = vmin + 1.0
    return float(vmin), float(vmax)


# ---------------------------------------------------------------------------
# 1. MTF curves — Michelson vs lp/mm per channel, H and V directions
# ---------------------------------------------------------------------------


def build_mtf_curves_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    *,
    threshold: float = 0.3,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    fig = Figure(figsize=(10.5, 6.5), facecolor=th["fig_face"])
    ax = fig.add_subplot(111)
    _style_axes(ax, th)

    # For each channel, plot Michelson vs lp/mm for both directions.
    lim_per_channel: dict[str, float | None] = {}
    all_lp = []
    for ch, meas in channel_measurements.items():
        if not meas:
            continue
        color = _channel_color(ch)
        for direction, style in DIR_STYLES.items():
            subset = [m for m in meas if m.spec.direction == direction]
            if not subset:
                continue
            subset = sorted(subset, key=lambda m: m.lp_mm)
            xs = [m.lp_mm for m in subset]
            ys = [m.modulation_pct for m in subset]
            all_lp.extend(xs)
            ax.plot(xs, ys, color=color, linewidth=1.3, alpha=0.8, linestyle=style["linestyle"])
            ax.scatter(
                xs,
                ys,
                color=color,
                marker=style["marker"],
                s=style["markersize"] ** 2,
                edgecolor="white",
                linewidth=0.9,
                zorder=4,
                label=f"{ch} {direction}",
            )
        # Detection limit for the combined measurement list:
        lim, _ = detection_limit_lp_mm(meas, float(threshold))
        lim_per_channel[ch] = lim
        if lim is not None:
            ax.axvline(lim, color=color, linestyle=":", linewidth=0.9, alpha=0.6)

    ax.axhline(threshold, color=th["text_muted"], linestyle="--", linewidth=0.9, alpha=0.7)
    ax.text(
        ax.get_xlim()[1] if not all_lp else max(all_lp) * 1.05,
        threshold,
        f"  threshold  {int(threshold * 100)}%",
        va="center",
        ha="left",
        color=th["text_muted"],
        fontsize=9,
    )

    if all_lp:
        ax.set_xlim(max(0.5, min(all_lp) / 1.5), max(all_lp) * 1.6)
    ax.set_xscale("log")
    ax.set_ylim(0, 1.1)
    ax.set_xlabel("Spatial frequency  (lp/mm @ chart)", fontsize=10.5)
    ax.set_ylabel("Michelson contrast (P10/P90)", fontsize=10.5)

    # Summary line near the title: detection limits per channel.
    parts = []
    for ch, lim in lim_per_channel.items():
        parts.append(f"{ch}: {lim:.2f}" if lim is not None else f"{ch}: —")
    ax.set_title(
        "USAF MTF — Michelson vs spatial frequency",
        fontsize=12.5,
        pad=14,
        loc="left",
        color=th["text"],
    )
    fig.text(
        0.5,
        0.945,
        "detection limit @ threshold  ·  " + "  ·  ".join(parts),
        ha="center",
        va="bottom",
        fontsize=9.5,
        color=th["text_muted"],
    )

    ax.legend(
        loc="upper right",
        fontsize=8.5,
        labelcolor=th["text"],
        facecolor=th["ax_face"],
        edgecolor=th["grid"],
        framealpha=0.9,
        ncols=min(4, max(1, len(channel_measurements))),
    )

    fig.tight_layout(rect=(0, 0, 1, 0.94))
    return fig


# ---------------------------------------------------------------------------
# 2. Profile gallery — one small plot per picked line, cross-channel overlay
# ---------------------------------------------------------------------------


def build_profile_gallery_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    specs: Sequence[LineSpec],
    *,
    threshold: float = 0.3,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    n = len(specs)
    if n == 0:
        fig = Figure(figsize=(10, 3), facecolor=th["fig_face"])
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "No lines picked.",
            ha="center",
            va="center",
            color=th["text_muted"],
            fontsize=11,
        )
        ax.set_axis_off()
        return fig

    cols = 3 if n >= 3 else n
    rows = int(np.ceil(n / cols))
    fig = Figure(figsize=(cols * 3.6, rows * 2.5 + 0.6), facecolor=th["fig_face"])
    gs = fig.add_gridspec(rows, cols, wspace=0.25, hspace=0.55)

    for i, spec in enumerate(specs):
        r, c = divmod(i, cols)
        ax = fig.add_subplot(gs[r, c])
        _style_axes(ax, th)

        # Overlay one profile per channel (post-ISP, already measured).
        first_m = None
        for ch, ms in channel_measurements.items():
            if i >= len(ms):
                continue
            m = ms[i]
            first_m = first_m or m
            color = _channel_color(ch)
            prof = np.asarray(m.profile)
            t = np.linspace(0, m.line_length_px, prof.size)
            ax.plot(t, prof, color=color, linewidth=1.2, alpha=0.9, label=ch)

        m0 = first_m
        ax.set_title(
            f"G{spec.group}E{spec.element}{spec.direction}   "
            f"{2 ** (spec.group + (spec.element - 1) / 6):.2f} lp/mm",
            fontsize=10,
            loc="left",
            color=th["text"],
        )
        if m0 is not None:
            ax.set_xlim(0, m0.line_length_px)
            # Mich annotation per channel
            parts = []
            for ch, ms in channel_measurements.items():
                if i < len(ms):
                    parts.append(f"{ch}={ms[i].modulation_pct:.2f}")
            ax.text(
                0.02,
                0.02,
                "  ".join(parts[:4]),
                transform=ax.transAxes,
                fontsize=8,
                color=th["text_muted"],
                ha="left",
                va="bottom",
                family="monospace",
            )
        ax.set_xlabel("distance along line (px)", fontsize=9)
        ax.set_ylabel("DN", fontsize=9)

    fig.suptitle(
        "Profile gallery — extracted intensity along each picked line",
        fontsize=12,
        color=th["text"],
        y=0.995,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    return fig


# ---------------------------------------------------------------------------
# 3. Summary table — one row per channel × line
# ---------------------------------------------------------------------------


def build_summary_table_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    specs: Sequence[LineSpec],
    *,
    threshold: float = 0.3,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    rows: list[tuple[str, LineSpec, LineMeasurement]] = []
    for ch, ms in channel_measurements.items():
        for spec, m in zip(specs, ms, strict=False):
            rows.append((ch, spec, m))
    if not rows:
        fig = Figure(figsize=(10, 3), facecolor=th["fig_face"])
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "No measurements.",
            ha="center",
            va="center",
            color=th["text_muted"],
            fontsize=11,
        )
        ax.set_axis_off()
        return fig

    headers = [
        "Channel",
        "G",
        "E",
        "D",
        "lp/mm",
        "Mich (P)",
        "Mich (FFT)",
        "Mich (min/max)",
        "s/cyc",
        "Reliability",
    ]
    cell_rows = []
    row_colors = []
    for ch, spec, m in rows:
        cell_rows.append(
            [
                ch,
                str(spec.group),
                str(spec.element),
                spec.direction,
                f"{m.lp_mm:.2f}",
                f"{m.modulation_pct:.3f}",
                f"{m.modulation_fft:.3f}",
                f"{m.modulation_minmax:.3f}",
                f"{m.samples_per_cycle:.1f}",
                m.reliability,
            ]
        )
        pass_mich = m.modulation_pct >= threshold
        below_nyq = m.samples_per_cycle < 3.0
        if below_nyq:
            row_colors.append(th["nyq"])
        elif pass_mich:
            row_colors.append(th["ok"])
        else:
            row_colors.append(th["fail"])

    # Figure sized to row count (generous row height for readability).
    row_h = 0.36
    fig_h = max(2.5, 1.6 + row_h * len(cell_rows))
    fig = Figure(figsize=(13, fig_h), facecolor=th["fig_face"])
    ax = fig.add_subplot(111)
    ax.set_axis_off()

    # Table
    table = ax.table(
        cellText=cell_rows,
        colLabels=headers,
        loc="upper center",
        cellLoc="center",
        colLoc="center",
    )
    table.auto_set_font_size(False)
    table.set_fontsize(10)

    # Style header row
    n_cols = len(headers)
    for c in range(n_cols):
        cell = table[(0, c)]
        cell.set_facecolor(th["grid"])
        cell.set_text_props(color=th["text"], weight="bold")
        cell.set_edgecolor(th["grid"])
        cell.set_height(0.065)

    # Style data rows: alternating background, status dot in Channel cell.
    for r_idx, (ch, _, _) in enumerate(rows, start=1):
        base = th["fig_face"] if r_idx % 2 == 1 else th["table_alt"]
        for c in range(n_cols):
            cell = table[(r_idx, c)]
            cell.set_facecolor(base)
            cell.set_text_props(color=th["text"])
            cell.set_edgecolor(th["grid"])
            cell.set_height(0.058)
        # Color-code the Mich (P) column by pass/fail/below-Nyquist.
        mich_cell = table[(r_idx, 5)]
        mich_cell.set_text_props(color=row_colors[r_idx - 1], weight="bold")
        # Color channel cell by its color swatch.
        ch_cell = table[(r_idx, 0)]
        ch_cell.set_text_props(color=_channel_color(ch), weight="bold")

    table.scale(1.0, 1.22)

    fig.suptitle(
        f"Summary table — {len(cell_rows)} measurement"
        f"{'s' if len(cell_rows) != 1 else ''} "
        f"· threshold {int(threshold * 100)}%",
        fontsize=12,
        color=th["text"],
        y=0.985,
    )
    return fig


# ---------------------------------------------------------------------------
# 4. Detection overlay — per-channel image with picked lines coloured pass/fail
# ---------------------------------------------------------------------------


def build_detection_overlay_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    channel_images: dict[str, np.ndarray],
    specs: Sequence[LineSpec],
    *,
    threshold: float = 0.3,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    channels = list(channel_measurements.keys())
    n = len(channels)
    if n == 0 or not specs:
        fig = Figure(figsize=(10, 4), facecolor=th["fig_face"])
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "Nothing to overlay.",
            ha="center",
            va="center",
            color=th["text_muted"],
            fontsize=11,
        )
        ax.set_axis_off()
        return fig

    cols = min(4, n)
    rows = int(np.ceil(n / cols))
    fig = Figure(figsize=(cols * 3.8, rows * 3.5 + 0.5), facecolor=th["fig_face"])
    gs = fig.add_gridspec(rows, cols, wspace=0.12, hspace=0.25)

    for idx, ch in enumerate(channels):
        r, c = divmod(idx, cols)
        ax = fig.add_subplot(gs[r, c])
        img = channel_images.get(ch)
        if img is None:
            ax.set_axis_off()
            continue
        vmin, vmax = _stretch(img)
        ax.imshow(img, cmap="gray", vmin=vmin, vmax=vmax, interpolation="nearest")
        ax.set_xticks([])
        ax.set_yticks([])
        for spine in ax.spines.values():
            spine.set_edgecolor(th["grid"])

        # Draw every line, coloured by pass/fail/below-Nyquist.
        meas = channel_measurements[ch]
        for spec, m in zip(specs, meas, strict=False):
            below_nyq = m.samples_per_cycle < 3.0
            pass_ = m.modulation_pct >= threshold
            color = th["nyq"] if below_nyq else (th["ok"] if pass_ else th["fail"])
            ax.plot(
                [spec.p0[0], spec.p1[0]],
                [spec.p0[1], spec.p1[1]],
                color=color,
                linewidth=1.8,
                alpha=0.95,
            )
            mx, my = (spec.p0[0] + spec.p1[0]) / 2, (spec.p0[1] + spec.p1[1]) / 2
            ax.text(
                mx,
                my - 10,
                f"G{spec.group}E{spec.element}{spec.direction}",
                color="#ffffff",
                fontsize=7.5,
                ha="center",
                va="bottom",
                fontfamily="monospace",
                bbox=dict(boxstyle="round,pad=0.18", fc=(0.06, 0.07, 0.09, 0.85), ec=color, lw=0.7),
            )
        ax.set_title(ch, fontsize=11, color=_channel_color(ch), loc="left")

    # Legend across the bottom
    handles = [
        mpatches.Patch(color=th["ok"], label=f"pass  (≥ {int(threshold * 100)}%)"),
        mpatches.Patch(color=th["fail"], label=f"fail  (< {int(threshold * 100)}%)"),
        mpatches.Patch(color=th["nyq"], label="below Nyquist  (s/cyc < 3)"),
    ]
    fig.legend(
        handles=handles,
        loc="lower center",
        ncol=3,
        fontsize=9.5,
        frameon=False,
        bbox_to_anchor=(0.5, 0.005),
        labelcolor=th["text"],
    )

    fig.suptitle(
        "Detection overlay — picked lines colored by outcome", fontsize=12, color=th["text"], y=0.99
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.96))
    return fig


# ---------------------------------------------------------------------------
# 5. Group sweep — max Michelson per group per channel
# ---------------------------------------------------------------------------


def build_group_sweep_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    *,
    threshold: float = 0.3,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    fig = Figure(figsize=(10, 5.5), facecolor=th["fig_face"])
    ax = fig.add_subplot(111)
    _style_axes(ax, th)

    # Collect per-channel, per-group mean + max modulation.
    # Groups 0..5. Skip empty.
    groups = sorted({m.spec.group for ms in channel_measurements.values() for m in ms})
    if not groups:
        ax.text(
            0.5,
            0.5,
            "No measurements.",
            ha="center",
            va="center",
            transform=ax.transAxes,
            color=th["text_muted"],
        )
        ax.set_axis_off()
        return fig

    n_channels = len(channel_measurements)
    bar_w = 0.8 / max(1, n_channels)
    x = np.arange(len(groups))
    for i, (ch, meas) in enumerate(channel_measurements.items()):
        means = []
        for g in groups:
            vals = [m.modulation_pct for m in meas if m.spec.group == g]
            means.append(np.mean(vals) if vals else 0.0)
        offset = (i - (n_channels - 1) / 2) * bar_w
        ax.bar(
            x + offset,
            means,
            bar_w,
            label=ch,
            color=_channel_color(ch),
            edgecolor="white",
            linewidth=0.8,
        )

    ax.axhline(threshold, color=th["text_muted"], linestyle="--", linewidth=0.9, alpha=0.8)
    ax.text(
        ax.get_xlim()[1],
        threshold,
        f"  t={int(threshold * 100)}%",
        va="center",
        ha="left",
        color=th["text_muted"],
        fontsize=9,
    )
    ax.set_xticks(x)
    ax.set_xticklabels([f"G{g}" for g in groups])
    ax.set_ylim(0, 1.05)
    ax.set_xlabel("USAF group", fontsize=10.5)
    ax.set_ylabel("mean Michelson (P10/P90) across picked elements", fontsize=10.5)
    ax.set_title(
        "Group sweep — mean contrast per group, per channel",
        fontsize=12,
        loc="left",
        color=th["text"],
        pad=12,
    )
    ax.legend(
        loc="upper right",
        fontsize=9,
        labelcolor=th["text"],
        facecolor=th["ax_face"],
        edgecolor=th["grid"],
        framealpha=0.9,
        ncols=min(4, max(1, n_channels)),
    )
    fig.tight_layout()
    return fig


# ---------------------------------------------------------------------------
# 6. FFT spectra — one plot per line, magnitude vs cy/px, fundamental marked
# ---------------------------------------------------------------------------


def build_fft_spectra_fig(
    channel_measurements: dict[str, list[LineMeasurement]],
    specs: Sequence[LineSpec],
    *,
    theme: str = "light",
) -> Figure:
    th = _theme(theme)
    n = len(specs)
    if n == 0:
        fig = Figure(figsize=(10, 3), facecolor=th["fig_face"])
        ax = fig.add_subplot(111)
        ax.text(
            0.5,
            0.5,
            "No lines picked.",
            ha="center",
            va="center",
            color=th["text_muted"],
            fontsize=11,
        )
        ax.set_axis_off()
        return fig
    cols = 3 if n >= 3 else n
    rows = int(np.ceil(n / cols))
    fig = Figure(figsize=(cols * 3.6, rows * 2.4 + 0.5), facecolor=th["fig_face"])
    gs = fig.add_gridspec(rows, cols, wspace=0.3, hspace=0.55)

    for i, spec in enumerate(specs):
        r, c = divmod(i, cols)
        ax = fig.add_subplot(gs[r, c])
        _style_axes(ax, th)
        first_m = None
        for ch, ms in channel_measurements.items():
            if i >= len(ms):
                continue
            m = ms[i]
            first_m = first_m or m
            prof = np.asarray(m.profile)
            if prof.size < 4:
                continue
            pad = max(64, 1 << int(np.ceil(np.log2(max(64, prof.size * 4)))))
            spec_fft = np.fft.rfft(prof - prof.mean(), n=pad)
            freqs = np.fft.rfftfreq(pad, d=1.0)
            mag = np.abs(spec_fft)
            mag /= mag.max() if mag.max() > 0 else 1.0
            ax.plot(freqs, mag, color=_channel_color(ch), linewidth=1.1, alpha=0.9, label=ch)
        if first_m is not None and first_m.f_expected_cy_per_sample > 0:
            ax.axvline(
                first_m.f_expected_cy_per_sample,
                color=th["text_muted"],
                linestyle="--",
                linewidth=0.8,
                alpha=0.8,
            )
        ax.set_xlim(0, 0.5)
        ax.set_ylim(0, 1.05)
        ax.set_title(
            f"G{spec.group}E{spec.element}{spec.direction}",
            fontsize=10,
            loc="left",
            color=th["text"],
        )
        ax.set_xlabel("freq (cy/sample)", fontsize=9)
        ax.set_ylabel("|FFT| (norm)", fontsize=9)

    fig.suptitle(
        "FFT spectra — per-line magnitude, bar-fundamental marked",
        fontsize=12,
        color=th["text"],
        y=0.995,
    )
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    return fig


# ---------------------------------------------------------------------------
# Orchestrator — builds all figures, returns dict of PNGs
# ---------------------------------------------------------------------------


@dataclass
class AnalyzeResult:
    figures: dict[str, bytes]
    summary_channel: str
    per_channel_detection_limit: dict[str, float | None]


def build_all_usaf_figures(
    channel_images: dict[str, np.ndarray],
    specs: Sequence[LineSpec],
    *,
    threshold: float = 0.3,
    theme: str = "light",
    swath_width: float = 8.0,
    method: str = "percentile",
) -> AnalyzeResult:
    """Run every picked line on every requested channel, then build the full
    set of analysis figures. Returns ``AnalyzeResult`` with PNG bytes keyed
    by figure name."""
    from .figures import figure_to_png
    from .usaf_groups import measure_line

    channel_measurements: dict[str, list[LineMeasurement]] = {}
    for ch, img in channel_images.items():
        ms: list[LineMeasurement] = []
        for spec in specs:
            try:
                ms.append(measure_line(img, spec, swath_width=float(swath_width), method=method))
            except ValueError:
                # Line too short or degenerate; skip rather than abort.
                continue
        channel_measurements[ch] = ms

    limits: dict[str, float | None] = {}
    for ch, ms in channel_measurements.items():
        lim, _ = detection_limit_lp_mm(ms, float(threshold))
        limits[ch] = lim

    figs = {
        "mtf_curves": build_mtf_curves_fig(channel_measurements, threshold=threshold, theme=theme),
        "profile_gallery": build_profile_gallery_fig(
            channel_measurements, specs, threshold=threshold, theme=theme
        ),
        "summary_table": build_summary_table_fig(
            channel_measurements, specs, threshold=threshold, theme=theme
        ),
        "detection_overlay": build_detection_overlay_fig(
            channel_measurements, channel_images, specs, threshold=threshold, theme=theme
        ),
        "group_sweep": build_group_sweep_fig(
            channel_measurements, threshold=threshold, theme=theme
        ),
        "fft_spectra": build_fft_spectra_fig(channel_measurements, specs, theme=theme),
    }

    png_bytes = {k: figure_to_png(v) for k, v in figs.items()}
    return AnalyzeResult(
        figures=png_bytes,
        summary_channel=next(iter(channel_images), ""),
        per_channel_detection_limit=limits,
    )
