# BACKLOG

Explicit work that remains. Ordered by impact + readiness. Each item
has a unique `B-000N` ID. Append-only; do not renumber.

---

## B-0017 — DoF mode rewrite (same treatment as FPN) — **CLOSED 2026-04-22**

**Completed** under `.agent/runs/dof-rewrite-v1/`. DoF now has:

- Rulers + zoom-to-cursor + pan + rotation + keyboard shortcuts.
- Sortable points + lines tables with rename / multi-select / CSV export.
- Display colormap / B/C/γ, ISP card, save/load JSON config.
- Live per-channel focus compute with Gaussian fit overlay.
- Research extras: 4-metric parallel sweep, bootstrap 95% CI,
  tilt-plane / field-curvature fit, DoF-width stability curve,
  chromatic-focus-shift quantification.
- 7-tab native-vector analysis modal.

All three mode rewrites now shipped (USAF / FPN / DoF).

---

## B-0019 — Finish per-chart plotStyle refactor — **CLOSED 2026-04-23**

Done in `backlog-cleanup-v1`. All ~85 hardcoded `fontSize={N}` /
`strokeWidth={N}` / `fontFamily="ui-monospace,..."` literals in
`web/src/analysis.jsx` chart components are replaced with
`scaled(N, style)` / `style.lineWidth` / `style.gridWidth` /
`style.axisStrokeWidth` / `style.markerStrokeWidth`. `MiniMTFChart`'s
draw-style prop was renamed from `style` to `drawStyle` to disambiguate
from the plotStyle context. Browser-verified: bumping
`elementScale=1.5` + `lineWidth=3.5` in localStorage now flows into all
inline SVG charts.

---

## B-0019 (orig) — Finish per-chart plotStyle refactor (size / weight / line / marker)

**Why**: `analysis-polish-v1` shipped the infrastructure (context +
primitives + panel) and wired font-family via CSS cascade across every
modal. But ~80 inline `fontSize={N}` / `strokeWidth={N}` / `fontFamily=
"ui-monospace,Menlo,monospace"` literals remain in the chart
components, so title/axis/tick/legend size sliders + line/marker
sliders + palette don't move those charts yet.

**Scope** — touch `MiniMTFChart`, `ProfileCard`, `GroupMiniChart`,
`FFTSpectraGrid`, `RowColCard`, `PSD1DChart`, `MetricBars`,
`LineOverlayChart`, `MetricOverlayChart`, `ChromaticShiftChart`,
`PointsBarChart`, `StabilityChart` (all in `web/src/analysis.jsx`).
Replace each hardcoded `fontSize={N}` with `fontSize={scaled(N,
style)}` using `const { style } = usePlotStyle();` at component top;
replace hardcoded stroke constants with `style.lineWidth` /
`style.gridWidth` / `style.axisStrokeWidth`; remove hardcoded
`fontFamily="ui-monospace,Menlo,monospace"` so modal-root cascade wins
(or replace with `fontFamily={style.fontFamily}` for explicit).

**Estimated effort**: ~1-2 long sessions. Batch this as a refactor-
only initiative; no user-visible behavior change except sliders now
bite everywhere.

---

## B-0020 — DoF analysis modal: unit selector (px / µm / mm / cm) — **CLOSED 2026-04-23**

Done in `backlog-cleanup-v1`. A `Unit` segmented control (Auto / px /
µm / mm / cm) lives on the DoF modal's filter bar. Default "Auto"
preserves the prior behavior (use whichever unit the line was
calibrated in on the picker). Explicit px / µm / mm / cm routes every
formatter through a new `dofFmt(ln, px, pref, digits)` + helpers
(`dofDisplayUnit`, `dofToDisplay`, `dofIsCalibrated`,
`DOF_UNIT_IN_UM`). When the user picks a non-px unit without any
calibrated line, a small "calibration missing" hint shows in the
filter bar and values fall back to px. Browser-verified: flipping Unit
from Auto → px changed Summary table header + cells as expected.

---

## B-0020 (orig) — DoF analysis modal: unit selector (px / µm / mm / cm)

