---
name: independent-review-loop
description: How to spawn reviewer subagents after implementation, merge findings, and decide disposition. Enforces "do not self-certify" for any non-trivial initiative.
when_to_use:
  - before closing any non-trivial initiative
  - when a user asks for a second opinion
  - when uncertain whether a change is safe to ship
outputs:
  - a consolidated findings list with severity + disposition
  - Status.md section: "Reviewer findings"
related_agents: planner-architect, react-ui-ux-reviewer, frontend-react-engineer, fastapi-backend-reviewer, playwright-verifier, performance-reviewer, test-coverage-reviewer, risk-skeptic, docs-handoff-curator
---

# independent-review-loop

## When to use

- Before closing any initiative that touches:
  - A React / user-facing surface.
  - A FastAPI route / schema.
  - A session-state path.
  - A data-pipeline / ISP-mode change.
  - A dependency addition.
- Any time a change "works in the happy path" but the failure modes
  aren't obvious.

Always — not optional — on initiatives that modified > 10 files or
touched any `AGENT_RULES.md` invariant adjacent to a locked one.

## Core rule

**Do not self-certify.** The implementing agent resolves reviewer
findings; it does not grade its own work. If a reviewer returns P0/P1
findings, they must be fixed or explicitly deferred with documented
rationale before close.

## Workflow

### Step 1 — pick the reviewers

Consult the per-change-type table in
[`../quality-gates/SKILL.md`](../quality-gates/SKILL.md) and
[`.agent/agents/README.md`](../../agents/README.md).

Baseline (always invoke at close):

- `docs-handoff-curator` — docs consistency.

For UI changes add:

- `react-ui-ux-reviewer`
- `playwright-verifier`
- Optionally `performance-reviewer`, `frontend-react-engineer`.

For backend changes add:

- `fastapi-backend-reviewer`
- `test-coverage-reviewer`

For any major change add:

- `risk-skeptic` — adversarial pass.

### Step 2 — brief each reviewer

Use the `Agent` tool with `subagent_type: "general-purpose"` (or the
specialist type when wired). Prompt shape:

```
ROLE: You are the <agent-name> reviewer for MantisAnalysis.
Read .agent/agents/<agent-name>.md verbatim to understand your role.

CONTEXT:
- Initiative: <slug>
- ExecPlan: .agent/runs/<slug>/ExecPlan.md
- Status: .agent/runs/<slug>/Status.md
- Changed files: <comma-separated list>
- Branch: <name>

TASK:
<the specific review question; often "review the initiative for
compliance with your checklist and report severity-tagged findings">

OUTPUT:
Markdown with sections: Summary / Confirmed facts / Findings
(severity, title, file:line, description, fix) / Assumptions.
Be concrete. Cite file:line. Distinguish fact from guess.
```

### Step 3 — run reviewers in parallel where independent

If two reviewers don't need each other's findings as input, send a
single message with multiple `Agent` calls. E.g.,
`docs-handoff-curator` and `test-coverage-reviewer` are
independent; `risk-skeptic` benefits from going after the others.

### Step 4 — consolidate findings

In the initiative's `Status.md`, append a "Reviewer findings" table:

```markdown
| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | docs-handoff-curator | P1 | ARCHITECTURE.md invariant still mentions Qt theme dict | Fixed: D-0014 applied |
| F-2 | risk-skeptic | P2 | Playwright test flaky under reduced_motion | Deferred: B-0030 |
| F-3 | react-ui-ux-reviewer | P0 | Esc closes modal but focus doesn't return | Fixed: web/src/analysis/modal.jsx:142 |
```

### Step 5 — resolve

- **P0** — fix before any further work.
- **P1** — fix before final close.
- **P2** — fix if cheap; else defer to `BACKLOG.md` with an entry.
- **P3** — defer to backlog; note in findings table.

Every deferral has a `B-000N` entry with enough context for a later
agent to pick up.

### Step 6 — record

- Status.md: findings table + resolution notes.
- If disposition required a new decision (e.g., choosing between two
  fixes): DECISIONS.md entry.
- If a new risk emerged: RISKS.md entry.
- If deferred: BACKLOG.md entry.

### Step 7 — re-run any gates invalidated by the fixes

- If a fix changed code: Tier 1–4 relevant to the change must re-pass.
- If a fix changed docs: Tier 0 must re-pass.

### Step 8 — close only when

All P0/P1 are resolved + every gate green + handoff docs updated.

## Acceptance

- [ ] At least `docs-handoff-curator` invoked.
- [ ] All relevant specialists invoked per change type.
- [ ] Findings consolidated in Status.md.
- [ ] Every P0/P1 either fixed or explicitly deferred with BACKLOG
  entry + user consent (for P1 deferrals).
- [ ] Gates re-run after fixes.

## Escalation

- Reviewer returns contradictory findings → implementing agent
  decides; record the decision.
- Reviewer returns a finding that violates a hard invariant →
  `planner-architect` pass before acting.
- Reviewer returns a P0 that requires scope expansion beyond the
  initiative → scope as a new initiative; defer only if the gap is
  safe to carry.
