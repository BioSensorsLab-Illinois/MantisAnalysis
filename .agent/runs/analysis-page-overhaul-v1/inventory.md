# Phase 0 inventory — analysis-page-overhaul-v1

Opened: 2026-04-23
Source of truth for every subsequent phase. Every file:line reference
points at the tree at commit `84a918b` (HEAD at session start).

Relevant absolute paths:
- `/Users/zz4/BSL/MantisAnalysis/web/src/analysis.jsx` (~3920 lines)
- `/Users/zz4/BSL/MantisAnalysis/web/src/shared.jsx` (~2220 lines)
- `/Users/zz4/BSL/MantisAnalysis/web/src/app.jsx` (sole `AnalysisModal` mount at 157)
- `/Users/zz4/BSL/MantisAnalysis/web/src/{fpn,dof,usaf}.jsx` — pre-analysis
  pickers, **zero** `style.*` consumption.

## A. DEFAULT_PLOT_STYLE fields (shared.jsx 128–172)

| Key | Default | Selected analysis.jsx refs | shared.jsx refs | Status |
|---|---|---|---|---|
| `fontFamily` | `'Inter Tight'` | 317, 1290, 2013, 2477, 2901 (many) | 260, 274, 289, 303, 330, 575 | alive |
| `titleSize` | `14` | 3349 | 257 | alive |
| `titleWeight` | `600` | 3350 | 258 | alive |
| `titleItalic` | `false` | 3351 | 259, 1969 | alive |
| `axisLabelSize` | `12` | 630, 631, 2959, 3204, 3790 (many) | 272, 1934 | alive |
| `axisLabelWeight` | `500` | 3542, 3549, 3790, 3795 | 273, 1951 | alive |
| `tickSize` | `10` | 590, 600, 606, 1002, 1129 (many) | 287, 582, 1936 | alive |
| `tickWeight` | `400` | none | 288 | partial — read only by `AxisTick` primitive which has no callers |
| `legendSize` | `11` | 649, 2014, 2100, 2972, 3076 (many) | 301, 576, 1938 | alive |
| `legendWeight` | `400` | 2101, 2973, 3077, 3109, 3217 (many) | 302, 577, 1959 | alive |
| `annotationSize` | `9.5` | 3782, 3848, 3853 | none | partial — `TiltPlaneSVG` + `PointsBarChart` value labels only |
| `elementScale` | `1.0` | >100 call sites via `scaled()` | 247, 1983 (slider) | alive |
| `chartScale` | `1.0` | none | 316 (`useChartSize` hook), 1987 (slider) | **dead** — `useChartSize` has no callers |
| `lineWidth` | `1.6` | 610, 619, 722, 1011, 1139 (many) | 1998 | alive |
| `markerSize` | `7` | 2118, 2125–2127, 3195, 3502, 3657–3660, 3831 | 2000 | alive |
| `markerStrokeWidth` | `0.9` | 1012, 2120, 2129, 2948, 3196 (many) | — | alive |
| `showGrid` | `true` | 2894, 2904, 3047, 3166, 3462, 3467, 3751 | 336, 2014 | partial — gates 7/15+ charts; others draw grid unconditionally |
| `gridWidth` | `0.5` | 589, 599, 1001, 1128, 1736 (many) | 340, 2019 | alive |
| `gridOpacity` | `0.6` | 2898, 2908, 3050, 3170, 3465 | 341, 2021 | partial — applied only on the `showGrid`-gated grids |
| `axisStrokeWidth` | `0.8` | 605, 727, 1006, 1132, 1750 (many) | 2002 | alive |
| `showLegend` | `true` | none | none | **dead** — never gated; legend renders unconditionally |
| `cardBackground` | `'panel'` | 2598–2599 (DoF modal body only) | 368, 2039 | alive, inconsistent |
| `cardBorder` | `true` | 3342 | 373, 2051 | alive via `cardChromeFor`/ChartCard |
| `cardBorderRadius` | `8` | via `cardChromeFor` | 374, 2056 | alive |
| `gridGap` | `14` | 39, 469, 2021, 2077 | 2031 | alive |
| `cardPadding` | `10` | via `cardChromeFor` | 375, 2033 | alive |
| `cardMaxWidth` | `0` | 39, 469 (GridTabFrame + MTFCurvesTab — latter shadows `style`, see §F) | 1783, 2036 | alive, leaky |
| `aspect` | `'auto'` | none | none | **dead** — defined + seeded in presets, no reader |
| `palette` | `'channel'` | indirect via `paletteColor(style, ch)` (≥30 sites) | 359, 2065 | alive |
| `exportScale` | `2` | 3255 | 2084 | alive |
| `exportFormat` | `'png'` | 3256 | 2092 | alive |
| `exportBackground` | `'auto'` | 3257 | 2101 | alive |

