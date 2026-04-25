# DATA_MODEL — recording-inspection-implementation-v1

> Companion to ExecPlan.md / API_DESIGN.md / UI_IMPLEMENTATION_NOTES.md.
> Source of truth for every dataclass, dict shape, and serialization
> contract introduced by Playback.

Last updated: 2026-04-24

## 0. Overview

```
                                         (client / browser)
                                          ┌────────────────┐
                                          │  React state   │
                                          │ usePlaybackState│
                                          └──────┬─────────┘
                                                 │ JSON over HTTP
                                                 ▼
              ┌───────────────────────── server ───────────────────────────┐
              │                                                            │
              │   PlaybackStore (in-memory, LRU)                           │
              │     ├── RecordingHandle  (recording_id → handle)           │
              │     │     └── lazy h5py.File access (no full-load)         │
              │     ├── DarkHandle       (dark_id → master dark)           │
              │     ├── Stream           (stream_id → ordered handles)     │
              │     ├── ExportJob        (job_id → progress + bytes)       │
              │     └── frame LRU cache  ((rec_id, local_frame) → ndarray) │
              │                                                            │
              │  Pure-NumPy modules:                                       │
              │    recording.py      → RecordingMeta, inspect_recording   │
              │    dark_frame.py     → MasterDark, average_dark_h5        │
              │    playback_pipeline → render_frame() (one entry point)   │
              │    playback_export   → export_image / export_video        │
              └────────────────────────────────────────────────────────────┘
```

## 1. Frozen invariants

These constraints survive every refactor and every reviewer pass:

1. **Channel-key schema is immutable** (AGENT_RULES rule 6).
   Recordings load through `image_io.load_any_detail`; dark frames
   load with `isp_mode_id` + `isp_config` taken from the parent
   recording so channel keys match. We never coin a new key.
   `recording.extract_frame` synthesizes `HG-Y` / `LG-Y` for
   `rgb_nir` mode the same way `image_io.load_h5_channels` does
   (image_io.py:191-196) so the 10-key schema is preserved end to
   end including handoff to USAF/FPN/DoF. (P0-2)
2. **GSense Bayer constants are locked** (AGENT_RULES rule 5).
   Playback never touches `extract.ORIGIN` or `extract.LOC`.
3. **Analysis math modules stay pure** (AGENT_RULES rule 7).
   `recording.py` / `dark_frame.py` / `playback_pipeline.py` /
   `playback_export.py` import only from `numpy`, `h5py`,
   `matplotlib.colormaps`, `PIL`, `imageio` (optional). They MUST NOT
   import `fastapi` / `uvicorn` / `mantisanalysis.server` /
   `mantisanalysis.session`. **Purity test**:
   `tests/unit/test_playback_pipeline.py::test_pure_imports` asserts
   `mantisanalysis.session not in sys.modules and
   mantisanalysis.server not in sys.modules and
   fastapi not in sys.modules` after `import
   mantisanalysis.playback_pipeline`. (P1-3)
   `playback_pipeline.subtract_dark` is inlined (not imported from
   `session.py`) — it's 4 lines.
4. **Single render entry point.** Both preview-PNG and export-PNG
   flows call `playback_pipeline.render_frame(stream, view, frame)`
   and the export modules wrap it. WYSIWYG by construction.
   **Byte-equality test runs with `include_labels=False`** —
   PIL TrueType hinting differs across platforms, so labels are
   tested separately via corner-pixel-non-bg assertions. (P2-6)

## 2. H5 schema (assumed)

The MantisCam recording format (see
`mantisanalysis/extract.py::load_recording`) is the canonical input.
Inspection is deliberately tolerant so the loader can degrade
gracefully on slightly-different layouts.

### 2.1 Canonical layout

```
recording.h5
└── /camera/                        (group)
    ├── frames                      (dataset, (N, H, W) uint16)
    ├── timestamp                   (dataset, (N,)   float64,  Unix or seconds-into-recording)
    ├── integration-time            (dataset, (N,)   float64,  microseconds)
    ├── integration-time-expected   (dataset, (N,)   float64,  microseconds)
    └── attrs                       (model, serial, fw_version, ...)
```

### 2.2 Tolerated deviations

`recording.inspect_recording` falls back through an ordered list of
heuristics. Each fallback emits a `W-META-*` warning so the user sees
what was assumed.

| Heuristic | Example layout it salvages | Warning |
|---|---|---|
| H1 | `/camera/frames` (canonical) | none |
| H2 | top-level `frames` dataset | `W-META-PATH` |
| H3 | first 3-D `uint16` dataset | `W-META-PATH` |
| H4 | `(H, W)` 2-D dataset (single frame) | `W-META-SINGLE-FRAME` |
| H5 | timestamp absent → fabricate `np.arange(N) / fps_default` | `W-META-TS` |
| H6 | exposure absent → record `exposure_us = None` | `W-META-EXP` |
| H7 | `(N, H, W, 1)` 4-D dataset (legacy) | (silent — already handled) |

