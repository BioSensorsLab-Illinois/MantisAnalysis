"""Journal-quality USAF resolution figures and an embedded Tk viewer.

The picker GUI calls `open_analysis_window` to display the figure(s) for
the currently picked lines. The same code can be invoked headlessly via
`build_analysis_figures` to write PNGs from CLI tools.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle

from .image_io import luminance_from_rgb
from .usaf_groups import (
    LineMeasurement,
    LineSpec,
    USAF_LP_MM,
    detection_limit_lp_mm,
    extract_line_profile,
    lp_mm,
    measure_line,
)


# ---- Plot style ---------------------------------------------------------

CHANNEL_COLORS = {
    "R":   "#d62728",
    "G":   "#2ca02c",
    "B":   "#1f77b4",
    "NIR": "#7f7f7f",
    "Y":   "#000000",
    "L":   "#000000",
}
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


# ---- Qt viewer ----------------------------------------------------------

def _get_transform_from_app(app_state) -> Dict:
    """Read view-transform values from a picker app, tolerating both the
    PySide6 layout (plain attrs) and the legacy Tk layout (tk.Var)."""
    def _get(attr_var, attr_plain, default):
        v = getattr(app_state, attr_var, None)
        if v is not None:
            try:
                return v.get()
            except Exception:
                pass
        return getattr(app_state, attr_plain, default)
    return {
        "rotation": int(_get("rotation_var", "rotation", 0)),
        "flip_h": bool(_get("flip_h_var", "flip_h", False)),
        "flip_v": bool(_get("flip_v_var", "flip_v", False)),
    }


def _get_sharpen_from_app(app_state) -> Optional[Dict]:
    """Return a sharpen-params dict if the picker has 'apply to analysis'
    on, else None. The dict has ``method``, ``amount``, ``radius`` keys."""
    if not bool(getattr(app_state, "sharpen_to_analysis", False)):
        return None
    method = str(getattr(app_state, "sharpen_method", "None") or "None")
    if method in ("", "None"):
        return None
    return {
        "method": method,
        "amount": float(getattr(app_state, "sharpen_amount", 1.0)),
        "radius": float(getattr(app_state, "sharpen_radius", 2.0)),
    }


# ==========================================================================
# Whole-dataset measurement model
# ==========================================================================

@dataclass
class Measurement:
    """One (gain, channel, group, element, direction) datapoint.

    Three Michelson values are always carried:
        modulation_pct  - P10/P90 percentile (robust to single outliers)
        modulation_mm   - min/max (peak-to-peak)
        modulation_fft  - amplitude at the *expected* bar fundamental,
                          via FFT — robust to aliasing of bars below
                          the per-pixel Nyquist
    `samples_per_cycle` is a quality indicator: bar pattern resolved
    only when there are >= ~3-5 samples per cycle.
    `modulation` is the *primary* value chosen by the user
    (`measurement_method`: "pct" | "minmax" | "fft").
    """
    gain: str
    channel: str
    group: int
    element: int
    direction: str
    lp_mm: float
    modulation: float
    modulation_pct: float
    modulation_mm: float
    modulation_fft: float
    samples_per_cycle: float
    line_length_px: float
    n_samples: int
    profile: np.ndarray
    p0: Tuple[float, float]
    p1: Tuple[float, float]

    @property
    def reliability(self) -> str:
        spc = self.samples_per_cycle
        if spc < 3.0:
            return "unreliable"
        if spc < 5.0:
            return "marginal"
        return "ok"

    @property
    def label(self) -> str:
        base = f"G{self.group}E{self.element}{self.direction}"
        return f"{self.gain}-{self.channel}  {base}" if self.gain else f"{self.channel}  {base}"


def compute_all_measurements(channel_images: Dict[str, np.ndarray],
                             lines: Sequence[LineSpec],
                             *, mode: str = "rgbnir",
                             transform: Dict | None = None,
                             sharpen: Dict | None = None,
                             measurement_method: str = "pct",
                             ) -> List[Measurement]:
    """Run every picked line against every target channel and collect
    results. `mode` picks the channel set (``rgb``/``rgbnir``/``luminance``/
    ``r_only``/``g_only``/``b_only``/``n_only``).

    When ``sharpen`` is a dict like
    ``{"method": "Unsharp mask", "amount": 1.0, "radius": 2.0}`` the
    measurement image is sharpened with those parameters before the
    Michelson contrast is computed. When None, raw (transform-only).
    """
    from .image_processing import apply_sharpen
    from .usaf_groups import measure_line as _ml
    if transform is None:
        transform = {"rotation": 0, "flip_h": False, "flip_v": False}
    target_keys = _resolve_target_channels(channel_images.keys(), mode)
    out: List[Measurement] = []
    sharpen_method = (sharpen or {}).get("method") if sharpen else None
    sharpen_active = sharpen_method not in (None, "", "None")
    for key in target_keys:
        img = _apply_transform(
            channel_images[key],
            rotation=int(transform.get("rotation", 0)),
            flip_h=bool(transform.get("flip_h", False)),
            flip_v=bool(transform.get("flip_v", False)),
        )
        if sharpen_active:
            img = apply_sharpen(img, sharpen_method,
                                amount=float(sharpen.get("amount", 1.0)),
                                radius=float(sharpen.get("radius", 2.0)))
        gain = _gain_of(key)
        channel = key.split("-")[-1] if "-" in key else key
        for ln in lines:
            lm = _ml(img, ln, method=measurement_method)
            out.append(Measurement(
                gain=gain, channel=channel,
                group=ln.group, element=ln.element,
                direction=ln.direction,
                lp_mm=lm.lp_mm,
                modulation=lm.modulation,         # primary (per `method`)
                modulation_pct=lm.modulation_pct,
                modulation_mm=lm.modulation_minmax,
                modulation_fft=lm.modulation_fft,
                samples_per_cycle=lm.samples_per_cycle,
                line_length_px=lm.line_length_px,
                n_samples=lm.n_samples,
                profile=np.asarray(lm.profile, dtype=np.float64),
                p0=ln.p0, p1=ln.p1,
            ))
    return out


# ==========================================================================
# Shared Qt helpers
# ==========================================================================

def _mpl_theme_for(fig_face: str, text: str) -> Dict:
    return {
        "axes.facecolor": fig_face,
        "figure.facecolor": fig_face,
        "axes.edgecolor": text,
        "axes.labelcolor": text,
        "xtick.color": text,
        "ytick.color": text,
        "text.color": text,
    }


def _palette_from_parent(parent) -> Tuple[str, str, str]:
    """Return (figure_face, text, accent) from a parent widget's theme."""
    try:
        from PySide6 import QtWidgets
        pal = parent.palette() if parent is not None else QtWidgets.QApplication.instance().palette()
        from PySide6 import QtGui
        fig_face = pal.color(QtGui.QPalette.Window).name()
        text = pal.color(QtGui.QPalette.WindowText).name()
        accent = pal.color(QtGui.QPalette.Highlight).name()
        # Figure face that contrasts in either theme
        if pal.color(QtGui.QPalette.WindowText).lightness() < 128:
            # light palette → white figure
            fig_face = "#ffffff"
        return fig_face, text, accent
    except Exception:
        return "#ffffff", "#1f2328", "#0969da"


