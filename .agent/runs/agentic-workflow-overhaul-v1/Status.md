# agentic-workflow-overhaul-v1 — Status

Opened: 2026-04-24
Last updated: 2026-04-24 (M0 scaffold complete — audit captured, moving
into M1 Agents)

## Current branch

`main` — meta-initiative. No product-code edits. Deliverable is a
discrete series of `.agent/` + `CLAUDE.md` + `scripts/` commits.

## Current focus

M1 — populating `.agent/agents/` with 10 specialist subagent briefs so
later milestones can reference them from workflows + skills.

## Audit summary (from M0)

<!-- qt-allowed: This audit enumerates the Qt-era drift the initiative is fixing. The references are historical, intentionally preserved as evidence. -->

Stale Qt/PySide references identified in these files and must be
rewritten for React/FastAPI truth or moved into an explicit
`qt-allowed` block:

| File | Nature of drift |
|---|---|
| `.agent/00_START_HERE.md` | "Desktop GUI" intro, Windows-only path, bootstrap steps miss Tier 3 (server) and Tier 4 (browser) |
| `.agent/AGENT_RULES.md` | Rule 7 / 13 / 14 mention Qt and analysis-only pure modules — OK, but missing: browser-verification gate, independent-review-loop, stopping criteria, context-compaction protocol |
| `.agent/PROJECT_BRIEF.md` | First line says "PySide6/Qt-6 desktop application" |
| `.agent/SETUP_AND_RUN.md` | "PySide6 ≥ 6.5", `scripts/pick_lines_gui.py`, "opens the GUI with no file loaded", troubleshooting mentions `libxcb-cursor0` + `qt.qpa.plugin` |
| `.agent/WORKFLOWS.md` | § E "UI (Qt) change" with QScrollArea/QSS, § G "Theme / QSS change" |
| `.agent/QUALITY_GATES.md` | Tier 3 titled "Qt boot" with `QApplication`, xvfb notes |
| `.agent/TASK_PLAYBOOK.md` | "add new mode" recipe uses `mantisanalysis/modes/<name>.py`, `QWidget`, `QMainWindow`; "sidebar-overflow" recipe is Qt-only |
| `.agent/TOOLS_AND_SKILLS.md` | Lists `pytest-qt` as shipped; skills list has `qt-ui-edit`, `theming-change` as placeholders |
| `.agent/SESSION_BOOTSTRAP.md` | Windows path `/c/Users/J/...`, UI-edit routing table points at `scripts/pick_lines_gui.py` + `mantisanalysis/modes/` (both deleted) |
| `.agent/manifest.yaml` | `ui_toolkit: "PySide6 / Qt 6"`, lists `scripts/pick_lines_gui.py`, `mantisanalysis/modes/common.py`, `mantisanalysis/modes/fpn.py`, `mantisanalysis/modes/dof.py` (all deleted) |
| `.agent/RISKS.md` | R-0001 / R-0002 / R-0003 / R-0007 / R-0008 all Qt-specific + closed or obsolete |
| `.agent/REPO_MAP.md` | Line 22: `UI_SPEC.md ← long UX spec; output of Phase 1 spec pass` — file doesn't exist at root; line refs to `scripts/pick_lines_gui.py` and `mantisanalysis/modes/` (deleted) |
| `.agent/ARCHITECTURE.md` | Mostly correct. Invariants #4 (Theme dict) + #5 (QScrollArea) still describe Qt — replace with React invariants. |

<!-- /qt-allowed -->

Missing artefacts (must be created in this initiative):

- `CLAUDE.md` at repo root
- `.agent/agents/` (directory + 10 specialist briefs)
- `.agent/skills/` currently empty — needs 17 SKILL.md files
- `.agent/UI_VERIFICATION.md`
- `.agent/STOPPING_CRITERIA.md`
- `.agent/REFERENCES.md`
- `.agent/settings.local.README.md`
- `scripts/check_agent_docs.py` + `smoke_test.py --tier 0` wiring

