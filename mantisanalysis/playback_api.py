"""FastAPI routes for the Playback (Recording Inspection) mode.

Mounted via ``_mount_playback_api(app)`` from ``server.create_app``.
This is the *adapter* layer — pure FastAPI / Pydantic. The real work
lives in ``recording``, ``dark_frame``, ``playback_pipeline``, and
``playback_session`` modules (all rule-7 pure).

Routes (per API_DESIGN §1–9):

  GET  /api/playback/health
  POST /api/playback/recordings/inspect
  POST /api/playback/recordings/load-path
  POST /api/playback/recordings/upload
  POST /api/playback/recordings/load-sample        (test-only)
  GET  /api/playback/recordings
  GET  /api/playback/recordings/{recording_id}
  DELETE /api/playback/recordings/{recording_id}
  POST /api/playback/darks/load-path
  POST /api/playback/darks/upload
  POST /api/playback/darks/load-sample             (test-only)
  GET  /api/playback/darks
  DELETE /api/playback/darks/{dark_id}
  POST /api/playback/streams
  GET  /api/playback/streams
  GET  /api/playback/streams/{stream_id}
  PUT  /api/playback/streams/{stream_id}
  DELETE /api/playback/streams/{stream_id}
  GET  /api/playback/streams/{stream_id}/lookup?frame=N
  GET  /api/playback/streams/{stream_id}/frame/{frame}.png
  POST /api/playback/exports/image                 (M10)
  POST /api/playback/exports/video                 (M10)
  GET  /api/playback/exports/{job_id}              (M10)
  DELETE /api/playback/exports/{job_id}            (M10)

Test-only endpoints are gated by ``MANTIS_PLAYBACK_TEST=1`` env var;
the gate is read at app construction (per risk-skeptic P1-I).
"""

from __future__ import annotations

import multiprocessing
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from . import __version__
from . import isp_modes as _isp
from .dark_frame import (
    MasterDark,
    Strategy as DarkStrategy,
    average_dark_h5,
    match_dark_by_exposure,
)
from .playback_export import (
    GIF_FRAME_CAP,
    RENDER_PIPELINE_VERSION,
    export_image_bytes,
    has_ffmpeg as _exp_has_ffmpeg,
    render_views_for_frame,
    write_sidecar,
    write_video,
)
from .playback_pipeline import (
    BlendMode,
    BurnInContext,
    CCM_TARGETS,
    ViewState,
    ViewType,
    WBMode,
    render_frame_to_png,
    solve_ccm_from_patches,
)
from .playback_session import (
    PLAYBACK_STORE,
    DarkHandle,
    PlaybackStore,
    RecordingHandle,
    StreamHandle,
    frame_lookup,
)
from .recording import (
    ERR_LAYOUT,
    Warning as RecWarning,
    inspect_recording,
)


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class WarningOut(BaseModel):
    code: str
    severity: str
    text: str

    @classmethod
    def from_dataclass(cls, w: RecWarning) -> "WarningOut":
        return cls(code=w.code, severity=w.severity, text=w.text)


class RecordingMetaOut(BaseModel):
    path: Optional[str]
    name: str
    size_bytes: int
    frame_count: int
    frame_shape: Tuple[int, int]
    raw_shape: Tuple[int, int]
    channels: List[str]
    isp_mode_id: str
    frame_dataset_path: str
    timestamps_available: bool
    timestamp_start_s: Optional[float]
    timestamp_end_s: Optional[float]
    estimated_fps: Optional[float]
    exposure_min: Optional[float]
    exposure_max: Optional[float]
    exposure_mean: Optional[float]
    camera_attrs: Dict[str, str]
    warnings: List[WarningOut]
    errors: List[WarningOut]


class RecordingHandleOut(RecordingMetaOut):
    recording_id: str
    loaded_at: float


class DarkHandleOut(BaseModel):
    dark_id: str
    name: str
    path: Optional[str]
    isp_mode_id: str
    frame_count_total: int
    frames_averaged: int
    exposure: Optional[float]
    shape: Tuple[int, int]
    channels: List[str]
    strategy: str
    sigma_threshold: Optional[float]
    loaded_at: float
    warnings: List[WarningOut]


class StreamBoundaryOut(BaseModel):
    recording_id: str
    start_frame: int
    end_frame: int
    ts_start_s: float
    ts_end_s: float
    exposure: Optional[float]
    gap_to_prev_s: Optional[float]


class StreamOut(BaseModel):
    stream_id: str
    name: str
    isp_mode_id: str
    isp_config: Dict[str, Any]
    recording_ids: List[str]
    quarantined_recording_ids: List[str]
    continuity_threshold_s: float
    boundaries: List[StreamBoundaryOut]
    total_frames: int
    total_duration_s: float
    fps: float
    shape: Tuple[int, int]
    available_channels: List[str]
    issues: Dict[str, int]
    warnings: List[WarningOut]
    loaded_at: float
    invalidated: bool


class HealthOut(BaseModel):
    ok: bool
    version: str
    ffmpeg_available: bool
    ffmpeg_path: Optional[str]
    max_recording_frames: int
    max_dark_frames: int
    supported_image_formats: List[str]
    supported_video_formats: List[str]
    supported_blend_modes: List[str]
    supported_colormaps: List[str]
    supported_dark_strategies: List[str]
    supported_isp_modes: List[str]
    live_stream_supported: bool
    ccm_editor_enabled: bool
    handoff_modes: List[str]
    test_endpoints_enabled: bool


class LoadPathRequest(BaseModel):
    path: str
    name: Optional[str] = None


class DarkLoadPathRequest(BaseModel):
    path: str
    name: Optional[str] = None
    max_frames: int = 256
    strategy: str = "mean"
    sigma_threshold: float = 3.0


class BuildStreamRequest(BaseModel):
    name: Optional[str] = None
    recording_ids: List[str]
    continuity_threshold_s: float = 1.0
    isp_mode_id: Optional[str] = None
    isp_config: Optional[Dict[str, Any]] = None


class UpdateStreamRequest(BaseModel):
    recording_ids: Optional[List[str]] = None
    continuity_threshold_s: Optional[float] = None
    isp_mode_id: Optional[str] = None
    isp_config: Optional[Dict[str, Any]] = None
    name: Optional[str] = None


