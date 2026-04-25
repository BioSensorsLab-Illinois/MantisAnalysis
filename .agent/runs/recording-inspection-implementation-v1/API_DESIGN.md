# API_DESIGN — recording-inspection-implementation-v1

> Companion to ExecPlan.md / DATA_MODEL.md. Authoritative shape for the
> `/api/playback/*` namespace. All routes live in `mantisanalysis/server.py`,
> mounted via `_mount_playback_api(app)` next to `_mount_api(app)`. None of
> the existing routes change.

Last updated: 2026-04-24

## 0. Conventions

- All bodies are JSON unless explicitly marked `multipart/form-data`
  (uploads) or `image/png` (frame thumbnails).
- Errors return `{"detail": str}` per FastAPI default.
- Status codes:
  - 400 — malformed request (path missing, bytes empty).
  - 404 — unknown id.
  - 410 — id was once valid but evicted (parallel to R-0009 pattern).
  - 422 — schema/validation error (Pydantic).
  - 503 — soft dependency missing (e.g. ffmpeg).
- Time fields are seconds (float). Frame indices are 0-based ints.
- IDs are 12-hex strings (`uuid.uuid4().hex[:12]`), matching the
  existing `STORE` pattern.
- `Cache-Control: no-store` on every dynamic endpoint (frame PNGs,
  exports). `public, max-age=86400` on static (colormap strips).
- All routes are append-only: USAF/FPN/DoF unaffected.

## 1. Health + capability

### `GET /api/playback/health`

```json
{
  "ok": true,
  "version": "1.0.0",
  "ffmpeg_available": true,
  "ffmpeg_path": "/Users/.../site-packages/imageio_ffmpeg/binaries/ffmpeg-...",
  "max_recording_frames": 100000,
  "max_dark_frames": 256,
  "supported_image_formats": ["png", "tif", "jpg"],
  "supported_video_formats": ["mp4", "apng", "gif", "png-seq"],
  "supported_blend_modes": ["alpha", "additive", "screen", "masked"],
  "supported_colormaps": ["viridis", "inferno", "magma", "plasma",
                          "cividis", "turbo", "gray", "hot", "cool"],
  "supported_dark_strategies": ["mean", "median", "sigma_clipped"],
  "supported_isp_modes": ["rgb_nir", "bare_single", "bare_dualgain",
                           "polarization_single", "polarization_dual"],
  "live_stream_supported": false,
  "ccm_editor_enabled": true,
  "handoff_modes": ["usaf", "fpn", "dof"]
}
```

`ffmpeg_available=false` is a **blocker** per user 2026-04-24 — M10
will not close until ffmpeg is reachable. UI surfaces an actionable
"install `imageio-ffmpeg`" CTA in the Export Video modal; the modal's
"Start export" button is disabled until ffmpeg health check passes.
GIF output stays available regardless (Pillow-based).
`live_stream_supported` is reserved for the future realtime feed
extension; clients should treat the field as a feature flag.

## 2. Recordings

### `POST /api/playback/recordings/inspect`

Read metadata for an arbitrary disk path **without** registering it.
Used by the file picker to pre-flight a path before commit. (Web-only:
when running locally we accept disk paths.)

Request:

```json
{ "path": "/abs/path/to/recording_001.h5" }
```

Response (`RecordingMeta`):

```json
{
  "path": "/abs/path/to/recording_001.h5",
  "name": "recording_001.h5",
  "size_bytes": 870989824,
  "frame_count": 1200,
  "frame_shape": [1080, 1920],
  "channels": ["HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"],
  "isp_mode_id": "rgb_nir",
  "frame_dataset_path": "/camera/frames",
  "timestamps": {
    "available": true,
    "start_s": 1714018723.214,
    "end_s": 1714018763.196,
    "estimated_fps": 30.0
  },
  "exposure": {
    "available": true,
    "set_us_min": 20000,
    "set_us_max": 20000,
    "actual_us_mean": 19998
  },
  "camera_attrs": {
    "model": "GSense BSI",
    "serial": "..."
  },
  "warnings": [
    { "code": "W-META-TS", "severity": "info",
      "text": "..." }
  ],
  "errors": []
}
```