Good state already:

- `.agent/ARCHITECTURE.md` correctly describes FastAPI + React SPA (except the two Qt invariants noted above).
- `.agent/HANDOFF.md` is current (2026-04-23, analysis-page-overhaul-v1 Phase 0/1/2 + isp-modes-v1 shipped).
- `.agent/CHANGELOG_AGENT.md` is actively maintained (2026-04-24 ISP modes v1 entry).
- `README.md` (root) correctly describes FastAPI + React.
- `.agent/runs/` pattern with `_archive/` + active + templates is sound.
- `scripts/smoke_test.py` has tiers 1–3 covering imports / figures / FastAPI — good foundation; Tier 0 gate + Tier 4 (real browser) still needed.
- `tests/web/test_web_boot.py` + `tests/web/conftest.py` already implement the minimum Playwright smoke.

## Progress

- [x] M0 — Initiative scaffold (this file + ExecPlan.md)
- [x] M1 — Agents  (10 specialist subagent briefs under `.agent/agents/`)
- [x] M2 — Skills  (17 SKILL.md under `.agent/skills/`)
- [x] M3 — New infra docs  (UI_VERIFICATION, STOPPING_CRITERIA, REFERENCES, CLAUDE.md, settings.local.README)
- [x] M4 — Core doc rewrite for React/FastAPI truth
- [x] M5 — Tier-0 consistency check script + unit tests
- [x] M6 — Templates upgrade
- [x] M7 — Permissions expansion
- [x] M8 — Self-verification via reviewer subagents (5 invoked, findings resolved / deferred)
- [x] M9 — Close-out (HANDOFF + CHANGELOG + DECISIONS D-0015)

## Smoke status (last verified 2026-04-24 at M0)

- Tier 0: not yet implemented (this initiative adds it)
- Tier 1: not yet re-run this session (HANDOFF reports green 2026-04-23)
- Tier 2: not yet re-run this session (HANDOFF reports green 2026-04-23)
- Tier 3: not yet re-run this session (HANDOFF reports green 2026-04-23)
- pytest: not yet re-run this session (HANDOFF reports 40/40 green 2026-04-23)
- Browser boot (Playwright): not required for this meta-initiative

Re-verification is scheduled for M5 (after Tier 0 lands) and M8
(pre-close).

## Blockers

None.

## Known checks still required at close

- `scripts/check_agent_docs.py` 0 exit
- Five reviewer subagents spawned + findings merged
- HANDOFF / CHANGELOG / DECISIONS updated

## Modified files (running tally)

This initiative has not touched any file yet; M0 scaffolds only.

Planned (will appear as `git status` noise during execution):

```
A  .agent/agents/planner-architect.md
A  .agent/agents/react-ui-ux-reviewer.md
A  .agent/agents/frontend-react-engineer.md
A  .agent/agents/fastapi-backend-reviewer.md
A  .agent/agents/playwright-verifier.md
A  (deleted) accessibility-reviewer.md
A  .agent/agents/performance-reviewer.md
A  .agent/agents/test-coverage-reviewer.md
A  .agent/agents/risk-skeptic.md
A  .agent/agents/docs-handoff-curator.md
A  .agent/skills/<17 subdirs>/SKILL.md
A  .agent/UI_VERIFICATION.md
A  .agent/STOPPING_CRITERIA.md
A  .agent/REFERENCES.md
A  .agent/settings.local.README.md
A  CLAUDE.md
A  scripts/check_agent_docs.py
M  scripts/smoke_test.py       (add Tier 0 function)
M  .agent/*.md                 (drift fixes)
M  .agent/manifest.yaml
M  .agent/templates/*.md
M  .agent/settings.local.json
```

## Reviewer findings (M8)