**Why**: Today the analysis modal shows distances in pixels when no
calibration was set on the picker. Users want to pick a result unit
directly in the modal.

**Scope** — add a Unit segmented control (px / µm / mm / cm) to the
DoF modal filter bar. When the user picks a non-px unit without an
active calibration, either (a) inline-prompt "assume N px = 1 µm" and
propagate, or (b) fall back to px with a "calibration missing" hint.
When calibration exists, reuse `ln.px_per_unit` / `ln.unit_name` and
convert to the chosen unit via the µm common base. Summary table,
Line scans, Metric compare, Chromatic shift, Points tab all need to
route their formatters through a single `dofFmt(ln, px, unit)`.

**Estimated effort**: ~half session. Mostly modal UI + a helper.

---

## B-0021 — DoF target-tilt correction — **CLOSED 2026-04-23**

Done in `backlog-cleanup-v1`. Picker side: new "Target tilt (°)"
slider in the Research-extras card, persisted at `dof/tiltAngleDeg`,
disabled until the picker has a horizontal or vertical calibration
reference. Value propagates to the analysis run payload as
`tilt_angle_deg`. Modal side: `tiltFactor = 1 / cos(θ·π/180)` multiplies
every displayed peak / σ / FWHM / DoF width; CSV + JSON exports carry
both the raw-px columns and the active tilt angle / factor for
traceability. Header gets a `(tilt-corrected θ=XX°, ×Y.YYY)` suffix so
pre- and post-correction numbers are never confused. The modal also
exposes a live °-input so the user can sweep θ without re-running the
pipeline. Clamped to [0, 89]°. Browser-verified at θ=45°: peak
−1.82 px → −2.57 px, σ 1.50 → 2.13, FWHM 3.54 → 5.00 — matches
1/cos(45°) = √2 within rounding.

---

## B-0021 (orig) — DoF target-tilt correction

**Why**: Using a tilted DoF target (e.g. Edmund 5-15) means the
image-plane DoF is the projection of the actual sample-plane DoF by
`cos(θ)`. Let users enter a target-tilt angle in degrees; apply
`1 / cos(θ)` correction to every reported peak / σ / FWHM / DoF-width
across the DoF analysis modal so the numbers match the physical
sample-plane values.

**Scope**:
1. Add a "Target tilt (°)" input to the DoF picker (right panel),
   persisted at `dof/tiltAngleDeg`.
2. Pass through the analysis run payload as `run.tilt_angle_deg`.
3. In the DoF analysis modal: if `tilt_angle_deg > 0`, multiply every
   peak position, σ, FWHM, DoF width shown to the user by
   `1 / cos(tilt_angle_deg * π / 180)`. Show "(tilt-corrected θ=XX°)"
   suffix on the modal header so nobody misreads pre-correction vs
   post-correction numbers.
4. Add a live "Tilt angle" control in the DoF modal so the user can
   re-apply / explore different angles without re-running the full
   pipeline.

