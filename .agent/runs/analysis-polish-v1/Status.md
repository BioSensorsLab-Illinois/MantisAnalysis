# analysis-polish-v1 — Status

Opened: 2026-04-22
Last updated: 2026-04-22 (session in progress)

## Milestones

- [x] Baseline smoke tier 1+2 green.
- [x] Scope opened — ExecPlan.md written.
- [x] plotStyle defaults + PlotStyleCtx + usePlotStyle.
- [x] Styled-SVG primitives (`PlotTitle`, `AxisLabel`, `AxisTick`,
      `LegendLabel`, `GridLine`, `scaled`, `useChartSize`,
      `cardChromeFor`, `legendCssFor`, `plotPaletteColor`).
- [x] PlotStylePanel collapsible toolbar with typography / scale /
      lines / grid / layout / palette / export / presets sections.
- [x] Presets wired: Default / Publication / Presentation / Compact.
- [x] Provider + panel + export-scale/format/background wired into
      USAF / FPN / DoF modals.
- [x] GridTabFrame reads `style.gridGap`.
- [x] Font-family CSS cascade from modal root into inline SVG text
      that doesn't hardcode fontFamily.
- [x] Export pipeline: configurable scale (1/2/3/4×), configurable
      background (auto / white / transparent), SVG option.
- [x] Tier 1+2+3 smoke green.
- [x] Preview MCP validation — Style button opens panel, font
      dropdown switches live across modal + chart, Publication preset
      snaps typography + grid + background.
- [x] Docs: CHANGELOG + Status + ExecPlan done; B-0019, B-0020,
      B-0021 opened for follow-up work.

## Partial coverage (captured as B-0019)

~80 inline `fontSize={N}` / `strokeWidth={N}` /
`fontFamily="ui-monospace,..."` literals remain in the chart
components. Font family works via CSS cascade today; fontSize /
lineWidth / palette sliders need those literals replaced with
`scaled(N, style)` / `style.lineWidth` / `plotPaletteColor(...)` for
every chart. Scoped as B-0019 in the backlog.
