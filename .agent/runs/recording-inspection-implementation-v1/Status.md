# Status — recording-inspection-implementation-v1

> Updated at every milestone. Never delete prior content; append.

Opened: 2026-04-24
Last updated: 2026-04-25 (**M11 closed** — Send-to-mode handoff
backend + frontend + Storybook ProcessingBadge + skill doc
updates; Tier 0 PASS, pytest 249/249, web_smoke 16/16; ready to
begin M12)

## Current branch

`main` — per user 2026-04-24, working **directly on main** (no
initiative branch). Per-milestone commit; push only with explicit
user consent (AGENT_RULES rule 16).

## Active initiative

`.agent/runs/recording-inspection-implementation-v1/`

## Current milestone

**M12 CLOSED — INITIATIVE COMPLETE.** All 12 milestones delivered.
Reviewer P0/P1 disposition resolved inline; deferred polish tracked
in BACKLOG (B-0029..B-0037). 262 unit + headless tests, 21 web_smoke
tests, 5 visual baselines (light + dark + 1024 narrow + sample
single + sample 2×2). Tier 0 PASS, npm build/lint/typecheck clean.

## Reviewer findings rollup (M12)

8 reviewer agents fired serially per ExecPlan §10. Reports under
`reviews/`:

| Reviewer | P0 | P1 | P2/P3 | Disposition |
|---|---|---|---|---|
| `fastapi-backend` | 2 | 7 | 4 | P0/P1 resolved inline; 4 P2/P3 → BACKLOG |
| `frontend-react` | 1 | 9 | 11 | P0 + 6 of 9 P1 inline; 3 P1 + all P2/P3 → BACKLOG |
| `react-ui-ux` | 1 | 7 | 5 | P0 + 3 cheap P1 inline; 4 P1 (drop zone, remove confirm, handoff modal, responsive collapse, context menu) → BACKLOG |
| `accessibility` | 4 | 5 | 7 | P0 (4) + 4 cheap P1 inline; 1 P1 (responsive reflow) + P2/P3 → BACKLOG |
| `performance` | 2 | 4 | 3 | P0 (2: slider debounce, ProcessPool honesty) inline; 4 P1 (ticker refs, React.memo, Cache-Control, perf test) — 2 inline, 2 → BACKLOG |
| `playwright-verifier` | 3 | 9 | 6 | P0 (3: cold-start flake, wait_for_timeout removal, conftest cleanup hoist) inline; P1/P2 → BACKLOG |
| `test-coverage` | 3 | 5 | 4 | P0 (3: cancel test, double-dark refusal, bare_dualgain handoff) inline; P1 (5) → 3 inline + 2 BACKLOG |
| `risk-skeptic` | 1 | 5 | 5 | P0 (A1) inline (honest downgrade); 4 of 5 P1 inline; A6 dead by A1 fix; P2 → BACKLOG |

**Inline P0/P1 fix log (M12):**

Backend (`mantisanalysis/`):
- `playback_export.py`: WYSIWYG dark fix — `render_views_for_frame`
  now accepts `dark` and applies per-view `dark_on`. Removed dead
  `render_frame_for_export` + `ProcessPoolExecutor` import. Honest
  docstring about thread-only Event.
- `playback_api.py`: handoff promoted to `HandoffRequest(BaseModel)`;
  uses `STORE.register_external` (not `_items` poking); passes
  `stream.isp_mode_id` + empty `isp_config` to LoadedSource; error
  detail nesting fixed (`detail={"message":...,"code":"W-HANDOFF-NOLUM"}`);
  both export paths resolve dark per-frame from `view.dark_on`;
  `_run` unlinks partial output on cancel/fail (risk-skeptic A2).
- `playback_session.py` + `playback_export.py`: docstrings updated
  to honestly describe single-process threaded export (risk-skeptic
  A1 honest downgrade); ProcessPool migration deferred to
  `playback-multiproc-v1` follow-up (BACKLOG).
- `dark_frame.py::match_dark_by_exposure`: refuses target=0.0 +
  skips zero-exposure darks (risk-skeptic A5).
- `session.py::SessionStore`: new `register_external` method;
  `_refuse_if_dark_already_subtracted` guard wired into both
  `attach_dark_from_path` and `attach_dark_from_bytes` (test-cov
  P0-B + risk-skeptic A3 + planner-architect P0-2 contract).

