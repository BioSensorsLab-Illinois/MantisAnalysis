# CHANGELOG_AGENT

Append-only log of agent sessions. One bullet per session, newest at top.

---

## 2026-04-22 — Phase 2 implementation pass (Claude Opus 4.7)

- Renamed top-level folder `rgbnir-analysis/` → `MantisAnalysis/` via
  robocopy /MOVE (Windows handle on the original folder root left an
  empty husk; recorded as R-0008).
- Renamed Python package `rgbnir/` → `mantisanalysis/`. Rewrote 3
  `from rgbnir.X` import sites in `scripts/`.
- Added `pyproject.toml` (PEP 621), `LICENSE` (MIT), `.gitignore`.
- Added `mantisanalysis/__init__.py` with version + author metadata.
- Added `mantisanalysis/app.py` (shim) + `mantisanalysis/__main__.py`
  so `python -m mantisanalysis` works; `[project.scripts]` entry
  point set.
- Renamed `launch_picker.bat` → `MantisAnalysis.bat`; updated to use
  `python -m mantisanalysis`.
- Added `scripts/smoke_test.py` with Tiers 1, 2, 3 implemented; Tier
  4 stub. Tier 1 + 2 pass; Tier 3 verified mid-development.
- Added `tests/` (5 unit modules + 1 headless module = 39 tests).
  All green via `pytest -q`.
- Built `.agent/` operating layer: 17 docs (00_START_HERE through
  CHANGELOG_AGENT) + `manifest.yaml` + `templates/` + `runs/` (empty).
- Added `.github/workflows/smoke.yml` (Tier 1 + pytest matrix on
  Linux/macOS/Windows × Python 3.10/3.11/3.12/3.13; Tier 2 on Linux).
- Rewrote root `README.md` as user-facing docs (install + run + modes
  + troubleshooting). Preserved `UI_SPEC.md` and `HANDOFF.md` from
  Phase 1.
- Recorded 7 DECISIONS, 8 RISKS, 12 BACKLOG items.
- VCS: `git init`, `git remote add origin
  https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git`. **No
  initial commit yet** — held for user review (B-0010).

Smoke status at session close: ✅ Tier 1, ✅ Tier 2, ⚠ Tier 3
(verified during dev, not formally re-run after rename), ❌ Tier 4
(not implemented).

`pytest tests/`: ✅ 39 passed.

---

*(future entries above this line)*
