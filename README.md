# MantisAnalysis

[![smoke](https://img.shields.io/badge/smoke-tier1%2F2%20pass-brightgreen)](scripts/smoke_test.py)
[![tests](https://img.shields.io/badge/pytest-39%20passed-brightgreen)](tests/)
[![python](https://img.shields.io/badge/python-3.10%2B-blue)](pyproject.toml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Desktop analysis suite for **MantisCam GSense BSI dual-gain RGB-NIR** recordings,
plus generic PNG / TIFF / JPG images. Three modes:

| Mode | What it does |
|---|---|
| **USAF Resolution** | Pick profile lines across USAF-1951 chart bar groups; report Michelson contrast vs lp/mm and per-channel detection limits. Six-tab analysis window: MTF curves · Profile gallery · Summary table · Detection heatmap · Group sweep · FFT/MTF. |
| **FPN Analysis** | Drag a rectangular ROI; optional ISP (median, Gaussian, hot-pixel, bilateral); percentile outlier mask with live red overlay; DSNU / PRNU / row σ / col σ / residual σ. Five figure types per channel. |
| **Depth of Field** | Pick focus probe points or scan lines on a DoF target; choose from four focus metrics (variance of Laplacian, Brenner, Tenengrad, FFT-HF energy); H/V reference-line calibration converts pixel distances to μm or mm. Five figure types per channel. |

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

For development (pytest + ruff + mypy + pytest-qt):

```bash
python -m pip install -e .[dev]
```

## Run

```bash
python -m mantisanalysis                        # opens GUI; use File → Open
python -m mantisanalysis path/to/recording.h5   # open immediately
python -m mantisanalysis --dark path/to/file    # dark theme
```

Equivalent direct invocations:

```bash
python scripts/pick_lines_gui.py [path]         # legacy direct entry
mantisanalysis [path]                           # if pip-installed
```

Windows users can also double-click `MantisAnalysis.bat`.

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

After extraction every per-channel image is `(H/4, W/4)` — for the
2048×2048 half-frame, 512×512 per channel. Per-channel Nyquist is **0.5
cy/channel-pixel = 0.125 cy/sensor-pixel**.

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

## Two analysis workflows

### A. Auto FFT line-profile MTF *(legacy CLI)*

```bash
python scripts/run_usaf_resolution.py "path/to/h5" [out-dir]
```

Generates per-gain panel + overlay + HG-vs-LG summary figures using a
horizontal and vertical strip auto-placed at the row/column of strongest
periodic content. Orthogonal to the GUI.

### B. Interactive USAF per-element picking *(default workflow in the GUI)*

Pick lines through specific USAF elements; the analysis window reports
Michelson contrast vs lp/mm with the first-dip detection limit per
channel, in three measurement-method flavors (percentile / FFT @
fundamental / peak-to-peak).

## Test + lint

```bash
python -m pytest tests/ -q              # 39 tests, ~0.7 s
python -m ruff check mantisanalysis scripts tests
python -m ruff format mantisanalysis scripts tests
python -m mypy mantisanalysis           # progressive
```

## Smoke gates

```bash
python scripts/smoke_test.py --tier 1   # imports only
python scripts/smoke_test.py --tier 2   # headless figure builders
python scripts/smoke_test.py --tier 3   # Qt boot (needs display)
```

Tiers 1 + 2 are mandatory before claiming any non-doc change complete.
Both run in CI on every push (Linux / macOS / Windows × Python
3.10–3.13). See [`.agent/QUALITY_GATES.md`](.agent/QUALITY_GATES.md).

## Repository structure

```
MantisAnalysis/
├── mantisanalysis/          ← Python package (analysis math + figures + UI modes)
├── scripts/                 ← entry points + smoke harness
├── tests/                   ← unit + headless test suites
├── .agent/                  ← agent operating layer (start here for AI work)
├── .github/workflows/       ← CI
├── pyproject.toml           ← packaging + tool configs
├── README.md                ← this file
├── UI_SPEC.md               ← long UX spec (for design / UI rework)
└── LICENSE                  ← MIT
```

For deeper architecture see [`.agent/ARCHITECTURE.md`](.agent/ARCHITECTURE.md)
and [`.agent/REPO_MAP.md`](.agent/REPO_MAP.md).

## Contributing / agent workflow

This repo ships with a `.agent/` operating layer. Coding agents
(Claude Code, Cursor, etc.) should start at
[`.agent/00_START_HERE.md`](.agent/00_START_HERE.md). Human contributors
working with an agent should read the same file plus
[`.agent/AGENT_RULES.md`](.agent/AGENT_RULES.md).

## Caveats

- HG can be heavily saturated near bright targets — Michelson contrast
  collapses to ≈ 0 once both bar and gap are clipped. Use LG for the
  resolvable-element verdict.
- The auto-strip FFT MTF (Workflow A) is a rigorous estimator of the
  system spatial-content envelope, not a formal optical-MTF measurement
  (which would require a slanted-edge target, ISO 12233).
- USAF Michelson in the interactive picker is a per-element,
  per-direction estimate; lines for high-frequency elements must span
  all 3 bars cleanly, which becomes hard when the bars are sub-pixel-
  period in the per-channel image (Nyquist = 0.5 cy/channel-pixel).

## License + attribution

```
MIT License — Copyright (c) 2026 Zhongmin Zhu — BioSensors Lab @ UIUC
```

See [`LICENSE`](LICENSE) for the full text.
