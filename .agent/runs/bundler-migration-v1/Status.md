# Status — bundler-migration-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (Phase 1 + Phase 2 closed)

## Current branch

`main`.

## Current focus

Phase 3 is next. **Must be atomic** — empirical finding this
session (2026-04-24) showed dual-mode is infeasible.

## Phase 3 probe finding (2026-04-24)

User requested Phase 3 start; began as an exploratory probe to
test whether `shared.jsx` could be dual-moded (run under both CDN
and Vite during transition). Result:

- Added `export const _PHASE3_PROBE = '...'` to `shared.jsx` top.
  CDN path reloaded and React still mounted cleanly → Babel-
  standalone **silently strips top-level `export`**. Good.
- Added `import ReactImport from 'react'` to the top. CDN path
  immediately broke with a cascade of `<App>` component errors
  → Babel-standalone **does NOT strip `import`**; it throws.

**Conclusion**: dual-mode shared.jsx requires import-maps +
`<script type="module">` on the CDN side, which is a larger
delta than the bundler migration itself. Phase 3 is therefore an
atomic cutover — no viable partial ship.

shared.jsx was reverted to pristine after the probe; no code
changes ship this session for Phase 3. ExecPlan updated with the
empirical note + revised atomic-cutover subtask list.

## Progress

- [x] Phase 1 — infrastructure (shipped 2026-04-24, commit e5bab0e)
- [x] Phase 2 — **pivoted**: parallel `shared-esm.js` with
      strategic subset + `main.jsx` live API shell (this session)
- [ ] Phase 3 — full shared.jsx migration + 6 mode files + kill CDN
- [ ] Phase 4 — ESLint + Prettier
- [ ] Phase 5 — TypeScript gradual migration
- [ ] Phase 6 — axe-core integration
- [ ] Phase 7 — Storybook + initial stories
- [ ] Phase 8 — docs + close

## Phase 2 pivot note

The original ExecPlan proposed "replace `window.X` with `export`
in shared.jsx while keeping both paths working." Inspection of
`web/index.html` showed this is infeasible with Babel-standalone's
`<script type="text/babel">` classic-script loading — adding
`export` statements would break the CDN path. A clean dual-path
requires either import-maps + `<script type="module">` (large
cascading change across every `.jsx`) OR a parallel ES-module file
that mirrors a subset of the shared primitives.

**Decision (2026-04-24)**: parallel file. Scope-limited Phase 2
proves the ES-module pattern end-to-end, preserves the CDN path
byte-identically, and keeps Phase 3 atomic.

## Phase 2 tasks

- [x] `web/src/shared-esm.js` — ported subset: `BRAND`,
      `IMAGE_DIMS`, `useViewport`, `useLocalStorageState`,
      `useDebounced`, `API_BASE`, `formatApiDetail`, `apiFetch`,
      `apiUpload`, `channelPngUrl`, `SourceCtx`, `useSource`
      — byte-identical behavior to the shared.jsx originals
- [x] `web/src/main.jsx` expanded — `<PhaseTwoShell>` with live
      `/api/health` + `/api/sources` fetches, fallback to
      `load-sample` on empty
- [x] `vite.config.js` — added `base: '/dist/'` so the built
      output's asset paths resolve under FastAPI's `web/` static
      mount at `/dist/index-vite.html`
- [x] `npm run build` — 31 modules, 147.53 KB (gzip 47.87 KB),
      353 ms
- [x] Browser-verified via Preview MCP at `/dist/index-vite.html`:
      React mounts; `/api/health` returned
      `{"ok": true, "version": "0.2.0", "sources": 1}`; source
      shown with real `source_id 4ebf90addf67`; no console errors;
      screenshot captured

## Phase 2 final verification (2026-04-24)

Gates:

- [x] Tier 0 — 4 scanners PASS
- [x] Tier 1 — imports PASS (15 modules)
- [x] Tier 2 — headless figures PASS
- [x] Tier 3 — FastAPI endpoints PASS
- [x] pytest — 107/107 green (no Python surface touched)
- [x] `npm run build` clean (31 modules)
- [x] Browser verification at `/dist/index-vite.html` — live API
      round-trip confirmed; screenshot captured
- [ ] Tier 7 — accessibility — N/A — Phase 6 scope
- [ ] Tier 8 — performance — N/A — bundle within budget

Browser verification (screenshot captured via Preview MCP):

- [x] Vite-built page renders under FastAPI's `web/dist/` mount
- [x] Health returns `{"ok": true, "version": "0.2.0", "sources": 1}`
- [x] Source loaded with real `source_id 4ebf90addf67`
- [x] No console errors during the async API fetches
- [x] No failed network requests from the Phase 2 shell itself

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| — | — | — | Phase 2 is mechanical infrastructure with immediate browser verification; no reviewer subagents spawned. Full `risk-skeptic` + `planner-architect` + `playwright-verifier` pass is planned for Phase 3 (the atomic CDN-deletion cutover). | N/A |

Honesty:

- **Pivoted from original plan** — dual-path `shared.jsx` won't
  work under Babel-standalone. Parallel file is cleaner.
  ExecPlan + BACKLOG + CHANGELOG all note the pivot.
- **shared-esm.js duplicates a subset** — ~230 lines of overlap
  with shared.jsx. Phase 3 dissolves this by migrating shared.jsx
  fully and collapsing the two.
- **Only constants + hooks + API helpers are covered** — no JSX
  primitives (Card, Button, Icon, Chart, etc.) yet. Those migrate
  in Phase 3.

## Next concrete action

**Phase 3 (dedicated session)** — atomic cutover. Concrete
subtask list is in `ExecPlan.md` § Phase 3. Essential moves:

1. `shared.jsx` — add `import { useState, ... } from 'react'`;
   `export` every primitive in the `Object.assign(window, ...)`
   block; delete the window-assignment block.
2. Each mode file — replace `window.X` destructures with
   `import { X } from './shared.jsx'`; replace `window.React` /
   `window.ReactDOM` / `window.Plotly` / `window.domtoimage`
   with real npm imports.
3. `npm install plotly.js-dist-min dom-to-image-more`.
4. `main.jsx` — mount the real `<App>`.
5. `web/index.html` — delete CDN script tags (or replace with
   the Vite-built HTML).
6. `mantisanalysis/server.py` — serve `web/dist/` as the default.
7. `scripts/doctor.py` — Node/npm check WARN → FAIL.
8. Update tests.

Risk profile: HIGH — touches every frontend file. Spawn
`planner-architect` for the plan review + `risk-skeptic` for
missed `window.X` references before committing, then
`playwright-verifier` after the build renders.

Estimated effort: 2-3 dedicated sessions.