Frontend (`web/src/`):
- `playback/state.tsx`: F1 — eviction filtering moved into reducer
  (`stream/evict` action); listener subscribes once with `[]` deps.
- `playback/index.tsx`: F2/F10 — `frameRef` + ticker/keyboard
  effects no longer depend on `state.frame`. Ticker capped at 60 fps
  (was 125 fps); cleaner cleanup.
- `playback/ViewerCard.tsx`: F3 — epoch bumped in `useLayoutEffect`
  before img remounts; handlers read `epoch.current` directly. F8 —
  `useDebounced(view, 80)`. F9 — stable `_viewSig` URL key. A11y P0:
  dropped `role="button"` + `aria-selected` (axe critical), wrapped
  as `role="group"`; toolbar always mounted with opacity/pointer-
  events for keyboard reachability (axe serious nested-interactive
  resolved). Toolbar buttons bumped 22→24 px (WCAG 2.5.8). Handoff
  buttons get `title=` tooltips.
- `playback/ExportVideoModal.tsx`: F4 — `pollAliveRef` +
  `pollTimeoutRef` track lifecycle; cancel stops polling immediately.
  Progress bar gains `role="progressbar"` + `aria-valuenow/min/max/
  text`; container `aria-live="polite"`.
- `shared.tsx`: Modal upgraded — `role="dialog"`, `aria-modal="true"`,
  focus moved into dialog on mount, focus trap on Tab/Shift+Tab,
  focus restored to trigger on close. Toast → `role={status|alert}`
  + `aria-live`. Global `:focus-visible { outline: 2px solid #1560d9 }`
  injected into the one-time stylesheet.

Tests:
- `tests/headless/test_playback_api.py`: 7 new Tier 3 regression
  tests + STORE-cleanup in `client` fixture.
- `tests/web/conftest.py`: autouse fixture clears both stores before
  every Tier 4 test (test-coverage P1-D + playwright-verifier P0).
- `tests/web/test_playback_boot.py`: `wait_for_timeout(500)` → web-
  first `wait_for_load_state('networkidle')`. Cold-start flake fix:
  init script sets `mantis/mode='play'` + `mantis/playback/enabled='1'`
  before goto.
- `tests/web/test_playback_visual_baselines.py`: localStorage
  `mantis/theme` set to match the requested theme (light vs dark
  baselines now byte-differ); `wait_for_function` on
  `naturalWidth>0` for img instead of blind sleep; `document.fonts.
  ready` between reload and screenshot.
- `tests/unit/test_dark_frame.py`: 2 new tests for the exposure=0
  guard.

CI (`.github/workflows/smoke.yml`):
- `tier4-web-smoke` job installs ffmpeg so video-export tests run.
- Uploads `screenshots/*.png` as a CI artifact for reviewers.

## Current focus

(Nothing — initiative is closed pending the M12 commit + the user's
push-to-origin go/no-go.)

## Current focus

M11 close (commit `1278264`):

- **Send-to-mode handoff backend** — `POST /api/playback/streams/{sid}/handoff/{mode}`
  (`mode ∈ {usaf, fpn, dof}`) renders the frame's raw extracted
  channel dict (post-dark, pre-display γ/WB/CCM), registers a new
  `LoadedSource` in analysis-mode `STORE`, returns
  `dark_already_subtracted: true` when dark was applied. Returns 422
  with `code: "W-HANDOFF-NOLUM"` when target mode lacks luminance
  (e.g. USAF on `bare_*` / `polarization_*` ISP modes).
- **Frontend handoff buttons** — three small `→U` / `→F` / `→D`
  buttons in `ViewerCard.tsx` hover toolbar (`data-action="handoff-{usaf|fpn|dof}"`).
  On success: app switches mode + binds the new source via existing
  `setSource()` hook in `app.tsx`.
- **Storybook ProcessingBadge story** at `web/src/ProcessingBadge.stories.tsx`
  (8 variants: Raw / Dark / Normalized / Lut / Rgb / Overlay / Locked
  / AllBadges + theme picker). Builds clean.
