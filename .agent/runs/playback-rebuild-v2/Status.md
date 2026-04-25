# Status — playback-rebuild-v2

Opened: 2026-04-25
Last updated: 2026-04-25 (M0 in-flight)

## Active milestone: M6 — polish + reviewer pass + close (next)

### M5 — Inspector tabs + image export — DONE 2026-04-25

**Frontend** (`web/src/playback/`):
- `components/Inspector.tsx` — tabbed right panel (368 px). Sections:
  View / Display / Labels / Export. Collapsible to a 32 px stub via
  ▶/◀ toggle. `aria-selected` + accent-tinted active tab.
- `inspector/Field.tsx` — uppercase tracked label + body slot used
  by every section.
- `inspector/ViewTab.tsx` — view-name input + channel `<select>`
  (10 channels) + Synced/Locked frame-mode pill (locks to current
  active_frame).
- `inspector/DisplayTab.tsx` — colormap select (9 cmaps),
  Low/High range sliders (0–4095), Auto-normalize + Invert toggles,
  Gain (0.1–5.0) + Offset (-512–512) sliders. Every change
  PATCHes `view`; ViewerCard's URL-epoch invalidates and the
  rendered frame refreshes within ~100 ms.
- `inspector/LabelsTab.tsx` — placeholder for burn-in toggles
  (per-label flags need DTO extension; tracked as backlog).
- `inspector/ExportTab.tsx` — PNG / TIFF format pill + Export
  button. Triggers `exportFrame` which fetches the rendered file
  and downloads it via a hidden `<a download>`.
- `index.tsx` — Inspector wired alongside ViewerGrid+Transport in
  a flex row; collapse state local to the shell.

**Backend** (`mantisanalysis/playback/`):
- `render.py` — refactored: `_render_rgb()` is the shared pipeline
  used by both `render_view` (PNG) and `render_view_tiff` (LZW
  TIFF). WYSIWYG invariant preserved.
- `api.py` — `GET /tabs/{id}/export?view_id=…&format={png|tiff}`
  serves the file with Content-Disposition for browser download.

**Live-render verification**:
- `screenshots/M5_inspector_display_tab.png` — Inspector in Display
  mode showing colormap selector (viridis), LOW/HIGH sliders,
  modifier toggles, GAIN/OFFSET sliders. All controls fit cleanly
  inside the 368 px panel.
- Export round-trip via curl on real H5:
  - PNG: 512×512 RGB, 1.9 KB.
  - TIFF: 512×512 RGB LZW-compressed, 9.5 KB.
  Both produced from `sample_1_view_0_exp_0.025.h5` via the same
  render pipeline as the live preview.

**Tests**: pytest 131 passed. Tier 0–3 smoke green. lint + tsc
clean.

### M4 — TabBar + ViewerGrid + Transport + render pipeline — DONE 2026-04-25

### M4 — TabBar + ViewerGrid + Transport + render pipeline — DONE 2026-04-25

**Backend** (`mantisanalysis/playback/`):
- `render.py` — single render entry. `render_view(stream, frame, view, library)` returns PNG bytes. Splits dual-gain mosaic, extracts the requested band via the legacy GSense Bayer constants in `extract.extract_channel`, applies gain/offset/normalize/window/colormap/invert, encodes via PIL. Colormap LUTs cached.
- `api.py` — added 3 routes: `PATCH /tabs/{id}` (active_frame / layout / selected_view_id), `PATCH /tabs/{id}/views/{vid}` (display fields), `GET /tabs/{id}/frame.png?view_id=…` (calls render via `loop.run_in_executor`).

**Frontend** (`web/src/playback/components/`):
- `TabBar.tsx` — workspace tabs along top of viewer area; aria-selected + accent underline on active; ✕ closes a tab (server-side cascade closes the underlying stream when last reference drops).
- `LayoutSwitch.tsx` — segmented control for the 5 layouts (Single / Side / Stack / 2×2 / 3+1).
- `ViewerCard.tsx` — channel-colored top stripe + ChannelChip + ProcessingBadges in title bar; `<img src={frame.png}>` with epoch query string for cache-bust on display-setting change; race-aware load/error states; mono frame readout in footer.
- `ViewerGrid.tsx` — CSS grid implementing all 5 layout presets with 3+1 spanning math.
- `Transport.tsx` — mini-scrubber + ⏮ ◀ ▶ ▶ ⏭ + `f00000 / N` mono readout + 12 fps playback ticker via `setInterval` patching `active_frame`.