def _is_dark_theme(parent) -> bool:
    try:
        from PySide6 import QtGui, QtWidgets
        pal = parent.palette() if parent is not None else QtWidgets.QApplication.instance().palette()
        return pal.color(QtGui.QPalette.Window).lightness() < 128
    except Exception:
        return False


def _make_canvas_page(parent, fig: Figure):
    """Build (page, canvas) where page has canvas + nav toolbar."""
    from PySide6 import QtWidgets
    from matplotlib.backends.backend_qtagg import (
        FigureCanvasQTAgg, NavigationToolbar2QT,
    )
    page = QtWidgets.QWidget(parent)
    pl = QtWidgets.QVBoxLayout(page)
    pl.setContentsMargins(0, 0, 0, 0); pl.setSpacing(0)
    cnv = FigureCanvasQTAgg(fig)
    tb = NavigationToolbar2QT(cnv, page)
    pl.addWidget(cnv, stretch=1)
    pl.addWidget(tb)
    return page, cnv


# ==========================================================================
# Tab 1 — MTF curves (chart + modulation vs lp/mm)
# ==========================================================================

def _build_mtf_tab(parent, app_state, measurements, mode, threshold,
                   fig_face, text, accent):
    from PySide6 import QtWidgets
    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    # Sub-tabs: one per gain (HG/LG for H5, single for image input)
    sub_tabs = QtWidgets.QTabWidget()
    layout.addWidget(sub_tabs, stretch=1)

    figures = build_analysis_figures(
        app_state.channel_images, app_state.lines, mode=mode,
        transform=_get_transform_from_app(app_state),
        threshold=threshold,
        sharpen=_get_sharpen_from_app(app_state),
    )
    for i, fig in enumerate(figures):
        # Re-skin to match theme
        fig.set_facecolor(fig_face)
        for ax in fig.axes:
            ax.set_facecolor(fig_face)
            ax.tick_params(colors=text)
            for sp in ax.spines.values():
                sp.set_color(text)
            ax.xaxis.label.set_color(text)
            ax.yaxis.label.set_color(text)
            ax.title.set_color(text)
        fig.canvas.draw_idle() if hasattr(fig, "canvas") else None
        page, _ = _make_canvas_page(tab, fig)
        label = ("HG" if i == 0 and len(figures) > 1 else
                 "LG" if i == 1 and len(figures) > 1 else
                 f"Figure {i + 1}")
        sub_tabs.addTab(page, label)

    btn_row = QtWidgets.QHBoxLayout()
    btn_row.addStretch(1)
    btn_png = QtWidgets.QPushButton("Export PNGs…")
    btn_row.addWidget(btn_png)
    layout.addLayout(btn_row)

    def do_export():
        out = QtWidgets.QFileDialog.getExistingDirectory(
            parent, "Export figures to…")
        if not out:
            return
        out_p = Path(out); out_p.mkdir(parents=True, exist_ok=True)
        stem = _source_stem(app_state)
        for i, fig in enumerate(figures):
            fig.savefig(out_p / f"{stem}_mtf_{mode}_{i + 1}.png",
                        dpi=220, bbox_inches="tight")
        QtWidgets.QMessageBox.information(parent, "Export",
                                          f"Saved {len(figures)} PNG(s).")
    btn_png.clicked.connect(do_export)
    return tab


# ==========================================================================
# Tab 2 — Profile gallery (filtered grid + export profiles CSV)
# ==========================================================================

