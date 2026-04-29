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
import sys
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import math
import numpy as np
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator

# Whitelist of disk extensions the server is willing to bind a source
# to (via `/api/sources/{sid}/attach-path`) or delete (via
# `/api/sources/delete-files`). Refusing other extensions blocks the
# obvious abuse path of pointing the destructive routes at unrelated
# files (config, keys, source). Keep in sync with the formats accepted
# by `image_io.load_any_detail` + `legacy_h5.is_legacy_gsbsi_h5`.
_ALLOWED_DISK_EXTS = {".h5", ".hdf5", ".tif", ".tiff", ".png", ".jpg", ".jpeg"}
# Hard cap on `delete-files` batch size so a malformed body can't ask
# the server to enumerate STORE for thousands of paths.
_DELETE_FILES_MAX_BATCH = 50

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
from .session import (
    STORE,
    _summary_dict,
    channel_histogram,
    channel_to_png_bytes,
    subtract_dark,
)
from .labels import render_labels
from .rgb_grading import apply_grading, auto_white_balance
from .usaf_groups import LineSpec, detection_limit_lp_mm, measure_line
from .export_jobs import JOBS as _JOBS, ExportJob


# ---------------------------------------------------------------------------
# Pydantic request / response schemas
# ---------------------------------------------------------------------------

class SourceSummary(BaseModel):
    source_id: str
    name: str
    kind: str
    channels: List[str]
    shape: List[int]
    # Raw mosaic dimensions before channel-split (FilePill "raw file
    # resolution"). For modern MantisCam this is the full
    # ``camera/frames`` H × W (typically 2048 × 4096); for legacy gsbsi
    # it's 2048 × 1024; for image sources it matches ``shape``.
    raw_shape: List[int] = Field(default_factory=list)
    # "uint16" for sensor recordings, "uint8" for 8-bit images, etc.
    raw_dtype: str = "uint16"
    # Sensor bit depth: 12 for legacy gsbsi, 16 for modern MantisCam,
    # 8 for uint8 images. Surfaced so the user can see whether their
    # highlights are clipping at 4095 or 65535 instead of guessing.
    raw_bit_depth: int = 16
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
    # play-tab-recording-inspection-rescue-v1 M1: per-frame metadata so
    # the Play tab can show frame_count without an extra round-trip.
    # ``frame_count`` is 1 for image sources, ≥1 for H5.
    frame_count: int = 1
    # M16: per-source warnings collected at load time. Each entry is
    # ``{code: "W-…", severity: "info|warning|error", detail: "..."}``.
    # Frontend chips them on the FilePill and aggregates into Warning
    # Center.
    warnings: List[Dict[str, str]] = Field(default_factory=list)


class FrameMetadata(BaseModel):
    """Per-frame metadata for one H5 source (Play mode).

    Sized for the typical MantisCam recording (≤ a few thousand frames).
    For image sources the response carries a single-frame stub.
    play-tab-recording-inspection-rescue-v1 M1.
    """
    source_id: str
    frame_count: int
    exposures_s: List[float]    # length == frame_count; 0.0 when unknown
    timestamps: List[float]     # length == frame_count; Unix epoch seconds, 0.0 when unknown
    duration_s: float           # last_ts - first_ts (0.0 for single-frame)
    fps_estimate: float         # frame_count / duration_s, or 0.0 if not derivable


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
    model_config = ConfigDict(extra="forbid")
    path: str
    name: Optional[str] = None


class LoadFromPathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str
    name: Optional[str] = None


class LocateFileRequest(BaseModel):
    """Body for ``/api/files/locate``. Both ``name`` and ``size`` are
    REQUIRED — a name-only match would let the locator return
    coincidentally-same-named files in ``~/Documents`` etc., which
    the upload flow would then bind via ``attach-path`` and the
    bulk-delete flow would unlink. Requiring byte-size match makes
    the collision rate effectively zero for binary recordings.
    """
    model_config = ConfigDict(extra="forbid")
    name: str
    size: int = Field(ge=0)
    roots: Optional[List[str]] = None  # extra search roots beyond the defaults
    max_depth: int = 6


class ManualUSAFPointsIn(BaseModel):
    """Manual 5-point extrema for one channel/profile.

    Indices are sample positions in the extracted 1-D USAF profile. They are
    channel-local: a correction made on LG-R should not be reused for LG-G.
    """
    model_config = ConfigDict(extra="forbid")
    bar_indices: List[int] = Field(min_length=3, max_length=3)
    gap_indices: List[int] = Field(min_length=2, max_length=2)


class LineSpecIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    group: int
    element: int
    direction: str                        # "H" or "V"
    p0: Tuple[float, float]
    p1: Tuple[float, float]
    manual_points_by_channel: Dict[str, ManualUSAFPointsIn] = Field(default_factory=dict)


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


class TiledExportViewSpec(BaseModel):
    """One view's render spec for the tiled-image export.

    play-tab-recording-inspection-rescue-v1 M23. Mirrors the per-frame
    thumbnail / rgb route's query params, packed as a Pydantic model
    so the frontend can POST a JSON list. Defaults match the
    individual route defaults so omitting fields renders the standard
    look.
    """
    source_id: str
    frame_index: int = 0
    render: str = "rgb_composite"          # "rgb_composite" | "channel" | "overlay"
    # rgb_composite + overlay (base) selectors
    gain: str = "hg"                       # "hg" | "lg" | "hdr" (M25)
    # channel-only fields
    channel: Optional[str] = None
    colormap: str = "gray"
    invert: bool = False
    show_clipping: bool = False
    # Threshold / ISP linear chain (M20.1)
    vmin: Optional[float] = None
    vmax: Optional[float] = None
    normalize: str = "none"
    black_level: float = 0.0
    isp_gain: float = 1.0
    offset: float = 0.0
    isp_brightness: float = 0.0
    isp_contrast: float = 1.0
    isp_gamma: float = 1.0
    apply_dark: bool = True
    # Overlay-specific
    base_kind: str = "rgb_composite"
    base_channel: Optional[str] = None
    overlay_channel: Optional[str] = None
    overlay_low: Optional[float] = None
    overlay_high: Optional[float] = None
    overlay_colormap: str = "inferno"
    blend: str = "alpha"
    strength: float = 0.65
    # M22 RGB grading
    grading_gain_r: float = 1.0
    grading_gain_g: float = 1.0
    grading_gain_b: float = 1.0
    grading_offset_r: float = 0.0
    grading_offset_g: float = 0.0
    grading_offset_b: float = 0.0
    grading_gamma: float = 1.0
    grading_brightness: float = 0.0
    grading_contrast: float = 1.0
    grading_saturation: float = 1.0
    grading_wb_kelvin: Optional[float] = None
    # M21 burn-in labels
    label_timestamp: bool = False
    label_frame: bool = False
    label_channel: bool = False
    label_source: bool = False
    label_scale_bar: bool = False
    label_position: str = "bottom-left"
    label_font_size: int = 12
    # M26 — non-linear sharpen / FPN chain (mirrors per-frame route).
    sharpen_method: Optional[str] = None
    sharpen_amount: float = 1.0
    sharpen_radius: float = 2.0
    denoise_sigma: float = 0.0
    median_size: int = 0
    gaussian_sigma: float = 0.0
    hot_pixel_thr: float = 0.0
    bilateral: bool = False
    # Optional polygon ROI (image-pixel coords). When the per-tile
    # render is render='overlay' and the polygon has ≥ 3 vertices, the
    # colormapped overlay is composited only inside the polygon — base
    # RGB shows through everywhere else. Mirrors mask_polygon on the
    # per-frame /overlay.png route so exports honor WYSIWYG.
    mask_polygon: Optional[List[List[float]]] = None
    # Display-only
    title: Optional[str] = None            # caption above this tile (UI label)


class TiledExportRequest(BaseModel):
    """Body for ``POST /api/sources/export/image-tiled``.

    play-tab-recording-inspection-rescue-v1 M23.
    """
    model_config = ConfigDict(extra="forbid")
    views: List[TiledExportViewSpec]
    layout: str = "auto"                   # "1xN" | "2xM" | "3plus1" | "4x2" | "auto"
    gap_px: int = 6
    background: str = "#000000"            # hex CSS color for inter-tile + outer padding
    max_dim: int = 1280                    # per-tile max (longest side); composited canvas inherits
    format: str = "png"                    # "png" | "tiff" | "jpeg"


class TiledExportVideoRequest(BaseModel):
    """Body for ``POST /api/sources/export/video-tiled``.

    play-tab-recording-inspection-rescue-v1 M24. Each view's
    ``frame_index`` is the *anchor* for the first output frame; the
    route advances frames in lock-step (clamped to each source's
    own frame_count so streams of differing lengths don't overshoot).
    """
    model_config = ConfigDict(extra="forbid")
    views: List[TiledExportViewSpec]
    layout: str = "auto"
    gap_px: int = 6
    background: str = "#000000"
    max_dim: int = 1024
    fps: float = 10.0
    start: int = 0                         # global anchor for first output frame
    end: Optional[int] = None              # inclusive global anchor for last output frame
    format: str = "mp4"                    # "mp4" | "gif" | "zip"


class MultiSourceVideoRequest(BaseModel):
    """Body for ``POST /api/play/exports`` — one MP4 stitched across
    every supplied source in cascade order. Each source contributes its
    own [start, end] frame range using its own per-source ISP / overlay
    settings; the runner concatenates them into a single MP4.

    play-export-and-roi-fixes-v1 M4 (Bugs 5 + 6). Job-based: the route
    returns immediately with a job_id; the client polls
    ``/api/play/exports/{id}`` for progress and fetches
    ``/api/play/exports/{id}/result`` when status = "done".
    """
    model_config = ConfigDict(extra="forbid")

    class SourceSpec(BaseModel):
        model_config = ConfigDict(extra="forbid")
        source_id: str
        start: int = Field(0, ge=0)
        end: Optional[int] = Field(None, ge=0)  # inclusive; defaults to last frame
        # Render mode + parameters mirror the single-source GET route
        # so the runner can reuse the same render_frame closure.
        render: Literal["rgb_composite", "channel", "overlay"] = "rgb_composite"
        gain: Literal["hg", "lg", "HG", "LG"] = "hg"
        channel: Optional[str] = None
        colormap: str = "gray"
        vmin: Optional[float] = None
        vmax: Optional[float] = None
        apply_dark: bool = True
        # Linear ISP
        black_level: float = 0.0
        isp_gain: float = Field(1.0, ge=0.0, le=64.0)
        isp_offset: float = 0.0
        # Non-linear ISP chain. ``sharpen_method`` is constrained to
        # the set ``apply_sharpen`` accepts so a typo 422s at the API
        # edge instead of 500-ing inside the runner thread.
        sharpen_method: Optional[Literal["Unsharp mask", "Laplacian", "High-pass"]] = None
        sharpen_amount: float = Field(1.0, ge=0.0, le=8.0)
        sharpen_radius: float = Field(2.0, ge=0.5, le=10.0)
        denoise_sigma: float = Field(0.0, ge=0.0, le=6.0)
        median_size: int = Field(0, ge=0, le=15)
        gaussian_sigma: float = Field(0.0, ge=0.0, le=20.0)
        hot_pixel_thr: float = Field(0.0, ge=0.0, le=50.0)
        bilateral: bool = False
        # Overlay-specific
        base_channel: Optional[str] = None
        overlay_channel: Optional[str] = None
        overlay_low: Optional[float] = None
        overlay_high: Optional[float] = None
        blend: Literal["alpha", "screen", "additive"] = "alpha"
        strength: float = Field(0.65, ge=0.0, le=1.0)
        overlay_colormap: str = "inferno"
        mask_polygon: Optional[List[List[float]]] = None

    sources: List[SourceSpec]
    fps: float = Field(10.0, ge=0.1, le=120.0)
    max_dim: int = Field(4096, ge=64, le=8192)
    crf: int = Field(18, ge=0, le=51)
    preset: Literal[
        "ultrafast", "superfast", "veryfast", "faster",
        "fast", "medium", "slow", "slower", "veryslow",
    ] = "slow"
    format: Literal["mp4"] = "mp4"  # currently mp4-only on the multi-source path


class PlaybackPreset(BaseModel):
    """One persisted Inspector preset.

    play-tab-recording-inspection-rescue-v1 M28. ``view_type`` is the
    SOURCE_MODES id (e.g. ``rgb_hg`` / ``nir_hg`` / ``gray_hgy``); the
    Inspector filters the Load dropdown to presets matching the active
    view's ``view_type``. ``fields`` is an opaque JSON dict containing
    the snapshot of view-state fields the user chose to save (colormap,
    vmin, vmax, normalize, blackLevel, gain, offset, gamma, isp,
    grading, labels, ...). Frontend owns the schema; backend just
    round-trips it.
    """
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    view_type: str
    fields: Dict[str, Any] = Field(default_factory=dict)
    created_at: float = 0.0  # epoch seconds; 0 means "unknown"


class PlaybackPresetsBody(BaseModel):
    """PUT body for replacing the whole presets list. Atomic: backend
    writes to a tmp file then renames over the canonical path."""
    model_config = ConfigDict(extra="forbid")
    presets: List[PlaybackPreset]


class PlaybackHandoffRequest(BaseModel):
    """POST body for the right-click frame → Send to USAF/FPN/DoF flow.

    play-tab-recording-inspection-rescue-v1 M30. ``target_mode`` is
    informational for the backend (the frontend dispatches the actual
    mode switch via a window event); the backend just creates the
    transient source. Frame index is clamped to the parent's
    ``frame_count`` server-side.
    """
    model_config = ConfigDict(extra="forbid")
    source_id: str
    frame_index: int = 0
    target_mode: str = "usaf"  # "usaf" | "fpn" | "dof"


class DeleteFilesRequest(BaseModel):
    """POST body for the Sources-panel multi-select "Delete from disk"
    flow. Each entry is an absolute filesystem path. The backend:

      1. Drops any loaded source whose ``path`` resolves to the given
         path (closes the FrameReader handle so the file isn't held
         open under Windows-style locks).
      2. ``Path.unlink()`` the file. Symlinks are NOT followed — the
         link itself is removed, never the target.
      3. Returns a per-path status so the frontend can chip successes
         and surface partial failures.

    The frontend MUST present a confirmation dialog listing the paths
    before calling this route — the route itself does no second-guess
    confirmation. Restricted to regular files; refuses directories.

    Defence-in-depth: the route additionally requires every path to
    correspond to a path tracked by a registered ``LoadedSource``
    (either ``src.path`` or ``src._owned_tempfile``). The frontend's
    bulk-delete flow operates on the FilePill set so this is invisible
    in normal use, but it blocks the pathological "attacker controls
    a single body" case from unlinking arbitrary files.

    B-0042: ``use_trash`` (default True) routes the destructive step
    through ``send2trash`` so deletes land in the user's Trash /
    Recycle Bin instead of permanently unlinking. Falls back to
    ``Path.unlink()`` if send2trash is missing or fails (logged in
    the per-row ``trash_error`` field).
    """
    model_config = ConfigDict(extra="forbid")
    paths: List[str] = Field(min_length=0, max_length=_DELETE_FILES_MAX_BATCH)
    use_trash: bool = True


class ROIStatsViewConfig(BaseModel):
    """Optional ISP/grading state attached to an ROI-stats request.

    Mirrors the canvas thumbnail's linear chain (sharpen + denoise +
    FPN, then black_level + gain + offset) so the TBR ratio reflects
    what the user sees.
    """
    model_config = ConfigDict(extra="forbid")
    gain: float = 1.0
    offset: float = 0.0
    sharpen_method: Optional[str] = None
    sharpen_amount: float = 1.0
    sharpen_radius: float = 2.0
    denoise_sigma: float = 0.0
    median_size: int = 0
    gaussian_sigma: float = 0.0
    hot_pixel_thr: float = 0.0
    bilateral: bool = False


class ROIStatsRequest(BaseModel):
    """POST body for the per-frame channel ROI-stats route.

    Polygon vertices are validated to be finite (rejects NaN/Inf so
    the rasterizer never sees garbage), the list size is bounded
    (3–2000 vertices), and unknown body fields are rejected.
    play-tab-recording-inspection-rescue-v1 polish-sweep hardening.
    """
    model_config = ConfigDict(extra="forbid")
    polygon: List[Tuple[float, float]] = Field(min_length=3, max_length=2000)
    method: str = Field("mean", pattern=r"^(mean|percentile|mode)$")
    percentile: float = Field(50.0, ge=0.0, le=100.0)
    apply_dark: bool = True
    black_level: float = 0.0
    view_config: Optional[ROIStatsViewConfig] = None
    # B-0040 — HDR fusion override (honored when the requested channel
    # is HDR-*). Defaults to "switch" so existing TBR entries match
    # the cached extraction byte-for-byte.
    hdr_fusion: str = Field("switch", pattern=r"^(switch|mertens)$")

    @field_validator("polygon")
    @classmethod
    def _finite_polygon(cls, v: List[Tuple[float, float]]) -> List[Tuple[float, float]]:
        for i, p in enumerate(v):
            x, y = p
            if not (math.isfinite(x) and math.isfinite(y)):
                raise ValueError(f"polygon vertex {i} contains non-finite value")
        return v


class AttachPathRequest(BaseModel):
    """POST body for ``/api/sources/{source_id}/attach-path``.

    Binds an absolute disk path to an already-loaded upload source so
    the DELETE flow can unlink the user's original file rather than
    just the upload tempfile. The route enforces three guards:

      1. The candidate path must have an extension in
         ``_ALLOWED_DISK_EXTS`` (no binding ``/etc/passwd`` etc.).
      2. The candidate's basename must equal the source's
         ``upload_basename`` captured at upload time.
      3. The candidate's byte-size must equal the source's
         ``upload_size``.

    All three values come from server-trusted state (UploadFile
    metadata + filesystem ``stat()``), not from the request body, so an
    attacker who controls only the body cannot forge a match. The body
    carries only the discovered path.
    """
    model_config = ConfigDict(extra="forbid")
    path: str


class MeasureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
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
    model_config = ConfigDict(extra="forbid")
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
    model_config = ConfigDict(extra="forbid")
    source_id: str
    channels: Optional[List[str]] = None  # None = all
    lines: List[LineSpecIn]
    threshold: float = 0.2
    theme: str = "light"
    transform: Dict[str, Any] = Field(default_factory=dict)
    isp: Optional[ISPParams] = None


class FPNComputeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
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
    model_config = ConfigDict(extra="forbid")
    source_id: str
    channel: str
    roi: Tuple[int, int, int, int]
    n_shrinks: int = 5
    settings: Dict[str, Any] = Field(default_factory=dict)


class FPNAnalyzeRequest(BaseModel):
    """Full multi-channel FPN analysis, mirrors USAF's analyze shape.
    One or more channels, one or more ROIs; response is a rich JSON
    dataset plus base64 PNGs for offline export."""
    model_config = ConfigDict(extra="forbid")
    source_id: str
    channels: Optional[List[str]] = None   # default = all
    rois: List[Tuple[int, int, int, int]]
    settings: Dict[str, Any] = Field(default_factory=dict)
    theme: str = "light"
    include_pngs: bool = True              # off → faster, JSON-only


class DoFPointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float
    y: float
    label: str = ""


class DoFLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    p0: Tuple[float, float]
    p1: Tuple[float, float]


class DoFComputeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
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
    model_config = ConfigDict(extra="forbid")
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
    model_config = ConfigDict(extra="forbid")
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
    _mount_static(app)

    # Shutdown hook — drain the export-job executor on app teardown so
    # uvicorn --reload (or a Ctrl-C in the dev runner) doesn't leak the
    # worker thread. fastapi-backend-reviewer P1.
    @app.on_event("shutdown")
    def _shutdown_export_jobs() -> None:
        try:
            _JOBS.shutdown()
        except Exception:
            pass

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

    @app.post("/api/files/locate")
    def files_locate(req: LocateFileRequest) -> Dict[str, Any]:
        """Find a file on the local filesystem by name (and optionally size).

        Used by Play to recover the user's ORIGINAL on-disk path after an
        upload — browsers don't expose file paths from
        ``<input type='file'>`` for security, but since this server runs
        locally as the same user, we can scan their HOME for a matching
        file and surface the path so the delete flow can unlink the
        actual file (not just the upload tempfile).

        Search roots: HOME, HOME/Desktop, HOME/Downloads, HOME/Documents,
        plus any extra roots the caller passes. Hard depth cap so we
        don't walk node_modules / Library / etc. for hours.
        """
        from os.path import expanduser
        home = Path(expanduser("~"))
        default_roots = [
            home / "Desktop",
            home / "Downloads",
            home / "Documents",
        ]
        extra_roots = []
        for r in (req.roots or []):
            try:
                p = Path(r).expanduser().resolve()
                if p.is_dir():
                    extra_roots.append(p)
            except Exception:
                continue
        roots = [r for r in (default_roots + extra_roots) if r.exists() and r.is_dir()]
        # Skip these heavy / system dirs to keep the scan fast.
        SKIP_NAMES = {
            "node_modules", ".git", ".cache", ".npm", ".Trash", "Library",
            ".venv", "venv", "__pycache__", ".idea", ".vscode",
        }
        target_name = req.name
        target_size = req.size
        max_depth = max(1, min(12, int(req.max_depth or 6)))
        matches: List[Dict[str, Any]] = []
        def _walk(root: Path, depth_left: int) -> None:
            try:
                with __import__("os").scandir(root) as entries:
                    for ent in entries:
                        if ent.name.startswith("."):
                            continue
                        if ent.name in SKIP_NAMES:
                            continue
                        try:
                            if ent.is_file(follow_symlinks=False):
                                if ent.name == target_name:
                                    try:
                                        st = ent.stat(follow_symlinks=False)
                                        # Size is mandatory in the
                                        # request now; only matching
                                        # files of identical byte-size
                                        # qualify so name-collision
                                        # in ~/Documents can't return
                                        # the wrong file.
                                        if st.st_size == target_size:
                                            matches.append({
                                                "path": str(Path(ent.path).resolve()),
                                                "size": st.st_size,
                                                "mtime": st.st_mtime,
                                            })
                                    except OSError:
                                        continue
                            elif ent.is_dir(follow_symlinks=False) and depth_left > 1:
                                _walk(Path(ent.path), depth_left - 1)
                        except OSError:
                            continue
            except (PermissionError, OSError):
                return
        for root in roots:
            _walk(root, max_depth)
            if matches:
                break  # Stop scanning lower-priority roots once we've found a match.
        # Most-recently-modified first so the user's likely-active copy
        # ranks above older duplicates.
        matches.sort(key=lambda m: m.get("mtime", 0), reverse=True)
        return {"matches": matches[:8]}

    @app.post("/api/sources/{source_id}/attach-path")
    def attach_disk_path(source_id: str, body: AttachPathRequest):
        """Bind an absolute disk path to an already-loaded source so the
        DELETE route can unlink that path (not just the upload tempfile).

        Used after `/api/files/locate` finds the user's original file
        post-upload. Idempotent — re-attaching with the same path is a
        no-op. The candidate must match the source's
        ``upload_basename`` + ``upload_size`` captured at upload time;
        without those guards the route would let any caller bind any
        readable file (e.g. ~/.ssh/id_ed25519) so the destructive
        DELETE flow could unlink it.
        """
        candidate = Path(body.path).expanduser().resolve()
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(404, f"no such file: {candidate}")
        if candidate.suffix.lower() not in _ALLOWED_DISK_EXTS:
            raise HTTPException(
                400,
                f"refusing to attach extension {candidate.suffix!r}; "
                f"allowed: {sorted(_ALLOWED_DISK_EXTS)}",
            )
        with STORE._lock:
            src = STORE._items.get(source_id)
            if src is None:
                raise HTTPException(404, "unknown source")
            if src.upload_basename is None or src.upload_size is None:
                raise HTTPException(
                    400,
                    "source has no upload metadata; attach-path is only "
                    "valid post-upload (load_from_path sources already "
                    "carry an authoritative path).",
                )
            if candidate.name != src.upload_basename:
                raise HTTPException(
                    400,
                    f"basename mismatch: candidate {candidate.name!r} != "
                    f"upload {src.upload_basename!r}",
                )
            try:
                actual_size = candidate.stat().st_size
            except OSError as exc:
                raise HTTPException(
                    500, f"stat failed: {type(exc).__name__}: {exc}"
                ) from exc
            if actual_size != src.upload_size:
                raise HTTPException(
                    400,
                    f"size mismatch: candidate {actual_size} bytes != "
                    f"upload {src.upload_size} bytes",
                )
            src.path = str(candidate)
        return {"ok": True, "path": str(candidate)}

    @app.get("/api/system/info")
    def system_info() -> Dict[str, Any]:
        """Report host capabilities the frontend can't reach itself.

        ``navigator.deviceMemory`` is bucketed AND capped at 8 GB on
        Chromium/Safari/macOS, so it's useless for sizing the Play
        frame-cache budget on a 16/32/64 GB workstation. Use this route
        to feed the real number into the Inspector → Advanced cap.
        """
        total_ram_bytes: Optional[int] = None
        # Prefer psutil when available (cross-platform).
        try:
            import psutil  # type: ignore
            total_ram_bytes = int(psutil.virtual_memory().total)
        except Exception:
            # macOS-native fallback via sysctl.
            try:
                import subprocess
                out = subprocess.check_output(
                    ["sysctl", "-n", "hw.memsize"], text=True, stderr=subprocess.DEVNULL
                ).strip()
                total_ram_bytes = int(out)
            except Exception:
                total_ram_bytes = None
        # Final fallback to /proc/meminfo on Linux. Force UTF-8 with
        # replace-on-error so a non-UTF-8 locale on a hardened host
        # can't UnicodeDecodeError → 500 the route.
        if total_ram_bytes is None:
            try:
                with open("/proc/meminfo", "r", encoding="utf-8", errors="replace") as f:
                    for line in f:
                        if line.startswith("MemTotal:"):
                            kb = int(line.split()[1])
                            total_ram_bytes = kb * 1024
                            break
            except Exception:
                pass
        return {
            "platform": sys.platform,
            "total_ram_bytes": total_ram_bytes,
            "total_ram_mb": (total_ram_bytes // (1024 * 1024)) if total_ram_bytes else None,
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
        # Cache a Bayer-mosaic raw_frame so reconfigure_isp can re-extract
        # via the same path real recordings use. Without this, hitting
        # Apply in the ISP Settings dialog produced a 400 ("source has no
        # cached raw frame") because the synthetic source's channels were
        # generated directly without ever round-tripping through
        # extract_with_mode.
        raw_frame = _synthetic_usaf_raw_mosaic(channels)

        import uuid

        from .session import LoadedSource
        rgb_nir_mode = _isp.get_mode(_isp.RGB_NIR.id)
        rgb_nir_cfg = _isp.normalize_config(rgb_nir_mode, None)
        src = LoadedSource(
            source_id=uuid.uuid4().hex[:12],
            name="sample (synthetic USAF target)",
            source_kind="synthetic",
            channels=channels,
            attrs={"note": "procedural USAF target with bar groups 0-5"},
            shape_hw=shape,
            raw_shape=(int(raw_frame.shape[0]), int(raw_frame.shape[1])),
            raw_dtype=str(raw_frame.dtype),
            raw_bit_depth=16,
            raw_frame=raw_frame,
            isp_mode_id=rgb_nir_mode.id,
            isp_config=rgb_nir_cfg,
        )
        with STORE._lock:
            STORE._items[src.source_id] = src
            STORE._evict_locked()
        return _summary(src)

    @app.delete("/api/sources/{source_id}")
    def delete_source(source_id: str, delete_disk_file: bool = Query(False)):
        """Drop the source from STORE and (when ``delete_disk_file`` is set)
        unlink any on-disk artifact tied to it.

        On-disk artifact resolution:
            * If the source was loaded by path (``src.path`` is set), that
              user-chosen file is unlinked.
            * If the source is an upload (``src.path`` is None but the
              backend owns a tempfile via ``_owned_tempfile``), that
              tempfile is unlinked. Either way the user gets disk-level
              cleanup, never just a session drop.

        Response carries the deleted-from path so the frontend can show
        the user exactly what was removed.
        """
        with STORE._lock:
            src = STORE._items.get(source_id)
            if src is None:
                raise HTTPException(404, "unknown source")
            disk_target: Optional[Path] = (
                src.resolve_disk_target() if delete_disk_file else None
            )
        # close_frame_reader (called inside STORE.remove) auto-unlinks the
        # _owned_tempfile, so we deliberately resolve `disk_target` BEFORE
        # the remove so we know whether we're deleting the user's
        # original on-disk file (src.path) or the upload tempfile.
        STORE.remove(source_id)
        deleted_path: Optional[str] = None
        deleted_kind: Optional[str] = None
        delete_error: Optional[str] = None
        if disk_target is not None:
            try:
                disk_target.unlink()
                deleted_path = str(disk_target)
                deleted_kind = "user_path" if (src.path and Path(src.path) == disk_target) else "upload_tempfile"
            except FileNotFoundError:
                # Already gone (e.g. tempfile cleaned up by close_frame_reader
                # before we got here). Treat as success.
                deleted_path = str(disk_target)
                deleted_kind = "user_path" if (src.path and Path(src.path) == disk_target) else "upload_tempfile"
            except OSError as exc:
                delete_error = f"{type(exc).__name__}: {exc}"
        return {
            "ok": True,
            "deleted_path": deleted_path,
            "deleted_kind": deleted_kind,
            "delete_error": delete_error,
        }

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
    def channel_range(
        source_id: str,
        channel: str,
        frame_index: int = Query(
            0, ge=0,
            description=(
                "Frame to compute the range from. Defaults to 0 for "
                "back-compat with the analysis modes (which only see "
                "frame 0). Play mode passes the active frame so the "
                "slider seed reflects the displayed frame, not frame 0."
            ),
        ),
    ):
        """Return min/max + low/high percentiles of the channel pixel
        values. Used by the frontend to seed sensible vmin/vmax defaults
        and bound the slider range. Dark subtraction is applied first so
        the reported values match what the colormap actually sees.

        For ``frame_index > 0`` (Play mode) the channel is extracted
        from that frame via ``LoadedSource.extract_frame``; if the
        source has only a single frame (image / synthetic), the
        ``frame_index=0`` path uses the cached ``src.channels`` so the
        existing analysis-mode call sites remain byte-identical.
        """
        src = _must_get(source_id)
        if frame_index == 0:
            a = _channel_image(src, channel).astype(np.float32, copy=False)
        else:
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e)) from e
            except RuntimeError as e:
                raise HTTPException(409, str(e)) from e
            if channel not in chs:
                raise HTTPException(
                    404,
                    f"channel {channel!r} not in frame {frame_index} of source {source_id!r}; "
                    f"available: {sorted(chs)!r}",
                )
            image = chs[channel]
            if src.has_dark and src.dark_channels is not None:
                d = src.dark_channels.get(channel)
                if d is not None:
                    image = subtract_dark(image, d)
            a = np.asarray(image, dtype=np.float32)
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

    # ---- Play / Recording Inspection (per-frame access) ----
    # play-tab-recording-inspection-rescue-v1 M1
    # The single-source-frame-0 endpoints above stay byte-identical;
    # these new routes layer per-frame extraction on top.

    @app.get("/api/sources/{source_id}/frames", response_model=FrameMetadata)
    def list_frames(source_id: str):
        """Return per-frame exposures and timestamps for a source.

        H5 sources return real arrays from ``camera/integration-time``
        and ``camera/timestamp``. Image sources return a single-frame
        stub (frame_count=1, exposures=[0], timestamps=[0]) so the Play
        UI can treat both kinds uniformly.
        """
        src = _must_get(source_id)
        n = int(src.frame_count)
        if src.per_frame_exposures_s is not None:
            exposures = [float(x) for x in src.per_frame_exposures_s.tolist()]
        else:
            exposures = [0.0] * n
        if src.per_frame_timestamps is not None:
            timestamps = [float(x) for x in src.per_frame_timestamps.tolist()]
        else:
            timestamps = [0.0] * n
        # Duration / FPS estimate — only meaningful when we have monotonic
        # real timestamps. Single-frame or zero-stamp sources report 0.
        duration = 0.0
        fps_est = 0.0
        if n >= 2 and src.per_frame_timestamps is not None:
            ts = src.per_frame_timestamps
            if ts[-1] > ts[0]:
                duration = float(ts[-1] - ts[0])
                if duration > 0:
                    fps_est = float((n - 1) / duration)
        return FrameMetadata(
            source_id=src.source_id,
            frame_count=n,
            exposures_s=exposures,
            timestamps=timestamps,
            duration_s=duration,
            fps_estimate=fps_est,
        )

    @app.get(
        "/api/sources/{source_id}/frame/{frame_index}/channel/{channel}/thumbnail.png",
        responses={200: {"content": {"image/png": {}}}},
    )
    def frame_channel_thumbnail(
        source_id: str,
        frame_index: int,
        channel: str,
        max_dim: int = Query(1600, ge=64, le=8192),
        colormap: str = Query("gray"),
        vmin: Optional[float] = Query(None),
        vmax: Optional[float] = Query(None),
        rgb_composite: bool = Query(False),
        apply_dark: bool = Query(True,
            description="Subtract the source's attached dark frame "
                        "before rendering. Defaults to True so the Play "
                        "view reflects the same correction users see in "
                        "the other modes."),
        show_clipping: bool = Query(False,
            description="M20: paint magenta on pixels at or above the "
                        "high threshold so the user can spot saturated "
                        "regions. Honored by the channel branch; the "
                        "RGB-composite branch falls through unchanged."),
        # M20.1 — ISP corrections + normalize mode. All optional; the
        # defaults yield the previous behaviour byte-for-byte.
        normalize: str = Query("none", pattern="^(auto|manual|none)$",
            description="none (default, M22) = scale against dtype max "
                        "so HG vs LG show their true levels; auto = "
                        "1st/99.5th percentile clip; manual = use "
                        "vmin/vmax exactly. Low/High threshold sliders "
                        "(vmin/vmax) override the chosen mode's default "
                        "bounds in every mode."),
        black_level: float = Query(0.0,
            description="Constant subtracted from raw pixels before gain."),
        gain: float = Query(1.0, ge=0.0, le=64.0),
        offset: float = Query(0.0),
        brightness: float = Query(0.0, ge=-1.0, le=1.0,
            description="Post-normalize additive offset on [0,1]."),
        contrast: float = Query(1.0, ge=0.0, le=4.0,
            description="Post-normalize multiplier around 0.5."),
        gamma: float = Query(1.0, ge=0.1, le=4.0),
        # M26 — non-linear sharpen / FPN ISP chain. Mirrors the legacy
        # USAF channel_thumbnail route's defaults and gating. Applied
        # AFTER dark subtraction and BEFORE _apply_pre_norm so the chain
        # operates on raw DN intensities (matches USAF/FPN analysis).
        sharpen_method: Optional[str] = Query(None,
            description="'Unsharp mask' | 'Laplacian' | 'High-pass' | None"),
        sharpen_amount: float = Query(1.0, ge=0.0, le=8.0),
        sharpen_radius: float = Query(2.0, ge=0.5, le=10.0),
        denoise_sigma: float = Query(0.0, ge=0.0, le=6.0),
        median_size: int = Query(0, ge=0, le=15),
        gaussian_sigma: float = Query(0.0, ge=0.0, le=20.0),
        hot_pixel_thr: float = Query(0.0, ge=0.0, le=50.0),
        bilateral: bool = Query(False),
        # M21 — burn-in label flags. Defaults are all off; backend
        # short-circuits to the unmodified PNG when no flag is set.
        labels_timestamp: bool = Query(False),
        labels_frame: bool = Query(False),
        labels_channel: bool = Query(False),
        labels_source: bool = Query(False),
        labels_scale_bar: bool = Query(False),
        labels_position: str = Query("bottom-left",
            pattern="^(top-left|top-right|bottom-left|bottom-right)$"),
        labels_font_size: int = Query(12, ge=6, le=64),
        # M22 — RGB grading (only honored when the route returns an RGB
        # composite, i.e. rgb_composite=true). Defaults are no-op.
        gain_r: float = Query(1.0, ge=0.0, le=8.0),
        gain_g: float = Query(1.0, ge=0.0, le=8.0),
        gain_b: float = Query(1.0, ge=0.0, le=8.0),
        offset_r: float = Query(0.0, ge=-1.0, le=1.0),
        offset_g: float = Query(0.0, ge=-1.0, le=1.0),
        offset_b: float = Query(0.0, ge=-1.0, le=1.0),
        gamma_g: float = Query(1.0, ge=0.1, le=4.0),
        brightness_g: float = Query(0.0, ge=-1.0, le=1.0),
        contrast_g: float = Query(1.0, ge=0.0, le=4.0),
        saturation_g: float = Query(1.0, ge=0.0, le=4.0),
        wb_kelvin: Optional[float] = Query(None, ge=1500.0, le=12000.0),
        # B-0040: HDR fusion mode override. Default "switch" (hard
        # threshold; cached at extract time) is byte-identical to the
        # previous behaviour. "mertens" re-fuses at render time with a
        # smoothstep blend so HG-saturated regions transition smoothly
        # into LG-scaled values instead of producing the hard seam.
        # Honored only when the requested channel is HDR-*.
        hdr_fusion: str = Query("switch", pattern=_HDR_FUSION_PATTERN,
            description="'switch' (default, hard threshold) or 'mertens' "
                        "(smooth knee). Re-fuses HDR channels at render time."),
    ):
        """Per-frame variant of channel_thumbnail — same contract,
        different frame index. ISP / sharpen chain is intentionally
        omitted (Play mode is for inspection, not analysis pre-processing).
        ``rgb_composite=true`` returns an R/G/B composite of the frame's
        RGB channels (HG- or LG- depending on the prefix on ``channel``).

        When ``hdr_fusion`` differs from ``"switch"`` (the cached
        default) and the requested channel is HDR-*, the HDR triplet
        is re-fused at render time via ``_resolve_hdr_channels``.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                # Source loaded from upload (no path) — frame > 0 unavailable.
                raise HTTPException(409, str(e))
            chs = _resolve_hdr_channels(chs, hdr_fusion)
            labels_cfg = {
                "timestamp": labels_timestamp,
                "frame": labels_frame,
                "channel": labels_channel,
                "source_file": labels_source,
                "scale_bar": labels_scale_bar,
                "position": labels_position,
                "font_size": labels_font_size,
            }
            # M26 — non-linear sharpen / FPN chain (None when no stage active).
            isp_pre_chain = _isp_chain_from_query(
                sharpen_method=sharpen_method,
                sharpen_amount=sharpen_amount,
                sharpen_radius=sharpen_radius,
                denoise_sigma=denoise_sigma,
                median_size=median_size, gaussian_sigma=gaussian_sigma,
                hot_pixel_thr=hot_pixel_thr, bilateral=bilateral,
            )
            if rgb_composite:
                grading = _grading_from_query(
                    gain_r=gain_r, gain_g=gain_g, gain_b=gain_b,
                    offset_r=offset_r, offset_g=offset_g, offset_b=offset_b,
                    gamma_g=gamma_g, brightness_g=brightness_g,
                    contrast_g=contrast_g, saturation_g=saturation_g,
                    wb_kelvin=wb_kelvin,
                )
                png = _build_rgb_composite_png_from_channels(
                    src, chs, channel, max_dim=max_dim, vmin=vmin, vmax=vmax,
                    apply_dark=apply_dark, normalize=normalize,
                    black_level=black_level, gain=gain, offset=offset,
                    brightness=brightness, contrast=contrast, gamma=gamma,
                    grading=grading, isp_pre_chain=isp_pre_chain,
                )
                if png is not None:
                    png = _maybe_burn_labels(
                        png, src=src, frame_index=int(frame_index),
                        channel_name=channel, cfg=labels_cfg,
                    )
                    return Response(content=png, media_type="image/png",
                                    headers={"Cache-Control": "no-store"})
                # Fall through to grayscale below.
            if channel not in chs:
                raise HTTPException(
                    404,
                    f"channel {channel!r} not in frame {frame_index} of source {source_id!r}; "
                    f"available: {sorted(chs)!r}",
                )
            image = chs[channel]
            if apply_dark and src.has_dark and src.dark_channels is not None:
                dark = src.dark_channels.get(channel)
                if dark is not None:
                    image = subtract_dark(image, dark)
            # M26 — non-linear sharpen / FPN chain on raw DN values
            # (after dark subtract, before linear pre-norm).
            if isp_pre_chain is not None:
                image = _apply_analysis_isp(image, isp_pre_chain)
            # M20.1 — pre-normalize ISP linear correction.
            image = _apply_pre_norm(image, black_level=black_level,
                                    gain=gain, offset=offset)
            png = channel_to_png_bytes(
                image, max_dim=max_dim, colormap=colormap,
                vmin=vmin, vmax=vmax, show_clipping=show_clipping,
                normalize_mode=normalize,
                brightness=brightness, contrast=contrast, gamma=gamma,
            )
            png = _maybe_burn_labels(
                png, src=src, frame_index=int(frame_index),
                channel_name=channel, cfg=labels_cfg,
            )
            return Response(content=png, media_type="image/png",
                            headers={"Cache-Control": "no-store"})
        except HTTPException:
            raise
        except Exception as e:
            # M11 hardening: include traceback in server log AND surface
            # the exception detail so the frontend's error overlay shows
            # something actionable instead of a bare 500.
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"frame {frame_index} render failed: "
                f"{type(e).__name__}: {e}",
            )

    @app.get(
        "/api/sources/{source_id}/frame/{frame_index}/channel/{channel}/histogram",
        responses={200: {"content": {"application/json": {}}}},
    )
    def frame_channel_histogram(
        source_id: str,
        frame_index: int,
        channel: str,
        bins: int = Query(64, ge=4, le=1024),
        apply_dark: bool = Query(True),
        # Same correction params the canvas-render path honors so the
        # on-screen histogram matches the displayed pixels — without
        # this the histogram showed pre-correction DN counts and the
        # vmin/vmax markers landed on the wrong bins after the user
        # set a black-level / gain / offset.
        black_level: float = Query(0.0),
        gain: float = Query(1.0),
        offset: float = Query(0.0),
        # Optional ISP chain (sharpen / denoise / median / gaussian) —
        # mirrors the channel-thumbnail params so the histogram of the
        # post-ISP frame is a faithful preview of what the user sees.
        sharpen_method: Optional[str] = Query(None),
        sharpen_amount: float = Query(1.0),
        sharpen_radius: float = Query(2.0),
        denoise_sigma: float = Query(0.0),
        median_size: int = Query(0),
        gaussian_sigma: float = Query(0.0),
        hot_pixel_thr: float = Query(0.0),
        bilateral: bool = Query(False),
        # B-0040 — HDR fusion mode override; honored only for HDR-* channels.
        hdr_fusion: str = Query("switch", pattern=_HDR_FUSION_PATTERN),
    ):
        """64-bin histogram of one channel of one frame.

        Used by the Inspector Display section to render an inline
        histogram with vmin/vmax markers (M20). Returns ``counts /
        edges / min / max / p1 / p99`` so the frontend can size its
        own SVG without round-tripping for percentile values.

        Now applies the same correction pipeline as the channel render
        route — dark subtract, black-level, gain/offset, ISP chain —
        so the histogram represents the actually-displayed pixels.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                raise HTTPException(409, str(e))
            chs = _resolve_hdr_channels(chs, hdr_fusion)
            if channel not in chs:
                raise HTTPException(
                    404,
                    f"channel {channel!r} not in frame {frame_index} of source {source_id!r}; "
                    f"available: {sorted(chs)!r}",
                )
            image = chs[channel]
            if apply_dark and src.has_dark and src.dark_channels is not None:
                dark = src.dark_channels.get(channel)
                if dark is not None:
                    image = subtract_dark(image, dark)
            # Apply the same chain the canvas uses, in the same order:
            #   1. non-linear ISP (sharpen / denoise / median / gauss /
            #      hot-pixel / bilateral) on raw DN values.
            #   2. linear pre-norm (black_level → gain → offset).
            # `_isp_chain_from_query` returns None when no stage is
            # active, which short-circuits the cost.
            isp_pre_chain = _isp_chain_from_query(
                sharpen_method=sharpen_method,
                sharpen_amount=sharpen_amount,
                sharpen_radius=sharpen_radius,
                denoise_sigma=denoise_sigma,
                median_size=median_size,
                gaussian_sigma=gaussian_sigma,
                hot_pixel_thr=hot_pixel_thr,
                bilateral=bilateral,
            )
            if isp_pre_chain is not None:
                image = _apply_analysis_isp(image, isp_pre_chain)
            arr = _apply_pre_norm(
                image, black_level=black_level, gain=gain, offset=offset
            )
            return JSONResponse(channel_histogram(arr, bins=int(bins)),
                                headers={"Cache-Control": "no-store"})
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"frame {frame_index} histogram failed: "
                f"{type(e).__name__}: {e}",
            )

    @app.post(
        "/api/sources/{source_id}/frame/{frame_index}/channel/{channel}/roi-stats",
        responses={200: {"content": {"application/json": {}}}},
    )
    def frame_channel_roi_stats(
        source_id: str,
        frame_index: int,
        channel: str,
        body: ROIStatsRequest,
    ):
        """Compute ROI statistics on one channel of one frame for the
        TBR Analysis tool in Play mode.

        Pipeline matches the canvas thumbnail's linear chain at
        ``frame_channel_thumbnail`` (server.py:1332-1343):
        per-frame channel extraction → optional dark subtract →
        ``_apply_analysis_isp`` (sharpen + denoise + FPN) →
        ``_apply_pre_norm`` (black_level + gain + offset) → polygon
        mask → stats. The post-normalize tone curve (brightness /
        contrast / gamma) and colormap are intentionally NOT applied
        — TBR stays in physical-DN-scaled-by-gain units so the ratio
        is comparable across frames and the standard error
        propagation σ_R/R = √((σ_T/T)² + (σ_B/B)²) holds.

        Response carries ``pipeline_version=2`` so clients can flag
        entries committed under the pre-fix pipeline.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                raise HTTPException(409, str(e))
            chs = _resolve_hdr_channels(chs, body.hdr_fusion)
            if channel not in chs:
                raise HTTPException(
                    404,
                    f"channel {channel!r} not in frame {frame_index} of source {source_id!r}; "
                    f"available: {sorted(chs)!r}",
                )
            polygon = list(body.polygon)
            method = body.method
            percentile = float(body.percentile)
            apply_dark = bool(body.apply_dark)
            black_level = float(body.black_level)
            vc = body.view_config
            vc_gain = float(vc.gain) if vc else 1.0
            vc_offset = float(vc.offset) if vc else 0.0
            vc_sharpen_method = vc.sharpen_method if vc else None
            vc_sharpen_amount = float(vc.sharpen_amount) if vc else 1.0
            vc_sharpen_radius = float(vc.sharpen_radius) if vc else 2.0
            vc_denoise_sigma = float(vc.denoise_sigma) if vc else 0.0
            vc_median_size = int(vc.median_size) if vc else 0
            vc_gaussian_sigma = float(vc.gaussian_sigma) if vc else 0.0
            vc_hot_pixel_thr = float(vc.hot_pixel_thr) if vc else 0.0
            vc_bilateral = bool(vc.bilateral) if vc else False
            isp_pre_chain = _isp_chain_from_query(
                sharpen_method=vc_sharpen_method,
                sharpen_amount=vc_sharpen_amount,
                sharpen_radius=vc_sharpen_radius,
                denoise_sigma=vc_denoise_sigma,
                median_size=vc_median_size,
                gaussian_sigma=vc_gaussian_sigma,
                hot_pixel_thr=vc_hot_pixel_thr,
                bilateral=vc_bilateral,
            )
            image = chs[channel]
            # Apply the same correction pipeline the canvas uses
            # (frame_channel_thumbnail:1332-1343).
            if apply_dark and src.has_dark and src.dark_channels is not None:
                d = src.dark_channels.get(channel)
                if d is not None:
                    image = subtract_dark(image, d)
            if isp_pre_chain is not None:
                image = _apply_analysis_isp(image, isp_pre_chain)
            # _apply_pre_norm folds black_level + gain + offset and
            # hard-clips to [0, ∞) after black_level subtraction so
            # wrap-around (uint16 underflow) can't poison TBR.
            arr = _apply_pre_norm(
                image, black_level=black_level, gain=vc_gain, offset=vc_offset,
            ).astype(np.float64, copy=False)
            # Rasterize polygon → boolean mask (matches the channel
            # array shape, which is post-Bayer-extraction).
            try:
                from PIL import Image as _PI, ImageDraw as _PID
                H, W = arr.shape
                poly = [(float(p[0]), float(p[1])) for p in polygon]
                canvas = _PI.new("L", (W, H), 0)
                _PID.Draw(canvas).polygon(poly, fill=1)
                mask = (np.asarray(canvas, dtype=np.uint8) > 0)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    400, f"polygon rasterize failed: {type(exc).__name__}: {exc}"
                )
            sel = arr[mask]
            n_pixels = int(sel.size)
            if n_pixels == 0:
                raise HTTPException(
                    400, "polygon contains no pixels (zero-area or fully outside frame)"
                )
            mean = float(np.mean(sel))
            std = float(np.std(sel, ddof=1)) if n_pixels > 1 else 0.0
            median = float(np.median(sel))
            pct_value = float(np.percentile(sel, percentile))
            # Mode: histogram-binned mode is more useful than scipy.stats.mode
            # on continuous-valued data (most pixels are unique). Bin into
            # 256 buckets across the selection's [min, max] and pick the
            # most-populated bucket's centre.
            mn = float(np.min(sel))
            mx = float(np.max(sel))
            if mx > mn:
                hist, edges = np.histogram(sel, bins=256, range=(mn, mx))
                k = int(np.argmax(hist))
                mode_val = float(0.5 * (edges[k] + edges[k + 1]))
            else:
                mode_val = mn
            if method == "mean":
                computed = mean
            elif method == "percentile":
                computed = pct_value
            else:
                computed = mode_val
            return JSONResponse(
                {
                    "n_pixels": n_pixels,
                    "mean": mean,
                    "std": std,
                    "median": median,
                    "percentile_value": pct_value,
                    "percentile": percentile,
                    "mode": mode_val,
                    "min": mn,
                    "max": mx,
                    "method": method,
                    "computed_value": computed,
                    "apply_dark": apply_dark,
                    "black_level": black_level,
                    # Pipeline v2: linear ISP chain (dark + analysis_isp +
                    # pre_norm). v1 entries (pre-fix) only saw dark + black_level.
                    "pipeline_version": 2,
                    "view_config_applied": isp_pre_chain is not None
                    or abs(vc_gain - 1.0) > 1e-9
                    or abs(vc_offset) > 1e-9,
                },
                headers={"Cache-Control": "no-store"},
            )
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"frame {frame_index} ROI stats failed: "
                f"{type(e).__name__}: {e}",
            )

    @app.post(
        "/api/sources/{source_id}/frame/{frame_index}/rgb/auto-wb",
        responses={200: {"content": {"application/json": {}}}},
    )
    def frame_rgb_auto_wb(
        source_id: str,
        frame_index: int,
        gain: str = Query("hg", pattern="^(hg|lg|HG|LG)$"),
        method: str = Query("gray-world", pattern="^(gray-world|max-rgb)$"),
        apply_dark: bool = Query(True),
    ):
        """M22 — return suggested per-channel grading gains that bring
        the current RGB composite to gray. The frontend pushes these
        into ``view.grading`` (gain_r/g/b) and re-renders.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                raise HTTPException(409, str(e))
            prefix = "HG-" if gain.lower() == "hg" else "LG-" if gain.lower() == "lg" else "HDR-"
            # Auto-WB samples in *auto* mode so it sees a well-spread
            # signal regardless of HG/LG dimness — the suggested gains
            # are still applied to whatever mode the live render uses.
            arr = _composite_rgb_array(src, chs, prefix + "R",
                                       apply_dark=apply_dark, normalize="auto")
            if arr is None:
                raise HTTPException(
                    422,
                    f"source {source_id!r} does not support an RGB composite under "
                    f"its active ISP mode {src.isp_mode_id!r}",
                )
            return JSONResponse(
                auto_white_balance(arr, method=method),
                headers={"Cache-Control": "no-store"},
            )
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"frame {frame_index} auto-wb failed: "
                f"{type(e).__name__}: {e}",
            )

    @app.get(
        "/api/sources/{source_id}/frame/{frame_index}/rgb.png",
        responses={200: {"content": {"image/png": {}}}},
    )
    def frame_rgb_composite(
        source_id: str,
        frame_index: int,
        gain: str = Query("hg", pattern="^(hg|lg|HG|LG|hdr|HDR)$",
                          description="'hg' for HG-R/G/B, 'lg' for LG-R/G/B, "
                                      "'hdr' for HDR-R/G/B (M25 fusion)."),
        max_dim: int = Query(1600, ge=64, le=8192),
        vmin: Optional[float] = Query(None),
        vmax: Optional[float] = Query(None),
        apply_dark: bool = Query(True),
        # M20.1/M22 — same ISP pipeline as the channel route. Default
        # 'none' so HG and LG render at their true relative brightness.
        normalize: str = Query("none", pattern="^(auto|manual|none)$"),
        black_level: float = Query(0.0),
        isp_gain: float = Query(1.0, ge=0.0, le=64.0,
            description="Linear multiplier applied before normalize. Named "
                        "isp_gain to avoid colliding with the existing 'gain' "
                        "param (HG/LG selector)."),
        offset: float = Query(0.0),
        brightness: float = Query(0.0, ge=-1.0, le=1.0),
        contrast: float = Query(1.0, ge=0.0, le=4.0),
        gamma: float = Query(1.0, ge=0.1, le=4.0),
        # M26 — non-linear sharpen / FPN chain (mirrors channel route).
        # Applied per-channel on each of R/G/B before _apply_pre_norm.
        sharpen_method: Optional[str] = Query(None),
        sharpen_amount: float = Query(1.0, ge=0.0, le=8.0),
        sharpen_radius: float = Query(2.0, ge=0.5, le=10.0),
        denoise_sigma: float = Query(0.0, ge=0.0, le=6.0),
        median_size: int = Query(0, ge=0, le=15),
        gaussian_sigma: float = Query(0.0, ge=0.0, le=20.0),
        hot_pixel_thr: float = Query(0.0, ge=0.0, le=50.0),
        bilateral: bool = Query(False),
        # M21 — burn-in labels (mirrors the channel route).
        labels_timestamp: bool = Query(False),
        labels_frame: bool = Query(False),
        labels_channel: bool = Query(False),
        labels_source: bool = Query(False),
        labels_scale_bar: bool = Query(False),
        labels_position: str = Query("bottom-left",
            pattern="^(top-left|top-right|bottom-left|bottom-right)$"),
        labels_font_size: int = Query(12, ge=6, le=64),
        # M22 — RGB grading.
        gain_r: float = Query(1.0, ge=0.0, le=8.0),
        gain_g: float = Query(1.0, ge=0.0, le=8.0),
        gain_b: float = Query(1.0, ge=0.0, le=8.0),
        offset_r: float = Query(0.0, ge=-1.0, le=1.0),
        offset_g: float = Query(0.0, ge=-1.0, le=1.0),
        offset_b: float = Query(0.0, ge=-1.0, le=1.0),
        gamma_g: float = Query(1.0, ge=0.1, le=4.0),
        brightness_g: float = Query(0.0, ge=-1.0, le=1.0),
        contrast_g: float = Query(1.0, ge=0.0, le=4.0),
        saturation_g: float = Query(1.0, ge=0.0, le=4.0),
        wb_kelvin: Optional[float] = Query(None, ge=1500.0, le=12000.0),
        # B-0040: see frame_channel_thumbnail for description. Honored
        # when gain="hdr" — re-fuses the HDR-R/G/B/NIR triplet under
        # the requested fusion mode before the RGB composite.
        hdr_fusion: str = Query("switch", pattern=_HDR_FUSION_PATTERN),
    ):
        """Convenience endpoint that auto-resolves the RGB triplet for a
        dual-gain RGB-NIR source. Equivalent to calling the per-channel
        thumbnail with ``channel=HG-R&rgb_composite=true``, but the URL
        is cleaner for the frontend's auto-RGB code path.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                raise HTTPException(409, str(e))
            chs = _resolve_hdr_channels(chs, hdr_fusion)
            prefix = "HG-" if gain.lower() == "hg" else "LG-" if gain.lower() == "lg" else "HDR-"
            # Use the prefix-aware composite helper. Channel arg is just used
            # to pick the gain prefix.
            grading = _grading_from_query(
                gain_r=gain_r, gain_g=gain_g, gain_b=gain_b,
                offset_r=offset_r, offset_g=offset_g, offset_b=offset_b,
                gamma_g=gamma_g, brightness_g=brightness_g,
                contrast_g=contrast_g, saturation_g=saturation_g,
                wb_kelvin=wb_kelvin,
            )
            # M26 — non-linear sharpen / FPN chain.
            isp_pre_chain = _isp_chain_from_query(
                sharpen_method=sharpen_method,
                sharpen_amount=sharpen_amount,
                sharpen_radius=sharpen_radius,
                denoise_sigma=denoise_sigma,
                median_size=median_size, gaussian_sigma=gaussian_sigma,
                hot_pixel_thr=hot_pixel_thr, bilateral=bilateral,
            )
            png = _build_rgb_composite_png_from_channels(
                src, chs, prefix + "R",
                max_dim=max_dim, vmin=vmin, vmax=vmax,
                apply_dark=apply_dark,
                normalize=normalize,
                black_level=black_level, gain=isp_gain, offset=offset,
                brightness=brightness, contrast=contrast, gamma=gamma,
                grading=grading, isp_pre_chain=isp_pre_chain,
            )
            if png is None:
                raise HTTPException(
                    422,
                    f"source {source_id!r} does not support an RGB composite under "
                    f"its active ISP mode {src.isp_mode_id!r}",
                )
            png = _maybe_burn_labels(
                png, src=src, frame_index=int(frame_index),
                channel_name=f"RGB · {gain.upper()}",
                cfg={
                    "timestamp": labels_timestamp,
                    "frame": labels_frame,
                    "channel": labels_channel,
                    "source_file": labels_source,
                    "scale_bar": labels_scale_bar,
                    "position": labels_position,
                    "font_size": labels_font_size,
                },
            )
            return Response(content=png, media_type="image/png",
                            headers={"Cache-Control": "no-store"})
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"RGB composite render failed for frame {frame_index}: "
                f"{type(e).__name__}: {e}",
            )

    @app.get(
        "/api/sources/{source_id}/frame/{frame_index}/overlay.png",
        responses={200: {"content": {"image/png": {}}}},
    )
    def frame_overlay(
        source_id: str,
        frame_index: int,
        base_channel: str = Query(...,
            description="Channel key used as the base RGB layer. For RGB "
                        "composite bases, pass HG-R or LG-R and set "
                        "base_kind=rgb_composite."),
        overlay_channel: str = Query(...,
            description="Single-channel key colormapped + composited over the base."),
        base_kind: str = Query("rgb_composite", pattern="^(rgb_composite|single_channel)$"),
        overlay_colormap: str = Query("inferno"),
        overlay_low: Optional[float] = Query(None),
        overlay_high: Optional[float] = Query(None),
        blend: str = Query("alpha", pattern="^(alpha|screen|additive)$"),
        strength: float = Query(0.65, ge=0.0, le=1.0),
        max_dim: int = Query(1600, ge=64, le=8192),
        apply_dark: bool = Query(True),
        # Optional polygon ROI (image-pixel coords on the per-channel
        # array, NOT the raw mosaic). Format: JSON-encoded list of
        # [x, y] pairs. When present, the overlay is applied ONLY
        # inside the polygon and the base shows through everywhere
        # else. Points outside the channel shape are clipped at
        # rasterization time. Pass an empty list to clear.
        mask_polygon: Optional[str] = Query(None),
        # Burn-in label flags (parity with frame_channel_thumbnail and
        # frame_rgb). Defaults all off; _maybe_burn_labels short-circuits
        # to the unmodified PNG when no flag is set, so the no-labels
        # path stays free.
        labels_timestamp: bool = Query(False),
        labels_frame: bool = Query(False),
        labels_channel: bool = Query(False),
        labels_source: bool = Query(False),
        labels_scale_bar: bool = Query(False),
        labels_position: str = Query("bottom-left",
            pattern="^(top-left|top-right|bottom-left|bottom-right)$"),
        labels_font_size: int = Query(12, ge=6, le=64),
    ):
        """Compose a base view + colormapped overlay channel into one PNG.

        Used for the NIR-over-RGB workflow. Channel arrays come from the
        per-frame cache; rendering is in-process via PIL + matplotlib LUT.
        """
        try:
            src = _must_get(source_id)
            try:
                chs = src.extract_frame(int(frame_index))
            except IndexError as e:
                raise HTTPException(404, str(e))
            except RuntimeError as e:
                raise HTTPException(409, str(e))
            if overlay_channel not in chs:
                raise HTTPException(404,
                    f"overlay channel {overlay_channel!r} not present in frame "
                    f"{frame_index} (have: {sorted(chs)!r})")
            # Build the base RGB array (H, W, 3) float32 in [0, 1].
            # Overlay views are visualization aids — auto-percentile is
            # the right default for both base and overlay channels so
            # the overlay actually pops. (The thumbnail/rgb routes
            # default to 'none' for HG-vs-LG truth; overlay diverges.)
            if base_kind == "rgb_composite":
                base_arr = _composite_rgb_array(
                    src, chs, base_channel, apply_dark=apply_dark, normalize="auto"
                )
                if base_arr is None:
                    raise HTTPException(422,
                        f"RGB composite unavailable for source {source_id!r}; "
                        f"check active ISP mode and channel set.")
            else:
                if base_channel not in chs:
                    raise HTTPException(404,
                        f"base channel {base_channel!r} not in frame {frame_index}")
                base_single = chs[base_channel]
                if apply_dark and src.has_dark and src.dark_channels is not None:
                    d = src.dark_channels.get(base_channel)
                    if d is not None:
                        base_single = subtract_dark(base_single, d)
                base_arr = _norm_to_unit(base_single, mode="auto")
                base_arr = np.dstack([base_arr, base_arr, base_arr])
            # Overlay channel — colormap + threshold mask
            ov_single = chs[overlay_channel]
            if apply_dark and src.has_dark and src.dark_channels is not None:
                d = src.dark_channels.get(overlay_channel)
                if d is not None:
                    ov_single = subtract_dark(ov_single, d)
            ov_norm = _norm_to_unit(ov_single, lo=overlay_low, hi=overlay_high, mode="auto")
            # Apply colormap
            try:
                from matplotlib import colormaps
                cmap = colormaps[overlay_colormap]
            except (KeyError, ImportError):
                from matplotlib import colormaps
                cmap = colormaps["inferno"]
            ov_rgba = cmap(ov_norm)            # (H, W, 4) float64 in [0,1]
            ov_rgb = ov_rgba[..., :3].astype(np.float32, copy=False)
            # Mask: pixels below low threshold are transparent.
            s = float(strength)
            mask = ov_norm.astype(np.float32) * s
            # Optional polygon ROI: rasterize the user-drawn polygon to
            # a binary {0,1} alpha mask and AND it into `mask`. The base
            # image shows through outside the polygon (mask=0 there);
            # the colormapped overlay only blends inside.
            roi = _polygon_to_roi_mask(mask_polygon, mask.shape)
            if roi is not None:
                mask = mask * roi
            if blend == "additive":
                out = np.clip(base_arr + ov_rgb * mask[..., None], 0.0, 1.0)
            elif blend == "screen":
                out = 1.0 - (1.0 - base_arr) * (1.0 - ov_rgb * mask[..., None])
            else:  # alpha
                out = base_arr * (1.0 - mask[..., None]) + ov_rgb * mask[..., None]
            out_u8 = (np.clip(out, 0.0, 1.0) * 255.0).astype(np.uint8)
            from PIL import Image
            im = Image.fromarray(out_u8, mode="RGB")
            if max(im.size) > max_dim:
                scale = max_dim / float(max(im.size))
                new_size = (int(im.size[0] * scale), int(im.size[1] * scale))
                im = im.resize(new_size, Image.Resampling.BILINEAR)
            buf = io.BytesIO()
            im.save(buf, format="PNG", optimize=False)
            png = buf.getvalue()
            labels_cfg = {
                "timestamp": labels_timestamp,
                "frame": labels_frame,
                "channel": labels_channel,
                "source_file": labels_source,
                "scale_bar": labels_scale_bar,
                "position": labels_position,
                "font_size": labels_font_size,
            }
            png = _maybe_burn_labels(
                png, src=src, frame_index=int(frame_index),
                channel_name=overlay_channel, cfg=labels_cfg,
            )
            return Response(content=png, media_type="image/png",
                            headers={"Cache-Control": "no-store"})
        except HTTPException:
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            raise HTTPException(
                500,
                f"overlay render failed for frame {frame_index}: "
                f"{type(e).__name__}: {e}",
            )

    @app.post(
        "/api/sources/export/image-tiled",
        responses={200: {"content": {
            "image/png": {},
            "image/tiff": {},
            "image/jpeg": {},
        }}},
    )
    def export_image_tiled(req: TiledExportRequest):
        """M23 — render N views and composite them into a single image.

        Each view spec drives one tile; the layout selector arranges
        them in a grid. Supports 5 presets:

          * ``1xN``     — single row of every view
          * ``2xM``     — 2 columns × ceil(N/2) rows
          * ``3plus1``  — three small (left col) + one large (right col)
          * ``4x2``     — 4 columns × 2 rows (caps at 8 views)
          * ``auto``    — picks based on N (1/2/3-4/5-6/7-8/…)

        The render path mirrors the per-frame ``rgb.png`` /
        ``channel/.../thumbnail.png`` / ``overlay.png`` routes so what
        the user sees in the live ViewerCard is what gets baked in.
        Returns PNG / TIFF / JPEG bytes with ``Content-Disposition:
        attachment`` so the browser saves to Downloads.
        """
        if not req.views:
            raise HTTPException(400, "image-tiled export requires at least one view")
        if len(req.views) > 16:
            raise HTTPException(
                413,
                f"image-tiled export caps at 16 views (got {len(req.views)})",
            )

        # Render every view, then composite onto a single canvas.
        try:
            tiles = [
                _render_tiled_view_to_rgb(v, max_dim=req.max_dim) for v in req.views
            ]
        except HTTPException:
            raise
        canvas = _compose_tiled_canvas(
            tiles,
            layout=req.layout,
            gap_px=req.gap_px,
            background=req.background,
        )
        n = len(tiles)
        layout = (req.layout or "auto").lower()

        fmt = (req.format or "png").lower()
        if fmt not in ("png", "tiff", "jpeg"):
            fmt = "png"
        media = {
            "png": "image/png",
            "tiff": "image/tiff",
            "jpeg": "image/jpeg",
        }[fmt]
        ext = {"png": "png", "tiff": "tiff", "jpeg": "jpg"}[fmt]
        buf = io.BytesIO()
        save_kwargs = {"format": "PNG" if fmt == "png" else "TIFF" if fmt == "tiff" else "JPEG"}
        if fmt == "jpeg":
            save_kwargs["quality"] = 92
        canvas.save(buf, **save_kwargs)
        filename = f"play_tiled_{n}views_{layout}.{ext}"
        return Response(
            content=buf.getvalue(),
            media_type=media,
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @app.post(
        "/api/sources/export/video-tiled",
        responses={200: {"content": {
            "video/mp4": {},
            "image/gif": {},
            "application/zip": {},
        }}},
    )
    def export_video_tiled(req: TiledExportVideoRequest):
        """M24 — render N views per frame, composite, encode as MP4/GIF/zip.

        Mirrors the M23 image-tiled pipeline frame-by-frame. Each
        view's ``frame_index`` is the anchor for the first output
        frame; for output frame ``g`` (in [start, end]) every view
        renders ``min(view.frame_index + (g - start), src.frame_count - 1)``
        — sources of differing lengths clamp to their last frame
        rather than aborting. The composite layout is held constant
        across the whole stream (computed from the first frame's tile
        sizes).
        """
        if not req.views:
            raise HTTPException(400, "video-tiled export requires at least one view")
        if len(req.views) > 16:
            raise HTTPException(
                413,
                f"video-tiled caps at 16 views (got {len(req.views)})",
            )
        # Determine the longest source so default `end` covers it.
        try:
            srcs = [STORE.get(v.source_id) for v in req.views]
        except KeyError as e:
            raise HTTPException(404, f"unknown source_id in video-tiled: {e}")
        max_frames = max(int(getattr(s, "frame_count", 1)) for s in srcs)
        first = max(0, int(req.start))
        last = (max_frames - 1) if req.end is None else int(req.end)
        last = max(first, min(last, max_frames - 1))
        n_frames = last - first + 1

        MAX_TILED_VIDEO_FRAMES = 1000
        if n_frames > MAX_TILED_VIDEO_FRAMES:
            raise HTTPException(
                413,
                f"video-tiled export {n_frames} frames exceeds the limit of "
                f"{MAX_TILED_VIDEO_FRAMES}; narrow the range brush.",
            )

        from PIL import Image as _PILImage

        def _frame_bytes(g: int) -> np.ndarray:
            """Render one composite frame at global index ``g``."""
            offset = g - first
            tiles = [
                _render_tiled_view_to_rgb(
                    v, max_dim=req.max_dim,
                    override_frame_index=int(v.frame_index) + offset,
                )
                for v in req.views
            ]
            canvas = _compose_tiled_canvas(
                tiles,
                layout=req.layout,
                gap_px=req.gap_px,
                background=req.background,
            )
            return np.asarray(canvas, dtype=np.uint8)

        def _even_pad(rgb: np.ndarray) -> np.ndarray:
            """libx264 needs even dimensions; pad with one row/col if odd."""
            h, w = rgb.shape[:2]
            ph = h + (h & 1)
            pw = w + (w & 1)
            if ph == h and pw == w:
                return rgb
            out = np.zeros((ph, pw, 3), dtype=np.uint8)
            out[:h, :w] = rgb
            return out

        fmt = (req.format or "mp4").lower()
        if fmt not in ("mp4", "gif", "zip"):
            fmt = "mp4"
        n_views = len(req.views)
        layout_label = (req.layout or "auto").lower()

        if fmt == "mp4":
            import imageio
            import tempfile
            try:
                with tempfile.NamedTemporaryFile(
                    suffix=".mp4", delete=False
                ) as fh:
                    tmp_path = Path(fh.name)
                first_arr = _even_pad(_frame_bytes(first))
                try:
                    with imageio.get_writer(
                        str(tmp_path),
                        format="FFMPEG",
                        mode="I",
                        fps=float(req.fps),
                        codec="libx264",
                        macro_block_size=1,
                        ffmpeg_params=["-pix_fmt", "yuv420p"],
                    ) as w:
                        w.append_data(first_arr)
                        for g in range(first + 1, last + 1):
                            w.append_data(_even_pad(_frame_bytes(g)))
                except (RuntimeError, OSError, ImportError) as e:
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass
                    raise HTTPException(
                        503,
                        f"MP4 encoder unavailable: {type(e).__name__}: {e}; "
                        f"try GIF or PNG-zip instead.",
                    )
                payload = tmp_path.read_bytes()
                try:
                    tmp_path.unlink()
                except OSError:
                    pass
            except HTTPException:
                raise
            except Exception as e:
                import traceback
                traceback.print_exc()
                raise HTTPException(
                    500,
                    f"MP4 tiled export failed: {type(e).__name__}: {e}",
                )
            filename = (
                f"play_tiled_{n_views}views_{layout_label}_"
                f"f{first:04d}-{last:04d}.mp4"
            )
            return Response(
                content=payload,
                media_type="video/mp4",
                headers={
                    "Cache-Control": "no-store",
                    "Content-Disposition": f'attachment; filename="{filename}"',
                },
            )
        if fmt == "gif":
            import imageio
            frames = [_frame_bytes(g) for g in range(first, last + 1)]
            buf = io.BytesIO()
            imageio.mimsave(
                buf, frames, format="GIF", fps=float(req.fps),
            )
            filename = (
                f"play_tiled_{n_views}views_{layout_label}_"
                f"f{first:04d}-{last:04d}.gif"
            )
            return Response(
                content=buf.getvalue(),
                media_type="image/gif",
                headers={
                    "Cache-Control": "no-store",
                    "Content-Disposition": f'attachment; filename="{filename}"',
                },
            )
        # zip — write each composite frame as a PNG inside the archive.
        import zipfile
        zbuf = io.BytesIO()
        with zipfile.ZipFile(zbuf, mode="w", compression=zipfile.ZIP_STORED) as zf:
            pad = max(4, len(str(last)))
            for g in range(first, last + 1):
                arr = _frame_bytes(g)
                im = _PILImage.fromarray(arr, mode="RGB")
                pbuf = io.BytesIO()
                im.save(pbuf, format="PNG", optimize=False)
                zf.writestr(
                    f"frame_{g:0{pad}d}.png",
                    pbuf.getvalue(),
                )
        filename = (
            f"play_tiled_{n_views}views_{layout_label}_"
            f"f{first:04d}-{last:04d}.zip"
        )
        return Response(
            content=zbuf.getvalue(),
            media_type="application/zip",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @app.get(
        "/api/sources/{source_id}/export/video",
        responses={
            200: {"content": {
                "video/mp4": {},
                "image/gif": {},
                "application/zip": {},
            }},
        },
    )
    def export_video(
        source_id: str,
        format: str = Query("mp4", pattern="^(mp4|gif|zip)$"),
        render: str = Query("rgb_composite",
            pattern="^(rgb_composite|channel|overlay)$"),
        # Common render params
        gain: str = Query("hg", pattern="^(hg|lg|HG|LG)$"),
        channel: Optional[str] = Query(None,
            description="Channel key for render=channel."),
        colormap: str = Query("gray"),
        vmin: Optional[float] = Query(None),
        vmax: Optional[float] = Query(None),
        apply_dark: bool = Query(True),
        # Range
        start: int = Query(0, ge=0),
        end: Optional[int] = Query(None,
            description="Inclusive last frame; defaults to last frame."),
        fps: float = Query(10.0, ge=0.1, le=120.0),
        # Output
        max_dim: int = Query(4096, ge=64, le=8192),
        # libx264 quality knobs. crf=18 is visually lossless (default
        # bumped from imageio default ~25). preset=slow trades encode
        # time for ~10–15 % smaller files at the same CRF. Passed only
        # to the MP4 path; GIF / PNG-zip ignore.
        crf: int = Query(18, ge=0, le=51),
        preset: str = Query("slow",
            pattern="^(ultrafast|superfast|veryfast|faster|fast|medium|slow|slower|veryslow)$"),
        # Overlay-specific (when render=overlay)
        base_channel: Optional[str] = Query(None),
        overlay_channel: Optional[str] = Query(None),
        overlay_low: Optional[float] = Query(None),
        overlay_high: Optional[float] = Query(None),
        blend: str = Query("alpha", pattern="^(alpha|screen|additive)$"),
        strength: float = Query(0.65, ge=0.0, le=1.0),
        overlay_colormap: str = Query("inferno"),
        # Optional polygon ROI for render=overlay. JSON-encoded list of
        # [x, y] image-pixel pairs. When provided, the colormapped
        # overlay only blends inside the polygon and the base RGB shows
        # through everywhere else — mirrors the per-frame /overlay.png
        # route so the exported video matches WYSIWYG with the canvas.
        # Ignored for render='rgb_composite' / 'channel'.
        mask_polygon: Optional[str] = Query(None),
        # Linear ISP pre-norm (forwarded to channel + RGB renders so the
        # exported video honors the live gain / offset / black-level the
        # canvas is showing). Defaults are no-op.
        black_level: float = Query(0.0),
        isp_gain: float = Query(1.0),
        isp_offset: float = Query(0.0),
        # Non-linear ISP chain (sharpen + denoise + FPN) forwarded so
        # exported channel/RGB videos match the canvas WYSIWYG.
        sharpen_method: Optional[str] = Query(None),
        sharpen_amount: float = Query(1.0, ge=0.0, le=8.0),
        sharpen_radius: float = Query(2.0, ge=0.5, le=10.0),
        denoise_sigma: float = Query(0.0, ge=0.0, le=6.0),
        median_size: int = Query(0, ge=0, le=15),
        gaussian_sigma: float = Query(0.0, ge=0.0, le=20.0),
        hot_pixel_thr: float = Query(0.0, ge=0.0, le=50.0),
        bilateral: bool = Query(False),
    ):
        """Render a frame range as MP4 / GIF / PNG-zip.

        Each frame is rendered through the same pipeline as the live view
        (per-frame extraction → optional dark subtract → colormap or RGB
        composite or overlay → resize) so the exported video matches WYSIWYG
        per spec R5. Returns bytes inline with ``Content-Disposition: attachment``
        so the browser saves to the user's default Downloads folder
        (resolved decision #4).

        play-tab-recording-inspection-rescue-v1 M10.
        """
        src = _must_get(source_id)
        n = int(src.frame_count)
        if n <= 0:
            raise HTTPException(409, f"source {source_id} has no frames to export")
        last = n - 1 if end is None else min(int(end), n - 1)
        first = max(0, int(start))
        if last < first:
            raise HTTPException(400,
                f"end ({last}) must be >= start ({first})")
        # M11 P1: cap export size so /export/video can't OOM the server.
        # 2000 frames × 1280×720 RGB ≈ 7 GB peak in a worst-case render
        # path; in practice most exports are < 100 frames.
        MAX_EXPORT_FRAMES = 2000
        n_export = last - first + 1
        if n_export > MAX_EXPORT_FRAMES:
            raise HTTPException(
                413,
                f"export range {n_export} frames exceeds the limit of "
                f"{MAX_EXPORT_FRAMES}; narrow the range or split the export.",
            )

        from PIL import Image as _PILImage

        # Build the non-linear ISP pre-chain once per export so we don't
        # rebuild it per frame. None = no-op (matches the live render
        # path's frame_channel_thumbnail behaviour).
        export_isp_chain = _isp_chain_from_query(
            sharpen_method=sharpen_method,
            sharpen_amount=sharpen_amount,
            sharpen_radius=sharpen_radius,
            denoise_sigma=denoise_sigma,
            median_size=median_size, gaussian_sigma=gaussian_sigma,
            hot_pixel_thr=hot_pixel_thr, bilateral=bilateral,
        )

        def _channel_post_isp(img: np.ndarray, ch: str) -> np.ndarray:
            """dark → analysis_isp → pre_norm — same chain as the canvas."""
            if apply_dark and src.has_dark and src.dark_channels is not None:
                d = src.dark_channels.get(ch)
                if d is not None:
                    img = subtract_dark(img, d)
            if export_isp_chain is not None:
                img = _apply_analysis_isp(img, export_isp_chain)
            return _apply_pre_norm(
                img, black_level=black_level, gain=isp_gain, offset=isp_offset,
            )

        def render_frame(idx: int) -> np.ndarray:
            """Render one frame to (H, W, 3) uint8."""
            chs = src.extract_frame(idx)
            if render == "rgb_composite":
                arr = _composite_rgb_array(
                    src, chs,
                    "HG-R" if gain.lower() == "hg" else "LG-R",
                    apply_dark=apply_dark, vmin=vmin, vmax=vmax,
                )
                if arr is None:
                    raise HTTPException(422,
                        f"RGB composite unavailable for source {source_id}")
                return (arr * 255.0).astype(np.uint8)
            if render == "channel":
                if not channel:
                    raise HTTPException(400,
                        "render=channel requires ?channel=<name>")
                if channel not in chs:
                    raise HTTPException(404,
                        f"channel {channel!r} not in frame {idx}")
                img = _channel_post_isp(chs[channel], channel)
                norm = _norm_to_unit(img, lo=vmin, hi=vmax)
                cmap_name = (colormap or "gray").lower()
                if cmap_name in ("gray", "grey", "l", "mono"):
                    g = (norm * 255.0).astype(np.uint8)
                    return np.stack([g, g, g], axis=-1)
                from matplotlib import colormaps
                try:
                    cmap = colormaps[cmap_name]
                except KeyError:
                    cmap = colormaps["gray"]
                rgba = cmap(norm, bytes=True)
                return rgba[..., :3]
            if render == "overlay":
                if not base_channel or not overlay_channel:
                    raise HTTPException(400,
                        "render=overlay requires base_channel and overlay_channel")
                base_arr = _composite_rgb_array(
                    src, chs, base_channel,
                    apply_dark=apply_dark, vmin=vmin, vmax=vmax,
                )
                if base_arr is None:
                    raise HTTPException(422,
                        "RGB composite unavailable for overlay base")
                if overlay_channel not in chs:
                    raise HTTPException(404,
                        f"overlay channel {overlay_channel!r} not in frame {idx}")
                ov = chs[overlay_channel]
                if apply_dark and src.has_dark and src.dark_channels is not None:
                    d = src.dark_channels.get(overlay_channel)
                    if d is not None:
                        ov = subtract_dark(ov, d)
                ov_norm = _norm_to_unit(ov, lo=overlay_low, hi=overlay_high)
                from matplotlib import colormaps
                try:
                    cmap = colormaps[overlay_colormap]
                except KeyError:
                    cmap = colormaps["inferno"]
                ov_rgb = cmap(ov_norm)[..., :3].astype(np.float32)
                s = float(strength)
                mask = ov_norm.astype(np.float32) * s
                # Polygon ROI clip — same behaviour as /overlay.png.
                roi = _polygon_to_roi_mask(mask_polygon, mask.shape)
                if roi is not None:
                    mask = mask * roi
                if blend == "additive":
                    out = np.clip(base_arr + ov_rgb * mask[..., None], 0.0, 1.0)
                elif blend == "screen":
                    out = 1.0 - (1.0 - base_arr) * (1.0 - ov_rgb * mask[..., None])
                else:
                    out = base_arr * (1.0 - mask[..., None]) + ov_rgb * mask[..., None]
                return (np.clip(out, 0.0, 1.0) * 255.0).astype(np.uint8)
            raise HTTPException(400, f"unknown render: {render!r}")

        def maybe_resize(rgb: np.ndarray) -> np.ndarray:
            h, w = rgb.shape[:2]
            big = max(h, w)
            if big <= max_dim:
                return rgb
            scale = max_dim / float(big)
            new_size = (int(round(w * scale)), int(round(h * scale)))
            im = _PILImage.fromarray(rgb, mode="RGB")
            im = im.resize(new_size, _PILImage.Resampling.BILINEAR)
            return np.asarray(im)

        # Encode -----------------------------------------------------------
        base_name = Path(src.name).stem
        pad = max(4, len(str(last)))

        if format == "mp4":
            # imageio's FFMPEG plugin can't write to BytesIO — needs a path.
            # Write to a tempfile, read the bytes, then unlink.
            import imageio
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp_path = tmp.name
            try:
                # libx264 + yuv420p needs even dims; pad odd by 1 on right/bottom.
                first_arr = maybe_resize(render_frame(first))
                h, w = first_arr.shape[:2]
                pad_h = h + (h % 2)
                pad_w = w + (w % 2)

                def even_pad(arr):
                    if arr.shape[0] == pad_h and arr.shape[1] == pad_w:
                        return arr
                    out = np.zeros((pad_h, pad_w, 3), dtype=np.uint8)
                    out[: arr.shape[0], : arr.shape[1]] = arr
                    return out

                with imageio.get_writer(
                    tmp_path, format="ffmpeg", fps=fps, codec="libx264",
                    macro_block_size=1,
                    output_params=[
                        "-pix_fmt", "yuv420p",
                        # Visually-lossless default — crf=18 puts the
                        # encoder at the threshold of perceptual loss.
                        # User-tunable via ?crf= (0=lossless, 51=worst).
                        "-crf", str(int(crf)),
                        # Slow preset gives ~10–15 % smaller files at the
                        # same CRF for the cost of encode time.
                        "-preset", str(preset),
                    ],
                ) as w:
                    w.append_data(even_pad(first_arr))
                    for i in range(first + 1, last + 1):
                        w.append_data(even_pad(maybe_resize(render_frame(i))))
                with open(tmp_path, "rb") as f:
                    body = f.read()
            except HTTPException:
                # M11 P1 fix: don't swallow user-input errors (404 / 422
                # raised by render_frame) into a generic 500.
                raise
            except (RuntimeError, OSError, ImportError) as e:
                # M11 P1 fix: codec / ffmpeg-not-installed → 503 with a
                # clear hint to fall back to GIF or PNG-zip.
                raise HTTPException(
                    503,
                    f"MP4 codec unavailable: {e}. Try format=gif or format=zip.",
                )
            except Exception as e:
                raise HTTPException(
                    500,
                    f"MP4 export failed: {e}. Try GIF or PNG-zip — those use Pillow only.",
                )
            finally:
                try:
                    Path(tmp_path).unlink()
                except OSError:
                    pass
            filename = f"{base_name}_f{first:0{pad}d}-{last:0{pad}d}_{render}.mp4"
            return Response(
                content=body,
                media_type="video/mp4",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-store",
                },
            )
        elif format == "gif":
            import imageio
            buf = io.BytesIO()
            frames = [maybe_resize(render_frame(i)) for i in range(first, last + 1)]
            imageio.mimsave(buf, frames, format="GIF", duration=1.0 / max(0.1, fps))
            filename = f"{base_name}_f{first:0{pad}d}-{last:0{pad}d}_{render}.gif"
            return Response(
                content=buf.getvalue(),
                media_type="image/gif",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-store",
                },
            )
        else:  # zip
            import zipfile
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_STORED) as zf:
                for i in range(first, last + 1):
                    arr = maybe_resize(render_frame(i))
                    fbuf = io.BytesIO()
                    _PILImage.fromarray(arr, mode="RGB").save(fbuf, format="PNG", optimize=False)
                    zf.writestr(f"{base_name}_f{i:0{pad}d}_{render}.png", fbuf.getvalue())
            filename = f"{base_name}_f{first:0{pad}d}-{last:0{pad}d}_{render}.zip"
            return Response(
                content=buf.getvalue(),
                media_type="application/zip",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "no-store",
                },
            )

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
            manual_points_by_channel on each line is optional; when present
            for a requested channel, those profile sample indices override
            that channel's automatic 5-point extrema detection.
        """
        src = _must_get(req.source_id)
        line_inputs = list(req.lines)
        specs = [_line_spec(l) for l in line_inputs]
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
            for line_in, spec in zip(line_inputs, specs):
                try:
                    manual = (line_in.manual_points_by_channel or {}).get(ch)
                    m = measure_line(
                        img,
                        spec,
                        swath_width=8.0,
                        method="five_point",
                        bar_indices=manual.bar_indices if manual else None,
                        gap_indices=manual.gap_indices if manual else None,
                    )
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
    # Playback presets store (M28)
    # ---------------------------------------------------------------------------

    @app.get("/api/playback/presets")
    def playback_presets_list():
        """Return the persisted presets list.

        play-tab-recording-inspection-rescue-v1 M28. Empty when the file
        doesn't exist yet (first-run), so the frontend renders ``Load ▾``
        with no items rather than erroring.
        """
        return {"presets": [p.model_dump() for p in _load_playback_presets()]}

    @app.put("/api/playback/presets")
    def playback_presets_replace(body: PlaybackPresetsBody):
        """Replace the entire presets list. Atomic: write to tmp + rename
        so two concurrent writers can never produce a partial file."""
        _save_playback_presets(body.presets)
        return {"ok": True, "count": len(body.presets)}

    @app.post("/api/sources/delete-files")
    def delete_files(req: DeleteFilesRequest):
        """Permanently delete files from disk, used by the Sources-panel
        multi-select "Delete from disk" flow.

        DESTRUCTIVE. The frontend must show a confirmation dialog
        listing the paths before calling. Per path:

          1. Verify the path corresponds to a tracked source (either
             ``src.path`` or ``src._owned_tempfile``). Untracked paths
             are refused so a malformed body can't unlink arbitrary
             user files (~/.ssh/id_ed25519 etc.).
          2. Verify the extension is in ``_ALLOWED_DISK_EXTS``.
          3. Drop any loaded source whose `path` resolves to this path
             (closes the FrameReader so the file isn't held open).
          4. ``Path.unlink()``. ``follow_symlinks=False`` semantics —
             only the link is removed if the path is itself a symlink;
             we never delete the target of a symlink.
          5. Return a per-path status so partial failures (permission
             error on one file) don't poison the rest.

        Refuses to delete directories or non-existent paths. The body
        is capped at ``_DELETE_FILES_MAX_BATCH`` paths so a malformed
        request can't enumerate STORE for thousands of paths at once.
        """
        from pathlib import Path as _P
        # Build the allow-set: every disk path the server's STORE
        # currently tracks. Resolved up-front so the comparison below
        # is by absolute Path equality, not by string. One source can
        # contribute up to two entries (user path + owned tempfile).
        allowed: Dict[Path, List[str]] = {}
        with STORE._lock:
            for sid, src in STORE._items.items():
                for cand in (
                    getattr(src, "path", None),
                    getattr(src, "_owned_tempfile", None),
                ):
                    if not cand:
                        continue
                    try:
                        rp = _P(cand).resolve()
                    except (OSError, RuntimeError, ValueError):
                        continue
                    allowed.setdefault(rp, []).append(sid)
        results = []
        for raw in req.paths:
            try:
                resolved = _P(raw).expanduser().resolve()
            except (OSError, RuntimeError, ValueError) as e:
                results.append({
                    "path": str(raw), "status": "error",
                    "detail": f"path resolve failed: {type(e).__name__}: {e}",
                })
                continue
            if resolved.suffix.lower() not in _ALLOWED_DISK_EXTS:
                results.append({
                    "path": str(resolved), "status": "error",
                    "detail": (
                        f"refusing extension {resolved.suffix!r}; "
                        f"allowed: {sorted(_ALLOWED_DISK_EXTS)}"
                    ),
                })
                continue
            if resolved not in allowed:
                results.append({
                    "path": str(resolved), "status": "error",
                    "detail": (
                        "refusing — path is not tracked by any loaded "
                        "source. Bulk-delete is restricted to paths the "
                        "frontend has loaded as sources."
                    ),
                })
                continue
            # Drop the loaded source(s) that own this path so the
            # FrameReader closes (releasing any Windows-style file lock
            # before unlink).
            drop_ids = list(allowed.get(resolved, []))
            with STORE._lock:
                for sid in drop_ids:
                    src = STORE._items.pop(sid, None)
                    if src is not None:
                        try:
                            src.close_frame_reader()
                        except Exception:
                            pass
            # Now unlink the file.
            if not resolved.exists() and not resolved.is_symlink():
                results.append({
                    "path": str(resolved), "status": "missing",
                    "dropped_source_ids": drop_ids,
                })
                continue
            if resolved.is_dir() and not resolved.is_symlink():
                results.append({
                    "path": str(resolved), "status": "error",
                    "detail": "refusing to delete a directory",
                    "dropped_source_ids": drop_ids,
                })
                continue
            # B-0042: prefer send2trash (cross-platform undo path).
            # Fall back to a hard unlink if either send2trash isn't
            # importable on this host or the OS-level call fails (e.g.
            # the file is on a removable volume without a Trash). The
            # per-row response carries which path was used so the
            # frontend can show "Sent to Trash" vs "Permanently
            # deleted" copy.
            mode_used = None
            trash_error = None
            try:
                if req.use_trash:
                    try:
                        from send2trash import send2trash as _trash
                        _trash(str(resolved))
                        mode_used = "trash"
                    except Exception as exc:
                        trash_error = (
                            f"{type(exc).__name__}: {exc} "
                            "(falling back to permanent delete)"
                        )
                        resolved.unlink()
                        mode_used = "unlink"
                else:
                    resolved.unlink()
                    mode_used = "unlink"
                row = {
                    "path": str(resolved), "status": "deleted",
                    "deleted_via": mode_used,
                    "dropped_source_ids": drop_ids,
                }
                if trash_error:
                    row["trash_error"] = trash_error
                results.append(row)
            except OSError as e:
                row = {
                    "path": str(resolved), "status": "error",
                    "detail": f"{type(e).__name__}: {e}",
                    "dropped_source_ids": drop_ids,
                }
                if trash_error:
                    row["trash_error"] = trash_error
                results.append(row)
        return {"results": results}

    @app.post("/api/playback/handoff", response_model=SourceSummary)
    def playback_handoff(req: PlaybackHandoffRequest):
        """Materialize one Play-mode frame as a standalone image source so
        USAF / FPN / DoF can analyze it.

        play-tab-recording-inspection-rescue-v1 M30. The new source has
        ``frame_count=1`` and inherits the parent's ISP mode + config +
        dark channels. The frontend dispatches a ``mantis:switch-source``
        custom event with ``{source_id, mode}`` to actually flip the UI.
        """
        try:
            transient = STORE.create_transient_from_frame(
                req.source_id, int(req.frame_index)
            )
        except KeyError:
            raise HTTPException(404, f"unknown source_id: {req.source_id!r}")
        except IndexError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:
            raise HTTPException(409, str(e))
        return _summary(transient)

    @app.delete("/api/playback/presets/{preset_id}")
    def playback_presets_delete(preset_id: str):
        """Remove one preset by id. Returns ``{"ok": True}`` even when
        the id wasn't found (idempotent — the user's intent was satisfied
        either way)."""
        kept = [p for p in _load_playback_presets() if p.id != preset_id]
        _save_playback_presets(kept)
        return {"ok": True, "count": len(kept)}

    @app.post("/api/play/exports")
    def create_play_export(req: MultiSourceVideoRequest):
        """Kick off a multi-source MP4 export as a background job.

        Returns immediately with ``{job_id}``. Frontend polls
        ``GET /api/play/exports/{job_id}`` for progress, then fetches
        the bytes from ``GET /api/play/exports/{job_id}/result`` when
        the job's status flips to ``done``.

        play-export-and-roi-fixes-v1 M4.
        """
        if not req.sources:
            raise HTTPException(400, "sources[] must be non-empty")
        if (req.format or "mp4").lower() != "mp4":
            raise HTTPException(400, "multi-source export currently mp4-only")
        # Pre-flight: resolve every source_id NOW so a typo fails the
        # API call instead of dying mid-render and orphaning a job.
        plan = []
        total_frames = 0
        for spec in req.sources:
            try:
                src = _must_get(spec.source_id)
            except HTTPException:
                raise
            n = int(getattr(src, "frame_count", 0) or 0)
            if n <= 0:
                raise HTTPException(
                    409,
                    f"source {spec.source_id!r} has no frames to export",
                )
            first = max(0, int(spec.start))
            last = (n - 1) if spec.end is None else min(int(spec.end), n - 1)
            if last < first:
                raise HTTPException(
                    400,
                    f"source {spec.source_id!r}: end ({last}) < start ({first})",
                )
            plan.append({"src": src, "spec": spec, "first": first, "last": last})
            total_frames += last - first + 1
        if total_frames > 5000:
            raise HTTPException(
                413,
                f"multi-source export {total_frames} frames exceeds the limit "
                f"of 5000; narrow the per-source frame ranges.",
            )

        label = (
            f"{len(req.sources)} source"
            + ("s" if len(req.sources) != 1 else "")
            + f" · {total_frames} frames @ {req.fps:.0f} fps"
        )

        def _runner(job: ExportJob) -> None:
            import imageio
            import tempfile
            from PIL import Image as _PILImage
            tmp_path: Optional[Path] = None
            writer = None
            try:
                with tempfile.NamedTemporaryFile(
                    suffix=".mp4", delete=False
                ) as fh:
                    tmp_path = Path(fh.name)
                produced = 0
                first_arr_locked: Optional[np.ndarray] = None
                pad_h = pad_w = 0
                # We open the writer lazily on the first frame so the
                # output dims match the actual first-frame render
                # (sources of differing native resolutions still need
                # one consistent canvas size — the runner uses the
                # first source's resized dims as the canonical size).
                for entry in plan:
                    if job.cancel_event.is_set():
                        break
                    src = entry["src"]
                    spec = entry["spec"]
                    first = entry["first"]
                    last = entry["last"]
                    isp_pre_chain = _isp_chain_from_query(
                        sharpen_method=spec.sharpen_method,
                        sharpen_amount=spec.sharpen_amount,
                        sharpen_radius=spec.sharpen_radius,
                        denoise_sigma=spec.denoise_sigma,
                        median_size=spec.median_size,
                        gaussian_sigma=spec.gaussian_sigma,
                        hot_pixel_thr=spec.hot_pixel_thr,
                        bilateral=spec.bilateral,
                    )

                    def _channel_post_isp(
                        img: np.ndarray, ch: str
                    ) -> np.ndarray:
                        if (
                            spec.apply_dark
                            and src.has_dark
                            and src.dark_channels is not None
                        ):
                            d = src.dark_channels.get(ch)
                            if d is not None:
                                img = subtract_dark(img, d)
                        if isp_pre_chain is not None:
                            img = _apply_analysis_isp(img, isp_pre_chain)
                        return _apply_pre_norm(
                            img,
                            black_level=spec.black_level,
                            gain=spec.isp_gain,
                            offset=spec.isp_offset,
                        )

                    def _render(idx: int) -> np.ndarray:
                        chs = src.extract_frame(idx)
                        if spec.render == "rgb_composite":
                            arr = _composite_rgb_array(
                                src,
                                chs,
                                "HG-R" if spec.gain.lower() == "hg" else "LG-R",
                                apply_dark=spec.apply_dark,
                                vmin=spec.vmin,
                                vmax=spec.vmax,
                            )
                            if arr is None:
                                raise RuntimeError(
                                    f"RGB composite unavailable for {spec.source_id}"
                                )
                            return (arr * 255.0).astype(np.uint8)
                        if spec.render == "channel":
                            if not spec.channel:
                                raise RuntimeError(
                                    f"render=channel needs `channel` ({spec.source_id})"
                                )
                            if spec.channel not in chs:
                                raise RuntimeError(
                                    f"channel {spec.channel!r} not in frame {idx}"
                                )
                            img = _channel_post_isp(chs[spec.channel], spec.channel)
                            norm = _norm_to_unit(img, lo=spec.vmin, hi=spec.vmax)
                            cn = (spec.colormap or "gray").lower()
                            if cn in ("gray", "grey", "l", "mono"):
                                g = (norm * 255.0).astype(np.uint8)
                                return np.stack([g, g, g], axis=-1)
                            from matplotlib import colormaps
                            try:
                                cmap = colormaps[cn]
                            except KeyError:
                                cmap = colormaps["gray"]
                            return cmap(norm, bytes=True)[..., :3]
                        if spec.render == "overlay":
                            if not spec.base_channel or not spec.overlay_channel:
                                raise RuntimeError(
                                    "render=overlay needs base_channel + overlay_channel"
                                )
                            base_arr = _composite_rgb_array(
                                src,
                                chs,
                                spec.base_channel,
                                apply_dark=spec.apply_dark,
                                vmin=spec.vmin,
                                vmax=spec.vmax,
                            )
                            if base_arr is None:
                                raise RuntimeError(
                                    "RGB composite unavailable for overlay base"
                                )
                            if spec.overlay_channel not in chs:
                                raise RuntimeError(
                                    f"overlay channel {spec.overlay_channel!r} not in frame {idx}"
                                )
                            ov = chs[spec.overlay_channel]
                            if (
                                spec.apply_dark
                                and src.has_dark
                                and src.dark_channels is not None
                            ):
                                d = src.dark_channels.get(spec.overlay_channel)
                                if d is not None:
                                    ov = subtract_dark(ov, d)
                            ov_norm = _norm_to_unit(
                                ov, lo=spec.overlay_low, hi=spec.overlay_high
                            )
                            from matplotlib import colormaps
                            try:
                                cmap = colormaps[spec.overlay_colormap]
                            except KeyError:
                                cmap = colormaps["inferno"]
                            ov_rgb = cmap(ov_norm)[..., :3].astype(np.float32)
                            mask = ov_norm.astype(np.float32) * float(spec.strength)
                            roi = _polygon_to_roi_mask(spec.mask_polygon, mask.shape)
                            if roi is not None:
                                mask = mask * roi
                            if spec.blend == "additive":
                                out = np.clip(
                                    base_arr + ov_rgb * mask[..., None], 0.0, 1.0
                                )
                            elif spec.blend == "screen":
                                out = 1.0 - (1.0 - base_arr) * (
                                    1.0 - ov_rgb * mask[..., None]
                                )
                            else:
                                out = (
                                    base_arr * (1.0 - mask[..., None])
                                    + ov_rgb * mask[..., None]
                                )
                            return (np.clip(out, 0.0, 1.0) * 255.0).astype(np.uint8)
                        raise RuntimeError(f"unknown render: {spec.render!r}")

                    def _resize(arr: np.ndarray) -> np.ndarray:
                        h, w = arr.shape[:2]
                        big = max(h, w)
                        if big <= req.max_dim:
                            return arr
                        scale = req.max_dim / float(big)
                        im = _PILImage.fromarray(arr, mode="RGB")
                        im = im.resize(
                            (int(round(w * scale)), int(round(h * scale))),
                            _PILImage.Resampling.BILINEAR,
                        )
                        return np.asarray(im)

                    for idx in range(first, last + 1):
                        if job.cancel_event.is_set():
                            break
                        arr = _resize(_render(idx))
                        if writer is None:
                            # First frame — open the writer with the
                            # canonical (even-padded) dims and lock
                            # subsequent frames to match.
                            h, w = arr.shape[:2]
                            pad_h = h + (h & 1)
                            pad_w = w + (w & 1)
                            first_arr_locked = arr
                            writer = imageio.get_writer(
                                str(tmp_path),
                                format="ffmpeg",
                                fps=req.fps,
                                codec="libx264",
                                macro_block_size=1,
                                output_params=[
                                    "-pix_fmt", "yuv420p",
                                    "-crf", str(int(req.crf)),
                                    "-preset", str(req.preset),
                                ],
                            )
                            # Pad to even dims if needed.
                            if pad_h != h or pad_w != w:
                                padded = np.zeros((pad_h, pad_w, 3), dtype=np.uint8)
                                padded[:h, :w] = arr
                                arr = padded
                        else:
                            # Subsequent frames — clamp/pad to the
                            # canonical first-frame dims so the encoder
                            # stays happy with mixed-resolution sources.
                            h, w = arr.shape[:2]
                            if h != pad_h or w != pad_w:
                                tile = np.zeros(
                                    (pad_h, pad_w, 3), dtype=np.uint8
                                )
                                copy_h = min(h, pad_h)
                                copy_w = min(w, pad_w)
                                tile[:copy_h, :copy_w] = arr[:copy_h, :copy_w]
                                arr = tile
                        writer.append_data(arr)
                        produced += 1
                        job.current_frame = produced
                        job.progress = (
                            produced / float(total_frames) if total_frames else 1.0
                        )
                # Snapshot cancel state BEFORE writer.close(). A cancel
                # arriving between the last append_data and writer.close
                # would otherwise discard a fully-encoded MP4 the user
                # could have kept; we only honor cancellation when the
                # encoded frame count fell short of the requested total
                # (i.e. the loop genuinely bailed early). risk-skeptic
                # P1-C.
                cancelled_mid_encode = (
                    job.cancel_event.is_set() and produced < total_frames
                )
                if writer is not None:
                    writer.close()
                if cancelled_mid_encode:
                    job.status = "cancelled"
                    job.finished_at = time.time()
                    if tmp_path and tmp_path.exists():
                        try:
                            tmp_path.unlink()
                        except OSError:
                            pass
                    return
                if produced == 0:
                    raise RuntimeError("no frames rendered")
                job.result_path = tmp_path
                job.result_filename = (
                    f"play_multi_{len(req.sources)}sources_"
                    f"{produced}frames.mp4"
                )
                job.result_media_type = "video/mp4"
                job.status = "done"
                job.progress = 1.0
                job.finished_at = time.time()
            except Exception:
                if writer is not None:
                    try:
                        writer.close()
                    except Exception:
                        pass
                if tmp_path and tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass
                raise

        job = _JOBS.create(
            kind="video_multi", runner=_runner,
            label=label, total_frames=total_frames,
        )
        return {"job_id": job.job_id, "status": job.status, "label": label}

    @app.get("/api/play/exports/{job_id}")
    def get_play_export(job_id: str):
        # Opportunistic cleanup of stale finished jobs on every poll.
        _JOBS.cleanup()
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(404, f"unknown export job {job_id!r}")
        return job.public()

    @app.get("/api/play/exports/{job_id}/result")
    def get_play_export_result(job_id: str):
        job = _JOBS.get(job_id)
        if not job:
            raise HTTPException(404, f"unknown export job {job_id!r}")
        if job.status == "queued" or job.status == "running":
            raise HTTPException(409, f"job {job_id} not finished (status={job.status})")
        if job.status != "done" or not job.result_path or not job.result_path.exists():
            raise HTTPException(
                410,
                f"job {job_id} has no result available "
                f"(status={job.status}, error={job.error or '—'})",
            )
        # Read once into memory then unlink the tempfile + clear the
        # job's result_path so the disk doesn't sit on the bytes for
        # the full TTL window (1 hr). Two concurrent /result fetches
        # race here; the second sees `not result_path.exists()` and
        # 410s, which is acceptable given the user's flow is fetch-
        # then-stop. fastapi-backend-reviewer P1.
        body = job.result_path.read_bytes()
        path = job.result_path
        job.result_path = None
        try:
            path.unlink()
        except OSError:
            pass
        return Response(
            content=body,
            media_type=job.result_media_type or "video/mp4",
            headers={
                "Cache-Control": "no-store",
                "Content-Disposition": (
                    f'attachment; filename="{job.result_filename or "export.mp4"}"'
                ),
            },
        )

    @app.delete("/api/play/exports/{job_id}")
    def cancel_play_export(job_id: str):
        ok = _JOBS.cancel(job_id)
        if not ok:
            raise HTTPException(409, f"job {job_id} not cancellable (already finished or unknown)")
        return {"ok": True}


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
# Playback presets storage helpers (M28)
# ---------------------------------------------------------------------------
#
# Single JSON file at ~/.mantisanalysis/playback-presets.json. Atomic
# writes via tmp + rename. Mode 0600 so other users on a shared host
# can't read another user's saved view configurations. Tests override
# the path via the MANTIS_PRESETS_PATH env var.
# ---------------------------------------------------------------------------

import json
import os
import tempfile
import threading
import time

_PRESETS_LOCK = threading.Lock()


def _playback_presets_path() -> Path:
    override = os.environ.get("MANTIS_PRESETS_PATH")
    if override:
        return Path(override)
    return Path.home() / ".mantisanalysis" / "playback-presets.json"


def _load_playback_presets() -> List["PlaybackPreset"]:
    """Read the presets file. Returns ``[]`` when the file is missing or
    malformed (treated as a fresh start). Raises HTTPException 500 only
    if the file exists but is unreadable for some I/O reason."""
    path = _playback_presets_path()
    if not path.exists():
        return []
    with _PRESETS_LOCK:
        try:
            with path.open("r", encoding="utf-8") as f:
                raw = json.load(f)
        except (json.JSONDecodeError, OSError):
            # First-corrupt-then-fix is treated as a fresh start; the
            # next save will overwrite the malformed file. Log so an
            # operator notices.
            import traceback
            traceback.print_exc()
            return []
    presets_raw = raw.get("presets") if isinstance(raw, dict) else None
    if not isinstance(presets_raw, list):
        return []
    out: List[PlaybackPreset] = []
    for item in presets_raw:
        try:
            out.append(PlaybackPreset(**item))
        except Exception:
            # Skip malformed rows so one bad entry doesn't kill the whole
            # list. Logged but not raised.
            import traceback
            traceback.print_exc()
            continue
    return out


def _save_playback_presets(presets: List["PlaybackPreset"]) -> None:
    """Atomic write: tmp file → fsync → rename. Mode 0600 on the final
    file so other users on a shared host can't read it."""
    path = _playback_presets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"presets": [p.model_dump() for p in presets]}
    body = json.dumps(payload, indent=2, sort_keys=False).encode("utf-8")
    with _PRESETS_LOCK:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=str(path.parent), prefix=".presets-",
            suffix=".tmp", delete=False,
        ) as tf:
            tmp_path = Path(tf.name)
            tf.write(body)
            tf.flush()
            os.fsync(tf.fileno())
        try:
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, path)
        except Exception:
            try:
                tmp_path.unlink()
            except OSError:
                pass
            raise


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


