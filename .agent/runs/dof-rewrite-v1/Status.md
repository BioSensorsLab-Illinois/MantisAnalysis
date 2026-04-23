# dof-rewrite-v1 — Status

Opened: 2026-04-22 (immediately after `fpn-rewrite-v1` landed)
Last updated: 2026-04-22 (session in progress)

## Milestones

- [x] Scope opened — `ExecPlan.md` written.
- [x] Baseline smoke tier 1 + 2 green before starting.
- [x] `dof_analysis.py` enriched (Gaussian fit, bootstrap CI, multi-
      metric sweep, `analyze_dof_multi`, `compute_dof_stability`,
      `fit_focus_plane`, `measure_focus_all`).
- [x] `dof_render.py` + `figures.py` wired — three new builders
      (`build_gaussian_fit_fig`, `build_chromatic_shift_fig`,
      `build_tilt_plane_fig`) plus the existing 4 now produce 7 DoF
      PNGs in `build_dof_pngs`, plus a standalone multi-channel
      chromatic shift PNG via `build_dof_multi_chromatic_png`.
- [x] `server.py` endpoints expanded — `/api/dof/compute` now returns
      the rich JSON shape (gaussian / bootstrap / metric_sweep /
      tilt_plane); `/api/dof/analyze` rewritten to
      multi-channel × multi-line with per-channel figure PNGs;
      `/api/dof/stability` added.
- [x] `smoke_test.py` tier 2 covers every new builder + multi + stability
      + plane; tier 3 exercises all three new endpoints end-to-end.
- [x] `web/src/dof.jsx` rewritten (414 → 1655 lines) with rulers, zoom-
      to-cursor pan, keyboard shortcuts, display knobs, ISP card, JSON
      save/load, sortable points + lines tables, focus-profile preview
      with Gaussian overlay, stability card, tilt-plane summary.
- [x] `web/src/analysis.jsx` gets `DoFAnalysisModal` with 7 tabs —
      Summary, Line scans, Gaussian fits, Metric compare, Chromatic
      shift, Focus heatmaps, Points / tilt. All native-vector except
      the PNG tabs (gaussian / heatmap / tilt).
- [x] Tier 1+2+3 smoke green after all changes.
- [x] Browser visual verification via Claude Preview MCP (dropped 3
      points + 1 line on synthetic sample, confirmed live stats,
      Gaussian fit overlay, R², and every analysis-modal tab).
- [x] `.agent/*` docs updated (this file + CHANGELOG_AGENT + ARCHITECTURE
      + HANDOFF + BACKLOG + DECISIONS).

## Baseline (before this session)

`web/src/dof.jsx` = 414 lines. `dof_analysis.py` = 352 lines.
`dof_render.py` = 586 lines. Current analysis modal = `LegacyPngModal`
(3 static PNGs).
