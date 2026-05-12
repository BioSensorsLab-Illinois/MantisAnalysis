# Status — dof-profile-threshold-bands-v1

Opened: 2026-05-05
Last updated: 2026-05-11

## Current branch

`codex/polarization-dolp-aop-calibration`

## Active initiative

`.agent/runs/dof-profile-threshold-bands-v1/`

## Current milestone

Closed — pending user visual confirmation

## Current focus

Feature implemented, verified, and server restarted on
`http://127.0.0.1:8765/`; follow-ups fixed the Run Analysis Raw
profiles tab, added top-bar `Load analysis` for exported result JSON
snapshots, froze imported DoF snapshots so metric switching cannot
re-run analysis, and separated display-only picker state from Run
Analysis inputs. Latest follow-up turns DoF **All 4 metrics** runs into
four complete cached metric result trees that are exported/imported with
analysis JSON. Latest UI follow-up adds metric-aware titles to the DoF
Run Analysis result tables and charts so exported/inspected plots state
which focus metric and chart type they show. Latest raw-profile follow-up
adds an optional purple profile-peak marker, controlled before Run
Analysis and in the result modal, while leaving the yellow metric peak
marker unchanged.
Latest copy follow-up removes "selected metric" wording from the DoF
`Metric compare` tab because those charts always overlay all four
metrics.
Latest overlay follow-up makes raw-profile metric/profile bands and
metric/profile peaks four independent overlays before and after Run
Analysis, and only includes the selected metric in Raw profile chart
titles when the Metric peak overlay is visible.
Latest export follow-up adds per-chart CSV downloads beside per-chart
PNG buttons. Each chart card now exports only its own plotted data:
USAF MTF/profile/heatmap/group/FFT data, FPN histogram/profile/PSD/2-D
grid/hot-cold/compare data, and DoF line/raw/metric/chromatic/Gaussian/
heatmap/point diagnostic data.

## Progress

- [x] M1 — Backend profile band
- [x] M2 — UI controls and overlays
- [x] M3 — Docs and verification

## Current hypothesis

The most useful supplemental DoF estimate comes from local stripe amplitude after subtracting slow illumination background, then thresholding the normalized amplitude envelope around its peak.

## Modified files

`git status -sb` snapshot at open:

