# Status — usaf-channel-manual-points-v1

Opened: 2026-04-29
Last updated: 2026-04-29

## Current branch

`codex/usaf-channel-manual-points`

## Active initiative

`.agent/runs/usaf-channel-manual-points-v1/`

## Current milestone

M4 — Verification and handoff

## Current focus

Closed bugfix: per-channel manual USAF extrema now persist through preview, saved config, and multi-channel analysis.

## Progress

- [x] M1 — Backend contract
- [x] M2 — Frontend state flow
- [x] M3 — Regression coverage
- [x] M4 — Verification and handoff

## Current hypothesis

The bug is caused by USAF manual extrema being stored only on the picked line and not sent to `/api/usaf/analyze`; the analysis modal therefore shows server auto-detected extrema.

Confirmed and fixed. Manual extrema are now stored as `line.manualPointsByChannel[channel]`, preview re-measures the active display channel with that channel's saved points, and `/api/usaf/analyze` applies `manual_points_by_channel[ch]` only to the matching analysis channel.

## Modified files

Initial snapshot:

```
## main...origin/main
?? .agents/
?? START_MANTIS_WEBVIEW.md
```

Backup created:

```
/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_usaf_manual_points_20260429_000626
```

Implementation files:

- `.agent/ARCHITECTURE.md`
- `.agent/runs/usaf-channel-manual-points-v1/ExecPlan.md`
- `.agent/runs/usaf-channel-manual-points-v1/Status.md`
- `mantisanalysis/server.py`
- `web/src/usaf.tsx`
- `tests/unit/test_usaf_manual_points_api.py`

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~3.5 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 3` | FAIL, missing `httpx` in `.venv` | ~0 s |
| 2026-04-29 | `.venv/bin/python -m pip install -e '.[dev]'` | PASS | ~2 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python -m pytest -q` | PASS, 305 passed / 4 skipped | 18.15 s |
| 2026-04-29 | `.venv/bin/python -m pytest tests/unit/test_usaf_manual_points_api.py -q` | PASS, 1 passed | 1.03 s |
| 2026-04-29 | `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build` | PASS | 11.79 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS, prettier + eslint + tsc clean | ~1 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~1 s |
| 2026-04-29 | `.venv/bin/python -m pytest -q` | PASS, 306 passed / 4 skipped | 17.07 s |
| 2026-04-29 | `curl http://127.0.0.1:8765/api/health` | PASS, `{"ok": true}` | <1 s |
| 2026-04-29 | live `/api/usaf/analyze` curl with different HG-G/LG-G manual points | PASS, response echoed matching per-channel indices | <1 s |

## Smoke status (last verified 2026-04-29)

- Tier 0: PASS
- Tier 1: PASS
- Tier 2: PASS
- Tier 3: PASS
- Tier 4 (Playwright): not installed; pytest web-smoke tests skipped
- pytest: PASS, 306 passed / 4 skipped
- Vite build: PASS

## Browser verification

- [ ] Screenshots captured
- [ ] Console error-free
- [x] Network/API smoke error-free via `curl`
- [ ] Keyboard walk clean
- [ ] Responsive at 1024 / 1280 / 1920
- [ ] Light + dark themes verified

Screenshots:

- none; the Browser Use tool was unavailable in this session and Playwright is not installed in `.venv`.

## Reviewer findings

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | | | | |

## Open issues (P0 / P1 / P2 / P3)

- P0: none
- P1: none
- P2: none
- P3: none

## Blockers

- none

## Known checks still required

- Optional browser screenshot/manual walkthrough after installing `.[web-smoke]` or using the in-app browser manually.

## Next concrete action

1. Refresh `http://127.0.0.1:8765/` in the in-app browser and manually exercise LG-R/LG-G calibration if desired.
2. Commit this branch if the manual browser check looks good.

## Stop / resume notes

- Current branch: `codex/usaf-channel-manual-points`
- Active milestone: closed through M4
- Modified files: see Implementation files above
- Local server: running on `http://127.0.0.1:8765/` from `.venv/bin/python -m mantisanalysis --no-browser --port 8765`
- Next concrete action: user refreshes browser and tries per-channel calibration; then commit if accepted
- Decisions this session: channel-keyed manual extrema map
- Reviewer findings still open: none; subagent reviewers not spawned because this desktop thread did not have explicit user permission for delegated agents

## Decisions this session

- 2026-04-29 **decision**: Do not reuse one channel's manual extrema across channels; each channel key owns its own 3-bar/2-gap sample indices.
- 2026-04-29 **decision**: Keep legacy unscoped manual fields as display-preview-only fallback, but do not fan them out into multi-channel analysis payloads.

## Final verification

- [x] Manual extrema are saved per display/analysis channel.
- [x] Profile Preview uses the active display channel's saved manual extrema before `Run analysis`.
- [x] Multi-channel analysis sends and consumes matching `manual_points_by_channel` entries only.
- [x] Existing payloads without manual points remain valid.
- [x] Tier 0–3 smoke green.
- [x] Full pytest green.
- [x] Frontend build succeeds.
- [x] Docs/status synced.
- [ ] Browser screenshots/manual UI walkthrough — N/A — Playwright is not installed and Browser Use tooling was unavailable.
