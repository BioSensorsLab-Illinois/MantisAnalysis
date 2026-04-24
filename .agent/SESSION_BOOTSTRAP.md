# SESSION_BOOTSTRAP

The exact commands to copy-paste at the start of every session.

Cross-reference: the [`session-start`](skills/session-start/SKILL.md)
skill has the full procedure + decision tree. This file is the
shell cheat-sheet.

## Phase A — orient (~30 s)

```bash
cd "$(git rev-parse --show-toplevel)"
cat CLAUDE.md
cat .agent/00_START_HERE.md
cat .agent/AGENT_RULES.md
cat .agent/HANDOFF.md
git status -sb
ls .agent/runs/ 2>/dev/null
```

After reading: you know the project, the rules, the live state, and
whether the tree is dirty.

## Phase B — verify (~10 s)

```bash
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

If any tier fails → STOP. Read the error, find the broken file, fix
or revert. Do not proceed with new work on a broken tree.

## Phase C — plan (~1–3 min)

Decide what to work on. Either:

- **Continue an open initiative** under `.agent/runs/<slug>/`, or
- **Pick a `B-000N`** from `BACKLOG.md` and open a new initiative via
  [`execplan-large-feature`](skills/execplan-large-feature/SKILL.md).

If picking up an open initiative:

```bash
cat .agent/runs/<slug>/Status.md
cat .agent/runs/<slug>/ExecPlan.md
```

If opening a new one (only for non-trivial work):

```bash
slug=<short-name>
mkdir -p .agent/runs/$slug
cp .agent/templates/ExecPlan.md .agent/runs/$slug/ExecPlan.md
cp .agent/templates/Status.md   .agent/runs/$slug/Status.md
git checkout -b $slug
```

## Phase D — work

Follow the matching skill from `.agent/skills/`:

| Change touches | Skill |
|---|---|
| `web/src/*.jsx` | [`react-browser-ui-change`](skills/react-browser-ui-change/SKILL.md) |
| `mantisanalysis/server.py`, `session.py`, `figures.py` | [`fastapi-api-change`](skills/fastapi-api-change/SKILL.md) |
| `mantisanalysis/image_io.py`, `extract.py`, `isp_modes.py` | [`h5-io-data-pipeline-change`](skills/h5-io-data-pipeline-change/SKILL.md) |
| `mantisanalysis/plotting.py`, `*_render.py`, canvas code | [`visualization-canvas-image-pipeline`](skills/visualization-canvas-image-pipeline/SKILL.md) |
| `tests/web/` | [`playwright-e2e-verification`](skills/playwright-e2e-verification/SKILL.md) |
| `pyproject.toml` dependencies | [`dependency-change`](skills/dependency-change/SKILL.md) |
| Git branch / commit / push | [`safe-git-and-worktrees`](skills/safe-git-and-worktrees/SKILL.md) |
| `.agent/` docs | [`docs-sync`](skills/docs-sync/SKILL.md) |
| Something's broken and confusing | [`emergency-recovery`](skills/emergency-recovery/SKILL.md) |

## Phase E — close out

When you stop or hand off, follow
[`context-handoff`](skills/context-handoff/SKILL.md):

```bash
# 1. Update the active initiative's Status.md.
# 2. Update HANDOFF.md if next-step / branch / dirty set changed.
# 3. One-line entry in CHANGELOG_AGENT.md.
# 4. Commit small + meaningful chunks (NOT auto-pushed).
git add <explicit-files>
git commit -m "<slug> <milestone> — <short topic>"
git status -sb
```

See [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) for the full
exit checklist before declaring major work complete.

## Cheat sheet — single-shot bootstrap

If you want a one-shot bootstrap and you trust the working tree:

```bash
cd "$(git rev-parse --show-toplevel)" && \
  cat CLAUDE.md && \
  cat .agent/HANDOFF.md && \
  python scripts/smoke_test.py --tier 0 && \
  python scripts/smoke_test.py --tier 1 && \
  python scripts/smoke_test.py --tier 2 && \
  python scripts/smoke_test.py --tier 3
```

If any tier fails, the chain stops at the first failure — by design.