```
 M .agent/ARCHITECTURE.md
 M .agent/CHANGELOG_AGENT.md
 M .agent/DECISIONS.md
 M .agent/HANDOFF.md
 M .agent/REPO_MAP.md
 M .agent/manifest.yaml
 M README.md
 M mantisanalysis/dof_analysis.py
 M mantisanalysis/isp_modes.py
 M mantisanalysis/plotting.py
 M mantisanalysis/server.py
 M mantisanalysis/session.py
 M mantisanalysis/usaf_figures.py
 M tests/unit/test_dof_metrics.py
 M web/src/analysis.tsx
 M web/src/analysis/modes/dof.tsx
 M web/src/dof.tsx
 M web/src/fpn.tsx
 M web/src/isp_settings.tsx
 M web/src/playback.tsx
 M web/src/shared.tsx
 M web/src/usaf.tsx
?? .agent/runs/dof-line-intensity-profiles-v1/
?? .agent/runs/dof-profile-threshold-bands-v1/
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
| 2026-05-05 | prior `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | recorded in HANDOFF |
| 2026-05-05 | prior `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | recorded in HANDOFF |
| 2026-05-05 | prior `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | recorded in HANDOFF |
| 2026-05-05 | prior `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | recorded in HANDOFF |
| 2026-05-05 | prior `.venv/bin/python -m pytest -q` | PASS, 312 passed / 4 skipped | recorded in HANDOFF |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metrics.py -q` | PASS, 9 passed | ~1 s |
| 2026-05-05 | `.venv/bin/python -m py_compile mantisanalysis/dof_analysis.py mantisanalysis/server.py` | PASS | <1 s |
| 2026-05-05 | `npm run build` | PASS | 11.64 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~1.5 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 313 passed / 4 skipped | 17.59 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.36 s |
| 2026-05-05 | `git diff --check` | PASS | <1 s |
| 2026-05-05 | live `/api/dof/compute` with `profile_threshold=0.42` | PASS, returned 171 profile/contrast samples and profile width | <1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | FAIL, missing Final verification block in this Status.md | ~1.5 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after adding Final verification block | ~1.5 s |
| 2026-05-05 | `npm run build` | PASS after raw-tab follow-up | 11.72 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after raw-tab follow-up | ~1.5 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after raw-tab follow-up | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after raw-tab follow-up | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after raw-tab follow-up | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.45 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 313 passed / 4 skipped | 17.55 s |
| 2026-05-05 | `git diff --check` | PASS after raw-tab follow-up | <1 s |
| 2026-05-05 | `npm run build` | PASS after analysis JSON loader | 12.18 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after analysis JSON loader | ~1.5 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after analysis JSON loader | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after analysis JSON loader | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after analysis JSON loader | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.46 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 313 passed / 4 skipped | 18.07 s |
| 2026-05-05 | `git diff --check` | PASS after analysis JSON loader | <1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after final docs sync | ~1.5 s |
| 2026-05-05 | `npm run build` | PASS after frozen DoF snapshot + display-state isolation | 11.69 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after display-state isolation | ~1.5 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after display-state isolation | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after display-state isolation | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after display-state isolation | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 313 passed / 4 skipped | 17.72 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.37 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after final handoff docs sync | ~1.5 s |
| 2026-05-05 | `git diff --check` | PASS after display-state isolation | <1 s |
| 2026-05-05 | `curl -s http://127.0.0.1:8765/api/health` | PASS after server restart | <1 s |
| 2026-05-05 | `npm run build` | PASS after full DoF metric result cache | 12.02 s |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metric_results_api.py -q` | PASS, 2 passed | 1.21 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after full DoF metric result cache | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after full DoF metric result cache | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after full DoF metric result cache | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 18.26 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.41 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after final all-metric docs sync | ~1.6 s |
| 2026-05-05 | `git diff --check` | PASS after full DoF metric result cache | <1 s |
| 2026-05-05 | `curl -s http://127.0.0.1:8765/api/health` | PASS after all-metric server restart | <1 s |
| 2026-05-05 | `npm run build` | PASS after DoF metric-aware result chart titles | 11.64 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after DoF metric-aware result chart titles | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after DoF metric-aware result chart titles | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after DoF metric-aware result chart titles | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metric_results_api.py -q` | PASS, 2 passed | ~1 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.40 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after DoF metric-aware result chart titles + docs sync | ~1.5 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 18.00 s |
| 2026-05-05 | `git diff --check` | PASS after DoF metric-aware result chart titles | <1 s |
| 2026-05-05 | `npm run build` | PASS after optional DoF profile-peak marker | 11.78 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after optional DoF profile-peak marker | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after optional DoF profile-peak marker | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after optional DoF profile-peak marker | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metrics.py tests/unit/test_dof_metric_results_api.py -q` | PASS, 11 passed | 1.81 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.41 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after optional DoF profile-peak marker docs sync | ~1.5 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 18.30 s |
| 2026-05-05 | `git diff --check` | PASS after optional DoF profile-peak marker | <1 s |
| 2026-05-05 | `npm run build` | PASS after Metric compare copy cleanup | 12.01 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after Metric compare copy cleanup | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after Metric compare copy cleanup | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after Metric compare copy cleanup | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.43 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 18.27 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after Metric compare copy cleanup docs sync | ~1.5 s |
| 2026-05-05 | `git diff --check` | PASS after Metric compare copy cleanup | <1 s |
| 2026-05-05 | `npm run build` | PASS after independent raw-profile overlay controls | 12.04 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS after independent raw-profile overlay controls | ~1 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS after independent raw-profile overlay controls | ~2 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS after independent raw-profile overlay controls | ~2 s |
| 2026-05-05 | `.venv/bin/python -m pytest tests/unit/test_dof_metrics.py tests/unit/test_dof_metric_results_api.py -q` | PASS, 11 passed | 1.83 s |
| 2026-05-05 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.43 s |
| 2026-05-05 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS after independent raw-profile overlay controls docs sync | ~1.5 s |
| 2026-05-05 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 18.38 s |
| 2026-05-05 | `git diff --check` | PASS after independent raw-profile overlay controls | <1 s |
| 2026-05-11 | `npm run build` | PASS after per-chart CSV exports | 11.61 s |
| 2026-05-11 | `npm run lint -- web/src/analysis.tsx web/src/shared.tsx` | PASS with existing warnings only | ~2 s |
| 2026-05-11 | `.venv/bin/python scripts/smoke_test.py --tier 0` | PASS | ~1.1 s |
| 2026-05-11 | `.venv/bin/python scripts/smoke_test.py --tier 1` | PASS | <1 s |
| 2026-05-11 | `.venv/bin/python scripts/smoke_test.py --tier 2` | PASS | ~1 s |
| 2026-05-11 | `.venv/bin/python scripts/smoke_test.py --tier 3` | PASS | ~1 s |
| 2026-05-11 | `.venv/bin/python -m pytest -m web_smoke -q` | SKIPPED, 4 skipped because Playwright is not installed | 1.31 s |
| 2026-05-11 | `.venv/bin/python -m pytest -q` | PASS, 315 passed / 4 skipped | 17.63 s |
| 2026-05-11 | `git diff --check` | PASS | <1 s |
| 2026-05-11 | `curl -s http://127.0.0.1:8765/` | PASS, served rebuilt `/assets/index-C70U4gM_.js` | <1 s |

