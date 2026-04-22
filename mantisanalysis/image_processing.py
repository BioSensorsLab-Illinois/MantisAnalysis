"""Display-time image enhancement and sharpening.

All routines operate in float64, accept any 2-D numeric array, and return
float64. Convert back to display dtype downstream as needed.

Display pipeline (suggested order):
    1. sharpen   (optional, structural change)
    2. brightness / contrast / gamma   (display tone-curve)
    3. clip percentiles -> normalize to [0, 1]   (display range)

The MTF analysis should run on RAW data unless the user explicitly opts
into "apply sharpening to analysis" — sharpening inflates Michelson
contrast.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np
from scipy.ndimage import gaussian_filter, laplace


SHARPEN_METHODS = ("None", "Unsharp mask", "Laplacian", "High-pass")


# --- Sharpening -----------------------------------------------------------

def unsharp_mask(image: np.ndarray, radius: float = 2.0,
                 amount: float = 1.0) -> np.ndarray:
    """Classic unsharp mask: out = img + amount * (img - gauss(img, radius))."""
    a = image.astype(np.float64, copy=False)
    blur = gaussian_filter(a, sigma=max(0.1, float(radius)))
    return a + float(amount) * (a - blur)


def laplacian_sharpen(image: np.ndarray, amount: float = 1.0,
                      radius: float = 1.0) -> np.ndarray:
    """Subtract a (negatively-scaled) Laplacian.

    A small Gaussian pre-blur (radius) suppresses single-pixel noise so
    the Laplacian responds to edges, not noise. amount controls strength.
    """
    a = image.astype(np.float64, copy=False)
    if radius > 0.05:
        a_for_lap = gaussian_filter(a, sigma=float(radius))
    else:
        a_for_lap = a
    lap = laplace(a_for_lap)
    return a - float(amount) * lap


def highpass_sharpen(image: np.ndarray, radius: float = 8.0,
                     amount: float = 1.0) -> np.ndarray:
    """High-pass = image - lowpass(image); add scaled high-pass back to image.

    Larger radius = broader low-pass cutoff = lower-frequency content
    re-amplified. Good for global contrast lift.
    """
    a = image.astype(np.float64, copy=False)
    lowpass = gaussian_filter(a, sigma=max(0.5, float(radius)))
    highpass = a - lowpass
    return a + float(amount) * highpass


def apply_sharpen(image: np.ndarray, method: str,
                  amount: float = 1.0, radius: float = 2.0) -> np.ndarray:
    if method in (None, "", "None"):
        return image.astype(np.float64, copy=False)
    if method == "Unsharp mask":
        return unsharp_mask(image, radius=radius, amount=amount)
    if method == "Laplacian":
        return laplacian_sharpen(image, amount=amount, radius=radius)
    if method == "High-pass":
        return highpass_sharpen(image, radius=radius, amount=amount)
    raise ValueError(f"unknown sharpen method: {method!r}")


# --- Tone curve & range stretch ------------------------------------------

def adjust_brightness_contrast_gamma(image: np.ndarray,
                                     brightness: float = 0.0,
                                     contrast: float = 1.0,
                                     gamma: float = 1.0) -> np.ndarray:
    """Apply (display-only) tone adjustments in float space.

    brightness : additive shift in normalized units (relative to image range)
    contrast   : multiplicative scale around the image mean
    gamma      : power applied to [0, 1]-normalized values (γ < 1 lifts
                 shadows, γ > 1 deepens them)
    """
    a = image.astype(np.float64, copy=False)
    if contrast != 1.0:
        m = float(a.mean())
        a = (a - m) * float(contrast) + m
    if brightness:
        # express brightness as fraction of dynamic range
        dyn = float(a.max() - a.min())
        if dyn > 0:
            a = a + float(brightness) * dyn
    if gamma != 1.0 and gamma > 0:
        # gamma works on [0,1] normalized, so do percentile normalize first
        lo, hi = float(a.min()), float(a.max())
        if hi > lo:
            n = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
            n = np.power(n, 1.0 / float(gamma))
            a = lo + n * (hi - lo)
    return a


def percentile_clip(image: np.ndarray, lo_pct: float = 1.0,
                    hi_pct: float = 99.5) -> Tuple[float, float]:
    """Return (vmin, vmax) for display via percentile clipping."""
    a = image.astype(np.float32, copy=False)
    vmin, vmax = np.percentile(a, [lo_pct, hi_pct])
    if vmax <= vmin:
        vmax = vmin + 1.0
    return float(vmin), float(vmax)


def prepare_display(image: np.ndarray, *,
                    sharpen_method: str = "None",
                    sharpen_amount: float = 1.0,
                    sharpen_radius: float = 2.0,
                    brightness: float = 0.0,
                    contrast: float = 1.0,
                    gamma: float = 1.0,
                    clip_lo_pct: float = 1.0,
                    clip_hi_pct: float = 99.5,
                    ) -> Tuple[np.ndarray, float, float]:
    """Run the whole display pipeline. Returns (image_float, vmin, vmax)."""
    a = apply_sharpen(image, sharpen_method,
                      amount=sharpen_amount, radius=sharpen_radius)
    a = adjust_brightness_contrast_gamma(a, brightness=brightness,
                                         contrast=contrast, gamma=gamma)
    vmin, vmax = percentile_clip(a, lo_pct=clip_lo_pct, hi_pct=clip_hi_pct)
    return a, vmin, vmax


def maybe_apply_to_analysis(image: np.ndarray, *,
                            apply_sharpen_to_analysis: bool,
                            sharpen_method: str = "None",
                            sharpen_amount: float = 1.0,
                            sharpen_radius: float = 2.0) -> np.ndarray:
    """Optionally apply sharpening to the analysis image (default: don't)."""
    if not apply_sharpen_to_analysis or sharpen_method in (None, "", "None"):
        return image
    return apply_sharpen(image, sharpen_method,
                         amount=sharpen_amount, radius=sharpen_radius)
