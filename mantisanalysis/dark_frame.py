"""Dark-frame averaging + exposure matching for the Playback mode.

Pure NumPy / h5py module — same purity invariants as
``mantisanalysis.recording`` (AGENT_RULES rule 7).

A "master dark" is the per-pixel average of N dark-stack frames,
extracted into the same channel-key schema as the parent recording so
``playback_pipeline.render_frame`` can subtract it pixel-for-pixel.

Three averaging strategies (per user 2026-04-24, ExecPlan M2):

  * mean            — `np.mean(stack, axis=0)`. Default; fastest. Sensitive
                      to cosmic-ray hits.
  * median          — `np.median(stack, axis=0)`. ~1.3× the wall time;
                      robust to outliers.
  * sigma_clipped   — iterative mean with |x − μ| > kσ rejected. Good
                      compromise; default k=3.

Exposure matching is a fractional-tolerance lookup over a pool of
masters. Per risk-skeptic resolution + user 2026-04-24, ties at the same
exposure resolve to the most-recently-loaded master.

Channel-key schema (rule 6) is preserved by routing every dark frame
through ``image_io.extract_with_mode`` + the rgb_nir Y synthesis, the
same path ``recording.extract_frame`` uses.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

import h5py
import numpy as np

from . import isp_modes as _isp
from .image_io import extract_with_mode, luminance_from_rgb
from .recording import (
    WARN_DARK_SHORT,
    WARN_META_EXP,
    Warning,
    _detect_frames_dataset,
    _frame_shape_from_dataset,
)


Strategy = Literal["mean", "median", "sigma_clipped"]


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MasterDark:
    """Averaged dark-frame channel dict + provenance.

    Attributes
    ----------
    channels :
        Dict ``{channel_key: float64 ndarray (H, W)}``, one entry per
        channel key in the chosen ISP mode. For ``rgb_nir`` the Y
        channels are synthesized to keep the canonical 10-key schema.
    frames_averaged :
        Actual number of frames consumed (after ``max_frames`` cap).
    exposure :
        Raw value from ``/camera/integration-time`` mean (camera units —
        seconds for Mantis FSI, microseconds for synthetic fixtures;
        no implicit conversion).
    strategy :
        Which averaging strategy was used.
    sigma_threshold :
        Set only when ``strategy='sigma_clipped'`` (default 3.0).
    """

    name: str
    path: Optional[str]
    isp_mode_id: str
    channels: Dict[str, np.ndarray]
    frame_count_total: int
    frames_averaged: int
    exposure: Optional[float]
    shape: Tuple[int, int]
    strategy: Strategy
    sigma_threshold: Optional[float]
    loaded_at: float = field(default_factory=time.time)
    warnings: Tuple[Warning, ...] = ()


# ---------------------------------------------------------------------------
# Averaging math
# ---------------------------------------------------------------------------


def _aggregate_strategy(stack: np.ndarray,
                        strategy: Strategy,
                        sigma_threshold: float) -> np.ndarray:
    """Average a (N, H, W) float64 stack into one (H, W) per-pixel image.

    Inputs are float64 to keep the math precise; output is float64.
    """
    if stack.ndim != 3:
        raise ValueError(f"expected (N, H, W) stack; got shape {stack.shape}")
    if strategy == "mean":
        return np.mean(stack, axis=0)
    if strategy == "median":
        return np.median(stack, axis=0)
    if strategy == "sigma_clipped":
        # Iterative sigma-clip: at each iter, compute μ + σ across N axis,
        # mask pixels |x - μ| > kσ, recompute μ from the unmasked mean.
        # Two iterations is plenty for cosmic-ray rejection without
        # diverging on real noise tails.
        mu = np.mean(stack, axis=0)
        for _ in range(2):
            sigma = np.std(stack, axis=0, ddof=0)
            sigma = np.where(sigma == 0, 1e-9, sigma)
            mask = np.abs(stack - mu) <= float(sigma_threshold) * sigma
            # Use np.ma so masked pixels don't contribute.
            ma = np.ma.array(stack, mask=~mask)
            new_mu = ma.mean(axis=0).filled(mu)
            if np.allclose(new_mu, mu, atol=1e-9):
                mu = new_mu
                break
            mu = new_mu
        return mu
    raise ValueError(f"unknown strategy {strategy!r}; "
                     "expected one of 'mean'|'median'|'sigma_clipped'")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def average_dark_h5(path: str | Path,
                    *,
                    max_frames: int = 256,
                    isp_mode_id: Optional[str] = None,
                    isp_config: Optional[Dict[str, Any]] = None,
                    strategy: Strategy = "mean",
                    sigma_threshold: float = 3.0,
                    name: Optional[str] = None,
                    ) -> MasterDark:
    """Read a dark stack from H5, ISP-extract each frame, average per channel.

    Parameters
    ----------
    path : str | Path
        Dark-stack H5. Same layout heuristics as `recording.inspect_recording`
        apply (canonical /camera/frames or fall through).
    max_frames : int
        Cap on how many frames are consumed (defaults to 256). When the
        stack is shorter we use what's there and emit ``W-DARK-SHORT``
        if fewer than 4.
    isp_mode_id, isp_config :
        Forwarded to `image_io.extract_with_mode`. When ``None`` defaults
        to the rgb_nir mode (matches `recording.inspect_recording`).
    strategy :
        Averaging strategy. See module docstring.
    sigma_threshold :
        Only used for ``strategy='sigma_clipped'``. Default 3σ.
    name :
        Optional override for the master's display name. Defaults to
        ``Path(path).name``.

    Returns
    -------
    MasterDark
        Channel-key schema matches the chosen ISP mode + Y synthesis
        for ``rgb_nir`` (so dark subtraction lines up with the
        recording's channel dict).

    Raises
    ------
    FileNotFoundError, ValueError, KeyError
        On file / layout / mode problems.
    """
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(p)

    warnings: List[Warning] = []
    mode = _isp.get_mode(isp_mode_id or _isp.default_mode_id_for_source_kind(
        "h5", is_dual_gain=True,
    ))
    cfg = _isp.normalize_config(mode, isp_config)

    with h5py.File(p, "r") as f:
        ds, dataset_path, det_warns = _detect_frames_dataset(f)
        warnings.extend(det_warns)
        if ds is None:
            raise ValueError(
                f"no frames dataset found in {p.name}; cannot average"
            )
        n_total, raw_shape = _frame_shape_from_dataset(ds)
        if n_total == 0:
            raise ValueError(f"dark-stack {p.name} has zero frames")

        n_use = min(int(max_frames), n_total)
        if n_use < 4:
            warnings.append(Warning(
                code=WARN_DARK_SHORT,
                severity="warning",
                text=f"dark stack {p.name} has only {n_use} frames; "
                     "averaging is noisy below ~16",
            ))

        # Pull integration-time once for the whole stack so we can tag the
        # master with a single exposure value.  Skip when missing.
        exp_mean: Optional[float] = None
        if "camera" in f and "integration-time" in f["camera"]:
            it = np.asarray(f["camera/integration-time"][:n_use], dtype=np.float64)
            if it.size:
                exp_mean = float(np.mean(it))
        elif "integration-time" in f:
            it = np.asarray(f["integration-time"][:n_use], dtype=np.float64)
            if it.size:
                exp_mean = float(np.mean(it))
        if exp_mean is None:
            warnings.append(Warning(
                code=WARN_META_EXP,
                severity="warning",
                text=f"{p.name}: missing integration-time; auto-match disabled",
            ))

        # Per-channel float64 accumulator. We keep one stack per channel —
        # memory cost is `n_use * H_ch * W_ch * 8` bytes per channel; for
        # the dev folder's 1024×1024 channels that's ~256 MB at
        # n_use=32 (10 channels × 8 MB), well under budget.
        accum: Dict[str, List[np.ndarray]] = {}

        for i in range(n_use):
            raw = np.asarray(ds[i])
            if raw.ndim == 3 and raw.shape[-1] == 1:
                raw = raw[..., 0]
            channels = extract_with_mode(raw, mode, cfg)
            if mode.id == _isp.RGB_NIR.id:
                hg = {k: channels[f"HG-{k}"] for k in ("R", "G", "B")}
                lg = {k: channels[f"LG-{k}"] for k in ("R", "G", "B")}
                channels["HG-Y"] = luminance_from_rgb(hg)
                channels["LG-Y"] = luminance_from_rgb(lg)
            for k, v in channels.items():
                accum.setdefault(k, []).append(v.astype(np.float64, copy=False))

    averaged: Dict[str, np.ndarray] = {}
    any_shape: Tuple[int, int] = (0, 0)
    for k, frames in accum.items():
        stack = np.stack(frames, axis=0)
        averaged[k] = _aggregate_strategy(stack, strategy, sigma_threshold)
        any_shape = (int(averaged[k].shape[0]), int(averaged[k].shape[1]))

    return MasterDark(
        name=name or p.name,
        path=str(p),
        isp_mode_id=mode.id,
        channels=averaged,
        frame_count_total=n_total,
        frames_averaged=n_use,
        exposure=exp_mean,
        shape=any_shape,
        strategy=strategy,
        sigma_threshold=sigma_threshold if strategy == "sigma_clipped" else None,
        warnings=tuple(warnings),
    )


def bench_dark(shape: Tuple[int, int],
               channels: Sequence[str],
               *,
               pedestal: float = 140.0,
               isp_mode_id: str = "rgb_nir",
               name: str = "synthetic-dark",
               ) -> MasterDark:
    """Synthesize a flat-pedestal master dark for development without a
    real dark-frame H5 capture.

    Marks the result with a ``W-DARK-SYNTHETIC`` warning so the UI can
    surface "this is fabricated" — never let it sneak into a real
    measurement path.
    """
    h, w = int(shape[0]), int(shape[1])
    arr = np.full((h, w), float(pedestal), dtype=np.float64)
    return MasterDark(
        name=name,
        path=None,
        isp_mode_id=isp_mode_id,
        channels={k: arr.copy() for k in channels},
        frame_count_total=0,
        frames_averaged=0,
        exposure=None,
        shape=(h, w),
        strategy="mean",
        sigma_threshold=None,
        warnings=(Warning(
            code="W-DARK-SYNTHETIC",
            severity="info",
            text=f"{name}: synthetic flat-pedestal dark (pedestal={pedestal}); "
                 "for development only, never a real measurement",
        ),),
    )


# ---------------------------------------------------------------------------
# Exposure matching
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DarkMatch:
    """One exposure-match candidate."""
    dark: MasterDark
    delta_pct: float


def match_dark_by_exposure(target: float,
                           pool: Sequence[MasterDark],
                           tolerance: float = 0.10,
                           ) -> Tuple[Optional[MasterDark], List[DarkMatch]]:
    """Pick the best master dark matching ``target`` exposure (raw units).

    Parameters
    ----------
    target : float
        Target exposure value (same camera units as the master darks'
        ``exposure`` field).
    pool : Sequence[MasterDark]
        Available masters.
    tolerance : float
        Fractional tolerance — a match is allowed when
        ``|d.exposure - target| / max(|target|, eps) ≤ tolerance``.

    Returns
    -------
    (best_match, alternatives)
        ``best_match`` is the exposed-closest master that satisfies
        the tolerance. ``alternatives`` is the full sorted list of
        candidates (closest first), incl. ones outside the tolerance,
        for the UI's "alternatives" surface. Ties at zero delta resolve
        to the **most recent** master (max ``loaded_at``) per user
        2026-04-24.

    On no candidates: ``(None, [])``.
    On all candidates outside tolerance: ``(None, alternatives)``.
    """
    if not pool:
        return None, []
    eps = 1e-12
    target_abs = max(abs(float(target)), eps)

    cands: List[DarkMatch] = []
    for d in pool:
        if d.exposure is None:
            continue
        delta = abs(float(d.exposure) - float(target)) / target_abs
        cands.append(DarkMatch(dark=d, delta_pct=float(delta)))

    if not cands:
        return None, []

    # Sort by delta ascending; on tie break by loaded_at desc (most recent wins).
    cands.sort(key=lambda m: (m.delta_pct, -m.dark.loaded_at))
    best: Optional[MasterDark] = None
    if cands[0].delta_pct <= float(tolerance):
        best = cands[0].dark
    return best, cands


__all__ = [
    "Strategy",
    "MasterDark",
    "DarkMatch",
    "average_dark_h5",
    "bench_dark",
    "match_dark_by_exposure",
]