def _build_gallery_tab(parent, app_state, measurements, threshold,
                       fig_face, text, accent):
    from PySide6 import QtCore, QtWidgets

    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    # Filter row
    filter_row = QtWidgets.QHBoxLayout()
    gains = sorted({m.gain for m in measurements if m.gain}) or ["—"]
    channels = list(dict.fromkeys([m.channel for m in measurements]))
    dirs = sorted({m.direction for m in measurements})

    gain_cb = QtWidgets.QComboBox(); gain_cb.addItems(["All"] + gains)
    ch_cb = QtWidgets.QComboBox(); ch_cb.addItems(["All"] + channels)
    dir_cb = QtWidgets.QComboBox(); dir_cb.addItems(["All"] + dirs)

    filter_row.addWidget(QtWidgets.QLabel("Gain"))
    filter_row.addWidget(gain_cb)
    filter_row.addSpacing(12)
    filter_row.addWidget(QtWidgets.QLabel("Channel"))
    filter_row.addWidget(ch_cb)
    filter_row.addSpacing(12)
    filter_row.addWidget(QtWidgets.QLabel("Direction"))
    filter_row.addWidget(dir_cb)
    filter_row.addStretch(1)
    btn_csv = QtWidgets.QPushButton("Export filtered profiles to CSV…")
    btn_png = QtWidgets.QPushButton("Export figure PNG…")
    filter_row.addWidget(btn_csv); filter_row.addWidget(btn_png)
    layout.addLayout(filter_row)

    fig = Figure(facecolor=fig_face)
    page, cnv = _make_canvas_page(tab, fig)
    layout.addWidget(page, stretch=1)

    summary_lbl = QtWidgets.QLabel("")
    summary_lbl.setStyleSheet(f"color: {text};")
    layout.addWidget(summary_lbl)

    def current_filter() -> List[Measurement]:
        g = gain_cb.currentText(); c = ch_cb.currentText()
        d = dir_cb.currentText()
        sel = []
        for m in measurements:
            if g != "All" and m.gain != g:
                continue
            if c != "All" and m.channel != c:
                continue
            if d != "All" and m.direction != d:
                continue
            sel.append(m)
        return sel

    def redraw():
        sel = current_filter()
        fig.clear()
        fig.set_facecolor(fig_face)
        if not sel:
            ax = fig.add_subplot(111)
            ax.text(0.5, 0.5, "No profiles match the filter.",
                    ha="center", va="center", color=text, fontsize=12)
            ax.set_xticks([]); ax.set_yticks([])
            for sp in ax.spines.values():
                sp.set_visible(False)
            summary_lbl.setText("")
            cnv.draw_idle()
            return
        # Sort by group then element
        sel.sort(key=lambda m: (m.group, m.element, m.direction,
                                m.gain, m.channel))
        n = len(sel)
        cols = min(6, n)
        rows = int(np.ceil(n / cols))
        fig.set_size_inches(2.5 * cols, 1.8 * rows, forward=False)
        for i, m in enumerate(sel):
            ax = fig.add_subplot(rows, cols, i + 1)
            ax.set_facecolor(fig_face)
            col = CHANNEL_COLORS.get(m.channel, accent)
            ax.plot(m.profile, color=col, linewidth=1.3)
            ax.set_xticks([]); ax.set_yticks([])
            for sp in ("top", "right"):
                ax.spines[sp].set_visible(False)
            for sp in ("bottom", "left"):
                ax.spines[sp].set_color(text)
            # Pass / fail frame
            ok = m.modulation_pct >= threshold
            if ok:
                border = "#2ca02c"
            else:
                border = "#d62728"
            for sp in ("bottom", "left"):
                ax.spines[sp].set_color(border)
                ax.spines[sp].set_linewidth(1.6)
            title = (f"{m.gain}-{m.channel}  G{m.group}E{m.element}{m.direction}"
                     if m.gain else
                     f"{m.channel}  G{m.group}E{m.element}{m.direction}")
            sub = (f"{m.lp_mm:.2f} lp/mm    "
                   f"Mich = {m.modulation_pct:.2f}")
            ax.set_title(title, fontsize=8, color=text)
            ax.set_xlabel(sub, fontsize=7, color=text, labelpad=2)
        fig.suptitle(
            f"Profile gallery   ({n} profiles, threshold = {int(threshold*100)}%)",
            fontsize=12, color=text, y=0.995)
        fig.tight_layout(rect=[0, 0, 1, 0.97])
        summary_lbl.setText(
            f"{n} profiles shown  •  "
            f"{sum(1 for m in sel if m.modulation_pct >= threshold)} at/above "
            f"{int(threshold * 100)}%, "
            f"{sum(1 for m in sel if m.modulation_pct < threshold)} below")
        cnv.draw_idle()

    def do_export_csv():
        sel = current_filter()
        if not sel:
            QtWidgets.QMessageBox.information(parent, "Export",
                                              "No profiles match the filter.")
            return
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save profiles CSV",
            f"{_source_stem(app_state)}_profiles.csv",
            "CSV (*.csv)")
        if not path:
            return
        # Build table: sample index + one column per profile.
        # Profiles have different lengths — pad with empty.
        max_n = max(len(m.profile) for m in sel)
        header_rows = [
            ["label"] + [m.label for m in sel],
            ["gain"] + [m.gain for m in sel],
            ["channel"] + [m.channel for m in sel],
            ["group"] + [str(m.group) for m in sel],
            ["element"] + [str(m.element) for m in sel],
            ["direction"] + [m.direction for m in sel],
            ["lp_mm"] + [f"{m.lp_mm:.4f}" for m in sel],
            ["modulation_pct"] + [f"{m.modulation_pct:.6f}" for m in sel],
            ["modulation_mm"] + [f"{m.modulation_mm:.6f}" for m in sel],
            ["line_length_px"] + [f"{m.line_length_px:.2f}" for m in sel],
        ]
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            for row in header_rows:
                w.writerow(row)
            w.writerow([])
            w.writerow(["sample_index"] + ["intensity" for _ in sel])
            for i in range(max_n):
                row = [i]
                for m in sel:
                    row.append(f"{m.profile[i]:.4f}"
                               if i < len(m.profile) else "")
                w.writerow(row)
        QtWidgets.QMessageBox.information(
            parent, "Export",
            f"Exported {len(sel)} profiles × up to {max_n} samples "
            f"→ {path}")
    btn_csv.clicked.connect(do_export_csv)

    def do_export_png():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save figure PNG",
            f"{_source_stem(app_state)}_gallery.png",
            "PNG (*.png)")
        if path:
            fig.savefig(path, dpi=220, bbox_inches="tight",
                        facecolor=fig_face)
    btn_png.clicked.connect(do_export_png)

    gain_cb.currentIndexChanged.connect(redraw)
    ch_cb.currentIndexChanged.connect(redraw)
    dir_cb.currentIndexChanged.connect(redraw)
    redraw()
    return tab


# ==========================================================================
# Tab 3 — Summary table (QTableWidget + filter + CSV)
# ==========================================================================

