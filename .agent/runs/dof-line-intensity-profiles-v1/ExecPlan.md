# ExecPlan — dof-line-intensity-profiles-v1

Opened: 2026-05-05
Branch: `codex/polarization-dolp-aop-calibration`
Owner: agent (per user ask)

## 1. Goal

Add raw line-intensity profiles to DoF live preview and analysis results so users can show black/white waveform contrast fading outside the depth-of-field band.

## 2. Why (user value)

The existing DoF UI shows focus-metric curves but not the underlying grayscale signal along the drawn line. Users need the raw profile as visual evidence that resolvable peaks and valleys disappear as focus degrades.

## 3. Scope (in)

- `mantisanalysis/dof_analysis.py` — sample raw intensity along each focus line.
- `mantisanalysis/server.py` — serialize profile arrays in DoF compute/analyze responses.
- `web/src/dof.tsx` — show raw profile in the right-side live preview before Run Analysis.
- `web/src/analysis.tsx` and `web/src/analysis/modes/dof.tsx` — add a results tab for raw line profiles.
- Tests and docs covering the new response fields and user-facing behavior.

## 4. Out of scope (deliberately deferred)

- New focus metric math — the existing metric pipeline remains unchanged.
- Z-stack DoF workflow — this initiative is only for single-image line profiles.
- New dependencies — SVG charts are sufficient for the profile display.

## 5. Architecture impact

Touches the pure DoF analysis layer, FastAPI JSON adapter, and React visualization layer. No channel schema or H5 parsing changes.

## 6. UI/UX impact

The DoF right-side preview will include an intensity-vs-position profile for the selected line. The analysis modal gains a raw/intensity profiles tab with DoF band and peak markers.

## 7. Backend / API impact

Existing `/api/dof/compute` and `/api/dof/analyze` responses gain optional per-line `profile_positions_px` and `intensity_profile` arrays. No route or request schema changes.

## 8. Data model impact

No persisted session/localStorage/channel-key changes. DoF line result objects gain optional transient profile arrays.

## 9. Test strategy

- Unit: `tests/unit/test_dof_metrics.py` for profile sampling.
- API: Tier 3 smoke and/or focused TestClient coverage if needed.
- Frontend: `npm run build`, browser smoke if Playwright is available.
- Full gate: Tier 0-3 and `.venv/bin/python -m pytest -q`.

## 10. Verification agents to invoke (at close)

Sub-agents are not invoked unless the user explicitly asks for parallel agent work. Self-review plus automated gates will be recorded here.

## 11. Milestones

- [x] M1 — Backend profile data — DoF line results carry raw intensity profiles.
- [x] M2 — UI rendering — live preview and analysis modal display profile charts.
- [x] M3 — Verification/docs — tests, build, smoke, and docs updated.

## 12. Acceptance criteria

- [x] Tier 0-3 smoke green.
- [x] `.venv/bin/python -m pytest -q` green.
- [x] `npm run build` green.
- [x] DoF live preview shows raw intensity profile for the selected line.
- [x] DoF analysis modal shows raw intensity profiles for selected lines/channels.
- [x] Docs synced per `docs-sync`.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Large line profiles could bloat JSON. | Medium | Cap samples and keep one-pixel sampling for typical 2-3k px lines. |
| W-2 | Downsampling could hide 1-2 px bars. | Medium | Server samples at ~1 px until the cap, preserving the user's fine bars. |
| W-3 | Raw DN scale differs by channel. | Low | Per-card y scaling, not cross-channel normalization. |

## 14. Rollback plan

Revert the initiative's edits to the DoF analysis, server serialization, React DoF/analysis files, tests, and docs. The backup snapshot is `/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_before_dof_line_profile_20260505_165259`.

## 15. Decisions

- (2026-05-05) **decision**: add profile arrays to existing DoF responses instead of creating a new route, because both live preview and analysis modal already consume the DoF line result object.

## 16. Surprises & discoveries

- (2026-05-05) The existing live preview already computes focus curves continuously, so the raw profile can ride the same response.

## 17. Outcomes & retrospective

- Raw line profiles now ship in DoF compute/analyze JSON and render in the right preview plus a new Run Analysis tab.
- Focus-metric behavior was left unchanged.
- Browser screenshot verification could not be automated because Browser Use/Preview tools were not exposed and Playwright is not installed.

## 18. Final verification checklist

See `Status.md` for live verification.
