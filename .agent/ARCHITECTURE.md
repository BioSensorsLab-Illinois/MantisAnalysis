# ARCHITECTURE

## Layered view

```
┌───────────────────────────────────────────────────────────────────┐
│ ENTRY                                                             │
│   mantisanalysis/__main__.py    — `python -m mantisanalysis`       │
│   mantisanalysis/app.py          — main() shim → pick_lines_gui    │
│   scripts/pick_lines_gui.py      — THE GUI module (MainWindow,     │
│                                     USAFPickerApp, themes, QSS)    │
│   MantisAnalysis.bat             — Windows double-click launcher   │
├───────────────────────────────────────────────────────────────────┤
│ MODES (QWidget pages in MainWindow.QStackedWidget)                 │
│   mantisanalysis/modes/fpn.py    — FPN UI                          │
│   mantisanalysis/modes/dof.py    — DoF UI (with calibration card) │
│   mantisanalysis/modes/common.py — Card / ImageCanvas / slider_row│
│                                     / ChannelSelector / stretch /  │
│                                     apply_transform                │
│   (USAF "mode" today lives inside scripts/pick_lines_gui.py as    │
│    USAFPickerApp; embedded via takeCentralWidget in MainWindow.   │
│    Backlog item: demote to QWidget under mantisanalysis/modes/.)   │
├───────────────────────────────────────────────────────────────────┤
│ FIGURE BUILDERS + ANALYSIS VIEWERS (Qt + matplotlib)              │
│   mantisanalysis/usaf_render.py  — 6-tab USAF analysis window      │
│   mantisanalysis/fpn_render.py   — FPN window + figures            │
│   mantisanalysis/dof_render.py   — DoF window + figures            │
├───────────────────────────────────────────────────────────────────┤
│ ANALYSIS MATH (pure NumPy / SciPy — NO Qt imports allowed here)    │
│   mantisanalysis/usaf_groups.py  — lp/mm table, line profile,      │
│                                     3 Michelson estimators         │
│   mantisanalysis/fpn_analysis.py — ISP filters, FPN stats          │
│   mantisanalysis/dof_analysis.py — 4 focus metrics + line/heatmap │
│   mantisanalysis/resolution.py   — legacy auto-strip FFT MTF       │
├───────────────────────────────────────────────────────────────────┤
│ IMAGE PIPELINE + I/O                                               │
│   mantisanalysis/image_processing.py — sharpen, B/C/γ, percentile  │
│   mantisanalysis/image_io.py        — unified load_any(path)       │
│   mantisanalysis/extract.py         — GSense dual-gain Bayer       │
│                                        (4×4 super-pixel)           │
└───────────────────────────────────────────────────────────────────┘
```

## Import graph (facts)

- `image_io` → `extract`.
- `usaf_render` → `image_io` (luminance helper), `usaf_groups`.
- `fpn_render` → `fpn_analysis`.
- `dof_render` → `dof_analysis`, `fpn_render` (*reaches for `_color`,
  `_ch`, `_style_axes` — coupling noted in RISKS*).
- `modes/fpn` → `fpn_analysis`, `fpn_render`, `modes/common`.
- `modes/dof` → `dof_analysis`, `dof_render`, `modes/common`.
- `scripts/pick_lines_gui.py` → `image_io`, `image_processing`,
  `usaf_groups`; lazy-imports `modes/fpn` and `modes/dof` in `MainWindow`.
- `mantisanalysis/app` → `pick_lines_gui` via a `sys.path` shim.

Acyclic.

## Runtime model

`main(argv)` at `scripts/pick_lines_gui.py:1906` creates a
`QApplication`, parses `--dark`/`--light`, calls `apply_theme()`,
instantiates `MainWindow`. `MainWindow.__init__` (line 1755) does the
following:

1. Constructs `USAFPickerApp(theme_name=...)` (line 1771). This object
   is still a `QMainWindow` subclass — a backlog item.
2. Steals its central widget with `.takeCentralWidget()` (line 1772).
3. Monkey-patches `usaf_app._update_status` (line 1779) and
   `usaf_app._do_open` (line 1791) to forward status into the new
   window's status bar and broadcast file-loads to FPN + DoF.
4. Lazy-imports `FPNMode` and `DoFMode`; instantiates them with a
   `theme_provider` lambda that returns `self.theme`.
5. Builds a `QStackedWidget` of [USAF central widget, FPN, DoF] as
   central widget of `MainWindow`.
6. Builds the mode toolbar (3 exclusive checkable actions) + menu bar
   (File, View, Mode, Help).

Shared state on `MainWindow`: `channel_images`, `attrs`,
`source_path`. Each mode reads via `self.app.channel_images` and
implements `on_file_loaded()` / `on_theme_changed()` hooks.

Analysis-window lifecycles: each mode's Run button constructs a new
non-modal `QMainWindow` child; MainWindow holds references to prevent
GC (`_analysis_windows` list).

## Key invariants

1. **GSense Bayer constants** `ORIGIN = (0, 0)` and
   `LOC = {B:(0,0), R:(0,1), G:(1,0), NIR:(1,1)}` at
   `mantisanalysis/extract.py:25-26` are locked to the physical lab
   setup. Do not change.
2. **USAF lp/mm table** follows `2^(group + (element-1)/6)` over groups
   0..5, elements 1..6 — verified in `tests/unit/test_usaf_lpmm.py`.
3. **Channel key schema** returned by `load_any()` is frozen:
   - H5 inputs → `{HG-R, HG-G, HG-B, HG-NIR, HG-Y, LG-R, LG-G, LG-B, LG-NIR, LG-Y}`.
   - RGB image inputs → `{R, G, B, Y}`.
   - Grayscale image inputs → `{L}`.
4. **Theme is a dict** mapping role names (`BG`, `SURFACE`, `TEXT`,
   `ACCENT`, ...) to hex strings. See `scripts/pick_lines_gui.py:70-109`
   for the two complete palettes.
5. **QScrollArea** in sidebars uses
   `setHorizontalScrollBarPolicy(ScrollBarAsNeeded)` +
   `setMinimumWidth(180)` + `body.setMinimumWidth(0)` to let the
   splitter shrink. Don't revert.
