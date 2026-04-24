# CLAUDE.md — MantisAnalysis

Agent orientation. Short by design. Detail lives in
[`.agent/`](.agent/).

## 1. What this project is

**MantisAnalysis** — FastAPI + React 18 browser tool for analyzing
MantisCam GSense BSI dual-gain RGB-NIR recordings + generic
PNG/TIFF/JPG. Three modes: USAF Resolution, FPN, Depth of Field.
Author: Zhongmin Zhu, BioSensors Lab @ UIUC. License: MIT.

## 2. The two things to read before any action

1. [`.agent/00_START_HERE.md`](.agent/00_START_HERE.md) — orientation + bootstrap.
2. [`.agent/AGENT_RULES.md`](.agent/AGENT_RULES.md) — non-negotiables.

Then consult the specific skill in `.agent/skills/` that matches
the change class, and the reviewer briefs in `.agent/agents/` at
close.

## 3. Bootstrap every session

```bash
cd "$(git rev-parse --show-toplevel)"
cat CLAUDE.md .agent/00_START_HERE.md .agent/AGENT_RULES.md .agent/HANDOFF.md
git status -sb
ls .agent/runs/ 2>/dev/null
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

If any tier fails → STOP. Fix or revert before new work.
Full procedure: [`.agent/skills/session-start/SKILL.md`](.agent/skills/session-start/SKILL.md).

## 4. Critical rules

1. **Read before editing.** No blind edits.
2. **Smoke is the gate.** Every non-doc change must pass Tier 1 +
   Tier 2 + Tier 3 before claiming done. UI changes additionally
   require Tier 4 (browser). See
   [`.agent/QUALITY_GATES.md`](.agent/QUALITY_GATES.md).
3. **Verify frontend changes by actually rendering them.** Take a
   screenshot. Check the console. See
   [`.agent/UI_VERIFICATION.md`](.agent/UI_VERIFICATION.md).
4. **GSense Bayer constants locked.** `ORIGIN = (0, 0)` and `LOC`
   at [`mantisanalysis/extract.py:25-26`](mantisanalysis/extract.py)
   are the physical lab setup. Do not change without Zhongmin's
   explicit approval.
5. **Channel key schema frozen.** `HG-R`, `HG-G`, …, `R`, `G`, `B`,
   `Y`, `L`. Renames break saved JSON + React frontend.
6. **Analysis math stays pure NumPy/SciPy.** No Qt, no FastAPI, no
   React imports in `*_analysis.py` / `usaf_groups.py` /
   `image_io.py` / `extract.py` / `image_processing.py`.
7. **Scope discipline.** > 3 files → open an initiative under
   `.agent/runs/<slug>/`. See
   [`.agent/skills/execplan-large-feature/SKILL.md`](.agent/skills/execplan-large-feature/SKILL.md).
8. **Single agent directory.** `.claude → .agent` symlink. Don't
   create a separate `.claude/` folder.
9. **Never commit secrets or large binaries.** `.gitignore` covers
   `outputs/`. Real H5 recordings are never committed.
10. **Never push without user consent.** Initial push of `main` is
    the B-0010 gate. See
    [`.agent/skills/safe-git-and-worktrees/SKILL.md`](.agent/skills/safe-git-and-worktrees/SKILL.md).

## 5. Before stopping

Every major change must satisfy
[`.agent/STOPPING_CRITERIA.md`](.agent/STOPPING_CRITERIA.md):

1. All required quality gates green.
2. Browser verified for UI work.
3. Reviewer subagents spawned; P0/P1 findings resolved.
4. Docs synced (architecture, repo map, handoff, changelog,
   decisions, risks, backlog).
5. Final response honestly states what was verified + what wasn't.

Do not self-certify.

## 6. Context compaction protocol

If this session is about to be compacted, preserve in the
conversation:

- **Current branch** (`git rev-parse --abbrev-ref HEAD`)
- **Active initiative** (path under `.agent/runs/<slug>/`)
- **Current milestone** (which is checked off, which is next)
- **Modified files** (`git status -sb` snapshot)
- **Completed checks** + **pending checks** + **failed checks**
- **Open reviewer findings** (if any)
- **Decisions made this session**
- **Next concrete action** (specific file / function / check)

Write these into `Status.md` AND mention them inline in the chat
before compaction fires, so the post-compact model has state in
both places. Full procedure: [`.agent/skills/context-handoff/SKILL.md`](.agent/skills/context-handoff/SKILL.md).

## 7. Key commands (shortcut card)

```bash
# Run the app (local, browser auto-opens)
python -m mantisanalysis
python -m mantisanalysis --no-browser --port 8765

# Smoke ladder
python scripts/smoke_test.py --tier {0|1|2|3}
pytest -m web_smoke -q                       # Tier 4 (opt-in)

# Tests
python -m pytest -q
python -m pytest tests/unit/ -q
python -m pytest tests/web/ -q -m web_smoke

# Lint + types
python -m ruff check mantisanalysis scripts tests
python -m mypy mantisanalysis

# H5 one-shot inspector
python scripts/inspect_recording.py "path/to/recording.h5" outputs/inspect/
```

## 8. Where things live

- **React SPA**: [`web/`](web/) — React 18 via CDN + Babel
  standalone, no bundler.
- **FastAPI server**: [`mantisanalysis/server.py`](mantisanalysis/server.py) + [`session.py`](mantisanalysis/session.py) + [`figures.py`](mantisanalysis/figures.py).
- **Analysis math**: [`mantisanalysis/usaf_groups.py`](mantisanalysis/usaf_groups.py), [`fpn_analysis.py`](mantisanalysis/fpn_analysis.py), [`dof_analysis.py`](mantisanalysis/dof_analysis.py), [`image_io.py`](mantisanalysis/image_io.py), [`extract.py`](mantisanalysis/extract.py), [`isp_modes.py`](mantisanalysis/isp_modes.py).
- **Figure builders**: [`mantisanalysis/*_render.py`](mantisanalysis/) + [`plotting.py`](mantisanalysis/plotting.py).
- **Tests**: `tests/unit/`, `tests/headless/`, `tests/web/`.
- **Scripts**: `scripts/smoke_test.py`, `scripts/inspect_recording.py`, `scripts/run_usaf_resolution.py`, `scripts/check_agent_docs.py`.
- **Agent layer**: `.agent/` (see its [`README`](.agent/README.md)).

## 9. Where to find detail

| Want | Go to |
|---|---|
| What to do in the first 30 s | `.agent/skills/session-start/SKILL.md` |
| Rules (longer than this file) | `.agent/AGENT_RULES.md` |
| Per-tier verification | `.agent/QUALITY_GATES.md` |
| UI verification | `.agent/UI_VERIFICATION.md` |
| Stopping criteria | `.agent/STOPPING_CRITERIA.md` |
| Architecture | `.agent/ARCHITECTURE.md` |
| Repo map | `.agent/REPO_MAP.md` |
| Current live state | `.agent/HANDOFF.md` |
| Per-change-type workflows | `.agent/WORKFLOWS.md` + `.agent/skills/*/SKILL.md` |
| Reviewer briefs | `.agent/agents/*.md` |
| Setup commands | `.agent/SETUP_AND_RUN.md` |
| External references (Anthropic, Playwright, WCAG, …) | `.agent/REFERENCES.md` |
| Backlog | `.agent/BACKLOG.md` |
| Decisions | `.agent/DECISIONS.md` |
| Risks | `.agent/RISKS.md` |
| Historical log | `.agent/CHANGELOG_AGENT.md` |
