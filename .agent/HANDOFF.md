# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `bundler-migration-v1` Phases
6 + 7 + 8 — **B-0014 INITIATIVE CLOSED** (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Commits already pushed today: `isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, upstream `release` merge,
  `correctness-sweep-v1`, `bundler-migration-v1` Phase 1, Phase 2,
  Phase 3 atomic cutover (`cb3cbaf`), Phase 3 follow-up fixes
  (this session's pending push).

## What just shipped

**bundler-migration-v1 Phases 6 + 7 + 8 — B-0014 CLOSED** (this
session; push pending).

- **Phase 6 — axe-core**: `axe-playwright-python` added to
  `[web-smoke]` extras; `tests/web/test_accessibility.py` runs
  axe-core against WCAG A/AA on the boot page; baseline-gated
  (2 critical + 3 serious captured; B-0026 tracks tightening).
- **Phase 7 — Storybook**: `storybook@^8` + `@storybook/react-vite`
  + `addon-essentials`/`addon-interactions`/`addon-a11y` installed.
  `.storybook/main.ts` + `preview.ts`. Seed story
  `web/src/Brand.stories.tsx`. `npm run storybook` /
  `build-storybook` operational. `storybook-static/` gitignored.
- **Phase 8 — close**: `DECISIONS.md::D-0017` records the final
  toolchain decision (Vite + TypeScript + ESLint + Prettier +
  Storybook + axe-core); `REFERENCES.md` updated;
  `BACKLOG.md::B-0014` marked CLOSED with all 8 phases listed;
  consolidated CHANGELOG entry written.

**Today's commits in initiative order**:

- `cb3cbaf` — Phase 3 atomic CDN→ESM cutover
- `febb365` — Phase 3 reviewer-findings follow-up
- `cd560d7` — Phase 4 ESLint + Prettier
- `2bd4ef6` — Phase 5a TypeScript infra + main.tsx seed
- `1fd05f2` — Phase 5b-1 isp_settings.tsx typed + warnings 372→49
- `07736f3` — Phase 5b-finish: mass .jsx → .tsx + allowJs off
- (this commit) — Phases 6 + 7 + 8 + initiative close

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

**None.** `bundler-migration-v1` (B-0014) is **CLOSED** as of
2026-04-24. Phases 1–8 all shipped. Outstanding tech debt from the
initiative tracked in BACKLOG:

- **B-0026** — drive axe-core a11y baseline to zero (5 violations:
  label, select-name, aria-command-name, color-contrast,
  nested-interactive).
- **Phase 5c** — DEFERRED, multi-session. Drop `@ts-nocheck`
  file-by-file, type shared.tsx's exports, delete the `as any`
  shim in `isp_settings.tsx`, promote ESLint to
  `typescript-eslint/recommendedTypeChecked`. Not blocking
  anything; pair with future feature work.

`analysis-page-overhaul-v1` remains at Phase 2 done / Phase 3 next
— paused since the harness rework. With Phase 3 of the bundler
migration landed, the new `web/src/analysis/` subtree refactor can
be built ES-modules-native from the start.

## Where to pick up next

The frontend tooling is fully migrated; the next initiatives are
all product / quality work:

1. **H5 recording-inspection feature** — originally-deferred
   product work; the harness + Vite + TS + Storybook + axe-core
   stack is now ready for it. Open via
   `skills/execplan-large-feature/SKILL.md`.
2. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Pairs well with Phase 5c
   (type the analysis tab components on the way through).
3. **B-0026 a11y-baseline tightening** — pick a category (start
   with `label` — quick wins on `<input>` elements in
   `isp_settings.tsx::GeomRow`). Each fix lowers the test's
   `BASELINE_*` constants.
4. **Phase 5c type-tightening** — drop `@ts-nocheck` from
   `shared.tsx` first to propagate types outward.
5. **Stories for Card / Button / Chart / Page / PlotStylePanel** —
   Storybook is wired but only has the seed story.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **CLOSED 2026-04-24**
  (all 8 phases shipped). Phase 5c + B-0026 are tech debt
  follow-ups, not initiative blockers.
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
