# REPO_MAP

Everything at the repo root and what it contains. Run the Tier-0
check (`python scripts/smoke_test.py --tier 0`) to catch drift
between this file and actual state.

```
MantisAnalysis/
├── .agent/                       ← agentic operating layer (single source of truth)
│   ├── 00_START_HERE.md          ← first-read orientation
│   ├── AGENT_RULES.md            ← non-negotiable rules
│   ├── PROJECT_BRIEF.md          ← 1-page product overview
│   ├── ARCHITECTURE.md           ← layered view
│   ├── REPO_MAP.md               ← this file
│   ├── SETUP_AND_RUN.md          ← exact commands
│   ├── WORKFLOWS.md              ← per-change-class recipes
│   ├── QUALITY_GATES.md          ← tier ladder
│   ├── UI_VERIFICATION.md        ← browser-verification protocol
│   ├── STOPPING_CRITERIA.md      ← exit checklist
│   ├── REFERENCES.md             ← external refs (Anthropic, Playwright, WCAG, ...)
│   ├── TASK_PLAYBOOK.md          ← concrete recipes
│   ├── TOOLS_AND_SKILLS.md       ← tooling inventory
│   ├── SESSION_BOOTSTRAP.md      ← shell cheat-sheet
│   ├── DECISIONS.md              ← D-000N log
│   ├── RISKS.md                  ← R-000N log
│   ├── BACKLOG.md                ← B-000N log
│   ├── HANDOFF.md                ← live state pointer
│   ├── CHANGELOG_AGENT.md        ← session log (append-only)
│   ├── manifest.yaml             ← machine-readable summary
│   ├── README.md                 ← index of the .agent folder
│   ├── launch.json               ← Claude Preview MCP server config
│   ├── settings.local.json       ← permission allowlist
│   ├── settings.local.README.md  ← rationale for each allowlist entry
│   ├── agents/                   ← 10 specialist reviewer briefs
│   │   ├── README.md
│   │   ├── planner-architect.md
│   │   ├── react-ui-ux-reviewer.md
│   │   ├── frontend-react-engineer.md
│   │   ├── fastapi-backend-reviewer.md
│   │   ├── playwright-verifier.md
│   │   ├── accessibility-reviewer.md
│   │   ├── performance-reviewer.md
│   │   ├── test-coverage-reviewer.md
│   │   ├── risk-skeptic.md
│   │   └── docs-handoff-curator.md
│   ├── skills/                   ← 17 reusable workflow skills
│   │   ├── README.md
│   │   ├── session-start/SKILL.md
│   │   ├── execplan-large-feature/SKILL.md
│   │   ├── react-browser-ui-change/SKILL.md
│   │   ├── fastapi-api-change/SKILL.md
│   │   ├── h5-io-data-pipeline-change/SKILL.md
│   │   ├── visualization-canvas-image-pipeline/SKILL.md
│   │   ├── playwright-e2e-verification/SKILL.md
│   │   ├── visual-regression/SKILL.md
│   │   ├── accessibility-check/SKILL.md
│   │   ├── performance-profiling/SKILL.md
│   │   ├── quality-gates/SKILL.md
│   │   ├── independent-review-loop/SKILL.md
│   │   ├── context-handoff/SKILL.md
│   │   ├── docs-sync/SKILL.md
│   │   ├── safe-git-and-worktrees/SKILL.md
│   │   ├── dependency-change/SKILL.md
│   │   └── emergency-recovery/SKILL.md
│   ├── templates/                ← initiative templates
│   │   ├── ExecPlan.md
│   │   └── Status.md
│   └── runs/                     ← per-initiative folders
│       ├── _archive/             ← closed initiatives
│       ├── agentic-workflow-overhaul-v1/   ← THIS initiative
│       ├── analysis-page-overhaul-v1/      ← active (Phase 3 next)
│       ├── analysis-polish-v1/             ← historical
│       ├── backlog-cleanup-v1/             ← historical
│       ├── dof-rewrite-v1/                 ← historical
│       ├── fpn-rewrite-v1/                 ← historical
│       ├── gui-rewrite-v1/                 ← historical
│       ├── isp-modes-v1/                   ← just shipped
│       └── plot-style-completion-v1/       ← historical
├── .claude → .agent              ← symlink; Claude Code tool-config resolves here
├── .git/                         ← git history
├── .github/workflows/            ← CI (smoke.yml)
├── .gitignore                    ← __pycache__, outputs/, .venv, test-results/, etc.
├── CLAUDE.md                     ← short root entry for Claude Code; points to .agent/
├── AGENTS.md                     ← standard discoverable pointer for AI coding agents
├── LICENSE                       ← MIT, attributed to Zhongmin Zhu / BSL UIUC
├── README.md                     ← user-facing readme (install + usage + modes)
├── HANDOFF.md                    ← historical first-session audit report (kept for archaeology)
├── MantisAnalysis.bat            ← Windows double-click launcher
├── MantisAnalysis.command        ← macOS double-click launcher
├── pyproject.toml                ← PEP-621 metadata + deps + tool configs
├── mantisanalysis/               ← importable Python package
│   ├── __init__.py               ← version, author, email
│   ├── __main__.py               ← `python -m mantisanalysis` entry
│   ├── app.py                    ← CLI → uvicorn + open browser
│   ├── server.py                 ← FastAPI routes + Pydantic schemas
│   ├── session.py                ← in-memory source store (LRU) + helpers
│   ├── figures.py                ← matplotlib → PNG bytes adapter
│   ├── plotting.py               ← shared matplotlib helpers (CHANNEL_COLORS, _color, _ch, _style_axes)
│   ├── extract.py                ← GSense dual-gain 4×4 super-pixel Bayer extractor (constants locked)
│   ├── image_io.py               ← unified load_any: H5 + PNG/TIFF/JPG; ISP-mode aware
│   ├── image_processing.py       ← sharpen (unsharp/Laplacian/high-pass) + tone
│   ├── isp_modes.py              ← ISP-mode registry (bare single/dual, RGB-NIR, image, polarization)
│   ├── usaf_groups.py            ← lp/mm table + Michelson estimators + LineSpec
│   ├── usaf_render.py            ← USAF matplotlib figure builders
│   ├── usaf_figures.py           ← alt USAF figure set (hi-dpi journal style)
│   ├── fpn_analysis.py           ← FPN math (ISP + outlier mask + stats)
│   ├── fpn_render.py             ← FPN matplotlib figure builders
│   ├── dof_analysis.py           ← DoF focus metrics + line/heatmap scan
│   ├── dof_render.py             ← DoF matplotlib figure builders
│   └── resolution.py             ← LEGACY: auto-strip FFT MTF (kept per D-0004)
├── scripts/
│   ├── inspect_recording.py      ← one-shot H5 inspector (stdout + preview PNG)
│   ├── run_usaf_resolution.py    ← legacy CLI pairing with mantisanalysis.resolution
│   ├── smoke_test.py             ← tiered smoke harness (--tier 0|1|2|3|4)
│   └── check_agent_docs.py       ← Tier-0 docs-consistency checker
├── tests/
│   ├── __init__.py
│   ├── conftest.py               ← Agg backend fixture + sys.path injection
│   ├── unit/
│   │   ├── test_usaf_lpmm.py
│   │   ├── test_bayer.py
│   │   ├── test_michelson.py
│   │   ├── test_dof_metrics.py
│   │   ├── test_fpn_math.py
│   │   ├── test_isp_modes.py     ← v1 ISP-mode registry + extraction
│   │   └── test_isp_override.py  ← ISP reconfigure path
│   ├── headless/
│   │   └── test_figures.py
│   └── web/                      ← Playwright smoke (opt-in via [web-smoke])
│       ├── conftest.py           ← session-scoped uvicorn fixture
│       └── test_web_boot.py      ← boots SPA, asserts React mount + 3 mode btns + ISP modes endpoint
├── docs/
│   └── validation/               ← B-0018 staging for real-sample captures (git-ignored contents)
│       └── README.md
├── web/                          ← React 18 SPA (CDN; no bundler)
│   ├── index.html                ← entry: React 18 + Babel standalone via CDN
│   └── src/
│       ├── shared.jsx            ← BRAND, THEMES, icons, hooks, Chart primitive,
│       │                            useChartGeom, tokens(), renderChartToPng,
│       │                            API helpers (apiFetch, apiUpload, channelPngUrl)
│       ├── app.jsx               ← root <App>, TopBar, StatusBar, ModeRail,
│       │                            CommandPalette (⌘K), HelpOverlay, AboutOverlay,
│       │                            TweaksPanel, theme/accent
│       ├── usaf.jsx              ← USAFMode — canvas + sidebars, line pick
│       ├── fpn.jsx               ← FPNMode — ROI drag, channel chips, live stats
│       ├── dof.jsx               ← DoFMode — probe points, focus lines, H/V refs, tilt
│       ├── analysis.jsx          ← AnalysisModal — per-mode tabs + CSV/PNG export
│       └── isp_settings.jsx      ← ISPSettingsModal — mode selector + geometry + per-channel config
└── outputs/                      ← generated artifacts (git-ignored)
    ├── smoke/                    ← PNGs from `smoke_test.py --tier 2`
    ├── web-smoke/                ← screenshots + traces from Playwright runs
    └── verify/                   ← ad-hoc screenshots from browser verification
```

