# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `bundler-migration-v1 Phase 5b-1
+ warning reduction` (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Commits already pushed today: `isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, upstream `release` merge,
  `correctness-sweep-v1`, `bundler-migration-v1` Phase 1, Phase 2,
  Phase 3 atomic cutover (`cb3cbaf`), Phase 3 follow-up fixes
  (this session's pending push).

## What just shipped

**bundler-migration-v1 Phase 5b-1 + warning reduction** (this
session; push pending).

- **`isp_settings.jsx` → `isp_settings.tsx`** (615 lines). First
  real-component TypeScript migration. Typed component props +
  server-contract shapes (`IspMode`, `IspChannelSpec`, `IspConfig`,
  `SourceLite`, `Pair`, `SayFn`). Established the
  `import * as _shared from './shared.jsx'; const _s = _shared as any;`
  shim pattern that every future .tsx file will use until
  `shared.tsx` lands.
- **ESLint warning count 372 → 49 (87% drop)**. Drivers: turned off
  core `no-unused-vars` (typescript-eslint handles both JS + TS);
  turned off `react-refresh/only-export-components` (dev-HMR hint
  that doesn't map to our primitives hub); auto-pruned 81 unused
  shared-module imports across `app.jsx` + `analysis.jsx`;
  auto-removed 21 dead `const { style } = usePlotStyle();` lines;
  auto-removed 7 other dead single-const destructures; ran
  `npm run lint:fix` for 10 unused eslint-disable directives.
- **Browser-verified** — ISP settings window opens cleanly from
  the gear; mode dropdown + geometry + channel list render; zero
  console errors.

**Previous sessions** (already pushed):

- `2bd4ef6` — Phase 5a (TypeScript infrastructure + main.tsx seed).
- `cd560d7` — Phase 4 (ESLint + Prettier).
- `febb365` — Phase 3 follow-up (reviewer findings).
- `cb3cbaf` — Phase 3 atomic CDN→ESM cutover.

(For Phases 3–5a detail, see
`.agent/CHANGELOG_AGENT.md` + `.agent/runs/bundler-migration-v1/Status.md`.)

## Smoke status, last verified 2026-04-24

- ✅ Tier 0 — 5 scanners pass (docs, skills, stopping-criteria,
  reviewer-evidence, frontend-lint — now with prettier + eslint + tsc)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written)
- ✅ Tier 3 — PASS (FastAPI endpoints exercised)
- ✅ pytest — **108/108** green (3/3 web_smoke)
- ✅ `npm run build` — 41 modules, 5.35 MB / gzip 1.62 MB
- ✅ `npm run typecheck` — 0 errors
- ✅ `npm run lint` — 0 errors, **49 warnings** (was 372 before the
  Phase 5b-1 warning-reduction pass; 87% drop)
- ✅ Browser-verified via Preview MCP — ISP settings window opens
  cleanly from the gear with mode + geometry + channel list

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

**`bundler-migration-v1`** — Phases 1–4 + 5a + **5b-1** closed.
Phases 5b-2+ + 6–8 remain (multi-session):

- Phase 5b-2 — `shared.jsx` → `shared.tsx`. The dependency hub
  (~4300 lines, 85+ exports). Likely 1-2 sessions just to type
  it; downstream consumers get real types for free afterward.
- Phase 5b-3+ — `analysis.jsx` → `analysis.tsx`, then
  `usaf`/`fpn`/`dof`/`app`. One per session.
- Phase 6 — axe-core integration under `pytest -m web_smoke`
- Phase 7 — Storybook with component stories
- Phase 8 — docs + close

`analysis-page-overhaul-v1` remains at Phase 2 done / Phase 3 next
— paused since the harness rework. With Phase 3 of the bundler
migration landed, the new `web/src/analysis/` subtree refactor can
be built ES-modules-native from the start.

## Where to pick up next

1. **bundler-migration-v1 Phase 5b-2** — migrate `shared.jsx` →
   `shared.tsx`. Once the hub is typed, the `as any` shim in every
   `.tsx` file gets dropped and downstream .tsx files start seeing
   real prop/return types. Budget: 1-2 sessions.
2. **Warning-cleanup-last-mile** — 49 remaining warnings are all
   legit tech debt: unused component props (`onToast`, `unitPref`,
   etc.) and unused destructured state. Each resolves with `_`-
   prefix or deletion. Pair well with Phase 5b-2+.
3. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Now safe to do ES-modules-
   native + typed.
4. **H5 recording-inspection feature** — originally-deferred
   product work; now safe under the hardened harness + Vite +
   linter + typechecker stack. Open via
   `skills/execplan-large-feature/SKILL.md`.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **Phases 1–4 + 5a + 5b-1
  SHIPPED** (2026-04-24). Phase 5b-2+ (shared.tsx + remaining file
  migrations) + 6–8 upcoming.
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
