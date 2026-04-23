# HANDOFF — current live state pointer

Last updated: **2026-04-23**, end of `analysis-page-overhaul-v1` Phase 0+1+2
(inventory + foundation primitives + plotStyle cleanup).

## Current state of the working tree

- Branch: `main`.
- Three new commits on top of the previous `plot-style-completion-v1`
  ship (84a918b):
  - `468490a` — analysis-page-overhaul-v1 Phase 0 (ExecPlan.md +
    inventory.md under `.agent/runs/analysis-page-overhaul-v1/`).
  - `f081404` — analysis-page-overhaul-v1 Phase 1 foundation primitives
    (+593 lines in `web/src/shared.jsx`; old exports kept live).
  - `d9cbf8e` — analysis-page-overhaul-v1 Phase 2 prune (`chartScale` +
    `useChartSize` + "Chart ×" slider deleted).
- Not yet pushed (per B-0010 explicit-consent gate).

## What just shipped (analysis-page-overhaul-v1 Phase 0+1+2)

- **Phase 0 — `.agent/runs/analysis-page-overhaul-v1/inventory.md`.**
  Full audit: 30 plotStyle fields tagged alive/partial/dead; ~40-chart
  catalog with ChartCard adoption; five-source background-hierarchy
  map; three-modal shell duplication mapped; `MTFCurvesTab` shadow bug
  + DoF-missing-BgColorPicker + missing Esc-to-close documented.
- **Phase 1 — foundation primitives (`web/src/shared.jsx`).** New
  exports:
  - `pageBackground` + `chartBodyBackground` plotStyle fields;
    `pageBgFor()` + `chartBodyBgFor()` resolvers.
  - Canonical `channelColor(ch)` + `paletteColor(style, ch)` in shared
    scope.
  - `tokens(style, t)` + `useTokens()` memoized style dict.
  - `useChartGeom({ W, H, PAD, xDomain, yDomain, yFlipped })` geometry
    hook honoring `style.aspect`.
  - `<Chart>` — single chart primitive with card chrome + title row +
    per-card PNG button + aspect-bounded body + `ChartGeomCtx`.
  - `<Page>` — PlotStyleCtx provider that paints the container with
    resolved `pageBackground`.
  - `renderChartToPng(node, opts)` — SVG-first export (direct
    serialize / canvas composite / HTML fallback via
    `renderNodeToPng`). No dom-to-image CORS trap.
  - Old helpers (`cardChromeFor`, `ChartCard`, `mantisExport`) remain
    live — nothing in analysis.jsx / fpn.jsx / dof.jsx / usaf.jsx is
    touched yet.
- **Phase 2 — plotStyle prune.** Deleted `chartScale` field +
  `useChartSize` hook + "Chart ×" slider; zero callers outside
  shared.jsx. `showLegend` + `tickWeight` + `annotationSize` kept for
  Phase 6's typography sweep; `aspect` already wired via
  `useChartGeom` in Phase 1.

## What just shipped before that (backlog-cleanup-v1)

Single session that swept the open backlog after the USAF/FPN/DoF
rewrite trio closed:

- **B-0016 + B-0005 (R-0007)** — new `mantisanalysis/plotting.py` owns
  `_color` / `_ch` / `_style_axes` + `CHANNEL_COLORS`. Deleted dead
  `open_*_window` Qt factories and their entire tab / draw / theme
  helper chain. −~1500 LoC across three render files; R-0007
  cross-module coupling closed.
- **B-0020** — DoF analysis modal gets a `Unit` segmented control
  (Auto / px / µm / mm / cm) + helpers that fall back to px with a
  "calibration missing" hint when a physical unit is picked on an
  uncalibrated line.
- **B-0021** — DoF target-tilt correction. `Target tilt (°)` slider on
  the picker (persisted at `dof/tiltAngleDeg`, disabled until a
  calibration reference is set) propagates through the run payload as
  `tilt_angle_deg`; the modal shows a live °-input + applies
  `1/cos(θ·π/180)` to every peak / σ / FWHM / DoF width, with a
  header suffix making pre/post-correction numbers unambiguous. CSV
  + JSON exports carry the raw-px values and the active tilt.
- **B-0019** — every hardcoded `fontSize={N}` / `strokeWidth={N}` /
  `fontFamily="ui-monospace,..."` literal in `web/src/analysis.jsx`
  replaced with `scaled(N, style)` / `style.*` / cascade-from-modal-
  root fontFamily. Renamed `MiniMTFChart`'s draw-style prop from
  `style` → `drawStyle` to disambiguate.
