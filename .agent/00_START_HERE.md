# START HERE

You are an agent (human or LLM) picking up work on **MantisAnalysis**.
Read this document to completion before taking any action. It is short
by design.

---

## 1. What this project is

**FastAPI + React 18 browser tool** for MantisCam GSense BSI dual-gain
RGB-NIR recordings + generic PNG / TIFF / JPG images. Three modes:
USAF Resolution, FPN Analysis, Depth of Field. Author: **Zhongmin Zhu**
(`j@polarxphotonics.com`). Lab: **BioSensors Lab @ UIUC**. License:
**MIT**. Repo: <https://github.com/BioSensorsLab-Illinois/MantisAnalysis>.

Quick read: [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md).

## 2. The files you must read to operate

Always-loaded context (short + critical):

| # | File | Why |
|---|---|---|
| 1 | [`CLAUDE.md`](../CLAUDE.md) (root) | Rules of the road + compaction protocol |
| 2 | this file (`.agent/00_START_HERE.md`) | orientation |
| 3 | [`AGENT_RULES.md`](AGENT_RULES.md) | the rules — non-negotiables |
| 4 | [`HANDOFF.md`](HANDOFF.md) | live state pointer |

Then, on demand:

- [`SETUP_AND_RUN.md`](SETUP_AND_RUN.md) — exact commands.
- [`QUALITY_GATES.md`](QUALITY_GATES.md) — what "done" means.
- [`UI_VERIFICATION.md`](UI_VERIFICATION.md) — browser-verification
  protocol for UI work.
- [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) — what must be true
  before declaring an initiative complete.
- [`WORKFLOWS.md`](WORKFLOWS.md) — per-change-class recipes.
- [`skills/`](skills/) — the conditional-knowledge workflows.
- [`agents/`](agents/) — specialist reviewer briefs.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — the layered view.
- [`REPO_MAP.md`](REPO_MAP.md) — where each module lives.
- [`TASK_PLAYBOOK.md`](TASK_PLAYBOOK.md) — concrete recipes.
- [`TOOLS_AND_SKILLS.md`](TOOLS_AND_SKILLS.md) — tooling inventory.
- [`SESSION_BOOTSTRAP.md`](SESSION_BOOTSTRAP.md) — shell cheat-sheet.
- [`REFERENCES.md`](REFERENCES.md) — external refs (Anthropic,
  Playwright, WCAG, etc.).
- [`DECISIONS.md`](DECISIONS.md) — why things are the way they are.
- [`RISKS.md`](RISKS.md) — known minefields.
- [`BACKLOG.md`](BACKLOG.md) — what remains.
- [`CHANGELOG_AGENT.md`](CHANGELOG_AGENT.md) — what past sessions
  did.
- [`manifest.yaml`](manifest.yaml) — machine-readable summary.

## 3. Bootstrap your session (copy-paste)

```bash
cd "$(git rev-parse --show-toplevel)"
cat CLAUDE.md
cat .agent/00_START_HERE.md .agent/AGENT_RULES.md .agent/HANDOFF.md
git status -sb
ls .agent/runs/ 2>/dev/null
```

Now run the smoke ladder. If any tier fails, **stop and fix before
any other work.**

```bash
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
```

Full procedure: [`skills/session-start/SKILL.md`](skills/session-start/SKILL.md).

## 4. The rules you must not break

Core from [`AGENT_RULES.md`](AGENT_RULES.md):

- **Smoke is the gate.** Every non-doc change passes the mandatory
  tiers before claiming done. UI changes require browser
  verification per [`UI_VERIFICATION.md`](UI_VERIFICATION.md).
- **GSense Bayer constants locked.** `ORIGIN = (0, 0)` + `LOC` at
  `mantisanalysis/extract.py:25-26`.
- **Channel keys locked.** `HG-R`, `HG-G`, …, `R`, `G`, `B`, `Y`, `L`.
- **Analysis math stays pure NumPy/SciPy.** No server / React / UI
  imports in `*_analysis.py` / `usaf_groups.py` / `image_io.py` /
  `extract.py` / `image_processing.py`.
- **Scope discipline.** > 3 files → an initiative under
  `.agent/runs/<slug>/`.
- **Never self-certify.** Spawn reviewer subagents; resolve P0/P1
  findings before close. See
  [`skills/independent-review-loop/SKILL.md`](skills/independent-review-loop/SKILL.md).
- **Never push without user consent.**

## 5. What you should NOT do without reading further

- Restructure the package layout (see `BACKLOG.md` + `.agent/runs/`
  before touching).
- Change GSense Bayer constants (`extract.py:25-26`) — locked to
  the physical lab setup; see [`RISKS.md`](RISKS.md).
- Delete `mantisanalysis/resolution.py` or
  `scripts/run_usaf_resolution.py` — Workflow A is documented in
  the README; decision pending (`D-0004`).
- Commit real H5 recordings, secrets, or large binaries.

## 6. Where to pick up

Check [`HANDOFF.md`](HANDOFF.md). It points at the active initiative
under `.agent/runs/<slug>/`. Read its `Status.md` + `ExecPlan.md` and
resume at "Next concrete action".

If starting fresh, pick a `B-000N` from [`BACKLOG.md`](BACKLOG.md)
and open an initiative via
[`skills/execplan-large-feature/SKILL.md`](skills/execplan-large-feature/SKILL.md).