## Entry points (confirmed by evidence)

| How you run it | What actually happens |
|---|---|
| `python -m mantisanalysis [path]` | `__main__.py` → `app.main` → uvicorn on `127.0.0.1:8765` + browser |
| `mantisanalysis [path]` *(pip install)* | `[project.scripts]` → `mantisanalysis.app:main_argv` |
| `uvicorn mantisanalysis.server:app` | bare ASGI runner for scripting / deployment testing |

All three reach the same FastAPI `app` at `mantisanalysis.server:app`.
The CLI adds browser auto-open and optional file pre-load; direct
uvicorn skips both.

## Where each analysis mode's UI lives

| Mode | Frontend component (React) | API routes | Analysis math | Figure builders |
|---|---|---|---|---|
| USAF | `web/src/usaf.jsx` | `/api/usaf/{measure,analyze}` | `mantisanalysis/usaf_groups.py` | `mantisanalysis/usaf_render.py:build_analysis_figures` |
| FPN | `web/src/fpn.jsx` | `/api/fpn/{compute,measure,measure_batch,stability,analyze}` | `mantisanalysis/fpn_analysis.py` | `mantisanalysis/fpn_render.py:build_{overview,rowcol,map,psd,autocorr,psd1d,hotpix}_fig` |
| DoF | `web/src/dof.jsx` | `/api/dof/{compute,stability,analyze}` | `mantisanalysis/dof_analysis.py` | `mantisanalysis/dof_render.py:build_{heatmap,line_scan,points,gaussian_fit,tilt_plane,metric_compare,chromatic_shift}_fig` |
| ISP | `web/src/isp_settings.jsx` | `/api/isp/modes`, `/api/sources/{id}/isp` (GET/PUT) | `mantisanalysis/isp_modes.py` | — (no per-mode figures; drives extraction geometry) |

