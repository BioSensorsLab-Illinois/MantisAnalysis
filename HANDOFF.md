# MantisAnalysis — Repository Audit & Agent-Harness Design

**Identity**
- Repository: **`MantisAnalysis`** (current on-disk dir: `rgbnir-analysis`; proposed rename)
- Author: **Zhongmin Zhu** — `j@polarxphotonics.com`
- Organization: **BioSensors Lab @ UIUC**
- Purpose: Desktop analysis tool for **MantisCam GSense BSI dual-gain RGB-NIR** recordings (and generic images), with three modes — USAF Resolution, FPN, Depth of Field.
- Current working state: **functional but not reproducible** (no VCS, no tests, no packaging). Ready to be hardened into a standalone repo.

This document is the audit, architecture reconstruction, and implementation blueprint for a subsequent structural pass. All claims are cited against repo evidence (path:line).

---

## 1. Audit Summary

### 1.1 Inventory (evidence-backed)

- 18 Python modules, **7,755 lines of source code** (files sized via `wc -l`):
  | File | LoC | Role |
  |---|---:|---|
  | `scripts/pick_lines_gui.py` | 1 936 | Main launcher + USAFPickerApp + MainWindow |
  | `rgbnir/usaf_render.py` | 1 576 | USAF analysis figures + 6-tab Qt viewer |
  | `rgbnir/modes/dof.py` | 803 | DoF mode UI (QWidget) |
  | `rgbnir/dof_render.py` | 586 | DoF analysis figures + Qt viewer |
  | `rgbnir/fpn_render.py` | 488 | FPN analysis figures + Qt viewer |
  | `rgbnir/modes/fpn.py` | 466 | FPN mode UI (QWidget) |
  | `scripts/run_usaf_resolution.py` | 358 | Legacy CLI (auto-strip FFT MTF) |
  | `rgbnir/dof_analysis.py` | 351 | DoF focus-metric math |
  | `rgbnir/resolution.py` | 302 | Legacy — FFT auto-strip MTF math |
  | `rgbnir/usaf_groups.py` | 271 | USAF lp/mm table + measurement fns |
  | `rgbnir/modes/common.py` | 269 | Shared widgets (Card / ImageCanvas / slider_row) |
  | `rgbnir/fpn_analysis.py` | 241 | FPN statistics + ISP math |
  | `rgbnir/image_processing.py` | 149 | Sharpen + tone-curve functions |
  | `rgbnir/extract.py` | 117 | GSense dual-gain Bayer extraction |
  | `rgbnir/image_io.py` | 105 | Unified H5/image loader |
  | `scripts/inspect_recording.py` | 75 | One-shot file-preview utility |

- Top-level files: `README.md`, `requirements.txt`, `launch_picker.bat`, `outputs/` (PNG artifacts).
- **No** `pyproject.toml`, `setup.py`, `setup.cfg`, `.gitignore`, `LICENSE`, `.git/`, `tests/`, `.github/`, `ruff.toml`, `pre-commit`.
- `outputs/` contains only historical PNGs from past runs (`fig_HG_overlay.png` etc.) — not part of the package.

### 1.2 Runtime characteristics

- Entry points:
  - GUI: `scripts/pick_lines_gui.py` → `main() → MainWindow(QMainWindow)` at pick_lines_gui.py:1906 / :1744.
  - Legacy CLI: `scripts/run_usaf_resolution.py` (uses `rgbnir.resolution`, orthogonal to the GUI).
  - Utility: `scripts/inspect_recording.py`.
- Launch wrapper for Windows: `launch_picker.bat`.
- Dependencies (`requirements.txt`): `h5py ≥3.0`, `numpy ≥1.24`, `scipy ≥1.10`, `matplotlib ≥3.7`, `Pillow ≥10.0`, `tifffile ≥2023.0`, `PySide6 ≥6.5`.
- Python version tested in practice: **3.13** (Scoop install on Windows; same environment used for ad-hoc smoke tests throughout development).

### 1.3 Quality posture (current state)

| Axis | Status | Evidence |
|---|---|---|
| VCS | **Absent** | `find .git`: not found |
| Packaging | **Absent** | No `pyproject.toml` |
| Tests | **Absent** | No `tests/`, no smoke harness |
| CI | **Absent** | No `.github/workflows/` |
| Lint / format | **Absent** | No `ruff`, `black`, `pre-commit` config |
| Type-check | **Partial** | Annotations used throughout; no `mypy` config |
| Docs | **One files** | `README.md` (150 lines) |
| Reproducibility | **Brittle** | Dependencies pinned only to lower bounds; Python version unspecified |
| Error handling | **Reasonable** | `_check_environment()` at pick_lines_gui.py:1720 catches missing deps; modes raise `QMessageBox` on bad input |
| Logging | **None** | No `logging` module calls; everything flows through `print()` / status bar |

---

## 2. Architecture Summary

### 2.1 Layered view (reconstructed from imports)

