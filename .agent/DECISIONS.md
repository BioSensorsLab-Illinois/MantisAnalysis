# DECISIONS

Append-only log. Every non-trivial choice gets an entry. The counter
`D-000N` is monotonic; do not renumber.

---

## D-0001 — License: MIT  (2026-04-22)

**Context**: Phase 1 audit listed several license options; user
confirmed MIT.
**Options**: MIT, BSD-3-Clause, Apache-2.0, academic-only.
**Decision**: MIT.
**Consequences**: Permissive use; no UIUC-specific clauses; copyright
attributed to Zhongmin Zhu — BioSensors Lab @ UIUC.
**Revisit**: only if a UIUC IP / TTO requirement surfaces.

---

## D-0002 — Remote: github.com/BioSensorsLab-Illinois/MantisAnalysis  (2026-04-22)

**Context**: Phase 1 listed remote-host as unresolved.
**Options**: personal GitHub, BSL-org GitHub, GitLab.
**Decision**: GitHub under the `BioSensorsLab-Illinois` org at
`https://github.com/BioSensorsLab-Illinois/MantisAnalysis`.
**Consequences**: CI = GitHub Actions; PRs follow GitHub conventions.
Not yet pushed (the working tree was just `git init`'d locally).
**Revisit**: only if BSL changes hosting policy.

---

## D-0003 — Python floor: 3.10  (2026-04-22)

**Context**: PySide6 6.5 supports 3.8+; matplotlib 3.7 supports 3.9+.
The lab's primary workstation runs Python 3.13.
**Options**: 3.9 (broadest), 3.10 (typing niceties), 3.11+ (perf).
**Decision**: `requires-python = ">=3.10"`.
**Consequences**: Allows PEP-604 union syntax, `typing.TypeAlias`,
modern `match/case` in any future code.
**Revisit**: if a lab machine is stuck on 3.9 in practice.

---

## D-0004 — Workflow A (auto-strip FFT MTF) survives Phase 2  (2026-04-22)

**Context**: Phase 1 §3.6 flagged that `mantisanalysis/resolution.py`
+ `scripts/run_usaf_resolution.py` (Workflow A) are documented in the
README but not wired into the GUI. User said "not sure" on its fate.
**Options**: (a) delete now, (b) keep as documented CLI, (c) rewrite
into the modern `mantisanalysis/cli/` style.
**Decision**: KEEP as a documented CLI (option b). Both files are
lightweight (302 + 358 LoC), have docstrings, and produce useful
journal-style figures the user has invested in. Removal is reversible
later but blocks tagged users today.
**Consequences**:
- README continues to advertise Workflow A.
- A test under `tests/unit/test_legacy_resolution_cli.py` is on the
  backlog (B-0006) to ensure it doesn't bit-rot.
- The CLI is NOT exposed via `[project.scripts]`; users invoke it via
  `python scripts/run_usaf_resolution.py`.
**Revisit**: when the next round of UI/structural work happens, OR
when Zhongmin signals it can go.

---

## D-0005 — Folder renamed; PYTHON package renamed  (2026-04-22)

**Context**: User asked to rename project AND folders.
**Decision**: Two renames executed:
- `rgbnir-analysis/` → `MantisAnalysis/` (top-level dir; via robocopy
  /MOVE because Windows held a handle on the old folder root — empty
  husk left for user to delete manually).
- `rgbnir/` → `mantisanalysis/` (package; via `mv`; all `from rgbnir.X`
  imports rewritten to `from mantisanalysis.X` in
  `scripts/{pick_lines_gui,inspect_recording,run_usaf_resolution}.py`).
**Consequences**: any external script that did `from rgbnir.X import Y`
will now break. None known to exist.
**Revisit**: not.

---

## D-0006 — Defer the deeper sub-package restructure  (2026-04-22)

**Context**: Phase 1 §4.1 proposed sub-packaging into `io/`, `isp/`,
`widgets/`, `modes/{usaf,fpn,dof}/{logic,render,ui}.py`, plus widget
deduplication and demoting `USAFPickerApp` from `QMainWindow` to
`QWidget`. This is the high-value, high-risk Phase-2 work.
**Decision**: Defer. Phase 2 of THIS implementation pass restricts
itself to: rename, packaging, .agent/ harness, smoke tests, CI, docs.
Sub-packaging + widget dedup + USAFPickerApp demotion is recorded as
backlog items B-0001 through B-0004.
**Rationale**: keeps blast radius small; preserves working behavior
(Phase-2 prompt mandate); leaves a clean state for the next initiative
to pick up.
**Revisit**: on opening of `.agent/runs/structural-cleanup/`.

---

## D-0007 — `mantisanalysis.app` is a SHIM, not the real entry  (2026-04-22)

**Context**: The 1936-line GUI lives in `scripts/pick_lines_gui.py`.
`pyproject.toml [project.scripts]` needs an importable entry point.
**Options**: (a) move pick_lines_gui.py into the package now, (b) shim.
**Decision**: shim. `mantisanalysis/app.py:main` adds
`scripts/` to `sys.path` and imports `pick_lines_gui.main`.
**Consequences**: a small import-time penalty; one extra layer of
indirection. Move planned in B-0001.
**Revisit**: when B-0001 fires.

---

## D-0009 — Delete PyQt GUI; web (FastAPI + React) is the only frontend  (2026-04-22)

**Context**: After D-0008 landed the React prototype in parallel with the
PyQt app, the user tested and said *"nothing works, the goal is to delete
the QT app, implement the full functionality of the new GUI"*. The prototype
rendered only synthetic data — it did not load real recordings or call the
NumPy/SciPy analysis code.

**Options**:
  (a) Abandon the web direction; keep PyQt.
  (b) Build a local FastAPI server that wraps the existing analysis math,
      wire the React app to it, delete PyQt.
  (c) Ship the web UI as an Electron/Tauri desktop container with a Python
      subprocess.
  (d) Port analysis math to JavaScript / WASM.

**Decision**: (b).

**Rationale**:
- The analysis math is already Qt-free pure NumPy/SciPy (AGENT_RULES rule 7).
  Wrapping it with FastAPI is a thin adapter, not a rewrite.
- (c) adds a binary distribution burden that does not buy anything for a
  local dev tool running on a research workstation.
- (d) throws away 15+ years of rigorous NumPy/SciPy behavior; a scientific
  tool cannot afford that regression.
- (a) contradicts the user's directive.

**What changed**:
- Added `mantisanalysis/server.py` (FastAPI routes + Pydantic schemas),
  `mantisanalysis/session.py` (in-memory LRU source store + thumbnail
  helper), `mantisanalysis/figures.py` (matplotlib→PNG byte adapter).
- Rewrote `mantisanalysis/app.py` and `mantisanalysis/__main__.py` to
  launch uvicorn + auto-open the browser.
- Rewrote every file in `web/src/` to consume the real API (thumbnails,
  live-stats, full analysis). Removed the procedural-only code paths.
- Deleted:
  - `scripts/pick_lines_gui.py` (1936 LoC Qt app)
  - `mantisanalysis/modes/{__init__,common,fpn,dof}.py`
  - `MantisAnalysis.bat`
- `pyproject.toml`: removed `PySide6`, `pytest-qt`; added `fastapi`,
  `uvicorn[standard]`, `python-multipart`, `pydantic`, `httpx` (dev).
  Version bumped 0.1.0 → 0.2.0.
- Smoke tier 3 redefined: now exercises the FastAPI app in-process via
  `fastapi.testclient.TestClient`, no Qt display needed.
- CI workflow gained a tier-3 job on Linux.

**Consequences**:
- The Qt-wrapper functions still present at the bottom of `*_render.py`
  (`open_fpn_window`, `open_analysis_window`, `open_dof_window`, plus
  helpers that call `QtWidgets`) are dead code. Their Qt imports are
  lazy (inside function bodies), so they do not affect module imports
  or add a hard dependency on PySide6. Deletion is a separate
  housekeeping pass (B-0016).
- Anyone who had `mantisanalysis` installed expecting a Qt app gets a
  web server instead. Not a semver-stable change; caller-facing API
  surface is different.

**Revisit**: if a local-first / no-network deployment is required and the
uvicorn server becomes a problem, reconsider Electron/Tauri (option c) or
Pyodide (option d).

---

## D-0008 — Adopt React prototype as parallel web GUI under `web/`  (2026-04-22, superseded by D-0009)

**Context**: User directed "rewrite the entire software GUI with new
GUI stack and tech" and pointed to a Claude Design handoff
(https://api.anthropic.com/v1/design/h/sRqIo_XUO3eQLBfY1bw3sg)
containing a full hi-fi `MantisAnalysis Suite` React prototype — three
modes, analysis modal, ⌘K palette, rotation-aware labels, DoF
reference-length calibration, ISP card, theme + accent tokens.
**Options**:
  (a) Rewrite the prototype in a different frontend stack (Vue /
      Svelte / vanilla) chosen fresh for this repo.
  (b) Land the React prototype verbatim at `web/` as a parallel GUI,
      keep the PyQt desktop app working for real analysis.
  (c) Replace `scripts/pick_lines_gui.py` now; treat the web GUI as
      the sole frontend.
**Decision**: (b). Files copied verbatim from the design bundle into
`web/index.html` + `web/src/*.jsx`. No Python code touched.
**Rationale**:
- The design bundle README explicitly allows verbatim React as an
  implementation for a repo that has no frontend stack yet.
- Option (a) would burn effort on framework migration for zero user
  value vs (b); any future migration is reversible.
- Option (c) is premature — the prototype uses synthetic procedural
  images (`makeUSAFImage` / `makeFPNImage` / `makeDoFImage`) and has
  no wiring to real H5 loads or to the `mantisanalysis/*.py` analysis
  math. Retiring the working PyQt app before bridging would regress
  the ability to actually run analysis.
**Consequences**:
- Repo now has two GUI surfaces: the authoritative PyQt desktop app
  (reachable via `python -m mantisanalysis`) and the preview web GUI
  (open `web/index.html` in a browser, no toolchain required).
- Branding / metadata for the web GUI is centralized in
  `web/src/shared.jsx:10` (`BRAND` object).
- Three backlog items opened:
  - B-0013 — bridge web GUI to real Python analysis
  - B-0014 — adopt bundler / toolchain (Vite or esbuild)
  - B-0015 — web-side test harness (Playwright or Vitest)
- No new runtime Python dependencies. CI is unchanged.
**Revisit**:
- When B-0013 lands, re-open this decision to consider retiring
  `scripts/pick_lines_gui.py`.
- Or sooner, if the user directs us to pick a different frontend
  stack before wiring to Python.

---

## D-0010 — FPN drift-plane removal BEFORE stats; PRNU normalized against pre-drift mean  (2026-04-22)

**Context**: Adding bilinear / biquadratic surface-fit drift removal to
FPN separates illumination roll-off from genuine pattern noise, but
the residual has mean ≈ 0, so the legacy `PRNU = 100 · std / mean`
explodes to ~1e15%.

**Options**:
  (a) Compute PRNU on the raw pre-drift sub-ROI — simple, but then
      DSNU and PRNU disagree (DSNU measures residual, PRNU doesn't).
  (b) Store both means on `FPNResult` — `mean` is post-drift (≈0,
      useful for histograms), `mean_signal` is pre-drift on kept
      pixels. Normalize PRNU against `mean_signal`.
  (c) Disable drift removal by default, warn when PRNU/mean becomes
      pathological.

**Decision**: (b). Dataclass gets an additional `mean_signal` field
(additive, no API break). PRNU = 100 · std / mean_signal. Stat tables
show both means labelled 'Signal mean (μ)' and 'Residual mean'.

**Consequences**: `FPNComputeResponse` gains `mean_signal`.
Downstream (CSV, GUI) shows both. Matplotlib stat table panel
uses the pre-drift mean for the headline PRNU too.

**Revisit**: if EMVA 1288 changes its PRNU definition, or if a
specific workflow needs the raw-image PRNU; add a mode selector then.

---

## D-0011 — FPN analysis JSON-first; PNGs optional  (2026-04-22)

**Context**: The USAF analysis modal renders everything as native
Plotly / inline SVG from raw JSON (measurements + thumbnails + per-
channel detection limit). The FPN analysis endpoint previously
returned just 4 matplotlib PNGs. Bringing FPN to USAF parity meant
making the modal interactive (filterable channels/ROIs, sortable
table, zoomable plots), which means shipping the numerical arrays
(row/col means, 1-D PSDs, hot-pixel coords) as JSON too.

**Options**:
  (a) PNG-only — fastest server, simplest. Modal stays static. Rejected.
  (b) JSON-only — live interactive charts but no offline PDF-export
      path. Rejected; users want "save the 2-D FPN map as a PNG."
  (c) Both — JSON first-class, PNGs bundled under `figures.{channel}
      .{roi_idx}.{builder}`. Caller can toggle with `include_pngs=false`
      to save bandwidth.

**Decision**: (c). `/api/fpn/analyze` returns both; `/api/fpn/measure`
and `/api/fpn/measure_batch` are JSON-only (for the live sidebar
and the multi-ROI live-compare path where PNGs would be wasted).

**Consequences**: Response payload is larger but still well under
typical HTTP limits (≈ 1-2 MB for 4 channels × 3 ROIs at 520 px
thumbnails). Analysis modal opens faster because inline SVG renders
immediately; server-rendered PNGs lazy-load as img src on their tabs.

**Revisit**: if multi-channel × multi-ROI × high-DPI PNG bundles
exceed 10 MB in practice, add a streaming endpoint.

---


---

## D-0012 — DoF analysis: Gaussian fit is primary, argmax is fallback  (2026-04-22)

**Context**: DoF peak-position estimation by argmax-of-discrete-focus-
array has two problems: (a) it's noise-sensitive — a single noisy sample
can shift the reported peak by `line_step_px`, and (b) the DoF-width
estimator (walk left/right from peak until focus_norm drops below
threshold) depends on where the argmax landed. For noisy microscopy /
tilted-target acquisitions, the argmax can snap to a spurious ripple.

**Options**:
  (a) Keep argmax primary; add Gaussian fit as a separate metric tab.
      → User has to switch between tabs to compare; easy to overlook.
  (b) Replace argmax entirely with parametric Gaussian fit.
      → Catastrophic when the profile isn't Gaussian (e.g. plateau near
      best focus on a USAF-periodic target — the fit's μ can be anywhere
      inside the plateau).
  (c) Compute BOTH and report both; make the Gaussian fit the visual
      headline when `converged=True` and `R² ≥ 0.7`, otherwise fall back
      to argmax. This matches how microscopists actually read these
      plots.

**Decision**: (c). The Lines table and Chromatic-shift chart both use
`gaussian.mu` when `gaussian.converged=True`, else `peak_position_px`.
The Gaussian overlay is always drawn so the user sees the fit quality
themselves.

**Consequences**: Slightly wider CSV schema (new gauss_* columns). No
back-compat break: old clients reading `peak_position_px` still work.

**Revisit**: if the "converged + R² ≥ 0.7" gate proves too lax in
practice, add an explicit toggle to always use argmax or always use fit.

---

## D-0013 — DoF `compute_all_metrics` + `bootstrap` + `fit_tilt_plane` are opt-in, not always-on  (2026-04-22)

**Context**: The three research extras added to `analyze_dof` are
expensive:
- `compute_all_metrics`: re-runs `_scan_line` three extra times per line
  (once per non-primary metric). O(N_lines · 3 · N_samples) windows.
- `bootstrap`: percentile bootstrap is O(N_boot · N_samples) per line.
- `fit_tilt_plane`: cheap (least-squares on ≤ few dozen points), but
  useless with < 3 points.

Running all three by default on every live-drag call would tank the
live-update latency budget (target: < 200 ms per ROI move).

**Options**:
  (a) Always on — simpler API, but bad UX.
  (b) Always on for `/api/dof/analyze`, off for `/api/dof/compute`.
  (c) Explicit boolean kwargs on both; UI defaults them off for live and
      on for "Run analysis".

**Decision**: (c). `DoFComputeRequest` and `DoFAnalyzeRequest` both
carry `compute_all_metrics`, `bootstrap`, `fit_tilt_plane`, `n_boot`
kwargs. The frontend toggles them via a "Research extras" checkbox card
(live flags default off) and the `/api/dof/analyze` call sets them all
true (`n_boot=200`, `fit_tilt_plane=True` gated on `points.length >= 3`).

**Consequences**: Caller controls the cost/quality tradeoff. Back-compat
is preserved since the defaults are all False.

**Revisit**: if the user ever hits "Run analysis" latency issues on a
very large channel grid, add `max_lines_per_channel` and a progress
endpoint.


---

## D-0014 — Hoist `_color` / `_ch` / `_style_axes` to `mantisanalysis/plotting.py`; delete dead Qt wrappers  (2026-04-23)

**Context**: After D-0009 removed the Qt desktop surface, three
`open_*_window` factories plus their entire tab / draw / theme helper
chain survived at the tail of `fpn_render.py`, `dof_render.py`, and
`usaf_render.py`. Their Qt imports were lazy, so Tier-1 imports stayed
green, but they were unreferenced dead code (B-0016). Separately, R-0007
flagged that `dof_render.py` and `dof_analysis.py` reached across into
`fpn_render` for `_color` / `_ch` / `_style_axes` — a backwards
coupling (render → analysis is the wrong direction, and analysis ought
to depend on a neutral helper, not on the render of another mode).

**Options**:
- (a) Just delete the dead wrappers; leave the cross-module import.
- (b) Hoist the shared helpers into a new `plotting.py`, then delete
  the wrappers. Closes R-0007 in the same pass.
- (c) Leave everything; deal with it later.

**Decision**: (b). New module `mantisanalysis/plotting.py` owns
`CHANNEL_COLORS`, `_ch`, `_color`, `_style_axes`. `fpn_render`,
`dof_render`, and `dof_analysis` all import from there. The
`open_fpn_window` / `open_analysis_window` / `open_dof_window`
factories and every helper only they referenced
(`_mpl_theme_for`, `_palette_from_parent`, `_is_dark_theme`,
`_make_canvas_page`, `_build_mtf_tab`, `_build_gallery_tab`,
`_build_table_tab`, `_build_heatmap_tab`, `_build_sweep_tab`,
`_draw_mtf_curves`, `_draw_fft_spectra`, `_build_fft_mtf_tab`,
`_get_transform_from_app`, `_get_sharpen_from_app`,
`compute_all_measurements`, `_source_stem`) are deleted.

**Consequences**:
- `mantisanalysis/usaf_render.py`: 1576 → 341 LoC.
- `mantisanalysis/fpn_render.py`: 613 → 449 LoC.
- `mantisanalysis/dof_render.py`: 842 → 678 LoC.
- Net delete ≈ −1500 LoC. Tier 1 + 2 + 3 smoke green.
- R-0007 closed. The analysis layer no longer depends on a render
  module, which means `dof_analysis.py` could live in a slimmer
  distribution that omits matplotlib entirely if that ever becomes
  interesting.

**Revisit**: only if a new figure builder needs to draw from the same
palette and we want to widen `plotting.py` into a fuller `plotting`
submodule (e.g. typed theme objects, multi-palette export).