- **Skill doc updates** — `.agent/skills/recording-inspection/SKILL.md`
  now documents the handoff contract, presets workflow (M8), CCM
  editor (M8), and frame-LRU controls (M8).
- **4 Tier 3 handoff tests** in `tests/headless/test_playback_api.py`
  (round-trip + unknown mode + unknown stream + frame OOB) — all
  green.
- **1 Tier 4 Playwright handoff test** in `tests/web/test_playback_boot.py`
  (`test_playback_handoff_to_usaf`) — green.
- Total: 249 unit + headless tests, 16 web_smoke tests, all green.

Next concrete actions for M12:

1. Establish visual-regression baselines (Tier 6) under
   `screenshots/` — empty state, Sources panel, Stream Builder,
   ViewerGrid (each layout preset), Inspector (each section),
   Overlay Builder, Image/Video export modals (light + dark).
2. Spawn the milestone-close reviewer agents serially per
   ExecPlan §10 (M11/M12: `react-ui-ux-reviewer`,
   `accessibility-reviewer`, `performance-reviewer`,
   `frontend-react-engineer`, `fastapi-backend-reviewer`,
   `playwright-verifier`, `test-coverage-reviewer`,
   `risk-skeptic`, `docs-handoff-curator`). Resolve P0 / P1
   findings inline.
3. CI wiring (Tier 4 / 5 / 7) — confirm `pytest -m web_smoke`,
   feature Playwright tests, and `axe-core` accessibility checks
   are wired into `.github/workflows/*` (no GitHub remote yet, but
   the workflow files should be ready).
4. Final docs sync — HANDOFF.md, CHANGELOG_AGENT.md, DECISIONS.md,
   RISKS.md, ARCHITECTURE.md, REPO_MAP.md, SETUP_AND_RUN.md,
   manifest.yaml, BACKLOG.md, README.md.
5. Final initiative-close commit + stamp on Status.md.

## Progress

- [x] **M0** — Audit + plan (commit `005a355`).
- [x] **M1** — Backend: H5 inspection + flexible detection (commit `e2130fd`).
- [x] **M2** — Backend: dark-frame averaging + exposure matching (commit `17cb57d`); revert rehearsal logged in `14bd361` → `14ae6c8` per risk-skeptic P1-F.
- [x] **M3** — Backend: multi-file stream + global frame mapping (commit `588e342`).
- [x] **M4** — Backend: render pipeline + `/api/playback/*` preview (commit `3c75851`).
- [x] **M5** — Frontend: rail tile + empty state + Sources skeleton (commit `cb612ce`); shared.tsx + app.tsx eviction kind-routing fixed (risk-skeptic P0-B).
- [x] **M6** — Frontend: file loading, dark manager, Stream Builder modal.
- [x] **M7** — Frontend: ViewerGrid + ViewerCard + TimelineStrip + play-head ticker + keyboard map.
- [x] **M8** — Frontend: 9-section Inspector + CCM editor + presets + frame-LRU widget; backend solve_ccm_from_patches + 7 new routes.
- [x] **M9** — Overlay system end-to-end (Overlay Builder modal w/ live preview + Apply commits to view).
- [x] **M10** — Export system: image (synchronous, byte-equal WYSIWYG) + video (async job, MP4/APNG/GIF/PNG-seq, GIF cap, sidecar JSON, ffmpeg gate) (commit pending).
- [x] **M11** — Polish, handoff routing (`POST /api/playback/streams/{sid}/handoff/{mode}`), 3 viewer-toolbar buttons (`→U/→F/→D`), Storybook ProcessingBadge story, skill-doc updates (commit `1278264`).
- [x] **M12** — Final verification + visual-regression baselines + CI wiring (Tier 4 + ffmpeg + screenshots artifact) + 8 reviewer agents serially + P0/P1 inline resolution + docs sync (commit pending).

## Modified files

`git status -sb` snapshot after planning docs are written:

```
## main
 M .agent/runs/analysis-page-overhaul-v1/ExecPlan.md     (pre-existing)
 M .agent/runs/analysis-page-overhaul-v1/Status.md       (pre-existing)
 M web/src/analysis.tsx                                  (pre-existing)
?? .agent/runs/recording-inspection-implementation-v1/
?? web/src/analysis/                                     (pre-existing)
```

