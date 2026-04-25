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

Research extras (dof-rewrite-v1):

    Gaussian fit         : scipy.optimize.curve_fit of
                           f(s) = A·exp(-(s-μ)²/(2σ²)) + b against the
                           line scan. `μ` is a parametric peak estimate
                           that's more robust than argmax; `σ` is
                           directly proportional to the optical circle-
                           of-confusion; FWHM = 2·√(2 ln 2)·σ ≈ 2.355·σ
                           gives a noise-resilient DoF estimate.
    Bootstrap CI         : percentile-bootstrap on the focus array
                           (B=200 by default) to deliver a 95% CI on
                           the peak position and DoF width. Big CIs
                           mean the ROI / exposure is too noisy.
    Multi-metric sweep   : same line scanned with all 4 metrics; if
                           the peak positions agree, the estimate is
                           robust; if they disagree, the image content
                           doesn't have enough fine detail for that
                           metric to discriminate focus.
    Per-channel compare  : `analyze_dof_multi` runs the full pipeline
                           across several channels in one call,
                           enabling chromatic-focus-shift detection.
    Tilt-plane fit       : `fit_focus_plane(points)` — least-squares
                           bilinear surface over (x, y, focus); the
                           slope gives the image-plane tilt direction.
    Stability curve      : `compute_dof_stability()` shrinks the line's
                           half-window to see if the DoF estimate is
                           window-size-dependent.

References:
    Pech-Pacheco et al., 2000 — Diatom Autofocusing (variance of Laplacian)
    Brenner et al., 1976 — Quantitative microscopy autofocus
    Pertuz et al., 2013 — Analysis of focus measure operators for SFF
    Edmund Optics — Depth of Field & Depth of Focus application note
    ISO 12233 — MTF / SFR (for the COC-from-Gaussian-σ interpretation)
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.ndimage import laplace, sobel

FOCUS_METRICS = ("laplacian", "brenner", "tenengrad", "fft_hf")


# ---------------------------------------------------------------------------
# Per-window focus metrics


def _window(image: np.ndarray, cx: float, cy: float, half: int) -> np.ndarray | None:
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
    dx = window[:, 2:] - window[:, :-2]
    dy = window[2:, :] - window[:-2, :]
    return float((dx**2).sum() + (dy**2).sum()) / float(window.size)


def focus_tenengrad(window: np.ndarray) -> float:
    if window is None or window.size == 0:
        return 0.0
    sx = sobel(window, axis=1, mode="reflect")
    sy = sobel(window, axis=0, mode="reflect")
    return float((sx**2 + sy**2).mean())


def focus_fft_hf(window: np.ndarray, *, hf_lo: float = 0.20, hf_hi: float = 0.50) -> float:
    """Fraction of spectral power in the high-frequency band [hf_lo, hf_hi]
    (cycles per pixel, isotropic)."""
    if window is None or window.size < 16:
        return 0.0
    a = window - window.mean()
    win2d = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fft = np.fft.fftshift(np.fft.fft2(a * win2d))
    mag = np.abs(fft) ** 2
    h, w = mag.shape
    cy = (h - 1) / 2.0
    cx = (w - 1) / 2.0
    yy, xx = np.indices(mag.shape).astype(np.float64)
    fy = (yy - cy) / max(1, h)
    fx = (xx - cx) / max(1, w)
    radial = np.hypot(fx, fy)
    band = (radial >= hf_lo) & (radial <= hf_hi)
    total = mag[radial <= hf_hi].sum()
    if total <= 0:
        return 0.0
    return float(mag[band].sum() / total)


def measure_focus(
    image: np.ndarray, cx: float, cy: float, *, half_window: int = 32, metric: str = "laplacian"
) -> float:
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


def measure_focus_all(
    image: np.ndarray, cx: float, cy: float, *, half_window: int = 32
) -> dict[str, float]:
    """Compute all four focus metrics against the same window in one pass.

    The window is extracted once and reused, which is cheaper than four
    independent ``measure_focus`` calls for long line scans.
    """
    win = _window(image, cx, cy, half_window)
    if win is None:
        return {m: 0.0 for m in FOCUS_METRICS}
    return {
        "laplacian": focus_laplacian(win),
        "brenner": focus_brenner(win),
        "tenengrad": focus_tenengrad(win),
        "fft_hf": focus_fft_hf(win),
    }


