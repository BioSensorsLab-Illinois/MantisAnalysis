# agentic-workflow-overhaul-v1 — ExecPlan

Opened: 2026-04-24
Branch: `main` (treated as a meta-initiative — no product-code edits; pure
agent-harness surgery. Will still be delivered as a discrete commit set
after all phases land.)
Owner: agent, acting on explicit user request to "substantially improve
the repository's agentic operating layer under `.agent/` before
implementing any new product feature."

## 1. Goal

Upgrade the current `.agent/` layer into a robust, self-verifying,
long-horizon agentic workflow system for the **current** React + FastAPI
MantisAnalysis app — fix the stale PySide/Qt drift, add specialist
subagents, reusable skills, browser/UI verification, independent review
loop, stopping criteria, and context-handoff protocol strong enough to
run large unsupervised feature work (next up: H5 recording-inspection
feature) without hallucinating completion.

<!-- qt-allowed: The audit sections below enumerate Qt-era drift being fixed by this initiative. Historical references are preserved as evidence; the audit is what justifies the rewrite. -->

## 2. Why (evidence from the audit)

1. **Docs describe a stack that doesn't exist any more.** `PROJECT_BRIEF`
   says "PySide6/Qt-6 desktop application"; `SETUP_AND_RUN` names
   `scripts/pick_lines_gui.py` and `PySide6 ≥ 6.5`; `WORKFLOWS` § E is
   Qt QScrollArea + QSS; `TASK_PLAYBOOK` references `QMainWindow`
   subclassing; `QUALITY_GATES` Tier 3 is titled "Qt boot";
   `TOOLS_AND_SKILLS` lists `pytest-qt` and `qt-ui-edit` skills;
   `SESSION_BOOTSTRAP` routes UI edits to `scripts/pick_lines_gui.py`;
   `manifest.yaml` has `ui_toolkit: "PySide6 / Qt 6"` and lists
   `scripts/pick_lines_gui.py` + `mantisanalysis/modes/*.py`. None of
   those files or modules exist in the tree any more
   (D-0009 / D-0014 deleted them).

2. **Browser-verification gates are absent** from the canonical smoke
   tiers despite the UI being the primary surface. Tier 4 is a
   placeholder. Playwright smoke (`tests/web/test_web_boot.py`) exists
   but is opt-in + invisible in the workflow docs.

3. **No specialist review loop.** `AGENT_RULES` encourages independent
   review but there is no codified way to invoke one — no
   `.agent/agents/` folder, no reviewer briefs, no merge rule for
   findings.

4. **Skills folder is empty** (`.agent/skills/.gitkeep` only). The
   conditional workflow knowledge lives entirely in long .md files that
   have to be re-read every session.

5. **No explicit stopping criteria.** Agents can (and historically
   have) declared "done" after Tier 1+2 pass with no browser check, no
   reviewer pass, and no P0/P1 resolution discipline.

6. **Missing context-compaction rule.** When the main model compacts
   or hands off, there's no protocol for preserving
   "active initiative + current milestone + modified files + next
   concrete action + open findings".

7. **No long-running autonomous workflow.** The current ruleset is
   single-session oriented. Larger projects need milestone-based
   execution with per-milestone reviewer passes and deterministic
   resume points.

## 3. Scope (in)

Pure `.agent/` / `.claude/` / `CLAUDE.md` / `scripts/` infrastructure
work:

- **Fix drift.** Update every doc that still describes the Qt desktop
  app so it reflects FastAPI + React 18 SPA truth, OR mark a section
  explicitly "Historical (pre-D-0009)".
- **Add specialist subagents** under `.agent/agents/` (minimum 10 from
  spec).
- **Add reusable skills** under `.agent/skills/` (minimum 17 from spec),
  each a `SKILL.md` with frontmatter + concrete workflow.
- **Add `CLAUDE.md` at repo root** — short, delegates to
  `.agent/00_START_HERE.md`, includes the context-compaction protocol.
- **Add `.agent/UI_VERIFICATION.md`** — browser/UI verification
  protocol (screenshots, console, network, keyboard, responsive,
  locators).
- **Add `.agent/STOPPING_CRITERIA.md`** — strict exit checklist before
  declaring major work complete.
- **Add `.agent/REFERENCES.md`** — curated notes from Anthropic
  "Building effective agents" + Claude Code best practices + Playwright
  + RTL + Storybook + WCAG, cited + summarized (do not copy full text).
- **Rewrite `.agent/QUALITY_GATES.md`** with the 9-tier ladder
  (Tier 0 docs-consistency → Tier 8 performance) + per-change-type
  mandatory-tier table.
