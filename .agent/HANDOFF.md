# HANDOFF — current live state pointer

Last updated: **2026-04-29** — `usaf-channel-manual-points-v1`
closed on branch `codex/usaf-channel-manual-points`. The USAF picker
now stores manual 5-point extrema per channel, Profile Preview
re-measures the active display channel with that channel's saved
manual points, and `/api/usaf/analyze` applies
`manual_points_by_channel[ch]` only to the matching analysis channel.
Initiative artifacts at
[`.agent/runs/usaf-channel-manual-points-v1/`](runs/usaf-channel-manual-points-v1/).

## Current state of the working tree

- Branch: `codex/usaf-channel-manual-points`.
- Uncommitted bugfix files:
  * `mantisanalysis/server.py` — `ManualUSAFPointsIn`,
    `LineSpecIn.manual_points_by_channel`, and per-channel override
    lookup in `/api/usaf/analyze`.
  * `web/src/usaf.tsx` — `manualPointsByChannel` state/config,
    per-display-channel preview remeasurement, and analysis payload
    emission only for matching analysis channels.
  * `tests/unit/test_usaf_manual_points_api.py` — regression proving
    HG-G and LG-G can use different manual profile indices in the same
    analysis request.
  * `.agent/ARCHITECTURE.md` and
    `.agent/runs/usaf-channel-manual-points-v1/` — contract/status
    documentation.
- Pre-existing untracked files still present and intentionally not
  touched: `.agents/`, `START_MANTIS_WEBVIEW.md`.
- Backup of original code before this fix:
  `/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_usaf_manual_points_20260429_000626`.
- Local server is running on `http://127.0.0.1:8765/` from
  `.venv/bin/python -m mantisanalysis --no-browser --port 8765`;
  refresh the in-app browser to load the new backend/frontend.

## Smoke status, last verified 2026-04-29

- `.venv/bin/python scripts/smoke_test.py --tier 0` — PASS
- `.venv/bin/python scripts/smoke_test.py --tier 1` — PASS
- `.venv/bin/python scripts/smoke_test.py --tier 2` — PASS
- `.venv/bin/python scripts/smoke_test.py --tier 3` — PASS
- `.venv/bin/python -m pytest -q` — PASS, 306 passed / 4 skipped
- `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build` — PASS
- Live server `/api/health` and `/api/usaf/analyze` curl checks — PASS
- Browser screenshots/manual UI walkthrough deferred: Playwright is
  not installed and Browser Use tooling was unavailable.

## Where to pick up next

1. Refresh `http://127.0.0.1:8765/` and manually try: calibrate
   `LG-R`, switch to `LG-G`, calibrate separately, switch back and
   confirm Profile Preview keeps each channel's saved extrema.
2. If manual UI behavior looks good, commit branch
   `codex/usaf-channel-manual-points`.
- The **prior** "Three layered changes" listed below were **all
  committed** before this session began — see commits `8a1e056`
  (polish-sweep), `b01d8f7` (B-0037/B-0040/B-0041/B-0042), and
  `d1c0a9b` (Phase 2-4 extracts). Section retained for the audit
  trail of what those changes were.

## Prior layered changes (now committed; section retained for trail)

