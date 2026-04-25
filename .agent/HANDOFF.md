# HANDOFF — current live state pointer

Last updated: **2026-04-25**, end of
`recording-inspection-implementation-v1` **INITIATIVE CLOSED** —
all 12 milestones delivered (M0 audit + reviewer pass; M1-M3 backend
H5/dark/stream; M4 render pipeline; M5-M7 frontend rail/sources/
viewers; M8 9-section Inspector + CCM + presets + frame-LRU; M9
overlay; M10 image+video export; M11 send-to-mode handoff +
Storybook + skill doc; **M12 final verification + visual-regression
baselines + 8 reviewer agents serially + P0/P1 inline resolution +
docs sync**). 28 commits ahead of origin/main once the pending M12 close commit (this set) lands; `git status -sb` currently reports `[ahead 27]`, push pending (Claude
Opus 4.7, 1M context).

Prior initiative (`analysis-page-overhaul-v1`) closed earlier this
session; details preserved at end of this file.

## Current state of the working tree

- Branch: `main`. 28 commits ahead of origin/main once the pending M12 close commit (this set) lands; `git status -sb` currently reports `[ahead 27]` (push pending).
- Active initiative: **none** — `recording-inspection-implementation-v1`
  closed at M12 today.
- Outstanding deferred work tracked as B-0029..B-0038 in
  [`.agent/BACKLOG.md`](BACKLOG.md):
  - B-0029 `playback-multiproc-v1` (cross-process video encode +
    Manager().Event() — unblocked when scale-out is needed)
  - B-0030 `playback-ux-polish-v1` (HandoffModal, drop zone, remove
    confirm, responsive collapse, context menu, Inspector text size)
  - B-0031 `playback-test-cleanup-v1` (Playwright migration to
    web-first locators + page fixture + console-error attachment)
  - B-0032 Playback feature-flag default flip
  - B-0033 Playback test-coverage gaps (cancel mid-batch, byte-equal
    contactsheet/grid, LRU cross-stream, preset 64-cap, perceptual
    parity, CCM n=3 collinear, eviction kind=source positive)
  - B-0034 Playback perf test (TEST_PLAN §Tier 8 budget)
  - B-0035 Preview PNG Cache-Control
  - B-0036 Inspector React.memo per section
  - B-0037 Hot-path module hoisting
  - B-0038 Visual-regression diff infrastructure
    (`visual-regression-infra-v1`)

## What just shipped

**`recording-inspection-implementation-v1`** — M0 → M12 in one
multi-day session. New mode `Playback (Recording Inspection)`
behind the `mantis/playback/enabled` localStorage flag (default
OFF until B-0032 polish lands). Surface:

- 6 new backend modules (`recording.py`, `dark_frame.py`,
  `playback_session.py`, `playback_pipeline.py`,
  `playback_export.py`, `playback_api.py` — 24+ routes), all
  preserving AGENT_RULES rule 7 (analysis purity) — pure NumPy/
  h5py/PIL/matplotlib/imageio.
- 16 React frontend components under `web/src/playback/` +
  `ProcessingBadge.stories.tsx` Storybook.
- WYSIWYG single-render-entry-point invariant: preview-PNG and
  export-PNG share `playback_pipeline.render_frame`; byte-equal
  for image (incl. with dark applied — fixed in M12); perceptual
  parity for video.
- Send-to-mode handoff route `POST /api/playback/streams/{sid}/
  handoff/{mode}` registers a fresh `LoadedSource` in the
  analysis-mode `STORE` via the new public
  `STORE.register_external` (eviction-tracking honored).
  `dark_already_subtracted: true` enforced at the receiving mode's
  `attach_dark_*` (refuses double-subtract).
- 5 ISP modes supported from M1 (rgb_nir / bare_single /
  bare_dualgain / polarization_single / polarization_dual).
- All stretch features in scope per user 2026-04-24: GIF export
  (300-frame cap), CCM editor + auto-from-patches against X-Rite
  whites, calibrated WB, send-to-mode handoff,
  parallelized-via-thread video encode (per-frame cancel — full
  ProcessPool deferred to B-0029 with honest docs).
- 8 reviewer agents (M0 + M12) — every P0 and most P1 resolved
  inline; P2/P3 + 4 deferred P1 tracked as B-0029..B-0038.