def _resolve_hdr_channels(
    chs: Dict[str, np.ndarray],
    hdr_fusion: str,
) -> Dict[str, np.ndarray]:
    """Optionally replace cached HDR-* channels with a re-fusion under a
    different fusion mode.

    ``extract_frame`` populates ``HDR-{R,G,B,NIR,Y}`` using the source
    default fusion mode (``"switch"`` — hard threshold; cache key
    stays stable per frame). When the user picks a different mode in
    the Inspector ("mertens" — smoothstep blend), this helper re-fuses
    on top of the cache without invalidating it. Cost: 4 NumPy
    re-fusions + a Rec-601 Y recompute, well under 5 ms on
    1024×1024 channels.

    No-op when ``hdr_fusion`` is empty / "switch" (the default fusion
    is already in the cache) or when the source isn't a dual-gain
    RGB-NIR layout (no HG-/LG- pairs to re-fuse).
    """
    if not hdr_fusion or hdr_fusion.lower() == "switch":
        return chs
    needed = ("HG-R", "HG-G", "HG-B", "HG-NIR",
              "LG-R", "LG-G", "LG-B", "LG-NIR")
    if not all(k in chs for k in needed):
        return chs
    from .hdr_fusion import fuse_hdr
    params = {"fusion": hdr_fusion.lower()}
    out = dict(chs)
    for c in ("R", "G", "B", "NIR"):
        out[f"HDR-{c}"] = fuse_hdr(chs[f"HG-{c}"], chs[f"LG-{c}"], params=params)
    r = out["HDR-R"].astype(np.float32, copy=False)
    g = out["HDR-G"].astype(np.float32, copy=False)
    b = out["HDR-B"].astype(np.float32, copy=False)
    out["HDR-Y"] = (0.299 * r + 0.587 * g + 0.114 * b).astype(np.float32, copy=False)
    return out