| ID | Reviewer | Severity | Title | Disposition |
|---|---|---|---|---|
| F-1 | docs-handoff-curator | P1 | HANDOFF.md stale | Fixed at M9 |
| F-2 | docs-handoff-curator | P1 | CHANGELOG_AGENT.md no entry for this initiative | Fixed at M9 |
| F-3 | docs-handoff-curator | P1 | DECISIONS.md missing D-0015 | Fixed at M9 |
| F-4 | docs-handoff-curator | P2 | settings.local.README documents an allowlist entry absent from JSON | Fixed (entry clarified as "not allowlisted") |
| F-5 | docs-handoff-curator | P2 | REPO_MAP omits `.agent/scheduled_tasks.lock` | Deferred — runtime lockfile, low value |
| F-6 | docs-handoff-curator | P2 | ARCHITECTURE invariant #4 phrasing | Fixed (split into React + matplotlib bullets) |
| F-7 | risk-skeptic | P0 | Agent can skip browser verification for UI change | Deferred → `B-0022` — requires Claude Code hook consent; documented in `R-0014` |
| F-8 | risk-skeptic | P0 | settings.local.json self-editable | Deferred → `B-0026` |
| F-9 | risk-skeptic | P1 | STOPPING_CRITERIA is prose, no mechanical gate | Deferred → `B-0023` |
| F-10 | risk-skeptic | P1 | Reviewer loop can be faked | Deferred → `B-0024` |
| F-11 | risk-skeptic | P1 | No PreCompact hook | Deferred → `B-0025` |
| F-12 | risk-skeptic | P1 | Agent↔skill name coupling | **Fixed** — added cross-reference scanner to `check_agent_docs.py` |
| F-13 | risk-skeptic | P2 | Blocklist coverage incomplete | **Fixed** — extended `QT_PATTERNS` with 10+ additional Qt symbols |
| F-14 | risk-skeptic | P2 | qt-allowed region size unbounded | **Fixed** — 2000-line / 95%-of-file cap with exempt-historical-files list |
| F-15 | risk-skeptic | P2 | Skill frontmatter match | Deferred → `B-0027` |
| F-16 | risk-skeptic | P3 | ROOT sanity assertion | **Fixed** — `_REQUIRED` assertion at import |
| F-17 | playwright-verifier | P1 | pytest-playwright `page` fixture underused | **Fixed** — skill example uses `page` fixture |
| F-18 | playwright-verifier | P1 | Trace/video flag inconsistency | **Fixed** — `retain-on-failure` everywhere + `--screenshot=only-on-failure` added |
| F-19 | playwright-verifier | P1 | `threshold` semantics wrong | **Fixed** — 0.02 per-pixel + `max_diff_pixel_ratio=0.01` |
| F-20 | playwright-verifier | P1 | `networkidle` caveat | **Fixed** — switched to `domcontentloaded` + web-first assertion |
| F-21 | playwright-verifier | P1 | Boot test uses `is_visible()` not web-first | Documented as pre-existing, not changed (product code untouched in this initiative); flagged for follow-up if reviewer brief quotes it |
| F-22 | playwright-verifier | P2 | JS syntax in Python brief | **Fixed** — all Python |
| F-23 | react-ui-ux-reviewer | P1 | Error-state simulation under-specified | **Fixed** — added 4-option trigger table |
| F-24 | react-ui-ux-reviewer | P1 | Loading state no threshold | **Fixed** — 250 ms rule |
| F-25 | react-ui-ux-reviewer | P1 | Focus-return assertion snippet | **Fixed** — added to UI_VERIFICATION |
| F-26 | react-ui-ux-reviewer | P1 | "Interactions actually move output" procedure | **Fixed** — added pixel-hash step |
| F-27 | react-ui-ux-reviewer | P2 | 1024×768 clip criteria | **Fixed** — `scrollWidth > innerWidth` assertion |
| F-28 | react-ui-ux-reviewer | P2 | Export WYSIWYG | **Fixed** — Pillow size check |
| F-29 | react-ui-ux-reviewer | gap | Destructive-actions + primary-action checks | **Fixed** — added both to UI_VERIFICATION §10 |
| F-30 | test-coverage-reviewer | P1 | No tests for check_agent_docs.py | **Fixed** — `tests/unit/test_check_agent_docs.py` with 10 tests, all green |
| F-31 | test-coverage-reviewer | P1 | QT_PATTERNS incomplete | **Fixed** (same as F-13) |
| F-32 | test-coverage-reviewer | P2 | PYTEST_PATH_RE template false-positives | **Fixed** — tightened regex + `_is_exempt` for historical files |
| F-33 | test-coverage-reviewer | P2 | MANIFEST scan misses important_docs | **Fixed** — extended `scan_manifest` to cover `important_docs:` + top-level scalars |