- 5 visual baselines (`screenshots/M12_baseline_*.png`) committed
  for review evidence; on-disk diff is B-0038.
- CI: `tier4-web-smoke` job now installs ffmpeg + uploads
  `screenshots/*.png` as a CI artifact.

**Verification ladder at M12 close:**

- Tier 0 — agent-doc consistency PASS (5 scanners).
- Tier 1 — 21 modules imported.
- Tier 2 — figures rendered (Agg).
- Tier 3 — `pytest -q tests/headless` 84 PASS (45 playback + 39 prior).
- Tier 4 — `pytest -m web_smoke` 21 PASS.
- Full `pytest -q` 262 PASS (was 109 before this initiative; +153 tests).
- `npm run build` clean (606 kB main + 4.8 MB plotly chunk).
- `npm run lint` 0 errors / 0 warnings.
- `npm run typecheck` 0 errors.
- `npm run build-storybook` clean.

## Earlier in this session: `analysis-page-overhaul-v1` close

(Pre-existing prior-initiative content preserved below for
context — `analysis-page-overhaul-v1` was closed earlier this
session; M11 + M12 of `recording-inspection-implementation-v1`
both happened after.)

**analysis-page-overhaul-v1 — all 8 phases delivered, initiative
CLOSED.** Major refactor of the analysis-results modal complete:

- New `web/src/analysis/` type-clean subtree (zero `@ts-nocheck`)
  with `<AnalysisShell>`, typed `ModeSpec` registry, shared
  filter-bar primitives, and Storybook stories.
- All 17 chart types in `analysis.tsx` render through the unified
  `<Chart>` primitive — every card has a per-card PNG button, every
  card reacts to `cardBackground` / `cardBorder` / `cardPadding`
  sliders. DoF gains `BgColorPicker` parity. Esc-to-close listener
  installed.
- Initial bundle dropped 5.38 MB → 549 kB (Plotly dynamic-imported).
- Single export pipeline (`renderChartToPng`) — duplicate
  `mantisExport` deleted.
- ~2350 lines of legacy code retired: `LegacyPngModal`, the three
  `*AnalysisModal` bodies, `BgColorPicker`, `measurementToRow`,
  `mantisExport`, `ChartCard`, `?newshell` flag.
- Phase 7 Playwright smoke (`test_new_shell_boots_under_flag`)
  added; full per-mode interaction suite deferred (needs
  synthetic-line-pick fixture).
- Phase 6 empty-state pattern shipped on three high-visibility DoF
  charts; remaining chart-internal `return null` paths deferred to
  follow-up sessions per Status.md.

**Previous session: Tech-debt cleanup pass — B-0026 CLOSED, lint clean,
more Storybook stories, H5 deferred-feature mentions removed**.

