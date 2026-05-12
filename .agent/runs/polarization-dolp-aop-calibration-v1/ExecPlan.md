# ExecPlan — polarization-dolp-aop-calibration-v1

Opened: 2026-04-30
Branch: `codex/polarization-dolp-aop-calibration`
Owner: agent (per user request)

## 1. Goal

Add polarization-derived DoLP/AoP outputs for the existing polarization ISP modes, plus optional `.polcal.h5` calibration-map support gated on a loaded dark frame.

## 2. Why (user value)

The Polarization camera modes currently expose analyzer channels only. Users need the standard Stokes-derived DoLP/AoP outputs and a way to apply lab calibration products from the provided calibration scripts before analyzing or previewing those derived images.

## 3. Scope (in)

- Runtime DoFP helpers for Stokes, DoLP, AoP, `.polcal.h5` profile loading, and optional calibration-map application.
- Session/source state for an attached polarization calibration file and enable/disable switch.
- FastAPI upload/load-path/clear/settings routes for polarization calibration.
- ISP settings UI controls for calibration upload and apply switch.
- Focused backend tests and minimal docs/status sync.

## 4. Out of scope (deliberately deferred)

- Rebuilding the full calibration-generation notebook workflow in the web app.
- New dependencies for optional batch export paths from the downloaded scripts.
- A new standalone Polarization analysis page; derived channels should be available to the existing analysis/display surfaces.

## 5. Architecture impact

Adds derived polarization channel keys under the two polarization ISP modes. Single-gain mode gains `S0`, `DoLP`, and `AoP`; dual-gain mode gains gain-prefixed variants such as `LG-DoLP` and `LG-AoP`. Calibration lives in source session state and is applied during channel derivation only when explicitly enabled.

## 6. UI/UX impact

When a polarization mode is selected in Filter & Channel Specification, users can load a polarization calibration file and toggle its application. The toggle stays disabled until both a dark frame and a calibration file are attached.

## 7. Backend / API impact

`SourceSummary` gains polarization calibration status fields. New routes under `/api/sources/{source_id}/polarization-cal/*` manage the attached calibration and the enabled state.

## 8. Data model impact

`LoadedSource` gains polarization calibration metadata. Existing non-polarization sources should ignore these fields. No on-disk project data is migrated.

## 9. Test strategy

- Unit: pure DoLP/AoP math, calibration profile loading/application, derived channel emission.
- API: upload/load/enable gating rejects calibration without dark and updates summary when valid.
- Smoke: Tier 0–3 and full pytest.
- Frontend: Vite build; browser check if tooling/server state allows.

## 10. Verification agents to invoke (at close)

- [ ] docs-handoff-curator
- [ ] risk-skeptic

Note: reviewer subagents are not spawned in this desktop thread unless explicitly requested by the user.

## 11. Milestones

- [x] **M1 — Runtime math** — pure polarization helper module and tests.
- [x] **M2 — Session/API** — attach calibration, enforce dark+cal gating, emit derived channels.
- [x] **M3 — ISP UI** — upload/load/clear/toggle controls for polarization modes.
- [x] **M4 — Verification and docs** — tests, build, smoke, handoff docs.

## 12. Acceptance criteria

- [x] Polarization modes expose DoLP and AoP derived outputs after Run Analysis/display refresh.
- [x] Optional calibration map can be enabled only after both dark and `.polcal.h5` are attached.
- [x] Calibration uses the uploaded profile data rather than hardcoded lookup values.
- [x] Existing RGB-NIR, bare, image, USAF, FPN, DoF flows keep passing tests.
- [x] Tier 0–3 smoke green.
- [x] Full pytest green.
- [x] Frontend build succeeds.

## 13. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Channel schema changes surprise existing analysis defaults | Medium | Add derived keys only for polarization modes and preserve analyzer keys. |
| W-2 | Calibration map order mismatches analyzer channel order | High | Mirror the supplied scripts' standard physical order and legacy runtime order explicitly; cover with tests. |
| W-3 | Applying calibration without dark subtract produces misleading outputs | High | Server-side enable route requires attached dark and calibration file. |
| W-4 | Large `.polcal.h5` files increase memory use | Medium | Load only the active profile arrays and keep runtime helpers NumPy-only. |

## 14. Rollback plan

Use the timestamped backup at `/Users/mini-09/BioSensorsLab/MantisAnalysis_backup_before_pol_dolp_aop_20260430_111841`, or switch off this branch.

## 15. Decisions

- 2026-04-30 **decision**: Implement calibration application from the standard `.polcal.h5` schema produced by the supplied export script; do not embed the whole notebook/batch generation workflow in the web app.
- 2026-04-30 **decision**: Gate the calibration toggle on both dark-frame presence and attached calibration-file presence, matching the user's requested workflow.

## 16. Surprises & discoveries

- 2026-04-30 The ISP registry already defined two polarization modes and documented derived Intensity/AoP/DoLP as a future analysis-time behavior; implementation was missing.

## 17. Outcomes & retrospective

Closed 2026-04-30. The implementation keeps polarization outputs as
virtual channels so existing display and Run Analysis flows can select
them without a new analysis page. Calibration profiles are loaded from
the standard `.polcal.h5` schema, and the server enforces the requested
dark-frame + calibration-file gate before applying the map.

Automated verification was green: Tier 0–3 smoke, full pytest, focused
polarization tests, Vite build, and a live-server curl smoke against the
new polarization calibration route flow. Browser screenshots were
deferred because Playwright is not installed and no Browser Use tool was
available in this thread.
