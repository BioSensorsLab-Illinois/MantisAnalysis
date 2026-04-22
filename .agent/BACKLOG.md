# BACKLOG

Explicit work that remains. Ordered by impact + readiness. Each item
has a unique `B-000N` ID. Append-only; do not renumber.

---

## B-0001 — Move `scripts/pick_lines_gui.py` → `mantisanalysis/app.py` (the real move, not a shim)

**Why**: cleaner package; `python -m mantisanalysis` no longer needs
`sys.path` gymnastics; better discoverability; pytest collection won't
need a separate `scripts/` shim.

**Risk**: 1936 LoC move; many imports inside the file reference
neighbours via `from mantisanalysis.X` already (so they survive the
move). Only `app.py` shim and `MantisAnalysis.bat` need updates.

**Steps**:
1. `git mv scripts/pick_lines_gui.py mantisanalysis/app.py` (rename the
   file; replace the existing thin shim).
2. Move the contents in.
3. Update `mantisanalysis/__main__.py` to `from .app import main`.
4. Update `MantisAnalysis.bat` (already calls `python -m mantisanalysis`,
   so OK).
5. Tier 1 + Tier 2 + Tier 3 smoke.
6. Update `ARCHITECTURE.md` + `REPO_MAP.md`.

**Out**: this becomes a 1-session initiative under
`.agent/runs/move-app/`.

---

## B-0002 — Deduplicate widget classes (`Card`, `ImageCanvas`, `slider_row`, `apply_transform`)

**Why**: Risk R-0001. Two parallel implementations drift silently.

**Steps**:
1. Make `mantisanalysis/widgets/` package with one file per widget.
2. Re-export from `mantisanalysis/modes/common.py` for back-compat.
3. Replace local definitions in `pick_lines_gui.py` with imports.
4. Tier 3 smoke + visual check (sidebars, canvas mouse events).

**Estimated effort**: ~1 session.

---

## B-0003 — Demote `USAFPickerApp(QMainWindow)` to `USAFMode(QWidget)`

**Why**: Risk R-0003. Removes the `takeCentralWidget` +
monkey-patching gymnastics in `MainWindow`.

**Steps**:
1. After B-0002, change inheritance to `QWidget`.
2. Replace `self.statusBar()` calls with a Qt signal emitted to
   `MainWindow`.
3. Replace `self.menuBar()` with a method that returns menu actions
   for `MainWindow` to install.
4. Promote `_do_open` and `_update_status` to a clean public API.
5. Tier 3 smoke + functional verification of every menu/file
   interaction.

**Estimated effort**: ~1 session.

---

## B-0004 — Sub-package by concern (`io/`, `isp/`, `widgets/`,
`modes/{usaf,fpn,dof}/{logic,render,ui}.py`)

**Why**: Phase 1 §4.1. Improves discoverability + isolates UI vs math
vs render.

**Why deferred**: large mechanical move with heavy import-graph churn;
should follow B-0002 + B-0003.

**Estimated effort**: ~1-2 sessions.

---

## B-0005 — Hoist `_color`, `_ch`, `_style_axes` out of `fpn_render`

**Why**: Risk R-0007. Cross-module coupling.

**Steps**: create `mantisanalysis/plotting.py`; move; update imports
in both `fpn_render.py` and `dof_render.py`.

**Estimated effort**: ~30 min.

---

## B-0006 — Test for the legacy Workflow A CLI

**Why**: D-0004 keeps `mantisanalysis/resolution.py` +
`scripts/run_usaf_resolution.py` alive. Add a smoke that they don't
bit-rot.

**Steps**: add `tests/unit/test_resolution_legacy.py` that imports the
module + exercises `analyze_channel` on a synthetic strip; add a
Tier-2 case in `smoke_test.py`.

**Estimated effort**: ~30 min.

---

## B-0007 — Warn on rotate-clears-picks; offer coordinate remap

**Why**: Risk R-0006.

**Options**: (a) modal warning before the clear, (b) auto-remap line
endpoints through the rotation matrix, (c) refuse to load a JSON
whose `transform.rotation` differs from the current view.

**Estimated effort**: ~1 session.

---

## B-0008 — Tier-4 end-to-end smoke test

**Why**: Today's Tier 1+2 covers math + figure builders, Tier 3 covers
boot. None covers the full user gesture: load file → drop picks →
Run analysis → assert window contents.

**Steps**: bundle a small synthetic GSense H5 in `examples/`;
programmatically drive each mode; assert `_analysis_windows[-1]` has
the expected tab count + canvas count.

**Estimated effort**: ~1-2 sessions.

---

## B-0009 — GitHub Actions Tier-3 with xvfb-run

**Why**: today CI runs Tier 1+2 on Linux only. Tier 3 needs a virtual
display.

**Steps**: add `xvfb-run` wrapper on the Linux leg; gate behind a
`ci-tier3` job to keep PR feedback fast.

**Estimated effort**: ~30 min once xvfb path is verified.

---

## B-0010 — Push initial commit + remote tracking

**Why**: D-0002 says the remote is
`github.com/BioSensorsLab-Illinois/MantisAnalysis`. Local tree has
`git init` + `git remote add origin`, but **no commit has been made
yet** (waiting for review).

**Steps**:
1. `git add -A`.
2. `git commit -m "Initial commit: rename + .agent harness + smoke + tests + CI"`.
3. `git push -u origin main` (with user consent).

**Estimated effort**: ~5 min.

---

## B-0011 — Decide fate of legacy `requirements.txt`

**Why**: `pyproject.toml` is canonical; `requirements.txt` was kept for
compatibility. Once `pip install -e .` is the standard install
command, requirements.txt is redundant.

**Estimated effort**: ~5 min — delete + update README.

---

## B-0012 — Onboarding helper script

**Why**: New developer flow is currently several manual commands.

**Steps**: add `scripts/dev_setup.sh` (Linux/macOS) and
`scripts/dev_setup.ps1` (Windows) that creates a venv, installs `[dev]`,
runs Tier 1+2 smoke, prints next steps.

**Estimated effort**: ~30 min.
