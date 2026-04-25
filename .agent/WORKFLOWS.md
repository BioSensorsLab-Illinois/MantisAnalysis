# WORKFLOWS

End-to-end recipes per common change class. Each ends with the
relevant smoke gates + reviewer pass. For the expanded per-skill
procedures, see [`skills/`](skills/).

## A. Session start

See [`SESSION_BOOTSTRAP.md`](SESSION_BOOTSTRAP.md) +
[`skills/session-start/SKILL.md`](skills/session-start/SKILL.md).

TL;DR: read CLAUDE.md + HANDOFF, run Tier 0 + 1 + 2 + 3 + pytest,
pick up the active initiative or scope a new one.

## B. Non-trivial work (> 3 files) — open an initiative

See [`skills/execplan-large-feature/SKILL.md`](skills/execplan-large-feature/SKILL.md).

```bash
slug=<topic>-v1
mkdir -p .agent/runs/$slug
cp .agent/templates/ExecPlan.md .agent/runs/$slug/ExecPlan.md
cp .agent/templates/Status.md   .agent/runs/$slug/Status.md
git checkout -b $slug
```

Invoke [`planner-architect`](agents/planner-architect.md) before major
surgery; [`risk-skeptic`](agents/risk-skeptic.md) to surface failure
modes.

## C. Analysis-math change (pure NumPy/SciPy)

Example: a new Michelson estimator.

1. Edit `mantisanalysis/<module>_analysis.py` or `usaf_groups.py`.
2. **Never import server, React, FastAPI, or Qt in these modules.**
   Per `AGENT_RULES.md` rule 7.
3. Add or extend a unit test under `tests/unit/`.
4. `python -m pytest tests/unit/ -q`.
5. Tier 1 + Tier 2 smoke.
6. If you added new dataclass fields: extend
   `tests/headless/test_figures.py` so render modules still render.
7. Update `ARCHITECTURE.md` if a key invariant changed.

## D. Figure-builder change (`*_render.py`, `plotting.py`, `figures.py`)

See [`skills/visualization-canvas-image-pipeline/SKILL.md`](skills/visualization-canvas-image-pipeline/SKILL.md).

1. Edit the relevant `*_render.py` or `plotting.py` helper.
2. Theme-aware: pass `fig_face` + `text` kwargs through. Preserve
   `plotting.CHANNEL_COLORS` as the single channel-color source.
3. Tier 2 smoke and visually inspect PNGs in `outputs/smoke/`.
4. Tier 3 smoke (if `figures.py` builders are exercised — they are).
5. Update `tests/headless/test_figures.py` if the builder contract
   changed.

## E. React UI change (`web/src/*.jsx`)

See [`skills/react-browser-ui-change/SKILL.md`](skills/react-browser-ui-change/SKILL.md)
+ [`UI_VERIFICATION.md`](UI_VERIFICATION.md).

Mandatory: browser render + screenshot + console + network + keyboard
+ responsive + theme, then Playwright update, then reviewer pass.

1. Edit the component.
2. Tier 1 + Tier 2 smoke (Python side still works).
3. Boot `python -m mantisanalysis --no-browser --port 8765`.
4. Use Claude Preview MCP (`preview_start`, `preview_screenshot`,
   `preview_console_logs`, `preview_network`, `preview_click`,
   `preview_resize`) to render, interact, verify.
5. Capture screenshots (light + dark + responsive widths).
6. Update / add a Playwright test under `tests/web/`.
7. `pytest -m web_smoke -q`.
8. Invoke [`react-ui-ux-reviewer`](agents/react-ui-ux-reviewer.md)
   + [`playwright-verifier`](agents/playwright-verifier.md).
9. For substantial UI: also
   [`performance-reviewer`](agents/performance-reviewer.md).

## F. FastAPI route / schema / session change

See [`skills/fastapi-api-change/SKILL.md`](skills/fastapi-api-change/SKILL.md).

1. Edit `server.py` / `session.py` / `figures.py`.
2. Precise Pydantic models; actionable `HTTPException` details.
3. Tier 1 + Tier 2 + Tier 3 smoke.
4. Add a unit test under `tests/unit/test_<route>.py` asserting the
   new shape.
5. Update every React consumer of the changed route:
   `grep -n "api/<route>" web/src/*.jsx`.
6. Tier 4 browser smoke if the frontend contract changed.
7. Update `ARCHITECTURE.md` "Analysis response shape" table.
8. Invoke [`fastapi-backend-reviewer`](agents/fastapi-backend-reviewer.md).

## G. H5 / data-pipeline change (`image_io.py`, `extract.py`, `isp_modes.py`)

See [`skills/h5-io-data-pipeline-change/SKILL.md`](skills/h5-io-data-pipeline-change/SKILL.md).

