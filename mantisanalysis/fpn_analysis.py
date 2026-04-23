"""Fixed Pattern Noise (FPN) analysis on a single image / ROI.

Math overview
-------------
Given a 2-D image (or a rectangular ROI) we compute spatial-noise
statistics of the *kept* pixel set (after percentile outlier exclusion
and optional drift-plane removal).

EMVA-1288–aligned headline metrics:

    DSNU  (DN)           = std of pixel values across the ROI
    PRNU  (%)            = 100 * std / mean           (relative pattern noise)
    σ_row (DN)           = std of row means           (row-banding)
    σ_col (DN)           = std of col means           (col-banding)
    σ_residual (DN)      = std of (image - row - col) (what's left)
    DSNU_row_only (DN)   = std after subtracting row structure only
    DSNU_col_only (DN)   = std after subtracting col structure only
    hot-pixel count      = pixels with |(x-μ)/σ| > hot_sigma

Research extras:

    2-D  autocorrelation = inverse FFT of |F(fpn_map)|²,       normalized
    1-D  row PSD         = |FFT(row_means - μ)|² at 0..½ cy/row
    1-D  col PSD         = |FFT(col_means - μ)|² at 0..½ cy/col
    row_peak_freq        = argmax of row PSD (excl. DC) in cy/row
    col_peak_freq        = argmax of col PSD (excl. DC) in cy/col
    drift plane          = optional bilinear / biquadratic surface fit
                           subtracted BEFORE the stats (separates
                           illumination roll-off from true FPN)

ISP / smoothing controls (applied to the *measurement* image before
statistics, not the raw display unless requested):

    median_size:     0 / 3 / 5 / 7 — odd-window median filter
    gaussian_sigma:  0..10 px      — Gaussian smoothing σ
    hot_pixel_thr:   0..20         — replace pixels deviating > thr·σ
                                     from the local 3×3 median
    bilateral:       True / False  — small, edge-preserving smoothing
    drift_order:     'none'/'bilinear'/'biquadratic' — plane subtraction
                                     before stats
    hot_sigma:       0..20         — |z|-threshold for reporting hot / cold
                                     outliers in the map (after drift removal)

The analysis module stays pure NumPy / SciPy (see AGENT_RULES #7) so it
can be unit-tested headless and called from a FastAPI endpoint without
any UI / Qt imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

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
    drift_order: str = "none"     # 'none' | 'bilinear' | 'biquadratic'
    hot_sigma: float = 4.0        # |z|-threshold for the hot-pixel map


@dataclass
class FPNResult:
    """Full FPN analysis result for one ROI on one channel.

    The ``image`` / ``fpn_map`` / ``autocorr_2d`` / ``psd_log`` arrays
    are the sub-ROI size (not the whole channel). ``roi`` is carried so
    the frontend can locate them in the source image.
    """

    # Identity / inputs
    name: str                         # channel name like 'HG-G' or 'L'
    image: np.ndarray                 # the measurement image (post-ISP, post-drift), 2-D
    raw_image: np.ndarray             # the measurement image BEFORE drift-plane removal
    roi: Tuple[int, int, int, int]    # (y0, x0, y1, x1) in original-image coords
    mask_kept: np.ndarray             # boolean, True = kept after outlier cuts
    n_kept: int
    n_total: int

    # Distribution statistics on KEPT pixels (after drift removal).
    # `mean` is ~0 when drift subtraction is active — that's expected,
    # because drift removal centers the residual. `mean_signal` is the
    # mean of the pre-drift ROI (what the sensor actually reads out) and
    # is what PRNU is normalized against.
    mean: float
    mean_signal: float
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
    residual_pixel_noise_dn: float   # after subtracting row + col structure
    dsnu_row_only_dn: float          # after subtracting row structure only
    dsnu_col_only_dn: float          # after subtracting col structure only

    # Per-row, per-col profiles (only kept pixels averaged)
    row_means: np.ndarray
    row_stds: np.ndarray
    col_means: np.ndarray
    col_stds: np.ndarray

    # 2-D FPN map (image - global_mean of kept pixels, NaN where excluded)
    fpn_map: np.ndarray

    # 2-D PSD (log magnitude of FFT of fpn_map with NaN→0)
    psd_log: np.ndarray
    psd_extent: Tuple[float, float, float, float]   # for imshow extent (cy/px)

    # Normalized 2-D autocorrelation (-1..1). Lag 0 is at the center. See
    # `_autocorr_from_fpn_map`. Structured patterns appear as regular peaks.
    autocorr_2d: np.ndarray
    autocorr_extent: Tuple[float, float, float, float]  # (-max_lag, max_lag, ...)

    # 1-D PSDs of row-mean and col-mean series (not the 2-D projection —
    # this is a 1-D FFT of an already-averaged signal). Useful for spotting
    # periodic row-banding / column clocking artifacts.
    row_psd: np.ndarray
    col_psd: np.ndarray
    row_freq: np.ndarray   # cycles per row index
    col_freq: np.ndarray   # cycles per col index
    row_peak_freq: float   # dominant non-DC row frequency
    col_peak_freq: float   # dominant non-DC col frequency
    row_peak_amp: float    # amplitude at the peak frequency
    col_peak_amp: float

    # Hot / cold pixel map (boolean mask where |z| > hot_sigma, where z is
    # computed over the kept-pixel distribution post-drift-removal)
    hot_pixel_mask: np.ndarray
    hot_pixel_count: int
    cold_pixel_count: int
    # Lists of (y, x, DN, z) tuples for the top-50 hottest + top-50 coldest
    # outliers. Everything downstream of this comes over JSON so we cap the
    # list lengths here to keep the response bounded.
    top_hot: List[Tuple[int, int, float, float]]
    top_cold: List[Tuple[int, int, float, float]]

    # Drift plane (linear or quadratic surface) subtracted from `image`
    # before the stats were computed. `drift_plane` is the subtracted
    # array itself (all-zeros when `drift_order='none'`); useful for the
    # "show me the separated roll-off" inspection tab.
    drift_plane: np.ndarray
    drift_order: str

    # Pixel-value histogram of the kept ROI (PRE-drift-removal — i.e. the
    # raw DN distribution the user sees on the canvas). 256 bins span the
    # ROI's actual min..max DN. The frontend uses this for the histogram
    # tab in the analysis modal; sized to keep the JSON response bounded.
    hist_bin_edges: np.ndarray   # length 257, DN units
    hist_counts: np.ndarray      # length 256, integer counts

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


# --- Drift-plane removal ----------------------------------------------------

def _fit_drift_plane(image: np.ndarray, mask: np.ndarray,
                     order: str) -> np.ndarray:
    """Fit a low-order polynomial surface to `image[mask]` and return the
    evaluated surface at every (y, x). `order` is 'bilinear' (1 + x + y +
    xy) or 'biquadratic' (1 + x + y + x² + y² + xy).

    A bilinear surface catches simple illumination tilts (top-edge bright,
    bottom-edge dark); biquadratic catches vignette-style parabolic
    roll-off. Separating these from the FPN stats is how we report
    *pattern noise* without confounding illumination drift.
    """
    if order == "none" or not mask.any():
        return np.zeros_like(image, dtype=np.float64)
    h, w = image.shape
    # Normalize coordinates to [-1, 1] so the design matrix is well-conditioned.
    ys, xs = np.indices(image.shape, dtype=np.float64)
    xn = (xs / max(1, (w - 1))) * 2.0 - 1.0
    yn = (ys / max(1, (h - 1))) * 2.0 - 1.0
    if order == "bilinear":
        # 1, x, y, x*y
        X = np.stack([np.ones_like(xn), xn, yn, xn * yn], axis=-1)
    elif order == "biquadratic":
        # 1, x, y, x², y², x*y
        X = np.stack([np.ones_like(xn), xn, yn, xn * xn, yn * yn, xn * yn],
                     axis=-1)
    else:
        return np.zeros_like(image, dtype=np.float64)
    X_flat = X.reshape(-1, X.shape[-1])
    m_flat = mask.ravel()
    A = X_flat[m_flat]
    b = image.astype(np.float64).ravel()[m_flat]
    if A.shape[0] < A.shape[1] + 1:
        # Underdetermined — fall back to zero surface.
        return np.zeros_like(image, dtype=np.float64)
    coeffs, *_ = np.linalg.lstsq(A, b, rcond=None)
    return (X_flat @ coeffs).reshape(image.shape)


# --- Autocorrelation / PSD -------------------------------------------------

def _autocorr_from_fpn_map(fpn_map: np.ndarray) -> np.ndarray:
    """Normalized 2-D autocorrelation of the mean-centered FPN map.

    Computes autocorrelation via the Wiener–Khinchin theorem:
    autocorr = IFFT(|FFT(x)|²). Normalized so autocorr[0, 0] = 1.
    """
    x = np.nan_to_num(fpn_map, nan=0.0)
    if not np.any(x):
        return np.zeros_like(x)
    F = np.fft.fft2(x)
    psd = (np.abs(F) ** 2)
    ac = np.fft.ifft2(psd).real
    ac = np.fft.fftshift(ac)
    peak = ac.flat[ac.size // 2 + ac.shape[1] // 2] if ac.ndim == 2 else ac.max()
    # Safer: explicit center index.
    cy, cx = ac.shape[0] // 2, ac.shape[1] // 2
    center = float(ac[cy, cx])
    if center != 0:
        ac = ac / center
    return ac


def _row_col_1d_psd(arr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """1-D PSD of a length-N series. Returns (freq, psd) at 0..½ cy.

    NaNs (from rows/cols that were fully excluded) are zero-filled so the
    FFT is well-defined. The DC component is kept so the caller can report
    the mean level if desired, but the `*_peak_freq` helpers exclude it.
    """
    if arr.size < 2:
        return np.zeros(0), np.zeros(0)
    a = np.where(np.isfinite(arr), arr, 0.0).astype(np.float64)
    a = a - float(np.nanmean(arr))  # detrend against the nan-aware mean
    N = a.size
    F = np.fft.rfft(a)
    psd = (np.abs(F) ** 2) / max(1, N)
    freq = np.fft.rfftfreq(N, d=1.0)
    return freq, psd


def _peak_non_dc(freq: np.ndarray, psd: np.ndarray) -> Tuple[float, float]:
    """Return (peak_freq, peak_amp) excluding the DC bin."""
    if psd.size <= 1:
        return 0.0, 0.0
    # Skip bin 0 (DC). argmax over the remainder.
    idx = int(np.argmax(psd[1:])) + 1
    return float(freq[idx]), float(psd[idx])


# --- Hot pixel detection ----------------------------------------------------

def _find_hot_pixels(image: np.ndarray, mask_kept: np.ndarray,
                     hot_sigma: float) -> Tuple[np.ndarray, int, int,
                                                List[Tuple[int, int, float, float]],
                                                List[Tuple[int, int, float, float]]]:
    """Flag pixels whose |z|-score against the kept-distribution exceeds
    `hot_sigma`. Returns (mask, hot_count, cold_count, top_hot, top_cold).
    """
    kept = image[mask_kept]
    if kept.size < 2 or hot_sigma <= 0:
        return (np.zeros(image.shape, dtype=bool), 0, 0, [], [])
    mu = float(kept.mean())
    sd = float(kept.std(ddof=1)) or 1.0
    z = (image - mu) / sd
    hot_mask = np.abs(z) > hot_sigma
    # Don't flag pixels that were already outlier-excluded; those are
    # reported via `n_total - n_kept` separately.
    hot_mask &= mask_kept
    hot_count = int(((z > hot_sigma) & mask_kept).sum())
    cold_count = int(((z < -hot_sigma) & mask_kept).sum())

    top_hot: List[Tuple[int, int, float, float]] = []
    top_cold: List[Tuple[int, int, float, float]] = []
    if hot_count + cold_count:
        # argsort on flat z, keep top-50 highest + top-50 lowest that are
        # actually in hot_mask.
        flat_z = z.ravel()
        flat_img = image.ravel()
        flat_mask = hot_mask.ravel()
        H, W = image.shape
        # Hot (highest z): only take those in mask
        cand_hot = np.where(flat_mask & (flat_z > hot_sigma))[0]
        if cand_hot.size:
            order = cand_hot[np.argsort(-flat_z[cand_hot])][:50]
            for k in order:
                yy, xx = divmod(int(k), W)
                top_hot.append((int(yy), int(xx), float(flat_img[k]),
                                float(flat_z[k])))
        cand_cold = np.where(flat_mask & (flat_z < -hot_sigma))[0]
        if cand_cold.size:
            order = cand_cold[np.argsort(flat_z[cand_cold])][:50]
            for k in order:
                yy, xx = divmod(int(k), W)
                top_cold.append((int(yy), int(xx), float(flat_img[k]),
                                 float(flat_z[k])))
    return hot_mask, hot_count, cold_count, top_hot, top_cold


# --- Main ------------------------------------------------------------------

def compute_fpn(image: np.ndarray,
                *, name: str = "",
                roi: Optional[Tuple[int, int, int, int]] = None,
                settings: Optional[FPNSettings] = None,
                ) -> FPNResult:
    """Compute FPN statistics for an image (or roi sub-image).

    `roi` is (y0, x0, y1, x1) in original-image coords.

    Processing pipeline:
        1. Slice sub = image[y0:y1, x0:x1].
        2. Apply ISP (hot-pixel, bilateral, median, gaussian) → `sub_raw`.
        3. Compute percentile keep-mask.
        4. Fit + subtract drift-plane (bilinear / biquadratic) if requested.
        5. Compute kept-pixel summary statistics, row/col profiles,
           DSNU/PRNU, row-only and col-only DSNU variants.
        6. Compute 2-D FPN map, 2-D PSD (log), 2-D autocorrelation.
        7. Compute 1-D row + col PSDs with peak-frequency extraction.
        8. Flag hot/cold pixels at `settings.hot_sigma`.
    """
    if settings is None:
        settings = FPNSettings()
    if roi is None:
        roi = (0, 0, int(image.shape[0]), int(image.shape[1]))
    y0, x0, y1, x1 = roi
    sub_raw = image[y0:y1, x0:x1].astype(np.float64, copy=False)
    if sub_raw.size == 0:
        raise ValueError("ROI has zero pixels")

    # 2. ISP pre-stage (float64 output).
    sub_pre_drift = apply_isp(sub_raw, settings)

    # 3. Percentile mask is computed BEFORE drift-plane fit so that the
    # plane fit isn't biased by a bright corner / hot-pixel blob.
    mask = percentile_mask(sub_pre_drift, settings.lo_pct, settings.hi_pct)
    n_total = int(sub_pre_drift.size)
    n_kept = int(mask.sum())
    if n_kept < 2:
        raise ValueError("After outlier exclusion fewer than 2 pixels remain — "
                         "loosen the percentile cuts.")

    # 4. Drift-plane (optional). The fit uses only kept pixels so outliers
    # can't warp the surface; the plane is then evaluated over ALL pixels
    # and subtracted so the mask-relative coordinates remain consistent.
    drift_order = str(settings.drift_order or "none").lower()
    drift_plane = _fit_drift_plane(sub_pre_drift, mask, drift_order)
    sub = sub_pre_drift - drift_plane

    kept = sub[mask]
    kept_signal = sub_pre_drift[mask]
    mean = float(kept.mean())
    mean_signal = float(kept_signal.mean())
    std = float(kept.std(ddof=1))
    minv = float(kept.min())
    maxv = float(kept.max())
    p1 = float(np.percentile(kept, 1))
    p99 = float(np.percentile(kept, 99))
    median = float(np.median(kept))

    # 5. Row/col profiles — average only over kept pixels per row/col.
    sub_masked = np.where(mask, sub, np.nan)
    with np.errstate(invalid="ignore"):
        row_means = np.nanmean(sub_masked, axis=1)
        col_means = np.nanmean(sub_masked, axis=0)
        row_stds = np.nanstd(sub_masked, axis=1, ddof=1)
        col_stds = np.nanstd(sub_masked, axis=0, ddof=1)

    # FPN metrics.
    # PRNU is defined as σ_spatial / mean_signal — it must use the
    # pre-drift mean, because drift removal centers the residual at ~0 DN.
    dsnu_dn = std
    prnu_pct = 100.0 * std / mean_signal if mean_signal > 0 else 0.0
    row_noise_dn = float(np.nanstd(row_means, ddof=1))
    col_noise_dn = float(np.nanstd(col_means, ddof=1))
    rm = np.where(np.isnan(row_means), 0.0, row_means)
    cm = np.where(np.isnan(col_means), 0.0, col_means)
    # Residual (row + col) stripped:
    residual = sub_masked - rm[:, None] - cm[None, :] + mean
    residual_pixel_noise_dn = float(np.nanstd(residual, ddof=1))
    # Row-only stripped (σ after subtracting row means):
    row_only_residual = sub_masked - rm[:, None] + mean
    dsnu_row_only_dn = float(np.nanstd(row_only_residual, ddof=1))
    # Col-only stripped (σ after subtracting col means):
    col_only_residual = sub_masked - cm[None, :] + mean
    dsnu_col_only_dn = float(np.nanstd(col_only_residual, ddof=1))

    # 6. 2-D FPN map (mean-centered on kept pixels). `sub` is already
    # drift-removed, so `sub - mean` is the residual pattern noise.
    fpn_map = np.where(mask, sub - mean, np.nan)

    # 2-D PSD (NaN→0 first)
    fpn_for_fft = np.nan_to_num(fpn_map, nan=0.0)
    fft = np.fft.fftshift(np.fft.fft2(fpn_for_fft))
    psd = np.abs(fft) ** 2
    psd_log = np.log10(psd + 1.0)
    psd_extent = (-0.5, 0.5, -0.5, 0.5)  # cycles per pixel

    # 2-D autocorrelation
    autocorr_2d = _autocorr_from_fpn_map(fpn_map)
    ah, aw = autocorr_2d.shape
    autocorr_extent = (-aw / 2.0, aw / 2.0, -ah / 2.0, ah / 2.0)

    # 7. 1-D PSDs
    row_freq, row_psd = _row_col_1d_psd(row_means)
    col_freq, col_psd = _row_col_1d_psd(col_means)
    row_peak_freq, row_peak_amp = _peak_non_dc(row_freq, row_psd)
    col_peak_freq, col_peak_amp = _peak_non_dc(col_freq, col_psd)

    # 8. Hot/cold pixels
    hot_mask, hot_count, cold_count, top_hot, top_cold = _find_hot_pixels(
        sub, mask, float(settings.hot_sigma),
    )

    # 9. Pixel-value histogram of the kept ROI (PRE-drift, since the user
    #    cares about the raw DN distribution, not the residual centered
    #    near zero). 256 bins span the kept-pixel min..max so the histogram
    #    auto-adapts to whatever DR / bit-depth the channel actually uses.
    kept_pre_drift = sub_pre_drift[mask]
    if kept_pre_drift.size > 0:
        lo_h = float(kept_pre_drift.min())
        hi_h = float(kept_pre_drift.max())
        if hi_h <= lo_h:
            hi_h = lo_h + 1.0
        hist_counts_arr, hist_bin_edges_arr = np.histogram(
            kept_pre_drift, bins=256, range=(lo_h, hi_h)
        )
    else:
        hist_bin_edges_arr = np.linspace(0.0, 1.0, 257)
        hist_counts_arr = np.zeros(256, dtype=np.int64)

    return FPNResult(
        name=name,
        image=sub, raw_image=sub_pre_drift, roi=roi, mask_kept=mask,
        n_kept=n_kept, n_total=n_total,
        mean=mean, mean_signal=mean_signal, std=std, minv=minv, maxv=maxv,
        p1=p1, p99=p99, median=median,
        dsnu_dn=dsnu_dn, prnu_pct=prnu_pct,
        row_noise_dn=row_noise_dn, col_noise_dn=col_noise_dn,
        residual_pixel_noise_dn=residual_pixel_noise_dn,
        dsnu_row_only_dn=dsnu_row_only_dn,
        dsnu_col_only_dn=dsnu_col_only_dn,
        row_means=row_means, row_stds=row_stds,
        col_means=col_means, col_stds=col_stds,
        fpn_map=fpn_map, psd_log=psd_log, psd_extent=psd_extent,
        autocorr_2d=autocorr_2d, autocorr_extent=autocorr_extent,
        row_psd=row_psd, col_psd=col_psd,
        row_freq=row_freq, col_freq=col_freq,
        row_peak_freq=row_peak_freq, col_peak_freq=col_peak_freq,
        row_peak_amp=row_peak_amp, col_peak_amp=col_peak_amp,
        hot_pixel_mask=hot_mask,
        hot_pixel_count=hot_count, cold_pixel_count=cold_count,
        top_hot=top_hot, top_cold=top_cold,
        drift_plane=drift_plane, drift_order=drift_order,
        hist_bin_edges=hist_bin_edges_arr, hist_counts=hist_counts_arr,
        settings=settings,
    )


def compute_fpn_multi(image: np.ndarray,
                      *, name: str = "",
                      rois: Sequence[Tuple[int, int, int, int]],
                      settings: Optional[FPNSettings] = None,
                      ) -> List[FPNResult]:
    """Run `compute_fpn` over multiple ROIs on the same channel.

    The frontend uses this to show "flat-field uniformity" audits — e.g.
    corners vs center. ROIs that are too small or degenerate are skipped
    with a silent `None`... actually no, we raise the per-ROI error only
    if ALL rois fail; individual failures are returned as None-free empty
    results would be confusing. So we raise instead — and expect the
    caller to sanitize rois first.
    """
    return [compute_fpn(image, name=name, roi=r, settings=settings) for r in rois]


def compute_prnu_stability(image: np.ndarray,
                           *, roi: Tuple[int, int, int, int],
                           n_shrinks: int = 5,
                           settings: Optional[FPNSettings] = None,
                           ) -> List[Dict[str, float]]:
    """Shrink the ROI concentrically in `n_shrinks` steps and report
    PRNU / DSNU at each size. A flat curve means the statistics are
    stable (ROI is large enough); a diverging curve means the ROI is
    too small.
    """
    if settings is None:
        settings = FPNSettings()
    y0, x0, y1, x1 = roi
    cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
    h0, w0 = y1 - y0, x1 - x0
    fracs = np.linspace(1.0, 0.25, int(max(2, n_shrinks)))
    out: List[Dict[str, float]] = []
    for f in fracs:
        hh, ww = max(4, int(h0 * f)), max(4, int(w0 * f))
        ya = int(max(0, cy - hh / 2))
        yb = int(min(image.shape[0], ya + hh))
        xa = int(max(0, cx - ww / 2))
        xb = int(min(image.shape[1], xa + ww))
        try:
            r = compute_fpn(image, name="", roi=(ya, xa, yb, xb),
                            settings=settings)
            out.append({
                "frac": float(f),
                "size_h": int(yb - ya),
                "size_w": int(xb - xa),
                "n_pixels": int(r.n_kept),
                "mean_dn": float(r.mean),
                "dsnu_dn": float(r.dsnu_dn),
                "prnu_pct": float(r.prnu_pct),
                "row_noise_dn": float(r.row_noise_dn),
                "col_noise_dn": float(r.col_noise_dn),
            })
        except ValueError:
            out.append({
                "frac": float(f),
                "size_h": int(yb - ya),
                "size_w": int(xb - xa),
                "n_pixels": 0,
                "mean_dn": float("nan"),
                "dsnu_dn": float("nan"),
                "prnu_pct": float("nan"),
                "row_noise_dn": float("nan"),
                "col_noise_dn": float("nan"),
            })
    return out