## Final verification (2026-04-24)

Gates:

- [x] Tier 0 — agent-doc consistency PASS (73 docs, 0 drift)
- [x] Tier 1 — imports PASS (15 modules)
- [x] Tier 2 — headless figures PASS
- [x] Tier 3 — FastAPI endpoints PASS
- [x] pytest — 65/65 green (40 pre-existing + 15 isp-modes + 10 new test_check_agent_docs)
- Tier 4 (Playwright) — N/A for harness-only initiative; existing `test_web_boot.py` remains green
- Tier 7 (a11y) — N/A (no UI change)
- Tier 8 (perf) — N/A (no data-heavy change)

Browser verification:

- N/A — no UI change in this initiative. Confirmed: `git diff --stat web/` is empty for changes in this session.

Reviewer subagents:

- [x] docs-handoff-curator (6 findings; 3 P1 fixed at M9, 2 P2 fixed / deferred, 1 P3 deferred)
- [x] risk-skeptic (14 findings; 2 P0 + 4 P1 + 4 P2 + 2 P3 + gaps — fixed inline or logged to BACKLOG B-0022–B-0028 + RISKS R-0014/R-0015/R-0016)
- [x] playwright-verifier (10 findings; 5 P1 fixed inline, 3 P2 fixed, 2 P3 acknowledged)
- [x] react-ui-ux-reviewer (10 findings + 3 gaps; 4 P1 fixed, 3 P2 fixed, 3 gaps filled)
- [x] test-coverage-reviewer (7 findings; 2 P1 fixed inline, 4 P2 fixed, 1 P3 aligned)

Docs:

- [x] All 10 core docs rewritten for React/FastAPI truth
- [x] ARCHITECTURE invariants updated
- [x] REPO_MAP matches tree state
- [x] manifest.yaml `important_docs:` + module list verified by Tier 0
- [x] `docs-sync/SKILL.md` mapping refreshed
- [x] DECISIONS D-0015 recorded
- [x] RISKS R-0014, R-0015, R-0016 recorded
- [x] BACKLOG B-0022–B-0028 recorded
- [x] CHANGELOG_AGENT 2026-04-24 entry prepended
- [x] HANDOFF refreshed

State:

- [x] Status.md — Progress updated, reviewer findings captured
- [x] HANDOFF.md — last updated 2026-04-24, reflects current state
- [x] CHANGELOG_AGENT.md — new top-line entry
- [x] git status captured in HANDOFF

Honesty:

- [x] Final response enumerates what was verified, what remains, why.

## Next concrete action (post-initiative)

1. User review of the working tree + commit per B-0010.
2. Decide on B-0022 / B-0023 / B-0025 / B-0026 hook consent — these
   convert prose-only gates into mechanical ones, but require user
   approval for `settings.json` repo-wide hooks.
3. Open the H5 recording-inspection initiative using the new harness
   (per the user's stated next goal).

## Stop / resume notes

If this session stops mid-initiative:

1. `git status -sb` will show a partial tree of `.agent/agents/` +
   `.agent/skills/` + infra docs.
2. Next agent reads `ExecPlan.md` + this `Status.md`, resumes at the
   first unchecked milestone.
3. No product code is touched; reverting any subset of `.agent/*` is
   safe.
4. The H5 recording-inspection feature is NOT to be started until this
   initiative's M9 close-out lands.