**Dead/partial count**: `aspect`, `chartScale`, `showLegend` fully dead;
`tickWeight` orphaned; `annotationSize` used in 3 places; `showGrid`
gates 7 of 15+ grid-drawing charts.

## B. Chart component catalog (analysis.jsx)

Legend for "Root": SVG = inline `<svg viewBox>`, div+canvas =
`HeatmapCanvas`, Plotly = `PlotlyChart`, table = HTML. "PNG"
inherit = comes from ChartCard.

### USAF modal (227–392)

| Component : lines | Parent | ChartCard? | Root | PNG? | style tokens read | Layout knobs | Empty state |
|---|---|---|---|---|---|---|---|
| `MTFCurvesTab` : 423–481 | USAF/mtf | no | div grid | no | `cardMaxWidth` (shadowed — see §F) | `gridStyleFor` | "No channels match" |
| `MiniMTFChart` : 522–663 | MTFCurvesTab | no (raw `cardChromeFor`) | SVG | no | `gridWidth`, `tickSize`, `axisStrokeWidth`, `lineWidth`, `axisLabelSize`, `markerStrokeWidth` | `viewBox 0 0 360 220`, `width="100%"`, **no preserveAspectRatio** | legend hides missing chips; no placeholder |
| `ProfileGalleryTab` : 667–686 | USAF/profiles | no (delegates) | GridTabFrame | no | none | `minCardPx=220` | "No lines/channels match" |
| `ProfileCard` : 688–738 | ProfileGalleryTab | no (raw `<div>` chrome, ignores `cardChromeFor`) | SVG | no | `lineWidth`, `axisStrokeWidth` | `viewBox 0 0 200 70`, `preserveAspectRatio="none"` | "— no data" when `!m` |
| `SummaryTableTab` : 743–841 | USAF/table | no | HTML table | no | — (ignores plotStyle) | scroll `maxHeight: calc(94vh - 320px)` | "No rows." |
| `DetectionHeatmapTab` : 846–895 | USAF/heatmap | no | div grid | no | — | `gridTemplateColumns: repeat(N, minmax(220px, 1fr)) 56px` | "No channels match" |
| `HeatmapPanel` : 897–937 | DetectionHeatmapTab | no (raw `cardChromeFor`) | CSS-grid cells (no SVG/canvas) | no | — | `gridTemplateColumns: '24px repeat(6, 1fr)'` | em-dash per empty cell |
| `Colorbar` : 939–952 | DetectionHeatmapTab | no | div + gradient | no | — | 200px min-height | n/a |
| `GroupSweepTab` : 957–972 | USAF/group | no | GridTabFrame | no | — | `minCardPx=260` | blank grid when `channels=[]` |
| `GroupMiniChart` : 974–1018 | GroupSweepTab | no (raw `cardChromeFor`) | SVG | no | `gridWidth`, `tickSize`, `axisStrokeWidth`, `lineWidth`, `markerStrokeWidth`, `palette` | `viewBox 0 0 260 170`, **no preserveAspectRatio** | returns `null` when no pts |
| `FFTMTFTab` : 1023–1050 | USAF/fft | no | dispatcher | no | — | toolbar | "No data to display" |
| `FFTMTFOverlay` : 1052–1090 | FFTMTFTab (ctf/coltman) | no | `PlotlyChart` inside chrome | no (Plotly modebar) | `palette` | `minHeight: 480px` outer, Plotly handles rest | Plotly empty axes |
| `FFTSpectraGrid` : 1092–1148 | FFTMTFTab (fft) | no (per-card `cardChromeFor`) | SVG per card | no | `gridWidth`, `tickSize`, `axisStrokeWidth`, `lineWidth`, `palette` | `viewBox 0 0 340 180`, `width="100%"` | per-channel `null` when empty |

