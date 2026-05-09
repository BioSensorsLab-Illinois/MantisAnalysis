"""USAF lateral-resolution analysis for the GSense RGB-NIR pipeline.

Per gain (HG, LG) and per channel (R, G, B):
    - rotate the channel image 180 degrees (h+v flip applied to the raw frame)
    - locate the USAF-chart bounding box
    - extract a horizontal strip through the row with the most periodic
      content (probes vertical bars) and a vertical strip through the
      column with the most periodic content (probes horizontal bars)
    - average each strip to a 1D profile, detrend, Hann-window, rFFT
    - report MTF50 / MTF20 / MTF10 detection limits per direction

Outputs (in --out-dir, default `outputs/`):
    fig_<gain>_panels.png       (cropped chart + per-channel H&V spectra)
    fig_<gain>_overlay.png      (R/G/B overlaid spectra, separate H/V)
    fig_HG_vs_LG_summary.png    (bar comparison of detection limits)

Usage:
    python scripts/run_usaf_resolution.py <h5-path> [out-dir]
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch, Rectangle

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mantisanalysis.extract import (
    extract_rgb_nir,
    load_recording,
    split_dual_gain,
)
from mantisanalysis.resolution import (
    ChannelResult,
    DirectionResult,
    analyze_channel,
    rotate_180,
)

# ---------------------------------------------------------------------------
# Style


def _set_journal_style() -> None:
    plt.rcParams.update(
        {
            "font.family": "DejaVu Sans",
            "font.size": 10,
            "axes.titlesize": 11,
            "axes.labelsize": 10,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.linewidth": 0.8,
            "xtick.major.width": 0.8,
            "ytick.major.width": 0.8,
            "xtick.direction": "out",
            "ytick.direction": "out",
            "legend.frameon": False,
            "legend.fontsize": 9,
            "figure.dpi": 130,
            "savefig.dpi": 220,
            "savefig.bbox": "tight",
        }
    )


CHANNEL_COLORS = {"R": "#d62728", "G": "#2ca02c", "B": "#1f77b4"}
DIRECTION_COLORS = {"H": "#e34a33", "V": "#3182bd"}  # used over the chart image


def _stretch(img: np.ndarray, lo: float = 1.0, hi: float = 99.5) -> np.ndarray:
    a = img.astype(np.float32)
    vmin, vmax = np.percentile(a, [lo, hi])
    if vmax <= vmin:
        vmax = vmin + 1
    return np.clip((a - vmin) / (vmax - vmin), 0, 1)


# ---------------------------------------------------------------------------
# Plotting


def _draw_chart_panel(ax, r: ChannelResult, *, margin_frac: float = 0.06) -> None:
    """Cropped chart with H+V slice annotations, bbox outline, channel title."""
    y0, x0, y1, x1 = r.chart_bbox
    h_box, w_box = y1 - y0, x1 - x0
    pad_y = int(margin_frac * h_box)
    pad_x = int(margin_frac * w_box)
    cy0 = max(0, y0 - pad_y)
    cy1 = min(r.image.shape[0], y1 + pad_y)
    cx0 = max(0, x0 - pad_x)
    cx1 = min(r.image.shape[1], x1 + pad_x)
    crop = r.image[cy0:cy1, cx0:cx1]
    ax.imshow(_stretch(crop), cmap="gray", interpolation="nearest")
    # bbox in cropped coords
    ax.add_patch(
        Rectangle(
            (x0 - cx0, y0 - cy0),
            w_box,
            h_box,
            fill=False,
            edgecolor="white",
            linestyle="--",
            linewidth=0.8,
            alpha=0.55,
        )
    )
    crop_h, crop_w = crop.shape[:2]
    # H slice: draw line, put compact label at the right edge
    y_h = r.horizontal.line_index - cy0
    ax.axhline(y_h, color=DIRECTION_COLORS["H"], linewidth=1.4, alpha=0.95)
    ax.annotate(
        "H",
        xy=(crop_w - 4, y_h),
        xycoords="data",
        color="white",
        fontsize=9,
        fontweight="bold",
        ha="right",
        va="center",
        bbox=dict(
            facecolor=DIRECTION_COLORS["H"], alpha=0.95, edgecolor="none", boxstyle="round,pad=0.18"
        ),
    )
    # V slice: line + compact label at the bottom edge
    x_v = r.vertical.line_index - cx0
    ax.axvline(x_v, color=DIRECTION_COLORS["V"], linewidth=1.4, alpha=0.95)
    ax.annotate(
        "V",
        xy=(x_v, crop_h - 4),
        xycoords="data",
        color="white",
        fontsize=9,
        fontweight="bold",
        ha="center",
        va="bottom",
        bbox=dict(
            facecolor=DIRECTION_COLORS["V"], alpha=0.95, edgecolor="none", boxstyle="round,pad=0.18"
        ),
    )
    sat_pct = 100.0 * r.saturation_fraction
    title = f"{r.gain} — channel {r.channel}"
    if sat_pct > 0.5:
        title += f"   (clipping: {sat_pct:.1f}%)"
    ax.set_title(title, color=CHANNEL_COLORS[r.channel])
    ax.set_xticks([])
    ax.set_yticks([])


def _plot_direction_curve(
    ax,
    dr: DirectionResult,
    color: str,
    linestyle: str,
    label_prefix: str,
    show_cutoff_text: bool = True,
    text_y_anchor: float = 0.97,
) -> None:
    f = dr.freqs
    m = f > 0
    ax.semilogy(
        f[m],
        dr.spectrum_smoothed[m],
        color=color,
        linewidth=1.6,
        linestyle=linestyle,
        label=f"{label_prefix} ({dr.direction})",
    )
    cutoff_styles = [("MTF50", 1.0), ("MTF10", 0.6)]
    cutoff_lines = []
    for key, alpha in cutoff_styles:
        fc = dr.cutoffs.get(key)
        if fc is None:
            continue
        ax.axvline(fc, color=color, linestyle=linestyle, linewidth=0.9, alpha=alpha)
        cutoff_lines.append((key, fc))
    if show_cutoff_text and cutoff_lines:
        text = "\n".join([f"{dr.direction}-{k}: {v:.3f}" for k, v in cutoff_lines])
        ax.text(
            0.98,
            text_y_anchor,
            text,
            transform=ax.transAxes,
            ha="right",
            va="top",
            fontsize=8,
            color=color,
            bbox=dict(facecolor="white", alpha=0.85, edgecolor=color, linewidth=0.6, pad=2.5),
        )


def plot_panels(
    gain: str, results: dict[str, ChannelResult], out_path: Path, file_label: str
) -> None:
    fig, axes = plt.subplots(2, 3, figsize=(13.5, 8.0), gridspec_kw={"height_ratios": [1.05, 0.85]})

    for col, ch in enumerate(("R", "G", "B")):
        r = results[ch]
        _draw_chart_panel(axes[0, col], r)

        ax_sp = axes[1, col]
        _plot_direction_curve(
            ax_sp,
            r.horizontal,
            color=CHANNEL_COLORS[ch],
            linestyle="-",
            label_prefix=ch,
            text_y_anchor=0.97,
        )
        _plot_direction_curve(
            ax_sp,
            r.vertical,
            color=CHANNEL_COLORS[ch],
            linestyle="--",
            label_prefix=ch,
            text_y_anchor=0.62,
        )

        for thr, ls in [(0.5, "-"), (0.1, ":")]:
            ax_sp.axhline(thr, color="0.55", linestyle=ls, linewidth=0.6, alpha=0.7)

        ax_sp.set_xlim(0, 0.5)
        ax_sp.set_ylim(1e-3, 1.3)
        ax_sp.set_xlabel("Spatial frequency  (cycles / channel-pixel)")
        if col == 0:
            ax_sp.set_ylabel("Normalized FFT magnitude")
        from matplotlib.lines import Line2D

        leg_handles = [
            Line2D(
                [0], [0], color=CHANNEL_COLORS[ch], linestyle="-", linewidth=1.6, label="H slice"
            ),
            Line2D(
                [0], [0], color=CHANNEL_COLORS[ch], linestyle="--", linewidth=1.6, label="V slice"
            ),
        ]
        ax_sp.legend(handles=leg_handles, loc="lower left", fontsize=8)

    fig.suptitle(f"{file_label} — {gain} gain — RGB lateral resolution", fontsize=12.5, y=1.005)

    fig.text(
        0.5,
        -0.012,
        "Methodology: per-channel image rotated 180°. Horizontal strip (20 rows) and "
        "vertical strip (20 cols) are taken at the row/column with the strongest periodic "
        "content in 0.04–0.40 cy/px (constrained to the central 70% of the chart bbox). "
        "Each strip is averaged to a 1-D profile, detrended (Gaussian σ = 30 px lowpass "
        "subtracted), Hann-windowed, then rFFT magnitude normalized to its peak. "
        "Detection limit = highest spatial frequency at which the smoothed magnitude "
        "stays above {0.5, 0.2, 0.1}·peak and above 1.5·noise-floor (median of the top "
        "10% frequency bins). Dashed white box = detected chart bbox.",
        ha="center",
        va="top",
        fontsize=8.5,
        color="0.25",
        wrap=True,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def plot_overlay(
    gain: str, results: dict[str, ChannelResult], out_path: Path, file_label: str
) -> None:
    fig, axes = plt.subplots(1, 2, figsize=(12.5, 4.5), sharey=True)
    for ax, direction, title in zip(
        axes,
        ("H", "V"),
        ("H slice (probes vertical bars)", "V slice (probes horizontal bars)"),
        strict=False,
    ):
        for ch in ("R", "G", "B"):
            r = results[ch]
            dr = r.horizontal if direction == "H" else r.vertical
            f = dr.freqs
            m = f > 0
            ax.semilogy(
                f[m], dr.spectrum_smoothed[m], color=CHANNEL_COLORS[ch], linewidth=1.6, label=ch
            )
            for key, ls, alpha in [("MTF50", "-", 0.45), ("MTF10", ":", 0.35)]:
                fc = dr.cutoffs.get(key)
                if fc is None:
                    continue
                ax.axvline(fc, color=CHANNEL_COLORS[ch], linestyle=ls, linewidth=0.8, alpha=alpha)
        for thr, ls in [(0.5, "-"), (0.1, ":")]:
            ax.axhline(thr, color="0.55", linestyle=ls, linewidth=0.6, alpha=0.6)
        ax.set_xlim(0, 0.5)
        ax.set_ylim(1e-3, 1.3)
        ax.set_xlabel("Spatial frequency  (cycles / channel-pixel)")
        ax.set_title(title)
        ax.legend(loc="upper right")
    axes[0].set_ylabel("Normalized FFT magnitude")
    fig.suptitle(f"{file_label} — {gain} gain — channel comparison", fontsize=12.0, y=1.02)
    fig.tight_layout()
    fig.savefig(out_path, dpi=220, bbox_inches="tight")
    plt.close(fig)


def plot_hg_vs_lg(
    all_results: dict[str, dict[str, ChannelResult]], out_path: Path, file_label: str
) -> None:
    fig, axes = plt.subplots(2, 3, figsize=(12.5, 6.5), sharey="row", gridspec_kw={"hspace": 0.45})
    metrics = [
        ("MTF50", "MTF50  (50% peak)"),
        ("MTF20", "MTF20  (20% peak)"),
        ("MTF10", "MTF10  (10% peak ≈ Rayleigh)"),
    ]
    channels = ("R", "G", "B")
    width = 0.35
    x = np.arange(len(channels))
    for row_i, (direction, dlabel) in enumerate((("H", "H slice"), ("V", "V slice"))):
        for col, (key, title) in enumerate(metrics):
            ax = axes[row_i, col]
            for i, gain in enumerate(("HG", "LG")):
                vals = []
                for ch in channels:
                    dr = (
                        all_results[gain][ch].horizontal
                        if direction == "H"
                        else all_results[gain][ch].vertical
                    )
                    vals.append(dr.cutoffs.get(key) or 0.0)
                offset = (i - 0.5) * width
                bars = ax.bar(
                    x + offset,
                    vals,
                    width=width,
                    label=gain,
                    color=[CHANNEL_COLORS[c] for c in channels],
                    alpha=0.45 if gain == "HG" else 0.95,
                    edgecolor="0.15",
                    linewidth=0.6,
                )
                for b, v in zip(bars, vals, strict=False):
                    ax.text(
                        b.get_x() + b.get_width() / 2,
                        v + 0.005,
                        f"{v:.3f}" if v else "—",
                        ha="center",
                        va="bottom",
                        fontsize=7,
                    )
            ax.set_xticks(x)
            ax.set_xticklabels(channels)
            if row_i == 0:
                ax.set_title(title)
            if col == 0:
                ax.set_ylabel(f"{dlabel}\n(cy / channel-pixel)")
            ax.set_ylim(0, 0.55)
            ax.axhline(0.5, color="0.6", linestyle=":", linewidth=0.6)
    legend_elements = [
        Patch(facecolor="0.7", edgecolor="0.15", alpha=0.55, label="HG"),
        Patch(facecolor="0.4", edgecolor="0.15", alpha=0.95, label="LG"),
    ]
    axes[0, -1].legend(handles=legend_elements, loc="upper right")
    fig.suptitle(f"{file_label} — HG vs LG detection-limit comparison", fontsize=12.0, y=1.005)
    fig.tight_layout()
    fig.savefig(out_path, dpi=220, bbox_inches="tight")
    plt.close(fig)


# ---------------------------------------------------------------------------


def main(h5_path: str, out_dir: Path) -> None:
    _set_journal_style()
    rec = load_recording(h5_path)
    file_label = rec.path.name + f"  (frame 0 / {rec.n_frames})"
    print(f"Recording: {rec.path}")
    print(
        f"  {rec.attrs.get('nickname', '?')}  "
        f"{rec.attrs.get('model-name', '?')}  "
        f"sn={rec.attrs.get('sn-camera', '?')}"
    )
    print(f"  shape {rec.shape}  n_frames {rec.n_frames}")

    f0 = rec.frames[0]
    hg_half, lg_half = split_dual_gain(f0)

    all_results: dict[str, dict[str, ChannelResult]] = {}
    for gain, half in (("HG", hg_half), ("LG", lg_half)):
        ch_raw = extract_rgb_nir(half)
        ch_rot = {k: rotate_180(v) for k, v in ch_raw.items()}
        results: dict[str, ChannelResult] = {}
        for k in ("R", "G", "B"):
            results[k] = analyze_channel(ch_rot[k], gain=gain, channel=k)
        all_results[gain] = results

        plot_panels(gain, results, out_dir / f"fig_{gain}_panels.png", file_label)
        plot_overlay(gain, results, out_dir / f"fig_{gain}_overlay.png", file_label)
        print(f"  wrote fig_{gain}_panels.png + fig_{gain}_overlay.png")

    plot_hg_vs_lg(all_results, out_dir / "fig_HG_vs_LG_summary.png", file_label)
    print("  wrote fig_HG_vs_LG_summary.png")

    print("\nDetection-limit frequencies (cycles / channel-pixel):")
    print(
        f"  {'gain':<4} {'ch':<2} {'dir':<3}  "
        f"{'MTF50':>8}  {'MTF20':>8}  {'MTF10':>8}  "
        f"{'noise':>10}  {'sat%':>6}"
    )
    for gain in ("HG", "LG"):
        for ch in ("R", "G", "B"):
            r = all_results[gain][ch]
            for direction, dr in (("H", r.horizontal), ("V", r.vertical)):
                f50 = dr.cutoffs.get("MTF50")
                f20 = dr.cutoffs.get("MTF20")
                f10 = dr.cutoffs.get("MTF10")
                print(
                    f"  {gain:<4} {ch:<2} {direction:<3}  "
                    f"{('—' if f50 is None else f'{f50:.3f}'):>8}  "
                    f"{('—' if f20 is None else f'{f20:.3f}'):>8}  "
                    f"{('—' if f10 is None else f'{f10:.3f}'):>8}  "
                    f"{dr.noise_floor:>10.2e}  "
                    f"{100 * r.saturation_fraction:>6.2f}"
                )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    p = sys.argv[1]
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "outputs"
    out.mkdir(parents=True, exist_ok=True)
    main(p, out)
