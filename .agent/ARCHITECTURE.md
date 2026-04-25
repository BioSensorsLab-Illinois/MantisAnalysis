# ARCHITECTURE

As of D-0009 the app is a local web tool: FastAPI backend + React SPA.
The PyQt desktop surface has been deleted.

Four user-facing modes: USAF Resolution, FPN, Depth of Field, and
**Playback (Recording Inspection)** — added by
`recording-inspection-implementation-v1` (2026-04-25). Playback is
flag-gated behind `mantis/playback/enabled` localStorage key.

## Layered view (outer → inner)

```
┌───────────────────────────────────────────────────────────────────┐
│ ENTRY                                                             │
│   mantisanalysis/__main__.py    — `python -m mantisanalysis`       │
│   mantisanalysis/app.py          — CLI → uvicorn + browser launch │
│   `mantisanalysis` console script pointed at app.main_argv         │
├───────────────────────────────────────────────────────────────────┤
│ FRONTEND — React 18 SPA served from the same server at /          │
│   web/index.html                                                   │
│   web/src/shared.jsx   — BRAND, THEMES, icons, API helpers        │
│                          (apiFetch / apiUpload / channelPngUrl),  │
│                          SourceCtx / useSource / useDebounced     │
│   web/src/app.jsx      — App shell, TopBar, ModeRail, ⌘K palette, │
│                          source bootstrap (auto-loads a sample)   │
│   web/src/usaf.jsx     — USAF mode (pick lines → live Michelson)  │
│   web/src/fpn.jsx      — FPN mode (drag ROI → live DSNU/PRNU)     │
│   web/src/dof.jsx      — DoF mode (points + lines + H/V refs)     │
│   web/src/analysis.jsx — analysis results modal (server PNGs)     │
│   web/src/playback/    — Playback mode (16 components, M5–M11):    │
│                          index, state, EmptyState, SourcesPanel,   │
│                          StreamHeader, StreamBuilderModal,         │
│                          FilePill, DarkFrameRow, ViewerCard,       │
│                          ViewerGrid, TimelineStrip, Inspector,     │
│                          OverlayBuilderModal, ExportImageModal,    │
│                          ExportVideoModal, api                     │
├───────────────────────────────────────────────────────────────────┤
│ HTTP API — FastAPI + uvicorn                                       │
│   mantisanalysis/server.py        — route definitions + Pydantic    │
│                                    schemas (analysis modes)         │
│   mantisanalysis/session.py       — in-memory analysis-source store │
│                                    (LRU)                            │
│   mantisanalysis/figures.py       — matplotlib → PNG bytes          │
│   mantisanalysis/playback_api.py  — `/api/playback/*` (Playback     │
│                                    mode — 24+ routes incl. handoff) │
├───────────────────────────────────────────────────────────────────┤
│ PLAYBACK PIPELINE (M1-M11, pure NumPy/h5py/PIL/matplotlib/imageio)  │
│   mantisanalysis/recording.py        — H5 metadata inspection +     │
│                                       extract_frame (5 ISP modes)   │
│   mantisanalysis/dark_frame.py       — average_dark_h5 (mean /      │
│                                       median / sigma_clipped) +     │
│                                       match_dark_by_exposure        │
│   mantisanalysis/playback_session.py — PlaybackStore: recordings /  │
│                                       darks / streams / jobs /      │
│                                       presets + process-global      │
│                                       byte-capped frame LRU         │
│   mantisanalysis/playback_pipeline.py — single render entry point   │
│                                       (WYSIWYG): render_frame +     │
│                                       solve_ccm_from_patches +      │
│                                       CCM_TARGETS catalog           │
│   mantisanalysis/playback_export.py  — image + video export         │
│                                       (mp4 / apng / gif / png-seq), │
│                                       ProcessPoolExecutor for video,│
│                                       ffmpeg gate, sidecar JSON     │
├───────────────────────────────────────────────────────────────────┤
│ FIGURE BUILDERS (pure matplotlib — post D-0014 the files are Qt-free)│
│   mantisanalysis/usaf_render.py    — `build_analysis_figures`      │
│   mantisanalysis/fpn_render.py     — build_{overview,rowcol,map,psd,…}│
│   mantisanalysis/dof_render.py     — build_{heatmap,line_scan,points,…}│
│   mantisanalysis/plotting.py       — CHANNEL_COLORS + `_color`,    │
│                                       `_ch`, `_style_axes` (shared │
│                                       across render + analysis)    │
├───────────────────────────────────────────────────────────────────┤
│ ANALYSIS MATH — pure NumPy / SciPy, headless-testable             │
│   mantisanalysis/usaf_groups.py  — lp/mm, LineSpec, Michelson      │
│   mantisanalysis/fpn_analysis.py — FPN stats + ISP                 │
│   mantisanalysis/dof_analysis.py — 4 focus metrics + calibration  │
│   mantisanalysis/resolution.py   — legacy auto-strip FFT MTF       │
├───────────────────────────────────────────────────────────────────┤
│ IMAGE PIPELINE + I/O                                               │
│   mantisanalysis/image_processing.py — sharpen, B/C/γ, percentile  │
│   mantisanalysis/image_io.py        — unified load_any(path)       │
│   mantisanalysis/extract.py         — GSense dual-gain Bayer       │
│                                        (4×4 super-pixel)           │
└───────────────────────────────────────────────────────────────────┘
```

## Import graph (facts)

- `image_io` → `extract`.
- `plotting` → (no internal deps; pure matplotlib helpers).
- `usaf_render` → `plotting`, `usaf_groups`.
- `fpn_render` → `plotting`, `fpn_analysis`.
- `dof_render` → `plotting`, `dof_analysis`.
- `dof_analysis` → `plotting` (lazy, inside a `@property`, for color).
- `figures` → `usaf_render`, `fpn_render`, `dof_render`.
- `session` → `image_io`.
- `server` → `figures`, `session`, `usaf_groups`, `fpn_analysis`,
  `dof_analysis`, `playback_api` (mounts the `/api/playback/*` routes).
- `app` → `server` (imports `mantisanalysis.server:app` via uvicorn).

**Playback subgraph** (recording-inspection-implementation-v1):
- `recording` → `image_io` (`extract_with_mode`, `luminance_from_rgb`).
- `dark_frame` → `recording`.
- `playback_session` → `recording`, `dark_frame`.
- `playback_pipeline` → `recording`, `dark_frame`, `playback_session`.
- `playback_export` → `playback_pipeline`, `playback_session`.
- `playback_api` → `recording`, `dark_frame`, `playback_session`,
  `playback_pipeline`, `playback_export`, `session` (only on the
  send-to-mode handoff path, to register a `LoadedSource` in the
  analysis-mode `STORE`).

Analysis-purity (AGENT_RULES rule 7) enforced: `recording`,
`dark_frame`, `playback_session`, `playback_pipeline`, `playback_export`
import only from numpy/h5py/PIL/matplotlib/imageio. They never import
fastapi / uvicorn / server. The analysis-mode `STORE` entry happens
exclusively from `playback_api.handoff`, the only API-aware module on
the Playback side.

Acyclic. The pre-D-0014 cross-module reach from `dof_render` into
`fpn_render` (R-0007) is gone; both now share `plotting`.

## Runtime model

`python -m mantisanalysis` → `app.main(argv)` → uvicorn on
`127.0.0.1:8765`, with a background thread that polls the port and
opens the browser once the server is listening.

The FastAPI app at `mantisanalysis.server:app` mounts:
- `/api/*` — JSON endpoints (load-sample, upload, sources list,
  channel thumbnails, usaf/fpn/dof compute + analyze)
- `/` — static `web/index.html`
- `/src/*.jsx`, etc. — static files from `web/`
- `/api/docs` — FastAPI auto-generated interactive docs

Session model: `mantisanalysis.session.STORE` (module-global) keeps
loaded `LoadedSource` dataclasses keyed by a short hex id. LRU-capped
at 12 entries. Thread-safe via an RLock. All analysis endpoints take a
`source_id` and resolve it against the store.

Analysis response shape:
- `/api/usaf/measure` → per-line numbers (all three Michelson flavors +
  samples-per-cycle + reliability flag + profile array).
- `/api/usaf/analyze` → native JSON: channel × line measurements grid +
  per-channel detection limit + base64 channel thumbnails (no PNG
  plots — frontend draws native charts).
- `/api/fpn/compute` → small summary stats for live-drag ROI updates
  (extended in `fpn-rewrite-v1` with `mean_signal`, row/col-only DSNU,
  row/col peak frequencies, hot/cold counts, drift order).
- `/api/fpn/measure` → rich per-ROI payload (row/col profiles + 1-D
  PSDs + top-50 hot/cold pixel coordinates).
- `/api/fpn/measure_batch` → multiple ROIs on one channel in one call.
- `/api/fpn/stability` → PRNU/DSNU stability curve (shrinking ROI).
- `/api/fpn/analyze` → multi-channel × multi-ROI native JSON + per-ROI
  PNGs (overview / rowcol / map / psd / autocorr / psd1d / hotpix).
- `/api/dof/compute` → rich per-point + per-line JSON: gaussian fit
  (μ / σ / FWHM / R²), bootstrap 95% CI on peak + DoF, all-metrics
  parallel sweep, tilt-plane coefficients (post `dof-rewrite-v1`).
- `/api/dof/stability` → DoF-width vs half-window curve for one line.
- `/api/dof/analyze` → multi-channel × multi-line native JSON +
  per-channel base64 PNGs (heatmap / line scan / points / gaussian /
  tilt / metric_compare) + optional multi-channel chromatic-shift PNG.

## Key invariants

1. **GSense Bayer constants** `ORIGIN = (0, 0)` and
   `LOC = {B:(0,0), R:(0,1), G:(1,0), NIR:(1,1)}` at
   `mantisanalysis/extract.py:25-26` are locked to the physical lab
   setup. Do not change.
2. **USAF lp/mm table** follows `2^(group + (element-1)/6)` over groups
   0..5, elements 1..6 — verified in `tests/unit/test_usaf_lpmm.py`.
3. **Channel key schema** returned by `load_any()` is frozen:
   - H5 inputs → `{HG-R, HG-G, HG-B, HG-NIR, HG-Y, LG-R, LG-G, LG-B, LG-NIR, LG-Y}`.
   - RGB image inputs → `{R, G, B, Y}`.
   - Grayscale image inputs → `{L}`.
4. **Theme is a dict** mapping role names (`BG`, `SURFACE`, `TEXT`,
   `ACCENT`, ...) to hex strings. Defined in `web/src/shared.jsx::THEMES`
   for light + dark palettes; every theme-aware component reads via
   `useTheme()` / `useTokens()`. The matplotlib backend reads
   `fig_face` + `text` kwargs from the server-side render helpers.
5. **FastAPI is the single source of truth** for all computed
   numbers. The React layer renders what the server emits; it does
   NOT compute Michelson / DSNU / focus values. Procedural image
   generators in `shared.jsx` (`makeUSAFImage` / `makeFPNImage` /
   `makeDoFImage`) are vestigial — the real canvas image is the
   server-rendered PNG thumbnail via `channelPngUrl(...)`.
6. **localStorage keys** are namespaced `mantis/<mode>/<field>`. User-
   facing state only (theme, mode, DoF refs, plot style, ISP
   settings). Server state (loaded sources) is in-memory and does not
   survive process restarts. Any localStorage schema change needs a
   migration shim or a tolerant reader.
7. **Vite-bundled frontend.** `web/index.html` loads
   `/src/main.jsx` as an ES module; `npm run build` emits
   `web/dist/`, which FastAPI serves at `/`. React, Plotly, and
   dom-to-image-more are real npm packages (post
   `bundler-migration-v1` Phase 3 — 2026-04-24). Source checkouts
   require Node ≥ 20 + npm; pre-built binaries bundle the already-
   built dist.

## Web GUI (single authoritative surface, D-0009)

The `web/` tree is the only frontend. Important properties:

- **Single source of truth = the FastAPI server.** The browser never
  computes Michelson / DSNU / focus values itself. Every number on screen
  originates in `mantisanalysis/{usaf_groups,fpn_analysis,dof_analysis}.py`
  and travels over JSON. Procedural image generators (`makeUSAFImage` /
  `makeFPNImage` / `makeDoFImage` in `shared.jsx`) are vestigial — the real
  canvas image is a server-rendered PNG thumbnail.
- **Server autostart.** `python -m mantisanalysis` boots uvicorn and opens
  the browser. The same server serves the static `web/` tree, so the UI is
  always co-located with its API — no CORS surprises in the default path.
- **Branding + metadata** centralized at `web/src/shared.jsx:10` in the
  `BRAND` object. Keep in sync with `mantisanalysis/__init__.py` on
  version bumps.
- **Vite-bundled.** `web/src/*.jsx` are ES modules; `npm run build`
  emits `web/dist/index.html` + hashed `assets/index-XXXX.js`. The
  CDN + Babel-standalone path was retired in
  `bundler-migration-v1` Phase 3 (2026-04-24). FastAPI serves the
  built dist; if it's missing, `/` returns a friendly "run npm run
  build" page instead of 500ing.
- **Channel-key schema** identical on both sides: `HG-R / HG-G / HG-B /
  HG-NIR / HG-Y / LG-R / LG-G / LG-B / LG-NIR / LG-Y` for H5 sources;
  `R / G / B / Y` for RGB images; `L` for grayscale. See
  `image_io.load_any` and `FPN_CHANNELS` / `USAF_CHANNELS_H5` in the mode
  files.
- **Persistence** uses `localStorage` via `useLocalStorageState` under the
  `mantis/` prefix. User-facing state only (theme, mode, DoF references).
  Server state (loaded sources) is in-memory and does not survive process
  restarts.
