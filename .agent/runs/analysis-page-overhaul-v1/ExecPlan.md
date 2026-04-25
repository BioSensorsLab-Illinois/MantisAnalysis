# analysis-page-overhaul-v1 — ExecPlan (ultra)

Opened: 2026-04-23
Re-evaluated: 2026-04-24 — Phases 0–2 already shipped; Phases 3–8 below
rewritten to land on the post-`bundler-migration-v1` infrastructure
(Vite + ESM + TypeScript + Storybook + ESLint + axe baseline).
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

## 3.5. Infrastructure deltas since 2026-04-23

The original phase plan was authored against React-via-CDN + Babel-
standalone + JSX-only + window-globals + dom-to-image-only export +
no Storybook + no a11y baseline. Between 2026-04-23 (Phases 0–2) and
2026-04-24 (this re-evaluation), `bundler-migration-v1` Phases 1–8
shipped + a tech-debt cleanup pass closed B-0026. Concrete deltas:

1. **ESM + TypeScript.** Every `.jsx` is now `.tsx`. The five large
   files (`analysis.tsx` 7403 lines, `usaf.tsx` 3662, `fpn.tsx` 3114,
   `dof.tsx` 3464, `app.tsx`, `shared.tsx` 4307) are wrapped in
   `// @ts-nocheck` as a debt marker. **New files in
   `web/src/analysis/` are born type-clean** — no `@ts-nocheck`
   directive, typed props, typed registries.
2. **Phase 1 primitives are live in `shared.tsx`** —
   `<Chart>` (4103), `<Page>` (4254), `useChartGeom` (3803),
   `tokens()` (3696), `useTokens()` (3754), `renderChartToPng`
   (3915), `renderNodeToPng` (4011), `pageBgFor` (489),
   `chartBodyBgFor` (502), `paletteColor` (521), `channelColor`
   (519). Also `cardChromeFor` (469), `usePlotStyleState` (867),
   `PlotStyleCtx` (324), `HeatmapCanvas` (678).
3. **Storybook 8.6 + addon-a11y wired** (`.storybook/`,
   `Brand.stories.tsx`, `Buttons.stories.tsx`,
   `ChannelChip.stories.tsx`). Every chart rewritten in Phase 4
   ships with a companion `<Component>.stories.tsx` so the
   per-chart visual + a11y check is a CI-cheap byproduct.
4. **ESLint 9 + Prettier 3 + tsc clean.** `npm run lint`,
   `npm run typecheck`, `npm run build` are required gates per
   commit (currently at 0 errors / 0 warnings).
5. **axe-core a11y baseline = 0 critical / 0 serious** WCAG A/AA
   violations on the boot page (`tests/web/test_accessibility.py`
   `BASELINE_*` constants set to 0). The new analysis subtree must
   not regress that.
6. **`mantisExport` is duplicated.** `analysis.tsx:6207` (modal-
   level dom-to-image) mirrors `renderNodeToPng` in `shared.tsx:
   4011`. Phase 5 collapses to one source.
7. **Plotly is npm-bundled** (`plotly.js-dist-min` ^3.5.0; ~3.5 MB
   of the 5.35 MB bundle). HANDOFF residual #1: dynamic
   `import('plotly.js-dist-min')` is a Phase 4+ win — formalized
   below as **Phase 4.5**.
8. **`LegacyPngModal` confirmed dead** (analysis.tsx:7268). The
   `run.mode ∉ {usaf,fpn,dof}` dispatch branch is unreachable.
9. **B-0014 closed** + 109/109 pytest green + tier 0–3 smoke +
   axe baseline = the working tree is fully shippable today, so
   every Phase 3+ commit must keep it that way.
10. **B-0015 (per-mode Playwright suite) is gated on this
    initiative.** That's Phase 7's job.
11. **R-0011 (Playwright font diffs) is unblocked** by the bundler
    migration but no visual baseline exists. Phase 7 captures it.
12. **Phase 5c (drop `@ts-nocheck` per file) is paired with this
    work.** As the giant `analysis.tsx` shrinks (Phase 3 + 4
    extract ~3000 lines into typed subtree files), the residual
    body becomes small enough to type incrementally. Phase 6
    drops `@ts-nocheck` from `analysis.tsx` once it's <1000 lines.

