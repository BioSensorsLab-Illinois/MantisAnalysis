# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `bundler-migration-v1 Phase 3
+ post-review cleanup` (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Commits already pushed today: `isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, upstream `release` merge,
  `correctness-sweep-v1`, `bundler-migration-v1` Phase 1, Phase 2,
  Phase 3 atomic cutover (`cb3cbaf`), Phase 3 follow-up fixes
  (this session's pending push).

## What just shipped

**bundler-migration-v1 Phase 3 — atomic CDN→ESM cutover** (`cb3cbaf`)
+ a follow-up cleanup pass driven by `risk-skeptic` and
`frontend-react-engineer` reviewer findings (this session).

Phase 3 itself (already pushed):

- All 7 `.jsx` migrated to ES `import` / `export`. React, Plotly
  (`plotly.js-dist-min`), and dom-to-image-more are real npm
  packages — no CDN `<script>` tags, no Babel-standalone.
- `web/index.html` rewritten as a Vite entry; `web/src/main.jsx` is
  a 16-line `createRoot` mount of `<App />`.
- `vite.config.js` `base: '/'`; canonical `web/index.html` is the
  single Vite entry.
- `mantisanalysis/server.py::_mount_static` now serves
  `web/dist/index.html` and mounts `web/dist/` at `/`. If the dist
  is missing, `/` returns a friendly "build the frontend first"
  HTML page (no 404/500).
- `scripts/doctor.py::check_node_npm` promoted WARN → FAIL.
- `tests/web/test_web_boot.py` skips the Playwright test cleanly
  when `web/dist/` is absent.
- Bonus fix: `web/src/usaf.jsx` RulerH replaced an invalid
  `<text x={calc(...)}>` SVG attribute with a
  `<g transform="translate(3,0)">` wrapper.

Follow-up cleanup this session (pending push):

- **P0 fixed** — `web/src/isp_settings.jsx` now imports `useSource`
  (was referenced but missing — would crash the moment a user
  opened ISP settings).
- **P0 fixed** — release pipeline no longer ships the placeholder
  page: `packaging/mantisanalysis.spec` hard-fails if
  `web/dist/index.html` is missing; `packaging/build.py` runs
  `npm install && npm run build` before PyInstaller;
  `packaging/smoke_frozen.py` now asserts the body contains
  `/assets/` (Vite's hashed asset reference) and not the
  "Frontend bundle not built" string;
  `.github/workflows/release.yml` adds a Set-up-Node-20 step;
  `.github/workflows/smoke.yml` adds a `tier4-web-smoke` job that
  runs `npm run build` + `pytest -m web_smoke -q`.
- **P0 fixed** — README.md + 9 `.agent/` docs scrubbed of "no Node"
  / "CDN" / "Babel standalone" claims and updated to reference
  the Vite-bundled flow.
- **P1 fixed** — `web/src/app.jsx` deleted the dead
  `window.FILE_FILTERS = ...` line; `web/src/analysis.jsx` deleted
  duplicate local `channelColor` / `paletteColor` and imports
  them from `shared.jsx`; stale Babel comments in `fpn.jsx` +
  `main.jsx` updated; main.jsx now guards against a missing
  `#root` element.
- **P1 fixed** — `tests/web/test_web_boot.py` adds
  `test_analysis_modal_plotly_renders` that exercises the
  Plotly path through ⌘K → "run analysis" and asserts no console
  errors during the modal lifecycle.

## Smoke status, last verified 2026-04-24

- ✅ Tier 0 — 4 scanners pass (docs, skills, stopping-criteria,
  reviewer-evidence)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written)
- ✅ Tier 3 — PASS (FastAPI endpoints exercised)
- ✅ pytest — **108/108** green (was 107; +1 analysis-modal
  Plotly test)
- ✅ `npm run build` — 41 modules, 5.35 MB / gzip 1.62 MB
- ✅ Browser-verified end-to-end via Preview MCP — DoF, USAF, FPN
  modes all render with zero console errors

## Quick verification for the next agent

```bash
cd "$(git rev-parse --show-toplevel)"
python scripts/doctor.py                        # 9-check env sanity
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q

# Frontend (Vite-bundled post bundler-migration-v1 Phase 3):
npm install                                      # first time only
npm run build                                    # emits web/dist/
python -m mantisanalysis --no-browser --port 8773
# Open http://127.0.0.1:8773/ — must serve the SPA, not the
# "Frontend bundle not built" placeholder.
```

## Active initiative

**`bundler-migration-v1`** — Phases 1, 2, 3 closed. Phases 4–8
remain (multi-session):

- Phase 4 — ESLint + Prettier
- Phase 5 — TypeScript gradual migration (`.jsx` and `.tsx`)
- Phase 6 — axe-core integration under `pytest -m web_smoke`
- Phase 7 — Storybook with component stories
- Phase 8 — docs + close

`analysis-page-overhaul-v1` remains at Phase 2 done / Phase 3 next
— paused since the harness rework. With Phase 3 of the bundler
migration landed, the new `web/src/analysis/` subtree refactor can
be built ES-modules-native from the start.

## Where to pick up next

1. **bundler-migration-v1 Phase 4** — ESLint + Prettier. Self-
   contained session.
2. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Now safe to do ES-modules-
   native.
3. **H5 recording-inspection feature** — originally-deferred
   product work; now safe under the hardened harness + Vite stack.
   Open via `skills/execplan-large-feature/SKILL.md`.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **Phases 1–3 SHIPPED**
  (2026-04-24). Phases 4–8 upcoming.
- **B-0015 extended** — per-mode Playwright interaction suites
  (USAF / FPN / DoF analysis modals). Substantial; depends on
  analysis-page-overhaul-v1 Phase 3 landing.
  `tests/web/test_web_boot.py` now covers boot + analysis-modal
  Plotly path.
- **B-0018** — real-sample validation. Blocked on H5 captures from
  the lab bench; user action.
- **R-0011** — Playwright font diffs. No visual-regression baseline
  exists; blocks on Phase 3 + visual-regression adoption (now
  unblocked since Phase 3 shipped — schedule under Phase 6 or B-0015
  extension).
- **R-0014 residual** — hook hard-block vs soft-nudge promotion
  (tracked in RISKS).
- **R-0015** — same-context reviewers (harness change needed).
- **R-0016** — qt-allowed budget (scanner cap is the mitigation).
- **H5 recording-inspection viewer** — user exclusion for the
  current sweep; plan for a dedicated initiative next.

## Known dirty files

None after this session's commit + push lands.

## Residual risks / open questions for user

1. **Bundle is 5.35 MB uncompressed (gzip 1.62 MB)** — dominated
   by Plotly (~3.5 MB). A dynamic `import()` of `plotly.js-dist-min`
   (only loaded when the analysis modal opens) is the obvious
   Phase 4+ win. Not blocking; gzip is fine for local use.
2. **Hook-alias pattern lingers** — every mode file still does
   `const { useState: useStateU, ... } = React;`. Cosmetic, safe
   under ES modules. Phase 4 cleanup.
3. **Analysis-modal Plotly test is permissive** — passes if no
   console errors fire, even when Plotly returns no chart node.
   This is intentional (synthetic sources can return "no usable
   data") but means a regression that ships an empty modal with
   silent failure won't trip this test. Fixing requires a more
   aggressive setup that picks lines + asserts non-empty data
   before opening the modal — out-of-scope here.
4. **Pre-existing residuals from prior sessions** — same as last
   handoff (R-0009 chain not exercised end-to-end in browser;
   R-0006 closure by inspection; R-0014 hooks soft-nudge;
   PreCompact hook harness support; agentic-workflow-overhaul-v1
   reviewer evidence backfill).
