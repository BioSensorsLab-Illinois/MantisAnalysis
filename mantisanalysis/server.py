"""FastAPI server for the MantisAnalysis web GUI.

Wraps the pure-NumPy analysis modules (`usaf_groups`, `fpn_analysis`,
`dof_analysis`, `image_io`, `extract`, `image_processing`) with JSON
endpoints. Serves the React frontend from the repo's `web/` tree.

Process-local only — no auth, no multi-tenancy. One user, one machine.
The server is meant to be launched via `python -m mantisanalysis`, which
also opens the default browser to the root URL.
"""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from . import isp_modes as _isp
from .image_io import rgb_composite as _rgb_composite
from .dof_analysis import (
    DoFPoint,
    analyze_dof,
    analyze_dof_multi,
    compute_dof_stability,
)
from .figures import (
    build_dof_multi_chromatic_png,
    build_dof_pngs,
    build_fpn_pngs,
    build_usaf_pngs,
)
from .fpn_analysis import (
    FPNSettings,
    compute_fpn,
    compute_fpn_multi,
    compute_prnu_stability,
)
from .image_processing import apply_sharpen
from .session import STORE, _summary_dict, channel_to_png_bytes, subtract_dark
from .usaf_groups import LineSpec, detection_limit_lp_mm, measure_line


# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------

class SourceSummary(BaseModel):
    source_id: str
    name: str
    kind: str
    channels: List[str]
    shape: List[int]
    loaded_at: float
    path: Optional[str] = None       # absolute disk path when available
    has_dark: bool = False           # True iff a dark frame is attached
    dark_name: Optional[str] = None  # display name (filename or 'load-path')
    dark_path: Optional[str] = None  # absolute disk path of dark, when known
    # ISP-modes-v1: active mode + resolved geometry + rename map.
    isp_mode_id: str = "rgb_nir"
    isp_config: Dict[str, Any] = Field(default_factory=dict)
    isp_channel_map: Dict[str, str] = Field(default_factory=dict)
    rgb_composite_available: bool = False


class ISPChannelSpecOut(BaseModel):
    slot_id: str
    default_name: str
    loc: Tuple[int, int]
    renameable: bool
    color_hint: str


class ISPModeOut(BaseModel):
    id: str
    display_name: str
    description: str
    dual_gain: bool
    channels: List[ISPChannelSpecOut]
    default_origin: Tuple[int, int]
    default_sub_step: Tuple[int, int]
    default_outer_stride: Tuple[int, int]
    supports_rgb_composite: bool


class ISPReconfigureRequest(BaseModel):
    """Payload for PUT /api/sources/{source_id}/isp.

    All fields are optional — omit to inherit the mode's defaults.
    ``channel_name_overrides`` keys must match a renameable slot_id on
    the target mode; other keys are dropped silently.
    ``channel_loc_overrides`` maps slot_id → [row, col] to point an
    individual channel at a different sub-tile (e.g. RGB-NIR's R slot
    at (1,1) instead of the default (0,1)). Keys for unknown slot_ids
    on the target mode are silently dropped.
    """
    mode_id: str
    origin: Optional[Tuple[int, int]] = None
    sub_step: Optional[Tuple[int, int]] = None
    outer_stride: Optional[Tuple[int, int]] = None
    channel_name_overrides: Optional[Dict[str, str]] = None
    channel_loc_overrides: Optional[Dict[str, Tuple[int, int]]] = None


class DarkLoadPathRequest(BaseModel):
    path: str
    name: Optional[str] = None


class LoadFromPathRequest(BaseModel):
    path: str
    name: Optional[str] = None


class LineSpecIn(BaseModel):
    group: int
    element: int
    direction: str                        # "H" or "V"
    p0: Tuple[float, float]
    p1: Tuple[float, float]


class ISPParams(BaseModel):
    """ISP pipeline applied to the analysis image before measurement.
    Every field is optional; omit to bypass that stage.

    Two distinct chains live here side-by-side:
      * USAF / sharpening chain — sharpen_method + sharpen_amount/radius +
        denoise_sigma + black_level. Order: black-level → sharpen → gauss.
      * FPN / smoothing chain — median_size + gaussian_sigma + hot_pixel_thr
        + bilateral. Same order as `apply_isp` in fpn_analysis.py
        (hot-pix → bilateral → median → gauss). The two chains compose:
        USAF stages run first, then FPN stages. In practice users only set
        one chain at a time, but composing is well-defined.
    """
    # USAF / sharpening chain
    sharpen_method: Optional[str] = None        # "Unsharp mask" | "Laplacian" | "High-pass"
    sharpen_amount: float = 1.0
    sharpen_radius: float = 2.0
    denoise_sigma: float = 0.0                  # Gaussian σ in px
    black_level: float = 0.0                    # DN offset subtracted before measure
    # FPN / smoothing chain (mirrors fpn_analysis.FPNSettings field names so
    # the same JSON shape feeds both `apply_isp` and the canvas thumbnail).
    median_size: int = 0                         # 0 = off · else odd 3/5/7
    gaussian_sigma: float = 0.0                  # 0 = off · stronger Gaussian (FPN-style)
    hot_pixel_thr: float = 0.0                   # 0 = off · replace pixels > thr·σ from local median
    bilateral: bool = False                      # cheap edge-preserving smoothing


class MeasureRequest(BaseModel):
    source_id: str
    channel: str
    line: LineSpecIn
    swath_width: float = 8.0
    method: str = "five_point"            # "percentile" | "minmax" | "fft" | "five_point"
    isp: Optional[ISPParams] = None       # live-apply ISP before measurement
    # Optional manual 5-point overrides: sample indices into the extracted
    # profile. When present, the server uses these instead of auto-detection.
    bar_indices: Optional[List[int]] = None
    gap_indices: Optional[List[int]] = None


class MeasureResponse(BaseModel):
    lp_mm: float
    modulation: float
    modulation_pct: float
    modulation_minmax: float
    modulation_fft: float
    modulation_5pt: float
    profile_min: float
    profile_max: float
    profile_p10: float
    profile_p90: float
    line_length_px: float
    n_samples: int
    samples_per_cycle: float
    reliability: str
    profile: List[float]
    # 5-point detection output (or user-supplied override echoed back)
    bar_indices: List[int]
    gap_indices: List[int]
    bar_values: List[float]
    gap_values: List[float]
    bars_bright: bool


class USAFAnalyzeRequest(BaseModel):
    source_id: str
    channels: Optional[List[str]] = None  # None = all
    lines: List[LineSpecIn]
    threshold: float = 0.2
    theme: str = "light"
    transform: Dict[str, Any] = Field(default_factory=dict)
    isp: Optional[ISPParams] = None


class FPNComputeRequest(BaseModel):
    source_id: str
    channel: str
    roi: Tuple[int, int, int, int]        # (y0, x0, y1, x1)
    settings: Dict[str, Any] = Field(default_factory=dict)
    theme: str = "light"


class FPNComputeResponse(BaseModel):
    """Small-payload summary — used by the live-drag Live stats card.
    For the full per-ROI dataset (row/col profiles, 1-D PSDs, hot-pixel
    lists, etc.) hit /api/fpn/measure instead."""
    name: str
    mean: float
    mean_signal: float
    std: float
    dsnu_dn: float
    prnu_pct: float
    row_noise_dn: float
    col_noise_dn: float
    residual_pixel_noise_dn: float
    dsnu_row_only_dn: float
    dsnu_col_only_dn: float
    row_peak_freq: float
    col_peak_freq: float
    row_peak_amp: float
    col_peak_amp: float
    hot_pixel_count: int
    cold_pixel_count: int
    n_kept: int
    n_total: int
    minv: float
    maxv: float
    p1: float
    p99: float
    median: float
    drift_order: str


class FPNMeasureRequest(FPNComputeRequest):
    """Per-ROI rich payload. Returns everything /api/fpn/compute does
    plus row_means / col_means / 1-D PSDs / top hot/cold pixel lists so
    the UI can show every inline chart without a follow-up round-trip."""


class FPNMeasureBatchRequest(BaseModel):
    """Compute rich per-ROI data for a list of ROIs on one channel.
    Used by the multi-ROI compare view."""
    source_id: str
    channel: str
    rois: List[Tuple[int, int, int, int]]
    settings: Dict[str, Any] = Field(default_factory=dict)


