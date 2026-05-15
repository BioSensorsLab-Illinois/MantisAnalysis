# ExecPlan — usaf-channel-manual-points-v1

Opened: 2026-04-29
Branch: `codex/usaf-channel-manual-points`
Owner: agent (per user bug report)

## 1. Goal

Make USAF manual 5-point calibration channel-specific so each analysis channel uses its own saved bar/gap positions.

## 2. Why (user value)

The current USAF picker stores manual extrema on a line without channel identity. The analysis modal then re-runs server auto-detection and ignores the user's manually corrected points, so per-channel resolution results can disagree with the picker preview.

## 3. Scope (in)

- `web/src/usaf.tsx`: store manual points as line × channel state, preserve them in config JSON, and send them to analysis.
- `mantisanalysis/server.py`: accept per-channel manual point overrides in `/api/usaf/analyze`.
- Targeted regression test covering channel-specific overrides.
- Minimal docs/status notes for the changed analysis contract.

## 4. Out of scope (deliberately deferred)

- Redesigning the analysis modal UI — this fix keeps the existing modal but feeds it correct measurements.
- Solving cross-channel physical registration — manual extrema remain per-channel sample indices, as requested.
- Changing channel key names or GSense extraction constants — forbidden project invariants.

## 5. Architecture impact

Touches the FastAPI adapter and React USAF mode only. Analysis math stays in `usaf_groups.py` and remains pure NumPy/SciPy.

## 6. UI/UX impact

Users can display `LG-R`, adjust extrema, switch to `LG-G`, adjust separately, and run multi-channel analysis; each channel uses its own saved points when available.

## 7. Backend / API impact

`LineSpecIn` gains optional `manual_points_by_channel` data for `/api/usaf/analyze`. Existing payloads without this field remain valid and continue to auto-detect.

## 8. Data model impact

USAF picker line objects gain `manualPointsByChannel`, keyed by channel name. Saved config JSON includes this map when present. No H5/session/channel schema changes.

## 9. Test strategy

- Unit/API: add targeted FastAPI TestClient regression for `/api/usaf/analyze`.
- Smoke: Tier 0, 1, 2, 3.
- Pytest: full suite.
- Browser: rebuild frontend and verify the server serves the built app; full Playwright is unavailable unless the optional browser dependency is installed.

## 10. Verification agents to invoke (at close)

- [ ] docs-handoff-curator
- [ ] risk-skeptic

Note: reviewer subagents are not spawned in this desktop thread unless explicitly requested by the user.

## 11. Milestones

- [x] **M1 — Backend contract** — `/api/usaf/analyze` accepts channel-keyed manual points.
- [x] **M2 — Frontend state flow** — USAF picker stores and sends channel-specific manual points.
- [x] **M3 — Regression coverage** — targeted test proves different channels can use different overrides.
- [x] **M4 — Verification and handoff** — smoke, pytest, build, docs/status updated.

## 12. Acceptance criteria

- [x] Manual extrema are saved per analysis channel.
- [x] Multi-channel analysis uses the override for the matching channel only.
- [x] Existing configs/payloads without manual points remain valid.
- [x] Tier 0–3 smoke green.
- [x] Full pytest green.
- [x] Frontend build succeeds.
- [x] Docs/status synced.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Accidentally applying one channel's extrema to another channel | High | Payload keyed by channel name; backend lookup per channel. |
| W-2 | Breaking old saved USAF JSON configs | Medium | Keep legacy fields tolerated and optional. |
| W-3 | Analysis modal still confusing if auto-detected vs manual points are not visually labeled | Low | Preserve server echo of final bar/gap indices; document behavior in status. |

## 14. Rollback plan

Use the timestamped backup at `/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_usaf_manual_points_20260429_000626`, or switch back to `main` / revert this branch's diff.

## 15. Decisions

- 2026-04-29 **decision**: Store manual extrema as profile sample indices keyed by channel name, not by display mode or gain family, because indices are channel-profile-local.

## 16. Surprises & discoveries

- 2026-04-29 The picker preview already supports server-side manual point measurement for one channel; the missing link is persistence and `/api/usaf/analyze` payload propagation.

## 17. Outcomes & retrospective

Closed 2026-04-29. The fix keeps user calibration tied to the channel whose profile was displayed: `manualPointsByChannel` in React state/config, `manual_points_by_channel` in the analysis API payload, and a per-channel lookup on the FastAPI side before calling `measure_line`. Profile Preview also labels whether the active display channel is using saved manual extrema or auto extrema.

Automated verification was green: Tier 0–3 smoke, full pytest, targeted API regression, Vite build, and a live-server curl against `/api/usaf/analyze` proving HG-G and LG-G received distinct manual indices. Browser screenshots were deferred because Playwright is not installed and Browser Use tooling was unavailable in this desktop thread.

## 18. Final verification checklist

Tracked in `Status.md`.
