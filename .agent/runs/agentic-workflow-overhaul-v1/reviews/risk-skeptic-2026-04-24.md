<!-- qt-allowed: Reviewer report content discusses the Qt-era history + blocklist patterns the scanner enforces; subject matter of the review. -->

# risk-skeptic — agentic-workflow-overhaul-v1

Invoked: 2026-04-24 (mid-M8 reviewer loop).

## Premise check

The overhaul claims: "specialist reviewers at `.agent/agents/`, reusable skills at `.agent/skills/`, and a Tier-0 docs consistency gate together prevent self-certification, doc drift, and unverified UI claims." **What could make that claim false?** Almost every enforcement in the system is a *convention documented in markdown* — not a hook, not a CI check, not a harness-enforced callback. An agent that doesn't read the docs (or reads them and decides to skip) bypasses the whole thing silently. The only *mechanical* gates are `scripts/check_agent_docs.py` + the four smoke tiers.

## Failure mode inventory

| ID | Category | Trigger | Severity | Mitigation |
|---|---|---|---|---|
| A | enforcement | Agent edits web/src/*.jsx, runs Tier 1+2+3, claims done without booting browser | **P0** | Install PostToolUse hook on Edit(web/src/*.jsx) + Stop hook that fails if no new PNG under .agent/runs/<slug>/screenshots/. → B-0022 |
| B | enforcement | STOPPING_CRITERIA.md is pure prose; agent writes "complete" without running checklist | **P1** | Add scripts/check_stopping_criteria.py. → B-0023 |
| C | enforcement / coupling | independent-review-loop is markdown; agent can fabricate findings | **P1** | Require reviewer output blobs under reviews/; check_stopping_criteria asserts. → B-0024 |
| D | blocklist coverage | QT_PATTERNS list is finite; new Qt leak passes | **P2** | Expand to include QtWidgets/QtCore/QtGui/QSettings/QAction/QComboBox/etc. → **Fixed inline F-13** |
| E | command correctness | CMD_PATH_RE validates file exists but not flags | **P2** | Enumerate valid subcommands/flags in checker. → B-0028 |
| F | manifest | MANIFEST_PATH_RE only existence, not type/role | **P3** | Extend manifest scan; deferred. |
| G | state / context | Compaction mid-initiative with no PreCompact hook leaves stale HANDOFF | **P1** | Install PreCompact hook running snapshot_session.sh. → B-0025 |
| H | allowlist escape | qt-allowed region size unbounded | **P2** | Add size cap; fixed inline F-14 (2000-line / 95% cap + exempt-historical-files list). |
| I | frontmatter accuracy | Skill description/when_to_use fields may not match harness | **P2** | Audit + scripts/check_skill_frontmatter.py. → B-0027 |
| J | hidden coupling | Agent↔skill name references string-matched across docs; renames rot silently | **P1** | Extend check_agent_docs.py with cross-reference scanner. → **Fixed inline F-12** |
| K | environment | scripts/check_agent_docs.py works from any cwd but has no sanity assertion | **P3** | Assert .agent/ + CLAUDE.md exist at import. → **Fixed inline F-16** |
| L | auth/perm | settings.local.json agent-editable | **P0** | PreToolUse hook on Edit(.agent/settings.local.json). → B-0026 |
| M | state / data | Handoff updates not atomic across 3 files | **P2** | Session-close script updating all three. Deferred. |
| N | concurrency | Two agents in parallel worktrees on same initiative | **P2** | Flock-style lock via .agent/runs/<slug>/.lock. Deferred. |

## Questions to answer before close

1. Will hooks be installed? (Needed for A, G, L — highest leverage.)
2. Will check_stopping_criteria.py be written? (B/C — converts prose to mechanical gate.)
3. Is `qt-allowed` budget enforcement in scope, or a follow-up? (H.)

**Bottom line**: the workflow is a well-written *handbook*. It's not yet a *harness*. Every deferred finding is the delta between "documented expectation" and "mechanically enforced." P0s (A, L) should block close; P1s (B, C, G, J) are the shortlist for a follow-up initiative.

## Disposition (applied by implementer)

- D, J, K: **fixed inline** in check_agent_docs.py (extended patterns, cross-ref scanner, ROOT sanity assertion).
- H: **fixed inline** (2000-line cap + exempt list).
- A, B, C, G, I, L, E, F, M, N: **deferred** to BACKLOG B-0022..B-0028 because they need user consent for hooks OR are scoped as their own follow-ups. R-0014 / R-0015 / R-0016 added to RISKS.md to document the residual prose-only enforcement gap.

<!-- /qt-allowed -->