class FPNStabilityRequest(BaseModel):
    source_id: str
    channel: str
    roi: Tuple[int, int, int, int]
    n_shrinks: int = 5
    settings: Dict[str, Any] = Field(default_factory=dict)


class FPNAnalyzeRequest(BaseModel):
    """Full multi-channel FPN analysis, mirrors USAF's analyze shape.
    One or more channels, one or more ROIs; response is a rich JSON
    dataset plus base64 PNGs for offline export."""
    source_id: str
    channels: Optional[List[str]] = None   # default = all
    rois: List[Tuple[int, int, int, int]]
    settings: Dict[str, Any] = Field(default_factory=dict)
    theme: str = "light"
    include_pngs: bool = True              # off → faster, JSON-only


class DoFPointIn(BaseModel):
    x: float
    y: float
    label: str = ""


class DoFLineIn(BaseModel):
    p0: Tuple[float, float]
    p1: Tuple[float, float]


class DoFComputeRequest(BaseModel):
    source_id: str
    channel: str
    points: List[DoFPointIn] = Field(default_factory=list)
    lines: List[DoFLineIn] = Field(default_factory=list)
    metric: str = "laplacian"
    half_window: int = 32
    threshold: float = 0.5
    calibration: Optional[Dict[str, Any]] = None
    theme: str = "light"
    isp: Optional[ISPParams] = None
    # dof-rewrite-v1 extras; default false so old callers keep paying zero cost.
    compute_all_metrics: bool = False
    bootstrap: bool = False
    n_boot: int = 200
    fit_tilt_plane: bool = False


class DoFAnalyzeRequest(BaseModel):
    """Multi-channel DoF analysis. Mirrors the FPN analyze shape: pick
    a list of channels, run the full pipeline per channel, and return
    a grid of per-channel DoFChannelResult dicts plus base64 PNGs for
    offline export."""
    source_id: str
    channels: Optional[List[str]] = None   # None = all
    points: List[DoFPointIn] = Field(default_factory=list)
    lines: List[DoFLineIn] = Field(default_factory=list)
    metric: str = "laplacian"
    half_window: int = 32
    threshold: float = 0.5
    calibration: Optional[Dict[str, Any]] = None
    theme: str = "light"
    isp: Optional[ISPParams] = None
    compute_all_metrics: bool = True
    bootstrap: bool = True
    n_boot: int = 200
    fit_tilt_plane: bool = True
    include_pngs: bool = True


class DoFStabilityRequest(BaseModel):
    source_id: str
    channel: str
    p0: Tuple[float, float]
    p1: Tuple[float, float]
    metric: str = "laplacian"
    threshold: float = 0.5
    line_step_px: float = 4.0
    windows: List[int] = Field(default_factory=lambda: [12, 16, 24, 32, 48, 64])
    isp: Optional[ISPParams] = None


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent


def _resolve_web_dir() -> Path:
    """Locate the bundled ``web/`` SPA tree.

    Resolution order:
      1. ``MANTIS_WEB_DIR`` env override (tests, custom deployments).
      2. PyInstaller onefile extraction dir (``sys._MEIPASS``).
      3. PyInstaller onedir sibling (``<exe_dir>/web``).
      4. Source checkout (``<repo_root>/web``).
    """
    import os
    import sys

    override = os.environ.get("MANTIS_WEB_DIR")
    if override:
        p = Path(override).expanduser().resolve()
        if p.exists():
            return p

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "web"
        if p.exists():
            return p

    if getattr(sys, "frozen", False):
        p = Path(sys.executable).resolve().parent / "web"
        if p.exists():
            return p

    return REPO_ROOT / "web"


WEB_DIR = _resolve_web_dir()


