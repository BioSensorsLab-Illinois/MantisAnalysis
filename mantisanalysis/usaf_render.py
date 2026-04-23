"""Journal-quality USAF resolution figures.

``build_analysis_figures`` is the public entry point — it produces one
matplotlib ``Figure`` per gain (HG / LG) and is what the FastAPI server
+ CLI smoke use for offline PNG rendering. The previous
``open_analysis_window`` Qt viewer was deleted in B-0016.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from .plotting import CHANNEL_COLORS
from .usaf_groups import (
    LineMeasurement,
    LineSpec,
    detection_limit_lp_mm,
    measure_line,
)


# ---- Plot style ---------------------------------------------------------

DIR_MARKERS = {"H": "o", "V": "s"}
DIR_NAMES = {"H": "horizontal slice (probes vertical bars)",
             "V": "vertical slice (probes horizontal bars)"}

JOURNAL_RC = {
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
    "savefig.dpi": 220,
    "savefig.bbox": "tight",
}


def _apply_transform(img: np.ndarray, *, rotation: int,
                     flip_h: bool, flip_v: bool) -> np.ndarray:
    out = img
    if rotation:
        out = np.rot90(out, k=(rotation // 90) % 4)
    if flip_h:
        out = np.fliplr(out)
    if flip_v:
        out = np.flipud(out)
    return np.ascontiguousarray(out)


def _stretch(img: np.ndarray, lo: float = 1.0, hi: float = 99.5
             ) -> Tuple[float, float]:
    a = img.astype(np.float32)
    vmin, vmax = np.percentile(a, [lo, hi])
    if vmax <= vmin:
        vmax = vmin + 1
    return float(vmin), float(vmax)


def _bbox_from_lines(lines: Sequence[LineSpec], shape: Tuple[int, int],
                     pad: int = 24) -> Tuple[int, int, int, int]:
    """Bounding box around the picked lines (with padding), clamped to image."""
    if not lines:
        return (0, 0, shape[0], shape[1])
    xs: List[float] = []
    ys: List[float] = []
    for ln in lines:
        xs.extend([ln.p0[0], ln.p1[0]])
        ys.extend([ln.p0[1], ln.p1[1]])
    x0 = max(0, int(min(xs)) - pad)
    x1 = min(shape[1], int(max(xs)) + pad)
    y0 = max(0, int(min(ys)) - pad)
    y1 = min(shape[0], int(max(ys)) + pad)
    return (y0, x0, y1, x1)


# ---- Channel selection by mode -----------------------------------------

SINGLE_CHANNEL_MODES = {
    "r_only": "R", "g_only": "G", "b_only": "B", "n_only": "NIR",
}


def _resolve_target_channels(channel_keys: Iterable[str], mode: str
                             ) -> List[str]:
    """Pick which channels to analyze based on the mode and available keys.

    Modes:
        rgb        - R, G, B for every gain present
        rgbnir     - R, G, B, NIR for every gain present
        luminance  - Y per gain (or Y / L for image inputs)
        r_only / g_only / b_only / n_only - just that one channel per gain

    Returns a flat list of channel keys (e.g., ['HG-R', 'LG-R'] for
    'r_only' against an H5 input, or ['R'] for an image input).
    """
    keys = list(channel_keys)
    has_gain = any("-" in k for k in keys)

    # Single-channel modes
    if mode in SINGLE_CHANNEL_MODES:
        target = SINGLE_CHANNEL_MODES[mode]
        if has_gain:
            return [k for k in (f"HG-{target}", f"LG-{target}") if k in keys]
        return [target] if target in keys else []

    if has_gain:
        gains = ["HG", "LG"]
        if mode == "luminance":
            return [f"{g}-Y" for g in gains if f"{g}-Y" in keys]
        if mode == "rgbnir":
            chosen = []
            for g in gains:
                for c in ("R", "G", "B", "NIR"):
                    if f"{g}-{c}" in keys:
                        chosen.append(f"{g}-{c}")
            return chosen
        # default: rgb
        chosen = []
        for g in gains:
            for c in ("R", "G", "B"):
                if f"{g}-{c}" in keys:
                    chosen.append(f"{g}-{c}")
        return chosen
    # No gain split (single image input)
    if mode == "luminance":
        return [k for k in ("Y", "L") if k in keys]
    if mode == "rgbnir":
        return [k for k in ("R", "G", "B", "NIR", "Y", "L") if k in keys]
    return [k for k in ("R", "G", "B", "Y", "L") if k in keys]


def _channel_color(name: str) -> str:
    base = name.split("-")[-1]
    return CHANNEL_COLORS.get(base, "#444444")


def _gain_of(name: str) -> str:
    return name.split("-")[0] if "-" in name else ""


# ---- Per-channel analysis result ---------------------------------------

@dataclass
class ChannelAnalysis:
    name: str
    transformed_image: np.ndarray
    measurements: List[LineMeasurement]
    detection_limit: Dict[float, Optional[float]]   # threshold -> lp/mm

    @property
    def short_name(self) -> str:
        return self.name


def analyze_channel_lines(name: str, image: np.ndarray,
                          lines: Sequence[LineSpec],
                          *, transform: Dict,
                          thresholds: Sequence[float] = (0.5, 0.2, 0.1),
                          sharpen: Dict | None = None,
                          ) -> ChannelAnalysis:
    img_t = _apply_transform(
        image,
        rotation=int(transform.get("rotation", 0)),
        flip_h=bool(transform.get("flip_h", False)),
        flip_v=bool(transform.get("flip_v", False)),
    )
    if sharpen is not None and sharpen.get("method") not in (None, "", "None"):
        from .image_processing import apply_sharpen
        img_t = apply_sharpen(img_t, sharpen["method"],
                              amount=float(sharpen.get("amount", 1.0)),
                              radius=float(sharpen.get("radius", 2.0)))
    measurements = [measure_line(img_t, ln) for ln in lines]
    dlim: Dict[float, Optional[float]] = {}
    for thr in thresholds:
        f, _ = detection_limit_lp_mm(measurements, thr)
        dlim[thr] = f
    return ChannelAnalysis(name=name, transformed_image=img_t,
                           measurements=measurements, detection_limit=dlim)


# ---- Plotting ----------------------------------------------------------

def _draw_chart_panel(ax, an: ChannelAnalysis,
                      *, lines: Sequence[LineSpec]) -> None:
    img = an.transformed_image
    bbox = _bbox_from_lines(lines, img.shape)
    y0, x0, y1, x1 = bbox
    crop = img[y0:y1, x0:x1]
    vmin, vmax = _stretch(crop)
    ax.imshow(crop, cmap="gray", vmin=vmin, vmax=vmax,
              interpolation="nearest")
    ax.set_xticks([]); ax.set_yticks([])
    # Draw the lines (in cropped coords)
    for ln, m in zip(lines, an.measurements):
        color = _channel_color(an.name)
        x_p0 = ln.p0[0] - x0; y_p0 = ln.p0[1] - y0
        x_p1 = ln.p1[0] - x0; y_p1 = ln.p1[1] - y0
        ax.plot([x_p0, x_p1], [y_p0, y_p1], color=color, linewidth=1.4,
                alpha=0.95)
        ax.plot(x_p0, y_p0, marker="o", color=color, markersize=2.5)
        ax.plot(x_p1, y_p1, marker="o", color=color, markersize=2.5)
    ax.set_title(f"{an.name}", color=_channel_color(an.name), fontsize=11)


def _draw_mtf_panel(ax, an: ChannelAnalysis, *,
                    threshold: float = 0.2,
                    show_thresholds: Sequence[float] = (0.5, 0.2, 0.1),
                    show_legend: bool = True) -> None:
    color = _channel_color(an.name)
    # Group measurements by direction
    by_dir: Dict[str, List[LineMeasurement]] = {"H": [], "V": []}
    for m in an.measurements:
        by_dir.setdefault(m.spec.direction, []).append(m)
    for dr, ms in by_dir.items():
        if not ms:
            continue
        ms_sorted = sorted(ms, key=lambda m: m.lp_mm)
        x = [m.lp_mm for m in ms_sorted]
        y = [m.modulation for m in ms_sorted]
        ax.plot(x, y, color=color, linewidth=1.0, alpha=0.55,
                linestyle="-" if dr == "H" else "--")
        ax.scatter(x, y, color=color, marker=DIR_MARKERS.get(dr, "o"),
                   s=42, edgecolor="white", linewidth=0.8, zorder=4,
                   label=f"{dr} slice")

    # Threshold gridlines
    for thr in show_thresholds:
        ax.axhline(thr, color="0.7", linestyle=":", linewidth=0.6)

    # Detection limit annotation (using `threshold`)
    f_lim = an.detection_limit.get(threshold)
    annot = f"{int(threshold * 100)}% limit:  "
    if f_lim is not None:
        annot += f"{f_lim:.2f} lp/mm"
        ax.axvline(f_lim, color=color, linestyle="-", linewidth=0.9,
                   alpha=0.6)
    else:
        annot += "—"

    # X-limits adapt to the picked elements so groups 0-5 all fit.
    lp_values = [m.lp_mm for m in an.measurements if m.lp_mm > 0]
    if lp_values:
        x_lo = min(0.85, min(lp_values) / 1.5)
        x_hi = max(18.0, max(lp_values) * 1.5)
    else:
        x_lo, x_hi = 0.85, 18.0
    ax.set_xlim(x_lo, x_hi)
    ax.set_xscale("log")
    ax.set_ylim(0, 1.1)
    ax.set_xlabel("Spatial frequency  (lp / mm @ chart)")
    ax.set_ylabel("Michelson contrast")
    ax.set_title(annot, fontsize=10, color=color)
    if show_legend:
        ax.legend(loc="upper right", fontsize=8)


def build_analysis_figures(channel_images: Dict[str, np.ndarray],
                           lines: Sequence[LineSpec],
                           *, mode: str = "rgb",
                           transform: Dict | None = None,
                           threshold: float = 0.2,
                           sharpen: Dict | None = None,
                           ) -> List[Figure]:
    """One figure per gain (HG / LG), or a single figure for image inputs.

    Each figure is a 2-row grid: row 1 = chart panels with picked lines,
    row 2 = modulation-vs-lp/mm with detection limit at `threshold`.
    """
    if transform is None:
        transform = {"rotation": 0, "flip_h": False, "flip_v": False}
    plt.rcParams.update(JOURNAL_RC)

    targets = _resolve_target_channels(channel_images.keys(), mode)
    if not targets:
        raise ValueError(f"no channels matched mode {mode!r} in "
                         f"available keys {list(channel_images)}")

    # Group target channels by gain prefix (or "" for image inputs)
    groups: Dict[str, List[str]] = {}
    for name in targets:
        g = _gain_of(name)
        groups.setdefault(g, []).append(name)

    figures: List[Figure] = []
    for gain, names in groups.items():
        analyses = [
            analyze_channel_lines(name, channel_images[name], lines,
                                  transform=transform, sharpen=sharpen)
            for name in names
        ]
        n = len(analyses)
        fig = Figure(figsize=(4.0 * n, 7.5), facecolor="white")
        gs = fig.add_gridspec(2, n, height_ratios=[1.05, 0.95],
                              hspace=0.35, wspace=0.30)
        for i, an in enumerate(analyses):
            ax_top = fig.add_subplot(gs[0, i])
            _draw_chart_panel(ax_top, an, lines=lines)
            ax_bot = fig.add_subplot(gs[1, i])
            _draw_mtf_panel(ax_bot, an, threshold=threshold,
                            show_legend=(i == n - 1))
        title = f"USAF resolution — {gain or 'channels'}  "
        title += f"(detection limit at {int(threshold * 100)}% Michelson)"
        fig.suptitle(title, fontsize=12.5, y=0.995)
        fig.text(0.5, -0.005,
                 "Lines: user-picked profiles through the 3 bars of each "
                 "USAF element. lp/mm at chart from 2^(group + (element-1)/6). "
                 "Solid line + circles = horizontal slice (probes vertical bars); "
                 "dashed + squares = vertical slice (probes horizontal bars). "
                 "Detection limit = first lp/mm at which Michelson dips "
                 "below the threshold (scanning coarse → fine).",
                 ha="center", va="top", fontsize=8.5, color="0.30", wrap=True)
        figures.append(fig)
    return figures