```
┌─────────────────────────────────────────────────────────────┐
│ Entry / UI shell                                            │
│ scripts/pick_lines_gui.py                                   │
│   ├─ MainWindow              (top-level, mode switcher)     │
│   ├─ USAFPickerApp           (legacy QMainWindow, embedded) │
│   ├─ Card / ImageCanvas /    (DUPLICATED, see §3.3)         │
│   │  slider_row / apply_transform                           │
│   └─ THEMES + make_qss + apply_theme                        │
├─────────────────────────────────────────────────────────────┤
│ Mode widgets (QWidget pages inside MainWindow's QStack)     │
│ rgbnir/modes/                                               │
│   ├─ common.py   (Card / ImageCanvas / slider_row /         │
│   │               ChannelSelector / apply_transform /       │
│   │               stretch — USED BY fpn.py + dof.py)        │
│   ├─ fpn.py      (FPNMode)                                  │
│   └─ dof.py      (DoFMode)                                  │
├─────────────────────────────────────────────────────────────┤
│ Figure builders + analysis viewers                          │
│ rgbnir/usaf_render.py       (MTF / gallery / table /        │
│                              heatmap / sweep / FFT; 6 tabs) │
│ rgbnir/fpn_render.py        (overview / rowcol / map /      │
│                              PSD / compare)                 │
│ rgbnir/dof_render.py        (heatmap / line-scan / points / │
│                              metric-compare / compare)      │
├─────────────────────────────────────────────────────────────┤
│ Analysis math (numpy/scipy, no Qt)                          │
│ rgbnir/usaf_groups.py   (USAF lp/mm, line profile, Michelson│
│                          {percentile, minmax, fft})         │
│ rgbnir/fpn_analysis.py  (ISP filters, FPN statistics)       │
│ rgbnir/dof_analysis.py  (focus metrics, line scan, heatmap) │
│ rgbnir/resolution.py    (legacy auto-strip FFT MTF)         │
├─────────────────────────────────────────────────────────────┤
│ Image pipeline + I/O                                        │
│ rgbnir/image_processing.py (sharpen / brightness /          │
│                             contrast / gamma / clip)        │
│ rgbnir/image_io.py         (unified load_any dispatcher)    │
│ rgbnir/extract.py          (GSense dual-gain Bayer extract) │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Import graph (verbatim from `grep -rn "^from rgbnir\|^from \."`)

- `rgbnir/dof_render.py:36` → `from .dof_analysis import …`
- `rgbnir/dof_render.py:40` → `from .fpn_render import _color, _ch, _style_axes`  *(FPN helpers reused in DoF — see §3.5)*
- `rgbnir/fpn_render.py:26` → `from .fpn_analysis import FPNResult`
- `rgbnir/image_io.py:10` → `from .extract import LOC, ORIGIN, …`
- `rgbnir/modes/dof.py:21-25` → imports from `..dof_analysis`, `..dof_render`, `.common`
- `rgbnir/modes/fpn.py:17-19` → imports from `..fpn_analysis`, `..fpn_render`, `.common`
- `rgbnir/usaf_render.py:20-21` → `from .image_io import luminance_from_rgb`; `from .usaf_groups import …`
- `scripts/pick_lines_gui.py:52-64` → `from rgbnir.image_io import load_any`; `from rgbnir.image_processing import …`; `from rgbnir.usaf_groups import …`
- `scripts/pick_lines_gui.py:1794-1795` → *lazy* `from rgbnir.modes.fpn import FPNMode` / `from rgbnir.modes.dof import DoFMode`

Graph is acyclic, but layering has a leak: `dof_render.py` reaches into `fpn_render._color / _ch / _style_axes` (dof_render.py:40). The two render modules should share a neutral helper — either a `rgbnir.plotting` module or hoist these into `modes/common.py`.

### 2.3 Runtime model

- `main()` at pick_lines_gui.py:1906 constructs `QApplication`, parses `--dark` / `--light`, calls `apply_theme()`, instantiates `MainWindow`.
- `MainWindow.__init__` at pick_lines_gui.py:1755:
  1. Instantiates `USAFPickerApp` (still a `QMainWindow` subclass, pick_lines_gui.py:523).
  2. Calls `self.usaf_app.takeCentralWidget()` to **steal** the central widget.
  3. **Monkey-patches** `usaf_app._update_status` (line 1779) and `usaf_app._do_open` (line 1791) to forward into the new window.
  4. Lazy-imports + instantiates `FPNMode(self, theme_provider=...)` and `DoFMode(self, theme_provider=...)`.
  5. Builds a `QStackedWidget` of [USAF central, FPNMode, DoFMode].
- Shared state: `self.channel_images`, `self.attrs`, `self.source_path` on `MainWindow`. Modes read via `self.app.channel_images`.
- Analysis windows are non-modal `QMainWindow` children opened from each mode's Run button.
- Theme is a dict passed via `theme_provider` lambda; `_set_theme()` at pick_lines_gui.py:1890 reapplies Qt palette + QSS and propagates to both mode widgets.

---

## 3. Risks · Unknowns · Dead Code · Structural Issues

Prioritized by blast radius.

### 3.1 **P0 — No version control** ✅ evidence: no `.git/`

Consequences: every past change is irreversible; no history; no branching; no diff-review; cannot be used with any `.agent/` workflow that tracks initiatives (which assumes per-branch work).

### 3.2 **P0 — No test + no smoke harness** ✅ evidence: no `tests/`, no `scripts/smoke_test.py`

Current validation pattern during development was `timeout 4 python scripts/pick_lines_gui.py …` + eyeballing the launch. This is not repeatable by a future agent. **First required deliverable of any implementation pass is a tiered smoke harness** (see §7.3).

### 3.3 **P0 — Duplicated shared widgets** ✅ evidence:
- `Card` defined at pick_lines_gui.py:338 AND rgbnir/modes/common.py:20
- `ImageCanvas` at pick_lines_gui.py:409 AND rgbnir/modes/common.py:90
- `slider_row` at pick_lines_gui.py:357 AND rgbnir/modes/common.py:41
- `apply_transform` at pick_lines_gui.py:309 AND rgbnir/modes/common.py:249

USAFPickerApp uses the pick_lines_gui.py-local copies (pick_lines_gui.py:691, :702); FPNMode + DoFMode use the common.py copies. Drift risk is high — any QSS change to `Card` must be made in both places; any mouse-event change to `ImageCanvas` likewise. This is THE first thing a refactor must collapse.

### 3.4 **P0 — `USAFPickerApp` is still a `QMainWindow`** ✅ evidence: pick_lines_gui.py:523

The multi-mode MainWindow works around this with `takeCentralWidget()` + monkey-patching of `_update_status` and `_do_open`. Fragile; future changes to those names break the wiring silently. Proper fix: demote `USAFPickerApp` to `QWidget` like `FPNMode` and `DoFMode`.

### 3.5 **P1 — Cross-module coupling between render layers** ✅ evidence: dof_render.py:40 imports `_color, _ch, _style_axes` from `fpn_render`.

Prevents FPN and DoF from evolving independently; if one wants a new axis-styling helper, the other co-changes. Hoist these to a neutral `plotting.py` or to `modes/common.py`.

### 3.6 **P1 — Legacy module still referenced in README but not used by the GUI** ✅ evidence:
- `rgbnir/resolution.py` (302 LoC) + `scripts/run_usaf_resolution.py` (358 LoC) implement Workflow A (auto-strip FFT MTF).
- Only `scripts/run_usaf_resolution.py` imports from `rgbnir.resolution` (scripts/run_usaf_resolution.py:42).
- README §Workflow A (README.md:57-66) documents the CLI, but no UI path calls it.
- **Decision required**: keep as a documented CLI tool (rename & move to `legacy/` or a `scripts/cli/` folder), or deprecate & delete. It works today; deleting is not urgent, but README must either match or be rewritten.

### 3.7 **P1 — Hidden sharpening-bounds pitfall** ✅ evidence: UI_SPEC.md:12 §6, this session's prior smoke test.

When "Apply sharpening to analysis" is enabled with Unsharp mask amount ≥ 2, Michelson percentile contrast can exceed 1.0 (unphysical — observed `1.947` during LG-R smoke). Not clamped and not warned in the UI. Known behavior, not a bug, but surfaces as confusing numbers to end users.

### 3.8 **P1 — Rotate/flip clears picks silently** ✅ evidence:
- USAF mode: no re-map logic; pick list is in the rotated-image frame.
- FPN mode (rgbnir/modes/fpn.py `_set_rotation`): `self.roi = None` on rotation change.
- DoF mode (rgbnir/modes/dof.py `_set_rotation`): clears both points and lines.

Scripted users who save USAF lines JSON then re-open at a different rotation will see their picks silently mis-aligned (USAF) or silently cleared (FPN/DoF).

### 3.9 **P2 — Error paths swallow exceptions inconsistently**

- `rgbnir/modes/fpn.py::_update_live_stats` catches `ValueError` and sets a muted label (benign).
- `rgbnir/usaf_render.py::open_analysis_window` catches everything and prints traceback to stdout (benign during dev; invisible in a bundled app).
- No central log file; when the `.bat` launcher hits an error in a packaged binary, console closes before user can read it.

### 3.10 **P2 — Dead + ambiguous code**

- `rgbnir/extract.py::split_and_extract` (line 112) — never called anywhere. Harmless but worth deleting during consolidation.
- `rgbnir/modes/common.py::stretch` is redefined locally in `scripts/pick_lines_gui.py`? No — it only exists in `common.py`. OK.
- `scripts/pick_lines_gui.py:1255` — `patched_set_message` monkey-patches matplotlib's `NavigationToolbar2QT.set_message`. Works but fragile to matplotlib upstream changes.

### 3.11 **Unknowns (require human or evidence)**

- Which Python versions are officially supported? (3.13 works; 3.9/3.10/3.11/3.12 are untested.)
- Whether FPN/DoF picks should persist in JSON (USAF does; they don't).
- Whether the legacy Workflow A CLI should survive the rename.
- Whether there's an intended license.
- Whether binary packaging (PyInstaller) will be needed.
- Whether the tool is intended to be used cross-platform in practice, or Windows-only in the BSL lab (requirements suggests the former, launch_picker.bat suggests the latter).

---

## 4. Proposed Repo Restructuring (MantisAnalysis standalone)

Goal: take the working codebase as-is, drop it into a properly-scaffolded standalone repo, resolve the P0 issues above, and leave all `P2` items for later initiatives. **No changes to analysis math or UI behavior** in this first restructure — it is a packaging + layering pass.

### 4.1 Target layout

```
MantisAnalysis/
├── .agent/                          # agent harness (see §5)
├── .github/
│   └── workflows/
│       ├── smoke.yml                # Tier 1/2 on every push
│       └── agent-lint.yml           # skill-frontmatter + initiative hygiene
├── .gitignore
├── AGENTS.md                        # thin pointer → .agent/AGENT.md
├── CLAUDE.md                        # thin pointer → .agent/AGENT.md
├── LICENSE                          # MIT or BSD-3 (TBD by Zhongmin)
├── README.md                        # user-facing readme only
├── HANDOFF.md                       # this file; remove after first initiative
├── pyproject.toml                   # PEP-621 metadata + deps + entry point
├── requirements-dev.txt             # ruff, pytest, pytest-qt, mypy
├── launch_picker.bat
│
├── mantisanalysis/                  # importable package (flat — no src/ layout)
│   ├── __init__.py                  # exports version, package metadata
│   ├── __main__.py                  # `python -m mantisanalysis` entry
│   │
│   ├── app.py                       # MainWindow + main() (was pick_lines_gui.py)
│   │
│   ├── theming.py                   # THEMES + make_qss + apply_theme + apply_palette
│   │
│   ├── io/
│   │   ├── __init__.py
│   │   ├── h5.py                    # Recording + load_recording (was extract.py)
│   │   ├── bayer.py                 # GSense Bayer extraction (was extract.py)
│   │   ├── image.py                 # PNG/TIFF/JPG loader (was image_io.py)
│   │   └── channels.py              # load_any dispatcher (was image_io.py)
│   │
│   ├── isp/
│   │   ├── __init__.py
│   │   ├── sharpen.py               # unsharp/laplacian/highpass
│   │   ├── tone.py                  # brightness/contrast/gamma/clip
│   │   └── pipeline.py              # prepare_display + maybe_apply_to_analysis
│   │
│   ├── widgets/
│   │   ├── __init__.py
│   │   ├── card.py                  # single Card (collapse the two)
│   │   ├── canvas.py                # single ImageCanvas
│   │   ├── slider_row.py
│   │   ├── channel_selector.py
│   │   └── common.py                # shared Qt helpers (apply_transform, stretch)
│   │
│   ├── plotting.py                  # shared axes/figure helpers (was dof_render._color etc.)
│   │
│   ├── modes/
│   │   ├── __init__.py              # ModeBase abstract class
│   │   ├── usaf/
│   │   │   ├── __init__.py
│   │   │   ├── logic.py             # was usaf_groups.py
│   │   │   ├── render.py            # was usaf_render.py (6-tab analysis window)
│   │   │   └── ui.py                # was USAFPickerApp (now QWidget)
│   │   ├── fpn/
│   │   │   ├── __init__.py
│   │   │   ├── logic.py             # was fpn_analysis.py
│   │   │   ├── render.py            # was fpn_render.py
│   │   │   └── ui.py                # was modes/fpn.py
│   │   └── dof/
│   │       ├── __init__.py
│   │       ├── logic.py             # was dof_analysis.py
│   │       ├── render.py            # was dof_render.py
│   │       └── ui.py                # was modes/dof.py
│   │
│   └── cli/
│       ├── __init__.py
│       ├── inspect.py               # was scripts/inspect_recording.py
│       └── usaf_fft.py              # was scripts/run_usaf_resolution.py + rgbnir/resolution.py (legacy)
│
├── scripts/
│   ├── MantisAnalysis.py            # thin wrapper: `from mantisanalysis.app import main; sys.exit(main(sys.argv))`
│   └── smoke_test.py                # Tier 1/2/3 smoke runner
│
├── tests/
│   ├── unit/                        # pure-math tests (no Qt, no matplotlib GUI)
│   │   ├── test_bayer.py
│   │   ├── test_usaf_lpmm.py
│   │   ├── test_usaf_modulation.py
│   │   ├── test_fpn_math.py
│   │   └── test_dof_focus_metrics.py
│   ├── headless/                    # matplotlib Agg backend; figure builders
│   │   ├── test_usaf_figures.py
│   │   ├── test_fpn_figures.py
│   │   └── test_dof_figures.py
│   └── gui/                         # pytest-qt, requires display; CI gated
│       ├── test_main_window_boot.py
│       └── test_mode_switch.py
│
└── examples/                        # tiny synthetic H5s + sample PNGs (≤ 1 MB each)
    ├── synthetic_usaf_chart.png
    ├── synthetic_gsense_dual_gain.h5
    └── README.md