## 4. Phase plan

Each phase ends with a smoke gate, a browser-verification screenshot,
and a commit. Phases are sized so the codebase stays shippable at
every commit boundary.

### Phase 0 — Audit & baseline (output: inventory.md) — **DONE 2026-04-23**

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

### Phase 1 — Foundation primitives (shared.tsx) — **DONE 2026-04-23**

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

### Phase 2 — PlotStyle model cleanup — **DONE 2026-04-23**

Shipped:
- Dropped `DEFAULT_PLOT_STYLE.chartScale` + `useChartSize` hook +
  "Chart ×" slider row.
- Kept `showLegend` / `tickWeight` / `annotationSize` / `aspect` for
  Phase 6 wire-through (deliberately retained — see Status.md).

Deferred to Phase 6 (so UI language lands alongside unified shell):
- Rename "Card bg" → "Page bg" slider label.
- Per-section "which tokens move what" hint popover on
  `PlotStylePanel`.

### Phase 3 — Unified AnalysisModal shell **(active)**

Build a new **type-clean subtree** at `web/src/analysis/`:

```
web/src/analysis/
  shell.tsx           — <AnalysisShell mode run onClose onToast />
  registry.ts         — typed mode registry + ModeSpec / TabDef
  types.ts            — RunRecord, AnalysisChannel, FilterState…
  filterbar.tsx       — shared filter-bar primitives (channel chips,
                        gain segmented, threshold slider, BgColorPicker)
  modes/
    usaf.tsx          — ModeSpec<UsafResponse>: { tabs, filterBar, defaultTab }
    fpn.tsx           — ModeSpec<FpnResponse>
    dof.tsx           — ModeSpec<DofResponse>
  shell.stories.tsx   — Storybook story for the shell (no real data)
```

Hard constraints:

- **No `@ts-nocheck`** anywhere in `web/src/analysis/`. Every file
  ships with explicit prop types, registry types, and tab-spec
  generics. This is the type-clean island the rest of the tree will
  eventually grow into.
- **Typed registry contract** — `ModeSpec<TResponse>` exports
  `{ id, defaultTab, tabs: TabDef<TResponse>[], filterBar:
  FC<FilterBarProps<TResponse>>, exportRow: FC<ExportRowProps>,
  themeFallbackBg: 'panelAlt' | 'panel' }`.
- **Esc-to-close** — install `keydown` listener on `document` in
  `shell.tsx` with proper `useEffect` cleanup. The "(Esc)" hint
  in the close button stops being a lie. Inventory §F.
- **DoF `BgColorPicker` parity** — wire into the shared filter-bar
  shell so every mode gets the picker and the localStorage-backed
  `bgColor` state. Inventory §F.
- **`tabBodyRef`-based export hook moves into the shell** — no more
  three copies. Filename goes through the deterministic schema
  `mantis-<mode>-<tab>-<ts>.<png|svg>` from §5 below.
- **Cutover via query-param feature flag** — `?newshell=1` toggles
  the new shell alongside the existing modals in the first commit.
  This is cleaner than the original "two implementations live"
  plan: only one source of truth (`shell.tsx`), gated by a runtime
  read. After Phase 4 lands, the old `USAFAnalysisModal` /
  `FPNAnalysisModal` / `DoFAnalysisModal` functions are deleted in
  one commit and the flag is removed.
- **`web/src/analysis/shell.stories.tsx`** ships with a synthetic
  `RunRecord` fixture so the shell renders in Storybook without a
  live FastAPI backend. Storybook a11y addon must report 0
  violations on the shell story.

What stays in `analysis.tsx` after Phase 3:
- All chart components (Phase 4 sweep moves them).
- Local `mantisExport` (Phase 5 deletes it).
- `LegacyPngModal` (Phase 8 deletes it).
- `PlotlyChart` wrapper (Phase 4.5 may delete it).

### Phase 4 — Rewrite every chart on the new primitives

Revised sweep order — group by **closest current chrome** to
`<Chart>` first, then by structural complexity:

**Wave A — already on `ChartCard`, port to `<Chart>` (8 charts; 1:1
swap of chrome wrapper, body unchanged)**:
1. `MetricOverlayChart` (DoF, simplest).
2. `LineOverlayChart` (DoF).
3. `ChromaticShiftChart` (DoF).
4. `GaussianFitChart` (DoF).
5. `PointsBarChart` + `TiltPlaneSVG` (DoF, share parent ChartCard).
6. `DoFHeatmapCard` (DoF, canvas + SVG composite).
7. `FPNHeatmapCard` (FPN, canvas + SVG composite).
8. `HotPixCard` (FPN, canvas + SVG + footer).

**Wave B — raw `cardChromeFor` without ChartCard, gain `<Chart>`
chrome + per-card PNG button (6 charts)**:
9. `MetricBars` (FPN) — simple SVG bar chart.
10. `FPNHistChart` (FPN).
11. `PSD1DChart` (FPN).
12. `MiniMTFChart` (USAF main).
13. `GroupMiniChart` (USAF).
14. `FFTSpectraGrid` per-channel cards (USAF).

**Wave C — currently bypass `cardChromeFor` entirely (3 cards;
cardBackground/border/padding sliders are dead-wired today — these
gain liveness)**:
15. `ProfileCard` (USAF).
16. `RowColCard` (FPN).
17. `HeatmapPanel` (USAF DetectionHeatmapTab).

**Per-chart deliverables**:
- `<Chart title sub footer channel exportName aspect>` chrome,
  `tokens(style)` for inline-style props, `useChartGeom` for
  `{xOf, yOf, plotW, plotH}`. SVG bodies stop computing geometry
  inline.
- Companion `<Component>.stories.tsx` under
  `web/src/analysis/charts/<chart>.stories.tsx` (or co-located if
  the chart moves). Each story renders the chart against synthetic
  data + the `ThemeFrame` + `PlotStyleCtx` providers (template:
  `Buttons.stories.tsx`). Storybook a11y addon must pass.
- Empty-state component visible when filtered data is empty (per
  inventory §F: 6 charts currently render blank). Phase 6 polishes
  copy; Phase 4 wires the hook.

**File-level moves**:
- New `web/src/analysis/charts/` subtree: each chart family gets
  its own typed module (`mtf.tsx`, `histogram.tsx`,
  `heatmap_card.tsx`, …). Each is born `@ts-nocheck`-free.
- `analysis.tsx` shrinks from 7403 → ~1000 lines (charts + legacy
  shells extracted).
- ESLint `no-restricted-imports` rule blocks new files from
  reaching back into `analysis.tsx` for chart helpers (one-way
  flow).

### Phase 4.5 — Plotly dynamic import (bundle split)

HANDOFF residual #1: Plotly is ~3.5 MB of the 5.35 MB bundle and is
only consumed by `FFTMTFOverlay` (analysis.tsx:1052) inside the USAF
modal. With the unified shell, the lazy-load point is unambiguous.

- Replace the static `import 'plotly.js-dist-min'` (or
  `plotly.js-dist-min`-resolving wrapper) with
  `const Plotly = await import('plotly.js-dist-min')` inside the
  FFT-MTF chart's `useEffect`.
- Vite chunk hint via magic comment:
  `import(/* webpackChunkName: 'plotly' */ 'plotly.js-dist-min')`
  (Vite honors the same comment grammar).
- Render a `<Chart>` skeleton + spinner while Plotly streams in.
- Decision point: if `PlotlyChart` wrapper is no longer needed
  outside the FFT-MTF tab, delete it in this phase (else Phase 8).
- Verify: initial bundle drops from 5.35 MB → ~1.85 MB
  (uncompressed); gzipped from 1.62 MB → ~0.6 MB. `npm run build`
  output is the gate.

### Phase 5 — Export pipeline

- **Eliminate the `mantisExport` duplicate.** `analysis.tsx:6207`
  is dead code once every chart goes through `<Chart>`'s built-in
  PNG button (which calls `renderChartToPng` already). Modal-level
  "Export Tab" buttons (USAF 302, FPN 1266, DoF 2456) call
  `renderChartToPng(tabBodyRef.current, …)` instead of the local
  `mantisExport`. Phase 8 deletes the function definition.
- Remove the SVG-width-freeze pass and transform-scale hack from
  `analysis.tsx` — `renderChartToPng`'s direct-serialize path
  (`shared.tsx:3942–3957`) doesn't need them, and `renderNodeToPng`
  (HTML fallback) already includes the width-freeze idempotently.