- **Three layered changes on `main`** (all now committed):
  0. **Polish-sweep audit fixes** (this session, 2026-04-28 PM) —
     reviewer-driven correctness + hardening pass:
     * Path-containment on `/api/sources/{sid}/attach-path`
       (basename + size + extension match against upload metadata
       captured at `/api/sources/upload` time) and on
       `/api/sources/delete-files` (only paths tracked by a
       registered LoadedSource; capped at 50 paths/call).
     * `ROIStatsRequest` Pydantic model with `extra='forbid'` +
       per-vertex `math.isfinite` validator + min/max polygon size.
     * `extra='forbid'` swept across every request BaseModel in
       `server.py` (27 models). Response models (SourceSummary,
       FrameMetadata, ISPChannelSpecOut, ISPModeOut,
       MeasureResponse, FPNComputeResponse) intentionally allow
       extras — the response_model serializer needs them.
     * `LocateFileRequest.size` made mandatory (was Optional).
     * `channel_range` accepts `frame_index` query param (defaults
       to 0 for back-compat with analysis modes).
     * Transient handoff sources flagged `pinned=True` in the
       LRU so heavy right-click usage can't evict the user's real
       recordings.
     * `/proc/meminfo` opened with `encoding='utf-8'`.
     * `LoadedSource.resolve_disk_target()` public method —
       `delete_source` no longer reaches into `_owned_tempfile`.
     * Frontend: warmer effect 100 ms debounce (slider drag stops
       restarting it 50×/s; per-card AbortController fetch unaffected
       so canvas stays responsive); `viewConfigSig` memoized; TBR
       polygon-vertex auto-recompute 120 ms debounce; play-loop deps
       trimmed to `[playing, fps, loop, totalFrames]`;
       `_AVG_BLOB_KB_ESTIMATE` 150 → 400 KB; cache budget low-RAM
       safety (`min(1024, ceilingMb / 4)`); `useStatePb` aliases
       dropped (146 call sites refactored to `React.useState`);
       `loadingDarks` / `loadingFiles` switched to id-based
       deduplication (was vulnerable to duplicate-name collisions);
       ISP fan-out aggregate toast (single result toast at end of
       multi-source PUT loop instead of silent partial failure).
     * `<ContentErrorBoundary>` lifted from `playback.tsx` into
       `shared.tsx` and wrapped around the AnalysisShell tab body.
     * Tier-3 smoke now exercises `/api/sources/{sid}/frame/0/...`
       + `/api/playback/handoff` + `/api/system/info`.
     * `tests/web/test_web_boot.py::test_play_tab_boots` —
       Playwright boot smoke for the Play tab.
     * 6 new unit tests for the polygon edge cases + 4 new tests
       for the polish-sweep contracts (transient pinning, channel
       range with frame index, attach-path basename+size guard).
     * `.github/workflows/smoke.yml` — dead artifact-upload step
       removed.
     * `D-0018` decision + `R-0010` risk + `B-0037..B-0042`
       backlog entries logged.
     * pytest baseline 269 → 280 passing tests.
  1. **Two layered changes on `main`, both uncommitted (prior session)**:
  1. **CI/CD: Linux binary + 2 real bugs caught locally** —
     `.github/workflows/release.yml` gained a `linux-x86_64` matrix
     entry on `ubuntu-22.04`, system-deps install, concurrency
     cancellation, expanded triggers, SHA256SUMS publish.
     `.github/workflows/smoke.yml` got matching concurrency.
     `packaging/mantisanalysis.spec` excludes all Qt/Tk/GTK/wx
     bindings (caught a real "multiple Qt bindings" build crash on
     the local macOS run). `packaging/smoke_frozen.py` reads the
     full root response (was truncating at 2 KB and failing the
     `/assets/` check on legitimately-correct builds).
     `packaging/README.md` got Linux launch instructions + CI matrix
     table. **End-to-end build + frozen smoke verified locally on
     macOS arm64** (`MantisAnalysis-macos-arm64.tar.gz`, 123.7 MB).
     Linux + Windows can only be validated by pushing.
  2. **Play polish + delete-from-disk + cache rebuild + 18-file
     resilience** (from 2026-04-27) — see CHANGELOG_AGENT for the
     full breakdown.
- Active initiative: **play-tab-recording-inspection-rescue-v1** (Phase 2
  Group A in flight; M28 + M29 ✓; M30 still next, blocked on M30
  spec — right-click handoff to USAF/FPN/DoF).
- Active modes: **USAF, FPN, DoF, Play** (4 modes).
- Initiative folder: [.agent/runs/play-tab-recording-inspection-rescue-v1/](runs/play-tab-recording-inspection-rescue-v1/).
- **Heavy uncommitted work**: 11 modified files, +1,863/−402 LOC since
  HEAD `0645d57`. Highlights: `playback.tsx` +1,716 (cache rewrite,
  warmer, error boundary, file-handle delete, shift+click range
  select, FPS+overlay+RGB-grading polish), `server.py` +204 (system
  info, file locate, attach-path, full-disk DELETE), `legacy_h5.py`
  +22 (calibrated bench layout: NIR=(0,0), G=(0,1), R=(1,0), B=(1,1)).
  Nothing committed this session yet — awaiting user consent.

