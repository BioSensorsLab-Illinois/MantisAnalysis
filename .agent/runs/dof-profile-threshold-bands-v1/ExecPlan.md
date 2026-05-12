# ExecPlan — dof-profile-threshold-bands-v1

Opened: 2026-05-05
Branch: `codex/polarization-dolp-aop-calibration`
Owner: agent (per user ask)

## 1. Goal

Add a supplemental profile-based DoF threshold band that is computed from the raw line-intensity waveform and can be shown alongside the existing focus-metric band before and after Run Analysis.

## 2. Why (user value)

The user's 30 degree endoscope images do not always produce the ideal blur-sharp-blur metric shape; a raw stripe-amplitude envelope gives a second, visually explainable DoF estimate when black/white bars remain visibly separable outside the focus-metric band.

## 3. Scope (in)

- `mantisanalysis/dof_analysis.py` — pure NumPy/SciPy profile-envelope calculation and per-line result fields.
- `mantisanalysis/server.py` — DoF request/response schema for `profile_threshold` and serialized profile-band fields.
- `web/src/dof.tsx` — left-side profile threshold controls, band toggles, and preview chart overlays.
- `web/src/analysis.tsx` and `web/src/analysis/modes/dof.tsx` — Run Analysis result overlays/toggles/exports.
- `tests/unit/test_dof_metrics.py` — profile-band regression coverage.
- Agent/user docs touched by the response-shape and workflow change.

## 4. Out of scope (deliberately deferred)

- Replacing the existing focus metric — the profile band is supplemental, not a scientific replacement.
- Automatic target-angle calibration — this feature reports band width in existing pixel/calibrated units only.
- New browser automation baselines — Playwright is not installed in the current environment.

## 5. Architecture impact

The analysis math stays in `mantisanalysis/dof_analysis.py`; FastAPI remains the adapter that serializes the result; React only renders server-emitted data and user-selected visibility toggles.

## 6. UI/UX impact

DoF gains a left-side `Profile threshold` card below `Focus metric`, with a threshold slider and toggles for the metric/profile bands. The right-side line preview and the Run Analysis raw-profile tab can overlay both bands.

## 7. Backend / API impact

`/api/dof/compute` and `/api/dof/analyze` accept `profile_threshold` and return optional per-line profile-envelope arrays plus profile-based low/high/width fields.

## 8. Data model impact

No channel-key or H5 schema changes. Adds a localStorage preference for the profile threshold and band visibility.

## 9. Test strategy

- Unit: `tests/unit/test_dof_metrics.py`.
- Smoke: Tier 0, 1, 2, 3.
- Full: `.venv/bin/python -m pytest -q`.
- Frontend build: `npm run build`.
- Browser smoke: `pytest -m web_smoke -q` if available; otherwise document the skip.
- Live API sanity against the local server after restart.

## 10. Verification agents to invoke (at close)

- [ ] `docs-handoff-curator`
- [ ] `risk-skeptic`
- [ ] `fastapi-backend-reviewer`
- [ ] `react-ui-ux-reviewer`

## 11. Milestones

- [x] **M1 — Backend profile band** — compute and serialize profile-envelope DoF; verified by unit tests.
- [x] **M2 — UI controls and overlays** — expose threshold and toggles in preview/results; verified by build and live API payload.
- [x] **M3 — Docs and verification** — sync docs/handoff and run required gates.

## 12. Acceptance criteria

- [x] Tier 0, 1, 2, and 3 smoke green.
- [x] Focused DoF unit tests green.
- [x] Full pytest green.
- [x] `npm run build` green.
- [x] Browser verification attempted; unavailable tooling documented if skipped.
- [x] Docs synced per `docs-sync`.
- [x] `Status.md`, `HANDOFF.md`, and `CHANGELOG_AGENT.md` updated.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Profile-envelope threshold may be mistaken for the canonical optical DoF limit. | Medium | Label it as supplemental and keep the existing metric band visible by default. |
| W-2 | Slow illumination gradients can dominate raw intensity. | Medium | Remove a smoothed background and threshold local high-low stripe amplitude, not absolute DN. |
| W-3 | Two translucent bands can visually clutter the chart. | Low | Use distinct colors and independent visibility toggles. |

## 14. Rollback plan

Revert the files listed in Scope (in) for this initiative while preserving the previous raw intensity profile feature.

## 15. Decisions

- (2026-05-05) **Supplemental server-side band**: compute the profile threshold in the backend so live preview and Run Analysis use the same numerical result.

## 16. Surprises & discoveries

- Pending.

## 17. Outcomes & retrospective

- Implemented the supplemental profile-threshold DoF band entirely server-side and reused it in live preview and Run Analysis.
- The green metric band remains the canonical existing estimate; the blue profile band gives a visually explainable local stripe-amplitude estimate.
- Browser automation was unavailable in this thread, so visual confirmation is left to the user after refresh.

## 18. Final verification checklist

See `Status.md` for live pass/fail entries before close.