- Per-card PNG button on the new `<Chart>` primitive automatically
  picks SVG-direct vs canvas-composite vs HTML-fallback based on
  the children — already implemented in Phase 1.
- Deterministic filenames: `mantis-<mode>-<tab>-<ch|line>-<ts>.png`
  flow through the registry's `exportName` helpers (per-mode).
- New per-mode test: assert the per-card button + tab-level button
  emit a non-empty `image/png` Blob (Phase 7 covers).

### Phase 6 — Empty states, polish, type-tightening

- **Empty states** for the 6 charts that currently render blank
  (per inventory §B): `MiniMTFChart`, `GroupMiniChart`,
  `FPNHistChart`, `RowColCard`, `PSD1DChart`, `MetricBars`.
  Messages phrased "do X to see Y", not "no data". Each lands as a
  Storybook `EmptyState` story variant.
- **Typography sweep**: every chart title, card subtitle, table
  header, filter-bar label resolved through `tokens(style)`. No
  hardcoded `fontSize: 11` in chart body context.
- **Wire the deferred plotStyle fields**:
  - `showLegend` — gate every chart legend.
  - `tickWeight` — fold into `tokens(style).tick`.
  - `annotationSize` — fold into `tokens(style).annotation`.
- **Rename "Card bg" → "Page bg"** (deferred from Phase 2).
- **Per-section "which tokens move what" hint popovers** in
  `PlotStylePanel` (deferred from Phase 2).
- **Drop `@ts-nocheck` from `analysis.tsx`** once it's <1000 lines
  (residual after Phases 3–5 extraction). This closes Phase 5c
  for the analysis page surface specifically — all of
  `web/src/analysis/**/*.tsx` is type-clean.
- Shadow depth + `cardBorderRadius` subtle polish so cards look
  intentional at any background.
- Palette selector stable: `palette = 'channel'` keeps physical-
  correct colors; alternatives map cyclically with stable ordering.

### Phase 7 — Tests & CI

New **Playwright** tests under `tests/web/`:

- `test_analysis_usaf.py` — boot, load a sample, pick lines, open
  the analysis modal, click every tab, assert no PNG `<img>` (every
  chart is SVG-or-canvas-based now), assert per-card export button
  exists on every chart card. Closes B-0015 for USAF.
- `test_analysis_fpn.py` — same for FPN. Closes B-0015 for FPN.
- `test_analysis_dof.py` — same for DoF, plus flipping Unit / Tilt /
  Metric and asserting state updates propagate. Closes B-0015 for
  DoF.
- `test_plotstyle_controls.py` — one test per plotStyle token; set
  via localStorage, reload, assert the rendered DOM reflects the
  change. Catches dead-wired tokens like the original
  `aspect`/`showLegend`/`tickWeight`.
- `test_analysis_export.py` — click per-card PNG, intercept the
  download via `page.expect_download()`, assert blob >1 KB and
  `content-type: image/png`. Run twice per chart: once with
  `style.exportBackground='auto'`, once with `'transparent'`.
- `test_analysis_esc_close.py` — assert `Escape` key dismisses the
  modal in every mode.

New **Storybook visual regression** baselines:

- Per-chart story renders captured under `tests/web/snapshots/
  storybook/` via Playwright — closes R-0011 (Playwright font
  diffs unblocked since bundler migration). Threshold: 1% pixel
  delta to absorb font hinting differences.
- Story + axe a11y addon scan: 0 critical/serious violations on
  every chart story (parity with the boot page baseline).

**Required gates per commit (every Phase 3–8 phase boundary)**:

| Gate | Command | Threshold |
|---|---|---|
| Tier 1 smoke | `python scripts/smoke_test.py --tier 1` | pass |
| Tier 2 smoke | `python scripts/smoke_test.py --tier 2` | pass |
| Tier 3 smoke | `python scripts/smoke_test.py --tier 3` | pass |
| pytest | `python -m pytest -q` | 109/109+ green |
| Lint | `npm run lint` | 0 errors / 0 warnings |
| Typecheck | `npm run typecheck` | 0 errors |
| Build | `npm run build` | succeeds |
| a11y baseline | `pytest tests/web/test_accessibility.py` | 0 critical / 0 serious |
| Storybook build | `npm run build-storybook` | succeeds |