# ---------------------------------------------------------------------------
# Data classes


@dataclass
class DoFPoint:
    """One labeled focus probe."""

    x: float
    y: float
    label: str = ""
    z_um: float | None = None  # optional Z calibration


@dataclass
class DoFPointResult:
    point: DoFPoint
    focus: float
    focus_norm: float  # = focus / peak_focus (0..1)
    # All-metrics response at this point (dof-rewrite-v1). Present when
    # ``analyze_dof(..., compute_all_metrics=True)`` was used.
    focus_all: dict[str, float] | None = None


@dataclass
class GaussianFit:
    """Parametric fit ``A·exp(-(s-μ)²/(2σ²)) + b`` on a focus curve.

    ``converged`` is False when ``scipy.optimize.curve_fit`` raised or
    returned a degenerate σ; callers should fall back to the argmax /
    threshold-walk estimate in that case.
    """

    converged: bool
    amp: float  # A
    mu: float  # peak position
    sigma: float  # standard deviation (px along line)
    baseline: float  # b
    fwhm: float  # = 2·√(2·ln 2)·σ ≈ 2.355·σ
    r_squared: float  # goodness-of-fit in [0, 1]; NaN if undefined

    @classmethod
    def empty(cls) -> GaussianFit:
        nan = float("nan")
        return cls(False, nan, nan, nan, nan, nan, nan)


@dataclass
class DoFLineResult:
    """Sliding-window scan along a user-drawn line."""

    p0: tuple[float, float]
    p1: tuple[float, float]
    positions: np.ndarray  # distance from p0 along the line, in pixels
    focus: np.ndarray
    focus_norm: np.ndarray
    peak_idx: int
    peak_position_px: float
    dof_low_px: float | None  # left edge of focus band
    dof_high_px: float | None  # right edge
    dof_width_px: float | None

    # Physical-unit conversions (filled when calibration is present)
    px_per_unit: float | None = None  # px / unit ALONG this line
    unit_name: str | None = None
    positions_unit: np.ndarray | None = None
    peak_position_unit: float | None = None
    dof_low_unit: float | None = None
    dof_high_unit: float | None = None
    dof_width_unit: float | None = None

    # --- dof-rewrite-v1 extras ---------------------------------------------
    # Gaussian fit on ``focus`` vs ``positions``. Parametric peak / σ / FWHM
    # is usually a stabler DoF estimate than the argmax / threshold walk.
    gaussian: GaussianFit = field(default_factory=GaussianFit.empty)

    # Percentile bootstrap 95% CI (2.5th, 97.5th) on peak position + DoF
    # width. ``None`` when not requested or when the bootstrap failed.
    peak_ci95_px: tuple[float, float] | None = None
    dof_width_ci95_px: tuple[float, float] | None = None

    # All-metrics parallel scan. Keys are FOCUS_METRICS; values are dicts
    # with ``focus_norm`` (array), ``peak_position_px`` (float), and
    # ``dof_width_px`` (optional float) so the UI can show a single overlay
    # of every metric without a second request.
    metric_sweep: dict[str, dict[str, Any]] | None = None


@dataclass
class DoFChannelResult:
    name: str  # "HG-G", "L", etc.
    image: np.ndarray  # post-transform
    metric: str
    half_window: int
    threshold: float  # focus threshold (0..1)

    points: list[DoFPointResult]
    lines: list[DoFLineResult]

    # Optional overall focus heatmap (downsampled grid, for the heatmap tab)
    heatmap: np.ndarray | None = None
    heatmap_step: int = 32

    # Calibration carried through — None when uncalibrated. Per-axis
    # px/unit; the per-line conversion factor is in DoFLineResult.
    unit_name: str | None = None
    px_per_unit_h: float | None = None
    px_per_unit_v: float | None = None

    # dof-rewrite-v1: bilinear plane fit (z_of_focus = a + b·x + c·y) over
    # the picked points. ``None`` when < 3 points. Populated only when
    # ``analyze_dof(..., fit_tilt_plane=True)`` was used.
    tilt_plane: dict[str, Any] | None = None

    @property
    def color(self) -> str:
        from .plotting import _color

        return _color(self.name)

    @property
    def is_calibrated(self) -> bool:
        return self.px_per_unit_h is not None and self.px_per_unit_v is not None


