"""Fixed Pattern Noise (FPN) analysis on a single image / ROI.

Math overview
-------------
Given a 2-D image (or a rectangular ROI) we compute spatial-noise
statistics of the *kept* pixel set (after percentile outlier exclusion).

FPN metrics:
    DSNU (DN)        = std of pixel values across the ROI
    PRNU (%)         = 100 * std / mean   (relative pattern noise)
    Row noise (DN)   = std of row means
    Col noise (DN)   = std of col means
    Pixel noise (DN) = std of (image - row_mean - col_mean) — what's left
                       after subtracting row + column structure

We also build:
    - boolean mask of kept vs excluded pixels  (for live overlay)
    - 1-D row-mean and col-mean profiles + their stds
    - 2-D FPN map (image - global_mean), divergent display
    - log magnitude of the 2-D FFT (PSD) of the FPN map — periodic
      column / row patterns appear as bright lines in this map

ISP / smoothing controls (applied to the *measurement* image before
statistics, not the raw display unless requested):

    median_size:     0 / 3 / 5 / 7 — odd-window median filter
    gaussian_sigma:  0..10 px      — Gaussian smoothing σ
    hot_pixel_thr:   0..20         — replace pixels deviating > thr·σ
                                     from the local 3×3 median
    bilateral:       True / False  — small, edge-preserving smoothing
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

import numpy as np
from scipy.ndimage import gaussian_filter, median_filter


@dataclass
class FPNSettings:
    median_size: int = 0          # 0 = off, else odd
    gaussian_sigma: float = 0.0   # 0 = off
    hot_pixel_thr: float = 0.0    # 0 = off (in stddevs from local median)
    bilateral: bool = False       # cheap edge-preserving smoothing
    lo_pct: float = 0.0           # bottom-percentile pixels excluded
    hi_pct: float = 0.0           # top-percentile pixels excluded


@dataclass
class FPNResult:
    name: str                     # channel name like 'HG-G' or 'L'
    image: np.ndarray             # the measurement image (post-ISP), 2-D
    roi: Tuple[int, int, int, int]    # (y0, x0, y1, x1) in image coords
    mask_kept: np.ndarray         # boolean, True = kept after outlier cuts
    n_kept: int
    n_total: int

    # Statistics on KEPT pixels
    mean: float
    std: float
    minv: float
    maxv: float
    p1: float
    p99: float
    median: float

    # FPN metrics (DN units)
    dsnu_dn: float
    prnu_pct: float
    row_noise_dn: float
    col_noise_dn: float
    residual_pixel_noise_dn: float   # after removing row + col structure

    # Per-row, per-col profiles (only kept pixels averaged)
    row_means: np.ndarray
    row_stds: np.ndarray
    col_means: np.ndarray
    col_stds: np.ndarray

    # 2-D FPN map (image - global_mean of kept pixels, NaN where excluded)
    fpn_map: np.ndarray

    # 2-D PSD (log magnitude of FFT of fpn_map with NaN→0)
    psd_log: np.ndarray
    psd_extent: Tuple[float, float, float, float]   # for imshow extent

    # Settings used
    settings: FPNSettings = field(default_factory=FPNSettings)


# --- ISP --------------------------------------------------------------------

def _bilateral_simple(image: np.ndarray, sigma_s: float = 2.0,
                      sigma_r: float = 0.05) -> np.ndarray:
    """Lightweight bilateral via two Gaussian filters in normalized space.

    Not as good as a proper joint-domain bilateral, but cheap and edge-
    preserving enough for FPN previews."""
    a = image.astype(np.float64)
    span = float(a.max() - a.min()) or 1.0
    norm = (a - a.min()) / span
    smoothed = gaussian_filter(norm, sigma=sigma_s)
    detail = norm - smoothed
    # attenuate detail proportional to its magnitude (range filter)
    weight = np.exp(-(detail ** 2) / (2 * (sigma_r ** 2)))
    return (smoothed + detail * weight) * span + a.min()


def _hot_pixel_correct(image: np.ndarray,
                       thr_sigmas: float = 6.0) -> np.ndarray:
    """Replace pixels > thr·σ from a 3×3 median with that median.

    σ here is the global std after a 5×5 median (a robust noise floor).
    """
    a = image.astype(np.float64, copy=True)
    med3 = median_filter(a, size=3)
    med5 = median_filter(a, size=5)
    noise_std = float(np.std(a - med5)) or 1.0
    deviation = np.abs(a - med3)
    bad = deviation > (thr_sigmas * noise_std)
    a[bad] = med3[bad]
    return a


def apply_isp(image: np.ndarray, settings: FPNSettings) -> np.ndarray:
    """Apply the configured smoothing / hot-pixel chain. Returns float64."""
    out = image.astype(np.float64, copy=True)
    if settings.hot_pixel_thr > 0.5:
        out = _hot_pixel_correct(out, thr_sigmas=float(settings.hot_pixel_thr))
    if settings.bilateral:
        out = _bilateral_simple(out)
    if settings.median_size and settings.median_size >= 3:
        size = int(settings.median_size)
        if size % 2 == 0:
            size += 1
        out = median_filter(out, size=size)
    if settings.gaussian_sigma > 0.05:
        out = gaussian_filter(out, sigma=float(settings.gaussian_sigma))
    return out


# --- Outlier mask -----------------------------------------------------------

def percentile_mask(image: np.ndarray, lo_pct: float,
                    hi_pct: float) -> np.ndarray:
    """Boolean mask where True = pixel kept (within the percentile cuts)."""
    if lo_pct <= 0 and hi_pct <= 0:
        return np.ones(image.shape, dtype=bool)
    a = image.astype(np.float32, copy=False).ravel()
    lo = float(np.percentile(a, max(0.0, lo_pct))) if lo_pct > 0 else -np.inf
    hi = float(np.percentile(a, 100.0 - max(0.0, hi_pct))) if hi_pct > 0 else np.inf
    m = (image >= lo) & (image <= hi)
    return m


# --- Main ------------------------------------------------------------------

def compute_fpn(image: np.ndarray,
                *, name: str = "",
                roi: Optional[Tuple[int, int, int, int]] = None,
                settings: Optional[FPNSettings] = None,
                ) -> FPNResult:
    """Compute FPN statistics for an image (or roi sub-image).

    `roi` is (y0, x0, y1, x1) in original-image coords.
    """
    if settings is None:
        settings = FPNSettings()
    if roi is None:
        roi = (0, 0, int(image.shape[0]), int(image.shape[1]))
    y0, x0, y1, x1 = roi
    sub_raw = image[y0:y1, x0:x1].astype(np.float64, copy=False)
    if sub_raw.size == 0:
        raise ValueError("ROI has zero pixels")

    sub = apply_isp(sub_raw, settings)

    mask = percentile_mask(sub, settings.lo_pct, settings.hi_pct)
    n_total = int(sub.size)
    n_kept = int(mask.sum())
    if n_kept < 2:
        raise ValueError("After outlier exclusion fewer than 2 pixels remain — "
                         "loosen the percentile cuts.")

    kept = sub[mask]
    mean = float(kept.mean())
    std = float(kept.std(ddof=1))
    minv = float(kept.min())
    maxv = float(kept.max())
    p1 = float(np.percentile(kept, 1))
    p99 = float(np.percentile(kept, 99))
    median = float(np.median(kept))

    # Row/col profiles — average only over kept pixels per row / col
    sub_masked = np.where(mask, sub, np.nan)
    with np.errstate(invalid="ignore"):
        row_means = np.nanmean(sub_masked, axis=1)
        col_means = np.nanmean(sub_masked, axis=0)
        row_stds = np.nanstd(sub_masked, axis=1, ddof=1)
        col_stds = np.nanstd(sub_masked, axis=0, ddof=1)

    # FPN metrics
    dsnu_dn = std
    prnu_pct = 100.0 * std / mean if mean > 0 else 0.0
    row_noise_dn = float(np.nanstd(row_means, ddof=1))
    col_noise_dn = float(np.nanstd(col_means, ddof=1))
    # Residual: image - row_mean - col_mean + global_mean
    rm = np.where(np.isnan(row_means), 0.0, row_means)
    cm = np.where(np.isnan(col_means), 0.0, col_means)
    residual = sub_masked - rm[:, None] - cm[None, :] + mean
    residual_pixel_noise_dn = float(np.nanstd(residual, ddof=1))

    # 2-D FPN map (mean-centered)
    fpn_map = np.where(mask, sub - mean, np.nan)

    # 2-D PSD (NaN→0 first)
    fpn_for_fft = np.nan_to_num(fpn_map, nan=0.0)
    fft = np.fft.fftshift(np.fft.fft2(fpn_for_fft))
    psd = np.abs(fft) ** 2
    # log-scale, normalize for visibility
    psd_log = np.log10(psd + 1.0)
    h, w = sub.shape
    psd_extent = (-0.5, 0.5, -0.5, 0.5)  # cycles per pixel

    return FPNResult(
        name=name,
        image=sub, roi=roi, mask_kept=mask,
        n_kept=n_kept, n_total=n_total,
        mean=mean, std=std, minv=minv, maxv=maxv,
        p1=p1, p99=p99, median=median,
        dsnu_dn=dsnu_dn, prnu_pct=prnu_pct,
        row_noise_dn=row_noise_dn, col_noise_dn=col_noise_dn,
        residual_pixel_noise_dn=residual_pixel_noise_dn,
        row_means=row_means, row_stds=row_stds,
        col_means=col_means, col_stds=col_stds,
        fpn_map=fpn_map, psd_log=psd_log, psd_extent=psd_extent,
        settings=settings,
    )
