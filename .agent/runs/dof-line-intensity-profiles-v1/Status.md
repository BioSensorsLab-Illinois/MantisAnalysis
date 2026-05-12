# Status — dof-line-intensity-profiles-v1

Opened: 2026-05-05
Last updated: 2026-05-05

## Current branch

`codex/polarization-dolp-aop-calibration`

## Active initiative

`.agent/runs/dof-line-intensity-profiles-v1/`

## Current milestone

M3 — Verification/docs

## Current focus

Completed implementation; local server is running the rebuilt bundle on port 8765.

## Progress

- [x] M1 — Backend profile data
- [x] M2 — UI rendering
- [x] M3 — Verification/docs

## Current hypothesis

Raw line profiles should be sampled independently at about 1 px spacing, while focus metrics keep their existing sliding-window sampling.

## Modified files

`git status -sb` snapshot before edits:

```
## codex/polarization-dolp-aop-calibration
 M .agent/ARCHITECTURE.md
 M .agent/CHANGELOG_AGENT.md
 M .agent/DECISIONS.md
 M .agent/HANDOFF.md
 M .agent/REPO_MAP.md
 M .agent/manifest.yaml
 M README.md
 M mantisanalysis/isp_modes.py
 M mantisanalysis/plotting.py
 M mantisanalysis/server.py
 M mantisanalysis/session.py
 M mantisanalysis/usaf_figures.py
 M web/src/dof.tsx
 M web/src/fpn.tsx
 M web/src/isp_settings.tsx
 M web/src/playback.tsx
 M web/src/shared.tsx
 M web/src/usaf.tsx
?? .agent/runs/polarization-dolp-aop-calibration-v1/
?? .agents/
?? START_MANTIS_WEBVIEW.md
?? mantisanalysis/polarization.py
?? tests/unit/test_polarization_calibration.py
?? web/src/polarization_calibration.tsx
```

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~3 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 310 passed / 4 skipped | 16.67 s |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metrics.py -q` | PASS, 8 passed | 0.94 s |
| 2026-05-05 | `npm run build` | PASS | 11.59 s |
| 2026-05-05 | `git diff --check` | PASS | <1 s |
| 2026-05-05 | `npm run build` | PASS | 11.58 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | <1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIP, 4 skipped (Playwright missing) | 1.38 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 312 passed / 4 skipped | 17.65 s |
| 2026-05-05 | live API sanity via `.venv/bin/python -c ...` | PASS, DoF compute/analyze returned 541 profile samples | <1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | FAIL, missing Final verification block in this Status.md | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after adding Final verification block | ~2 s |

## Smoke status (last verified 2026-05-05)

- Tier 0: PASS after edits
- Tier 1: PASS after edits
- Tier 2: PASS after edits
- Tier 3: PASS after edits
- Tier 4 (Playwright): skipped in pytest because Playwright is not installed
- pytest: PASS after edits, 312 passed / 4 skipped

## Browser verification

- [ ] Screenshots captured (`screenshots/` subfolder)
- [ ] Console error-free
- [x] Network error-free for live API sanity
- [ ] Keyboard walk clean
- [ ] Responsive at 1024 / 1280 / 1920
- [ ] Light + dark themes verified

Screenshots:

- Not captured: Browser Use/Preview tools are not exposed in this thread, and Playwright is not installed.

## Reviewer findings

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|

## Open issues (P0 / P1 / P2 / P3)

- P0: none
- P1: none
- P2: none
- P3: none

## Blockers

- Browser automation plugin tools are not currently exposed in this thread; Playwright is not installed.

## Known checks still required

- Manual visual inspection in the in-app browser by the user after refresh.

## Next concrete action

1. User refreshes `http://127.0.0.1:8765/`, reloads their H5 source, and checks DoF right preview + Raw profiles tab.
2. Commit/stage only after user confirms the UI looks right.

## Stop / resume notes

- Current branch: `codex/polarization-dolp-aop-calibration`
- Active milestone: complete, pending user visual confirmation
- Modified files: see above
- Next concrete action: user visual confirmation, then optional commit/PR flow
- Decisions this session: existing DoF responses carry profile arrays
- Reviewer findings still open: none

## Decisions this session

- (2026-05-05) **decision**: use existing DoF compute/analyze responses for raw profile arrays so live and modal views stay consistent.

## Final verification

### Final verification (2026-05-05)

Gates:

- [x] Tier 0 — agent-doc consistency
- [x] Tier 1 — imports
- [x] Tier 2 — headless figures
- [x] Tier 3 — FastAPI endpoints
- [ ] Tier 4 — browser smoke — N/A — Playwright is not installed; pytest marked 4 web smoke tests skipped
- [ ] Tier 5 — feature Playwright tests — N/A — no Playwright runtime available in this workstation session
- [ ] Tier 6 — visual regression — N/A — no visual baseline exists for DoF raw profiles
- [ ] Tier 7 — accessibility checklist — N/A — no new keyboard control was added; only passive charts
- [ ] Tier 8 — performance profile — N/A — profile arrays are capped and live API sanity returned 541 samples
- [x] pytest -q full suite green
- [x] npm run build green
- [x] git diff --check green

Browser verification:

- [ ] App booted; mount verified — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Screenshots captured — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Console error-free after interaction — N/A — Browser Use/Preview tools are not exposed in this thread
- [x] Network error-free after interaction for live API sanity
- [ ] Keyboard walk complete; Esc closes modals; focus return works — N/A — no new keyboard control was added
- [ ] Empty / loading / error / success states verified — N/A — passive chart render only; API no-data fallbacks exist
- [ ] Exports verified if applicable — N/A — chart export pipeline unchanged

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| R-1 | self-check | N/A | Sub-agent review not invoked | User did not explicitly request parallel/sub-agent work; automated gates passed |

Docs:

- [x] ARCHITECTURE.md
- [x] REPO_MAP.md
- [ ] SETUP_AND_RUN.md — N/A — commands/install unchanged
- [ ] WORKFLOWS.md — N/A — workflow unchanged
- [ ] QUALITY_GATES.md — N/A — tiers unchanged
- [ ] TOOLS_AND_SKILLS.md — N/A — tools unchanged
- [x] README.md
- [x] manifest.yaml
- [x] DECISIONS.md
- [ ] RISKS.md — N/A — no new persistent risk surfaced beyond bounded payload cap documented here
- [ ] BACKLOG.md — N/A — no deferred product work added

State:

- [x] Status.md — Progress updated
- [x] HANDOFF.md — Last updated, current state, next action
- [x] CHANGELOG_AGENT.md — new entry
- [x] git status -sb captured and consistent with docs

Honesty:

- [x] Final response to user will state what was verified, what was not, and why.