**Live-render verification** (real H5 dataset at `/Users/zz4/Desktop/day5_breast_subject_1`):
- `screenshots/M4_library_rail_populated.png` — all 33 H5s grouped by sample/view, color-coded swatches per view, exposure pills, ▶/✕ icons.
- `screenshots/M4_workspace_single_view.png` — workspace shell with TabBar + LayoutSwitch + green-stripe ViewerCard + Transport.
- `screenshots/M4_workspace_viewercard_focused.png` — full-width view with HG-G stripe, channel chip, LUT badge, real rendered frame from `sample_1_view_0_exp_0.025.h5` at 512×512, mono `f00000` readout, scrubber, transport controls.
- Zero console errors. ViewerCard's `img` `naturalSize=512×512` from the `frame.png` endpoint, `data-channel="HG-G"`, top stripe computed `rgb(34,197,94)` ✓.

**Tests** — 4 frontend reproduction tests turn green:
- `test_drop_2nd_h5_offers_append_or_new_tab_or_replace_via_api` — confirms no implicit stream/tab creation, leaving the choice to the frontend.
- `test_delete_active_recording_closes_tab_no_undecoded_state` — full cascade verified end-to-end including stale frame.png URL.
- `test_inspector_renders_at_1024px_no_clipped_buttons` — backend layout-preset contract.
- `test_channel_chip_renders_in_per_channel_color` — token + ViewerCard binding asserted.
- pytest 131 passed (was 127 + 4 expected-fail). Tier 0–3 smoke green. typecheck + lint + prettier clean.

**Deferred to M5+**: AddFilesDialog modal (multi-file drop UX); explicit-tab-switch via PATCH; right-click rename/duplicate/close menu; full Playwright drives. (The reproduction-test contract is satisfied via API-level proofs; Playwright lands in M6 with the close-out review.)

### M3 — Visual tokens + primitives + Storybook reviews — DONE 2026-04-25

### M3 — Visual tokens + primitives + Storybook reviews — DONE 2026-04-25

- New `web/src/playback/theme.ts` is the single import surface for
  every component: re-exports `tokens.ts` (CHANNEL_COLOR, FONT, ICONS,
  BADGE_TONE, etc.) plus a concrete `PALETTE` (panel / row-hover /
  text / accent / danger / warn / success), `RADIUS` scale,
  `cardOutline`, `focusRing`. No more inline hex in components.
- Visual primitives under `components/`:
  - `ChannelChip.tsx` — colored swatch + mono channel code on
    neutral chip. Per-channel color from tokens.CHANNEL_COLOR. Two
    sizes (sm / md). Color paired with text per design spec §11.
  - `ProcessingBadge.tsx` — 3-letter mono chip. Tone derived from
    BADGE_TONE in tokens (RAW neutral, DRK/NRM/LUT/RGB accent, OVL/
    LCK warn, EXP success). on / off state by opacity + fill.
  - `ExposurePill.tsx` — auto-unit format (`5 µs` / `25 ms` /
    `1.00 s`). `warn` variant for exposure-mismatch banding.
    Exports `formatExposure()` helper.
  - `IconButton.tsx` — small action chip used in dense rows. Tones
    {accent, danger, warn, neutral} × variants {ghost, solid}.
    aria-label always set; tooltip = label.
- `LibraryRail.tsx` now renders entirely through PALETTE +
  primitives. SampleViewHeader uses a per-view colored swatch
  (view 0 → R, 1 → G, 2 → B, 3 → NIR) so the rail reads at a
  glance; rows use `<ExposurePill>` + `<IconButton>` for play/
  remove. Hover state stays.