- **Rewrite `.agent/WORKFLOWS.md`** with React / FastAPI / H5 / viz /
  export / accessibility / performance / dependency / CI / session
  workflows — remove Qt workflow or archive it under an explicit
  `Archived — pre-D-0009` heading.
- **Rewrite `.agent/TASK_PLAYBOOK.md`** with React/FastAPI-first
  recipes; drop Qt mode-add recipe; add: new FastAPI endpoint, new
  React tab/panel, new Pydantic schema, new Playwright test, new ISP
  mode, new H5 fixture, dependency add.
- **Rewrite `.agent/TOOLS_AND_SKILLS.md`** — current React/FastAPI
  tooling status + tools to consider (Playwright, axe, Storybook,
  Vite, pre-commit, gh, Preview MCP, React Profiler) each with Status,
  Why, Setup, When to use, Verification, Risks/costs.
- **Update `.agent/AGENT_RULES.md`** — remove Qt-specific rule clauses;
  add: browser-verification-required-for-UI, independent-review-loop,
  stopping-criteria-required, context-compaction-protocol,
  long-running-autonomous-workflow.
- **Update `.agent/ARCHITECTURE.md`** — drop the Qt invariants #4 (Theme
  dict) + #5 (QScrollArea); replace with React invariants (channel
  schema on both sides, single-source-of-truth on FastAPI, no bundler,
  localStorage keys under `mantis/`).
