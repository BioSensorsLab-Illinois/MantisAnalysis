# Status — playback-rebuild-v2

Opened: 2026-04-25
Last updated: 2026-04-25 (M0 in-flight)

## Active milestone: M3 — Visual tokens + Storybook reviews (next)

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
