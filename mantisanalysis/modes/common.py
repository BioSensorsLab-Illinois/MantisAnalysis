"""Shared GUI building blocks used by all analysis modes."""

from __future__ import annotations

from typing import Callable, Optional, Tuple

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets

from matplotlib.backends.backend_qtagg import (
    FigureCanvasQTAgg,
    NavigationToolbar2QT,
)
from matplotlib.figure import Figure


# ---------------------------------------------------------------------------
# Card frame (a styled QFrame with a title and a body layout)

class Card(QtWidgets.QFrame):
    def __init__(self, title: str, parent=None):
        super().__init__(parent)
        self.setObjectName("Card")
        self.setFrameShape(QtWidgets.QFrame.NoFrame)
        layout = QtWidgets.QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 12)
        layout.setSpacing(8)
        title_lbl = QtWidgets.QLabel(title.upper())
        title_lbl.setObjectName("CardTitle")
        layout.addWidget(title_lbl)
        self.body = QtWidgets.QWidget()
        self.body_layout = QtWidgets.QVBoxLayout(self.body)
        self.body_layout.setContentsMargins(0, 0, 0, 0)
        self.body_layout.setSpacing(6)
        layout.addWidget(self.body)


# ---------------------------------------------------------------------------
# Slider+Spinbox row helper

def slider_row(parent_layout, label: str,
               getter: Callable[[], float],
               setter: Callable[[float], None],
               low: float, high: float, default: float,
               *, decimals: int = 2, step: Optional[float] = None,
               on_change: Optional[Callable[[], None]] = None
               ) -> QtWidgets.QDoubleSpinBox:
    row = QtWidgets.QHBoxLayout()
    row.setSpacing(8)
    lbl = QtWidgets.QLabel(label)
    lbl.setMinimumWidth(96)
    row.addWidget(lbl)
    sl = QtWidgets.QSlider(QtCore.Qt.Horizontal)
    sl.setMinimum(0); sl.setMaximum(1000)
    span = high - low
    init_pos = int(round((default - low) / span * 1000)) if span else 0
    sl.setValue(init_pos)
    sb = QtWidgets.QDoubleSpinBox()
    sb.setDecimals(decimals)
    sb.setRange(low, high)
    sb.setSingleStep(step or (span / 100.0))
    sb.setValue(default)
    sb.setMaximumWidth(80)

    def slider_changed(v):
        val = low + v / 1000.0 * span
        sb.blockSignals(True); sb.setValue(val); sb.blockSignals(False)
        setter(val)
        if on_change:
            on_change()

    def spin_changed(v):
        pos = int(round((v - low) / span * 1000)) if span else 0
        sl.blockSignals(True); sl.setValue(pos); sl.blockSignals(False)
        setter(v)
        if on_change:
            on_change()

    sl.valueChanged.connect(slider_changed)
    sb.valueChanged.connect(spin_changed)
    row.addWidget(sl, stretch=1)
    row.addWidget(sb)
    parent_layout.addLayout(row)
    return sb


# ---------------------------------------------------------------------------
# Image canvas with mouse + scroll-wheel signals