def _build_table_tab(parent, app_state, measurements, threshold,
                     fig_face, text, accent):
    from PySide6 import QtCore, QtGui, QtWidgets

    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    gains = sorted({m.gain for m in measurements if m.gain})
    channels = list(dict.fromkeys([m.channel for m in measurements]))
    dirs = sorted({m.direction for m in measurements})
    groups = sorted({m.group for m in measurements})

    filter_row = QtWidgets.QHBoxLayout()
    gain_cb = QtWidgets.QComboBox(); gain_cb.addItems(["All"] + gains)
    ch_cb = QtWidgets.QComboBox(); ch_cb.addItems(["All"] + channels)
    dir_cb = QtWidgets.QComboBox(); dir_cb.addItems(["All"] + dirs)
    grp_cb = QtWidgets.QComboBox(); grp_cb.addItems(["All"] + [str(g) for g in groups])
    filter_row.addWidget(QtWidgets.QLabel("Gain")); filter_row.addWidget(gain_cb)
    filter_row.addWidget(QtWidgets.QLabel("Channel")); filter_row.addWidget(ch_cb)
    filter_row.addWidget(QtWidgets.QLabel("Group")); filter_row.addWidget(grp_cb)
    filter_row.addWidget(QtWidgets.QLabel("Dir")); filter_row.addWidget(dir_cb)
    filter_row.addStretch(1)
    btn_csv = QtWidgets.QPushButton("Export visible rows to CSV…")
    filter_row.addWidget(btn_csv)
    layout.addLayout(filter_row)

    tbl = QtWidgets.QTableWidget()
    columns = ["Gain", "Channel", "Group", "Elt", "Dir", "lp/mm",
               "Mich (P10/P90)", "Mich (min/max)", "Mich (FFT)",
               "s/cyc", "Line L (px)", "Samples",
               f"≥{int(threshold*100)}%"]
    tbl.setColumnCount(len(columns))
    tbl.setHorizontalHeaderLabels(columns)
    tbl.setAlternatingRowColors(True)
    tbl.setSortingEnabled(True)
    tbl.setEditTriggers(QtWidgets.QAbstractItemView.NoEditTriggers)
    tbl.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
    layout.addWidget(tbl, stretch=1)

    def _row_visible(m: Measurement) -> bool:
        if gain_cb.currentText() != "All" and m.gain != gain_cb.currentText():
            return False
        if ch_cb.currentText() != "All" and m.channel != ch_cb.currentText():
            return False
        if dir_cb.currentText() != "All" and m.direction != dir_cb.currentText():
            return False
        if grp_cb.currentText() != "All" and str(m.group) != grp_cb.currentText():
            return False
        return True

    def fill():
        visible = [m for m in measurements if _row_visible(m)]
        tbl.setSortingEnabled(False)
        tbl.setRowCount(len(visible))
        for r, m in enumerate(visible):
            primary = m.modulation
            vals = [m.gain, m.channel, m.group, m.element, m.direction,
                    f"{m.lp_mm:.2f}",
                    f"{m.modulation_pct:.3f}",
                    f"{m.modulation_mm:.3f}",
                    f"{m.modulation_fft:.3f}",
                    f"{m.samples_per_cycle:.1f}",
                    f"{m.line_length_px:.1f}",
                    m.n_samples,
                    "✓" if primary >= threshold else "—"]
            for c, v in enumerate(vals):
                item = QtWidgets.QTableWidgetItem(str(v))
                if c >= 5:
                    item.setTextAlignment(QtCore.Qt.AlignRight
                                          | QtCore.Qt.AlignVCenter)
                # Pass/fail column
                if c == len(vals) - 1:
                    item.setForeground(QtGui.QBrush(
                        QtGui.QColor("#2ca02c" if primary >= threshold
                                     else "#d62728")))
                # s/cyc column color
                if c == 9:
                    if m.samples_per_cycle < 3:
                        item.setForeground(QtGui.QBrush(QtGui.QColor("#cf222e")))
                        item.setToolTip("< 3 samples/cycle: aliasing-driven; "
                                        "use Mich (FFT) for a more honest read.")
                    elif m.samples_per_cycle < 5:
                        item.setForeground(QtGui.QBrush(QtGui.QColor("#bf8700")))
                        item.setToolTip("3–5 samples/cycle: marginal.")
                    else:
                        item.setForeground(QtGui.QBrush(QtGui.QColor("#1a7f37")))
                # Numeric sort for group/elt/samples and numeric cols
                if c in (2, 3, 11):
                    item.setData(QtCore.Qt.DisplayRole, int(v))
                elif c in (5, 6, 7, 8, 9, 10):
                    try:
                        item.setData(QtCore.Qt.DisplayRole, float(v))
                    except Exception:
                        pass
                tbl.setItem(r, c, item)
        tbl.setSortingEnabled(True)
        tbl.resizeColumnsToContents()

    def do_export_csv():
        visible = [m for m in measurements if _row_visible(m)]
        if not visible:
            QtWidgets.QMessageBox.information(
                parent, "Export", "No rows match the filter.")
            return
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save summary CSV",
            f"{_source_stem(app_state)}_summary.csv", "CSV (*.csv)")
        if not path:
            return
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["gain", "channel", "group", "element", "direction",
                        "lp_mm",
                        "modulation_pct_p1090",
                        "modulation_minmax",
                        "modulation_fft_fundamental",
                        "samples_per_cycle",
                        "line_length_px", "n_samples", "above_threshold"])
            for m in visible:
                w.writerow([m.gain, m.channel, m.group, m.element,
                            m.direction, f"{m.lp_mm:.4f}",
                            f"{m.modulation_pct:.6f}",
                            f"{m.modulation_mm:.6f}",
                            f"{m.modulation_fft:.6f}",
                            f"{m.samples_per_cycle:.3f}",
                            f"{m.line_length_px:.2f}", m.n_samples,
                            int(m.modulation >= threshold)])
        QtWidgets.QMessageBox.information(
            parent, "Export", f"Exported {len(visible)} rows → {path}")

    btn_csv.clicked.connect(do_export_csv)
    for cb in (gain_cb, ch_cb, dir_cb, grp_cb):
        cb.currentIndexChanged.connect(fill)
    fill()
    return tab


# ==========================================================================
# Tab 4 — Detection heatmap (Group × Element × Direction, per gain-channel)
# ==========================================================================

