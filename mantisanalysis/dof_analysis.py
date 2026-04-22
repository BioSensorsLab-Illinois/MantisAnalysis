"""Depth-of-Field analysis using local-contrast / focus-metric math.

The Edmund DoF 5-15 target (#11656) is a tilted resolution chart used to
visualize depth of field on a microscope: bars are designed for ~5-15
cy/mm, so when imaged on a photographic-class system the bars are often
sub-pixel and you see them as moiré rather than discrete lines. That
doesn't matter — every common autofocus / sharpness metric responds to
*local high-frequency energy*, regardless of whether the underlying
features are resolved or aliased. As you move away from the focus
plane the high-frequency energy drops; the rate of drop-off defines DoF.

We support 4 focus metrics so the user can sanity-check across them:

    laplacian  : variance of the discrete Laplacian (Pech-Pacheco)
                 — the de-facto autofocus metric in OpenCV / scikit-image
    brenner    : sum of squared first differences (Brenner gradient)
                 — favors sharp edges; sensitive to aliased bars
    tenengrad  : mean of |Sobel|² magnitude
                 — robust, similar to Brenner but isotropic
    fft_hf     : ratio of high-frequency to total spectral energy
                 — direct measure of "fine detail" content; immune to
                 absolute brightness

References:
    Pech-Pacheco et al., 2000 — Diatom Autofocusing (variance of Laplacian)
    Brenner et al., 1976 — Quantitative microscopy autofocus
    Pertuz et al., 2013 — Analysis of focus measure operators for SFF
    Edmund Optics — Depth of Field & Depth of Focus application note
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.ndimage import gaussian_filter, laplace, sobel


FOCUS_METRICS = ("laplacian", "brenner", "tenengrad", "fft_hf")


# ---------------------------------------------------------------------------
# Per-window focus metrics

def _window(image: np.ndarray, cx: float, cy: float,
            half: int) -> Optional[np.ndarray]:
    h, w = image.shape[:2]
    x0 = max(0, int(round(cx - half)))
    y0 = max(0, int(round(cy - half)))
    x1 = min(w, int(round(cx + half + 1)))
    y1 = min(h, int(round(cy + half + 1)))
    if x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return image[y0:y1, x0:x1].astype(np.float64, copy=False)


def focus_laplacian(window: np.ndarray) -> float:
    if window is None or window.size == 0:
        return 0.0
    lap = laplace(window)
    return float(lap.var())


def focus_brenner(window: np.ndarray) -> float:
    if window is None or window.size == 0:
        return 0.0
    if window.shape[0] < 3 or window.shape[1] < 3:
        return 0.0
    # Sum of squared 2-step horizontal + vertical differences
    dx = window[:, 2:] - window[:, :-2]
    dy = window[2:, :] - window[:-2, :]
    return float((dx ** 2).sum() + (dy ** 2).sum()) / float(window.size)


def focus_tenengrad(window: np.ndarray) -> float:
    if window is None or window.size == 0:
        return 0.0
    sx = sobel(window, axis=1, mode="reflect")
    sy = sobel(window, axis=0, mode="reflect")
    return float((sx ** 2 + sy ** 2).mean())


def focus_fft_hf(window: np.ndarray, *, hf_lo: float = 0.20,
                 hf_hi: float = 0.50) -> float:
    """Fraction of spectral power in the high-frequency band [hf_lo, hf_hi]
    (cycles per pixel, isotropic)."""
    if window is None or window.size < 16:
        return 0.0
    a = window - window.mean()
    win2d = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fft = np.fft.fftshift(np.fft.fft2(a * win2d))
    mag = (np.abs(fft) ** 2)
    h, w = mag.shape
    cy = (h - 1) / 2.0; cx = (w - 1) / 2.0
    yy, xx = np.indices(mag.shape).astype(np.float64)
    fy = (yy - cy) / max(1, h)
    fx = (xx - cx) / max(1, w)
    radial = np.hypot(fx, fy)
    band = (radial >= hf_lo) & (radial <= hf_hi)
    total = mag[radial <= hf_hi].sum()
    if total <= 0:
        return 0.0
    return float(mag[band].sum() / total)


def measure_focus(image: np.ndarray, cx: float, cy: float, *,
                  half_window: int = 32, metric: str = "laplacian") -> float:
    """Measure local focus at (cx, cy) using the named metric."""
    win = _window(image, cx, cy, half_window)
    if win is None:
        return 0.0
    if metric == "laplacian":
        return focus_laplacian(win)
    if metric == "brenner":
        return focus_brenner(win)
    if metric == "tenengrad":
        return focus_tenengrad(win)
    if metric == "fft_hf":
        return focus_fft_hf(win)
    raise ValueError(f"unknown focus metric: {metric!r}")


# ---------------------------------------------------------------------------
# Data classes

@dataclass
class DoFPoint:
    """One labeled focus probe."""
    x: float
    y: float
    label: str = ""
    z_um: Optional[float] = None    # optional Z calibration


@dataclass
class DoFPointResult:
    point: DoFPoint
    focus: float
    focus_norm: float       # = focus / peak_focus (0..1)


@dataclass
class DoFLineResult:
    """Sliding-window scan along a user-drawn line."""
    p0: Tuple[float, float]
    p1: Tuple[float, float]
    positions: np.ndarray      # distance from p0 along the line, in pixels
    focus: np.ndarray
    focus_norm: np.ndarray
    peak_idx: int
    peak_position_px: float
    dof_low_px: Optional[float]      # left edge of focus band
    dof_high_px: Optional[float]     # right edge
    dof_width_px: Optional[float]
    # Physical-unit conversions (filled when calibration is present)
    px_per_unit: Optional[float] = None     # px / unit ALONG this line
    unit_name: Optional[str] = None
    positions_unit: Optional[np.ndarray] = None
    peak_position_unit: Optional[float] = None
    dof_low_unit: Optional[float] = None
    dof_high_unit: Optional[float] = None
    dof_width_unit: Optional[float] = None


@dataclass
class DoFChannelResult:
    name: str                          # "HG-G", "L", etc.
    image: np.ndarray                  # post-transform
    metric: str
    half_window: int
    threshold: float                   # focus threshold (0..1)

    points: List[DoFPointResult]
    lines: List[DoFLineResult]

    # Optional overall focus heatmap (downsampled grid, for the heatmap tab)
    heatmap: Optional[np.ndarray] = None
    heatmap_step: int = 32

    # Calibration carried through — None when uncalibrated. Per-axis
    # px/unit; the per-line conversion factor is in DoFLineResult.
    unit_name: Optional[str] = None
    px_per_unit_h: Optional[float] = None
    px_per_unit_v: Optional[float] = None

    @property
    def color(self) -> str:
        from .fpn_render import _color
        return _color(self.name)

    @property
    def is_calibrated(self) -> bool:
        return (self.px_per_unit_h is not None
                and self.px_per_unit_v is not None)


# ---------------------------------------------------------------------------
# Per-channel analysis

def analyze_dof(image: np.ndarray, *,
                name: str,
                points: Sequence[DoFPoint],
                lines: Sequence[Tuple[Tuple[float, float],
                                      Tuple[float, float]]] = (),
                metric: str = "laplacian",
                half_window: int = 32,
                threshold: float = 0.5,
                line_step_px: float = 4.0,
                build_heatmap: bool = True,
                heatmap_step: int = 48,
                calibration: Optional[dict] = None,
                ) -> DoFChannelResult:
    """Compute focus values at every picked point + along each line.

    `calibration` (optional): dict with keys ``unit``, ``px_per_unit_h``,
    ``px_per_unit_v``. When all three are present, every line's results
    will be available in physical units in addition to pixels.
    """
    # Points
    pt_focus = [
        measure_focus(image, p.x, p.y,
                      half_window=half_window, metric=metric)
        for p in points
    ]
    peak_pt = max(pt_focus) if pt_focus else 0.0
    pt_results = [
        DoFPointResult(point=p, focus=f,
                       focus_norm=(f / peak_pt) if peak_pt > 0 else 0.0)
        for p, f in zip(points, pt_focus)
    ]

    # Lines
    line_results: List[DoFLineResult] = []
    for p0, p1 in lines:
        line_results.append(
            _scan_line(image, p0, p1,
                       step_px=line_step_px,
                       half_window=half_window,
                       metric=metric, threshold=threshold,
                       calibration=calibration))

    # Heatmap (optional, for the focus-map tab)
    heatmap = None
    if build_heatmap:
        heatmap = _build_focus_heatmap(image, step=heatmap_step,
                                       half_window=half_window,
                                       metric=metric)

    cal = calibration or {}
    return DoFChannelResult(
        name=name, image=image, metric=metric,
        half_window=half_window, threshold=threshold,
        points=pt_results, lines=line_results,
        heatmap=heatmap, heatmap_step=heatmap_step,
        unit_name=cal.get("unit"),
        px_per_unit_h=cal.get("px_per_unit_h"),
        px_per_unit_v=cal.get("px_per_unit_v"),
    )


def _scan_line(image: np.ndarray, p0: Tuple[float, float],
               p1: Tuple[float, float], *,
               step_px: float, half_window: int,
               metric: str, threshold: float,
               calibration: Optional[dict] = None
               ) -> DoFLineResult:
    x0, y0 = p0; x1, y1 = p1
    L = float(np.hypot(x1 - x0, y1 - y0))
    n = max(2, int(np.ceil(L / max(0.5, float(step_px)))))
    ts = np.linspace(0.0, 1.0, n)
    xs = x0 + ts * (x1 - x0)
    ys = y0 + ts * (y1 - y0)
    positions = ts * L

    focus = np.array([
        measure_focus(image, float(x), float(y),
                      half_window=half_window, metric=metric)
        for x, y in zip(xs, ys)
    ])
    peak = float(focus.max()) if focus.size else 0.0
    focus_norm = focus / peak if peak > 0 else focus * 0.0

    peak_idx = int(np.argmax(focus_norm))
    peak_position = float(positions[peak_idx])

    # DoF edges: walk left + right from peak until the curve drops below threshold.
    dof_lo = dof_hi = None
    for j in range(peak_idx, -1, -1):
        if focus_norm[j] < threshold:
            dof_lo = float(positions[j])
            break
    for j in range(peak_idx, len(focus_norm)):
        if focus_norm[j] < threshold:
            dof_hi = float(positions[j])
            break
    width = (dof_hi - dof_lo) if (dof_lo is not None and dof_hi is not None) else None

    # Calibration → physical units along this line direction.
    px_per_unit = None
    unit_name = None
    positions_unit = None
    peak_position_unit = None
    dof_lo_unit = dof_hi_unit = width_unit = None
    if calibration is not None:
        ph = calibration.get("px_per_unit_h")
        pv = calibration.get("px_per_unit_v")
        unit_name = calibration.get("unit")
        if ph and pv and L > 0:
            # Convert each component, recombine to get px-along-line / unit
            dx_px = abs(float(x1) - float(x0))
            dy_px = abs(float(y1) - float(y0))
            dx_u = dx_px / float(ph)
            dy_u = dy_px / float(pv)
            L_u = float(np.hypot(dx_u, dy_u))
            if L_u > 0:
                px_per_unit = float(L / L_u)
                positions_unit = positions / px_per_unit
                peak_position_unit = float(peak_position / px_per_unit)
                if dof_lo is not None:
                    dof_lo_unit = float(dof_lo / px_per_unit)
                if dof_hi is not None:
                    dof_hi_unit = float(dof_hi / px_per_unit)
                if width is not None:
                    width_unit = float(width / px_per_unit)

    return DoFLineResult(
        p0=(float(x0), float(y0)), p1=(float(x1), float(y1)),
        positions=positions, focus=focus, focus_norm=focus_norm,
        peak_idx=peak_idx, peak_position_px=peak_position,
        dof_low_px=dof_lo, dof_high_px=dof_hi, dof_width_px=width,
        px_per_unit=px_per_unit, unit_name=unit_name,
        positions_unit=positions_unit,
        peak_position_unit=peak_position_unit,
        dof_low_unit=dof_lo_unit, dof_high_unit=dof_hi_unit,
        dof_width_unit=width_unit,
    )


def _build_focus_heatmap(image: np.ndarray, *, step: int,
                         half_window: int, metric: str) -> np.ndarray:
    h, w = image.shape[:2]
    ys = np.arange(half_window, h - half_window, step)
    xs = np.arange(half_window, w - half_window, step)
    out = np.zeros((len(ys), len(xs)), dtype=np.float64)
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            out[iy, ix] = measure_focus(image, float(x), float(y),
                                        half_window=half_window,
                                        metric=metric)
    return out
