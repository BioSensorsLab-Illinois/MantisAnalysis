# .agent/skills/ — reusable workflow skills

Each subfolder holds a `SKILL.md` with YAML frontmatter. Skills are
*conditional* knowledge — read on demand for a specific change class —
as opposed to `00_START_HERE.md` + `AGENT_RULES.md` + `CLAUDE.md`,
which are always-loaded context.

## Roster

### Session lifecycle

- [`session-start`](session-start/SKILL.md) — orient + verify + pick up
  the active initiative at the top of every session.
- [`execplan-large-feature`](execplan-large-feature/SKILL.md) — scaffold
  a new initiative (≥ 4 files of work) with milestones, acceptance,
  rollback.
- [`context-handoff`](context-handoff/SKILL.md) — write HANDOFF.md +
  Status.md + CHANGELOG_AGENT.md at session close so the next agent can
  resume cold.

### Change-class workflows

- [`react-browser-ui-change`](react-browser-ui-change/SKILL.md) —
  required workflow for any `web/src/*.jsx` edit.
- [`fastapi-api-change`](fastapi-api-change/SKILL.md) — required
  workflow for any `server.py` / `session.py` / schema edit.
- [`h5-io-data-pipeline-change`](h5-io-data-pipeline-change/SKILL.md) —
  for `image_io.py`, `extract.py`, `isp_modes.py`, new H5 fixture work.
- [`visualization-canvas-image-pipeline`](visualization-canvas-image-pipeline/SKILL.md)
  — image display, canvas, colormap, thresholds, overlays, export
  rendering.

### Verification skills

- [`quality-gates`](quality-gates/SKILL.md) — canonical tiered
  smoke / test / lint / browser ladder.
- [`playwright-e2e-verification`](playwright-e2e-verification/SKILL.md)
  — how to write / run Playwright tests (user-facing locators,
  web-first assertions, screenshots, console / network checks).
- [`visual-regression`](visual-regression/SKILL.md) — screenshot
  comparison discipline if / when baselines exist.
- [`performance-profiling`](performance-profiling/SKILL.md) — browser
  responsiveness, re-render count, payload size, server throughput.
- [`independent-review-loop`](independent-review-loop/SKILL.md) — how
  to spawn reviewer subagents + merge findings + decide disposition.

### Infra skills

- [`docs-sync`](docs-sync/SKILL.md) — which docs to update when which
  kind of change lands.
- [`safe-git-and-worktrees`](safe-git-and-worktrees/SKILL.md) — branch,
  commit, no-force-push, no-destructive-reset hygiene; when a worktree
  is the right call.
- [`dependency-change`](dependency-change/SKILL.md) — add / update /
  remove a Python or JS dependency safely.
- [`emergency-recovery`](emergency-recovery/SKILL.md) — what to do when
  tests fail in ways you can't diagnose, context is polluted, or a
  refactor is spiraling.

## Skill file shape

```yaml
---
name: <slug>
description: <1-sentence description used for the skill index>
when_to_use: <bullet triggers>
outputs: <what the skill produces>
related_agents: <comma-separated subagent names>
---

# <Skill name>

## When to use

- trigger 1
- trigger 2

## Workflow

Ordered steps, each concrete and verifiable.

## Acceptance

Checklist the implementer must satisfy before moving on.

## Escalation

When to stop and delegate / ask.
```

## Invocation

Skills are invoked by the implementing agent reading the relevant
`SKILL.md` inline. No runtime framework — it's a structured cheat
sheet + cross-reference hub.

If/when the harness supports auto-loading skills on trigger keywords,
the YAML frontmatter + `when_to_use` list is where those keywords
live.