- `frame_count` may be 0 if the dataset is empty; `errors` will explain.
- `errors` non-empty → frontend shows the error variant of `FilePill`
  with Retry/Remove. We do not raise HTTP 4xx on partial-data files.
- `frame_dataset_path` is recorded so subsequent reads use the same
  path even if the inspector's heuristic was approximate (logged in
  `warnings` if non-canonical).

### `POST /api/playback/recordings/load-path`

Inspect + register. Returns `RecordingHandle` (extends `RecordingMeta`
with `recording_id` + a registration timestamp).

Request:

```json
{ "path": "/abs/path/to/recording_001.h5",
  "name": "optional override" }
```

Response:

```json
{
  "recording_id": "8f1d2c91a3b0",
  "loaded_at": 1714018723.214,
  /* …all RecordingMeta fields… */
}
```

### `POST /api/playback/recordings/upload`

Browser-side file picker upload, multipart/form-data with field
`file`. Backend writes to a temp file, calls `inspect_recording`,
registers the handle. Same response shape as `load-path`. Temp file is
unlinked after metadata extraction; subsequent frame reads happen
against an h5py dataset opened on the upload's persisted bytes (we
keep an `Optional[Path]` on `RecordingHandle`; if None, reads use a
stored `bytes` cache).

### `GET /api/playback/recordings`

Returns `List[RecordingHandle]`, sorted by `loaded_at` descending.

### `GET /api/playback/recordings/{recording_id}`

Returns one `RecordingHandle`. 404 unknown / 410 evicted.

### `DELETE /api/playback/recordings/{recording_id}`

Removes from the store. Any active stream that referenced it is
detached and recomputed.

```json
{ "ok": true, "stream_ids_invalidated": ["29ab...", "7fbc..."] }
```

### `POST /api/playback/recordings/load-sample` *(test-only convenience)*

Build a tiny synthetic H5 in a temp dir with the GSense layout,
register it, return the handle. This is the only way Playwright tests
acquire a recording without an OS file picker. Behind a debug flag
(`MANTIS_PLAYBACK_TEST=1` env var) by default; turned on automatically
in `tests/web/conftest.py`.

## 3. Dark frames

### `POST /api/playback/darks/load-path`

Same shape as `recordings/load-path`. Loads one or more frames from a
dark-stack H5, averages them into a master dark using the chosen
strategy, registers a `DarkHandle`.

Request:

```json
{ "path": "/abs/.../dark_20ms_32.h5",
  "name": "optional override",
  "max_frames": 256,
  "strategy": "mean",                      // "mean" | "median" | "sigma_clipped"
  "sigma_threshold": 3.0                   // only used when strategy="sigma_clipped"
}
```

Response (`DarkHandle`):

```json
{
  "dark_id": "1f02a99c8d6e",
  "name": "dark_20ms_32.h5",
  "path": "/abs/.../dark_20ms_32.h5",
  "frame_count_total": 32,
  "frames_averaged": 32,
  "exposure_us": 20000,
  "shape": [1080, 1920],
  "isp_mode_id": "rgb_nir",
  "channels": ["HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"],
  "strategy": "mean",
  "sigma_threshold": null,
  "loaded_at": 1714018800.555,
  "warnings": []
}
```

If multiple darks share the same exposure, `match_dark_by_exposure`
picks the most-recent (highest `loaded_at`); other matches surface in
`alternatives` with their `loaded_at` and `delta_pct`.

### `POST /api/playback/darks/upload`

Multipart upload, otherwise identical.

### `GET /api/playback/darks`

`List[DarkHandle]`.

### `DELETE /api/playback/darks/{dark_id}`

Drops the master dark.

### `GET /api/playback/darks/match?exposure_us=…&tolerance=0.10`

Convenience: return matched dark id (or null) for a target exposure.
Tolerance is fractional (default 10%).