# Reusable Query schema for the per-render HDR fusion mode. Keeping
# the pattern in one place so every route honors the same allow-list.
_HDR_FUSION_PATTERN = r"^(switch|mertens)$"


def _isp_chain_from_query(*, sharpen_method: Optional[str],
                          sharpen_amount: float, sharpen_radius: float,
                          denoise_sigma: float,
                          median_size: int, gaussian_sigma: float,
                          hot_pixel_thr: float, bilateral: bool,
                          ) -> Optional[ISPParams]:
    """Return an ``ISPParams`` for the non-linear sharpen / FPN chain
    when at least one stage is active, else ``None`` so render paths
    short-circuit.

    play-tab-recording-inspection-rescue-v1 M26. Mirrors the activation
    gating used by the legacy USAF ``channel_thumbnail`` route at line
    790-792. ``black_level`` is intentionally excluded — Play's linear
    chain (``_apply_pre_norm``) already handles it; passing 0 here
    avoids double-subtraction.
    """
    any_sharpen_chain = (
        (sharpen_method and sharpen_method not in ("", "None"))
        or denoise_sigma > 0.05
    )
    any_fpn_chain = (
        median_size >= 3 or gaussian_sigma > 0.05
        or hot_pixel_thr > 0.5 or bilateral
    )
    if not (any_sharpen_chain or any_fpn_chain):
        return None
    return ISPParams(
        sharpen_method=sharpen_method,
        sharpen_amount=sharpen_amount,
        sharpen_radius=sharpen_radius,
        denoise_sigma=denoise_sigma,
        black_level=0.0,
        median_size=median_size,
        gaussian_sigma=gaussian_sigma,
        hot_pixel_thr=hot_pixel_thr,
        bilateral=bilateral,
    )


