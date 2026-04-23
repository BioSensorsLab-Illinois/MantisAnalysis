# analysis-page-overhaul-v1 — Status

Opened: 2026-04-23
Last updated: 2026-04-23 (Phase 0 + Phase 1 landed; Phase 2 next)

## Milestones

- [x] Phase 0 — Audit & inventory → `inventory.md`
- [x] Phase 1 — Foundation primitives
      (`<Chart>`, `useChartGeom`, `tokens()`, `<Page>`,
      `renderChartToPng` + `renderNodeToPng`, new plotStyle fields
      `pageBackground` + `chartBodyBackground`)
- [ ] Phase 2 — plotStyle model cleanup (drop `chartScale` + `useChartSize`; rename Card bg → Page bg in the style panel after Phase 3)
- [ ] Phase 3 — Unified `<AnalysisModal>` shell + per-mode tab registry
- [ ] Phase 4 — Rewrite every chart through `<Chart>`
- [ ] Phase 5 — Export pipeline replacement (migrate callers from `mantisExport` → `renderChartToPng`)
- [ ] Phase 6 — Empty states + typography polish
- [ ] Phase 7 — Playwright analysis-modal test suite
- [ ] Phase 8 — Docs + migration cleanup

## Active phase

Phase 2 — pruning confirmed-dead plotStyle fields. Phase 3 is the first
"high-risk" surgery (merging 3 modal shells into one).

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

## Next session entry

1. Phase 2 — delete `chartScale` field + `useChartSize` hook + the "Chart ×" slider row from `PlotStylePanel`. Grep confirmed zero callers outside shared.jsx. Bump pyproject version? **No** — still pre-release.
2. Phase 3 — extract `<AnalysisModal>` shell from USAF/FPN/DoF duplicates. Create `web/src/analysis/` subtree: `modal.jsx` (shell), `usaf.jsx`, `fpn.jsx`, `dof.jsx` per-mode specs. Add DoF's missing `BgColorPicker`. Install Esc-to-close listener in the shell.
3. See inventory.md §H for the phase → code-map crosswalk.
