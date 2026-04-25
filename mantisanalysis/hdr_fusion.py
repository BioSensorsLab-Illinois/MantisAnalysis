"""HDR fusion helpers for GSense dual-gain RGB-NIR sources.

play-tab-recording-inspection-rescue-v1 M25.

The GSense sensor records HG (high-gain) and LG (low-gain) halves
simultaneously. HG saturates above ``hg_saturation_threshold`` (default
~60000 in 16-bit); LG remains linear there. Pre-saturation, HG ≈
``hg_lg_gain_ratio × LG`` (default 16×). Two fusion modes:

  * ``"switch"`` — saturation-aware hard switch:
        out = HG    where HG < threshold
        out = LG·R  elsewhere (R = gain ratio)
    Cheapest, deterministic, edges may be visible at the seam.

  * ``"mertens"`` — Reinhard-style smooth blend on per-pixel weights.
        w_hg = 1 - smoothstep(threshold − knee, threshold, HG)
        out = w_hg·HG + (1 − w_hg)·(LG·R)
    Smoother transitions, only marginally more expensive.

Both modes preserve dynamic range past HG saturation by recovering
detail from LG. Pure NumPy — no FastAPI/React/Qt.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

import numpy as np


# Defaults match GSense documentation. The "saturation threshold" is
# the HG value above which we trust LG more; the "gain ratio" is the
# HG/LG amplification factor (HG ≈ R × LG below saturation).
_DEFAULT_PARAMS: Dict[str, Any] = {
    "fusion": "switch",
    "hg_saturation_threshold": 60000.0,
    "hg_lg_gain_ratio": 16.0,
    "knee_width": 4000.0,         # mertens-only smoothstep knee
}


def fuse_hdr(hg_arr: np.ndarray,
             lg_arr: np.ndarray,
             params: Optional[Dict[str, Any]] = None) -> np.ndarray:
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
        raise ValueError(
            f"fuse_hdr shape mismatch: hg={hg_arr.shape} vs lg={lg_arr.shape}"
        )
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
        return out.astype(np.float32, copy=False)

    # default: hard switch
    out = np.where(hg < threshold, hg, lg_scaled)
    return out.astype(np.float32, copy=False)


def add_hdr_channels(channels: Dict[str, np.ndarray],
                     *,
                     params: Optional[Dict[str, Any]] = None,
                     ) -> Dict[str, np.ndarray]:
    """Mutate ``channels`` in-place to add ``HDR-{R,G,B,NIR,Y}``.

    Expects HG-* / LG-* keys for R / G / B / NIR (the GSense RGB-NIR
    layout). When any required channel is missing, returns ``channels``
    unchanged. ``HDR-Y`` is the Rec. 601 luma over the fused R/G/B.

    Idempotent: re-calling with the same channel dict simply overwrites
    the existing HDR-* entries. play-tab-recording-inspection-rescue-v1
    M25.
    """
    needed = ("HG-R", "HG-G", "HG-B", "HG-NIR",
              "LG-R", "LG-G", "LG-B", "LG-NIR")
    if not all(k in channels for k in needed):
        return channels
    for c in ("R", "G", "B", "NIR"):
        channels[f"HDR-{c}"] = fuse_hdr(
            channels[f"HG-{c}"], channels[f"LG-{c}"], params=params,
        )
    # Rec. 601 luma over the fused R/G/B.
    r = channels["HDR-R"].astype(np.float32, copy=False)
    g = channels["HDR-G"].astype(np.float32, copy=False)
    b = channels["HDR-B"].astype(np.float32, copy=False)
    channels["HDR-Y"] = (0.299 * r + 0.587 * g + 0.114 * b).astype(
        np.float32, copy=False
    )
    return channels
