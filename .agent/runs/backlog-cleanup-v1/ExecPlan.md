# backlog-cleanup-v1 — ExecPlan

Opened: 2026-04-23
Owner: agent (per user "take care of all items mentioned above")

<!-- qt-allowed: Historical initiative — referenced pre-D-0009 Qt cleanup entries from the backlog (pick_lines_gui.py etc.). Preserved verbatim as archaeology. -->

## Goal

Drain the open backlog (post-trio) in one coherent sweep, then make the
first commit (B-0010). Every step is smoke-gated.

## Order (by dependency + blast radius)

1. **B-0016 / B-0005** — hoist `_color` / `_ch` / `_style_axes` into a
   new `mantisanalysis/plotting.py`; delete dead Qt wrappers
   (`open_fpn_window`, `open_analysis_window`, `open_dof_window`) and
   the helpers only they referenced (`_palette_from_parent`,
   `_is_dark_theme`, `_mpl_theme_for`, `_make_canvas_page`,
   `_build_*_tab`, `_draw_mtf_curves`, `_draw_fft_spectra`,
   `_source_stem`, `_get_transform_from_app`, `_get_sharpen_from_app`,
   `compute_all_measurements`). Net delete ≈ −1500 LOC across three
   render files.
2. **B-0020** — DoF modal unit selector (px/µm/mm/cm). Single unit
   segmented control at top of DoF analysis modal; `dofFmt(ln, px,
   unit)` helper routes every distance formatter through it.
3. **B-0021** — DoF target-tilt correction. Add "Target tilt (°)" input
   to the DoF picker (persist at `dof/tiltAngleDeg`), pass through to
   analysis payload, apply `1/cos(θ)` to peak / σ / FWHM / DoF-width
   in modal with a live re-apply slider.
4. **B-0019** — replace the ~80 hardcoded `fontSize={N}` /
   `strokeWidth={N}` / `fontFamily="ui-monospace,..."` literals across
   all chart components in `web/src/analysis.jsx` with
   `scaled(N, style)` / `style.lineWidth` / `plotPaletteColor(...)` so
   the PlotStylePanel sliders bite everywhere.
5. **B-0015** — minimal Playwright smoke: boot `index.html` against the
   running dev server, assert no console errors + 3 mode-rail buttons
   render. (Full CI gating deferred.)
6. **B-0018** — real-sample validation: flag as blocked on absent H5
   recordings; document expected workflow in
   `docs/validation/README.md`.
7. **Legacy sweep** — close the backlog items that are obsolete or done:
   B-0001 (done: pick_lines_gui.py deleted), B-0002/B-0003 (obsolete:
   Qt GUI deleted), B-0005 (rolled into B-0016), B-0013 (done: D-0009).
   Quick-fix B-0011 (delete or justify `requirements.txt`).
8. **Docs** — HANDOFF + ARCHITECTURE + REPO_MAP + BACKLOG + DECISIONS
   + CHANGELOG + Status.md all reflect the post-cleanup state.
9. **B-0010** — initial commit + push (only after all above are green).

## Smoke gate after every numbered step

`python scripts/smoke_test.py --tier 1 && --tier 2 && --tier 3`. No
step is "done" until those are green. Browser preview verification via
Claude Preview MCP for any user-visible change (B-0020, B-0021, B-0019).

## Deferred / non-goals

- Full CI gating of Playwright smoke (B-0015 stretch).
- Real-sample H5 captures for B-0018 (user action).
- B-0006 (legacy Workflow A smoke): keep on backlog; low priority.
- B-0007, B-0008, B-0009, B-0012, B-0014: stay on backlog.

<!-- /qt-allowed -->