def create_app() -> FastAPI:
    app = FastAPI(
        title="MantisAnalysis",
        version=__version__,
        description=(
            "HTTP API over MantisAnalysis analysis math. Consumed by the "
            "React single-page app served from /. See /api/docs for the "
            "full interactive schema."
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    # Permissive CORS — this server is always local, but users may hit it
    # from a `python -m http.server` frontend on a different port during
    # hot-reload development.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
    )

    _mount_api(app)
    from .playback.api import mount as _mount_playback
    _mount_playback(app)
    _mount_static(app)
    return app


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

def _mount_api(app: FastAPI) -> None:

    @app.get("/api/health")
    def health() -> Dict[str, Any]:
        return {
            "ok": True,
            "version": __version__,
            "sources": len(STORE.list()),
        }

    @app.get("/api/sources", response_model=List[SourceSummary])
    def list_sources():
        return STORE.list()

    @app.post("/api/sources/upload", response_model=SourceSummary)
    async def upload_source(file: UploadFile = File(...)):
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty upload")
        try:
            src = STORE.load_from_bytes(data, name=file.filename or "upload")
        except Exception as exc:
            raise HTTPException(400, f"load failed: {type(exc).__name__}: {exc}") from exc
        return _summary(src)

    @app.post("/api/sources/load-path", response_model=SourceSummary)
    def load_path(req: LoadFromPathRequest):
        p = Path(req.path).expanduser()
        if not p.exists():
            raise HTTPException(404, f"path not found: {p}")
        try:
            src = STORE.load_from_path(p, name=req.name)
        except Exception as exc:
            raise HTTPException(400, f"load failed: {type(exc).__name__}: {exc}") from exc
        return _summary(src)

    @app.post("/api/sources/load-sample", response_model=SourceSummary)
    def load_sample():
        """Generate a USAF-like synthetic dual-gain sample so the user can
        drive the whole pipeline — picking lines, ISP, analysis — without
        a real recording. Uses real hard-edged bar patterns (which the ISP
        sharpen/denoise sliders produce visibly-different output on)."""
        channels = _synthetic_usaf_sample()
        any_ch = next(iter(channels.values()))
        shape = (int(any_ch.shape[0]), int(any_ch.shape[1]))

        import uuid

        from .session import LoadedSource
        src = LoadedSource(
            source_id=uuid.uuid4().hex[:12],
            name="sample (synthetic USAF target)",
            source_kind="synthetic",
            channels=channels,
            attrs={"note": "procedural USAF target with bar groups 0-5"},
            shape_hw=shape,
        )
        with STORE._lock:
            STORE._items[src.source_id] = src
            STORE._evict_locked()
        return _summary(src)

    @app.delete("/api/sources/{source_id}")
    def delete_source(source_id: str):
        with STORE._lock:
            if source_id not in STORE._items:
                raise HTTPException(404, "unknown source")
            del STORE._items[source_id]
        return {"ok": True}

    @app.get("/api/sources/{source_id}", response_model=SourceSummary)
    def get_source(source_id: str):
        src = _must_get(source_id)
        return _summary(src)

    # ---- Dark frame management -----------------------------------------
    # A dark frame is a per-pixel offset (sensor dark current + bias)
    # captured with the lens covered. Subtracting it from every analysis
    # image cancels the per-pixel pedestal that USAF Michelson contrast
    # would otherwise interpret as a dim "gap". Math runs in float64 with
    # a ≥ 0 clamp so uint16 wrap-around can never poison the result.

    @app.post("/api/sources/{source_id}/dark/upload", response_model=SourceSummary)
    async def upload_dark(source_id: str, file: UploadFile = File(...)):
        data = await file.read()
        if not data:
            raise HTTPException(400, "empty upload")
        try:
            src = STORE.attach_dark_from_bytes(source_id, data, name=file.filename or "dark")
        except KeyError:
            raise HTTPException(404, f"unknown source id: {source_id}")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except Exception as exc:
            raise HTTPException(400, f"dark load failed: {type(exc).__name__}: {exc}")
        return _summary(src)

    @app.post("/api/sources/{source_id}/dark/load-path", response_model=SourceSummary)
    def load_dark_path(source_id: str, req: DarkLoadPathRequest):
        from pathlib import Path as _P
        p = _P(req.path).expanduser()
        if not p.exists():
            raise HTTPException(404, f"path not found: {p}")
        try:
            src = STORE.attach_dark_from_path(source_id, p, name=req.name)
        except KeyError:
            raise HTTPException(404, f"unknown source id: {source_id}")
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except Exception as exc:
            raise HTTPException(400, f"dark load failed: {type(exc).__name__}: {exc}")
        return _summary(src)

    @app.delete("/api/sources/{source_id}/dark", response_model=SourceSummary)
    def clear_dark(source_id: str):
        try:
            src = STORE.clear_dark(source_id)
        except KeyError:
            raise HTTPException(404, f"unknown source id: {source_id}")
        return _summary(src)

    # ---- ISP modes -----------------------------------------------------

    @app.get("/api/isp/modes", response_model=List[ISPModeOut])
    def list_isp_modes():
        """Static catalog of the ISP modes the analysis tool knows about.

        Shape matches ``ISPModeOut``; the UI consumes this once at startup
        and drives the settings-window dropdown off the result.
        """
        out: List[ISPModeOut] = []
        for mode in _isp.ALL_MODES.values():
            out.append(ISPModeOut(
                id=mode.id,
                display_name=mode.display_name,
                description=mode.description,
                dual_gain=mode.dual_gain,
                channels=[ISPChannelSpecOut(
                    slot_id=c.slot_id, default_name=c.default_name,
                    loc=tuple(c.loc), renameable=c.renameable,
                    color_hint=c.color_hint,
                ) for c in mode.channels],
                default_origin=tuple(mode.default_origin),
                default_sub_step=tuple(mode.default_sub_step),
                default_outer_stride=tuple(mode.default_outer_stride),
                supports_rgb_composite=mode.supports_rgb_composite,
            ))
        return out

    @app.get("/api/sources/{source_id}/isp", response_model=SourceSummary)
    def get_source_isp(source_id: str):
        """Current ISP mode + resolved geometry for a source."""
        src = _must_get(source_id)
        return _summary(src)

    @app.put("/api/sources/{source_id}/isp", response_model=SourceSummary)
    def reconfigure_source_isp(source_id: str, req: ISPReconfigureRequest):
        """Switch ISP mode and/or override geometry; returns updated summary.

        422 when mode_id is unknown or geometry tuples are malformed.
        400 when the source was created without a cached raw frame
        (e.g. the synthetic sample).
        """
        overrides = {}
        if req.origin is not None:
            overrides["origin"] = list(req.origin)
        if req.sub_step is not None:
            overrides["sub_step"] = list(req.sub_step)
        if req.outer_stride is not None:
            overrides["outer_stride"] = list(req.outer_stride)
        if req.channel_name_overrides is not None:
            overrides["channel_name_overrides"] = dict(req.channel_name_overrides)
        if req.channel_loc_overrides is not None:
            overrides["channel_loc_overrides"] = {
                k: list(v) for k, v in req.channel_loc_overrides.items()
            }
        try:
            src = STORE.reconfigure_isp(source_id, req.mode_id, overrides)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(400, str(exc)) from exc
        return _summary(src)

    @app.get(
        "/api/sources/{source_id}/channel/{channel}/thumbnail.png",
        responses={200: {"content": {"image/png": {}}}},
    )
    def channel_thumbnail(
        source_id: str,
        channel: str,
        max_dim: int = Query(1600, ge=64, le=8192),
        colormap: str = Query("gray"),
        # USAF / sharpen chain
        sharpen_method: Optional[str] = Query(None),
        sharpen_amount: float = Query(1.0),
        sharpen_radius: float = Query(2.0),
        denoise_sigma: float = Query(0.0),
        black_level: float = Query(0.0),
        # FPN / smoothing chain — additive to the sharpen chain so the
        # canvas image previews the same preprocessing the FPN analysis
        # actually runs on the array.
        median_size: int = Query(0, ge=0, le=15),
        gaussian_sigma: float = Query(0.0, ge=0.0, le=20.0),
        hot_pixel_thr: float = Query(0.0, ge=0.0, le=50.0),
        bilateral: bool = Query(False),
        vmin: Optional[float] = Query(None),
        vmax: Optional[float] = Query(None),
        rgb_composite: bool = Query(False,
            description="Return an R/G/B composite PNG instead of a "
                        "single-channel colormap. Only honored when the "
                        "active ISP mode supports it."),
    ):
        """Serve a channel as a display-ready PNG. Optional ISP query params
        apply the same pipeline used by /api/usaf/measure so the live canvas
        can mirror what the analysis sees. Supported colormaps: any
        matplotlib name (gray / jet / viridis / magma / inferno / plasma /
        cividis / turbo / ...).

        ``vmin`` / ``vmax`` (both required to take effect) override the
        default percentile-clip normalization and pin the colormap range to
        the user-specified DN window — so the live canvas matches whatever
        sweep / reference range the user wants displayed.

        ``rgb_composite=true`` returns an RGB composite PNG sourced from
        the mode's R/G/B slots. For dual-gain modes, the leading ``HG-``
        or ``LG-`` prefix of the ``channel`` path parameter selects which
        gain half's composite is built. Falls back to the single-channel
        grayscale path when the active mode doesn't support composites.
        """
        src = _must_get(source_id)
        if rgb_composite:
            composite_png = _try_build_rgb_composite_png(
                src, channel, max_dim=max_dim, vmin=vmin, vmax=vmax,
            )
            if composite_png is not None:
                return Response(content=composite_png, media_type="image/png",
                                headers={"Cache-Control": "no-store"})
            # Falls through to grayscale when composite unavailable so the
            # UI can optimistically request and gracefully degrade.
        # Use _channel_image so dark subtraction is applied transparently
        # before the colormap + percentile-clip thumbnail render.
        image = _channel_image(src, channel)
        # Only construct ISPParams if at least one stage is active, so the
        # no-ISP fast path still hits the raw array without a copy.
        any_sharpen_chain = (sharpen_method and sharpen_method not in ("", "None")) or denoise_sigma > 0.05 or black_level > 0
        any_fpn_chain    = (median_size >= 3 or gaussian_sigma > 0.05
                            or hot_pixel_thr > 0.5 or bilateral)
        if any_sharpen_chain or any_fpn_chain:
            isp = ISPParams(
                sharpen_method=sharpen_method,
                sharpen_amount=sharpen_amount,
                sharpen_radius=sharpen_radius,
                denoise_sigma=denoise_sigma,
                black_level=black_level,
                median_size=median_size,
                gaussian_sigma=gaussian_sigma,
                hot_pixel_thr=hot_pixel_thr,
                bilateral=bilateral,
            )
            image = _apply_analysis_isp(image, isp)
        png = channel_to_png_bytes(image, max_dim=max_dim, colormap=colormap,
                                    vmin=vmin, vmax=vmax)
        # Thumbnails are state-dependent (ISP params are passed as query
        # args). Disable HTTP caching so the browser always re-fetches when
        # the URL changes, even if the URL happens to repeat.
        return Response(content=png, media_type="image/png",
                        headers={"Cache-Control": "no-store"})

    @app.get("/api/sources/{source_id}/channel/{channel}/range")
    def channel_range(source_id: str, channel: str):
        """Return min/max + low/high percentiles of the channel pixel
        values. Used by the frontend to seed sensible vmin/vmax defaults
        and bound the slider range. Dark subtraction is applied first so
        the reported values match what the colormap actually sees."""
        src = _must_get(source_id)
        a = _channel_image(src, channel).astype(np.float32, copy=False)
        return {
            "min":  float(a.min()),
            "max":  float(a.max()),
            "p1":   float(np.percentile(a, 1.0)),
            "p99":  float(np.percentile(a, 99.5)),
            "mean": float(a.mean()),
            "std":  float(a.std()),
        }

    @app.get("/api/colormap/{name}.png",
             responses={200: {"content": {"image/png": {}}}})
    def colormap_strip(name: str, w: int = Query(16, ge=4, le=256),
                                  h: int = Query(256, ge=8, le=2048)):
        """Render a vertical colormap strip as PNG (top = high, bottom =
        low). Used by the frontend to draw the canvas colorbar with exact
        colormap parity (no need to ship matplotlib's LUT to the browser)."""
        from PIL import Image
        # Build a gradient column from 1.0 (top) to 0.0 (bottom).
        col = np.linspace(1.0, 0.0, h, dtype=np.float32)[:, None]
        col = np.repeat(col, w, axis=1)
        cmap_name = (name or "gray").lower()
        if cmap_name in ("gray", "grey", "l", "mono"):
            n8 = (col * 255.0).astype(np.uint8)
            im = Image.fromarray(n8, mode="L")
        else:
            from matplotlib import colormaps
            try:
                cmap = colormaps[cmap_name]
            except KeyError:
                n8 = (col * 255.0).astype(np.uint8)
                im = Image.fromarray(n8, mode="L")
            else:
                rgba = cmap(col, bytes=True)
                im = Image.fromarray(rgba[..., :3], mode="RGB")
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=False)
        # Colormap strips are pure functions of (name, w, h) — cacheable.
        return Response(content=buf.getvalue(), media_type="image/png",
                        headers={"Cache-Control": "public, max-age=86400"})

    # ---- USAF ----

    @app.post("/api/usaf/measure", response_model=MeasureResponse)
    def usaf_measure(req: MeasureRequest):
        src = _must_get(req.source_id)
        img = _apply_analysis_isp(_channel_image(src, req.channel), req.isp)
        spec = _line_spec(req.line)
        try:
            m = measure_line(
                img, spec,
                swath_width=float(req.swath_width),
                method=req.method,
                bar_indices=req.bar_indices,
                gap_indices=req.gap_indices,
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return _measure_to_response(m)

    @app.post("/api/usaf/analyze")
    def usaf_analyze(req: USAFAnalyzeRequest):
        """Full USAF analysis. Returns JSON (no rendered PNG plots) so the
        frontend can draw native vector charts with Plotly.js. Payload:

            channels:                 [str, ...] — in the order requested
            specs:                    [{group, element, direction, p0, p1}]
            threshold:                float in [0, 1]
            channel_shape:            [H, W]
            measurements:             {channel: [MeasureResponse-like | null, ...]}
            channel_thumbnails:       {channel: "data:image/png;base64,..."}
            per_channel_detection_limit: {channel: lp_mm | null}
        """
        src = _must_get(req.source_id)
        specs = [_line_spec(l) for l in req.lines]
        chs_requested = req.channels or list(src.channels.keys())
        # Apply dark subtraction first (no-op if no dark attached), then ISP.
        channel_images = {
            k: _apply_analysis_isp(_channel_image(src, k), req.isp)
            for k in chs_requested if k in src.channels
        }
        if not channel_images:
            raise HTTPException(400, "no valid channels requested")

        # Measure every line on every channel. Individual per-line failures
        # (degenerate / too-short) are reported as `null` entries so the
        # frontend can show partial data instead of erroring the whole run.
        measurements: Dict[str, List[Any]] = {}
        per_ch_lim: Dict[str, Optional[float]] = {}
        for ch, img in channel_images.items():
            ms: List[Any] = []
            lm_list = []
            for spec in specs:
                try:
                    m = measure_line(img, spec, swath_width=8.0, method="five_point")
                    ms.append(_measure_to_response(m).model_dump())
                    lm_list.append(m)
                except Exception:
                    ms.append(None)
            measurements[ch] = ms
            lim, _ = detection_limit_lp_mm(lm_list, float(req.threshold)) if lm_list else (None, None)
            per_ch_lim[ch] = lim

        # Channel thumbnails as data-URL PNGs so the detection-heatmap tab can
        # drop them in as Plotly layout images (no separate HTTP round-trip
        # per tab). Apply the requested colormap (default gray) server-side.
        colormap = req.theme if req.theme in ("gray",) else "gray"
        thumbnails = {}
        thumb_dim = 520
        for ch, img in channel_images.items():
            blob = channel_to_png_bytes(img, max_dim=thumb_dim, colormap="gray")
            thumbnails[ch] = "data:image/png;base64," + base64.b64encode(blob).decode()

        any_ch = next(iter(channel_images))
        h, w = channel_images[any_ch].shape[:2]

        return JSONResponse({
            "channels": list(channel_images.keys()),
            "specs": [
                {"group": int(s.group), "element": int(s.element),
                 "direction": s.direction,
                 "p0": [float(s.p0[0]), float(s.p0[1])],
                 "p1": [float(s.p1[0]), float(s.p1[1])]}
                for s in specs
            ],
            "threshold": float(req.threshold),
            "channel_shape": [int(h), int(w)],
            "measurements": measurements,
            "channel_thumbnails": thumbnails,
            "per_channel_detection_limit": per_ch_lim,
        })

    # ---- FPN ----

    @app.post("/api/fpn/compute", response_model=FPNComputeResponse)
    def fpn_compute(req: FPNComputeRequest):
        """Small-payload live summary. Drop this on every ROI drag tick."""
        src = _must_get(req.source_id)
        img = _channel_image(src, req.channel)
        settings = _fpn_settings(req.settings)
        try:
            res = compute_fpn(img, name=req.channel, roi=tuple(req.roi), settings=settings)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return _fpn_to_response(res)

    @app.post("/api/fpn/measure")
    def fpn_measure(req: FPNMeasureRequest):
        """Rich per-ROI payload used by the right-sidebar profile + PSD
        previews and the Analysis modal's summary tab. Same shape as the
        FPNResult dataclass minus the very large 2-D arrays (FPN map,
        autocorr, PSD map) which are streamed via separate endpoints or
        rendered server-side."""
        src = _must_get(req.source_id)
        img = _channel_image(src, req.channel)
        settings = _fpn_settings(req.settings)
        try:
            res = compute_fpn(img, name=req.channel, roi=tuple(req.roi), settings=settings)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return JSONResponse(_fpn_full_dict(res))

    @app.post("/api/fpn/measure_batch")
    def fpn_measure_batch(req: FPNMeasureBatchRequest):
        """Rich per-ROI payload for a list of ROIs — one channel."""
        src = _must_get(req.source_id)
        img = _channel_image(src, req.channel)
        settings = _fpn_settings(req.settings)
        out: List[Dict[str, Any]] = []
        for i, roi in enumerate(req.rois):
            try:
                res = compute_fpn(img, name=req.channel, roi=tuple(roi),
                                  settings=settings)
                out.append(_fpn_full_dict(res))
            except ValueError as exc:
                out.append({"roi": list(roi), "error": str(exc)})
        return JSONResponse({"channel": req.channel, "rois": out})

    @app.post("/api/fpn/stability")
    def fpn_stability(req: FPNStabilityRequest):
        """PRNU stability curve — shrinks the ROI in `n_shrinks` steps
        and reports DSNU/PRNU at each size. Used to check whether a
        user's ROI is large enough for the statistics to stabilize."""
        src = _must_get(req.source_id)
        img = _channel_image(src, req.channel)
        settings = _fpn_settings(req.settings)
        try:
            curve = compute_prnu_stability(img, roi=tuple(req.roi),
                                            n_shrinks=int(req.n_shrinks),
                                            settings=settings)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return JSONResponse({"channel": req.channel,
                             "roi": list(req.roi), "curve": curve})

    @app.post("/api/fpn/analyze")
    def fpn_analyze(req: FPNAnalyzeRequest):
        """Full multi-channel × multi-ROI FPN analysis. Mirrors the
        shape of /api/usaf/analyze: every channel gets a list of
        per-ROI FPN results, channel thumbnails are attached as
        data-URLs, and an optional dict of matplotlib PNG figures
        (per-channel × per-builder) is included for offline PDF export.

        Response shape:

            {
              channels:  [str, ...],
              rois:      [[y0, x0, y1, x1], ...],   # input echoed back
              channel_shape: [H, W],
              measurements:  {channel: [FPN full dict, ...]},
              channel_thumbnails: {channel: "data:image/png;base64,..."},
              settings: {...},
              figures: {
                  channel: {roi_idx: {overview: base64, rowcol: base64, ...}},
              }          # omitted when include_pngs=false
            }
        """
        src = _must_get(req.source_id)
        settings = _fpn_settings(req.settings)
        chs_requested = req.channels or list(src.channels.keys())
        channel_images = {k: _channel_image(src, k) for k in chs_requested if k in src.channels}
        if not channel_images:
            raise HTTPException(400, "no valid channels requested")
        if not req.rois:
            raise HTTPException(400, "at least one ROI is required")

        measurements: Dict[str, List[Any]] = {}
        figures: Dict[str, Any] = {}
        thumb_dim = 520
        thumbnails: Dict[str, str] = {}

        for ch, img in channel_images.items():
            per_roi: List[Any] = []
            per_roi_figs: Dict[str, Any] = {}
            for i, roi in enumerate(req.rois):
                try:
                    res = compute_fpn(img, name=ch, roi=tuple(roi), settings=settings)
                    per_roi.append(_fpn_full_dict(res))
                    if req.include_pngs:
                        pngs = build_fpn_pngs(res, theme=req.theme)
                        per_roi_figs[str(i)] = {
                            k: base64.b64encode(v).decode()
                            for k, v in pngs.items()
                        }
                except Exception as exc:
                    per_roi.append({"roi": list(roi),
                                    "error": f"{type(exc).__name__}: {exc}"})
            measurements[ch] = per_roi
            figures[ch] = per_roi_figs
            blob = channel_to_png_bytes(img, max_dim=thumb_dim, colormap="gray")
            thumbnails[ch] = "data:image/png;base64," + base64.b64encode(blob).decode()

        any_ch = next(iter(channel_images))
        h, w = channel_images[any_ch].shape[:2]

        resp: Dict[str, Any] = {
            "channels": list(channel_images.keys()),
            "rois": [list(r) for r in req.rois],
            "channel_shape": [int(h), int(w)],
            "measurements": measurements,
            "channel_thumbnails": thumbnails,
            "settings": {
                "median_size": settings.median_size,
                "gaussian_sigma": settings.gaussian_sigma,
                "hot_pixel_thr": settings.hot_pixel_thr,
                "bilateral": settings.bilateral,
                "lo_pct": settings.lo_pct,
                "hi_pct": settings.hi_pct,
                "drift_order": settings.drift_order,
                "hot_sigma": settings.hot_sigma,
            },
        }
        if req.include_pngs:
            resp["figures"] = figures
        return JSONResponse(resp)

    # ---- DoF ----

    @app.post("/api/dof/compute")
    def dof_compute(req: DoFComputeRequest):
        """Live per-channel DoF compute. Small payload by default
        (no heatmap, no all-metrics sweep, no bootstrap). Toggle the
        extras flags when the caller actually needs them."""
        src = _must_get(req.source_id)
        img = _apply_analysis_isp(_channel_image(src, req.channel), req.isp)
        try:
            res = analyze_dof(
                img, name=req.channel,
                points=[DoFPoint(x=p.x, y=p.y, label=p.label) for p in req.points],
                lines=[(l.p0, l.p1) for l in req.lines],
                metric=req.metric, half_window=int(req.half_window),
                threshold=float(req.threshold),
                build_heatmap=False,
                calibration=req.calibration,
                compute_all_metrics=bool(req.compute_all_metrics),
                bootstrap=bool(req.bootstrap),
                n_boot=int(req.n_boot),
                fit_tilt_plane=bool(req.fit_tilt_plane),
            )
        except Exception as exc:
            raise HTTPException(422, f"{type(exc).__name__}: {exc}") from exc
        return _dof_to_dict(res)

    @app.post("/api/dof/stability")
    def dof_stability(req: DoFStabilityRequest):
        """DoF stability curve — scans the same line across multiple
        half-window sizes. Flat curve = the DoF estimate is stable;
        monotonically rising curve = window too small."""
        src = _must_get(req.source_id)
        img = _apply_analysis_isp(_channel_image(src, req.channel), req.isp)
        try:
            curve = compute_dof_stability(
                img, p0=tuple(req.p0), p1=tuple(req.p1),
                metric=req.metric, threshold=float(req.threshold),
                line_step_px=float(req.line_step_px),
                windows=tuple(int(w) for w in req.windows),
            )
        except Exception as exc:
            raise HTTPException(422, f"{type(exc).__name__}: {exc}") from exc
        return JSONResponse({
            "channel": req.channel,
            "p0": list(req.p0), "p1": list(req.p1),
            "metric": req.metric,
            "curve": curve,
        })

    @app.post("/api/dof/analyze")
    def dof_analyze(req: DoFAnalyzeRequest):
        """Multi-channel × multi-line / multi-point DoF analysis.
        Returns:

            channels:   [str, ...]
            results:    {channel: DoFChannelResult-like dict}
            channel_thumbnails: {channel: data-URL PNG}
            figures:    {channel: {<builder>: base64 PNG, ...}}    (optional)
            chromatic_shift_png: base64 single chart across channels
            settings:   {metric, half_window, threshold, calibration, isp, ...}
        """
        src = _must_get(req.source_id)
        chs_requested = req.channels or list(src.channels.keys())
        channel_images = {
            k: _apply_analysis_isp(_channel_image(src, k), req.isp)
            for k in chs_requested if k in src.channels
        }
        if not channel_images:
            raise HTTPException(400, "no valid channels requested")
        points = [DoFPoint(x=p.x, y=p.y, label=p.label) for p in req.points]
        lines = [(l.p0, l.p1) for l in req.lines]
        if not points and not lines:
            raise HTTPException(400, "need at least one point or line")
        try:
            per_ch = analyze_dof_multi(
                channel_images,
                points=points, lines=lines,
                metric=req.metric, half_window=int(req.half_window),
                threshold=float(req.threshold),
                build_heatmap=True, heatmap_step=48,
                calibration=req.calibration,
                compute_all_metrics=bool(req.compute_all_metrics),
                bootstrap=bool(req.bootstrap),
                n_boot=int(req.n_boot),
                fit_tilt_plane=bool(req.fit_tilt_plane),
            )
        except Exception as exc:
            raise HTTPException(422, f"{type(exc).__name__}: {exc}") from exc

        results_json = {r.name: _dof_to_dict(r) for r in per_ch}
        thumbnails: Dict[str, str] = {}
        for name, img in channel_images.items():
            blob = channel_to_png_bytes(img, max_dim=520, colormap="gray")
            thumbnails[name] = "data:image/png;base64," + base64.b64encode(blob).decode()

        figures_json: Dict[str, Dict[str, str]] = {}
        chromatic_b64: Optional[str] = None
        if req.include_pngs:
            for r in per_ch:
                pngs = build_dof_pngs(r, theme=req.theme)
                figures_json[r.name] = {
                    k: base64.b64encode(v).decode() for k, v in pngs.items()
                }
            if len(per_ch) > 1 and any(r.lines for r in per_ch):
                try:
                    chromatic_b64 = base64.b64encode(
                        build_dof_multi_chromatic_png(per_ch, theme=req.theme)
                    ).decode()
                except Exception:
                    chromatic_b64 = None

        resp: Dict[str, Any] = {
            "channels": list(channel_images.keys()),
            "channel_shape": list(next(iter(channel_images.values())).shape[:2]),
            "results": results_json,
            "channel_thumbnails": thumbnails,
            "settings": {
                "metric": req.metric,
                "half_window": int(req.half_window),
                "threshold": float(req.threshold),
                "calibration": req.calibration,
                "compute_all_metrics": bool(req.compute_all_metrics),
                "bootstrap": bool(req.bootstrap),
                "n_boot": int(req.n_boot),
                "fit_tilt_plane": bool(req.fit_tilt_plane),
            },
        }
        # PNG-figure responses are legacy (plot-style-completion-v1 native
        # canvas/SVG rewrite). Kept only when the caller explicitly opts
        # in, so existing CLI users can still ask for offline-ready PNGs.
        if req.include_pngs:
            resp["figures"] = figures_json
            if chromatic_b64:
                resp["chromatic_shift_png"] = chromatic_b64
        return JSONResponse(resp)


# ---------------------------------------------------------------------------
# Static mount — serve the React frontend
# ---------------------------------------------------------------------------

_UNBUILT_PAGE = """<!doctype html>
<html lang=\"en\"><head><meta charset=\"utf-8\">
<title>MantisAnalysis — build the frontend first</title>
<style>
 body {{ font: 15px/1.55 -apple-system, 'Inter Tight', system-ui, sans-serif;
        background: #121212; color: #eee; margin: 0; padding: 4rem 2rem;
        max-width: 44rem; }}
 code {{ background: #1e1e1e; padding: 2px 6px; border-radius: 4px;
        font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
        font-size: 13px; }}
 pre  {{ background: #1e1e1e; padding: 1rem 1.25rem; border-radius: 6px;
        font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace;
        font-size: 13px; overflow-x: auto; }}
 h1 {{ color: #6bcb3a; font-weight: 600; }}
 a  {{ color: #4a9eff; }}
</style></head><body>
<h1>Frontend bundle not built</h1>
<p>FastAPI is running, but <code>{dist}</code> is empty — the Vite
build hasn't been run yet.</p>
<p>Build the SPA from the repo root:</p>
<pre>npm install       # first time only
npm run build     # emits web/dist/</pre>
<p>Then reload this page.</p>
<p>API docs: <a href=\"/api/docs\">/api/docs</a> · health:
<a href=\"/api/health\">/api/health</a></p>
</body></html>"""


def _mount_static(app: FastAPI) -> None:
    """Serve the Vite-built React frontend from ``web/dist/``.

    bundler-migration-v1 Phase 3: the frontend is now ES-module-bundled
    by Vite. ``npm run build`` emits to ``web/dist/``. If the build
    hasn't run yet, ``/`` serves a friendly explainer page instead of
    404ing. ``NO_CACHE`` stays in place — local dev benefits from it,
    and the hashed filenames Vite emits make HTTP caching largely
    redundant anyway.
    """
    if not WEB_DIR.exists():
        return

    NO_CACHE = {"Cache-Control": "no-store, max-age=0",
                "Pragma": "no-cache", "Expires": "0"}

    dist_dir = WEB_DIR / "dist"
    dist_index = dist_dir / "index.html"

    if not dist_index.exists():
        page = _UNBUILT_PAGE.format(dist=str(dist_dir))

        @app.get("/")
        def _unbuilt_root():
            from fastapi.responses import HTMLResponse

            return HTMLResponse(page, headers=NO_CACHE)

        return

    @app.get("/")
    def root():
        return FileResponse(dist_index, headers=NO_CACHE)

    class NoCacheStatic(StaticFiles):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            resp.headers.update(NO_CACHE)
            return resp

    app.mount("/", NoCacheStatic(directory=str(dist_dir), html=True), name="web")


# ---------------------------------------------------------------------------
# Conversion helpers
# ---------------------------------------------------------------------------

def _must_get(source_id: str):
    try:
        return STORE.get(source_id)
    except KeyError:
        # Distinguish evicted (410 Gone) from never-existed (404 Not Found)
        # so the frontend can react specifically: 410 → drop cached id +
        # auto-load sample, 404 → inform user the id was never valid.
        # See R-0009.
        if STORE.was_evicted(source_id):
            raise HTTPException(
                410,
                f"source id {source_id!r} was evicted from the LRU; reload the page "
                "to re-register. See .agent/RISKS.md R-0009.",
            )
        raise HTTPException(404, f"unknown source id: {source_id}")


def _channel_image(src, channel: str, *, apply_dark: bool = True) -> np.ndarray:
    """Return the channel pixel array, optionally with dark-frame subtraction.

    Dark subtraction runs in float64 with a hard ≥ 0 clamp so:
      * no integer-wrap when uint16 dark > uint16 raw
      * no negative DN values poisoning downstream Michelson math

    Pass ``apply_dark=False`` to bypass (rarely needed; analysis paths
    should always work on dark-subtracted data).
    """
    if channel not in src.channels:
        raise HTTPException(404, f"channel {channel!r} not in source {src.source_id}")
    if apply_dark and src.has_dark:
        dark = src.dark_channels.get(channel)
        if dark is not None:
            return subtract_dark(src.channels[channel], dark)
    return src.channels[channel]


def _try_build_rgb_composite_png(src, channel: str, *,
                                 max_dim: int = 1600,
                                 vmin: Optional[float] = None,
                                 vmax: Optional[float] = None,
                                 ) -> Optional[bytes]:
    """Build an RGB composite PNG for sources whose active mode supports it.

    Returns ``None`` when the mode doesn't support composites or when
    the source is missing one of the required R/G/B slots (e.g. mid-
    reconfigure). Callers fall back to the per-channel grayscale path.
    """
    try:
        mode = _isp.get_mode(src.isp_mode_id)
    except KeyError:
        return None
    if not mode.supports_rgb_composite:
        return None
    slot_map = {c.slot_id: c for c in mode.channels}
    if not all(s in slot_map for s in ("r", "g", "b")):
        return None
    names = (src.isp_config or {}).get("channel_name_overrides") or {}
    r_name = _isp.resolved_channel_name(mode, slot_map["r"], names)
    g_name = _isp.resolved_channel_name(mode, slot_map["g"], names)
    b_name = _isp.resolved_channel_name(mode, slot_map["b"], names)
    # Dual-gain: respect the URL's channel prefix (HG-* or LG-*) so the
    # canvas can flip between gains without the caller having to re-call
    # /isp reconfigure. Single-gain: plain names.
    if mode.dual_gain:
        prefix = "HG-"
        if isinstance(channel, str) and channel.startswith("LG-"):
            prefix = "LG-"
        r_key, g_key, b_key = f"{prefix}{r_name}", f"{prefix}{g_name}", f"{prefix}{b_name}"
    else:
        r_key, g_key, b_key = r_name, g_name, b_name
    if not all(k in src.channels for k in (r_key, g_key, b_key)):
        return None
    # Dark-subtracted planes — the composite matches what analysis sees.
    r = _channel_image(src, r_key).astype(np.float32, copy=False)
    g = _channel_image(src, g_key).astype(np.float32, copy=False)
    b = _channel_image(src, b_key).astype(np.float32, copy=False)

    def _norm(a: np.ndarray) -> np.ndarray:
        if vmin is not None and vmax is not None:
            lo, hi = float(vmin), float(vmax)
        else:
            lo = float(np.percentile(a, 1.0))
            hi = float(np.percentile(a, 99.5))
        if hi <= lo:
            hi = lo + 1.0
        return np.clip((a - lo) / (hi - lo), 0.0, 1.0)

    # Per-channel percentile-clip keeps each primary's dynamic range —
    # sensor primaries usually have different native gains, and a shared
    # clip would mute the weakest channel to invisibility.
    stack = np.dstack([_norm(r), _norm(g), _norm(b)])
    u8 = (stack * 255.0).astype(np.uint8)
    from PIL import Image
    im = Image.fromarray(u8, mode="RGB")
    if max(im.size) > max_dim:
        scale = max_dim / float(max(im.size))
        new_size = (int(im.size[0] * scale), int(im.size[1] * scale))
        im = im.resize(new_size, Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def _synthetic_usaf_sample(w: int = 640, h: int = 480) -> Dict[str, np.ndarray]:
    """Build a 10-channel dual-gain GSense-shaped sample with realistic
    USAF-1951 bar groups. The bars have hard high-contrast edges, so the
    ISP sharpen / denoise sliders visibly change the rendered thumbnail.

    Each HG-/LG- channel gets a slightly different per-channel gain,
    orientation offset, and noise realisation so that multi-channel
    analysis looks plausible (different colors have different detection
    limits).
    """
    rng = np.random.default_rng(seed=42)

    def draw_group(canvas: np.ndarray, cx: float, cy: float, bar_px: float,
                   fg: float, bg: float) -> None:
        """Draw a classic USAF element: 3 horizontal bars + 3 vertical bars."""
        bp = max(1.0, float(bar_px))
        gap = bp
        total = 3 * bp + 2 * gap
        # Horizontal bars (probe vertical resolution)
        for i in range(3):
            y = int(round(cy - total / 2 + i * (bp + gap)))
            x0 = int(round(cx - bp * 2.5))
            x1 = int(round(cx + bp * 2.5))
            y0 = y
            y1 = int(round(y + bp))
            if 0 <= y0 < canvas.shape[0] and y1 <= canvas.shape[0]:
                canvas[y0:y1, max(0, x0):min(canvas.shape[1], x1)] = fg
        # Vertical bars (to the right, probe horizontal resolution)
        right_cx = cx + bp * 4.0
        for i in range(3):
            x = int(round(right_cx - total / 2 + i * (bp + gap)))
            y0 = int(round(cy - bp * 2.5))
            y1 = int(round(cy + bp * 2.5))
            x0 = x
            x1 = int(round(x + bp))
            if 0 <= x0 < canvas.shape[1] and x1 <= canvas.shape[1]:
                canvas[max(0, y0):min(canvas.shape[0], y1), x0:x1] = fg

    # Build a grayscale canvas at high DN for the "bright" background,
    # then stamp dark bars (classic negative USAF on a lit frame).
    bg = 45000.0
    fg = 3000.0
    canvas = np.full((h, w), bg, dtype=np.float32)

    # Place six groups (0–5) across the frame, bar widths halving as group grows.
    groups = [
        # (cx, cy, bar_px)
        (70,  60,   18.0),  # G0 E1
        (200, 60,   10.0),  # ~G1 E1
        (330, 60,    6.2),  # ~G2 E1
        (430, 60,    3.8),  # ~G3 E1
        (510, 60,    2.4),  # ~G4 E1
        (580, 60,    1.6),  # ~G5 E1
        (70,  180,  14.0),
        (200, 180,   8.5),
        (330, 180,   5.4),
        (430, 180,   3.4),
        (510, 180,   2.2),
        (580, 180,   1.4),
        (70,  300,  11.5),
        (200, 300,   7.5),
        (330, 300,   4.8),
        (430, 300,   3.0),
        (510, 300,   1.9),
        (580, 300,   1.25),
        (70,  400,   9.5),
        (200, 400,   6.5),
        (330, 400,   4.2),
        (430, 400,   2.6),
        (510, 400,   1.7),
        (580, 400,   1.1),
    ]
    for (cx, cy, bp) in groups:
        draw_group(canvas, cx, cy, bp, fg, bg)

    # Subtle vignette makes it feel like a real frame.
    yy, xx = np.indices((h, w), dtype=np.float32)
    rr = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    canvas *= (1.0 - 0.18 * rr ** 2)

    # Per-channel noise + gain / black-level offsets so channels differ.
    def chan(gain: float, offset: float, noise_amp: float) -> np.ndarray:
        a = canvas * gain + offset
        a += rng.normal(0.0, noise_amp, size=a.shape)
        return np.clip(a, 0, 65535).astype(np.uint16)

    hg = {
        "HG-R": chan(1.00, 0,    140.0),
        "HG-G": chan(1.05, -200, 120.0),
        "HG-B": chan(0.92, 200,  160.0),
        "HG-NIR": chan(1.15, -350, 180.0),
    }
    # HG-Y = Rec.601 luminance over HG-RGB
    hg_y = (0.299 * hg["HG-R"].astype(np.float32)
            + 0.587 * hg["HG-G"].astype(np.float32)
            + 0.114 * hg["HG-B"].astype(np.float32))
    hg["HG-Y"] = np.clip(hg_y, 0, 65535).astype(np.uint16)

    # LG is a downscaled version — less saturation, more noise.
    lg_canvas = canvas / 4.2
    def lg_chan(gain: float, offset: float, noise_amp: float) -> np.ndarray:
        a = lg_canvas * gain + offset
        a += rng.normal(0.0, noise_amp, size=a.shape)
        return np.clip(a, 0, 65535).astype(np.uint16)

    lg = {
        "LG-R": lg_chan(1.00, 0,    40.0),
        "LG-G": lg_chan(1.05, -50,  35.0),
        "LG-B": lg_chan(0.92, 50,   48.0),
        "LG-NIR": lg_chan(1.15, -90, 55.0),
    }
    lg_y = (0.299 * lg["LG-R"].astype(np.float32)
            + 0.587 * lg["LG-G"].astype(np.float32)
            + 0.114 * lg["LG-B"].astype(np.float32))
    lg["LG-Y"] = np.clip(lg_y, 0, 65535).astype(np.uint16)

    return {**hg, **lg}


def _apply_analysis_isp(image: np.ndarray, isp: Optional[ISPParams]) -> np.ndarray:
    """Apply optional ISP stages to the analysis image before measurement.

    Order: black-level subtract → sharpen → gaussian denoise. Returns a new
    float64 array so the raw channel dict is never mutated. Critically, the
    output is clamped to ``[0, ∞)`` after every stage that can produce
    negative DN. Unsharp / Laplacian / High-pass sharpening over-shoots into
    negative values around bright edges; without this clamp, a downstream
    Michelson computation of ``(P90 − P10) / (P90 + P10)`` can exceed 1.0
    (which is mathematically impossible for a real contrast).
    """
    if isp is None:
        return image
    a = image.astype(np.float64, copy=True)
    if isp.black_level:
        a = np.maximum(0.0, a - float(isp.black_level))
    if isp.sharpen_method and isp.sharpen_method not in ("", "None"):
        a = apply_sharpen(a, isp.sharpen_method,
                          amount=float(isp.sharpen_amount),
                          radius=float(isp.sharpen_radius))
        np.maximum(a, 0.0, out=a)  # sharpening over-shoots can go negative
    if isp.denoise_sigma and isp.denoise_sigma > 0.05:
        from scipy.ndimage import gaussian_filter
        a = gaussian_filter(a, sigma=float(isp.denoise_sigma))
        np.maximum(a, 0.0, out=a)
    # FPN / smoothing chain (delegated to fpn_analysis.apply_isp so the
    # canvas thumbnail uses byte-for-byte the same pipeline as the FPN
    # analysis itself — no two-implementations drift).
    if (isp.median_size or isp.gaussian_sigma > 0.05
            or isp.hot_pixel_thr > 0.5 or isp.bilateral):
        from .fpn_analysis import FPNSettings, apply_isp as fpn_apply_isp
        a = fpn_apply_isp(a, FPNSettings(
            median_size=int(isp.median_size),
            gaussian_sigma=float(isp.gaussian_sigma),
            hot_pixel_thr=float(isp.hot_pixel_thr),
            bilateral=bool(isp.bilateral),
        ))
    return a


def _summary(src) -> Dict[str, Any]:
    """Use the canonical summary helper from session.py so all API endpoints
    expose the same fields (channels, shape, dark info, path, ...)."""
    return _summary_dict(src)


def _line_spec(line: LineSpecIn) -> LineSpec:
    return LineSpec(
        group=int(line.group), element=int(line.element),
        direction=line.direction, p0=tuple(line.p0), p1=tuple(line.p1),
    )


def _measure_to_response(m) -> MeasureResponse:
    return MeasureResponse(
        lp_mm=float(m.lp_mm),
        modulation=float(m.modulation),
        modulation_pct=float(m.modulation_pct),
        modulation_minmax=float(m.modulation_minmax),
        modulation_fft=float(m.modulation_fft),
        modulation_5pt=float(m.modulation_5pt),
        profile_min=float(m.profile_min),
        profile_max=float(m.profile_max),
        profile_p10=float(m.profile_p10),
        profile_p90=float(m.profile_p90),
        line_length_px=float(m.line_length_px),
        n_samples=int(m.n_samples),
        samples_per_cycle=float(m.samples_per_cycle),
        reliability=m.reliability,
        profile=[float(v) for v in m.profile.tolist()],
        bar_indices=list(m.bar_indices),
        gap_indices=list(m.gap_indices),
        bar_values=list(m.bar_values),
        gap_values=list(m.gap_values),
        bars_bright=bool(m.bars_bright),
    )


def _fpn_settings(raw: Dict[str, Any]) -> FPNSettings:
    return FPNSettings(
        median_size=int(raw.get("median_size", 0)),
        gaussian_sigma=float(raw.get("gaussian_sigma", 0.0)),
        hot_pixel_thr=float(raw.get("hot_pixel_thr", 0.0)),
        bilateral=bool(raw.get("bilateral", False)),
        lo_pct=float(raw.get("lo_pct", 0.0)),
        hi_pct=float(raw.get("hi_pct", 0.0)),
        drift_order=str(raw.get("drift_order", "none")),
        hot_sigma=float(raw.get("hot_sigma", 4.0)),
    )


def _fpn_to_response(r) -> FPNComputeResponse:
    return FPNComputeResponse(
        name=r.name,
        mean=float(r.mean), mean_signal=float(r.mean_signal),
        std=float(r.std),
        dsnu_dn=float(r.dsnu_dn), prnu_pct=float(r.prnu_pct),
        row_noise_dn=float(r.row_noise_dn), col_noise_dn=float(r.col_noise_dn),
        residual_pixel_noise_dn=float(r.residual_pixel_noise_dn),
        dsnu_row_only_dn=float(r.dsnu_row_only_dn),
        dsnu_col_only_dn=float(r.dsnu_col_only_dn),
        row_peak_freq=float(r.row_peak_freq),
        col_peak_freq=float(r.col_peak_freq),
        row_peak_amp=float(r.row_peak_amp),
        col_peak_amp=float(r.col_peak_amp),
        hot_pixel_count=int(r.hot_pixel_count),
        cold_pixel_count=int(r.cold_pixel_count),
        n_kept=int(r.n_kept), n_total=int(r.n_total),
        minv=float(r.minv), maxv=float(r.maxv),
        p1=float(r.p1), p99=float(r.p99), median=float(r.median),
        drift_order=r.drift_order,
    )


def _float32_grid(arr: np.ndarray, *, max_cells: int = 65_536) -> Dict[str, Any]:
    """Pack a 2-D array as a compact client-consumable descriptor.

    The client renders heatmaps natively on a ``<canvas>`` in real time
    (no server PNGs). For that it needs the numeric grid plus enough
    hints to pick a color-scale range. The array is downsampled by a
    nearest-neighbor stride when it exceeds ``max_cells`` total entries
    so typical ROI heatmaps stay under ~256 KB of base64 payload.

    Returned shape:

        {
          "dims":    [H, W],
          "data":    base64(float32 array, H*W values, row-major),
          "stats":   {"min": ..., "max": ..., "p1": ..., "p99": ..., "mean": ..., "has_nan": bool},
          "stride":  [sy, sx],    # nearest-neighbor downsample applied
        }
    """
    a = np.asarray(arr)
    if a.ndim != 2:
        raise ValueError(f"expected 2-D array, got shape {a.shape}")
    h, w = int(a.shape[0]), int(a.shape[1])
    sy = sx = 1
    if h * w > max_cells:
        # pick strides so H*W / (sy*sx) <= max_cells, keeping aspect ratio.
        ratio = (h * w) / float(max_cells)
        k = int(np.ceil(np.sqrt(ratio)))
        sy = sx = max(1, k)
        a = a[::sy, ::sx]
    af = np.ascontiguousarray(a, dtype=np.float32)
    finite = af[np.isfinite(af)]
    if finite.size == 0:
        stats = {"min": 0.0, "max": 1.0, "p1": 0.0, "p99": 1.0,
                 "mean": 0.0, "has_nan": True}
    else:
        stats = {
            "min": float(finite.min()),
            "max": float(finite.max()),
            "p1":  float(np.percentile(finite, 1)),
            "p99": float(np.percentile(finite, 99)),
            "mean": float(finite.mean()),
            "has_nan": bool(af.size != finite.size),
        }
    return {
        "dims": [int(af.shape[0]), int(af.shape[1])],
        "data": base64.b64encode(af.tobytes()).decode("ascii"),
        "stats": stats,
        "stride": [sy, sx],
    }


def _fpn_full_dict(r) -> Dict[str, Any]:
    """FPN result as a JSON-serializable dict, including the 1-D profile
    arrays + hot/cold pixel lists + 2-D grids the frontend needs for the
    native canvas heatmaps. 2-D grids are base64-float32 with a nearest-
    neighbor downsample above 64 k cells so payloads stay bounded.
    """
    base = _fpn_to_response(r).model_dump()
    base["roi"] = list(r.roi)
    base["row_means"] = _finite_list(r.row_means)
    base["col_means"] = _finite_list(r.col_means)
    base["row_stds"] = _finite_list(r.row_stds)
    base["col_stds"] = _finite_list(r.col_stds)
    base["row_freq"] = [float(x) for x in r.row_freq.tolist()]
    base["col_freq"] = [float(x) for x in r.col_freq.tolist()]
    base["row_psd"] = [float(x) for x in r.row_psd.tolist()]
    base["col_psd"] = [float(x) for x in r.col_psd.tolist()]
    base["top_hot"] = [
        {"y": int(y), "x": int(x), "value": float(v), "z": float(z)}
        for (y, x, v, z) in r.top_hot
    ]
    base["top_cold"] = [
        {"y": int(y), "x": int(x), "value": float(v), "z": float(z)}
        for (y, x, v, z) in r.top_cold
    ]
    # Pixel-value histogram (256 bins). Sent as parallel arrays so the
    # frontend can render a bar chart without a follow-up round-trip.
    base["hist_bin_edges"] = [float(x) for x in r.hist_bin_edges.tolist()]
    base["hist_counts"]    = [int(c) for c in r.hist_counts.tolist()]
    # 2-D grids for native canvas rendering (no server PNGs).
    base["image_grid"]    = _float32_grid(r.image)
    base["fpn_map_grid"]  = _float32_grid(r.fpn_map)
    base["psd_log_grid"]  = _float32_grid(r.psd_log)
    base["autocorr_grid"] = _float32_grid(r.autocorr_2d)
    base["kept_mask_dims"] = [int(r.mask_kept.shape[0]), int(r.mask_kept.shape[1])]
    # Pack the bool kept-mask the same way (as uint8 0/1) so the native
    # hotpix / fpn-map renderers can dim excluded pixels.
    km = np.ascontiguousarray(r.mask_kept.astype(np.uint8))
    base["kept_mask_b64"] = base64.b64encode(km.tobytes()).decode("ascii")
    base["settings"] = {
        "median_size": int(r.settings.median_size),
        "gaussian_sigma": float(r.settings.gaussian_sigma),
        "hot_pixel_thr": float(r.settings.hot_pixel_thr),
        "bilateral": bool(r.settings.bilateral),
        "lo_pct": float(r.settings.lo_pct),
        "hi_pct": float(r.settings.hi_pct),
        "drift_order": r.settings.drift_order,
        "hot_sigma": float(r.settings.hot_sigma),
    }
    return base


def _finite_list(arr: np.ndarray) -> List[Optional[float]]:
    """Serialize a 1-D float array to JSON, turning NaNs into None so
    `json.dumps` doesn't emit bare `NaN` (which isn't strict JSON)."""
    out: List[Optional[float]] = []
    for v in arr.tolist():
        out.append(None if not np.isfinite(v) else float(v))
    return out


def _dof_to_dict(r) -> Dict[str, Any]:
    """Serialize DoFChannelResult to a JSON-safe dict. Extends the
    original shape (kept as-is for back-compat) with the dof-rewrite-v1
    fields: per-line ``gaussian`` fit, ``peak_ci95_px`` /
    ``dof_width_ci95_px`` bootstrap CIs, ``metric_sweep`` across the
    four focus metrics, per-point ``focus_all`` dict, and a top-level
    ``tilt_plane`` entry when the bilinear plane fit ran.
    """
    heatmap_grid = _float32_grid(r.heatmap) if r.heatmap is not None else None
    image_grid = _float32_grid(r.image) if r.image is not None else None
    return {
        "name": r.name,
        "metric": r.metric,
        "half_window": int(r.half_window),
        "threshold": float(r.threshold),
        "is_calibrated": bool(r.is_calibrated),
        "unit_name": r.unit_name,
        "px_per_unit_h": r.px_per_unit_h,
        "px_per_unit_v": r.px_per_unit_v,
        "tilt_plane": r.tilt_plane,
        "heatmap_step": int(r.heatmap_step),
        "heatmap_grid": heatmap_grid,
        "image_grid": image_grid,
        "points": [
            {
                "x": float(p.point.x),
                "y": float(p.point.y),
                "label": p.point.label,
                "focus": float(p.focus),
                "focus_norm": float(p.focus_norm),
                "focus_all": (p.focus_all if p.focus_all is not None else None),
            }
            for p in r.points
        ],
        "lines": [
            {
                "p0": list(ln.p0),
                "p1": list(ln.p1),
                "positions_px": [float(x) for x in ln.positions.tolist()],
                "focus": [float(x) for x in ln.focus.tolist()],
                "focus_norm": [float(x) for x in ln.focus_norm.tolist()],
                "peak_idx": int(ln.peak_idx),
                "peak_position_px": float(ln.peak_position_px),
                "dof_low_px": ln.dof_low_px,
                "dof_high_px": ln.dof_high_px,
                "dof_width_px": ln.dof_width_px,
                "px_per_unit": ln.px_per_unit,
                "unit_name": ln.unit_name,
                "peak_position_unit": ln.peak_position_unit,
                "dof_low_unit": ln.dof_low_unit,
                "dof_high_unit": ln.dof_high_unit,
                "dof_width_unit": ln.dof_width_unit,
                "gaussian": _dof_gaussian_to_dict(ln.gaussian),
                "peak_ci95_px": (list(ln.peak_ci95_px)
                                 if ln.peak_ci95_px is not None else None),
                "dof_width_ci95_px": (list(ln.dof_width_ci95_px)
                                      if ln.dof_width_ci95_px is not None
                                      else None),
                "metric_sweep": ln.metric_sweep,
            }
            for ln in r.lines
        ],
    }


def _dof_gaussian_to_dict(g) -> Dict[str, Any]:
    """Serialize GaussianFit with NaN → None (strict JSON)."""
    def _ok(v):
        return None if not isinstance(v, (int, float)) or not np.isfinite(v) \
                    else float(v)
    return {
        "converged": bool(g.converged),
        "amp": _ok(g.amp),
        "mu": _ok(g.mu),
        "sigma": _ok(g.sigma),
        "baseline": _ok(g.baseline),
        "fwhm": _ok(g.fwhm),
        "r_squared": _ok(g.r_squared),
    }


# Module-level app for `uvicorn mantisanalysis.server:app`.
app = create_app()
