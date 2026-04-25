# analysis-page-overhaul-v1 — Status

Opened: 2026-04-23
Last updated: 2026-04-24 — ExecPlan re-evaluated against post-
`bundler-migration-v1` infrastructure. Phases 3–8 rewritten to land
on Vite + ESM + TypeScript + Storybook + axe baseline. New Phase 4.5
inserted (Plotly dynamic import). Phase 3 remains the next active
phase but its scope expanded: type-clean subtree, typed registry,
feature-flag cutover, Storybook story for the shell.

## Milestones

- [x] Phase 0 — Audit & inventory → `inventory.md`
- [x] Phase 1 — Foundation primitives
      (`<Chart>`, `useChartGeom`, `tokens()`, `<Page>`,
      `renderChartToPng` + `renderNodeToPng`, new plotStyle fields
      `pageBackground` + `chartBodyBackground`) — live in
      `shared.tsx`
- [x] Phase 2 — plotStyle model cleanup (dropped `chartScale`,
      `useChartSize` hook, "Chart ×" slider). Card bg → Page bg
      rename deferred to Phase 6.
- [x] Phase 3 — `<AnalysisShell>` + typed mode registry under
      type-clean `web/src/analysis/` subtree, `?newshell=1` flag,
      DoF `BgColorPicker` parity, Esc-to-close, Storybook shell
      story. **Shipped 2026-04-24 (`e552c83`).**
- [x] Phase 4 Wave A — 8 ChartCard-using charts ported to
      `<Chart>`; `ChartCard` deleted. **Shipped (`5c97353`).**
- [x] Phase 4 Wave B — 6 raw-`cardChromeFor` charts ported. Per-
      card PNG buttons gained. **Shipped (`7d90ce4`).**
- [x] Phase 4 Wave C — 3 ignore-`cardChromeFor` cards ported.
      `cardChromeFor` import dropped from analysis.tsx.
      **Shipped (`52cfe9c`).**
- [x] Phase 4.5 — Plotly dynamic-import. Initial bundle 5.38 MB
      → 549 kB. **Shipped (`ba2a8f7`).**
- [x] Phase 5 — `mantisExport` collapsed onto `renderChartToPng`.
      Single export pipeline. **Shipped (`f4206a0`).**
- [ ] Phase 6 — Empty states + typography sweep + wire deferred
      tokens (`showLegend`, `tickWeight`, `annotationSize`) +
      "Card bg → Page bg" rename + drop `@ts-nocheck` from
      `analysis.tsx`.
- [ ] Phase 7 — Playwright analysis-modal suite (closes B-0015) +
      Storybook visual regression baselines (closes R-0011) +
      lint/tsc/a11y gates.
- [~] Phase 8 partial — `LegacyPngModal` deleted (~135 lines).
      HANDOFF + Status + CHANGELOG_AGENT updated. Final cutover
      (flip `?newshell=1` to default, delete legacy modal bodies
      + bridge `_*TabBody` exports) deferred until Phase 6 + 7
      land.

## Active phase

**Phase 6** — empty states for the 6 charts that currently render
blank, typography sweep through `tokens()`, wire deferred plotStyle
tokens (`showLegend`, `tickWeight`, `annotationSize`) per-chart,
"Card bg → Page bg" rename in PlotStylePanel, drop `@ts-nocheck`
from `analysis.tsx`. ~1 session.

Then **Phase 7** (Playwright + visual baselines) and **Phase 8 final**
(flip flag, delete legacy bodies). ~2 sessions combined.

## What Phase 1 added (shared.jsx)

- `DEFAULT_PLOT_STYLE` gained two fields:
  - `pageBackground: 'theme'` — `'theme' | 'white' | 'black' | 'transparent' | <hex>`
  - `chartBodyBackground: 'inherit'` — `'inherit' | 'panel' | 'white' | 'transparent'`
- Helpers `pageBgFor(style, t, themeFallback)` and `chartBodyBgFor(style, t)` resolve the new tokens.
- Canonical `channelColor(ch)` + `paletteColor(style, ch)` added to shared.jsx so the primitives don't reach back into analysis.jsx for swatches. (`analysis.jsx` still has its own locals — those stay until Phase 4.)
- `tokens(style, t)` + `useTokens()` — memoized inline-style dict (title, axisLabel, tick, legend, annotation, gridLine, axisLine, line, marker) so chart bodies stop repeating `fontSize={scaled(…)}` boilerplate.
- `useChartGeom({ W, H, PAD, xDomain, yDomain, yFlipped })` — geometry hook that honors `style.aspect`. With no args, reads from `<Chart>`'s context; otherwise computes and returns `{W, H, PAD, plotW, plotH, xOf, yOf}`.
- `<Chart title sub footer channel exportName aspect geom>` — the single chart primitive. Card chrome + title row + per-card PNG button + aspect-bounded body + `ChartGeomCtx.Provider`. Optional `geom` prop triggers the geometry context.
- `<Page plotStyleState themeFallback as style>` — `PlotStyleCtx.Provider` wrapper that also paints the wrapped container with the resolved `pageBackground`. Mints its own `usePlotStyleState()` if not supplied, for drop-in use.
- `renderChartToPng(node, { filename, style, themeFallbackBg })` — SVG-first export pipeline. Three paths: single-SVG (direct serialize + rasterize), canvas + SVG overlays (composite), HTML-heavy (dom-to-image fallback via `renderNodeToPng`).
- `renderNodeToPng(...)` — same hardening as existing `mantisExport` (hide `[data-no-export]`, freeze SVG width/height, 15-second watchdog, restore on finally). Keeps dom-to-image as the HTML fallback.