class LookupOut(BaseModel):
    frame: int
    recording_id: str
    local_frame: int
    ts_s: float
    exposure: Optional[float]
    boundary_index: int


class CCMSolveRequest(BaseModel):
    observed_rgb: List[List[float]]
    target_rgb: List[List[float]]
    regularize: float = 1e-3


class CCMSolveResponse(BaseModel):
    matrix: List[List[float]]
    determinant: float
    stable: bool
    residual_rms: float


class CCMTargetOut(BaseModel):
    id: str
    name: str
    white_rgb: List[float]


class PresetIn(BaseModel):
    kind: str                      # 'view' | 'dark' | 'ccm'
    name: str
    payload: Dict[str, Any]


class PresetOut(BaseModel):
    preset_id: str
    kind: str
    name: str
    payload: Dict[str, Any]
    created_at: float


class FrameLruIn(BaseModel):
    bytes: int


class FrameLruOut(BaseModel):
    cap_bytes: int
    current_bytes: int
    n_frames: int


class ImageExportRequest(BaseModel):
    stream_id: str
    frame: int
    compose: str = "contactSheet"     # single | contactSheet | grid
    tile_arrangement: Optional[Tuple[int, int]] = None
    fmt: str = "png"                  # png | tif | jpg
    bit_depth: int = 8
    include_labels: bool = True
    include_badges: bool = True
    views: List[Dict[str, Any]]


class VideoExportRequest(BaseModel):
    stream_id: str
    frame_range: Tuple[int, int]
    fmt: str = "mp4"                  # mp4 | apng | gif | png-seq
    fps: int = 30
    quality: str = "high"             # low | med | high
    compose: str = "contactSheet"
    tile_arrangement: Optional[Tuple[int, int]] = None
    include_labels: bool = True
    views: List[Dict[str, Any]]


class HandoffRequest(BaseModel):
    """recording-inspection-implementation-v1 M11 + M12 fastapi-backend P1.

    Promoted from Dict[str, Any] so frame and preserve_dark are typed
    + a missing/wrong-typed `frame` returns 422 not silently coerced.
    """
    frame: int
    view: Optional[Dict[str, Any]] = None
    preserve_dark: bool = True
    name: Optional[str] = None


class ExportJobOut(BaseModel):
    job_id: str
    kind: str
    status: str
    progress: float
    current_frame: int
    total_frames: int
    elapsed_s: float
    eta_s: float
    output_url: Optional[str]
    sidecar_url: Optional[str]
    error: Optional[str]


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _meta_payload(meta) -> Dict[str, Any]:
    return {
        "path": meta.path,
        "name": meta.name,
        "size_bytes": meta.size_bytes,
        "frame_count": meta.frame_count,
        "frame_shape": list(meta.frame_shape),
        "raw_shape": list(meta.raw_shape),
        "channels": list(meta.channels),
        "isp_mode_id": meta.isp_mode_id,
        "frame_dataset_path": meta.frame_dataset_path,
        "timestamps_available": meta.timestamps_available,
        "timestamp_start_s": meta.timestamp_start_s,
        "timestamp_end_s": meta.timestamp_end_s,
        "estimated_fps": meta.estimated_fps,
        "exposure_min": meta.exposure_min,
        "exposure_max": meta.exposure_max,
        "exposure_mean": meta.exposure_mean,
        "camera_attrs": dict(meta.camera_attrs),
        "warnings": [WarningOut.from_dataclass(w).model_dump()
                     for w in meta.warnings],
        "errors": [WarningOut.from_dataclass(w).model_dump()
                   for w in meta.errors],
    }


def _recording_payload(h: RecordingHandle) -> Dict[str, Any]:
    p = _meta_payload(h.meta)
    p["recording_id"] = h.recording_id
    p["loaded_at"] = h.loaded_at
    return p


def _dark_payload(h: DarkHandle) -> Dict[str, Any]:
    return {
        "dark_id": h.dark_id,
        "name": h.master.name,
        "path": h.master.path,
        "isp_mode_id": h.master.isp_mode_id,
        "frame_count_total": h.master.frame_count_total,
        "frames_averaged": h.master.frames_averaged,
        "exposure": h.master.exposure,
        "shape": list(h.master.shape),
        "channels": sorted(h.master.channels.keys()),
        "strategy": h.master.strategy,
        "sigma_threshold": h.master.sigma_threshold,
        "loaded_at": h.loaded_at,
        "warnings": [WarningOut.from_dataclass(w).model_dump()
                     for w in h.master.warnings],
    }


def _stream_payload(s: StreamHandle) -> Dict[str, Any]:
    return {
        "stream_id": s.stream_id,
        "name": s.name,
        "isp_mode_id": s.isp_mode_id,
        "isp_config": dict(s.isp_config or {}),
        "recording_ids": list(s.recording_ids),
        "quarantined_recording_ids": list(s.quarantined_recording_ids),
        "continuity_threshold_s": s.continuity_threshold_s,
        "boundaries": [
            {
                "recording_id": b.recording_id,
                "start_frame": b.start_frame,
                "end_frame": b.end_frame,
                "ts_start_s": b.ts_start_s,
                "ts_end_s": b.ts_end_s,
                "exposure": b.exposure,
                "gap_to_prev_s": b.gap_to_prev_s,
            }
            for b in s.boundaries
        ],
        "total_frames": s.total_frames,
        "total_duration_s": s.total_duration_s,
        "fps": s.fps,
        "shape": list(s.shape),
        "available_channels": list(s.available_channels),
        "issues": dict(s.issues),
        "warnings": [WarningOut.from_dataclass(w).model_dump()
                     for w in s.warnings],
        "loaded_at": s.loaded_at,
        "invalidated": s.invalidated,
    }


# ---------------------------------------------------------------------------
# ffmpeg detection (risk-skeptic P1-D — must actually exec, not just exists)
# ---------------------------------------------------------------------------


_FFMPEG_CACHE: Dict[str, Tuple[bool, Optional[str], float]] = {}


