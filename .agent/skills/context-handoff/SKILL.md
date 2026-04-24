---
name: context-handoff
description: How to update HANDOFF.md, the active initiative's Status.md, CHANGELOG_AGENT.md, and preserve state before stopping. Must run at every session end.
when_to_use:
  - ending a session (stopping work)
  - after a context compaction
  - before handing off to another agent or user
outputs:
  - updated .agent/HANDOFF.md
  - updated .agent/runs/<slug>/Status.md
  - one-line entry in .agent/CHANGELOG_AGENT.md
  - if decisions were made: DECISIONS.md entries
  - if risks were discovered: RISKS.md entries
related_agents: docs-handoff-curator
---

# context-handoff

## When to use

- Before ending any session with non-trivial work.
- Before a context compaction (preserve the essentials so the post-
  compact state has what it needs).
- When pausing mid-initiative.

## What state must be preserved

1. **Current branch** — `git rev-parse --abbrev-ref HEAD`.
2. **Active initiative slug** — `.agent/runs/<slug>/`.
3. **Modified files** — `git status -sb` output.
4. **Completed milestones** — checked-off items in Status.md.
5. **Failed / pending checks** — which gates ran, which didn't, which
   failed.
6. **Decisions made this session** — architectural, scoping, or
   trade-off decisions.
7. **Pending questions** — things the next agent needs the user to
   clarify.
8. **Next concrete action** — not "continue the initiative"; name the
   specific file, function, or check to run first.
9. **Smoke status** — Tier 0 / 1 / 2 / 3 / pytest last-run status.
10. **Browser screenshots captured** (if UI work).

## Workflow

### Step 1 — update the active initiative's Status.md

Open `.agent/runs/<slug>/Status.md` and:

- Update **Current branch** + **Current focus**.
- Update **Progress** checkboxes.
- Update **Smoke status (last verified)** with dates + results.
- Add a new bullet under **Modified files** if necessary.
- Append **Reviewer findings** table entries if any new ones closed.
- Update **Next concrete action** — specific and actionable.
- Add **Stop / resume notes** if the stop is mid-milestone.

### Step 2 — update HANDOFF.md

Open `.agent/HANDOFF.md` and:

- Update **Last updated** date.
- Update **Current state of the working tree** — which branch, which
  commits (or "unpushed, N commits on <branch>"), dirty status.
- Summarize **What just shipped** if new milestones closed.
- Update **Smoke status, last verified <date>**.
- Update **Active initiative** — pointer to the active `runs/<slug>/`.
- Update **Where to pick up next** — numbered list, top item first.

### Step 3 — one-line CHANGELOG_AGENT entry

Prepend to `.agent/CHANGELOG_AGENT.md`:

```markdown
## <YYYY-MM-DD> — <initiative-slug> <phase/milestone> (<agent-name>, model)

<One-paragraph summary: what shipped, what tests run, what deferred.>

Files: <top-level summary>
Smoke: Tier <tiers> <PASS/FAIL>; pytest <N/N> green.
Status: <active / paused / closed>.
```

### Step 4 — DECISIONS.md if applicable

If a non-trivial decision was made this session:

```markdown
## D-000N — <title> (<YYYY-MM-DD>)

**Context**: <what forced the choice>
**Options**: <options considered>
**Decision**: <what was chosen>
**Consequences**: <what this locks in>
**Revisit**: <trigger that would make us reconsider>
```

Append; bump the counter.

### Step 5 — RISKS.md if applicable

If a new minefield was surfaced:

```markdown
## R-000N — <short title> (severity: <low/medium/high>)

**Where**: <file:line>
**Symptom**: <what breaks if you ignore it>
**Mitigation today**: <workaround or containment>
**Trigger to reconsider**: <when this becomes urgent>
```

### Step 6 — BACKLOG.md if applicable

For any deferred P2/P3 or scope spill-over:

```markdown
## B-000N — <short title>

**Why**: <motivation>
**Scope**: <files / modules / surfaces>
**Estimated effort**: <rough size>
**Blocks / is blocked by**: <other items>
```

### Step 7 — verify git status

```bash
git status -sb
```

Confirm the list matches what Status.md + HANDOFF.md describe.

### Step 8 — verify smoke one more time (if time permits)

```bash
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

If something is failing at handoff time, the failure MUST be called
out explicitly in HANDOFF.md "Known checks still required" — do not
hand off a silent failure.

## Acceptance

- [ ] Status.md updated with current progress, next action, stop
      notes.
- [ ] HANDOFF.md updated with branch, active initiative, last-shipped.
- [ ] CHANGELOG_AGENT.md has a new top-line entry.
- [ ] DECISIONS.md / RISKS.md / BACKLOG.md updated if relevant.
- [ ] `git status -sb` output consistent with docs.
- [ ] Any failing gate is surfaced, not hidden.

## Context-compaction preservation

If your session is about to be compacted, write the following to the
current chat before compaction (in addition to updating the docs):

```
Active initiative: <slug>
Current branch: <name>
Current milestone: <name>
Completed milestones: <list>
Modified files: <list>
Passing gates: <tiers>
Failing gates: <tiers + reason>
Open reviewer findings: <list>
Next concrete action: <specific step>
Rationale for approach: <1–2 sentences>
```

This keeps the post-compaction model on track even if specific edit
history is lost.

## Escalation

- If you cannot update HANDOFF + Status before the session ends
  (e.g., conversation cap) → do the minimum: commit only what's
  ready, and ensure `git status` + the log tell the next agent what
  state the tree is in.
- If a critical gate is failing and you cannot fix it → explicit
  failure callout at top of HANDOFF + BACKLOG entry.
