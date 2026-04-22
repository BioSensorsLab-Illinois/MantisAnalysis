"""FPN analysis mode — UI widget.

The user picks one or more channels, drags a rectangle to define an
ROI on the displayed channel, tweaks ISP filters + percentile cuts
(with a live red overlay showing excluded pixels) and runs the
multi-channel analysis window.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from PySide6 import QtCore, QtGui, QtWidgets
from matplotlib.patches import Rectangle

from ..fpn_analysis import FPNSettings, apply_isp, compute_fpn, percentile_mask
from ..fpn_render import open_fpn_window
from .common import (
    Card, ChannelSelector, ImageCanvas, apply_transform, slider_row, stretch,
)


class FPNMode(QtWidgets.QWidget):
    """Top-level widget for the FPN mode (sits inside MainWindow's stack)."""

    statusMessage = QtCore.Signal(str)

    def __init__(self, parent_app, *, theme_provider):
        super().__init__()
        self.app = parent_app  # MainWindow — for shared file state
        self._theme = theme_provider  # callable returning current theme dict

        # State
        self.current_channel: Optional[str] = None
        self.selected_channels: List[str] = []
        self.roi: Optional[Tuple[int, int, int, int]] = None  # (y0,x0,y1,x1)
        self.settings = FPNSettings()
        # Image transforms (mirror USAF defaults for consistency)
        self.rotation = 180
        self.flip_h = False
        self.flip_v = False

        self._build_ui()

    # ---- UI ---------------------------------------------------------------

    def _build_ui(self) -> None:
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
        splitter.setSizes([220, 760, 280])

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
        self.display_picker.activeChanged.connect(self._on_display_channel_changed)
        c.body_layout.addWidget(self.display_picker)
        v.addWidget(c)

        c = Card("Channels for analysis")
        self.analysis_picker = ChannelSelector(multi=True)
        self.analysis_picker.selectionChanged.connect(
            self._on_selection_changed)
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
        self.cb_fh = QtWidgets.QCheckBox("Flip H")
        self.cb_fh.toggled.connect(lambda v: (setattr(self, "flip_h", v),
                                              self._render()))
        self.cb_fv = QtWidgets.QCheckBox("Flip V")
        self.cb_fv.toggled.connect(lambda v: (setattr(self, "flip_v", v),
                                              self._render()))
        flipf.addWidget(self.cb_fh); flipf.addWidget(self.cb_fv)
        flipf.addStretch(1)
        c.body_layout.addLayout(flipf)
        v.addWidget(c)

        # Run analysis button
        self.btn_run = QtWidgets.QPushButton("Run FPN analysis")
        self.btn_run.setObjectName("AccentButton")
        self.btn_run.clicked.connect(self._run_analysis)
        v.addWidget(self.btn_run)

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
        self.canvas.leftDragged.connect(self._on_drag_roi)
        self.canvas.leftClicked.connect(self._on_click)  # click to clear ROI
        self.canvas.cursorMoved.connect(self._on_cursor)
        lay.addWidget(self.canvas, stretch=1)

        from matplotlib.backends.backend_qtagg import NavigationToolbar2QT
        self.nav = NavigationToolbar2QT(self.canvas, self)
        # Forward toolbar mode → canvas
        original_set_message = self.nav.set_message
        def patched(msg):
            original_set_message(msg)
            try: self.canvas.set_nav_mode(self.nav.mode)
            except Exception: pass
        self.nav.set_message = patched
        lay.addWidget(self.nav)

        # Hint
        self.hint_label = QtWidgets.QLabel(
            "Drag = define ROI · click in image to clear ROI · "
            "scroll = zoom · drag inside ROI to redefine.")
        self.hint_label.setStyleSheet("color: #888;")
        lay.addWidget(self.hint_label)

        return wrap

    def _build_right_sidebar(self):
        body = QtWidgets.QWidget()
        v = QtWidgets.QVBoxLayout(body)
        v.setContentsMargins(4, 8, 8, 8); v.setSpacing(6)

        # ROI info
        c = Card("ROI")
        self.roi_label = QtWidgets.QLabel("(none — drag to define)")
        c.body_layout.addWidget(self.roi_label)
        roi_btn_row = QtWidgets.QHBoxLayout()
        b1 = QtWidgets.QPushButton("Use full image")
        b1.clicked.connect(self._use_full_roi)
        b2 = QtWidgets.QPushButton("Clear ROI")
        b2.clicked.connect(self._clear_roi)
        roi_btn_row.addWidget(b1); roi_btn_row.addWidget(b2)
        roi_btn_row.addStretch(1)
        c.body_layout.addLayout(roi_btn_row)
        v.addWidget(c)

        # Outlier cuts
        c = Card("Outlier cuts (live preview)")
        slider_row(c.body_layout, "Bottom %",
                   lambda: self.settings.lo_pct,
                   lambda x: setattr(self.settings, "lo_pct", float(x)),
                   0.0, 10.0, 0.0, decimals=2,
                   on_change=self._render)
        slider_row(c.body_layout, "Top %",
                   lambda: self.settings.hi_pct,
                   lambda x: setattr(self.settings, "hi_pct", float(x)),
                   0.0, 10.0, 0.0, decimals=2,
                   on_change=self._render)
        self.excluded_label = QtWidgets.QLabel("excluded: 0 px (0.00%)")
        self.excluded_label.setStyleSheet("color: #888;")
        c.body_layout.addWidget(self.excluded_label)
        v.addWidget(c)

        # ISP / smoothing
        c = Card("ISP / smoothing")
        # Median filter size
        med_row = QtWidgets.QHBoxLayout()
        med_row.addWidget(QtWidgets.QLabel("Median filter"))
        self.cb_med = QtWidgets.QComboBox()
        self.cb_med.addItem("off", 0)
        self.cb_med.addItem("3×3", 3)
        self.cb_med.addItem("5×5", 5)
        self.cb_med.addItem("7×7", 7)
        self.cb_med.currentIndexChanged.connect(self._on_isp_changed)
        med_row.addStretch(1); med_row.addWidget(self.cb_med)
        c.body_layout.addLayout(med_row)
        slider_row(c.body_layout, "Gauss σ (px)",
                   lambda: self.settings.gaussian_sigma,
                   lambda x: setattr(self.settings, "gaussian_sigma",
                                     float(x)),
                   0.0, 6.0, 0.0, decimals=2, on_change=self._render)
        slider_row(c.body_layout, "Hot-pix > σ",
                   lambda: self.settings.hot_pixel_thr,
                   lambda x: setattr(self.settings, "hot_pixel_thr",
                                     float(x)),
                   0.0, 20.0, 0.0, decimals=1, on_change=self._render)
        self.cb_bil = QtWidgets.QCheckBox("Bilateral (edge-preserving)")
        self.cb_bil.toggled.connect(self._on_bil_changed)
        c.body_layout.addWidget(self.cb_bil)
        v.addWidget(c)

        # Live stats (current displayed channel)
        c = Card("Live statistics  (current channel)")
        self.stats_label = QtWidgets.QLabel("Pick an ROI to see stats.")
        self.stats_label.setStyleSheet(
            "font-family: Consolas, 'Menlo', monospace;")
        c.body_layout.addWidget(self.stats_label)
        v.addWidget(c)

        v.addStretch(1)
        return self._scrollable(body)

    # ---- Public hooks called by MainWindow --------------------------------

    def on_file_loaded(self):
        names = list(self.app.channel_images.keys())
        # Default display = something reasonable
        default = next((n for n in ("LG-G", "G", "LG-Y", "Y", "L")
                        if n in names), names[0] if names else None)
        self.display_picker.populate(names, default=default)
        self.analysis_picker.populate(names, default=default,
                                      checked=[default] if default else None)
        self.roi = None
        if default:
            self._on_display_channel_changed(default)

    def on_theme_changed(self):
        self._render()

    # ---- Event handlers ---------------------------------------------------

    def _on_display_channel_changed(self, name: str):
        self.current_channel = name
        self.image_title.setText(f"FPN — {name}")
        self._render()

    def _on_selection_changed(self, sel: list):
        self.selected_channels = list(sel)
        self.btn_run.setEnabled(bool(sel))

    def _set_rotation(self, deg: int):
        self.rotation = int(deg) % 360
        self.roi = None  # ROI invalidated by transform
        self._render()

    def _on_isp_changed(self):
        self.settings.median_size = int(self.cb_med.currentData())
        self._render()

    def _on_bil_changed(self, v: bool):
        self.settings.bilateral = bool(v)
        self._render()

    def _on_drag_roi(self, x0, y0, x1, y1):
        img = self._current_image()
        if img is None:
            return
        h, w = img.shape[:2]
        # Snap to integer + clamp
        xa, xb = sorted([int(round(x0)), int(round(x1))])
        ya, yb = sorted([int(round(y0)), int(round(y1))])
        xa = max(0, xa); xb = min(w, xb + 1)
        ya = max(0, ya); yb = min(h, yb + 1)
        if (xb - xa) < 4 or (yb - ya) < 4:
            return
        self.roi = (ya, xa, yb, xb)
        self._render()

    def _on_click(self, x, y):
        # Click outside any current ROI clears it. Click inside → keep it.
        if self.roi is None:
            return
        y0, x0, y1, x1 = self.roi
        if not (x0 <= x < x1 and y0 <= y < y1):
            self.roi = None
            self._render()

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

    def _use_full_roi(self):
        img = self._current_image()
        if img is None:
            return
        h, w = img.shape[:2]
        self.roi = (0, 0, h, w)
        self._render()

    def _clear_roi(self):
        self.roi = None
        self._render()

    # ---- Rendering --------------------------------------------------------

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
                    ha="center", va="center", color=t["EMPTY_INK"],
                    transform=ax.transAxes, fontsize=12)
            ax.set_xticks([]); ax.set_yticks([])
            self.canvas.draw_idle()
            return

        # Apply ISP for display (so user sees what FPN will measure)
        img_isp = apply_isp(img, self.settings)
        vmin, vmax = stretch(img_isp)
        ax.imshow(img_isp, cmap="gray", vmin=vmin, vmax=vmax,
                  interpolation="nearest")
        ax.set_xticks([]); ax.set_yticks([])

        # Outlier overlay (only inside ROI if ROI is set)
        if self.settings.lo_pct > 0 or self.settings.hi_pct > 0:
            target_img = img_isp
            if self.roi is not None:
                y0, x0, y1, x1 = self.roi
                sub = img_isp[y0:y1, x0:x1]
                mask_sub = percentile_mask(sub, self.settings.lo_pct,
                                           self.settings.hi_pct)
                full_mask = np.ones(img_isp.shape, dtype=bool)
                full_mask[y0:y1, x0:x1] = mask_sub
                excluded = ~full_mask
                # Excluded count is for ROI only
                n_excluded = int((~mask_sub).sum())
                n_total = int(sub.size)
            else:
                mask = percentile_mask(target_img, self.settings.lo_pct,
                                       self.settings.hi_pct)
                excluded = ~mask
                n_excluded = int(excluded.sum())
                n_total = int(target_img.size)
            if excluded.any():
                overlay = np.zeros((*img_isp.shape, 4), dtype=np.float32)
                overlay[..., 0] = 1.0
                overlay[..., 3] = excluded.astype(np.float32) * 0.55
                ax.imshow(overlay, interpolation="nearest")
            pct = 100.0 * n_excluded / max(1, n_total)
            self.excluded_label.setText(
                f"excluded: {n_excluded:,} px  ({pct:.2f}% of "
                f"{'ROI' if self.roi is not None else 'image'})")
        else:
            self.excluded_label.setText("excluded: 0 px (0.00%)")

        # ROI rectangle
        if self.roi is not None:
            y0, x0, y1, x1 = self.roi
            rect = Rectangle((x0 - 0.5, y0 - 0.5),
                             x1 - x0, y1 - y0,
                             fill=False, edgecolor="#ffd54f",
                             linewidth=1.6)
            ax.add_patch(rect)
            self.roi_label.setText(
                f"y[{y0}:{y1}]  x[{x0}:{x1}]   "
                f"size {y1 - y0}×{x1 - x0} px")
            self._update_live_stats(img_isp[y0:y1, x0:x1])
        else:
            self.roi_label.setText("(none — drag to define)")
            self._update_live_stats(None)

        self.canvas.draw_idle()

    def _update_live_stats(self, sub: Optional[np.ndarray]) -> None:
        if sub is None or sub.size == 0:
            self.stats_label.setText("Pick an ROI to see stats.")
            return
        try:
            res = compute_fpn(self._current_image(),
                              name=self.current_channel or "",
                              roi=self.roi, settings=self.settings)
        except ValueError as exc:
            self.stats_label.setText(f"({exc})")
            return
        self.stats_label.setText(
            f"  μ           = {res.mean:>10.2f} DN\n"
            f"  σ (DSNU)    = {res.std:>10.3f} DN\n"
            f"  PRNU = σ/μ  = {res.prnu_pct:>10.3f} %\n"
            f"  σ rows      = {res.row_noise_dn:>10.3f} DN\n"
            f"  σ cols      = {res.col_noise_dn:>10.3f} DN\n"
            f"  σ residual  = {res.residual_pixel_noise_dn:>10.3f} DN")

    # ---- Run analysis -----------------------------------------------------

    def _run_analysis(self):
        if not self.app.channel_images:
            QtWidgets.QMessageBox.information(
                self, "No data", "Open a file first.")
            return
        sel = self.selected_channels or (
            [self.current_channel] if self.current_channel else [])
        if not sel:
            QtWidgets.QMessageBox.information(
                self, "No channels", "Select at least one channel.")
            return
        # If user hasn't drawn an ROI, fall back to full image
        results = []
        for name in sel:
            raw = self.app.channel_images.get(name)
            if raw is None:
                continue
            img = apply_transform(raw, rotation=self.rotation,
                                  flip_h=self.flip_h, flip_v=self.flip_v)
            roi = self.roi if self.roi is not None else (
                0, 0, img.shape[0], img.shape[1])
            try:
                results.append(compute_fpn(img, name=name, roi=roi,
                                           settings=self.settings))
            except ValueError as exc:
                QtWidgets.QMessageBox.warning(
                    self, f"FPN ({name})", str(exc))
        if not results:
            return
        t = self._theme()
        open_fpn_window(parent=self.window(), results=results,
                        fig_face=t["FIG_FACE"], text=t["TEXT"])
