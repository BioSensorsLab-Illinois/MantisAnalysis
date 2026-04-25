# Status — playback-rebuild-v2

Opened: 2026-04-25
Last updated: 2026-04-25 (M0 in-flight)

## Active milestone: M2 — Frontend useWorkspace + SSE + LibraryRail (next)

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

M2 — Frontend `useWorkspace()` hook + SSE wiring + LibraryRail
component. Per ExecPlan §5:

1. Implement `mantisanalysis/playback/api.py::mount(app)` — the ~10
   FastAPI routes against the M1 backend. Hand-write OpenAPI shapes
   matching the DTOs in `web/src/playback/api.ts`.
2. Wire `Workspace.events.subscribe` into a Server-Sent-Events
   endpoint at `GET /api/playback/events` (use the 256-event history
   buffer for reconnect catch-up).
3. Implement `web/src/playback/workspace.ts::useWorkspace()` — fetch
   `GET /api/playback/workspace` once, subscribe to SSE, diff
   on event payloads.
4. Implement `web/src/playback/components/LibraryRail.tsx` — render
   recordings grouped by sample → view → exposure (using parsed
   filename metadata); render darks grouped by exposure; empty state
   with drag-drop.
5. Boot the app, point at `/Users/zz4/Desktop/day5_breast_subject_1/`,
   capture screenshot showing all 33 H5s grouped, no console errors.
