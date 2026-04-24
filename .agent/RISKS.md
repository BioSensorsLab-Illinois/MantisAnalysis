# RISKS

Known minefields. Each entry has an ID, severity, evidence, and
mitigation. Append new risks as discovered.

---

## Open risks

### R-0005 — Sharpen-to-analysis can produce unphysical Michelson > 1  (severity: low)

**Where**: `mantisanalysis/image_processing.py` (Unsharp mask /
Laplacian / High-pass) + `mantisanalysis/usaf_groups.py:measure_modulation`.

**Symptom**: enabling `Apply sharpening to analysis` with Unsharp Amount
≥ 2 produces percentile-based Michelson values like `1.947` (LG-R smoke).
Mathematically the kernel makes the profile non-positive in spots, so
percentile values can give >1 ratios.

**Mitigation today**: status bar prints a heads-up when the toggle
flips on; values reported as-is to avoid hiding the user's choice.

**Trigger to reconsider**: if the user wants this clamped + warned,
record a DECISIONS entry and add the clamp to `measure_modulation`.

---

### R-0006 — Rotate / flip silently invalidates picks (severity: low)

**Where**: USAF / FPN / DoF mode panels in `web/src/*.jsx` —
each clears ROI / lines / points on rotation or flip; there is no
coordinate remap.

**Symptom**: a user who saves USAF lines JSON, re-opens later at a
different rotation, sees misaligned picks.

**Mitigation**: TBD. Could either (a) re-map coordinates through
the rotation automatically, or (b) refuse to load a JSON whose
`transform.rotation` doesn't match the current view. `B-0007`.

---

### R-0009 — `session.STORE` LRU eviction is silent to the frontend  (severity: medium)

**Where**: `mantisanalysis/session.py` — `STORE` is an LRU(12).
When the 13th source is loaded, the oldest is evicted.

**Symptom**: the React frontend keeps a cached `source_id` in
localStorage. After eviction, any `/api/*/compute|measure|analyze`
call with that id returns 404, but the React layer has no
notification channel to flush caches.

**Mitigation today**: reload the page recovers. Users don't often
load > 12 sources per session in practice.

**Trigger to reconsider**: if users report "my session lost sources"
frequently, surface 410 Gone on the server + frontend listener that
drops the cached id.

---

### R-0010 — ISP reconfigure mid-analysis can strand results  (severity: low)

**Where**: `session.reconfigure_isp(...)` auto-detaches incompatible
dark frames and re-extracts `raw_frame` → new channel dict. Any
open analysis modal that was computing against the previous
channels has stale results.

**Symptom**: the modal shows "detection limit ≥ 11.3 lp/mm" based on
channels that no longer exist.

**Mitigation today**: modal close + re-run is the user recovery.

**Trigger to reconsider**: add an event-channel (SSE / WebSocket
or poll) so React can invalidate mode state on reconfig.

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

### R-0004 — Dead code import path: `mantisanalysis/extract.py:split_and_extract` (severity: low)

**Where**: `mantisanalysis/extract.py:112-117`.

**Symptom**: function is exported but never called. Harmless, but a
fresh agent can spend time tracing why it exists.

**Mitigation**: covered by ruff (`F841` etc.) in CI. Slated for
removal when the next math change touches the module.

---

## New risks added during agentic-workflow-overhaul-v1

### R-0014 — Prose-only enforcement leaves escape hatches (severity: medium)

**Where**: `AGENT_RULES.md` rule 3 (browser verification),
rule 14 (independent review), rule 15 (stopping criteria);
`STOPPING_CRITERIA.md`; `UI_VERIFICATION.md`;
`skills/independent-review-loop/SKILL.md`.

**Symptom**: every enforcement in the new harness is a *convention
documented in markdown* — not a mechanical hook or CI gate. The only
mechanical gates today are `scripts/check_agent_docs.py` (Tier 0) +
the four smoke tiers. An agent that doesn't read the docs (or reads
them and decides to skip) can:

- Edit `web/src/*.jsx` and declare done without a browser render.
- Declare an initiative complete without invoking reviewer subagents.
- Write "STOPPING_CRITERIA satisfied" without running the 16-item
  checklist.
- Self-edit `.agent/settings.local.json` to add permissive entries.

**Mitigation today**: `docs-handoff-curator` review at close catches
most of these post-hoc; `risk-skeptic` adversarial pass surfaces the
rest. The Tier 0 scanner catches stale docs.

**Trigger to reconsider**: if any of the above is observed in
practice → install the hooks tracked in `B-0022` / `B-0023` /
`B-0024` / `B-0025` / `B-0026`. Those convert prose gates into
mechanical ones.

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
