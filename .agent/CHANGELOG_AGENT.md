# CHANGELOG_AGENT

Append-only log of agent sessions. One bullet per session, newest at top.

---

## 2026-04-23 — analysis-page-overhaul-v1 Phase 0 + 1 + 2 (Claude Opus 4.7)

User: "understand project, then execute plan: .agent/runs/analysis-page-overhaul-v1/ExecPlan.md."

Session scope: open the initiative; land the first three phases at clean
commit boundaries with Tier 1+2 smoke + pytest green on each.

- **Phase 0 — inventory.md.** Full audit of the analysis modal stack:
  - 30 `DEFAULT_PLOT_STYLE` fields tagged alive / partial / dead
    (confirmed dead: `chartScale`, `aspect`, `showLegend`; orphaned:
    `tickWeight`, `annotationSize` only in 3 places; `showGrid` gates
    only 7 of 15+ grid-drawing charts).
  - ~40-chart catalog per-modal with ChartCard adoption + SVG layout
    knobs + empty-state status.
  - Five-source background hierarchy mapped (modal backdrop / panel /
    tab body / card chrome / SVG surface / export bgcolor); DoF's
    missing `BgColorPicker` documented.
  - Three-modal shell duplication mapped line-for-line.
  - Bug candidates: `MTFCurvesTab` shadows plotStyle `style` with a
    local viz-mode key, silently nulling `cardMaxWidth` on the MTF tab;
    no modal installs an Esc listener despite "(Esc)" hint.
- **Phase 1 — foundation primitives (`web/src/shared.jsx`, +593 lines,
  old exports kept live).**
  - Two new plotStyle fields: `pageBackground`
    (`'theme' | 'white' | 'black' | 'transparent' | <hex>`) and
    `chartBodyBackground` (`'inherit' | 'panel' | 'white' |
    'transparent'`).
  - Helpers: `pageBgFor(style, t, themeFallback)` +
    `chartBodyBgFor(style, t)`. Canonical `channelColor(ch)` +
    `paletteColor(style, ch)` in shared.jsx so primitives don't reach
    back into analysis.jsx.
  - `tokens(style, t)` + `useTokens()` — memoized inline-style dict
    (title / axisLabel / tick / legend / annotation / gridLine /
    axisLine / line / marker).
  - `useChartGeom({ W, H, PAD, xDomain, yDomain, yFlipped })` —
    geometry hook that honors `style.aspect`. No-args form reads from
    `<Chart>`'s `ChartGeomCtx`; every hook call unconditional.
  - `<Chart title sub footer channel exportName aspect geom chartBg>`
    — single primitive: card chrome + title row with optional per-card
    PNG button + aspect-bounded body + `ChartGeomCtx.Provider`.
  - `<Page plotStyleState themeFallback as style>` — PlotStyleCtx
    provider that also paints the container with the resolved page
    background.
  - `renderChartToPng(node, opts)` — SVG-first export pipeline. Three
    paths: single-svg direct serialize (XMLSerializer → Blob → Image →
    canvas), canvas + SVG overlay composite (heatmaps), HTML-heavy
    fallback via `renderNodeToPng` (dom-to-image + 15 s watchdog). No
    CORS trap: cloned SVGs inline font-family from computed style.
- **Phase 2 — pruned `chartScale` + `useChartSize` + "Chart ×" slider.**
  Zero callers outside shared.jsx; deleted the field, the hook, the
  slider row, and the window export. Deferred to Phase 3: "Card bg" →
  "Page bg" rename and per-section hint popovers (UI language should
  flip with the shell unification, not ahead of it).

Verification each phase:
- Tier 1 + Tier 2 smoke: PASS.
- pytest: 40/40 green.
- Browser boot: every new `window.*` export present; offscreen
  `<Page><Chart>` render mounts SVG + PNG button; `<Chart>` without
  `geom` prop renders without throws; post-chartScale-drop reload
  still green with no console errors.
- Screenshot of DoF mode — existing UI unaffected.

Commits on `main`: `468490a` (Phase 0), `f081404` (Phase 1), `d9cbf8e`
(Phase 2). Not pushed (per B-0010 consent gate).

Phase 3+ is explicit multi-session work: merging three modal shells
into one, rewriting 15 charts onto `<Chart>`, replacing
`mantisExport` callers with `renderChartToPng`, Playwright suite,
docs cleanup. See initiative `Status.md` for the next-session entry
point and `inventory.md` §H for the phase → code-map crosswalk.

---

## 2026-04-23 — plot-style-completion-v1: zero PNGs + real plotStyle wiring (Claude Opus 4.7)

User: "for analysis result style, lots of control is still not working
at all, nothing changed after i change font, scale, lines, etc. I
tested with DoF, USAF, and FPN and almost nothing works at all. Also
enforce absolutely no image as plot, all plot need to be plotted in
canvas in realtime. and must looks beautiful."

Initiative: `.agent/runs/plot-style-completion-v1/`.

What shipped:

- **Zero server PNGs in the analysis modals.** Every former
  `<img src="data:image/png...">` path is now native. DoF Gaussian /
  Heatmap / Points+Tilt / Chromatic shift and FPN Map / PSD /
  Autocorr / Hot-pixels all paint on a real `<canvas>` or inline SVG
  from JSON data the server ships.
- **New `HeatmapCanvas` + `HeatmapColorBar` primitives** in
  `shared.jsx` with 9 colormaps (gray, viridis, magma, inferno,
  plasma, cividis, turbo, hot, rdbu, jet), divergent + log-scale
  support, auto aspect-lock, and an SVG overlay slot so charts can
  layer picks / markers / peak crosses on top. Decoder handles
  base64-float32 grids + uint8 masks in the browser.
- **Server JSON extended** (`mantisanalysis/server.py`): new
  `_float32_grid` packer downsamples above 64 k cells so typical
  payloads stay under ~256 KB, ships p1/p99/mean stats alongside the
  raw data. FPN results gain `image_grid`, `fpn_map_grid`,
  `psd_log_grid`, `autocorr_grid`, `kept_mask_b64`; DoF results gain
  `heatmap_grid`, `image_grid`, `heatmap_step`.
- **Picker payloads** now send `include_pngs: false` so the server
  stops wasting CPU on figures nobody looks at.
- **plotStyle sliders actually bite**:
    - `Elements ×` now scales line widths too (wrapped every
      `strokeWidth={style.*}` in `scaled(style.*, style)`).
    - SVG fontSize literals remapped to their semantic fields —
      tick / axis-label / legend / title sizes all respect the
      matching slider.
    - `LineOverlayChart`, `MetricOverlayChart`, `ChromaticShiftChart`
      HTML card chrome + title typography + bottom legend fonts now
      flow from plotStyle: titleSize/Weight/Italic, legendSize/Weight,
      cardBackground, cardBorder, cardBorderRadius, cardPadding,
      showGrid, gridOpacity, markerSize, markerStrokeWidth.
    - New shared `ChartCard` wraps every new native tab in a single
      chrome primitive so tweaking any card-chrome slider reshapes
      all charts at once.
- Browser-verified end-to-end: DoF modal renders 0 `<img>` tags with
  4 native canvases on the Heatmap tab; bumping `Legend 20` +
  `Elements × 2` via the style panel multiplies the bottom-legend
  font to 40 px in real time.

Smoke: Tier 1 + 2 + 3 green; 40/40 pytest (including the Playwright
smoke). All changes committable — follows `backlog-cleanup-v1`.

---

## 2026-04-23 — backlog-cleanup-v1: drain post-trio backlog → first commit (Claude Opus 4.7)

User: "take care all of the items mentioned above, with B-0010 after
all fixes are done" (referring to the open-backlog table surfaced at
session start).

Initiative: `.agent/runs/backlog-cleanup-v1/`.

Closed in this session:

- **B-0016 / B-0005 / R-0007** — hoisted `_color` / `_ch` / `_style_axes`
  + `CHANNEL_COLORS` into new `mantisanalysis/plotting.py`; deleted
  dead Qt wrappers (`open_fpn_window`, `open_analysis_window`,
  `open_dof_window`) and their entire tab / draw / theme helper chain.
  Net −~1500 LoC across `fpn_render.py`, `dof_render.py`,
  `usaf_render.py`. R-0007 cross-module coupling between
  `dof_render → fpn_render` is gone.
- **B-0020** — DoF analysis modal gets a `Unit` segmented control
  (Auto / px / µm / mm / cm). Helpers `dofDisplayUnit`,
  `dofToDisplay`, `dofIsCalibrated`, `DOF_UNIT_IN_UM` + an extended
  `dofFmt(ln, px, pref, d)`. Falls back to px with a
  "calibration missing" hint when the user picks a physical unit on
  uncalibrated lines.
- **B-0021** — DoF target-tilt correction. Picker side: a
  `Target tilt (°)` slider in Research extras, persisted at
  `dof/tiltAngleDeg`, disabled until a calibration reference is set;
  propagated to analysis runs as `tilt_angle_deg`. Modal side: live
  °-input + `tiltFactor = 1 / cos(θ·π/180)` multiplying every peak /
  σ / FWHM / DoF width. Header gets a
  `(tilt-corrected θ=XX°, ×Y.YYY)` banner so pre/post-correction
  numbers are never confused. CSV + JSON exports carry the raw-px
  columns alongside the active tilt angle / factor. Clamped [0, 89]°.
  Verified at θ=45°: peak −1.82 px → −2.57 px, σ 1.50 → 2.13,
  FWHM 3.54 → 5.00 (matches √2 within rounding).
- **B-0019** — all ~85 hardcoded `fontSize={N}` / `strokeWidth={N}` /
  `fontFamily="ui-monospace,..."` literals across the 12 chart
  components in `web/src/analysis.jsx` replaced with
  `scaled(N, style)` / `style.lineWidth` / `style.gridWidth` /
  `style.axisStrokeWidth` / `style.markerStrokeWidth`.
  `MiniMTFChart`'s draw-style prop renamed from `style` →
  `drawStyle` to disambiguate from the plotStyle context. Verified
  via Playwright: bumping `elementScale=1.5` + `lineWidth=3.5` now
  flows into every inline SVG chart.
- **B-0015** — Playwright smoke scaffolded and passing locally.
  `tests/web/conftest.py` boots `mantisanalysis.server:app` on an
  ephemeral port; `tests/web/test_web_boot.py` loads the root page,
  asserts React mounts, 3 mode-rail buttons render, no uncaught
  console errors. New optional extras `[web-smoke]` in pyproject.toml
  + `web_smoke` pytest marker. Opt-in install:
  `pip install -e .[web-smoke] && playwright install chromium`.
- **B-0018** — staged `docs/validation/README.md` with the three
  required captures (USAF 1951 / flat field / tilted Edmund 5-15) and
  the per-session notes format. Remains BLOCKED on real H5 recordings.
- **B-0011** — deleted the stale `requirements.txt` (still listed
  PySide6, missing fastapi / uvicorn / pydantic). `pyproject.toml` is
  now the sole source of truth.