## What's new this session (uncommitted)

### Filter & Channel Specification (formerly "ISP settings")
- TopBar entry promoted from icon-only to a labeled `Filter & Channel`
  button with descriptive tooltip; ⌘K palette + modal title + toast
  copy all renamed.
- Apply path now fans the same config out to every loaded Play
  recording via `mantis:source-reconfigured` → PUT `/api/sources/{sid}/isp`
  per sibling. One Apply, all files reconfigured.

### USAF / FPN / DoF channel UX
- Removed the legacy global `Show RGB color composite on canvas`
  toggle. Each mode's Display channel card now exposes explicit
  `RGB · HG` / `RGB · LG` chips (or a single `RGB` for non-dual-gain)
  with a tri-color pie swatch (`RgbCompositeChip` in `shared.tsx`).
  Single channels render mono so the colormap applies; pick RGB for a
  color composite.

### Play polish
- FPS dropdown widened to 12 presets (1, 2, 5, 10, 15, 24, 30, 48, 60,
  90, 120, 240). Export Video Spinbox cap raised to 240.
- Removed the pre-baked `overlay_nir_hg` / `overlay_nir_lg` source
  modes; only `overlay_custom` remains and the Inspector Overlay
  section's "Open Overlay Builder…" button is now reachable from any
  source mode (apply switches the view to `overlay_custom`).
- RGB Grading panel rebuilt from `<Row><Slider/></Row>` (3 visual
  rows per param) to a single-row `GradeRow` (label + slider track +
  click-to-edit numeric inline). All 11 grading params + the Auto WB
  / Clear WB / Defaults buttons now fit ~⅓ the prior vertical space.
- Inspector Gain reads from `splitSourceMode(view.sourceMode).gain`
  first so it stays in sync with the rendered image after stream-
  follow rebinds. `setRecordingGain` propagates the choice across
  ALL recordings + unlocked views (gain is now stream-wide).
- Stream-follow rebind preserves `view.name` (no longer resets to
  `meta.label`), `view.sourceMode` (when available on the new
  source), `view.colormap`, and every per-view inspector setting.

### File management — actual on-disk delete
- Backend `POST /api/files/locate` (scans `~/Desktop`, `~/Downloads`,
  `~/Documents` by name+size, depth 6) + `POST
  /api/sources/{sid}/attach-path` to bind a discovered path to an
  uploaded source.
- Frontend upload flow now calls `locate` → `attach-path`
  automatically so uploaded recordings get their original disk path
  enriched. `handleOpenClick` also tries `window.showOpenFilePicker`
  first for `FileSystemFileHandle.remove()` capability.
- `DELETE /api/sources/{sid}` now resolves and unlinks the user's
  actual file (path-loaded or `_owned_tempfile`), returns
  `{deleted_path, deleted_kind}`. `delete_kind: 'upload_tempfile'`
  is now classified as FAILURE on the frontend — only `'user_path'`
  or a successful `FileSystemFileHandle.remove()` count.
- Modal dropped the type-DELETE confirmation (single confirm button
  "Delete N from my computer"). Title + body copy updated to make
  clear the actual on-disk file is unlinked.
- Sources panel header carries permanent `Select all` / `Delete (N)`
  buttons (no longer hidden behind "first mark something"). FilePill
  checkbox supports `Shift+click` for contiguous range select
  (Finder/Explorer semantics, additive, anchor-tracked). Stale
  `markedRecIds` are pruned automatically when their recording
  vanishes from any source (delete, remove, eviction).

### Cache strategy rebuilt
- Replaced the per-tick lookahead with a single eager **warmer
  effect** that walks (view × frame) URLs round-robin in playhead
  order, bounded at half the cache capacity so the LRU never evicts
  what was just queued.
- Bumped default cache budget from 64 MB → **1024 MB** (per the
  guaranteed 8 GB minimum RAM). Cap derived from `/api/system/info`
  (`psutil` → `sysctl hw.memsize` → `/proc/meminfo` fallback) at 80%
  of physical RAM; navigator.deviceMemory only used when the API
  fails. On the 192 GB workstation, slider max is now 157,286 MB.