If none match, returns `RecordingMeta(errors=[E-LAYOUT])` and the UI
shows the FilePill error variant.

### 2.3 Dark-frame H5 schema

Dark stacks use the same canonical layout. We don't require a
separate marker; the `dark` semantics is conferred by the user
loading via the dark CTA. `average_dark_h5` reads up to `max_frames`
frames (default 256), runs them through the source's ISP mode (so the
channel keys match), and averages each channel in float64.

## 3. Pure-Python modules

### 3.1 `mantisanalysis/recording.py`

```python
@dataclass(frozen=True)
class RecordingMeta:
    path: str | None             # absolute path or None for upload-bytes-only
    name: str
    size_bytes: int
    frame_count: int
    frame_shape: tuple[int, int] # (H, W) of the dual-gain frame
    channels: tuple[str, ...]    # post-ISP, sorted (HG-* before LG-*)
    isp_mode_id: str             # 'rgb_nir' default, taken from image_io
    frame_dataset_path: str      # '/camera/frames' canonical
    timestamps_available: bool
    timestamp_start_s: float | None
    timestamp_end_s: float | None
    estimated_fps: float | None
    exposure_us_min: int | None
    exposure_us_max: int | None
    exposure_us_mean: float | None
    camera_attrs: dict[str, str]
    warnings: tuple[Warning, ...]
    errors: tuple[Warning, ...]


@dataclass(frozen=True)
class Warning:
    code: str          # 'W-META-TS', 'W-META-EXP', 'W-META-PATH', ...
    severity: str      # 'info' | 'warning' | 'error' | 'blocking'
    text: str


def inspect_recording(path: pathlib.Path,
                      max_attrs_size: int = 8192,
                      isp_mode_id: str | None = None,
                      isp_config: dict | None = None,
                      ) -> RecordingMeta: ...

def extract_frame(meta: RecordingMeta, frame_idx: int,
                  isp_mode: ISPMode, isp_config: dict
                  ) -> dict[str, np.ndarray]: ...
```

`extract_frame` returns one frame's channel dict (key set matches
`meta.channels`). It uses h5py's lazy access and mirrors the Y
synthesis from `image_io.load_h5_channels` (image_io.py:191-196)
so the 10-key `rgb_nir` schema is preserved exactly:

```python
with h5py.File(path, 'r') as f:
    raw = np.asarray(f[meta.frame_dataset_path][frame_idx])
    if raw.ndim == 3 and raw.shape[-1] == 1:
        raw = raw[..., 0]
channels = image_io.extract_with_mode(raw, isp_mode, isp_config)
# Mirror image_io.py:191-196: synthesize HG-Y / LG-Y for rgb_nir.
if isp_mode.id == 'rgb_nir':
    hg = {k: channels[f'HG-{k}'] for k in ('R', 'G', 'B')}
    lg = {k: channels[f'LG-{k}'] for k in ('R', 'G', 'B')}
    channels['HG-Y'] = image_io.luminance_from_rgb(hg)
    channels['LG-Y'] = image_io.luminance_from_rgb(lg)
return channels
```

This is the *only* "load one frame" path in Playback.

### 3.2 `mantisanalysis/dark_frame.py`

```python
@dataclass(frozen=True)
class MasterDark:
    name: str
    path: str | None
    isp_mode_id: str
    channels: dict[str, np.ndarray]      # float64 mean/median/clipped per channel
    frame_count_total: int
    frames_averaged: int
    exposure_us: int | None
    shape: tuple[int, int]
    strategy: str                        # 'mean' | 'median' | 'sigma_clipped'
    sigma_threshold: float | None        # only set when strategy='sigma_clipped'
    warnings: tuple[Warning, ...]


def average_dark_h5(path: pathlib.Path,
                    max_frames: int = 256,
                    isp_mode_id: str | None = None,
                    isp_config: dict | None = None,
                    strategy: Literal['mean', 'median', 'sigma_clipped'] = 'mean',
                    sigma_threshold: float = 3.0,
                    ) -> MasterDark: ...

def bench_dark(shape: tuple[int, int],
               channels: tuple[str, ...],
               pedestal: int = 140,
               ) -> MasterDark:
    """Synthesize a flat-pedestal master dark for development without
    real dark-frame H5 captures. Marks the result with a
    W-DARK-SYNTHETIC warning so the UI can surface 'this is fake.'"""

def match_dark_by_exposure(target_us: int,
                           pool: list[MasterDark],
                           tolerance: float = 0.10
                           ) -> tuple[MasterDark | None, list[tuple[MasterDark, float]]]:
    """Return (best_match, [(dark, delta_pct), ...] sorted ascending)."""
```

