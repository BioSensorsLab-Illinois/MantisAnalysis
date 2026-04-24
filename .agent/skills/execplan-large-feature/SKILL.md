---
name: execplan-large-feature
description: Scaffold a new initiative under .agent/runs/ with milestones, acceptance criteria, and status tracking for any work touching > 3 files.
when_to_use:
  - a task will touch > 3 files
  - a task involves architectural change
  - a task adds a new FastAPI route, React mode, ISP mode, or analysis metric
  - a task runs for > 1 session
outputs:
  - .agent/runs/<slug>/ExecPlan.md
  - .agent/runs/<slug>/Status.md
  - (optional) a new branch named <slug>
related_agents: planner-architect, risk-skeptic
---

# execplan-large-feature

## When to use

Per `AGENT_RULES.md` rule 4 (scope discipline):

> If a task leads to more than three files you think you should
> change, stop and scope it as an initiative under
> `.agent/runs/<slug>/`.

Also trigger when:

- The work will run across multiple sessions (handoff required).
- The work introduces risk that benefits from reviewer subagents.
- The work modifies public surface (API, channel schema, user
  workflow).

## Workflow

### Step 1 — name the initiative

Slug format: `<topic>-v<N>`. Examples: `isp-modes-v1`,
`analysis-page-overhaul-v1`, `h5-inspector-v1`.

### Step 2 — invoke `planner-architect`

Brief the planner with the user problem + relevant code pointers.
Expected output: draft ExecPlan sections (Goal, Why, Scope, Milestones,
Risks).

### Step 3 — create the initiative folder

```bash
slug=<topic>-v1
mkdir -p .agent/runs/$slug
cp .agent/templates/ExecPlan.md .agent/runs/$slug/ExecPlan.md
cp .agent/templates/Status.md   .agent/runs/$slug/Status.md
```

### Step 4 — fill ExecPlan.md

Populate every section from the template:

- **Goal** — one sentence.
- **Why** — link to BACKLOG / user ask / incident.
- **Scope (in)** — concrete files / modules / routes.
- **Out of scope** — with rationale each.
- **Architecture impact** — layers touched.
- **UI/UX impact** — user-visible surface delta.
- **Backend/API impact** — routes + schemas.
- **Data model impact** — H5 / channel / localStorage / session.
- **Test strategy** — which tiers + which test files.
- **Verification agents to invoke** — subset of
  `.agent/agents/`.
- **Milestones** — each independently shippable.
- **Acceptance criteria** — checklist.
- **Risks** — ID + severity + mitigation.
- **Rollback plan** — simplest way to undo.
- **Decisions** — recorded as they arise.
- **Final verification checklist** — executed at close.

### Step 5 — optional branch

For large work, open a branch:

```bash
git checkout -b $slug
```

For small-to-medium initiatives that are expected to land in main
without review, staying on `main` is fine if user consent is implied.
Follow [`safe-git-and-worktrees`](../safe-git-and-worktrees/SKILL.md).

### Step 6 — populate Status.md

- Current branch + current focus + Progress checklist + Smoke status.
- Update after every milestone.

### Step 7 — work milestone by milestone

Per `AGENT_RULES.md`:

- Each milestone ends with a verification (see
  [`quality-gates`](../quality-gates/SKILL.md)).
- Update `Status.md` after each milestone.
- If a milestone is too big to finish in one commit, it's not a
  milestone — split it.

### Step 8 — invoke reviewers at close

See [`independent-review-loop`](../independent-review-loop/SKILL.md).

### Step 9 — close out

See [`context-handoff`](../context-handoff/SKILL.md).

On close, move to archive:

```bash
mv .agent/runs/$slug .agent/runs/_archive/
```

## Acceptance

- [ ] Initiative folder exists with ExecPlan + Status.
- [ ] ExecPlan has every section populated.
- [ ] Milestones are each independently verifiable + shippable.
- [ ] Verification agents listed.
- [ ] Branch opened if scope warrants.
- [ ] HANDOFF.md points at the new initiative folder.

## Escalation

- If ExecPlan risks violating a hard invariant (GSense constants,
  channel schema, analysis-math purity), stop and ask the user.
- If `planner-architect` returns a P0 finding, revise the plan
  before creating the initiative folder.
- If the plan is actually a cluster of small initiatives, split it —
  one initiative = one branch = one ExecPlan.