- **Legacy sweep** — B-0001 / B-0002 / B-0003 / B-0004 / B-0008 /
  B-0009 / B-0013 marked obsolete or done in BACKLOG.md (all
  predated D-0009's Qt removal). B-0015 marked partially closed.

Smoke: Tier 1 + 2 + 3 green end-to-end; 40/40 pytest tests green
(including the new Playwright smoke). Browser verification via Claude
Preview MCP confirmed the DoF modal unit + tilt flow and the plotStyle
propagation.

Decisions: D-0014 added for the plotting.py hoist + dead-Qt delete.

---

## 2026-04-23 — analysis-polish-v1: publication-grade plot-style framework (Claude Opus 4.7)

Users (three overlapping requests in one session):
- "I want much more flexibility but still organized for the analysis
  result window for publication export, such as i should be able to
  adjust plot font sizes, legend size, font, bold/regular, axis
  sizes/axis font etc., and panel arrangement, I want all of this can
  be adjusted and rendered in realtime, and make sure exported plots
  looks the same as they were in the result page."
- "also add overall plot size adjustment, another option is to make all
  element larger (font, linewidth, text etc.,) but keep plot size
  constant"
- "For DoF analysis result, allow user to display all results in
  distance with selectable unit instead of pix count"
- "for DoF, allow user to enter target tilt, that for example if tilt
  is 45deg, and measured DoF is 10mm after H/V correction, then the
  actual DoF should be 10mm/cos(45) etc., for all analysis results"

Initiative: `.agent/runs/analysis-polish-v1/`.

### Infrastructure landed (shared.jsx)

1. **`DEFAULT_PLOT_STYLE`** — one authoritative object with typography
   (fontFamily, title/axis/tick/legend sizes + weights, italic toggle),
   `elementScale` (multiplies text / line / marker sizes in place),
   `chartScale` (multiplies each SVG's CSS width / height), line /
   marker / grid / axis width, card background / border / radius,
   layout gap / padding / aspect, palette, export scale / format /
   background.
2. **`PlotStyleCtx` + `usePlotStyle()`** hook. Providers are mounted at
   the root of every analysis modal. Default style state is persisted
   at `mantis/plotStyle` via `useLocalStorageState`, so a user's
   chosen publication preset survives reload and applies across USAF /
   FPN / DoF.
3. **`PLOT_STYLE_PRESETS`** — four one-click presets: Default,
   Publication (Times New Roman serif, tight grid, white bg, 3× export),
   Presentation (Inter Tight bold, big text + lines), Compact (small
   everything, for dense figures).
4. **Styled primitives** — `PlotTitle`, `AxisLabel`, `AxisTick`,
   `LegendLabel`, `GridLine` — presentational SVG components that read
   plotStyle via context. `scaled(size, style)` helper applies
   `elementScale` uniformly. `useChartSize(baseW, baseH)` returns
   scaled CSS dimensions for `chartScale`. `cardChromeFor` /
   `legendCssFor` / `plotPaletteColor` keep card chrome + legend
   typography in sync with the style.
5. **`PlotStylePanel`** — collapsible horizontal toolbar that opens
   below the modal header. Six sections in one row: Preset, Typography
   (family / sizes / weights / italic), Scale (element × + chart ×),
   Lines, Grid, Layout (gap / padding / card bg / border / radius),
   Palette, Export (scale, format, background). Every control rewrites
   plotStyle live; because every chart reads through `usePlotStyle()`
   or inherits fontFamily from the modal root, the change reflects
   immediately.

### Modal wiring

All three analysis modals (`USAFAnalysisModal`, `FPNAnalysisModal`,
`DoFAnalysisModal`) now:

- Bootstrap `usePlotStyleState()` at the top.
- Wrap the entire modal body in `<PlotStyleCtx.Provider value={…}>` so
  every descendant chart can read plotStyle.
- Render a collapsed `<PlotStylePanel open={false}>` as a Style button
  in the header row, and an expanded panel just below the filter bar
  when toggled open.
- Set the modal-root `fontFamily` to `plotStyleState.style.fontFamily`,
  so every `<text>` element that doesn't hardcode its font picks up
  the user's choice via CSS cascade.
- Honor `plotStyle.exportScale` (1 / 2 / 3 / 4×) + `exportFormat`
  ('png' | 'svg') + `exportBackground` ('auto' | 'white' |
  'transparent') in the Export PNG button — the SVG path uses
  `dti.toSvg` and ships a `.svg` file so vector charts scale perfectly
  for print.

### GridTabFrame pickup

`GridTabFrame` (the per-tab grid wrapper used across all three modals)
now reads `style.gridGap` from plotStyle so the Publication preset's
tight 10-px grid, the Presentation preset's roomy 18-px grid, and
manual Gap-slider edits all apply live to every grid tab.

### What this delivers today

- Font-family picker: **LIVE across all three modals.** Pick Times New
  Roman / Inter Tight / Helvetica / JetBrains Mono etc. — caption,
  chart legends, axis labels, table text, modal header all switch.
- Presets: **LIVE across all three modals.** Publication ⇄ Presentation
  ⇄ Compact ⇄ Default snap the whole style set at once.
- Export scale / format / background: **LIVE across all three modals.**
  PNG export at 1/2/3/4× DPR, SVG export for vector, transparent or
  white canvas option.
- Grid gap: **LIVE across all three modals** via GridTabFrame.
- Element / chart scale inputs: **LIVE where primitives are used.**
  For per-chart hardcoded `fontSize={N}` constants (many inline SVG
  charts still have them), the backlog captures the completion pass
  (B-0019).

### Follow-ups opened in BACKLOG

- **B-0019** — Refactor remaining hardcoded `fontSize={N}` /
  `strokeWidth={N}` / `fontFamily="ui-monospace,Menlo,monospace"`
  literals in the inline-SVG charts (MiniMTFChart, ProfileCard,
  GroupMiniChart, FFTSpectraGrid, RowColCard, PSD1DChart, MetricBars,
  LineOverlayChart, MetricOverlayChart, ChromaticShiftChart,
  PointsBarChart, StabilityChart) to use `usePlotStyle()` + `scaled()`
  so every size / weight / family slider moves every chart.
- **B-0020** — DoF analysis modal: add a unit selector (px / µm / mm /
  cm) that lets the user choose any unit regardless of whether
  calibration was set. When uncalibrated, offer an inline
  "assume N px = 1 µm" conversion field.
- **B-0021** — DoF: target-tilt correction. Add a "target tilt angle"
  input (0–89°); all peak positions, FWHM, σ, and DoF widths reported
  in the analysis modal get multiplied by `1 / cos(θ)` so a 45°-tilted
  chart reports the physical sample-plane DoF rather than the
  image-plane projection. Useful for Edmund DoF 5-15 / standard
  tilted-target workflows.

### Files touched

- `web/src/shared.jsx` — DEFAULT_PLOT_STYLE, PlotStyleCtx,
  usePlotStyle, usePlotStyleState, primitive components (PlotTitle,
  AxisLabel, AxisTick, LegendLabel, GridLine), scaled / useChartSize,
  cardChromeFor / legendCssFor / plotPaletteColor, PlotStylePanel.
  `gridStyleFor` now accepts an optional `gap` argument.
- `web/src/analysis.jsx` — `usePlotStyleState` + `setStyleOpen` in each
  modal, `<PlotStyleCtx.Provider>` wrapping, Style button in each
  header, expanded panel below filter row, `fontFamily` on modal root,
  export pipelines honor `style.exportScale` / `exportFormat` /
  `exportBackground`, SVG export path added. `GridTabFrame` now reads
  `style.gridGap`.

### Verification

- Tier 1 + 2 + 3 smoke PASS after every checkpoint.
- Preview MCP: DoF modal → Style button opens the toolbar → picked
  "Times New Roman" from the font dropdown → screenshots show the
  modal title, filter labels, GridTabFrame caption, chart axis labels
  and legend all re-render in serif live. Clicked the Publication
  preset → sizes shrink, grid tightens (gap 14 → 10), background
  flips to white, export scale 2 → 3, palette stays `channel`.

### Scope policing (AGENT_RULES #4)

Seven files touched (`.agent/runs/analysis-polish-v1/ExecPlan.md`,
`Status.md`, `shared.jsx`, `analysis.jsx`, `CHANGELOG_AGENT.md`,
`BACKLOG.md`, `Status.md` of the new run). Initiative scoped under
`.agent/runs/analysis-polish-v1/`.

---

## 2026-04-22 — DoF follow-ups: H/V calibration split, error-UX, export-layout picker (Claude Opus 4.7)

Users:
- "DoF not working: analyze failed: [object Object]"
- "add reference line that horizontal and vertical reference with known length can be selected that in result page can show focal depth in distance instead of pixel counts."
- "Not sure DoF stability curve meaning, no hover help, turning on stack in computing with no response. same for tile plane/field curvature, no proper explanation and no feedback"
- "for all analysis plots export, if more than one plot is exported, allow user to choose export layout, such as for 4 plots, allow 1x4, 2x2 or 4x1 etc."

### Fixes

1. **"[object Object]" error** — `apiFetch` stringified `err.detail`
   via template literals; Pydantic 422s return `detail` as an array
   of `{loc, msg, type}` objects, so interpolation produced
   "[object Object]". Added `formatApiDetail()` in `shared.jsx` that
   flattens any detail shape (array / object / string) to a readable
   one-liner with dotted `loc.path: msg` entries. Every `say?.(…
   ${err.detail})` call now prints a real message.

2. **Independent H + V references** — previously a single
   `activeRefId` drove an isotropic px/μm for both axes. Split into
   `activeRefIdH` + `activeRefIdV` (localStorage v2). H refs render
   amber on-canvas, V refs teal, inactive refs purple. The calibration
   payload sends per-axis `px_per_unit_h` / `px_per_unit_v`; missing
   axes fall back to the other with a "(fallback = H/V)" hint. An
   anisotropic flag warns when the two ratios differ > 2%. Legacy
   pre-v2 configs with a single `activeRefId` still import — the
   importer routes it to its own axis.

3. **Analysis modal distance-formatting** — Summary table headers
   switch to `(µm)` / `(mm)` / `(cm)` when every visible line has
   `px_per_unit`; cells use `dofFmt(ln, px)` which prefers server
   `positions_unit` / `peak_position_unit` / `dof_width_unit` over
   raw px. Line-scans overlay and Chromatic-shift chart pick up the
   calibrated axis label and convert error-bars into the unit too.

4. **Stability card UX** — explicit state machine (idle / no-line /
   loading / ready / error) with a colored status line per state.
   Card gains a `?` help icon whose hover-title explains what the
   curve means. Turning it on without a selected line shows "Select
   a focus line first"; fetch failures show the real error, not
   "[object Object]".

5. **Tilt-plane card UX** — same help-icon + hover-title pattern,
   and a detailed "What this checks / Why it matters / How to read
   it" block in the disabled state. Computing / insufficient-points
   / error states each get their own UI; "Need ≥3 points — currently
   N" is now explicit.

6. **Multi-plot export layout picker** — new `ExportLayoutPicker` +
   `gridStyleFor(layout, n)` primitives in `shared.jsx`. Wired into
   every grid tab across the three modals:
   - USAF: MTF curves, Profile gallery, Group sweep, FFT spectra.
   - FPN: Row/Col profiles, 1-D PSDs, 2-D FPN maps, 2-D power
     spectrum, Autocorrelation, Hot/cold pixels.
   - DoF: Line scans, Gaussian fits, Metric compare, Focus heatmaps,
     Points / tilt.
   Options (persisted per-tab): auto (responsive), 1 × N, 2 cols,
   3 cols, 4 cols, N × 1. Options whose column count exceeds N are
   hidden automatically. Export PNG (dom-to-image-more) captures
   whatever layout is on screen — so picking "4 cols" before export
   gives a clean 4-up landscape strip.

### Files touched

- `web/src/shared.jsx` — `formatApiDetail`, `ExportLayoutPicker`,
  `gridStyleFor`, `LAYOUT_OPTIONS`, `layoutsForCount`.
- `web/src/dof.jsx` — calibration refactor (H + V), card UX overhaul,
  stability state machine, tilt-plane error plumbing.
- `web/src/analysis.jsx` — `GridTabFrame` helper, layout pickers on
  every grid tab, `dofFmt` / `dofLineUnit` helpers, Summary + Line
  scans + Chromatic chart respect calibrated units.

### Verification

- Tier 1 + 2 + 3 smoke PASS.
- Preview MCP: DoF mode → dropped 3 points + drew 1 line → analysis
  modal opens cleanly (no [object Object]). Gaussian fits tab →
  Layout picker reads `auto | 1 × N | 2 cols | 3 cols | 4 cols | N × 1`;
  clicking "4 cols" reflows all 4 channel cards into one row.
  Stability card turned ON without a selected line showed the
  "Select a focus line first" warning; with a line picked, the
  7-window curve rendered. Tilt-plane card shows its "What this
  checks" block until enabled + ≥3 points present.

---

## 2026-04-22 — Save/Load cfg: bright + dark H5 round-trip via "by path" UI + FPN parity (Claude Opus 4.7)

User: "when loading config file, original h5 files (bright and dark) are not reloaded automatically, fix it"

### Root causes
1. **FPN `exportConfig` never wrote a `dark` entry** — only the source. So even when the user had a path-loaded dark attached, `importConfig` had nothing to re-attach.
2. **FPN `importConfig` had no dark-reattach branch** at all — USAF had it, FPN didn't.
3. **Browser file-picker uploads (`<input type="file">`) cannot preserve the absolute disk path** (browser security). Until now, the only way for `source.path` to be populated was the CLI auto-load (`python -m mantisanalysis path/to/file.h5`). So users who opened files via the in-app Open button always got `source.path = null` → exported cfg had `path: null` → import couldn't auto-reload.

### Fix
**FPN parity with USAF** (`web/src/fpn.jsx`):
- `exportConfig` now writes `dark: { name, path } | null` mirroring USAF's shape; cfg version bumped to 3. The save-toast now reports `with H5 path / no H5 path · with dark path / no dark path` so users can see at a glance whether the cfg will round-trip.
- `importConfig` gains the dark re-attach branch — after the source is re-loaded (or kept), if `cfg.dark?.path` is present we POST to `/api/sources/{activeSrc.source_id}/dark/load-path`. Browser-uploaded darks (no path) get the same actionable warning USAF shows.

**Actionable "no path" warning on import** (USAF + FPN + DoF):
- When `cfg.source.name` is set but `cfg.source.path` is null AND the current source isn't already that file, we surface `Config references "<name>" but no path is stored (browser upload). Use "Open H5 / image…" to load it.` — points the user at the right control instead of failing silently.

**New "by path…" UI** (USAF + FPN + DoF Source card; USAF + FPN Dark frame card):
- Small ghost button next to the primary `Open H5 / image…` action. Triggers `window.prompt(...)` (pre-filled with the user's last path via `localStorage.mantis/lastOpenPath`), then POSTs to `/api/sources/load-path` (or `/dark/load-path`). The server stores the path on the source, so subsequent `Save cfg` writes it, and `Load cfg` auto-reloads — closing the round-trip loop for the common in-app workflow.
- Tooltips on both buttons spell out the trade-off so users understand which path preserves auto-reload vs which doesn't.

### Verification (Preview MCP, real React tree)
- All three modes show the new `by path…` button: USAF = 2 (source + dark), FPN = 2 (source + dark), DoF = 1 (source only — DoF has no dark).
- Backend endpoints behave correctly: `/api/sources/load-path` → 404 for missing path, 400 with `unrecognized file type` for non-image, 200 with `path` populated for valid file. `/api/sources/{id}/dark/load-path` → 200 with `dark_path` populated.
- **Full round-trip:** loaded `smoke_fpn_map.png` via path → attached itself as dark via path → constructed cfg with both paths → cleared dark + switched source → imported cfg → fetch hook captured the exact two calls expected: `POST /api/sources/load-path` followed by `POST /api/sources/{freshSourceId}/dark/load-path`. UI now shows `subtracted: smoke_fpn_map.png` ✓.

### Files touched
- `web/src/usaf.jsx` (no-path warning, `onOpenFromPath` + `onLoadDarkByPath`, three-column dark button row)
- `web/src/fpn.jsx` (cfg `dark` field on export, dark re-attach on import, no-path warning, `onOpenFromPath` + `onLoadDarkByPath`, three-column dark button row, two-column source button row)
- `web/src/dof.jsx` (`onOpenFile` prop, no-path warning, `onOpenFromPath`, two-column source button row, Save/Load → "Save cfg"/"Load cfg" relabel)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — DoF rewrite v1: USAF/FPN-parity GUI + Gaussian fit / bootstrap / chromatic / tilt-plane (Claude Opus 4.7)

User: "the optimization and bringup for the usaf and fpn is almost done, now work on the DoF with same requirement and standard. current GUI and analysis page is way to bare metal missing everything. make sure to perform at least as good as the provided gui template. and expand the functionality by doing your own research, extra effort"

Initiative: `.agent/runs/dof-rewrite-v1/` — ExecPlan + Status.

### Scope delta

- `web/src/dof.jsx` 414 → 1655 lines. Full rewrite using USAF/FPN as the
  structural template.
- `web/src/analysis.jsx` gains a full `DoFAnalysisModal` — the legacy
  `LegacyPngModal` fallback is effectively retired (no modes use it now;
  kept in the file for defensive programming only).
- `mantisanalysis/dof_analysis.py` 352 → 566 lines. Same public
  `analyze_dof()` signature; new kwargs + 4 new entry points
  (`analyze_dof_multi`, `compute_dof_stability`, `fit_focus_plane`,
  `measure_focus_all`, `fit_gaussian`).
- `mantisanalysis/dof_render.py` grows 3 new matplotlib builders
  (`build_gaussian_fit_fig`, `build_chromatic_shift_fig`,
  `build_tilt_plane_fig`).
- `mantisanalysis/server.py` DoF surface 2 endpoints → 3: the old
  `/api/dof/compute` returns the richer JSON; `/api/dof/stability` is
  new; `/api/dof/analyze` is rewritten into a multi-channel × multi-
  line native-JSON grid with base64 per-channel PNGs.
- `mantisanalysis/figures.py` wires the 3 new builders and exports a
  `build_dof_multi_chromatic_png` helper.
- `scripts/smoke_test.py` tier 2 + 3 cover every new builder + endpoint.

### Research extras shipped (beyond USAF/FPN parity)

1. **Gaussian fit** on every line scan — `scipy.optimize.curve_fit` on
   `A·exp(-(s-μ)²/(2σ²)) + b`. Reports μ (parametric peak — more
   robust than argmax), σ (circle-of-confusion proxy), FWHM (≈2.355·σ
   noise-tolerant DoF), and R². Surfaced in the Lines table and as a
   dashed overlay on every per-line chart.
2. **Bootstrap 95% CI** — percentile bootstrap on the focus array gives
   the user a peak-position CI and DoF-width CI per line. Rendered as
   horizontal error bars on the chromatic-shift chart.
3. **All-metrics parallel sweep** — `measure_focus_all()` reuses one
   window extraction for all four metrics; `_scan_line()` is re-run per
   metric on the same line so the Metric Compare tab can overlay
   laplacian / brenner / tenengrad / fft_hf and show whether they
   agree on the peak.
4. **Per-channel chromatic focus shift** — `analyze_dof_multi()` runs
   the full pipeline across multiple channels in one call so the
   Chromatic Shift tab can plot per-channel peak positions on each
   line, with CI error bars.
5. **Tilt-plane / field-curvature fit** — `fit_focus_plane()` does a
   least-squares bilinear surface on (x, y, focus_norm) over the
   picked points. Rendered as a server PNG (image with residuals +
   heatmap of the evaluated plane + uphill arrow).
6. **Stability curve** — `compute_dof_stability()` re-scans the same
   line at several half-window sizes; reports peak + DoF width per
   window. Flat = stable estimate; rising = window too small.
7. **ISP live-apply** (like USAF/FPN) — black-level / sharpen / denoise
   flow into the server's measurement image before focus-metric math.
8. **Save/Load JSON `version: 2`** — round-trips analysis channels,
   metric, half-window, threshold, research-extra toggles, ISP
   settings, display knobs, points, lines, refs, selected ids.

### USAF-parity features now on DoF

- Rulers (H + V) + zoom-to-cursor + pan (hold Space, Pan tool,
  middle-click) + rotation (R) + flip H / V.
- Keyboard shortcuts: P (focus tool), H / V (ref tools), Space (pan),
  ⌘Z undo, ⌘A select-all, Del delete selected, R rotate, F / 0 fit.
- Display: 10 colormaps / brightness / contrast / gamma (CSS only).
- Sortable points + lines tables with multi-select via ⌘-click, inline
  double-click to rename.
- Live per-channel compute on debounce.
- CSV export: flat (channel × line/point) rows with Gaussian + bootstrap
  CI columns.
- Analysis modal with 7 native-vector tabs, channel filter, gain
  filter, line filter, metric filter.

### Invariants preserved

- Analysis modules still pure NumPy / SciPy (AGENT_RULES #7).
- Channel key schema + GSense Bayer constants untouched
  (AGENT_RULES #5/#6).
- All old public signatures on `analyze_dof()` / `_scan_line()` /
  `measure_focus()` are unchanged; new kwargs all default to False so
  existing callers keep paying zero cost.
- `DoFLineResult` and `DoFChannelResult` gain fields (additive only).

### Verification

- `python scripts/smoke_test.py --tier 1` → PASS (15 modules).
- `python scripts/smoke_test.py --tier 2` → PASS (7 DoF PNGs + multi +
  stability + plane).
- `python scripts/smoke_test.py --tier 3` → PASS (3 DoF endpoints
  including rich-mode compute + stability + multi-channel analyze).
- Preview MCP end-to-end: loaded synthetic sample → DoF mode → dropped
  3 points + drew 1 line → live profile chart shows Gaussian fit
  overlay with σ=30.77 px, FWHM=72.45 px, R²=0.41. Run analysis →
  modal opened on 4 channels × 1 line; confirmed Summary, Line scans,
  Chromatic shift, and Points / tilt tabs all render correctly.

### Files touched

- `mantisanalysis/dof_analysis.py` (research extras)
- `mantisanalysis/dof_render.py` (3 new builders)
- `mantisanalysis/figures.py` (wire extras + multi-chromatic helper)
- `mantisanalysis/server.py` (expand DoF request/response schemas +
  rewrite analyze route)
- `scripts/smoke_test.py` (tier 2 + tier 3 DoF coverage)
- `web/src/dof.jsx` (full rewrite — 414 → 1655 lines)
- `web/src/analysis.jsx` (`DoFAnalysisModal` + routing)
- `.agent/runs/dof-rewrite-v1/{ExecPlan,Status}.md` (new initiative)
- `.agent/CHANGELOG_AGENT.md` (this entry)
- `.agent/HANDOFF.md`, `ARCHITECTURE.md`, `BACKLOG.md`, `DECISIONS.md`

### Trio status

All three modes — USAF (`gui-rewrite-v1`), FPN (`fpn-rewrite-v1`), DoF
(this initiative) — are now at the same research-grade bar: multi-
channel live compute, native-vector analysis modals, save/load JSON,
ISP live-apply, display knobs, keyboard shortcuts, research extras.
The app is ready for real-sample validation.

---

## 2026-04-22 — Hotfix: FPN ROI delete now sticks (race in live re-measure effect) (Claude Opus 4.7)

User: "unable to delete ROI in FPN mode"

### Root cause
The FPN live re-measure effect (`web/src/fpn.jsx` ~line 180) re-measures every ROI whenever the channel or any setting changes (debounced via `useDebounced` ~200 ms). Old code:

```js
const updated = await Promise.all(rois.map(async (r) => {
  const m = await measureOne(r);
  return { ...r, m, error, pending: false };
}));
if (alive) setRois(updated);  // ← clobber!
```

This captured `rois` at effect-fire time, but when the Promise.all resolved (often hundreds of ms later for real H5 files), it called `setRois(updated)` with the **stale** array — wiping any user deletes that happened in between. Symptom: user clicks Delete (or hits the Delete key), the ROI vanishes for a frame, then snaps back when the in-flight measure resolves. The `alive` flag only flips on dep changes (channel/dSettings) or unmount, so a delete that doesn't change those deps gets clobbered by the in-flight cycle.

### Fix
Switched to a **functional** setRois that **merges measurements by id**:

```js
if (!alive) return;
const updateById = Object.fromEntries(updated.map(u => [u.id, u]));
setRois(prev => prev.map(r =>
  updateById[r.id] ? { ...r, ...updateById[r.id] } : r));
```

Now:
- Deleted ROIs stay deleted (the `prev.map` walks the LIVE post-delete array; ids no longer present are simply skipped).
- Concurrent adds (from `addRoi` resolving in parallel) are preserved (anything in `prev` not in `updateById` keeps its current measurement, if any).
- Measurement payload only carries `{ id, m, error, pending }` — we no longer spread the whole stale ROI rectangle, so a user-edit of the ROI bounds during measure can't be reverted either.

### Verification (Preview MCP, real React tree)
- Loaded 3 ROIs (Alpha · Beta · Gamma) via JSON config.
- Bumped Gauss σ to start a debounced in-flight measure cycle, waited 350 ms (past debounce, Promise.all in flight), then clicked the row + Delete button on Alpha.
  - Immediately after delete: ROIs visible = `[Beta, Gamma]` ✓
  - 2.5 s later (well after measure completes): ROIs = `[Beta, Gamma]` ✓ — delete is sticky.
- Repeated with the keyboard `Delete` shortcut on Beta — also sticky → `[Gamma]` ✓.
- Without the fix this same sequence would resurrect Alpha after ~500 ms.

### Files touched
- `web/src/fpn.jsx` (re-measure effect uses functional `setRois` + id-keyed merge)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — FPN: ROI rename in result · histograms tab · DN ↔ %DR · canvas-side smoothing · column selector (Claude Opus 4.7)

User: "For FPN: 1. allow user to modify name of ROI, reflect this in result page. 2. result page missing simple histogram views. 3. result page using DN as unit but without DR and bit-depth, this is not that relavent, allow user to show all result unit in percentage of DR (0-65535). 4. ISP smoothing is not aggressive enough or it is not being shown to the main canvas rendered image. 5. allow user to set which parameter or result to be shown in the table for result page"

### Backend
1. **`ISPParams` extended** with the FPN smoothing chain (`median_size`, `gaussian_sigma`, `hot_pixel_thr`, `bilateral`). `_apply_analysis_isp` now composes the existing USAF/sharpen chain with the FPN chain by delegating to `fpn_analysis.apply_isp` — no two-implementations drift, byte-for-byte identical preprocessing on the canvas thumbnail vs the analysis itself.
2. **`/api/sources/{id}/channel/{ch}/thumbnail.png`** accepts the four new query params (`median_size`, `gaussian_sigma`, `hot_pixel_thr`, `bilateral`) and forwards them through.
3. **`FPNResult`** gains `hist_bin_edges` (length 257) + `hist_counts` (length 256) — a kept-pixel pre-drift histogram auto-spanning each ROI's actual DN min..max so the bin edges adapt to whatever bit depth the channel uses. `_fpn_full_dict` exposes both as JSON arrays, served via `/api/fpn/measure` and `/api/fpn/analyze`.
4. **Smoke tier 1 + 2 + 3 PASS** — backward-compat verified end-to-end.

### Frontend (`web/src/{shared,fpn,analysis}.jsx`)
5. **Canvas ISP smoothing now reaches the thumbnail.** `channelPngUrl()` accepts the new ISP fields; `FPNMode`'s `imgSrc` memo composes them from `medianSize`/`gaussSigma`/`hotPixThr`/`bilateral` and passes through (only when actually active, so the no-ISP fast path stays cache-friendly). Verified: dragging the Gauss σ slider to 3.5 makes the canvas URL include `&gaussian_sigma=3.5` and the server applies the smoothing.
6. **ROI inline rename in the result page.** New `roiLabelOverrides` state in `FPNAnalysisModal`; `roiLabel(i)` reads from override → falls back to `run.rois[i].label` → falls back to `ROI-${i+1}`. `FPNSummaryTab`'s ROI cell is double-click-editable with the same UX as the live ROI table (autoFocus input, Enter to commit, Escape to cancel). Renames propagate to every other tab (Histograms, Profiles, PSDs, …) since they all use `roiLabel()`.
7. **DN ↔ %DR unit toggle** in the FPN modal's filter bar. New `useLocalStorageState('analysis/fpn/unit', 'DN')`. When `pctDR`, every DN-valued metric divides by `FULL_DR = 65535` and renders as a percentage; column headers also relabel to `μ %DR` / `DSNU %DR` / `σ row %DR` / etc. PRNU is already a percentage of mean_signal so it's never re-scaled. Verified: toggling adds `%DR` to all 8 noise headers in one click.
8. **Histograms tab.** New `FPNHistogramsTab` in the modal, between Summary and Row/Col means. Renders one inline-SVG bar chart per (channel × ROI) using the new `hist_counts`/`hist_bin_edges` arrays — 256 bars, channel-colored, with a dashed mean line and 5 tick labels along the x-axis (DN or %DR per the unit toggle). Verified: 4 channels × 2 ROIs → 8 panels, ~256 bars each, totaling ~2050 SVG `<rect>` bars.
9. **Configurable result-table columns.** `FPNSummaryTab` gains a `Columns (n/N)` settings dropdown with a checkbox per column (Channel · ROI · Pixels · μ · DSNU · PRNU% · σ row · σ col · σ res · σ row-only · σ col-only · row peak · col peak · hot · cold). Selection persisted via `useLocalStorageState('analysis/fpn/hiddenCols', {})`. Sort still works on hidden columns (the sort state survives toggling). All / None convenience buttons.
10. **Bonus: 5 new sortable columns** added to the table since they were already in the response but not shown — σ row-only, σ col-only, row peak (cy/row), col peak (cy/col), and cold-pixel count.

### Verification (Preview MCP, real React tree)
- **Backend:** `/api/fpn/measure` returns `hist_counts.length === 256`, `hist_bin_edges.length === 257`, range `[1810, 45607]` for synthetic HG-G ROI. `/thumbnail.png?gaussian_sigma=3.5` returns 200.
- **Frontend (FPN modal opened with 2 ROIs × 4 channels):**
  - Background picker present ✓ · Unit toggle present ✓ · Histograms tab present ✓ · Columns dropdown present ✓.
  - Histograms tab renders 8 panels with thousands of SVG bars ✓.
  - Unit → `%DR` toggle: every applicable header becomes `μ %DR` / `DSNU %DR` / `σ row %DR` / `σ col %DR` / `σ res %DR` / `σ row-only %DR` / `σ col-only %DR`. localStorage persists `"pctDR"` ✓.
  - All 15 column headers render in default-all-visible state ✓.
  - Canvas image URL includes `&gaussian_sigma=3.5` after slider change ✓.
- Smoke tier 1 + 3 PASS.

### Files touched
- `mantisanalysis/server.py` (ISPParams expansion, `_apply_analysis_isp` FPN-chain delegation, thumbnail query params, `_fpn_full_dict` histogram arrays)
- `mantisanalysis/fpn_analysis.py` (FPNResult `hist_bin_edges` + `hist_counts` fields + computation in `compute_fpn`)
- `web/src/shared.jsx` (`channelPngUrl` FPN ISP params)
- `web/src/fpn.jsx` (FPN canvas `imgSrc` ISP composition)
- `web/src/analysis.jsx` (BgColor wiring already done; `roiLabelOverrides`, `FULL_DR`, `unit` toggle, `FPNHistogramsTab` + `FPNHistChart`, FPNSummaryTab rewrite with rename + unit-aware formatters + column selector)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — MTF H/V split styling · 4× hi-DPI PNG export · user-choosable analysis bg color (Claude Opus 4.7)

User: "when showing H & V on the same plot, need to have two sets of style/stroke/marker for each of the dataset" · "exported analysis png is not hi-def enough, also make sure don't export the header control with it" · "when only H or V data shown, hide on plot legend for H and V" · "make user able to choose analysis result page's background color, so that user can set it to match publication background and screenshot on their own"

### MTF tab — independent H + V styling (`web/src/analysis.jsx`)
1. **Toolbar split.** `Stroke`/`Marker` are now `H stroke`/`V stroke` and `H marker`/`V marker`. The `Style` (lines/markers/lines+markers/stairs) and `X-axis` (log/lin) controls remain shared since they apply to the whole chart.
2. **Defaults differentiate at first paint:** H = `solid`/`circle`, V = `dashed`/`square`. The user can change either independently.
3. **`MTF_MARKERS`** loses the `auto` entry (no longer needed; explicit per-direction picks supersede it).
4. **`MiniMTFChart` props** swap from `dashPattern` + `markerShape` to `dashPatternH`/`dashPatternV` + `markerH`/`markerV`. Per-direction stroke + shape applied during the polyline + MarkerShape rendering.
5. **Legend chips reflect actual styles** (line dasharray + marker shape = whichever the user picked for that direction), and the chip for an empty direction is hidden — when the Direction filter isolates H, no orphan "V" chip is drawn, and vice versa.

### PNG export — hi-DPI + clean chart content (`web/src/analysis.jsx`)
6. **Resolution bump 2× → 4×.** dom-to-image's `scale` doubled-doubled, raising MTF tab capture (in our test fixture) from ~1604×2992 → 1604×5984 (now ≈4500 px tall after toolbar drop). Plenty for journal print.
7. **Toolbar exclusion.** Each per-tab toolbar is marked `data-no-export`. `exportPNG` collapses every `[data-no-export]` descendant via `style.display = 'none'` *before* measuring `scrollWidth`/`scrollHeight`, then renders the now-shorter node, then restores the original `display` in a `finally` block (so a render error never leaves the toolbar invisible). Verified end-to-end: same fixture went 5984 → 4508 px tall (1476 px / 25% reduction) and 628 KB → 414 KB (34% size drop).
8. **`filter`-based no-export approach was tried first and discarded** — it skipped the toolbar's pixels but left the bounding box, producing an empty band. Display-collapse is the correct fix because it removes the toolbar from layout entirely.
9. **Same fix applied to `FPNAnalysisModal`'s `exportPNG`** (also bumped to 4×, also collapses `[data-no-export]`).

### User-choosable background color (`web/src/analysis.jsx`)
10. **`BgColorPicker`** — small inline component (Theme / White / Black / Transparent presets + `<input type="color">` for any hex). Chosen color is the SAME source of truth for both:
    - the live tab-body background (so what you see is what you export), and
    - the dom-to-image `bgcolor` parameter on PNG export.
11. **Transparent preset** suppresses `bgcolor` in the export options (PNG keeps alpha) and shows a checkerboard pattern in the live view so the user can tell at a glance.
12. **Persistence:** single localStorage key `analysis/bgColor`, shared between USAF + FPN analysis modals. Set once, both modals honor it.
13. **Wired into both modals** at the end of the filter bar (Channels / Gain / Direction / [ROI for FPN] / Threshold / **Background**).

### Verification (Preview MCP, real React tree)
- Toolbar headings render: `['Style', 'H stroke', 'V stroke', 'H marker', 'V marker', 'X-axis']` ✓.
- Direction filter → H only: legend chip set = `['H']`. Direction → V only: `['V']`. Direction → All: `['H', 'V']`. ✓
- PNG export hooked: `bgcolor` matches the active picker (`'#ffffff'` for White, omitted for Transparent). ✓
- Live tab body `getComputedStyle.backgroundColor` flips between `rgb(250,251,252)` (theme) → `rgb(255,255,255)` (white) → `rgb(0,0,0)` (black) → `rgba(0,0,0,0)` (transparent) on each preset click. ✓
- Tier-3 smoke unchanged (PASS). Frontend-only refactor.

### Files touched
- `web/src/analysis.jsx` (BgColorPicker, MTF toolbar split, MiniMTFChart per-direction styling, conditional legend, exportPNG hi-DPI + display-collapse, FPN modal twin)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — Hotfix: panel drag now restricted to the title row (`data-drag-handle`) (Claude Opus 4.7)

User: "when i drag slider, still draging the whole panel, make panel drag works only when dragging the top title row, don't add shading though"

### Root cause of the regression
The earlier "abort drag from interactive elements" fix (`onDragStart` checked `e.target.closest('input, button, …')`) was wrong. `dragstart` fires on the *source* element, so `event.target` is the wrapper itself — not the descendant the user clicked on. The `closest()` call always missed the slider. My synthesized test happened to pass because I dispatched the event with the slider as the explicit target.

### Fix (`web/src/shared.jsx`)
1. **`Card` header gains `data-drag-handle`** — single attribute, no visible change. Marks the title-row button as the only valid drag-init zone.
2. **`DraggablePanelList` flips `draggable` based on `mousedown` location.** Each panel wrapper now has:
   - `onMouseDown`: if `e.target.closest('[data-drag-handle]')` → keep wrapper `draggable=true`; else flip to `false` so the browser never even initiates a drag from this gesture.
   - `onMouseUp`: restore the default (`draggable=true`) so the next gesture is evaluated fresh.
   - Per-id state map keyed on panel id, so toggling one panel's draggable doesn't affect the others.
3. **Removed `cursor: 'grab'`** from the wrapper — per the user's "don't add shading though". The panel body now has the default cursor; only the header text/icon row reads `cursor: pointer` (Card's existing styling).
4. **Removed the now-defunct `onDragStart` interactive-element guard** — no longer needed since the gesture never reaches `dragstart` when it starts outside the title row.

### Verification (Preview MCP, synthesized DOM events)
| Sequence | Wrapper `draggable` |
|---|---|
| Initial render | `"true"` ✓ |
| `mousedown` on slider thumb | `"false"` ✓ (panel won't drag) |
| `mouseup` (anywhere) | `"true"` ✓ (gesture armed again) |
| `mousedown` on title row | `"true"` ✓ (drag proceeds) |

### Files touched
- `web/src/shared.jsx` (`Card` adds `data-drag-handle`; `DraggablePanelList` swaps the dragstart-guard for an onMouseDown-driven `draggable` toggle)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — FPN dark frame · in-panel H5 open · canvas colorbar with vmin/vmax (Claude Opus 4.7)

User: "1. for FPN, also allow dark frame loading. 2. modify source tag on the left panel that user should load h5 from there too other than on the top bar for all three modes. 3. display scale bar/colorbar for main canvas, allow user to set vmin and vmax."

### Task 1 — FPN dark frame (`web/src/fpn.jsx`)
1. **Mirrored USAF's dark-frame UX into FPN** — the same `/api/sources/{id}/dark/{upload,delete,load-path}` endpoints already accept any source, so the only delta was UI. FPN's Source card now renders an identical dark-frame block: status pill, Load/Replace/Clear buttons, inline Filetype dropdown shared with the global filter. After attach/clear we switch the source so the canvas thumbnail re-fetches with the dark applied; FPN live stats already key on `source.has_dark` via the existing `useEffect` chain so they re-measure for free.

### Task 2 — Open H5/image directly from each mode's Source card (`web/src/app.jsx`, `web/src/{usaf,fpn,dof}.jsx`)
2. **`onOpenFile` prop** added to the USAFMode / FPNMode / DoFMode signature, threaded from `App` as `() => fileInputRef.current?.click()` so the existing top-bar hidden file input is re-used (and the global Filetype filter is honored uniformly).
3. **USAF + FPN Source cards** gain a primary "Open H5 / image…" button above Save/Load cfg. The legacy Save/Load buttons are renamed `Save cfg` / `Load cfg` to disambiguate from "Open file".
4. **DoF gets a Source card for the first time** (it had none before) — name + shape + Open H5 button. Mirrors the visual contract of USAF/FPN.

### Task 3 — Canvas colorbar + user vmin/vmax (`mantisanalysis/{session,server}.py`, `web/src/{shared,usaf,fpn}.jsx`)
5. **`channel_to_png_bytes(...)`** gains optional `vmin` / `vmax`. When *both* are provided they replace the default 1%/99.5% percentile clip; otherwise the percentile path is preserved (so old callers behave identically).
6. **`/api/sources/{id}/channel/{ch}/thumbnail.png`** accepts `vmin` / `vmax` query parameters and forwards them through.
7. **`GET /api/sources/{id}/channel/{ch}/range`** — returns `{ min, max, p1, p99, mean, std }` in DN. Used to seed sensible defaults and bound the slider; computed on the dark-subtracted image so the values match what the colormap actually sees.
8. **`GET /api/colormap/{name}.png`** — renders a vertical colormap-strip PNG (top = high) using matplotlib's exact LUT, cached server-side for 24 h. Used by the canvas colorbar overlay for true colormap parity.
9. **`channelPngUrl()`** helper (shared.jsx) gains `vmin` / `vmax` arguments; both must be set and `vmax > vmin` for the URL to include them.
10. **`colormapStripUrl(name, w, h)`** helper added in shared.jsx.
11. **`<CanvasColorbar>`** component in shared.jsx — `position: absolute, right: 12, top: 12` floating panel that shows the colormap strip plus three labels (vmax / midpoint / vmin) in monospace. Hidden when both colormap is `gray` AND vmin/vmax are unpinned. Renamed from `Colorbar` after a name-collision crash with the existing `Colorbar` in analysis.jsx (each `<script>` shares the global scope; the later script's `var` declaration was overwriting mine, leading to "Cannot read properties of undefined" inside the analysis-modal Colorbar's signature).
12. **USAF + FPN Display cards** each gain a "Colormap range" sub-card with:
    - **AUTO/MANUAL toggle** — AUTO uses the percentile defaults and re-syncs whenever the channel changes; MANUAL pins vmin/vmax to the current values and lets the user edit them.
    - **vmin/vmax numeric inputs** — disabled in AUTO; step auto-scales to ~`(max-min)/1000`.
    - **min/max · μ ± 3σ · p1/p99 quick-snap buttons** — one-click presets that update both vmin and vmax atomically.
    - All three controls are wrapped in a `data-no-drag` container so the slider-fix's interactive-element check covers them in the draggable sidebar.
13. **vmin/vmax fetch on channel change** — both modes hit `/range` after every `(source_id, has_dark, activeChannel, autoRange)` change, then snap the slider to `[p1, p99]` if AUTO is on. Cancellation guard in the `useEffect` prevents a stale response from clobbering a freshly chosen channel.
14. **Canvas overlays the `<CanvasColorbar>`** in both USAFCanvas and FPNCanvas; rendered when `colormap !== 'gray'` OR vmin/vmax are explicitly pinned (so grayscale users aren't pestered, but power users who want a DN scale always get one).

### Verification (Preview MCP + tier-3 smoke)
- `python scripts/smoke_test.py --tier 1` → PASS · `--tier 3` → PASS.
- `GET /api/colormap/jet.png?w=16&h=64` → 200 · `image/png` · 184 bytes.
- `GET /api/sources/{sid}/channel/HG-G/range` → `{ min: 1666, max: 47450, p1: 2249, p99: 47038, mean: 37375, std: 12310 }` ✓.
- `GET /thumbnail.png?colormap=viridis&vmin=…&vmax=…` → 200 · `image/png` ✓.
- USAF mode (post-reload): `colorbarPresent: true`, `colorbarSrc` resolves to `/api/colormap/viridis.png?w=16&h=256`, `openH5BtnPresent: true`, `autoToggleLabel: 'AUTO'`.
- FPN mode (post-reload): same four checks pass; dark-frame Load button also present.
- AUTO → MANUAL toggle: canvas `<img src>` query string changes from `max_dim=1600&colormap=viridis` to `max_dim=1600&colormap=viridis&vmin=2248.99&vmax=47038.00` ✓.

### Files touched
- `mantisanalysis/session.py` (`channel_to_png_bytes` vmin/vmax)
- `mantisanalysis/server.py` (`io` import, thumbnail vmin/vmax, `/range` + `/api/colormap/*.png` endpoints)
- `web/src/app.jsx` (`onOpenFile` prop wiring)
- `web/src/shared.jsx` (`channelPngUrl` vmin/vmax, `colormapStripUrl`, `CanvasColorbar`)
- `web/src/usaf.jsx` (Open H5 button, vmin/vmax state + `/range` fetch + Display sub-card + Colorbar overlay)
- `web/src/fpn.jsx` (Open H5 button + dark frame card + vmin/vmax state + `/range` fetch + Display sub-card + Colorbar overlay)
- `web/src/dof.jsx` (new Source card with Open H5 button)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — Hotfix: JSON Load crashed on legacy `picker.method` (`setMethod is not defined`) (Claude Opus 4.7)

User: "unable to load json config with error missing setMethod"

### Root cause
Earlier in the session the Method dropdown was removed from the Picking panel — `[method, setMethod] = useState(...)` was replaced with the const `method = 'five_point'` so the analysis modal still gets a method name. The `importConfig` path in `web/src/usaf.jsx` still had `if (p.method) setMethod(p.method);` from before the removal. When a user loaded any saved JSON (every prior export writes `picker.method`), `setMethod` was undefined → ReferenceError → caught by the surrounding `try/catch` and surfaced as the toast "Load failed: setMethod is not defined". The whole picker block past the throwing line never applied, so Group / Element / Direction / etc. silently stayed where they were.

### Fix (`web/src/usaf.jsx`, line 561)
Removed the `setMethod` call. Replaced with a comment explaining that `p.method` is intentionally ignored on import — the method is now hard-pinned to `'five_point'`, the export still writes the field for shape stability, and old configs that pinned other methods (e.g. `fft`) must not crash on load. No data loss: FFT / min-max / percentile metrics are still computed server-side and shown side-by-side in the analysis modal Summary table.

### Verification (Preview MCP)
- Synthesized a legacy JSON with `picker: { group: 1, element: 4, direction: 'V', method: 'fft', … }` and dispatched a `change` event on the JSON file input.
- After import: `localStorage['mantis/usaf/group'] = "1"`, `element = "4"`, `direction = '"V"'` — all picker fields applied as intended.
- Zero console errors during the import.

### Files touched
- `web/src/usaf.jsx` (one-line removal + clarifying comment)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — Drag-from-slider abort + shared bright/dark filetype filter (Claude Opus 4.7)

User: "when uploading file both bright and dark, allow user to select filetype, include option for all files. when dragging sliders, the entire panel is dragged with it, fix this bug"

### Bug 1 — sliders pulling the whole panel (`web/src/shared.jsx`)
1. **Root cause:** the panel wrapper rendered by `DraggablePanelList` carries `draggable=true`. HTML5 dnd lets that bubble up from any descendant, so a mousedown on `<input type="range">` (slider track / thumb), `<button>`, `<select>`, etc. triggered a panel reorder gesture instead of the intended slider scrub.
2. **Fix:** `DraggablePanelList.onDragStart` now inspects `e.target.closest('input, button, select, textarea, [role="button"], [role="slider"], [contenteditable], [data-no-drag]')`. If the gesture started on any interactive control (or anything that opted out via `data-no-drag`), we call `e.preventDefault()` and bail. Otherwise the drag proceeds as before.
3. **Verified end-to-end via Preview MCP:**
   - `dispatchEvent(new DragEvent('dragstart'))` from the brightness `<input type="range">` → `defaultPrevented: true` ✓
   - Same event from the wrapper root (no interactive descendant in the path) → `defaultPrevented: false` (drag still works for reorder) ✓
   - Slider value changes still propagate normally (DOM `value` 0 → 0.25 after `input` event).

### Bug 2 — bright + dark uploads share a filetype filter (`web/src/shared.jsx`, `web/src/app.jsx`, `web/src/usaf.jsx`)
4. **`FileFilterCtx`** added to `shared.jsx` — distributes `{ filters, current, set }` so every mode can render parallel filter UI for its own auxiliary file inputs without duplicating the FILE_FILTERS map.
5. **`FILE_FILTERS`** kept in `app.jsx` (single source of truth) but also pinned to `window.FILE_FILTERS` so it's discoverable from any bundle. `App` wraps its tree in `<FileFilterCtx.Provider value={{ filters: FILE_FILTERS, current: fileFilter, set: setFileFilter }}>` — same `useLocalStorageState('fileFilter', 'all')` that already drives the top-bar Open dropdown, so the user's choice persists across reloads and is shared between bright and dark uploads automatically.
6. **USAFMode** reads `useFileFilter()` and threads `darkAccept = filters[current]?.accept || ''` into the `<input ref={darkInputRef} type="file" accept={darkAccept}>`. The previous hardcoded `accept=".h5,.hdf5,image/*"` is gone.
7. **Dark frame card UI** gains a small inline `<select>` labeled "Filetype" with all 6 options including the always-present `All files (*.*)`. The control is marked `data-no-drag` so the slider-fix's interactive-element check covers it. Selecting H5 in the dark card also updates the top-bar Open select; selecting "All files" in the top bar likewise opens the dark dialog with no filter — a single state owned by `App`, displayed in two places.
8. **Verified end-to-end via Preview MCP:**
   - `darkFilterExists: true`, options = `['All files (*.*)', 'H5 / HDF5 …', 'All images …', 'PNG only', 'TIFF only', 'JPEG only']` ✓
   - Setting dark dropdown to `h5` → `topSelectValue: 'h5'`, `openBtnTitle: 'Open — filter: H5 / HDF5 (*.h5, *.hdf5) (⌘O)'`, `darkInputAccept: '.h5,.hdf5'`, `localStorage['mantis/fileFilter']: '"h5"'` (all four agree).

### Files touched
- `web/src/shared.jsx` (`onDragStart` interactive-element guard, `FileFilterCtx`/`useFileFilter`, exports)
- `web/src/app.jsx` (`window.FILE_FILTERS`, `<FileFilterCtx.Provider>`)
- `web/src/usaf.jsx` (`useFileFilter()`, dark Filetype `<select>`, `accept={darkAccept}`)
- `.agent/CHANGELOG_AGENT.md` (this entry)

### Verification
- `python scripts/smoke_test.py --tier 3` → PASS.
- Preview MCP screenshots show the new "Filetype" row inside the DARK FRAME card with the dropdown defaulting to "All files (*.*)".

---

## 2026-04-22 — FPN rewrite v1: USAF-parity GUI + EMVA-grade research extras (Claude Opus 4.7)

User: "the optimization and bringup for the usaf is almost done, now work on the FPN with same requirement and standard. current GUI and analysis page is way to bare metal missing everything. make sure to perform at least as good as the provided gui template. and expand the functionality by doing your own research, extra efforts."

Initiative: `.agent/runs/fpn-rewrite-v1/` — ExecPlan + Status.

### Scope delta (compared to pre-session baseline)

- `web/src/fpn.jsx` 261 → 1059 lines. Near-total rewrite using USAF as the
  structural template. Old version was a single-ROI live-stats panel.
- `web/src/analysis.jsx` gained a full `FPNAnalysisModal` alongside
  `USAFAnalysisModal`; FPN no longer falls through to the legacy PNG
  modal. DoF still does (its rewrite is a separate future initiative).
- `mantisanalysis/fpn_analysis.py` 241 → ~440 lines. Same public
  `compute_fpn()` signature; new `compute_fpn_multi` and
  `compute_prnu_stability` entry points.
- `mantisanalysis/fpn_render.py` gets three new matplotlib builders
  (`build_autocorr_fig`, `build_psd1d_fig`, `build_hotpix_fig`).
- `mantisanalysis/server.py` FPN surface 2 endpoints → 5:
  `/api/fpn/compute` (small summary, back-compat + expanded fields),
  new `/api/fpn/measure` (rich per-ROI JSON),
  new `/api/fpn/measure_batch` (multi-ROI on one channel),
  new `/api/fpn/stability` (PRNU stability curve),
  `/api/fpn/analyze` rewritten to mirror `/api/usaf/analyze`'s shape
  (channel × ROI grid of native JSON + base64 PNGs).
- `mantisanalysis/figures.py` wires the 3 new builders into `build_fpn_pngs`.
- `scripts/smoke_test.py` tier 2 covers every new builder + multi/stability
  calls; tier 3 round-trips every new endpoint.

### Research extras shipped (beyond USAF parity)

1. **Drift-plane removal** (`drift_order` in settings: `none` / `bilinear`
   / `biquadratic`). Least-squares surface fit on kept pixels, subtracted
   before stats. Separates illumination roll-off from true FPN. Reported
   `mean` is the residual mean (~0 when drift active); new `mean_signal`
   is the *pre-drift* mean used as the PRNU denominator — otherwise
   PRNU would collapse to `std/0`.
2. **DSNU decomposition** — `dsnu_row_only_dn` and `dsnu_col_only_dn`
   (σ after subtracting row-means only, then col-means only), plus the
   existing `residual_pixel_noise_dn` (σ after both). Lets the user see
   whether FPN is predominantly row-banding or col-banding vs per-pixel.
3. **1-D row + col PSDs** — `_row_col_1d_psd()` on `row_means` / `col_means`.
   Peak frequencies (`row_peak_freq`, `col_peak_freq`) are reported as
   cycles/row and cycles/col with `_peak_non_dc()`. Peaks away from DC
   signal periodic banding (ADC clocking, 60 Hz pickup, column-parallel
   phase mismatch).
4. **2-D autocorrelation** via Wiener–Khinchin
   (`IFFT(|FFT(fpn_map)|²)`), normalized so lag 0 = 1. Off-center peaks
   reveal periodic spatial structure (fabric patterns, tile artifacts).
5. **Hot/cold pixel map** — pixels with `|z| > hot_sigma` against the
   kept-distribution. Returns the full boolean mask plus top-50 hot and
   top-50 cold pixels as `(y, x, value, z)` tuples in the JSON response,
   rendered as overlaid markers in `build_hotpix_fig` and a compact
   "top outliers" list in the analysis modal's Hot/cold pixels tab.
6. **PRNU stability curve** — `compute_prnu_stability()` shrinks the ROI
   concentrically over N steps (default 6) and reports PRNU at each size.
   Flat curve → statistics stable; rising curve → ROI too small.
   Surfaced as the optional `PRNU stability curve` card in the right
   sidebar, wired to `/api/fpn/stability`, renders an inline-SVG chart.
7. **Multi-ROI batch + compare** — the right-sidebar ROI table is the
   multi-ROI workbench; the analysis modal's ROI comparison tab shows
   5 grouped bar charts (DSNU / PRNU / σ_row / σ_col / σ_res) with bars
   grouped by ROI and coloured by channel, so the user can audit
   flat-field uniformity across the image field.

### USAF-parity features now on FPN

- Rulers + zoom-to-cursor pan + rotation-aware overlay.
- Multi-ROI draw via drag, click-select, click-outside to deselect,
  right-click to delete, ⌘Z undo, ⌘A select-all, Del to delete selection.
- Sortable ROI table (9 columns) with checkbox multi-select and inline
  double-click rename.
- Display-only colormap / brightness / contrast / gamma controls
  (CSS `filter`, does not affect the analysis math).
- ISP card (median / Gaussian / hot-pixel replacement / bilateral) —
  applied to the measurement image server-side before stats.
- JSON Save/Load round-trips ROI(s), labels, ISP, display, drift
  settings, sort state.
- Analysis modal: 8 tabs (Summary, Row/Col means, 1-D PSDs, 2-D FPN
  maps, 2-D power spectrum, Autocorrelation, Hot/cold pixels, ROI
  comparison). Channel filter + gain filter + ROI filter in the header.
  PNG / CSV / JSON export buttons.

### Invariants preserved

- Analysis modules remain pure NumPy/SciPy (AGENT_RULES #7). The
  existing `compute_fpn(image, name, roi, settings)` signature is
  unchanged; new fields on `FPNResult` only add, never rename.
- GSense Bayer constants + channel key schema untouched
  (AGENT_RULES #5/#6).
- `FPNComputeResponse`'s original 14 fields are all still present; new
  fields (`mean_signal`, `dsnu_row_only_dn`, `dsnu_col_only_dn`,
  `row_peak_freq`, `col_peak_freq`, `row_peak_amp`, `col_peak_amp`,
  `hot_pixel_count`, `cold_pixel_count`, `drift_order`) are additive.

### Verification

- `python scripts/smoke_test.py --tier 1` → PASS (15 modules).
- `python scripts/smoke_test.py --tier 2` → PASS (7 FPN PNGs + multi + stability).
- `python scripts/smoke_test.py --tier 3` → PASS (all 5 FPN endpoints).
- Preview MCP end-to-end: loaded synthetic sample, switched to FPN mode,
  drew 2 ROIs, confirmed live stats (μ_signal, DSNU, PRNU, σ_row/col,
  row-strip, col-strip, residual, row/col peak freq, hot/cold counts,
  drift) all populate; ran analysis, modal opened on 2 ROIs × 4 channels;
  cycled through Summary, 2-D FPN maps, Autocorrelation, 1-D PSDs, ROI
  comparison tabs — all render.
- Bug caught during verification: stale localStorage `analysisChannels`
  for a different source crashed Run with "no valid channels"; fixed by
  filtering to `available.includes(c)` in `runAnalysis` and falling back
  to `[activeChannel]`. Second bug: two rapid ROI draws both got
  `ROI-${rois.length+1}` = "ROI-1" because React batches state updates;
  fixed by using functional `setRois(prev => ...)` so the label reflects
  commit-time length.

### Files touched

- `mantisanalysis/fpn_analysis.py` (EMVA extras, multi-ROI, stability)
- `mantisanalysis/fpn_render.py` (3 new builders, stat-table fields)
- `mantisanalysis/figures.py` (wire new builders)
- `mantisanalysis/server.py` (expand FPN Pydantic models + 3 new endpoints)
- `scripts/smoke_test.py` (tier 2 extras, tier 3 FPN coverage)
- `web/src/fpn.jsx` (full rewrite)
- `web/src/analysis.jsx` (`FPNAnalysisModal` + routing)
- `.agent/runs/fpn-rewrite-v1/{ExecPlan,Status}.md` (new initiative)
- `.agent/CHANGELOG_AGENT.md` (this entry)
- `.agent/HANDOFF.md`, `ARCHITECTURE.md`, `BACKLOG.md` (follow-ups)

---

## 2026-04-22 — Branding polish + USAF picking-panel cleanup + drag-to-reorder sidebars + Profile preview pop-out (Claude Opus 4.7)

User: "increase separation between MantisAnalysis and Suite by a little bit. for copyright section, Zhongmin Zhu's affiliation should be with PolarX Photonics, and this software is developed for BioSensors Lab @ UIUC. for USAF, picking panel, remove 6->1, then G+1 note, remove lock H/V notes. these should all be within hover help, default boot to G0E1. Make sure all functions have their hover help explains what it is for. method in picking panel doesn't seem to have any uses? allow user to rearrange order of panels inside of the side panels. and allow user to drag profile preview out of the side panel to anywhere they want"

### Branding (`web/src/shared.jsx`, `web/src/app.jsx`)
1. **Wordmark** — increased separation between `MantisAnalysis` and `SUITE` (added `marginLeft: 8`, `letterSpacing: 0.4`, uppercased), plus minor `letterSpacing: 0.2` on `Analysis` for visual rhythm. Both halves remain on one line; the SUITE word is unmistakably its own token now.
2. **BRAND object split** into the two roles the user identified:
   - `authorAffiliation: 'PolarX Photonics'` — Zhongmin Zhu's company.
   - `customer: 'BioSensors Lab · UIUC'` — the lab the software was built for.
   - Legacy `lab` field kept as alias of `customer` so existing callers don't break.
3. **About modal** now shows two distinct sections — "Author affiliation" (PolarX Photonics) and "Built for" (BioSensors Lab · UIUC) — instead of one ambiguous "Affiliation" line.
4. **Footer copyright** rewritten to `© 2026 Zhongmin Zhu · PolarX Photonics. Developed for BioSensors Lab · UIUC. MIT licensed.`

### USAF Picking-panel cleanup (`web/src/usaf.jsx`)
5. **Default boot G0/E1** (was G2/E3). Group spinbox initial value is now `0`; `Reset G0 E1` button label still matches.
6. **Method dropdown removed.** `method` is now a const `'five_point'` (the canonical primary metric); FFT / min-max / percentile are still computed by the server and shown side-by-side in the analysis modal Summary table for cross-reference. The string is kept on `/api/usaf/measure` for body-shape stability.
7. **Inline hint text moved into hover Tips:**
   - "After 6→1, then G+1" — folded into the Sequential checkbox Tip ("When Element rolls past 6, advance Group by 1 and reset Element to 1, so picks sweep G0E1, G0E2, …, G0E6, G1E1, G1E2, …").
   - "Lock H/V within 8px" — folded into the Snap checkbox Tip ("When drawing, snap the stroke to a perfect horizontal or vertical axis if it's within 8 pixels of one. Helpful for USAF where bars are axis-aligned. Off = freehand.").
   - Auto-increment Tip explains the increment behavior end-to-end.
   - Group/Element/Direction Spinboxes get arrow-key tip text ("← / → also changes this").
   - All / None / HG / LG channel-selector buttons get explicit `title=` strings.
   - Reset G0 E1 + Reset zoom buttons wrapped in Tips.
8. **Display + ISP sliders** (right sidebar) — every Brightness / Contrast / Gamma / Sharpen / Radius / Denoise / BlackLevel slider is wrapped in a Tip explaining what it does and (critically) whether it affects analysis math or only the display.

### Drag-to-reorder sidebar panels (`web/src/shared.jsx`, `web/src/usaf.jsx`)
9. **`DraggablePanelList({ order, setOrder, panels })`** — new reusable primitive in `shared.jsx`. HTML5 drag-and-drop, zero deps. Each panel gets `draggable=true`, drop-target shows a 2px accent-color top border, drop reorders within the same list, persists order via the caller's `setOrder` (typically `useLocalStorageState`). Tolerates stale ids (filtered) and new ids (appended) so adding/removing a panel never requires a localStorage migration.
10. **USAF left sidebar** wired through `DraggablePanelList`: `source`, `displayChannel`, `analysisChannels`, `picking`, `outputMode`. Persisted at `usaf/leftOrder`.
11. **USAF right sidebar** likewise: `display`, `isp`, `linesTable`, `profilePreview`, `summary`. Persisted at `usaf/rightOrder`.
12. **Verified end-to-end** via Preview MCP: changing `localStorage['mantis/usaf/leftOrder']` to `['picking','source',…]` and reloading rendered Picking at the top of the left sidebar. Restoring defaults brought it back.

### Profile preview pop-out (`web/src/shared.jsx`, `web/src/usaf.jsx`)
13. **`FloatingWindow({ title, icon, x, y, w, h, onChange, onClose, children })`** — new primitive. `position: fixed`, drag-by-header (mousedown → mousemove → mouseup, body cursor pinned to `grabbing`), bottom-right resize handle (clamped at 220×160 min). Close × dock-back button in the header. Caller owns `x/y/w/h` so position can be persisted.
14. **Profile preview Card** gets a small `↗` (or `↓` when floating) action button via Card's `actions` prop. Click toggles `profileFloating` (persisted at `usaf/profileFloating`). When floating, the sidebar slot shows a placeholder ("Profile preview is floating in its own window. Click ↓ to dock back here.") and a `<FloatingWindow>` is mounted as a sibling of the sidebar grid with the actual `<ProfilePreview>` inside. Position survives reload via `usaf/profileWin`.
15. **`<button>`-in-`<button>` warning fix.** The Card header is itself a `<button>`; nesting another `<button>` inside the `actions` slot trips React's `validateDOMNesting`. Resolved by rendering the pop-out trigger as `<span role="button" tabIndex={0}>` with `onClick` + `onKeyDown` for Enter/Space, and `onMouseDown` to `stopPropagation` so the parent header doesn't also collapse the card. Verified via Preview MCP: toggling pop-out three times produced zero new console errors (the 54 historical errors all pre-date the fix).

### Verification
- `python scripts/smoke_test.py --tier 3` → PASS (FastAPI endpoints round-trip).
- Preview MCP: USAF mode renders cleanly at fresh boot showing G0/E1, no Method dropdown, all 10 panels marked `draggable="true"` with `title="Drag to reorder this panel"`.
- Pop-out path verified: click → `floatHeaderCount` goes 0→1 + `profileFloating` localStorage flips false→true; dock-back via × button reverses both.

### Files touched
- `web/src/shared.jsx` (BRAND split, `DraggablePanelList`, `FloatingWindow`, exports)
- `web/src/usaf.jsx` (defaults, Method removal, Tips, sidebar refactor, pop-out wiring)
- `web/src/app.jsx` (wordmark spacing, About modal sections, footer)
- `.agent/CHANGELOG_AGENT.md` (this entry)

---

## 2026-04-22 — Per-pixel dark-frame subtraction (math-safe + UI + JSON round-trip) (Claude Opus 4.7)

User: "add a function that user can also load a dark frame for the h5 file that for dark substraction, make sure handle math and guard properly no overflow or negative."

### Backend
1. **`LoadedSource.dark_channels: Optional[Dict[str, np.ndarray]]`** + `dark_name`/`dark_path` fields. `has_dark` property. Three new SessionStore methods: `attach_dark_from_path`, `attach_dark_from_bytes`, `clear_dark`.
2. **`subtract_dark(image, dark)`** — the math. Always promotes to `float64` BEFORE subtracting (so a uint16 → uint16 case where dark > raw can't wrap to 65436), then clamps the result to `[0, ∞)` via `np.maximum(out=)`. Returns a new array; never mutates inputs. None-dark = identity (cast to float64). Shape mismatch returns the image unchanged (defensive — caller validates).
3. **`_validate_dark_shapes`** — every source channel must have a same-shape dark counterpart; missing-channel and shape-mismatch produce a clear multi-line error message; no-channel-overlap raises with both key sets in the message.
4. **`_channel_image(src, channel, *, apply_dark=True)`** — single chokepoint for raw → dark-subtracted access. Applied transparently in the channel-thumbnail endpoint and in the analysis endpoint (which previously read `src.channels[k]` directly — now goes through `_channel_image` so the dark cancels there too).
5. **Three new endpoints** (with KeyError → 404, ValueError → 422, generic → 400):
   - `POST /api/sources/{id}/dark/upload` — multipart upload, validates + attaches.
   - `POST /api/sources/{id}/dark/load-path` — disk path (preserves `dark_path` for Save/Load JSON round-trip).
   - `DELETE /api/sources/{id}/dark` — detach.
6. **`SourceSummary`** gains `has_dark`, `dark_name`, `dark_path`. `STORE.list()` and `_summary()` route through the new `_summary_dict` helper so every API endpoint returns the same shape.

### Math invariants (unit-verified end-to-end)
| Case | Input | Result |
|---|---|---|
| Basic | `[100,200,300,400] − [10,20,30,40]` | `[90,180,270,360]` ✓ |
| Underflow | `[10,20] − [100,5]` | `[0,15]` (clamped, not negative) ✓ |
| uint16 wrap | `100 − 200` | `0` (would naively wrap to 65436) ✓ |
| Shape mismatch | `(4,4) − (3,3)` | image returned unchanged ✓ |
| None dark | `[1,2] − None` | `[1.0,2.0]` (float64 cast) ✓ |
| Validate shape | source `(10,10)`, dark `(9,9)` | `ValueError: source shape (10,10) ≠ dark shape (9,9)` ✓ |
| Validate overlap | dark channels disjoint from source | `ValueError: ... do not overlap` ✓ |

### Frontend
7. **Source card gains a "DARK FRAME" panel** under the Save/Load row. Two states:
   - Not attached: muted background, "not attached — analysis uses raw DN", `Load` enabled, `Clear` disabled.
   - Attached: accent-soft background with green status dot, `subtracted: <name>`, `Replace` + `Clear` (red).
   Hidden file input with `accept=".h5,.hdf5,image/*"`. Pipeline: `apiUpload('/api/sources/{id}/dark/upload', file)` → `onSwitchSource(updated)` → `reMeasureAll()` so every picked line re-measures against the dark-subtracted image.
8. **TopBar source badge gets a `− DARK` chip** in success-green when a dark frame is attached, with full path on hover.
9. **Save / Load JSON round-trips dark too.** `exportConfig` writes `dark: { name, path }`. `importConfig` first tries `/api/sources/load-path` for the source, then `/api/sources/{id}/dark/load-path` for the dark — each with graceful fallback (warn-toast if file moved/permission denied/browser-uploaded so no path).

### Verified end-to-end via Preview MCP
- Curl: attached image-as-its-own-dark → thumbnail bytes encode a uniform 0 raster (`mean=0, std=0.00`); `DELETE /dark` restores original (sha1 byte-identical to pre-attach).
- Curl: 16×16 dark on 100×120 source → `HTTP 422` with explanatory `dark frame is incompatible with source: · L: source shape (100, 120) ≠ dark shape (16, 16)`.
- Screenshot: TopBar shows `tmp3qqv7ztm.tif · 1ch · 120×100 · − DARK`; Source card shows highlighted DARK FRAME panel with `subtracted: tmp3qqv7ztm.tif` and active Replace/Clear buttons; canvas renders solid black (image − dark = 0). Tier 1 + Tier 3 smoke green.

---

## 2026-04-22 — Percentile killed (everywhere) + MTF stroke/marker fix + PNG export + Save/Load H5 path (Claude Opus 4.7)

User feedback: "no contrast at all almost here, percentile still shows 0.708, remove this percentiles thing at once and use 5-point contrast as main metric"; "save/load json should also load the h5 file"; "even when line set to solid, it is still dashed"; "add option to have marker with different shapes"; "add option to export as png".

1. **Percentile finally fully purged from the visible UI.** The previous round removed it from the dropdown + sidebar table + analysis Summary table, but `ProfilePreview` still had a method-driven fallthrough — when the localStorage cache held an old `'percentile'` value the big number was still pulling `m.modulation_pct`. Now `primary` is unconditionally the live 5-point client recompute (`primary5pt`), the title row is hardcoded to "Michelson · 5-point", and the percentile cell in the stats grid is gone. Curl-validated value-set still includes `modulation_pct` in the response (for anyone scripting) but no part of the visible UI reads it anymore.

2. **MTF: stroke now applies to V too (no auto-override).** Previously V-direction lines forced `strokeDasharray='5 3'` regardless of the toolbar choice, so "solid" still drew dashed for V. Removed the override; `dashPattern` is honored for both H and V. Visual H/V differentiation is preserved via marker shape (`auto` mode keeps H=circle / V=square).

3. **MTF: marker shape selector.** New toolbar segmented control with `auto / circle / square / triangle / diamond / cross / plus`. New `MarkerShape` SVG primitive draws each shape at consistent visual size (~7 px) with `<title>` tooltips threading G/E/lp_mm/Mich. `auto` keeps the legacy H=circle / V=square distinction; the others apply to both directions.

4. **Save / Load JSON now round-trips the H5 path.** `LoadedSource` gained a `path: Optional[str]` field, populated to the absolute resolved path when the source came from `/api/sources/load-path` (or the CLI `mantisanalysis path/to/file`). Browser-uploaded files still get `path=None` because the original disk location isn't exposed for security. `SourceSummary` and `STORE.list()` echo it. Frontend `exportConfig` writes `source: { name, kind, path }`; on `importConfig`, if `source.path` differs from current and is set, the frontend POSTs `/api/sources/load-path` first and switches via the new `onSwitchSource` prop (App-level setSource). On 404 / permission-denied, falls back gracefully to "using current source" with a warn-toast.

5. **Analysis modal: Export PNG.** `dom-to-image-more@3.4.4` from CDN. New `exportPNG` callback captures the active tab body (now wrapped in a `tabBodyRef`) at 2× DPR with the panel-alt background color, downloads as `mantis-{tab}-{timestamp}.png`. Header buttons reorganized: PNG · CSV · JSON. Verified end-to-end via Preview MCP — anchor download fires with `mantis-mtf-{ts}.png` and real blob URL after click. (One non-fatal `SecurityError` reading Google Fonts CSS rules — fonts fall back to system defaults in the PNG; everything else inlines correctly.)

Verified via Preview MCP: drew 4 lines, sidebar shows `MICH (5-PT)` column, ProfilePreview header reads "MICHELSON · 5-POINT" with 5-point value bold-accent in the stats grid (no percentile cell), MTF marker switched to triangle visibly, PNG export downloaded a real blob. Tier 1 + Tier 3 smoke green.

---

## 2026-04-22 — Detector invariants + percentile removal + MTF style picker (Claude Opus 4.7)

User feedback: "michelson percentile makes zero sense, always close to 1.00 PASS"; "picked-lines table should show 5-point if percentile can't be made meaningful"; "auto 5-point detect: enforce bright-dark-bright-dark-bright order with dark ≤ adjacent bright"; "let me select different MTF curve styles".

1. **5-point detector rewritten with hard invariants.** New `detect_three_bar_points`:
   - Picks 3 brightest peaks (by prominence × value, with `min_dist_frac=0.06`).
   - For each consecutive bracketed segment, takes the **local minimum** as the dark sample. `np.argmin(profile[a:b+1])` is mathematically guaranteed ≤ both endpoints — so the dark-vs-adjacent-bright invariant is enforced **by construction**, not by post-hoc validation.
   - Final safety clamp ensures dark ≤ each adjacent bright even on degenerate single-sample spans (the user's "points may share location" allowance).
   - `bars_bright = True` always — the labeled "bright" set is locally brightest by construction; the UI shows yellow dots above and blue dots below the curve consistently. For a negative USAF (dark bars on bright surround) the bright dots will land at inter-bar bright gaps; that's deliberate — the contrast math is polarity-symmetric, but the visual labeling stays consistent.
   - Fallback `_spread_top_samples` handles low-prominence cases (very smooth or noisy profiles) by picking the top-N highest-value samples with a minimum-separation constraint.
   - Unit-verified: synthetic 3-bar profile (bars at 30/65/95, gaps between, σ=200 noise) → bright = [23,64,99] @ 9310/9431/9087 DN, dark = [48,79] @ 663/618 DN. Order = `BDBDB`, every dark ≤ both adjacent brights. ✓

2. **Mich (P10/P90) percentile removed from the visible UI.** The metric is fundamentally misleading on USAF profiles — `(P90 − P10) / (P90 + P10)` reads ~1 for any line that crosses both bright surround and dark bars regardless of bar-pattern visibility. Three changes:
   - **Picking method dropdown** (USAF sidebar): `Percentile (P10/P90)` option dropped. Remaining: `5-point (3 bars / 2 gaps) — default`, `FFT @ fundamental`, `Peak-to-peak (min/max)`. Tooltip explains why.
   - **Picked-lines sidebar table**: `Mich.` column header renamed to `Mich (5-pt)` so it's unambiguous, and the cell value now always reads from `m.modulation_5pt` (no longer dependent on the dropdown's "primary" pick). Sort key, summary stats (`passCount`, `failing`, detection-limit calc) all use `modulation_5pt` consistently.
   - **Analysis Summary table**: `Mich (P10/P90)` column dropped. Remaining columns: 5-pt, FFT, min/max. Comment in `analysis.jsx` explains the omission.
   - The percentile value is **still computed and returned in the JSON export** so anyone scripting against the raw API can access it; only removed from the visible UI.

3. **MTF curve style toolbar.** New row of selectors above the per-channel mini-charts:
   - **Style**: `Lines + markers` (default) / `Lines only` / `Markers only (scatter)` / `Stair-step`.
   - **Stroke**: `solid` / `dashed` / `dotted` / `dashdot` (modulates the line's `strokeDasharray`).
   - **X-axis**: `log` (default) / `linear`.
   - Each switch updates all per-channel charts simultaneously. The mini-chart respects the new props (V-direction always overrides stroke to dashed for visual differentiation; stair-step emits a step-after polyline path).
   - Verified by screenshot at `lines+markers/solid/log` (default) and `markers only/dotted/linear` (alternate) — both render correctly.

Verified end-to-end via Preview MCP: drew 4 lines, ran analysis, switched MTF styles + log/linear, opened Summary table, closed modal, observed sidebar `MICH (5-PT)` header. All 4 changes visible. Tier 1 + Tier 3 smoke green.

---

## 2026-04-22 — Analysis modal rewrite, template-fidelity + verify-by-render workflow (Claude Opus 4.7)

User feedback: "terrible job" on earlier analysis-tab attempts — Detection heatmap was an image overlay rather than the template's real G×E Michelson matrix; MTF charts were all overlaid on one plot; profile gallery was sparse; page white-screened right after the first line was drawn. Directed to **re-audit the template**, **download the preview tooling**, and **verify by rendered result**.

### Bug fixes
1. **White-screen crash**: `ProfilePreview` referenced `vMin` / `vMax` that I had renamed during the y-padding refactor. Replaced with `m.profile_min` / `m.profile_max`.
2. **Browser was caching stale Babel transpiles** even after edits. Added `Cache-Control: no-store, max-age=0` to every static response via a `NoCacheStatic` subclass of `StaticFiles`; the server now serves JSX + HTML as no-store, so reloads always pick up the latest file.
3. **`modulation_pct > 1` under aggressive ISP**: unsharp-mask over-shoot pushes DN below 0, which inverts the percentile-Michelson ratio. Fixed in two places: `_apply_analysis_isp` clamps to `[0, ∞)` after every stage; `michelson()` clamps its output to `[0, 1]` defensively.
4. **`modulation_fft > 1` for sub-Nyquist / spiky profiles**: the (π/2) square-wave coefficient assumes an ideal square; real low-SNR / aliased signals over-shoot. Clamp `measure_modulation_fft` to `[0, 1]`.
5. **5-point detector polarity**: rewrote `detect_three_bar_points` to try BOTH polarities (3 peaks + 2 valleys, and 3 valleys + 2 peaks) and pick the one that maximizes `contrast × spacing_regularity × within-set tightness`. After picking, the `bars_bright` label is derived from actual mean DN so "dark" is always lower than "bright" on the profile — not just the detector's initial guess.

### Workflow upgrades (ultra-efforts)
6. **Directory merge**: `.claude` is now a symlink to `.agent`. Moved `launch.json` + `settings.local.json` under `.agent/`. Both paths resolve to the same files; one source of truth. Added AGENT_RULES rules 13 (one workflow dir) and 14 (verify by rendered result).
7. **Verify-by-render workflow established**: loaded the Claude Preview MCP, scripted line-draw + tab-clicks via `preview_eval`, screenshot-verified every tab before claiming done. This is now the standard workflow for UI changes (AGENT_RULES rule 14).

### Analysis modal rewrite (per-template)
8. **Re-read the original template analysis.jsx** to inventory the exact shape of each tab, then rewrote `web/src/analysis.jsx` from scratch:
    - **MTF curves** — per-channel subplot grid (inline SVG mini-charts, log x, H/V markers, threshold dashed horizontal, detection-limit dotted vertical, channel-color first column). Responsive: `repeat(auto-fill, minmax(380px, 1fr))`.
    - **Profile gallery** — compact pass/fail-bordered cards (2 px border = outcome). Inline SVG profile polyline + bar/gap markers + below-Nyquist warning. `repeat(auto-fill, minmax(220px, 1fr))`.
    - **Summary table** — real HTML `<table>`, sortable every column, channel-colored first column with dot swatch, pass/fail/<Nyquist color-coded Mich cell, ✓/✗ Pass column.
    - **Detection heatmap** — REAL **G×E Michelson matrix** per channel with JET colormap (10 built-in maps — JET, turbo, viridis, magma, inferno, plasma, cividis, hot, cool, gray). Cells without picked data render as dashed "—". Vertical colorbar with threshold tick. Per-cell hover shows `G·E·M·n`.
    - **Group sweep** — 6 mini-charts (one per USAF group). X = element 1-6, Y = Michelson (5-pt), one curve per channel, threshold dashed horizontal.
    - **FFT / MTF** — view toggle (CTF / Coltman / FFT spectra). CTF = raw 5-point Michelson. Coltman = (π/4)·CTF (sine-wave MTF approximation). FFT spectra = per-line magnitude via client-side DFT.
9. **Filter bar** above the tabs — channel chips multi-select, gain (All/HG/LG), direction (All/H/V), threshold slider live-updates every tab.
10. **CSV + JSON export** — header buttons; CSV = 23 columns flat per (channel × line), JSON = round-trippable payload.
11. **Performance**: used inline SVG for the many-small-chart cases (profile cards, group-sweep panels, per-channel MTFs, heatmap cells, FFT spectra cards) instead of one Plotly instance per. Plotly reserved for the single big chart in the FFT/MTF overlay view. Dozens of charts per tab stay snappy.

Verified end-to-end via the Preview MCP: drew 4 lines programmatically on a loaded real H5 source, ran analysis, clicked each of the 6 tabs, screenshotted — every tab renders correctly. Smoke tier 1 + 3 both PASS.

---

## 2026-04-22 — Resizable side panels + button overflow + profile y-padding (Claude Opus 4.7)

Three reported regressions in one quick pass:

1. **Save / Load config buttons overflowed** the Source card — only "Save" was visible; "Load" got pushed off-screen. Cause: each button had `fullWidth` (= `width: 100%`) plus `flexShrink: 0`, and they sat in a `display: flex` row. Two non-shrinkable 100%-wide siblings can't fit in one container, so the second is clipped. Fix: switch the row to `display: grid; gridTemplateColumns: 1fr 1fr`, where each cell is a guaranteed half-width. Removed the now-unnecessary `Tip` wrappers (Button already accepts `title`) and shortened the labels to just "Save" / "Load" so they fit comfortably in narrow sidebars too.

2. **Resizable left + right panels in every mode (USAF, FPN, DoF).** Added a small `ResizeHandle` primitive in `shared.jsx` — a 6 px-wide invisible-by-default vertical bar absolutely positioned on the inside edge of a sidebar, that paints a translucent accent on hover and a solid accent during drag. `cursor: col-resize` is pinned globally (`document.body.style.cursor`) for the whole drag so it doesn't flicker over child elements. The handle owns the start-snapshot + cumulative-delta math so the parent just passes `value` + `onChange` + `min/max` + `grow: ±1`. Each mode now stores `leftW` and `rightW` in localStorage (`usaf/leftW`, `fpn/rightW`, etc.) so the layout survives reloads.

3. **ProfilePreview y-axis was clipping** the dragged-point circles, their dashed guide lines, and the "B1/G1" badges when they sat near the profile's actual min or max. Cause: y-range was set tight to `[profile_min, profile_max]`, leaving zero room for the circle radius (5–6 px) or the labels rendered at `y - 8`. Fix: compute padded range — `+12% top / +18% bottom` of the dynamic range (extra room at the bottom for the gap labels rendered at `H - 2`). Polyline, p10/p90 dashed reference lines, and bar/gap circles all now route through a single `yOf(v)` helper that uses the padded range, so nothing clips.

Tier 1 + 3 smoke green. ResizeHandle is also exported on `window` so any future panels (e.g. analysis-modal sidebars) can use the same primitive.

---

## 2026-04-22 — Analysis modal: native Plotly vector charts, no more PNG figures (Claude Opus 4.7)

User feedback: PNG figures blurry, table unreadable as tiny image, missing raw CSV export, missing colormap (JET), no channel/gain/direction filters inside the modal, and a white-screen crash after drawing the first line.

1. **White-screen crash fix.** `ProfilePreview` had `React.useState` + `React.useEffect` below early returns that fired when `line` was null / pending. This violates the React rule that hooks must be called in the same order every render. Moved all hooks above the early returns; live-drag feedback now goes through a local `dragOverride` state instead of mutating the line prop. Also got rid of the custom-event force-rerender hack.
2. **Plotly.js CDN** added to `web/index.html`. Every chart in the analysis modal is now real interactive SVG (pan / zoom / hover readouts / download-as-SVG built-in).
3. **`/api/usaf/analyze` returns JSON only** — no more base64 PNG figures in the payload. Schema:
   ```
   { channels, specs, threshold, channel_shape, measurements: {ch: [MeasureResponse | null]},
     channel_thumbnails: {ch: data-URL}, per_channel_detection_limit: {ch: lp_mm|null} }
   ```
4. **Colormap support.**
   - `channel_to_png_bytes(image, ..., colormap="gray")` in `session.py` accepts any matplotlib colormap (JET, turbo, viridis, magma, inferno, plasma, cividis, hot, cool, gist_heat, ...).
   - `channel_thumbnail` endpoint exposes `colormap` query param.
   - `channelPngUrl` in `shared.jsx` plumbs it into the URL.
   - USAF Display card gets a colormap selector (JET, turbo, viridis, etc.); the canvas live image re-fetches immediately when the colormap changes.
5. **New analysis modal** in `web/src/analysis.jsx` — complete rewrite, six proper tabs:
   - **MTF curves** — Plotly log-x scatter/line with H/V markers, per-channel detection-limit dotted lines, threshold horizontal dashed line.
   - **Profile gallery** — per-line grid of Plotly profile plots (one per picked line), every channel overlaid, bar/gap detection markers as vertical dotted lines.
   - **Summary table** — real HTML `<table>`, sortable by any column, pass/fail/<Nyquist color-coded, zebra stripes, per-channel-color first column.
   - **Detection heatmap** — Plotly with the (server-rendered, colormap-applied) channel image as a layout image, picked lines overlaid as colored scatter lines with hover readouts. In-tab dropdown to switch channel + colormap. Preserves aspect ratio (`scaleanchor: 'x'`).
   - **Group sweep** — Plotly grouped bar chart, mean Michelson per USAF group per channel, threshold line.
   - **FFT / MTF** — per-line Plotly FFT magnitude (client-side DFT on the returned profile), expected-fundamental marker. One chart per line, all channels overlaid.
6. **Filters bar** above the tabs — channel multi-select chips, gain segmented (All / HG / LG), direction segmented (All / H / V), threshold slider (live-updates every tab including pass/fail coloring).
7. **CSV + JSON export** — buttons in the modal header. CSV flattens every visible (channel × line) measurement into 23 columns (G/E/D, lp/mm, all four Michelson flavors, s/cyc, reliability, bar/gap values + indices, profile min/max/p10/p90, line length, n_samples). JSON is the full raw payload (round-trippable).
8. **Plotly config**: built-in toolbar lets the user download any chart as SVG at 2× scale, pan/zoom with scroll, double-click to reset. No external library config needed.

Curl-verified: `/api/sources/.../thumbnail.png?colormap=jet` returns `mode=RGB` color PNGs; `/api/usaf/analyze` returns the new JSON shape with all fields present; per-channel detection limit computes correctly (2.0 lp/mm on G1E1 / G2E1 / G3E1 test lines). Tier 1+2+3 smoke all green.

---

## 2026-04-22 — 5-point Michelson + interactive points + undo-G/E + file filter (Claude Opus 4.7)

User feedback: single-sample min/max Michelson too noisy; asked for a proper 5-point (3 bars + 2 gaps) estimator with auto-detection, user-editable points, a toggle (the method selector), undo-revert-G/E, and a file-type filter in the Open dialog.

1. **5-point Michelson, robust.** New `detect_three_bar_points(profile)` in `usaf_groups.py` Gaussian-smooths the profile, calls `scipy.signal.find_peaks` for peaks *and* negated-profile valleys with prominence-gated filtering, chooses the polarity (bright bars vs dark bars) by summed prominence, and picks the most-prominent opposite-polarity extremum between each pair of bar centers. Then `measure_modulation_5pt` computes `M = (Ī_bright − Ī_dark) / (Ī_bright + Ī_dark)` from the 3+2 averages. Verified on a synthetic 3-bar profile: auto-detect lands within 3 samples of the true bar centers and returns Michelson 0.819 vs analytic 0.800 under σ=120 DN noise.
2. **`measure_line` always returns `modulation_5pt` + `bar_indices` + `gap_indices` + values**, and takes optional `bar_indices` / `gap_indices` kwargs to override auto-detect.
3. **Server schemas**: `MeasureRequest` accepts `bar_indices` / `gap_indices` overrides; `MeasureResponse` echoes them back plus the new `modulation_5pt` and bar/gap values. Default method switched to `five_point`.
4. **Frontend method segmented** defaults to 5-point, with percentile / FFT / min-max available. Method is persisted in localStorage.
5. **ProfilePreview is now interactive.** The SVG renders 5 draggable points (3 yellow "B" bars + 2 blue "G" gaps) with dashed guide lines to the x-axis and DN labels. Drag-to-adjust triggers an immediate *client-side* recompute for lag-free feedback, then a single server re-measure on mouseup. A small "Auto-detect" button resets manual overrides. The stat grid now shows all four Michelson flavors (5-point / percentile / FFT / min-max) side by side so the user can eyeball the spread.
6. **Undo / delete revert G/E/direction.** Every new line stores the `{group, element, direction}` that were active *before* `advance()` fired. `⌘Z`, the canvas Undo button, the keyboard `Delete` for selected lines, and the sidebar "Delete" / "Clear all" buttons all restore those values if the latest line is removed. Middle-of-list deletions intentionally don't revert (that would be surprising).
7. **5-pixel minimum** (was 6) in `addLine`.
8. **File-type selector** in the TopBar. A native `<select>` with six presets (All files / H5 / all images / PNG / TIFF / JPEG) drives the `<input type="file">` `accept` attribute. Choice is persisted in localStorage.

Tier 1+2+3 smoke still green. End-to-end: `/api/usaf/measure` now returns `modulation_5pt = 0.7149` (vs `modulation_pct = 0.8859` — the percentile estimator was inflating the contrast reading by taking the tails rather than the detected features).

---

## 2026-04-22 — USAF analysis pass: realistic sample + 6 analysis figures + 5-px min (Claude Opus 4.7)

User reported: analysis broken / ugly / missing info, can't pick lines under 6 px, ISP not changing the canvas.

1. **Line minimum 6 → 5 px.** `web/src/usaf.jsx:addLine` guard dropped.
2. **Synthetic sample rewritten to a real USAF-1951-style target** with four rows of bar groups at decreasing bar widths (18 → 1.1 px), subtle vignette, and per-channel gain/black-level/noise offsets. Previously the sample was a single smooth sine — on that, ISP sharpening / denoising produced invisible changes because there were no high-frequency features to act on. The new sample has hard bar edges, so dragging any ISP slider visibly alters the canvas (curl-verified: raw 55 KB vs sharpen 63 KB vs denoise 37 KB, all distinct sha1).
3. **`Cache-Control: no-store` on `/api/sources/.../thumbnail.png`** so the browser can't serve stale ISP-off thumbnails across param changes.
4. **New `mantisanalysis/usaf_figures.py`** with six matplotlib figure builders — no Qt, fully themed (light / dark), publication-grade density:
   - `build_mtf_curves_fig` — Michelson vs lp/mm log-x, H/V directions, threshold line, per-channel detection limits.
   - `build_profile_gallery_fig` — one sub-plot per picked line, extracted profile overlaid for every requested channel.
   - `build_summary_table_fig` — matplotlib `ax.table` with G/E/D/lp-mm/Mich-P/Mich-FFT/Mich-minmax/s-per-cyc/reliability, colored by pass/fail/below-Nyquist.
   - `build_detection_overlay_fig` — per-channel image, picked lines colored by outcome, labels per line.
   - `build_group_sweep_fig` — grouped bar chart of mean Michelson per USAF group, per channel.
   - `build_fft_spectra_fig` — per-line FFT magnitude with fundamental marked.
   Plus `build_all_usaf_figures` orchestrator returning `{ figures: {name: bytes}, per_channel_detection_limit, summary_channel }`.
5. **`/api/usaf/analyze` returns named figures dict** keyed by figure name, plus per-channel detection limits.
6. **`web/src/analysis.jsx` USAF branch** now builds six named tabs in a canonical order (MTF, Profile gallery, Summary table, Detection overlay, Group sweep, FFT spectra) plus the Summary tab, and shows per-channel detection limits in the Summary.

Tier 1+2+3 smoke still green. Verified end-to-end: analyze returns all 6 figures (196 KB detection overlay, 82 KB profile gallery, 84 KB summary table, 63 KB FFT, 57 KB MTF curves, 34 KB group sweep).

---

## 2026-04-22 — USAF canvas crispness + ISP live-fetch (Claude Opus 4.7)

Two follow-up bugs from live use:

1. **Lines + labels became blurry when zoomed in.** The SVG overlay was sitting inside the same CSS `transform: scale(zoom)` as the `<img>`. Chrome/Safari rasterize an element once at its unscaled pixel size and then upsample during CSS scaling, so strokes and text were losing resolution. Fix: split the layer stack — only the `<img>` stays inside the transform; the overlay SVG renders in untransformed screen-pixel space, with each image-space endpoint forward-mapped through a new `imgToScreen()` helper (inverse of `toImg`, same flip→rotate→scale→pan chain). Strokes and labels now render at their true resolution at every zoom level. Also added `image-rendering: pixelated` on the `<img>` when `zoom ≥ 1`, so individual sensor pixels stay crisp instead of bilinear-smoothed past 100%.

2. **ISP still not visibly applying to the live canvas image.** Replaced the previous `useCallback` → `useMemo` chain (which passed the callback ref through deps) with a plain builder plus a `useMemo` whose dep array explicitly lists every ISP state var. Now any ISP slider / toggle immediately invalidates the memo, which rebuilds the URL with fresh query params, which triggers the browser to refetch the server-rendered thumbnail. Curl-verified that the server already correctly produces different PNGs for raw vs. sharpen vs. denoise; the prior bug was only on the frontend side — the memo was subscribing to a callback reference instead of the underlying state.

Tier 1+2+3 smoke still green.

---

## 2026-04-22 — USAF canvas fixes: coord mapping, zoom, strokes, live ISP (Claude Opus 4.7)

Five bugs reported from live use of the USAF canvas; all five fixed end-to-end.

1. **Coord mapping was wrong under zoom / rotation / flip / non-square aspect.**
   `web/src/usaf.jsx:toImg` now inverts the full CSS transform stack in the
   correct order (pan → zoom → rotation → flips) and then maps through the
   `object-fit: contain` letterbox. Verified at zoom, rotation 90/180/270, and
   both flips.
2. **Labels stretched because SVG used `preserveAspectRatio="none"`.**
   Overlay now uses `preserveAspectRatio="xMidYMid meet"`, matching the img's
   letterbox. Text characters render at their natural aspect.
3. **Wheel required ⌘/⇧ to zoom.** Dropped the modifier guard; plain scroll
   zooms, with the cursor position as a stable focal point (pan is updated to
   keep the pixel under the cursor fixed across the zoom step).
4. **Line thickness grew with zoom.** All overlay strokes now divide by the
   current `zoom` so they render at constant screen pixels (matplotlib
   behavior). Labels wrap in `scale(1/zoom)` so text + box + border stay at
   fixed screen size regardless of zoom.
5. **ISP not applied to live canvas image.** `channel_thumbnail` endpoint now
   takes ISP query params (sharpen_method/amount/radius, denoise_sigma,
   black_level) and runs them through `_apply_analysis_isp` before serializing
   the PNG. `channelPngUrl` in `web/src/shared.jsx` builds the URL with ISP
   params; `usaf.jsx` memoizes `imgSrc` on `ispPayload()` so toggling ISP or
   any knob refetches the thumbnail. Curl-verified: raw and ISP thumbnails
   have different sha1 hashes.

Tier 1+2+3 smoke still green.

---

## 2026-04-22 — USAF full-feature port (Claude Opus 4.7)

- Re-read the original design bundle (`/tmp/mantis_design/camera-performance-analysis/project/src/usaf.jsx`) and ported every feature into the server-backed web/src/usaf.jsx. The file grew from ~230 lines to ~800.
- Added ISP to the server: `ISPParams` Pydantic model + `_apply_analysis_isp` helper. `MeasureRequest` and `USAFAnalyzeRequest` now accept an optional `isp` field. Server pipeline is black-level → sharpen (Unsharp/Laplacian/High-pass via `image_processing.apply_sharpen`) → Gaussian denoise.
- Frontend USAF features now shipping:
  - Rulers (H + V) with adaptive ticks reflecting pan/zoom; cursor marker.
  - Zoom-to-cursor via ⌘/⇧ + wheel; pan via middle-mouse, `Pan` tool, or space-hold.
  - Tool toggle (Pick / Pan) + Fit / Undo / Zoom ± / Reset buttons with live zoom %.
  - Rotation-aware labels — badges counter-rotate + counter-flip so `G0E1H` always reads upright.
  - Snap-to-axis with live guide lines when drawing.
  - Multi-select sortable Lines table: ⇧-click range, ⌘-click toggle, select-all header checkbox, sortable by every column, pass/fail/below-Nyquist coloring, ISP-applied marker.
  - Profile preview: real server profile array (not synthetic), P10/P90 dashed refs, PASS/FAIL badge, FFT + min/max + lp/mm + s/cyc breakdown, below-Nyquist warning.
  - HUD (live length, G/E, lp/mm) while drawing.
  - Display controls (brightness/contrast/gamma) as CSS filters — clearly labeled as display-only.
  - Save / Load JSON config — saves picker state, view, ISP, and all picked lines; on load, re-measures each line against the current source.
  - CSV export of the measurements table.
  - Keyboard shortcuts: R rotate · F/0 fit · ⌘Z undo · ⌘A select-all · Del delete-selected · ←→ G · ↑↓ E · Esc cancel first-click · Space pan.
- Re-measures all lines automatically when channel / method / ISP toggles change.
- Verified end-to-end via curl: raw Michelson 0.0055 → ISP-sharpened Michelson 0.0070 on the sample source.
- Tier 1+2+3 smoke all PASS.

---

## 2026-04-22 — launcher scripts: MantisAnalysis.{command,bat} (Claude Opus 4.7)

- Added `MantisAnalysis.command` (macOS, `+x`) and `MantisAnalysis.bat`
  (Windows) at the repo root for Finder / Explorer double-click launch.
- Each script discovers the local Python (3.10+), pip-installs the
  package in editable mode the first time, then runs
  `python -m mantisanalysis`, which boots the FastAPI server on
  `127.0.0.1:8765` and opens the default browser.
- Verified the macOS `.command` launches the server and shuts down
  cleanly with `--no-browser --port 8766` + a 3-second timeout.

---

## 2026-04-22 — gui-rewrite-v2: FastAPI backend + server-backed React (Claude Opus 4.7)

- Per D-0009: the PyQt GUI is gone and the web UI is the only frontend.
- Added `mantisanalysis/server.py` (FastAPI + Pydantic), `session.py`
  (in-memory source store + thumbnail generator), `figures.py`
  (matplotlib→PNG byte adapter).
- Rewrote `mantisanalysis/app.py` (CLI → uvicorn + browser open) and
  `mantisanalysis/__main__.py` accordingly.
- Deleted `scripts/pick_lines_gui.py`, `mantisanalysis/modes/{common,
  dof,fpn,__init__}.py`, `MantisAnalysis.bat`.
- `pyproject.toml`: version 0.1.0 → 0.2.0; removed `PySide6` + `pytest-qt`;
  added `fastapi`, `uvicorn[standard]`, `python-multipart`, `pydantic`
  runtime deps and `httpx` dev dep.
- Rewrote `scripts/smoke_test.py` tier 3 — now a FastAPI TestClient
  round-trip (sample load → thumbnail → USAF measure → FPN compute →
  DoF compute). Tier 1+2+3 all green locally.
- Added `tier3-server` job to `.github/workflows/smoke.yml`.
- Rewrote every file in `web/src/` to consume the real server API:
  - `shared.jsx` gains `apiFetch` / `apiUpload` / `channelPngUrl` /
    `SourceCtx` / `useSource` / `useDebounced`.
  - `app.jsx` bootstraps against `/api/sources`, auto-loads a sample
    when none exists, uploads real files via `/api/sources/upload`.
  - `usaf.jsx` / `fpn.jsx` / `dof.jsx` swap every synthetic image for
    a real PNG thumbnail URL and every local compute for the
    corresponding server endpoint (with debounced live stats).
  - `analysis.jsx` displays server-rendered matplotlib PNGs.
- Updated `.agent/ARCHITECTURE.md`, `AGENT_RULES.md`, `DECISIONS.md`,
  `REPO_MAP.md`, `README.md`, initiative Status.md.

Smoke status at session close: ✅ Tier 1, ✅ Tier 2, ✅ Tier 3.

---

## 2026-04-22 — gui-rewrite-v1: land React prototype at `web/` (Claude Opus 4.7, superseded same day)

- Fetched the Claude Design handoff bundle for `MantisAnalysis Suite`
  (https://api.anthropic.com/v1/design/h/sRqIo_XUO3eQLBfY1bw3sg) and
  landed 6 files verbatim under `web/` — `index.html` + `src/{shared,
  usaf, fpn, dof, analysis, app}.jsx`. ≈3800 lines of React prototype,
  CDN-loaded (React 18 + Babel standalone), synthetic imagery only.
- Opened `.agent/runs/gui-rewrite-v1/` with ExecPlan + Status.
- Logged D-0008 (adopt React prototype as parallel GUI, PyQt untouched).
- Added B-0013 (wire web GUI to real Python analysis), B-0014 (adopt
  bundler / toolchain), B-0015 (web-side test harness).
- Updated `.agent/ARCHITECTURE.md`, `.agent/REPO_MAP.md`, and
  `README.md` to reflect the new `web/` layer.
- Smoke status at session close: see `.agent/HANDOFF.md` for the
  as-run result of Tier 1 + Tier 2 + pytest.

No Python source was modified — the Python package, tests, scripts,
smoke harness, and CI remain exactly as they were at the end of the
Phase 2 pass.

---

## 2026-04-22 — Phase 2 implementation pass (Claude Opus 4.7)

- Renamed top-level folder `rgbnir-analysis/` → `MantisAnalysis/` via
  robocopy /MOVE (Windows handle on the original folder root left an
  empty husk; recorded as R-0008).
- Renamed Python package `rgbnir/` → `mantisanalysis/`. Rewrote 3
  `from rgbnir.X` import sites in `scripts/`.
- Added `pyproject.toml` (PEP 621), `LICENSE` (MIT), `.gitignore`.
- Added `mantisanalysis/__init__.py` with version + author metadata.
- Added `mantisanalysis/app.py` (shim) + `mantisanalysis/__main__.py`
  so `python -m mantisanalysis` works; `[project.scripts]` entry
  point set.
- Renamed `launch_picker.bat` → `MantisAnalysis.bat`; updated to use
  `python -m mantisanalysis`.
- Added `scripts/smoke_test.py` with Tiers 1, 2, 3 implemented; Tier
  4 stub. Tier 1 + 2 pass; Tier 3 verified mid-development.
- Added `tests/` (5 unit modules + 1 headless module = 39 tests).
  All green via `pytest -q`.
- Built `.agent/` operating layer: 17 docs (00_START_HERE through
  CHANGELOG_AGENT) + `manifest.yaml` + `templates/` + `runs/` (empty).
- Added `.github/workflows/smoke.yml` (Tier 1 + pytest matrix on
  Linux/macOS/Windows × Python 3.10/3.11/3.12/3.13; Tier 2 on Linux).
- Rewrote root `README.md` as user-facing docs (install + run + modes
  + troubleshooting). Preserved `UI_SPEC.md` and `HANDOFF.md` from
  Phase 1.
- Recorded 7 DECISIONS, 8 RISKS, 12 BACKLOG items.
- VCS: `git init`, `git remote add origin
  https://github.com/BioSensorsLab-Illinois/MantisAnalysis.git`. **No
  initial commit yet** — held for user review (B-0010).

Smoke status at session close: ✅ Tier 1, ✅ Tier 2, ⚠ Tier 3
(verified during dev, not formally re-run after rename), ❌ Tier 4
(not implemented).

`pytest tests/`: ✅ 39 passed.

---

*(future entries above this line)*