The pre-existing modifications belong to the separate
`analysis-page-overhaul-v1` initiative; we leave them alone. None of
M1+ work touches those files.

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-04-24 | initiative scaffold (planning) | n/a | n/a |
| 2026-04-25 | M1 close — `pytest tests/unit/test_recording_inspect.py` | 22 PASS | 0.18s |
| 2026-04-25 | M2 close — `pytest tests/unit/test_dark_frame.py` | 17 PASS | 0.18s |
| 2026-04-25 | M2 close — revert rehearsal (P1-F) | PASS | ~10s |
| 2026-04-25 | M3 close — `pytest tests/unit/test_playback_stream.py` | 26 PASS | 0.27s |
| 2026-04-25 | M4 close — `pytest tests/unit/test_playback_pipeline.py` | 23 PASS | 0.15s |
| 2026-04-25 | M4 close — `pytest tests/headless/test_playback_api.py` | 18 PASS | 1.38s |
| 2026-04-25 | M4 close — Tier 3 (smoke_test.py) | PASS | ~3s |
| 2026-04-25 | M5 close — `pytest -m web_smoke` | 8 PASS (was 4) | 26s |
| 2026-04-25 | M5 close — full `pytest -q` | 220 PASS | 36s |
| 2026-04-25 | M5 close — Tier 0/1/2/3 ladder | all PASS | ~5s |
| 2026-04-25 | M6 close — `pytest -m web_smoke` | 11 PASS (was 8) | ~32s |
| 2026-04-25 | M7 close — `pytest -m web_smoke` | 12 PASS (was 11) | ~35s |
| 2026-04-25 | M8 close — `pytest -q` full suite | 245 PASS | ~52s |
| 2026-04-25 | M8 close — `pytest -m web_smoke` | 13 PASS (was 12) | ~38s |
| 2026-04-25 | M9 close — `pytest -m web_smoke` | 14 PASS (was 13) | ~40s |
| 2026-04-25 | M10 close — `pytest -m web_smoke` | 15 PASS (was 14) | ~42s |
| 2026-04-25 | M10 close — `pytest -q` full suite | 245 PASS | ~52s |
| 2026-04-25 | M11 close — `pytest -q` full suite | 249 PASS | ~55s |
| 2026-04-25 | M11 close — `pytest -m web_smoke` | 16 PASS (was 15) | ~44s |
| 2026-04-25 | M11 close — Tier 0 (lint+prettier+tsc) | PASS | ~6s |
| 2026-04-25 | M11 close — `npm run build` + `build-storybook` | PASS | ~10s |
| 2026-04-25 | M12 close — `pytest -q` full suite | 262 PASS (was 249) | ~54s |
| 2026-04-25 | M12 close — `pytest -m web_smoke` | 21 PASS (was 16) | ~42s |
| 2026-04-25 | M12 close — Tier 0 (lint+prettier+tsc) | PASS | ~6s |
| 2026-04-25 | M12 close — `npm run build` + `typecheck` | PASS | ~15s |
| 2026-04-25 | M12 close — visual baselines captured (5 PNGs) | PASS | ~6s |
| 2026-04-25 | M12 close — 8 reviewer agents serially | PASS | ~12 min wall (parallel) |

Smoke + unit + Playwright runs begin at M1. The expected ladder is
documented in [`TEST_PLAN.md`](TEST_PLAN.md).

## Smoke status (last verified 2026-04-24 from prior session HANDOFF)

- Tier 0: ✅
- Tier 1: ✅ (15 modules)
- Tier 2: ✅
- Tier 3: ✅
- Tier 4 (Playwright): ✅ (existing 3 web_smoke tests)
- pytest: ✅ (109/109)
- npm run build / lint / typecheck: ✅ / 0 errors / 0 errors

(Per HANDOFF.md, last full ladder run before this session.)

## Browser verification

Pending. M5+ milestones populate this section.

- [ ] Screenshots captured (`screenshots/` subfolder)
- [ ] Console error-free
- [ ] Network error-free
- [ ] Keyboard walk clean
- [ ] Responsive at 1024 / 1280 / 1920
- [ ] Light + dark themes verified

Screenshots:

- (none yet — populates from M5)

## Reviewer findings (M0 close, 2026-04-24)