```

### 4.2 Invariants preserved during restructure

- Every current public function keeps its name. Imports change, behavior does not.
- `apply_transform` signature unchanged.
- `load_any` return shape unchanged — still `(dict, attrs, kind)`.
- USAF lines JSON schema unchanged (to keep user-saved pick sets loadable).
- All analysis figure APIs (`build_*_fig(...)`, `open_*_window(...)`) unchanged.

### 4.3 `pyproject.toml` targets (evidence-based)

```toml
[project]
name = "mantisanalysis"
version = "0.1.0"
description = "MantisCam RGB-NIR + USAF/FPN/DoF analysis suite"
authors = [{ name = "Zhongmin Zhu", email = "j@polarxphotonics.com" }]
requires-python = ">=3.10"          # PySide6 6.5 supports 3.8+; scipy 1.10 supports 3.8+; 3.10 gives us TypedDict niceties
dependencies = [
    "h5py>=3.0",
    "numpy>=1.24",
    "scipy>=1.10",
    "matplotlib>=3.7",
    "Pillow>=10.0",
    "tifffile>=2023.0",
    "PySide6>=6.5",
]

[project.scripts]
mantisanalysis = "mantisanalysis.app:main"

[project.optional-dependencies]
dev = ["pytest>=7", "pytest-qt>=4", "ruff>=0.5", "mypy>=1.8"]
```

### 4.4 Out of scope for the restructure

- No algorithm changes.
- No UI behavior changes.
- No new modes.

---

## 5. Proposed `.agent/` Operating Layer

Modelled on the MantisCamUnified repo's harness (which Zhongmin already operates). The design goal: **a fresh agent with zero memory must be able to resume productively by reading `.agent/AGENT.md` alone**.

### 5.1 File tree

```
.agent/
├── AGENT.md                         # canonical operating manual (the source of truth)
├── SOP.md                           # one-page cheatsheet (which skill for which change-type)
├── PLANS.md                         # ExecPlan routine + Status.md routine
├── INDEX.md                         # master index of all artifacts under .agent/
├── README.md                        # what this folder is; link to AGENT.md
│
├── skills/                          # repo-local skills (YAML-frontmatter markdown)
│   ├── README.md                    # annotated index of all skills
│   ├── session-start/SKILL.md
│   ├── smoke-test/SKILL.md
│   ├── qt-ui-edit/SKILL.md
│   ├── mode-change/SKILL.md
│   ├── analysis-math-change/SKILL.md
│   ├── theming-change/SKILL.md
│   ├── plotting-change/SKILL.md
│   ├── io-change/SKILL.md
│   ├── packaging-binary/SKILL.md
│   ├── ci-cd/SKILL.md
│   ├── release-workflow/SKILL.md
│   ├── context-handoff/SKILL.md
│   └── review-loop/SKILL.md
│
├── templates/
│   ├── ExecPlan.md                  # initiative work template
│   └── Status.md                    # initiative status template
│
└── runs/                            # active + archived initiatives
    ├── _archive/                    # closed initiatives
    ├── bootstrap-repo/              # first initiative (see §7)
    │   ├── ExecPlan.md
    │   └── Status.md
    ├── smoke-test-harness/
    ├── widget-deduplication/
    └── usafpickerapp-demotion/
