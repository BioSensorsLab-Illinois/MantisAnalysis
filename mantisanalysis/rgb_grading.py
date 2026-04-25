"""Per-channel RGB color grading for Play-mode rendering.

play-tab-recording-inspection-rescue-v1 M22.

Applies a photographic grading curve to a float32 RGB array in [0, 1].
The order matches industry convention so users can chain corrections
without surprises:

    1. Per-channel offset (additive)        — black-level lift / sink per R/G/B.
    2. Per-channel gain (multiplicative)    — exposure / WB-like channel scaling.
    3. White-balance via Kelvin temperature — multiplies R/G/B by daylight-locus
                                              ratios (van Krevelen-style approximation).
    4. Gamma                                — per-channel power curve.
    5. Brightness                           — additive offset on every channel.
    6. Contrast                             — multiplier around 0.5.
    7. Saturation                           — luminance-preserving chroma scale.

Pure NumPy — no FastAPI / React / Qt imports. Suggested entry points::

    apply_grading(rgb_arr, params) -> ndarray
    auto_white_balance(rgb_arr, method='gray-world') -> dict

`params` is a plain dict (defaults are no-ops):

    {
      "gain_r":     float = 1.0,
      "gain_g":     float = 1.0,
      "gain_b":     float = 1.0,
      "offset_r":   float = 0.0,
      "offset_g":   float = 0.0,
      "offset_b":   float = 0.0,
      "gamma":      float = 1.0,
      "brightness": float = 0.0,
      "contrast":   float = 1.0,
      "saturation": float = 1.0,
      "wb_kelvin":  float | None = None,   # None or 6500 = no shift
    }
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np


# Reference daylight (D65) — when wb_kelvin is None or ≈ 6500 the WB
# multipliers are (1, 1, 1).
_REF_KELVIN = 6500.0


def kelvin_to_rgb_multipliers(kelvin: float) -> tuple[float, float, float]:
    """Approximate (r_mul, g_mul, b_mul) factors for a given Kelvin
    color temperature, normalized so D65 (~6500 K) yields ≈ (1, 1, 1).

    Uses Tanner Helland's piecewise empirical fit (commonly cited as
    a van Krevelen / blackbody approximation, accurate enough for
    interactive grading). Inputs outside [1000, 40000] are clamped.
    """
    k = max(1000.0, min(40000.0, float(kelvin))) / 100.0
    # Red
    if k <= 66.0:
        r = 255.0
    else:
        r = 329.698727446 * ((k - 60.0) ** -0.1332047592)
    # Green
    if k <= 66.0:
        g = 99.4708025861 * np.log(k) - 161.1195681661
    else:
        g = 288.1221695283 * ((k - 60.0) ** -0.0755148492)
    # Blue
    if k >= 66.0:
        b = 255.0
    elif k <= 19.0:
        b = 0.0
    else:
        b = 138.5177312231 * np.log(k - 10.0) - 305.0447927307
    r = float(np.clip(r, 0.0, 255.0))
    g = float(np.clip(g, 0.0, 255.0))
    b = float(np.clip(b, 0.0, 255.0))
    # Normalize so D65 ≈ (1, 1, 1).
    ref_r, ref_g, ref_b = _kelvin_at_d65()
    rm = r / ref_r if ref_r > 0 else 1.0
    gm = g / ref_g if ref_g > 0 else 1.0
    bm = b / ref_b if ref_b > 0 else 1.0
    return rm, gm, bm


# Cache the D65 reference so we don't recompute it 60 times/sec.
_D65_CACHE: Optional[tuple[float, float, float]] = None


def _kelvin_at_d65() -> tuple[float, float, float]:
    global _D65_CACHE
    if _D65_CACHE is not None:
        return _D65_CACHE
    # Recompute the raw Tanner Helland curve at exactly 6500 K. ALL three
    # channels must use the same piecewise branching as the full
    # function — the earlier "b = 255 if k>=66 else 0" shortcut produced
    # b=0 at k=65 (since 65 < 66), which collapsed every Kelvin
    # multiplier toward 1.0 via the divide-by-zero fallback.
    k = _REF_KELVIN / 100.0
    if k <= 66.0:
        r = 255.0
    else:
        r = 329.698727446 * ((k - 60.0) ** -0.1332047592)
    if k <= 66.0:
        g = 99.4708025861 * np.log(k) - 161.1195681661
    else:
        g = 288.1221695283 * ((k - 60.0) ** -0.0755148492)
    if k >= 66.0:
        b = 255.0
    elif k <= 19.0:
        b = 0.0
    else:
        b = 138.5177312231 * np.log(k - 10.0) - 305.0447927307
    _D65_CACHE = (
        float(np.clip(r, 0.0, 255.0)),
        float(np.clip(g, 0.0, 255.0)),
        float(np.clip(b, 0.0, 255.0)),
    )
    return _D65_CACHE


def _is_no_op(params: Optional[Dict[str, Any]]) -> bool:
    if not params:
        return True
    eps = 1e-6
    if abs(float(params.get("gain_r", 1.0)) - 1.0) > eps:
        return False
    if abs(float(params.get("gain_g", 1.0)) - 1.0) > eps:
        return False
    if abs(float(params.get("gain_b", 1.0)) - 1.0) > eps:
        return False
    if abs(float(params.get("offset_r", 0.0))) > eps:
        return False
    if abs(float(params.get("offset_g", 0.0))) > eps:
        return False
    if abs(float(params.get("offset_b", 0.0))) > eps:
        return False
    if abs(float(params.get("gamma", 1.0)) - 1.0) > eps:
        return False
    if abs(float(params.get("brightness", 0.0))) > eps:
        return False
    if abs(float(params.get("contrast", 1.0)) - 1.0) > eps:
        return False
    if abs(float(params.get("saturation", 1.0)) - 1.0) > eps:
        return False
    wb = params.get("wb_kelvin", None)
    if wb is not None and abs(float(wb) - _REF_KELVIN) > 1.0:
        return False
    return True


def apply_grading(rgb_arr: np.ndarray,
                  params: Optional[Dict[str, Any]]) -> np.ndarray:
    """Apply the grading pipeline to a float32 (H, W, 3) array in [0, 1].

    Returns a new array (input is not mutated). No-op when ``params``
    is None or every field is at its default.
    """
    if rgb_arr is None:
        return rgb_arr
    if rgb_arr.ndim != 3 or rgb_arr.shape[2] < 3:
        return rgb_arr
    if _is_no_op(params):
        return rgb_arr
    a = np.array(rgb_arr[..., :3], dtype=np.float32, copy=True)

    gain_r = float(params.get("gain_r", 1.0))
    gain_g = float(params.get("gain_g", 1.0))
    gain_b = float(params.get("gain_b", 1.0))
    off_r = float(params.get("offset_r", 0.0))
    off_g = float(params.get("offset_g", 0.0))
    off_b = float(params.get("offset_b", 0.0))
    gamma = float(params.get("gamma", 1.0))
    brightness = float(params.get("brightness", 0.0))
    contrast = float(params.get("contrast", 1.0))
    saturation = float(params.get("saturation", 1.0))
    wb_kelvin = params.get("wb_kelvin", None)

    # 1. Per-channel offset.
    a[..., 0] += off_r
    a[..., 1] += off_g
    a[..., 2] += off_b

    # 2. Per-channel gain.
    a[..., 0] *= gain_r
    a[..., 1] *= gain_g
    a[..., 2] *= gain_b

    # 3. WB Kelvin (skip when None or close to D65).
    if wb_kelvin is not None and abs(float(wb_kelvin) - _REF_KELVIN) > 1.0:
        rm, gm, bm = kelvin_to_rgb_multipliers(float(wb_kelvin))
        a[..., 0] *= rm
        a[..., 1] *= gm
        a[..., 2] *= bm

    # Clamp before non-linear ops so gamma / saturation see in-range data.
    np.clip(a, 0.0, 1.0, out=a)

    # 4. Gamma.
    if abs(gamma - 1.0) > 1e-6 and gamma > 0:
        a = np.power(a, 1.0 / gamma, dtype=np.float32)

    # 5. Brightness.
    if abs(brightness) > 1e-6:
        a = a + brightness

    # 6. Contrast around 0.5.
    if abs(contrast - 1.0) > 1e-6:
        a = (a - 0.5) * contrast + 0.5

    np.clip(a, 0.0, 1.0, out=a)

    # 7. Saturation (luminance-preserving). Uses Rec. 601 luma.
    if abs(saturation - 1.0) > 1e-6:
        luma = (
            0.299 * a[..., 0]
            + 0.587 * a[..., 1]
            + 0.114 * a[..., 2]
        )
        for i in range(3):
            a[..., i] = luma + (a[..., i] - luma) * saturation
        np.clip(a, 0.0, 1.0, out=a)

    if rgb_arr.shape[2] == 4:
        out = np.empty_like(rgb_arr, dtype=np.float32)
        out[..., :3] = a
        out[..., 3] = rgb_arr[..., 3]
        return out
    return a


def auto_white_balance(rgb_arr: np.ndarray,
                       *, method: str = "gray-world") -> Dict[str, float]:
    """Suggest per-channel gain factors that bring the image's average
    (or max) to gray. Returns a dict ``{gain_r, gain_g, gain_b}`` with
    G pinned at 1.0; the caller can multiply existing gains by these
    or just push the suggested values into ``view.grading``.

    method:
      * ``"gray-world"`` — assumes average reflectance is gray.
      * ``"max-rgb"``    — max-channel normalized to G's max.

    Always returns finite values (clamped to [0.1, 10.0]).
    """
    if rgb_arr is None or rgb_arr.ndim != 3 or rgb_arr.shape[2] < 3:
        return {"gain_r": 1.0, "gain_g": 1.0, "gain_b": 1.0}
    a = rgb_arr[..., :3].astype(np.float32, copy=False)
    if method == "max-rgb":
        m = a.reshape(-1, 3).max(axis=0)
        ref = max(1e-6, float(m[1]))
        gain_r = ref / max(1e-6, float(m[0]))
        gain_b = ref / max(1e-6, float(m[2]))
    else:  # gray-world (default)
        m = a.reshape(-1, 3).mean(axis=0)
        ref = max(1e-6, float(m[1]))
        gain_r = ref / max(1e-6, float(m[0]))
        gain_b = ref / max(1e-6, float(m[2]))
    gain_r = float(np.clip(gain_r, 0.1, 10.0))
    gain_b = float(np.clip(gain_b, 0.1, 10.0))
    return {"gain_r": gain_r, "gain_g": 1.0, "gain_b": gain_b}