- **Update `.agent/REPO_MAP.md`** — remove `scripts/pick_lines_gui.py`
  + `mantisanalysis/modes/` lines (they don't exist); add
  `mantisanalysis/isp_modes.py`, `web/src/isp_settings.jsx`, current
  tests tree.
- **Update `.agent/PROJECT_BRIEF.md`** — rewrite intro: "FastAPI +
  React 18 browser-based analysis suite …".
- **Update `.agent/SETUP_AND_RUN.md`** — remove PySide6 mention, add
  Playwright opt-in instructions, document `--no-browser` and `--port`,
  troubleshooting for the browser path.
- **Update `.agent/SESSION_BOOTSTRAP.md`** — remove Windows-only path;
  use `pwd` / relative path; update the UI-edit routing table.
- **Update `.agent/manifest.yaml`** — `ui_toolkit: "React 18 (Babel
  standalone via CDN) + FastAPI"`, correct module list, correct
  entry-points (no `pick_lines_gui.py`), correct commands, add
  `web_smoke` and `check_docs` gates.
- **Update `.agent/RISKS.md`** — close R-0001 / R-0002 / R-0003 /
  R-0007 / R-0008 (all Qt-specific, fixed or obsolete); add new risks:
  context drift across long sessions, Playwright browser-install cost,
  dom-to-image CORS, localStorage schema change, session-store LRU
  eviction mid-analysis.
- **Add `scripts/check_agent_docs.py`** — Tier-0 consistency checker
  that scans `.agent/*.md` for the blocklist regex
  `(PySide6|QMainWindow|QWidget|QScrollArea|QSS|pick_lines_gui)` and
  exits non-zero if any line matches outside explicit
  "Archived — pre-D-0009" blocks. Also verifies that every command
  mentioned in `SETUP_AND_RUN.md` exists as a file the shell could
  resolve (scripts / Python modules).
- **Extend `scripts/smoke_test.py` with `--tier 0`** — runs
  `scripts/check_agent_docs.py` as a pass/fail gate, so the workflow
  overhaul can live behind the same ladder.
- **Update `.agent/settings.local.json`** — add allowlist for routine
  verification commands (smoke tiers, pytest -q, ruff check, mypy,
  check_agent_docs) with inline rationale comments in a sibling
  `settings.local.README.md`. Do not allow destructive / push /
  deploy / broad-fs commands.
- **Upgrade `.agent/templates/ExecPlan.md` + `Status.md`** with the
  richer structure from the user spec (UI/UX impact, verification
  agents to invoke, per-milestone screenshots, reviewer findings).
- **Update `.agent/HANDOFF.md` + `CHANGELOG_AGENT.md`** on close —
  one-line entry per the standard close-out rule.

## 4. Out of scope

- **The H5 recording-inspection feature.** The user explicitly said
  "do not implement H5 recording-inspection yet. This task is about
  making the agent workflow strong enough to safely implement that
  feature later."
- Any `mantisanalysis/*.py` analysis-math or server-route edit.
- Any `web/src/*.jsx` edit.
- Any test edit under `tests/` (new Playwright workflow tests are the
  *next* initiative, not this one).
- Migrating the frontend off CDN Babel to Vite. Mentioned in
  TOOLS_AND_SKILLS as "recommended, not yet triggered".
- Installing Storybook / axe. Recommended in TOOLS_AND_SKILLS but
  gated on B-0014's bundler decision.
- Adding a GitHub Actions job for browser-smoke CI. Recommended but
  deferred — Playwright's chromium download is ~300 MB and CI cost
  needs a user decision.

## 5. Architecture impact

None on product code. Delivers:

- `.agent/agents/` (new directory with 10 `.md` subagent briefs)
- `.agent/skills/` (17 `SKILL.md` files in subfolders)
- `.agent/UI_VERIFICATION.md` (new)
- `.agent/STOPPING_CRITERIA.md` (new)
- `.agent/REFERENCES.md` (new)
- `CLAUDE.md` at repo root (new, short)
- `scripts/check_agent_docs.py` (new)
- `scripts/smoke_test.py` patched for `--tier 0`
- `.agent/settings.local.README.md` (new)
- Every other `.agent/*.md` rewritten or updated for React/FastAPI
  truth.

## 6. UI/UX impact

None direct. The new agent harness *enforces* UI/UX discipline on
future work: no UI change may ship without browser verification (Tier
4+), an accessibility check (Tier 7), and a `react-ui-ux-reviewer` +
`playwright-verifier` pass.

## 7. Backend / API impact

None direct. The new agent harness enforces that every FastAPI route
change passes Tier 3 smoke + a `fastapi-backend-reviewer` pass.

## 8. Data-model impact

None.

## 9. Test strategy

- **Agent-harness self-test.** `scripts/check_agent_docs.py` is the
  Tier-0 gate; it catches re-introduced Qt drift and broken
  `SETUP_AND_RUN.md` commands at any future session boot.
- **No product-code tests are added or modified.** Tier 1 + Tier 2 +
  Tier 3 + pytest must stay green at every commit of this initiative
  (verifies we haven't broken the build through harness changes).
- **Dry-run the new workflow.** After the initial pass lands, invoke
  `docs-handoff-curator`, `risk-skeptic`, `playwright-verifier`,
  `react-ui-ux-reviewer`, `test-coverage-reviewer` on the harness
  itself and resolve findings.

## 10. Verification agents to invoke (at close)

- **docs-handoff-curator** — every doc updated; no PySide/Qt residue
  outside archived blocks; HANDOFF + CHANGELOG + Status + manifest all
  consistent.
- **risk-skeptic** — adversarial read of the new workflow: can an
  agent bypass browser verification, skip stopping criteria, or
  self-certify a UI change? If yes, tighten.
- **playwright-verifier** — does `UI_VERIFICATION.md` actually
  demand what Playwright best-practices call for (user-facing locators,
  web-first assertions, screenshot on failure, no arbitrary waits)?
- **react-ui-ux-reviewer** — does the `react-browser-ui-change` skill
  include empty/loading/error states, keyboard nav, responsive sanity,
  focus-states, and a visual inspection step?
- **test-coverage-reviewer** — do the new quality gates cover unit +
  API + browser + visual + a11y + performance slices?

## 11. Milestones

- [ ] **M0 — Initiative scaffold (this file + Status.md).** *Done when
      both files exist and commit a snapshot-free audit summary.*
- [ ] **M1 — Agents.** `.agent/agents/` populated with 10 specialist
      subagent briefs. Each has frontmatter, purpose, when-to-invoke,
      allowed tools, inputs, outputs, severity rubric.
- [ ] **M2 — Skills.** `.agent/skills/` populated with 17 reusable
      `SKILL.md` files. Each has frontmatter + 1-page concrete
      workflow.
- [ ] **M3 — New infra docs.** `UI_VERIFICATION.md`,
      `STOPPING_CRITERIA.md`, `REFERENCES.md`, `settings.local.README.md`,
      root `CLAUDE.md`.
- [ ] **M4 — Rewrite core docs for React/FastAPI.** `00_START_HERE`,
      `AGENT_RULES`, `PROJECT_BRIEF`, `SETUP_AND_RUN`, `SESSION_BOOTSTRAP`,
      `WORKFLOWS`, `QUALITY_GATES`, `TASK_PLAYBOOK`, `TOOLS_AND_SKILLS`,
      `ARCHITECTURE` invariants, `REPO_MAP`, `RISKS`, `manifest.yaml`.
- [ ] **M5 — Tier-0 consistency check.** `scripts/check_agent_docs.py`
      ships; `scripts/smoke_test.py --tier 0` wired; passes locally.
- [ ] **M6 — Templates.** `templates/ExecPlan.md` + `Status.md`
      upgraded with UI/UX impact, verification agents, per-milestone
      screenshot checklist, reviewer-findings table, stop/resume notes.
- [ ] **M7 — Permissions.** `settings.local.json` expanded with
      routine safe verification commands; accompanying
      `settings.local.README.md` explains each rationale.
- [ ] **M8 — Self-verification.** Run `smoke --tier 0 1 2 3` +
      `pytest -q`; all green. Spawn reviewer agents; resolve P0/P1
      findings.
- [ ] **M9 — Close-out.** Update `HANDOFF.md`, `CHANGELOG_AGENT.md`,
      `DECISIONS.md` (record D-0015 "agent-harness overhaul"),
      archive this initiative under `.agent/runs/`. (Commit only if
      user asks; no auto-push.)

## 12. Acceptance criteria

- [ ] `python scripts/smoke_test.py --tier 0` passes (enforces the
      stale-Qt-reference scan + manifest-path existence + command
      resolvability in one gate).
- [ ] `python scripts/smoke_test.py --tier 0` passes.
- [ ] `python scripts/smoke_test.py --tier 1` passes.
- [ ] `python scripts/smoke_test.py --tier 2` passes.
- [ ] `python scripts/smoke_test.py --tier 3` passes.
- [ ] `python -m pytest -q` stays at 40+ green.
- [ ] `.agent/agents/` has ≥ 10 specialist subagent briefs.
- [ ] `.agent/skills/` has ≥ 17 `SKILL.md` files.
- [ ] `.agent/UI_VERIFICATION.md` exists and is linked from
      `00_START_HERE.md` + `WORKFLOWS.md` + `QUALITY_GATES.md`.
- [ ] `.agent/STOPPING_CRITERIA.md` exists and is linked from
      `AGENT_RULES.md`.
- [ ] `CLAUDE.md` at repo root exists, is under 150 lines, and points
      to `.agent/00_START_HERE.md`.
- [ ] `.agent/manifest.yaml` lists only files that exist on disk.
- [ ] Reviewer findings resolved or documented with severity + deferral
      rationale.
- [ ] `HANDOFF.md` + `CHANGELOG_AGENT.md` updated.

## 13. Risks

| ID | Risk | Mitigation |
|---|---|---|
| W-1 | Adding skills / agents without live harness wiring = cargo culting. | Each file must have a concrete *when-to-invoke* + *allowed tools* + *output contract*. Cross-reference from at least one WORKFLOWS or QUALITY_GATES entry. |
| W-2 | Deleting Qt references from docs could erase useful historical context. | Keep a `.agent/ARCHITECTURE.md`-appended *Archived: pre-D-0009 Qt era* section with a paragraph summary + pointer to D-0009. |
| W-3 | `scripts/check_agent_docs.py` false-positives on legitimate Qt history notes. | Allow explicit allowlist block markers: `<!-- qt-allowed -->` / `<!-- /qt-allowed -->` pairs. |
| W-4 | Bloat — .agent doubles in size, agents stop reading. | Keep `00_START_HERE.md` + `AGENT_RULES.md` + `CLAUDE.md` short; push detail into skills that load on demand. |
| W-5 | Permission allowlist too broad — agent runs destructive commands. | Whitelist only exact command strings (no regex, no wildcards); every entry has a rationale in `settings.local.README.md`. |
| W-6 | Subagent definitions use YAML frontmatter fields that don't match the Claude Code subagent spec. | Use the minimum-viable subset (name + description + tools) and document any non-standard fields as internal convention. |

## 14. Rollback plan

All edits are to `.agent/`, `CLAUDE.md`, `scripts/check_agent_docs.py`,
`scripts/smoke_test.py` (extending, not replacing, Tier 0). If the new
harness causes friction, revert with a single `git revert` on this
initiative's commit series — no product code touched.

## 15. Decisions

Recorded in `.agent/DECISIONS.md` on close:

- **D-0015** — agent-harness overhaul: React/FastAPI truth, specialist
  subagents, reusable skills, stopping criteria, Tier-0 docs gate.

<!-- /qt-allowed -->

## 16. Final verification checklist (executed at M9)

- [ ] Tier 0 / 1 / 2 / 3 smoke all green.
- [ ] pytest -q all green (40+).
- [ ] `scripts/check_agent_docs.py` returns 0.
- [ ] `docs-handoff-curator` reviewer invoked; P0/P1 findings resolved.
- [ ] `risk-skeptic` reviewer invoked; P0/P1 findings resolved.
- [ ] `playwright-verifier` reviewer invoked; P0/P1 findings resolved.
- [ ] `react-ui-ux-reviewer` reviewer invoked; P0/P1 findings resolved.
- [ ] `test-coverage-reviewer` reviewer invoked; P0/P1 findings resolved.
- [ ] `git status -sb` lists only this initiative's files.
- [ ] `HANDOFF.md` + `CHANGELOG_AGENT.md` + `DECISIONS.md` updated.
- [ ] Final response to user enumerates changes, reviewer findings,
      and remaining deferrals with explicit rationale.
