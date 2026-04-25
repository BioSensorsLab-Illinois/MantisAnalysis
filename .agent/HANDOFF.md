# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `bundler-migration-v1 Phase 5
(5b-finish)` — Phase 5 CLOSED (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Commits already pushed today: `isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, upstream `release` merge,
  `correctness-sweep-v1`, `bundler-migration-v1` Phase 1, Phase 2,
  Phase 3 atomic cutover (`cb3cbaf`), Phase 3 follow-up fixes
  (this session's pending push).

## What just shipped

**bundler-migration-v1 Phase 5b-finish — every .jsx → .tsx, Phase 5
CLOSED** (this session; push pending).

- **6 mass renames with `@ts-nocheck` headers**:
  `shared.jsx`/`app.jsx`/`usaf.jsx`/`fpn.jsx`/`dof.jsx`/`analysis.jsx`
  → `.tsx`. Bodies preserved byte-for-byte; each file gets a
  leading `// @ts-nocheck` so tsc parses but doesn't strict-check
  them. Phase 5c (deferred, multi-session) peels `@ts-nocheck`
  off file-by-file as code is touched.
- **`tsconfig.json`** drops `allowJs` + `checkJs: false`. Every
  source file is now TypeScript.
- **`eslint.config.js`** — `@typescript-eslint/ban-ts-comment`
  demoted so `@ts-nocheck` is allowed during the rollout.
- **Cross-file imports** rewritten (11 sites); `web/index.html`
  already pointed at `main.tsx`.
- **`scripts/check_frontend_lint.py`** — Prettier glob extended to
  include `.ts`/`.tsx` (the old glob matched nothing post-rename).
- **`isp_settings.tsx`** — the `as any` shim stays; removes when
  shared.tsx drops `@ts-nocheck` in Phase 5c.
- **Browser-verified** — FPN mode default, then USAF + DoF clicks;
  all 3 render with zero console errors.

**Previous sessions** (already pushed):

- `1fd05f2` — Phase 5b-1 (isp_settings.tsx + warning reduction 372→49).
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

**`bundler-migration-v1`** — Phases 1–5 CLOSED. Phases 6–8 +
Phase 5c (optional type-tightening) remain:

- Phase 5c (DEFERRED, multi-session) — drop `@ts-nocheck`
  file-by-file, type the exported primitives in shared.tsx, delete
  the `as any` shim in `isp_settings.tsx`, promote ESLint to
  `typescript-eslint/recommendedTypeChecked`. Not blocking 6/7/8.
- Phase 6 — axe-core integration under `pytest -m web_smoke`.
- Phase 7 — Storybook with component stories.
- Phase 8 — docs + close.

`analysis-page-overhaul-v1` remains at Phase 2 done / Phase 3 next
— paused since the harness rework. With Phase 3 of the bundler
migration landed, the new `web/src/analysis/` subtree refactor can
be built ES-modules-native from the start.

## Where to pick up next

1. **bundler-migration-v1 Phase 6** — axe-core accessibility
   integration under `pytest -m web_smoke`. Self-contained session.
2. **Phase 5c** (optional, any time) — drop `@ts-nocheck` from
   `shared.tsx` first; type its exported primitives. Downstream
   wins: delete the `as any` shim in `isp_settings.tsx`; the 49
   residual warnings mostly dissolve under strict TS.
3. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Now safe to do ES-modules-
   native + typed.
4. **H5 recording-inspection feature** — originally-deferred
   product work; now safe under the hardened harness + Vite +
   linter + typechecker stack. Open via
   `skills/execplan-large-feature/SKILL.md`.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **Phases 1–5 SHIPPED**
  (2026-04-24). Phase 5c (type-tightening) + Phases 6–8 remaining.
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
