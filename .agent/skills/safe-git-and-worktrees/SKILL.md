---
name: safe-git-and-worktrees
description: Git hygiene for MantisAnalysis. Branching, committing, explicit-consent pushes, no destructive resets, no --no-verify, when a worktree is the right call.
when_to_use:
  - opening a branch
  - committing a series of changes
  - considering a destructive operation (reset --hard, rebase, force-push)
  - running multiple agents in parallel on the same repo
outputs:
  - a commit series that's coherent, signed, verified
  - no surprising state in the tree
related_agents: docs-handoff-curator, risk-skeptic
---

# safe-git-and-worktrees

## When to use

- Before opening a branch for an initiative.
- Before every commit of a non-trivial change.
- Before any operation that could lose work (`reset --hard`,
  `clean -fd`, `branch -D`, amend of a pushed commit, force push).
- When considering running two agent sessions in parallel on the same
  repo.

## Hard rules

From `AGENT_RULES.md`:

- **Rule 11** — Never commit secrets, credentials, or large binary
  artifacts. `.gitignore` covers `outputs/`. If you generate
  > ~1 MB of data, confirm it's ignored before commit.
- **Irreversible-action rules** — Before `git push --force`,
  `git reset --hard`, `rm -rf` of anything not in `outputs/`,
  `build/`, or cache dirs: pause and confirm with user or clearly
  document.
- **B-0010** — initial `git push -u origin main` is the explicit
  user-consent gate. Do not auto-push.

Also:

- Never use `--no-verify` to bypass hooks unless the user explicitly
  asks.
- Never use `--no-gpg-sign` to bypass signing.
- Never amend a pushed commit; create a new commit instead.

## Workflow

### Branches

For a new initiative > 3 files:

```bash
git checkout -b <slug>
```

Slug matches the `.agent/runs/<slug>/` folder. Example:
`agentic-workflow-overhaul-v1`, `isp-modes-v1`.

For small changes that don't warrant an initiative, staying on `main`
is acceptable if the user implicitly consents (we're a solo lab repo
with no pre-push review today; that may change).

### Commits

- Small, meaningful commits. One logical change per commit.
- Message style (match existing log):
  `<initiative-slug> <phase/milestone> — <short topic>`.
- End the body with
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
  (per the global git-commit protocol; applied automatically when the
  user asks Claude to commit).

### Staging

- `git add <specific files>` — avoid `git add -A` or `git add .` so
  .env / credentials / accidental artifacts aren't swept in.
- After staging, `git status` and `git diff --cached` to confirm
  only-intended.

### Push

- **No auto-push** — the user-consent gate is B-0010 until they say
  otherwise.
- When pushing, explicit `git push origin <branch>`; never
  `git push --all --force` or `git push --mirror`.
- Never force-push to `main`. Force-push to a feature branch only
  when the branch is known private / non-shared.

### Amend vs. new commit

When a commit is wrong and has not been pushed:

- Prefer a new commit on top (`git commit --fixup=<sha>` + rebase
  before push).
- Use `git commit --amend` only for the very last commit, and only
  when its fix is trivial.
- Never amend a pushed commit.

### Rebase

- Interactive rebase is fine locally for cleaning up fixup commits
  before push.
- Never rebase commits that have been pushed to a shared branch.
- Never use `git rebase -i` in this non-interactive harness unless
  explicitly asked (most non-interactive rebase options exist).
- Never pass `--no-edit` to `git rebase` — not a valid flag.

### Reset

- `git reset --soft <sha>` — keep working tree, move HEAD. Safe.
- `git reset --mixed <sha>` — keep working tree, unstage. Safe.
- `git reset --hard <sha>` — **destructive**. Requires user consent.
  Has no undo except the reflog (which expires).

### Cleaning

- `git clean -n` — dry-run; always use first.
- `git clean -fd` — **destructive**. Requires user consent. Reads
  `.gitignore` but can still delete untracked files the user wanted
  to keep.

### Worktrees

Use a worktree when:

- Running a second agent session on a different branch without
  disturbing the primary checkout.
- Comparing two implementations side-by-side.

```bash
git worktree add ../MantisAnalysis-<branch> <branch>
# work in the sibling dir
git worktree remove ../MantisAnalysis-<branch>
```

Don't `rm -rf` a worktree directory; use `git worktree remove`.

### Tags and releases

- Follow the recipe in `TASK_PLAYBOOK.md` § Release.
- Bump both `mantisanalysis/__init__.py __version__` and
  `pyproject.toml version`.
- Never push tags without explicit consent.

### Sensitive files

- `.env*` — never commit. `.gitignore` covers.
- `*.h5` — never commit real recordings; too large + lab data.
- `outputs/` — git-ignored; contains smoke PNGs.
- `test-results/` — git-ignored; contains Playwright traces.

## Parallel agent sessions

If multiple agent sessions will run on this repo simultaneously:

- Use a worktree per session (different directories).
- Each session's branch is distinct.
- No session pushes without user consent.
- Shared state (`.agent/HANDOFF.md`) is touched by exactly one session
  at a time.

## Acceptance

- [ ] No secret / credential / large binary in the staged diff.
- [ ] No force push.
- [ ] No destructive reset / clean without user approval.
- [ ] Commit message matches project style.
- [ ] Files staged explicitly (`git add <path>`).

## Escalation

- User asks for a destructive operation → confirm once, then proceed.
- Pre-commit hook fails → investigate; fix root cause; create NEW
  commit (never amend a failed hook commit).
- Merge conflict → resolve; do not discard one side blindly.