- **B-0015** — Playwright smoke scaffolded + passing locally at
  `tests/web/test_web_boot.py`. Opt-in extras
  `[web-smoke]` + `web_smoke` pytest marker.
- **B-0018** — documented the required real-sample validation captures
  in `docs/validation/README.md`; still BLOCKED on H5 recordings.
- **B-0011** — deleted stale `requirements.txt` (was listing PySide6);
  `pyproject.toml` is now the only dependency source.
- **Legacy sweep** — B-0001 / B-0002 / B-0003 / B-0004 / B-0008 /
  B-0009 / B-0013 closed in BACKLOG.md as obsolete or already-done.
- **D-0014** added for the dead-Qt delete + `plotting.py` hoist.

## Smoke status, last verified 2026-04-23

- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written to `outputs/smoke/`)
- ✅ Tier 3 — PASS (FastAPI TestClient exercises health / sample /
  thumbnail / USAF measure / FPN compute / DoF compute / analyze)
- ✅ pytest — 40/40 green (including the new Playwright smoke at
  `tests/web/test_web_boot.py`)

## Quick verification for the next agent

```bash
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest               # 40 tests including tests/web
python -m mantisanalysis --no-browser   # real uvicorn boot
curl http://127.0.0.1:8765/api/health
```

## Where to pick up next

1. **analysis-page-overhaul-v1 Phase 3** — extract `<AnalysisModal>`
   shell from USAF/FPN/DoF duplicates. Create `web/src/analysis/`
   subtree: `modal.jsx` (shell), `usaf.jsx`, `fpn.jsx`, `dof.jsx`
   per-mode specs. Add DoF's missing `BgColorPicker`. Install the
   Esc-to-close listener all three modals already advertise. Keep old
   modals live behind a feature flag until Phase 4. See
   `.agent/runs/analysis-page-overhaul-v1/Status.md` + `inventory.md` §E.
2. **Phase 4 onward** (separate sessions): rewrite 15 charts through
   `<Chart>`, migrate every `mantisExport` caller to `renderChartToPng`
   (Phase 5), empty-state + typography polish (Phase 6), Playwright
   analysis-modal suite (Phase 7), docs + dead-code cleanup including
   `LegacyPngModal` + `PlotlyChart` wrapper (Phase 8).
3. **B-0010** — initial `git push -u origin main` is still the explicit
   user-consent gate from prior handoffs. Eleven commits now on `main`
   are unpushed; ask before pushing.
4. **B-0018** — real-sample validation: needs real H5 captures. Staging
   area is `docs/validation/` per its README.
5. **B-0015 extended** — per-mode interaction tests + CI gating of the
   Playwright smoke (installing chromium in CI is ~300 MB).
6. **B-0014** — adopt a bundler for `web/` (Vite/esbuild) if the CDN
   Babel boot becomes a bottleneck. Will become more attractive after
   Phase 3's `web/src/analysis/` subtree.
7. **B-0006, B-0007, B-0012** — untouched legacy items that stayed
   valid after Qt removal (legacy Workflow A CLI smoke, rotate-clears-
   picks warning, onboarding helper script).

## Known dirty files

Working tree is clean as of the three analysis-page-overhaul-v1 commits.
`git status -sb` should show only the branch ahead-count against origin.

## Active initiative

`.agent/runs/analysis-page-overhaul-v1/` — full rewrite of the analysis
modal stack as a first-class feature. Phase 0 + 1 + 2 done; Phase 3 is
the first high-risk surgery (unifying the three modal shells). See
`Status.md` for the milestone grid and `inventory.md` for the full
design document that drives the remaining phases.

Preceded by:
- `.agent/runs/plot-style-completion-v1/` — zero-PNG analysis modals +
  plotStyle wiring.
- `.agent/runs/backlog-cleanup-v1/` — drained post-trio backlog (closed
  B-0016 / B-0020 / B-0021 / B-0019 / B-0015 / B-0011 / legacy sweep /
  D-0014) and shipped the first commit ([53acac8](https://github.com/BioSensorsLab-Illinois/MantisAnalysis/commit/53acac8)).
- `.agent/runs/analysis-polish-v1/` — publication-grade plotStyle
  framework (infrastructure that this session wired up across every
  chart component).
- `.agent/runs/dof-rewrite-v1/` — DoF mode brought to USAF/FPN parity.
- `.agent/runs/fpn-rewrite-v1/` — FPN mode parity + EMVA extras.
- `.agent/runs/gui-rewrite-v1/` — original PyQt→web refactor (D-0009).
