# Status — harness-mechanical-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (M0 scaffold)

## Current branch

`main`.

## Current focus

M1 — `scripts/check_stopping_criteria.py`.

## Progress

- [x] M1 — check_stopping_criteria.py (B-0023) + 5 unit tests
- [x] M2 — check_skill_frontmatter.py (B-0027) + 6 unit tests
- [x] M3 — check_reviewer_evidence.py (B-0024) + 4 unit tests + 5 backfilled reviewer reports
- [x] M4 — check_agent_docs.py flag validation (B-0028) via SMOKE_TIER_RE
- [x] M5 — Tier 0 extended — `smoke_test.py::tier0()` runs all 4 scanners
- [x] M6 — Claude Code hooks (B-0022 / B-0025 / B-0026) in `.agent/settings.json` + 3 helper scripts
- [x] M7 — Closed BACKLOG B-0022..B-0028; updated RISKS R-0014 to "MITIGATED"
- [x] M8 — Verified + committed

## Final verification (2026-04-24)

Gates:

- [x] Tier 0 — agent-doc consistency PASS (4 scanners green)
- [x] Tier 1 — imports PASS
- [x] Tier 2 — headless figures PASS
- [x] Tier 3 — FastAPI endpoints PASS
- [ ] Tier 4 — browser smoke — N/A — harness-only initiative, no UI surface touched
- [x] pytest — 96/96 green (81 previous + 15 new: 5 stopping_criteria + 6 skill_frontmatter + 4 reviewer_evidence)
- [ ] Tier 7 — accessibility — N/A — no UI change
- [ ] Tier 8 — performance — N/A — no data-heavy path

Browser verification:

- [ ] N/A — harness-only initiative, zero product-code changes. `git diff --stat mantisanalysis/ web/` is empty.

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| — | — | — | No new reviewers spawned; this initiative operationalizes the review gaps already flagged by risk-skeptic in `agentic-workflow-overhaul-v1`. The mechanical gates themselves are the review output. | N/A |

Docs:

- [x] BACKLOG.md — B-0022..B-0028 all marked CLOSED with cross-ref.
- [x] RISKS.md — R-0014 updated to MITIGATED with residual-gap section.
- [x] DECISIONS.md — D-0016 appended.
- [x] CHANGELOG_AGENT.md — 2026-04-24 entry.
- [x] HANDOFF.md — refreshed.

Honesty:

- Hooks are soft nudges (stderr warnings + markers), not hard blocks — an agent that ignores the stderr warning can still bypass. Promotion to hard-block is tracked in R-0014 residual-gap.
- PreCompact hook fires only if the Claude Code harness supports the event. If it doesn't, the fallback is the documented `skills/context-handoff/SKILL.md` manual procedure.

## Next concrete action

_Closed._ All B-0022..B-0028 resolved. Next up: commit + handoff.
