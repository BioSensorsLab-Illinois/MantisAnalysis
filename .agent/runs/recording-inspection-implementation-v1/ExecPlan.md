# ExecPlan — recording-inspection-implementation-v1

> One initiative = one branch = one ExecPlan + one Status.
> Created from `.agent/templates/ExecPlan.md`. Update at every milestone.

Opened: 2026-04-24
Branch: `recording-inspection-implementation-v1` (to be cut from `main` once
M0 lands; user-consent push gate per AGENT_RULES rule 16)
Owner: agent (per user ask, 2026-04-24, "implement the full Recording
Inspection Mode on top of the provided GUI/UIUX template … work
continuously until the feature is complete, tested, browser-verified")

## 1. Goal

Implement a fourth interactive mode — **Playback (Recording Inspection)** —
in MantisAnalysis: a multi-window H5 viewer with multi-file stream
assembly, per-view dark / display / RGB / overlay processing, timeline
navigation with playback, and WYSIWYG image+video export, faithful to
the design at `design/playback/{spec,flows,wireframes}.md` plus the
prototype `playback*.jsx`.

## 2. Why (user value)

- Lab personas (Priya / Marcus / Lan in spec.md §3) need an inspection
  surface that sits next to USAF / FPN / DoF, not a separate tool.
- Today, the only way to look at an H5 recording is `scripts/inspect_recording.py`
  (one frame, no UI) or to send the file to USAF/FPN/DoF (analysis-bound,
  not exploratory).
- Multi-file recordings (buffer-flushed shards) currently have *no* tool
  in the project; engineers reassemble in ad-hoc Python.
- Dark-frame averaging by exposure is a recurring lab task that lives in
  ad-hoc notebooks; bringing it into the app eliminates a class of bench
  errors (wrong dark applied silently).
- The GUI template is a finished design — implementation cost is
  bounded; the unique technical risk is the H5 + multi-file + export
  plumbing, all of which we have partial groundwork for in `image_io`,
  `session.py`, and `channel_to_png_bytes`.

Linked backlog: extends B-0018 (real-sample validation; was blocked on
H5 captures from the lab bench — Playback gives those captures a home)
and partially closes the inspection-tool gap noted in
`HANDOFF.md` "Where to pick up next" §3 ("More Storybook stories" ≪ a
viable Playback mode).

## 3. Scope (in)

**Dependencies:**
- `pyproject.toml` — add
  `[project.optional-dependencies].playback-video = ["imageio-ffmpeg>=0.4.9"]`.
  Per AGENT_RULES rule 9, recorded in `DECISIONS.md` with rationale
  (M10 video export depends on ffmpeg; soft dep keeps default install
  small).

**Backend / data:**
- `mantisanalysis/recording.py` — new module: `RecordingMeta`,
  `inspect_recording()`, `Stream`, `build_stream()`, `frame_lookup()`,
  `extract_frame()`. Pure NumPy / h5py — no FastAPI imports.
- `mantisanalysis/dark_frame.py` — new module: `MasterDark`,
  `average_dark_h5()`, `match_dark_by_exposure()`.
- `mantisanalysis/playback_pipeline.py` — new module: pure-NumPy
  rendering pipeline (dark subtract → gain/offset → normalize →
  threshold → colormap / RGB compose / overlay → 8-bit RGB array). Pure
  NumPy + matplotlib LUTs; no FastAPI / React.
- `mantisanalysis/playback_export.py` — new module: PIL-based image
  export (PNG/TIFF/JPEG, tiled compositions); imageio-ffmpeg-based
  video export (MP4/APNG/PNG-seq), with graceful fallback.
- `mantisanalysis/server.py` — additive Pydantic models + routes under
  `/api/playback/*` (see API_DESIGN.md). No edits to USAF/FPN/DoF
  routes.
- `mantisanalysis/session.py` — additive: `PlaybackStore` keyed by
  `stream_id`, with `RecordingHandle`, `DarkHandle`, `Stream`,
  `ViewState`, `ExportJob`. Existing `LoadedSource` left alone.
- `tests/unit/test_recording_inspect.py`, `test_dark_frame.py`,
  `test_playback_stream.py`, `test_playback_pipeline.py`,
  `test_playback_export.py` — synthetic-H5-fixture-driven; no real
  recordings committed.
- `tests/headless/test_playback_render.py` — render parity between
  preview and export.
- `scripts/smoke_test.py` — extend Tier 3 to exercise
  `/api/playback/health`, `/api/playback/recordings/inspect`,
  `/api/playback/streams`, `/api/playback/streams/{id}/frame`.

**Frontend:**
- `web/src/playback/` — new ES-module subtree:
  - `index.tsx` — `PlaybackMode` entry component; orchestrates
    panels + modals.
  - `data.tsx` — channel/colormap/blend constants + helpers (ported
    from `playback_data.jsx`, but server-data-shaped not
    procedural-fake-shaped).
  - `state.tsx` — `usePlaybackState` reducer + `PlaybackCtx`.
  - `panels/SourcesPanel.tsx`, `Inspector.tsx`,
    `ViewerCard.tsx`, `ViewerGrid.tsx`, `TimelineStrip.tsx`,
    `StreamHeader.tsx`, badges, panels.
  - `modals/StreamBuilderModal.tsx`, `OverlayBuilderModal.tsx`,
    `ExportImageModal.tsx`, `ExportVideoModal.tsx`,
    `WarningCenter.tsx`.
  - `pipeline.ts` — client-side render fallback for the inline
    preview (low-res LUT + alpha overlay).
- `web/src/app.tsx` — register `'playback'` mode, mode-rail tile,
  keyboard shortcut `4`, command-palette entry, `key={stream_id}`
  swap when stream changes.

**Tests / verification:**
- `tests/web/test_playback_boot.py` — Playwright smoke: rail tile
  visible, empty state renders, stream-builder modal opens.
- `tests/web/test_playback_workspace.py` — Playwright feature: load
  a synthetic recording via test-only endpoint, add view, change
  channel, scrub timeline, export image.
- `tests/web/test_accessibility.py` — extend keyboard map with
  Playback shortcuts; assert WCAG A/AA on the workspace.
- `.agent/runs/recording-inspection-implementation-v1/screenshots/`
  — captured for every wireframe-mapped surface.

**Docs:**
- This folder (ExecPlan / Status / API_DESIGN / DATA_MODEL /
  TEST_PLAN / UI_IMPLEMENTATION_NOTES).
- `.agent/HANDOFF.md`, `.agent/CHANGELOG_AGENT.md`,
  `.agent/DECISIONS.md`, `.agent/RISKS.md`,
  `.agent/ARCHITECTURE.md`, `.agent/REPO_MAP.md`,
  `.agent/manifest.yaml`, `.agent/BACKLOG.md`,
  `.agent/QUALITY_GATES.md` (per-change-type table), `README.md`.
- New skill (optional, nice-to-have): `.agent/skills/recording-inspection/SKILL.md`
  — workflow for Playback feature work.

## 4. Out of scope (deliberately deferred)

- **Live camera feed.** Spec.md §2.1 non-goal. Per user 2026-04-24:
  "leave space for future realtime feed integration" — the
  architecture reserves a `LiveStreamHandle` extension point on
  `PlaybackStore` and a `view.live=true` field (no-op for now) so
  future integration is purely additive.
- **Multi-user / shared sessions.** Spec.md §2.1 non-goal.
- **Auto-detect lab anomalies.** Out of mandate; warnings cover
  metadata mismatches only.
- **Real H5 recordings in git.** Per AGENT_RULES rule 11. Dev
  fixture path `/Users/zz4/Desktop/day5_breast_subject_1` is the
  canonical real-data target for manual verification only; never
  committed.

## 4a. Newly in-scope per user 2026-04-24

- **GIF export.** Per spec.md §14.3 stretch; pulled IN. Implemented
  in `playback_export.export_video(fmt='gif')` via Pillow's
  `save_all=True` with optional palette quantization.
- **Color-correction matrix (CCM) UI.** A 3×3 measurable CCM editor
  in the Inspector RGB-grading section, layered on top of (not
  instead of) the gain/offset/γ/WB controls. Disclosure preserved:
  applied as display correction, not "calibrated ground truth"
  unless the user pins a measured target. M8 ships the editor, M11
  ships save/load presets for CCMs.
- **Color-calibrated WB.** When the user provides a known white
  point (X-Rite-style preset list or a clicked-pixel "this should
  be neutral" workflow), WB applies a measured 3×3 matrix not just
  K-temperature. Sits in the same RGB-grading section, separate
  Segmented "Display K / Calibrated patch".
- **"Send frame to USAF / FPN / DoF" routing.** Right-click on any
  ViewerCard → "Send to USAF / FPN / DoF". Server-side: Playback
  exposes `POST /api/playback/streams/{id}/handoff/{mode}` that
  builds a `LoadedSource` from the rendered frame's raw channel
  dict (preserving the channel-key schema), registers it in the
  analysis `STORE`, returns the `source_id`. Client: switches mode
  and binds the new source. M11 ships this; spec.md §15 R11 is
  reclassified as IN-SCOPE.
- **Visual-regression baselines (Tier 6).** Per user 2026-04-24:
  "establish baseline now". Screenshots captured at every milestone
  via Playwright `expect(locator).to_have_screenshot()`. Closes
  R-0011 inside this initiative.
- **Storybook stories for Playback primitives.** Pulled IN as a M11
  deliverable: `ProcessingBadge`, `FilePill`, `DarkFrameRow`,
  `StreamChip`, `ViewerCard` (locked / failed / loading variants).

## 5. Architecture impact

ARCHITECTURE.md layered view (`.agent/ARCHITECTURE.md` §"Layered view"):

- **Frontend** — adds the `web/src/playback/` subtree alongside
  `usaf.tsx` / `fpn.tsx` / `dof.tsx`. No edits to USAF/FPN/DoF code.
- **HTTP API** — adds `/api/playback/*` (own namespace). Existing
  routes untouched. Pydantic schemas live in `server.py` next to
  current ones.
- **Figure builders** — none touched (Playback renders to PNG via
  PIL + matplotlib colormaps directly, not via `*_render.py`).
- **Analysis math** — none touched. Recording / dark / pipeline
  modules are *new* layers strictly downstream of `extract.py` /
  `image_io.py`.
- **I/O** — `recording.py` reuses `extract.load_recording` for the
  H5 read; `dark_frame.py` reuses `extract_with_mode`. The frozen
  invariants (`ORIGIN`, `LOC`, channel-key schema) are honored.

Net diagram delta:

```
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND (existing) + playback/* (NEW)                              │
├──────────────────────────────────────────────────────────────────────┤
│ HTTP API: existing + /api/playback/* (NEW)                          │
├──────────────────────────────────────────────────────────────────────┤
│ Figure builders (unchanged)                                          │
├──────────────────────────────────────────────────────────────────────┤
│ Analysis math (unchanged)                                            │
├──────────────────────────────────────────────────────────────────────┤
│ Image pipeline + I/O                                                 │
│   image_processing  image_io  extract  isp_modes                     │
│   ↓ NEW DOWNSTREAM (still pure NumPy):                               │
│   recording  dark_frame  playback_pipeline  playback_export          │
└──────────────────────────────────────────────────────────────────────┘
```

## 6. UI/UX impact

User-visible surface delta:

- New mode rail tile `Playback` (4th), keyboard `4`, command-palette
  entry "Switch to Playback".
- New full-page mode with seven design-spec regions:
  ModeChrome / StreamHeader / Sources / ViewerGrid / Inspector /
  Timeline / Notifications.
- New file-picker accepting `.h5` (recordings) and `.h5` (dark frames)
  via separate CTAs.
- Five layout presets: Single / Side / Stack / 2×2 / 3+1.
- Five modals: StreamBuilder / OverlayBuilder / ExportImage /
  ExportVideo / WarningCenter.
- Keyboard map extended: `Space` play/pause, `←/→` step, `Shift+←/→`
  step×10, `Home/End` first/last, `[`/`]` cycle view selection,
  `4` switch mode, existing `⌘K` palette + `?` help still work.
- USAF / FPN / DoF modes are unchanged. No regression in their UX.
- Light + dark themes both honored. No new tokens.

See [`UI_IMPLEMENTATION_NOTES.md`](UI_IMPLEMENTATION_NOTES.md) for the
component-level plan.

## 7. Backend / API impact

New routes (full schemas in [`API_DESIGN.md`](API_DESIGN.md)):

- `GET  /api/playback/health` — capability probe + ffmpeg/imageio status.
- `POST /api/playback/recordings/inspect` — read metadata for a path
  (no session attachment); returns `RecordingMeta`.
- `POST /api/playback/recordings/upload` — upload + persist + inspect.
- `GET  /api/playback/recordings` — list known recording handles.
- `DELETE /api/playback/recordings/{rec_id}` — drop a handle.
- `POST /api/playback/darks/upload` — upload + average a dark stack.
- `POST /api/playback/darks/load-path` — load dark from disk.
- `GET  /api/playback/darks` — list master darks.
- `DELETE /api/playback/darks/{dark_id}` — drop a dark.
- `POST /api/playback/streams` — build a `Stream` from ordered
  recording_ids + continuity threshold + isp_mode.
- `GET  /api/playback/streams` — list.
- `GET  /api/playback/streams/{stream_id}` — full stream incl.
  boundaries, warnings.
- `DELETE /api/playback/streams/{stream_id}` — drop.
- `GET  /api/playback/streams/{stream_id}/frame/{frame}.png` — render
  a single frame (with the per-view processing query string). The
  WYSIWYG renderer.
- `GET  /api/playback/streams/{stream_id}/frame/{frame}/raw` — raw
  channel arrays (base64 float32 npz, internal use; small frames only;
  used for export-side rendering when `compose=tiled`).
- `POST /api/playback/exports/image` — start image export job.
- `POST /api/playback/exports/video` — start video export job.
- `GET  /api/playback/exports/{job_id}` — poll job status.
- `DELETE /api/playback/exports/{job_id}` — cancel.

Shared session store gets a parallel `PlaybackStore` (DATA_MODEL.md
§4); USAF/FPN/DoF `STORE` is untouched. New module `mantisanalysis/playback_session.py`
keeps the new state isolated.

## 8. Data model impact

- **Channel-key schema is unchanged** (frozen invariant). All
  recordings load through `image_io.load_any_detail`; resulting keys
  stay `HG-R / HG-G / … / LG-Y` etc.
- **localStorage** adds:
  - `mantis/playback/layout` — last layout preset.
  - `mantis/playback/inspectorOpen` — last collapsed-state map.
  - `mantis/playback/sourcesOpen` — sources collapsed state.
  - `mantis/playback/defaults` — per-band default colormap + thresholds.
  - `mantis/playback/labels` — last burned-label set.
  - `mantis/playback/continuityThreshold` — last threshold (default 1.0 s).
- **Session store**: new `PlaybackStore` (separate from the analysis
  `STORE`); see [`DATA_MODEL.md`](DATA_MODEL.md).
- **No DB**, no on-disk serialization. The new store is in-process and
  evicts on the same LRU as `STORE`.

## 9. Test strategy

Per-tier mapping (see [`TEST_PLAN.md`](TEST_PLAN.md) for detail):

- **Tier 0** — `.agent` doc consistency: `scripts/check_agent_docs.py`,
  `check_skill_frontmatter.py`, `check_stopping_criteria.py`,
  `check_reviewer_evidence.py`, `check_frontend_lint.py`. Runs every
  milestone and at close.
- **Tier 1** — imports: extend `scripts/smoke_test.py::tier1` modules
  list with `recording`, `dark_frame`, `playback_pipeline`,
  `playback_export`, `playback_session`.
- **Tier 2** — headless figures: extend `tier2` to:
  (a) build a synthetic 8-frame H5, run `inspect_recording`, assert
  meta. (b) render one frame through `playback_pipeline.render_frame`
  with overlay enabled and write to `outputs/smoke/playback_*.png`.
- **Tier 3** — FastAPI: new round-trip in `tier3`:
  - inspect → upload → build_stream → request frame.png →
    request export-image PNG (synchronous tiny stream).
- **Tier 4** — Playwright smoke (`tests/web/test_playback_boot.py`):
  rail tile + empty state + builder modal open.
- **Tier 5** — Playwright feature (`tests/web/test_playback_workspace.py`):
  end-to-end flow with mocked / synthetic recording loaded via a
  test-only `/api/playback/recordings/load-sample` endpoint.
- **Tier 7** — accessibility: keyboard tab walk + axe-core scan on the
  Playback workspace + dark-frame manager open. New `BASELINE_*` set
  to 0 in `tests/web/test_accessibility.py`.
- **Tier 8** — performance: profile timeline scrubbing on a 4 000-frame
  synthetic stream; assert preview render time < 100 ms (P95 from
  preview-network panel) at 1080p; assert no obvious re-render-storm
  on view selection.

Unit tests (Python):
- `tests/unit/test_recording_inspect.py` — synthetic H5 → metadata,
  channel layout, gap/exposure detection, partial-load handling.
- `tests/unit/test_dark_frame.py` — averaging math, exposure matching,
  shape-mismatch rejection.
- `tests/unit/test_playback_stream.py` — multi-file ordering,
  continuity, global ↔ local frame mapping, quarantine.
- `tests/unit/test_playback_pipeline.py` — dark / gain / offset /
  normalize / threshold / colormap / RGB / overlay numerics.
- `tests/unit/test_playback_export.py` — image export round-trip,
  tiled composition, label burn-in placement, video metadata when
  ffmpeg available; gracefully skip when not.

Headless integration:
- `tests/headless/test_playback_render.py` — preview vs export render
  parity (same image bytes, same labels, same dimensions).

## 10. Verification agents to invoke (at close)

Per AGENT_RULES rule 14 + STOPPING_CRITERIA. Reviewers fire
**serially per milestone close** per user 2026-04-24. Findings in
`reviews/<agent>-<milestone>.md`; severities recorded in Status.md.

- [x] `planner-architect` — review the ExecPlan + DATA_MODEL +
      API_DESIGN before code begins. (Pre-M0 close.) **Done
      2026-04-24** — see `reviews/planner-architect.md`.
- [ ] `risk-skeptic` — review at M0 close (planner-architect P1-5),
      M3 close (stream-builder lands), and M11 close (export
      round-trip).
- [ ] `react-ui-ux-reviewer` — at M5 close (mode shell), M7 close
      (multi-view), M9 close (overlay).
- [ ] `frontend-react-engineer` — at M8 close (per-view inspector
      wired) and at final close.
- [ ] `fastapi-backend-reviewer` — at M4 close (frame extraction +
      preview endpoint) and at final close.
- [ ] `playwright-verifier` — at M5 close (boot smoke) and at final
      close (feature suites).
- [ ] `test-coverage-reviewer` — at final close.
- [ ] `performance-reviewer` — at M7 close (timeline profile) and at
      M10 close (export).
- [ ] `accessibility-reviewer` — at M11 close (a11y sweep).
- [ ] `docs-handoff-curator` — final close, mandatory.

## 11. Milestones

Each shippable independently (working app, no console errors), each
gates with a specific `<check>`.

- [ ] **M0 — Audit + plan.** Read GUI template. Read code. Author
      ExecPlan / DATA_MODEL / API_DESIGN / TEST_PLAN /
      UI_IMPLEMENTATION_NOTES / Status. Verify by `planner-architect`
      review. **Verified by**: ExecPlan committed; reviewer report
      filed in `reviews/planner-architect.md`.

- [ ] **M1 — Backend: H5 inspection + flexible detection (all 5 ISP
      modes).** Implement `mantisanalysis/recording.py` with
      `inspect_recording()` that returns `RecordingMeta` (frame_count,
      frame_shape, channels, timestamps, exposure, fps, warnings).
      Add a synthetic-H5 builder to `tests/unit/_h5_fixtures.py`.
      Support all five ISP modes from this milestone:
      `rgb_nir`, `bare_single`, `bare_dualgain`,
      `polarization_single`, `polarization_dual`. **Y synthesis**
      preserved for `rgb_nir` (HG-Y / LG-Y) inside
      `recording.extract_frame` so handoff to USAF/FPN/DoF in M11
      sees the canonical 10-key channel set. **Verified by**:
      `tests/unit/test_recording_inspect.py` green; Tier 1 only
      (Tier 2 unchanged from baseline — Playback's Tier 2 assertion
      lands at M4 close when `render_frame` exists). Dev-folder
      smoke (3 files of different exposures) is **logged in
      Status.md**, not gating (per planner-architect P1-1).

- [ ] **M2 — Backend: dark-frame averaging + exposure matching +
      revert-rehearsal smoke.**
      `mantisanalysis/dark_frame.py` with `average_dark_h5()` and
      `match_dark_by_exposure()`. Three averaging strategies:
      mean (default, fast), median (cosmic-ray resistant), sigma-clipped
      mean (3σ). Strategy chosen at average time; recorded on the
      `MasterDark`. Per risk-skeptic P1-F: **at M2 close, run a
      `git revert HEAD; tier 1; tier 2; git revert <revert>`
      rehearsal** to confirm the leaf-revert path works before any
      higher-stake mistake. **Verified by**:
      `tests/unit/test_dark_frame.py` green (covers all 3 strategies);
      Tier 1 + Tier 2; revert rehearsal logged in Status.md.

- [ ] **M3 — Backend: multi-file stream + global frame mapping.**
      `Stream`, `build_stream()`, `frame_lookup()`. Continuity / gap /
      overlap / exposure-mismatch / shape-mismatch /
      channel-intersection detection. Quarantine. Per
      planner-architect P1-2: `tests/unit/test_playback_stream.py`
      includes `test_three_synthetic_recordings_with_canonical_layout`
      that builds three (N, 2048, 4096, 1) GSense FSI legacy-shape
      H5s and asserts the resulting boundaries, total_frames,
      available_channels intersection, and W-CHAN warning when one
      file is missing a channel. **Verified by**:
      `tests/unit/test_playback_stream.py` green; Tier 1 + Tier 2.

- [ ] **M4 — Backend: extraction pipeline + preview endpoint.**
      `playback_pipeline.render_frame()`. New routes:
      `/api/playback/recordings/inspect`, `/api/playback/recordings`,
      `/api/playback/streams`, `/api/playback/streams/{id}/frame/{n}.png`.
      Pydantic models. **Verified by**:
      `tests/unit/test_playback_pipeline.py` green; Tier 3 round-trip
      green; `fastapi-backend-reviewer` review.

- [ ] **M5 — Frontend: mode shell + empty state + sources skeleton +
      eviction kind-routing fixes.**
      Register `'playback'` mode in `app.tsx` **behind the
      `mantis/playback/enabled` feature flag** (P1-K).
      `web/src/playback/index.tsx` + `state.tsx` +
      `panels/SourcesPanel.tsx` + `StreamHeader.tsx`.
      **Required `shared.tsx` + `app.tsx` edits** (risk-skeptic P0-B
      + P3-W):
      - `web/src/shared.tsx::apiFetch` widens `sidMatch` regex to
        match `/api/(sources|playback/streams|playback/recordings|playback/darks)/[id]`
        and dispatches `mantis:source-evicted` with
        `detail.kind ∈ {'source','stream','recording','dark','job'}`.
      - `web/src/app.tsx::onEvicted` listener (lines 159–173)
        filters on `kind === 'source' || kind == null` before
        reloading any USAF/FPN/DoF sample. The Playback reducer
        listens for the same event and routes by `kind`.
      Per planner-architect P2-10: M5 verification gate is **rail
      tile + keyboard `4` (gated by feature flag) + empty-state
      copy + no console errors**, *not* "click load-recording"
      (test endpoint lands at M6).
      **Verified by**: `tests/web/test_playback_boot.py` green at
      Tier 4 — asserts (a) feature-flag gating works (default
      OFF: no rail tile; ON: rail tile visible), (b) `4` keypress
      activates mode only when flag set, (c) empty-state CTA
      buttons render, (d) firing `mantis:source-evicted` with
      `detail.kind='stream'` does NOT trigger
      `/api/sources/load-sample` POST. Browser screenshots in
      `screenshots/m5-empty-state-light-1440x900.png`,
      `m5-empty-state-dark-1440x900.png`,
      `m5-empty-state-light-1024x768.png` (for visual-regression
      baseline pickup, P1-6).
      `react-ui-ux-reviewer` + `frontend-react-engineer` review
      (the eviction + feature-flag changes touch app shell).

- [ ] **M6 — Frontend: file loading, dark manager, stream builder UI.**
      Wire SourcesPanel to `/api/playback/recordings`. Build
      `StreamBuilderModal`. Build dark-frame section + warnings.
      **Verified by**: `tests/web/test_playback_boot.py` extended for
      builder modal; manual upload of a synthetic H5 (with screenshot
      evidence). `screenshots/m6-builder.png`,
      `m6-dark-manager.png`.

- [ ] **M7 — Frontend: ViewerGrid + ViewerCard + TimelineStrip.** All
      five layout presets. Add/remove/duplicate/select/lock view.
      Timeline scrubbing + playback. Sync vs locked behavior.
      **Verified by**: `tests/web/test_playback_workspace.py` green;
      `screenshots/m7-2x2.png`, `m7-locked.png`,
      `m7-timeline.png`. `performance-reviewer` profile attached.

- [ ] **M8 — Frontend: per-view Inspector with all 9 collapsible
      sections wired, including CCM editor + presets.**
      View / Source / Corrections / Display / RGB grading / Overlay
      / Labels / Presets / Advanced. Basic/Advanced segmented at
      top. CCM 3×3 matrix editor in RGB grading section
      (auto-from-patch, manual edit, det-stability guard, preset
      load/save). Presets fully wired: Save / Load / Copy-to-other-views
      with localStorage persistence under `mantis/playback/presets/`.
      Frame-cache size adjustable in Advanced section.
      Roundtrip every control to a backend frame request, then verify
      the rendered PNG changes accordingly.
      **Verified by**: per-section interaction tests in
      `test_playback_workspace.py`; screenshots `m8-source.png`,
      `m8-display.png`, `m8-rgb-ccm.png`, `m8-overlay.png`,
      `m8-presets.png`, `m8-advanced.png`. `frontend-react-engineer`
      review.

- [ ] **M9 — Overlay system end-to-end.** Per-view overlay config +
      `OverlayBuilderModal`. Backend `overlay` query params on
      `/frame.png`. Composition: alpha / additive / screen / masked.
      **Verified by**: dedicated overlay test in `test_playback_workspace.py`;
      `screenshots/m9-overlay.png`. `react-ui-ux-reviewer` review.

- [ ] **M10 — Export system: image + video, parallelized.**
      `playback_export.py` + `/api/playback/exports/image` +
      `/api/playback/exports/video`. Job model, progress polling,
      cancel. WYSIWYG: same renderer as preview. Frame rendering
      uses `concurrent.futures.ProcessPoolExecutor` (workers =
      `os.cpu_count() // 2`); workers re-open the H5 by path. GIF
      output via Pillow `save_all=True`. Sidecar JSON emitted by
      default. Filename tokens include the full set
      `{stream}/{stream_short}/{frame}/{seq}/{timestamp}/{iso}/
      {date}/{view}/{view_id}/{channel}/{exposure}/{ms}/{file}/
      {layout}` derived from the dev recording metadata.
      **Verified by**:
      `tests/unit/test_playback_export.py` (image always, video and
      GIF when `imageio-ffmpeg` and `Pillow` present),
      `tests/headless/test_playback_render.py` preview/export parity,
      `screenshots/m10-export-image.png`,
      `m10-export-video-setup.png`,
      `m10-export-video-progress.png`,
      `m10-export-video-done.png`. Wall-clock ≤ 8 s for 1-second
      30-fps tiled-2×2 1080p MP4. `performance-reviewer` review on
      a 4 000-frame synthetic stream + the dev recording.

- [ ] **M11 — Polish, a11y, responsive, perf, handoff routing,
      Storybook, skill doc.** Keyboard map. Focus rings. Tab order.
      axe-core 0 critical/serious. Narrow-window layout (≤1180 px).
      Reduce re-render storms via memo where the profiler shows
      them. Wire `POST /api/playback/streams/{id}/handoff/{mode}`
      and the right-click "Send to USAF/FPN/DoF" affordance.
      Handoff sends **raw extracted channel dict** (post-dark,
      pre-display γ/WB/CCM) to preserve analysis-grade DN counts
      (planner-architect P2-5). 422 when target mode lacks the
      required channel keys (e.g. `bare_dualgain` → USAF lacks `Y`).
      Author `.agent/skills/recording-inspection/SKILL.md`. Add
      Storybook stories under `web/src/stories/playback/` for
      ProcessingBadge / FilePill / DarkFrameRow / StreamChip /
      ViewerCard (planner-architect P2-8). **Verified by**:
      Tier 7 a11y green; `tests/web/test_accessibility.py` baseline
      tightened to 0; responsive screenshots
      `screenshots/m11-narrow-1180.png`, `m11-narrow-1024.png`;
      `tests/web/test_playback_handoff.py` green;
      `npm run build-storybook` clean. `accessibility-reviewer`
      review.

- [ ] **M12 — Final verification + visual-regression baselines + CI
      wiring + docs + handoff.** Update HANDOFF / CHANGELOG /
      DECISIONS / RISKS / ARCHITECTURE / REPO_MAP / manifest /
      BACKLOG / README. Re-run all relevant tiers. Audit + finalize
      Tier 6 visual-regression baselines (incremental capture
      happens at M5/M6/M7/M8/M9/M10/M11 closes per
      planner-architect P1-6) under
      `tests/web/__baselines__/playback/`. Wire Tier 4 / Tier 5 /
      Tier 7 Playwright matrix into `.github/workflows/smoke.yml`.
      Spawn reviewer agents per §10. Resolve every P0/P1. Final
      response to user states what was verified and any deferrals.
      **Verified by**: STOPPING_CRITERIA checklist 100% green; CI
      green on a synthetic PR; visual regression delta ≤ 2% for
      every baseline.

## 12. Acceptance criteria

Per `STOPPING_CRITERIA.md` + per-change-type table in
`QUALITY_GATES.md`:

- [ ] Tier 0 — `.agent` consistency green.
- [ ] Tier 1 — imports green (15 → 20 modules, +5 new).
- [ ] Tier 2 — headless figures green (existing + 1 new playback render).
- [ ] Tier 3 — FastAPI green (existing + new playback round-trip).
- [ ] Tier 4 — `pytest -m web_smoke` green (existing + 2 new files).
- [ ] Tier 5 — `tests/web/test_playback_workspace.py` green.
- [ ] Tier 6 — visual regression baselines established and within
      ≤ 2% delta for every wireframe surface.
- [ ] Tier 7 — axe-core 0 critical / 0 serious WCAG A/AA.
- [ ] Tier 8 — preview render P95 < 150 ms at 1080p; export 30 fps
       1080p video uses < 8 GB RAM and ≤ 8 s for 1-second tiled-2×2.
- [ ] `pytest -q` green (109 → 109 + new tests, no regressions).
- [ ] `npm run build` green; `npm run lint` 0 errors / 0 warnings;
      `npm run typecheck` 0 errors; `npm run build-storybook` clean.
- [ ] Browser-verified all 15 wireframe screens in `screenshots/`,
      light + dark + 1024 / 1280 / 1920 / 2560 viewports, every
      milestone.
- [ ] **Playwright run mandatory before any milestone marked done.**
- [ ] CI matrix (Tier 4 / 5 / 7) green on a synthetic PR.
- [ ] Manual verification against `/Users/zz4/Desktop/day5_breast_subject_1`
      passes for at least 3 distinct files (different exposures).
- [ ] No console errors in core workflow.
- [ ] No 4xx/5xx in core workflow network panel.
- [ ] All reviewer P0/P1 findings resolved.
- [ ] Docs synced per `skills/docs-sync/SKILL.md`.
- [ ] Status.md / HANDOFF.md / CHANGELOG_AGENT.md updated.
- [ ] `.agent/skills/recording-inspection/SKILL.md` authored and
      passes `check_skill_frontmatter.py`.
- [ ] `imageio-ffmpeg` listed under
      `[project.optional-dependencies].playback-video` in
      `pyproject.toml`; `pip install -e '.[playback-video]'` works.
- [ ] Send-to-mode handoff round-trips through USAF / FPN / DoF
      with channel-key schema preserved (Tier 3 + Tier 5).

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | H5 dataset variability — files with non-standard layouts crash `load_recording` | High | `inspect_recording` wraps `load_recording` with structured error → `RecordingMeta(error=...)`. Detect `/camera/frames` first; fall back to 7 layout variants per DATA_MODEL.md §2.2; **every fallback raises a once-per-session modal warning** "We're guessing — confirm before continuing" |
| W-2 | Multi-thousand-frame timeline scrubbing feels laggy in browser | Med | Server-side preview is already PNG; client just swaps `<img>` src. Mini-map renders once per stream change. Detail row uses CSS-only ticks. Debounce scrub at 30 ms. R3 in spec.md |
| W-3 | Export WYSIWYG drift between preview and export | High | Single render entry point: both endpoints call `playback_pipeline.render_frame`. `tests/headless/test_playback_render.py` asserts byte-equality on identical params |
| W-4 | Video export depends on ffmpeg / imageio-ffmpeg, which is system-specific | Med | `imageio-ffmpeg` ships its own ffmpeg binary on Linux/macOS/Windows wheels; we make it a soft dep. Without it, `/exports/video` returns 503 `ffmpeg not available — install imageio-ffmpeg`. UI surfaces this to the modal |
| W-5 | Memory spike loading multiple long H5 recordings into RAM | High | Use `h5py` lazy datasets; only the current frame is materialized. Stream metadata reads frame *count* and *first/last timestamps* from the dataset — not the data |
| W-6 | Dark-frame averaging blocks the request loop on big stacks | Med | Average in a worker thread with a small tqdm-style progress; route returns 202 + job id; client polls. Soft cap 256 frames per dark, configurable |
| W-7 | Auto-grouping into a stream surprises users (R7 in spec.md) | Med | Default threshold 1.0 s; show plain-language rationale on each row in StreamBuilder; require explicit Apply; never auto-merge across exposure mismatch without user confirm |
| W-8 | Auto-applied dark hides bugs (spec.md R6) | Med | Dark correction OFF by default; per-view explicit toggle; `DRK` badge always visible when active |
| W-9 | RGB grading misread as calibrated correction (spec.md R4) | Med | Disclosure line "Display grading — not color calibrated" in inspector + builder; no "calibration" wording anywhere in Playback |
| W-10 | Channel key schema drift if we accidentally introduce a new key | High | Explicit assertion in `recording.py::_normalize_channel_keys` against the frozen set; unit test exercises all five existing ISP modes; covered by AGENT_RULES rule 6 |
| W-11 | Playwright file-picker brittle for tests | Med | Add `/api/playback/recordings/load-sample` test-only synthetic H5 endpoint behind `?test=1` query gate (or hidden by default and called via `apiFetch`); tests use it instead of OS file picker |
| W-12 | Inspector with 6 tabs feels deep (spec.md R1) | Med | "Basic / Advanced" Segmented at top of inspector that hides Presets / Advanced for novices (we ship as Basic-default with persisted opt-in) |
| W-13 | Eviction races (R-0009) — stream cached client-side, evicted server-side | Med | Reuse the `mantis:source-evicted` event pattern. PlaybackStore evictions broadcast `mantis:stream-evicted` with the id. Client listens, reloads sample, surfaces toast |
| W-14 | Locked views violate the "global frame is the only frame" mental model | Low | Locked-view pin on timeline + `LCK` badge + footer "LCK · frame 100" line are persistent; spec.md R2 mitigation |
| W-15 | Bundle bloat from a Playback subtree (already 5.35 MB pre-Plotly) | Low | No new heavy npm dep; everything is React + DOM canvas. Server renders to PNG so we don't ship LUTs to the browser. |
| W-16 | ProcessPoolExecutor + h5py file handles — passing an open `h5py.File` across processes corrupts state | High | Workers re-open the file by path inside the process; never pickle h5py objects. Tests assert workers can read concurrently against the dev recording folder |
| W-17 | OOB indexing on non-square channel shapes when ISP geometry produces (H, W) where H ≠ W | Med | `playback_pipeline.render_frame` asserts `0 ≤ low ≤ high` and clamps slices to `frame.shape`; `tests/unit/test_playback_pipeline.py` feeds non-square synthetic frames; ISP coordinate page recomputes bounds on shape change |
| W-18 | Real H5 dev folder unreadable — wrong path, permissions, files moved | Low | Path is referenced by absolute string only; tests never depend on it; M5 onward: bench the empty state behavior and surface a "real recording not found" hint when `MANTIS_PLAYBACK_DEV_PATH` is set but absent |
| W-19 | Visual-regression baseline drift on font-rendering differences across machines | Med | Pin Playwright's chromium version (already pinned via `playwright install`); use `to_have_screenshot(threshold=0.02)` per Playwright best practice; baselines stored under `tests/web/__baselines__/playback/` |
| W-20 | "Send to USAF/FPN/DoF" handoff loses dark-correction state across mode boundaries | Low | The handoff endpoint emits raw + dark dict in the new `LoadedSource`; the receiving mode's existing dark-attach path picks it up. Tests round-trip via Tier 3 |
| W-21 | CCM editor allows numerically-unstable matrices (singular, near-zero determinant) | Low | UI clamps `|det| ≥ 1e-3` with a warning; preset library ships sane starter matrices |
| W-22 | Combined `STORE` + `PlaybackStore` LRU saturation: ≥ 500 MB live (planner-architect P2-1) | Med | Document combined cap in DATA_MODEL §13; surface in Inspector Advanced section as "Memory" line; lower one cap if real-world spikes cross the budget |
| W-23 | Frame LRU sized by *count* not *bytes* — 32 frames × 16 MB at 1080p × 10 channels = 512 MB; at 2048×4096 raw the budget explodes (planner-architect P1-8) | High | LRU is byte-capped at default 2 GB (configurable [256 MB .. 8 GB]); user-adjustable knob in Inspector Advanced tracks current_bytes / current_frames |
| W-24 | M5 commits "Playback rail tile" before any test endpoints exist; opening it shows empty state but no test path to load a sample (planner-architect P2-10) | Low | M5 verification = rail tile + keyboard `4` + empty-state copy + no console errors. The `/recordings/load-sample` test endpoint lands at M6 with the file-loading UI |
| W-25 | Handoff bakes display γ / WB / CCM into the analysis source, contaminating measurements (planner-architect P2-5) | High | Handoff sends the **raw extracted channel dict** (post-dark, pre-display); display γ/WB/CCM live only in `render_frame`. Documented in API_DESIGN §6a |
| W-26 | Byte-equality WYSIWYG test fragile to PIL font hinting differences (planner-architect P2-6) | Med | Run byte-equality test with `include_labels=False`; label burn-in tested separately via corner-pixel-non-bg assertions |
| W-27 | ExportJob holds h5py file handles via worker pool; concurrent eviction races (planner-architect P2-7) | High | When an `ExportJob` registers, pin its `recording_id`/`stream_id` to a no-evict set; release on done/cancel/failed |
| W-28 | Channel intersection across stream files silently drops channels (planner-architect P1-12) | Med | `build_stream` emits `W-CHAN` for every channel that's missing in any file; FilePill surfaces the warning chip; spec.md "we're guessing" modal raises once per code |
| W-29 | `MANTIS_PLAYBACK_TEST=1` env-var leaks across sessions in the same shell (planner-architect P1-11) | Low | Tests use `monkeypatch.setenv`; production gate is `os.getenv("MANTIS_PLAYBACK_TEST", "0") == "1"` checked inside `_mount_playback_api(app)` so the gate is per-process not per-import |
| W-30 | M5–M11 commits land on `main` without per-milestone visual-regression coverage; subtle `shared.tsx` drift goes undetected (planner-architect P1-6) | Med | Visual-regression baselines captured at every milestone close starting M5, not deferred to M11 |
| W-31 | `cancel_event: threading.Event` doesn't cross ProcessPoolExecutor (risk-skeptic P0-A) | High | Use `multiprocessing.Event` from `Manager()`. Granularity: one batch. Documented in API_DESIGN §6 |
| W-32 | Existing eviction listener auto-reloads USAF sample on Playback 410s (risk-skeptic P0-B) | High | M5 edits `apiFetch` regex + `app.tsx` listener to filter on `detail.kind`. Tier 4 test asserts no `load-sample` POST on `kind='stream'` 410 |
| W-33 | Per-stream LRU caps don't enforce the documented "combined ~8 GB" peak (risk-skeptic P0-C) | High | LRU is process-global (single OrderedDict keyed by `(stream_id, rec_id, local_frame)`); max 8 GB total. Inspector Memory widget shows global usage |
| W-34 | `Path.exists()` on ffmpeg path doesn't prove ffmpeg works (risk-skeptic P1-D) | Med | `_has_ffmpeg()` execs `ffmpeg -version` and checks returncode==0. Cached 60 s |
| W-35 | Pillow GIF writer single-threaded; 4000 frames takes hours (risk-skeptic P1-E) | High | Hard cap GIF at 300 frames. 422 + W-EXPORT-GIF-CAP. Modal pre-flight surfaces the gate |
| W-36 | Per-milestone revert claim is false for non-leaf commits (risk-skeptic P1-F) | High | §14 rewritten: cascading revert required. M2 revert rehearsal logged. Per-module dependency table published |
| W-37 | WYSIWYG byte-equality breaks under MP4/GIF re-encoding (risk-skeptic P1-G) | Med | Byte-equality restricted to `export_image`. Video uses perceptual diff: mean per-channel < 5 LSB, max < 20 LSB |
| W-38 | Two-tab upload race duplicates 16 GB of bytes in RAM (risk-skeptic P1-H) | Med | Uploads always persist to `outputs/playback/uploads/<id>.h5`; `bytes_cache` removed |
| W-39 | Env var read after app singleton constructed → test routes never mounted (risk-skeptic P1-I) | High | `web_server` fixture sets env var BEFORE `from mantisanalysis.server import app`. Tier 4 sanity asserts `/recordings/load-sample` exists |
| W-40 | M3 timestamp edge cases unspecified (risk-skeptic P1-J) | Low | Tests added: tied first-ts, exact-zero gap, non-monotonic intra-file. New `W-TS-DISORDER` warning |
| W-41 | M5–M11 ships broken UI to `main` (risk-skeptic P1-K) | High | `mantis/playback/enabled` localStorage feature flag, default `false`. Rail tile + keyboard `4` gated. M11 close flips default `true` |
| W-42 | Handoff "post-dark" causes double-dark in receiving mode (risk-skeptic P1-L) | High | Response carries `dark_already_subtracted: true`; receiving mode's dark-attach checks the flag and refuses to subtract again. Tier 3 round-trip test |
| W-43 | DELETE /streams/{id} mid-export breaks worker → progress polling 404s (risk-skeptic P2-P) | Low | Returns 409 Conflict when active job pins the stream |
| W-44 | WB-patch formula in DATA_MODEL §12 was mathematically wrong (risk-skeptic P2-S) | Med | Rewritten to `gain_c = target_c[c] / observed_c[at_xy]`. Coordinated with CCM target picker |

## 14. Rollback plan

Per user 2026-04-24, work happens **directly on `main`** (no
initiative branch). Per planner-architect P0-1 finding:

- Each milestone is a **separate commit on `main`** with a commit
  subject prefix `recording-inspection-v1 Mn —`.
- M1 through M5 commits **are not user-shippable in isolation**
  (backend lands before UI; rail tile arrives at M5; first
  user-visible workflow at M6). Commit messages explicitly state
  this with a "WIP — see initiative" footer.
- Rollback is `git revert <commit>` on the specific milestone
  commit. Reverting M2 while M1, M3, M4 are present is supported
  because the modules are isolated; reverting M5 while frontend
  references exist on main is supported because the frontend
  imports are guarded with `if (mode === 'play')`.
- `web/src/playback/` is isolated; deletion + removal of one
  `'play'` mode entry in `web/src/app.tsx` is sufficient to
  remove the rail tile.
- `mantisanalysis/{recording,dark_frame,playback_pipeline,playback_export,playback_session}.py`
  are isolated modules; deletion is safe (no other module imports
  them).
- `/api/playback/*` are additive; deletion of
  `_mount_playback_api(app)` removes them.
- localStorage keys are namespaced under `mantis/playback/*`; no
  shared keys.
- `pyproject.toml`'s `[project.optional-dependencies].playback-video`
  is additive; removing the entry leaves the default install path
  unaffected.

**User-shippable boundaries on main**: per risk-skeptic P1-K, the
Playback rail tile is gated behind a **`mantis/playback/enabled`
localStorage feature flag** (default `false`). M5–M10 commits ship
the tile + workspace *behind the flag*; reviewers enable via
`localStorage.setItem('mantis/playback/enabled','1')` for testing.
M11 close flips the default to `true`. The keyboard `4` shortcut
and the command-palette "Switch to Playback" entry are also
gated on the same flag — otherwise users hit `4` and get a
blank/broken screen with no recovery. Any commit that breaks USAF
/ FPN / DoF is a P0 finding and gets reverted immediately.

**Rollback realism (risk-skeptic P1-F):** per-milestone reverts
are only safe at HEAD. Reverting M_n while M_{n+1..k} are present
requires reverting M_n through M_k (cascading revert), because
M_{n+1} imports M_n's modules (e.g. M3 imports `recording`,
M4 imports `recording` + `dark_frame`, M9 imports
`playback_pipeline`). Per-milestone module-dependency table:

| Milestone | New module | Imported by |
|---|---|---|
| M1 | `recording.py` | M3 (build_stream), M4 (preview), M9 (overlay), M10 (export) |
| M2 | `dark_frame.py` | M4 (preview), M10 (export) |
| M3 | `playback_session.py` | M4, M5+, M10, M11 |
| M4 | `playback_pipeline.py` | M9 (overlay), M10 (export), M11 (handoff) |
| M5–M11 | frontend incremental | self-contained per file |

A Tier 0 "smoke after revert" rehearsal runs at **M2 close**:
`git revert HEAD; python scripts/smoke_test.py --tier 1; git
revert <revert>` — confirms the revert path works for the
single-leaf case before relying on it for higher-stake mistakes.

## 15. Decisions

Append as they arise during the work.

- (2026-04-24) **Server-side rendering for the preview.** Use the same
  PNG-thumbnail endpoint pattern as USAF/FPN/DoF (`channelPngUrl`
  precedent) rather than shipping float arrays + a JS LUT pipeline to
  the browser. Rationale: numerical correctness, performance for high-
  bit-depth data, parity between preview and export. Cost: scrub
  latency depends on server. Mitigated by tiny PNGs (max_dim 1024).
- (2026-04-24) **Separate `PlaybackStore` instead of overloading
  `STORE`.** Keeps the existing analysis-mode path immutable and
  passes `fastapi-backend-reviewer` instinct check. Cost: two stores.
  Mitigated: each store has its own LRU; eviction events broadcast
  separate window events.
- (2026-04-24) **Channel-key schema is frozen.** All recordings flow
  through `image_io.load_any_detail`; we never coin new keys.
- (2026-04-24, *user-set*) **Work directly on `main`** — no
  initiative branch. Per-milestone commit. Push only with explicit
  user consent.
- (2026-04-24, *user-set*) **`imageio-ffmpeg` becomes a required
  optional install** for the M10 milestone to complete; without
  it, M10 is BLOCKED, not deferred. Added under
  `[project.optional-dependencies].playback-video` in
  `pyproject.toml`.
- (2026-04-24, *user-set*) **9-section collapsible inspector**
  (spec.md §7.1.8) instead of the prototype's 6-tab layout. More
  functions surfaced, Basic/Advanced segmented hides cognitive
  load.
- (2026-04-24, *user-set*) **All 5 ISP modes supported from M1.**
  Channel pickers reflect actual mode key set.
- (2026-04-24, *user-set*) **Frame-LRU is user-adjustable.**
  Default 32; bounds [4, 512]. Lives in Inspector Advanced section
  with explanatory copy.
- (2026-04-24, *user-set*) **Video export parallelized.**
  ProcessPoolExecutor (workers = cpu_count // 2). H5 file handles
  re-opened per-worker by path; never pickled.
- (2026-04-24, *user-set*) **CCM editor in M8.** 3×3 measurable
  matrix on top of (not instead of) gain/offset/γ/WB. Det-stability
  guard `|det| ≥ 1e-3`. Calibrated WB via clicked-pixel "this
  should be neutral" workflow.
- (2026-04-24, *user-set*) **Send-to-mode handoff in M11.**
  Right-click → Send to USAF/FPN/DoF. Renders the active frame to
  a `LoadedSource` and switches mode.
- (2026-04-24, *user-set*) **Visual-regression baselines
  established in this initiative (Tier 6).** Closes R-0011 inline.
- (2026-04-24, *user-set*) **Tier 4/5 wired into CI in M12.**
  GitHub Actions matrix gains a Playwright job.
- (2026-04-24, *user-set*) **Reviewer agents fire serially per
  milestone close**, not in parallel. Cleaner finding chains.
- (2026-04-24, *user-set*) **Storybook stories for Playback
  primitives in M11.**
- (2026-04-24, *user-set*) **Playwright run is mandatory before
  any milestone is marked done.** No exceptions.
- (2026-04-24, *user-set*) **Dev recording fixture path is
  `/Users/zz4/Desktop/day5_breast_subject_1`** (33 H5 files,
  GSense FSI Dual-Gain, exposures 0.005s–0.4s). Used for manual
  verification only; never committed.
- (2026-04-24, *planner-architect*) **Frame LRU is byte-capped,
  not count-capped.** Default 2 GB; user-adjustable in Inspector
  Advanced [256 MB .. 8 GB].
- (2026-04-24, *planner-architect*) **Eviction event uses the
  existing `mantis:source-evicted` name with `detail.kind` field.**
  No new event names. `kind ∈ {'source','stream','recording','dark','job'}`.
- (2026-04-24, *planner-architect*) **Handoff to USAF/FPN/DoF
  passes raw extracted channel dict** (post-dark, pre-display).
  Display γ/WB/CCM are not baked. 422 when target mode lacks
  required channel keys.
- (2026-04-24, *planner-architect*) **`Y` channel synthesis
  preserved in `recording.extract_frame`** for `rgb_nir` mode (not
  just at server-summary serialization). Mirrors
  `image_io.py:191-196`.
- (2026-04-24, *planner-architect*) **`pyproject.toml` change is
  in scope.** `[project.optional-dependencies].playback-video =
  ["imageio-ffmpeg>=0.4.9"]`.
- (2026-04-24, *planner-architect*) **CCM target catalog** =
  X-Rite ColorChecker 24-patch sRGB shipped in
  `web/src/playback/data.tsx::CCM_TARGETS`. User-supplied custom
  targets deferred to BACKLOG.
- (2026-04-24, *planner-architect*) **WB patch coords are
  normalized [0, 1]** so they survive `max_dim` clamps.
- (2026-04-24, *planner-architect*) **Dark averaging and export
  share a single `concurrent.futures.ProcessPoolExecutor`** sized
  `max(1, os.cpu_count() // 2)`. Sequential between dark and
  export submissions; concurrency within an export only. Workers
  re-open the H5 by path.
- (2026-04-24, *planner-architect*) **`playback_session.py` is a
  separate module file** (not an edit to existing `session.py`).
  Easier rollback; isolates the new store.
- (2026-04-24, *planner-architect*) **Visual-regression baselines
  captured incrementally** at M5 / M6 / M7 / M8 / M9 / M10 / M11
  closes; M12 audits the full set.
- (2026-04-24, *planner-architect*) **Storybook stories live at
  `web/src/stories/playback/`** under the existing Storybook config.
- (2026-04-24, *planner-architect*) **M0 close adds a
  `risk-skeptic` reviewer pass** before M1 starts — the plan's 21+
  risks deserve a second skeptic before code lands.
- (2026-04-24, *planner-architect*) **M10 wall-clock budget
  softened** to ≤ 12 s on M-series MBP / ≤ 25 s on x86 4-core for
  1-second 30-fps tiled-2×2 1080p MP4. Profile in M10; record
  actual wall-clock in Status.md. `--quality=low` (`fps_scale=0.5`
  baked) available as the SLA-meeting default if real-hardware
  numbers miss budget.

## 15a. Real-recording metadata audit (2026-04-24)

Single sample `sample_1_view_0_exp_0.025.h5` from
`/Users/zz4/Desktop/day5_breast_subject_1`:

```
top-level   /camera/                                         attrs:
                                                              fw-version          v3.0
                                                              imager-filter-array GSense FSI Dual-Gain (2048x2048 HG+LG)
                                                              link-speed          USB 3.0 SuperSpeed
                                                              manufacture         Opal Kelly / GPIXEL
                                                              model-name          GSense FSI
                                                              nickname            UV-VIS (FSI) Gen1
                                                              sensor-desc         GSense FSI Dual-Gain (2048x2048 HG+LG)
                                                              sn-camera           23340016G7
                                                              tl-type             USB3
                                                              vendor              Opal Kelly
dataset     /camera/frames                                   shape=(10, 2048, 4096, 1) uint16
dataset     /camera/integration-time                         shape=(10,) float64
dataset     /camera/integration-time-expected                shape=(10,) float64
dataset     /camera/timestamp                                shape=(10,) float64
```

Filename pattern: `sample_<S>_view_<V>_exp_<EXP>[_<YYYY-MM-DD_HH-MM-SS_mmm>].h5`.
Drives the `{exposure}` / `{file}` / `{seq}` / `{iso}` filename token
catalog in M10. Dev folder has 33 such files; no separate dark stack
present — M2 manual verification will need an external dark capture
or use the `bench_dark` synthetic fallback.

## 16. Surprises & discoveries

- (2026-04-24) Prototype stores per-view state with `gainClass` + `band`
  decomposition (`HG-G` ↔ `gainClass=HG, band=G`). The existing app
  uses single `channel` strings. Decision: keep both — `view.channel`
  is the canonical key (`HG-G`), and `gainClass`/`band` are derived
  selectors only used by the InspectorSource UI.
- (2026-04-24) The prototype's `channel.includes('HG')` band picker
  picks bands within a single gain class. Real recordings can have
  HG-only or LG-only channel sets. Picker must reflect actual channel
  availability, not assumed dual-gain. Plan: `availableChannels` from
  the source summary drives the picker; "no LG channels" disables
  that row.
- (2026-04-24) `extract.load_recording` reads the *whole frames
  dataset* into memory by default. For a 4 000-frame 1080p H5 that's
  ~16 GB. Plan: `recording.inspect_recording` reads only metadata + a
  zero-frame slice; `extract_frame` slices `frames[i:i+1]` lazily
  via h5py. Replace the eager `np.asarray(ds[sl])` for the playback
  path with a frame-by-frame `h5py.File.__getitem__` path.
- (2026-04-24) Real GSense FSI dev recording is `(N, 2048, 4096, 1)`
  — the 4-D legacy variant `extract.load_recording` already handles
  via `if frames.ndim == 4 and frames.shape[-1] == 1: frames =
  frames[..., 0]`. Half-frames are 2048×2048; ISP-mode `rgb_nir`
  emits 1024×1024 channels. Square. Polarization modes on the same
  raw also produce square channels. Non-square only arises from
  `bare_dualgain` on an odd-W frame (impossible at 4096) or from
  `bare_single` on a non-(2048,2048) sensor (not in this dev folder).
  Risk W-17 stays open for synthetic non-square fixtures.
- (2026-04-24) Dev folder has *no* dark frames. Plan: M2 includes a
  fallback `bench_dark()` helper that fabricates a flat-pedestal
  master dark from a known constant for development. Real dark
  validation deferred to user-supplied dark capture (manual verify
  step in M2 close).
- (2026-04-24) Filename pattern `sample_<S>_view_<V>_exp_<EXP>` —
  multiple "views" = different camera positions on the bench, not
  ViewerCard "views". Document the namespace clash to avoid
  confusion. The Playback "view" is the on-screen render config; the
  recording "view" is a bench position label that surfaces only as
  a `{file}` / `{stream_short}` token.

## 17. Outcomes & retrospective

Filled at close.

- What worked.
- What didn't.
- What you'd do differently next time.
- Which `.agent/` docs got updated.

## 18. Final verification checklist

Executed at the close milestone. Lives in `Status.md`.

See `Status.md` "Final verification" — copy of
`STOPPING_CRITERIA.md` template adapted to this initiative.