### 3.3 `mantisanalysis/playback_pipeline.py`

The renderer is a pure function: `(stream, view, frame, master_darks) → np.ndarray (H,W,3) uint8`.
Both the preview endpoint and the export modules call it.

```python
@dataclass(frozen=True)
class ViewState:
    view_id: str
    name: str
    type: str                        # 'single' | 'rgb'
    channel: str                     # for single
    channels: tuple[str, str, str]   # for rgb
    sync_to_global: bool
    locked_frame: int | None
    export_include: bool
    # corrections
    dark_on: bool
    dark_id: str | None              # None ⇒ auto-match by exposure
    gain: float
    offset: float
    normalize: bool
    # display
    low: float
    high: float
    colormap: str
    invert: bool
    show_clipped: bool
    # rgb grading
    rgb_gain: tuple[float, float, float]
    rgb_offset: tuple[float, float, float]
    gamma: float
    brightness: float
    contrast: float
    saturation: float
    wb_k: int
    wb_mode: str                        # 'k' | 'patch'
    wb_patch_uv: tuple[float, float] | None
        # Normalized [0, 1] image coordinates (P2-3) — survive
        # max_dim downscale across preview/export. Renderer
        # multiplies by (W, H) before sampling.
    wb_target_id: str | None
        # X-Rite white-target id used by 'patch' mode (risk-skeptic P2-S).
        # gain_c = target_white[c] / observed[c] (NOT mean-of-RGB).
    ccm_on: bool
    ccm: tuple[tuple[float, ...], ...]  # 3×3 row-major, identity by default
    ccm_target_id: str | None           # X-Rite preset id, optional
    # future-feed reservation removed from ViewState (risk-skeptic P2-M);
    # LiveStreamHandle (§3.5) is the future-feed carrier. render_frame
    # raises NotImplementedError if a LiveStreamHandle reaches it.
    # overlay
    overlay_on: bool
    overlay_channel: str
    overlay_low: float
    overlay_high: float
    overlay_blend: str               # 'alpha' | 'additive' | 'screen' | 'masked'
    overlay_strength: float
    overlay_cmap: str
    overlay_below: str               # 'hide' | 'clamp'
    overlay_above: str               # 'saturate' | 'clamp'
    # labels
    labels_timestamp: bool
    labels_frame: bool
    labels_channel: bool
    labels_source: bool
    labels_scale_bar: bool
    labels_badges: bool
    labels_legend: bool


def render_frame(channels: dict[str, np.ndarray],
                 view: ViewState,
                 dark: MasterDark | None,
                 *,
                 max_dim: int = 1024,
                 burn_in_ctx: BurnInContext | None = None,
                 ) -> np.ndarray:
    """Returns (H, W, 3) uint8 RGB ready to encode as PNG."""
```

Pipeline stages, in order:

1. Pick channel(s) from `channels`.
2. Cast to float64.
3. If `view.dark_on` and `dark` is provided, subtract per-channel dark
   (clamped to ≥ 0). Numerics use `session.subtract_dark` semantics.
4. Apply `view.gain`, `view.offset`.
5. If `view.normalize`, percentile-stretch to [0, 1] using
   `np.percentile(_, [1.0, 99.5])`. Otherwise use `[low, high]`.
