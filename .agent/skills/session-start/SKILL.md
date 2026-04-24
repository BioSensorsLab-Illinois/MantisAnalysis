---
name: session-start
description: Orient, verify, and pick up active work at the start of every MantisAnalysis session. Must run before any feature work.
when_to_use:
  - starting a new session
  - resuming after a compaction
  - returning after user feedback
outputs:
  - a clear view of current branch, dirty files, active initiative, next action
  - confirmed Tier 1 + Tier 2 + Tier 3 smoke green (or a fix plan if not)
related_agents: docs-handoff-curator
---

# session-start

## When to use

- First turn of every new session.
- First turn after a context compaction.
- When resuming an initiative that was paused.

## Workflow

### Phase A — orient

```bash
cd "$(git rev-parse --show-toplevel)"
```

Read, in order:

1. `CLAUDE.md` (root) — rules-of-the-road summary.
2. `.agent/00_START_HERE.md` — project orientation.
3. `.agent/AGENT_RULES.md` — non-negotiables.
4. `.agent/HANDOFF.md` — live state pointer.
5. `git status -sb` — current branch + dirty files.
6. `ls .agent/runs/ 2>/dev/null` — open initiatives.

### Phase B — verify

Run the tiered smoke ladder:

```bash
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

Expectations:

- Tier 0 — docs consistency (fast).
- Tier 1 — imports (~1 s).
- Tier 2 — headless figures (~3–5 s).
- Tier 3 — FastAPI endpoints (TestClient, ~2–4 s).
- pytest — full suite; 40+ tests green.

If any tier fails → STOP. Read the error. Fix or revert. Do not
start new work on a broken tree.

### Phase C — plan

Decide what to do:

1. If `HANDOFF.md` points at an active initiative under
   `.agent/runs/<slug>/`, read its `Status.md` + `ExecPlan.md` and
   resume at "Next concrete action".
2. If `BACKLOG.md` has a ready item, scope it as an initiative (see
   [`execplan-large-feature`](../execplan-large-feature/SKILL.md)).
3. If the user asks for something new, clarify scope, then decide
   whether it's a small task (≤ 3 files) or a large initiative
   (> 3 files).

### Phase D — set expectations

State in plain text:

- "I'll work on X."
- "I verified Tier 0–3 + pytest green."
- "Here's my plan: …"

Then proceed.

## Acceptance

- [ ] All always-loaded docs read.
- [ ] `git status -sb` captured.
- [ ] Smoke ladder + pytest run and reported.
- [ ] Active initiative resumed OR new scope opened.
- [ ] User has a one-paragraph answer: "what I'm doing and why".

## Escalation

- Smoke fails → fix before new work. If fix is non-trivial, open an
  initiative for the fix.
- `HANDOFF.md` is stale (last-updated > 7 days; current branch differs
  from git) → invoke `docs-handoff-curator` to refresh it before
  starting.
- Unclear what to work on → ask the user. Don't guess on large work.