### FPN modal (1165–1411)

| Component : lines | Parent | ChartCard? | Root | PNG? | style tokens | Layout | Empty |
|---|---|---|---|---|---|---|---|
| `FPNSummaryTab` : 1421–1661 | FPN/summary | no | HTML table | no | — | sticky thead, column menu | "No rows" |
| `FPNHistogramsTab` : 1663–1691 | FPN/hist | no | div grid | no | — | `auto-fill minmax(320px,1fr)` hard-coded, **not** `gridGap` | "Pick at least one channel + ROI" |
| `FPNHistChart` : 1693–1771 | FPNHistogramsTab | no (raw `cardChromeFor`) | SVG | no | `gridWidth`, `axisStrokeWidth`, `tickSize` | `viewBox 0 0 320 180` | "(no data)" card |
| `FPNProfilesTab` : 1776–1799 | FPN/profiles | no | GridTabFrame | no | — | `minCardPx=340` | "No measured data" |
| `RowColCard` : 1801–1872 | FPNProfilesTab | no (raw div, ignores `cardChromeFor`) | 2 stacked SVGs | no | `axisStrokeWidth`, `lineWidth`, `tickSize` | `viewBox 0 0 320 95` per svg | `plot()` null → empty `<g>` |
| `FPNPSD1DTab` : 1878–1902 | FPN/psd1d | no (inline card) | GridTabFrame | no | — | `minCardPx=360` | "No data." |
| `PSD1DChart` : 1904–1972 | FPNPSD1DTab | no | SVG | no | `gridWidth`, `tickSize`, `lineWidth`, `axisStrokeWidth` | `viewBox 0 0 340 120` | `return null` silently |
| `FPNFigureGrid` : 1986–2029 | FPN/map, /psd, /autocorr | delegates | div grid | via card | `fontFamily`, `legendSize`, `gridGap` | `auto-fit minmax(420px,1fr) gap: gridGap` | "No {label} data" |
| `FPNHeatmapCard` : 2035–2056 | FPNFigureGrid | **yes** | HeatmapCanvas + overlay SVG + colorbar | **yes via ChartCard** | (via ChartCard + HeatmapCanvas) | canvas 460×340, `aspectLock=true` | null when grid decode fails |
| `FPNHotPixTab` : 2062–2083 | FPN/hotpix | no | div grid | no | `gridGap` | `auto-fit minmax(460px,1fr) gap: gridGap` | "No data." |
| `HotPixCard` : 2085–2139 | FPNHotPixTab | **yes** | HeatmapCanvas + overlay SVG + HotColdList footer | **yes via ChartCard** | `legendSize`, `legendWeight`, `markerSize`, `markerStrokeWidth` | canvas 460 × aspect-locked | inner null when grid missing |
| `HotColdList` : 2141–2177 | HotPixCard footer | no | HTML | no | — | fixed 1fr 1fr | "No outliers" / `… X more` truncation |
| `FPNCompareTab` : 2182–2214 | FPN/compare | no (uses MetricBars) | div grid | no | — | `auto-fill minmax(420px,1fr)` hard-coded | "No data." |
| `MetricBars` : 2216–2278 | FPNCompareTab | no (raw `cardChromeFor`) | SVG | no | `gridWidth`, `tickSize`, `palette` | `viewBox 0 0 400 220` | no explicit empty, empty bars |

### DoF modal (2295–2631)

