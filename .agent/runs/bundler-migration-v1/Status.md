# Status — bundler-migration-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (Phase 1 + Phase 2 + Phase 3 closed)

## Current branch

`main`.

## Current focus

Phase 3 shipped this session — ES-module atomic cutover landed with
green Tier 0–3 + 107/107 pytest + browser verification across USAF /
FPN / DoF. Phase 4 (ESLint + Prettier) is next.

## Phase 3 shipment (2026-04-24)

- `web/src/shared.jsx` — `import React from 'react'; import
  domtoimage from 'dom-to-image-more'`; `export { ... }` for every
  primitive; `window.domtoimage` → `domtoimage`. The
  `Object.assign(window, ...)` bridge is gone.
- `web/src/app.jsx` / `usaf.jsx` / `fpn.jsx` / `dof.jsx` /
  `analysis.jsx` / `isp_settings.jsx` — each now imports React + the
  exact shared subset it uses, then `export`s its top-level component.
- `analysis.jsx` additionally imports `plotly.js-dist-min` and
  `dom-to-image-more` as real npm modules; `window.Plotly` +
  `window.domtoimage` are gone.
- `web/src/main.jsx` — rewritten to `import App from './app.jsx'` +
  `createRoot(...).render(<App />)`.
- `web/src/shared-esm.js` — deleted (subset redundant post-migration).
- `web/index.html` — rewritten as the Vite entry
  (`<script type="module" src="/src/main.jsx"></script>`). All CDN
  `<script>` tags (React, ReactDOM, Babel, Plotly, dom-to-image) are
  gone, and every `<script type="text/babel">` too.
- `vite.config.js` — `base: '/dist/'` → `base: '/'`; entry point is
  the canonical `web/index.html`.
- `mantisanalysis/server.py` — `_mount_static` now serves
  `web/dist/index.html` and `web/dist/` as `/`. If the dist hasn't
  been built, `/` returns a friendly HTML page instructing
  `npm install && npm run build`.
- `scripts/doctor.py` — the Node ≥ 20 + npm check is now FAIL-level
  (was WARN through Phases 1–2).
- `tests/web/test_web_boot.py` — skips the Playwright path when
  `web/dist/index.html` is absent.
- `web/src/usaf.jsx` RulerH — replaced `<text x={`calc(...)`}>` with
  a `<g transform="translate(3,0)"><text x={'X%'}>` wrapper; SVG
  attributes can't accept `calc()`, and the browser surfaces that as
  a console error the boot test now catches.

## Phase 3 final verification (2026-04-24)

- [x] Tier 0 — 4 scanners PASS
- [x] Tier 1 — imports PASS (15 modules)
- [x] Tier 2 — headless figures PASS
- [x] Tier 3 — FastAPI endpoints PASS
- [x] pytest — **108/108** green (107 pre-Phase-3 + 1 new
      `test_analysis_modal_plotly_renders`)
- [x] `npm run build` — 41 modules, 5.35 MB (gzip 1.62 MB), ~15 s
- [x] Browser verification via Preview MCP — FastAPI + `web/dist/`
      renders DoF (default), USAF, and FPN modes with no console
      errors; `/api/health` returns `{"ok": true, "version": "0.2.0",
      "sources": 1}`; full sidebar cards + channel chips + mode rail
      all functional.

## Reviewer findings — Phase 3 (2026-04-24)

Spawned `risk-skeptic` and `frontend-react-engineer` in parallel
after the Phase 3 commit was pushed. Findings + dispositions:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | frontend-react-engineer | P0 | `useSource` referenced but not imported in `isp_settings.jsx` | Fixed — added to import block. |
| RS-1 | risk-skeptic | P0 | Frozen binaries ship the "build the frontend first" placeholder (`web/dist/` not in spec) | Fixed — `mantisanalysis.spec` hard-fails when dist missing; `build.py` runs `npm install && npm run build` before PyInstaller; `smoke_frozen.py` asserts `/assets/` reference (not placeholder); `release.yml` adds Set-up-Node-20; `smoke.yml` adds `tier4-web-smoke` job. |
| RS-2 | risk-skeptic | P0 | README + `.agent/` docs claim "no Node / npm" / CDN / Babel | Fixed — README + 9 `.agent/` docs scrubbed. |
| RS-3 | risk-skeptic | P1 | Test gap: analysis-modal Plotly path uncovered | Fixed — added `test_analysis_modal_plotly_renders`. |
| RS-4 | risk-skeptic | P1 | Stale comments in `fpn.jsx`, `main.jsx` | Fixed. |
| F-2 | frontend-react-engineer | P1 | `analysis.jsx` duplicate `channelColor`/`paletteColor` | Fixed — deleted local copies, imported from shared. |
| F-3 | frontend-react-engineer | P3 | Dead `window.FILE_FILTERS` | Fixed — deleted. |
| F-4 | frontend-react-engineer | P3 | Hook-alias pattern (`useStateU`, etc.) | Deferred to Phase 4 cleanup — cosmetic. |
| RS-5 | risk-skeptic | P2 | Vite `optimizeDeps.include` for Plotly (dev-mode UX only) | Deferred — production build pre-bundles regardless. |
| RS-6 | risk-skeptic | P2 | `main.jsx` doesn't guard `#root` against null | Fixed — added a clear error throw. |

## Progress

- [x] Phase 1 — infrastructure (shipped 2026-04-24, commit e5bab0e)
- [x] Phase 2 — parallel `shared-esm.js` (shipped 2026-04-24)
- [x] Phase 3 — atomic cutover (**this commit**)
- [ ] Phase 4 — ESLint + Prettier
- [ ] Phase 5 — TypeScript gradual migration
- [ ] Phase 6 — axe-core integration
- [ ] Phase 7 — Storybook + initial stories
- [ ] Phase 8 — docs + close

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
