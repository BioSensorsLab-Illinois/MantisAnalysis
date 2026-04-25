# RISKS

Known minefields. Each entry has an ID, severity, evidence, and
mitigation. Append new risks as discovered.

---

## Open risks

### R-0017 — Playback video encode is single-process; cancel granularity is "one frame" (severity: low)

**Where**: `mantisanalysis/playback_api.py::export_video::_run`
runs the encoder in a `threading.Thread`; `cancel_event` is a
`multiprocessing.Event` that acts as a thread-shared flag.
`playback_export.write_video` does not poll the event inside
`imageio_ffmpeg.write_frames` — only between frames yielded by
the inner generator. So a cancel mid-mp4-flush still produces a
file (which we then `unlink(missing_ok=True)` per risk-skeptic A2),
but the user sees ~1 frame of latency between Cancel click and the
encoder noticing.

**Mitigation**: documented honestly in the modules' docstrings.
Track in B-0029 (`playback-multiproc-v1`) — when scale-out lands,
swap `multiprocessing.Event()` for `Manager().Event()` and route
through `ProcessPoolExecutor`.

### R-0018 — Playback feature flag is OFF by default (severity: low — intentional)

**Where**: `mantis/playback/enabled` localStorage key, default
absent → mode hidden. Per risk-skeptic P1-K (M0). Without the
flag, the rail tile + `4` keyboard shortcut + ⌘K Playback entry
are all hidden.

**Mitigation**: document in README + intend to flip in B-0032
once UX polish (B-0030) and per-cell perf (B-0035..B-0037) land.
Not a real risk; flagged for visibility.

### R-0019 — Visual baselines on disk; no CI diff yet (severity: low)

**Where**: `tests/web/test_playback_visual_baselines.py` writes 5
PNGs to `.agent/runs/recording-inspection-implementation-v1/
screenshots/` per run. CI uploads them as an artifact (`smoke.yml`
M12 edit). Diff against a committed baseline is **not** wired —
visual regressions ship silently.

**Mitigation**: track in B-0038
(`visual-regression-infra-v1`). Today the baselines are review
evidence, not a regression gate.

### R-0005 — Sharpen-to-analysis can produce unphysical Michelson > 1 (severity: low — **CLOSED 2026-04-24 via correctness-sweep-v1**)

**Where**: `mantisanalysis/usaf_groups.py::measure_modulation_5pt`
was the last path without the [0,1] clamp; `michelson()` and
`measure_modulation_fft` already clamped.

**Resolution**: added `m = max(0.0, min(1.0, m))` to the 5-point
estimator at the end. All four Michelson-variant estimators now
clamp consistently. Regression tests at
`tests/unit/test_michelson.py::test_five_point_michelson_clamped_to_unit_interval`
and `test_five_point_michelson_non_negative_profile_unchanged`.

---

### R-0006 — Rotate / flip silently invalidates picks (severity: low — **CLOSED 2026-04-24 via correctness-sweep-v1**)

**Where**: USAF / FPN / DoF mode panels in `web/src/*.jsx`.

**Resolution**: investigation showed the React SPA uses
`transform: rotate(...)` as a CSS-level canvas transform — picks
stored in image-pixel coords stay co-located with the image across
rotation because both rotate in the same transformed frame. The
original concern predated the Qt→React rewrite (Qt did pixel-level
rotation that genuinely invalidated coords). Closed alongside
B-0007 with no code change required.

---

### R-0009 — `session.STORE` LRU eviction is silent to the frontend (severity: medium — **CLOSED 2026-04-24 via correctness-sweep-v1**)

**Where**: `mantisanalysis/session.py` — `STORE` is an LRU(12).

**Resolution**: `SessionStore` now tracks evicted ids in a bounded
FIFO buffer (`_evicted`, cap 64). `server.py::_must_get` returns
**410 Gone** for known-evicted ids and **404 Not Found** for never-
existed ids. `web/src/shared.jsx::apiFetch` dispatches a
`mantis:source-evicted` custom event on 410; `app.jsx` listens,
clears the cached source + analysis, and auto-loads the sample.
Regression tests: `tests/unit/test_session_eviction.py` (3 tests).

---

### R-0010 — ISP reconfigure mid-analysis can strand results (severity: low — **CLOSED 2026-04-24 via correctness-sweep-v1**)

**Where**: `session.reconfigure_isp(...)` auto-detaches incompatible
dark frames; the React analysis modal cached a run under the
pre-reconfigure channel dict.

