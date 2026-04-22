"""Depth-of-Field mode UI.

Workflow
--------
- pick the display channel + the analysis channels
- left-click to drop a probe point (optionally Z-labelled via dialog)
- shift + drag (or click two endpoints) to draw a focus-scan line
- right-click to delete the nearest pick
- choose focus metric + half-window in the right sidebar
- run analysis → tabbed window with focus heatmap, line scan, point bar
  chart, focus-metric comparison, channel comparison
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets

from ..dof_analysis import (
    DoFChannelResult, DoFPoint, FOCUS_METRICS, analyze_dof, measure_focus,
)
from ..dof_render import open_dof_window
from .common import (
    Card, ChannelSelector, ImageCanvas, apply_transform, slider_row, stretch,
)


class _AddPointDialog(QtWidgets.QDialog):
    def __init__(self, parent=None, default_label: str = "",
                 default_z: Optional[float] = None):
        super().__init__(parent)
        self.setWindowTitle("Add focus probe")
        self.setModal(True)
        self.resize(320, 150)
        form = QtWidgets.QFormLayout()
        self.label_edit = QtWidgets.QLineEdit(default_label)
        self.z_edit = QtWidgets.QLineEdit(
            "" if default_z is None else f"{default_z:.3f}")
        self.z_edit.setPlaceholderText("optional, in μm")
        form.addRow("Label", self.label_edit)
        form.addRow("Z position (μm)", self.z_edit)
        bb = QtWidgets.QDialogButtonBox(
            QtWidgets.QDialogButtonBox.Ok | QtWidgets.QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        layout = QtWidgets.QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(bb)

    def values(self) -> Tuple[str, Optional[float]]:
        z_text = self.z_edit.text().strip()
        z: Optional[float] = None
        if z_text:
            try:
                z = float(z_text)
            except ValueError:
                pass
        return self.label_edit.text().strip(), z


class DoFMode(QtWidgets.QWidget):
    statusMessage = QtCore.Signal(str)

    def __init__(self, parent_app, *, theme_provider):
        super().__init__()
        self.app = parent_app
        self._theme = theme_provider

        # State
        self.current_channel: Optional[str] = None
        self.selected_channels: List[str] = []
        self.points: List[DoFPoint] = []
        self.lines: List[Tuple[Tuple[float, float],
                               Tuple[float, float]]] = []
        self._tmp_line_pt: Optional[Tuple[float, float]] = None

        self.metric: str = "laplacian"
        self.half_window: int = 32
        self.threshold: float = 0.50
        self.line_step: float = 4.0
        self.heatmap_step: int = 48
        self.build_heatmap: bool = True

        self.rotation = 180
        self.flip_h = False
        self.flip_v = False

        self.auto_label_z: bool = False  # if True, prompt for Z on each click

        # Pixel-to-distance calibration (per axis). px / unit; unit_name
        # is "μm" or "mm" — picked from the Calibration card.
        self.unit_name: str = "μm"
        self.px_per_unit_h: Optional[float] = None
        self.px_per_unit_v: Optional[float] = None
        # When set to "H" or "V", the next drag is captured as a
        # reference line (and a length-input dialog is shown).
        self._calibration_arm: Optional[str] = None

        self._build_ui()

    # ---- UI ---------------------------------------------------------------

    def _build_ui(self):
        splitter = QtWidgets.QSplitter(QtCore.Qt.Horizontal)
        splitter.setHandleWidth(6)
        outer = QtWidgets.QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0); outer.setSpacing(0)
        outer.addWidget(splitter)
        splitter.addWidget(self._build_left_sidebar())
        splitter.addWidget(self._build_center())
        splitter.addWidget(self._build_right_sidebar())
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setStretchFactor(2, 0)
        splitter.setSizes([230, 760, 290])

    def _scrollable(self, body):
        sa = QtWidgets.QScrollArea()
        sa.setWidgetResizable(True)
        sa.setFrameShape(QtWidgets.QFrame.NoFrame)
        sa.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAsNeeded)
        sa.setMinimumWidth(180)
        body.setMinimumWidth(0)
        sa.setWidget(body)
        return sa

    def _build_left_sidebar(self):
        body = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(body)
        v.setContentsMargins(8, 8, 4, 8); v.setSpacing(6)

        c = Card("Display channel")
        self.display_picker = ChannelSelector(multi=False)
        self.display_picker.activeChanged.connect(self._on_display_changed)
        c.body_layout.addWidget(self.display_picker)
        v.addWidget(c)

        c = Card("Channels for analysis")
        self.analysis_picker = ChannelSelector(multi=True)
        self.analysis_picker.selectionChanged.connect(
            lambda sel: setattr(self, "selected_channels", list(sel)))
        c.body_layout.addWidget(self.analysis_picker)
        v.addWidget(c)

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
        flipf = QtWidgets.QHBoxLayout()
        cb_fh = QtWidgets.QCheckBox("Flip H")
        cb_fh.toggled.connect(lambda v: (setattr(self, "flip_h", v),
                                          self._render()))
        cb_fv = QtWidgets.QCheckBox("Flip V")
        cb_fv.toggled.connect(lambda v: (setattr(self, "flip_v", v),
                                          self._render()))
        flipf.addWidget(cb_fh); flipf.addWidget(cb_fv); flipf.addStretch(1)
        c.body_layout.addLayout(flipf)
        v.addWidget(c)

        # ---- Calibration (NEW) -----------------------------------------
        c = Card("Calibration")
        # Unit dropdown
        unit_row = QtWidgets.QHBoxLayout()
        unit_row.addWidget(QtWidgets.QLabel("Unit"))
        self.cb_unit = QtWidgets.QComboBox()
        self.cb_unit.addItems(["μm", "mm"])
        self.cb_unit.setCurrentText(self.unit_name)
        self.cb_unit.currentTextChanged.connect(self._on_unit_changed)
        self.cb_unit.setMaximumWidth(80)
        unit_row.addStretch(1); unit_row.addWidget(self.cb_unit)
        c.body_layout.addLayout(unit_row)

        # H reference
        h_row = QtWidgets.QHBoxLayout()
        self.btn_set_h = QtWidgets.QPushButton("Set H ref")
        self.btn_set_h.setToolTip(
            "Then drag a horizontal line of known length on the image; "
            "you'll be asked to enter its physical length.")
        self.btn_set_h.clicked.connect(lambda: self._arm_calibration("H"))
        self.lbl_cal_h = QtWidgets.QLabel("H: —")
        self.lbl_cal_h.setStyleSheet(
            "font-family: Consolas, 'Menlo', monospace;")
        h_row.addWidget(self.btn_set_h)
        h_row.addWidget(self.lbl_cal_h, stretch=1)
        c.body_layout.addLayout(h_row)

        # V reference
        v_row = QtWidgets.QHBoxLayout()
        self.btn_set_v = QtWidgets.QPushButton("Set V ref")
        self.btn_set_v.setToolTip(
            "Then drag a vertical line of known length on the image; "
            "you'll be asked to enter its physical length.")
        self.btn_set_v.clicked.connect(lambda: self._arm_calibration("V"))
        self.lbl_cal_v = QtWidgets.QLabel("V: —")
        self.lbl_cal_v.setStyleSheet(
            "font-family: Consolas, 'Menlo', monospace;")
        v_row.addWidget(self.btn_set_v)
        v_row.addWidget(self.lbl_cal_v, stretch=1)
        c.body_layout.addLayout(v_row)

        clr_row = QtWidgets.QHBoxLayout()
        self.btn_clear_cal = QtWidgets.QPushButton("Clear")
        self.btn_clear_cal.clicked.connect(self._clear_calibration)
        self.btn_copy_h_to_v = QtWidgets.QPushButton("H = V")
        self.btn_copy_h_to_v.setToolTip(
            "Copy H scale to V (use when pixels are square).")
        self.btn_copy_h_to_v.clicked.connect(self._copy_h_to_v)
        clr_row.addWidget(self.btn_clear_cal)
        clr_row.addWidget(self.btn_copy_h_to_v)
        clr_row.addStretch(1)
        c.body_layout.addLayout(clr_row)
        v.addWidget(c)

        # ---- Measurement (focus metric + sliders, merged) --------------
        c = Card("Measurement")
        mrow = QtWidgets.QHBoxLayout()
        mrow.addWidget(QtWidgets.QLabel("Metric"))
        self.cb_metric = QtWidgets.QComboBox()
        for m in FOCUS_METRICS:
            self.cb_metric.addItem(m, m)
        self.cb_metric.setCurrentText(self.metric)
        self.cb_metric.currentTextChanged.connect(self._set_metric)
        self.cb_metric.setMaximumWidth(140)
        mrow.addStretch(1); mrow.addWidget(self.cb_metric)
        c.body_layout.addLayout(mrow)
        slider_row(c.body_layout, "Half-window",
                   lambda: self.half_window,
                   lambda x: setattr(self, "half_window", int(round(x))),
                   8.0, 128.0, float(self.half_window),
                   decimals=0, on_change=self._render_preview)
        slider_row(c.body_layout, "Threshold",
                   lambda: self.threshold,
                   lambda x: setattr(self, "threshold", float(x)),
                   0.10, 0.90, self.threshold, decimals=2)
        slider_row(c.body_layout, "Line step",
                   lambda: self.line_step,
                   lambda x: setattr(self, "line_step", float(x)),
                   1.0, 16.0, self.line_step, decimals=1)
        slider_row(c.body_layout, "Heatmap step",
                   lambda: float(self.heatmap_step),
                   lambda x: setattr(self, "heatmap_step", int(round(x))),
                   16.0, 128.0, float(self.heatmap_step),
                   decimals=0)
        cb_hm = QtWidgets.QCheckBox("Build focus heatmap (slower)")
        cb_hm.setChecked(self.build_heatmap)
        cb_hm.toggled.connect(lambda v: setattr(self, "build_heatmap", v))
        c.body_layout.addWidget(cb_hm)
        self.cb_autoz = QtWidgets.QCheckBox("Prompt Z on each click")
        self.cb_autoz.setChecked(False)
        self.cb_autoz.setToolTip(
            "Each probe-point click opens a Label + Z dialog so the "
            "Picked-points tab can plot focus-vs-Z and fit a Gaussian.")
        self.cb_autoz.toggled.connect(
            lambda v: setattr(self, "auto_label_z", v))
        c.body_layout.addWidget(self.cb_autoz)
        v.addWidget(c)

        # Run
        btn_run = QtWidgets.QPushButton("Run DoF analysis")
        btn_run.setObjectName("AccentButton")
        btn_run.clicked.connect(self._run_analysis)
        v.addWidget(btn_run)

        v.addStretch(1)
        return self._scrollable(body)

    def _build_center(self):
        wrap = QtWidgets.QWidget()
        lay = QtWidgets.QVBoxLayout(wrap)
        lay.setContentsMargins(8, 8, 8, 4); lay.setSpacing(4)

        tbar = QtWidgets.QHBoxLayout()
        self.image_title = QtWidgets.QLabel("No channel selected")
        self.image_title.setStyleSheet("font-weight: 600; font-size: 13pt;")
        tbar.addWidget(self.image_title)
        tbar.addStretch(1)
        self.coord_label = QtWidgets.QLabel("")
        self.coord_label.setStyleSheet(
            "font-family: Consolas, 'Menlo', monospace; color: #888;")
        tbar.addWidget(self.coord_label)
        lay.addLayout(tbar)

        self.canvas = ImageCanvas()
        self.canvas.leftClicked.connect(self._on_left_click)
        self.canvas.leftDragged.connect(self._on_left_drag)
        self.canvas.rightClicked.connect(self._on_right_click)
        self.canvas.cursorMoved.connect(self._on_cursor)
        lay.addWidget(self.canvas, stretch=1)

        from matplotlib.backends.backend_qtagg import NavigationToolbar2QT
        self.nav = NavigationToolbar2QT(self.canvas, self)
        original_set_message = self.nav.set_message
        def patched(msg):
            original_set_message(msg)
            try: self.canvas.set_nav_mode(self.nav.mode)
            except Exception: pass
        self.nav.set_message = patched
        lay.addWidget(self.nav)

        self.hint_label = QtWidgets.QLabel(
            "Click = drop a focus probe   ·   Drag = draw a focus-scan line   "
            "·   Right-click = delete nearest pick   ·   Scroll = zoom")
        self.hint_label.setStyleSheet("color: #888;")
        lay.addWidget(self.hint_label)
        return wrap

    def _build_right_sidebar(self):
        body = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(body)
        v.setContentsMargins(4, 8, 8, 8); v.setSpacing(6)

        # Picked items
        c = Card("Picked items")
        self.tree = QtWidgets.QTreeWidget()
        self.tree.setColumnCount(5)
        self.tree.setHeaderLabels(["Type", "Label/Idx", "x", "y", "Z (μm)"])
        self.tree.setRootIsDecorated(False)
        self.tree.setAlternatingRowColors(True)
        self.tree.setMinimumHeight(180)
        self.tree.itemSelectionChanged.connect(self._on_tree_select)
        c.body_layout.addWidget(self.tree)
        btn_row = QtWidgets.QHBoxLayout()
        b1 = QtWidgets.QPushButton("Delete selected")
        b1.clicked.connect(self._delete_selected)
        b2 = QtWidgets.QPushButton("Clear all")
        b2.clicked.connect(self._clear_all)
        btn_row.addWidget(b1); btn_row.addWidget(b2); btn_row.addStretch(1)
        c.body_layout.addLayout(btn_row)
        v.addWidget(c)

        # Live preview
        c = Card("Live focus value (current channel)")
        self.live_label = QtWidgets.QLabel("Pick a point or line to see "
                                            "the focus metric.")
        self.live_label.setWordWrap(True)
        self.live_label.setStyleSheet(
            "font-family: Consolas, 'Menlo', monospace;")
        c.body_layout.addWidget(self.live_label)
        v.addWidget(c)

        v.addStretch(1)
        return self._scrollable(body)

    # ---- Public hooks -----------------------------------------------------

    def on_file_loaded(self):
        names = list(self.app.channel_images.keys())
        default = next((n for n in ("LG-G", "G", "LG-Y", "Y", "L")
                        if n in names), names[0] if names else None)
        self.display_picker.populate(names, default=default)
        self.analysis_picker.populate(names, default=default,
                                      checked=[default] if default else None)
        self.points.clear(); self.lines.clear()
        self._refresh_tree()
        if default:
            self._on_display_changed(default)

    def on_theme_changed(self):
        self._render()

    # ---- Event handlers ---------------------------------------------------

    def _on_display_changed(self, name: str):
        self.current_channel = name
        self.image_title.setText(f"DoF — {name}")
        self._render()

    def _set_rotation(self, deg: int):
        self.rotation = int(deg) % 360
        self.points.clear(); self.lines.clear()
        self._refresh_tree(); self._render()

    def _set_metric(self, m: str):
        self.metric = m
        self._render_preview()

    def _on_left_click(self, x, y):
        # Click without modifier = drop a probe point
        label = ""; z = None
        if self.auto_label_z:
            dlg = _AddPointDialog(self,
                                  default_label=f"#{len(self.points) + 1}")
            if dlg.exec() != QtWidgets.QDialog.Accepted:
                return
            label, z = dlg.values()
        else:
            label = f"#{len(self.points) + 1}"
        self.points.append(DoFPoint(x=float(x), y=float(y),
                                    label=label, z_um=z))
        self._refresh_tree()
        self._render()
        self._render_preview()

    def _on_left_drag(self, x0, y0, x1, y1):
        # Calibration mode? Capture this drag as a reference line.
        if self._calibration_arm in ("H", "V"):
            self._handle_calibration_drag(x0, y0, x1, y1)
            return
        # Default: drag = focus-scan line
        self.lines.append(((float(x0), float(y0)),
                           (float(x1), float(y1))))
        self._refresh_tree()
        self._render()
        self._render_preview()

    def _on_right_click(self, x, y):
        # Delete nearest pick (point or line endpoint)
        if not (self.points or self.lines):
            return
        dist_pt = float("inf"); idx_pt = -1
        for i, p in enumerate(self.points):
            d = float(np.hypot(p.x - x, p.y - y))
            if d < dist_pt:
                dist_pt = d; idx_pt = i
        dist_ln = float("inf"); idx_ln = -1
        for i, ((x0, y0), (x1, y1)) in enumerate(self.lines):
            mx, my = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
            d = float(np.hypot(mx - x, my - y))
            if d < dist_ln:
                dist_ln = d; idx_ln = i
        if dist_pt < dist_ln and idx_pt >= 0 and dist_pt < 30:
            del self.points[idx_pt]
        elif idx_ln >= 0 and dist_ln < 50:
            del self.lines[idx_ln]
        self._refresh_tree(); self._render(); self._render_preview()

    def _on_cursor(self, x, y):
        if x is None:
            self.coord_label.setText(""); return
        img = self._current_image()
        if img is None:
            self.coord_label.setText(f"x={int(x)} y={int(y)}"); return
        ix = int(round(x)); iy = int(round(y))
        if 0 <= ix < img.shape[1] and 0 <= iy < img.shape[0]:
            self.coord_label.setText(f"x={ix} y={iy} v={int(img[iy, ix])}")
        else:
            self.coord_label.setText(f"x={ix} y={iy}")

    def _on_tree_select(self):
        self._render()
        self._render_preview()

    def _delete_selected(self):
        items = self.tree.selectedItems()
        if not items:
            return
        # Items are tagged with (kind, index) in QTreeWidgetItem.data
        idxs_pt: List[int] = []
        idxs_ln: List[int] = []
        for it in items:
            kind = it.data(0, QtCore.Qt.UserRole)
            idx = it.data(1, QtCore.Qt.UserRole)
            if kind == "pt":
                idxs_pt.append(int(idx))
            elif kind == "ln":
                idxs_ln.append(int(idx))
        for i in sorted(idxs_pt, reverse=True):
            del self.points[i]
        for i in sorted(idxs_ln, reverse=True):
            del self.lines[i]
        self._refresh_tree(); self._render(); self._render_preview()

    def _clear_all(self):
        if not (self.points or self.lines):
            return
        self.points.clear(); self.lines.clear()
        self._refresh_tree(); self._render(); self._render_preview()

    # ---- Calibration ------------------------------------------------------

    def _arm_calibration(self, axis: str) -> None:
        if axis not in ("H", "V"):
            return
        self._calibration_arm = axis
        self.app.statusBar().showMessage(
            f"[DoF] Drag a {'horizontal' if axis == 'H' else 'vertical'} "
            f"line of known physical length, then enter its length in "
            f"{self.unit_name}. Press Esc to cancel.")
        # Highlight the active button (poor man's pressed state)
        for b, a in ((self.btn_set_h, "H"), (self.btn_set_v, "V")):
            b.setEnabled(a != axis)
        self._render()

    def _disarm_calibration(self) -> None:
        self._calibration_arm = None
        self.btn_set_h.setEnabled(True)
        self.btn_set_v.setEnabled(True)

    def _handle_calibration_drag(self, x0, y0, x1, y1) -> None:
        axis = self._calibration_arm
        # Force the drag interpretation to the requested axis
        if axis == "H":
            length_px = abs(float(x1) - float(x0))
            # Snap to horizontal for visual reference
            y_mid = 0.5 * (float(y0) + float(y1))
            ref_pts = ((min(x0, x1), y_mid), (max(x0, x1), y_mid))
        else:
            length_px = abs(float(y1) - float(y0))
            x_mid = 0.5 * (float(x0) + float(x1))
            ref_pts = ((x_mid, min(y0, y1)), (x_mid, max(y0, y1)))
        if length_px < 4.0:
            QtWidgets.QMessageBox.information(
                self, "Calibration",
                "Reference line is too short (<4 px). Try again.")
            self._disarm_calibration()
            return
        # Ask for the physical length
        L, ok = QtWidgets.QInputDialog.getDouble(
            self, f"{axis} reference length",
            f"This {('horizontal' if axis == 'H' else 'vertical')} line "
            f"is {length_px:.1f} px.\n\n"
            f"Enter its physical length in {self.unit_name}:",
            1.0, 1e-9, 1e9, 4)
        if not ok or L <= 0:
            self.app.statusBar().showMessage("[DoF] Calibration cancelled.")
            self._disarm_calibration()
            return
        ratio = float(length_px) / float(L)
        if axis == "H":
            self.px_per_unit_h = ratio
        else:
            self.px_per_unit_v = ratio
        self._update_calibration_labels()
        self._disarm_calibration()
        # Tell the user the new pixel scale
        self.app.statusBar().showMessage(
            f"[DoF] {axis}-scale set: {ratio:.4f} px / {self.unit_name}  "
            f"(1 {self.unit_name} = {1.0 / ratio:.4f} px / {self.unit_name})")
        self._render()
        self._render_preview()

    def _on_unit_changed(self, name: str) -> None:
        # Switching units rescales numerical labels (px/unit and unit/px).
        # We do not re-prompt for length; the user can re-set H/V if they
        # want a different reference unit baseline.
        if name not in ("μm", "mm"):
            return
        if name == self.unit_name:
            return
        # Convert current scales (px/μm <-> px/mm). 1 mm = 1000 μm.
        scale_factor = 1000.0 if (self.unit_name, name) == ("μm", "mm") \
                       else (1.0 / 1000.0)
        if self.px_per_unit_h is not None:
            self.px_per_unit_h *= scale_factor
        if self.px_per_unit_v is not None:
            self.px_per_unit_v *= scale_factor
        self.unit_name = name
        self._update_calibration_labels()
        self._render_preview()

    def _clear_calibration(self) -> None:
        self.px_per_unit_h = None
        self.px_per_unit_v = None
        self._update_calibration_labels()
        self._render_preview()
        self.app.statusBar().showMessage("[DoF] Calibration cleared.")

    def _copy_h_to_v(self) -> None:
        if self.px_per_unit_h is None:
            return
        self.px_per_unit_v = self.px_per_unit_h
        self._update_calibration_labels()
        self._render_preview()

    def _update_calibration_labels(self) -> None:
        u = self.unit_name
        if self.px_per_unit_h is not None:
            self.lbl_cal_h.setText(
                f"H: {self.px_per_unit_h:.3f} px/{u}")
        else:
            self.lbl_cal_h.setText("H: —")
        if self.px_per_unit_v is not None:
            self.lbl_cal_v.setText(
                f"V: {self.px_per_unit_v:.3f} px/{u}")
        else:
            self.lbl_cal_v.setText("V: —")

    def _calibration_dict(self) -> dict:
        """Snapshot of the current calibration for downstream code."""
        return {
            "unit": self.unit_name,
            "px_per_unit_h": self.px_per_unit_h,
            "px_per_unit_v": self.px_per_unit_v,
        }

    def _line_length_units(self, p0, p1) -> Optional[float]:
        """Convert a line's (p0,p1) pixel length to physical units when
        calibrations for both axes covered are present."""
        if self.px_per_unit_h is None or self.px_per_unit_v is None:
            return None
        x0, y0 = p0; x1, y1 = p1
        dx_px = abs(float(x1) - float(x0))
        dy_px = abs(float(y1) - float(y0))
        dx_u = dx_px / self.px_per_unit_h
        dy_u = dy_px / self.px_per_unit_v
        return float(np.hypot(dx_u, dy_u))

    # ---- Render -----------------------------------------------------------

    def _current_image(self) -> Optional[np.ndarray]:
        if self.current_channel is None:
            return None
        raw = self.app.channel_images.get(self.current_channel)
        if raw is None:
            return None
        return apply_transform(raw, rotation=self.rotation,
                               flip_h=self.flip_h, flip_v=self.flip_v)

    def _render(self) -> None:
        t = self._theme()
        ax = self.canvas.ax
        self.canvas.fig.set_facecolor(t["FIG_FACE"])
        ax.clear()
        ax.set_facecolor(t["AXES_FACE"])
        img = self._current_image()
        if img is None:
            ax.text(0.5, 0.5, "Open a file first.",
                    transform=ax.transAxes, color=t["EMPTY_INK"],
                    ha="center", va="center", fontsize=12)
            ax.set_xticks([]); ax.set_yticks([])
            self.canvas.draw_idle()
            return
        vmin, vmax = stretch(img)
        ax.imshow(img, cmap="gray", vmin=vmin, vmax=vmax,
                  interpolation="nearest")
        ax.set_xticks([]); ax.set_yticks([])

        sel_kind, sel_idx = self._selected_meta()
        for i, ((x0, y0), (x1, y1)) in enumerate(self.lines):
            color = "#ffd54f"
            lw = 2.5 if (sel_kind == "ln" and sel_idx == i) else 1.5
            ax.plot([x0, x1], [y0, y1], color=color, linewidth=lw,
                    alpha=0.95)
            ax.plot(x0, y0, "o", color=color, markeredgecolor="white",
                    markersize=5)
            ax.plot(x1, y1, "o", color=color, markeredgecolor="white",
                    markersize=5)
            mx, my = 0.5 * (x0 + x1), 0.5 * (y0 + y1)
            ax.text(mx, my - 8, f"L{i + 1}", color="white", fontsize=8,
                    ha="center", va="bottom",
                    bbox=dict(facecolor="#cf6e1a", alpha=0.85,
                              edgecolor="none",
                              boxstyle="round,pad=0.2"))

        for i, p in enumerate(self.points):
            color = "#1f77b4"
            highlighted = (sel_kind == "pt" and sel_idx == i)
            if highlighted:
                ax.plot(p.x, p.y, "o", color="#ffd54f", markersize=14,
                        alpha=0.6)
            ax.plot(p.x, p.y, "o", color=color, markersize=7,
                    markeredgecolor="white")
            label = p.label or f"#{i + 1}"
            if p.z_um is not None:
                label = f"{label}  z={p.z_um:.1f}"
            ax.text(p.x + 7, p.y - 7, label, color="white", fontsize=8,
                    bbox=dict(facecolor=color, alpha=0.85,
                              edgecolor="none",
                              boxstyle="round,pad=0.2"))
        self.canvas.draw_idle()

    def _selected_meta(self) -> Tuple[Optional[str], Optional[int]]:
        items = self.tree.selectedItems()
        if not items:
            return None, None
        kind = items[0].data(0, QtCore.Qt.UserRole)
        idx = items[0].data(1, QtCore.Qt.UserRole)
        return kind, idx

    def _render_preview(self) -> None:
        img = self._current_image()
        if img is None:
            self.live_label.setText("Open a file first.")
            return
        kind, idx = self._selected_meta()
        if kind == "pt" and idx is not None and 0 <= idx < len(self.points):
            p = self.points[idx]
            f = measure_focus(img, p.x, p.y, half_window=self.half_window,
                              metric=self.metric)
            self.live_label.setText(
                f"point #{idx + 1}  ({p.label or '—'})\n"
                f"  metric = {self.metric}\n"
                f"  focus  = {f:.4g}\n"
                f"  half-w = {self.half_window} px")
            return
        if kind == "ln" and idx is not None and 0 <= idx < len(self.lines):
            (x0, y0), (x1, y1) = self.lines[idx]
            from ..dof_analysis import _scan_line
            scan = _scan_line(img, (x0, y0), (x1, y1),
                              step_px=self.line_step,
                              half_window=self.half_window,
                              metric=self.metric,
                              threshold=self.threshold,
                              calibration=self._calibration_dict())
            # Prefer physical-unit display when calibration is set
            if scan.unit_name and scan.peak_position_unit is not None:
                u = scan.unit_name
                dof_txt = (f"{scan.dof_width_unit:.3g} {u}"
                           if scan.dof_width_unit is not None else "—")
                L_unit = float(scan.positions_unit[-1])
                self.live_label.setText(
                    f"line {idx + 1}   ({self.metric})\n"
                    f"  peak @ {scan.peak_position_unit:.3g} {u} "
                    f"/ {L_unit:.3g} {u}\n"
                    f"  DoF (>{int(self.threshold * 100)}%) = {dof_txt}")
            else:
                dof_txt = (f"{scan.dof_width_px:.1f} px"
                           if scan.dof_width_px else "—")
                self.live_label.setText(
                    f"line {idx + 1}   ({self.metric})\n"
                    f"  peak @ {scan.peak_position_px:.1f} px / "
                    f"{float(scan.positions[-1]):.1f} px\n"
                    f"  DoF (>{int(self.threshold * 100)}%) = {dof_txt}\n"
                    f"  (calibrate to convert to physical units)")
            return
        # Show a global summary when nothing selected
        if self.points:
            best_focus = max(
                measure_focus(img, p.x, p.y, half_window=self.half_window,
                              metric=self.metric)
                for p in self.points)
            self.live_label.setText(
                f"{len(self.points)} points · {len(self.lines)} lines\n"
                f"max focus across points = {best_focus:.4g}")
        else:
            self.live_label.setText(
                f"{len(self.points)} points · {len(self.lines)} lines\n"
                f"Pick a point/line for live preview.")

    def _refresh_tree(self) -> None:
        self.tree.blockSignals(True)
        self.tree.clear()
        for i, p in enumerate(self.points):
            it = QtWidgets.QTreeWidgetItem([
                "point", p.label or f"#{i + 1}",
                f"{p.x:.1f}", f"{p.y:.1f}",
                "" if p.z_um is None else f"{p.z_um:.2f}"])
            it.setData(0, QtCore.Qt.UserRole, "pt")
            it.setData(1, QtCore.Qt.UserRole, i)
            self.tree.addTopLevelItem(it)
        for i, ((x0, y0), (x1, y1)) in enumerate(self.lines):
            it = QtWidgets.QTreeWidgetItem([
                "line", f"L{i + 1}",
                f"{x0:.0f}-{x1:.0f}", f"{y0:.0f}-{y1:.0f}", ""])
            it.setData(0, QtCore.Qt.UserRole, "ln")
            it.setData(1, QtCore.Qt.UserRole, i)
            self.tree.addTopLevelItem(it)
        self.tree.blockSignals(False)

    # ---- Run analysis -----------------------------------------------------

    def _run_analysis(self):
        if not self.app.channel_images:
            QtWidgets.QMessageBox.information(
                self, "No data", "Open a file first.")
            return
        if not (self.points or self.lines):
            QtWidgets.QMessageBox.information(
                self, "Nothing to analyze",
                "Drop at least one point (click) or one line (drag).")
            return
        sel = self.selected_channels or (
            [self.current_channel] if self.current_channel else [])
        if not sel:
            QtWidgets.QMessageBox.information(
                self, "No channels", "Select at least one channel.")
            return

        results: List[DoFChannelResult] = []
        raw_images: Dict[str, np.ndarray] = {}
        for name in sel:
            raw = self.app.channel_images.get(name)
            if raw is None:
                continue
            img = apply_transform(raw, rotation=self.rotation,
                                  flip_h=self.flip_h, flip_v=self.flip_v)
            raw_images[name] = img
            results.append(analyze_dof(
                img, name=name, points=self.points, lines=self.lines,
                metric=self.metric, half_window=self.half_window,
                threshold=self.threshold, line_step_px=self.line_step,
                build_heatmap=self.build_heatmap,
                heatmap_step=self.heatmap_step,
                calibration=self._calibration_dict(),
            ))
        if not results:
            return
        t = self._theme()
        open_dof_window(parent=self.window(), results=results,
                        raw_images=raw_images,
                        fig_face=t["FIG_FACE"], text=t["TEXT"])