def _grading_from_query(*, gain_r, gain_g, gain_b,
                        offset_r, offset_g, offset_b,
                        gamma_g, brightness_g, contrast_g,
                        saturation_g, wb_kelvin) -> Optional[Dict[str, Any]]:
    """Build a grading dict for ``apply_grading`` when any field is
    non-default, else return None so the render path can short-circuit.

    Caller is responsible for converting query-string types to floats /
    None already; this helper just packages them.
    """
    eps = 1e-6
    has_change = (
        abs(gain_r - 1.0) > eps or abs(gain_g - 1.0) > eps or abs(gain_b - 1.0) > eps
        or abs(offset_r) > eps or abs(offset_g) > eps or abs(offset_b) > eps
        or abs(gamma_g - 1.0) > eps or abs(brightness_g) > eps
        or abs(contrast_g - 1.0) > eps or abs(saturation_g - 1.0) > eps
        or (wb_kelvin is not None and abs(wb_kelvin - 6500.0) > 1.0)
    )
    if not has_change:
        return None
    return {
        "gain_r": gain_r, "gain_g": gain_g, "gain_b": gain_b,
        "offset_r": offset_r, "offset_g": offset_g, "offset_b": offset_b,
        "gamma": gamma_g, "brightness": brightness_g,
        "contrast": contrast_g, "saturation": saturation_g,
        "wb_kelvin": wb_kelvin,
    }


