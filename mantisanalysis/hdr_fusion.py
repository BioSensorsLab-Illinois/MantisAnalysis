"""HDR fusion helpers for GSense dual-gain RGB-NIR sources.

play-tab-recording-inspection-rescue-v1 M25.

The GSense sensor records HG (high-gain) and LG (low-gain) halves
simultaneously. HG saturates above ``hg_saturation_threshold`` (default
~60000 in 16-bit); LG remains linear there. Pre-saturation, HG ≈
``hg_lg_gain_ratio × LG`` (default 16×).

Fusion modes:

  * ``"switch"`` — saturation-aware hard switch:
        out = HG    where HG < threshold
        out = LG·R  elsewhere (R = gain ratio)
    Cheapest, deterministic, edges may be visible at the seam.

  * ``"mertens"`` — smoothstep blend on per-pixel weights.
        w_hg = 1 − smoothstep(threshold − knee, threshold, HG)
        out = w_hg·HG + (1 − w_hg)·(LG·R)
    Smoother transitions, only marginally more expensive.

  * ``"linear"`` — fixed weighted average independent of saturation.
        out = w·HG + (1 − w)·(LG·R)     where w = ``hg_lg_blend``
    Useful for users who want a manual mix that ignores HG
    saturation (e.g. to compare LG-only vs HG-only). Setting w=1
    is HG-only, w=0 is LG-only-scaled.

Output scaling (post-fusion):

  * ``"none"`` (default) — return raw fused values. Can exceed 65535
    when LG·R lifts a region past the 16-bit display range.
  * ``"linear"`` — uniform rescale so the fused frame's max maps to
    ``output_max`` and its min maps to ``output_min`` (default 0..65535;
    ``output_min`` lets the user lift the floor when they want a black
    pedestal).
  * ``"reinhard"`` — soft tone-map ``x / (1 + x/L_white)`` then
    rescale to ``[output_min, output_max]``. Compresses highlights more
    than shadows so a bright LG region doesn't crush mid-tones.

Both fusion + scaling run in pure NumPy — no FastAPI/React/Qt.
"""

from __future__ import annotations

from typing import Any

import numpy as np

# Defaults match GSense documentation. The "saturation threshold" is
# the HG value above which we trust LG more; the "gain ratio" is the
# HG/LG amplification factor (HG ≈ R × LG below saturation).
_DEFAULT_PARAMS: dict[str, Any] = {
    "fusion": "switch",
    "hg_saturation_threshold": 60000.0,
    "hg_lg_gain_ratio": 16.0,
    "knee_width": 4000.0,  # mertens-only smoothstep knee
    "hg_lg_blend": 0.5,  # linear-only HG/LG mix weight (1=HG, 0=LG)
    "output_scale": "none",  # 'none' | 'linear' | 'reinhard'
    "output_min": 0.0,  # post-scale floor (lifts the black point)
    "output_max": 65535.0,  # post-scale ceiling (the display range)
    "reinhard_white": 100000.0,  # reinhard L_white knee
}