**Edge cases**: θ → 90° diverges; clamp to [0, 89]. Disable when no
calibration (doesn't make physical sense to correct pixel distances).

**Estimated effort**: ~half session.

---

## B-0018 — Real-sample validation sweep — **BLOCKED on captures**

Scaffolding staged in `docs/validation/README.md` during
`backlog-cleanup-v1`: describes the three required recordings (USAF
1951, flat-field, tilted Edmund 5-15) and the per-recording notes
format. Actual validation remains open until real MantisCam H5
captures are acquired — not something the agent can do
autonomously. Reopen the active state once the files are in
`outputs/validation/`.

---

## B-0018 (orig) — Real-sample validation sweep

**Why**: The trio (USAF / FPN / DoF) has been tested against the
synthetic USAF sample but not yet a real MantisCam H5 recording nor a
tilted Edmund DoF chart. Before declaring the bench "done", run:

1. A USAF 1951 chart recording through USAF mode; confirm
   MTF-at-threshold matches historical measurement.
2. A flat-field (no target) recording through FPN mode; confirm
   DSNU / PRNU against prior Python-CLI numbers.
3. A tilted Edmund DoF chart through DoF mode; confirm the Gaussian
   FWHM matches manual inspection of the focus-sweep images.

**Steps**: capture representative recordings; drop them in
`outputs/validation/` (gitignored); record results in a
`docs/validation/` markdown. When all three agree with reference, mark
the rewrite trio GA.

---

## B-0001 — Move `scripts/pick_lines_gui.py` → `mantisanalysis/app.py` — **CLOSED 2026-04-23**

Obsolete: `scripts/pick_lines_gui.py` was deleted in D-0009 (Qt GUI
removal). `mantisanalysis/app.py` is now the real CLI entry (uvicorn +
browser) rather than a shim.

---

## B-0001 (orig) — Move `scripts/pick_lines_gui.py` → `mantisanalysis/app.py` (the real move, not a shim)

**Why**: cleaner package; `python -m mantisanalysis` no longer needs
`sys.path` gymnastics; better discoverability; pytest collection won't
need a separate `scripts/` shim.

**Risk**: 1936 LoC move; many imports inside the file reference
neighbours via `from mantisanalysis.X` already (so they survive the
move). Only `app.py` shim and `MantisAnalysis.bat` need updates.

**Steps**:
1. `git mv scripts/pick_lines_gui.py mantisanalysis/app.py` (rename the
   file; replace the existing thin shim).
2. Move the contents in.
3. Update `mantisanalysis/__main__.py` to `from .app import main`.
4. Update `MantisAnalysis.bat` (already calls `python -m mantisanalysis`,
   so OK).
5. Tier 1 + Tier 2 + Tier 3 smoke.
6. Update `ARCHITECTURE.md` + `REPO_MAP.md`.

**Out**: this becomes a 1-session initiative under
`.agent/runs/move-app/`.

---

## B-0002 — Deduplicate Qt widget classes — **CLOSED 2026-04-23**

Obsolete: Qt desktop surface removed in D-0009. All shared UI primitives
now live in `web/src/shared.jsx` (React).

---

## B-0002 (orig) — Deduplicate widget classes (`Card`, `ImageCanvas`, `slider_row`, `apply_transform`)

**Why**: Risk R-0001. Two parallel implementations drift silently.

**Steps**:
1. Make `mantisanalysis/widgets/` package with one file per widget.
2. Re-export from `mantisanalysis/modes/common.py` for back-compat.
3. Replace local definitions in `pick_lines_gui.py` with imports.
4. Tier 3 smoke + visual check (sidebars, canvas mouse events).

**Estimated effort**: ~1 session.

---

## B-0003 — Demote `USAFPickerApp(QMainWindow)` — **CLOSED 2026-04-23**

Obsolete: Qt desktop surface removed in D-0009. `USAFMode` is now a
React component in `web/src/usaf.jsx` rendered inside the single-page
app shell; no QMainWindow / monkey-patching remains.

---

## B-0003 (orig) — Demote `USAFPickerApp(QMainWindow)` to `USAFMode(QWidget)`

**Why**: Risk R-0003. Removes the `takeCentralWidget` +
monkey-patching gymnastics in `MainWindow`.

**Steps**:
1. After B-0002, change inheritance to `QWidget`.
2. Replace `self.statusBar()` calls with a Qt signal emitted to
   `MainWindow`.
3. Replace `self.menuBar()` with a method that returns menu actions
   for `MainWindow` to install.
4. Promote `_do_open` and `_update_status` to a clean public API.
5. Tier 3 smoke + functional verification of every menu/file
   interaction.

**Estimated effort**: ~1 session.

---

## B-0004 — Sub-package by concern — **CLOSED 2026-04-23**

Obsolete: original scope was to split Qt-era `modes/*` into
`logic/render/ui` triplets. Qt was removed in D-0009 and
`mantisanalysis/modes/*` is gone; the remaining package has a clean
layer split already (analysis math vs render vs FastAPI vs figures).

---

## B-0004 (orig) — Sub-package by concern (`io/`, `isp/`, `widgets/`,
`modes/{usaf,fpn,dof}/{logic,render,ui}.py`)

