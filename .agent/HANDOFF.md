# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `correctness-sweep-v1`
(Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- Today's shipment: 5 commits already pushed (`isp-modes-v1`,
  `agentic-workflow-overhaul-v1`, `isp-modes-v1-bugfixes-v1`,
  `harness-mechanical-v1`, merge of upstream `release`) + this
  session's `correctness-sweep-v1` commit (about to push).

## What just shipped

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

None. All three of today's initiatives closed with proper Final
verification blocks. `analysis-page-overhaul-v1` remains at Phase 2
done / Phase 3 next — paused since the harness rework and now the
natural product-facing follow-up.

## Where to pick up next

1. **`correctness-sweep-v1` commit push** — after this close-out.
2. **H5 recording-inspection feature** — the originally-deferred
   product work; the user explicitly excluded it from the current
   sweep. Open via `skills/execplan-large-feature/SKILL.md`.
3. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Resume via its Status.md.

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. Architectural; own
  multi-session initiative. Gated on a user decision re: frontend
  toolchain (currently CDN + Babel-standalone works).
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