def fuse_hdr(
    hg_arr: np.ndarray, lg_arr: np.ndarray, params: dict[str, Any] | None = None
) -> np.ndarray:
    """Fuse one HG/LG channel pair into a single HDR channel.

    Both inputs must have the same shape. Output is float32 in the
    same numeric range as ``hg_arr`` (so subsequent normalize/colormap
    paths see HG-comparable values, not normalized [0, 1]). Saturated
    HG pixels are replaced by ``LG × hg_lg_gain_ratio``.

    Returns input shape, dtype float32.
    """
    if hg_arr is None or lg_arr is None:
        return hg_arr if hg_arr is not None else lg_arr
    if hg_arr.shape != lg_arr.shape:
        raise ValueError(f"fuse_hdr shape mismatch: hg={hg_arr.shape} vs lg={lg_arr.shape}")
    p = dict(_DEFAULT_PARAMS)
    if params:
        p.update(params)
    fusion = (p.get("fusion") or "switch").lower()
    threshold = float(p.get("hg_saturation_threshold", 60000.0))
    ratio = float(p.get("hg_lg_gain_ratio", 16.0))

    hg = hg_arr.astype(np.float32, copy=False)
    lg = lg_arr.astype(np.float32, copy=False)
    lg_scaled = lg * ratio

    if fusion == "mertens":
        knee = max(1.0, float(p.get("knee_width", 4000.0)))
        # smoothstep((threshold - knee), threshold, hg) — 1.0 below
        # the knee, 0.0 above the threshold, smooth transition between.
        x = np.clip((threshold - hg) / knee, 0.0, 1.0)
        w_hg = x * x * (3.0 - 2.0 * x)
        out = w_hg * hg + (1.0 - w_hg) * lg_scaled
    elif fusion == "linear":
        # Fixed weighted average. w = 1 → HG-only, w = 0 → LG-only-
        # scaled. Independent of saturation; lets the user manually
        # bias the mix.
        w = float(p.get("hg_lg_blend", 0.5))
        w = max(0.0, min(1.0, w))
        out = w * hg + (1.0 - w) * lg_scaled
    else:
        # default: saturation-aware hard switch.
        out = np.where(hg < threshold, hg, lg_scaled)

    # ----- Output scaling -------------------------------------------
    # The fused signal can exceed the 16-bit display range when
    # LG · ratio lifts a saturated region past 65535. Three options:
    #   * "none"     — pass through (may clip downstream)
    #   * "linear"   — uniform rescale so out.min() == output_min and
    #                  out.max() == output_max
    #   * "reinhard" — soft tone-map x / (1 + x / L_white), then
    #                  rescale into [output_min, output_max]
    out = np.clip(out, 0.0, None)
    scale_mode = (p.get("output_scale") or "none").lower()
    if scale_mode in ("linear", "reinhard"):
        out_max = float(p.get("output_max", 65535.0))
        out_min = float(p.get("output_min", 0.0))
        if out_max <= 0.0:
            out_max = 65535.0
        if out_min < 0.0:
            out_min = 0.0
        if out_min >= out_max:
            out_min = max(0.0, out_max - 1.0)
        span = out_max - out_min
        if scale_mode == "reinhard":
            l_white = max(1.0, float(p.get("reinhard_white", 100000.0)))
            tone = out / (1.0 + out / l_white)
            # tone's range is [0, l_white]; rescale so [tone.min, tone.max]
            # maps to [out_min, out_max].
            cur_min = float(np.min(tone)) if tone.size else 0.0
            cur_max = float(np.max(tone)) if tone.size else 0.0
            if cur_max > cur_min:
                out = (tone - cur_min) * (span / (cur_max - cur_min)) + out_min
            elif cur_max > 0.0:
                # Single-value frame — collapse to out_min.
                out = np.full_like(tone, out_min)
            else:
                out = tone
        else:  # "linear"
            cur_min = float(np.min(out)) if out.size else 0.0
            cur_max = float(np.max(out)) if out.size else 0.0
            if cur_max > cur_min:
                out = (out - cur_min) * (span / (cur_max - cur_min)) + out_min
            elif cur_max > 0.0:
                out = np.full_like(out, out_min)
        out = np.clip(out, out_min, out_max)
    return out.astype(np.float32, copy=False)


def add_hdr_channels(
    channels: dict[str, np.ndarray],
    *,
    params: dict[str, Any] | None = None,
) -> dict[str, np.ndarray]:
    """Mutate ``channels`` in-place to add ``HDR-{R,G,B,NIR,Y}``.

    Expects HG-* / LG-* keys for R / G / B / NIR (the GSense RGB-NIR
    layout). When any required channel is missing, returns ``channels``
    unchanged. ``HDR-Y`` is the Rec. 601 luma over the fused R/G/B.

    Idempotent: re-calling with the same channel dict simply overwrites
    the existing HDR-* entries. play-tab-recording-inspection-rescue-v1
    M25.
    """
    needed = ("HG-R", "HG-G", "HG-B", "HG-NIR", "LG-R", "LG-G", "LG-B", "LG-NIR")
    if not all(k in channels for k in needed):
        return channels
    for c in ("R", "G", "B", "NIR"):
        channels[f"HDR-{c}"] = fuse_hdr(
            channels[f"HG-{c}"],
            channels[f"LG-{c}"],
            params=params,
        )
    # Rec. 601 luma over the fused R/G/B.
    r = channels["HDR-R"].astype(np.float32, copy=False)
    g = channels["HDR-G"].astype(np.float32, copy=False)
    b = channels["HDR-B"].astype(np.float32, copy=False)
    channels["HDR-Y"] = (0.299 * r + 0.587 * g + 0.114 * b).astype(np.float32, copy=False)
    return channels