| Component : lines | Parent | ChartCard? | Root | PNG? | style tokens | Layout | Empty |
|---|---|---|---|---|---|---|---|
| `DoFSummaryTab` : 2696–2829 | DoF/summary | no | HTML table | no | — | column widths hard-coded | "No rows" |
| `DoFLinesTab` : 2831–2852 | DoF/lines | no | GridTabFrame | no | — | `minCardPx=420` | "No lines" |
| `LineOverlayChart` : 2854–2989 | DoFLinesTab | **yes** | SVG | **yes via ChartCard** | `showGrid`, `gridWidth`, `gridOpacity`, `tickSize`, `fontFamily`, `axisStrokeWidth`, `lineWidth`, `markerStrokeWidth`, `axisLabelSize`, `legendSize`, `legendWeight`, `palette` | `viewBox 0 0 420 260`, `preserveAspectRatio="xMidYMid meet"` | returns null when no series |
| `DoFMetricCompareTab` : 2994–3020 | DoF/metric | no | GridTabFrame | no | — | `minCardPx=380` | "No multi-metric data. Enable 'All 4 metrics' before running" |
| `MetricOverlayChart` : 3022–3092 | DoFMetricCompareTab | **yes** | SVG | **yes via ChartCard** | `showGrid`, `gridWidth`, `gridOpacity`, `lineWidth`, `axisStrokeWidth`, `legendSize`, `legendWeight`, `fontFamily` | `viewBox 0 0 380 220`, `preserveAspectRatio="xMidYMid meet"` | null when `xsPx` empty |
| `DoFChromaticTab` : 3097–3126 | DoF/chromatic | no | div wrapper | no | `legendSize`, `legendWeight`, `fontFamily` | `maxWidth: 640` hard-cap | "Need ≥2 channels and ≥1 line" |
| `ChromaticShiftChart` : 3128–3230 | DoFChromaticTab | **yes** | SVG | **yes via ChartCard** | `showGrid`, `gridWidth`, `gridOpacity`, `tickSize`, `fontFamily`, `lineWidth`, `markerSize`, `markerStrokeWidth`, `axisLabelSize`, `legendSize`, `legendWeight`, `palette` | `viewBox 0 0 400 260`, `preserveAspectRatio="xMidYMid meet"` | null when `allPeaks=[]` |
| `ChartCard` : 3326–3379 | wrapper (DoF/FPN heatmap + gaussian + etc.) | n/a | div chrome | **yes** (`onExport → mantisExport(cardRef, name, style, t.panel)`) | `titleSize`, `titleWeight`, `titleItalic`, `fontFamily`, `legendSize`, `legendWeight`, `cardBorder`, `cardChromeFor` | inline button `data-no-export` | children decide |
| `DoFGaussianTab` : 3385–3414 | DoF/gaussian | no | GridTabFrame | no | — | `minCardPx=440` | "No lines with sampled focus data" |
| `GaussianFitChart` : 3416–3576 | DoFGaussianTab | **yes** | SVG | **yes via ChartCard** | `showGrid`, `gridWidth`, `gridOpacity`, `axisStrokeWidth`, `lineWidth`, `markerSize`, `markerStrokeWidth`, `tickSize`, `fontFamily`, `axisLabelSize`, `axisLabelWeight`, `legendSize`, `legendWeight`, `palette` | `viewBox 0 0 460 260`, `preserveAspectRatio="xMidYMid meet"` | "fit did not converge" footer |
| `DoFHeatmapTab` : 3579–3614 | DoF/heatmap | no | GridTabFrame | no | `fontFamily`, `legendSize` (toolbar) | `minCardPx=460` | "No focus heatmap data" |
| `DoFHeatmapCard` : 3616–3701 | DoFHeatmapTab | **yes** | HeatmapCanvas + overlay SVG | **yes via ChartCard** | `lineWidth`, `markerSize`, `markerStrokeWidth`, `legendSize`, `fontFamily`, `axisStrokeWidth` (peak X mark) | canvas 480 × aspect-locked | null on grid decode fail |
| `DoFPointsTab` : 3705–3733 | DoF/points | no | GridTabFrame | no | — (delegates) | `minCardPx=480` | "No picked points" |
| `PointsBarChart` : 3735–3802 | DoFPointsTab | no (rendered inside parent ChartCard) | SVG | inherits parent ChartCard PNG | `legendSize`, `fontFamily`, `showGrid`, `gridWidth`, `gridOpacity`, `axisStrokeWidth`, `tickSize`, `annotationSize`, `axisLabelSize`, `axisLabelWeight` | `viewBox 0 0 460 180`, `preserveAspectRatio="xMidYMid meet"` | "(no points)" text |
| `TiltPlaneSVG` : 3807–3859 | DoFPointsTab (same ChartCard) | no | SVG | inherits parent ChartCard PNG | `axisStrokeWidth`, `markerSize`, `markerStrokeWidth`, `lineWidth`, `annotationSize`, `fontFamily` | `viewBox 0 0 460 240`, no explicit preserveAspectRatio | null when `!tilt || pts<3` |
| `LegacyPngModal` : 3864–3918 | AnalysisModal fallback (unreachable, §F) | n/a | `<img>` | no | — | 1400×92vh | "No figure" |