**Why**: Phase 1 §4.1. Improves discoverability + isolates UI vs math
vs render.

**Why deferred**: large mechanical move with heavy import-graph churn;
should follow B-0002 + B-0003.

**Estimated effort**: ~1-2 sessions.

---

## B-0005 — Hoist `_color`, `_ch`, `_style_axes` — **CLOSED 2026-04-23**

Done as part of B-0016 / `backlog-cleanup-v1`. New module
`mantisanalysis/plotting.py` owns these helpers; `fpn_render`,
`dof_render`, and `dof_analysis` now import from there. R-0007 closed.

---

## B-0005 (orig) — Hoist `_color`, `_ch`, `_style_axes` out of `fpn_render`

**Why**: Risk R-0007. Cross-module coupling.

**Steps**: create `mantisanalysis/plotting.py`; move; update imports
in both `fpn_render.py` and `dof_render.py`.

**Estimated effort**: ~30 min.

---

## B-0006 — Test for the legacy Workflow A CLI

**Why**: D-0004 keeps `mantisanalysis/resolution.py` +
`scripts/run_usaf_resolution.py` alive. Add a smoke that they don't
bit-rot.

**Steps**: add `tests/unit/test_resolution_legacy.py` that imports the
module + exercises `analyze_channel` on a synthetic strip; add a
Tier-2 case in `smoke_test.py`.

**Estimated effort**: ~30 min.

---

## B-0007 — Warn on rotate-clears-picks; offer coordinate remap

**Why**: Risk R-0006.

**Options**: (a) modal warning before the clear, (b) auto-remap line
endpoints through the rotation matrix, (c) refuse to load a JSON
whose `transform.rotation` differs from the current view.

**Estimated effort**: ~1 session.

---

## B-0008 — Tier-4 end-to-end smoke test — **CLOSED 2026-04-23**

Superseded by B-0015 (Playwright smoke). The Qt-era Tier-4 described
here asserted `_analysis_windows[-1]` state on a live QMainWindow,
which no longer exists. The new Playwright smoke at
`tests/web/test_web_boot.py` covers the equivalent "full-stack boots
clean" gate against the FastAPI + React app.

---

## B-0008 (orig) — Tier-4 end-to-end smoke test

**Why**: Today's Tier 1+2 covers math + figure builders, Tier 3 covers
boot. None covers the full user gesture: load file → drop picks →
Run analysis → assert window contents.

**Steps**: bundle a small synthetic GSense H5 in `examples/`;
programmatically drive each mode; assert `_analysis_windows[-1]` has
the expected tab count + canvas count.

**Estimated effort**: ~1-2 sessions.

---

## B-0009 — GitHub Actions Tier-3 with xvfb-run — **CLOSED 2026-04-23**

Obsolete: D-0009 removed Qt entirely, so no virtual display is needed
to run the stack headlessly. The Tier-3 smoke (FastAPI TestClient
round-trip) already runs cleanly on headless CI.

---

## B-0009 (orig) — GitHub Actions Tier-3 with xvfb-run

**Why**: today CI runs Tier 1+2 on Linux only. Tier 3 needs a virtual
display.

**Steps**: add `xvfb-run` wrapper on the Linux leg; gate behind a
`ci-tier3` job to keep PR feedback fast.

**Estimated effort**: ~30 min once xvfb path is verified.

---

## B-0010 — Push initial commit + remote tracking

**Why**: D-0002 says the remote is
`github.com/BioSensorsLab-Illinois/MantisAnalysis`. Local tree has
`git init` + `git remote add origin`, but **no commit has been made
yet** (waiting for review).

**Steps**:
1. `git add -A`.
2. `git commit -m "Initial commit: rename + .agent harness + smoke + tests + CI"`.
3. `git push -u origin main` (with user consent).

**Estimated effort**: ~5 min.

---

## B-0011 — Decide fate of legacy `requirements.txt` — **CLOSED 2026-04-23**

