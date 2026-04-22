# DECISIONS

Append-only log. Every non-trivial choice gets an entry. The counter
`D-000N` is monotonic; do not renumber.

---

## D-0001 — License: MIT  (2026-04-22)

**Context**: Phase 1 audit listed several license options; user
confirmed MIT.
**Options**: MIT, BSD-3-Clause, Apache-2.0, academic-only.
**Decision**: MIT.
**Consequences**: Permissive use; no UIUC-specific clauses; copyright
attributed to Zhongmin Zhu — BioSensors Lab @ UIUC.
**Revisit**: only if a UIUC IP / TTO requirement surfaces.

---

## D-0002 — Remote: github.com/BioSensorsLab-Illinois/MantisAnalysis  (2026-04-22)

**Context**: Phase 1 listed remote-host as unresolved.
**Options**: personal GitHub, BSL-org GitHub, GitLab.
**Decision**: GitHub under the `BioSensorsLab-Illinois` org at
`https://github.com/BioSensorsLab-Illinois/MantisAnalysis`.
**Consequences**: CI = GitHub Actions; PRs follow GitHub conventions.
Not yet pushed (the working tree was just `git init`'d locally).
**Revisit**: only if BSL changes hosting policy.

---

## D-0003 — Python floor: 3.10  (2026-04-22)

**Context**: PySide6 6.5 supports 3.8+; matplotlib 3.7 supports 3.9+.
The lab's primary workstation runs Python 3.13.
**Options**: 3.9 (broadest), 3.10 (typing niceties), 3.11+ (perf).
**Decision**: `requires-python = ">=3.10"`.
**Consequences**: Allows PEP-604 union syntax, `typing.TypeAlias`,
modern `match/case` in any future code.
**Revisit**: if a lab machine is stuck on 3.9 in practice.

---

## D-0004 — Workflow A (auto-strip FFT MTF) survives Phase 2  (2026-04-22)

**Context**: Phase 1 §3.6 flagged that `mantisanalysis/resolution.py`
+ `scripts/run_usaf_resolution.py` (Workflow A) are documented in the
README but not wired into the GUI. User said "not sure" on its fate.
**Options**: (a) delete now, (b) keep as documented CLI, (c) rewrite
into the modern `mantisanalysis/cli/` style.
**Decision**: KEEP as a documented CLI (option b). Both files are
lightweight (302 + 358 LoC), have docstrings, and produce useful
journal-style figures the user has invested in. Removal is reversible
later but blocks tagged users today.
**Consequences**:
- README continues to advertise Workflow A.
- A test under `tests/unit/test_legacy_resolution_cli.py` is on the
  backlog (B-0006) to ensure it doesn't bit-rot.
- The CLI is NOT exposed via `[project.scripts]`; users invoke it via
  `python scripts/run_usaf_resolution.py`.
**Revisit**: when the next round of UI/structural work happens, OR
when Zhongmin signals it can go.

---

## D-0005 — Folder renamed; PYTHON package renamed  (2026-04-22)

**Context**: User asked to rename project AND folders.
**Decision**: Two renames executed:
- `rgbnir-analysis/` → `MantisAnalysis/` (top-level dir; via robocopy
  /MOVE because Windows held a handle on the old folder root — empty
  husk left for user to delete manually).
- `rgbnir/` → `mantisanalysis/` (package; via `mv`; all `from rgbnir.X`
  imports rewritten to `from mantisanalysis.X` in
  `scripts/{pick_lines_gui,inspect_recording,run_usaf_resolution}.py`).
**Consequences**: any external script that did `from rgbnir.X import Y`
will now break. None known to exist.
**Revisit**: not.

---

## D-0006 — Defer the deeper sub-package restructure  (2026-04-22)

**Context**: Phase 1 §4.1 proposed sub-packaging into `io/`, `isp/`,
`widgets/`, `modes/{usaf,fpn,dof}/{logic,render,ui}.py`, plus widget
deduplication and demoting `USAFPickerApp` from `QMainWindow` to
`QWidget`. This is the high-value, high-risk Phase-2 work.
**Decision**: Defer. Phase 2 of THIS implementation pass restricts
itself to: rename, packaging, .agent/ harness, smoke tests, CI, docs.
Sub-packaging + widget dedup + USAFPickerApp demotion is recorded as
backlog items B-0001 through B-0004.
**Rationale**: keeps blast radius small; preserves working behavior
(Phase-2 prompt mandate); leaves a clean state for the next initiative
to pick up.
**Revisit**: on opening of `.agent/runs/structural-cleanup/`.

---

## D-0007 — `mantisanalysis.app` is a SHIM, not the real entry  (2026-04-22)

**Context**: The 1936-line GUI lives in `scripts/pick_lines_gui.py`.
`pyproject.toml [project.scripts]` needs an importable entry point.
**Options**: (a) move pick_lines_gui.py into the package now, (b) shim.
**Decision**: shim. `mantisanalysis/app.py:main` adds
`scripts/` to `sys.path` and imports `pick_lines_gui.main`.
**Consequences**: a small import-time penalty; one extra layer of
indirection. Move planned in B-0001.
**Revisit**: when B-0001 fires.
