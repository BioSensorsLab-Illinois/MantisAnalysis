"""H5 recording inspection for the Playback (Recording Inspection) mode.

Pure NumPy / h5py module — no FastAPI, no React, no
``mantisanalysis.session`` / ``mantisanalysis.server`` imports
(AGENT_RULES rule 7). The Playback frontend never reaches into this
module directly; it goes through ``mantisanalysis.server`` via
``/api/playback/*``.

Frozen invariants honored:
  * Channel-key schema (rule 6) — every recording flows through
    ``image_io.extract_with_mode`` and (for ``rgb_nir``)
    ``luminance_from_rgb`` so the emitted dict carries the canonical
    10-key set ``{HG-R, HG-G, HG-B, HG-NIR, HG-Y, LG-R, LG-G, LG-B,
    LG-NIR, LG-Y}``.
  * GSense Bayer constants (rule 5) — never touched here.
  * Analysis-purity (rule 7) — only ``numpy``, ``h5py``,
    ``mantisanalysis.image_io``, ``mantisanalysis.isp_modes``,
    ``mantisanalysis.extract``.

Per `.agent/runs/recording-inspection-implementation-v1/DATA_MODEL.md`
§2.2, ``inspect_recording`` falls through 7 layout heuristics and
emits a structured ``Warning`` for every fallback so the user sees
what was assumed.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import h5py
import numpy as np

from . import isp_modes as _isp
from .image_io import extract_with_mode, luminance_from_rgb


# ---------------------------------------------------------------------------
# Warning + meta dataclasses
# ---------------------------------------------------------------------------


# Canonical warning codes — single source of truth.  See DATA_MODEL §8.
WARN_META_TS = "W-META-TS"
WARN_META_EXP = "W-META-EXP"
WARN_META_PATH = "W-META-PATH"
WARN_META_SINGLE_FRAME = "W-META-SINGLE-FRAME"
WARN_TS_DISORDER = "W-TS-DISORDER"
WARN_DARK_SHORT = "W-DARK-SHORT"
ERR_LAYOUT = "E-LAYOUT"


@dataclass(frozen=True)
class Warning:
    """One warning or error emitted during inspection.

    ``severity`` ∈ {info, warning, error, blocking}; the wire payload
    in ``server.py`` mirrors these strings.
    """

    code: str
    severity: str
    text: str


@dataclass(frozen=True)
class RecordingMeta:
    """Structured H5 recording metadata.

    Returned by :func:`inspect_recording`.  Empty/missing fields are
    represented by ``None`` rather than zero so the UI can distinguish
    "field absent" from "field is zero".
    """

    path: Optional[str]
    name: str
    size_bytes: int
    frame_count: int
    frame_shape: Tuple[int, int]          # (H, W) of the post-extract channel
    raw_shape: Tuple[int, int]            # (H, W) of the dual-gain raw frame
    channels: Tuple[str, ...]             # canonical sorted channel keys
    isp_mode_id: str
    frame_dataset_path: str
    timestamps_available: bool
    timestamp_start_s: Optional[float]
    timestamp_end_s: Optional[float]
    estimated_fps: Optional[float]
    # /camera/integration-time stored as raw camera units (Mantis FSI dev
    # recordings use seconds; older synthetic / Qt-era data used microseconds).
    # We don't convert — display layer renders the raw value with a unit
    # heuristic. Dark-matching compares raw-vs-raw (same camera = same unit).
    exposure_min: Optional[float]
    exposure_max: Optional[float]
    exposure_mean: Optional[float]
    camera_attrs: Dict[str, str] = field(default_factory=dict)
    warnings: Tuple[Warning, ...] = ()
    errors: Tuple[Warning, ...] = ()


# ---------------------------------------------------------------------------
# H5 layout detection — 7 fallback heuristics (DATA_MODEL §2.2)
# ---------------------------------------------------------------------------


def _detect_frames_dataset(f: h5py.File
                           ) -> Tuple[Optional[h5py.Dataset], str, List[Warning]]:
    """Locate the frames dataset using the heuristic ladder.

    Returns ``(dataset, path, warnings)``.  ``dataset is None`` only
    on E-LAYOUT failure.
    """
    warnings: List[Warning] = []

    def _check_2d_single_frame(ds: h5py.Dataset, path: str) -> None:
        if ds.ndim == 2 and ds.dtype.kind in ("u", "i"):
            warnings.append(Warning(
                code=WARN_META_SINGLE_FRAME,
                severity="warning",
                text=f"2-D dataset at {path}; treating as a 1-frame recording",
            ))

    # H1 canonical
    if "camera" in f and "frames" in f["camera"]:
        ds = f["camera/frames"]
        _check_2d_single_frame(ds, "/camera/frames")
        return ds, "/camera/frames", warnings
    # H2 top-level
    if "frames" in f:
        warnings.append(Warning(
            code=WARN_META_PATH,
            severity="info",
            text="frames dataset found at top level instead of /camera/frames; "
                 "treating as the recording payload",
        ))
        ds = f["frames"]
        _check_2d_single_frame(ds, "/frames")
        return ds, "/frames", warnings
    # H3 first 3-D / 4-D uint integer dataset
    candidate: Optional[h5py.Dataset] = None
    candidate_path = ""
    def _visit(name: str, obj: Any) -> Optional[bool]:
        nonlocal candidate, candidate_path
        if not isinstance(obj, h5py.Dataset):
            return None
        if obj.dtype.kind not in ("u", "i"):
            return None
        if obj.ndim in (3, 4):
            if obj.ndim == 4 and obj.shape[-1] != 1:
                return None
            candidate = obj
            candidate_path = "/" + name
            return True  # stop walk
        return None
    f.visititems(_visit)
    if candidate is not None:
        warnings.append(Warning(
            code=WARN_META_PATH,
            severity="info",
            text=f"frames dataset inferred at {candidate_path} (no canonical "
                 "/camera/frames found)",
        ))
        return candidate, candidate_path, warnings
    # H4 single 2-D image: handled inside _read_frames; no dataset here
    if "camera" in f:
        cam = f["camera"]
        for key, obj in cam.items():
            if isinstance(obj, h5py.Dataset) and obj.ndim == 2 and obj.dtype.kind in ("u", "i"):
                warnings.append(Warning(
                    code=WARN_META_SINGLE_FRAME,
                    severity="warning",
                    text=f"only a single 2-D image found at /camera/{key}; "
                         "treating as a 1-frame recording",
                ))
                return obj, f"/camera/{key}", warnings
    for key in f:
        obj = f[key]
        if isinstance(obj, h5py.Dataset) and obj.ndim == 2 and obj.dtype.kind in ("u", "i"):
            warnings.append(Warning(
                code=WARN_META_SINGLE_FRAME,
                severity="warning",
                text=f"only a single 2-D image found at /{key}; "
                     "treating as a 1-frame recording",
            ))
            return obj, f"/{key}", warnings
    return None, "", warnings


def _frame_shape_from_dataset(ds: h5py.Dataset) -> Tuple[int, Tuple[int, int]]:
    """Return ``(n_frames, (h, w))`` regardless of ndim layout.

    Handles 2-D (single frame), 3-D ``(N, H, W)``, 4-D ``(N, H, W, 1)``.
    """
    if ds.ndim == 2:
        return 1, (int(ds.shape[0]), int(ds.shape[1]))
    if ds.ndim == 3:
        return int(ds.shape[0]), (int(ds.shape[1]), int(ds.shape[2]))
    if ds.ndim == 4:
        return int(ds.shape[0]), (int(ds.shape[1]), int(ds.shape[2]))
    raise ValueError(f"unsupported frames dataset ndim {ds.ndim}")


def _read_frame_at(path: Path, dataset_path: str, frame_idx: int) -> np.ndarray:
    """Lazily read one frame from disk via h5py.  Never loads the whole stack."""
    with h5py.File(path, "r") as f:
        ds = f[dataset_path]
        if ds.ndim == 2:
            arr = np.asarray(ds[...])
        elif ds.ndim in (3, 4):
            arr = np.asarray(ds[frame_idx])
        else:
            raise ValueError(f"unsupported frames ndim {ds.ndim}")
    if arr.ndim == 3 and arr.shape[-1] == 1:
        arr = arr[..., 0]
    return arr


def _read_dataset_or_none(f: h5py.File, *candidate_paths: str
                          ) -> Optional[np.ndarray]:
    for p in candidate_paths:
        if p in f:
            return np.asarray(f[p][...])
    return None


def _serialize_attrs(attrs: h5py.AttributeManager) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for k in attrs.keys():
        v = attrs[k]
        try:
            if isinstance(v, (bytes, bytearray)):
                out[k] = v.decode(errors="replace")
            else:
                out[k] = str(v)
        except Exception:
            out[k] = repr(v)
    return out


# ---------------------------------------------------------------------------
# Public inspection API
# ---------------------------------------------------------------------------


def inspect_recording(path: str | Path,
                      *,
                      isp_mode_id: Optional[str] = None,
                      isp_config: Optional[Dict[str, Any]] = None,
                      ) -> RecordingMeta:
    """Read metadata for a Mantis-style H5 without loading frames eagerly.

    The frame dataset is *not* read in full — we slice ``[0:0]`` to get
    shape + dtype + attribute access only.  Subsequent per-frame reads
    happen via :func:`extract_frame`.

    Falls through 7 layout heuristics (DATA_MODEL §2.2); each fallback
    emits a ``Warning`` so the UI can surface "we're guessing" once
    per session per code.

    Returns a populated :class:`RecordingMeta` even when the file is
    badly formed; ``errors`` is non-empty in that case and the caller
    should refuse to build a stream from it.
    """
    p = Path(path)
    if not p.exists():
        return RecordingMeta(
            path=str(p), name=p.name, size_bytes=0,
            frame_count=0, frame_shape=(0, 0), raw_shape=(0, 0),
            channels=(), isp_mode_id="rgb_nir",
            frame_dataset_path="",
            timestamps_available=False,
            timestamp_start_s=None, timestamp_end_s=None,
            estimated_fps=None,
            exposure_min=None, exposure_max=None, exposure_mean=None,
            camera_attrs={},
            warnings=(),
            errors=(Warning(code=ERR_LAYOUT, severity="blocking",
                            text=f"file not found: {p}"),),
        )

    size_bytes = int(p.stat().st_size)
    warnings: List[Warning] = []
    errors: List[Warning] = []

    try:
        with h5py.File(p, "r") as f:
            ds, dataset_path, det_warns = _detect_frames_dataset(f)
            warnings.extend(det_warns)
            if ds is None:
                return RecordingMeta(
                    path=str(p), name=p.name, size_bytes=size_bytes,
                    frame_count=0, frame_shape=(0, 0), raw_shape=(0, 0),
                    channels=(), isp_mode_id="rgb_nir",
                    frame_dataset_path="",
                    timestamps_available=False,
                    timestamp_start_s=None, timestamp_end_s=None,
                    estimated_fps=None,
                    exposure_min=None, exposure_max=None,
                    exposure_mean=None,
                    camera_attrs={},
                    warnings=tuple(warnings),
                    errors=(Warning(code=ERR_LAYOUT, severity="blocking",
                                    text=f"no frames dataset found in {p.name}"),),
                )

            n_frames, raw_shape = _frame_shape_from_dataset(ds)

            # Empty recording — surface as error, not warning.
            if n_frames == 0:
                return RecordingMeta(
                    path=str(p), name=p.name, size_bytes=size_bytes,
                    frame_count=0, frame_shape=(0, 0), raw_shape=raw_shape,
                    channels=(), isp_mode_id="rgb_nir",
                    frame_dataset_path=dataset_path,
                    timestamps_available=False,
                    timestamp_start_s=None, timestamp_end_s=None,
                    estimated_fps=None,
                    exposure_min=None, exposure_max=None,
                    exposure_mean=None,
                    camera_attrs={},
                    warnings=tuple(warnings),
                    errors=(Warning(code=ERR_LAYOUT, severity="blocking",
                                    text=f"recording {p.name} has zero frames"),),
                )

            # Timestamps.
            ts = _read_dataset_or_none(f, "/camera/timestamp", "/timestamp")
            ts_available = ts is not None and ts.size == n_frames
            ts_start: Optional[float] = None
            ts_end: Optional[float] = None
            est_fps: Optional[float] = None
            if ts_available and ts is not None:
                ts_arr = np.asarray(ts, dtype=np.float64)
                # Non-monotonic intra-file detection (W-TS-DISORDER).
                if n_frames >= 2:
                    diffs = np.diff(ts_arr)
                    if np.any(diffs < -1e-9):
                        warnings.append(Warning(
                            code=WARN_TS_DISORDER,
                            severity="warning",
                            text=f"{p.name} timestamps are not monotonically "
                                 "increasing; the boundary fps estimate may be "
                                 "noisy",
                        ))
                ts_start = float(ts_arr[0])
                ts_end = float(ts_arr[-1])
                if n_frames >= 2 and ts_end > ts_start:
                    est_fps = float((n_frames - 1) / (ts_end - ts_start))
            else:
                warnings.append(Warning(
                    code=WARN_META_TS,
                    severity="info",
                    text=f"{p.name}: missing or wrong-length /camera/timestamp; "
                         "frame intervals will be synthesized from a default "
                         "FPS",
                ))

            # Exposure / integration time.
            it = _read_dataset_or_none(f, "/camera/integration-time",
                                       "/integration-time")
            exp_min: Optional[float] = None
            exp_max: Optional[float] = None
            exp_mean: Optional[float] = None
            if it is not None and it.size == n_frames:
                exp_min = float(np.min(it))
                exp_max = float(np.max(it))
                exp_mean = float(np.mean(it))
            else:
                warnings.append(Warning(
                    code=WARN_META_EXP,
                    severity="warning",
                    text=f"{p.name}: missing /camera/integration-time; dark "
                         "auto-match disabled for frames from this recording",
                ))

            # Camera attrs.
            attrs: Dict[str, str] = {}
            if "camera" in f:
                attrs.update(_serialize_attrs(f["camera"].attrs))
            attrs.update(_serialize_attrs(f.attrs))

            # Decide ISP mode + extract first frame to learn the channel set.
            mode_id = isp_mode_id or _isp.default_mode_id_for_source_kind(
                "h5", is_dual_gain=True,
            )
            mode = _isp.get_mode(mode_id)
            cfg = _isp.normalize_config(mode, isp_config)

            # Read just frame 0 to infer extracted channel shape.
            raw0 = _read_frame_at(p, dataset_path, 0)
            channels = extract_with_mode(raw0, mode, cfg)
            # Y synthesis for rgb_nir (mirrors image_io.py:191-196,
            # planner-architect P0-2). Other modes leave Y alone.
            if mode.id == _isp.RGB_NIR.id:
                hg = {k: channels[f"HG-{k}"] for k in ("R", "G", "B")}
                lg = {k: channels[f"LG-{k}"] for k in ("R", "G", "B")}
                channels["HG-Y"] = luminance_from_rgb(hg)
                channels["LG-Y"] = luminance_from_rgb(lg)

            any_ch = next(iter(channels.values()))
            frame_shape = (int(any_ch.shape[0]), int(any_ch.shape[1]))
            channel_keys = tuple(sorted(channels.keys()))

    except OSError as exc:
        errors.append(Warning(code=ERR_LAYOUT, severity="blocking",
                              text=f"cannot open {p}: {exc}"))
        return RecordingMeta(
            path=str(p), name=p.name, size_bytes=size_bytes,
            frame_count=0, frame_shape=(0, 0), raw_shape=(0, 0),
            channels=(), isp_mode_id="rgb_nir",
            frame_dataset_path="",
            timestamps_available=False,
            timestamp_start_s=None, timestamp_end_s=None,
            estimated_fps=None,
            exposure_min=None, exposure_max=None, exposure_mean=None,
            camera_attrs={},
            warnings=tuple(warnings),
            errors=tuple(errors),
        )

    return RecordingMeta(
        path=str(p),
        name=p.name,
        size_bytes=size_bytes,
        frame_count=n_frames,
        frame_shape=frame_shape,
        raw_shape=raw_shape,
        channels=channel_keys,
        isp_mode_id=mode.id,
        frame_dataset_path=dataset_path,
        timestamps_available=ts_available,
        timestamp_start_s=ts_start,
        timestamp_end_s=ts_end,
        estimated_fps=est_fps,
        exposure_min=exp_min,
        exposure_max=exp_max,
        exposure_mean=exp_mean,
        camera_attrs=attrs,
        warnings=tuple(warnings),
        errors=tuple(errors),
    )


def extract_frame(meta: RecordingMeta,
                  frame_idx: int,
                  isp_mode: Optional[_isp.ISPMode] = None,
                  isp_config: Optional[Dict[str, Any]] = None,
                  ) -> Dict[str, np.ndarray]:
    """Extract one frame's channel dict.

    Lazy — opens the H5, slices ``frames[frame_idx]``, runs ISP
    extraction, synthesizes ``HG-Y`` / ``LG-Y`` for ``rgb_nir`` to
    preserve the frozen 10-key schema, returns. Never materializes the
    whole stack.

    Raises:
      KeyError when ``meta`` carries an E-LAYOUT error.
      IndexError when ``frame_idx`` is out of range.
    """
    if meta.errors:
        raise KeyError(
            f"recording {meta.name} has structural errors: "
            + "; ".join(e.text for e in meta.errors)
        )
    if frame_idx < 0 or frame_idx >= meta.frame_count:
        raise IndexError(
            f"frame index {frame_idx} out of range [0, {meta.frame_count})"
        )
    if meta.path is None:
        raise KeyError(f"recording {meta.name} has no on-disk path")

    mode = isp_mode or _isp.get_mode(meta.isp_mode_id)
    cfg = _isp.normalize_config(mode, isp_config or {})
    raw = _read_frame_at(Path(meta.path), meta.frame_dataset_path, frame_idx)
    channels = extract_with_mode(raw, mode, cfg)
    if mode.id == _isp.RGB_NIR.id:
        hg = {k: channels[f"HG-{k}"] for k in ("R", "G", "B")}
        lg = {k: channels[f"LG-{k}"] for k in ("R", "G", "B")}
        channels["HG-Y"] = luminance_from_rgb(hg)
        channels["LG-Y"] = luminance_from_rgb(lg)
    return channels


__all__ = [
    "Warning",
    "RecordingMeta",
    "WARN_META_TS",
    "WARN_META_EXP",
    "WARN_META_PATH",
    "WARN_META_SINGLE_FRAME",
    "WARN_TS_DISORDER",
    "WARN_DARK_SHORT",
    "ERR_LAYOUT",
    "inspect_recording",
    "extract_frame",
]