Done. `requirements.txt` was stale (still listed PySide6, missing
fastapi / uvicorn / python-multipart / pydantic). Deleted during
`backlog-cleanup-v1`. `pyproject.toml` is now the sole source of truth;
install with `pip install -e .[dev]`.

---

## B-0011 (orig) — Decide fate of legacy `requirements.txt`

**Why**: `pyproject.toml` is canonical; `requirements.txt` was kept for
compatibility. Once `pip install -e .` is the standard install
command, requirements.txt is redundant.

**Estimated effort**: ~5 min — delete + update README.

---

## B-0012 — Onboarding helper script

**Why**: New developer flow is currently several manual commands.

**Steps**: add `scripts/dev_setup.sh` (Linux/macOS) and
`scripts/dev_setup.ps1` (Windows) that creates a venv, installs `[dev]`,
runs Tier 1+2 smoke, prints next steps.

**Estimated effort**: ~30 min.

---

## B-0013 — Bridge the new web GUI to real Python analysis — **CLOSED 2026-04-22**

Done in D-0009 (option (a) — FastAPI + uvicorn backend). The React
frontend at `web/src/*` now fetches every number it displays over HTTP
from `mantisanalysis.server:app`. No procedural imagery left on the
hot path.

---

## B-0013 (orig) — Bridge the new web GUI to real Python analysis

**Why**: D-0008 landed the React prototype at `web/` with synthetic
procedural imagery only — `makeUSAFImage`, `makeFPNImage`, `makeDoFImage`
in `web/src/shared.jsx`. The GUI cannot load H5 recordings, cannot call
the Bayer extractor, cannot run USAF / FPN / DoF analysis math. All real
analysis still lives behind the PyQt app.

**Options**:
  (a) FastAPI/Uvicorn server that exposes load_any, extract,
      usaf_groups, fpn_analysis, dof_analysis over HTTP+JSON (plus
      numpy payloads via arrow or base64). Web front-end fetches.
  (b) Pyodide-based in-browser Python (ships NumPy/SciPy to WASM). No
      server, but H5 I/O is awkward and large deps.
  (c) Electron/Tauri desktop shell that spawns a Python subprocess and
      talks over stdio / IPC. Keeps "desktop app" feel.
  (d) WebSocket push for live canvas streaming while user is scrubbing
      ROIs (nice for FPN live stats).

**Steps** (sketch, for the (a) path which is the likely winner):
  1. Add `mantisanalysis/server.py` with FastAPI; route `/api/load`,
     `/api/usaf/michelson`, `/api/fpn/stats`, `/api/dof/scan`.
  2. Wrap existing analysis functions so they accept JSON-ish args
     and emit JSON-serializable results (bytes via base64 for
     thumbnails).
  3. Update `web/src/{usaf,fpn,dof}.jsx` to replace procedural image
     gen with `fetch('/api/load', ...)`.
  4. Add a `mantisanalysis-serve` entry in `[project.scripts]`.
  5. Add a dev script that runs server + opens `web/index.html`.
  6. Tier 1+2+new web-level smoke must all pass.

**Estimated effort**: ~1-2 weeks for a first cut on path (a).

**Blockers**: decide between (a)/(b)/(c)/(d) with user before starting.

---

## B-0014 — Adopt a bundler / toolchain for `web/`

**Why**: Today `web/index.html` loads React + Babel standalone from CDN
and transpiles in the browser. That's fine for a prototype but is slow
to boot, offline-hostile, and has no tree-shaking or source maps.

**Options**: Vite (fast, ESM-native, popular), esbuild (minimal,
library-style), parcel (zero-config), Next.js (too heavy for a static
single-page tool).

**Steps**:
  1. `npm init`; add React/react-dom proper deps.
  2. Convert `<script type="text/babel">` loads to ESM imports.
  3. `web/src/*.jsx` need explicit imports of shared primitives
     instead of reaching for `window.*`.
  4. Add `web/package.json`, `web/vite.config.js` (if Vite).
  5. `npm run dev` works; `npm run build` emits static assets.