def _render_tiled_view_to_rgb(spec: "TiledExportViewSpec", *,
                              max_dim: int,
                              override_frame_index: Optional[int] = None,
                              ) -> np.ndarray:
    """Render one view spec to (H, W, 3) uint8.

    Used by both the M23 image-tiled and M24 video-tiled routes.
    `override_frame_index` lets the video route advance frames without
    mutating the spec dict each tick. Frame index is clamped to the
    source's `frame_count`.

    Raises HTTPException on bad source_id / channel / out-of-range frame.
    """
    from PIL import Image as _PILImage
    try:
        src = STORE.get(spec.source_id)
    except KeyError:
        raise HTTPException(
            404, f"unknown source_id in tiled export: {spec.source_id!r}"
        )
    frame_index = int(spec.frame_index if override_frame_index is None
                      else override_frame_index)
    # Clamp so streams of differing length stay renderable.
    frame_index = max(0, min(frame_index, int(getattr(src, "frame_count", 1)) - 1))
    try:
        chs = src.extract_frame(frame_index)
    except IndexError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    grading = _grading_from_query(
        gain_r=spec.grading_gain_r, gain_g=spec.grading_gain_g,
        gain_b=spec.grading_gain_b,
        offset_r=spec.grading_offset_r, offset_g=spec.grading_offset_g,
        offset_b=spec.grading_offset_b,
        gamma_g=spec.grading_gamma, brightness_g=spec.grading_brightness,
        contrast_g=spec.grading_contrast, saturation_g=spec.grading_saturation,
        wb_kelvin=spec.grading_wb_kelvin,
    )
    # M26 — non-linear sharpen / FPN chain (None when no stage active).
    isp_pre_chain = _isp_chain_from_query(
        sharpen_method=spec.sharpen_method,
        sharpen_amount=spec.sharpen_amount,
        sharpen_radius=spec.sharpen_radius,
        denoise_sigma=spec.denoise_sigma,
        median_size=spec.median_size,
        gaussian_sigma=spec.gaussian_sigma,
        hot_pixel_thr=spec.hot_pixel_thr,
        bilateral=spec.bilateral,
    )
    r = (spec.render or "rgb_composite").lower()
    if r == "rgb_composite":
        prefix = (
            "HG-" if spec.gain.lower() == "hg"
            else "LG-" if spec.gain.lower() == "lg"
            else "HDR-"
        )
        arr = _composite_rgb_array(
            src, chs, prefix + "R",
            apply_dark=spec.apply_dark,
            vmin=spec.vmin, vmax=spec.vmax,
            normalize=spec.normalize,
            black_level=spec.black_level, gain=spec.isp_gain,
            offset=spec.offset,
            brightness=spec.isp_brightness, contrast=spec.isp_contrast,
            gamma=spec.isp_gamma,
            grading=grading,
            isp_pre_chain=isp_pre_chain,
        )
        if arr is None:
            raise HTTPException(
                422,
                f"RGB composite unavailable for {spec.source_id!r} "
                f"under ISP {src.isp_mode_id!r}",
            )
        rgb_u8 = (arr * 255.0).astype(np.uint8)
    elif r == "channel":
        if not spec.channel or spec.channel not in chs:
            raise HTTPException(
                404,
                f"channel {spec.channel!r} not in frame {frame_index}",
            )
        img = chs[spec.channel]
        if (
            spec.apply_dark and src.has_dark
            and src.dark_channels is not None
        ):
            d = src.dark_channels.get(spec.channel)
            if d is not None:
                img = subtract_dark(img, d)
        # M26 — non-linear sharpen / FPN chain on raw DN values
        # (matches the per-frame channel route ordering).
        if isp_pre_chain is not None:
            img = _apply_analysis_isp(img, isp_pre_chain)
        img = _apply_pre_norm(
            img, black_level=spec.black_level,
            gain=spec.isp_gain, offset=spec.offset,
        )
        png_bytes = channel_to_png_bytes(
            img, max_dim=max_dim,
            colormap=spec.colormap or "gray",
            vmin=spec.vmin, vmax=spec.vmax,
            show_clipping=spec.show_clipping,
            normalize_mode=spec.normalize,
            brightness=spec.isp_brightness,
            contrast=spec.isp_contrast,
            gamma=spec.isp_gamma,
        )
        im_ch = _PILImage.open(io.BytesIO(png_bytes)).convert("RGB")
        rgb_u8 = np.asarray(im_ch, dtype=np.uint8)
    elif r == "overlay":
        if not spec.base_channel or not spec.overlay_channel:
            raise HTTPException(
                400,
                "render=overlay requires base_channel and overlay_channel",
            )
        base_arr = _composite_rgb_array(
            src, chs, spec.base_channel,
            apply_dark=spec.apply_dark, normalize="auto",
        )
        if base_arr is None:
            raise HTTPException(422, "RGB base unavailable for overlay")
        if spec.overlay_channel not in chs:
            raise HTTPException(
                404,
                f"overlay channel {spec.overlay_channel!r} not in frame "
                f"{frame_index}",
            )
        ov = chs[spec.overlay_channel]
        if (
            spec.apply_dark and src.has_dark
            and src.dark_channels is not None
        ):
            d = src.dark_channels.get(spec.overlay_channel)
            if d is not None:
                ov = subtract_dark(ov, d)
        ov_norm = _norm_to_unit(
            ov, lo=spec.overlay_low, hi=spec.overlay_high, mode="auto",
        )
        from matplotlib import colormaps
        try:
            cmap = colormaps[spec.overlay_colormap]
        except KeyError:
            cmap = colormaps["inferno"]
        ov_rgb = cmap(ov_norm)[..., :3].astype(np.float32)
        s = float(spec.strength)
        mask = ov_norm.astype(np.float32) * s
        # Polygon ROI clip — overlay composites inside the polygon only.
        roi = _polygon_to_roi_mask(spec.mask_polygon, mask.shape)
        if roi is not None:
            mask = mask * roi
        if spec.blend == "additive":
            out = np.clip(
                base_arr + ov_rgb * mask[..., None], 0.0, 1.0,
            )
        elif spec.blend == "screen":
            out = 1.0 - (1.0 - base_arr) * (
                1.0 - ov_rgb * mask[..., None]
            )
        else:
            out = (
                base_arr * (1.0 - mask[..., None])
                + ov_rgb * mask[..., None]
            )
        rgb_u8 = (np.clip(out, 0.0, 1.0) * 255.0).astype(np.uint8)
    else:
        raise HTTPException(400, f"unknown render: {spec.render!r}")
    # Resize to per-tile max_dim cap.
    cap = int(max_dim)
    h, w = rgb_u8.shape[:2]
    big = max(h, w)
    if big > cap > 0:
        scale = cap / float(big)
        im = _PILImage.fromarray(rgb_u8, mode="RGB")
        im = im.resize(
            (int(round(w * scale)), int(round(h * scale))),
            _PILImage.Resampling.BILINEAR,
        )
        rgb_u8 = np.asarray(im, dtype=np.uint8)
    # Apply burn-in labels.
    cfg = {
        "timestamp": spec.label_timestamp, "frame": spec.label_frame,
        "channel": spec.label_channel, "source_file": spec.label_source,
        "scale_bar": spec.label_scale_bar,
        "position": spec.label_position,
        "font_size": spec.label_font_size,
    }
    if any(cfg.get(k) for k in ("timestamp", "frame", "channel",
                                "source_file", "scale_bar")):
        ts = None
        if cfg.get("timestamp") and getattr(
            src, "per_frame_timestamps", None
        ) is not None:
            try:
                ts = float(src.per_frame_timestamps[frame_index])
            except Exception:
                ts = None
        fc = dict(cfg)
        fc["ts_value"] = ts
        fc["frame_index"] = frame_index
        fc["channel_name"] = (
            spec.channel
            or (f"RGB · {spec.gain.upper()}" if r == "rgb_composite"
                else None)
        )
        fc["source_name"] = getattr(src, "name", None)
        rgb_u8 = render_labels(rgb_u8, fc)
    return rgb_u8