def _build_heatmap_tab(parent, app_state, measurements, threshold,
                       fig_face, text, accent):
    from PySide6 import QtWidgets
    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    dirs_row = QtWidgets.QHBoxLayout()
    dir_cb = QtWidgets.QComboBox(); dir_cb.addItems(["Both (H | V)", "H only", "V only"])
    dirs_row.addWidget(QtWidgets.QLabel("Direction view"))
    dirs_row.addWidget(dir_cb)
    dirs_row.addStretch(1)
    btn_png = QtWidgets.QPushButton("Export PNG…")
    dirs_row.addWidget(btn_png)
    layout.addLayout(dirs_row)

    fig = Figure(facecolor=fig_face)
    page, cnv = _make_canvas_page(tab, fig)
    layout.addWidget(page, stretch=1)

    # Group the measurements
    by_key: Dict[Tuple[str, str, str], Dict[Tuple[int, int], float]] = {}
    for m in measurements:
        k = (m.gain, m.channel, m.direction)
        by_key.setdefault(k, {})[(m.group, m.element)] = m.modulation_pct

    def redraw():
        dir_mode = dir_cb.currentText()
        # Decide which (gain, channel) pairs to plot
        gc_pairs = sorted({(g, c) for g, c, _ in by_key.keys()})
        if dir_mode == "H only":
            dir_list = ["H"]
        elif dir_mode == "V only":
            dir_list = ["V"]
        else:
            dir_list = ["H", "V"]
        n_rows = len(gc_pairs)
        n_cols = len(dir_list)
        fig.clear(); fig.set_facecolor(fig_face)
        if n_rows == 0 or n_cols == 0:
            ax = fig.add_subplot(111)
            ax.text(0.5, 0.5, "No data for this direction filter.",
                    ha="center", va="center", color=text, fontsize=12)
            ax.set_xticks([]); ax.set_yticks([])
            cnv.draw_idle(); return
        fig.set_size_inches(3.5 * n_cols + 1.2,
                            2.5 * n_rows + 0.6, forward=False)
        from .usaf_groups import USAF_GROUPS, USAF_ELEMENTS
        groups = list(USAF_GROUPS)
        elements = list(USAF_ELEMENTS)
        import matplotlib.colors as mcolors
        cmap = plt.cm.RdYlGn
        for r, (g, ch) in enumerate(gc_pairs):
            for c, d in enumerate(dir_list):
                ax = fig.add_subplot(n_rows, n_cols, r * n_cols + c + 1)
                ax.set_facecolor(fig_face)
                data = np.full((len(groups), len(elements)), np.nan)
                src = by_key.get((g, ch, d), {})
                for (grp, elt), mod in src.items():
                    if grp in groups and elt in elements:
                        data[groups.index(grp), elements.index(elt)] = mod
                im = ax.imshow(data, cmap=cmap, vmin=0, vmax=1,
                               aspect="auto", origin="upper")
                ax.set_xticks(range(len(elements)))
                ax.set_xticklabels([str(e) for e in elements],
                                   color=text, fontsize=8)
                ax.set_yticks(range(len(groups)))
                ax.set_yticklabels([str(y) for y in groups],
                                   color=text, fontsize=8)
                ax.tick_params(colors=text)
                # Cell text
                for gi in range(len(groups)):
                    for ei in range(len(elements)):
                        v = data[gi, ei]
                        if np.isnan(v):
                            continue
                        tcol = "#ffffff" if (v > 0.55 or v < 0.20) else "#111111"
                        ax.text(ei, gi, f"{v:.2f}", ha="center", va="center",
                                color=tcol, fontsize=7, fontweight="bold")
                title = (f"{g}-{ch}  {d} slice" if g
                         else f"{ch}  {d} slice")
                ax.set_title(title, color=text, fontsize=10)
                if r == n_rows - 1:
                    ax.set_xlabel("Element", color=text, fontsize=9)
                if c == 0:
                    ax.set_ylabel("Group", color=text, fontsize=9)
                for sp in ax.spines.values():
                    sp.set_color(text)
        # Shared colorbar
        cb = fig.colorbar(im, ax=fig.axes, shrink=0.85, pad=0.02)
        cb.ax.yaxis.set_tick_params(color=text)
        plt.setp(cb.ax.yaxis.get_ticklabels(), color=text)
        cb.ax.tick_params(colors=text)
        cb.set_label(f"Michelson contrast  (threshold = {threshold:.2f})",
                     color=text)
        fig.suptitle(
            f"Detection heatmap — {n_rows} channel-stream(s), "
            f"{'H+V' if n_cols == 2 else dir_list[0]} direction",
            color=text, fontsize=12, y=0.995)
        cnv.draw_idle()

    dir_cb.currentIndexChanged.connect(redraw)

    def do_export_png():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save heatmap PNG",
            f"{_source_stem(app_state)}_heatmap.png", "PNG (*.png)")
        if path:
            fig.savefig(path, dpi=220, bbox_inches="tight",
                        facecolor=fig_face)
    btn_png.clicked.connect(do_export_png)

    redraw()
    return tab


# ==========================================================================
# Tab 5 — Group sweep (modulation vs element, faceted per group)
# ==========================================================================

def _build_sweep_tab(parent, app_state, measurements, threshold,
                     fig_face, text, accent):
    from PySide6 import QtWidgets
    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    top_row = QtWidgets.QHBoxLayout()
    dir_cb = QtWidgets.QComboBox(); dir_cb.addItems(["Both (H | V)", "H only", "V only"])
    top_row.addWidget(QtWidgets.QLabel("Direction"))
    top_row.addWidget(dir_cb)
    top_row.addStretch(1)
    btn_png = QtWidgets.QPushButton("Export PNG…")
    btn_csv = QtWidgets.QPushButton("Export sweep CSV…")
    top_row.addWidget(btn_csv); top_row.addWidget(btn_png)
    layout.addLayout(top_row)

    fig = Figure(facecolor=fig_face)
    page, cnv = _make_canvas_page(tab, fig)
    layout.addWidget(page, stretch=1)

    def redraw():
        dir_mode = dir_cb.currentText()
        if dir_mode == "H only":
            dirs = ["H"]
        elif dir_mode == "V only":
            dirs = ["V"]
        else:
            dirs = ["H", "V"]
        gains = sorted({m.gain for m in measurements if m.gain}) or [""]
        groups = sorted({m.group for m in measurements})
        if not groups:
            return
        fig.clear(); fig.set_facecolor(fig_face)
        n_rows = len(gains)
        n_cols = len(groups)
        fig.set_size_inches(3.2 * n_cols + 0.6,
                            2.6 * n_rows + 0.4, forward=False)
        dir_ls = {"H": "-", "V": "--"}
        dir_marker = {"H": "o", "V": "s"}
        channels = list(dict.fromkeys([m.channel for m in measurements]))
        for ri, g in enumerate(gains):
            for ci, grp in enumerate(groups):
                ax = fig.add_subplot(n_rows, n_cols, ri * n_cols + ci + 1)
                ax.set_facecolor(fig_face)
                for ch in channels:
                    col = CHANNEL_COLORS.get(ch, accent)
                    for d in dirs:
                        pts = [m for m in measurements
                               if m.gain == g and m.channel == ch
                               and m.group == grp and m.direction == d]
                        if not pts:
                            continue
                        pts.sort(key=lambda m: m.element)
                        xs = [m.element for m in pts]
                        ys = [m.modulation_pct for m in pts]
                        ax.plot(xs, ys, color=col,
                                linestyle=dir_ls[d],
                                marker=dir_marker[d],
                                markersize=6, markeredgecolor="white",
                                linewidth=1.4,
                                label=(f"{ch} ({d})" if ri == 0 and ci == 0
                                       else None))
                ax.axhline(threshold, color=text, linestyle=":",
                           linewidth=0.7, alpha=0.6)
                ax.set_xlim(0.7, 6.3); ax.set_ylim(0, 1.05)
                ax.set_xticks(range(1, 7))
                ax.tick_params(colors=text)
                for sp in ax.spines.values():
                    sp.set_color(text)
                title = (f"{g}   Group {grp}   "
                         f"({lp_mm(grp, 1):.2f}–{lp_mm(grp, 6):.2f} lp/mm)"
                         if g else
                         f"Group {grp}   "
                         f"({lp_mm(grp, 1):.2f}–{lp_mm(grp, 6):.2f} lp/mm)")
                ax.set_title(title, color=text, fontsize=10)
                if ri == n_rows - 1:
                    ax.set_xlabel("Element", color=text)
                if ci == 0:
                    ax.set_ylabel("Michelson contrast", color=text)
        # Single legend on the first axis
        if fig.axes:
            handles, labels = fig.axes[0].get_legend_handles_labels()
            if handles:
                fig.legend(handles, labels, loc="upper center",
                           ncol=min(8, len(labels)),
                           bbox_to_anchor=(0.5, 0.995),
                           frameon=False, fontsize=9,
                           labelcolor=text)
        fig.suptitle(
            f"Group sweep — Michelson contrast vs element   "
            f"(dashed line: threshold = {threshold:.2f})",
            y=0.975, color=text, fontsize=12)
        fig.tight_layout(rect=[0, 0, 1, 0.93])
        cnv.draw_idle()

    dir_cb.currentIndexChanged.connect(redraw)

    def do_export_png():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save sweep PNG",
            f"{_source_stem(app_state)}_sweep.png", "PNG (*.png)")
        if path:
            fig.savefig(path, dpi=220, bbox_inches="tight",
                        facecolor=fig_face)
    btn_png.clicked.connect(do_export_png)

    def do_export_csv():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save sweep CSV",
            f"{_source_stem(app_state)}_sweep.csv", "CSV (*.csv)")
        if not path:
            return
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["gain", "channel", "group", "element", "direction",
                        "lp_mm", "modulation_p1090", "above_threshold"])
            for m in sorted(measurements,
                            key=lambda x: (x.gain, x.channel, x.group,
                                           x.element, x.direction)):
                w.writerow([m.gain, m.channel, m.group, m.element,
                            m.direction, f"{m.lp_mm:.4f}",
                            f"{m.modulation_pct:.6f}",
                            int(m.modulation_pct >= threshold)])
        from PySide6 import QtWidgets as _W
        _W.QMessageBox.information(parent, "Export",
                                   f"Exported {len(measurements)} rows → {path}")
    btn_csv.clicked.connect(do_export_csv)

    redraw()
    return tab