**Estimated effort**: ~1-2 days. Best done after B-0013 decides its
transport, since server-side static dir path matters.

---

## B-0016 — Delete dead Qt wrapper functions in `*_render.py` — **CLOSED 2026-04-23**

Done in `backlog-cleanup-v1`. Deleted:
- `mantisanalysis/fpn_render.py::open_fpn_window` (~135 LoC)
- `mantisanalysis/dof_render.py::open_dof_window` (~160 LoC)
- `mantisanalysis/usaf_render.py::open_analysis_window` and the whole
  Qt-tab/builder chain (`_mpl_theme_for`, `_palette_from_parent`,
  `_is_dark_theme`, `_make_canvas_page`, `_build_mtf_tab`,
  `_build_gallery_tab`, `_build_table_tab`, `_build_heatmap_tab`,
  `_build_sweep_tab`, `_draw_mtf_curves`, `_draw_fft_spectra`,
  `_build_fft_mtf_tab`, `_get_transform_from_app`,
  `_get_sharpen_from_app`, `compute_all_measurements`, `_source_stem`)
  — about 1230 LoC.

Also hoisted `_ch`, `_color`, `_style_axes` + `CHANNEL_COLORS` from
`fpn_render.py` to a new `mantisanalysis/plotting.py`; `fpn_render`,
`dof_render`, and `dof_analysis` now import from there. R-0007 closed.

Net delete ≈ −1500 LoC across three files. Tier 1 + 2 + 3 smoke green.

---

## B-0016 (orig) — Delete dead Qt wrapper functions in `*_render.py`

**Why**: After D-0009, `open_fpn_window`, `open_analysis_window`, and
`open_dof_window` (plus their `_palette_from_parent` / `_is_dark_theme`
helpers) are unreachable. They import Qt lazily so they don't break
Tier 1, but they are dead weight.

**Steps**:
1. Delete the `open_*_window` functions and any helper referenced only
   by them.
2. Drop the `_color` / `_ch` / `_style_axes` cross-module imports from
   `dof_render` → `fpn_render` (R-0007) by hoisting shared helpers
   into `figures.py` or a new `plotting.py`.
3. Confirm Tier 1+2+3 remain green.

**Estimated effort**: ~1 session.

---

## B-0015 — Web-side test harness — **PARTIALLY CLOSED 2026-04-23**

Minimum-viable slice shipped in `backlog-cleanup-v1`. Deliverables:
- `tests/web/conftest.py` — pytest session fixture that boots
  `mantisanalysis.server:app` on an ephemeral port.
- `tests/web/test_web_boot.py` — Playwright smoke: root page mounts
  React, 3 mode-rail buttons render, no uncaught console errors in the
  first 2 s.
- `[project.optional-dependencies].web-smoke` in pyproject.toml so the
  Playwright deps are an opt-in install (activate with
  `pip install -e .[web-smoke] && playwright install chromium`).
- `web_smoke` pytest marker.

Still open / deferred:
- Per-mode interaction tests (click-to-draw USAF; ROI drag FPN; probe
  drop DoF) — valuable but adds another day of work. Leave for a
  follow-on `web-smoke-v2` initiative.
- CI gating on the Playwright test. Requires committing to installing
  chromium in CI (~300 MB download). Revisit when the smoke has been
  running locally for a release cycle without flakes.

---

## B-0015 (orig) — Web-side test harness

**Why**: The prototype has zero tests. When we start bridging to real
analysis (B-0013), visual regressions and logic bugs will bite.

**Options**: Playwright (full browser, screenshot diffing), Vitest
(unit + jsdom), testing-library/react (component-level).

**Steps**:
  1. Start with a smoke test that boots `web/index.html` in a
     headless browser and asserts no JS console errors + the three
     mode-rail buttons render.
  2. Add interaction tests per mode (click-to-draw for USAF; ROI drag
     for FPN; probe drop for DoF).
  3. Gate CI on them once stable.

**Estimated effort**: ~1 day for the smoke step.
