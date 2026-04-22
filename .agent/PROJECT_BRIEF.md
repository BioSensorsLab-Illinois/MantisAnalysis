# PROJECT_BRIEF

## What

`MantisAnalysis` is a PySide6/Qt-6 desktop application that analyzes imaging
recordings produced by the lab's MantisCam camera stack, plus any generic
PNG / TIFF / JPG. It has three modes:

1. **USAF Resolution.** Pick profile lines across USAF-1951 chart bar
   groups. Compute Michelson contrast (percentile / min-max / FFT-at-
   fundamental estimators) vs lp/mm at the chart. Report per-channel
   detection limits using a first-dip-below-threshold rule. Six-tab
   analysis window: MTF curves, Profile gallery, Summary table,
   Detection heatmap, Group sweep, FFT / MTF.

2. **FPN Analysis.** Drag a rectangular ROI on the image. Optional ISP
   preprocessing (median, Gaussian, hot-pixel, bilateral). Percentile
   outlier mask with live red overlay. Five figure types: overview
   (image + FPN map + histogram + stat table), row & col profiles,
   2-D FPN map with marginals, 2-D FFT PSD, multi-channel comparison.
   Metrics: DSNU, PRNU, row σ, col σ, residual pixel σ.

3. **Depth of Field.** Pick focus probe points and/or focus-scan lines.
   Four focus metrics: variance of Laplacian, Brenner gradient,
   Tenengrad, and FFT high-frequency energy fraction. Five figures per
   channel: focus heatmap, line scan, picked points (with Z-vs-focus
   Gaussian fit when Z-calibrated), metric compare, channel compare.
   H/V reference-line calibration converts pixel distances to μm or
   mm.

## Why

BSL @ UIUC needs a single tool to characterize optical + sensor
performance of their MantisCam recordings before downstream biological
assays. Off-the-shelf tools don't support the GSense dual-gain 4×4
super-pixel layout. The code reproduces the camera's ISP channel-
extraction math (see `mantisanalysis/extract.py:25-26`).

## Who

- **Author**: Zhongmin Zhu (`j@polarxphotonics.com`).
- **Lab**: BioSensors Lab @ UIUC.
- **Users**: imaging engineers + bench scientists in the lab + external
  collaborators.

## Where

- Source: <https://github.com/BioSensorsLab-Illinois/MantisAnalysis>
- License: MIT
- Working tree on the author's workstation: `C:\Users\J\BioSensors-Lab\MantisAnalysis`

## Success criteria (today)

1. One-line install: `pip install -e .[dev]` succeeds on Python 3.10+.
2. One-line launch: `python -m mantisanalysis` opens the GUI; `File → Open` on a real lab recording produces expected analysis in all three modes.
3. `python scripts/smoke_test.py --tier 1` and `--tier 2` both exit 0.
4. `python -m pytest tests/ -q` is green.

## Out of scope (today)

- Real-time data acquisition (belongs to the separate MantisCamUnified repo).
- Online databases, telemetry, auto-update.
- Binary distribution (PyInstaller work is backlogged; not required yet).
- Cross-mode analytics (e.g., using USAF to calibrate DoF).