Old exports are kept live for the transition — nothing in analysis.jsx / fpn.jsx / dof.jsx / usaf.jsx is touched.

## Verification

- Tier 1 + Tier 2 smoke: PASS (15 modules, figures written).
- pytest: 40/40 green.
- Browser boot: `window.{Chart, Page, useChartGeom, tokens, useTokens, renderChartToPng, renderNodeToPng, pageBgFor, chartBodyBgFor, channelColor, paletteColor, ChartGeomCtx}` all present after reload.
- Offscreen React render of `<Page><Chart>…</Chart></Page>`: no throws, SVG mounts, PNG button renders, page bg resolves to the passed `themeFallback`.
- No console errors after full page reload (only the expected in-browser Babel transformer notice).

## What Phase 2 dropped

- `DEFAULT_PLOT_STYLE.chartScale` — confirmed zero readers outside the
  hook itself (grep §F of inventory). Any user state in localStorage that
  still carries a `chartScale` key becomes a harmless orphan; `setStyle`
  shallow-merges so existing saved state loads without warning.
- `useChartSize(baseW, baseH)` hook — had zero callers.
- "Chart ×" slider row in `PlotStylePanel` Scale section.
- `useChartSize` removed from `window` exports.

Kept deliberately:
- `showLegend` + `tickWeight` + `annotationSize` (partially-wired fields):
  scheduled to become alive in Phase 6's typography sweep once `tokens()`
  is adopted everywhere.
- `aspect`: Phase 1 wired it into `useChartGeom`. Slider UI comes with
  Phase 2's rename work (deferred — see above).

## Next session entry

**Phase 6 — concrete starting moves**:

1. Empty-state polish for the 6 charts that currently `return null`
   on no-data (per inventory §B): `MiniMTFChart` (line ~1180),
   `GroupMiniChart` (~2142), `PSD1DChart` (~3941), `MetricBars`
   (~4451), `RowColCard` (~3672), and the inner `FFTSpectraGrid`
   per-card path. Replace `return null` with
   `<Chart noExport>(empty-state JSX)</Chart>` so empty cards have
   coherent chrome.
2. Typography sweep: every chart body that still inlines
   `fontSize: 12, fontWeight: 600` etc. should consume
   `useTokens()` (`tok.title`, `tok.tick`, `tok.legend`,
   `tok.annotation`).
3. Wire `showLegend`: every chart that has a legend block should
   gate it with `if (!tok.showLegend) return null` around the
   legend group.
4. Wire `tickWeight`: the `tokens.tick` already includes it; just
   confirm chart bodies consume `tok.tick` instead of inlining
   `fontWeight`.
5. Drop `@ts-nocheck` from `analysis.tsx` once the file is small
   enough (currently ~6900 lines after the deletes; HANDOFF
   warns of ~98 strict-mode errors per file when removed cold —
   the remaining work is per-line type tightening).
6. PlotStylePanel: rename "Card background" → "Page background"
   in the dropdown's tooltip. (Field name `cardBackground` stays
   for backwards-compat with saved JSON.)

**Crosswalk**: see `inventory.md` §H for Phase → code-map. Note
that the inventory was authored with `.jsx` paths; everything is
`.tsx` now, and the file line numbers have shifted since the
mass deletes in Waves A-C and Phase 5.

---

## Original Phase 3 starting moves (kept for reference)


1. Create `web/src/analysis/` subtree (no `@ts-nocheck`):
   - `types.ts` — `RunRecord`, `AnalysisMode`, `FilterState`,
     `TabDef<T>`, `ModeSpec<T>`.
   - `registry.ts` — typed `MODE_REGISTRY: Record<AnalysisMode,
     ModeSpec<unknown>>` with module-augmentation hook.
   - `shell.tsx` — `<AnalysisShell mode run onClose onToast />`
     with Esc-to-close, `<Page>` provider root, shared filter-bar
     scaffold, tab-rail, tab-body, modal chrome.
   - `filterbar.tsx` — extracts shared filter-bar bits
     (`BgColorPicker`, channel chips, gain segmented).
   - `modes/usaf.tsx`, `modes/fpn.tsx`, `modes/dof.tsx` — each
     exports a `ModeSpec` with `{ tabs, filterBar, defaultTab,
     themeFallbackBg, exportName }`. **Tab dispatch bodies still
     point at the existing chart functions in `analysis.tsx`** for
     this phase — Phase 4 moves them.
   - `shell.stories.tsx` — synthetic `RunRecord` fixture, each
     mode rendered against `ThemeFrame` + `PlotStyleCtx`.
2. Wire `?newshell=1` query param read in `app.tsx` `AnalysisModal`
   mount — toggle between old and new shells.
3. Add DoF `BgColorPicker` via the shared filter-bar component.
4. Install `keydown(Escape)` listener in `shell.tsx` with proper
   cleanup. Drop the "(Esc)" lie from button titles.
5. Verify: open `?newshell=1`, click through every mode + tab,
   confirm visual + behavioral parity. Take screenshots.
6. Gates per Phase 7: lint + tsc + build + a11y + smoke + pytest.
7. Commit "analysis-page-overhaul-v1 Phase 3 — `<AnalysisShell>`
   + typed registry + `?newshell=1` cutover".

**Then Phase 4 Wave A** — port the 8 `ChartCard`-based charts onto
`<Chart>`. Each chart lands with a companion `.stories.tsx`. See
ExecPlan §Phase 4 for the revised wave order.

**Crosswalk**: see `inventory.md` §H for Phase → code-map. Note
that the inventory was authored with `.jsx` paths; everything is
`.tsx` now.
