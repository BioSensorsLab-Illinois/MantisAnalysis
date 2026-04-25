# Status — recording-inspection-implementation-v1

> Updated at every milestone. Never delete prior content; append.

Opened: 2026-04-24
Last updated: 2026-04-24 (**M0 closed** — both reviewers passed
serially, every P0 + P1 + P2 finding resolved inline; ready to
begin M1)

## Current branch

`main` — per user 2026-04-24, working **directly on main** (no
initiative branch). Per-milestone commit; push only with explicit
user consent (AGENT_RULES rule 16).

## Active initiative

`.agent/runs/recording-inspection-implementation-v1/`

## Current milestone

**M5 closed; M6 next** — file loading UI + Stream Builder + Dark
Manager + warning banners (per spec.md W3 + W4 + flows F3/F4/F5/F14).

## Current focus

M5 close (this commit set):

- Rail tile + empty state + Sources skeleton + Stream header all
  shipped behind the `mantis/playback/enabled` localStorage feature
  flag (default OFF until M11 close per risk-skeptic P1-K).
- Eviction kind-routing fixed in `shared.tsx::apiFetch` and
  `app.tsx::onEvicted` (risk-skeptic P0-B).
- 4 new Tier 4 Playwright tests, all green; total 220 unit + 8
  web_smoke.
- Browser-verified in Claude Preview MCP: flag-off (no rail tile),
  flag-on (rail + empty state + Sources panel + Stream header all
  render with no console errors).

Next concrete actions for M6:

1. Wire `web/src/playback/api.ts::loadRecordingByPath` /
   `loadDarkByPath` to file picker (`onOpenFile` already plumbed).
2. Build `web/src/playback/StreamBuilder.tsx` (modal, W3 spec) —
   ordered file list with continuity badges, gap/overlap/exposure
   chips, threshold slider, Apply button.
3. Build `web/src/playback/DarkFrameRow.tsx` + dark-frame manager
   section in `SourcesPanel.tsx` — list, strategy picker, exposure
   match indicator.
4. Add inline warning banner (shows W-GAP / W-OVERLAP /
   W-EXP-MISMATCH chips on each FilePill, plus a "1 gap / 1
   exposure mismatch" summary in the SourcesPanel footer).
5. Tier 4 Playwright: load 3 synthetic recordings → Stream Builder
   auto-opens → Apply → workspace placeholder shows the new
   stream's totals.

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
- [ ] **M11** — Polish, a11y, responsive, perf, handoff routing, Storybook.
- [ ] **M12** — Final verification + visual-regression baselines + CI wiring.

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

## Final verification (filled at M12)

Gates (from QUALITY_GATES.md per-change-type table):

- [ ] Tier 0 — agent-doc consistency
- [ ] Tier 1 — imports (15 → 20 modules)
- [ ] Tier 2 — headless figures
- [ ] Tier 3 — FastAPI endpoints (incl. playback round-trip)
- [ ] Tier 4 — browser smoke (`pytest -m web_smoke`)
- [ ] Tier 5 — feature Playwright tests (workspace + handoff +
      ccm + visual)
- [ ] Tier 6 — visual regression baselines established + green
- [ ] Tier 7 — accessibility checklist (axe-core 0/0)
- [ ] Tier 8 — performance profile (parallelized export ≤ 8 s
      tiled-2×2 1080p MP4)
- [ ] pytest -q full suite green
- [ ] `npm run build` / `lint` / `typecheck` / `build-storybook`
      green
- [ ] CI matrix Tier 4/5/7 green on synthetic PR

Browser verification (see UI_VERIFICATION.md):

- [ ] App booted; mount verified
- [ ] Screenshots captured (light + dark + responsive sizes)
- [ ] Console error-free after interaction
- [ ] Network error-free after interaction
- [ ] Keyboard walk complete; Esc closes modals; focus return works
- [ ] Empty / loading / error / success states verified
- [ ] Exports verified

Reviewer findings:

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| (filled at close) | | | | |

Docs:

- [ ] ARCHITECTURE.md
- [ ] REPO_MAP.md
- [ ] SETUP_AND_RUN.md (if new install steps)
- [ ] WORKFLOWS.md
- [ ] QUALITY_GATES.md
- [ ] TOOLS_AND_SKILLS.md
- [ ] README.md
- [ ] manifest.yaml
- [ ] DECISIONS.md
- [ ] RISKS.md
- [ ] BACKLOG.md (deferrals)

State:

- [ ] Status.md — Progress updated
- [ ] HANDOFF.md — last updated, current state, next action
- [ ] CHANGELOG_AGENT.md — new entry
- [ ] git status -sb captured and consistent with docs

Honesty:

- [ ] Final response to user: what was verified, what wasn't, why.
