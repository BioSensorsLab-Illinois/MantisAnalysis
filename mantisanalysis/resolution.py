"""USAF-chart lateral-resolution analysis for the RGB-NIR pipeline.

Methodology (per-channel, per-gain):
    1. Apply 180-degree rotation (user's reported flip-H + flip-V).
    2. Locate chart bounding box via per-row / per-col detail variance.
    3. Pick the horizontal row inside the chart with the strongest bar
       contrast and extract a `strip_rows`-tall slice; average rows -> 1D
       profile.
    4. Detrend (subtract a slow lowpass to kill illumination roll-off),
       apply a Hann window, take the rFFT, return a normalized
       single-sided spectrum.
    5. Estimate the noise floor from the highest 10 % of frequency bins
       (taken to be beyond the system passband for a sharply blurred
       chart). The "detection limit" is the highest frequency at which
       the smoothed spectrum sits above ``max(threshold, noise_floor)``.

The output of this module is a `ChannelResult` per (gain, channel).
Plotting lives in `scripts/run_usaf_resolution.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import gaussian_filter1d


@dataclass
class DirectionResult:
    """Per-direction (horizontal-strip OR vertical-strip) FFT analysis."""

    direction: str  # "H" or "V"
    line_index: int  # row (H) or col (V) at strip centre
    line_range: tuple[int, int]  # (start, end) of the strip along scan axis
    profile: np.ndarray  # detrended 1D profile (input to FFT)
    freqs: np.ndarray  # cycles per channel-pixel
    spectrum: np.ndarray  # normalized magnitude (peak=1)
    spectrum_smoothed: np.ndarray
    noise_floor: float
    cutoffs: dict[str, float | None] = field(default_factory=dict)


@dataclass
class ChannelResult:
    gain: str  # "HG" or "LG"
    channel: str  # "R" / "G" / "B" / "NIR"
    image: np.ndarray  # rotated 2D channel image
    chart_bbox: tuple[int, int, int, int]  # (y0, x0, y1, x1)
    horizontal: DirectionResult
    vertical: DirectionResult
    saturation_fraction: float = 0.0


def rotate_180(img: np.ndarray) -> np.ndarray:
    """Apply h+v flip (== 180-degree rotation)."""
    return np.flip(img, axis=(0, 1)).copy()


def find_chart_bbox(
    image: np.ndarray, sigma: float = 6.0, pad: int = 8
) -> tuple[int, int, int, int]:
    """Bounding box of the high-detail (chart) region.

    Computes a high-pass detail image (image - gaussian-blurred image) and
    thresholds the per-row / per-col detail energy at half-peak to find
    the chart envelope.
    """
    img = image.astype(np.float64)
    blurred = gaussian_filter1d(gaussian_filter1d(img, sigma, axis=0), sigma, axis=1)
    detail = np.abs(img - blurred)
    row_e = gaussian_filter1d(detail.sum(axis=1), sigma=4)
    col_e = gaussian_filter1d(detail.sum(axis=0), sigma=4)
    row_thr = 0.40 * row_e.max()
    col_thr = 0.40 * col_e.max()
    rows = np.where(row_e > row_thr)[0]
    cols = np.where(col_e > col_thr)[0]
    if rows.size == 0 or cols.size == 0:
        return (0, 0, image.shape[0], image.shape[1])
    y0 = max(0, int(rows.min()) - pad)
    y1 = min(image.shape[0], int(rows.max()) + pad + 1)
    x0 = max(0, int(cols.min()) - pad)
    x1 = min(image.shape[1], int(cols.max()) + pad + 1)
    return (y0, x0, y1, x1)


def _find_max_contrast_index(
    sub: np.ndarray, *, freq_band: tuple[float, float], strip_rows: int
) -> int:
    """Index of the row inside ``sub`` with the strongest periodic content
    in the requested frequency band."""
    n_cols = sub.shape[1]
    win = np.hanning(n_cols)
    freqs = np.fft.rfftfreq(n_cols)
    fmask = (freqs >= freq_band[0]) & (freqs <= freq_band[1])

    pad = strip_rows // 2
    n_rows = sub.shape[0]
    scores = np.zeros(n_rows, dtype=np.float64)
    for i in range(n_rows):
        ys = max(0, i - pad)
        ye = min(n_rows, i + pad)
        profile = sub[ys:ye].mean(axis=0)
        profile = profile - gaussian_filter1d(profile, sigma=30.0)
        spec = np.abs(np.fft.rfft(profile * win))
        scores[i] = spec[fmask].max() if fmask.any() else 0.0

    scores_s = gaussian_filter1d(scores, sigma=2.0)
    return int(np.argmax(scores_s))


def find_max_contrast_row(
    image: np.ndarray,
    bbox: tuple[int, int, int, int],
    *,
    central_frac: float = 0.70,
    freq_band: tuple[float, float] = (0.04, 0.40),
    strip_rows: int = 20,
) -> int:
    """Row (in full-image coordinates) with the strongest *periodic* bar pattern.

    Resolution-bar groups create distinct peaks in the row's 1D FFT at
    well-defined non-DC frequencies. Variance alone is dominated by large
    text glyphs and chart-edge contrast (non-periodic features), which is
    why we score by the peak FFT magnitude inside ``freq_band``.

    The search is restricted to the central ``central_frac`` of the bbox
    height to avoid the chart-label text band ('THORLABS', part-number,
    group/element index labels).
    """
    y0, x0, y1, x1 = bbox
    h_bbox = y1 - y0
    margin = int((1.0 - central_frac) / 2.0 * h_bbox)
    y_lo = y0 + margin
    y_hi = y1 - margin
    sub = image[y_lo:y_hi, x0:x1].astype(np.float64)
    return y_lo + _find_max_contrast_index(sub, freq_band=freq_band, strip_rows=strip_rows)


def find_max_contrast_col(
    image: np.ndarray,
    bbox: tuple[int, int, int, int],
    *,
    central_frac: float = 0.70,
    freq_band: tuple[float, float] = (0.04, 0.40),
    strip_cols: int = 20,
) -> int:
    """Column with the strongest periodic content (vertical bar pattern)."""
    y0, x0, y1, x1 = bbox
    w_bbox = x1 - x0
    margin = int((1.0 - central_frac) / 2.0 * w_bbox)
    x_lo = x0 + margin
    x_hi = x1 - margin
    sub = image[y0:y1, x_lo:x_hi].astype(np.float64).T  # transpose -> rows = cols
    return x_lo + _find_max_contrast_index(sub, freq_band=freq_band, strip_rows=strip_cols)


def line_profile_spectrum(
    image: np.ndarray,
    row_y: int,
    xrange: tuple[int, int],
    strip_rows: int = 20,
    detrend_sigma: float = 30.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hann-windowed rFFT magnitude of a horizontal averaged strip.

    Returns (profile_used_for_fft, freqs_cy_per_pixel, magnitude_normalized).
    """
    h = image.shape[0]
    ystart = max(0, row_y - strip_rows // 2)
    yend = min(h, row_y + strip_rows // 2)
    x0, x1 = xrange
    strip = image[ystart:yend, x0:x1].astype(np.float64)
    return _spectrum_from_strip(strip, axis=0, detrend_sigma=detrend_sigma)


def column_profile_spectrum(
    image: np.ndarray,
    col_x: int,
    yrange: tuple[int, int],
    strip_cols: int = 20,
    detrend_sigma: float = 30.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Hann-windowed rFFT magnitude of a vertical averaged strip."""
    w = image.shape[1]
    xstart = max(0, col_x - strip_cols // 2)
    xend = min(w, col_x + strip_cols // 2)
    y0, y1 = yrange
    strip = image[y0:y1, xstart:xend].astype(np.float64)
    return _spectrum_from_strip(strip, axis=1, detrend_sigma=detrend_sigma)


def _spectrum_from_strip(
    strip: np.ndarray, *, axis: int, detrend_sigma: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Average across `axis`, detrend, Hann-window, rFFT, normalize."""
    profile = strip.mean(axis=axis)
    baseline = gaussian_filter1d(profile, sigma=detrend_sigma)
    profile_d = profile - baseline
    win = np.hanning(len(profile_d))
    profile_w = profile_d * win
    n = len(profile_w)
    spec = np.abs(np.fft.rfft(profile_w))
    freqs = np.fft.rfftfreq(n)
    spec[0] = 0.0
    peak = spec.max() if spec.max() > 0 else 1.0
    return profile_d, freqs, spec / peak


def detection_cutoff(freqs: np.ndarray, mag_smoothed: np.ndarray, threshold: float) -> float | None:
    """Highest frequency at which the smoothed magnitude crosses `threshold`
    going from above to below. Linearly interpolated."""
    above = mag_smoothed >= threshold
    if not above.any():
        return None
    # walk from the high-frequency end backwards
    last_above = int(np.where(above)[0].max())
    if last_above == len(freqs) - 1:
        return float(freqs[last_above])
    f0, f1 = freqs[last_above], freqs[last_above + 1]
    m0, m1 = mag_smoothed[last_above], mag_smoothed[last_above + 1]
    if m0 == m1:
        return float(f0)
    frac = (m0 - threshold) / (m0 - m1)
    return float(f0 + frac * (f1 - f0))


def estimate_noise_floor(mag: np.ndarray, frac_high: float = 0.10) -> float:
    """Median magnitude in the top `frac_high` of the frequency band."""
    n = len(mag)
    k = max(1, int(frac_high * n))
    return float(np.median(mag[-k:]))


def saturation_fraction(
    image: np.ndarray, bbox: tuple[int, int, int, int], max_value: int = 65520
) -> float:
    """Fraction of chart-bbox pixels at >= `max_value` (clipping)."""
    y0, x0, y1, x1 = bbox
    sub = image[y0:y1, x0:x1]
    if sub.size == 0:
        return 0.0
    return float((sub >= max_value).mean())


def _analyze_direction(
    profile: np.ndarray,
    freqs: np.ndarray,
    mag: np.ndarray,
    *,
    smoothing_sigma: float,
    cutoff_thresholds: tuple[float, ...],
) -> tuple[np.ndarray, float, dict[str, float | None]]:
    mag_s = gaussian_filter1d(mag, sigma=smoothing_sigma)
    noise_floor = estimate_noise_floor(mag_s, frac_high=0.10)
    cutoffs: dict[str, float | None] = {}
    for thr in cutoff_thresholds:
        eff_thr = max(thr, 1.5 * noise_floor)
        key = f"MTF{int(round(thr * 100)):02d}"
        cutoffs[key] = detection_cutoff(freqs, mag_s, eff_thr)
    return mag_s, noise_floor, cutoffs


def analyze_channel(
    image_rotated: np.ndarray,
    gain: str,
    channel: str,
    *,
    strip_size: int = 20,
    smoothing_sigma: float = 1.5,
    cutoff_thresholds: tuple[float, ...] = (0.5, 0.2, 0.1),
) -> ChannelResult:
    bbox = find_chart_bbox(image_rotated)

    # Horizontal slice (probes vertical bar pattern)
    line_y = find_max_contrast_row(image_rotated, bbox, strip_rows=strip_size)
    profile_h, freqs_h, mag_h = line_profile_spectrum(
        image_rotated, line_y, (bbox[1], bbox[3]), strip_rows=strip_size
    )
    mag_h_s, nf_h, cuts_h = _analyze_direction(
        profile_h,
        freqs_h,
        mag_h,
        smoothing_sigma=smoothing_sigma,
        cutoff_thresholds=cutoff_thresholds,
    )
    horizontal = DirectionResult(
        direction="H",
        line_index=line_y,
        line_range=(bbox[1], bbox[3]),
        profile=profile_h,
        freqs=freqs_h,
        spectrum=mag_h,
        spectrum_smoothed=mag_h_s,
        noise_floor=nf_h,
        cutoffs=cuts_h,
    )

    # Vertical slice (probes horizontal bar pattern)
    line_x = find_max_contrast_col(image_rotated, bbox, strip_cols=strip_size)
    profile_v, freqs_v, mag_v = column_profile_spectrum(
        image_rotated, line_x, (bbox[0], bbox[2]), strip_cols=strip_size
    )
    mag_v_s, nf_v, cuts_v = _analyze_direction(
        profile_v,
        freqs_v,
        mag_v,
        smoothing_sigma=smoothing_sigma,
        cutoff_thresholds=cutoff_thresholds,
    )
    vertical = DirectionResult(
        direction="V",
        line_index=line_x,
        line_range=(bbox[0], bbox[2]),
        profile=profile_v,
        freqs=freqs_v,
        spectrum=mag_v,
        spectrum_smoothed=mag_v_s,
        noise_floor=nf_v,
        cutoffs=cuts_v,
    )

    return ChannelResult(
        gain=gain,
        channel=channel,
        image=image_rotated,
        chart_bbox=bbox,
        horizontal=horizontal,
        vertical=vertical,
        saturation_fraction=saturation_fraction(image_rotated, bbox),
    )
