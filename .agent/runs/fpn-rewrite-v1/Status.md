# fpn-rewrite-v1 — Status

Opened: 2026-04-22
Last updated: 2026-04-22 (session in progress)

## Milestones

- [x] Scope opened — `ExecPlan.md` written.
- [x] Baseline smoke tier 1 + 2 green before starting.
- [x] `fpn_analysis.py` enriched (multi-ROI, autocorr, 1-D PSDs, drift
      plane, hot-pixel map, EMVA extras).
- [x] `fpn_render.py` + `figures.py` wired (7 PNG builders).
- [x] `server.py` endpoints expanded (5 endpoints including new
      `/api/fpn/measure`, `/api/fpn/measure_batch`, `/api/fpn/stability`;
      `/api/fpn/analyze` now returns a channel × ROI JSON grid).
- [x] `smoke_test.py` tier 2 covers extras + tier 3 hits every new endpoint.
- [x] `web/src/fpn.jsx` rewritten to USAF parity (+ extras).
- [x] `web/src/analysis.jsx` — `FPNAnalysisModal` with 8 tabs wired.
- [x] Tier 1+2+3 smoke green after.
- [x] Browser visual verification via Claude Preview MCP.
- [x] `.agent/*` docs updated.

## Bugs caught + fixed during visual verification

1. **Stale localStorage `analysisChannels`** from a previous session
   listed a channel the new source doesn't expose, so `/api/fpn/analyze`
   400'd with "no valid channels". Fix: `runAnalysis` now filters the
   persisted list to channels actually present on the current source and
   falls back to the display channel if nothing remains.
2. **ROI label race** — rapid two-draw sequence labeled both as "ROI-1"
   because `setRois(...rois.length + 1)` captured the pre-commit length
   both times. Fix: functional updater `setRois(prev => ...)` so the
   label reflects commit-time length.
3. **`FPNResult.mean` becomes ~0 under drift removal** — which blew up
   PRNU = σ/μ to ~1e15. Fix: store both `mean` (residual mean, post-drift)
   and `mean_signal` (pre-drift, on kept pixels) in the dataclass;
   PRNU normalizes against `mean_signal`.

## Follow-ups

- DoF rewrite — same treatment, separate initiative.
- Playwright smoke (B-0015) — now worth it with two rich modes to cover.
- Consider auto-loading previous session's ROI set on boot (currently
  JSON save/load is manual).
- The existing dead `open_fpn_window` Qt factory in `fpn_render.py` is
  still there (B-0016). Not a regression from this session.