## Smoke status (last verified 2026-05-11)

- Tier 0: PASS
- Tier 1: PASS
- Tier 2: PASS
- Tier 3: PASS
- Tier 4 (Playwright): SKIPPED, Playwright not installed
- pytest: PASS, 315 passed / 4 skipped
- Vite build: PASS after per-chart CSV exports
- npm lint: PASS with existing warnings only
- git diff check: PASS

## Browser verification

- [ ] Screenshots captured (`screenshots/` subfolder)
- [ ] Console error-free
- [ ] Network error-free
- [ ] Keyboard walk clean
- [ ] Responsive at 1024 / 1280 / 1920
- [ ] Light + dark themes verified

Screenshots:

- Not captured: `tool_search` exposed no Browser Use tool, and Playwright is not installed. Build, Tier 0 TypeScript/lint/prettier, full pytest, and live server root/health checks passed.

## Reviewer findings

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | self-check only | P2 | Reviewer subagents not invoked because the active tool policy allows subagents only when the user explicitly asks for delegation. | Documented; mitigated with tests/build/live API sanity. |

## Open issues (P0 / P1 / P2 / P3)

- P0: none
- P1: none
- P2: none
- P3: none

## Blockers

- Browser automation unavailable in this thread; manual browser visual confirmation remains for the user.

## Known checks still required

- User visual confirmation in the refreshed in-app browser.

## Next concrete action

1. Refresh `http://127.0.0.1:8765/`.
2. Open a result modal and confirm chart cards show **CSV** beside
   **PNG** when that card has plotted data.
3. Download CSV from representative USAF, FPN, and DoF chart cards and
   confirm each file contains only that card's plotted data.
4. In DoF, draw/select a line, turn one band off, run analysis, and
   confirm the `Raw profiles` tab inherits the pre-run metric band,
   profile band, metric peak, and profile peak visibility.

## Stop / resume notes

- Current branch: `codex/polarization-dolp-aop-calibration`
- Active milestone: closed, pending user visual confirmation
- Modified files: see above
- Next concrete action: user refreshes the browser and samples per-chart CSV downloads in representative result tabs.
- Decisions this session: supplemental profile band stays server-side and opt-in visible via toggles; display controls are not analysis inputs; All 4 metrics persists full result trees; per-chart CSV exports are scoped to the specific chart card rather than the whole modal.
- Reviewer findings still open: none

## Decisions this session

- (2026-05-05) **Profile band is supplemental**: keep the metric-based DoF band as the canonical existing result and add the raw-profile band as a second explainable overlay.

## Outcomes & retrospective

- Implemented server-side local stripe-amplitude envelope calculation and serialized `profile_contrast_norm`, profile peak, low/high/width, and bounded-edge flags.
- Added a DoF picker `Profile threshold` card below `Focus metric` with threshold slider and metric/profile band toggles.
- Added green/blue band overlays in the right-side raw profile preview and Run Analysis `Raw profiles` tab.
- Follow-up fixed `_DoFTabBody` so the raw-profile result tab receives `showMetricBand` / `showProfileBand`, and clarified the per-card footer labels.
- Added `Load analysis` for exported result JSON snapshots; `Load cfg` remains the picker-configuration path.
- Imported DoF analysis JSONs now remain frozen snapshots: metric changes
  no longer trigger `/api/dof/analyze`, and the metric control is
  rendered as a static `snapshot` label.
- USAF/FPN/DoF Run Analysis now uses only currently-valid Analysis
  channels; stale localStorage channels disable Run Analysis instead of
  falling back to Display channel.