### Phase 8 — Docs + migration cleanup

- Delete `LegacyPngModal` from `analysis.tsx` (confirmed dead per
  inventory §F + `run.mode` always ∈ {usaf,fpn,dof}).
- Delete the duplicate `mantisExport` from `analysis.tsx` (Phase 5
  retired all callers).
- Delete `PlotlyChart` wrapper if Phase 4.5 made FFTMTFOverlay use
  Plotly directly; otherwise document why it stays.
- Delete the `?newshell=1` feature flag and the residual
  `USAFAnalysisModal` / `FPNAnalysisModal` / `DoFAnalysisModal`
  function bodies once Phase 4 has parity.
- Drop `@ts-nocheck` from `analysis.tsx` in Phase 6; this phase
  confirms zero `@ts-nocheck` directives across the analysis
  surface (`analysis.tsx`, `web/src/analysis/**`).
- Update `.agent/ARCHITECTURE.md` — describe new shell + primitives
  + `web/src/analysis/` tree.
- Update `.agent/HANDOFF.md` — point at this initiative as closed.
- Update `.agent/REPO_MAP.md` — new analysis subtree.
- New ADR in `.agent/DECISIONS.md` — single-shell refactor +
  type-clean island rationale.
- Update `.agent/RISKS.md` — close R-0011 (visual regression
  baseline now exists), reassess any analysis-page risks.
- Update `.agent/BACKLOG.md` — close B-0015 (per-mode Playwright
  suites), close any analysis-related deferred items.
- Update `.agent/CHANGELOG_AGENT.md` — initiative-close entry.
- Save a memory note: "`web/src/analysis/` is the type-clean
  island — no `@ts-nocheck`, no implicit `any`. Same standard
  applies to any new file created under that subtree."
- Close `.agent/runs/analysis-page-overhaul-v1/Status.md` with a
  final retrospective + gate-results table.

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

## 6. Quality gates at every phase

See Phase 7 table. **All nine gates** (Tier 1+2+3 smoke, pytest,
lint, typecheck, build, a11y baseline, Storybook build) must pass at
every commit boundary. The `?newshell=1` flag means Phases 3–4 ship
the new code dark, so existing tests stay green throughout.

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Rewriting 15 charts across 3 waves is a big surface. Regressions are likely mid-session. | `?newshell=1` flag keeps the old modals live as the safety net through Phase 4. Per-chart Storybook stories give a CI-cheap visual baseline. Every commit is independently green. |
| `renderChartToPng` canvas+SVG composite path was Phase 1 work but only smoke-tested. | Wave A starts with the canvas-composite charts (DoFHeatmap, FPNHeatmap, HotPixCard) to prove the pipeline early. Wave B + C are SVG-only and lower-risk. |
| New `<Page>` + `pageBackground` model needs the whole shell inside its provider. Missed subtree = missed background. | `shell.tsx` roots the provider; grep `analysis.tsx` for any raw `t.panelAlt` usage after Phase 4 sweep. |
| PlotStyle control wiring misses a chart. | `test_plotstyle_controls.py` mutates every token and asserts at least one DOM change — catches dead-wired charts at CI time. |
| Type-strictness for new subtree explodes when consuming `RunRecord` from a `@ts-nocheck` source. | Phase 3 defines `RunRecord`-shaped types in `web/src/analysis/types.ts` and casts at the dispatcher boundary (`as RunRecord` once, with a runtime guard). Internal subtree code is fully typed. |
| Plotly dynamic-import (Phase 4.5) breaks SSR / preview build. | Vite handles dynamic imports fine; verify `npm run build` chunk output explicitly lists a `plotly-*.js` chunk before merging. |
| Visual regression baseline drifts on font-rendering differences across CI hosts. | 1% pixel-delta threshold on per-chart Storybook captures absorbs hinting noise; treat anything bigger as a real regression. |
| `@ts-nocheck` removal from `analysis.tsx` (Phase 6) surfaces 90+ strict-mode errors. | Phase 6 is the right spot — by then `analysis.tsx` is <1000 lines, and the typed primitives in `shared.tsx`/`web/src/analysis/` mean most call-sites already have inferred shapes. If it spirals, scope back to "drop `@ts-nocheck` from `web/src/analysis/**` only" and leave `analysis.tsx` for a Phase 5c follow-up. |
| Initiative is multi-session; user comes back without context. | `Status.md` tracks current phase + last-completed milestone + dirty-files snapshot. Every phase ends with a context-handoff entry per `.agent/skills/context-handoff/SKILL.md`. |