# ==========================================================================
# Tab 6 — FFT / MTF (per-line FFT spectra + Coltman sine-MTF curve)
# ==========================================================================

# Coltman correction maps the *square-wave* contrast (CTF) measured on a
# bar target to the sine-wave MTF a manufacturer would quote. The single-
# frequency approximation (no harmonics measured separately) is:
#     MTF_sine(f) ≈ (π/4) · CTF_square(f)
# Reference: Coltman, JOSA 44, 468 (1954).
_COLTMAN_PI_OVER_4 = float(np.pi / 4.0)


def _draw_mtf_curves(fig, sel: List["Measurement"], threshold: float,
                     coltman: bool, fig_face: str, text: str,
                     accent: str) -> None:
    """One panel per gain; channels overlaid with H solid + V dashed."""
    gains = sorted({m.gain for m in sel}) or [""]
    n = len(gains)
    cols = min(2, n)
    rows = int(np.ceil(n / cols))
    fig.set_size_inches(5.6 * cols, 4.0 * rows + 0.4, forward=False)
    factor = _COLTMAN_PI_OVER_4 if coltman else 1.0
    for i, g in enumerate(gains):
        ax = fig.add_subplot(rows, cols, i + 1)
        ax.set_facecolor(fig_face)
        chans = list(dict.fromkeys([m.channel for m in sel if m.gain == g]))
        for ch in chans:
            color = CHANNEL_COLORS.get(ch, accent)
            for d in ("H", "V"):
                pts = [m for m in sel if m.gain == g
                       and m.channel == ch and m.direction == d]
                if not pts:
                    continue
                pts.sort(key=lambda m: m.lp_mm)
                xs = [m.lp_mm for m in pts]
                ys = [m.modulation_pct * factor for m in pts]
                ax.plot(xs, ys, color=color, alpha=0.55,
                        linestyle=("-" if d == "H" else "--"),
                        linewidth=1.3,
                        marker=DIR_MARKERS[d], markersize=7,
                        markerfacecolor=color, markeredgecolor="white",
                        markeredgewidth=0.8,
                        label=f"{ch} ({d})")
        eff_thr = threshold * factor
        ax.axhline(eff_thr, color=text, linestyle=":",
                   linewidth=0.8, alpha=0.6)
        ax.text(0.98, eff_thr + 0.015,
                f"threshold = {eff_thr:.2f}",
                transform=ax.get_yaxis_transform(),
                ha="right", va="bottom", color=text, fontsize=8)
        ax.set_xscale("log")
        # Adapt to whatever lp/mm range the user actually picked
        lp_values = [m.lp_mm for m in sel if m.lp_mm > 0]
        if lp_values:
            x_lo = min(0.85, min(lp_values) / 1.5)
            x_hi = max(18.0, max(lp_values) * 1.5)
        else:
            x_lo, x_hi = 0.85, 18.0
        ax.set_xlim(x_lo, x_hi); ax.set_ylim(0, 1.05)
        ax.set_xlabel("Spatial frequency  (lp/mm @ chart)", color=text)
        ax.set_ylabel("Sine-wave MTF (Coltman)" if coltman
                      else "Square-wave Michelson contrast",
                      color=text)
        ax.tick_params(colors=text)
        for sp in ax.spines.values():
            sp.set_color(text)
        ax.grid(True, which="both", alpha=0.15, linestyle=":")
        title = (g if g else "Channels")
        ax.set_title(title, color=text, fontsize=11)
        ax.legend(fontsize=8, loc="upper right",
                  labelcolor=text, facecolor=fig_face,
                  edgecolor=text, framealpha=0.85)
    fig.suptitle(
        ("Sine-wave MTF (Coltman π/4 approximation)" if coltman
         else "Square-wave Michelson contrast vs spatial frequency"),
        color=text, fontsize=12, y=0.995)
    fig.tight_layout(rect=[0, 0, 1, 0.96])


