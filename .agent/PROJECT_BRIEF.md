# PROJECT_BRIEF

## What

`MantisAnalysis` is a browser-based analysis suite built on **FastAPI
+ React 18**. A local FastAPI server wraps pure-NumPy / SciPy analysis
and serves a single-page React app; the CLI `python -m mantisanalysis`
boots the server and opens the user's default browser. Post
[D-0009](DECISIONS.md) the app is browser-first; the original PyQt
desktop layer is gone.

It analyzes imaging recordings from the lab's MantisCam camera stack
(GSense BSI dual-gain RGB-NIR) plus any generic PNG / TIFF / JPG. Three
analysis modes are live:

1. **USAF Resolution.** Pick profile lines across USAF-1951 chart bar
   groups. Michelson contrast (percentile / min-max / FFT-at-
   fundamental) vs lp/mm at the chart. Per-channel detection limit
   using first-dip-below-threshold. Six-tab analysis modal: MTF
   curves, Profile gallery, Summary table, Detection heatmap, Group
   sweep, FFT / MTF.

2. **FPN Analysis.** Drag a rectangular ROI on any channel. Optional
   ISP preprocessing (median, Gaussian, hot-pixel, bilateral).
   Percentile outlier mask with live red overlay. Per-ROI figures:
   overview (image + FPN map + histogram + stat table), row + col
   profiles, 2-D FPN map with marginals, 2-D FFT PSD, 1-D PSD, auto-
   correlation, hot-pixel chart. Metrics: DSNU, PRNU, row σ, col σ,
   residual pixel σ, mean signal, hot / cold counts, row/col peak
   frequency.

3. **Depth of Field.** Drop focus probe points and / or draw focus-
   scan lines. Four focus metrics: variance of Laplacian, Brenner
   gradient, Tenengrad, FFT high-frequency energy fraction. Seven-tab
   analysis modal: focus heatmap, line scan, picked points, Gaussian
   fit, tilt-plane / field-curvature, metric compare, chromatic
   shift. H/V reference-line calibration converts pixel distances to
   μm / mm / cm. Target-tilt correction via user-input angle.

All numbers on screen originate server-side — the React layer renders
them but does not compute Michelson / DSNU / focus values itself.

## Why

BSL @ UIUC needs a single tool to characterize optical + sensor
performance of MantisCam recordings before downstream biological
assays. Off-the-shelf tools don't support the GSense dual-gain 4×4
super-pixel layout. The code reproduces the camera's ISP channel-
extraction math exactly — see
[`mantisanalysis/extract.py:25-26`](../mantisanalysis/extract.py).

## Who

- **Author**: Zhongmin Zhu (`j@polarxphotonics.com`).
- **Lab**: BioSensors Lab @ UIUC.
- **Users**: imaging engineers + bench scientists in the lab +
  external collaborators.

## Where

- Source: <https://github.com/BioSensorsLab-Illinois/MantisAnalysis>
- License: MIT
- Working tree: `~/BSL/MantisAnalysis` on the author's workstation.

## Stack

- **Backend**: FastAPI 0.110+ + uvicorn, Pydantic 2.5+.
- **Analysis math**: NumPy, SciPy (pure — no GUI imports).
- **Figures**: matplotlib (server-rendered PNGs for export).
- **Frontend**: React 18 + Babel standalone, loaded from CDN.
  No bundler — `web/index.html` is the entry. `B-0014` tracks the
  future Vite migration decision.
- **Testing**: pytest (unit + headless + FastAPI TestClient), opt-in
  Playwright for browser smoke.

## Runtime

```
python -m mantisanalysis          # starts uvicorn at 127.0.0.1:8765 + opens browser
python -m mantisanalysis --no-browser
python -m mantisanalysis --port 9001
python -m mantisanalysis path/to/recording.h5
```

Details: [`SETUP_AND_RUN.md`](SETUP_AND_RUN.md).

## Success criteria (today)

1. One-line install: `pip install -e .[dev]` succeeds on Python 3.10+.
2. One-line launch: `python -m mantisanalysis` boots the server,
   opens the browser, renders the three mode rail buttons.
3. `python scripts/smoke_test.py --tier 0` + `--tier 1` + `--tier 2`
   + `--tier 3` all exit 0.
4. `python -m pytest -q` is green (40+ tests).

## Out of scope (today)

- Real-time data acquisition (belongs to the separate
  MantisCamUnified repo).
- Multi-user / online / telemetry.
- Binary distribution (PyInstaller — backlogged; not required yet).
- Cross-mode analytics (e.g., using USAF to calibrate DoF).

## The one invariant every agent must remember

Per [`AGENT_RULES.md`](AGENT_RULES.md):

- GSense Bayer constants at `mantisanalysis/extract.py:25-26` are
  locked. Channel key names are locked. Analysis-math modules stay
  pure NumPy / SciPy with no UI / server imports.