```json
{
  "exposure_us": 20000,
  "tolerance": 0.10,
  "match": {
    "dark_id": "1f02a99c8d6e",
    "exposure_us": 20000,
    "delta_pct": 0.0
  },
  "alternatives": [
    { "dark_id": "...", "exposure_us": 22000, "delta_pct": 0.10 }
  ]
}
```

## 4. Streams

### `POST /api/playback/streams`

Build a new stream from an ordered list of `recording_id`s.
Continuity / gap / overlap detection runs in the call.

Request:

```json
{
  "name": "Stream · 04-24",
  "recording_ids": ["8f1d2c91a3b0", "5fa2c8...", "12abcd..."],
  "continuity_threshold_s": 1.0,
  "isp_mode_id": "rgb_nir",
  "isp_config": null
}
```

Response (`Stream`):

```json
{
  "stream_id": "29ab3f0c5d11",
  "name": "Stream · 04-24",
  "isp_mode_id": "rgb_nir",
  "isp_config": { "origin": [0,0], "sub_step": [2,2], "outer_stride": [4,4] },
  "recording_ids": ["8f1d2c91a3b0", "5fa2c8...", "12abcd..."],
  "continuity_threshold_s": 1.0,
  "boundaries": [
    { "recording_id": "8f1d2c91a3b0", "start_frame": 0,
      "end_frame": 1200, "ts_start_s": 0.0, "ts_end_s": 40.0,
      "exposure_us": 20000 },
    { "recording_id": "5fa2c8...",   "start_frame": 1200,
      "end_frame": 2400, "ts_start_s": 40.8, "ts_end_s": 80.8,
      "exposure_us": 20000,
      "gap_to_prev_s": 0.8 },
    { "recording_id": "12abcd...",   "start_frame": 2400,
      "end_frame": 3800, "ts_start_s": 80.8, "ts_end_s": 136.8,
      "exposure_us": 40000,
      "gap_to_prev_s": 0.0 }
  ],
  "total_frames": 3800,
  "total_duration_s": 136.8,
  "fps": 30.0,
  "shape": [1080, 1920],
  "available_channels": ["HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                          "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"],
  "issues": {
    "gap_count": 1,
    "overlap_count": 0,
    "exposure_mismatch_count": 1,
    "shape_mismatch_count": 0,
    "channel_mismatch_count": 0
  },
  "warnings": [
    { "code": "W-GAP-0.8", "severity": "warning",
      "text": "0.8 s gap between recording_001 and recording_002.",
      "recording_id": "5fa2c8..." },
    { "code": "W-EXP-MISMATCH", "severity": "warning",
      "text": "recording_003 exposure 40 ms differs from base 20 ms.",
      "recording_id": "12abcd..." }
  ],
  "quarantined_recording_ids": [],
  "loaded_at": 1714018900.123
}
```

`shape_mismatch_count` and `channel_mismatch_count` files are
auto-quarantined. Their ids appear in `quarantined_recording_ids`. The
client can manually pull them back via `PUT /streams/{id}` (below).

### `GET /api/playback/streams`

Returns `List[Stream]` (without boundary detail; light listing). Use
`GET /streams/{id}` for the full payload.

### `GET /api/playback/streams/{stream_id}`

Full `Stream` as above.

### `PUT /api/playback/streams/{stream_id}`

Update ordering / continuity threshold / quarantine. Recomputes
boundaries.

```json
{
  "recording_ids": ["…","…","…"],            // optional
  "continuity_threshold_s": 1.5,             // optional
  "quarantined_recording_ids": ["12abcd…"],  // optional
  "isp_mode_id": "rgb_nir",                  // optional
  "isp_config": null                         // optional
}
```

Returns the updated `Stream`.

### `DELETE /api/playback/streams/{stream_id}`

Drop. 200 → `{ "ok": true }`.

**409 Conflict (risk-skeptic P2-P)** when an active export job
(status in `{queued, rendering}`) references this stream:

```json
{ "detail": "stream has active export job <job_id>; cancel it first",
  "active_job_id": "f8a13c220777" }
```

### `GET /api/playback/streams/{stream_id}/lookup?frame=N`

Resolve a global frame index to its source.

```json
{
  "frame": 1850,
  "recording_id": "5fa2c8...",
  "local_frame": 650,
  "ts_s": 62.4,
  "exposure_us": 20000,
  "boundary_index": 1
}
```

## 5. Frame rendering (the WYSIWYG endpoint)

### `GET /api/playback/streams/{stream_id}/frame/{frame}.png`

Renders one frame through `playback_pipeline.render_frame`. Query
params describe the per-view processing — the same set the
`ViewState` carries — so the same renderer drives preview and export.

| Query param          | Type      | Default | Meaning |
|----------------------|-----------|---------|---------|
| `view_type`          | str       | "single"| `single` / `rgb` |
| `channel`            | str       | `HG-G`  | Single-channel key |
| `channels`           | str (csv) | `HG-R,HG-G,HG-B` | RGB triplet for `view_type=rgb` |
| `dark_on`            | bool      | false   | Enable dark subtraction |
| `dark_id`            | str       | (auto)  | Master dark id; empty = auto by exposure |
| `gain`               | float     | 1.0     | Linear gain |
| `offset`             | float     | 0.0     | DN offset post-dark |
| `normalize`          | bool      | false   | Per-frame min/max stretch |
| `low`                | float     | 30      | Display low threshold |
| `high`               | float     | 900     | Display high threshold |
| `colormap`           | str       | viridis | LUT name |
| `invert`             | bool      | false   | Invert luminance |
| `show_clipped`       | bool      | false   | Highlight clipped pixels |
| `rgb_gain_r/g/b`     | float×3   | 1.0     | RGB grading gains |
| `rgb_offset_r/g/b`   | float×3   | 0.0     | RGB grading offsets |
| `gamma`              | float     | 1.0     | RGB γ |
| `brightness`         | float     | 0.0     | RGB brightness |
| `contrast`           | float     | 1.0     | RGB contrast |
| `saturation`         | float     | 1.0     | RGB saturation |
| `wb_k`               | int       | 5500    | White balance K (Kelvin) |
| `wb_mode`            | str       | k       | `k` (Kelvin) or `patch` (calibrated) |
| `wb_patch_xy`        | str (csv) |         | `"x,y"` clicked-pixel coords for `wb_mode=patch` |
| `ccm_on`             | bool      | false   | Apply 3×3 color-correction matrix |
| `ccm`                | str (csv) |         | `"a,b,c,d,e,f,g,h,i"` 3×3 matrix row-major |
| `overlay_on`         | bool      | false   | Compose overlay |
| `overlay_channel`    | str       | HG-NIR  | Overlay source channel |
| `overlay_low/high`   | float     | 300/900 | Overlay thresholds |
| `overlay_blend`      | str       | alpha   | `alpha` / `additive` / `screen` / `masked` |
| `overlay_strength`   | float     | 0.65    | 0..1 |
| `overlay_cmap`       | str       | inferno | Overlay LUT |
| `overlay_below`      | str       | hide    | `hide` / `clamp` |
| `overlay_above`      | str       | saturate| `saturate` / `clamp` |
| `labels_timestamp`   | bool      | true    | Burn timestamp |
| `labels_frame`       | bool      | true    | Burn frame index |
| `labels_channel`     | bool      | false   | Burn channel name |
| `labels_source`      | bool      | false   | Burn source filename |
| `labels_scale_bar`   | bool      | false   | Burn scale bar (px count) |
| `labels_badges`      | bool      | true    | Burn processing badges |
| `labels_legend`      | bool      | true    | Burn overlay legend (overlay only) |
| `max_dim`            | int       | 1024    | Server-side downscale cap |

Response: `image/png`. Headers `Cache-Control: no-store`. The full
query string is the cache key on the *client* side; we use
`URLSearchParams` + `useDebounced` from the existing pattern (no need
for client-side caching layer).