- **B-0026 a11y baseline → 0**: all 5 critical/serious WCAG A/AA
  violations on the boot page resolved.
  - `Slider`, `Spinbox`, `Select` primitives gained `aria-label`
    plumbing (defaults + caller-overridable).
  - `usaf.tsx` `<span role="button">` pop-out gained
    `aria-label`.
  - `usaf.tsx` + `fpn.tsx` "select all" checkboxes gained
    `aria-label`.
  - `Card` header restructured: outer drag-handle is now a
    `<div>`, inner toggle is a tight `<button>`, `actions`
    siblings live outside any button (eliminates
    `nested-interactive`).
  - Light-theme `textFaint` collapsed onto `textMuted` (#5d6773)
    to clear AA on `accentSoft`. Dark-theme `textFaint` bumped
    #6a7280 → #8a93a0.
  - `ChannelChip` gain-prefix dropped `opacity: 0.6` (was
    producing 4.49:1 / 2.47:1).
  - `dof.tsx` + `usaf.tsx` ISP-card !enabled wrapper opacity
    bumped 0.45 → 0.95 to keep cascaded text contrast above AA.
  - Disabled-input opacity bumped 0.5 → 0.7 globally.
  - `tests/web/test_accessibility.py::BASELINE_*` set to 0 →
    strict gate.
- **ESLint warnings 49 → 0**: 44 unused-vars `_-prefixed` via a
  one-shot script; 4 `react-hooks/exhaustive-deps` resolved by
  extracting `optsKey`/`geomKey` stringified deps with explicit
  per-line `eslint-disable` comments documenting the memo-
  stability rationale; 1 unused `reRunning` state local
  `_-prefixed`.
- **Storybook stories expanded**: `Buttons.stories.tsx` (variants:
  primary / subtle / danger / with-icon / disabled / dark-theme)
  - `ChannelChip.stories.tsx` (HG/LG bands, multi-select, compact,
    dark) — both with theme-frame providers + Storybook controls.
    `npm run build-storybook` clean.
- **H5 recording-inspection deferred-feature mentions removed**
  from `HANDOFF.md` + `DECISIONS.md::D-0015` revisit point. The
  feature is no longer suggested as a "next thing" in active
  planning docs.
- **Phase 5c (drop @ts-nocheck file-by-file) — explicitly DOCUMENTED
  AS DEFERRED, not skipped.** Empirical check: dropping the
  directive from app.tsx alone surfaces 98 strict-mode errors;
  the 5 mass-migrated files would require multi-session per-file
  type-tightening that pairs with feature work. The shim in
  `isp_settings.tsx` is the visible cost; lint clean + tsc clean
  is the tradeoff.

**Previous session commits (already pushed)**:

- `f3ed701` — Phases 6 + 7 + 8 + initiative close
- `07736f3` — Phase 5b-finish: mass .jsx → .tsx + allowJs off
- `1fd05f2` — Phase 5b-1 isp_settings.tsx typed + warnings 372→49
- `2bd4ef6` — Phase 5a TypeScript infra + main.tsx seed
- `cd560d7` — Phase 4 ESLint + Prettier
- `febb365` — Phase 3 reviewer follow-up
- `cb3cbaf` — Phase 3 atomic CDN→ESM cutover

**Today's commits in initiative order**:

- `cb3cbaf` — Phase 3 atomic CDN→ESM cutover
- `febb365` — Phase 3 reviewer-findings follow-up
- `cd560d7` — Phase 4 ESLint + Prettier
- `2bd4ef6` — Phase 5a TypeScript infra + main.tsx seed
- `1fd05f2` — Phase 5b-1 isp_settings.tsx typed + warnings 372→49
- `07736f3` — Phase 5b-finish: mass .jsx → .tsx + allowJs off
- (this commit) — Phases 6 + 7 + 8 + initiative close

(For Phases 3–5a detail, see
`.agent/CHANGELOG_AGENT.md` + `.agent/runs/bundler-migration-v1/Status.md`.)

---

# Prior session context (preserved verbatim — not authoritative)

The block below is the analysis-page-overhaul-v1 close-out from
earlier this same session (2026-04-25). It predates the
recording-inspection-implementation-v1 close above and is
preserved for archaeological context. **Where the two contradict,
the top of this file wins.** New agents reading cold should treat
the M12 truth above as the live state.

## Smoke status, last verified 2026-04-24 (pre-Playback)

- ✅ Tier 0 — 5 scanners pass (docs, skills, stopping-criteria,
  reviewer-evidence, frontend-lint — now with prettier + eslint + tsc)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written)
- ✅ Tier 3 — PASS (FastAPI endpoints exercised)
- ✅ pytest — **109/109** green (3/3 web_smoke + a11y test)
- ✅ `npm run build` — 41 modules, 5.35 MB / gzip 1.62 MB
- ✅ `npm run typecheck` — 0 errors
- ✅ `npm run lint` — **0 errors, 0 warnings** (was 372 → 49 → 0)
- ✅ `axe-core a11y` — **0 critical / 0 serious WCAG A/AA**
  violations (was 2 critical + 3 serious; baseline tightened to 0)
- ✅ Browser-verified DoF / FPN / USAF mode switches with zero
  console errors; theme tokens still visually clean post-contrast
  fixes

## Quick verification for the next agent

```bash
cd "$(git rev-parse --show-toplevel)"
python scripts/doctor.py                        # 9-check env sanity
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q

# Frontend (Vite-bundled post bundler-migration-v1 Phase 3):
npm install                                      # first time only
npm run build                                    # emits web/dist/
python -m mantisanalysis --no-browser --port 8773
# Open http://127.0.0.1:8773/ — must serve the SPA, not the
# "Frontend bundle not built" placeholder.
```

## Active initiative (from earlier in this session — pre-Playback)

