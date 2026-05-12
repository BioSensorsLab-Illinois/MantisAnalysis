# Status — polarization-dolp-aop-calibration-v1

Opened: 2026-04-30
Last updated: 2026-04-30

## Current branch

`codex/polarization-dolp-aop-calibration`

## Active initiative

`.agent/runs/polarization-dolp-aop-calibration-v1/`

## Current milestone

M4 — Verification and docs

## Current focus

Verification pass for polarization virtual channels, `.polcal.h5` upload/load routes, and the left-side Polcal controls below the existing dark-frame controls.

## Progress

- [x] M1 — Runtime math
- [x] M2 — Session/API
- [x] M3 — ISP UI
- [x] M4 — Verification and docs

## Current hypothesis

The right app-level implementation is to derive `S0`, `DoLP`, and `AoP` from the existing polarization analyzer channels. When calibration is enabled, the source should use the attached dark-subtracted raw frame plus `.polcal.h5` `Gc_map`/`Gc_avg` data to compute calibrated Stokes before deriving DoLP/AoP.

## Modified files

Initial snapshot:

```
## codex/polarization-dolp-aop-calibration
?? .agents/
?? START_MANTIS_WEBVIEW.md
```

Backup created:

```
/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_before_pol_dolp_aop_20260430_111841
```

Implementation files:

- `.agent/ARCHITECTURE.md`
- `.agent/DECISIONS.md`
- `.agent/REPO_MAP.md`
- `.agent/manifest.yaml`
- `.agent/runs/polarization-dolp-aop-calibration-v1/ExecPlan.md`
- `.agent/runs/polarization-dolp-aop-calibration-v1/Status.md`
- `README.md`
- `mantisanalysis/isp_modes.py`
- `mantisanalysis/plotting.py`
- `mantisanalysis/polarization.py`
- `mantisanalysis/server.py`
- `mantisanalysis/session.py`
- `mantisanalysis/usaf_figures.py`
- `tests/unit/test_polarization_calibration.py`
- `web/src/fpn.tsx`
- `web/src/isp_settings.tsx`
- `web/src/playback.tsx`
- `web/src/polarization_calibration.tsx`
- `web/src/shared.tsx`
- `web/src/usaf.tsx`

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~3 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | ~1 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~1 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~1 s |
| 2026-04-30 | `.venv/bin/python -m pytest -q` | PASS, 306 passed / 4 skipped | 16.49 s |
| 2026-04-30 | `.venv/bin/python -m pytest tests/unit/test_polarization_calibration.py -q` | PASS, 4 passed | 1.00 s |
| 2026-04-30 | `.venv/bin/python -m pytest tests/unit/test_polarization_calibration.py tests/unit/test_isp_modes.py tests/unit/test_isp_override.py -q` | PASS, 35 passed | 1.04 s |
| 2026-04-30 | `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build` | PASS | 11.42 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0` | FAIL, Prettier drift in `web/src/isp_settings.tsx` | ~1 s |
| 2026-04-30 | `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx prettier --write web/src/isp_settings.tsx web/src/shared.tsx` | PASS | <1 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~4 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0 && ... --tier 3` | PASS, tiers 0–3 | ~10 s |
| 2026-04-30 | `.venv/bin/python -m pytest -q` | PASS, 310 passed / 4 skipped | 17.59 s |
| 2026-04-30 | `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run build` | PASS | 12.15 s |
| 2026-04-30 | live `http://127.0.0.1:8765` curl smoke for polarization cal routes | PASS, `LG-DoLP` range with calibration enabled | <1 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after final status block | ~4 s |
| 2026-04-30 | `.venv/bin/python -m pytest tests/unit/test_polarization_calibration.py -q` | PASS after ready-shape guard, 4 passed | 1.01 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after ready-shape guard | ~4 s |
| 2026-04-30 | `npx prettier --write web/src/polarization_calibration.tsx web/src/isp_settings.tsx web/src/usaf.tsx web/src/fpn.tsx web/src/playback.tsx` | PASS after moving Polcal controls | <1 s |
| 2026-04-30 | `npm run build` | PASS after moving Polcal controls | 11.37 s |
| 2026-04-30 | `python scripts/smoke_test.py --tier 0` | PASS after moving Polcal controls | ~4 s |
| 2026-04-30 | `python scripts/smoke_test.py --tier 1 && python scripts/smoke_test.py --tier 2` | PASS after moving Polcal controls | ~6 s |
| 2026-04-30 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after moving Polcal controls | ~2 s |
| 2026-04-30 | `.venv/bin/python -m pytest tests/unit/test_polarization_calibration.py -q` | PASS after moving Polcal controls, 4 passed | 0.99 s |
| 2026-04-30 | `python scripts/smoke_test.py --tier 0` | PASS after final Polcal/FPN cleanup | ~4 s |
| 2026-04-30 | `npm run build` | PASS after final Polcal/FPN cleanup | 11.34 s |
| 2026-05-01 | `.venv/bin/python -m pytest tests/unit/test_polarization_calibration.py -q` | PASS after DoLP/AoP thumbnail fix, 4 passed | 10.64 s |
| 2026-05-01 | `python scripts/smoke_test.py --tier 0` | PASS after DoLP/AoP thumbnail fix | ~5 s |
| 2026-05-01 | `python scripts/smoke_test.py --tier 1` | PASS after DoLP/AoP thumbnail fix | ~11 s |
| 2026-05-01 | `python scripts/smoke_test.py --tier 2` | PASS after DoLP/AoP thumbnail fix | ~13 s |
| 2026-05-01 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after DoLP/AoP thumbnail fix | ~11 s |
| 2026-05-01 | live `http://127.0.0.1:8765` curl for DoLP/AoP PNGs | PASS, DoLP PNG max 80 and AoP PNG max 173 on loaded polarization source | <1 s |
| 2026-05-01 | `npx prettier --write web/src/shared.tsx web/src/usaf.tsx web/src/fpn.tsx web/src/dof.tsx` | PASS after display refresh-key fix | <1 s |
| 2026-05-01 | `npm run build` | PASS after display refresh-key fix | 12.01 s |
| 2026-05-01 | `python scripts/smoke_test.py --tier 0` | PASS after display refresh-key fix | ~4 s |