Summary of ChartCard adoption:
- **Using ChartCard (8)**: `FPNHeatmapCard`, `HotPixCard`, `LineOverlayChart`, `MetricOverlayChart`, `ChromaticShiftChart`, `GaussianFitChart`, `DoFHeatmapCard`, `DoFPointsTab` (wraps `PointsBarChart` + `TiltPlaneSVG` together).
- **Using raw `cardChromeFor` without ChartCard (6)**: `MiniMTFChart`, `HeatmapPanel`, `GroupMiniChart`, cards inside `FFTSpectraGrid`, `FPNHistChart`, `MetricBars`.
- **Ignoring `cardChromeFor` entirely (raw `<div>`)**: `ProfileCard`, `RowColCard`, `FPNPSD1DTab` inner div, `FPNFigureGrid` outer. **These won't react to `cardBackground`/`cardBorder`/`cardPadding` sliders.**

## C. Background hierarchy map — five concurrent sources

1. **Modal backdrop** — `rgba(10,12,18,0.62)`. USAF 315, FPN 1282, DoF 2469. Fixed.
2. **Modal panel (outer chrome)** — `t.panel`. USAF 316, FPN 1287, DoF 2474. Theme-only; plotStyle has no hook.
3. **Tab body** — three strategies:
   - **USAF & FPN**: `BgColorPicker` → localStorage → `effectiveBg = bgColor || t.panelAlt`. `background: bgColor==='transparent' ? 'transparent' : effectiveBg`, plus checker pattern when transparent. USAF 374–380, FPN 1375–1381. *Tab body background is user-controlled.*
   - **DoF**: reads `plotStyle.cardBackground` directly (2598–2600: `white → #ffffff`, `transparent → transparent`, else `t.panelAlt`). **No `BgColorPicker` in DoF modal** — inconsistent with USAF/FPN.
4. **Card chrome (`cardChromeFor`, shared 367–377)** — reads `style.cardBackground`. `panel → t.panel`, `white → #ffffff`, `transparent → transparent`. Also applies `cardBorder`, `cardBorderRadius`, `cardPadding`. Used by ChartCard (3329), `MiniMTFChart` (574), `HeatmapPanel` (903), `GroupMiniChart` (994), `FFTSpectraGrid` cards (1123), `FPNHistChart` (1722), `MetricBars` (2232). **NOT** used by `ProfileCard` (714), `RowColCard` (1844), `FPNPSD1DTab` inner div (1890).
5. **SVG surface** — every inline `<svg>` passes `style={{ background: 'transparent', borderRadius: 4 }}`. Every SVG is transparent; card chrome shows through.
6. **Inline `<rect fill=...>` bg inside SVG** — **none**. No chart paints a bg inside its SVG; letterboxing on export relies on (3)/(4).
7. **`mantisExport`'s `bgcolor` arg (3292)** — derived from `plotStyle.exportBackground`:
   - `transparent → no bgcolor`
   - `white → #ffffff`
   - `auto → themeFallbackBg` passed in by caller.
   - USAF/FPN pass `effectiveBg` (user picker); DoF passes `t.panelAlt`; ChartCard passes `t.panel`.
   - **Inconsistency**: DoF single-card PNG has `t.panel`, DoF tab PNG has `t.panelAlt`, DoF has no user override.

