# plot-style-completion-v1 — Status

Opened: 2026-04-23
Last updated: 2026-04-23 (session complete)

## Milestones

- [x] Baseline smoke green before edits.
- [x] Server JSON extended with compact base64-float32 grids
      (`image_grid`, `fpn_map_grid`, `psd_log_grid`, `autocorr_grid`,
      `kept_mask_b64`, `heatmap_grid`).
- [x] `HeatmapCanvas` + `HeatmapColorBar` primitives shipped in
      `shared.jsx` (9 colormaps, divergent / log-scale support,
      aspect-lock, SVG overlay slot).
- [x] `ChartCard` shared card-chrome component added to `analysis.jsx`.
- [x] DoF Gaussian tab: native SVG fit-curve chart per (channel ×
      line) with CI band + DoF band + μ/σ/FWHM/R² legend.
- [x] DoF Heatmap tab: native canvas + SVG overlay (points, lines,
      best-focus × marker) with user-selectable colormap.
- [x] DoF Points/tilt tab: native bar chart + SVG tilt-plane
      diagnostic with gradient arrow.
- [x] DoF Chromatic shift: server-PNG side-by-side removed; native
      `ChromaticShiftChart` rewired to honour plotStyle.
- [x] FPN map / psd / autocorr tabs: single unified `FPNHeatmapCard`
      with user-selectable colormap per tab (RdBu divergent for map +
      autocorr; magma / viridis / … for PSD).
- [x] FPN Hot-pixel tab: native canvas with SVG markers (red circles =
      hot, blue squares = cold) + compact outlier list.
- [x] All `strokeWidth={style.*}` now wrapped in `scaled(style.*,
      style)` so `Elements ×` scales line widths too.
- [x] SVG fontSize literals remapped by semantic role to
      `tickSize` / `axisLabelSize` / `legendSize` / `titleSize`.
- [x] `LineOverlayChart`, `MetricOverlayChart`, `ChromaticShiftChart`
      chart-card chrome + HTML legend/title fonts fully routed through
      plotStyle.
- [x] `include_pngs: false` in DoF + FPN picker run payloads.
- [x] Tier 1 + 2 + 3 smoke green; 40/40 pytest green (including
      Playwright).
- [x] Browser-verified: DoF modal (0 `<img>` tags, 4 canvases for
      heatmap tab); Presentation preset bumps tick + axis + legend
      fontSize + lineWidth + fontFamily in real time; `Elements × 2`
      composes with `Legend 20` → 40 px.

## Notable delete

`chromatic_shift_png` response field + `DoFPointsTab`'s old
`figures[ch].tilt` consumer — both are now native.

## Net change

- `mantisanalysis/server.py`: +54 LoC (float32 grid packer + JSON
  fields).
- `mantisanalysis/shared.jsx`: +170 LoC (HeatmapCanvas + colormap LUTs).
- `web/src/analysis.jsx`: rewrite of FPN + DoF PNG tabs → native SVG
  + canvas; +~600 LoC of new components, −~180 LoC of old PNG-grid
  code. Net ≈ +420 LoC.
