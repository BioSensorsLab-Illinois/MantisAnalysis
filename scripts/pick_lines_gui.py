"""Interactive USAF resolution picker — PySide6 / Qt6.

Cross-platform (Windows / macOS / Linux) GUI with native DPI support.

Workflow
--------
1. File ▸ Open: load an H5 GSense recording or a single image (PNG/TIFF/JPG).
2. Pick a channel (HG/LG × R/G/B/NIR + per-half luminance Y) in the left
   sidebar.
3. In the **Picking** card, set the label that the next line will receive:
       Group     [0..5]
       Element   [1..6]
       Direction [H | V]
4. Left-click two points across the 3 bars of one USAF element. The line
   is auto-labeled with the dropdown values. Auto-increment advances the
   element after each pick. Sequential mode advances both group + element
   so you can sweep all 36 elements in one direction.
5. Scroll-wheel zoom is always live (regardless of toolbar Pan/Zoom mode).
   Right-click on a line to delete it. Double-click a row to re-label it.
6. Tweak Display + Sharpen sliders to make bars easier to see; sharpening
   is display-only unless "Apply sharpening to analysis" is ticked.
7. Run analysis to open the journal-style figure window.

Run:
    python scripts/pick_lines_gui.py [<path-to-h5-or-image>]
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import matplotlib

matplotlib.use("QtAgg")

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets

from matplotlib.backends.backend_qtagg import (
    FigureCanvasQTAgg,
    NavigationToolbar2QT,
)
from matplotlib.figure import Figure

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mantisanalysis.image_io import load_any
from mantisanalysis.image_processing import (
    SHARPEN_METHODS,
    maybe_apply_to_analysis,
    prepare_display,
)
from mantisanalysis.usaf_groups import (
    LineSpec,
    USAF_LP_MM,
    extract_line_profile,
    lp_mm,
    measure_modulation,
)


# --- Themes --------------------------------------------------------------
# Two complete palettes. Switching between them is a one-call operation
# (apply_theme on the QApplication + restyle all matplotlib figures).
THEMES: Dict[str, Dict[str, str]] = {
    "light": {
        "BG":         "#f5f6f8",
        "SURFACE":    "#ffffff",
        "BORDER":     "#d0d7de",
        "TEXT":       "#1f2328",
        "TEXT_MUTED": "#6e7781",
        "ACCENT":     "#0969da",
        "ACCENT_HI":  "#0858c0",
        "ACCENT_RED": "#cf222e",
        "ALT_ROW":    "#fafbfc",
        "HOVER":      "#f0f3f6",
        "PRESS":      "#e6ebf1",
        "TROUGH":     "#e6ebf1",
        "FIG_FACE":   "#ffffff",
        "AXES_FACE":  "#0a0a0a",  # the chart canvas keeps a dark axis for contrast
        "AXIS_INK":   "#1f2328",
        "EMPTY_INK":  "#6e7781",
    },
    "dark": {
        "BG":         "#1f2228",
        "SURFACE":    "#2a2d33",
        "BORDER":     "#3a3d44",
        "TEXT":       "#e6e8eb",
        "TEXT_MUTED": "#9aa0a6",
        "ACCENT":     "#4dabf7",
        "ACCENT_HI":  "#3791e6",
        "ACCENT_RED": "#ff6b6b",
        "ALT_ROW":    "#2f3239",
        "HOVER":      "#34373e",
        "PRESS":      "#3d4047",
        "TROUGH":     "#3a3d44",
        "FIG_FACE":   "#2a2d33",
        "AXES_FACE":  "#0a0a0a",
        "AXIS_INK":   "#e6e8eb",
        "EMPTY_INK":  "#9aa0a6",
    },
}

# Per-element line colors (used to overlay picked lines on the chart).
ELEMENT_COLORS = {
    1: "#1f77b4", 2: "#2ca02c", 3: "#ff7f0e",
    4: "#d62728", 5: "#9467bd", 6: "#17becf",
}
COLORMAPS = ("gray", "viridis", "magma", "inferno", "plasma", "cividis")
THRESHOLDS = (0.5, 0.3, 0.2, 0.1)
MEASUREMENT_METHODS = (
    ("pct",    "Percentile (P10/P90)"),
    ("fft",    "FFT @ fundamental"),
    ("minmax", "Peak-to-peak (min/max)"),
)

# Output-mode definitions used in the sidebar combobox + Analysis menu.
# Tuple form: (mode_id, human label).
OUTPUT_MODES = (
    ("rgb",       "R / G / B"),
    ("rgbnir",    "R / G / B / NIR"),
    ("luminance", "Y luminance"),
    ("r_only",    "R only"),
    ("g_only",    "G only"),
    ("b_only",    "B only"),
    ("n_only",    "NIR only"),
)


def make_qss(t: Dict[str, str]) -> str:
    return f"""
QMainWindow {{ background: {t['BG']}; }}
QWidget {{ color: {t['TEXT']}; }}
QStatusBar {{ background: {t['SURFACE']}; color: {t['TEXT_MUTED']};
              border-top: 1px solid {t['BORDER']};
              padding: 0 6px; min-height: 18px; }}
QFrame#Card {{
    background: {t['SURFACE']};
    border: 1px solid {t['BORDER']};
    border-radius: 6px;
}}
QLabel {{ color: {t['TEXT']}; }}
QLabel#CardTitle {{
    color: {t['TEXT_MUTED']};
    font-weight: 700;
    letter-spacing: 0.4px;
    padding: 0;
}}
QLabel#TitleLabel {{ font-weight: 600; font-size: 12pt; color: {t['TEXT']}; }}
QLabel#MutedLabel {{ color: {t['TEXT_MUTED']}; }}
QPushButton {{
    background: {t['SURFACE']};
    color: {t['TEXT']};
    border: 1px solid {t['BORDER']};
    padding: 3px 10px;
    min-height: 18px;
    border-radius: 4px;
}}
QPushButton:hover {{ background: {t['HOVER']}; }}
QPushButton:pressed {{ background: {t['PRESS']}; }}
QPushButton:disabled {{ color: {t['TEXT_MUTED']}; }}
QPushButton#AccentButton {{
    background: {t['ACCENT']};
    color: #ffffff;
    font-weight: 600;
    border: 1px solid {t['ACCENT']};
    padding: 4px 12px;
}}
QPushButton#AccentButton:hover {{ background: {t['ACCENT_HI']}; border-color: {t['ACCENT_HI']}; }}
QPushButton#AccentButton:pressed {{ background: {t['ACCENT_HI']}; }}
QComboBox, QSpinBox, QDoubleSpinBox {{
    background: {t['SURFACE']};
    color: {t['TEXT']};
    border: 1px solid {t['BORDER']};
    padding: 2px 6px;
    min-height: 16px;
    border-radius: 4px;
    selection-background-color: {t['ACCENT']};
    selection-color: #ffffff;
}}
QComboBox::drop-down {{ border: none; }}
QComboBox QAbstractItemView {{
    background: {t['SURFACE']};
    color: {t['TEXT']};
    selection-background-color: {t['ACCENT']};
    selection-color: #ffffff;
}}
QGroupBox {{ border: 1px solid {t['BORDER']}; border-radius: 6px;
             margin-top: 12px; padding: 10px; color: {t['TEXT']}; }}
QGroupBox::title {{ subcontrol-origin: margin; left: 10px;
                    padding: 0 4px; color: {t['TEXT_MUTED']}; }}
