# fpn-rewrite-v1 — ExecPlan

Opened: 2026-04-22
Owner: agent
Driver: Zhongmin

## Why

USAF mode has been brought up to a research-grade workbench: rulers,
zoom-to-cursor pan, snap, save/load JSON config, sortable measurement
table, profile preview with draggable 5-point overrides, CSP-clean
native-vector analysis modal with 6 tabs (MTF curves, profile gallery,
summary table, detection heatmap, group sweep, FFT/MTF), ISP live-apply,
display brightness/contrast/gamma/colormap, keyboard shortcuts, and
per-channel detection-limit reporting.

FPN mode, by comparison, is **261 lines** of JSX vs USAF's **1420** — a
5.4× feature gap. There is no zoom, no pan, no rulers, no keyboard
shortcuts, no display knobs, no save/load, no sortable ROI table, no
multi-ROI workflow, no native-chart analysis modal (it just shows 4
static matplotlib PNGs).

Zhongmin wants FPN at least at USAF parity, then beyond — "expand the
functionality by doing your own research, extra efforts."

## Scope — full list of files I expect to change

1. `mantisanalysis/fpn_analysis.py` — add EMVA-grade metrics + research
   extras (multi-ROI, auto-correlation, 1-D row/col PSDs, drift-plane
   removal, per-column/per-row DSNU, hot/cold pixel maps, temporal noise
   placeholder, `from_bytes` helpers stay pure NumPy/SciPy).
2. `mantisanalysis/fpn_render.py` — add new matplotlib figure builders
   (autocorrelation heatmap, 1-D PSDs, hot-pixel map, multi-ROI compare).
   Keep old functions for back-compat.
3. `mantisanalysis/server.py` — extend `/api/fpn/compute` and
   `/api/fpn/analyze` to return the full numerical dataclass as JSON
   (not just the tiny 14-field summary). Add `/api/fpn/measure` for
   multi-ROI batch. Keep PNG builder path for backward compat.