# ---------------------------------------------------------------------------
# Gaussian fit + bootstrap helpers


def _gaussian_model(
    s: np.ndarray, amp: float, mu: float, sigma: float, baseline: float
) -> np.ndarray:
    return amp * np.exp(-((s - mu) ** 2) / (2.0 * sigma**2)) + baseline


def fit_gaussian(positions: np.ndarray, focus: np.ndarray) -> GaussianFit:
    """Least-squares Gaussian fit on a focus curve.

    Returns a ``GaussianFit`` with ``converged=False`` on failure so
    callers can fall back to the argmax estimate.
    """
    try:
        from scipy.optimize import curve_fit
    except Exception:
        return GaussianFit.empty()
    if positions.size < 5 or focus.size != positions.size:
        return GaussianFit.empty()
    s = positions.astype(np.float64)
    y = focus.astype(np.float64)
    if not np.all(np.isfinite(y)) or float(y.max()) <= 0:
        return GaussianFit.empty()
    # Initial guess: baseline = min, amp = max - min, μ = argmax, σ = span / 6.
    b0 = float(np.percentile(y, 10))
    a0 = max(1e-9, float(y.max()) - b0)
    mu0 = float(s[int(np.argmax(y))])
    sigma0 = max(1e-3, (float(s[-1]) - float(s[0])) / 6.0)
    try:
        popt, _pcov = curve_fit(
            _gaussian_model,
            s,
            y,
            p0=(a0, mu0, sigma0, b0),
            bounds=(
                (0.0, float(s[0]) - sigma0 * 6, 1e-6, -abs(a0) * 2),
                (
                    a0 * 6 + 1e-9,
                    float(s[-1]) + sigma0 * 6,
                    (float(s[-1]) - float(s[0])) * 2 + 1.0,
                    a0 * 6 + 1e-9,
                ),
            ),
            maxfev=6000,
        )
    except Exception:
        return GaussianFit.empty()
    amp, mu, sigma, baseline = (float(v) for v in popt)
    if not np.isfinite(sigma) or sigma <= 0:
        return GaussianFit.empty()
    yhat = _gaussian_model(s, amp, mu, sigma, baseline)
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2)) or 1e-9
    r2 = max(0.0, 1.0 - ss_res / ss_tot)
    fwhm = 2.0 * np.sqrt(2.0 * np.log(2.0)) * sigma
    return GaussianFit(
        converged=True,
        amp=amp,
        mu=mu,
        sigma=sigma,
        baseline=baseline,
        fwhm=fwhm,
        r_squared=r2,
    )


def _bootstrap_peak_and_dof(
    positions: np.ndarray,
    focus: np.ndarray,
    threshold: float,
    n_boot: int = 200,
    seed: int = 1234,
) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    """Percentile bootstrap on (peak_position_px, dof_width_px).

    Resamples the (positions, focus) pairs WITH REPLACEMENT `n_boot`
    times; re-sorts each resample by position to keep the left→right
    threshold walk consistent, then records the argmax position + the
    DoF width at `threshold`. Returns two 95% CIs (or None when
    degenerate).
    """
    if positions.size < 8 or focus.size != positions.size:
        return None, None
    rng = np.random.default_rng(seed)
    peaks: list[float] = []
    widths: list[float] = []
    n = positions.size
    for _ in range(int(max(50, n_boot))):
        idx = rng.integers(0, n, size=n)
        s = positions[idx]
        y = focus[idx]
        order = np.argsort(s, kind="mergesort")
        s = s[order]
        y = y[order]
        y_max = float(y.max())
        if y_max <= 0:
            continue
        yn = y / y_max
        k = int(np.argmax(yn))
        peaks.append(float(s[k]))
        # Walk out for threshold crossings.
        lo_i = None
        for j in range(k, -1, -1):
            if yn[j] < threshold:
                lo_i = j
                break
        hi_i = None
        for j in range(k, n):
            if yn[j] < threshold:
                hi_i = j
                break
        if lo_i is not None and hi_i is not None:
            widths.append(float(s[hi_i] - s[lo_i]))

    def _ci(arr: list[float]) -> tuple[float, float] | None:
        if len(arr) < 20:
            return None
        a = np.asarray(arr, dtype=np.float64)
        return float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))

    return _ci(peaks), _ci(widths)


