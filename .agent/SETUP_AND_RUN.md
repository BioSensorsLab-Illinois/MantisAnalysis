# SETUP_AND_RUN

Exact commands. Copy-paste, don't paraphrase.

## Supported platforms

- Windows 10/11, macOS 12+, Linux (X11 or Wayland with XWayland).
- Python **3.10, 3.11, 3.12, 3.13** (tested on 3.13 in this repo).
- PySide6 ≥ 6.5.

## First-time install (end user)

```bash
git clone https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git
cd MantisAnalysis
python -m pip install -e .
python -m mantisanalysis
```

The last line opens the GUI with no file loaded. Use **File → Open** to
load a MantisCam raw-H5 recording or any PNG / TIFF / JPG.

## First-time install (developer)

```bash
git clone https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git
cd MantisAnalysis
python -m venv .venv                  # optional but recommended
source .venv/bin/activate             # macOS / Linux
# or: .\.venv\Scripts\activate        # Windows PowerShell

python -m pip install -e .[dev]       # installs runtime + pytest, ruff, mypy, pytest-qt
```

## Run

```bash
# With or without a file path argument:
python -m mantisanalysis
python -m mantisanalysis "path/to/recording.h5"
python -m mantisanalysis --dark "path/to/image.png"

# Legacy direct entry (identical behavior):
python scripts/pick_lines_gui.py "path/to/recording.h5"

# Windows double-click:
MantisAnalysis.bat
```

## Run the legacy Workflow A CLI (auto-strip FFT MTF)

```bash
python scripts/run_usaf_resolution.py "path/to/h5" [out-dir]
```

This is orthogonal to the GUI and produces per-gain panel + overlay +
summary PNGs. Decision re: long-term fate is pending — see
`.agent/DECISIONS.md` D-0004.

## Inspect a recording

```bash
python scripts/inspect_recording.py "path/to/h5" [out-dir]
```

Dumps metadata to stdout + writes a preview PNG of HG/LG × R/G/B with a
composite.

## Test commands

```bash
# Pure unit tests (no display, no Qt):
python -m pytest tests/unit/ -q

# Headless figure-builder tests:
python -m pytest tests/headless/ -q

# All tests:
python -m pytest tests/ -q
```

## Smoke tiers

The blessed gate before claiming any non-doc change complete. Tiers 1+2
are mandatory; Tier 3 when display is available; Tier 4 is a placeholder.

```bash
python scripts/smoke_test.py --tier 1    # imports only, ~1 s, no display
python scripts/smoke_test.py --tier 2    # headless figures, ~3-5 s, no display
python scripts/smoke_test.py --tier 3    # Qt boot (opens window briefly), needs display
python scripts/smoke_test.py --tier 4    # NOT IMPLEMENTED yet (see BACKLOG)
```

Tier 2 writes sample figure PNGs into `outputs/smoke/`.

## Lint, format, type-check

```bash
python -m ruff check mantisanalysis scripts tests
python -m ruff format mantisanalysis scripts tests   # auto-format
python -m mypy mantisanalysis                         # progressive; expect warnings
```

Ruff config is conservative (see `pyproject.toml [tool.ruff]`) — it
does not auto-refactor existing code style.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ModuleNotFoundError: No module named 'mantisanalysis'` when running `python -m mantisanalysis` | You are not in the repo root; `cd` into `MantisAnalysis/`, or `pip install -e .`. |
| Sidebar content overflows the window | Resize: the splitter is draggable; or report a regression of the Tier-3 fix recorded in `DECISIONS.md`. |
| PySide6 errors about plugin loading on Linux | `apt install libxcb-cursor0 libxcb-xinerama0`. |
| `qt.qpa.plugin: Could not find the Qt platform plugin` | Reinstall PySide6: `pip install --force-reinstall PySide6`. |
| Tier-2 smoke writes but images look empty | Check matplotlib version ≥ 3.7. |
