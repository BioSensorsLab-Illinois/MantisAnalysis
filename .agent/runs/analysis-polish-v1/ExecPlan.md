# analysis-polish-v1 — ExecPlan

Opened: 2026-04-22
Owner: agent
Driver: Zhongmin

## Why

User: *"I want much more flexibility but still organized for the analysis
result window for publication export, such as i should be able to
adjust plot font sizes, legend size, font, bold/regular, axis
sizes/axis font etc., and panel arrangement, I want all of this can be
adjusted and rendered in realtime, and make sure exported plots looks
the same as they were in the result page."*

The analysis modals today hard-code fontSize / fontFamily / strokeWidth
in each inline-SVG chart. For camera-ready figures the user needs
live-editable typography, lines, grid, palette, and layout, with
pixel-identical export.

## Scope — files expected to change

1. `web/src/shared.jsx` — add `plotStyle` defaults, `PlotStyleCtx` +
   `usePlotStyle` hook, `PlotStylePanel` collapsible toolbar,
   styled-SVG primitive components (`PlotTitle`, `AxisLabel`, `AxisTick`,
   `LegendLabel`, `GridLine`), export helpers.
2. `web/src/analysis.jsx` — thread `plotStyle` through every inline-SVG
   chart across the three modals; upgrade `GridTabFrame` to pick up
   style-driven gap + padding + aspect; upgrade every Plotly call-site
   to feed `plotStyle` into layout.font / xaxis.title.font / legend.font.
   Replace each hardcoded `fontSize={N}` with `style.axisLabelSize` etc.
3. Export fidelity — embed web fonts as base64 @font-face so the PNG
   export renders the chosen family without relying on machine-local
   fonts; add optional SVG export path (vector, perfectly scalable);
   scale selector (1× / 2× / 3× / 4×).

No backend changes. No new endpoints. Server-rendered PNGs (FPN 2-D
maps, DoF heatmaps, etc.) are out of scope for realtime restyling —
those come from matplotlib Agg on the server and are a one-time render.
The native-vector tabs ARE restyle-able and cover the USAF MTF curves,
profile gallery, group sweep, FFT spectra, FPN row/col profiles, 1-D
PSDs, ROI compare, DoF line scans, metric compare, chromatic shift,
points bar chart — everything the user normally puts in a paper.

## plotStyle default shape

```js
{
  // Typography
  fontFamily: 'Inter Tight',
  titleSize: 14, titleWeight: 600, titleItalic: false,
  axisLabelSize: 12, axisLabelWeight: 500,
  tickSize: 10, tickWeight: 400,
  legendSize: 11, legendWeight: 400,
  annotationSize: 9.5,

  // Lines / markers
  lineWidth: 1.6,
  markerSize: 7,
  markerStrokeWidth: 0.9,

  // Grid / axes
  showGrid: true,
  gridWidth: 0.5,
  gridOpacity: 0.6,
  axisStrokeWidth: 0.8,
  showLegend: true,
  legendPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'outside',

  // Background & border
  cardBackground: 'panel' | 'white' | 'transparent',
  cardBorder: true,
  cardBorderRadius: 8,

  // Layout (feeds GridTabFrame)
  gridGap: 14,
  cardPadding: 10,
  aspect: 'auto' | '4:3' | '16:9' | '1:1' | '3:4',

  // Palette
  palette: 'channel' | 'viridis' | 'magma' | 'mono-dark' | 'mono-light',

  // Export
  exportScale: 2,
  exportFormat: 'png' | 'svg',
  exportBackground: 'auto' | 'white' | 'transparent',
}
```

Persisted globally at `mantis/plotStyle`. One shared style applies
across all three modes; presets snap back to Default / Publication /
Presentation / Compact.

## PlotStylePanel

Collapsible toolbar BELOW the filter bar, above the tab body. Opens
when user clicks a "Style" button in the modal header. When open, it
takes ~140 px of vertical space; the tab body narrows. Closing it
pushes the tab body back to full height.

Sections, left to right, in one horizontal row (scrolls horizontally on
narrow modals):
- Typography: fontFamily, titleSize, axisLabelSize, tickSize, legendSize
- Weights: title weight, axis weight, legend weight
- Lines: lineWidth, markerSize, axisStrokeWidth
- Grid: showGrid toggle, opacity
- Layout: gap, padding, aspect
- Palette: channel / viridis / magma / mono
- Export: scale (1/2/3/4×), format (png / svg), background (auto / white / transparent)
- Presets: Default / Publication / Presentation / Compact (one-click)

## Validation strategy

- Preview MCP: open each modal, tweak each control, confirm live
  re-render. Verify fonts are picked up by dom-to-image-more (export a
  test PNG and eyeball).
- Compare screen and export at 2× and 4×; confirm no typography drift.
- Switch palette → verify all channel dots + legend swatches update.
- Switch to SVG export → verify output file parses as valid SVG in
  Chrome.
- Tier 1+2+3 smoke stays green (no backend regressions).

## Out of scope (B-backlog)

- Server PNG restyling (matplotlib figures). The matplotlib builders
  already respect `theme`; per-request restyle would require a new
  request path and cache invalidation — deferred.
- Per-tab custom style (one modal-wide style for now).
- Dark/light theme coupling beyond what the existing theme tokens give.