def _draw_fft_spectra(fig, sel: List["Measurement"],
                      fig_face: str, text: str, accent: str) -> None:
    """One subplot per measurement: zero-padded windowed-FFT magnitude.

    Vertical lines mark the *expected* fundamental + first odd harmonics
    of a 3-bar element spanning the user's line (3 bars + 2 gaps =
    2.5 cycles per line length).
    """
    n = len(sel)
    cols = min(6, n)
    rows = int(np.ceil(n / cols))
    fig.set_size_inches(2.6 * cols, 1.95 * rows + 0.3, forward=False)

    for i, m in enumerate(sel):
        ax = fig.add_subplot(rows, cols, i + 1)
        ax.set_facecolor(fig_face)
        prof = np.asarray(m.profile, dtype=np.float64)
        prof = prof - float(prof.mean())
        n_s = len(prof)
        if n_s < 8:
            ax.text(0.5, 0.5, f"n = {n_s}\n(too short)",
                    ha="center", va="center",
                    transform=ax.transAxes, color=text, fontsize=8)
            ax.set_xticks([]); ax.set_yticks([])
            continue
        win = np.hanning(n_s)
        # Zero-pad to a generous power-of-two for smooth-looking spectrum.
        pad_n = 1 << int(np.ceil(np.log2(max(64, n_s * 4))))
        spec = np.abs(np.fft.rfft(prof * win, n=pad_n))
        if spec.max() > 0:
            spec = spec / spec.max()
        freqs = np.fft.rfftfreq(pad_n, d=1.0)
        col = CHANNEL_COLORS.get(m.channel, accent)
        ax.fill_between(freqs, spec, color=col, alpha=0.18, linewidth=0)
        ax.plot(freqs, spec, color=col, linewidth=1.2)

        # Expected bar-pattern fundamental: 3 bars + 2 gaps = 2.5 cycles
        # spread over the line's original length (n_s - 1 sample steps).
        f_exp = 2.5 / max(1, n_s - 1)
        for k, alpha in ((1, 0.95), (3, 0.45), (5, 0.30)):
            f = k * f_exp
            if f > 0.5:
                continue
            ax.axvline(f, color=text, linestyle="--",
                       linewidth=0.8, alpha=alpha)
        # Find dominant peak in [0.5*f_exp, 1.5*f_exp]
        mask = (freqs >= 0.5 * f_exp) & (freqs <= 1.5 * f_exp)
        if mask.any():
            f_peak = float(freqs[mask][int(np.argmax(spec[mask]))])
            ax.axvline(f_peak, color="#ffd54f", linestyle="-",
                       linewidth=0.9, alpha=0.85)
        else:
            f_peak = float("nan")

        ax.set_xlim(0, 0.5); ax.set_ylim(0, 1.12)
        ax.set_xticks([0, 0.1, 0.2, 0.3, 0.4, 0.5])
        ax.set_xticklabels(["0", "", "", "", "", "0.5"],
                           color=text, fontsize=7)
        ax.set_yticks([])
        ax.tick_params(colors=text)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        for sp in ("bottom", "left"):
            ax.spines[sp].set_color(text)
        title = (f"{m.gain}-{m.channel}  G{m.group}E{m.element}{m.direction}"
                 if m.gain else
                 f"{m.channel}  G{m.group}E{m.element}{m.direction}")
        ax.set_title(title, color=text, fontsize=8)
        sub = (f"f_exp = {f_exp:.3f}   "
               f"f_peak = {f_peak:.3f}" if not np.isnan(f_peak)
               else f"f_exp = {f_exp:.3f}")
        ax.set_xlabel(sub, color=text, fontsize=7, labelpad=2)

    fig.suptitle(
        "FFT magnitude of line profiles "
        "(white dashed = expected 3-bar fundamental + 3rd / 5th harmonics; "
        "yellow = measured peak nearest fundamental)",
        color=text, fontsize=11, y=0.995)
    fig.tight_layout(rect=[0, 0, 1, 0.965])


