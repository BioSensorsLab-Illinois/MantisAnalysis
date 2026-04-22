# SESSION_BOOTSTRAP

The exact commands to copy-paste at the START of every session.

## Phase A — orient (~30 s)

```bash
cd /c/Users/J/BioSensors-Lab/MantisAnalysis
cat .agent/00_START_HERE.md
cat .agent/AGENT_RULES.md
cat .agent/HANDOFF.md
git status -sb
```

After reading: you know the project, the rules, the live state, and
whether the tree is dirty.

## Phase B — verify (~5 s)

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

If either fails → STOP. Read the error, find the broken file, fix or
revert. Do not proceed with new work on a broken tree.

## Phase C — plan (~1-3 min)

```bash
ls .agent/runs/ 2>/dev/null
cat .agent/BACKLOG.md
```

Decide what to work on. Either:
- continue an open initiative under `.agent/runs/<slug>/`, or
- pick a `B-000N` from BACKLOG and open a new initiative.

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

Follow the matching workflow from `.agent/WORKFLOWS.md`:

| Change touches | Workflow |
|---|---|
| `mantisanalysis/*_analysis.py`, `usaf_groups.py` | C |
| `mantisanalysis/*_render.py` | D |
| `scripts/pick_lines_gui.py`, `mantisanalysis/modes/` | E |
| `mantisanalysis/image_io.py`, `extract.py` | F |
| Theming / QSS | G |
| Packaging / deps | H |
| CI | I |
| Release | J |

## Phase E — close out

When you stop or hand off:

```bash
# 1. Update the active initiative's Status.md.
# 2. Update HANDOFF.md if next-step changed.
# 3. One-line entry in CHANGELOG_AGENT.md.
# 4. Commit small + meaningful chunks.
git add -p
git commit -m "<short topic>: <what happened>"
```

## Cheat sheet — single command equivalent

If you want a one-shot bootstrap and you trust the working tree:

```bash
cd /c/Users/J/BioSensors-Lab/MantisAnalysis && \
  cat .agent/00_START_HERE.md && \
  python scripts/smoke_test.py --tier 1 && \
  python scripts/smoke_test.py --tier 2 && \
  cat .agent/HANDOFF.md
```

If the smoke fails, the whole chain stops at the first failure — by
design.
