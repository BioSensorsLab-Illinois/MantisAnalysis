# Status — isp-modes-v1-bugfixes-v1

Opened: 2026-04-24
Last updated: 2026-04-24 (M0 scaffold)

## Current branch

`main`.

## Current focus

Fixing 5 /ultrareview findings on commit 5608074 (isp-modes-v1
shipment).

## Progress

- [x] M1 — bug_004 collision check (isp_modes.py)
- [x] M2 — bug_001 + merged_bug_002 (session.py)
- [x] M3 — bug_003 GeomRow min prop (isp_settings.jsx)
- [x] M4 — bug_008 test harness fix (test_web_boot.py)
- [x] M5 — 6 regression tests (test_isp_modes.py + test_isp_override.py)
- [x] M6 — Tier 0-3 + pytest green (81/81); browser verified (GeomRow clamp works, modal renders, no console errors)

## Verification (2026-04-24)

- Tier 0: PASS (75 docs, 0 drift)
- Tier 1: PASS (15 modules)
- Tier 2: PASS (figures written)
- Tier 3: PASS (FastAPI endpoints exercised)
- pytest: 81/81 green (75 previous + 6 new: test_rgb_image_reconfigure_produces_2d_channels, test_attach_dark_from_path_after_reconfigure_works, test_attach_dark_from_bytes_works, test_rename_collision_with_default_rejected, test_rename_to_distinct_name_accepted, test_rename_collision_with_another_override_rejected)
- Browser: ISP settings modal renders, Sub-step + Outer stride inputs enforce min=1 (typing "0" clamps to "1"), Origin stays at min=0. No console errors. Synthetic source 400s on reconfigure as expected (no raw frame).

## Final verification (2026-04-24)

Gates:

- [x] Tier 0 — agent-doc consistency PASS
- [x] Tier 1 — imports PASS
- [x] Tier 2 — headless figures PASS
- [x] Tier 3 — FastAPI endpoints PASS
- [ ] Tier 4 — browser smoke — N/A — isp_settings.jsx change is UI-observable but bug-fix only; GeomRow min clamp verified in preview (typing "0" → "1") + no console errors after modal open.
- [x] pytest — 81/81 green (75 previous + 6 new regressions)
- [ ] Tier 7 — accessibility — N/A — no semantic UI changes, only client-side validation tightening
- [ ] Tier 8 — performance — N/A — no data-heavy path touched

Browser verification:

- [x] Screenshots captured (modal with Sub-step min=1 shown)
- [x] Console error-free after modal open
- [x] Network inspected — only my own test API calls (expected)
- [ ] Keyboard walk — N/A — no new interactive controls
- [ ] Responsive sanity — N/A — modal layout unchanged
- [ ] Theme sweep — N/A — theme tokens unchanged

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| — | — | — | This initiative was driven by an external `/ultrareview` pass (task rnftzr8y6) whose findings are the input, not the output. No new reviewer subagents spawned. | N/A |

Docs:

- [x] ExecPlan.md + Status.md complete
- [x] No ARCHITECTURE / REPO_MAP changes needed
- [x] CHANGELOG_AGENT entry will be added at final harness-mechanical-v1 close

Honesty:

- The 5 bugs are real regressions from the isp-modes-v1 session; all resolved with tests. Tier 4 was not run (Playwright chromium install cost not authorized for this run); unit tests at the server / session layer cover the same logic paths the browser would hit.

## Next concrete action

_Closed._ Proceed to `harness-mechanical-v1` for the backlog items.