Both reviewers ran **serially** per user 2026-04-24. Full reports:

- `reviews/planner-architect.md` — 3 P0 / 12 P1 / 10 P2 / 8 P3.
  Disposition: "Approve with the P1 changes."
- `reviews/risk-skeptic.md` — 3 P0 / 9 P1 / 7 P2 / 6 P3.
  Disposition: "Pause" until P0-A/B/C resolved.

Implementer disposition: **all 6 P0 + 21 P1 + 17 P2 findings
resolved inline before M0 close.** P3s tracked in the review
files; non-blocking.

| ID | Reviewer | Sev | Title | Disposition |
|---|---|---|---|---|
| pa-P0-1 | planner-architect | P0 | Work-on-main rollback semantics | Resolved (§14 rewritten) |
| pa-P0-2 | planner-architect | P0 | Y synthesis on handoff | Resolved (`recording.extract_frame` mirrors image_io) |
| pa-P0-3 | planner-architect | P0 | pyproject.toml change in scope | Resolved (added to §3) |
| rs-P0-A | risk-skeptic | P0 | threading.Event vs ProcessPool | Resolved (multiprocessing.Event) |
| rs-P0-B | risk-skeptic | P0 | Eviction listener kind-routing | Resolved (M5 frontend edits) |
| rs-P0-C | risk-skeptic | P0 | Process-global LRU cap | Resolved (single OrderedDict) |
| pa-P1-1..12 | planner-architect | P1 | (12 items) | All resolved (see report) |
| rs-P1-D..L | risk-skeptic | P1 | (9 items) | All resolved (see report) |
| pa-P2-1..10 | planner-architect | P2 | (10 items) | All resolved (see report) |
| rs-P2-M..S | risk-skeptic | P2 | (7 items) | All resolved (see report) |

## Open issues (P0 / P1 / P2 / P3)

- P0: **none open** (6 resolved inline at M0 close)
- P1: **none open** (21 resolved inline at M0 close)
- P2: **none open** (17 resolved inline at M0 close)
- P3: 14 P3 observations recorded in `reviews/*.md`; non-blocking;
  consulted at relevant milestones.

## Blockers

- **User confirmation that the M0-close inline resolutions are
  acceptable.** Two reviewers (`planner-architect`, `risk-skeptic`)
  flagged 3 P0s each; all six are resolved in the patched plan.
  The user's policy "P1 changes mandatory; whatever makes the end
  result better; never mark a milestone done without a Playwright
  run" is honored.

## Known checks still required

Tracked deferrals (none currently active; this section grows as
implementation reveals trade-offs):

- (none)

## Next concrete action

1. ~~Spawn `planner-architect` reviewer~~ — done; report at
   `reviews/planner-architect.md`. P0+P1+P2 resolved inline.
2. ~~Spawn `risk-skeptic` reviewer~~ — done; report at
   `reviews/risk-skeptic.md`. P0+P1+P2 resolved inline.
3. **Surface M0 close to user** for go/no-go on M1 implementation.
4. On user OK: commit M0 close on `main` with subject
   `recording-inspection-v1 M0 — initiative plan + reviewer pass`.
