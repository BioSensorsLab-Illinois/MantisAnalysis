# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `bundler-migration-v1 Phase 1`
(Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Today's shipment (pushed): 6 commits — `isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, upstream `release` merge,
  `correctness-sweep-v1`. Pending push:
  `bundler-migration-v1` Phase 1.

## What just shipped

**bundler-migration-v1 Phase 1** — closed. Vite + React 18
toolchain installed alongside the existing CDN + Babel-standalone
path:

- `package.json` + `vite.config.js` + `web/index-vite.html` +
  `web/src/main.jsx` (minimal Vite-compatible entry).
- `npm run build` emits `web/dist/` (30 modules, 143 KB → 46 KB gz,
  320 ms).
- `npm run dev` serves on `:5173` with HMR (ready in 136 ms).
- `scripts/doctor.py` new Node/npm check (WARN-level until Phase 3).
- `.gitignore` + docs updated.

The real CDN-served app at `web/index.html` + `web/src/*.jsx` is
byte-identical; the production surface is unchanged. Phases 2–8
migrate the real app to ES modules + add ESLint/Prettier/
TypeScript/axe-core/Storybook in follow-up sessions. Full plan in
`.agent/runs/bundler-migration-v1/ExecPlan.md`.

Previous-ship summary (today, earlier):

**correctness-sweep-v1** — closed. 5 RISKS + 3 BACKLOG items in
one pass:

- **R-0004** — dead `split_and_extract` removed from `extract.py`.
- **R-0005** — `measure_modulation_5pt` clamped to [0, 1] to match
  the other Michelson estimators.
- **R-0006 / B-0007** — closed as architecturally obsolete (React
  CSS `transform: rotate()` keeps picks aligned with the image;
  Qt-era concern no longer applies).
- **R-0009** — server 410 Gone on evicted source_ids +
  `mantis:source-evicted` custom event + `app.jsx` auto-recovery
  listener clears cached source + analysis + reloads sample.
- **R-0010** — `ispEpoch` in `app.jsx` clears cached analysis run
  when ISP config changes; user sees a warning toast.
- **B-0006** — 4 smoke tests for `mantisanalysis.resolution` (the
  legacy Workflow A pipeline).
- **B-0012** — `scripts/doctor.py` onboarding helper (9 checks, 3
  tests).

11 new regression tests (2 Michelson clamp, 3 session eviction,
4 legacy resolution, 3 doctor). Browser-verified the event chain
end-to-end.

Full summary at `.agent/CHANGELOG_AGENT.md` 2026-04-24 top entry.

## Smoke status, last verified 2026-04-24

- ✅ Tier 0 — 4 scanners pass (docs, skills, stopping-criteria,
  reviewer-evidence)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written)
- ✅ Tier 3 — PASS (FastAPI endpoints exercised)
- ✅ pytest — 107/107 green (96 previous + 11 new regressions)

## Quick verification for the next agent

```bash
cd "$(git rev-parse --show-toplevel)"
python scripts/doctor.py                   # 9-check env sanity
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

## Active initiative

**`bundler-migration-v1`** — Phase 1 closed; Phases 2–8 pending
(multi-session). Phase 2 is the natural resume: migrate
`web/src/shared.jsx` from `window.*` globals to ES modules.

`analysis-page-overhaul-v1` remains at Phase 2 done / Phase 3 next
— paused since the harness rework. Can be interleaved with
bundler-migration work OR resumed after the bundler migration
lands (Phase 3) so the `web/src/analysis/` subtree is built with
real ES modules from the start.

## Where to pick up next

1. **`bundler-migration-v1` Phase 1 push** — after this close-out
   (current pending commit).
2. **`bundler-migration-v1` Phase 2** — migrate `shared.jsx` to ES
   modules. Natural resume; self-contained session.
3. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Either interleave or wait for
   bundler Phase 3 to land so the new subtree is ES-modules from
   the start.
4. **H5 recording-inspection feature** — originally-deferred
   product work; now safe under the hardened harness. Open via
   `skills/execplan-large-feature/SKILL.md`.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **IN PROGRESS.**
  `bundler-migration-v1` Phase 1 shipped 2026-04-24; Phases 2–8
  are upcoming sessions. See
  `.agent/runs/bundler-migration-v1/ExecPlan.md`.
- **B-0015 extended** — per-mode Playwright interaction suites
  (USAF / FPN / DoF analysis modals). Substantial; depends on
  analysis-page-overhaul-v1 Phase 3 landing first.
  `tests/web/test_web_boot.py` remains the minimum smoke.
- **B-0018** — real-sample validation. Blocked on H5 captures from
  the lab bench; user action.
- **R-0011** — Playwright font diffs. No visual-regression baseline
  exists; blocks on Phase 3 + visual-regression adoption.
- **R-0014 residual** — hook hard-block vs soft-nudge promotion
  (tracked in RISKS).
- **R-0015** — same-context reviewers (harness change needed).
- **R-0016** — qt-allowed budget (scanner cap is the mitigation).
- **H5 recording-inspection viewer** — user exclusion for the
  current sweep; plan for a dedicated initiative next.

## Known dirty files

None after this session's commit + push lands.

## Residual risks / open questions for user

1. **Full 410 → auto-recovery chain not exercised end-to-end in
   browser** (`correctness-sweep-v1`, R-0009): the server-side 410
   and the client-side dispatch/listen are each unit-tested, but
   the full round-trip would require loading > 12 sources in one
   session to trigger LRU eviction (or a server-side eviction poke
   API for tests). Residual risk: low — the chain is mechanically
   straightforward and the parts are each tested.
2. **R-0006 closure is by inspection** — we verified the React CSS
   transform preserves pick alignment under rotation; a Playwright
   test that rotates + asserts pick positions would be more
   bulletproof. Candidate for `tests/web/` when it expands.
3. **R-0014 residual gap** — hooks are soft nudges. Same as prior
   session; no change.
4. **PreCompact hook harness support** — unchanged; fallback is
   the manual `context-handoff` skill.
5. **Reviewer evidence backfilling** — only an issue for
   `agentic-workflow-overhaul-v1`; all subsequent initiatives
   record reviewers in real time (or explicitly note "no
   reviewers spawned" as this sweep did).