`t.panelAlt` (theme-only, not plotStyle) consulted at USAF 252, FPN 1185, DoF 2462/2600, `ProfileCard` 721, inside empty heatmap treatment 916.

## D. Export surface

| Path | Function : lines | Engine | Filename | Heatmap handling |
|---|---|---|---|---|
| Modal PNG — USAF | `exportPNG` : 302–311 | `mantisExport` → `window.domtoimage` toBlob/toSvg | `mantis-${tab}-${Date.now()}.{png|svg}` | SVG width/height freeze 3271–3283; canvas pixel-snapshotted |
| Modal PNG — FPN | `exportPNG` : 1266–1275 | `mantisExport` | `mantis-fpn-${tab}-${ts}` | same |
| Modal PNG — DoF | `exportPNG` : 2456–2465 | `mantisExport` (passes `t.panelAlt` fallback) | `mantis-dof-${tab}-${ts}` | same |
| Per-card PNG | `ChartCard.onExport` : 3331–3338 | `mantisExport(cardRef, name, style, t.panel)` | `${exportName || 'mantis-' + ch || 'mantis-chart'}-${ts}` lowercased | same |
| Core export util | `mantisExport` : 3250–3324 | dom-to-image-more; hides `[data-no-export]`; 15s timeout; fallback restore | `.png` or `.svg` per `style.exportFormat` | **no special canvas branch** — rasterized by dom-to-image |
| CSV (USAF/FPN/DoF) | 275–286 / 1222–1253 / 2396–2440 | `exportCSV` helper (shared 1376) | `mantis-<mode>-${ts}.csv` | n/a |
| JSON (USAF/FPN/DoF) | 288–297 / 1255–1262 / 2442–2453 | `exportJSON` helper (shared 1375) | `mantis-<mode>-${ts}.json` | n/a |
| Plotly `toImage` | PlotlyChart config 69 | Plotly internal | `mantis_chart` SVG scale 2 | n/a |
| Legacy PNG | LegacyPngModal 3910 | `<img src={base64}>`, no download wired | — | n/a |

Only one PNG engine (`mantisExport`) serves all three modals + ChartCard.
No helper composites canvas + SVG separately.

## E. Modal-shell duplication checklist

Every modal is a near-copy-paste of five pieces.

### Backdrop + outer panel + Escape hint
- USAF: 313–330. `rgba(10,12,18,0.62)`, onClick=onClose, inner card stops propagation. Header 319–330. Close button `title="Close (Esc)"` with **no key listener** attached.
- FPN: 1282–1315. Identical structure; same missing Esc listener (1314).
- DoF: 2469–2509. Identical; same missing Esc.

### PlotStyleCtx.Provider + per-modal state
- USAF: `plotStyleState = usePlotStyleState()` at 230; provider at 314 / close 390.
- FPN: 1168 / 1281 / 1409.
- DoF: 2298 / 2468 / 2629.

### Style panel toggle
- USAF: 231 (state), 325 (button), 331 (conditional panel).
- FPN: 1169, 1310, 1316.
- DoF: 2299, 2504, 2510.

### Filter bar
- USAF: 334–358. Channels + gain + direction + threshold slider + `BgColorPicker`.
- FPN: 1318–1359. Channels + gain + ROI segmented + Unit (DN/%DR) + `BgColorPicker`.
- DoF: 2512–2580. Channels + gain + Line segmented + (Metric, conditional) + Unit + Tilt input. **No `BgColorPicker`.**

### Tab rail
- USAF: 361–371 · FPN: 1361–1373 · DoF: 2582–2594. Identical button-rail structure, accent underline.

### Tab body wrapper
- USAF: 374–387 (uses `tabBodyRef`, bgColor + checker).
- FPN: 1375–1406 (same).
- DoF: 2596–2626 (uses `style.cardBackground`, no checker, no user bg).

### Tabs metadata + dispatcher
- Each modal has its own hard-coded `tabs` array (266–273 / 1209–1219 / 2386–2394), its own `tab` useState, and an if/else dispatcher (USAF 381–386, FPN 1382–1405, DoF 2601–2625).