def _layout_cells(n: int, layout: str) -> tuple[int, int, list, int]:
    """Resolve a layout selector to ``(rows, cols, cells, n_used)``.

    Each cell entry is ``(row, col)`` or ``(row, col, row_span, col_span)``.
    `n_used` is the number of input tiles actually placed (e.g. 4x2 caps
    at 8). play-tab-recording-inspection-rescue-v1 M23/M24.
    """
    layout = (layout or "auto").lower()
    if layout == "1xn":
        rows, cols = 1, n
        cells = [(0, i) for i in range(n)]
    elif layout == "2xm":
        cols = 2
        rows = (n + cols - 1) // cols
        cells = [(i // cols, i % cols) for i in range(n)]
    elif layout == "3plus1":
        small = max(1, n - 1)
        rows, cols = small, 2
        cells = [(0, 1, rows, 1)]
        for i in range(1, min(n, small + 1)):
            cells.append((i - 1, 0, 1, 1))
    elif layout == "4x2":
        cols = 4
        rows = 2
        n = min(n, 8)
        cells = [(i // cols, i % cols) for i in range(n)]
    else:  # auto
        if n <= 1:
            rows, cols = 1, 1
        elif n == 2:
            rows, cols = 1, 2
        elif n <= 4:
            rows, cols = 2, 2
        elif n <= 6:
            rows, cols = 2, 3
        elif n <= 9:
            rows, cols = 3, 3
        else:
            rows, cols = 3, 4
        cells = [(i // cols, i % cols) for i in range(n)]
    return rows, cols, cells, n


def _compose_tiled_canvas(tiles: list, *,
                          layout: str,
                          gap_px: int,
                          background: str,
                          ) -> "Image.Image":
    """Composite a list of (H, W, 3) uint8 tiles onto a single PIL canvas.

    Cell sizes per row/col are the max width/height of any tile assigned
    there so nothing gets cropped. Tiles whose intrinsic size exceeds
    their cell are downscaled with bilinear; tiles smaller than their
    cell are centered. play-tab-recording-inspection-rescue-v1 M23/M24.
    """
    from PIL import Image as _PILImage
    n = len(tiles)
    rows, cols, cells, n_used = _layout_cells(n, layout)
    tiles = tiles[:n_used]
    col_w = [0] * cols
    row_h = [0] * rows
    for i, t in enumerate(tiles):
        cell = cells[i]
        row, col = cell[0], cell[1]
        row_span = cell[2] if len(cell) > 2 else 1
        col_span = cell[3] if len(cell) > 3 else 1
        h, w = t.shape[:2]
        per_col = (w + col_span - 1) // col_span
        per_row = (h + row_span - 1) // row_span
        for c in range(col, col + col_span):
            if c < cols:
                col_w[c] = max(col_w[c], per_col)
        for r in range(row, row + row_span):
            if r < rows:
                row_h[r] = max(row_h[r], per_row)
    gap = max(0, int(gap_px or 0))
    try:
        bg_color = _PILImage.new("RGB", (1, 1), background or "#000000").getpixel((0, 0))
    except Exception:
        bg_color = (0, 0, 0)
    canvas_w = sum(col_w) + gap * (cols + 1)
    canvas_h = sum(row_h) + gap * (rows + 1)
    canvas = _PILImage.new("RGB", (canvas_w, canvas_h), bg_color)
    col_x = [0]
    for w in col_w:
        col_x.append(col_x[-1] + w)
    row_y = [0]
    for h in row_h:
        row_y.append(row_y[-1] + h)
    for i, t in enumerate(tiles):
        cell = cells[i]
        row, col = cell[0], cell[1]
        row_span = cell[2] if len(cell) > 2 else 1
        col_span = cell[3] if len(cell) > 3 else 1
        cell_w = sum(col_w[col:col + col_span]) + gap * (col_span - 1)
        cell_h = sum(row_h[row:row + row_span]) + gap * (row_span - 1)
        tile_im = _PILImage.fromarray(t, mode="RGB")
        tw, th = tile_im.size
        scale = min(cell_w / max(1, tw), cell_h / max(1, th))
        if scale < 1.0:
            tile_im = tile_im.resize(
                (max(1, int(round(tw * scale))),
                 max(1, int(round(th * scale)))),
                _PILImage.Resampling.BILINEAR,
            )
        tw, th = tile_im.size
        x = gap + col_x[col] + (cell_w - tw) // 2 + gap * col
        y = gap + row_y[row] + (cell_h - th) // 2 + gap * row
        canvas.paste(tile_im, (x, y))
    return canvas


def _maybe_burn_labels(png_bytes: bytes,
                       *,
                       src,
                       frame_index: int,
                       channel_name: Optional[str],
                       cfg: Dict[str, Any]) -> bytes:
    """Run ``render_labels`` over a PNG payload when any label flag is on.

    Re-decodes the PNG to numpy, paints the labels via ``mantisanalysis.
    labels.render_labels``, re-encodes. Skipped when no flag is set so
    the per-frame route stays cheap. Pulls per-frame timestamp from
    ``src.per_frame_timestamps`` and the source filename from ``src.name``
    so the frontend doesn't have to round-trip them.
    """
    if not cfg or not any((
        cfg.get("frame"),
        cfg.get("timestamp"),
        cfg.get("channel"),
        cfg.get("source_file"),
        cfg.get("scale_bar"),
        cfg.get("processing_badges"),
    )):
        return png_bytes
    from PIL import Image
    import io as _io
    im = Image.open(_io.BytesIO(png_bytes))
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    arr = np.asarray(im, dtype=np.uint8)
    # Resolve per-frame metadata for the label config.
    ts_value = None
    if cfg.get("timestamp") and getattr(src, "per_frame_timestamps", None) is not None:
        try:
            ts_value = float(src.per_frame_timestamps[int(frame_index)])
        except Exception:
            ts_value = None
    fc = dict(cfg)
    fc.setdefault("ts_value", ts_value)
    fc.setdefault("frame_index", int(frame_index))
    fc.setdefault("channel_name", channel_name)
    fc.setdefault("source_name", getattr(src, "name", None))
    out = render_labels(arr, fc)
    if out is None:
        return png_bytes
    out_im = Image.fromarray(out, mode=im.mode if im.mode in ("RGB", "RGBA") else "RGB")
    buf = _io.BytesIO()
    out_im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


def _norm_to_unit(a: np.ndarray, *,
                  lo: Optional[float] = None,
                  hi: Optional[float] = None,
                  pct_lo: float = 1.0,
                  pct_hi: float = 99.5,
                  mode: str = "none",
                  dtype_max: Optional[float] = None) -> np.ndarray:
    """Normalize a 2-D array to ``[0, 1]`` for compositing.

    Modes (M22 — defaults are consistent across modes):
      * ``"none"`` (default) — render against the data type's full
        positive range so the image's TRUE brightness is visible. HG
        renders bright (uses ~10-30k of 16-bit range), LG renders dim
        (≪1k of range) without auto-percentile artificially boosting
        either. User-supplied ``lo``/``hi`` override the [0, dtype_max]
        defaults so threshold sliders still work.
      * ``"auto"`` — 1st / 99.5th percentile clip. User-supplied
        ``lo``/``hi`` override the percentile bound on that side.
      * ``"manual"`` — explicit ``lo``/``hi`` bounds; missing-side
        falls back to percentile for that side only.

    User Low/High threshold sliders ALWAYS take effect when set,
    regardless of mode — the mode just chooses what the *missing*
    bound defaults to (dtype-max for none, percentile for auto/manual).

    Mirrors ``channel_to_png_bytes`` so all Play-mode rendering paths
    use the same rule.
    """
    af = a.astype(np.float32, copy=False)
    # Resolve default bounds per mode.
    if mode == "none":
        if dtype_max is None:
            try:
                dtype_max = float(np.iinfo(a.dtype).max)
            except (ValueError, TypeError):
                dtype_max = 65535.0
        default_lo = 0.0
        default_hi = max(1.0, float(dtype_max))
    else:
        # auto / manual: percentile-derived defaults.
        default_lo = float(np.percentile(af, pct_lo))
        default_hi = float(np.percentile(af, pct_hi))
    eff_lo = float(lo) if lo is not None else default_lo
    eff_hi = float(hi) if hi is not None else default_hi
    if eff_hi <= eff_lo:
        eff_hi = eff_lo + 1.0
    return np.clip((af - eff_lo) / (eff_hi - eff_lo), 0.0, 1.0)


def _apply_isp(norm: np.ndarray, *,
               brightness: float = 0.0,
               contrast: float = 1.0,
               gamma: float = 1.0) -> np.ndarray:
    """Apply post-normalize ISP curve: contrast around 0.5, then
    additive brightness, then gamma. Inputs/outputs in [0, 1].

    Order matches photographic convention: contrast pivots around the
    mid-gray, brightness shifts the result, gamma reshapes the curve.
    A no-op default (1, 0, 1) leaves ``norm`` unchanged.
    """
    out = norm
    if abs(contrast - 1.0) > 1e-6:
        out = (out - 0.5) * float(contrast) + 0.5
    if abs(brightness) > 1e-6:
        out = out + float(brightness)
    out = np.clip(out, 0.0, 1.0)
    if abs(gamma - 1.0) > 1e-6 and float(gamma) > 0:
        out = np.power(out, 1.0 / float(gamma))
    return out


def _polygon_to_roi_mask(
    points: Optional[Any], shape: Tuple[int, int],
) -> Optional[np.ndarray]:
    """Rasterize a user-drawn polygon into a binary {0.0, 1.0} float32
    mask of ``shape = (H, W)``. Multiplied into the overlay's alpha mask
    so the colormapped overlay only blends inside the polygon while the
    base shows through everywhere else.

    Accepts either a JSON-encoded string (query-string callers like
    ``frame_overlay`` and ``export_video``) or an already-parsed
    list-of-pairs (Pydantic body callers like ``TiledExportViewSpec``).
    Returns ``None`` for empty / null / fewer-than-3-vertex inputs so
    callers can treat "no polygon" as the no-clip path.

    Raises ``HTTPException(400)`` on parse failure to preserve the
    error contract of the original inline rasterizer at frame_overlay.
    """
    if points is None or points == "" or points == []:
        return None
    if isinstance(points, str):
        try:
            import json as _json
            points = _json.loads(points)
        except Exception as exc:
            raise HTTPException(400, f"invalid mask_polygon JSON: {exc}")
    if not isinstance(points, list) or len(points) < 3:
        return None
    try:
        from PIL import Image as _PI, ImageDraw as _PID
        H, W = int(shape[0]), int(shape[1])
        # Pillow expects [(x, y), …]; clip out-of-bounds gracefully so a
        # stray drag doesn't 500.
        poly = [(float(p[0]), float(p[1])) for p in points]
        canvas = _PI.new("L", (W, H), 0)
        _PID.Draw(canvas).polygon(poly, fill=255)
        return np.asarray(canvas, dtype=np.float32) / 255.0
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            400, f"polygon rasterize failed: {type(exc).__name__}: {exc}"
        )


def _apply_pre_norm(image: np.ndarray, *,
                    black_level: float = 0.0,
                    gain: float = 1.0,
                    offset: float = 0.0) -> np.ndarray:
    """Pre-normalize linear correction: subtract black level (clamped
    ≥0), then ``out = image * gain + offset``. Output dtype stays
    float32 so downstream normalize/colormap doesn't overflow.
    """
    a = image.astype(np.float32, copy=False)
    if abs(black_level) > 1e-9:
        a = np.maximum(a - float(black_level), 0.0)
    if abs(gain - 1.0) > 1e-9:
        a = a * float(gain)
    if abs(offset) > 1e-9:
        a = a + float(offset)
    return a


def _composite_rgb_array(src, chs: Dict[str, np.ndarray], channel: str,
                         *, apply_dark: bool = True,
                         vmin: Optional[float] = None,
                         vmax: Optional[float] = None,
                         normalize: str = "none",
                         black_level: float = 0.0,
                         gain: float = 1.0,
                         offset: float = 0.0,
                         brightness: float = 0.0,
                         contrast: float = 1.0,
                         gamma: float = 1.0,
                         grading: Optional[Dict[str, Any]] = None,
                         isp_pre_chain: Optional[ISPParams] = None,
                         ) -> Optional[np.ndarray]:
    """Build an (H, W, 3) float32 in [0,1] composite for a per-frame
    channel dict ``chs`` taken from ``src.extract_frame(...)``.

    Returns None when the source's active ISP mode doesn't expose RGB
    channels under the implied gain prefix. play-tab-recording-
    inspection-rescue-v1 M1; M20.1 hotfix adds normalize / black /
    gain / brightness / contrast / gamma so HG vs LG show their true
    relative brightness when ``normalize='none'``.
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
    if mode.dual_gain:
        prefix = "HG-"
        if isinstance(channel, str) and channel.startswith("LG-"):
            prefix = "LG-"
        elif isinstance(channel, str) and channel.startswith("HDR-"):
            # M25 — HDR fusion produces HDR-R/G/B/NIR alongside HG-/LG-.
            prefix = "HDR-"
        r_key = f"{prefix}{r_name}"
        g_key = f"{prefix}{g_name}"
        b_key = f"{prefix}{b_name}"
    else:
        r_key, g_key, b_key = r_name, g_name, b_name
    if not all(k in chs for k in (r_key, g_key, b_key)):
        return None
    r = chs[r_key].astype(np.float32, copy=False)
    g = chs[g_key].astype(np.float32, copy=False)
    b = chs[b_key].astype(np.float32, copy=False)
    if apply_dark and src.has_dark and src.dark_channels is not None:
        for k, arr in (("r", r), ("g", g), ("b", b)):
            d = src.dark_channels.get({"r": r_key, "g": g_key, "b": b_key}[k])
            if d is not None:
                if k == "r":
                    r = subtract_dark(r, d).astype(np.float32, copy=False)
                elif k == "g":
                    g = subtract_dark(g, d).astype(np.float32, copy=False)
                else:
                    b = subtract_dark(b, d).astype(np.float32, copy=False)
    # M26 — non-linear sharpen / FPN chain on raw DN values per channel
    # (matches the channel-route ordering: dark → analysis ISP → pre-norm).
    if isp_pre_chain is not None:
        r = _apply_analysis_isp(r, isp_pre_chain).astype(np.float32, copy=False)
        g = _apply_analysis_isp(g, isp_pre_chain).astype(np.float32, copy=False)
        b = _apply_analysis_isp(b, isp_pre_chain).astype(np.float32, copy=False)
    # M20.1 — pre-normalize ISP linear correction.
    r = _apply_pre_norm(r, black_level=black_level, gain=gain, offset=offset)
    g = _apply_pre_norm(g, black_level=black_level, gain=gain, offset=offset)
    b = _apply_pre_norm(b, black_level=black_level, gain=gain, offset=offset)
    rn = _norm_to_unit(r, lo=vmin, hi=vmax, mode=normalize)
    gn = _norm_to_unit(g, lo=vmin, hi=vmax, mode=normalize)
    bn = _norm_to_unit(b, lo=vmin, hi=vmax, mode=normalize)
    rn = _apply_isp(rn, brightness=brightness, contrast=contrast, gamma=gamma)
    gn = _apply_isp(gn, brightness=brightness, contrast=contrast, gamma=gamma)
    bn = _apply_isp(bn, brightness=brightness, contrast=contrast, gamma=gamma)
    out = np.dstack([rn, gn, bn]).astype(np.float32, copy=False)
    # M22 — server-side per-channel RGB grading (per-channel gain/offset,
    # WB Kelvin, gamma, brightness, contrast, saturation). No-op when
    # grading dict is None or every field is at default.
    if grading:
        out = apply_grading(out, grading).astype(np.float32, copy=False)
    return out


def _build_rgb_composite_png_from_channels(src, chs: Dict[str, np.ndarray],
                                           channel: str, *,
                                           max_dim: int = 1600,
                                           vmin: Optional[float] = None,
                                           vmax: Optional[float] = None,
                                           apply_dark: bool = True,
                                           normalize: str = "none",
                                           black_level: float = 0.0,
                                           gain: float = 1.0,
                                           offset: float = 0.0,
                                           brightness: float = 0.0,
                                           contrast: float = 1.0,
                                           gamma: float = 1.0,
                                           grading: Optional[Dict[str, Any]] = None,
                                           isp_pre_chain: Optional[ISPParams] = None,
                                           ) -> Optional[bytes]:
    """PNG-encode the per-frame RGB composite array. play-tab-
    recording-inspection-rescue-v1 M1; M20.1 ISP pipeline; M22 grading;
    M26 sharpen/FPN chain (``isp_pre_chain``)."""
    arr = _composite_rgb_array(src, chs, channel,
                               apply_dark=apply_dark,
                               vmin=vmin, vmax=vmax,
                               normalize=normalize,
                               black_level=black_level, gain=gain, offset=offset,
                               brightness=brightness, contrast=contrast, gamma=gamma,
                               grading=grading, isp_pre_chain=isp_pre_chain)
    if arr is None:
        return None
    u8 = (arr * 255.0).astype(np.uint8)
    from PIL import Image
    im = Image.fromarray(u8, mode="RGB")
    if max(im.size) > max_dim:
        scale = max_dim / float(max(im.size))
        new_size = (int(im.size[0] * scale), int(im.size[1] * scale))
        im = im.resize(new_size, Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=False)
    return buf.getvalue()


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


def _synthetic_usaf_raw_mosaic(channels: Dict[str, np.ndarray]) -> np.ndarray:
    """Re-interleave the synthetic per-channel arrays into a Bayer mosaic
    that ``extract_with_mode(raw, RGB_NIR, defaults)`` would demosaic
    back to the same per-channel set.

    Lets the synthetic sample source (created by ``/api/sources/load-sample``)
    cache a real ``raw_frame`` on the LoadedSource so ``reconfigure_isp``
    works end-to-end — including geometry tweaks (origin / sub_step /
    outer_stride) and rename overrides. Without this, the dialog's Apply
    button produced a 400 ("source has no cached raw frame") for users
    who tried the workflow on the synthetic sample.

    Layout: dual-gain split horizontally (HG left, LG right), each half a
    4×4 super-pixel. Within each half:
        B   @ (0, 0)        R   @ (0, 2)
        G   @ (2, 0)        NIR @ (2, 2)
    Unused mosaic positions get the per-pixel mean across the four
    populated channels so the raw frame still looks like a plausible
    gradient (matters mostly for the Display section's histogram preview).
    """
    H_pc, W_pc = next(iter(channels.values())).shape
    half_h = 4 * H_pc
    half_w = 4 * W_pc
    full_w = 2 * half_w
    raw = np.zeros((half_h, full_w), dtype=np.uint16)
    # Each half is `half_w` wide; populate via per-half views so the
    # column slices stride within the half rather than across both halves.
    hg_half = raw[:, :half_w]
    lg_half = raw[:, half_w:]
    hg_half[0::4, 0::4] = channels["HG-B"]
    hg_half[0::4, 2::4] = channels["HG-R"]
    hg_half[2::4, 0::4] = channels["HG-G"]
    hg_half[2::4, 2::4] = channels["HG-NIR"]
    lg_half[0::4, 0::4] = channels["LG-B"]
    lg_half[0::4, 2::4] = channels["LG-R"]
    lg_half[2::4, 0::4] = channels["LG-G"]
    lg_half[2::4, 2::4] = channels["LG-NIR"]
    # Fill unused mosaic positions with a per-half mean so the raw frame
    # has a coherent intensity profile (the histogram + thumbnail paths
    # never look at these positions, but a sane neighbour is friendlier
    # than a hole of zeros).
    for half_view, prefix in ((hg_half, "HG-"), (lg_half, "LG-")):
        mean = (channels[prefix + "R"].astype(np.float32)
                + channels[prefix + "G"].astype(np.float32)
                + channels[prefix + "B"].astype(np.float32)
                + channels[prefix + "NIR"].astype(np.float32)) / 4.0
        mean_u16 = np.clip(mean, 0, 65535).astype(np.uint16)
        used = {(0, 0), (0, 2), (2, 0), (2, 2)}
        for r in range(4):
            for c in range(4):
                if (r, c) in used:
                    continue
                half_view[r::4, c::4] = mean_u16
    return raw


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