def _has_ffmpeg() -> Tuple[bool, Optional[str]]:
    """Return ``(available, path)``. Caches for 60 s.

    Per risk-skeptic P1-D: actually exec ``ffmpeg -version`` and check
    returncode==0; ``Path.exists()`` is not enough.
    """
    import subprocess
    import time
    now = time.time()
    cached = _FFMPEG_CACHE.get("ffmpeg")
    if cached is not None and now - cached[2] < 60.0:
        return cached[0], cached[1]
    try:
        import imageio_ffmpeg  # type: ignore[import-not-found]
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        _FFMPEG_CACHE["ffmpeg"] = (False, None, now)
        return False, None
    try:
        proc = subprocess.run([exe, "-version"], capture_output=True,
                              timeout=5, check=False)
        ok = proc.returncode == 0
    except Exception:
        ok = False
    _FFMPEG_CACHE["ffmpeg"] = (ok, exe if ok else None, now)
    return ok, exe if ok else None


# ---------------------------------------------------------------------------
# View state from query params (preview endpoint)
# ---------------------------------------------------------------------------


def _view_from_query(q: Dict[str, Any]) -> ViewState:
    """Build a ViewState from URL query parameters.

    Per API_DESIGN §5, the preview endpoint takes ~30 query params; we
    parse the canonical set and fall back to ViewState defaults for the
    rest. The export endpoints take a richer JSON body; both call
    ``render_frame``.
    """
    def _b(name: str, default: bool) -> bool:
        v = q.get(name)
        if v is None:
            return default
        return str(v).lower() in ("1", "true", "yes", "y")

    def _f(name: str, default: float) -> float:
        v = q.get(name)
        if v is None:
            return default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    def _s(name: str, default: str) -> str:
        v = q.get(name)
        return str(v) if v is not None else default

    channels_csv = _s("channels", "HG-R,HG-G,HG-B")
    triplet = tuple(channels_csv.split(",")[:3]) + ("HG-R", "HG-G", "HG-B")
    triplet = (triplet[0], triplet[1], triplet[2])

    return ViewState(
        view_id=_s("view_id", "v1"),
        name=_s("name", "view"),
        type=_s("view_type", "single"),  # type: ignore[arg-type]
        channel=_s("channel", "HG-G"),
        channels=triplet,  # type: ignore[arg-type]
        dark_on=_b("dark_on", False),
        gain=_f("gain", 1.0),
        offset=_f("offset", 0.0),
        normalize=_b("normalize", False),
        low=_f("low", 30.0),
        high=_f("high", 900.0),
        colormap=_s("colormap", "viridis"),
        invert=_b("invert", False),
        show_clipped=_b("show_clipped", False),
        rgb_gain=(_f("rgb_gain_r", 1.0),
                  _f("rgb_gain_g", 1.0),
                  _f("rgb_gain_b", 1.0)),
        rgb_offset=(_f("rgb_offset_r", 0.0),
                    _f("rgb_offset_g", 0.0),
                    _f("rgb_offset_b", 0.0)),
        gamma=_f("gamma", 1.0),
        brightness=_f("brightness", 0.0),
        contrast=_f("contrast", 1.0),
        saturation=_f("saturation", 1.0),
        wb_k=int(_f("wb_k", 5500.0)),
        wb_mode=_s("wb_mode", "k"),  # type: ignore[arg-type]
        wb_target_id=q.get("wb_target_id"),
        ccm_on=_b("ccm_on", False),
        overlay_on=_b("overlay_on", False),
        overlay_channel=_s("overlay_channel", "HG-NIR"),
        overlay_low=_f("overlay_low", 300.0),
        overlay_high=_f("overlay_high", 900.0),
        overlay_blend=_s("overlay_blend", "alpha"),  # type: ignore[arg-type]
        overlay_strength=_f("overlay_strength", 0.65),
        overlay_cmap=_s("overlay_cmap", "inferno"),
        overlay_below=_s("overlay_below", "hide"),  # type: ignore[arg-type]
        overlay_above=_s("overlay_above", "saturate"),  # type: ignore[arg-type]
        labels_timestamp=_b("labels_timestamp", True),
        labels_frame=_b("labels_frame", True),
        labels_channel=_b("labels_channel", False),
        labels_source=_b("labels_source", False),
        labels_scale_bar=_b("labels_scale_bar", False),
        labels_badges=_b("labels_badges", True),
        labels_legend=_b("labels_legend", True),
    )


# ---------------------------------------------------------------------------
# Test-only synthetic helpers (gated by MANTIS_PLAYBACK_TEST=1)
# ---------------------------------------------------------------------------


def _synthetic_recording_h5(tmp_dir: Path) -> Path:
    """Build a tiny synthetic H5 the test endpoint can register.

    Mirrors `_h5_fixtures.write_synthetic_recording(canonical)` but
    without importing tests/.
    """
    import h5py
    p = tmp_dir / f"synth-{uuid.uuid4().hex[:8]}.h5"
    n_frames, h, w = 8, 32, 64
    rr, cc = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    frames = np.stack([
        ((i * 1_000_000 + rr * 1_000 + cc) % 65535).astype(np.uint16)
        for i in range(n_frames)
    ], axis=0)
    ts = np.asarray([i / 30.0 for i in range(n_frames)], dtype=np.float64)
    it = np.full((n_frames,), 20_000.0, dtype=np.float64)
    with h5py.File(p, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=it)
        cam.create_dataset("integration-time-expected", data=it)
        cam.attrs["model-name"] = "Synthetic GSense (test endpoint)"
        cam.attrs["fw-version"] = "v3.0"
    return p


def _synthetic_dark_h5(tmp_dir: Path) -> Path:
    import h5py
    p = tmp_dir / f"synth-dark-{uuid.uuid4().hex[:8]}.h5"
    n_frames, h, w = 16, 32, 64
    rng = np.random.default_rng(42)
    base = np.full((n_frames, h, w), 140, dtype=np.int32)
    noise = rng.integers(-12, 13, size=base.shape)
    frames = np.clip(base + noise, 0, 65535).astype(np.uint16)
    ts = np.arange(n_frames, dtype=np.float64) / 30.0
    it = np.full((n_frames,), 20_000.0, dtype=np.float64)
    with h5py.File(p, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=it)
        cam.attrs["model-name"] = "Synthetic Dark"
    return p


# ---------------------------------------------------------------------------
# Mount
# ---------------------------------------------------------------------------


