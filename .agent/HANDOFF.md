# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of the
`isp-modes-v1-bugfixes-v1` + `harness-mechanical-v1` double
initiative (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- 4 commits ahead of `origin/main` (all unpushed per B-0010
  consent gate): `5608074`, `0236634`, `5aa985b`, and the pending
  harness-mechanical commit after this close-out.

## What just shipped

**isp-modes-v1-bugfixes-v1** — closed. Fixed 5 /ultrareview
regressions on commit 5608074 (P0 dark-attach NameError, P0 RGB
reconfigure 3-D arrays, P1 channel rename collision, P1 test
marker gap, P2 UI min-prop). 6 regression tests. Browser-verified.

**harness-mechanical-v1** — closed. Converted R-0014 prose-only
gaps into mechanical Tier-0 gates + soft-nudge Claude Code hooks.
Closed BACKLOG B-0022..B-0028. D-0016 recorded.

Full summary at `.agent/CHANGELOG_AGENT.md` 2026-04-24 top entry.

## Smoke status, last verified 2026-04-24

- ✅ Tier 0 — 4 scanners pass (docs, skills, stopping-criteria,
  reviewer-evidence)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written)
- ✅ Tier 3 — PASS (FastAPI endpoints exercised)
- ✅ pytest — 96/96 green

## Quick verification for the next agent

```bash
cd "$(git rev-parse --show-toplevel)"
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

## Active initiative

None. Both this session's initiatives (isp-modes-v1-bugfixes-v1 +
harness-mechanical-v1) closed with Final verification blocks
present. `analysis-page-overhaul-v1` is still at Phase 2 done /
Phase 3 next — it was paused by the harness rework and is the
natural product-facing follow-up.

## Where to pick up next

1. **User review + commit the harness-mechanical commit** (pending
   after this close-out).
2. **H5 recording-inspection feature** — the originally-deferred
   product work the user asked for at the start of the overhaul.
   Now safe to start under the hardened harness. Open via
   `skills/execplan-large-feature/SKILL.md`; the new Tier-0 gates
   will enforce review + evidence + stopping criteria mechanically.
3. **analysis-page-overhaul-v1 Phase 3** — paused; unified
   `<AnalysisModal>` shell refactor. Resume via its Status.md.
4. **B-0010** — push to origin/main. Per-event user consent.
5. **Small pre-existing backlog** (all still open, not touched
   this session):
   - B-0006 — legacy Workflow A CLI smoke (~half session).
   - B-0007 — rotate-clears-picks warning (~half session).
   - B-0012 — onboarding helper script (~half session).

## Deferred with explicit rationale

- **B-0010** — `git push -u origin main`. Per-event user consent
  required; not autonomous. 4 unpushed commits.
- **B-0014** — Vite bundler migration. Architectural; own
  multi-session initiative. Gated on decision re: frontend
  ergonomics (currently CDN + Babel-standalone works).
- **B-0015 extended** — per-mode Playwright interaction suites
  (USAF / FPN / DoF analysis modals). Substantial; own initiative.
  `tests/web/test_web_boot.py` remains the minimum smoke.
- **B-0018** — real-sample validation. Blocked on H5 captures
  from the lab bench; user action.

## Known dirty files

Working tree clean as of the last commit (5aa985b). The
harness-mechanical changes are staged to commit immediately after
this close-out.

## Residual risks / open questions for user

1. **R-0014 MITIGATED, not CLOSED** (`RISKS.md`): the Claude Code
   hooks are soft nudges (stderr warnings, markers) rather than
   hard blocks. An agent that ignores the Stop hook's stderr
   warning can still technically bypass browser verification. The
   visibility in the transcript is enough friction that
   `docs-handoff-curator` catches it at close, but a hard-block
   model is tracked as a future escalation.
2. **PreCompact hook harness support** — if the Claude Code
   version running this agent doesn't support `PreCompact`, the
   hook silently doesn't fire. Fallback is the documented
   `skills/context-handoff/SKILL.md` manual procedure; no loss.
3. **Reviewer evidence backfilled** — the 5 reports for
   `agentic-workflow-overhaul-v1` under `reviews/` were authored
   at this session's close-out from the reviewer outputs captured
   earlier. They're accurate to what the reviewers actually
   returned, but they're artifact files created after the fact,
   not real-time captures. Future initiatives should write reviews
   during the reviewer pass, not at close.
4. **R-0015, R-0016** — same-context reviewers, qt-allowed cap
   abuse potential — unchanged; documented in RISKS.md.