- Prefetch concurrency semaphore (max 6 in flight, drops on
  saturation), in-flight URL dedupe (`_prefetchInflight: Set`), and
  hard 32-frame lookahead cap.
- Cache status bar at the bottom of Play is **persistent** — never
  flashes in/out. Shows "CACHE Idle · {entries}/{cap} frames cached
  · ~{usedMB} MB / {budgetMB} MB budget · {pct}% full" when quiet,
  switches to the live progress bar during bursts.
- New Inspector → Advanced "Frame cache RAM budget" control
  (slider + numeric input, persisted per-user via localStorage).
  Live trim — shrinking the budget evicts immediately.

### Resilience for high-recording-count sessions
- `SessionStore.max_entries` raised from 12 → **64** so 18+ legacy H5s
  stay loaded without LRU eviction mid-warmup.
- `PlaybackErrorBoundary` wraps the Play tab; render-time crashes now
  show a dark error pane with stack trace + "Try again" button
  instead of a solid-color blank.
- `warmerKey` simplified — no more JSON.stringify of `labels` /
  `grading` / `isp` / `overlay` per render; only URL-template-relevant
  scalars participate.
- Warm queue capped, walks views round-robin so the active stream is
  always primed first.
- Verified live with 18 legacy gsbsi loads (~537 MB each, ~10 GB
  total): 16 loaded cleanly, 2 surfaced inline error pills (one
  truncated H5, one bad path), no crash, cache idle at 128/6990,
  zero console errors.

### Legacy gsbsi calibration
- Updated `legacy_gsbsi_rgb_nir` ISP mode + the hardcoded
  `extract_legacy_channels` demosaic to the user's bench-validated
  layout: `default_origin=(0,0)`, `default_sub_step=(1,1)`,
  `default_outer_stride=(2,2)`, with `NIR=(0,0)`, `G=(0,1)`,
  `R=(1,0)`, `B=(1,1)` within each gain half. `tests/unit/test_legacy_h5.py`
  17/17 stays green.

## What just shipped (play-tab-recording-inspection-rescue-v1)

12 milestones (M0–M11) in one session. Highlights:

- **Backend** ([mantisanalysis/session.py](../mantisanalysis/session.py),
  [mantisanalysis/server.py](../mantisanalysis/server.py)) — `LoadedSource.extract_frame`
  per-frame extraction with lazy `FrameReader` (h5py handle held open per source);
  64 MB LRU frame cache bounded at 16 entries; per-source `RLock` for thread-safe
  cache mutation under FastAPI threadpool. New routes: `/api/sources/{sid}/frames`,
  `/frame/{i}/channel/{ch}/thumbnail.png`, `/frame/{i}/rgb.png`,
  `/frame/{i}/overlay.png`, `/export/video?format=mp4|gif|zip`. Dark-frame loader
  averages all frames in the dark H5 before extraction.
- **Frontend** ([web/src/playback.tsx](../web/src/playback.tsx)) — full 7-region
  template layout: StreamHeader, SourcesPanel (recordings + dark frames),
  ViewerGrid (Single / Side-by-side / Stack / 2×2), ViewerCard with title-bar
  source-mode dropdown + ProcessingBadges + footer, Inspector with 8 sections
  (View / Source / Corrections / Display / RGB grading / Overlay / Labels /
  Advanced), TimelineStrip with mini-map + slider + play/pause + FPS + Loop,
  Stream Builder modal, Export Video modal, Warning Center modal.
- **Source-mode dropdown** — for GSense H5 enumerates 9 options (RGB · HG/LG,
  NIR · HG/LG, Gray · HG-Y/LG-Y, RGB+NIR overlay · HG/LG, Raw channel…) all
  derived from `source.channels[]`. Default = `RGB · HG`. **Kills the prior
  "manual R/G/B picker" failure.**
