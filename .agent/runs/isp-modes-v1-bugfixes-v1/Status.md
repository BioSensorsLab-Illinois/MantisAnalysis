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

## Next concrete action

Commit, then open harness-mechanical-v1 for B-0022..B-0028.