**Resolution**: `app.jsx` now derives a stable `ispEpoch` from the
source's `isp_mode_id` + serialized `isp_config` and clears the
`analysis` state (the cache behind `<AnalysisModal>`) via `useEffect`
when the epoch changes. User sees a warning toast: "ISP reconfigured
— analysis cache cleared; re-run Analyze for fresh results." No
polling or SSE needed — the reconfigure flow already calls
`setSource(updated)` which drives the effect.

---

### R-0011 — Playwright fonts + anti-aliasing differ CI vs local  (severity: low)

**Where**: any future visual-regression baseline in `tests/web/`.

**Symptom**: `expect(locator).to_have_screenshot(...)` fails in CI
because the chromium font stack renders text slightly differently
than on the developer's machine.

**Mitigation today**: no visual-regression baselines exist yet.
First initiative to adopt must document the mitigation (bundle
fonts, container-pinned chromium, or CI-regenerated baselines).

**Trigger to reconsider**: when `analysis-page-overhaul-v1` Phase 7
introduces the first baseline.

---

### R-0012 — dom-to-image export has CORS + canvas composite traps  (severity: low)

**Where**: `web/src/analysis.jsx` + shared export helpers. Current
export path uses `dom-to-image-more`.

**Symptom**: Google-Fonts-linked stylesheets break the rasterization
due to CORS; canvas + SVG composites mis-align at certain zoom levels.

**Mitigation today**: `renderChartToPng` + `renderNodeToPng` in
`shared.jsx` (Phase 1 of analysis-page-overhaul-v1) replace
dom-to-image for the SVG path. Migration to all charts pending
Phase 4/5.

**Trigger to reconsider**: already under active mitigation; watch
for new edge cases as more charts migrate.

---

### R-0013 — Docs drift can re-appear if Tier 0 is skipped (severity: medium)

**Where**: `.agent/*.md`, `CLAUDE.md`, `AGENTS.md`, `manifest.yaml`.

**Symptom**: after a large refactor, stale references (PySide/Qt,
removed scripts, renamed modules) re-appear in docs.

**Mitigation today**: `scripts/check_agent_docs.py` (Tier 0) catches
the common patterns. Session-start skill runs it.

**Trigger to reconsider**: if drift keeps slipping through, install
a `PostToolUse` hook on `Edit(.agent/*.md)` to run Tier 0
automatically.

---

## Closed / historical risks

<!-- qt-allowed: The Qt-era risks are preserved as history of why the current architecture exists. All closed by D-0009 (Qt removal) and D-0014 (plotting.py hoist). -->

### R-0001 — Widget classes duplicated  (severity: medium — **CLOSED 2026-04-22 via D-0009**)

**Was**: `scripts/pick_lines_gui.py` `Card` / `slider_row` /
`ImageCanvas` duplicated against `mantisanalysis/modes/common.py`.

**Closed**: The Qt layer + `mantisanalysis/modes/` were deleted in
D-0009; the React SPA + FastAPI layers have no equivalent
duplication today.

### R-0002 — Sidebar overflow regressions (severity: medium — **CLOSED 2026-04-22 via D-0009**)

**Was**: `QScrollArea` sidebar in the Qt mode panels had to use
`setHorizontalScrollBarPolicy(ScrollBarAsNeeded)` +
`setMinimumWidth(180)` + `body.setMinimumWidth(0)`; silent regression
if any dropped.

**Closed**: Qt sidebar is gone. React mode panels have no analogous
regression today; responsive layout is checked via
[`UI_VERIFICATION.md`](UI_VERIFICATION.md) § 8.

### R-0003 — `USAFPickerApp` is a `QMainWindow` embedded via monkey-patch (severity: medium — **CLOSED 2026-04-22 via D-0009**)

**Closed**: The Qt embed + monkey-patch path no longer exists.

### R-0007 — `dof_render` reaches into `fpn_render` private helpers (severity: low — **CLOSED 2026-04-23 via D-0014**)

**Closed**: `mantisanalysis/plotting.py` now owns `_color`, `_ch`,
`_style_axes`, `CHANNEL_COLORS`. Both `dof_render` and `fpn_render`
import from there; no cross-reach.

### R-0008 — Rename husk: empty `rgbnir-analysis/` folder (severity: cosmetic — **CLOSED**)

**Closed**: Windows artifact from the original robocopy rename.
User to delete manually; not repo-visible.

<!-- /qt-allowed -->