- **Loop = ON by default** (resolved decision #3) wraps cleanly; loop OFF hard-stops.
- **Image + video export** — browser download via `Content-Disposition`. Filename
  pattern `{stream}_f{NNNN}-{NNNN}_{render}.{ext}`. MP4 / GIF / PNG-zip all working
  on real data.

Reviewer findings (frontend-react-engineer + fastapi-backend-reviewer) summarized
in [.agent/runs/play-tab-recording-inspection-rescue-v1/reviews/](runs/play-tab-recording-inspection-rescue-v1/reviews/).
P0s + critical P1s applied. Remaining P1/P2 deferred with rationale.

## Smoke status, last verified 2026-04-27 (after M30 + ISP-refresh + source-mode restructure)

- Tier 0 — agent-doc + lint + typecheck PASS
- `pytest -q` — **258 / 258 passing**
- `npm run build` — Vite production build clean
- Live browser verification — 11 (Phase 1) + 19 (M12 through M30) milestones +
  12 hotfix sweeps (the latest: now-playing indicator on the FilePill
  — green left-edge stripe + green ▶ glyph + tooltip when the global
  timeline playhead is inside that recording's frame range)
  logged in
  [VERIFICATION_LOG.md](runs/play-tab-recording-inspection-rescue-v1/VERIFICATION_LOG.md).

## Where to pick up next

**M30 — Right-click frame → Send to USAF/FPN/DoF** (Group A · Advanced).
Per plan §M30: NEW `STORE.create_transient_from_frame(parent_sid, idx)`
returns a new image-kind source whose channels are the parent's
`extract_frame(idx)` output (auto-evicted after 30 min idle). NEW
`POST /api/playback/handoff` accepting `{source_id, frame_index,
target_mode}` returns the new transient `source_id`. Frontend
`ViewerCard` `onContextMenu` opens a popover with USAF/FPN/DoF; click
posts the handoff and dispatches `mantis:switch-source`. `app.tsx`
listens for the event and switches mode + selected source. Gate: scrub
to frame 5 → right-click → Send to USAF → app switches modes with the
synthetic source loaded; original Play recording stays intact.

**M29 follow-up notes**: The 4-step Overlay Builder is reachable via
`Open Overlay Builder…` at the top of the Inspector Overlay section
when the active source-mode is overlay-kind. The modal mirrors the
inline OverlayConfigurator field-for-field but only commits on Apply.
The legacy-gsbsi P0 fix slurps `/dset` into `LegacyFrameReader._mem` on
first open (≈60 ms, 537 MB) — RAM cost is the dataset size, which is
within reasonable budget for "load everything into memory" semantics.
If a user loads multiple legacy files at once and hits RAM pressure,
the existing `SessionStore.max_entries` LRU + `close_frame_reader`
hook cleanly drops `_mem` on eviction. New `LoadedSource.raw_shape /
raw_dtype / raw_bit_depth` fields are surfaced through the
`SourceSummary` Pydantic and rendered on the FilePill (raw mosaic
resolution + bit-depth chip when ≠ 16) and ViewerCard footer
(per-channel rendered resolution).

Earlier deferred items in
[BUG_REGRESSION_CHECKLIST.md](runs/play-tab-recording-inspection-rescue-v1/BUG_REGRESSION_CHECKLIST.md)
remain valid follow-ups (stale-`views`-closure cleanups, stream-follow
rebind name-preservation).

Other modes (USAF / FPN / DoF) are unchanged and regression-clean.

## Outstanding deferred work

- B-0010 — push initial commit + remote tracking (pending consent).
- B-0018 — real-sample validation sweep (now partially satisfied for Play; USAF/FPN/DoF still pending).
- Phase 5c — drop `@ts-nocheck` per file (multi-session, paired with feature work).
- Play-mode P1/P2 polish from M11 reviewer pass (see CHECKLIST).

## Residual risks / open questions

- New backend dep `imageio[ffmpeg]>=2.30` added to `pyproject.toml` for video
  export. Existing virtualenvs need `pip install -e .` to pick it up. The route
  surfaces HTTP 503 with a fallback hint when the codec is unavailable.
- `_load_dark_channels` reads all frames into memory; for typical lab darks
  (≤200 MB) this is fine. Documented in CHECKLIST P2.
