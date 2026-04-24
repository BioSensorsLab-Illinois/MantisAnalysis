---
name: emergency-recovery
description: What to do when tests fail in confusing ways, context is polluted, or a refactor is spiraling. Triage, stop the bleeding, restore a known-good baseline.
when_to_use:
  - multiple tests fail with unclear root cause
  - a refactor has left the tree in a confusing half-state
  - context window is approaching limits and work is incomplete
  - a git operation went wrong
outputs:
  - a stable baseline
  - a documented plan to re-approach the work
  - no silent data loss
related_agents: risk-skeptic, docs-handoff-curator
---

# emergency-recovery

## When to use

- Three or more unrelated tests failing simultaneously.
- You've made N edits and the system is more confused than when you
  started.
- You're unsure what state the tree is in.
- A `git` operation had an unexpected side effect.
- Context window is nearing limits and work is not shippable.

## The golden rule

**Do not take more destructive actions when confused.** A confused
agent plus `git reset --hard` is how work disappears.

Stop. Take stock. Then act deliberately.

## Triage procedure

### Step 1 — stop

Do not make another edit until you understand the current state.

### Step 2 — capture the current state

```bash
git status -sb
git log --oneline -20
git stash list
```

Write down (in the initiative's Status.md or in the response):

- Current branch.
- Files modified (M), added (A), deleted (D), untracked (??).
- Last commit of known-good state.
- Any stashes that might hold work.

### Step 3 — identify known-good

Find the last commit where tests passed:

```bash
git log --oneline -20
# For each candidate, check out and run smoke:
git stash push -u -m "emergency-recovery-snapshot"
git checkout <candidate-sha>
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

Stop at the first green.

### Step 4 — decide recovery strategy

Pick one:

**Option A — bisect**. When you need to preserve nearly-working
code:

```bash
git bisect start
git bisect bad HEAD
git bisect good <last-known-good-sha>
# git auto-checks out midpoint; run tests; git bisect good/bad
```

**Option B — stash + restart**. When the current branch is just
exploratory:

```bash
git stash push -u -m "exploration-<slug>-<date>"
git checkout <last-known-good-sha>
git checkout -b <slug>-v2
```

**Option C — selective revert**. When you know which commit broke
it:

```bash
git revert <bad-sha>
# OR for uncommitted damage:
git checkout -- <path>
```

**Option D — hard reset** (LAST RESORT, user consent required).
Only use when you've captured the current state via stash AND you
understand what's being discarded. Follow the rules in
[`safe-git-and-worktrees`](../safe-git-and-worktrees/SKILL.md).

### Step 5 — document

In Status.md:

- "Encountered <condition> at <sha> <file:line>."
- "Recovered by <strategy>."
- "Lost work: <list or 'none — stashed as <stash-name>'>."
- "Next concrete action: <specific next step>."

### Step 6 — re-approach

Do not re-do the same thing that got you here. Consult:

- `risk-skeptic` — what assumption was wrong?
- `planner-architect` — is the plan still viable, or does it need
  revision?

## Context-pollution recovery

If the session's context is muddled (the model is contradicting
itself, making wrong assumptions):

1. Summarize the known-good state of the tree.
2. Write the next concrete action.
3. Write a fresh `CLAUDE.md`-style brief for yourself in the
   initiative's Status.md, ignoring session history.
4. Proceed from the brief.

Compaction may help, but only after state is captured in docs.

## Failed-test debugging checklist

When you can't figure out why a test fails:

1. Read the actual error — don't infer from summary.
2. Run the one failing test in isolation:
   ```bash
   python -m pytest tests/unit/test_<file>.py::test_<name> -v
   ```
3. Print intermediate values with `pytest -s` if needed.
4. Check for import order / sys.path issues.
5. Check for matplotlib backend (Agg required in tests).
6. Check for state leakage from other tests:
   `python -m pytest tests/unit/test_<file>.py -v --tb=short -p no:cacheprovider`.
7. If it only fails when the whole suite runs, it's a fixture or
   state leak.

## Accidental `rm -rf` / destructive action

If you've deleted files you didn't mean to:

1. Don't close the terminal.
2. Check `git status` — tracked files can be restored:
   ```bash
   git checkout -- <path>
   ```
3. For reflog-recoverable state:
   ```bash
   git reflog
   git checkout <reflog-sha>
   ```
4. For OS-level `rm`: check the trash / recycle bin on the OS.
5. Document what was lost in HANDOFF.md.

## Acceptance

- [ ] Current state captured explicitly.
- [ ] Recovery strategy chosen deliberately, not reflexively.
- [ ] No additional destructive action without user consent.
- [ ] Status.md + HANDOFF.md reflect the incident.
- [ ] Next concrete action is specific.

## Escalation

- Actual data loss (uncommitted work gone) → tell user immediately;
  describe what was lost; propose how to avoid next time.
- Corrupt `.git/` → do not attempt surgery; ask user.
- Recovery attempt failed → stop; ask user with full state dump.