---

### R-0004 — Dead code import path: `mantisanalysis/extract.py:split_and_extract` (severity: low — **CLOSED 2026-04-24 via correctness-sweep-v1**)

**Resolution**: function removed from `extract.py`; the single
test (`test_split_and_extract_returns_hg_lg_tuple`) removed from
`tests/unit/test_bayer.py`. No production callers existed; the
ISP-mode machinery (`extract_by_spec`) subsumed the use case.

---

## New risks added during agentic-workflow-overhaul-v1

### R-0014 — Prose-only enforcement leaves escape hatches (severity: medium — **MITIGATED 2026-04-24**)

**Where**: `AGENT_RULES.md` rule 3 (browser verification),
rule 14 (independent review), rule 15 (stopping criteria);
`STOPPING_CRITERIA.md`; `UI_VERIFICATION.md`;
`skills/independent-review-loop/SKILL.md`.

**Symptom**: every enforcement in the new harness was originally a
*convention documented in markdown* — not a mechanical hook or CI
gate. An agent that doesn't read the docs could edit `web/src/*.jsx`
and declare done without a browser render, write "STOPPING_CRITERIA
satisfied" without running the checklist, or self-edit
`.agent/settings.local.json`.

**Mitigation (2026-04-24 via `harness-mechanical-v1`)**:

- **Tier 0 extended** with three new scanners:
  `check_stopping_criteria.py` (parses "Final verification" blocks
  in Status.md and fails on untied gates),
  `check_reviewer_evidence.py` (requires `.agent/runs/<slug>/reviews/*.md`
  files to back every "Reviewer findings" table entry), and
  `check_skill_frontmatter.py`.
- **Claude Code hooks** in `.agent/settings.json`:
  - `PostToolUse` on `Edit|Write(web/src/**/*.jsx)` writes a marker;
    `Stop` hook nudges if no screenshot postdates it (B-0022).
  - `PreCompact` hook runs `snapshot_session.sh` to append branch /
    HEAD / dirty-file snapshot to the active Status.md (B-0025).
  - `PreToolUse` on `Edit|Write(.agent/settings.local.json)` warns
    before any permission edit (B-0026).

**Residual gap**: hooks are soft nudges + markers, not hard blocks.
A determined agent can still ignore stderr warnings and skip the
browser. The nudge makes silent bypass visible in the session
transcript, which is enough friction to surface the issue at review
time but doesn't physically prevent it. A harder-blocking hook model
is tracked as a future enhancement — raise severity back to medium
if silent bypass is ever observed in practice.

**Trigger to reconsider**: if any agent in practice silently bypasses
the new gates → promote the Stop hook from nudge to block,
or require reviewer evidence files as a prerequisite to tool
invocation.

### R-0015 — Reviewers run in the same context as the implementer (severity: low)

**Where**: `skills/independent-review-loop/SKILL.md`.

**Symptom**: today reviewers are *briefs*, not live subagents. The
implementing agent prompts `general-purpose` with the brief pasted
in — same context window, same biases. Real independence requires
either the harness-level `subagent_type` wiring or out-of-band
invocation. A reviewer that shares the implementer's blind spots
misses findings the implementer would miss.

**Mitigation today**: keep reviewer prompts self-contained; require
the reviewer to cite `file:line` rather than relying on implementer
claims.

**Trigger to reconsider**: when Claude Code custom-subagent auto-
discovery reaches the harness; migrate the briefs to the live
subagent shape so each reviewer runs in a fresh context.

### R-0016 — historical-allowlist block abuse is mitigated by scanner cap + review, not mechanically forbidden (severity: low)

**Where**: `scripts/check_agent_docs.py` + the 73 scanned docs.

**Symptom**: an agent wrapping a non-historical doc in the
historical-allowlist marker pair (see `scripts/check_agent_docs.py`)
and writing fresh references to the pre-D-0009 UI would pass the
scan. The scanner caps region size (2000 lines / 95% of file, with
explicit exemptions for known append-only logs under
`QT_ALLOW_EXEMPT_FILES` / `QT_ALLOW_EXEMPT_DIRS`) — but a 1500-line
PROJECT_BRIEF rewrite would slip.

**Mitigation today**: every allowlist open / close is visible in
commit diffs; `docs-handoff-curator` review catches abuse.

**Trigger to reconsider**: if silent abuse is ever observed, tighten
the exemption set or require explicit per-file budget in a
`.agent/qt-allowed-budget.yaml`.
