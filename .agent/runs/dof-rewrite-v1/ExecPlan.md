# dof-rewrite-v1 — ExecPlan

Opened: 2026-04-22 (same session as `fpn-rewrite-v1`)
Owner: agent
Driver: Zhongmin

## Why

After USAF (`gui-rewrite-v1`) and FPN (`fpn-rewrite-v1`) reached a
research-grade bench, DoF is the last mode still on the old "single
measurement + legacy PNG modal" pattern:

- `web/src/dof.jsx` = **414** lines (USAF 1420, FPN 1495).
- No rulers, no zoom, no pan, no keyboard shortcuts, no Save/Load, no
  display knobs, no ISP live-apply, no sortable tables, no native-vector
  analysis modal. Analysis modal falls through to `LegacyPngModal` → 3
  static matplotlib PNGs.
- `compute_fpn` supports multi-channel batch; `analyze_dof` is still
  per-channel-at-a-time.

Bring DoF up to the same UX / analysis bar, then exceed with physics-
grade extras.

## Scope — files expected to change

1. `mantisanalysis/dof_analysis.py` — new helper math, new result fields.
2. `mantisanalysis/dof_render.py` — new matplotlib builders for extras.
3. `mantisanalysis/figures.py` — wire new builders into `build_dof_pngs`.
4. `mantisanalysis/server.py` — expand `/api/dof/analyze` to a
   multi-channel native-JSON shape (like USAF + FPN), add live
   per-channel `/api/dof/compute_multi`.
5. `web/src/dof.jsx` — near-total rewrite (>1200 lines target).
6. `web/src/analysis.jsx` — new `DoFAnalysisModal` with tabs.
7. `scripts/smoke_test.py` — extend tier 2 + tier 3 coverage.

7 files. Initiative is intentionally scoped to this run directory.

## Research additions (beyond USAF/FPN parity)

1. **Gaussian fit on each line scan** — fit `f(s) = A·exp(-(s-μ)²/(2σ²)) + b`
   to the focus profile with `scipy.optimize.curve_fit`. Parametric
   `peak_position = μ`, `CoC_σ_px = σ`, `DoF_FWHM_px = 2.355·σ`.
   Handles noise far better than the argmax + threshold walk.
2. **Bootstrap confidence interval** — percentile-bootstrap on the
   focus array to give the user `peak_CI_95 = ±X px` and
   `dof_width_CI_95 = ±Y px`. Lets them see whether their ROI is long
   enough for a trustworthy DoF estimate.
3. **All-metrics parallel computation** — `measure_focus_all()` returns
   `{laplacian, brenner, tenengrad, fft_hf}` in one pass. Frontend
   shows a metric-comparison card so the user can sanity-check the DoF
   estimate is metric-independent.
4. **Per-channel chromatic focus shift** — when N channels are selected
   and multiple lines are drawn, compare per-channel peak positions on
   the same line to detect chromatic aberration (`HG-R` focuses farther
   than `HG-B` → lateral / longitudinal CA).
5. **Tilt / field-curvature plane fit** — if user drops ≥3 points and
   each has a measurable focus peak (we can't directly, but we use
   point focus values as a proxy surface), fit a bilinear plane to
   `(x, y, focus)` → report image-plane tilt angle. Useful for diagnosing
   a tilted sensor.
6. **Focus-window stability** — shrink the half-window in N steps;
   report DoF-width vs window for the selected line. Flat = stable.
7. **Per-metric peak** — if the user runs all-metrics, display per-line
   peak position for each metric so they can see metric disagreement.
8. **Save/Load JSON** with `version: 2` round-trips ROIs + refs +
   calibration + metric + threshold + half-window + display knobs.

## Frontend parity items (copy USAF pattern)

- Rulers + zoom-to-cursor pan + rotation-aware.
- Space-pan, wheel-zoom, ⌘Z undo, ⌘A select-all, Del/Backspace delete.
- Display: colormap / brightness / contrast / gamma (CSS only).
- ISP card (median / gaussian / hot-pixel / bilateral) applied to the
  measurement image server-side.
- Sortable points + lines tables, multi-select via ⇧/⌘, double-click
  to rename.
- Save/Load JSON and CSV export of per-line + per-point measurements.
- Multi-line + multi-point workflow with color-coded overlay.

## DoF-specific analysis modal tabs

1. Summary               — per-channel × per-line metric table
2. Line scans            — focus vs position cards with Gaussian fits
3. Multi-metric          — 4-metric overlay per line (cross-check)
4. Chromatic shift       — per-channel peak positions on each line
5. Focus heatmaps        — server-rendered PNG grid
6. Points                — bar chart of focus at each point per channel
7. Stability             — DoF vs half-window curve
8. Field curvature       — tilt-plane fit over all picked points

## Acceptance criteria

- Tier 1+2+3 smoke green.
- Preview MCP: load sample → DoF mode → drop 2 points + 2 lines →
  Run analysis → modal opens on 4 channels × 2 lines with all tabs
  populated.
- Analysis math stays pure NumPy/SciPy (AGENT_RULES #7).
- Channel key schema + Bayer constants untouched (AGENT_RULES #5/#6).
- `.agent/` docs updated.

## Risks

- R1. `scipy.optimize.curve_fit` can fail to converge on degenerate
  profiles. Mitigation: try/except; fall back to `peak_idx` argmax.
- R2. Bootstrap is O(N·B) per line where B is bootstrap iterations; keep
  B ≤ 200 for live latency.
- R3. `dof_render.py` imports `_color`, `_ch`, `_style_axes` from
  `fpn_render.py` (documented R-0007 / B-0005). We're not fixing that
  this session; just keep the import path stable.
- R4. JSX file growing past 1500-2000 lines may cross the Read-tool
  chunking threshold. Mitigation: split out helpers if needed.