## Where each dependency is declared

| Where | What |
|---|---|
| `pyproject.toml` `[project.dependencies]` | Canonical runtime deps — FastAPI, uvicorn, Pydantic, NumPy, SciPy, matplotlib, h5py, Pillow, tifffile, python-multipart |
| `pyproject.toml` `[project.optional-dependencies].dev` | `pytest`, `httpx`, `ruff`, `mypy` |
| `pyproject.toml` `[project.optional-dependencies].web-smoke` | `playwright`, `pytest-playwright` (opt-in) |
| `web/index.html` CDN `<script>` tags | React 18 + ReactDOM 18 + Babel standalone + dom-to-image-more |

## Where to look up a topic

| Topic | Primary source |
|---|---|
| Layered architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Exact commands | [`SETUP_AND_RUN.md`](SETUP_AND_RUN.md) |
| Verification ladder | [`QUALITY_GATES.md`](QUALITY_GATES.md) + [`UI_VERIFICATION.md`](UI_VERIFICATION.md) |
| When to stop | [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) |
| Per-change-class recipes | [`WORKFLOWS.md`](WORKFLOWS.md) + [`skills/`](skills/) |
| Specialist reviewers | [`agents/`](agents/) |
| Decisions | [`DECISIONS.md`](DECISIONS.md) |
| Risks | [`RISKS.md`](RISKS.md) |
| Open work | [`BACKLOG.md`](BACKLOG.md) |
| Live state | [`HANDOFF.md`](HANDOFF.md) |
| External refs (Anthropic, Playwright, WCAG) | [`REFERENCES.md`](REFERENCES.md) |