# ---------------------------------------------------------------------------
# Per-channel analysis


def analyze_dof(
    image: np.ndarray,
    *,
    name: str,
    points: Sequence[DoFPoint],
    lines: Sequence[tuple[tuple[float, float], tuple[float, float]]] = (),
    metric: str = "laplacian",
    half_window: int = 32,
    threshold: float = 0.5,
    line_step_px: float = 4.0,
    build_heatmap: bool = True,
    heatmap_step: int = 48,
    calibration: dict | None = None,
    compute_all_metrics: bool = False,
    bootstrap: bool = False,
    n_boot: int = 200,
    fit_tilt_plane: bool = False,
) -> DoFChannelResult:
    """Compute focus values at every picked point + along each line.

    ``calibration`` (optional): dict with keys ``unit``, ``px_per_unit_h``,
    ``px_per_unit_v``. When all three are present, every line's results
    will be available in physical units in addition to pixels.

    ``compute_all_metrics`` — also scan each line with the three other
    focus metrics; each ``DoFLineResult`` gets a ``metric_sweep`` dict.
    Per-point we also fill ``DoFPointResult.focus_all``.
    ``bootstrap`` — attach a percentile-bootstrap 95% CI on each line's
    peak position + DoF width. Adds O(`n_boot` · N_samples) work per
    line; safe for small N.
    ``fit_tilt_plane`` — bilinear least-squares fit on
    ``(x, y, focus_norm)`` over the picked points; included on the
    ``DoFChannelResult`` as ``tilt_plane``.
    """
    # Points — primary metric
    pt_focus = [
        measure_focus(image, p.x, p.y, half_window=half_window, metric=metric) for p in points
    ]
    peak_pt = max(pt_focus) if pt_focus else 0.0
    pt_results: list[DoFPointResult] = []
    for p, f in zip(points, pt_focus, strict=False):
        all_metrics = (
            measure_focus_all(image, p.x, p.y, half_window=half_window)
            if compute_all_metrics
            else None
        )
        pt_results.append(
            DoFPointResult(
                point=p,
                focus=f,
                focus_norm=(f / peak_pt) if peak_pt > 0 else 0.0,
                focus_all=all_metrics,
            )
        )

    # Lines
    line_results: list[DoFLineResult] = []
    for p0, p1 in lines:
        lr = _scan_line(
            image,
            p0,
            p1,
            step_px=line_step_px,
            half_window=half_window,
            metric=metric,
            threshold=threshold,
            calibration=calibration,
        )
        # Gaussian fit on primary metric
        lr.gaussian = fit_gaussian(lr.positions, lr.focus)
        # Bootstrap CI
        if bootstrap:
            peak_ci, width_ci = _bootstrap_peak_and_dof(
                lr.positions,
                lr.focus,
                float(threshold),
                n_boot=int(n_boot),
            )
            lr.peak_ci95_px = peak_ci
            lr.dof_width_ci95_px = width_ci
        # All-metrics sweep — separate scan per metric
        if compute_all_metrics:
            sweep: dict[str, dict[str, Any]] = {}
            for m in FOCUS_METRICS:
                if m == metric:
                    # Re-use the primary scan so we don't duplicate work.
                    sweep[m] = {
                        "focus_norm": lr.focus_norm.tolist(),
                        "focus": lr.focus.tolist(),
                        "peak_position_px": float(lr.peak_position_px),
                        "dof_width_px": lr.dof_width_px,
                    }
                    continue
                alt = _scan_line(
                    image,
                    p0,
                    p1,
                    step_px=line_step_px,
                    half_window=half_window,
                    metric=m,
                    threshold=threshold,
                    calibration=calibration,
                )
                sweep[m] = {
                    "focus_norm": alt.focus_norm.tolist(),
                    "focus": alt.focus.tolist(),
                    "peak_position_px": float(alt.peak_position_px),
                    "dof_width_px": alt.dof_width_px,
                }
            lr.metric_sweep = sweep
        line_results.append(lr)

    # Heatmap (optional, for the focus-map tab)
    heatmap = None
    if build_heatmap:
        heatmap = _build_focus_heatmap(
            image, step=heatmap_step, half_window=half_window, metric=metric
        )

    cal = calibration or {}
    tilt = None
    if fit_tilt_plane and len(pt_results) >= 3:
        tilt = fit_focus_plane(pt_results)

    return DoFChannelResult(
        name=name,
        image=image,
        metric=metric,
        half_window=half_window,
        threshold=threshold,
        points=pt_results,
        lines=line_results,
        heatmap=heatmap,
        heatmap_step=heatmap_step,
        unit_name=cal.get("unit"),
        px_per_unit_h=cal.get("px_per_unit_h"),
        px_per_unit_v=cal.get("px_per_unit_v"),
        tilt_plane=tilt,
    )