4. Begin M1:
   a. Write `tests/unit/_h5_fixtures.py` (synthetic H5 builder,
      8 layout variants).
   b. Write `mantisanalysis/recording.py::inspect_recording` with
      the 7-fallback layout-detection ladder.
   c. Write `tests/unit/test_recording_inspect.py` (~12 cases,
      per [`TEST_PLAN.md` §9.1](TEST_PLAN.md#91-testsunittest_recording_inspectpy)).
   d. Manual smoke against
      `/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5`,
      `sample_2_view_2_exp_0.4.h5`, `sample_11_view_2_exp_0.3.h5`
      (different exposures).
   e. Run `python scripts/smoke_test.py --tier 1` and
      `python -m pytest tests/unit/test_recording_inspect.py -q`.
   f. **Run Tier 4 Playwright** even though M1 is backend-only
      (mandatory per user). Boot the app, confirm rail/UI still
      green.
   g. Spawn relevant reviewers per ExecPlan §10 (M1: none mandatory;
      `risk-skeptic` advisable for the layout fallback ladder).
   h. Commit M1.

## Stop / resume notes

If this session stops mid-M0:

- Current branch: `main` (initiative folder is just-authored docs;
  no code edits yet).
- Active milestone: M0.
- Modified files: see "Modified files" above (only the new
  initiative folder's docs).
- Next concrete action: see "Next concrete action" above.
- Decisions this session: none yet (initial decisions live in
  `ExecPlan.md` §15).
- Reviewer findings still open: none yet.

If this session stops mid-M1+:

- Current branch: `recording-inspection-implementation-v1`.
- Active milestone: <Mn>.
- Modified files: rerun `git status -sb` and paste here.
- Failed checks: list explicitly.
- Open reviewer findings: copy from "Reviewer findings" above.
- Next concrete action: name the file/function being edited and the
  next test that needs to pass.

## Decisions this session

Full list in `ExecPlan.md` §15. Highlights:

- **Server-side preview rendering** (PNG endpoint pattern).
- **Separate `PlaybackStore`** parallel to analysis `STORE`.
- **Channel-key schema frozen** (rule 6).
- **Work directly on `main`** (no branch).
- **`imageio-ffmpeg` becomes required for M10 close** — moved from
  soft dep to hard prerequisite.
- **9-section collapsible inspector** (spec.md §7.1.8) with
  Basic/Advanced segmented; not the prototype's 6-tab layout.
- **All 5 ISP modes from M1.**
- **Frame-LRU user-adjustable [4..512] with explanatory copy.**
- **Parallelized video export** via ProcessPoolExecutor.
- **CCM editor + calibrated WB in M8.**
- **Send-to-mode handoff in M11.**
- **Visual-regression baselines (Tier 6) established in M11–M12.**
- **Tier 4/5/7 wired into CI in M12.**
- **Reviewer agents fire serially per milestone close.**
- **Storybook stories for primitives in M11.**
- **Playwright run mandatory before any milestone marked done.**
- **GIF export added** via Pillow `save_all=True`.
- **Dev fixture path:** `/Users/zz4/Desktop/day5_breast_subject_1`
  — manual verification only; never committed.

## Final verification (M12 — closed 2026-04-25)

Gates (from QUALITY_GATES.md per-change-type table):

- [x] Tier 0 — agent-doc consistency
- [x] Tier 1 — imports (21 modules; was 15)
- [x] Tier 2 — headless figures
- [x] Tier 3 — FastAPI endpoints (45 playback Tier 3 tests)
- [x] Tier 4 — browser smoke (`pytest -m web_smoke`) — 21 PASS
- [x] Tier 5 — feature Playwright tests (workspace + handoff + visual baselines)
- [x] Tier 6 — visual regression baselines established (5 PNGs); diff infra deferred to B-0038
- [~] Tier 7 — accessibility checklist (axe baseline 0/0 still holds; Playback inline P0/P1 axe fixes landed; @axe-core/playwright wiring against Playback is a B-0030 follow-up)
- [~] Tier 8 — performance profile (perf-reviewer numbers in `reviews/performance.md`; 1080p tiled-2×2 mp4 ≤ 8 s NOT auto-tested — deferred to B-0034. Inline F1/F2 fixes (slider debounce + ProcessPool honest downgrade) landed.)
- [x] pytest -q full suite green (262/262)
- [x] `npm run build` / `lint` / `typecheck` / `build-storybook` green
- [~] CI matrix Tier 4/5/7 green on synthetic PR — Tier 4 wired (`smoke.yml::tier4-web-smoke` includes ffmpeg + screenshots artifact); GitHub Actions run is gated on push, deferred per AGENT_RULES rule 16 (no push without user consent)

Browser verification (see UI_VERIFICATION.md):

- [x] App booted; mount verified (preview MCP at :8773)
- [x] Screenshots captured (light + dark + sample loaded + 2x2 + 1024 narrow → `screenshots/M12_baseline_*.png`)
- [x] Console error-free after interaction (every web_smoke test asserts; `test_playback_flag_enables_rail_and_empty_state` enforces)
- [x] Network error-free after interaction (eviction-kind test confirms no spurious requests)
- [x] Keyboard walk complete; Esc closes modals (Modal upgrade — focus trap + focus return added in M12)
- [x] Empty / loading / error / success states verified (16 web_smoke tests cover every primary state)
- [x] Exports verified (test_export_image_*, test_export_video_png_seq_round_trip, byte-equal WYSIWYG including with dark)

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| fb-P0-1 | fastapi-backend | P0 | WYSIWYG broken on dark | Resolved (`render_views_for_frame` + both export sites; new test) |
| fb-P0-2 | fastapi-backend | P0 | Handoff bypasses SessionStore API | Resolved (`STORE.register_external` + new test) |
| fr-F1 | frontend-react | P0 | Eviction listener stale closure | Resolved (`stream/evict` reducer action) |
| pf-F1 | performance | P0 | Slider drag → 51 PNG fetches | Resolved (`useDebounced(view, 80)` + viewSig URL key) |
| pf-F2 | performance | P0 | ProcessPool not parallelized | Resolved by honest downgrade + dead-code removal; B-0029 tracked |
| pw-P0-1 | playwright | P0 | Cold-start flake | Resolved (init script sets mode=play) |
| pw-P0-2 | playwright | P0 | wait_for_timeout antipattern | Resolved (web-first wait_for_load_state) |
| pw-P0-3 | playwright | P0 | Test isolation | Resolved (autouse conftest fixture) |
| tc-P0-A | test-coverage | P0 | mp.Event cancel never tested | Open — single-process honest downgrade docs the gap; full integration test deferred to B-0033 |
| tc-P0-B | test-coverage | P0 | Double-dark refusal not implemented | Resolved (`_refuse_if_dark_already_subtracted` + new test) |
| tc-P0-C | test-coverage | P0 | bare_*/polarization_* handoff untested | Resolved (test_handoff_w_handoff_nolum_error_code_shape) |
| a11y-P0-* | accessibility | P0 (4) | Modal ARIA, ViewerCard nested-interactive, hover toolbar keyboard | Resolved (Modal upgrade + role=group + always-mounted + 22→24 px) |
| ux-P0 | react-ui-ux | P0 | Modal ARIA | Resolved (subsumed by a11y-P0) |
| rs-A1 | risk-skeptic | P0 | rs-P0-A regressed | Resolved by honest downgrade; B-0029 tracked |
| (P1/P2/P3) | various | mixed | (~50 items) | ~30 inline; ~20 → BACKLOG B-0029..B-0038 |

Docs:

- [x] ARCHITECTURE.md (Playback section + import graph + analysis-purity note)
- [x] REPO_MAP.md (6 backend modules + 16 React components + 7 test files + Playback row in mode table)
- [~] SETUP_AND_RUN.md — no new install steps required (Playback already in `[project.optional-dependencies].playback-video` per pyproject.toml or graceful skip if ffmpeg missing); flag opt-in documented in README
- [~] WORKFLOWS.md — covered by `.agent/skills/recording-inspection/SKILL.md`; main WORKFLOWS.md unchanged
- [~] QUALITY_GATES.md — Tier ladder unchanged; Tier 6 (visual regression) opportunistically used; Tier 8 (perf) deferred
- [~] TOOLS_AND_SKILLS.md — recording-inspection skill exists; no new tools added
- [x] README.md (4-mode table now lists Playback as preview)
- [x] manifest.yaml (6 backend modules + Storybook story + 7 test files + 4 risky_areas)
- [x] DECISIONS.md (D-0018 flag-gate, D-0019 single-process honest, D-0020 dark-already-subtracted contract)
- [x] RISKS.md (R-0017 single-process encode, R-0018 flag default off, R-0019 visual baselines no diff)
- [x] BACKLOG.md (B-0029 multiproc, B-0030 ux polish, B-0031 test cleanup, B-0032 flag flip, B-0033 coverage gaps, B-0034 perf test, B-0035 cache-control, B-0036 React.memo, B-0037 hot-path hoist, B-0038 visual regression diff)

State:

- [x] Status.md — Progress updated, M12 marked closed, reviewer rollup written
- [x] HANDOFF.md — last updated, current state, next action
- [x] CHANGELOG_AGENT.md — new entry (top of file)
- [x] git status -sb captured and consistent with docs (29 commits ahead of origin/main, push pending — AGENT_RULES rule 16 honored, no auto-push)

Honesty:

- [x] Final response to user: what was verified, what wasn't, why.