QSlider::groove:horizontal {{ height: 4px; background: {t['TROUGH']}; border-radius: 2px; }}
QSlider::handle:horizontal {{
    background: {t['ACCENT']};
    width: 14px;
    margin: -6px 0;
    border-radius: 7px;
}}
QTreeWidget {{
    border: 1px solid {t['BORDER']};
    background: {t['SURFACE']};
    color: {t['TEXT']};
    alternate-background-color: {t['ALT_ROW']};
}}
QTreeWidget::item:selected {{ background: {t['ACCENT']}; color: #ffffff; }}
QHeaderView::section {{
    background: {t['ALT_ROW']};
    color: {t['TEXT']};
    border: 0; border-right: 1px solid {t['BORDER']};
    padding: 4px 6px; font-weight: 600;
}}
QToolBar {{ background: {t['SURFACE']}; border: 0; spacing: 2px; }}
QToolButton {{
    background: {t['SURFACE']};
    color: {t['TEXT']};
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 4px;
}}
QToolButton:hover {{ background: {t['HOVER']}; border-color: {t['BORDER']}; }}
QToolButton:checked {{ background: {t['HOVER']}; border-color: {t['ACCENT']}; }}
QToolButton:disabled {{ color: {t['TEXT_MUTED']}; }}
QMenuBar {{ background: {t['SURFACE']}; color: {t['TEXT']};
            border-bottom: 1px solid {t['BORDER']}; }}
QMenuBar::item {{ background: transparent; padding: 3px 8px; }}
QMenuBar::item:selected {{ background: {t['HOVER']}; }}
QMenu {{ background: {t['SURFACE']}; color: {t['TEXT']};
         border: 1px solid {t['BORDER']}; }}
QMenu::item {{ padding: 4px 14px; }}
QMenu::item:selected {{ background: {t['ACCENT']}; color: #ffffff; }}
QCheckBox, QRadioButton {{ color: {t['TEXT']}; spacing: 5px; }}
QCheckBox::indicator, QRadioButton::indicator {{ width: 13px; height: 13px; }}
QSplitter::handle {{ background: {t['BORDER']}; }}
QScrollArea {{ background: {t['BG']}; border: 0; }}
QScrollArea > QWidget > QWidget {{ background: {t['BG']}; }}
QScrollBar:vertical {{
    background: {t['BG']}; width: 10px; border: 0;
}}
QScrollBar:horizontal {{
    background: {t['BG']}; height: 10px; border: 0;
}}
QScrollBar::handle {{
    background: {t['BORDER']}; border-radius: 4px; min-height: 24px; min-width: 24px;
}}
QScrollBar::handle:hover {{ background: {t['TEXT_MUTED']}; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QTabWidget::pane {{ border: 1px solid {t['BORDER']}; background: {t['SURFACE']}; }}
QTabBar::tab {{
    background: {t['BG']}; color: {t['TEXT']};
    padding: 4px 10px; border: 1px solid {t['BORDER']};
    border-bottom: none;
    border-top-left-radius: 3px; border-top-right-radius: 3px;
}}
QTabBar::tab:selected {{ background: {t['SURFACE']}; }}
QTabBar::tab:!selected {{ margin-top: 2px; }}
QToolBar::separator {{ width: 4px; }}
QStatusBar::item {{ border: 0; }}
QDialog {{ background: {t['BG']}; color: {t['TEXT']}; }}
QToolTip {{ background: {t['SURFACE']}; color: {t['TEXT']};
            border: 1px solid {t['BORDER']}; }}
"""


def apply_palette(app: "QtWidgets.QApplication", t: Dict[str, str]) -> None:
    """Set Qt palette so non-stylesheet widgets (matplotlib toolbar icons,
    native menus, etc.) pick the right light/dark variant."""
    p = QtGui.QPalette()
    p.setColor(QtGui.QPalette.Window,          QtGui.QColor(t["BG"]))
    p.setColor(QtGui.QPalette.WindowText,      QtGui.QColor(t["TEXT"]))
    p.setColor(QtGui.QPalette.Base,            QtGui.QColor(t["SURFACE"]))
    p.setColor(QtGui.QPalette.AlternateBase,   QtGui.QColor(t["ALT_ROW"]))
    p.setColor(QtGui.QPalette.Text,            QtGui.QColor(t["TEXT"]))
    p.setColor(QtGui.QPalette.Button,          QtGui.QColor(t["SURFACE"]))
    # ButtonText is the key signal matplotlib uses to choose
    # light-glyph vs dark-glyph icon variants for its toolbar.
    p.setColor(QtGui.QPalette.ButtonText,      QtGui.QColor(t["TEXT"]))
    p.setColor(QtGui.QPalette.BrightText,      QtGui.QColor("#ffffff"))
    p.setColor(QtGui.QPalette.Highlight,       QtGui.QColor(t["ACCENT"]))
    p.setColor(QtGui.QPalette.HighlightedText, QtGui.QColor("#ffffff"))
    p.setColor(QtGui.QPalette.ToolTipBase,     QtGui.QColor(t["SURFACE"]))
    p.setColor(QtGui.QPalette.ToolTipText,     QtGui.QColor(t["TEXT"]))
    p.setColor(QtGui.QPalette.PlaceholderText, QtGui.QColor(t["TEXT_MUTED"]))
    p.setColor(QtGui.QPalette.Link,            QtGui.QColor(t["ACCENT"]))
    p.setColor(QtGui.QPalette.LinkVisited,     QtGui.QColor(t["ACCENT_HI"]))
    # Disabled set
    for role in (QtGui.QPalette.WindowText, QtGui.QPalette.Text,
                 QtGui.QPalette.ButtonText):
        p.setColor(QtGui.QPalette.Disabled, role,
                   QtGui.QColor(t["TEXT_MUTED"]))
    app.setPalette(p)


def apply_theme(app: "QtWidgets.QApplication", theme_name: str) -> Dict[str, str]:
    """Apply theme to the QApplication. Returns the theme dict."""
    t = THEMES[theme_name]
    apply_palette(app, t)
    app.setStyleSheet(make_qss(t))
    return t


# ------------------------------------------------------------------------
# Helpers

def apply_transform(img: np.ndarray, *, rotation: int,
                    flip_h: bool, flip_v: bool) -> np.ndarray:
    out = img
    if rotation:
        out = np.rot90(out, k=(rotation // 90) % 4)
    if flip_h:
        out = np.fliplr(out)
    if flip_v:
        out = np.flipud(out)
    return np.ascontiguousarray(out)


def line_distance(p, p0, p1) -> float:
    px, py = p
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    if L2 == 0:
        return float(np.hypot(px - x0, py - y0))
    t = max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
    cx = x0 + t * dx
    cy = y0 + t * dy
    return float(np.hypot(px - cx, py - cy))


# ------------------------------------------------------------------------
# Card layout helper

class Card(QtWidgets.QFrame):
    """Soft-shadowed surface with a section title."""
    def __init__(self, title: str, parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.setFrameShape(QtWidgets.QFrame.NoFrame)
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(8, 6, 8, 8)
        layout.setSpacing(4)
        title_lbl = QtWidgets.QLabel(title.upper())
        title_lbl.setObjectName("CardTitle")
        layout.addWidget(title_lbl)
        self.body = QtWidgets.QWidget()
        self.body_layout = QtWidgets.QVBoxLayout(self.body)
        self.body_layout.setContentsMargins(0, 0, 0, 0)
        self.body_layout.setSpacing(4)
        layout.addWidget(self.body)


def slider_row(parent_layout, label: str,
               getter, setter,
               low: float, high: float, default: float,
               *, decimals: int = 2, step: float = None,
               on_change=None) -> QtWidgets.QDoubleSpinBox:
    """Add a (label, slider, value-spinbox) row. Returns the spinbox."""
    row = QtWidgets.QHBoxLayout()
    row.setSpacing(8)
    lbl = QtWidgets.QLabel(label)
    lbl.setMinimumWidth(96)
    row.addWidget(lbl)
    sl = QtWidgets.QSlider(QtCore.Qt.Horizontal)
    sl.setMinimum(0); sl.setMaximum(1000)
    span = high - low
    init_pos = int(round((default - low) / span * 1000))
    sl.setValue(init_pos)
    sb = QtWidgets.QDoubleSpinBox()
    sb.setDecimals(decimals)
    sb.setRange(low, high)
    sb.setSingleStep(step or (span / 100.0))
    sb.setValue(default)
    sb.setMaximumWidth(80)

    def slider_changed(v):
        val = low + v / 1000.0 * span
        sb.blockSignals(True)
        sb.setValue(val)
        sb.blockSignals(False)
        setter(val)
        if on_change:
            on_change()

    def spin_changed(v):
        pos = int(round((v - low) / span * 1000))
        sl.blockSignals(True)
        sl.setValue(pos)
        sl.blockSignals(False)
        setter(v)
        if on_change:
            on_change()

    sl.valueChanged.connect(slider_changed)
    sb.valueChanged.connect(spin_changed)
    row.addWidget(sl, stretch=1)
    row.addWidget(sb)
    parent_layout.addLayout(row)
    return sb


# ------------------------------------------------------------------------
# Image canvas widget

class ImageCanvas(FigureCanvasQTAgg):
    """matplotlib FigureCanvas with right-click + scroll-wheel + cursor reporting.

    Emits Qt signals so the parent app can stay clean.
    """
    leftClicked = QtCore.Signal(float, float)      # (x, y) in axes coords
    rightClicked = QtCore.Signal(float, float)
    cursorMoved = QtCore.Signal(object, object)    # x, y or None, None
    zoomed = QtCore.Signal()

    def __init__(self, parent=None):
        self.fig = Figure(figsize=(8, 8))
        super().__init__(self.fig)
        self.setParent(parent)
        self.ax = self.fig.add_subplot(111, facecolor="#0a0a0a")
        self.ax.set_xticks([]); self.ax.set_yticks([])
        for s in ("top", "right", "bottom", "left"):
            self.ax.spines[s].set_visible(False)
        # We use mpl events for axes-aware coords, not Qt events
        self.mpl_connect("button_press_event", self._on_press)
        self.mpl_connect("motion_notify_event", self._on_motion)
        self.mpl_connect("scroll_event", self._on_scroll)
        self._nav_mode = ""

    def set_nav_mode(self, mode: str) -> None:
        self._nav_mode = mode

    def _on_press(self, event):
        if self._nav_mode != "":
            return
        if event.inaxes != self.ax:
            return
        if event.button == 1:
            self.leftClicked.emit(float(event.xdata), float(event.ydata))
        elif event.button == 3:
            self.rightClicked.emit(float(event.xdata), float(event.ydata))

    def _on_motion(self, event):
        if event.inaxes != self.ax:
            self.cursorMoved.emit(None, None)
        else:
            self.cursorMoved.emit(event.xdata, event.ydata)

    def _on_scroll(self, event):
        if event.inaxes != self.ax:
            return
        base = 1.25
        if event.button == "up":
            scale = 1.0 / base
        elif event.button == "down":
            scale = base
        else:
            return
        cur_x0, cur_x1 = self.ax.get_xlim()
        cur_y0, cur_y1 = self.ax.get_ylim()
        xd = event.xdata; yd = event.ydata
        if xd is None or yd is None:
            return
        new_w = (cur_x1 - cur_x0) * scale
        new_h = (cur_y1 - cur_y0) * scale
        relx = (xd - cur_x0) / (cur_x1 - cur_x0) if cur_x1 != cur_x0 else 0.5
        rely = (yd - cur_y0) / (cur_y1 - cur_y0) if cur_y1 != cur_y0 else 0.5
        self.ax.set_xlim(xd - new_w * relx, xd + new_w * (1 - relx))
        self.ax.set_ylim(yd - new_h * rely, yd + new_h * (1 - rely))
        self.draw_idle()
        self.zoomed.emit()


# ------------------------------------------------------------------------
# Edit-line dialog

class EditLineDialog(QtWidgets.QDialog):
    def __init__(self, ln: LineSpec, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Edit line")
        self.setModal(True)
        self.resize(320, 180)
        form = QtWidgets.QFormLayout()
        from mantisanalysis.usaf_groups import USAF_GROUPS, USAF_ELEMENTS
        self.group_sb = QtWidgets.QSpinBox()
        self.group_sb.setRange(min(USAF_GROUPS), max(USAF_GROUPS))
        self.group_sb.setValue(ln.group)
        self.elt_sb = QtWidgets.QSpinBox()
        self.elt_sb.setRange(min(USAF_ELEMENTS), max(USAF_ELEMENTS))
        self.elt_sb.setValue(ln.element)
        self.dir_cb = QtWidgets.QComboBox()
        self.dir_cb.addItems(["H", "V"])
        self.dir_cb.setCurrentText(ln.direction.upper())
        form.addRow("Group", self.group_sb)
        form.addRow("Element", self.elt_sb)
        form.addRow("Direction", self.dir_cb)
        coord_lbl = QtWidgets.QLabel(
            f"({ln.p0[0]:.0f}, {ln.p0[1]:.0f}) → "
            f"({ln.p1[0]:.0f}, {ln.p1[1]:.0f})")
        coord_lbl.setObjectName("MutedLabel")
        form.addRow("Coords", coord_lbl)
        bb = QtWidgets.QDialogButtonBox(
            QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        layout = QtWidgets.QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(bb)

    def result_spec(self, base: LineSpec) -> LineSpec:
        return LineSpec(group=int(self.group_sb.value()),
                        element=int(self.elt_sb.value()),
                        direction=str(self.dir_cb.currentText()).upper(),
                        p0=base.p0, p1=base.p1)


# ------------------------------------------------------------------------
# Main window

class USAFPickerApp(QtWidgets.QMainWindow):
    def __init__(self, initial_path: Optional[Path] = None,
                 theme_name: str = "light"):
        super().__init__()
        self.setWindowTitle("RGB-NIR USAF Resolution Picker")
        self.resize(1500, 920)
        self.setMinimumSize(1100, 720)

        # ---- Theme ----
        self.theme_name = theme_name if theme_name in THEMES else "light"
        self.theme = THEMES[self.theme_name]

        # ---- State ----
        self.channel_images: Dict[str, np.ndarray] = {}
        self.channel_names: List[str] = []
        self.attrs: Dict[str, str] = {}
        self.source_path: Optional[Path] = None
        self.source_kind: str = ""
        self.current_channel: Optional[str] = None
        self.lines: List[LineSpec] = []
        self.tmp_pts: List[Tuple[float, float]] = []
        self._lines_path: Optional[Path] = None
        self._last_rendered_channel: Optional[str] = None
        self._saved_xlim: Optional[Tuple[float, float]] = None
        self._saved_ylim: Optional[Tuple[float, float]] = None
        self._last_preview_pts: Optional[Tuple[Tuple[float, float],
                                               Tuple[float, float]]] = None

        # Picking
        self.pick_group = 0
        self.pick_element = 1
        self.pick_direction = "H"
        self.auto_increment = True
        self.sequential_mode = False

        # Transform
        self.rotation = 180
        self.flip_h = False
        self.flip_v = False

        # Display
        self.brightness = 0.0
        self.contrast = 1.0
        self.gamma = 1.0
        self.clip_lo = 1.0
        self.clip_hi = 99.5
        self.colormap = "gray"

        # Sharpen
        self.sharpen_method = "None"
        self.sharpen_amount = 1.0
        self.sharpen_radius = 2.0
        self.sharpen_to_analysis = False

        # Output
        self.output_mode = "rgb"
        self.threshold = 0.20
        # Measurement method: 'pct' / 'fft' / 'minmax'. FFT is the robust
        # choice when bars approach the per-pixel Nyquist.
        self.measurement_method = "pct"

        self._build_ui()
        self._build_menu()
        self._build_shortcuts()
        self.statusBar().showMessage("Open a file (Ctrl+O) to begin.")

        if initial_path is not None:
            self._do_open(initial_path)

    # ---- Menu + shortcuts -----------------------------------------------

    def _build_menu(self) -> None:
        mb = self.menuBar()
        m_file = mb.addMenu("&File")
        a_open = m_file.addAction("Open H5 / Image…")
        a_open.setShortcut("Ctrl+O"); a_open.triggered.connect(self.menu_open)
        m_file.addSeparator()
        a_save = m_file.addAction("Save Lines as JSON…")
        a_save.setShortcut("Ctrl+S"); a_save.triggered.connect(self.menu_save_lines)
        a_load = m_file.addAction("Load Lines from JSON…")
        a_load.triggered.connect(self.menu_load_lines)
        m_file.addSeparator()
        a_quit = m_file.addAction("Quit"); a_quit.setShortcut("Ctrl+Q")
        a_quit.triggered.connect(self.close)

        m_view = mb.addMenu("&View")
        for d in (0, 90, 180, 270):
            a = m_view.addAction(f"Rotation: {d}°")
            a.triggered.connect(lambda _=False, d=d: self._set_rotation(d))
        m_view.addSeparator()
        m_view.addAction("Reset display", self._reset_display)
        m_view.addAction("Reset sharpen", self._reset_sharpen)
        m_view.addAction("Reset zoom", self._reset_view)
        m_view.addSeparator()
        # Theme submenu
        m_theme = m_view.addMenu("Theme")
        self._theme_actions = {}
        theme_group = QtGui.QActionGroup(self)
        theme_group.setExclusive(True)
        for name in ("light", "dark"):
            a = QtGui.QAction(name.capitalize(), self, checkable=True)
            a.setChecked(name == self.theme_name)
            a.triggered.connect(lambda _=False, n=name: self._set_theme(n))
            theme_group.addAction(a)
            m_theme.addAction(a)
            self._theme_actions[name] = a

        m_an = mb.addMenu("&Analysis")
        for mode, label in OUTPUT_MODES:
            a = m_an.addAction(label)
            a.triggered.connect(lambda _=False, m=mode: self.run_analysis(m))

        m_help = mb.addMenu("&Help")
        m_help.addAction("How to use", self.show_help)

    def _build_shortcuts(self) -> None:
        # Element / group nav
        QtGui.QShortcut(QtGui.QKeySequence("Up"), self,
                        activated=self._key_element_up)
        QtGui.QShortcut(QtGui.QKeySequence("Down"), self,
                        activated=self._key_element_down)
        QtGui.QShortcut(QtGui.QKeySequence("Right"), self,
                        activated=self._key_group_up)
        QtGui.QShortcut(QtGui.QKeySequence("Left"), self,
                        activated=self._key_group_down)
        # Undo / cancel / delete
        QtGui.QShortcut(QtGui.QKeySequence("Ctrl+Z"), self,
                        activated=self._undo_last)
        QtGui.QShortcut(QtGui.QKeySequence("Esc"), self,
                        activated=self._cancel_tmp)
        QtGui.QShortcut(QtGui.QKeySequence("Delete"), self,
                        activated=self._delete_selected)

    # ---- Layout ---------------------------------------------------------

    def _build_ui(self) -> None:
        splitter = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        splitter.setHandleWidth(6)
        self.setCentralWidget(splitter)

        splitter.addWidget(self._build_left_sidebar())
        splitter.addWidget(self._build_center())
        splitter.addWidget(self._build_right_sidebar())
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setStretchFactor(2, 0)
        splitter.setSizes([230, 760, 290])

    def _scrollable(self, body: QtWidgets.QWidget) -> QtWidgets.QScrollArea:
        sa = QtWidgets.QScrollArea()
        sa.setWidgetResizable(True)
        sa.setFrameShape(QtWidgets.QFrame.NoFrame)
        # Show horizontal scrollbar only if content really doesn't fit —
        # never force the sidebar to grow to accommodate wide widgets.
        sa.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAsNeeded)
        # Let the splitter shrink the sidebar down to a usable minimum
        # regardless of inner content's natural width.
        sa.setMinimumWidth(180)
        body.setMinimumWidth(0)
        sa.setWidget(body)
        return sa

    def _build_left_sidebar(self) -> QtWidgets.QWidget:
        body = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(body)
        v.setContentsMargins(8, 8, 4, 8); v.setSpacing(6)

        # Source
        c = Card("Source")
        self.source_label = QtWidgets.QLabel("(no file loaded)")
        self.source_label.setWordWrap(True)
        self.source_label.setObjectName("MutedLabel")
        c.body_layout.addWidget(self.source_label)
        btn_open = QtWidgets.QPushButton("Open file… (Ctrl+O)")
        btn_open.clicked.connect(self.menu_open)
        c.body_layout.addWidget(btn_open)
        v.addWidget(c)

        # Channel
        self.channel_card = Card("Channel")
        self.channel_button_group = QtWidgets.QButtonGroup(self)
        self.channel_button_group.setExclusive(True)
        self.channel_buttons_holder = QtWidgets.QWidget()
        self.channel_buttons_layout = QtWidgets.QVBoxLayout(
            self.channel_buttons_holder)
        self.channel_buttons_layout.setContentsMargins(0, 0, 0, 0)
        self.channel_buttons_layout.setSpacing(2)
        self.channel_card.body_layout.addWidget(self.channel_buttons_holder)
        v.addWidget(self.channel_card)
        self._refresh_channel_selector()

        # Picking
        c = Card("Picking")
        grid = QtWidgets.QFormLayout()
        grid.setLabelAlignment(QtCore.Qt.AlignLeft)
        from mantisanalysis.usaf_groups import USAF_GROUPS, USAF_ELEMENTS
        self.group_sb = QtWidgets.QSpinBox()
        self.group_sb.setRange(min(USAF_GROUPS), max(USAF_GROUPS))
        self.group_sb.setValue(self.pick_group)
        self.group_sb.valueChanged.connect(self._on_group_changed)
        self.elt_sb = QtWidgets.QSpinBox()
        self.elt_sb.setRange(min(USAF_ELEMENTS), max(USAF_ELEMENTS))
        self.elt_sb.setValue(self.pick_element)
        self.elt_sb.valueChanged.connect(self._on_elt_changed)

        dir_widget = QtWidgets.QWidget()
        dir_layout = QtWidgets.QHBoxLayout(dir_widget)
        dir_layout.setContentsMargins(0, 0, 0, 0); dir_layout.setSpacing(8)
        self.dir_h = QtWidgets.QRadioButton("H")
        self.dir_v = QtWidgets.QRadioButton("V")
        self.dir_h.setChecked(self.pick_direction == "H")
        self.dir_v.setChecked(self.pick_direction == "V")
        dir_layout.addWidget(self.dir_h); dir_layout.addWidget(self.dir_v)
        dir_layout.addStretch(1)
        bg_dir = QtWidgets.QButtonGroup(self)
        bg_dir.addButton(self.dir_h); bg_dir.addButton(self.dir_v)
        self.dir_h.toggled.connect(self._on_dir_changed)
        self.dir_v.toggled.connect(self._on_dir_changed)

        grid.addRow("Group", self.group_sb)
        grid.addRow("Element", self.elt_sb)
        grid.addRow("Direction", dir_widget)
        c.body_layout.addLayout(grid)

        self.label_preview = QtWidgets.QLabel(self._label_preview_text())
        self.label_preview.setObjectName("MutedLabel")
        c.body_layout.addWidget(self.label_preview)

        self.cb_auto = QtWidgets.QCheckBox("Auto-increment element after pick")
        self.cb_auto.setChecked(self.auto_increment)
        self.cb_auto.toggled.connect(lambda v: setattr(self, "auto_increment", v))
        c.body_layout.addWidget(self.cb_auto)
        self.cb_seq = QtWidgets.QCheckBox(
            "Sequential mode (G+E auto)")
        self.cb_seq.setChecked(self.sequential_mode)
        self.cb_seq.toggled.connect(self._on_sequential_toggled)
        c.body_layout.addWidget(self.cb_seq)

        btn_row = QtWidgets.QHBoxLayout()
        b1 = QtWidgets.QPushButton("Reset G0 E1")
        b1.clicked.connect(self._reset_picking_label)
        b2 = QtWidgets.QPushButton("Reset zoom")
        b2.clicked.connect(self._reset_view)
        btn_row.addWidget(b1); btn_row.addWidget(b2); btn_row.addStretch(1)
        c.body_layout.addLayout(btn_row)

        # Measurement-method dropdown
        mm_row = QtWidgets.QHBoxLayout()
        mm_row.addWidget(QtWidgets.QLabel("Measurement"))
        self.method_cb = QtWidgets.QComboBox()
        for mid, lbl in MEASUREMENT_METHODS:
            self.method_cb.addItem(lbl, mid)
        for i in range(self.method_cb.count()):
            if self.method_cb.itemData(i) == self.measurement_method:
                self.method_cb.setCurrentIndex(i); break

        def _on_method_changed(i):
            self.measurement_method = str(self.method_cb.itemData(i))
            self._refresh_analysis_views()
            self._update_status(
                f"Measurement: {self.method_cb.currentText()}.")
        self.method_cb.currentIndexChanged.connect(_on_method_changed)
        mm_row.addWidget(self.method_cb, stretch=1)
        c.body_layout.addLayout(mm_row)

        v.addWidget(c)

        # Output
        c = Card("Output mode")
        out_row = QtWidgets.QHBoxLayout()
        out_row.addWidget(QtWidgets.QLabel("Channels"))
        self.output_cb = QtWidgets.QComboBox()
        for v_, lbl in OUTPUT_MODES:
            self.output_cb.addItem(lbl, v_)
        # Initialize selection
        for i in range(self.output_cb.count()):
            if self.output_cb.itemData(i) == self.output_mode:
                self.output_cb.setCurrentIndex(i); break
        self.output_cb.currentIndexChanged.connect(
            lambda i: setattr(self, "output_mode",
                              str(self.output_cb.itemData(i))))
        out_row.addStretch(1); out_row.addWidget(self.output_cb)
        c.body_layout.addLayout(out_row)

        thr_row = QtWidgets.QHBoxLayout()
        thr_row.addWidget(QtWidgets.QLabel("Detection threshold"))
        self.thr_cb = QtWidgets.QComboBox()
        for t in THRESHOLDS:
            self.thr_cb.addItem(f"{int(t*100)}%", t)
        self.thr_cb.setCurrentIndex(THRESHOLDS.index(self.threshold))
        self.thr_cb.currentIndexChanged.connect(
            lambda i: setattr(self, "threshold", float(self.thr_cb.itemData(i))))
        thr_row.addStretch(1); thr_row.addWidget(self.thr_cb)
        c.body_layout.addLayout(thr_row)

        run_btn = QtWidgets.QPushButton("Run analysis")
        run_btn.setObjectName("AccentButton")
        run_btn.clicked.connect(lambda: self.run_analysis(self.output_mode))
        c.body_layout.addWidget(run_btn)
        v.addWidget(c)

        v.addStretch(1)
        return self._scrollable(body)

    def _build_center(self) -> QtWidgets.QWidget:
        wrap = QtWidgets.QWidget()
        lay = QtWidgets.QVBoxLayout(wrap)
        lay.setContentsMargins(8, 8, 8, 4); lay.setSpacing(4)

        # Title bar
        tbar = QtWidgets.QHBoxLayout()
        self.image_title = QtWidgets.QLabel("No image loaded")
        self.image_title.setObjectName("TitleLabel")
        tbar.addWidget(self.image_title)
        tbar.addStretch(1)
        self.coord_label = QtWidgets.QLabel("")
        self.coord_label.setObjectName("MutedLabel")
        # Monospace via QFont so we don't fight the global stylesheet.
        coord_font = QtGui.QFont("Consolas")
        coord_font.setStyleHint(QtGui.QFont.Monospace)
        self.coord_label.setFont(coord_font)
        tbar.addWidget(self.coord_label)
        lay.addLayout(tbar)

        # Canvas
        self.canvas = ImageCanvas()
        self.canvas.leftClicked.connect(self._on_canvas_left)
        self.canvas.rightClicked.connect(self._on_canvas_right)
        self.canvas.cursorMoved.connect(self._on_cursor)
        self.canvas.zoomed.connect(self._on_zoom)
        lay.addWidget(self.canvas, stretch=1)

        # Toolbar
        self.nav = NavigationToolbar2QT(self.canvas, self)
        # Tie nav mode → canvas so picking is suppressed during pan/zoom drags
        self.nav.actions()  # ensure built
        # Hook update_buttons_checked to forward mode
        original_set_message = self.nav.set_message
        def patched_set_message(msg):
            original_set_message(msg)
            try:
                self.canvas.set_nav_mode(self.nav.mode)
            except Exception:
                pass
        self.nav.set_message = patched_set_message
        # Catch mode changes
        try:
            self.nav.actions()
        except Exception:
            pass
        lay.addWidget(self.nav)

        return wrap

    def _build_right_sidebar(self) -> QtWidgets.QWidget:
        body = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(body)
        v.setContentsMargins(4, 8, 8, 8); v.setSpacing(6)

        # View transform
        c = Card("View transform")
        rot_row = QtWidgets.QHBoxLayout()
        rot_row.addWidget(QtWidgets.QLabel("Rotation"))
        rot_row.addStretch(1)
        bg_rot = QtWidgets.QButtonGroup(self)
        for d in (0, 90, 180, 270):
            rb = QtWidgets.QRadioButton(f"{d}°")
            rb.setChecked(self.rotation == d)
            rb.toggled.connect(lambda chk, d=d:
                               chk and self._set_rotation(d))
            bg_rot.addButton(rb)
            rot_row.addWidget(rb)
        c.body_layout.addLayout(rot_row)
        flip_row = QtWidgets.QHBoxLayout()
        self.cb_fh = QtWidgets.QCheckBox("Flip H")
        self.cb_fh.toggled.connect(self._on_flip_h)
        self.cb_fv = QtWidgets.QCheckBox("Flip V")
        self.cb_fv.toggled.connect(self._on_flip_v)
        flip_row.addWidget(self.cb_fh); flip_row.addWidget(self.cb_fv)
        flip_row.addStretch(1)
        c.body_layout.addLayout(flip_row)
        v.addWidget(c)

        # Display
        c = Card("Display")
        slider_row(c.body_layout, "Brightness",
                   lambda: self.brightness,
                   lambda x: setattr(self, "brightness", float(x)),
                   -0.5, 0.5, 0.0, on_change=self._render)
        slider_row(c.body_layout, "Contrast",
                   lambda: self.contrast,
                   lambda x: setattr(self, "contrast", float(x)),
                   0.5, 2.5, 1.0, on_change=self._render)
        slider_row(c.body_layout, "Gamma",
                   lambda: self.gamma,
                   lambda x: setattr(self, "gamma", float(x)),
                   0.4, 2.5, 1.0, on_change=self._render)
        slider_row(c.body_layout, "Clip low %",
                   lambda: self.clip_lo,
                   lambda x: setattr(self, "clip_lo", float(x)),
                   0.0, 10.0, 1.0, decimals=1, on_change=self._render)
        slider_row(c.body_layout, "Clip high %",
                   lambda: self.clip_hi,
                   lambda x: setattr(self, "clip_hi", float(x)),
                   90.0, 100.0, 99.5, decimals=1, on_change=self._render)
        cm_row = QtWidgets.QHBoxLayout()
        cm_row.addWidget(QtWidgets.QLabel("Colormap"))
        self.cm_cb = QtWidgets.QComboBox()
        self.cm_cb.addItems(COLORMAPS)
        self.cm_cb.setCurrentText(self.colormap)
        self.cm_cb.currentTextChanged.connect(
            lambda t: (setattr(self, "colormap", t), self._render()))
        cm_row.addStretch(1); cm_row.addWidget(self.cm_cb)
        c.body_layout.addLayout(cm_row)
        v.addWidget(c)

        # Sharpen
        c = Card("Sharpen")
        sm_row = QtWidgets.QHBoxLayout()
        sm_row.addWidget(QtWidgets.QLabel("Method"))
        self.sm_cb = QtWidgets.QComboBox()
        self.sm_cb.addItems(SHARPEN_METHODS)
        self.sm_cb.setCurrentText(self.sharpen_method)
        self.sm_cb.currentTextChanged.connect(
            lambda t: (setattr(self, "sharpen_method", t),
                       self._on_sharpen_param_changed()))
        sm_row.addStretch(1); sm_row.addWidget(self.sm_cb)
        c.body_layout.addLayout(sm_row)
        slider_row(c.body_layout, "Amount",
                   lambda: self.sharpen_amount,
                   lambda x: setattr(self, "sharpen_amount", float(x)),
                   0.0, 4.0, 1.0, on_change=self._on_sharpen_param_changed)
        slider_row(c.body_layout, "Radius (px)",
                   lambda: self.sharpen_radius,
                   lambda x: setattr(self, "sharpen_radius", float(x)),
                   0.5, 20.0, 2.0, decimals=1,
                   on_change=self._on_sharpen_param_changed)
        self.cb_sharp_an = QtWidgets.QCheckBox("Apply sharpening to analysis")
        self.cb_sharp_an.setChecked(self.sharpen_to_analysis)

        def _toggle_sharp_to_analysis(v: bool) -> None:
            self.sharpen_to_analysis = bool(v)
            # Toggle ALWAYS refreshes — analysis-side image just changed.
            self._refresh_analysis_views()
            self._update_status(
                "Sharpening now affects analysis values."
                if v else
                "Analysis now uses raw (un-sharpened) image.")
        self.cb_sharp_an.toggled.connect(_toggle_sharp_to_analysis)
        c.body_layout.addWidget(self.cb_sharp_an)
        v.addWidget(c)

        # Lines
        c = Card("Picked lines")
        self.tree = QtWidgets.QTreeWidget()
        self.tree.setColumnCount(7)
        self.tree.setHeaderLabels(
            ["G", "E", "Dir", "lp/mm", "Mich.", "Mich-FFT", "s/cyc"])
        self.tree.setRootIsDecorated(False)
        self.tree.setAlternatingRowColors(True)
        self.tree.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        self.tree.setMinimumHeight(180)
        h = self.tree.header()
        h.setSectionResizeMode(QtWidgets.QHeaderView.ResizeToContents)
        self.tree.itemSelectionChanged.connect(self._on_tree_select)
        self.tree.itemDoubleClicked.connect(self._edit_selected_line)
        c.body_layout.addWidget(self.tree)
        btn_row = QtWidgets.QHBoxLayout()
        b1 = QtWidgets.QPushButton("Delete")
        b1.clicked.connect(self._delete_selected)
        b2 = QtWidgets.QPushButton("Clear all")
        b2.clicked.connect(self._delete_all)
        btn_row.addWidget(b1); btn_row.addWidget(b2); btn_row.addStretch(1)
        c.body_layout.addLayout(btn_row)
        v.addWidget(c)

        # Profile preview
        c = Card("Profile preview")
        self.preview_fig = Figure(figsize=(3.4, 1.6))
        self.preview_ax = self.preview_fig.add_subplot(111)
        self.preview_ax.set_xticks([]); self.preview_ax.set_yticks([])
        self.preview_canvas = FigureCanvasQTAgg(self.preview_fig)
        self.preview_canvas.setMinimumHeight(140)
        c.body_layout.addWidget(self.preview_canvas)
        self.contrast_text = QtWidgets.QLabel(
            "Pick a line to see its Michelson contrast.")
        self.contrast_text.setObjectName("MutedLabel")
        ct_font = QtGui.QFont("Consolas")
        ct_font.setStyleHint(QtGui.QFont.Monospace)
        self.contrast_text.setFont(ct_font)
        c.body_layout.addWidget(self.contrast_text)
        v.addWidget(c)

        v.addStretch(1)
        return self._scrollable(body)

    # ---- File I/O --------------------------------------------------------

    def menu_open(self) -> None:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Open H5 recording or image", "",
            "All supported (*.h5 *.hdf5 *.png *.tif *.tiff *.jpg *.jpeg *.bmp);;"
            "HDF5 (*.h5 *.hdf5);;"
            "Images (*.png *.tif *.tiff *.jpg *.jpeg *.bmp);;"
            "All files (*)")
        if path:
            self._do_open(Path(path))

    def _do_open(self, path: Path) -> None:
        try:
            channels, attrs, kind = load_any(path)
        except Exception as exc:
            QtWidgets.QMessageBox.critical(self, "Failed to open",
                                           f"{path}\n\n{exc}")
            return
        self.channel_images = channels
        self.channel_names = list(channels.keys())
        self.attrs = attrs
        self.source_path = path
        self.source_kind = kind
        self.lines = []
        self.tmp_pts = []
        self._refresh_channel_selector()
        for guess in ("LG-G", "G", "LG-Y", "Y", "L"):
            if guess in self.channel_images:
                self._switch_channel(guess)
                break
        else:
            first = next(iter(self.channel_names), None)
            if first:
                self._switch_channel(first)
        self.source_label.setText(str(path.name))
        self._refresh_lines_panel()
        self._update_status(
            f"Loaded {kind.upper()}: {path.name}  ({len(self.channel_images)} channels)")

    def menu_save_lines(self) -> None:
        if not self.lines:
            QtWidgets.QMessageBox.information(self, "No lines",
                                              "No lines drawn yet.")
            return
        default = "lines.json"
        if self.source_path is not None:
            default = f"lines_{self.source_path.stem}.json"
        path, _ = QtWidgets.QFileDialog.getSaveFileName(
            self, "Save lines JSON", str(ROOT / "outputs" / default),
            "JSON (*.json)")
        if not path:
            return
        self._save_lines_to(Path(path))

    def _save_lines_to(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source_path": str(self.source_path) if self.source_path else None,
            "source_kind": self.source_kind,
            "reference_channel": self.current_channel,
            "transform": {"rotation": self.rotation,
                          "flip_h": self.flip_h, "flip_v": self.flip_v},
            "lines": [
                {"group": ln.group, "element": ln.element,
                 "direction": ln.direction,
                 "p0": list(ln.p0), "p1": list(ln.p1)}
                for ln in self.lines
            ],
        }
        with open(path, "w") as f:
            json.dump(payload, f, indent=2)
        self._lines_path = path
        self._update_status(f"Saved {len(self.lines)} lines → {path.name}")

    def menu_load_lines(self) -> None:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            self, "Load lines JSON", str(ROOT / "outputs"), "JSON (*.json)")
        if not path:
            return
        try:
            with open(path) as f:
                data = json.load(f)
            self.lines = [
                LineSpec(group=int(d["group"]), element=int(d["element"]),
                         direction=str(d["direction"]).upper(),
                         p0=tuple(d["p0"]), p1=tuple(d["p1"]))
                for d in data.get("lines", [])
            ]
            tr = data.get("transform", {})
            if tr:
                self._set_rotation(int(tr.get("rotation", 0)))
                self.cb_fh.setChecked(bool(tr.get("flip_h", False)))
                self.cb_fv.setChecked(bool(tr.get("flip_v", False)))
            self._refresh_lines_panel()
            self._render()
            self._update_status(
                f"Loaded {len(self.lines)} lines from {Path(path).name}")
        except Exception as exc:
            QtWidgets.QMessageBox.critical(self, "Load failed",
                                           f"{path}\n\n{exc}")

    # ---- Channel selector ------------------------------------------------

    def _refresh_channel_selector(self) -> None:
        # Clear (only buttons belong to the button group; the placeholder
        # label is just laid out)
        while self.channel_buttons_layout.count():
            item = self.channel_buttons_layout.takeAt(0)
            w = item.widget()
            if w is None:
                continue
            if isinstance(w, QtWidgets.QAbstractButton):
                self.channel_button_group.removeButton(w)
            w.deleteLater()
        if not self.channel_names:
            lbl = QtWidgets.QLabel("(no channels)")
            lbl.setObjectName("MutedLabel")
            self.channel_buttons_layout.addWidget(lbl)
            return
        for name in self.channel_names:
            rb = QtWidgets.QRadioButton(name)
            self.channel_button_group.addButton(rb)
            rb.toggled.connect(
                lambda chk, n=name: chk and self._switch_channel(n))
            self.channel_buttons_layout.addWidget(rb)
            if name == self.current_channel:
                rb.setChecked(True)

    def _switch_channel(self, name: str) -> None:
        self.current_channel = name
        self.image_title.setText(name)
        # mark the right button
        for btn in self.channel_button_group.buttons():
            if btn.text() == name and not btn.isChecked():
                btn.blockSignals(True); btn.setChecked(True); btn.blockSignals(False)
        self._render()
        self._refresh_lines_panel()  # michelson values depend on current image

    # ---- Transform ------------------------------------------------------

    def _set_rotation(self, deg: int) -> None:
        self.rotation = int(deg) % 360
        self._render()

    def _on_flip_h(self, v: bool) -> None:
        self.flip_h = bool(v); self._render()

    def _on_flip_v(self, v: bool) -> None:
        self.flip_v = bool(v); self._render()

    def _set_theme(self, name: str) -> None:
        if name not in THEMES:
            return
        self.theme_name = name
        self.theme = THEMES[name]
        app = QtWidgets.QApplication.instance()
        if app is not None:
            apply_theme(app, name)
        # Re-style matplotlib elements to match the new theme
        self._render()
        # Refresh preview (needs a profile to redraw — only restyle face)
        self.preview_fig.set_facecolor(self.theme["FIG_FACE"])
        self.preview_ax.set_facecolor(self.theme["FIG_FACE"])
        self.preview_canvas.draw_idle()
        # Reflect selection state in the menu
        if name in self._theme_actions:
            self._theme_actions[name].setChecked(True)
        self._update_status(f"Theme: {name}.")

    def _reset_display(self) -> None:
        self.brightness = 0.0; self.contrast = 1.0; self.gamma = 1.0
        self.clip_lo = 1.0; self.clip_hi = 99.5; self.colormap = "gray"
        # Easiest: rebuild right sidebar — but spinboxes need re-sync
        # Just set the cm + render (sliders won't auto-reset; we leave
        # them — the values still reflect)
        self.cm_cb.setCurrentText(self.colormap)
        self._render()

    def _reset_sharpen(self) -> None:
        self.sharpen_method = "None"
        self.sm_cb.setCurrentText(self.sharpen_method)
        self.sharpen_amount = 1.0; self.sharpen_radius = 2.0
        self.sharpen_to_analysis = False
        self.cb_sharp_an.setChecked(False)
        self._render()

    # ---- Display pipeline -----------------------------------------------

    def _current_image(self) -> Optional[np.ndarray]:
        if self.current_channel is None:
            return None
        raw = self.channel_images.get(self.current_channel)
        if raw is None:
            return None
        return apply_transform(raw, rotation=self.rotation,
                               flip_h=self.flip_h, flip_v=self.flip_v)

    def _analysis_image(self, raw: np.ndarray) -> np.ndarray:
        t = apply_transform(raw, rotation=self.rotation,
                            flip_h=self.flip_h, flip_v=self.flip_v)
        return maybe_apply_to_analysis(
            t, apply_sharpen_to_analysis=self.sharpen_to_analysis,
            sharpen_method=self.sharpen_method,
            sharpen_amount=self.sharpen_amount,
            sharpen_radius=self.sharpen_radius)

    def _refresh_analysis_views(self) -> None:
        """Recompute everything that depends on the analysis-side image
        (Michelson column in the lines table + the profile preview)."""
        self._refresh_lines_panel()
        if self._last_preview_pts is not None:
            self._update_profile_preview(*self._last_preview_pts)

    def _on_sharpen_param_changed(self) -> None:
        """Slider/method/radius changed — always re-render display, and
        also refresh analysis views if sharpen-to-analysis is on."""
        self._render()
        if self.sharpen_to_analysis:
            self._refresh_analysis_views()

    def _measurement_image(self, name: Optional[str] = None) -> Optional[np.ndarray]:
        """Image used by the inline preview + lines-table Michelson cell.

        When 'Apply sharpening to analysis' is OFF this is just the
        rotated/flipped raw channel; when ON it is the same image plus
        whatever Sharpen-panel filter is selected — so the numbers shown
        in the GUI exactly match what the analysis tabs will compute.
        """
        name = name or self.current_channel
        if name is None:
            return None
        raw = self.channel_images.get(name)
        if raw is None:
            return None
        return self._analysis_image(raw)

    def _render(self) -> None:
        t = self.theme
        img = self._current_image()
        ax = self.canvas.ax
        # Sync figure facecolor with theme each draw — cheap and bulletproof.
        self.canvas.fig.set_facecolor(t["FIG_FACE"])
        keep_view = (self._last_rendered_channel == self.current_channel
                     and img is not None)
        if keep_view and ax.has_data():
            try:
                self._saved_xlim = ax.get_xlim()
                self._saved_ylim = ax.get_ylim()
            except Exception:
                keep_view = False
        ax.clear(); ax.set_facecolor(t["AXES_FACE"])
        if img is None:
            ax.text(0.5, 0.5,
                    "Open a file (Ctrl+O), then click two points\n"
                    "across one USAF element's bars to draw a line.\n\n"
                    "Scroll wheel = zoom around cursor.\n"
                    "Right-click on a line = delete.",
                    transform=ax.transAxes, color=t["EMPTY_INK"],
                    ha="center", va="center", fontsize=11)
            ax.set_xticks([]); ax.set_yticks([])
            self.canvas.draw_idle()
            self._last_rendered_channel = None
            return
        try:
            disp, vmin, vmax = prepare_display(
                img,
                sharpen_method=self.sharpen_method,
                sharpen_amount=self.sharpen_amount,
                sharpen_radius=self.sharpen_radius,
                brightness=self.brightness, contrast=self.contrast,
                gamma=self.gamma,
                clip_lo_pct=self.clip_lo, clip_hi_pct=self.clip_hi)
        except Exception:
            disp, vmin, vmax = (img.astype(np.float64),
                                float(img.min()), float(img.max()))
        ax.imshow(disp, cmap=self.colormap, vmin=vmin, vmax=vmax,
                  interpolation="nearest")
        ax.set_xticks([]); ax.set_yticks([])

        sel_iid = self._selected_index()
        for i, ln in enumerate(self.lines):
            color = ELEMENT_COLORS.get(ln.element, t["ACCENT_RED"])
            highlighted = (sel_iid == i)
            if highlighted:
                ax.plot([ln.p0[0], ln.p1[0]], [ln.p0[1], ln.p1[1]],
                        color="#ffd54f", linewidth=5.5, alpha=0.65,
                        solid_capstyle="round", zorder=3)
            ax.plot([ln.p0[0], ln.p1[0]], [ln.p0[1], ln.p1[1]],
                    color=color, linewidth=2.6 if highlighted else 1.4,
                    alpha=0.95, solid_capstyle="round", zorder=4)
            mx = 0.5 * (ln.p0[0] + ln.p1[0])
            my = 0.5 * (ln.p0[1] + ln.p1[1])
            ax.text(mx, my, f"G{ln.group}E{ln.element}{ln.direction}",
                    color="#ffffff", fontsize=8, ha="center", va="center",
                    zorder=5,
                    bbox=dict(facecolor=color, alpha=0.85,
                              edgecolor=("#ffd54f" if highlighted else "none"),
                              linewidth=(1.0 if highlighted else 0),
                              boxstyle="round,pad=0.25"))
        for x, y in self.tmp_pts:
            ax.plot(x, y, marker="+", color=t["ACCENT_RED"], markersize=12,
                    markeredgewidth=1.6, zorder=6)

        if keep_view and self._saved_xlim is not None:
            try:
                ax.set_xlim(self._saved_xlim)
                ax.set_ylim(self._saved_ylim)
            except Exception:
                pass
        else:
            self._saved_xlim = ax.get_xlim()
            self._saved_ylim = ax.get_ylim()
        self._last_rendered_channel = self.current_channel
        self.canvas.draw_idle()

    # ---- Canvas mouse handlers ------------------------------------------

    def _on_canvas_left(self, x: float, y: float) -> None:
        if self.current_channel is None:
            self._update_status("Open a file first.")
            return
        self.tmp_pts.append((float(x), float(y)))
        if len(self.tmp_pts) == 1:
            self._update_status(
                f"Point 1 at ({x:.0f}, {y:.0f}). Click second point to commit "
                f"G{self.pick_group} E{self.pick_element} {self.pick_direction}.")
        elif len(self.tmp_pts) == 2:
            p0, p1 = self.tmp_pts
            self.tmp_pts = []
            self._commit_line(p0, p1)
        self._render()

    def _on_canvas_right(self, x: float, y: float) -> None:
        self._delete_nearest((x, y))

    def _on_cursor(self, x, y) -> None:
        if x is None:
            self.coord_label.setText("")
            return
        img = self._current_image()
        if img is None:
            self.coord_label.setText(f"x={int(x)}  y={int(y)}")
            return
        ix = int(round(x)); iy = int(round(y))
        if 0 <= ix < img.shape[1] and 0 <= iy < img.shape[0]:
            self.coord_label.setText(
                f"x={ix}  y={iy}  v={int(img[iy, ix])}")
        else:
            self.coord_label.setText(f"x={ix}  y={iy}")

    def _on_zoom(self) -> None:
        try:
            self._saved_xlim = self.canvas.ax.get_xlim()
            self._saved_ylim = self.canvas.ax.get_ylim()
        except Exception:
            pass

    # ---- Picking logic --------------------------------------------------

    def _on_group_changed(self, v: int) -> None:
        self.pick_group = int(v)
        self.label_preview.setText(self._label_preview_text())

    def _on_elt_changed(self, v: int) -> None:
        self.pick_element = int(v)
        self.label_preview.setText(self._label_preview_text())

    def _on_dir_changed(self) -> None:
        self.pick_direction = "H" if self.dir_h.isChecked() else "V"
        self.label_preview.setText(self._label_preview_text())

    def _label_preview_text(self) -> str:
        try:
            return (f"Next: G{self.pick_group} E{self.pick_element} "
                    f"{self.pick_direction}  "
                    f"({lp_mm(self.pick_group, self.pick_element):.2f} lp/mm)")
        except Exception:
            return "Next: —"

    def _on_sequential_toggled(self, v: bool) -> None:
        self.sequential_mode = bool(v)
        if v:
            self.cb_auto.setChecked(True)
            self.auto_increment = True
            self._update_status(
                f"Sequential mode: direction {self.pick_direction}; "
                f"now picking G{self.pick_group} E{self.pick_element}.")

    def _advance_sequential(self) -> bool:
        from mantisanalysis.usaf_groups import USAF_GROUPS, USAF_ELEMENTS
        if self.pick_element < max(USAF_ELEMENTS):
            self.elt_sb.setValue(self.pick_element + 1)
            return True
        if self.pick_group < max(USAF_GROUPS):
            self.group_sb.setValue(self.pick_group + 1)
            self.elt_sb.setValue(min(USAF_ELEMENTS))
            return True
        return False

    def _commit_line(self, p0, p1) -> None:
        spec = LineSpec(group=self.pick_group, element=self.pick_element,
                        direction=self.pick_direction, p0=p0, p1=p1)
        self.lines.append(spec)
        self._refresh_lines_panel()
        self._update_profile_preview(p0, p1)
        base = (f"Saved G{spec.group}E{spec.element}{spec.direction}  "
                f"(@ {lp_mm(spec.group, spec.element):.2f} lp/mm) — "
                f"{len(self.lines)} total.")
        if self.sequential_mode:
            ok = self._advance_sequential()
            if ok:
                self._update_status(
                    f"{base}  Sequential next: G{self.pick_group} "
                    f"E{self.pick_element}.")
            else:
                from mantisanalysis.usaf_groups import USAF_GROUPS, USAF_ELEMENTS
                total = len(USAF_GROUPS) * len(USAF_ELEMENTS)
                self.cb_seq.setChecked(False)
                self._update_status(
                    f"{base}  Sequential mode complete ({total} elements).")
        elif self.auto_increment:
            if self.pick_element < 6:
                self.elt_sb.setValue(self.pick_element + 1)
                self._update_status(base)
            else:
                self.elt_sb.setValue(1)
                self._update_status(f"{base}  Element reset to 1 (wrapped).")
        else:
            self._update_status(base)

    # ---- Lines table handlers -------------------------------------------

    def _refresh_lines_panel(self) -> None:
        self.tree.blockSignals(True)
        self.tree.clear()
        # Use the analysis-side image so the Michelson columns match
        # what the analysis tabs report (respects sharpen-to-analysis).
        img = self._measurement_image()
        from mantisanalysis.usaf_groups import (
            measure_line as _ml,
            LineSpec as _LS,
        )
        for ln in self.lines:
            mod_str = "—"; mod_fft_str = "—"; spc_str = "—"
            reliability = "ok"
            if img is not None:
                try:
                    lm = _ml(img, ln, method=self.measurement_method)
                    mod_str = f"{lm.modulation:.3f}"
                    mod_fft_str = f"{lm.modulation_fft:.3f}"
                    spc_str = f"{lm.samples_per_cycle:.1f}"
                    reliability = lm.reliability
                except Exception:
                    pass
            it = QtWidgets.QTreeWidgetItem([
                str(ln.group), str(ln.element), ln.direction,
                f"{lp_mm(ln.group, ln.element):.2f}",
                mod_str, mod_fft_str, spc_str])
            for col in range(7):
                it.setTextAlignment(col, QtCore.Qt.AlignCenter)
            # Color-code the s/cyc cell by reliability
            from PySide6.QtGui import QBrush, QColor
            if reliability == "unreliable":
                it.setForeground(6, QBrush(QColor("#cf222e")))  # red
                it.setToolTip(6, "< 3 samples per bar cycle — Nyquist "
                                  "violated; the measured contrast is "
                                  "dominated by aliasing.")
            elif reliability == "marginal":
                it.setForeground(6, QBrush(QColor("#bf8700")))  # orange
                it.setToolTip(6, "3–5 samples per cycle — at the edge "
                                  "of reliable measurement.")
            else:
                it.setForeground(6, QBrush(QColor("#1a7f37")))  # green
            self.tree.addTopLevelItem(it)
        self.tree.blockSignals(False)

    def _selected_index(self) -> Optional[int]:
        items = self.tree.selectedItems()
        if not items:
            return None
        return self.tree.indexOfTopLevelItem(items[0])

    def _on_tree_select(self) -> None:
        idx = self._selected_index()
        if idx is None or not (0 <= idx < len(self.lines)):
            return
        ln = self.lines[idx]
        self._update_profile_preview(ln.p0, ln.p1)
        self._render()

    def _delete_selected(self) -> None:
        idx = self._selected_index()
        if idx is None:
            return
        del self.lines[idx]
        self._refresh_lines_panel()
        self._render()

    def _delete_all(self) -> None:
        if not self.lines:
            return
        ret = QtWidgets.QMessageBox.question(
            self, "Delete all", f"Remove all {len(self.lines)} lines?",
            QtWidgets.QMessageBox.Yes | QtWidgets.QMessageBox.No)
        if ret != QtWidgets.QMessageBox.Yes:
            return
        self.lines = []
        self._refresh_lines_panel()
        self._render()

    def _delete_nearest(self, p, max_dist: float = 18.0) -> None:
        if not self.lines:
            return
        dists = [line_distance(p, ln.p0, ln.p1) for ln in self.lines]
        idx = int(np.argmin(dists))
        if dists[idx] > max_dist:
            return
        ln = self.lines.pop(idx)
        self._refresh_lines_panel()
        self._render()
        self._update_status(
            f"Deleted G{ln.group}E{ln.element}{ln.direction} (right-click).")

    def _edit_selected_line(self, *_) -> None:
        idx = self._selected_index()
        if idx is None or not (0 <= idx < len(self.lines)):
            return
        ln = self.lines[idx]
        dlg = EditLineDialog(ln, self)
        if dlg.exec() == QtWidgets.QDialog.Accepted:
            self.lines[idx] = dlg.result_spec(ln)
            self._refresh_lines_panel()
            self.tree.setCurrentItem(self.tree.topLevelItem(idx))
            self._render()
            new = self.lines[idx]
            self._update_status(
                f"Updated line #{idx + 1} → G{new.group}E{new.element}"
                f"{new.direction} ({lp_mm(new.group, new.element):.2f} lp/mm).")

    # ---- Profile preview -------------------------------------------------

    def _update_profile_preview(self, p0, p1) -> None:
        # Use the analysis-side image so the displayed Michelson value
        # matches the analysis tabs (respects sharpen-to-analysis).
        img = self._measurement_image()
        if img is None:
            return
        # Remember the last previewed line so toggles can refresh it.
        self._last_preview_pts = (tuple(p0), tuple(p1))
        # Use the spec-aware measure_line so the FFT estimator + s/cyc
        # are computed once.
        from mantisanalysis.usaf_groups import measure_line as _ml
        from mantisanalysis.usaf_groups import measure_modulation_fft as _mfft
        try:
            profile = extract_line_profile(img, p0, p1, swath_width=8.0)
        except ValueError as exc:
            self.contrast_text.setText(f"Profile error: {exc}")
            return
        mod_p, lo, hi = measure_modulation(profile, method="percentile")
        mod_mm, _, _ = measure_modulation(profile, method="minmax")
        t = self.theme
        ax = self.preview_ax
        self.preview_fig.set_facecolor(t["FIG_FACE"])
        ax.clear()
        ax.set_facecolor(t["FIG_FACE"])
        ax.plot(profile, color=t["ACCENT"], linewidth=1.4)
        ax.axhline(lo, color=t["TEXT_MUTED"], linestyle=":", linewidth=0.8)
        ax.axhline(hi, color=t["TEXT_MUTED"], linestyle=":", linewidth=0.8)
        ax.set_xticks([]); ax.set_yticks([])
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        for sp in ("bottom", "left"):
            ax.spines[sp].set_color(t["BORDER"])
        # FFT estimate + samples-per-cycle quality flag.
        mod_fft, f_exp, f_peak = _mfft(profile, n_cycles_expected=2.5)
        n = len(profile)
        spc = n / 2.5  # 3 bars + 2 gaps = 2.5 cycles across the line
        if spc < 3.0:
            quality = "  ⚠ < 3 samples/cycle: BELOW NYQUIST — values not trustworthy"
        elif spc < 5.0:
            quality = "  ⚠ marginal sampling (3–5 samples/cycle); prefer FFT value"
        else:
            quality = ""
        self.preview_canvas.draw_idle()
        L_px = int(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
        self.contrast_text.setText(
            f"L = {L_px} px,  N = {n} samples,  s/cyc = {spc:.1f}{quality}\n"
            f"Michelson (P10/P90)         = {mod_p:.3f}\n"
            f"Michelson (min/max)          = {mod_mm:.3f}\n"
            f"Michelson (FFT @ fundamental) = {mod_fft:.3f}")

    # ---- Misc helpers ----------------------------------------------------

    def _update_status(self, msg: str) -> None:
        n = len(self.lines)
        suffix = f"     {n} line{'s' if n != 1 else ''} picked"
        self.statusBar().showMessage(msg + suffix)

    def _reset_picking_label(self) -> None:
        self.group_sb.setValue(0)
        self.elt_sb.setValue(1)

    def _reset_view(self) -> None:
        img = self._current_image()
        if img is None:
            return
        ax = self.canvas.ax
        ax.set_xlim(0, img.shape[1])
        ax.set_ylim(img.shape[0], 0)
        self._saved_xlim = ax.get_xlim()
        self._saved_ylim = ax.get_ylim()
        self.canvas.draw_idle()

    def _cancel_tmp(self) -> None:
        if self.tmp_pts:
            self.tmp_pts = []
            self._update_status("First point cleared.")
            self._render()

    def _undo_last(self) -> None:
        if self.tmp_pts:
            self._cancel_tmp()
            return
        if self.lines:
            ln = self.lines.pop()
            self._refresh_lines_panel()
            self._render()
            self._update_status(
                f"Undid G{ln.group}E{ln.element}{ln.direction}.")

    def _key_element_up(self) -> None:
        from mantisanalysis.usaf_groups import USAF_ELEMENTS
        if self.pick_element < max(USAF_ELEMENTS):
            self.elt_sb.setValue(self.pick_element + 1)

    def _key_element_down(self) -> None:
        from mantisanalysis.usaf_groups import USAF_ELEMENTS
        if self.pick_element > min(USAF_ELEMENTS):
            self.elt_sb.setValue(self.pick_element - 1)

    def _key_group_up(self) -> None:
        from mantisanalysis.usaf_groups import USAF_GROUPS
        if self.pick_group < max(USAF_GROUPS):
            self.group_sb.setValue(self.pick_group + 1)

    def _key_group_down(self) -> None:
        from mantisanalysis.usaf_groups import USAF_GROUPS
        if self.pick_group > min(USAF_GROUPS):
            self.group_sb.setValue(self.pick_group - 1)

    # ---- Help -----------------------------------------------------------

    def show_help(self) -> None:
        msg = (
            "WORKFLOW\n"
            "  1. File → Open: load an H5 GSense recording or an image.\n"
            "  2. Pick a channel from the left sidebar.\n"
            "  3. In the Picking card, set Group, Element, Direction.\n"
            "  4. Left-click two points across the 3 bars of that USAF\n"
            "     element. The line is auto-labeled. Auto-increment\n"
            "     advances the element after each pick. Sequential mode\n"
            "     advances both group + element through all 36 elements\n"
            "     (groups 0–5 × elements 1–6).\n"
            "  5. Right-click on a line to delete it.\n"
            "  6. Run analysis → tabbed window with figures.\n\n"
            "DISPLAY / SHARPEN\n"
            "  Brightness / Contrast / Gamma / clip percentiles +\n"
            "  Unsharp / Laplacian / High-pass help you SEE the bars.\n"
            "  Sharpening is display-only unless 'Apply sharpening to\n"
            "  analysis' is ticked.\n\n"
            "KEYBOARD\n"
            "  Ctrl+O   Open file\n"
            "  Ctrl+S   Save lines JSON\n"
            "  Ctrl+Z   Undo last line / clear first point\n"
            "  Esc      Cancel first point\n"
            "  Delete   Remove selected line\n"
            "  ←  →     Group  -1 / +1\n"
            "  ↑  ↓     Element +1 / -1")
        QtWidgets.QMessageBox.information(self, "How to use", msg)

    # ---- Analysis launcher ----------------------------------------------

    def run_analysis(self, mode: str) -> None:
        if not self.channel_images:
            QtWidgets.QMessageBox.information(self, "No data",
                                              "Open a file first.")
            return
        if not self.lines:
            QtWidgets.QMessageBox.information(self, "No lines",
                                              "Draw at least one line first.")
            return
        try:
            from mantisanalysis.usaf_render import open_analysis_window
            open_analysis_window(parent=self, app_state=self,
                                 mode=mode, threshold=self.threshold)
        except Exception as exc:
            traceback.print_exc()
            QtWidgets.QMessageBox.critical(self, "Analysis failed", str(exc))


def _check_environment() -> Optional[str]:
    missing = []
    for mod, hint in (("h5py", "pip install h5py"),
                      ("numpy", "pip install numpy"),
                      ("scipy", "pip install scipy"),
                      ("matplotlib", "pip install matplotlib"),
                      ("PIL", "pip install Pillow"),
                      ("PySide6", "pip install PySide6")):
        try:
            __import__(mod)
        except ImportError:
            missing.append(f"  - {mod}  ({hint})")
    if missing:
        return ("Required Python packages are missing:\n"
                + "\n".join(missing)
                + "\n\nInstall everything with:\n"
                "    python -m pip install -r requirements.txt")
    return None


# =========================================================================
# Multi-mode container window (USAF / FPN / DoF)
# =========================================================================

class MainWindow(QtWidgets.QMainWindow):
    """RGB-NIR Analysis Suite — top-level multi-mode window.

    The USAF mode is the existing USAFPickerApp's body; we keep the
    USAFPickerApp instance alive as a hidden QMainWindow and embed its
    central widget here. The new FPN and DoF modes are pure QWidget
    subclasses that read shared file state via `self.channel_images`.
    """

    MODES = ("USAF Resolution", "FPN Analysis", "Depth of Field")

    def __init__(self, *, theme_name: str = "light",
                 initial_path: Optional[Path] = None):
        super().__init__()
        self.setWindowTitle("RGB-NIR Analysis Suite")
        self.resize(1280, 800)
        self.setMinimumSize(960, 640)

        self.theme_name = theme_name if theme_name in THEMES else "light"
        self.theme = THEMES[self.theme_name]

        # Shared file state — every mode reads from these.
        self.channel_images: Dict[str, np.ndarray] = {}
        self.attrs: Dict[str, str] = {}
        self.source_path: Optional[Path] = None

        # ---- USAF: keep the existing app, embed its central widget ----
        self.usaf_app = USAFPickerApp(theme_name=self.theme_name)
        usaf_central = self.usaf_app.takeCentralWidget()

        # Forward USAF's status updates into THIS window's status bar.
        def _usaf_status(msg: str) -> None:
            n = len(self.usaf_app.lines)
            suffix = f"     {n} line{'s' if n != 1 else ''} picked"
            self.statusBar().showMessage(f"[USAF] {msg}{suffix}")
        self.usaf_app._update_status = _usaf_status

        # Wrap USAF file loading so FPN + DoF get notified too.
        _orig_do_open = self.usaf_app._do_open

        def _do_open(path: Path) -> None:
            _orig_do_open(path)
            self.channel_images = self.usaf_app.channel_images
            self.attrs = self.usaf_app.attrs
            self.source_path = self.usaf_app.source_path
            for m in (self.fpn_mode, self.dof_mode):
                m.on_file_loaded()
        self.usaf_app._do_open = _do_open

        # ---- Build FPN + DoF modes ----
        from mantisanalysis.modes.fpn import FPNMode
        from mantisanalysis.modes.dof import DoFMode

        self.fpn_mode = FPNMode(self, theme_provider=lambda: self.theme)
        self.dof_mode = DoFMode(self, theme_provider=lambda: self.theme)

        # ---- Stacked widget for the three modes ----
        self.stack = QtWidgets.QStackedWidget()
        self.stack.addWidget(usaf_central)
        self.stack.addWidget(self.fpn_mode)
        self.stack.addWidget(self.dof_mode)
        self.setCentralWidget(self.stack)

        # ---- Mode toolbar ----
        self._build_mode_toolbar()

        # ---- Menu (file menu drives shared file load; reuse USAF menus) --
        self._build_menu()

        # Open initial file if given
        if initial_path is not None:
            self.usaf_app._do_open(initial_path)

        self.statusBar().showMessage("Ready.  Mode: USAF Resolution")

    def _build_mode_toolbar(self) -> None:
        tb = QtWidgets.QToolBar("Mode")
        tb.setMovable(False)
        tb.setIconSize(QtCore.QSize(18, 18))
        tb.setToolButtonStyle(QtCore.Qt.ToolButtonTextOnly)
        self.addToolBar(QtCore.Qt.TopToolBarArea, tb)
        ag = QtGui.QActionGroup(self)
        ag.setExclusive(True)
        for i, label in enumerate(self.MODES):
            act = QtGui.QAction(label, self, checkable=True)
            if i == 0:
                act.setChecked(True)
            act.triggered.connect(lambda _=False, i=i: self._switch_mode(i))
            ag.addAction(act)
            tb.addAction(act)

    def _switch_mode(self, index: int) -> None:
        self.stack.setCurrentIndex(index)
        self.statusBar().showMessage(f"Mode: {self.MODES[index]}")
        # Notify mode it became visible — repaint with current theme
        widget = self.stack.currentWidget()
        if hasattr(widget, "on_theme_changed"):
            widget.on_theme_changed()

    def _build_menu(self) -> None:
        # File: shared open + save lines (USAF) + load lines (USAF)
        mb = self.menuBar()
        m_file = mb.addMenu("&File")
        a_open = m_file.addAction("Open H5 / Image…")
        a_open.setShortcut("Ctrl+O")
        a_open.triggered.connect(self.usaf_app.menu_open)
        m_file.addSeparator()
        # USAF-specific lines management:
        a_save = m_file.addAction("Save USAF lines as JSON…")
        a_save.setShortcut("Ctrl+S")
        a_save.triggered.connect(self.usaf_app.menu_save_lines)
        a_load = m_file.addAction("Load USAF lines from JSON…")
        a_load.triggered.connect(self.usaf_app.menu_load_lines)
        m_file.addSeparator()
        a_q = m_file.addAction("Quit")
        a_q.setShortcut("Ctrl+Q")
        a_q.triggered.connect(self.close)

        # View — theme toggle (applies app-wide)
        m_view = mb.addMenu("&View")
        m_theme = m_view.addMenu("Theme")
        ag = QtGui.QActionGroup(self)
        ag.setExclusive(True)
        for name in ("light", "dark"):
            a = QtGui.QAction(name.capitalize(), self, checkable=True)
            a.setChecked(name == self.theme_name)
            a.triggered.connect(lambda _=False, n=name: self._set_theme(n))
            ag.addAction(a)
            m_theme.addAction(a)

        # Mode menu (mirrors the toolbar)
        m_mode = mb.addMenu("&Mode")
        for i, label in enumerate(self.MODES):
            a = m_mode.addAction(label)
            a.triggered.connect(lambda _=False, i=i: self._switch_mode(i))

        # Help
        m_help = mb.addMenu("&Help")
        m_help.addAction("USAF — How to use",
                         lambda: self.usaf_app.show_help())
        m_help.addAction("About",
                         lambda: QtWidgets.QMessageBox.information(
                             self, "RGB-NIR Suite",
                             "RGB-NIR Analysis Suite\n"
                             "Modes: USAF Resolution · FPN · Depth of Field"))

    def _set_theme(self, name: str) -> None:
        if name not in THEMES:
            return
        self.theme_name = name
        self.theme = THEMES[name]
        # Propagate to the inner USAF app + the QApplication
        self.usaf_app.theme_name = name
        self.usaf_app.theme = THEMES[name]
        app = QtWidgets.QApplication.instance()
        if app is not None:
            apply_theme(app, name)
        self.usaf_app._render()
        self.fpn_mode.on_theme_changed()
        self.dof_mode.on_theme_changed()


def main(argv: list[str]) -> int:
    err = _check_environment()
    if err:
        print(err, file=sys.stderr)
        return 2
    app = QtWidgets.QApplication(argv)
    app.setStyle("Fusion")
    theme_name = "light"
    cleaned = []
    for a in argv[1:]:
        if a in ("--dark", "--theme=dark"):
            theme_name = "dark"
        elif a in ("--light", "--theme=light"):
            theme_name = "light"
        else:
            cleaned.append(a)
    apply_theme(app, theme_name)
    initial = None
    if cleaned:
        cand = Path(cleaned[0])
        if cand.exists():
            initial = cand
        else:
            print(f"warning: path not found, ignoring: {cand}", file=sys.stderr)
    win = MainWindow(theme_name=theme_name, initial_path=initial)
    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