1. Respect AGENT_RULES rules 5 + 6 (GSense constants + channel schema
   are locked).
2. Use synthetic fixtures for new tests; never commit real H5.
3. Add / extend `tests/unit/test_bayer.py` or a new
   `tests/unit/test_<feature>.py`.
4. Tier 1 + Tier 2 + Tier 3 smoke.
5. Spot-check with a real recording in the browser preview on the
   lab workstation.
6. Update `ARCHITECTURE.md` Channel schema invariant if anything
   changed.

## H. ISP-mode addition or change

Subset of G.

1. Add / edit entries in `mantisanalysis/isp_modes.py` registry.
2. Unit test under `tests/unit/test_isp_modes.py`.
3. Integration: `tests/unit/test_isp_override.py` + Tier 3 smoke
   covers `/api/isp/modes` + reconfigure path.
4. Update `ARCHITECTURE.md` + `README.md` "Channel layout" if a new
   channel slot appeared.
5. Invoke [`risk-skeptic`](agents/risk-skeptic.md) — reconfigure
   mid-analysis is a classic edge case.

## I. Export / visualization pipeline change

See [`skills/visualization-canvas-image-pipeline/SKILL.md`](skills/visualization-canvas-image-pipeline/SKILL.md).

1. Edit the relevant `*_render.py`, `plotting.py`, or React chart
   component.
2. Verify numerical correctness (unit test) before visual polish.
3. Verify in browser: on-screen matches exported PNG (WYSIWYG).
4. Verify export at all relevant DPIs.
5. Verify theme switch doesn't invalidate the export.

## J. Theme / token change (`shared.jsx::THEMES`, `DEFAULT_PLOT_STYLE`)

1. Touch both light + dark palettes.
2. For new plotStyle tokens, wire through `tokens(style)` in
   `shared.jsx`.
3. Browser-verify both themes on every mode.
4. Live-render a sample of every mode and capture screenshots for the
   record.

## K. Packaging / dependency change

See [`skills/dependency-change/SKILL.md`](skills/dependency-change/SKILL.md).

1. Update `pyproject.toml [project.dependencies]` or optional-extra
   group.
2. `pip install -e .[dev]` → succeeds.
3. Tier 0–3 smoke.
4. Record in `DECISIONS.md` for non-trivial deps.
5. Update `TOOLS_AND_SKILLS.md` row.

## L. CI change (`.github/workflows/`)

1. Tier 1 leg mandatory on all platforms (Ubuntu, macOS, Windows) × Python 3.10–3.13.
2. Tier 2 runs on Linux (Agg — no display).
3. Tier 3 runs in-process — cheap.
4. Tier 4 (Playwright) not yet wired (chromium ~300 MB). When wired,
   gate it behind a manual workflow dispatch until budget's
   approved.
5. Validate with `yq eval '.jobs' .github/workflows/smoke.yml` or
   a commit-and-watch cycle.

## M. Release / tag

See [`TASK_PLAYBOOK.md`](TASK_PLAYBOOK.md) § Release.

## N. Ending a session

See [`skills/context-handoff/SKILL.md`](skills/context-handoff/SKILL.md)
+ [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md).

Update HANDOFF + active Status + CHANGELOG + DECISIONS + RISKS +
BACKLOG (as relevant), then (optionally) commit.

## O. Independent multi-agent verification loop

See [`skills/independent-review-loop/SKILL.md`](skills/independent-review-loop/SKILL.md).

Spawn reviewers per change-type table; consolidate findings into
Status.md; resolve P0/P1 before close.

## Long-running autonomous work

For extended unsupervised runs, all workflows above apply plus:

1. **Always** create an initiative for large work.
2. Work milestone by milestone. After each:
   - Update `Status.md`.
   - Run relevant local checks.
   - Record failures + fixes.
   - Keep "Next concrete action" specific.
3. **Before major surgery**:
   - Ask `planner-architect` for plan review.
   - Ask `risk-skeptic` for failure modes.
4. **After implementation**:
   - Ask `test-coverage-reviewer`.
   - Ask `playwright-verifier` for UI/browser work.
   - Ask `react-ui-ux-reviewer` for user-facing UI work.
   - Ask `accessibility-reviewer` for substantial UI changes.
   - Ask `performance-reviewer` for data/visualization/export changes.
   - Ask `docs-handoff-curator` before the final response.
5. **Do not self-certify.** Resolve every P0/P1 finding or document
   explicit deferral per [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md).
6. **Context compaction**: preserve
   branch + initiative + milestone + modified files + passing gates +
   failing gates + open findings + next concrete action before the
   session context gets compacted. See
   [`skills/context-handoff/SKILL.md`](skills/context-handoff/SKILL.md).
