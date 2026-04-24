# .agent/agents/ — specialist subagents

This folder holds briefs for the specialist review + investigation
subagents that MantisAnalysis work should invoke at the points marked
in `.agent/WORKFLOWS.md` and `.agent/STOPPING_CRITERIA.md`.

Each file is a self-contained brief. The format is intentionally
close to the [Claude Code custom subagent](https://docs.claude.com/claude-code/sub-agents)
shape: YAML frontmatter (`name`, `description`, `tools`) + markdown
body with *Purpose*, *When to invoke*, *Inputs*, *Output contract*,
*Severity rubric*, *Must / Must not*.

These are briefs for the **implementing agent** — they describe how to
prompt a reviewer. If/when the harness gets wired to auto-load them as
live Claude Code subagents, the same files apply.

## Roster

| Agent | Role | Invoke when |
|---|---|---|
| [`planner-architect`](planner-architect.md) | Requirements / architecture / risk audit; produces execution plans | Before any >3-file initiative; before any architectural change |
| [`react-ui-ux-reviewer`](react-ui-ux-reviewer.md) | React UI usability, IA, hierarchy, empty/loading/error states, responsive, keyboard | After any user-facing React change |
| [`frontend-react-engineer`](frontend-react-engineer.md) | React state, component structure, rendering performance, maintainability | After any non-trivial React refactor |
| [`fastapi-backend-reviewer`](fastapi-backend-reviewer.md) | FastAPI routes, Pydantic schemas, session state, contract with frontend | After any `server.py` / `session.py` / `figures.py` change |
| [`playwright-verifier`](playwright-verifier.md) | Playwright test design, locators, web-first assertions, screenshots, console/network checks | After any browser-verifiable UI change; before stopping |
| [`accessibility-reviewer`](accessibility-reviewer.md) | WCAG 2.2 A/AA basics: labels, roles, contrast, keyboard, focus, ARIA | After any substantial UI change |
| [`performance-reviewer`](performance-reviewer.md) | Responsiveness, re-renders, large payloads, canvas/image, export throughput | After any data/visualization/export change |
| [`test-coverage-reviewer`](test-coverage-reviewer.md) | Do unit + integration + API + browser tests cover risk added by change | Before closing any initiative |
| [`risk-skeptic`](risk-skeptic.md) | Adversarial review — edge cases, race conditions, stale assumptions, failure modes | Before major surgery; before stopping |
| [`docs-handoff-curator`](docs-handoff-curator.md) | `.agent/`, README, setup, architecture, changelog, status, handoff all stay in sync | Before closing any initiative |

## Invocation pattern (inline in current session)

Until the harness wires auto-loading, the implementing agent invokes a
reviewer via the `Agent` tool using `subagent_type: "general-purpose"`
and a prompt that quotes the relevant brief. Minimum prompt shape:

```
ROLE: You are the <agent-name> reviewer for MantisAnalysis.
BRIEF: <paste relevant sections of .agent/agents/<name>.md>
CONTEXT: <the change under review — file paths, commit, initiative slug>
TASK: <specific review question>
OUTPUT: Markdown list of findings, each with severity (P0/P1/P2/P3),
        file:line citation, and suggested fix.
```

Each reviewer must cite `file:line` where possible and distinguish
*confirmed facts* from *assumptions*.

## Severity rubric (shared)

- **P0** — blocks continuing. Fix before any further work.
- **P1** — blocks final sign-off. Fix before declaring the initiative
  complete.
- **P2** — should fix; may defer with a documented rationale in
  `.agent/BACKLOG.md`.
- **P3** — nice-to-have; backlog.

Reviewers return findings; the *implementing agent* decides disposition
and records each P2 deferral in `BACKLOG.md`. Never auto-demote a P0/P1
to close out faster.
