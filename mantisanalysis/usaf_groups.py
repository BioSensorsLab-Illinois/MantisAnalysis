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

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.ndimage import gaussian_filter1d, map_coordinates
from scipy.signal import find_peaks


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
    modulation_5pt: float = 0.0      # always: 3-bars-and-2-gaps five-point Michelson
    profile_min: float = 0.0
    profile_max: float = 0.0
    profile_p10: float = 0.0
    profile_p90: float = 0.0
    line_length_px: float = 0.0
    n_samples: int = 0
    samples_per_cycle: float = 0.0   # n_samples / 2.5 (3-bar element)
    f_expected_cy_per_sample: float = 0.0
    f_peak_cy_per_sample: float = 0.0
    # Five-point detection outputs. Sample indices into `profile`.
    bar_indices: List[int] = field(default_factory=list)
    gap_indices: List[int] = field(default_factory=list)
    bar_values: List[float] = field(default_factory=list)
    gap_values: List[float] = field(default_factory=list)
    bars_bright: bool = True         # True if bars are brighter than gaps

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
    """Michelson contrast clamped to ``[0, 1]``.

    The textbook formula ``(I_hi − I_lo) / (I_hi + I_lo)`` is in [0, 1] for
    non-negative I_hi ≥ I_lo. We clamp defensively so that pathological
    inputs (negative DN from sharpening over-shoot, P10 < 0, swapped
    arguments) can never produce physically-impossible values like 1.2.
    """
    s = values_high + values_low
    if s <= 0:
        return 0.0
    v = (values_high - values_low) / s
    if v < 0:
        v = -v
    return float(min(1.0, max(0.0, v)))


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
    # Clamp to physically meaningful range. The (π/2) coefficient assumes
    # an ideal square wave; real (especially sub-Nyquist or noise-spike)
    # signals can produce > 1 which is meaningless for a Michelson reading.
    michelson_sq = max(0.0, min(1.0, michelson_sq))
    return michelson_sq, f_expected, f_peak