6. Clip to [0, 1].
7. RGB grading (only when `view.type == 'rgb'`):
   - Apply per-channel `rgb_gain` / `rgb_offset`.
   - Apply `gamma` (`x ** (1/γ)` after clipping ≥ 0).
   - Apply `brightness`, `contrast`.
   - Apply `saturation` via HSL conversion (cheap NumPy implementation).
   - Apply WB:
     - `wb_mode='k'` → Bradford-style channel scale by Kelvin LUT.
     - `wb_mode='patch'` → channel scale that maps the pixel under
       `wb_patch_xy` to neutral (R == G == B == that pixel's mean).
   - If `view.ccm_on`, apply 3×3 CCM (`out_rgb = ccm @ in_rgb`); else
     skip. Determinant guard `|det(ccm)| ≥ 1e-3` enforced upstream
     (UI refuses to apply unstable matrices).
8. If single-channel view, apply matplotlib colormap LUT
   (`matplotlib.colormaps[view.colormap](x, bytes=True)[..., :3]`).
9. If `view.invert`, mirror the LUT.
10. If `view.show_clipped`, blend a magenta overlay on saturated pixels.
11. Compose overlay if `view.overlay_on`:
    - Apply low/high thresholds + below/above policies on the overlay
      channel.
    - Map through `view.overlay_cmap`.
    - Blend per `view.overlay_blend` and `view.overlay_strength`.
12. If labels enabled, burn them via PIL `ImageDraw` using the same
    fonts the existing matplotlib renderers use (Inter Tight via
    DejaVu fallback).
13. Downsample to `max_dim` if larger.
14. Return uint8 (H, W, 3).

The function never mutates input arrays.

### 3.4 `mantisanalysis/playback_export.py`

```python
def export_image(stream: 'StreamHandle',
                 frame: int,
                 views: list[ViewState],
                 *,
                 compose: str = 'contactSheet',
                 tile_arrangement: tuple[int, int] | None = None,
                 fmt: str = 'png',
                 bit_depth: int = 8,
                 include_labels: bool = True,
                 include_badges: bool = True,
                 ) -> tuple[bytes, str]:
    """Returns (image_bytes, mime_type)."""

def export_video(stream: 'StreamHandle',
                 frame_range: tuple[int, int],
                 views: list[ViewState],
                 *,
                 fps: int = 30,
                 fmt: str = 'mp4',                # 'mp4' | 'apng' | 'gif' | 'png-seq'
                 quality: str = 'high',
                 worker_count: int | None = None, # None → cpu_count()//2
                 progress_cb: Callable[[float, int], None] | None = None,
                 cancel_event: threading.Event | None = None,
                 ) -> tuple[Path, dict]:
    """Returns (output_path, summary_dict).

    Frame rendering is parallelized via concurrent.futures.ProcessPoolExecutor.
    Workers re-open the H5 by path inside the process; never receive a
    pickled h5py object. Encoder consumes the ordered output queue
    single-threaded so frame order is deterministic regardless of
    worker completion order. Sidecar JSON written to <output>.json.
    """
```

Tiled composition does not call `render_frame` for the tile; it
calls it for each tile and `np.concatenate`s the results, with a
1-pixel divider in `panelAlt` color. This keeps the WYSIWYG promise.

For video, frames are encoded with `imageio.get_writer(...,
codec='libx264', quality=...)` for MP4, `imageio.get_writer(...,
'apng')` for APNG, Pillow `save_all=True` for GIF (with optional
adaptive palette quantization), or written one PNG per frame and
zipped for `png-seq`. Worker pickling validated by
`tests/unit/test_playback_export.py::test_workers_reopen_h5_by_path`.

**Filename token catalog** — the user supplies a pattern; we
substitute against:

| Token | Source | Example |
|---|---|---|
| `{stream}` | `stream.name` | `Stream · 04-24` |
| `{stream_short}` | first 8 chars of stream_id | `29ab3f0c` |
| `{frame}` | global frame index | `1850` |
| `{seq}` | sequence index within export | `0042` |
| `{timestamp}` | `ts_s` formatted as `mm:ss.fff` | `00:04.127` |
| `{iso}` | ISO-8601 of frame timestamp | `2026-04-24T08:51:14.708` |
| `{date}` | `YYYY-MM-DD` | `2026-04-24` |
| `{ms}` | unix-epoch ms | `1714019100123` |
| `{view}` | `view.name` | `HG-G · live` |
| `{view_id}` | `view.view_id` | `v1` |
| `{channel}` | `view.channel` | `HG-G` |
| `{exposure}` | `boundary.exposure_us / 1000` ms | `20.0` |
| `{file}` | source filename without ext | `sample_1_view_0_exp_0.025` |
| `{layout}` | active layout preset | `2x2` |

### 3.5 `mantisanalysis/playback_session.py`

```python
@dataclass
class RecordingHandle:
    recording_id: str
    meta: RecordingMeta
    # risk-skeptic P1-H: every upload persists to a real path
    # under outputs/playback/uploads/<recording_id>.h5 — bytes_cache
    # was removed to prevent in-RAM duplication of large H5s
    # across browser tabs. Cleanup on eviction is the responsibility
    # of PlaybackStore._evict_locked.
    path: pathlib.Path
    isp_mode_id: str
    isp_config: dict
    loaded_at: float


@dataclass
class DarkHandle:
    dark_id: str
    master: MasterDark
    loaded_at: float


@dataclass
class StreamBoundary:
    recording_id: str
    start_frame: int
    end_frame: int
    ts_start_s: float
    ts_end_s: float
    exposure_us: int | None
    gap_to_prev_s: float | None


@dataclass
class StreamHandle:
    stream_id: str
    name: str
    isp_mode_id: str
    isp_config: dict
    recording_ids: tuple[str, ...]
    quarantined_recording_ids: tuple[str, ...]
    continuity_threshold_s: float
    boundaries: tuple[StreamBoundary, ...]
    total_frames: int
    total_duration_s: float
    fps: float
    shape: tuple[int, int]
    available_channels: tuple[str, ...]
    issues: dict[str, int]
    warnings: tuple[Warning, ...]
    loaded_at: float


@dataclass
class ExportJob:
    job_id: str
    kind: str                          # 'image' | 'video'
    request: dict                      # original request
    status: str                        # queued | rendering | done | failed | cancelled
    progress: float
    current_frame: int
    total_frames: int
    elapsed_s: float
    eta_s: float
    decode_ms_per_frame: float
    encode_ms_per_frame: float
    worker_count: int                  # actual pool size used
    output_path: pathlib.Path | None
    sidecar_path: pathlib.Path | None  # <output>.json
    error: str | None
    submitted_at: float
    # risk-skeptic P0-A: must cross ProcessPoolExecutor boundary.
    # Created via multiprocessing.Manager() so the parent's set()
    # is visible to worker processes. cancel granularity is "one
    # batch" — already-submitted batches finish; new submissions
    # are refused after set().
    cancel_event: 'multiprocessing.synchronize.Event'


@dataclass(frozen=True)
class Preset:
    preset_id: str
    kind: str                           # 'view' | 'dark' | 'ccm'
    name: str
    payload: dict                       # opaque JSON; client owns schema
    created_at: float


# Reserved for future realtime feed integration. No-op in this
# initiative — server returns 501 for /live/* routes.
@dataclass(frozen=True)
class LiveStreamHandle:
    stream_id: str
    camera_id: str
    isp_mode_id: str
    is_live: bool                       # always True for this kind
    last_frame_index: int
    started_at: float


class PlaybackStore:
    def __init__(self, max_streams=4, max_recordings=12,
                 max_darks=8, max_jobs=8,
                 frame_lru=32) -> None: ...
    def register_recording(...) -> RecordingHandle: ...
    def register_dark(...) -> DarkHandle: ...
    def build_stream(recording_ids, threshold_s, isp_mode_id) -> StreamHandle: ...
    def update_stream(stream_id, **kwargs) -> StreamHandle: ...
    def delete_stream(stream_id) -> None: ...
    def get_recording(recording_id) -> RecordingHandle: ...
    def get_dark(dark_id) -> DarkHandle: ...
    def get_stream(stream_id) -> StreamHandle: ...
    def get_frame(stream_id, frame_idx) -> dict[str, np.ndarray]: ...
    def set_frame_lru_size(self, n: int) -> None: ...   # 4..512
    def submit_export(job: ExportJob) -> ExportJob: ...
    def get_job(job_id) -> ExportJob: ...
    def cancel_job(job_id) -> ExportJob: ...
    def save_preset(p: Preset) -> Preset: ...
    def load_presets(kind: str) -> list[Preset]: ...
    def delete_preset(preset_id: str) -> None: ...
    # reserved no-op for future feed
    def register_live(handle: LiveStreamHandle) -> LiveStreamHandle: ...
```

`get_frame` resolves global `frame_idx` to a `(recording_id,
local_frame)` pair via the stream's boundaries, calls
`recording.extract_frame` (or hits the LRU cache), and returns the
channel dict. The LRU cache is `OrderedDict[(rec_id, local_frame),
dict[str, np.ndarray]]` with `frame_lru` entries; tuned to keep ~3 s
of timeline fluid scrubbing for a 30-fps stream.

`PLAYBACK_STORE = PlaybackStore()` is the process-global singleton.

## 4. Continuity / gap / mismatch detection

Implemented in `recording.build_stream`:

```python
def build_stream(recordings: list[RecordingHandle],
                 *,
                 continuity_threshold_s: float = 1.0,
                 isp_mode_id: str | None = None,
                 isp_config: dict | None = None,
                 ) -> StreamHandle:
    # 1. Filter out shape mismatches → quarantine (hard reject).
    # 2. Sort by ts_start_s if no explicit order (caller order wins).
    # 3. Walk pairwise:
    #    gap_to_prev = ts_start[i] - ts_end[i-1]
    #    if gap_to_prev > continuity_threshold_s → W-GAP
    #    if gap_to_prev < -1e-6 → W-OVERLAP
    #    if exposure[i] != base_exposure → W-EXP-MISMATCH
    # 4. Compute global frame ranges per recording.
    # 5. Synthesize available_channels = intersection of all recordings.
    #    For every channel in the base recording but missing in any
    #    later recording → emit W-CHAN warning naming the file +
    #    channel (P1-12); the channel still drops out of
    #    available_channels but the user knows why.
    # 6. Emit stream + warnings list.
```

Auto-quarantine rules:

- Shape mismatch (channels' `(H, W)` differ from the base recording).
- Empty frame_count.

**Channel mismatch is NOT a quarantine** (P1-12): if recording B
lacks `HG-NIR` while A has it, B stays in the stream but `HG-NIR`
is dropped from `available_channels`. The user sees a W-CHAN
warning chip on B's FilePill explaining the lost channel. The
once-per-session "we're guessing" modal raises for W-CHAN too.

Soft warnings (don't quarantine):

- Gap > threshold.
- Overlap.
- Exposure mismatch (we still build the stream; rendering uses the
  per-frame exposure).
- Missing timestamps (we synthesize from `1/fps_default`).

`build_stream` is deterministic: same inputs → same boundaries.

## 5. React state shape

Lives in `web/src/playback/state.tsx` as a `useReducer` store
exported through `PlaybackCtx`.

```ts
interface PlaybackState {
  // server-derived (cached, refreshed on actions)
  recordings: RecordingHandle[];
  darks: DarkHandle[];
  streams: StreamHandle[];
  activeStreamId: string | null;

  // UI state
  frame: number;
  playing: boolean;
  playbackSpeed: 0.25 | 0.5 | 1 | 2 | 4;
  playbackFps: 24 | 30 | 60;
  range: [number, number] | null;        // export range select
  layout: 'single' | 'side' | 'stack' | '2x2' | '3plus1';
  views: ViewState[];
  selectedViewId: string | null;
  sourcesCollapsed: boolean;
  inspectorCollapsed: boolean;
  inspectorTab: 'source' | 'correct' | 'display' | 'overlay' | 'labels' | 'presets';
  modal:
    | { kind: 'stream-builder' }
    | { kind: 'overlay-builder', viewId: string }
    | { kind: 'export-image' }
    | { kind: 'export-video' }
    | { kind: 'warnings' }
    | null;

  // operations
  pendingFrameRequests: Set<string>;     // dedupe in-flight previews
  exportJobs: ExportJobStatus[];
}

type Action =
  | { type: 'recording/added', payload: RecordingHandle }
  | { type: 'recording/removed', payload: string }
  | { type: 'dark/added', payload: DarkHandle }
  | { type: 'dark/removed', payload: string }
  | { type: 'stream/built', payload: StreamHandle }
  | { type: 'stream/updated', payload: StreamHandle }
  | { type: 'stream/active', payload: string }
  | { type: 'frame/set', payload: number }
  | { type: 'play/toggle' }
  | { type: 'view/add', payload?: Partial<ViewState> }
  | { type: 'view/remove', payload: string }
  | { type: 'view/duplicate', payload: string }
  | { type: 'view/select', payload: string }
  | { type: 'view/update', payload: { id: string, patch: Partial<ViewState> } }
  | { type: 'view/lock', payload: { id: string, frame: number | null } }
  | { type: 'view/copy-settings-to', payload: { sourceId: string, targetIds: string[] } }
  | { type: 'layout/set', payload: PlaybackState['layout'] }
  | { type: 'modal/open', payload: PlaybackState['modal'] }
  | { type: 'modal/close' }
  | { type: 'export/added', payload: ExportJobStatus }
  | { type: 'export/updated', payload: ExportJobStatus }
  | { type: 'export/removed', payload: string };
```

Persisted to localStorage (per spec.md §4.3) under `mantis/playback/`:

- `layout`, `inspectorOpen` (flat dict per type), `sourcesOpen`,
  `defaults` (per-band `{ colormap, low, high }`),
  `labels` (default burned-in label set),
  `continuityThreshold`.

NOT persisted: `views`, `frame`, `range`, `recordings`, `darks`,
`streams` (rationale: spec.md §4.3 — preferences survive refresh,
loaded data does not).

## 6. Wire formats

Server-side Pydantic models map TypeScript types one-to-one. Aliases
preserve camelCase on the wire so the React state can spread API
payloads directly. Example:

```python
class ViewStateOut(BaseModel):
    view_id: str = Field(alias='viewId')
    type: str
    channel: str
    sync_to_global: bool = Field(alias='syncToGlobal')
    locked_frame: int | None = Field(alias='lockedFrame')
    # ...
    class Config:
        populate_by_name = True
        json_encoders = {tuple: list}
```

## 7. Eviction semantics

```
PlaybackStore caps:
   recordings: 12
   darks:       8
   streams:     4
   jobs:        8 most recent (active jobs are eviction-pinned)
   frame_lru_bytes: PROCESS-GLOBAL 2 GB default (P0-C)
                    user-adjustable [256 MB .. 8 GB] in Inspector Advanced
```

- Oldest-first eviction by `loaded_at`.
- **Active export jobs pin their `recording_id` and `stream_id`**
  to a no-evict set; release on done/cancel/failed (P2-7).
- `DELETE /streams/{id}` returns **409 Conflict** when an active
  job (status in `{queued, rendering}`) references the stream;
  body specifies `{detail: "stream has active export job <id>;
  cancel it first"}` (risk-skeptic P2-P).
- Evicted ids recorded in `_evicted` set per kind (recording / dark
  / stream / job).
- Subsequent reads return 410 with `kind` field set.
- `apiFetch` dispatches `mantis:source-evicted` with `detail.kind`
  + `detail.source_id` (or `detail.stream_id` etc., aliased). The
  existing app-shell listener at `web/src/app.tsx:159-173` filters
  on `kind === 'source' || kind == null` before reloading any
  USAF/FPN/DoF sample (P0-B). Playback's reducer listens for the
  same event and routes by `kind`.
  **Required edits at M5 (planner-architect P1-4 + risk-skeptic
  P0-B)**:
  - `web/src/shared.tsx::apiFetch` widens `sidMatch` regex to
    extract id from `/api/(sources|playback/streams|playback/recordings|playback/darks)/[id]`
    paths and populates `detail.kind` accordingly.
  - `web/src/app.tsx` listener filters on `kind === 'source' || kind == null`.
- Evicting a recording that participates in a stream → the stream
  is marked `invalidated: true` and its further reads return 410.
- Evicting a dark referenced by `view.dark_id` does not invalidate
  the view; the view falls back to auto-match (or no dark).
- **Frame LRU is process-global** (P0-C): a single OrderedDict
  keyed by `(stream_id, rec_id, local_frame)` shared across all
  streams. `frame_lru_bytes_global_cap` (default 2 GB) is the
  ceiling on the sum, not per-stream. Inspector Advanced widget
  shows `current_bytes` / `cap` and live frame count.

## 8. Error taxonomy

Codes prefixed `W-` (warning) or `E-` (error). Severity in the
schema is independent from code prefix (an `E-` code can be
`severity=warning` if recoverable).

| Code | Severity | Where it surfaces | Recovery |
|---|---|---|---|
| `W-META-TS` | info | inspect, file-pill | Synthesize from fps |
| `W-META-EXP` | warning | inspect, file-pill | Disable dark auto-match |
| `W-META-PATH` | info | inspect, builder | None (informational) |
| `W-META-SINGLE-FRAME` | warning | inspect | Allow as 1-frame stream |
| `W-EXP-MISMATCH` | warning | builder, dark mgr | Use closest dark / disable |
| `W-SHAPE` | error | builder | Quarantine / replace |
| `W-CHAN` | error | builder | Quarantine / replace |
| `W-DARK-NONE` | warning | dark mgr | Use closest / load dark |
| `W-DARK-AMBIG` | info | dark mgr | Pick explicitly |
| `W-OVL-SRC` | error | inspector overlay | Pick base / disable |
| `W-EXPORT-LONG` | warning | export modal | Continue / narrow |
| `W-FRAME-FAIL` | warning | viewer card | Retry / skip |
| `W-PROC-INVALID` | info | inspector | Auto-revert |
| `W-RANGE-HUGE` | warning | export modal | Continue / narrow |
| `W-GAP` | warning | builder | Threshold ↑ / accept |
| `W-OVERLAP` | warning | builder | Reorder |
| `W-FFMPEG-MISSING` | error (blocking) | export video | Install dep |
| `E-LAYOUT` | error (blocking) | inspect | Replace file |

The `mantisanalysis/recording.py` and `dark_frame.py` modules expose
`Warning` codes as constants so server / client never typo.

## 9. Channel selection rules

Per spec.md (channel chip behavior in `playback_panels.jsx`):

- A view has a **gain class** (`HG` / `LG`) and a **band**
  (`R`/`G`/`B`/`NIR`/`Y`).
- The available bands for a gain class are computed from the
  stream's `available_channels`. If only `LG-*` exist, the HG segment
  in the gain-class picker is disabled with tooltip "no HG channels
  in this stream".
- `view.channel = `${gainClass}-${band}`` — derived.
- For RGB views, `view.channels = ['HG-R', 'HG-G', 'HG-B']` defaulting
  to whatever the gain class is. Switching gain class remaps all three
  bands to the same gain (`['LG-R', 'LG-G', 'LG-B']`).
- Bands missing from `available_channels` are visibly disabled.

## 10. Frame index conventions

- Server: 0-based int, valid range `[0, total_frames - 1]`.
- Client: same.
- "Local frame index" relative to a recording: 0-based, always.
- Stream boundaries follow Python slice semantics:
  `start_frame` inclusive, `end_frame` exclusive.

## 11. Time conventions

- All times in seconds (float64) on the wire.
- `ts_start_s` / `ts_end_s` are seconds since the recording's first
  timestamp (so a stream that starts mid-day reads 0.0..N regardless
  of clock).
- The original Unix epoch (if present in the H5) is preserved on the
  meta object as `camera_attrs['unix_epoch_s']` for the Inspector
  Advanced tab; never used for frame math.

## 12. Color math reference

| Stage | Formula |
|---|---|
| Dark subtract | `out = max(raw_f64 - dark_f64, 0)` |
| Gain / offset | `out = out * gain + offset` |
| Normalize | `lo, hi = percentile(out, [1, 99.5])`; `out = clip((out - lo) / (hi - lo), 0, 1)` |
| Threshold (no normalize) | `out = clip((out - low) / (high - low), 0, 1)` |
| Gamma | `out = clip(out, 0, 1) ** (1/γ)` |
| Brightness | `out = out + brightness` |
| Contrast | `out = (out - 0.5) * contrast + 0.5` |
| Saturation | RGB → HSL → scale S → RGB |
| WB (display only) | `(R, G, B) *= K_to_gain(K)` (Tabular LUT, 2500–9500 K) |
| Colormap | `mpl.colormaps[name](out, bytes=True)[..., :3]` |
| Invert | `(255 - rgb)` after colormap |
| Overlay alpha | `out = base * (1 - α) + over * α` |
| Overlay additive | `out = clip(base + over * α, 0, 255)` |
| Overlay screen | `out = 255 - (255 - base) * (255 - over) / 255` |
| Overlay masked | `out = where(over > 0, over, base)` |
| CCM | `rgb_out = clip(ccm @ rgb_in, 0, 1)` (per-pixel, applied AFTER WB) |
| WB patch (risk-skeptic P2-S) | `x, y = wb_patch_uv * (W, H)`; `target = TARGETS[wb_target_id]['white_rgb']`; `gain_c = target[c] / observed_c[at_xy]` for c in (R,G,B); `rgb_out = rgb_in * gain`. NOT "make this pixel grey" — that would be uncalibrated. |

### CCM target catalog (P2-4)

`web/src/playback/data.tsx::CCM_TARGETS` ships the X-Rite ColorChecker
24-patch sRGB reference values (canonical bench targets). User picks
a target id from a dropdown; client posts `(observed, target)` pairs to
`/api/playback/ccm/from-patch`. User-supplied custom targets deferred
to BACKLOG.
| Below thr (`hide`) | mask alpha to 0 below `low` |
| Below thr (`clamp`) | clamp at `low` |
| Above thr (`saturate`) | full strength above `high` |
| Above thr (`clamp`) | clamp at `high` |

## 13. Storage budgets

| Asset | Cap | Why |
|---|---|---|
| `RecordingHandle` count | 12 | Same as STORE max |
| `MasterDark` count | 8 | One per common exposure |
| `Stream` count | 4 | Rare to have multiple in one session |
| `ExportJob` retention | 8 most recent | Output files served from disk |
| **frame LRU bytes — PROCESS-GLOBAL (P0-C)** | **user-adjustable [256 MB..8 GB], default 2 GB** | Byte-capped, single global ceiling shared across all streams; large raw frames or many streams cannot exceed the cap |
| Single frame max bytes | 64 MB raw | 2048×4096 × 10 channels × float64 worst case (GSense FSI Dual-Gain dev recording) |
| Server preview PNG | 1024 px max dim | Bandwidth + browser memory |
| Master dark in-RAM | per channel float64 | ~64 MB at 2048×4096 × 10 ch |
| Preset count per kind | 64 | LRU-evict oldest |
| Export worker pool | `max(1, os.cpu_count() // 2)` | Leave headroom for the encoder thread |
| Combined STORE + PlaybackStore peak | ~8 GB at full LRU saturation (P2-1) | Documented; surfaced in Inspector Advanced as "Memory" line |
| Eviction-pinned set during exports | 1 active job pins 1 stream + N recordings (P2-7) | Prevents 410 races mid-render |

**Frame-LRU implementation note (P1-8):** the cache holds
`(rec_id, local_frame) → channel_dict_bytes` entries; the running
total tracks `current_bytes`, eviction fires when
`current_bytes + new_bytes > frame_lru_bytes_cap`. The Inspector
Advanced section surfaces:

```
Frame cache
  Used:  1.4 GB / 2.0 GB  (52 frames)
  [───────●─────────────] 2 GB
   256 MB              8 GB
```

## 14. Backwards compatibility

- USAF / FPN / DoF are entirely unaffected.
- The existing `STORE` (analysis sources) is untouched. Loaded sources
  there can coexist with PlaybackStore entries; users may have a
  USAF analysis and a Playback stream open simultaneously.
- Existing routes are additive-only; no breakage.
- Frontend mode-rail icons and keyboard shortcuts shift to add a 4th
  tile and `4` shortcut. `1`/`2`/`3` keep mapping to USAF/FPN/DoF.