```

### 5.2 Per-file content specification

#### `.agent/AGENT.md` (the canonical manual)

Sections:
1. **Identity** — project name, author, lab, mission.
2. **The Most Important Rule** — every non-doc change must reach a validated state or record an explicit skip reason. Smoke test is the hard gate.
3. **Canonical Rules** — read AGENT.md first; consult SOP; ground in repo before asking; non-trivial work lives under `.agent/runs/<slug>/`.
4. **Project Orientation** — what `mantisanalysis/app.py`, `mantisanalysis/modes/*/`, `mantisanalysis/io/`, `mantisanalysis/isp/`, `mantisanalysis/widgets/` are for.
5. **Supported Input Model** — MantisCam GSense dual-gain H5 + PNG/TIFF/JPG + the Bayer invariant (cite `extract.py` math).
6. **Qt UI Rules** — PySide6 6.x; Fusion base style; theme is a dict + QSS; `QScrollArea.setHorizontalScrollBarPolicy(ScrollBarAsNeeded)` + `setMinimumWidth(0)` on body to prevent sidebar overflow (evidence: this session's fix).
7. **Runtime Architecture** — MainWindow + QStackedWidget; one QWidget per mode; shared file state on MainWindow; analysis windows non-modal children.
8. **Change Patterns** — pointers to skills per change class.
9. **Validation Principles** — four tiers of smoke test.
10. **Context-handoff SOP** — how to finish a session cleanly.
11. **Update Rules** — when workflow changes, update AGENT.md first.
12. **Quick Developer Reminders** — 6-10 bullet list.

#### `.agent/SOP.md` (cheatsheet)

Sections:
1. **Session Start SoP** (6 numbered steps).
2. **Change-Type → Skill(s)** table:
   | If change touches… | Load skill(s) |
   |---|---|
   | `mantisanalysis/app.py`, MainWindow, mode switcher | `qt-ui-edit` |
   | `mantisanalysis/modes/*/ui.py` | `qt-ui-edit` + `mode-change` |
   | `mantisanalysis/modes/*/logic.py`, `usaf_groups.py`, `fpn_analysis.py`, `dof_analysis.py` | `analysis-math-change` |
   | `mantisanalysis/modes/*/render.py`, `plotting.py` | `plotting-change` |
   | `mantisanalysis/theming.py`, QSS | `theming-change` |
   | `mantisanalysis/io/` | `io-change` |
   | `mantisanalysis/widgets/` | `qt-ui-edit` (shared widgets) |
   | `pyproject.toml`, packaging, freezing | `packaging-binary` |
   | `.github/workflows/` | `ci-cd` |
   | Tagged release | `release-workflow` |
   | Smoke harness itself | `smoke-test` |
   | Long-horizon or hand-off | `context-handoff` |
   | After milestone | `review-loop` |
3. **Validation SoP** — the 4 smoke tiers.
4. **Review Loop SoP**.
5. **Handoff SoP**.
6. **Quick Facts** — entry point, Python version, themes, PySide6 version, sample data paths.

#### `.agent/PLANS.md`

ExecPlan + Status routine. Lifted from the MantisCamUnified precedent; contents (sections): Purpose, Progress, Decision Log, Surprises & Discoveries, Outcomes & Retrospective for ExecPlan; and Current Branch, Current Focus, Progress, Blockers, Known Checks Still Required, Next Steps, Uncommitted Files, Notes for Handoff for Status.

#### `.agent/INDEX.md`

Auto-written index listing every file under `.agent/` with one-line description. Purpose: make the harness discoverable via `cat .agent/INDEX.md` alone.

#### `.agent/skills/session-start/SKILL.md`

YAML frontmatter:
```yaml
---
name: session-start
description: Mandatory session-start ritual — read AGENT.md + SOP.md, scan runs/*/Status.md, classify the task, load the matching skill. Triggers whenever the session opens and no other skill has been invoked.
---
```

Body: the 6-step ritual with bash commands.

#### `.agent/skills/smoke-test/SKILL.md` (HARD always-run SOP)

Frontmatter triggers on *any* non-doc change. Body describes 4 tiers:

- **Tier 1 — Import check.** `python -c "import mantisanalysis, mantisanalysis.modes.usaf, mantisanalysis.modes.fpn, mantisanalysis.modes.dof"`. Catches syntax + broken imports. Runs anywhere including CI without display.
- **Tier 2 — Headless figures.** Build every figure builder with synthetic data using `matplotlib.use("Agg")`. Writes a few PNGs into `outputs/smoke/`. Catches analysis-math regressions.
- **Tier 3 — Qt boot (display-required).** Launch `mantisanalysis.app:main` with `--smoke-quit-after=3s` flag added for testability; assert no exceptions. Skipped gracefully on headless Linux CI leg.
- **Tier 4 — End-to-end run.** Load a bundled `examples/synthetic_gsense_dual_gain.h5`, programmatically drop picks in each mode, invoke `run_analysis`, assert figure count. Gated by `MANTISANALYSIS_SMOKE_E2E=1`.

Implementation file: `scripts/smoke_test.py` with `--tier {1,2,3,4}`.

#### `.agent/skills/qt-ui-edit/SKILL.md`

Rules: use PySide6 ≥6.5. Sidebars inside `QScrollArea` MUST use `ScrollBarAsNeeded` + `setMinimumWidth(0)` on the body widget to let QSplitter shrink (evidence: this session's screenshot-driven fix). The `Card`, `ImageCanvas`, `slider_row`, `ChannelSelector` helpers are single-sourced in `mantisanalysis/widgets/`; never duplicate them into a mode module. Themes are switched by `mantisanalysis.theming.apply_theme(QApplication, name)` + re-`setStyleSheet` at the top level; don't override styles per-widget via `setStyleSheet` — rely on the global QSS.

#### `.agent/skills/mode-change/SKILL.md`

Triggers on `mantisanalysis/modes/*/` changes. Contract: every mode widget must (a) subclass `QtWidgets.QWidget`, (b) implement `on_file_loaded()` and `on_theme_changed()` hooks called by MainWindow, (c) emit status via `self.app.statusBar().showMessage(...)` (not a private method of its own), (d) keep picking state in plain attributes so smoke tests can drive them programmatically. A mode adds itself to `MainWindow.MODES` and the QStackedWidget.

#### `.agent/skills/analysis-math-change/SKILL.md`

Triggers on `*/logic.py`, `usaf_groups.py`, `fpn_analysis.py`, `dof_analysis.py`. Rules: pure NumPy/SciPy, no Qt imports allowed. New numerical functions need a unit test under `tests/unit/`. Preserve exported dataclasses' field names for backward-compatibility (they are used in the JSON line-save schema and in analysis-tab CSV exports).

#### `.agent/skills/plotting-change/SKILL.md`

Triggers on `*/render.py`, `plotting.py`. Rules: figure functions take `fig_face` + `text` (theme colors) as kwargs so they render correctly in both light and dark. Use `_style_axes()` from `mantisanalysis.plotting` to normalize axis/tick/spine colors. Analysis windows are `QMainWindow` children with a `QTabWidget` central and an Export action row — new tabs add a page via `_make_canvas_page(...)`.

#### `.agent/skills/theming-change/SKILL.md`

Triggers on `theming.py`, QSS changes. Rules: always include both "light" and "dark" variants; test both. Changes to palette keys need a search across mode UIs to ensure no widget reads `theme[KEY]` that doesn't exist.

#### `.agent/skills/io-change/SKILL.md`

Triggers on `mantisanalysis/io/*`. Rules: channel schema is frozen (`HG-R`, `HG-G`, `HG-B`, `HG-NIR`, `HG-Y`, `LG-R`, …, `LG-Y`, `R`, `G`, `B`, `Y`, `L`). `load_any()` must return `(dict[str, ndarray], dict[str, str], str)` tuple where the third string is `"h5"` or `"image"`. GSense Bayer constants `ORIGIN=(0,0)` and `LOC={B:(0,0), R:(0,1), G:(1,0), NIR:(1,1)}` are locked to the lab study (README.md:20-27).

#### `.agent/skills/packaging-binary/SKILL.md`

Only fires when producing a distributable. Covers PyInstaller spec template, hidden imports (`PySide6.QtSvg`, `scipy.special.cython_special`), data files (`examples/`).

#### `.agent/skills/ci-cd/SKILL.md`

Covers `.github/workflows/smoke.yml` (Tier 1 always; Tier 2 on Linux; Tier 3 on Windows + macOS) and `.github/workflows/agent-lint.yml` (skill-frontmatter validator + initiative-folder structure validator).

#### `.agent/skills/release-workflow/SKILL.md`

Bumps version, tags, runs full smoke, builds a binary, produces a release notes draft from Status.md files of closed initiatives.

#### `.agent/skills/context-handoff/SKILL.md`

Covers: update active `Status.md`, update `ExecPlan.md`, update `AGENT.md` if truth changed, hand off from docs not memory.

#### `.agent/skills/review-loop/SKILL.md`

Spawn an independent agent pass after a milestone. Review: safety/permission conflicts, QSS/theme coherence, mode-wiring integrity, analysis-math regressions, packaging impact. Findings captured in active Status.md.

#### `.agent/templates/ExecPlan.md` + `.agent/templates/Status.md`

Template bodies with placeholder sections.

#### `.agent/runs/bootstrap-repo/` (first initiative — see §7)

Pre-seeded with `ExecPlan.md` + `Status.md` describing the §4 restructuring work.

---

## 6. Recommended Tools / Skills / MCP Integrations

### 6.1 Local dev tooling

| Tool | Purpose | Config location |
|---|---|---|
| `ruff` (lint + format) | Consistent style, catch unused imports like the dead `split_and_extract` | `pyproject.toml [tool.ruff]` |
| `mypy` | Type-check — annotations already exist but unchecked | `pyproject.toml [tool.mypy]` |
| `pytest` + `pytest-qt` | Unit + GUI tests | `pyproject.toml [tool.pytest.ini_options]` |
| `pre-commit` | Run ruff + mypy + smoke tier-1 on commit | `.pre-commit-config.yaml` |
| `pip-tools` or `uv` | Lock files for reproducibility | `requirements.lock`, `requirements-dev.lock` |

### 6.2 CI — GitHub Actions

Three workflows:
1. `smoke.yml` — runs on every push/PR. Tier 1 always; Tier 2 (headless matplotlib) on all OS legs; Tier 3 (Qt boot) on Windows + macOS legs via `xvfb-run` on Linux (optional). Cache pip.
2. `agent-lint.yml` — validates skill-frontmatter and checks that every `.agent/runs/<slug>/` folder has both `ExecPlan.md` and `Status.md`.
3. `release.yml` (later) — `workflow_dispatch` only; builds PyInstaller artifacts for Windows + macOS.

### 6.3 Claude-Code harness integrations

Already in use by Zhongmin at `C:\Users\J\.claude\` and the sibling MantisCamUnified repo; reuse the same wiring:

- `.claude/settings.json` — project-local permissions + SessionStart hook that prints the 5-step ritual.
- `.claude/commands/` — slash-command shims that invoke repo-local skills:
  - `/session-start` → invoke the `session-start` skill.
  - `/smoke` → invoke `smoke-test` skill.
  - `/release` → invoke `release-workflow`.
  - `/handoff` → invoke `context-handoff`.
  - `/new-initiative` → bootstrap a `.agent/runs/<slug>/` folder from templates.
- `.claude/statusline.sh` (optional) — shows active initiative name in the Claude status line.

### 6.4 MCP servers worth enabling

Minimal, high-leverage set:

| Server | Why |
|---|---|
| `filesystem` (stdlib) | Default — already works. |
| `github` | If the repo lives on GitHub, enables PR/issue management without `gh` shell calls. |
| `ripgrep-mcp` or built-in `Grep` | Fast code search; used heavily by skills. |
| `python-sandbox` (optional) | Execute headless smoke tests in an isolated env. |

Avoid:
- Heavy IDE-style MCP servers — this is a solo lab project; overhead outweighs gain.
- Data-tool MCP servers — none of the workflows need DB / dashboards.

---

## 7. Prioritized Implementation Plan

Three phases. Each phase lands a coherent, testable state; no phase breaks the previous one.

### 7.1 Phase 0 — VCS + scaffolding (≈ 1 session, ≈ 2 hrs)

**Goal**: make the current tree versioned, reproducible, and auditable without changing any behavior.

Order of operations:
1. `git init` at repo root, add a comprehensive `.gitignore` (`__pycache__`, `outputs/*.png`, `*.egg-info`, `build/`, `dist/`, `.venv/`).
2. Add `LICENSE` (MIT recommended unless BSL policy differs).
3. Add `pyproject.toml` per §4.3. Leave `requirements.txt` alongside for compatibility.
4. Make the repo *installable in dev mode*: `pip install -e .[dev]` must work (validates pyproject).
5. Move `HANDOFF.md` (this file) into `.agent/runs/bootstrap-repo/HANDOFF.md` when the first initiative starts.
6. Add `.agent/` scaffolding per §5 — **files only, no behavior changes**. Skills are stubs at this phase.
7. Add `.claude/` wiring (settings + commands) per §6.3.
8. Initial commit: `chore: bootstrap repo with .agent harness, pyproject, .gitignore`.

Success gate: fresh clone + `pip install -e .[dev]` + `python -m mantisanalysis --help` (if `--help` exists) + `python scripts/pick_lines_gui.py` both succeed.

### 7.2 Phase 1 — Smoke harness (≈ 1 session)

**Goal**: make every future change gated by `python scripts/smoke_test.py --tier 2`.

1. Write `scripts/smoke_test.py` with Tier 1/2 implemented.
2. Add `tests/unit/test_usaf_lpmm.py` — verify `lp/mm = 2^(group + (element-1)/6)` (known values from README.md:131-136).
3. Add `tests/unit/test_bayer.py` — verify `extract.LOC` invariant using a synthetic 8×16 dual-gain array.
4. Add `tests/unit/test_usaf_modulation.py` — fixture signals of known Michelson to verify the three estimators.
5. Add `tests/headless/test_usaf_figures.py` that imports `usaf_render.build_analysis_figures` with 3 `LineSpec` and asserts figure count == 2 (HG, LG) using an Agg-backend matplotlib.
6. Wire `.github/workflows/smoke.yml` to run Tier 1 on every push; Tier 2 on Linux leg.
7. Update `.agent/AGENT.md` to declare Tier 1+2 as the mandatory gate.

Success gate: CI green on a PR that does nothing but adds a docstring.

### 7.3 Phase 2 — Structural cleanup (≈ 2 sessions)

**Goal**: eliminate the P0 structural issues from §3 without changing behavior.

Session A — Repo rename + package layout:
- Rename folder `rgbnir-analysis` → `MantisAnalysis` (after Phase 0 commits).
- Move source from `rgbnir/` into `mantisanalysis/` per §4.1.
- Update every import.
- Update `scripts/MantisAnalysis.py` to be a one-liner that calls `mantisanalysis.app:main`.
- Keep `rgbnir` as a compatibility shim for one cycle (`rgbnir/__init__.py` re-exports from `mantisanalysis` with a DeprecationWarning).

Session B — Widget deduplication + USAFPickerApp demotion:
- Collapse `Card` / `ImageCanvas` / `slider_row` / `apply_transform` duplicates into `mantisanalysis/widgets/`.
- Hoist `_color / _ch / _style_axes` out of `fpn_render` into `mantisanalysis/plotting.py`.
- Demote `USAFPickerApp(QMainWindow)` → `USAFMode(QWidget)` following the same contract as `FPNMode` / `DoFMode`.
- Remove the `takeCentralWidget()` + monkey-patch gymnastics in `MainWindow`.
- Delete dead `split_and_extract` from `extract.py`.

Success gate: all Tier 1+2 smoke tests still green; behavior unchanged on the USAF, FPN, DoF workflows.

### 7.4 Phase 3 — UX & product polish (deferred; outside this audit)

- Decide fate of Workflow A (`rgbnir/resolution.py`): rewrite as a proper `mantisanalysis/cli/usaf_fft.py` or drop entirely.
- Persist FPN ROI + DoF picks in JSON (symmetric with USAF).
- Warn-and-remap on rotation change (§3.8).
- Clamp Michelson to ≤ 1.0 with warning (§3.7).

---

## 8. Explicit Assumptions & Unresolved Ambiguities

### 8.1 Assumptions I am making (flag to Zhongmin to confirm)

1. **License**: I'll recommend **MIT**; change only if BSL / UIUC policy requires different (e.g., BSD-3-Clause, academic-only).
2. **Python floor**: `>=3.10` — gives us `typing.TypeAlias`, PEP 604 unions, and matches Scoop's default Python. Could tighten to `>=3.11` if performance-sensitive or relax to `>=3.9` if a lab machine is stuck on 3.9.
3. **Module name**: `mantisanalysis` (all-lowercase, PEP 8 compliant). Repository name stays mixed-case `MantisAnalysis` for marketing. Python won't accept a mixed-case top-level module cleanly.
4. **Cross-platform is real**: Windows + macOS + (optionally) Linux are all intended targets. PySide6 + Fusion style supports this cleanly. If BSL is Windows-only in practice, CI can drop the macOS leg later.
5. **No database / no network**: the app is pure local-disk analysis. No telemetry, no auto-update.
6. **Two themes only** (light + dark). No per-palette custom themes for now.
7. **USAF channel-extraction math is frozen**: the origin/loc constants at `extract.py:25-26` match a physical lab setup and must not change during the restructure.
8. **Legacy Workflow A stays** through Phase 2 as a documented CLI (`mantisanalysis/cli/usaf_fft.py`). Delete decision deferred to Phase 3.

### 8.2 Unresolved ambiguities (cannot answer without human input)

1. Where should this repo live remotely? (GitHub under Zhongmin's user, or under a BSL org?)
2. Is there an existing CI budget / preferred CI provider?
3. Should FPN ROI + DoF pick JSON schemas unify with USAF's schema, or keep per-mode JSON formats?
4. Does Zhongmin want PyInstaller binaries, or is `pip install + python -m mantisanalysis` acceptable for end users?
5. Are there lab data files that should be bundled as sample data? If yes, what file-size policy?
6. How far should backwards-compat go with existing USAF lines JSON files (if any saved during this development)?
7. Should the DoF calibration state persist across sessions? (Currently in-memory only.)

### 8.3 Things I explicitly did not do in this pass

- No file moves, renames, or deletions.
- No code edits (this is audit-only).
- No fix of P0/P1 issues yet (those belong in the implementation pass).
- No `.agent/` folder creation; the design is specified here and will be created in Phase 0.

---

## Appendix A — Success Condition Check

Per the user's prompt: *A follow-up implementation pass can be executed with minimal ambiguity.*

- Phase 0 needs: `.gitignore` content spec, `pyproject.toml` content spec, `.agent/` tree, `LICENSE` choice. ✅ All specified.
- Phase 1 needs: smoke-tier definitions, unit-test targets with exact invariants, CI YAML requirements. ✅ All specified with file paths.
- Phase 2 needs: final package layout, per-file mapping from old → new, invariants to preserve. ✅ Specified in §4 with named paths.

**Remaining agent-actionable gates before implementation**: Zhongmin confirms (a) license, (b) remote host, (c) Python floor, (d) Workflow-A survival. Everything else is resolved by this document.

---

## Appendix B — Glossary (drop into AGENT.md)

- **FPN** — Fixed Pattern Noise: spatial-pixel variance that does not change frame-to-frame. Metrics: DSNU (dark-signal non-uniformity), PRNU (photo-response non-uniformity), row / column / residual σ.
- **DoF** — Depth of Field: range along the optical axis over which the image is in acceptable focus. Measured here by local high-frequency energy.
- **USAF** — USAF 1951 resolution chart; `lp/mm = 2^(group + (element-1)/6)`.
- **GSense** — Gpixel GSense400BSI (or similar) dual-gain CMOS imager used by MantisCam.
- **Michelson contrast** — `(Imax - Imin) / (Imax + Imin)`. Three estimators in this codebase: percentile (P10/P90), peak-to-peak (min/max), FFT-at-expected-fundamental.
- **MantisCam** — the lab's imaging stack (hardware + capture software); this analysis tool consumes its H5 output.
- **Coltman correction** — `MTF_sine ≈ (π/4) · CTF_square`, single-frequency approximation mapping bar-target contrast to sine-wave MTF.

---

*Document produced from evidence gathered in a single audit pass. No repo-level changes have been made as a result of this audit. All proposed changes are contingent on Zhongmin's approval of §8.1 assumptions.*