## F. Deferred / dead / bug items

- **`LegacyPngModal`** (3864–3918): fallback in `AnalysisModal` dispatch 221 when `run.mode ∉ {usaf,fpn,dof}`. Mode is always one of those three → dead path. Safe to delete; Phase 8 sweep.
- **`PlotlyChart`** (51–78): called only by `FFTMTFOverlay` (1078). Candidate for removal if FFTMTFOverlay gets rewritten on the SVG primitive.
- **`chartScale`**: slider (1987) + hook `useChartSize` (314) defined but **zero callers**; the slider does nothing. Drop in Phase 2.
- **`aspect`**: in defaults (163), no reader, no slider → Phase 1 makes it alive (`useChartGeom`).
- **`showLegend`**: in defaults (150), never gated → Phase 6 wires it or Phase 2 drops it. Recommend wire in Phase 6 typography sweep.
- **`tickWeight`**: read only by `AxisTick` primitive that has no callers → Phase 6 typography sweep picks it up via `tokens(style)`.
- **TODO/FIXME/legacy/deprecated comments** (grep of analysis.jsx):
  - 3244 — "old transform-scale hack" historical note in `mantisExport`.
  - 3862 — "Legacy modal for modes that haven't been migrated (none left; here for safety)".
  - No `TODO:`, `FIXME:`, `XXX:`, `HACK:` markers.
- **Shadow bug in `MTFCurvesTab`** (423): local `style` (426) holds the MTF visual-style key (`'lines+markers'|'lines'|...`) that shadows the plotStyle `style`. Line 469 then reads `.cardMaxWidth` on a plain string → always `undefined` → the `cardMaxWidth` slider is silently ignored on the MTF curves tab. Fix in Phase 4 by renaming the local var (`styleMode`) or routing chart layout through `useChartGeom`.
- **Modal feature drift**:
  - **DoF modal lacks `BgColorPicker`** (USAF/FPN have it). Users can't change DoF export background without editing `plotStyle.exportBackground`, and DoF tab body ignores `bgColor` entirely. Fix in Phase 3 by unifying the filter bar.
  - `FPNHistogramsTab` (1678) and `FPNCompareTab` (2202) hard-code `gridTemplateColumns: repeat(auto-fill, minmax(...))` instead of using `GridTabFrame`/`gridStyleFor` → `cardMaxWidth` + user layout picker don't apply there. Fix in Phase 4 sweep.
  - No modal installs a keydown-Esc listener despite Close-button "(Esc)" hint. Closes work only via backdrop click. Fix in Phase 3 shell.

## G. Smoke baseline

Verified at commit `84a918b` on session open:

- Tier 1 — PASS (15 modules imported)
- Tier 2 — PASS (figures written to `outputs/smoke/`)
- 40/40 pytest green

## H. Phase → code-map crosswalk (for the next phases)

- Phase 1 creates: `<Chart>`, `useChartGeom`, `tokens()`, `<Page>`,
  `renderChartToPng` in `shared.jsx`; adds `pageBackground`,
  `chartBodyBackground`, wires existing `aspect`. Keep old exports live.
- Phase 2 prunes: `chartScale` + `useChartSize`. Consider renaming
  "Card bg" slider to "Page bg" after the shell is unified (Phase 3).
- Phase 3 splits: extract common modal shell + per-mode specs under
  `web/src/analysis/` (usaf.jsx, fpn.jsx, dof.jsx). Each exports
  `{ tabs, filterBar, defaultTab }`. Fix DoF bg picker here.
- Phase 4 rewrites 15 charts by order-of-simplicity above.
- Phase 5 ships `renderChartToPng` end-to-end; removes the
  SVG-width-freeze hack + transform-scale note from `mantisExport`.
- Phase 6 wires `showLegend`, `tickWeight`, adds empty states across
  the 6 places that currently render blank on no-data.
- Phase 7 adds `tests/web/test_analysis_*.py`.
- Phase 8 deletes `LegacyPngModal`, `PlotlyChart` wrapper (if
  FFTMTFOverlay is rewritten off Plotly), updates docs.