def mount_playback_api(app: FastAPI,
                       *,
                       store: PlaybackStore = PLAYBACK_STORE) -> None:
    """Add the /api/playback/* routes to ``app``.

    Per risk-skeptic P1-I, the test-only endpoint gate is read at
    *app construction time*, not at module import.
    """
    test_mode = os.getenv("MANTIS_PLAYBACK_TEST", "0") == "1"

    # --- Health -----------------------------------------------------------

    @app.get("/api/playback/health", response_model=None)
    def playback_health() -> Dict[str, Any]:
        ffm_ok, ffm_path = _has_ffmpeg()
        return {
            "ok": True,
            "version": __version__,
            "ffmpeg_available": ffm_ok,
            "ffmpeg_path": ffm_path,
            "max_recording_frames": 100_000,
            "max_dark_frames": 256,
            "supported_image_formats": ["png", "tif", "jpg"],
            "supported_video_formats": (
                ["mp4", "apng", "gif", "png-seq"] if ffm_ok
                else ["gif", "png-seq"]
            ),
            "supported_blend_modes": ["alpha", "additive", "screen", "masked"],
            "supported_colormaps": [
                "viridis", "inferno", "magma", "plasma",
                "cividis", "turbo", "gray", "hot", "cool",
            ],
            "supported_dark_strategies": ["mean", "median", "sigma_clipped"],
            "supported_isp_modes": list(_isp.ALL_MODES.keys()),
            "live_stream_supported": False,
            "ccm_editor_enabled": True,
            "handoff_modes": ["usaf", "fpn", "dof"],
            "test_endpoints_enabled": test_mode,
        }

    # --- Recordings -------------------------------------------------------

    @app.post("/api/playback/recordings/inspect")
    def inspect_recording_route(req: LoadPathRequest) -> Dict[str, Any]:
        meta = inspect_recording(req.path)
        return _meta_payload(meta)

    @app.post("/api/playback/recordings/load-path")
    def load_path(req: LoadPathRequest) -> Dict[str, Any]:
        try:
            h = store.register_recording(req.path, name=req.name)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return _recording_payload(h)

    @app.post("/api/playback/recordings/upload")
    async def upload_recording(file: UploadFile = File(...)) -> Dict[str, Any]:
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty upload")
        # Risk-skeptic P1-H: persist to disk under outputs/playback/uploads,
        # never bytes_cache.
        out_dir = Path("outputs/playback/uploads")
        out_dir.mkdir(parents=True, exist_ok=True)
        rec_id = uuid.uuid4().hex[:12]
        p = out_dir / f"{rec_id}-{Path(file.filename or 'upload').name}"
        p.write_bytes(data)
        try:
            h = store.register_recording(p, name=file.filename)
        except ValueError as e:
            try: p.unlink()
            except OSError: pass
            raise HTTPException(422, str(e)) from e
        return _recording_payload(h)

    @app.get("/api/playback/recordings")
    def list_recordings() -> List[Dict[str, Any]]:
        return [_recording_payload(h) for h in store.list_recordings()]

    @app.get("/api/playback/recordings/{recording_id}")
    def get_recording(recording_id: str) -> Dict[str, Any]:
        try:
            return _recording_payload(store.get_recording(recording_id))
        except KeyError:
            if store.was_evicted("recording", recording_id):
                raise HTTPException(410, _evicted_detail("recording", recording_id))
            raise HTTPException(404, f"unknown recording id: {recording_id}")

    @app.delete("/api/playback/recordings/{recording_id}")
    def delete_recording(recording_id: str) -> Dict[str, Any]:
        try:
            invalidated = store.delete_recording(recording_id)
        except KeyError:
            raise HTTPException(404, f"unknown recording id: {recording_id}")
        return {"ok": True, "stream_ids_invalidated": invalidated}

    # --- Dark frames ------------------------------------------------------

    @app.post("/api/playback/darks/load-path")
    def load_dark_path(req: DarkLoadPathRequest) -> Dict[str, Any]:
        try:
            master = average_dark_h5(
                req.path,
                max_frames=req.max_frames,
                strategy=req.strategy,  # type: ignore[arg-type]
                sigma_threshold=req.sigma_threshold,
                name=req.name,
            )
        except FileNotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        h = store.register_dark(master)
        return _dark_payload(h)

    @app.post("/api/playback/darks/upload")
    async def upload_dark(file: UploadFile = File(...),
                          strategy: str = Query("mean"),
                          sigma_threshold: float = Query(3.0),
                          max_frames: int = Query(256),
                          ) -> Dict[str, Any]:
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty upload")
        out_dir = Path("outputs/playback/uploads")
        out_dir.mkdir(parents=True, exist_ok=True)
        dark_id = uuid.uuid4().hex[:12]
        p = out_dir / f"dark-{dark_id}-{Path(file.filename or 'dark').name}"
        p.write_bytes(data)
        try:
            master = average_dark_h5(p, max_frames=max_frames,
                                     strategy=strategy,  # type: ignore[arg-type]
                                     sigma_threshold=sigma_threshold,
                                     name=file.filename)
        except (ValueError, FileNotFoundError) as e:
            try: p.unlink()
            except OSError: pass
            raise HTTPException(422, str(e)) from e
        h = store.register_dark(master)
        return _dark_payload(h)

    @app.get("/api/playback/darks")
    def list_darks() -> List[Dict[str, Any]]:
        return [_dark_payload(h) for h in store.list_darks()]

    @app.delete("/api/playback/darks/{dark_id}")
    def delete_dark(dark_id: str) -> Dict[str, Any]:
        try:
            store.delete_dark(dark_id)
        except KeyError:
            raise HTTPException(404, f"unknown dark id: {dark_id}")
        return {"ok": True}

    # --- Streams ----------------------------------------------------------

    @app.post("/api/playback/streams")
    def build_stream_route(req: BuildStreamRequest) -> Dict[str, Any]:
        try:
            s = store.build_stream(
                req.recording_ids,
                name=req.name,
                continuity_threshold_s=req.continuity_threshold_s,
                isp_mode_id=req.isp_mode_id,
                isp_config=req.isp_config,
            )
        except KeyError as e:
            raise HTTPException(404, str(e)) from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return _stream_payload(s)

    @app.get("/api/playback/streams")
    def list_streams() -> List[Dict[str, Any]]:
        return [_stream_payload(s) for s in store.list_streams()]

    @app.get("/api/playback/streams/{stream_id}")
    def get_stream(stream_id: str) -> Dict[str, Any]:
        try:
            s = store.get_stream(stream_id)
        except KeyError:
            if store.was_evicted("stream", stream_id):
                raise HTTPException(410, _evicted_detail("stream", stream_id))
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        return _stream_payload(s)

    @app.delete("/api/playback/streams/{stream_id}")
    def delete_stream(stream_id: str) -> Dict[str, Any]:
        try:
            store.delete_stream(stream_id)
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        except RuntimeError as e:
            raise HTTPException(409, str(e)) from e
        return {"ok": True}

    @app.get("/api/playback/streams/{stream_id}/lookup")
    def lookup_route(stream_id: str, frame: int = Query(...)
                     ) -> Dict[str, Any]:
        try:
            s = store.get_stream(stream_id)
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        try:
            boundary, rec_id, local = frame_lookup(s, frame)
        except IndexError as e:
            raise HTTPException(422, str(e)) from e
        idx = next(i for i, b in enumerate(s.boundaries)
                   if b.recording_id == rec_id and b.start_frame == boundary.start_frame)
        return {
            "frame": frame,
            "recording_id": rec_id,
            "local_frame": local,
            "ts_s": boundary.ts_start_s + (local / max(s.fps, 1e-9)),
            "exposure": boundary.exposure,
            "boundary_index": idx,
        }

    @app.get("/api/playback/streams/{stream_id}/frame/{frame_idx}.png")
    def frame_png_route(stream_id: str, frame_idx: int,
                        request: Request,
                        max_dim: int = Query(1024, ge=64, le=8192),
                        ) -> Response:
        try:
            s = store.get_stream(stream_id)
        except KeyError:
            if store.was_evicted("stream", stream_id):
                raise HTTPException(410, _evicted_detail("stream", stream_id))
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        if frame_idx < 0 or frame_idx >= s.total_frames:
            raise HTTPException(
                422, f"frame {frame_idx} out of stream range [0, {s.total_frames})"
            )
        try:
            channels = store.get_frame(stream_id, frame_idx)
        except IndexError as e:
            raise HTTPException(422, str(e)) from e

        view = _view_from_query(dict(request.query_params))

        # Build burn-in context from boundary + active dark.
        boundary, rec_id, local = frame_lookup(s, frame_idx)
        ctx = BurnInContext(
            frame_index=frame_idx,
            timestamp_s=boundary.ts_start_s + (local / max(s.fps, 1e-9)),
            source_filename=Path(store.get_recording(rec_id).path).name,
            badges=tuple(_badges_for(view)),
        )
        # Active dark: simple auto-match if dark_on=True and any dark has
        # the recording's exposure.
        dark_dict: Optional[Dict[str, np.ndarray]] = None
        if view.dark_on:
            target = boundary.exposure
            if target is not None:
                pool = [h.master for h in store.list_darks()]
                best, _ = match_dark_by_exposure(target, pool)
                if best is not None:
                    dark_dict = best.channels
        try:
            png = render_frame_to_png(channels, view, dark_dict,
                                      max_dim=max_dim, burn_ctx=ctx)
        except KeyError as e:
            raise HTTPException(422, f"channel error: {e}") from e
        # B-0035 (M12 perf F5): preview PNG bytes are a pure function
        # of (stream_id, frame, view) for fixed server-side state.
        # The URL already encodes every URL-affecting view field via
        # `previewPngUrl`, so the same URL re-issued during a backward
        # scrub may safely return the cached bytes. We use a short
        # `private, max-age=60` so a freshly-uploaded dark or a stream
        # rebuild becomes visible within ≤60 s without forcing the
        # client to round-trip per scrub. Includes an ETag so the
        # browser can revalidate cheaply.
        import hashlib
        etag = '"' + hashlib.sha1(png).hexdigest()[:16] + '"'  # noqa: S324
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers={
                "Cache-Control": "private, max-age=60, must-revalidate",
                "ETag": etag,
            })
        return Response(content=png, media_type="image/png",
                        headers={
                            "Cache-Control": "private, max-age=60, must-revalidate",
                            "ETag": etag,
                        })

    # --- CCM + presets + frame-LRU controls (M8) -------------------------

    @app.get("/api/playback/ccm/targets", response_model=List[CCMTargetOut])
    def ccm_targets() -> List[Dict[str, Any]]:
        return [
            {"id": k, "name": v["name"], "white_rgb": list(v["white_rgb"])}
            for k, v in CCM_TARGETS.items()
        ]

    @app.post("/api/playback/ccm/from-patch", response_model=CCMSolveResponse)
    def ccm_from_patch(req: CCMSolveRequest) -> Dict[str, Any]:
        try:
            matrix, det, stable, rms = solve_ccm_from_patches(
                np.asarray(req.observed_rgb, dtype=np.float64),
                np.asarray(req.target_rgb, dtype=np.float64),
                regularize=req.regularize,
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        return {
            "matrix": matrix.tolist(),
            "determinant": det,
            "stable": stable,
            "residual_rms": rms,
        }

    @app.get("/api/playback/presets", response_model=List[PresetOut])
    def list_presets(kind: str = Query(..., pattern="^(view|dark|ccm)$")
                      ) -> List[Dict[str, Any]]:
        try:
            return [
                {
                    "preset_id": p.preset_id,
                    "kind": p.kind,
                    "name": p.name,
                    "payload": p.payload,
                    "created_at": p.created_at,
                }
                for p in store.list_presets(kind)
            ]
        except KeyError as e:
            raise HTTPException(422, str(e)) from e

    @app.post("/api/playback/presets", response_model=PresetOut)
    def save_preset(req: PresetIn) -> Dict[str, Any]:
        try:
            p = store.save_preset(req.kind, req.name, req.payload)
        except KeyError as e:
            raise HTTPException(422, str(e)) from e
        return {
            "preset_id": p.preset_id,
            "kind": p.kind,
            "name": p.name,
            "payload": p.payload,
            "created_at": p.created_at,
        }

    @app.delete("/api/playback/presets/{preset_id}")
    def delete_preset(preset_id: str,
                       kind: str = Query(..., pattern="^(view|dark|ccm)$")
                       ) -> Dict[str, Any]:
        try:
            store.delete_preset(kind, preset_id)
        except KeyError:
            raise HTTPException(404, f"unknown preset id: {preset_id}")
        return {"ok": True}

    @app.get("/api/playback/frame-lru", response_model=FrameLruOut)
    def frame_lru_get() -> Dict[str, Any]:
        cur, cap, n = store.frame_lru_bytes()
        return {"cap_bytes": cap, "current_bytes": cur, "n_frames": n}

    @app.put("/api/playback/frame-lru", response_model=FrameLruOut)
    def frame_lru_set(req: FrameLruIn) -> Dict[str, Any]:
        store.set_frame_lru_bytes(req.bytes)
        cur, cap, n = store.frame_lru_bytes()
        return {"cap_bytes": cap, "current_bytes": cur, "n_frames": n}

    # --- Export · image (synchronous) -----------------------------------

    @app.post("/api/playback/exports/image")
    def export_image(req: ImageExportRequest) -> Response:
        try:
            stream = store.get_stream(req.stream_id)
        except KeyError:
            if store.was_evicted("stream", req.stream_id):
                raise HTTPException(410, _evicted_detail("stream", req.stream_id))
            raise HTTPException(404, f"unknown stream id: {req.stream_id}")
        if req.frame < 0 or req.frame >= stream.total_frames:
            raise HTTPException(422, f"frame {req.frame} out of range")
        if not req.views:
            raise HTTPException(422, "at least one view required")
        try:
            channels = store.get_frame(req.stream_id, req.frame)
        except IndexError as e:
            raise HTTPException(422, str(e)) from e

        from .playback_pipeline import ViewState as _VS
        views = [
            _VS(**{k: v for k, v in vp.items() if k in _VS.__dataclass_fields__})
            for vp in req.views
        ]
        # Build a burn-in context if labels are on.
        ctx = None
        # Pre-resolve the boundary/dark once per frame so both the
        # burn-in context and the WYSIWYG dark resolution share the
        # same exposure lookup (recording-inspection-implementation-v1
        # fastapi-backend P0 #1, M12).
        boundary_dark: Optional[Dict[str, np.ndarray]] = None
        if req.include_labels or any(v.dark_on for v in views):
            from .playback_session import frame_lookup as _lookup
            try:
                boundary, rec_id, local = _lookup(stream, req.frame)
                if req.include_labels:
                    ctx = BurnInContext(
                        frame_index=req.frame,
                        timestamp_s=boundary.ts_start_s + (local / max(stream.fps, 1e-9)),
                        source_filename=Path(store.get_recording(rec_id).path).name,
                    )
                if any(v.dark_on for v in views):
                    target = boundary.exposure
                    if target is not None:
                        pool = [h.master for h in store.list_darks()]
                        best, _ = match_dark_by_exposure(target, pool)
                        if best is not None:
                            boundary_dark = best.channels
            except Exception:
                ctx = None
        rgbs = render_views_for_frame(views, channels, dark=boundary_dark,
                                       max_dim=1024, burn_ctx=ctx)
        try:
            data, mime = export_image_bytes(
                rgbs, compose=req.compose,
                tile_arrangement=tuple(req.tile_arrangement) if req.tile_arrangement else None,
                fmt=req.fmt, bit_depth=req.bit_depth,
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

        # Persist to disk so the user can browse later; sidecar JSON.
        out_dir = Path("outputs/playback") / req.stream_id
        out_dir.mkdir(parents=True, exist_ok=True)
        suffix = {"image/png": "png", "image/tiff": "tiff", "image/jpeg": "jpg"}[mime]
        out_path = out_dir / f"frame-{req.frame:06d}.{suffix}"
        out_path.write_bytes(data)
        write_sidecar(
            out_path,
            stream_payload={"stream_id": stream.stream_id,
                             "name": stream.name,
                             "total_frames": stream.total_frames},
            views=views, frame_range=(req.frame, req.frame),
            fps=int(stream.fps), fmt=req.fmt, compose=req.compose,
            build_version=__version__,
        )
        return Response(
            content=data, media_type=mime,
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="frame-{req.frame:06d}.{suffix}"',
                "X-Output-Path": str(out_path),
            },
        )

    # --- Export · video (asynchronous job) ------------------------------

    @app.post("/api/playback/exports/video")
    def export_video(req: VideoExportRequest) -> Dict[str, Any]:
        try:
            stream = store.get_stream(req.stream_id)
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {req.stream_id}")
        lo, hi = req.frame_range
        if not (0 <= lo <= hi < stream.total_frames):
            raise HTTPException(422, f"range {req.frame_range} out of stream bounds")
        if not req.views:
            raise HTTPException(422, "at least one view required")
        if req.fmt == "gif" and (hi - lo + 1) > GIF_FRAME_CAP:
            raise HTTPException(422, {
                "detail": f"GIF export limited to {GIF_FRAME_CAP} frames; "
                          "reduce range or choose another format",
                "code": "W-EXPORT-GIF-CAP",
            })
        if req.fmt in ("mp4",) and not _exp_has_ffmpeg():
            raise HTTPException(503, {
                "detail": "ffmpeg not available — install imageio-ffmpeg",
                "code": "W-FFMPEG-MISSING",
            })

        from .playback_session import ExportJob, frame_lookup
        job = ExportJob(
            job_id=uuid.uuid4().hex[:12],
            kind="video",
            request=req.model_dump(),
            status="queued",
            total_frames=hi - lo + 1,
            cancel_event=multiprocessing.Event(),
            pinned_recording_ids=tuple(stream.recording_ids),
            pinned_stream_id=stream.stream_id,
        )
        store.submit_export(job)

        # Run the encode in a background thread; frame rendering pulls from
        # the same in-process channel cache via store.get_frame (which is
        # thread-safe). We chose threads over multiprocessing so the
        # _FrameLRU hit rate stays high. Cross-process scale-out is
        # deferred to ``playback-multiproc-v1`` (M12 risk-skeptic A1
        # honest downgrade); the cancel_event still uses
        # ``multiprocessing.Event`` so a future swap to
        # ``Manager().Event()`` does not require touching call sites.
        def _run() -> None:
            t0 = time.time()
            out_dir = Path("outputs/playback") / req.stream_id
            out_dir.mkdir(parents=True, exist_ok=True)
            ext = {"mp4": "mp4", "apng": "png", "gif": "gif", "png-seq": "zip"}[req.fmt]
            out_path = out_dir / f"video-{job.job_id}.{ext}"
            from .playback_pipeline import ViewState as _VS
            views = [
                _VS(**{k: v for k, v in vp.items() if k in _VS.__dataclass_fields__})
                for vp in req.views
            ]
            try:
                # Pre-compute view-side dark policy once (per-frame
                # dark resolution still happens inside the loop because
                # exposure may change at file boundaries).
                _need_dark = any(v.dark_on for v in views)

                def _frames():
                    for fi in range(lo, hi + 1):
                        if job.cancel_event.is_set():
                            return
                        try:
                            channels = store.get_frame(req.stream_id, fi)
                        except Exception as exc:
                            job.error = f"frame {fi} decode failed: {exc}"
                            job.status = "failed"
                            return
                        b, _, local = frame_lookup(stream, fi)
                        # WYSIWYG dark resolution per frame
                        # (recording-inspection-implementation-v1
                        # fastapi-backend P0 #1, M12).
                        boundary_dark: Optional[Dict[str, np.ndarray]] = None
                        if _need_dark and b.exposure is not None:
                            pool = [h.master for h in store.list_darks()]
                            best, _ = match_dark_by_exposure(b.exposure, pool)
                            if best is not None:
                                boundary_dark = best.channels
                        ctx = BurnInContext(
                            frame_index=fi,
                            timestamp_s=b.ts_start_s + (local / max(stream.fps, 1e-9)),
                            source_filename=Path(store.get_recording(b.recording_id).path).name,
                        ) if req.include_labels else None
                        rgbs = render_views_for_frame(views, channels,
                                                       dark=boundary_dark,
                                                       max_dim=1024, burn_ctx=ctx)
                        if len(rgbs) > 1:
                            yield render_views_compose(rgbs, req.compose,
                                                        req.tile_arrangement)
                        else:
                            yield rgbs[0]
                        job.current_frame = fi - lo + 1
                        job.progress = job.current_frame / max(1, job.total_frames)
                        job.elapsed_s = time.time() - t0
                        if job.progress > 0:
                            job.eta_s = job.elapsed_s * (1 - job.progress) / job.progress

                job.status = "rendering"
                write_video(_frames(), out_path=out_path, fmt=req.fmt,
                            fps=req.fps, quality=req.quality)
                if job.cancel_event.is_set():
                    job.status = "cancelled"
                    # recording-inspection-implementation-v1 risk-skeptic
                    # A2, M12: unlink the partial output so cancelled
                    # encodes don't accumulate in outputs/playback/.
                    try:
                        out_path.unlink(missing_ok=True)
                    except OSError:
                        pass
                else:
                    job.status = "done"
                    job.output_path = out_path
                    job.sidecar_path = write_sidecar(
                        out_path,
                        stream_payload={"stream_id": stream.stream_id,
                                         "name": stream.name,
                                         "total_frames": stream.total_frames},
                        views=views,
                        frame_range=(lo, hi),
                        fps=req.fps,
                        fmt=req.fmt,
                        compose=req.compose,
                        build_version=__version__,
                    )
                    job.progress = 1.0
            except Exception as exc:
                job.error = f"{type(exc).__name__}: {exc}"
                job.status = "failed"
                # Same A2 cleanup for failed encodes.
                try:
                    out_path.unlink(missing_ok=True)
                except OSError:
                    pass

        threading.Thread(target=_run, daemon=True).start()
        return _job_payload(job)

    @app.get("/api/playback/exports/{job_id}")
    def get_job(job_id: str) -> Dict[str, Any]:
        try:
            job = store.get_job(job_id)
        except KeyError:
            raise HTTPException(404, f"unknown job id: {job_id}")
        return _job_payload(job)

    @app.delete("/api/playback/exports/{job_id}")
    def cancel_job(job_id: str) -> Dict[str, Any]:
        try:
            job = store.cancel_job(job_id)
        except KeyError:
            raise HTTPException(404, f"unknown job id: {job_id}")
        return _job_payload(job)

    # --- Send-to-mode handoff (M11) -------------------------------------

    @app.post("/api/playback/streams/{stream_id}/handoff/{mode}")
    def handoff(stream_id: str, mode: str,
                req: HandoffRequest) -> Dict[str, Any]:
        """Render the active frame's raw channel dict, register it as
        a `LoadedSource` in the analysis-mode `STORE`, return the
        new source_id. Per planner-architect P0-2 + risk-skeptic P1-L
        + M12 fastapi-backend P0 #2 + risk-skeptic A3:

        - Send the **raw extracted channels** (post-dark, pre-display).
          Display γ/WB/CCM are NOT baked.
        - Response carries `dark_already_subtracted: true` when
          dark_on=true so the receiving mode's dark-attach refuses to
          subtract again. The flag is also written to
          `LoadedSource.attrs["dark_already_subtracted"]` and read by
          `STORE.attach_dark_from_path` / `attach_dark_from_bytes`.
        - The new `LoadedSource` carries the stream's `isp_mode_id`
          and an empty `isp_config` so the receiving mode's ISP
          Settings round-trip doesn't lie about the source.
        - 422 with code `W-HANDOFF-NOLUM` when target mode lacks
          required channel keys.
        - Uses `STORE.register_external(src)` (not `STORE._items`
          poking) so the analysis-mode eviction-tracking invariant
          holds (R-0009 / fastapi-backend M12 P0 #2).
        """
        if mode not in ("usaf", "fpn", "dof"):
            raise HTTPException(422, f"unknown mode: {mode}")
        try:
            stream = store.get_stream(stream_id)
        except KeyError:
            raise HTTPException(404, f"unknown stream id: {stream_id}")
        frame = req.frame
        view_payload = req.view or {}
        preserve_dark = req.preserve_dark
        name = req.name or f"{stream.name} · f{frame}"
        if frame < 0 or frame >= stream.total_frames:
            raise HTTPException(422, f"frame {frame} out of stream range")
        channels = store.get_frame(stream_id, frame)

        # Sanity: USAF/FPN/DoF expect HG-Y / Y / L luminance. For
        # rgb_nir, channels already include HG-Y / LG-Y. For other ISP
        # modes (bare_*, polarization_*) → 422 with a stable code in
        # `detail.code` (FastAPI nests the dict under "detail", so we
        # construct the inner dict explicitly to keep
        # `body.detail.code === "W-HANDOFF-NOLUM"` on the wire — M12
        # fastapi-backend P1).
        if mode == "usaf" and "HG-Y" not in channels and "Y" not in channels and "L" not in channels:
            raise HTTPException(422, detail={
                "message": (
                    f"USAF requires luminance channel (HG-Y / Y / L); stream's "
                    f"ISP mode {stream.isp_mode_id!r} doesn't synthesize one."
                ),
                "code": "W-HANDOFF-NOLUM",
            })

        # Build a LoadedSource against the analysis-mode STORE.
        from .session import LoadedSource, STORE
        import uuid as _uuid
        # Optionally subtract the matched dark; we set
        # dark_already_subtracted=True only when we actually subtract.
        dark_dict = None
        if preserve_dark and view_payload.get("dark_on"):
            from .dark_frame import match_dark_by_exposure as _match
            from .playback_pipeline import subtract_dark as _sub
            from .playback_session import frame_lookup as _lookup
            try:
                boundary, _, _local = _lookup(stream, frame)
            except IndexError:
                boundary = None
            target = boundary.exposure if boundary else None
            if target is not None:
                pool = [h.master for h in store.list_darks()]
                best, _ = _match(target, pool)
                if best is not None:
                    dark_dict = best.channels
                    channels = {
                        k: _sub(v, dark_dict.get(k))
                        for k, v in channels.items()
                    }

        any_ch = next(iter(channels.values()))
        shape = (int(any_ch.shape[0]), int(any_ch.shape[1]))
        src = LoadedSource(
            source_id=_uuid.uuid4().hex[:12],
            name=name,
            source_kind="h5",
            channels=channels,
            attrs={"handoff_from_stream": stream.stream_id,
                    "handoff_frame": str(frame),
                    "handoff_mode": mode,
                    "dark_already_subtracted": str(bool(dark_dict)).lower()},
            shape_hw=shape,
            # M12 risk-skeptic A3 + fastapi-backend P1: pass through
            # the stream's ISP mode so the receiving mode's ISP
            # Settings round-trip works. `isp_config` is empty because
            # the handed-off channels are post-extract; re-extract is
            # not supported (raw_frame is None).
            isp_mode_id=stream.isp_mode_id,
            isp_config={},
        )
        STORE.register_external(src)
        return {
            "source_id": src.source_id,
            "kind": "h5",
            "channels": sorted(channels.keys()),
            "shape": list(shape),
            "isp_mode_id": stream.isp_mode_id,
            "has_dark": dark_dict is not None,
            "dark_already_subtracted": dark_dict is not None,
            "target_mode": mode,
        }

    @app.get("/api/playback/exports/{job_id}/file")
    def get_job_file(job_id: str) -> Response:
        try:
            job = store.get_job(job_id)
        except KeyError:
            raise HTTPException(404, f"unknown job id: {job_id}")
        if job.status != "done" or job.output_path is None:
            raise HTTPException(404, f"job {job_id} has no output yet")
        data = job.output_path.read_bytes()
        mime_for = {
            ".mp4": "video/mp4",
            ".png": "image/apng",
            ".gif": "image/gif",
            ".zip": "application/zip",
        }
        mime = mime_for.get(job.output_path.suffix, "application/octet-stream")
        return Response(content=data, media_type=mime, headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="{job.output_path.name}"',
        })

    # Test-only synthetic endpoints (gated)
    if test_mode:
        @app.post("/api/playback/recordings/load-sample")
        def load_sample_recording() -> Dict[str, Any]:
            tmp_dir = Path(tempfile.mkdtemp(prefix="mantis-playback-"))
            p = _synthetic_recording_h5(tmp_dir)
            h = store.register_recording(p, name=p.name)
            return _recording_payload(h)

        @app.post("/api/playback/darks/load-sample")
        def load_sample_dark() -> Dict[str, Any]:
            tmp_dir = Path(tempfile.mkdtemp(prefix="mantis-playback-dark-"))
            p = _synthetic_dark_h5(tmp_dir)
            master = average_dark_h5(p, max_frames=16, strategy="mean")
            return _dark_payload(store.register_dark(master))


