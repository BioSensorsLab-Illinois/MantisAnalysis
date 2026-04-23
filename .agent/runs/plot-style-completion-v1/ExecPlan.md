# plot-style-completion-v1 — ExecPlan

Opened: 2026-04-23
Owner: agent (per user "for analysis result style, lots of control is
still not working at all … Also enforce absolutely no image as plot,
all plot need to be plotted in canvas in realtime")

## Problem

`backlog-cleanup-v1`'s B-0019 got the obvious SVG literals replaced
with `scaled(N, style)`. But user testing showed:

1. Many plotStyle controls still do nothing — font/scale/line sliders,
   bottom-legend sizes, showGrid / gridOpacity — because HTML chart-
   card chrome kept hardcoded literals and several inline SVG charts
   never honoured `showGrid` at all.
2. DoF "Gaussian fits", "Focus heatmaps", and the tilt plot inside
   "Points / tilt" were still server-rendered PNGs.
3. FPN "FPN map", "Power spectrum", "Autocorr", and "Hot pixels" tabs
   were all server-rendered PNGs.
4. DoF "Chromatic shift" still showed a server-rendered PNG alongside
   the native chart.

User asked for zero PNGs — everything on `<canvas>` or SVG, rendered
from server JSON in real time.

## Goal

- Delete every `<img src="data:image/png...">` from the analysis modals.
- Ship the 2-D arrays the old PNGs were drawn from (FPN image / fpn_map
  / psd_log / autocorr_2d; DoF heatmap / ROI image) inside the JSON
  response as compact base64-float32 grids.
- Build a `HeatmapCanvas` primitive that decodes those grids and paints
  them with a user-selectable colormap on a real `<canvas>`, with
  optional SVG overlay children for picks / markers / peak crosses.
- Rewrite every former PNG tab as a native canvas/SVG component that
  honours every plotStyle field (typography, weights, line widths,
  grid, markers, palette, card chrome).
- Make sure the remaining SVG chart cards (LineOverlayChart,
  MetricOverlayChart, ChromaticShiftChart) also honour the full
  plotStyle set so the user's sliders actually bite.

## Order

1. Extend server JSON
   - `mantisanalysis/server.py::_float32_grid` helper (base64 float32
     with p1/p99 stats + stride downsample above 64 k cells).
   - `_fpn_full_dict` ships `image_grid`, `fpn_map_grid`,
     `psd_log_grid`, `autocorr_grid`, `kept_mask_b64`.
   - `_dof_to_dict` ships `heatmap_grid`, `image_grid`, `heatmap_step`.
2. `shared.jsx` primitives
   - `decodeFloat32Grid(grid)` / `decodeUint8Mask(b64,h,w)`.
   - `colormapLUT(name, N)` + 9-stop cmaps (gray, viridis, magma,
     inferno, plasma, cividis, turbo, hot, rdbu, jet).
   - `HeatmapCanvas` that paints a 2-D grid with a colormap + optional
     SVG overlay; auto-letterboxes to source aspect; respects plotStyle
     card chrome.
   - `HeatmapColorBar` legend primitive.
3. `analysis.jsx` rewrites
   - DoF: `DoFGaussianTab` (native SVG fit-curve with CI band + DoF
     band), `DoFHeatmapTab` + `DoFHeatmapCard` (canvas + SVG overlay),
     `DoFPointsTab` + `TiltPlaneSVG` (native scatter + gradient arrow).
   - FPN: `FPNFigureGrid` (map/psd/autocorr all native canvas), new
     `FPNHeatmapCard`, native `FPNHotPixTab` + `HotPixCard`.
   - Drop the chromatic-shift server PNG from `DoFChromaticTab`.
   - Introduce a shared `ChartCard` component that applies
     `cardChromeFor(style, t)` + scaled title typography.
4. PlotStyle control wiring
   - Every `strokeWidth={style.lineWidth}` → `scaled(style.lineWidth,
     style)` so `Elements ×` scales lines too. Same for
     `axisStrokeWidth`, `gridWidth`, `markerStrokeWidth`.
   - SVG fontSize literals mapped by semantic role:
     `scaled(8.5|9|9.5, style)` → `scaled(style.tickSize, style)`
     `scaled(10, style)` → `scaled(style.axisLabelSize, style)`
     `scaled(10.5|11|11.5, style)` → `scaled(style.legendSize, style)`
     `scaled(12, style)` → `scaled(style.titleSize, style)`
   - `LineOverlayChart` / `MetricOverlayChart` / `ChromaticShiftChart`
     chart-card chrome + HTML legend/title fonts routed through
     plotStyle.
   - Grid visibility gated on `style.showGrid`; `strokeWidth` +
     `opacity` use `gridWidth` + `gridOpacity`.
5. Picker side
   - `include_pngs: false` in DoF + FPN run payloads so the server
     stops wasting CPU on figures nobody looks at.
6. Smoke + browser verification.

## Non-goals

- Every small-chart card in USAF (`MiniMTFChart`, `ProfileCard`,
  `GroupMiniChart`, `FFTSpectraGrid`) already got its SVG fontSize /
  strokeWidth / fontFamily wired in B-0019. They inherit the semantic
  fontSize mapping from step 4 automatically. HTML card chrome + legend
  fonts for those cards is follow-on polish (tracked as a new backlog
  item if needed).
