# REPO_MAP

Everything that exists at the repo root and what it contains.

```
MantisAnalysis/
├── .agent/                      ← this operating layer
├── .git/                        ← git history (git init'd)
├── .github/workflows/           ← CI (smoke.yml)
├── .gitignore                   ← __pycache__, outputs/, .venv, etc.
├── LICENSE                      ← MIT, attributed to Zhongmin Zhu / BSL UIUC
├── README.md                    ← user-facing readme (install + usage + modes)
├── UI_SPEC.md                   ← long UX spec; output of Phase 1 spec pass
├── HANDOFF.md                   ← first-session audit report (Phase 1 output)
├── MantisAnalysis.bat           ← Windows double-click launcher
├── requirements.txt             ← legacy deps file; pyproject is canonical
├── pyproject.toml               ← PEP-621 metadata + deps + tool configs
├── mantisanalysis/              ← importable Python package
│   ├── __init__.py              ← version, author, email
│   ├── __main__.py              ← `python -m mantisanalysis` entry
│   ├── app.py                   ← main() shim; imports scripts/pick_lines_gui.py
│   ├── extract.py               ← GSense dual-gain 4×4 super-pixel Bayer extractor
│   ├── image_io.py              ← unified load_any: H5 + PNG/TIFF/JPG
│   ├── image_processing.py      ← sharpen (unsharp/Laplacian/high-pass) + tone
│   ├── usaf_groups.py           ← lp/mm table + Michelson estimators + LineSpec
│   ├── usaf_render.py           ← 6-tab USAF analysis window + figure builders
│   ├── fpn_analysis.py          ← FPN math (ISP + outlier mask + stats)
│   ├── fpn_render.py            ← FPN figures + Qt window
│   ├── dof_analysis.py          ← DoF focus metrics + line/heatmap scan
│   ├── dof_render.py            ← DoF figures + Qt window
│   ├── resolution.py            ← LEGACY: auto-strip FFT MTF (kept per DECISIONS)
│   └── modes/
│       ├── __init__.py          ← doc string only
│       ├── common.py            ← Card / ImageCanvas / slider_row / ChannelSelector
│       ├── fpn.py               ← FPNMode (QWidget)
│       └── dof.py               ← DoFMode (QWidget) with H/V calibration card
├── scripts/
│   ├── pick_lines_gui.py        ← THE GUI entry (1936 LoC):
│   │                              MainWindow + USAFPickerApp + THEMES + QSS
│   ├── inspect_recording.py     ← one-shot H5 inspector (stdout + preview PNG)
│   ├── run_usaf_resolution.py   ← legacy CLI pairing with mantisanalysis.resolution
│   └── smoke_test.py            ← tiered smoke harness (--tier 1|2|3|4)
├── tests/
│   ├── __init__.py
│   ├── conftest.py              ← Agg backend fixture + sys.path injection
│   ├── unit/
│   │   ├── test_usaf_lpmm.py
│   │   ├── test_bayer.py
│   │   ├── test_michelson.py
│   │   ├── test_dof_metrics.py
│   │   └── test_fpn_math.py
│   └── headless/
│       └── test_figures.py
└── outputs/                     ← generated artifacts (git-ignored).
    └── smoke/                   ← PNGs from `smoke_test.py --tier 2`.
```

## Entry points (confirmed by evidence)

| How you run it | What actually happens |
|---|---|
| `python -m mantisanalysis [path]` | `mantisanalysis/__main__.py` → `app.main` → `pick_lines_gui.main` |
| `mantisanalysis [path]` *(pipx or pip install)* | `[project.scripts]` → `mantisanalysis.app:main_argv` |
| `python scripts/pick_lines_gui.py [path]` | direct (backward-compat) |
| `MantisAnalysis.bat [path]` | Windows double-click wrapper for `python -m mantisanalysis` |

All four reach the same `main(argv)` at `scripts/pick_lines_gui.py:1906`.

## Where each analysis mode's UI lives

| Mode | UI module | Analysis math | Figures/window |
|---|---|---|---|
| USAF | `scripts/pick_lines_gui.py` — `USAFPickerApp` class (line 523) | `mantisanalysis/usaf_groups.py` | `mantisanalysis/usaf_render.py` |
| FPN | `mantisanalysis/modes/fpn.py` — `FPNMode` | `mantisanalysis/fpn_analysis.py` | `mantisanalysis/fpn_render.py` |
| DoF | `mantisanalysis/modes/dof.py` — `DoFMode` | `mantisanalysis/dof_analysis.py` | `mantisanalysis/dof_render.py` |

## Where each dependency is declared

| Where | What |
|---|---|
| `pyproject.toml` `[project.dependencies]` | Canonical runtime deps |
| `pyproject.toml` `[project.optional-dependencies].dev` | `pytest`, `pytest-qt`, `ruff`, `mypy` |
| `requirements.txt` | Legacy listing (kept in-sync; not authoritative) |