## 8. Acceptance checklist

**Functional**
- [ ] All three analysis modals render through `<AnalysisShell>`.
- [ ] Every chart renders through `<Chart>` + `useChartGeom` +
      `tokens()`.
- [ ] Every plotStyle token has at least one visible effect + a
      Playwright test asserting that effect.
- [ ] Flipping `Page bg` changes the modal body, card chrome, chart
      body, AND exports — no config desync.
- [ ] Every chart card has a per-card PNG button.
- [ ] Every per-card PNG export is pixel-aligned (circles + polyline
      use the same xOf/yOf; export matches on-screen rendering 1:1
      at configured `style.exportScale`).
- [ ] Every tab has an empty state when filters leave nothing to
      render.
- [ ] DoF modal has `BgColorPicker` parity with USAF/FPN.
- [ ] Esc key closes every modal.
- [ ] Initial bundle <2 MB uncompressed (Plotly chunked out).

**Code health**
- [ ] `web/src/analysis/**` is `@ts-nocheck`-free.
- [ ] `analysis.tsx` is `@ts-nocheck`-free (Phase 6).
- [ ] `LegacyPngModal` deleted.
- [ ] Duplicate `mantisExport` deleted.
- [ ] `?newshell=1` feature flag removed.
- [ ] Vestigial `USAFAnalysisModal` / `FPNAnalysisModal` /
      `DoFAnalysisModal` deleted.

**Verification**
- [ ] Tier 1 + 2 + 3 smoke green at every commit.
- [ ] pytest 109/109+ green at every commit.
- [ ] `npm run lint` 0 errors / 0 warnings at every commit.
- [ ] `npm run typecheck` 0 errors at every commit.
- [ ] `npm run build` succeeds at every commit.
- [ ] axe-core baseline = 0 critical / 0 serious at every commit.
- [ ] `npm run build-storybook` succeeds at every commit.
- [ ] Per-mode Playwright suites all green (B-0015 closed).
- [ ] Visual regression baselines captured + green (R-0011
      closed).

**Docs + handoff**
- [ ] `.agent/ARCHITECTURE.md` updated (new shell + primitives).
- [ ] `.agent/HANDOFF.md` updated (initiative closed).
- [ ] `.agent/REPO_MAP.md` updated (new analysis subtree).
- [ ] `.agent/DECISIONS.md` has new ADR.
- [ ] `.agent/RISKS.md` updated (close R-0011).
- [ ] `.agent/BACKLOG.md` updated (close B-0015 + analysis items).
- [ ] `.agent/CHANGELOG_AGENT.md` initiative-close entry.
- [ ] Memory note: type-clean island under `web/src/analysis/`.
- [ ] Commits pushed with explicit consent; `HANDOFF.md` points at
      this initiative folder as closed.

## 9. Effort estimate (re-evaluated)

Honest sizing for a fresh agent picking up at Phase 3:

| Phase | Surface | Sessions |
|---|---|---|
| Phase 3 | Shell extraction + typed registry + flag | 1 |
| Phase 4 (Wave A) | 8 ChartCard ports | 1 |
| Phase 4 (Wave B) | 6 raw-cardChromeFor ports | 1 |
| Phase 4 (Wave C) | 3 ignore-cardChromeFor ports | 0.5 |
| Phase 4.5 | Plotly dynamic import | 0.5 |
| Phase 5 | Export pipeline collapse | 0.5 |
| Phase 6 | Empty states + typography + `@ts-nocheck` drop | 1 |
| Phase 7 | Playwright suites + visual baselines | 1.5 |
| Phase 8 | Docs + cleanup | 0.5 |
| **Total** | | **7–8 sessions** |

Each session is sized so the working tree stays shippable at every
commit. Sessions can be combined when the agent has enough context
budget; they cannot be split safely (a partial chart sweep leaves
inconsistent chrome).
