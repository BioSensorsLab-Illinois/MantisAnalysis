# analysis-page-overhaul-v1 — ExecPlan (ultra)

Opened: 2026-04-23
Owner: agent (per user "treat [the analysis results page] as its own
major project and feature. that is the most important part of this
software and has to be very stable and very functional").

## 1. Problem statement

The analysis-results modal is the primary value-delivery surface of
MantisAnalysis. It is where scientists look at the numbers that come
out of USAF / FPN / DoF and where they export figures for papers.
After six rounds of incremental edits it has accumulated real debt:

1. **Background controls don't compose.** The modal body, card
   chrome, and SVG body each track backgrounds independently. Flipping
   `Card bg` in the style panel leaves ghost panels or misses whole
   tabs (user report: "background color is not working again").
2. **Three parallel modal implementations** — `USAFAnalysisModal`,
   `FPNAnalysisModal`, `DoFAnalysisModal` — copy the filter bar, tab
   rail, toolbar, export handler, and PlotStyleCtx plumbing. Any bug
   fix has to land in three places, which is why regressions keep
   re-appearing.
3. **~15 chart components** hand-roll their own SVG chrome, sometimes
   through `ChartCard`, sometimes inline. Some have per-card PNG
   buttons, some don't; some wrap their `viewBox` with
   `preserveAspectRatio="xMidYMid meet"` and some with `"none"`;
   responsive sizing is ad-hoc.
4. **plotStyle fields have half-wiring.** `style.aspect`,
   `style.palette`, `style.showGrid`, `style.markerSize`,
   `style.cardMaxWidth`, `style.pageBackground` (doesn't exist),
   `style.exportBackground` — some tokens work in some charts but not
   others. Users can't tell which sliders actually bite.
5. **Export path is fragile.** dom-to-image-more hits CORS issues on
   Google Fonts, can return misaligned output when inner SVGs use
   `width="100%"`, and doesn't cleanly handle the heatmap tab's
   `<canvas>` + SVG overlay composite. We've fixed it three times and
   it's still intermittently sketchy.
6. **Empty states are inconsistent.** Some tabs show helpful
   guidance when there's nothing to plot; others render an empty chart
   body. Some show pre-computed defaults even when the filter has
   excluded everything.
7. **Per-mode specifics leak into the shared layer.** `tiltFactor`,
   `unitPref`, `metricFilter` are DoF-only state but their helpers
   (`dofFmt`, `dofToDisplay`) are global. USAF / FPN could reuse some
   of these but the contracts aren't explicit.
8. **Deferred items linger.** `aspect` control with no
   implementation, `cardMaxWidth` that only works in some layouts,
   unused `chartScale`, PlotlyChart path still lurking, legacy
   `LegacyPngModal` still compiled in.

## 2. Goal

Treat the analysis page as a first-class product feature. Deliver:

- **One shell** for the modal, the filter bar, the toolbar, and the
  plot-style panel. USAF / FPN / DoF plug tabs in via a registry.
- **One chart primitive** (`<Chart>`) that every SVG chart is rendered
  through. Title / subtitle / body / footer / export come for free.
  Responsive, export-safe, plotStyle-aware.
- **Background that works everywhere.** A single `Page background`
  token. The modal body, card chrome, SVG bodies, and exports all key
  off it. Zero config desync possible.
- **plotStyle where every token bites.** No dead fields. A written
  contract per token and a test harness that mutates each token and
  asserts the rendered DOM reflects the change.
- **A rock-solid export pipeline** that produces pixel-aligned output
  independent of CSS quirks or CORS issues. Replaces dom-to-image for
  the SVG path with direct SVG → canvas rasterization.
- **Empty states everywhere** — every tab renders something coherent
  when the filter leaves nothing to plot.
- **No regressions.** Tier 1 + 2 + 3 smoke green. 40/40 pytest. A new
  Playwright integration test exercises every tab in every mode and
  every export button.

## 3. Non-goals

- No server-side analysis-math changes (usaf_groups / fpn_analysis /
  dof_analysis). The overhaul is frontend + the figure/export adapter.
- No new analysis tabs. We polish what exists, we don't add new
  scientific content.
- No Plotly replacement for USAF. Plotly works; we just make the
  surrounding shell + styling coherent.
- No plugin API beyond per-mode tab registration. Not building an
  extensibility story.

## 4. Phase plan

Each phase ends with a smoke gate, a browser-verification screenshot,
and a commit. Phases are sized so the codebase stays shippable at
every commit boundary.

### Phase 0 — Audit & baseline (output: inventory.md)

- Enumerate every chart component in `web/src/analysis.jsx` (~15).
- For each, list: which `plotStyle.*` tokens it reads; which SVG
  chrome attributes it sets; whether it uses `ChartCard`; whether it
  has a per-card PNG button; whether it renders a canvas.
- Enumerate every `plotStyle` field (~20) and tag each as `alive` /
  `partial` / `dead`.
- Snapshot the current background hierarchy: modal body → tab body →
  card chrome → SVG bg → chart surface.
- Baseline smoke + pytest pass.

Deliverable: `.agent/runs/analysis-page-overhaul-v1/inventory.md`.

### Phase 1 — Foundation primitives (shared.jsx)

New exports (keep old ones alive for the transition):

- `<Chart>` — the single chart primitive. Props:
  `title`, `sub`, `footer`, `channel`, `exportName`, `aspect` (auto
  | 16:9 | 4:3 | 1:1 | 3:4), `children (SVG body)`. Provides card
  chrome, title row with optional per-card PNG button, bounded aspect
  ratio, responsive width, and a single `useChartGeom` context that
  child SVG code reads its canvas dims + tick/axis helpers from.
- `useChartGeom(opts)` — hook that gives `{ W, H, PAD, xOf, yOf }` to
  keep every chart's layout computations consistent + respect the
  user's aspect setting.
- `tokens(style)` — returns a memoized dict of every inline-style
  derivative: `titleStyle`, `axisLabelStyle`, `tickStyle`,
  `legendStyle`, `gridLineProps`, `axisLineProps`. Eliminates the
  repeated `fontSize={scaled(style.titleSize, style)}` boilerplate.
- `<Page>` — a `PlotStyleCtx.Provider` wrapper that also applies the
  resolved `pageBackground` to the modal body. Everything inside the
  provider tree reads bg via `usePageBg()`.
- `renderChartToPng(node, opts)` — new export path. For chart nodes
  whose root is an SVG, serialize the SVG directly via
  `XMLSerializer` + `Blob` + `Image` + `canvas.drawImage`. For chart
  nodes that contain a `<canvas>` (heatmaps), composite:
  draw the canvas first, then draw the SVG overlay on top. No
  dom-to-image. No CORS traps. Deterministic pixel output.
- `renderNodeToPng(node, opts)` — fallback path for HTML-heavy nodes
  (Summary tab table). Uses dom-to-image as a last resort but with
  the same `copyDefaultStyles:false, cacheBust:true` hardening.

New plotStyle fields:

- `pageBackground: 'theme' | 'white' | 'black' | 'transparent' | <hex>`
- `chartBodyBackground: 'inherit' | 'panel' | 'white' | 'transparent'`
- `aspect: 'auto' | '16:9' | '4:3' | '1:1' | '3:4'` — **now wired**
  into `useChartGeom`.

### Phase 2 — PlotStyle model cleanup

- Drop `chartScale` (covered by `cardMaxWidth` + `elementScale`).
- Drop the `palette: 'channel' | 'viridis' | ...` when we know the
  selector value isn't honored by every chart; ensure
  `paletteColor(style, ch)` is used consistently.
- Rename the `Card bg` control to `Page bg` so UI language matches
  the now-unified background model.
- Add a tiny "which tokens move what" hint popover on each slider
  section in the PlotStylePanel.

### Phase 3 — Unified AnalysisModal shell

Build `web/src/analysis/modal.jsx`:

- `<AnalysisModal mode, run, onClose, onToast />` — the new shell.
- Mode specs registered in a per-mode file under `web/src/analysis/`:
  `usaf.jsx`, `fpn.jsx`, `dof.jsx`. Each exports `{ tabs, filterBar,
  exportRow, defaultTab }`.
- Replace the three `USAFAnalysisModal` / `FPNAnalysisModal` /
  `DoFAnalysisModal` functions in `analysis.jsx` with a single
  dispatch: `mode === 'usaf' ? <AnalysisModal mode="usaf" ...` etc.
- Keep the old modals as-is in the first commit behind a feature
  flag so we can swap incrementally.

### Phase 4 — Rewrite every chart on the new primitives

Sweep order (easiest → hardest):

1. `MetricBars` (FPN) — simple SVG bar chart.
2. `RowColCard` (FPN) — two panels stacked.
3. `ProfileCard`, `GroupMiniChart`, `FFTSpectraGrid` (USAF small).
4. `MiniMTFChart` (USAF main).
5. `PSD1DChart`, FPN `Map/PSD/Autocorr` heatmap cards (Phase 1 made
   `renderChartToPng` able to composite canvas + SVG overlay so this
   is the same mechanic everywhere).
6. `LineOverlayChart`, `MetricOverlayChart`, `ChromaticShiftChart`,
   `GaussianFitChart`, `DoFHeatmapCard`, `TiltPlaneSVG`,
   `PointsBarChart`, `HotPixCard`.

Every chart gains: `<Chart title={...} sub={...} exportName={...}
aspect={style.aspect}>` + a minimal SVG body that reads `xOf`, `yOf`
from `useChartGeom`, and uses `tokens(style)` style objects.

### Phase 5 — Export pipeline

- Implement `renderChartToPng` end-to-end.
- Implement canvas-composite path for heatmap tabs.
- Remove the `mantisExport` transform-scale hack and the
  SVG-width-freeze pass; those become unnecessary because the new
  path serializes the SVG with its intrinsic dims directly.
- Per-card PNG button calls the right path automatically based on
  whether the chart root is an SVG or an HTML container.
- Deterministic file naming: `mantis-<mode>-<tab>-<ch|line>-<ts>.png`.

### Phase 6 — Empty states & polish

- Every tab renders an explicit empty-state element when the filter
  leaves nothing to render. Messages are phrased as "do X to see Y",
  not "no data".
- Typography sweep: chart titles, card subtitles, table headers,
  filter bar labels — all resolved through `tokens(style)`. No more
  hardcoded `fontSize: 11` in chart body context.
- Shadow depth + card-border-radius subtle polish so cards look
  intentional at any background.
- Ensure palette selector behavior is stable under `palette = 'channel'`
  (the default) — channels keep their physical-correct colors — and
  under every alternative palette — cyclic mapping stays consistent
  regardless of channel ordering.

### Phase 7 — Tests & CI

New Playwright tests under `tests/web/`:

- `test_analysis_usaf.py` — boot, load a sample, pick lines, open the
  analysis modal, click every tab, assert no PNG `<img>`, assert
  per-card export button exists on every chart card.
- `test_analysis_fpn.py` — same for FPN.
- `test_analysis_dof.py` — same for DoF, plus flipping Unit / Tilt /
  Metric and asserting state updates propagate.
- `test_plotstyle_controls.py` — one test per plotStyle token; set
  via localStorage, reload, assert the rendered DOM reflects the
  change.
- `test_analysis_export.py` — click per-card PNG, capture the
  downloaded blob, assert it's > 1 KB and is `image/png`.

Tier 1 + 2 + 3 smoke + pytest must stay green at every commit.

### Phase 8 — Docs + migration cleanup

- Remove `LegacyPngModal` from analysis.jsx (dead).
- Remove `PlotlyChart` wrapper if its only caller is the USAF MTF tab
  (which is Plotly-backed anyway — it doesn't need the wrapper).
- Update `ARCHITECTURE.md` to describe the new shell + primitives.
- Update `HANDOFF.md` with the new state.
- Update `REPO_MAP.md` for the new `web/src/analysis/` tree.
- Add an ADR under `DECISIONS.md` for the single-shell refactor.
- Close deferred items in `BACKLOG.md`.

## 5. Deferred-item disposition (from prior audit)

- **Dead `plotStyle.aspect` field** → implemented in Phase 1
  (`useChartGeom`).
- **`cardMaxWidth` only works in some layouts** → every new chart
  goes through the same grid in Phase 3 / 4, so this works everywhere.
- **USAF / FPN inline HTML fontSize** → Phase 6 typography sweep.
- **`B-0015` per-mode interaction tests** → Phase 7 Playwright suite.
- **`B-0006` legacy Workflow A CLI smoke** → not touched here; that's
  a backend gate, out of scope for the analysis-page overhaul.
- **`B-0007` rotate-clears-picks warning** → out of scope (picker
  feature, not analysis page).
- **`B-0018` real-sample validation** → still blocked on H5 captures,
  out of agent scope.

## 6. Smoke gate at every phase

`python scripts/smoke_test.py --tier 1 --tier 2 --tier 3` +
`python -m pytest`. No commit merges without a full green.

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Rewriting 15 charts across 4 phases is a big surface. Regressions are likely mid-session. | Ship the old modals under a feature flag until Phase 4 completes. Every commit is independently green. |
| `renderChartToPng` for canvas+SVG composite is non-trivial. | Start with SVG-only charts to prove the pipeline; tackle canvas composites after infra is stable. |
| The new `<Page>` + `pageBackground` model needs the whole modal tree inside its provider. Missed subtree = missed background. | Root the provider at the top of `<AnalysisModal>`; grep for any raw `t.panelAlt` usage inside modal code after refactor. |
| PlotStyle control wiring misses a chart. | Phase 7 test harness mutates every token and asserts at least one DOM change — catches dead-wired charts at CI time. |

## 8. Acceptance checklist

- [ ] All three analysis modals render through `<AnalysisModal>`.
- [ ] Every chart renders through `<Chart>`.
- [ ] Every plotStyle token has at least one visible effect + a
      Playwright test asserting that effect.
- [ ] Flipping `Page bg` changes the modal body, card chrome, chart
      body, AND exports — no config desync.
- [ ] Every chart card has a per-card PNG button.
- [ ] Every per-card PNG export is pixel-aligned (circles + polyline
      use the same xOf/yOf and the export matches the on-screen
      rendering 1:1 at the configured scale).
- [ ] Every tab has an empty state when filters leave nothing to
      render.
- [ ] Tier 1 + 2 + 3 smoke + 40+ pytest all green.
- [ ] New Playwright analysis-modal suite all green.
- [ ] `LegacyPngModal` + unused `PlotlyChart` wrapper removed.
- [ ] `ARCHITECTURE.md`, `HANDOFF.md`, `REPO_MAP.md`, `DECISIONS.md`,
      `BACKLOG.md` updated.
- [ ] Commit pushed; `HANDOFF.md` points at this initiative folder.
