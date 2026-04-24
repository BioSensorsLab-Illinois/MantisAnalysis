# harness-mechanical-v1 — ExecPlan

Opened: 2026-04-24
Branch: `main`
Owner: agent (per user "finish all bug fixes and backlogged items").

## 1. Goal

Convert the prose-only enforcement gaps surfaced by `risk-skeptic` in
`agentic-workflow-overhaul-v1` (R-0014) into mechanical gates. Closes
backlog items B-0022..B-0028 in a single initiative.

## 2. Why

`agentic-workflow-overhaul-v1` documented browser-verification,
stopping criteria, and reviewer invocation rules in markdown. An
agent that skips the docs can silently bypass every gate. This
initiative adds:

- Mechanical stopping-criteria gate (B-0023).
- Reviewer-output evidence protocol (B-0024).
- Skill-frontmatter validator (B-0027).
- Command-flag validation in the Tier-0 scanner (B-0028).
- Claude Code hooks for UI-verification (B-0022), PreCompact state
  preservation (B-0025), and settings.local.json self-edit guard
  (B-0026).

## 3. Scope (in)

- `scripts/check_stopping_criteria.py` — parses the active
  initiative's `Status.md` for a "Final verification checklist"
  section; exits non-zero if required gates aren't ticked.
- `scripts/check_skill_frontmatter.py` — enforces description
  length ≤ 200, `when_to_use` present, `related_agents` resolve.
- `scripts/check_reviewer_evidence.py` — asserts
  `.agent/runs/<slug>/reviews/*.md` exists per reviewer claimed in
  Status.md.
- `scripts/check_agent_docs.py` — extend with flag-existence check
  for documented commands.
- Smoke-test Tier 0 extended to include all of the above.
- `.agent/settings.json` (new, repo-wide) — hook definitions for
  PostToolUse(Edit web/src/*.jsx), PreCompact, and
  PreToolUse(Edit .agent/settings.local.json).
- `scripts/mark_ui_edit.py`, `scripts/check_ui_verification.py`,
  `scripts/snapshot_session.sh` — hook helpers.
- `skills/independent-review-loop/SKILL.md` — addendum for the
  reviewer-evidence protocol.
- Unit tests under `tests/unit/test_check_stopping_criteria.py` +
  `tests/unit/test_check_skill_frontmatter.py` + `tests/unit/test_check_reviewer_evidence.py`.

## 4. Out of scope

- Rewriting the `.agent/settings.json` hook schema beyond the
  three specific hooks above — leave future hook expansion to its
  own initiative.
- Migrating skills to a new frontmatter schema — additive only.
- Product-code changes.

## 5. Architecture / UI / API impact

None on product surface. Net-new gates under `scripts/` + a new
`.agent/settings.json` that the Claude Code harness reads.

## 6. Test strategy

Unit tests for every new script; Tier 0 runs all of them. Hook
logic is thin shell scripts; exercise via the smoke ladder +
manual run.

## 7. Verification agents

- `test-coverage-reviewer` — do the new gates have regression
  tests?
- `risk-skeptic` — does the mechanical gate actually prevent the
  bypass it's supposed to catch? Edge cases?
- `docs-handoff-curator` — BACKLOG + RISKS updated; skills cross-
  reference the new scripts.

## 8. Milestones

- [ ] **M1** — `scripts/check_stopping_criteria.py` + tests (B-0023).
- [ ] **M2** — `scripts/check_skill_frontmatter.py` + tests (B-0027).
- [ ] **M3** — `scripts/check_reviewer_evidence.py` + tests (B-0024) +
      `skills/independent-review-loop/SKILL.md` addendum.
- [ ] **M4** — `scripts/check_agent_docs.py` flag-validation
      extension (B-0028) + tests.
- [ ] **M5** — Tier 0 extended to run all four new checks.
- [ ] **M6** — `.agent/settings.json` with three hooks +
      `scripts/mark_ui_edit.py` + `scripts/check_ui_verification.py`
      + `scripts/snapshot_session.sh` (B-0022 / B-0025 / B-0026).
- [ ] **M7** — Close BACKLOG B-0022..B-0028 entries; update RISKS
      R-0014 (enforcement gap closed).
- [ ] **M8** — Verify + HANDOFF + CHANGELOG + DECISIONS.

## 9. Acceptance

- [ ] Tier 0-3 + pytest green.
- [ ] `scripts/check_stopping_criteria.py .agent/runs/harness-mechanical-v1/` passes on a fully-checked Status.md.
- [ ] `scripts/check_skill_frontmatter.py` passes on all 17 skills.
- [ ] `scripts/check_reviewer_evidence.py` passes on this initiative's close (2+ reviewer reports on disk).
- [ ] Hooks fire as expected (manual verification — agent cannot
      self-verify the harness).
- [ ] BACKLOG entries B-0022..B-0028 all marked CLOSED.

## 10. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Hooks break normal development (noisy / slow) | Medium | Hooks are documented + have opt-out via `settings.json` edit; commands are < 200 ms each; only fire on specific tool names. |
| W-2 | PreCompact hook not triggered by the harness (not all versions support it) | Medium | Document the hook + include a fallback — the `context-handoff` skill continues to work without the hook. |
| W-3 | `check_stopping_criteria.py` regex too strict; false-positive on valid checklists | Low | Match the literal template from STOPPING_CRITERIA.md; add an escape hatch for initiatives that legitimately skip a gate (with `N/A — <reason>`). |

## 11. Rollback

Each milestone is independently revertable. Hook config is in
`.agent/settings.json`; remove the file or the offending entry to
disable.

## 12. Decisions

- (2026-04-24) Hooks live in `.agent/settings.json` (repo-wide,
  committed) rather than `.agent/settings.local.json` (local
  allowlist). The repo-wide schema is the correct location for
  enforcement rules that must apply to every session; local
  settings are host-specific permissions only.