4. `mantisanalysis/figures.py` — wire new fpn_render builders.
5. `web/src/fpn.jsx` — near-total rewrite to USAF-class parity:
   rulers, zoom-to-cursor pan, space-pan, keyboard shortcuts, display
   sliders, colormap, JSON save/load, sortable multi-ROI table,
   EMVA live-stats card, ISP live-apply card (match USAF's ISP widget).
6. `web/src/analysis.jsx` — add `FPNAnalysisModal` next to
   `USAFAnalysisModal`: native-vector Plotly + inline SVG tabs
   (Overview, Row/Col profiles, 2-D map, PSD, Autocorrelation, Hot-pixel
   map, Multi-ROI compare, Summary table). Remove the static-PNG
   `LegacyPngModal` path for FPN (DoF keeps it until its own rewrite).
7. `mantisanalysis/__init__.py` — bump `__version__` patch.
8. `scripts/smoke_test.py` — extend tier 3 FastAPI round-trip to hit the
   new endpoints.

That's 8 files — past the 3-file threshold in `AGENT_RULES.md`, so this
is intentionally scoped as an initiative under
`.agent/runs/fpn-rewrite-v1/`.

## Out of scope

- DoF rewrite (B-0016 follow-up, separate initiative).
- Bundler migration (B-0014).
- Playwright smoke (B-0015).
- Legacy `open_fpn_window` Qt factory (already stale per D-0009).
- Changing GSense Bayer constants or channel key schema (locked per
  AGENT_RULES 5 + 6).

## Research additions I will ship (beyond USAF parity)

These go into `fpn_analysis.py` and surface as tabs in the analysis modal:

1. **EMVA 1288 column/row DSNU split** — DSNU_row (std of row-mean
   residuals after de-mean), DSNU_col (std of col-mean residuals), and
   the already-present `residual_pixel_noise_dn` (per-pixel after
   row+col strip).
2. **Row and column 1-D power spectra** — 1-D FFT of `row_means` and
   `col_means`, plot peaks highlight ADC / clock frequencies.
3. **Normalized 2-D autocorrelation** — reveals structured spatial
   correlations (fabric patterns, periodic fixed noise).
4. **Drift-plane removal toggle** — subtract a fit low-order polynomial
   surface (bilinear or biquadratic) before stats; separates illumination
   roll-off from FPN.
5. **Multi-ROI compare** — up to 6 ROIs on the same channel, side-by-side
   DSNU/PRNU/row/col bars + small FPN maps; supports flat-field-uniformity
   audits across the image field.
6. **Hot/cold pixel map** — pixels whose absolute z-score exceeds a user
   threshold; shown as scatter on the 2-D map plus a count and pixel %.
7. **Live PRNU-vs-ROI-size stability curve** — shrinks the ROI in
   concentric steps, reports PRNU at each; a flat curve means stats are
   stable, a diverging curve means ROI is too small.
8. **Horiz/vert row-banding metric** — column-of-row-means amplitude
   spectrum peak, useful to diagnose line-noise artifacts typical of
   rolling-shutter CMOS.
9. **ISP live-apply for FPN** — same design as USAF: black-level, sharpen
   (for comparison), denoise flow into the *measurement* array; display
   brightness/contrast/gamma/colormap stays CSS-only.
10. **Save/Load JSON config** — ROI(s), ISP, display, sort state, colormap.

## Acceptance criteria

- Tier 1 smoke passes (all modules still import).
- Tier 2 smoke passes (all figure builders produce PNGs to
  `outputs/smoke/`).
- Tier 3 smoke passes (TestClient round-trips hit the new endpoints
  and return the expected fields).
- Loading the sample in the browser and switching to FPN mode:
  - Draws the rulers + canvas + HUD exactly like USAF.
  - Drag ROI → right-panel Live statistics card updates within ~200 ms.
  - Press `r` → canvas rotates 90°. Press `space` → pans. Wheel → zooms
    to cursor.
  - Save/Load JSON round-trips ROI(s), ISP, display, colormap.
  - Run analysis opens the modal; Plotly native-vector charts render on
    all 8 tabs with the synthetic sample.
- No Qt imports sneak into the analysis math (AGENT_RULES #7).
- `.agent/ARCHITECTURE.md`, `BACKLOG.md`, `CHANGELOG_AGENT.md`,
  `DECISIONS.md`, `HANDOFF.md` all updated.

## Execution order (sequential)

1. Enrich `fpn_analysis.py` + unit-test mentally with tier-2 figures.
2. Update `fpn_render.py` to cover the new fields it needs for PNG
   builders; keep legacy functions intact (dead-code removal is B-0016).
3. Expand `server.py` FPN endpoints to return everything as JSON (the
   FPN response shape was previously a tiny 14-field subset).
4. Update `smoke_test.py` tier-3 to hit the new endpoints.
5. Rewrite `web/src/fpn.jsx` using the USAF file as the structural
   template. Keep file ≤ 1800 lines, one component per concern.
6. Add `FPNAnalysisModal` to `web/src/analysis.jsx` with 8 tabs. Remove
   `LegacyPngModal`'s FPN path and leave only the DoF legacy path.
7. Run tier 1 + 2 + 3. Fix any regression immediately.
8. Boot uvicorn via Claude Preview MCP, take screenshots of FPN-Idle,
   FPN-ROI-drawn, FPN-Analysis-modal at every tab.
9. Close the loop in `.agent/*` docs.

## Risks + mitigations

- **R1.** JSX file grows past 25 kB and becomes too big for the `Read`
  tool on the next agent. Mitigation: split into `fpn.jsx` (shell +
  canvas + sidebars) and possibly break out large helpers via a
  `fpn_parts.jsx` if we cross 1800 lines.
- **R2.** Multi-ROI state shape changes the JSON save-file schema.
  Mitigation: bump `version: 2` on the FPN config, add a compat step
  that wraps a legacy single-ROI into `rois: [...]`.
- **R3.** Percentile mask + drift-plane removal are O(N²) on big sensors.
  Mitigation: bilinear plane fit is O(N); biquadratic is still O(N) in
  pixel count. Keep ROIs bounded in the Live-apply hot path.
- **R4.** Autocorrelation via 2-D FFT is already implied by the PSD —
  we can compute it as the inverse FFT of `|F|²` at almost zero extra
  cost, no new hot path. Good.
- **R5.** Tier-3 smoke has to run in CI without a GPU. Ensure all new
  figures use matplotlib Agg (already enforced in `figures.py`).

## Estimated effort

1 long working session (this one).