**None at the time this block was written.** `analysis-page-overhaul-v1`
closed earlier this session. Status pointer:
`.agent/runs/analysis-page-overhaul-v1/Status.md`.

**Update from later in this same session:** the active initiative
became `recording-inspection-implementation-v1`, which is now also
closed (M12 done). See top of file for the authoritative current
state.

Outstanding tech debt:

- **Phase 5c** — DEFERRED, multi-session, paired-with-feature-work.
  Drop `@ts-nocheck` file-by-file (empirically 98 strict-mode
  errors per file when removed cold), type shared.tsx's exports,
  delete the `as any` shim in `isp_settings.tsx`, promote ESLint
  to `typescript-eslint/recommendedTypeChecked`. Not blocking
  anything.

## Where to pick up next (pre-Playback view — superseded)

**Superseded** by the M12 BACKLOG additions B-0029..B-0038 at the
top of this file. The list below is preserved verbatim for context
but is not the authoritative "next" action list.

1. **Per-mode Playwright interaction suite** —
   `test_analysis_{usaf,fpn,dof}.py`,
   `test_plotstyle_controls.py`, `test_analysis_export.py`. Needs
   a synthetic-line-pick fixture (programmatically inject picked
   lines) so the modal mounts in headless. Closes B-0015.
2. **Storybook visual-regression baselines** — Chromatic-style or
   Playwright pixel-diff against committed PNGs. Closes R-0011.
3. **`@ts-nocheck` removal from `analysis.tsx`** — pair with
   feature touches. The subtree at `web/src/analysis/` stays
   type-clean (enforce on new files).
4. **Move chart bodies into `web/src/analysis/charts/`** so the
   `_*TabBody` bridges retire. Per-chart `.stories.tsx`
   companions land alongside.
5. **Empty-state polish** for the remaining chart-internal
   `return null` paths (RowColCard inner `plot`, FFTSpectraGrid
   per-card inner, GroupMiniChart).

## Deferred with explicit rationale

- **B-0014** — Vite bundler migration. **CLOSED 2026-04-24**
  (all 8 phases shipped). Phase 5c + B-0026 are tech debt
  follow-ups, not initiative blockers.
- **B-0015 extended** — per-mode Playwright interaction suites
  (USAF / FPN / DoF analysis modals). Substantial; depends on
  analysis-page-overhaul-v1 Phase 3 landing.
  `tests/web/test_web_boot.py` now covers boot + analysis-modal
  Plotly path.
- **B-0018** — real-sample validation. Blocked on H5 captures from
  the lab bench; user action.
- **R-0011** — Playwright font diffs. No visual-regression baseline
  exists; blocks on Phase 3 + visual-regression adoption (now
  unblocked since Phase 3 shipped — schedule under Phase 6 or B-0015
  extension).
- **R-0014 residual** — hook hard-block vs soft-nudge promotion
  (tracked in RISKS).
- **R-0015** — same-context reviewers (harness change needed).
- **R-0016** — qt-allowed budget (scanner cap is the mitigation).

## Known dirty files

None after this session's commit + push lands.

## Residual risks / open questions for user

1. **Bundle is 5.35 MB uncompressed (gzip 1.62 MB)** — dominated
   by Plotly (~3.5 MB). A dynamic `import()` of `plotly.js-dist-min`
   (only loaded when the analysis modal opens) is the obvious
   Phase 4+ win. Not blocking; gzip is fine for local use.
2. **Hook-alias pattern lingers** — every mode file still does
   `const { useState: useStateU, ... } = React;`. Cosmetic, safe
   under ES modules. Phase 4 cleanup.
3. **Analysis-modal Plotly test is permissive** — passes if no
   console errors fire, even when Plotly returns no chart node.
   This is intentional (synthetic sources can return "no usable
   data") but means a regression that ships an empty modal with
   silent failure won't trip this test. Fixing requires a more
   aggressive setup that picks lines + asserts non-empty data
   before opening the modal — out-of-scope here.
4. **Pre-existing residuals from prior sessions** — same as last
   handoff (R-0009 chain not exercised end-to-end in browser;
   R-0006 closure by inspection; R-0014 hooks soft-nudge;
   PreCompact hook harness support; agentic-workflow-overhaul-v1
   reviewer evidence backfill).