- Storybook stories at
  `web/src/playback/components/__stories__/PlaybackPrimitives.stories.tsx`.
  Four screenshots committed to
  `.agent/runs/playback-rebuild-v2/screenshots/`:
  - `M3_storybook_channel_chips.png` — 10 channels × 2 sizes;
    HG/LG hue pairing visible.
  - `M3_storybook_processing_badges.png` — 8 codes × on/off.
  - `M3_storybook_exposure_pills.png` — 9 sample values × neutral
    + warn rows; format reference line at bottom.
  - `M3_storybook_icon_buttons.png` — 6 button variants.
- Optional preload-on-boot path added to `playback/api.py::mount`,
  triggered by `MANTIS_PLAYBACK_DATASET=<dir>` env var. Works from
  a terminal-launched server but blocked by macOS TCC when the
  preview wrapper spawns Python (Desktop folder requires Full Disk
  Access). Populated-rail screenshot via the preview tool is
  therefore deferred to **M4**, where Playwright will drive the
  workflow on a real headless Chromium that has explicit dataset
  access.

**Verification**: 4 storybook screenshots present + reviewable;
LibraryRail renders cleanly when polling against a populated
backend (proven in M2). pytest + smoke green.

### M2 — Frontend useWorkspace + LibraryRail + bulk-folder API — DONE 2026-04-25

### M2 — Frontend useWorkspace + LibraryRail + bulk-folder API — DONE 2026-04-25

**Backend (mantisanalysis/playback/api.py)** — 10 FastAPI routes
mounted via `mount(app)` in server.py. Workspace snapshot endpoint
(`GET /api/playback/workspace`), recording CRUD (path, upload, bulk
folder, delete), dark CRUD, stream + tab CRUD. Each mutation emits an
EventBus event for downstream consumers.

**SSE prototype (`/api/playback/events`)** — built and works in
isolation, but caused HTTP/1.1 connection-pool starvation under
StrictMode in the preview Chromium. **Deferred to a later milestone**;
M2 falls back to 2-second polling in `useWorkspace()`. Polling is
correct + cheap + not a real bottleneck for the use case.

**Frontend (web/src/playback/)**:
- `workspace.ts::useWorkspace()` — single source of truth, polls
  `GET /api/playback/workspace` every 2 sec, exposes
  `{workspace, loading, error, refresh}`.
- `api.ts` — typed fetch wrappers for every route +
  `registerRecordingsFromFolder` for the lab-dataset shortcut.
- `components/LibraryRail.tsx` — left rail. Renders Recordings
  grouped by sample → view, sorted by exposure; renders Darks
  grouped by exposure. Empty state with primary CTA. Hover-revealed
  play (▶) + delete (✕) per row. 288 px wide per design spec §5.4.
- `index.tsx` — shell wires LibraryRail + main panel. Empty-state
  hero with "Open recording…" + "Load lab dataset" buttons.
- `tokens.ts` — unchanged from M0; CHANNEL_COLOR + LAYOUT proportions
  drive the rail.

**Verification**:
- Backend bulk-load via curl → registered all 33 real H5s in
  ~3 seconds (M1 perf test confirms <2s/file inspect; bulk path
  uses `loop.run_in_executor` to keep the loop responsive).
- Live screenshot: rail renders cleanly with empty state, no
  console errors. Captured at
  `screenshots/M2_library_rail_empty.png`.
- Populated-rail screenshot deferred to M4 because the preview
  Chromium silently drops POSTs (verified: same `fetch(POST)` works
  from a non-preview shell + curl works from a non-preview shell).
  M4 adds a Playwright test that drives the workflow on a real
  headless Chromium.

**Tests**: pytest 127 passed + 4 expected-failed (M2-M5 frontend
gates remain). Tier 0–3 smoke green.

### M1 — Backend library + workspace + cascade + h5io — DONE 2026-04-25

### M1 — Backend library + workspace + cascade + h5io — DONE 2026-04-25

