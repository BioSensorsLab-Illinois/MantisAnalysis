"""Runtime helpers for DoFP polarization channels and calibration maps.

This module contains the small, server-safe subset of the lab calibration
scripts that the web app needs at analysis time:

* build Stokes/DoLP/AoP from the four analyzer planes
* read the standard ``.polcal.h5`` profile exported by the calibration script
* optionally apply ``Gc_map`` / ``Gc_avg`` before deriving polarization outputs

It intentionally avoids the notebook/batch calibration-generation paths from
the source scripts so importing the web server stays lightweight.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple

import h5py
import numpy as np


POLARIZATION_MODE_IDS = {"polarization_single", "polarization_dual"}
ANALYZER_BANDS: Tuple[str, ...] = ("I0", "I45", "I90", "I135")
DERIVED_BANDS: Tuple[str, ...] = ("S0", "DoLP", "AoP")

# Existing exported calibration files carry the historical runtime plane order.
# This matches the compatibility path in the supplied ISP_DoFP_Calibration.py.
INTERNAL_FROM_STANDARD: Tuple[int, int, int, int] = (0, 3, 2, 1)


@dataclass(frozen=True)
class PolcalProfile:
    """In-memory view of one ``.polcal.h5`` profile."""

    profile_id: str
    gc: np.ndarray
    use_avg: bool
    valid_mask: Optional[np.ndarray]
    frame_shape_hw: Tuple[int, int]
    super_shape: Tuple[int, int]
    legacy_dc_shift_map: Optional[np.ndarray] = None


def is_polarization_mode(mode_id: str | None) -> bool:
    return (mode_id or "") in POLARIZATION_MODE_IDS


def polarization_derived_keys(dual_gain: bool) -> Tuple[str, ...]:
    if dual_gain:
        return tuple(f"{gain}-{band}" for gain in ("HG", "LG") for band in DERIVED_BANDS)
    return DERIVED_BANDS


def is_polarization_virtual_channel(channel: str) -> bool:
    return parse_polarization_channel(channel) is not None


def parse_polarization_channel(channel: str) -> Optional[Tuple[str, str]]:
    """Return ``(prefix, band)`` for analyzer/derived channel keys.

    ``prefix`` is ``""``, ``"HG-"``, or ``"LG-"``. ``band`` is one of
    ``I0/I45/I90/I135/S0/DoLP/AoP``.
    """
    if not channel:
        return None
    for prefix in ("HG-", "LG-"):
        if channel.startswith(prefix):
            band = channel[len(prefix):]
            if band in ANALYZER_BANDS or band in DERIVED_BANDS:
                return prefix, band
            return None
    if channel in ANALYZER_BANDS or channel in DERIVED_BANDS:
        return "", channel
    return None


def append_virtual_channels(
    channels: Dict[str, np.ndarray],
    *,
    dual_gain: bool,
) -> Dict[str, np.ndarray]:
    """Return a channel dict with finite placeholder derived arrays added.

    The server recomputes polarization virtual channels at access time so dark
    subtraction and calibration state are honored. Placeholders are still kept
    in ``LoadedSource.channels`` so existing channel pickers and request
    validators can discover the keys without a separate virtual-channel model.
    """
    out = dict(channels)
    for key in polarization_derived_keys(dual_gain):
        if key in out:
            continue
        prefix, band = parse_polarization_channel(key) or ("", "")
        base_key = f"{prefix}I0"
        if base_key in out:
            shape = out[base_key].shape
            out[key] = np.zeros(shape, dtype=np.float32)
    return out


def physical_channel_keys(channels: Dict[str, np.ndarray]) -> Iterable[str]:
    """Yield non-virtual channel keys for dark-frame compatibility checks."""
    for key in channels:
        parsed = parse_polarization_channel(key)
        if parsed is not None and parsed[1] in DERIVED_BANDS:
            continue
        yield key


def stokes_from_analyzers(i_std: np.ndarray) -> np.ndarray:
    """Build ``[S0, S1, S2]`` from ``[I0, I45, I90, I135]`` intensities."""
    i = np.asarray(i_std, dtype=np.float32)
    if i.shape[-1] != 4:
        raise ValueError(f"analyzer stack must end with 4 planes, got {i.shape}")
    stokes = np.empty(i.shape[:-1] + (3,), dtype=np.float32)
    stokes[..., 0] = i[..., 0] + i[..., 2]
    stokes[..., 1] = i[..., 0] - i[..., 2]
    stokes[..., 2] = i[..., 1] - i[..., 3]
    return stokes


def compute_aop_dolp(
    stokes: np.ndarray,
    *,
    s0_floor: float = 1.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """Compute AoP degrees ``[0, 180)`` and DoLP ``[0, 1]``.

    Invalid or low-S0 pixels are returned as NaN, mirroring the supplied
    calibration script. Callers that need display-safe images can convert NaN
    to a finite fill value at the boundary.
    """
    s = np.asarray(stokes, dtype=np.float32)
    if s.shape[-1] != 3:
        raise ValueError(f"stokes stack must end with 3 planes, got {s.shape}")
    s0 = s[..., 0]
    s1 = s[..., 1]
    s2 = s[..., 2]

    aop = np.full(s0.shape, np.nan, dtype=np.float32)
    dolp = np.full(s0.shape, np.nan, dtype=np.float32)
    valid = (
        np.isfinite(s0)
        & np.isfinite(s1)
        & np.isfinite(s2)
        & (s0 > float(s0_floor))
    )
    if np.any(valid):
        aop_valid = 0.5 * np.degrees(np.arctan2(s2[valid], s1[valid]))
        aop[valid] = np.mod(aop_valid, 180.0).astype(np.float32)
        dolp_valid = np.sqrt(s1[valid] ** 2 + s2[valid] ** 2) / s0[valid]
        dolp[valid] = np.clip(dolp_valid, 0.0, 1.0).astype(np.float32)
    return aop, dolp


def load_polcal_profile(
    polcal_path: str | Path,
    *,
    profile_id: str | None = None,
    use_avg: bool = False,
) -> PolcalProfile:
    """Load one profile from the standard ``.polcal.h5`` schema."""
    path = Path(polcal_path).expanduser().resolve()
    with h5py.File(path, "r") as f:
        resolved_profile_id = _resolve_profile_id(f, profile_id=profile_id)
        if "profiles" not in f or resolved_profile_id not in f["profiles"]:
            raise ValueError(f"profile {resolved_profile_id!r} not found in {path.name}")
        profile = f["profiles"][resolved_profile_id]
        gc_name = "Gc_avg" if use_avg else "Gc_map"
        if gc_name not in profile:
            raise ValueError(f"profile {resolved_profile_id!r} is missing {gc_name}")
        gc = profile[gc_name][...].astype(np.float32)
        if gc.ndim == 2:
            if gc.shape != (3, 4):
                raise ValueError(f"{gc_name} must be (3,4), got {gc.shape}")
        elif gc.ndim == 4:
            if gc.shape[-2:] != (3, 4):
                raise ValueError(f"{gc_name} must end with (3,4), got {gc.shape}")
        else:
            raise ValueError(f"{gc_name} must be (Hs,Ws,3,4) or (3,4), got {gc.shape}")

        valid_mask = (
            profile["valid_mask"][...].astype(np.uint8)
            if "valid_mask" in profile
            else None
        )
        frame_shape_hw = _attr_pair(profile, "frame_shape_hw")
        super_shape = _attr_pair(profile, "super_shape")
        if not super_shape:
            if gc.ndim == 4:
                super_shape = (int(gc.shape[0]), int(gc.shape[1]))
            elif valid_mask is not None:
                super_shape = (int(valid_mask.shape[0]), int(valid_mask.shape[1]))
            elif frame_shape_hw:
                super_shape = (int(frame_shape_hw[0] // 2), int(frame_shape_hw[1] // 2))
            else:
                raise ValueError(f"profile {resolved_profile_id!r} lacks super_shape")
        if not frame_shape_hw:
            frame_shape_hw = (int(super_shape[0] * 2), int(super_shape[1] * 2))

        if valid_mask is not None and valid_mask.shape != super_shape:
            raise ValueError(
                f"valid_mask shape must be {super_shape}, got {valid_mask.shape}"
            )

        legacy_dc_shift_map = None
        runtime_compat = profile.get("runtime_compat")
        if runtime_compat is not None and "legacy_dc_shift_map" in runtime_compat:
            legacy_dc_shift_map = runtime_compat["legacy_dc_shift_map"][...].astype(np.float32)

    return PolcalProfile(
        profile_id=resolved_profile_id,
        gc=gc,
        use_avg=bool(use_avg),
        valid_mask=valid_mask,
        frame_shape_hw=frame_shape_hw,
        super_shape=super_shape,
        legacy_dc_shift_map=legacy_dc_shift_map,
    )


def validate_polcal_for_shape(profile: PolcalProfile, shape_hw: Tuple[int, int]) -> None:
    """Raise if a per-pixel calibration map does not match a channel shape."""
    shape = (int(shape_hw[0]), int(shape_hw[1]))
    if profile.gc.ndim == 4 and tuple(profile.gc.shape[:2]) != shape:
        raise ValueError(
            f"calibration profile super_shape {tuple(profile.gc.shape[:2])} "
            f"does not match polarization channel shape {shape}; load a matching "
            "calibration or enable an average-profile export."
        )
    if profile.valid_mask is not None and tuple(profile.valid_mask.shape) != shape:
        raise ValueError(
            f"calibration valid_mask shape {tuple(profile.valid_mask.shape)} "
            f"does not match polarization channel shape {shape}"
        )


def compute_virtual_channel(
    channels: Dict[str, np.ndarray],
    channel: str,
    *,
    dark_channels: Optional[Dict[str, np.ndarray]] = None,
    calibration: Optional[PolcalProfile] = None,
    calibration_enabled: bool = False,
    s0_floor: float = 1.0,
) -> np.ndarray:
    """Compute one analyzer or derived polarization channel.

    Analyzer channels return the raw/dark-subtracted plane unless calibration
    is enabled, in which case they return the reconstructed calibrated analyzer
    plane in the app's runtime order. Derived channels are computed from raw
    Stokes or calibrated Stokes as appropriate.
    """
    parsed = parse_polarization_channel(channel)
    if parsed is None:
        raise KeyError(channel)
    prefix, band = parsed
    stack = _stack_runtime_analyzers(channels, prefix, dark_channels=dark_channels)

    use_cal = calibration_enabled and calibration is not None
    if use_cal:
        validate_polcal_for_shape(calibration, stack.shape[:2])
        stokes = _apply_calibration(stack, calibration)
        if band in ANALYZER_BANDS:
            reconstructed = _reconstruct_runtime_intensities(stokes, calibration)
            idx = ANALYZER_BANDS.index(band)
            return _display_safe(reconstructed[..., idx])
    else:
        stokes = stokes_from_analyzers(stack)
        if band in ANALYZER_BANDS:
            idx = ANALYZER_BANDS.index(band)
            return _display_safe(stack[..., idx])

    if band == "S0":
        return _display_safe(stokes[..., 0])
    aop, dolp = compute_aop_dolp(stokes, s0_floor=s0_floor)
    if band == "DoLP":
        return _display_safe(dolp)
    if band == "AoP":
        return _display_safe(aop)
    raise KeyError(channel)


def _resolve_profile_id(h5_file: h5py.File, profile_id: str | None = None) -> str:
    if profile_id is not None:
        return str(profile_id)
    if "index" in h5_file and "profiles" in h5_file["index"]:
        ds = h5_file["index/profiles"]
        if ds.shape[0] > 0:
            raw_id = ds["profile_id"][0]
            if isinstance(raw_id, bytes):
                return raw_id.decode("ascii", errors="ignore").rstrip("\x00")
            return str(raw_id)
    if "profiles" not in h5_file:
        raise ValueError("calibration file is missing /profiles")
    profiles = list(h5_file["profiles"].keys())
    if not profiles:
        raise ValueError("No profiles found in calibration file")
    return str(profiles[0])


def _attr_pair(profile: h5py.Group, name: str) -> Tuple[int, int]:
    if name not in profile.attrs:
        return ()
    raw = profile.attrs[name]
    arr = np.asarray(raw).reshape(-1)
    if arr.size < 2:
        return ()
    return (int(arr[0]), int(arr[1]))


def _stack_runtime_analyzers(
    channels: Dict[str, np.ndarray],
    prefix: str,
    *,
    dark_channels: Optional[Dict[str, np.ndarray]],
) -> np.ndarray:
    planes = []
    for band in ANALYZER_BANDS:
        key = f"{prefix}{band}"
        if key not in channels:
            raise KeyError(f"missing polarization analyzer channel {key!r}")
        arr = np.asarray(channels[key], dtype=np.float32)
        if dark_channels is not None:
            dark = dark_channels.get(key)
            if dark is not None:
                d = np.asarray(dark, dtype=np.float32)
                if d.shape != arr.shape:
                    raise ValueError(
                        f"dark channel {key!r} shape {d.shape} != source shape {arr.shape}"
                    )
                arr = np.clip(arr - d, 0.0, None)
        planes.append(arr)
    min_h = min(p.shape[0] for p in planes)
    min_w = min(p.shape[1] for p in planes)
    cropped = [p[:min_h, :min_w] for p in planes]
    return np.stack(cropped, axis=-1).astype(np.float32, copy=False)


def _apply_calibration(stack: np.ndarray, profile: PolcalProfile) -> np.ndarray:
    gc = profile.gc
    if gc.ndim == 2:
        stokes = np.einsum("ij,...j->...i", gc, stack)
    else:
        stokes = np.einsum("...ij,...j->...i", gc, stack)
    stokes = stokes.astype(np.float32, copy=False)
    if profile.valid_mask is not None:
        stokes = stokes.copy()
        stokes[profile.valid_mask == 0] = np.nan
    return stokes


def _reconstruct_runtime_intensities(
    stokes: np.ndarray,
    profile: PolcalProfile,
) -> np.ndarray:
    standard = np.empty(stokes.shape[:-1] + (4,), dtype=np.float32)
    standard[..., 0] = 0.5 * (stokes[..., 0] + stokes[..., 1])  # I0
    standard[..., 1] = 0.5 * (stokes[..., 0] + stokes[..., 2])  # I45
    standard[..., 2] = 0.5 * (stokes[..., 0] - stokes[..., 1])  # I90
    standard[..., 3] = 0.5 * (stokes[..., 0] - stokes[..., 2])  # I135
    runtime = standard[..., list(INTERNAL_FROM_STANDARD)]
    if profile.legacy_dc_shift_map is not None:
        runtime = runtime + profile.legacy_dc_shift_map
    return np.clip(runtime, 0.0, None)


def _display_safe(a: np.ndarray) -> np.ndarray:
    return np.nan_to_num(
        np.asarray(a, dtype=np.float32),
        nan=0.0,
        posinf=0.0,
        neginf=0.0,
    )
