# MantisAnalysis

[![smoke](https://img.shields.io/badge/smoke-tier1%2F2%2F3%20pass-brightgreen)](scripts/smoke_test.py)
[![python](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![stack](https://img.shields.io/badge/stack-FastAPI%20%C2%B7%20React%2018-blue)](web/)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Browser-based analysis suite for **MantisCam GSense BSI dual-gain RGB-NIR**
recordings, plus generic PNG / TIFF / JPG images. A local FastAPI server
wraps pure-NumPy / SciPy analysis; a React single-page app in `web/` is the
UI. Three modes:

| Mode | What it does |
|---|---|
| **USAF Resolution** | Pick profile lines across USAF-1951 chart bar groups; per-line Michelson contrast (percentile / FFT / min-max) and per-channel detection limit are computed server-side. Six-tab analysis window. |
| **FPN Analysis** | Drag a rectangular ROI on any channel; live DSNU / PRNU / row-σ / col-σ / residual-σ updates from the server on every ROI / ISP / channel change. Four figure types per channel. |
| **Depth of Field** | Drop focus probe points or draw scan lines; four focus metrics (variance of Laplacian, Brenner, Tenengrad, FFT-HF). Optional H/V reference-length calibration converts all readouts to μm / mm / cm. |

Designed by **Zhongmin Zhu** (`j@polarxphotonics.com`) — **BioSensors Lab @ UIUC**.
Released under the [MIT License](LICENSE).

---

## Install

Requires **Python 3.10+** on Windows / macOS / Linux.

```bash
git clone https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git
cd MantisAnalysis
python -m pip install -e .
```

For development (pytest + ruff + mypy + httpx):

```bash
python -m pip install -e .[dev]
```

No Node / npm — the frontend is React 18 + Babel standalone, loaded from CDN by `web/index.html` and transpiled in the browser. No build step.

## Run

### Standalone executable — no Python install required

Pre-built, dependency-free binaries are published from every `main` push and attached to each tag release:

- **Windows** — download `MantisAnalysis-windows-x86_64.zip` from the
  [Releases page](https://github.com/BioSensorsLab-Illinois/MantisAnalysis/releases),
  extract, and double-click `MantisAnalysis.exe`.
- **macOS (Apple Silicon / Intel)** — download the matching
  `MantisAnalysis-macos-<arch>.tar.gz`, double-click to extract, then right-click
  `MantisAnalysis.app` → **Open** → **Open** (Gatekeeper's unsigned-binary
  prompt, once).

A console window shows the local server log; your browser opens to
`http://127.0.0.1:8765/`. Closing the console stops the server.

Build the executable yourself with `python packaging/build.py` — see
[`packaging/README.md`](packaging/README.md).

### Double-click with your own Python (developer shortcut)

- **macOS**: double-click [`MantisAnalysis.command`](MantisAnalysis.command) in Finder. If Gatekeeper blocks the first launch, right-click → **Open** once.
- **Windows**: double-click [`MantisAnalysis.bat`](MantisAnalysis.bat) in Explorer.

Either launcher detects your Python, runs `pip install -e .` the first time if the package is not yet installed, then starts the server and opens your default browser. Close the terminal window or press <kbd>Ctrl</kbd>-<kbd>C</kbd> to stop.

### From a shell

```bash
mantisanalysis                                  # starts server + opens browser
python -m mantisanalysis                        # same thing, without pip install
python -m mantisanalysis path/to/recording.h5   # preload a file
python -m mantisanalysis --no-browser           # server only
python -m mantisanalysis --port 9001            # custom port
```

The server binds `http://127.0.0.1:8765` by default and serves the `web/` tree at the root. `python -m mantisanalysis` waits for the port, then opens your default browser.

### Or use any HTTP client / Swagger

Interactive API docs: `http://127.0.0.1:8765/api/docs` (FastAPI auto-generated).

Example curl round-trip:

```bash
curl http://127.0.0.1:8765/api/health
curl -X POST http://127.0.0.1:8765/api/sources/load-sample
curl -X POST http://127.0.0.1:8765/api/usaf/measure \
  -H 'content-type: application/json' \
  -d '{"source_id":"<id>","channel":"HG-G","line":{"group":2,"element":3,"direction":"H","p0":[80,80],"p1":[150,80]}}'
```

## Channel layout (GSense dual-gain)

The GSense dual-gain frame is `(H, 2·W)` uint16 with the **left half =
high gain**, **right half = low gain**. Each half holds a 4×4 super-pixel
mosaic. The Bayer extraction follows the lab's MantisCam ISP exactly:

| Channel | `loc` (row, col) in 2×2 cell | origin | Pixel offset in 4×4 super-pixel |
|---|---|---|---|
| B   | (0, 0) | (0, 0) | `[0::4, 0::4]` |
| R   | (0, 1) | (0, 0) | `[0::4, 2::4]` |
| G   | (1, 0) | (0, 0) | `[2::4, 0::4]` |
| NIR | (1, 1) | (0, 0) | `[2::4, 2::4]` |

After extraction every per-channel image is `(H/4, W/4)` — for the 2048×2048 half-frame, 512×512 per channel. Per-channel Nyquist is **0.5 cy/channel-pixel = 0.125 cy/sensor-pixel**.

## USAF lp/mm reference (groups 0–5)

| Group | E1 | E2 | E3 | E4 | E5 | E6 |
|------:|---:|---:|---:|---:|---:|---:|
| 0 | 1.00 | 1.12 | 1.26 | 1.41 | 1.59 | 1.78 |
| 1 | 2.00 | 2.24 | 2.52 | 2.83 | 3.17 | 3.56 |
| 2 | 4.00 | 4.49 | 5.04 | 5.66 | 6.35 | 7.13 |
| 3 | 8.00 | 8.98 | 10.10 | 11.30 | 12.70 | 14.30 |
| 4 | 16.00 | 17.96 | 20.16 | 22.63 | 25.40 | 28.51 |
| 5 | 32.00 | 35.92 | 40.32 | 45.25 | 50.80 | 57.02 |

`lp/mm = 2^(group + (element-1)/6)`.

## Architecture

```
Browser (web/)                    FastAPI server (mantisanalysis/server.py)
┌────────────────────┐  HTTP      ┌──────────────────────────────────────┐
│ React 18 SPA       │ ─────────► │ /api/sources/{upload,load-sample,..} │
│ · USAF / FPN / DoF │            │ /api/sources/<id>/channel/../thumb   │
│   mode panes       │            │ /api/usaf/{measure,analyze}          │
│ · Canvas overlays  │            │ /api/fpn/{compute,analyze}           │
│ · ⌘K palette       │            │ /api/dof/{compute,analyze}           │
│ · Live stats from  │            └──────────┬───────────────────────────┘
│   server           │                       │
└────────────────────┘                       ▼
                              ┌──────────────────────────────────────┐
                              │ Pure NumPy / SciPy analysis          │
                              │ · extract.py (Bayer, GSense)         │
                              │ · image_io.py (H5 + PNG/TIFF/JPG)    │
                              │ · usaf_groups.py (Michelson, FFT)    │
                              │ · fpn_analysis.py (DSNU, PRNU, …)    │
                              │ · dof_analysis.py (4 focus metrics)  │
                              │ · figures.py → matplotlib PNGs       │
                              └──────────────────────────────────────┘
```

The analysis math layer stays Qt-free and pure NumPy / SciPy — the smoke gate and pytest suite both drive it headlessly. The FastAPI layer is a thin JSON + PNG adapter.

## Smoke gates

```bash
python scripts/smoke_test.py --tier 1   # imports
python scripts/smoke_test.py --tier 2   # headless figure builders (Agg)
python scripts/smoke_test.py --tier 3   # FastAPI endpoints (TestClient)
```

All three are mandatory before claiming any non-doc change complete. Tier 3 boots the ASGI app in-process (no external uvicorn) and exercises health + sample load + thumbnail + USAF measure + FPN compute + DoF compute. See [`.agent/QUALITY_GATES.md`](.agent/QUALITY_GATES.md).

## Repository structure

```
MantisAnalysis/
├── mantisanalysis/          ← Python package (analysis math + FastAPI server)
│   ├── extract.py           ← GSense Bayer extractor (constants locked)
│   ├── image_io.py          ← load_any: H5 + PNG/TIFF/JPG
│   ├── usaf_groups.py       ← lp/mm, LineSpec, Michelson (3 flavors)
│   ├── fpn_analysis.py      ← ISP + FPN stats + percentile mask
│   ├── dof_analysis.py      ← 4 focus metrics + heatmap + calibration
│   ├── image_processing.py  ← sharpen / tone / percentile clip
│   ├── {usaf,fpn,dof}_render.py  ← matplotlib figure builders
│   ├── figures.py           ← PNG byte serializer over render modules
│   ├── server.py            ← FastAPI app + JSON schemas
│   ├── session.py           ← in-memory source store (LRU)
│   ├── app.py               ← `mantisanalysis` CLI → uvicorn + browser
│   └── __main__.py          ← `python -m mantisanalysis`
├── web/                     ← React 18 SPA (CDN; no toolchain)
│   ├── index.html
│   └── src/{shared,app,usaf,fpn,dof,analysis}.jsx
├── scripts/
│   ├── inspect_recording.py ← one-shot H5 inspector
│   ├── run_usaf_resolution.py  ← legacy Workflow A CLI
│   └── smoke_test.py        ← tiered smoke harness
├── packaging/               ← PyInstaller spec + standalone-exe build
│   ├── entry.py
│   ├── mantisanalysis.spec
│   ├── build.py
│   ├── smoke_frozen.py
│   └── README.md
├── tests/                   ← unit + headless
├── .agent/                  ← agent operating layer
├── .github/
│   ├── workflows/           ← CI (smoke, release, auto-fix)
│   └── auto-fix/            ← Claude-powered CI repair bot
├── pyproject.toml
├── README.md
└── LICENSE                  ← MIT
```

## Caveats

- HG can be heavily saturated near bright targets — Michelson contrast collapses to ≈ 0 once both bar and gap are clipped. Use LG for the resolvable-element verdict.
- The auto-strip FFT MTF (`scripts/run_usaf_resolution.py`) is a rigorous estimator of the system spatial-content envelope, not a formal optical-MTF measurement (which would require a slanted-edge target, ISO 12233).
- USAF Michelson is a per-element, per-direction estimate; lines for high-frequency elements must span all 3 bars cleanly, which becomes hard when the bars are sub-pixel-period in the per-channel image (Nyquist = 0.5 cy/channel-pixel).

## Contributing / agent workflow

This repo ships with a `.agent/` operating layer. Start at [`.agent/00_START_HERE.md`](.agent/00_START_HERE.md), then read [`.agent/AGENT_RULES.md`](.agent/AGENT_RULES.md) and [`.agent/ARCHITECTURE.md`](.agent/ARCHITECTURE.md).

## License + attribution

```
MIT License — Copyright (c) 2026 Zhongmin Zhu — BioSensors Lab @ UIUC
```

See [`LICENSE`](LICENSE) for the full text.
