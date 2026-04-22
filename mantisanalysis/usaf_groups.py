"""USAF resolution-target group analysis: per-element Michelson contrast.

Spatial-frequency table (lp/mm at the chart) for the 4 visible groups of a
Thorlabs negative USAF target. Generated with the standard formula
``lp_mm(group, element) = 2 ** (group + (element - 1) / 6)``; the values
match the table the user reported.

A "line" is a user-picked profile through the 3 bars of one (group, element)
in one direction (H or V). Profiles are extracted with sub-pixel-accurate
bilinear interpolation along the line, optionally averaged across a
perpendicular swath. Modulation is reported as Michelson contrast, computed
either from min/max or from a robust percentile pair.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np
from scipy.ndimage import map_coordinates


# Standard USAF spatial-frequency table.
# lp/mm = 2 ** (group + (element - 1) / 6).
# Default range covers groups 0-5 (6 groups × 6 elements = 36 elements).
USAF_GROUPS = tuple(range(0, 6))
USAF_ELEMENTS = tuple(range(1, 7))
USAF_LP_MM: Dict[int, List[float]] = {
    g: [2.0 ** (g + (e - 1) / 6.0) for e in USAF_ELEMENTS]
    for g in USAF_GROUPS
}


def lp_mm(group: int, element: int) -> float:
    """Spatial frequency in line-pairs / mm at the chart."""
    return USAF_LP_MM[int(group)][int(element) - 1]


@dataclass
class LineSpec:
    group: int
    element: int
    direction: str          # "H" (horizontal line, probes vertical bars) or "V"
    p0: Tuple[float, float] # (x, y) in channel-pixel coords (rotated image)
    p1: Tuple[float, float]


@dataclass
class LineMeasurement:
    spec: LineSpec
    profile: np.ndarray
    modulation: float                # primary, chosen via `method` arg
    modulation_pct: float = 0.0      # always: P10/P90 Michelson
    modulation_minmax: float = 0.0   # always: peak-to-peak Michelson
    modulation_fft: float = 0.0      # always: FFT-fundamental Michelson
    profile_min: float = 0.0
    profile_max: float = 0.0
    profile_p10: float = 0.0
    profile_p90: float = 0.0
    line_length_px: float = 0.0
    n_samples: int = 0
    samples_per_cycle: float = 0.0   # n_samples / 2.5 (3-bar element)
    f_expected_cy_per_sample: float = 0.0
    f_peak_cy_per_sample: float = 0.0

    @property
    def lp_mm(self) -> float:
        return lp_mm(self.spec.group, self.spec.element)

    @property
    def reliability(self) -> str:
        """Quality flag based on samples per cycle of the bar pattern.
        Below ~3 samples / cycle the per-pixel image cannot resolve the
        bars at all (Nyquist), so contrast measurements are unreliable."""
        spc = self.samples_per_cycle
        if spc < 3.0:
            return "unreliable"   # below Nyquist
        if spc < 5.0:
            return "marginal"     # above Nyquist but very few samples
        return "ok"


def extract_line_profile(image: np.ndarray,
                         p0: Sequence[float], p1: Sequence[float],
                         *, swath_width: float = 8.0,
                         oversample: float = 2.0) -> np.ndarray:
    """Bilinear-interpolated line profile, averaged over a perpendicular swath.

    Parameters
    ----------
    image : 2D ndarray
    p0, p1 : (x, y) endpoints in image coordinates
    swath_width : pixels — averaging across a strip perpendicular to the line
                  smooths sub-pixel jitter without smearing along the line
    oversample : along-line samples per pixel of line length
    """
    p0 = np.asarray(p0, dtype=np.float64)
    p1 = np.asarray(p1, dtype=np.float64)
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = float(np.hypot(dx, dy))
    if L < 1.0:
        raise ValueError(f"line too short (length {L:.2f} px)")
    n_samples = max(2, int(np.ceil(L * oversample)))
    t = np.linspace(0.0, 1.0, n_samples)
    xs_c = p0[0] + t * dx
    ys_c = p0[1] + t * dy
    # Unit normal
    nx, ny = -dy / L, dx / L
    n_offsets = max(1, int(round(swath_width)))
    if n_offsets == 1:
        offsets = [0.0]
    else:
        offsets = np.linspace(-swath_width / 2.0, swath_width / 2.0, n_offsets)
    img_f = image.astype(np.float64)
    accum = np.zeros(n_samples, dtype=np.float64)
    for off in offsets:
        xs = xs_c + off * nx
        ys = ys_c + off * ny
        coords = np.array([ys, xs])  # map_coordinates wants (row, col)
        accum += map_coordinates(img_f, coords, order=1,
                                 mode="nearest")
    return accum / float(len(offsets))


def michelson(values_low: float, values_high: float) -> float:
    s = values_high + values_low
    if s <= 0:
        return 0.0
    return float((values_high - values_low) / s)


def measure_modulation(profile: np.ndarray,
                       *, method: str = "percentile",
                       lo_pct: float = 10.0, hi_pct: float = 90.0
                       ) -> Tuple[float, float, float]:
    """Return (modulation, low_value, high_value) for a profile.

    ``method``:
        "minmax"     - Michelson contrast from raw min/max
        "percentile" - Michelson contrast from (lo_pct, hi_pct) percentiles
                       (robust to single-pixel outliers)
    """
    p = np.asarray(profile, dtype=np.float64)
    if method == "minmax":
        lo = float(p.min())
        hi = float(p.max())
    elif method == "percentile":
        lo = float(np.percentile(p, lo_pct))
        hi = float(np.percentile(p, hi_pct))
    else:
        raise ValueError(f"unknown method {method!r}")
    return michelson(lo, hi), lo, hi


def measure_modulation_fft(profile: np.ndarray,
                           *, n_cycles_expected: float = 2.5
                           ) -> Tuple[float, float, float]:
    """Square-wave Michelson contrast at the *expected* bar fundamental.

    For a USAF 3-bar element drawn end-to-end, ``n_cycles_expected = 2.5``
    (3 bars + 2 gaps = 5 half-cycles).

    Algorithm:
      - zero-pad the profile (no window — clean DC reading) to a
        generous power of two
      - search the magnitude spectrum within [0.5, 1.5]·f_expected for
        the dominant peak
      - convert that peak amplitude back to a square-wave Michelson:
            M_sq = (π/2) · |F[f_peak]| / |F[0]|
        (FFT of an ideal square wave has fundamental amplitude
         (4/π)·A_square, so the inverse Fourier scale is π/4 on the
         peak amplitude, and the factor of 2 comes from the rFFT
         single-sided convention.)

    Returns ``(modulation, f_expected_cy_per_sample, f_peak_cy_per_sample)``.
    Aliasing of bars below the per-pixel Nyquist scatters energy into
    other bins, so this estimator stays close to the real contrast even
    when raw min/max would be inflated by a stray pixel.
    """
    p = np.asarray(profile, dtype=np.float64)
    n = int(p.size)
    if n < 4:
        return 0.0, 0.0, 0.0
    pad_n = max(64, 1 << int(np.ceil(np.log2(max(64, n * 8)))))
    spec = np.fft.rfft(p, n=pad_n)
    freqs = np.fft.rfftfreq(pad_n, d=1.0)
    f_expected = float(n_cycles_expected) / max(1.0, float(n - 1))
    band_lo = max(1e-9, 0.5 * f_expected)
    band_hi = min(0.5, 1.5 * f_expected)
    mask = (freqs >= band_lo) & (freqs <= band_hi)
    if not mask.any():
        return 0.0, f_expected, 0.0
    band_mags = np.abs(spec[mask])
    band_freqs = freqs[mask]
    idx = int(np.argmax(band_mags))
    fund_amp = float(band_mags[idx])
    f_peak = float(band_freqs[idx])
    dc_mag = float(abs(spec[0]))
    if dc_mag <= 0:
        return 0.0, f_expected, f_peak
    michelson_sq = float(np.pi / 2.0) * fund_amp / dc_mag
    return michelson_sq, f_expected, f_peak


def measure_line(image: np.ndarray, spec: LineSpec,
                 *, swath_width: float = 8.0,
                 method: str = "percentile",
                 n_cycles_expected: float = 2.5) -> LineMeasurement:
    """Measure all flavors of Michelson contrast for one picked line.

    The ``method`` parameter selects which value goes into the
    ``modulation`` field (the "primary" reading). Both `min/max` and
    `FFT-fundamental` are always also computed so the GUI can show all
    three side by side.
    """
    profile = extract_line_profile(image, spec.p0, spec.p1,
                                   swath_width=swath_width)
    mod_pct, lo_p, hi_p = measure_modulation(profile, method="percentile")
    mod_mm,  lo_m, hi_m = measure_modulation(profile, method="minmax")
    mod_fft, f_exp, f_peak = measure_modulation_fft(
        profile, n_cycles_expected=n_cycles_expected)

    if method == "fft":
        primary = mod_fft
    elif method == "minmax":
        primary = mod_mm
    else:
        primary = mod_pct

    n = int(len(profile))
    # samples-per-cycle: how many profile samples cover one bar pair.
    # n_samples covers n_cycles_expected cycles → spc = n / cycles.
    spc = float(n) / max(1.0, float(n_cycles_expected))
    L = float(np.hypot(spec.p1[0] - spec.p0[0], spec.p1[1] - spec.p0[1]))
    return LineMeasurement(
        spec=spec, profile=profile,
        modulation=float(primary),
        modulation_pct=float(mod_pct),
        modulation_minmax=float(mod_mm),
        modulation_fft=float(mod_fft),
        profile_min=float(profile.min()),
        profile_max=float(profile.max()),
        profile_p10=float(lo_p), profile_p90=float(hi_p),
        line_length_px=L, n_samples=n,
        samples_per_cycle=spc,
        f_expected_cy_per_sample=float(f_exp),
        f_peak_cy_per_sample=float(f_peak),
    )


def detection_limit_lp_mm(measurements: Sequence[LineMeasurement],
                          threshold: float) -> Tuple[float | None,
                                                     LineMeasurement | None]:
    """First lp/mm at which the modulation drops below ``threshold``.

    Walks the measurements in ascending lp/mm order and returns the
    *first* point whose modulation is below the threshold — i.e., the
    spatial frequency at which the system "fails". This is the
    conventional resolution-limit reading for a USAF chart: you scan
    from coarse to fine bars and stop at the first element you cannot
    resolve.

    Returns (lp_mm, measurement) of that first failure, or
    (None, None) if every measurement stayed at or above threshold.
    Ties on lp/mm are kept stable (Python's `sorted` is stable).
    """
    for m in sorted(measurements, key=lambda x: x.lp_mm):
        if m.modulation < threshold:
            return m.lp_mm, m
    return None, None