def _build_fft_mtf_tab(parent, app_state, measurements, threshold,
                       fig_face, text, accent):
    from PySide6 import QtWidgets

    tab = QtWidgets.QWidget(parent)
    layout = QtWidgets.QVBoxLayout(tab)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    gains = sorted({m.gain for m in measurements if m.gain}) or [""]
    channels = list(dict.fromkeys([m.channel for m in measurements]))
    dirs = sorted({m.direction for m in measurements})

    filter_row = QtWidgets.QHBoxLayout()
    gain_cb = QtWidgets.QComboBox(); gain_cb.addItems(["All"] + gains)
    ch_cb = QtWidgets.QComboBox(); ch_cb.addItems(["All"] + channels)
    dir_cb = QtWidgets.QComboBox(); dir_cb.addItems(["All"] + dirs)
    mode_cb = QtWidgets.QComboBox()
    mode_cb.addItems([
        "MTF curve  (raw Michelson — square-wave CTF)",
        "MTF curve  (Coltman \u2192 sine-wave MTF)",
        "FFT spectra  (per-line frequency content)",
    ])

    for label, w in (("Gain", gain_cb), ("Channel", ch_cb),
                     ("Dir", dir_cb), ("View", mode_cb)):
        filter_row.addWidget(QtWidgets.QLabel(label))
        filter_row.addWidget(w)
        filter_row.addSpacing(8)
    filter_row.addStretch(1)
    btn_csv = QtWidgets.QPushButton("Export MTF data CSV…")
    btn_png = QtWidgets.QPushButton("Export PNG…")
    filter_row.addWidget(btn_csv); filter_row.addWidget(btn_png)
    layout.addLayout(filter_row)

    fig = Figure(facecolor=fig_face)
    page, cnv = _make_canvas_page(tab, fig)
    layout.addWidget(page, stretch=1)

    info_lbl = QtWidgets.QLabel("")
    info_lbl.setWordWrap(True)
    info_lbl.setStyleSheet(f"color: {text};")
    layout.addWidget(info_lbl)

    def current_filter() -> List["Measurement"]:
        sel = []
        for m in measurements:
            if gain_cb.currentText() != "All" and m.gain != gain_cb.currentText():
                continue
            if ch_cb.currentText() != "All" and m.channel != ch_cb.currentText():
                continue
            if dir_cb.currentText() != "All" and m.direction != dir_cb.currentText():
                continue
            sel.append(m)
        return sel

    def redraw():
        sel = current_filter()
        view = mode_cb.currentText()
        fig.clear(); fig.set_facecolor(fig_face)
        if not sel:
            ax = fig.add_subplot(111)
            ax.text(0.5, 0.5, "No measurements match the filter.",
                    transform=ax.transAxes, ha="center", va="center",
                    color=text, fontsize=12)
            ax.set_xticks([]); ax.set_yticks([])
            for sp in ax.spines.values():
                sp.set_visible(False)
            info_lbl.setText("")
            cnv.draw_idle(); return

        if view.startswith("MTF curve"):
            coltman = "Coltman" in view
            _draw_mtf_curves(fig, sel, threshold, coltman,
                             fig_face, text, accent)
            note = ("Coltman π/4 single-frequency approximation: "
                    "MTF_sine(f) ≈ 0.785 · CTF_square(f). "
                    "Use this when comparing against vendor-quoted MTF."
                    if coltman else
                    "Square-wave CTF — what the bar target directly "
                    "measures (Michelson contrast).")
            info_lbl.setText(
                f"{len(sel)} measurements shown. {note}")
        else:
            _draw_fft_spectra(fig, sel, fig_face, text, accent)
            info_lbl.setText(
                f"{len(sel)} line profiles. "
                "Expected fundamental: 3 bars + 2 gaps span 2.5 cycles "
                "across the line; harmonics at 3× / 5× are square-wave "
                "Fourier components. Yellow = measured peak nearest "
                "expected fundamental — close match means the line is "
                "well placed.")
        cnv.draw_idle()

    def do_export_png():
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save FFT/MTF PNG",
            f"{_source_stem(app_state)}_fft_mtf.png", "PNG (*.png)")
        if path:
            fig.savefig(path, dpi=220, bbox_inches="tight",
                        facecolor=fig_face)

    def do_export_csv():
        sel = current_filter()
        if not sel:
            from PySide6 import QtWidgets as _W
            _W.QMessageBox.information(parent, "Export",
                                       "No measurements match filter.")
            return
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            parent, "Save MTF CSV",
            f"{_source_stem(app_state)}_mtf.csv", "CSV (*.csv)")
        if not path:
            return
        import csv
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["gain", "channel", "group", "element", "direction",
                        "lp_mm", "ctf_square_michelson",
                        "mtf_sine_coltman_approx", "above_threshold"])
            for m in sorted(sel,
                            key=lambda x: (x.gain, x.channel, x.lp_mm)):
                w.writerow([m.gain, m.channel, m.group, m.element,
                            m.direction, f"{m.lp_mm:.4f}",
                            f"{m.modulation_pct:.6f}",
                            f"{m.modulation_pct * _COLTMAN_PI_OVER_4:.6f}",
                            int(m.modulation_pct >= threshold)])
        from PySide6 import QtWidgets as _W
        _W.QMessageBox.information(parent, "Export",
                                   f"Exported {len(sel)} rows → {path}")

    btn_png.clicked.connect(do_export_png)
    btn_csv.clicked.connect(do_export_csv)
    for cb in (gain_cb, ch_cb, dir_cb, mode_cb):
        cb.currentIndexChanged.connect(redraw)
    redraw()
    return tab


# ==========================================================================
# open_analysis_window — driver
# ==========================================================================

def _source_stem(app_state) -> str:
    p = getattr(app_state, "source_path", None)
    return Path(p).stem if p else "usaf"


def open_analysis_window(*, app_state, mode: str = "rgb",
                         threshold: float = 0.2,
                         parent=None, root=None) -> None:
    """Multi-tab USAF analysis viewer (Qt).

    Tabs:
      1. MTF curves           — per-gain chart + modulation vs lp/mm
      2. Profile gallery      — filtered grid of 1-D line profiles
      3. Summary table        — sortable measurement table + CSV export
      4. Detection heatmap    — group × element heatmap per gain-channel
      5. Group sweep          — modulation vs element, faceted per group
      6. FFT / MTF            — square-wave CTF, Coltman-corrected sine
                                 MTF, and per-line FFT spectra with
                                 expected-fundamental + harmonic markers
    """
    from PySide6 import QtWidgets

    measurements = compute_all_measurements(
        app_state.channel_images, app_state.lines,
        mode=mode, transform=_get_transform_from_app(app_state),
        sharpen=_get_sharpen_from_app(app_state),
        measurement_method=str(getattr(app_state,
                                        "measurement_method", "pct")),
    )
    if not measurements:
        QtWidgets.QMessageBox.information(
            parent or root, "No data",
            "No measurements could be produced from the picked lines.")
        return

    parent = parent if parent is not None else root
    win = QtWidgets.QMainWindow(parent)
    n_lines = len(app_state.lines)
    win.setWindowTitle(
        f"USAF analysis — mode: {mode}   "
        f"({n_lines} line{'s' if n_lines != 1 else ''}, "
        f"threshold = {int(threshold*100)}%)")
    win.resize(1500, 900)

    # Inherit parent stylesheet for consistent theming
    if parent is not None:
        try:
            win.setStyleSheet(parent.styleSheet() or
                              QtWidgets.QApplication.instance().styleSheet())
        except Exception:
            pass

    fig_face, text, accent = _palette_from_parent(parent)

    central = QtWidgets.QWidget()
    win.setCentralWidget(central)
    layout = QtWidgets.QVBoxLayout(central)
    layout.setContentsMargins(6, 6, 6, 6); layout.setSpacing(6)

    tabs = QtWidgets.QTabWidget()
    layout.addWidget(tabs, stretch=1)

    tabs.addTab(_build_mtf_tab(win, app_state, measurements, mode, threshold,
                               fig_face, text, accent),
                "MTF curves")
    tabs.addTab(_build_gallery_tab(win, app_state, measurements, threshold,
                                   fig_face, text, accent),
                "Profile gallery")
    tabs.addTab(_build_table_tab(win, app_state, measurements, threshold,
                                 fig_face, text, accent),
                "Summary table")
    tabs.addTab(_build_heatmap_tab(win, app_state, measurements, threshold,
                                   fig_face, text, accent),
                "Detection heatmap")
    tabs.addTab(_build_sweep_tab(win, app_state, measurements, threshold,
                                 fig_face, text, accent),
                "Group sweep")
    tabs.addTab(_build_fft_mtf_tab(win, app_state, measurements, threshold,
                                   fig_face, text, accent),
                "FFT / MTF")

    if parent is not None:
        try:
            if not hasattr(parent, "_analysis_windows"):
                parent._analysis_windows = []
            parent._analysis_windows.append(win)
        except Exception:
            pass
    win.show()