Errors:
- 404 unknown stream
- 422 invalid query (`channel` not in stream's available channels)
- 500 frame decode failure ⇒ surfaces inline, frontend shows the
  Frame-not-decoded variant of `ViewerCanvas`.

### `GET /api/playback/streams/{stream_id}/frame/{frame}/range?channel=HG-G`

Same as `/api/sources/{id}/channel/{ch}/range` but for a stream's
current frame. Used to seed sensible defaults for `low`/`high`.

```json
{ "min": 24, "max": 4012, "p1": 90, "p99": 1100,
  "mean": 412, "std": 67 }
```

## 6. Exports

Exports run on the server side. Long jobs return a job id and stream
progress over polling.

### `POST /api/playback/exports/image`

Synchronous (one frame, even with tiled compose, completes in
<5 s for typical inputs). Response is the PNG bytes.

Request body:

```json
{
  "stream_id": "29ab3f0c5d11",
  "frame": 1850,
  "compose": "contactSheet",                    // "single" | "contactSheet" | "grid"
  "tile_arrangement": [2, 2],                   // optional, only for "grid"
  "format": "png",                              // "png" | "tif" | "jpg"
  "bit_depth": 8,                               // 8 | 16, only meaningful for "tif"
  "include_labels": true,
  "include_badges": true,
  "filename_pattern": "{stream}_f{frame}_{date}",
  "views": [ { ...ViewState... }, ... ]
}
```

Response: `image/png` (or `image/tiff` / `image/jpeg`) with header
`Content-Disposition: attachment; filename="…"`.

422 if `views` is empty / format unsupported / arrangement size <
view count.

### `POST /api/playback/exports/video`

Asynchronous. Returns 202 + job descriptor.

Request body:

```json
{
  "stream_id": "29ab3f0c5d11",
  "frame_range": [0, 3799],
  "compose": "grid",
  "tile_arrangement": [2, 2],
  "format": "mp4",                              // "mp4" | "apng" | "gif" | "png-seq"
  "fps": 30,
  "speed_baked": 1.0,
  "quality": "high",                            // "low" | "med" | "high"
  "include_labels": true,
  "include_badges": true,
  "views": [ ... ]
}
```

**GIF frame cap (risk-skeptic P1-E):** when `format='gif'`, the
server enforces `frame_count ≤ 300` (10 s @ 30 fps). Beyond
the cap, returns 422 with
`{detail: "GIF export limited to 300 frames; reduce range or
choose another format", code: "W-EXPORT-GIF-CAP"}`. The Export
Video modal pre-flight surfaces this gate and shows estimated
encode time before the user clicks Start.

Response 202:

```json
{
  "job_id": "f8a13c220777",
  "status": "queued",
  "format": "mp4",
  "frame_range": [0, 3799],
  "frame_count": 3800,
  "fps": 30,
  "estimated_seconds": 63.3,
  "submitted_at": 1714019100.0
}
```

503 if `format=mp4|apng` and `imageio_ffmpeg` is not importable;
detail: `"ffmpeg not available — install imageio-ffmpeg"`.

### `GET /api/playback/exports/{job_id}`

```json
{
  "job_id": "f8a13c220777",
  "status": "rendering",                       // queued | rendering | done | failed | cancelled
  "progress": 0.137,
  "current_frame": 521,
  "total_frames": 3800,
  "elapsed_s": 8.4,
  "eta_s": 53.0,
  "decode_ms_per_frame": 0.8,
  "encode_ms_per_frame": 12.3,
  "output_url": null,                          // populated on done
  "output_path": null,                         // server-local path on done
  "error": null
}
```

Once `status == "done"`:

```json
{
  "status": "done",
  "progress": 1.0,
  "output_url": "/api/playback/exports/f8a13c220777/file",
  "output_path": "/Users/.../outputs/playback/29ab3f0c5d11/04-24-1850.mp4",
  "size_bytes": 42088201
}
```

### `GET /api/playback/exports/{job_id}/file`

Returns the rendered video bytes (`video/mp4` / `image/apng` /
`image/gif`) or a zip of PNGs (`application/zip`) for `png-seq`.
404 if the job hasn't finished. Each export also writes a
`<output>.json` sidecar with the full ViewState[], stream
metadata, render-pipeline-version, build version, frame range,
fps, and `Cache-Control: no-store`.

### `DELETE /api/playback/exports/{job_id}`

Cancels a running job; transitions status to `cancelled`. Per
risk-skeptic P0-A, cancel signaling uses `multiprocessing.Event`
so it crosses ProcessPoolExecutor worker boundaries; granularity
is **one batch** — already-submitted batches finish, new
submissions are refused after `set()`. Wall-clock until
status is observably `cancelled` ≤ `worker_count × time_per_frame`,
typically under 1 s.

Returns:

```json
{ "ok": true, "status": "cancelled",
  "partial_output_url": "/api/playback/exports/f8a13c220777/file" }
```

## 6a. Send-to-mode handoff

### `POST /api/playback/streams/{stream_id}/handoff/{mode}`

**Send the raw extracted channel dict** (post-dark, pre-display) to
the analysis-mode `STORE` as a new `LoadedSource`. Display-side
corrections (γ, WB, CCM, brightness, contrast, saturation,
overlay, colormap) are **NOT** baked into the handoff frame —
analysis sees raw DN counts. This is per planner-architect P2-5;
USAF/FPN/DoF measurements depend on raw counts, not display
preview.

Mode is one of `usaf`, `fpn`, `dof`.

Request:

```json
{
  "frame": 1850,
  "view": { ...ViewState... },              // used only for `dark_id` + `channel`
  "preserve_dark": true,
  "name": "Stream 04-24 · f1850 · HG-G"
}
```

Response:

```json
{
  "source_id": "abc123def456",
  "kind": "h5",
  "channels": ["HG-R", "HG-G", "HG-B", "HG-NIR", "HG-Y",
                "LG-R", "LG-G", "LG-B", "LG-NIR", "LG-Y"],
  "shape": [1024, 1024],
  "isp_mode_id": "rgb_nir",
  "has_dark": true,
  "dark_already_subtracted": true
}
```

**`dark_already_subtracted` (risk-skeptic P1-L)**: when true, the
receiving analysis mode (USAF/FPN/DoF) **must not subtract dark
again** — it already happened in the Playback pipeline. The
field rides on the `LoadedSource` schema as a new optional
boolean (default `false` for legacy sources). USAF/FPN/DoF dark
attach paths check the flag and refuse to subtract twice. The
sister field `has_dark` continues to mean "a dark frame is
attached" for diagnostic display.

The frontend switches modes (`mode = 'usaf' | 'fpn' | 'dof'`) and
binds the new source via the existing `setSource(...)` hook.
Channel-key schema is preserved across the handoff (rule 6).

**422 when target mode lacks required channel keys.** Per
planner-architect P0-2:
- USAF requires `Y` (or `L`); only available for ISP modes that
  synthesize Y (`rgb_nir`, RGB-image-as-`Y`, grayscale-as-`L`).
  Handing off a `bare_dualgain` / `polarization_*` frame returns
  422 with `{ "detail": "USAF requires luminance channel; stream
  uses ISP mode 'bare_dualgain' which does not synthesize Y." }`.
- FPN works on any single channel — no 422 from missing Y.
- DoF works on any single channel — no 422 from missing Y.

`recording.extract_frame` mirrors `image_io.load_h5_channels`
(image_io.py:191-196) and synthesizes `HG-Y` / `LG-Y` from `HG-R/G/B`
and `LG-R/G/B` for the `rgb_nir` mode — preserving the frozen 10-key
schema. Other modes leave Y alone.

## 6b. Presets

User-saved presets live in localStorage on the client AND optionally
on the server for shared access.

### `GET /api/playback/presets?kind=view|dark|ccm`

Returns `[{ id, kind, name, payload, created_at, ... }]` sorted by
recency. `payload` is opaque JSON; the client owns the schema.

### `POST /api/playback/presets`

```json
{ "kind": "view", "name": "NIR diagnostic",
  "payload": { ...ViewState... } }
```

Returns the persisted preset with `id`. Persistence: in-process
LRU + an on-disk JSON cache at
`outputs/playback/presets/<kind>.json` for cross-session
durability.

### `DELETE /api/playback/presets/{id}`

Drops a preset.

## 6c. Color-correction matrix utilities

### `POST /api/playback/ccm/from-patch`

Solve a 3×3 CCM from a target patch and an observed patch.

```json
{
  "observed_rgb": [[r,g,b], ...],     // n×3 patches as observed
  "target_rgb":   [[r,g,b], ...],     // n×3 calibrated targets
  "regularize": 1e-3
}
```

Returns the matrix:

```json
{
  "matrix": [[a,b,c], [d,e,f], [g,h,i]],
  "determinant": 1.043,
  "stable": true,
  "residual_rms": 0.0218
}
```

Used by the Inspector RGB-grading section's "Auto from patch"
button. `stable=false` when `|det| < 1e-3`; UI surfaces a warning
and refuses to apply.

## 7. Eviction signaling

Per planner-architect P1-4: **single canonical event name.** When
`PlaybackStore` LRU-evicts a stream / recording / dark / job, the
server records the id in a typed `_evicted` set. Subsequent reads
return 410 Gone:

```json
{ "detail": "stream evicted from session cache",
  "evicted_id": "29ab3f0c5d11", "kind": "stream" }
```

`shared.tsx::apiFetch` already dispatches a `mantis:source-evicted`
event on 410 with `detail.source_id`. We **extend the existing
event** to accept a `detail.kind` field with the union
`'source' | 'stream' | 'recording' | 'dark' | 'job'`. Default
`'source'` for back-compat with the analysis modes. The Playback
React state listens for the same event and routes by `kind`. No new
event names introduced (W-13 / W-29 mitigation).

## 8. Pydantic schemas (server-side names)

Lives in `mantisanalysis/server.py`:

- `PlaybackHealthResponse`
- `RecordingMeta` (re-exposed via Pydantic, same shape as the dataclass)
- `RecordingHandle` (extends RecordingMeta)
- `DarkHandle`
- `StreamBoundary`
- `Stream`
- `StreamWarning`
- `BuildStreamRequest`
- `UpdateStreamRequest`
- `LookupResponse`
- `RangeResponse`
- `ImageExportRequest`
- `VideoExportRequest`
- `ExportJobStatus`
- `ExportJobSubmitted`
- `ViewState` (full ViewerCard config — server consumes it for export
  rendering only; preview uses query params)

`ViewState` mirrors DATA_MODEL.md §5. It's the same dict the React
state owns; we choose Pydantic field names to match `data.tsx`
constants exactly (snake_case in Python, camelCase in TS — pydantic
`Field(..., alias=...)` handles the bridge).

## 9. Test endpoints (gated)

These three exist behind `MANTIS_PLAYBACK_TEST=1` and are off by
default in production:

- `POST /api/playback/recordings/load-sample` — create + register a
  small synthetic H5 (described in TEST_PLAN.md).
- `POST /api/playback/darks/load-sample` — create + register a small
  synthetic dark stack.
- `POST /api/playback/streams/from-sample` — one-shot: load
  recording + dark sample, build a 1-file stream, return the stream.

**Gate semantics (planner-architect P1-11):** the env var is
read **inside** `_mount_playback_api(app)` at app construction
time, not at module import:

```python
def _mount_playback_api(app: FastAPI) -> None:
    if os.getenv("MANTIS_PLAYBACK_TEST", "0") == "1":
        @app.post("/api/playback/recordings/load-sample")
        ...
```

so a developer running `python -m mantisanalysis` after a test
session that forgot to clear the var doesn't ship test endpoints
in production. Tests set the var via `monkeypatch.setenv` scoped
to the `web_server` fixture in `conftest.py` so it doesn't leak
into other shells.

## 10. Caching + rate limits

- All dynamic endpoints `Cache-Control: no-store`.
- Frame PNGs are produced on demand. We cache the *raw* extracted
  frame in `PlaybackStore` keyed by `(recording_id, local_frame)`
  with a small LRU (default 32 frames). This is the only cache.
- No rate limiting (single-user local app).

## 11. Versioning

`api_version` is bumped to `2.0.0` once Playback ships (the Playback
namespace is additive and existing routes remain on v1.x semantics
forever; the version bump signals "Playback is here").

## 12. Sequence diagrams

### Loading a single recording

```
client                                 server (FastAPI)
  │                                       │
  ├─POST /recordings/upload (multipart) ──▶│
  │                                       │ inspect_recording(tmp_h5)
  │                                       │ register handle in PlaybackStore
  │◀── 200 RecordingHandle ──────────────  │
  │                                       │
  ├─POST /streams { recording_ids:[id] } ─▶│
  │                                       │ build_stream(...)
  │◀── 200 Stream ───────────────────────  │
  │                                       │
  ├─GET /streams/{sid}/frame/0.png?... ───▶│
  │                                       │ render_frame(...)
  │◀── 200 image/png ────────────────────  │
```

### Building a multi-file stream

```
client                                 server
  │                                       │
  ├─POST /recordings/upload (×3) ──────  ▶│
  │◀── 200 RecordingHandle ×3 ───────────  │
  ├─POST /streams { recording_ids:[a,b,c],
  │                  continuity_threshold_s:1.0 } ▶│
  │                                       │ detect gaps / overlaps / mismatches
  │◀── 200 Stream w/ warnings ────────────  │
  │                                       │
  ├─PUT /streams/{sid} { recording_ids:[a,c,b] } ▶│
  │                                       │ recompute boundaries
  │◀── 200 Stream (reordered) ────────────  │
```

### Exporting a video

```
client                                 server
  │                                       │
  ├─POST /exports/video {...} ────────  ▶│
  │◀── 202 ExportJobSubmitted ──────────  │
  │                                       │ background thread renders
  │── poll /exports/{job_id} every 250 ms │
  │                                       │
  │◀── 200 ExportJobStatus(0.13)         │
  │ ...                                   │
  │◀── 200 ExportJobStatus(done)         │
  │                                       │
  ├─GET /exports/{job_id}/file ────────  ▶│
  │◀── 200 video/mp4 (Content-Length …)  │
```

## 12a. Future-feed extension point (reserved, no-op)

To absorb a future realtime camera feed without redesigning the
namespace, the following routes are reserved on the schema but
return 501 in this initiative:

- `POST /api/playback/live/start` — begin a live stream. Body:
  `{ "camera_id": str, "isp_mode_id": str }`. Returns
  `LiveStreamHandle` (extends `Stream` with `is_live=true` and
  `frame_advance_strategy: "subscribe"`).
- `POST /api/playback/live/{stream_id}/stop`
- `GET  /api/playback/live/{stream_id}/frame.png` — pulls the most
  recent decoded frame.
- WebSocket `/api/playback/live/{stream_id}/feed` — push channel
  for new frames.

`PlaybackHealthResponse.live_stream_supported` flips to `true` when
these are wired.

## 13. Open questions

- (Resolved 2026-04-24) Should playback render endpoint be `POST`
  with a JSON body? — No; PNG GET keeps browser caching ergonomic and
  matches USAF/FPN/DoF channel-thumbnail precedent.
- (Open) Should we add `/api/playback/streams/{sid}/preview/{view_id}.png`
  routed by view id rather than parameters? — *Decision deferred to
  M8.* Probably not worth it; query params are explicit and the
  React state is the source of truth.
- (Open) Should `view_type=overlay` be a separate type vs. `single +
  overlay_on=true`? — *Decision deferred to M9.* The prototype
  treats overlay as a per-view boolean toggle; we keep that to avoid
  a third view-type axis.