class ImageCanvas(FigureCanvasQTAgg):
    leftClicked = QtCore.Signal(float, float)
    leftDragged = QtCore.Signal(float, float, float, float)  # x0,y0,x1,y1
    rightClicked = QtCore.Signal(float, float)
    cursorMoved = QtCore.Signal(object, object)
    zoomed = QtCore.Signal()

    def __init__(self, parent=None, surface_color: str = "#ffffff"):
        self.fig = Figure(figsize=(8, 8))
        super().__init__(self.fig)
        self.setParent(parent)
        self.ax = self.fig.add_subplot(111, facecolor="#0a0a0a")
        self.ax.set_xticks([]); self.ax.set_yticks([])
        for s in ("top", "right", "bottom", "left"):
            self.ax.spines[s].set_visible(False)
        self.mpl_connect("button_press_event", self._on_press)
        self.mpl_connect("button_release_event", self._on_release)
        self.mpl_connect("motion_notify_event", self._on_motion)
        self.mpl_connect("scroll_event", self._on_scroll)
        self._press_xy: Optional[Tuple[float, float]] = None
        self._is_dragging = False
        self._drag_threshold_px = 3.0
        self._nav_mode = ""

    def set_nav_mode(self, mode: str) -> None:
        self._nav_mode = mode

    def _on_press(self, event):
        if self._nav_mode != "":
            return
        if event.inaxes != self.ax:
            return
        if event.button == 1:
            self._press_xy = (float(event.xdata), float(event.ydata))
            self._is_dragging = False
        elif event.button == 3:
            self.rightClicked.emit(float(event.xdata), float(event.ydata))

    def _on_release(self, event):
        if self._nav_mode != "":
            return
        if event.inaxes != self.ax:
            self._press_xy = None
            return
        if event.button == 1 and self._press_xy is not None:
            x0, y0 = self._press_xy
            x1, y1 = float(event.xdata), float(event.ydata)
            dist = float(np.hypot(x1 - x0, y1 - y0))
            if dist > self._drag_threshold_px:
                self.leftDragged.emit(x0, y0, x1, y1)
            else:
                self.leftClicked.emit(x1, y1)
            self._press_xy = None
            self._is_dragging = False

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


# ---------------------------------------------------------------------------
# Channel selector that mirrors the parent's channel_images dict

class ChannelSelector(QtWidgets.QWidget):
    """Multi-channel checkable list. Emits `selectionChanged` whenever
    the user toggles which channels are included."""
    selectionChanged = QtCore.Signal(list)   # list[str]
    activeChanged = QtCore.Signal(str)       # the radio-pick (the one shown)

    def __init__(self, parent=None, multi: bool = True):
        super().__init__(parent)
        self.multi = multi
        self.layout = QtWidgets.QVBoxLayout(self)
        self.layout.setContentsMargins(0, 0, 0, 0)
        self.layout.setSpacing(2)
        self._buttons: dict[str, QtWidgets.QAbstractButton] = {}
        self._radio_group: Optional[QtWidgets.QButtonGroup] = None

    def populate(self, names: list[str], default: Optional[str] = None,
                 checked: Optional[list[str]] = None) -> None:
        # Clear
        while self.layout.count():
            item = self.layout.takeAt(0)
            w = item.widget()
            if w is not None:
                w.deleteLater()
        self._buttons = {}
        if self._radio_group is not None:
            for b in list(self._radio_group.buttons()):
                self._radio_group.removeButton(b)
            self._radio_group = None
        if not names:
            self.layout.addWidget(QtWidgets.QLabel("(no channels)"))
            return
        if not self.multi:
            self._radio_group = QtWidgets.QButtonGroup(self)
            self._radio_group.setExclusive(True)
            for name in names:
                rb = QtWidgets.QRadioButton(name)
                if (default and name == default) or (default is None and name == names[0]):
                    rb.setChecked(True)
                self._radio_group.addButton(rb)
                rb.toggled.connect(
                    lambda chk, n=name: chk and self.activeChanged.emit(n))
                self.layout.addWidget(rb)
                self._buttons[name] = rb
        else:
            checked_set = set(checked) if checked else (
                {default} if default else {names[0]})
            for name in names:
                cb = QtWidgets.QCheckBox(name)
                cb.setChecked(name in checked_set)
                cb.toggled.connect(self._emit_selection)
                self.layout.addWidget(cb)
                self._buttons[name] = cb
            self._emit_selection()

    def _emit_selection(self) -> None:
        sel = [n for n, b in self._buttons.items() if b.isChecked()]
        self.selectionChanged.emit(sel)

    def selected(self) -> list[str]:
        if not self.multi and self._radio_group is not None:
            for n, b in self._buttons.items():
                if b.isChecked():
                    return [n]
            return []
        return [n for n, b in self._buttons.items() if b.isChecked()]


# ---------------------------------------------------------------------------
# Apply rotation/flip transforms (shared with other modes)

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


# ---------------------------------------------------------------------------
# Tiny convenience: percentile stretch for display

def stretch(img: np.ndarray, lo: float = 1.0, hi: float = 99.5):
    a = img.astype(np.float32)
    vmin, vmax = np.percentile(a, [lo, hi])
    if vmax <= vmin:
        vmax = vmin + 1
    return float(vmin), float(vmax)