def detect_three_bar_points(
    profile: np.ndarray, *,
    smooth_sigma: float = 1.2,
    min_dist_frac: float = 0.06,
    min_prominence_frac: float = 0.03,
) -> Tuple[List[int], List[int], bool]:
    """Pick 3 bright + 2 dark sample indices from a USAF profile.

    Hard invariants on the output (matters for UI clarity + correctness):
      1. **Positional alternation**: the 5 sample indices, sorted by
         position, follow the pattern bright-dark-bright-dark-bright.
      2. **Magnitude order**: every dark sample value is ≤ both of its
         adjacent bright sample values. We enforce this by
         construction — if the prominence-based detection picks a "dark"
         that ends up higher than a neighbouring "bright", we replace it
         with the local minimum in the bracketed span (which is
         guaranteed ≤ both endpoints).
      3. **Degenerate cases allowed**: two output indices may collide
         (e.g., on a near-constant profile a dark may sit at the same
         sample as a bright); this is fine — the contrast formula
         still evaluates and just reports near-zero for that segment.
      4. **`bars_bright` is always True** — the 3-set is by definition
         the locally-brighter one, so labels in the UI always show
         bright dots above the curve and dark dots below it. For a
         negative USAF target (dark bars on bright background) the 3
         "bright" points would correspond to the inter-bar bright gaps;
         that's intentional — the contrast math is polarity-symmetric.

    Algorithm:
      * Smooth the profile so single-pixel noise doesn't dominate
        peak detection (especially near per-channel Nyquist).
      * Run ``scipy.signal.find_peaks`` for peaks, with prominence
        gated to a fraction of the dynamic range.
      * Take the 3 most-prominent peaks (sort by position) as the
        bright set. If we have fewer than 3 prominent peaks, fall
        back to the 3 highest-value samples that are well-separated.
      * For each bracketed segment between consecutive bright peaks,
        pick the local minimum as the dark sample. This GUARANTEES
        dark ≤ both adjacent brights.
    """
    p = np.asarray(profile, dtype=np.float64)
    n = int(p.size)
    if n < 5:
        return ([0, n // 2, n - 1][:3],
                [max(0, n // 4), min(n - 1, 3 * n // 4)][:2], True)

    ps = gaussian_filter1d(p, sigma=max(0.4, float(smooth_sigma)))
    dyn = float(ps.max() - ps.min()) or 1.0
    min_dist = max(1, int(n * float(min_dist_frac)))
    min_prom = float(min_prominence_frac) * dyn

    peaks, pk_props = find_peaks(ps, distance=min_dist, prominence=min_prom)

    # Pick 3 brightest peaks (by prominence, tie-break by raw value).
    if len(peaks) >= 3:
        prom = np.asarray(pk_props.get("prominences", np.zeros(len(peaks))))
        # Score = prominence + small value-weight tiebreaker.
        score = prom + 0.05 * (ps[peaks] - ps.min()) / dyn
        top3 = peaks[np.argsort(-score)[:3]]
        bright = sorted(int(x) for x in top3)
    else:
        # Fallback when find_peaks underdelivers: pick top-N samples
        # from the smoothed profile, keeping them spread out.
        bright = _spread_top_samples(ps, n_pick=3, min_sep=min_dist)

    # Hard invariant: each dark = local min of (bright[i], bright[i+1]) span.
    # `np.argmin` over the inclusive bracket is guaranteed ≤ both endpoints.
    dark: List[int] = []
    for a, b in zip(bright[:-1], bright[1:]):
        if b <= a:  # degenerate (collapsed bright neighbours)
            dark.append(a)
            continue
        rel = int(np.argmin(ps[a:b + 1]))
        dark.append(a + rel)

    # Final safety: enforce dark[i] ≤ bright[i] AND dark[i] ≤ bright[i+1].
    # The argmin construction above already guarantees this for normal
    # data, but a degenerate span (single sample) needs the clamp.
    for i, d in enumerate(dark):
        a, b = bright[i], bright[i + 1]
        if ps[d] > ps[a]: d = a
        if ps[d] > ps[b]: d = b
        dark[i] = int(d)

    while len(bright) < 3: bright.append(n - 1)
    while len(dark) < 2:   dark.append(n // 2)

    # `bars_bright = True` is guaranteed by construction (we labelled the
    # locally-brightest 3 as bars).
    return bright, dark, True


def _spread_top_samples(ps: np.ndarray, *, n_pick: int, min_sep: int) -> List[int]:
    """Pick `n_pick` indices, taking the highest-value samples while
    enforcing a minimum separation. Used as a fallback when
    `find_peaks` finds too few prominent peaks (very smooth or very
    noisy profiles).
    """
    n = ps.size
    order = np.argsort(-ps)
    chosen: List[int] = []
    for idx in order:
        idx = int(idx)
        if all(abs(idx - c) >= max(1, min_sep) for c in chosen):
            chosen.append(idx)
            if len(chosen) >= n_pick:
                break
    while len(chosen) < n_pick:
        chosen.append(n - 1)
    return sorted(chosen[:n_pick])


def measure_modulation_5pt(
    profile: np.ndarray, *,
    bar_indices: Optional[Sequence[int]] = None,
    gap_indices: Optional[Sequence[int]] = None,
) -> Tuple[float, List[int], List[int], List[float], List[float], bool]:
    """Five-point Michelson from the 3-bar / 2-gap set.

    The user draws a line from the dark surround through 3 bars with
    gaps in between and ends in dark again. The most robust contrast
    estimator is

        M = (I̅_bright − I̅_dark) / (I̅_bright + I̅_dark)

    averaging each side over multiple detected extrema rather than the
    single-sample min / max. Pass ``bar_indices`` + ``gap_indices`` to
    override auto-detect (e.g., user dragged the points in the UI).

    Returns ``(modulation, bar_indices, gap_indices, bar_values,
    gap_values, bars_bright)``.
    """
    p = np.asarray(profile, dtype=np.float64)
    n = int(p.size)
    if n < 3:
        return 0.0, [], [], [], [], True

    if bar_indices is None or gap_indices is None:
        bi, gi, bars_bright = detect_three_bar_points(p)
    else:
        bi = [int(np.clip(i, 0, n - 1)) for i in bar_indices]
        gi = [int(np.clip(i, 0, n - 1)) for i in gap_indices]
        bars_bright = float(np.mean([p[i] for i in bi])) \
                    > float(np.mean([p[i] for i in gi])) if bi and gi else True

    bar_vals = [float(p[i]) for i in bi]
    gap_vals = [float(p[i]) for i in gi]
    mean_bars = float(np.mean(bar_vals)) if bar_vals else 0.0
    mean_gaps = float(np.mean(gap_vals)) if gap_vals else 0.0
    I_hi, I_lo = max(mean_bars, mean_gaps), min(mean_bars, mean_gaps)
    denom = I_hi + I_lo
    m = float((I_hi - I_lo) / denom) if denom > 0 else 0.0
    # Clamp to physically meaningful [0, 1] to match michelson() and
    # measure_modulation_fft. Aggressive sharpening (Unsharp mask amount
    # ≥ 2) can produce negative DN values, which without this clamp
    # inflates m past 1.0. See R-0005.
    m = max(0.0, min(1.0, m))
    return m, bi, gi, bar_vals, gap_vals, bool(mean_bars > mean_gaps)


def measure_line(image: np.ndarray, spec: LineSpec,
                 *, swath_width: float = 8.0,
                 method: str = "percentile",
                 n_cycles_expected: float = 2.5,
                 bar_indices: Optional[Sequence[int]] = None,
                 gap_indices: Optional[Sequence[int]] = None,
                 ) -> LineMeasurement:
    """Measure all flavors of Michelson contrast for one picked line.

    The ``method`` parameter selects which value goes into the
    ``modulation`` field (the "primary" reading). `percentile`,
    `min/max`, `FFT-fundamental`, and the 5-point `five_point` are
    always also computed so the GUI can show all four side by side.

    Pass ``bar_indices`` / ``gap_indices`` to override the 5-point
    auto-detection (e.g., when the user has dragged the points in the
    profile preview).
    """
    profile = extract_line_profile(image, spec.p0, spec.p1,
                                   swath_width=swath_width)
    mod_pct, lo_p, hi_p = measure_modulation(profile, method="percentile")
    mod_mm,  lo_m, hi_m = measure_modulation(profile, method="minmax")
    mod_fft, f_exp, f_peak = measure_modulation_fft(
        profile, n_cycles_expected=n_cycles_expected)
    mod_5pt, bi, gi, bar_vals, gap_vals, bars_bright = measure_modulation_5pt(
        profile, bar_indices=bar_indices, gap_indices=gap_indices)

    if method == "fft":
        primary = mod_fft
    elif method == "minmax":
        primary = mod_mm
    elif method in ("five_point", "5pt", "5point"):
        primary = mod_5pt
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
        modulation_5pt=float(mod_5pt),
        profile_min=float(profile.min()),
        profile_max=float(profile.max()),
        profile_p10=float(lo_p), profile_p90=float(hi_p),
        line_length_px=L, n_samples=n,
        samples_per_cycle=spc,
        f_expected_cy_per_sample=float(f_exp),
        f_peak_cy_per_sample=float(f_peak),
        bar_indices=list(bi), gap_indices=list(gi),
        bar_values=bar_vals, gap_values=gap_vals,
        bars_bright=bars_bright,
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
