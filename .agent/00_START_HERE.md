# START HERE

You are an agent (human or LLM) picking up work on **MantisAnalysis**. Read
this document to completion before taking any action. It is short by design.

---

## 1. What this project is

Desktop GUI + analysis library for **MantisCam GSense BSI dual-gain RGB-NIR**
recordings, plus generic PNG / TIFF / JPG images. Three analysis modes:

1. **USAF Resolution** — pick profile lines across USAF chart bar groups,
   compute Michelson contrast vs lp/mm, report the first-dip resolution
   limit per channel.
2. **FPN Analysis** — ROI + percentile outlier mask + optional ISP, then
   DSNU / PRNU / row-col / residual / 2-D PSD.
3. **Depth of Field** — pick focus probe points + scan lines on a DoF target,
   evaluate 4 focus metrics, produce focus heatmaps + DoF-width plots. H/V
   reference-line calibration converts px → μm/mm.

Author: **Zhongmin Zhu** (`j@polarxphotonics.com`). Lab: **BioSensors Lab @
UIUC**. License: **MIT**. Repo: `https://github.com/BioSensorsLab-Illinois/MantisAnalysis`.

## 2. The six files you must read to operate

| # | File | Why |
|---|---|---|
| 1 | **this file** (`.agent/00_START_HERE.md`) | orientation |
| 2 | `.agent/AGENT_RULES.md` | the rules — non-negotiables |
| 3 | `.agent/SETUP_AND_RUN.md` | exact commands to get the app running |
| 4 | `.agent/REPO_MAP.md` | where each module lives + what it does |
| 5 | `.agent/QUALITY_GATES.md` | what "done" means + smoke tiers |
| 6 | `.agent/WORKFLOWS.md` | how to make a change end-to-end |

Then consult on demand:
- `.agent/TASK_PLAYBOOK.md` — recipes for common change types
- `.agent/RISKS.md` — known minefields
- `.agent/BACKLOG.md` — what remains
- `.agent/DECISIONS.md` — why things are the way they are
- `.agent/HANDOFF.md` — latest live-state pointer
- `.agent/TOOLS_AND_SKILLS.md` — tooling inventory
- `.agent/CHANGELOG_AGENT.md` — what past sessions did
- `.agent/ARCHITECTURE.md` — the layered view
- `.agent/PROJECT_BRIEF.md` — the product in 1 page
- `.agent/SESSION_BOOTSTRAP.md` — commands for session start
- `.agent/manifest.yaml` — machine-readable summary

## 3. Bootstrap your session (copy-paste)

```bash
cd /c/Users/J/BioSensors-Lab/MantisAnalysis        # absolute path on this workstation
cat .agent/00_START_HERE.md                        # this file
cat .agent/AGENT_RULES.md                          # rules
cat .agent/SETUP_AND_RUN.md                        # commands
cat .agent/QUALITY_GATES.md                        # smoke tiers
git status -sb                                     # current branch + dirty state
ls .agent/runs/ 2>/dev/null                        # open initiatives (may be empty)
```

Now run the Tier-1 smoke gate. **If it fails, stop and fix before anything else.**

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

## 4. The one rule you must not break

**Every non-doc change must pass Tier 1 + Tier 2 smoke before you claim it
complete.** No exceptions. Details in `.agent/QUALITY_GATES.md`.

## 5. What you should NOT do without reading further

- Restructure the package layout (see the deferred plan in
  `.agent/BACKLOG.md` + `.agent/runs/` before touching).
- Change the USAF Bayer extraction math (`mantisanalysis/extract.py:25-26`
  is locked to the physical lab setup; see `.agent/RISKS.md`).
- Delete `mantisanalysis/resolution.py` or `scripts/run_usaf_resolution.py`
  — they are documented as Workflow A in the README; decision pending
  (see `.agent/DECISIONS.md`).

Read the Rules file next. Then pick a task.
