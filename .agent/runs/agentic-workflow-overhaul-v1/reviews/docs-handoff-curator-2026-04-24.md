<!-- qt-allowed: Reviewer report content discusses the Qt-era history + blocklist patterns the scanner enforces; subject matter of the review. -->

# docs-handoff-curator — agentic-workflow-overhaul-v1

Invoked: 2026-04-24 (mid-M8 reviewer loop).

## Consistency summary

| Doc | Status | Notes |
|---|---|---|
| `CLAUDE.md` (root) | Green | Short, correct, delegates to `.agent/00_START_HERE.md`. |
| `.agent/00_START_HERE.md` | Green | React/FastAPI-correct; bootstrap commands valid. |
| `.agent/AGENT_RULES.md` | Green | All 16 rules; no Qt-era rule. |
| `.agent/PROJECT_BRIEF.md` | Green | First line is FastAPI + React. |
| `.agent/SETUP_AND_RUN.md` | Green | Every documented command resolves. |
| `.agent/SESSION_BOOTSTRAP.md` | Green | Windows-only path gone. |
| `.agent/WORKFLOWS.md` | Green | No § Qt. |
| `.agent/QUALITY_GATES.md` | Green | 9-tier ladder matches scripts/smoke_test.py. |
| `.agent/TASK_PLAYBOOK.md` | Green | All recipes React/FastAPI. |
| `.agent/TOOLS_AND_SKILLS.md` | Green | pytest-qt listed only as removed. |
| `.agent/UI_VERIFICATION.md` | Green | Matches Preview MCP tool list. |
| `.agent/STOPPING_CRITERIA.md` | Green | Consistent with AGENT_RULES.md. |
| `.agent/REFERENCES.md` | Green | Summaries only; no text dumps. |
| `.agent/ARCHITECTURE.md` | Yellow | Invariant #4 phrasing stutters; see P2 below. |
| `.agent/REPO_MAP.md` | Yellow | Omits `.agent/scheduled_tasks.lock`. |
| `.agent/manifest.yaml` | Green | All path: entries exist. |
| `.agent/RISKS.md` | Green | Qt risks in qt-allowed block; R-0013 new. |
| `.agent/HANDOFF.md` | Red | Not yet updated for this initiative (M9 close-out). |
| `.agent/CHANGELOG_AGENT.md` | Red | No entry for this initiative (M9 close-out). |
| `.agent/agents/` + README | Green | Roster (10) matches files on disk. |
| `.agent/skills/` + README | Green | Roster (17) matches subdirectories. |
| `.agent/settings.local.*` | Yellow | README lists an allowlist entry not in JSON. |
| `scripts/check_agent_docs.py` | Green | `--tier 0` passes. |
| `.agent/DECISIONS.md` | Red | No D-0015 entry (M9 close-out). |

## Findings

**P1 — HANDOFF.md stale.** Fix at close: rewrite with current date, active initiative, branch, dirty-files snapshot, next concrete action.

**P1 — CHANGELOG_AGENT.md has no entry.** Fix at close: prepend 2026-04-24 entry naming agentic-workflow-overhaul-v1.

**P1 — DECISIONS.md missing D-0015.** Fix at close: append D-0015 stanza.

**P2 — settings.local.README.md documents an allowlist entry absent from JSON.** `pytest -m web_smoke -q` row has no matching line in settings.local.json. Fix: add to JSON or remove from README.

**P2 — REPO_MAP.md omits `.agent/scheduled_tasks.lock`.** Low value; either add or footnote "runtime-only lockfiles omitted".

**P2 — ARCHITECTURE.md invariant #4 phrasing stutters.** Split into two bullets.

**P3 — REFERENCES.md Storybook phrasing should mirror TOOLS_AND_SKILLS's 🔵 status.**

**P3 — scripts/smoke_test.py help string on Tier 4 could be clearer.**

## Handoff readiness

Not ready to close without M9 deliverables (HANDOFF, CHANGELOG, D-0015). After they land + two P2s resolved-or-deferred, handoff is complete.

## Disposition (applied by implementer)

- F-1, F-2, F-3 — fixed at M9.
- F-4 (settings.local.README) — clarified entry as "not allowlisted today" to keep the table accurate.
- F-5 (REPO_MAP lockfile) — deferred; runtime state, low value.
- F-6 (ARCHITECTURE invariant) — retained phrasing; future polish.
- F-7, F-8 — backlogged as polish.

<!-- /qt-allowed -->
