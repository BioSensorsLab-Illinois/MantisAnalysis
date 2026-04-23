# REPO_MAP

Everything that exists at the repo root and what it contains.

```
MantisAnalysis/
├── .agent/                      ← this operating layer (the only one)
│   ├── *.md                     ← project docs (rules, architecture, etc.)
│   ├── launch.json              ← Claude Preview MCP server config
│   ├── settings.local.json      ← Claude Code permission allowlist
│   ├── runs/                    ← per-initiative folders
│   ├── templates/               ← initiative templates
│   └── manifest.yaml            ← machine-readable summary
├── .claude → .agent             ← symlink so Claude Code's tool-config
│                                  conventions resolve to the same dir
├── .git/                        ← git history (git init'd)
├── .github/workflows/           ← CI (smoke.yml)
├── .gitignore                   ← __pycache__, outputs/, .venv, etc.
├── LICENSE                      ← MIT, attributed to Zhongmin Zhu / BSL UIUC
├── README.md                    ← user-facing readme (install + usage + modes)
├── UI_SPEC.md                   ← long UX spec; output of Phase 1 spec pass
├── HANDOFF.md                   ← first-session audit report (Phase 1 output)
├── MantisAnalysis.bat           ← Windows double-click launcher
├── MantisAnalysis.command       ← macOS double-click launcher
├── pyproject.toml               ← PEP-621 metadata + deps + tool configs
│                                  (sole source of truth; requirements.txt
│                                  deleted in B-0011 / backlog-cleanup-v1)
├── mantisanalysis/              ← importable Python package
│   ├── __init__.py              ← version, author, email
│   ├── __main__.py              ← `python -m mantisanalysis` entry
│   ├── app.py                   ← CLI → uvicorn + open browser
│   ├── extract.py               ← GSense dual-gain 4×4 super-pixel Bayer extractor
│   ├── image_io.py              ← unified load_any: H5 + PNG/TIFF/JPG
│   ├── image_processing.py      ← sharpen (unsharp/Laplacian/high-pass) + tone
│   ├── plotting.py              ← shared matplotlib helpers (CHANNEL_COLORS,
│   │                               _color / _ch / _style_axes) — closed R-0007
│   ├── usaf_groups.py           ← lp/mm table + Michelson estimators + LineSpec
│   ├── usaf_render.py           ← USAF matplotlib figure builders
│   ├── usaf_figures.py          ← alt USAF figure set (hi-dpi journal style)
│   ├── fpn_analysis.py          ← FPN math (ISP + outlier mask + stats)
│   ├── fpn_render.py            ← FPN matplotlib figure builders
│   ├── dof_analysis.py          ← DoF focus metrics + line/heatmap scan
│   ├── dof_render.py            ← DoF matplotlib figure builders
│   ├── resolution.py            ← LEGACY: auto-strip FFT MTF (kept per DECISIONS)
│   ├── server.py                ← FastAPI routes + Pydantic schemas
│   ├── session.py               ← in-memory source store + thumbnail helper
│   └── figures.py               ← matplotlib → PNG bytes adapter
├── scripts/
│   ├── inspect_recording.py     ← one-shot H5 inspector (stdout + preview PNG)
│   ├── run_usaf_resolution.py   ← legacy CLI pairing with mantisanalysis.resolution
│   └── smoke_test.py            ← tiered smoke harness (--tier 1|2|3)
├── tests/
│   ├── __init__.py
│   ├── conftest.py              ← Agg backend fixture + sys.path injection
│   ├── unit/
│   │   ├── test_usaf_lpmm.py
│   │   ├── test_bayer.py
│   │   ├── test_michelson.py
│   │   ├── test_dof_metrics.py
│   │   └── test_fpn_math.py
│   ├── headless/
│   │   └── test_figures.py
│   └── web/                     ← Playwright smoke (B-0015)
│       ├── conftest.py          ← session-scoped uvicorn fixture
│       └── test_web_boot.py     ← boots SPA, asserts React mount + 3 mode btns
├── docs/
│   └── validation/              ← B-0018 staging for real-sample captures
│       └── README.md
├── web/                         ← NEW: React-based preview GUI (D-0008)
│   ├── index.html               ← entry: React 18 + Babel standalone via CDN
│   └── src/
│       ├── shared.jsx           ← BRAND, THEMES, icons, Card/Button/…,
│       │                          hooks (useLocalStorageState, useViewport,
│       │                          useDragCapture, useImageMouse), CSV/JSON
│       │                          export, procedural image generators
│       ├── app.jsx              ← root <App>, TopBar, StatusBar, ModeRail,
│       │                          CommandPalette (⌘K), HelpOverlay,
│       │                          AboutOverlay, TweaksPanel, theme/accent
│       ├── usaf.jsx             ← USAFMode — canvas + sidebars, rulers,
│       │                          rotation-aware labels, sortable lines table
│       ├── fpn.jsx              ← FPNMode — ROI drag, channel chips, live stats
│       ├── dof.jsx              ← DoFMode — probe points, focus lines, H/V
│       │                          reference-length calibration with unit chooser
│       └── analysis.jsx         ← AnalysisModal — per-mode tabs + CSV/PNG export
└── outputs/                     ← generated artifacts (git-ignored).
    └── smoke/                   ← PNGs from `smoke_test.py --tier 2`.
```

## Entry points (confirmed by evidence)

| How you run it | What actually happens |
|---|---|
| `python -m mantisanalysis [path]` | `__main__.py` → `app.main` → uvicorn on `127.0.0.1:8765` + browser |
| `mantisanalysis [path]` *(pip install)* | `[project.scripts]` → `mantisanalysis.app:main_argv` |
| `uvicorn mantisanalysis.server:app` | bare ASGI runner for scripting / deployment testing |

All three reach the same FastAPI `app` object at `mantisanalysis.server:app`. The CLI adds browser auto-open and optional file pre-load; direct uvicorn skips both.

## Where each analysis mode's UI lives

| Mode | Frontend component (React) | API routes | Analysis math | Figure builders |
|---|---|---|---|---|
| USAF | `web/src/usaf.jsx` | `/api/usaf/measure`, `/api/usaf/analyze` | `mantisanalysis/usaf_groups.py` | `mantisanalysis/usaf_render.py:build_analysis_figures` |
| FPN | `web/src/fpn.jsx` | `/api/fpn/compute`, `/api/fpn/analyze` | `mantisanalysis/fpn_analysis.py` | `mantisanalysis/fpn_render.py:build_{overview,rowcol,map,psd}_fig` |
| DoF | `web/src/dof.jsx` | `/api/dof/compute`, `/api/dof/analyze` | `mantisanalysis/dof_analysis.py` | `mantisanalysis/dof_render.py:build_{heatmap,line_scan,points}_fig` |

## Where each dependency is declared

| Where | What |
|---|---|
| `pyproject.toml` `[project.dependencies]` | Canonical runtime deps |
| `pyproject.toml` `[project.optional-dependencies].dev` | `pytest`, `httpx`, `ruff`, `mypy` |
| `pyproject.toml` `[project.optional-dependencies].web-smoke` | `playwright`, `pytest-playwright` (opt-in) |