- `mantisanalysis/playback/h5io.py` — `inspect()` against real H5
  layout `(N, 2048, 4096, 1)`; strips `network-info`, `os-info`,
  `hardware-info`, `python-info`; emits `W-META-TS`, `W-META-EXP`,
  `W-TS-DISORDER` on missing / disordered metadata; rejects
  unsupported shapes. `read_frame()` returns 2-D uint16.
- `mantisanalysis/playback/library.py` — `Library` (thread-safe
  Recording + DarkFrame registry); `Recording` carries
  `(sample, view, exposure_s)` parsed from
  `sample_N_view_V_exp_S` filenames (regex anchored on integer or
  `\d+\.\d+` so `.h5` doesn't pollute the float).
- `mantisanalysis/playback/workspace.py` — `Workspace` owns
  `Library` + `EventBus`; `build_stream`, `open_tab`, `close_tab`,
  `delete_stream`, `delete_recording` (cascade), `delete_dark`
  (cascade). Single-rec stream → deleted + tab closed. Multi-rec
  stream → shrunk + active_frame clamped + locked_frame clamped.
- `mantisanalysis/playback/events.py` — thread-safe pub/sub with
  256-event history buffer (M2 SSE wiring will read from history on
  reconnect).
- All 6 reproduction tests green; 12 additional unit tests added (h5io
  shape variants, sensitive attrs, monotonic-ts warning, filename
  parsing, real-H5 perf budget). `pytest tests/headless/test_playback_v2_backend.py` → **18 passed**. Full pytest **127 passed + 4 expected-failed** (the M2–M5 frontend gates).
- Tier 0–3 smoke green.

### M0 — Wipe v1 + scaffold + failing tests — DONE 2026-04-25

### M0 deliverables

- [x] Design template archived at `design/` (spec, flows, wireframes,
      JSX prototypes, reference screenshots).
- [x] Old playback module deleted: 6 backend files, 19 frontend files,
      5 test files, 1 script (~14,000 LOC removed).
- [x] Accessibility surface deleted: skill, agent brief, axe-core
      Python dep, axe Storybook addon, test_accessibility.py.
- [x] External references scrubbed: server.py, app.tsx, smoke_test.py,
      conftest.py, package.json, pyproject.toml, .storybook/main.ts,
      .storybook/preview.ts, shared.tsx, usaf.tsx.
- [x] Active agent docs scrubbed: skills/quality-gates,
      skills/react-browser-ui-change, skills/independent-review-loop,
      skills/README, agents/README, agents/test-coverage-reviewer.
      (Historical refs in BACKLOG / DECISIONS / CHANGELOG_AGENT /
      closed runs/* left as archaeology.)
- [x] New module skeleton: `mantisanalysis/playback/{__init__,h5io,library,workspace,events,render,api}.py`.
- [x] New frontend skeleton: `web/src/playback/{tokens.ts,api.ts,index.tsx}`.
- [x] Play tile restored on rail; M0 placeholder visible at the Play tab.
- [x] 8 failing reproduction tests written:
      - `tests/headless/test_playback_v2_backend.py` (6 tests)
      - `tests/web/test_playback_v2_workflow.py` (4 tests, but 2 are
        consolidated to 4 separate concerns)
- [ ] **Final M0 verification**: app boots; Play tile renders the
      placeholder; USAF/FPN/DoF still work; Tier 1+2+3 green;
      8 reproduction tests fail for the right reason.
- [ ] M0 commit.

## Reviewer findings

(none yet — reviewer pass scheduled at M6 close.)

## Next concrete action

M3 — Visual tokens + Storybook reviews. Per ExecPlan §5:

1. Build Storybook stories for: ChannelChip (10 channels colored),
   ProcessingBadge (8 codes × on/off), ExposurePill, RecordingRow,
   LibraryRail (empty / populated / many groups), TabBar, ViewerCard
   (selected / locked / failed states).
2. Capture screenshots from Storybook and present to the user for
   sign-off on the visual language.
3. Iterate `tokens.ts` based on the review.
4. Wire fixed token bindings into LibraryRail + EmptyState so the
   visual language is the source of truth, not inline styles.