def analyze_dof_multi(
    channel_images: dict[str, np.ndarray],
    *,
    points: Sequence[DoFPoint],
    lines: Sequence[tuple[tuple[float, float], tuple[float, float]]] = (),
    metric: str = "laplacian",
    half_window: int = 32,
    threshold: float = 0.5,
    line_step_px: float = 4.0,
    build_heatmap: bool = True,
    heatmap_step: int = 48,
    calibration: dict | None = None,
    compute_all_metrics: bool = False,
    bootstrap: bool = False,
    n_boot: int = 200,
    fit_tilt_plane: bool = False,
) -> list[DoFChannelResult]:
    """Run ``analyze_dof`` across several channels of the same source.

    Used by the multi-channel analysis modal to produce chromatic-
    focus-shift comparisons without round-tripping per channel.
    """
    out: list[DoFChannelResult] = []
    for name, image in channel_images.items():
        out.append(
            analyze_dof(
                image,
                name=name,
                points=points,
                lines=lines,
                metric=metric,
                half_window=half_window,
                threshold=threshold,
                line_step_px=line_step_px,
                build_heatmap=build_heatmap,
                heatmap_step=heatmap_step,
                calibration=calibration,
                compute_all_metrics=compute_all_metrics,
                bootstrap=bootstrap,
                n_boot=n_boot,
                fit_tilt_plane=fit_tilt_plane,
            )
        )
    return out


def compute_dof_stability(
    image: np.ndarray,
    *,
    p0: tuple[float, float],
    p1: tuple[float, float],
    metric: str = "laplacian",
    threshold: float = 0.5,
    line_step_px: float = 4.0,
    windows: Sequence[int] = (12, 16, 24, 32, 48, 64),
) -> list[dict[str, Any]]:
    """Scan the same line across several half-window sizes and report
    peak / width for each. A stability plateau = the DoF number is
    well-bounded; a monotonic rise means the window is still too small."""
    out: list[dict[str, Any]] = []
    for hw in windows:
        try:
            scan = _scan_line(
                image,
                p0,
                p1,
                step_px=float(line_step_px),
                half_window=int(hw),
                metric=metric,
                threshold=float(threshold),
                calibration=None,
            )
            out.append(
                {
                    "half_window": int(hw),
                    "peak_position_px": float(scan.peak_position_px),
                    "dof_width_px": None if scan.dof_width_px is None else float(scan.dof_width_px),
                    "focus_norm_peak": float(scan.focus_norm.max())
                    if scan.focus_norm.size
                    else 0.0,
                }
            )
        except Exception:
            out.append(
                {
                    "half_window": int(hw),
                    "peak_position_px": float("nan"),
                    "dof_width_px": None,
                    "focus_norm_peak": 0.0,
                }
            )
    return out


