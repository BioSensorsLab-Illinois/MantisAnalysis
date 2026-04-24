# correctness-sweep-v1 — ExecPlan

Opened: 2026-04-24
Branch: `main`
Owner: agent (per user "work on all unfinished bug fixes and
improvement other than the h5 recording viewer").

## 1. Goal

Close the accumulated small-severity correctness + UX items in one
coherent sweep so they don't linger on the backlog while larger work
(analysis-page-overhaul-v1 Phase 3+, H5-inspector) moves forward.

## 2. Why

Seven open items on `BACKLOG.md` / `RISKS.md`. Individually each is
small; collectively they're the paper cuts a new user would notice
first. The harness-mechanical Tier-0 gates now in place protect
against doc drift while this lands.

## 3. Scope (in)

Closes:

- **R-0004** — `mantisanalysis/extract.py:112-117` dead
  `split_and_extract`. Remove.
- **R-0005** — `mantisanalysis/usaf_groups.py::measure_modulation`
  can return percentile-Michelson > 1 under aggressive sharpening.
  Clamp to [0, 1] with a warning field on the response.
- **R-0006 / B-0007** — Rotate / flip silently clears picks.
  Add a confirm-before-clear UX in the three mode panels, with a
  "reset rotation first to restore picks" hint.
- **R-0009** — `session.STORE` LRU eviction silent to frontend.
  Server returns 410 Gone when a missing `source_id` is requested
  (currently 404 is the catch-all). Frontend flushes cached id on
  410.
- **R-0010** — ISP reconfigure strands analysis results. Frontend
  invalidates its cached analysis state on `source.isp_config`
  change.
- **B-0006** — Legacy Workflow A CLI (`scripts/run_usaf_resolution.py`)
  is documented in README but has zero test coverage. Add a thin
  smoke test that runs it headless against a synthetic PNG.
- **B-0012** — Onboarding helper script: `scripts/doctor.py`
  checks python version, deps installed, dev extras installed,
  Playwright optional, prints actionable advice.

## 4. Out of scope

- H5 recording-inspection viewer — user exclusion.
- analysis-page-overhaul-v1 Phase 3+ — paused; own initiative.
- B-0014 Vite bundler — architectural; own initiative.
- B-0015 extended per-mode Playwright tests — substantial; benefits
  from Phase 3 shell landing first.
- B-0018 real-sample validation — blocked on lab captures (user).
- R-0011 Playwright font diffs — no visual-regression baseline exists.
- R-0014 residual hook-to-block promotion — future escalation.
- R-0015 same-context reviewers — requires harness changes.
- R-0016 qt-allowed budget — speculative today.

## 5. Architecture impact

None of these cross a layer boundary.

## 6. UI/UX impact

- Rotate/flip prompt — new confirm dialog (or toast + undo) on the
  three mode panels.
- Stale-source handling — page may surface "source was evicted;
  reloading" toast + auto-load-sample fallback.
- ISP-reconfigure — analysis modal becomes stale → shows "stale;
  re-run analyze" banner or auto-clears.

## 7. Backend / API impact

- New 410 Gone status from `server.py` when a source was evicted
  (distinct from 404 for a never-existed id).
- `usaf/measure` response gains `clamped: bool` + `raw_modulation`
  fields for R-0005.

## 8. Data model impact

None.

## 9. Test strategy

Tier 0-3 + pytest. New tests per item:

- `tests/unit/test_michelson.py` extended — clamp + warning surface.
- `tests/unit/test_session.py` (new or extended) — 410 on evicted.
- `tests/unit/test_isp_override.py` extended — reconfigure detaches
  dark AND clears cached analysis pointer (if we add one).
- `tests/unit/test_legacy_cli.py` (new) — Workflow A smoke.
- `tests/unit/test_doctor.py` (new) — doctor.py exits 0 on the
  current dev env.

## 10. Milestones

- [ ] **M1** — R-0004 dead-code removal (trivial).
- [ ] **M2** — R-0005 Michelson clamp + test.
- [ ] **M3** — R-0009 410 Gone + `shared.jsx::apiFetch` handler.
- [ ] **M4** — R-0010 ISP reconfigure invalidates frontend state.
- [ ] **M5** — R-0006 / B-0007 rotate/flip warning in three modes.
- [ ] **M6** — B-0006 legacy CLI smoke test.
- [ ] **M7** — B-0012 `scripts/doctor.py`.
- [ ] **M8** — Gates + browser verify + close.

## 11. Acceptance

- [ ] Tier 0 / 1 / 2 / 3 + pytest all green.
- [ ] Every bug has ≥ 1 regression test.
- [ ] BACKLOG entries B-0006, B-0007, B-0012 marked CLOSED.
- [ ] RISKS R-0004, R-0005, R-0006, R-0009, R-0010 marked CLOSED /
      MITIGATED.
- [ ] Browser verified for the 3 UX-touching items (R-0006, R-0009,
      R-0010).

## 12. Risks

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| W-1 | Michelson clamp hides real physics signal | Low | Return `raw_modulation` alongside clamped `modulation`; docs call out the clamp in response schema. |
| W-2 | 410 vs 404 change is a breaking API surface | Low | Grandfather: emit 410 only for evicted ids (tracked via a `_evicted` set); unknown ids stay 404. |
| W-3 | Confirm-before-rotate dialog blocks power users | Low | Toast + 5-second undo, not a modal dialog. |

## 13. Decisions

- (2026-04-24) R-0009 uses 410 Gone, not 404, to distinguish evicted
  from never-existed. Rationale: lets frontend react specifically
  (flush localStorage, load-sample, retry).
- (2026-04-24) R-0005 returns `raw_modulation` alongside clamped
  `modulation`. Rationale: scientific transparency — the raw value
  is still useful for understanding how aggressive the sharpening
  got; the clamped value is what the UI displays.
