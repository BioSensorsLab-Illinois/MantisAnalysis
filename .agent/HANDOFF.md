# HANDOFF — current live state pointer

Last updated: **2026-04-22**, end of Phase-2 implementation pass by
Claude Opus 4.7.

## Current state of the working tree

- Branch: `main` (only branch).
- VCS state: `git init` complete; `git remote add origin
  https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git`. **No
  commits yet.** All files are uncommitted-untracked from git's POV.
- Folder rename: complete. Repo now lives at
  `C:\Users\J\BioSensors-Lab\MantisAnalysis`.
- Empty husk at `C:\Users\J\BioSensors-Lab\rgbnir-analysis` — see
  RISK R-0008. User can delete after closing any open Explorer windows
  on the path.

## What just shipped

1. Folder + Python-package rename (`rgbnir-analysis/rgbnir` →
   `MantisAnalysis/mantisanalysis`).
2. Imports rewritten across all scripts; package importable.
3. `pyproject.toml` (PEP 621) + `LICENSE` (MIT) +
   `.gitignore`.
4. `mantisanalysis/__init__.py` carries `__version__ = "0.1.0"`,
   `__author__`, `__email__`.
5. `mantisanalysis/app.py` + `mantisanalysis/__main__.py` —
   `python -m mantisanalysis` works.
6. `MantisAnalysis.bat` Windows launcher renamed.
7. `scripts/smoke_test.py` with Tiers 1, 2, 3 implemented (Tier 4
   stub).
8. `tests/` with 39 tests across 5 unit + 1 headless modules. All
   green.
9. `.agent/` operating layer — 17 docs + machine manifest.
10. `.github/workflows/smoke.yml` — Tier 1 + pytest on Linux/macOS/
    Windows × Python 3.10/3.11/3.12/3.13; Tier 2 on Linux.
11. Root `README.md` rewritten as user-facing docs.

## What did NOT ship in this pass (intentional, see DECISIONS / BACKLOG)

- Sub-packaging into `io/`, `isp/`, `widgets/`, `modes/{usaf,fpn,dof}/`
  (B-0001, B-0002, B-0003, B-0004).
- Widget deduplication.
- USAFPickerApp demotion to QWidget.
- Tier-4 end-to-end smoke (B-0008).
- Tier-3 CI integration (B-0009).
- Initial commit + push to remote (B-0010 — held for user review).

## Smoke tier status, last verified

- ✅ Tier 1 — PASS (15 modules)
- ✅ Tier 2 — PASS (USAF + FPN + DoF figure builders all output PNGs)
- ⚠ Tier 3 — partially verified mid-development (`timeout 4 python
  -m mantisanalysis` exits 0). NOT formally re-run after the rename;
  recommended as the first action of next session.
- ❌ Tier 4 — not implemented (B-0008).

`pytest tests/` — ✅ 39 passed in ~0.7s.

## Where to pick up next

1. **First**: run Tier 3 smoke on the current tree. If green, proceed.
2. Pick the next initiative from `.agent/BACKLOG.md`.
   - Recommended order: B-0010 (commit + push) → B-0005 (hoist
     plotting helpers, easy win) → B-0001 (move app.py) →
     B-0002 (widget dedup) → B-0003 (USAFPickerApp demotion) →
     B-0008 (tier-4 smoke) → B-0009 (CI tier-3).
3. Open a new initiative folder under `.agent/runs/<slug>/` from the
   templates in `.agent/templates/` before doing the work.

## Known dirty files

All files in the tree are "new" from git's POV (`git status -s` will
show `??`). Nothing is in a half-edited state.

## Active initiative

None open. The Phase-2 implementation work was tracked inline in this
HANDOFF rather than as a `.agent/runs/` folder because it crossed many
files and was driven by the user's prompt. Next agent should follow
the initiative pattern strictly per `WORKFLOWS.md` § B.