def fit_focus_plane(points: Sequence[DoFPointResult]) -> dict[str, Any] | None:
    """Least-squares bilinear fit ``focus_norm = a + b·x + c·y`` over the
    picked points. Returns None when < 3 points or the design matrix is
    degenerate. The slope direction `(b, c)` points uphill toward the
    best-focus region; a flat plane (`|b|, |c|` both ~ 0) means the
    image has no tilt across the picked region.

    Also returns a 2-D `grid` (downsampled to keep payloads small) so
    the frontend can draw an iso-contour overlay on top of the channel
    thumbnail.
    """
    if len(points) < 3:
        return None
    xs = np.array([p.point.x for p in points], dtype=np.float64)
    ys = np.array([p.point.y for p in points], dtype=np.float64)
    fs = np.array([p.focus_norm for p in points], dtype=np.float64)
    A = np.stack([np.ones_like(xs), xs, ys], axis=-1)
    try:
        coeffs, *_ = np.linalg.lstsq(A, fs, rcond=None)
    except Exception:
        return None
    a, b, c = (float(v) for v in coeffs)
    # Residuals
    pred = a + b * xs + c * ys
    ss_res = float(np.sum((fs - pred) ** 2))
    ss_tot = float(np.sum((fs - fs.mean()) ** 2)) or 1e-9
    r2 = max(0.0, 1.0 - ss_res / ss_tot)
    # Tilt angle in degrees (atan2 on gradient magnitude vs 1 px unit).
    slope_mag_per_px = float(np.hypot(b, c))
    tilt_direction_deg = float(np.degrees(np.arctan2(c, b)))
    return {
        "a": a,
        "b": b,
        "c": c,
        "slope_mag_per_px": slope_mag_per_px,
        "tilt_direction_deg": tilt_direction_deg,
        "r_squared": r2,
        "residuals": [float(v) for v in (fs - pred).tolist()],
        "x_range": [float(xs.min()), float(xs.max())],
        "y_range": [float(ys.min()), float(ys.max())],
    }


# ---------------------------------------------------------------------------
# Internal helpers


def _scan_line(
    image: np.ndarray,
    p0: tuple[float, float],
    p1: tuple[float, float],
    *,
    step_px: float,
    half_window: int,
    metric: str,
    threshold: float,
    calibration: dict | None = None,
) -> DoFLineResult:
    x0, y0 = p0
    x1, y1 = p1
    L = float(np.hypot(x1 - x0, y1 - y0))
    n = max(2, int(np.ceil(L / max(0.5, float(step_px)))))
    ts = np.linspace(0.0, 1.0, n)
    xs = x0 + ts * (x1 - x0)
    ys = y0 + ts * (y1 - y0)
    positions = ts * L

    focus = np.array(
        [
            measure_focus(image, float(x), float(y), half_window=half_window, metric=metric)
            for x, y in zip(xs, ys, strict=False)
        ]
    )
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
        p0=(float(x0), float(y0)),
        p1=(float(x1), float(y1)),
        positions=positions,
        focus=focus,
        focus_norm=focus_norm,
        peak_idx=peak_idx,
        peak_position_px=peak_position,
        dof_low_px=dof_lo,
        dof_high_px=dof_hi,
        dof_width_px=width,
        px_per_unit=px_per_unit,
        unit_name=unit_name,
        positions_unit=positions_unit,
        peak_position_unit=peak_position_unit,
        dof_low_unit=dof_lo_unit,
        dof_high_unit=dof_hi_unit,
        dof_width_unit=width_unit,
    )


def _build_focus_heatmap(
    image: np.ndarray, *, step: int, half_window: int, metric: str
) -> np.ndarray:
    h, w = image.shape[:2]
    ys = np.arange(half_window, h - half_window, step)
    xs = np.arange(half_window, w - half_window, step)
    out = np.zeros((len(ys), len(xs)), dtype=np.float64)
    for iy, y in enumerate(ys):
        for ix, x in enumerate(xs):
            out[iy, ix] = measure_focus(
                image, float(x), float(y), half_window=half_window, metric=metric
            )
    return out