## Smoke status

- Tier 0: PASS
- Tier 1: PASS
- Tier 2: PASS
- Tier 3: PASS
- Tier 4 / Playwright: not installed; existing web tests skip
- pytest: PASS, 310 passed / 4 skipped; focused polarization pytest 4 passed after DoLP/AoP thumbnail fix
- Vite build: PASS

## Browser verification

- [ ] Screenshots captured
- [ ] Console error-free
- [x] Network/API smoke error-free via live curl route test, including nonzero DoLP/AoP PNG output
- [ ] Keyboard walk clean
- [ ] Responsive sanity checked

Browser screenshots/manual UI walkthrough were deferred because Playwright is
not installed and no Browser Use tool was available in this thread. Live server
API and built-bundle checks passed.

## Reviewer findings

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|
| F-1 | | | | |

## Open issues

- P0: none
- P1: none
- P2: none
- P3: none

## Blockers

- none

## Next concrete action

Manual browser walkthrough of DoLP/AoP display, then commit/push this branch.

## Stop / resume notes

- Current branch: `codex/polarization-dolp-aop-calibration`
- Active milestone: closed through M4
- Local server: running on `http://127.0.0.1:8765/` from
  `.venv/bin/python -m mantisanalysis --no-browser --port 8765`
- Next concrete action: refresh the in-app browser, reload the source/dark/polcal
  if the server restart cleared them, and manually inspect DoLP/AoP display plus
  the left-side Polcal panel below the dark-frame controls.
- Reviewer findings still open: none; subagent reviewers were not spawned
  because this desktop thread did not have explicit user permission for
  delegated agents.

## Final verification

- [x] Polarization modes expose virtual `S0`, `DoLP`, and `AoP` channels.
- [x] `.polcal.h5` profiles load through upload and path routes.
- [x] Calibration enable is rejected until dark frame + calibration file are attached.
- [x] Virtual channels compute through the same `_channel_image` path used by display and analysis routes.
- [x] Tier 0–3 smoke green.
- [x] Full pytest green.
- [x] Frontend build succeeds.
- [x] Docs/status synced.
- [ ] Browser screenshots/manual UI walkthrough — N/A — Playwright is not installed and no Browser Use tool was available.