def _badges_for(view: ViewState) -> List[str]:
    """Compute badge codes for a view (mirrors `playback_panels.jsx::badgesFor`)."""
    badges: List[str] = []
    if (not view.dark_on and not view.normalize and view.colormap == "gray"
            and view.type != "rgb"):
        badges.append("RAW")
    if view.dark_on:
        badges.append("DRK")
    if view.normalize:
        badges.append("NRM")
    if view.colormap and view.colormap != "gray" and view.type != "rgb":
        badges.append("LUT")
    if view.type == "rgb":
        badges.append("RGB")
    if view.overlay_on:
        badges.append("OVL")
    return badges


def render_views_compose(rgbs: List[np.ndarray], compose: str,
                          tile_arrangement: Optional[Tuple[int, int]]
                          ) -> np.ndarray:
    """Compose multiple rendered RGBs into one frame for video export."""
    from .playback_export import _compose_tiled
    if compose == "single" or len(rgbs) == 1:
        return rgbs[0]
    if compose == "grid":
        cols, _rows = tile_arrangement or (2, 2)
        return _compose_tiled(rgbs, cols=cols)
    return _compose_tiled(rgbs, cols=len(rgbs))


def _job_payload(job) -> Dict[str, Any]:
    out_path = job.output_path
    sidecar_path = job.sidecar_path
    return {
        "job_id": job.job_id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "current_frame": job.current_frame,
        "total_frames": job.total_frames,
        "elapsed_s": job.elapsed_s,
        "eta_s": job.eta_s,
        "output_url": f"/api/playback/exports/{job.job_id}/file" if out_path else None,
        "sidecar_url": str(sidecar_path) if sidecar_path else None,
        "error": job.error,
    }


def _evicted_detail(kind: str, item_id: str) -> Dict[str, Any]:
    return {
        "detail": f"{kind} evicted from session cache",
        "evicted_id": item_id,
        "kind": kind,
    }


__all__ = ["mount_playback_api"]