- DoF calibration payloads now use canonical `μm`; picker/result unit
  controls only format existing values.
- DoF All 4 metrics now returns and exports full cached result trees in
  `metric_results`, so the metric selector after Run Analysis / Load
  analysis reads saved results rather than recomputing.
- DoF Run Analysis result tabs now display metric-aware titles on the
  summary table and every chart family, including line scans, raw
  profiles, metric comparison, chromatic shift, Gaussian fits, focus
  heatmaps, and points/tilt diagnostics.
- DoF raw profiles now preserve the yellow metric/Gaussian peak marker
  and optionally add a purple dashed profile-contrast peak marker from
  `profile_peak_position_px`; the toggle is available before Run
  Analysis and in the results modal, and is saved in DoF cfg / analysis
  JSON.
- DoF `Metric compare` copy no longer refers to a selected metric; it
  now describes the all-metric overlay directly.
- DoF raw-profile overlays now expose four independent visibility
  controls (metric band, profile band, metric peak, profile peak) before
  and after Run Analysis; metric/profile peak toggles persist in cfg and
  analysis JSON, and Raw profile chart titles mention the selected metric
  only when metric peak is shown.
- Per-chart CSV exports now sit beside the existing per-card PNG export
  button and emit only the plotted data for that specific USAF, FPN, or
  DoF chart card.
- Verification is green except browser automation, which skipped because Playwright/Browser Use are unavailable in this thread.

## Final verification

### Final verification (2026-05-11)

Gates:

- [x] `npm run build`
- [x] `npm run lint -- web/src/analysis.tsx web/src/shared.tsx` — existing warnings only
- [x] Tier 0 — agent-doc consistency / frontend lint / typecheck
- [x] Tier 1 — imports
- [x] Tier 2 — headless figures
- [x] Tier 3 — FastAPI endpoints
- [x] Tier 4 — browser smoke — DEFERRED/SKIPPED because Playwright is not installed
- [x] `pytest -q` full suite green, 315 passed / 4 skipped
- [x] `git diff --check`
- [x] live root/health curl confirmed the server is serving rebuilt `/assets/index-C70U4gM_.js`

Browser verification:

- [x] Screenshots/manual click-through — DEFERRED; no Browser Use tool was exposed and Playwright is not installed.

### Final verification (2026-05-05)

Gates (from QUALITY_GATES.md per-change-type table):

- [x] Tier 0 — agent-doc consistency
- [x] Tier 1 — imports
- [x] Tier 2 — headless figures
- [x] Tier 3 — FastAPI endpoints
- [ ] Tier 4 — browser smoke — N/A — Playwright is not installed; pytest marked 4 web smoke tests skipped
- [ ] Tier 5 — feature Playwright tests — N/A — no Playwright runtime available in this workstation session
- [ ] Tier 6 — visual regression — N/A — no visual baseline exists for DoF profile-band charts
- [ ] Tier 7 — accessibility checklist — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Tier 8 — performance profile — N/A — profile arrays are capped and live API sanity returned 171 samples
- [x] pytest -q full suite green
- [x] npm run build green
- [x] git diff --check green
- [x] live DoF API sanity green with `profile_threshold`

Browser verification (see UI_VERIFICATION.md):

- [ ] App booted; mount verified — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Screenshots captured — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Console error-free after interaction — N/A — Browser Use/Preview tools are not exposed in this thread
- [x] Network error-free after interaction for live API sanity
- [ ] Keyboard walk complete; Esc closes modals; focus return works — N/A — Browser Use/Preview tools are not exposed in this thread
- [ ] Empty / loading / error / success states verified — N/A — API no-data fallbacks exist; browser states not inspectable here
- [ ] Exports verified if applicable — N/A — chart export pipeline unchanged

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | self-check only | P2 | Reviewer subagents not invoked because the active tool policy allows subagents only when the user explicitly asks for delegation. | Documented; mitigated with tests/build/live API sanity. |

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
- [ ] RISKS.md — N/A — no new persistent risk surfaced beyond the supplemental-band caveat documented in DECISIONS
- [ ] BACKLOG.md — N/A — no deferred product work added

State:

- [x] Status.md — Progress updated
- [x] HANDOFF.md — Last updated, current state, next action
- [x] CHANGELOG_AGENT.md — new entry
- [x] git status -sb captured and consistent with docs

Honesty:

- [x] Final response to user will state what was verified, what was not, and why.
