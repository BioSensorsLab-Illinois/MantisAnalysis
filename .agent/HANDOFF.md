# HANDOFF — current live state pointer

Last updated: **2026-04-24**, end of `agentic-workflow-overhaul-v1`
full shipment (Claude Opus 4.7, 1M context).

## Current state of the working tree

- Branch: `main`.
- This session landed a substantial meta-initiative (pure harness
  work — zero product-code changes). Working tree is **not yet
  committed**; awaiting user review per B-0010 explicit-consent
  push gate.

## What just shipped (agentic-workflow-overhaul-v1)

The agent operating layer under `.agent/` was rebuilt top to bottom
to match the current **FastAPI + React 18** stack. Every stale
reference to the pre-D-0009 desktop-Qt layer either became
React/FastAPI prose or was moved inside an explicit historical-
allowlist block (see `scripts/check_agent_docs.py` for the marker
syntax). New infrastructure landed: specialist reviewer subagents,
reusable workflow skills, stopping-criteria protocol,
UI-verification protocol, context-compaction protocol, and a
mechanical Tier-0 drift scanner.

Full summary of the 9 milestones is at
`.agent/CHANGELOG_AGENT.md` 2026-04-24 entry. Decisions in
`DECISIONS.md` D-0015. Risks surfaced in `RISKS.md` R-0014, R-0015,
R-0016. Deferred hook-enforcement work at `BACKLOG.md` B-0022–B-0028.

### Files created

- `CLAUDE.md` (root — short entry + compaction protocol).
- `.agent/agents/` (10 subagent briefs + README).
- `.agent/skills/` (17 SKILL.md files + README).
- `.agent/UI_VERIFICATION.md`.
- `.agent/STOPPING_CRITERIA.md`.
- `.agent/REFERENCES.md`.
- `.agent/settings.local.README.md`.
- `.agent/runs/agentic-workflow-overhaul-v1/{ExecPlan,Status}.md`.
- `scripts/check_agent_docs.py` (Tier-0 drift scanner).
- `tests/unit/test_check_agent_docs.py` (10 unit tests).

### Files rewritten / extensively updated

- `.agent/00_START_HERE.md`, `AGENT_RULES.md`, `PROJECT_BRIEF.md`,
  `SETUP_AND_RUN.md`, `SESSION_BOOTSTRAP.md`, `WORKFLOWS.md`,
  `QUALITY_GATES.md`, `TASK_PLAYBOOK.md`, `TOOLS_AND_SKILLS.md`,
  `REPO_MAP.md`, `RISKS.md`, `README.md` (of `.agent/`).
- `.agent/ARCHITECTURE.md` — invariants #4/#5/#6/#7 updated.
- `.agent/manifest.yaml` — full module + commands + gates refresh.
- `.agent/templates/ExecPlan.md` + `Status.md` — richer structure.
- `.agent/DECISIONS.md` — D-0015 entry.
- `.agent/RISKS.md` — R-0014, R-0015, R-0016.
- `.agent/BACKLOG.md` — B-0022–B-0028.
- `.agent/CHANGELOG_AGENT.md` — 2026-04-24 top entry.
- `.agent/settings.local.json` — expanded routine-safe allowlist.
- `scripts/smoke_test.py` — `tier0()` function + `--tier 0` CLI.

## Smoke status, last verified 2026-04-24

- ✅ Tier 0 — check_agent_docs 73 docs OK (0 drift)
- ✅ Tier 1 — PASS (15 modules imported)
- ✅ Tier 2 — PASS (figures written to `outputs/smoke/`)
- ✅ Tier 3 — PASS (FastAPI TestClient exercises health + sample +
  thumbnail + USAF measure + FPN compute + DoF compute + analyze)
- ✅ pytest — 65/65 green (40 pre-existing + 15 isp-modes v1 + 10
  new `test_check_agent_docs`)

## Quick verification for the next agent

```bash
cd "$(git rev-parse --show-toplevel)"
python scripts/smoke_test.py --tier 0
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
python scripts/smoke_test.py --tier 3
python -m pytest -q
python -m mantisanalysis --no-browser &    # real uvicorn boot
curl http://127.0.0.1:8765/api/health
```

## Active initiative

None. `.agent/runs/agentic-workflow-overhaul-v1/` is complete (M0
through M9 all ticked). Ready to archive under
`.agent/runs/_archive/` on user say-so (or keep in `runs/` so
future readers can see it without archaeology).

The previously-active `.agent/runs/analysis-page-overhaul-v1/` is
still at Phase 2 done / Phase 3 next — it was paused by this
meta-initiative, not closed. Consult its `Status.md` to resume.

## Where to pick up next

1. **User review + commit** — this session's working tree is
   extensive (~30 new files + ~15 modified). User should skim the
   diff before committing. No push without explicit B-0010 consent.
2. **H5 recording-inspection feature** — the next product
   initiative per the user's ask. With the new harness, open via
   `skills/execplan-large-feature/SKILL.md` and use the workflow
   skills (`h5-io-data-pipeline-change`, `fastapi-api-change`,
   `react-browser-ui-change`, `visualization-canvas-image-pipeline`)
   + reviewer loop per `skills/independent-review-loop/SKILL.md`.
3. **analysis-page-overhaul-v1 Phase 3** — unified
   `<AnalysisModal>` shell. Paused; resume via its `Status.md`.
4. **Claude Code hook consent (B-0022 / B-0025 / B-0026)** — the
   `risk-skeptic` pass surfaced gaps that prose-only enforcement
   can't close. Installing hooks would convert them to mechanical
   gates. User decision + consent required (hooks affect every
   qualifying tool call).
5. **B-0023 `check_stopping_criteria.py`** — mechanical stopping-
   criteria enforcement; ~1 session. Blocks only on the time to do
   it.
6. **B-0010** — first `git push -u origin main` is still the
   explicit consent gate. 11+ commits are queued unpushed.
7. **B-0018** — real-sample validation; blocked on H5 captures.
8. **B-0014** — Vite / bundler migration; attractive after
   `analysis-page-overhaul-v1` Phase 3's subtree lands.

## Known dirty files

Extensive. Summary (`git status -sb` will show full list):

```
M  .agent/CHANGELOG_AGENT.md
M  .agent/BACKLOG.md
M  .agent/DECISIONS.md
M  .agent/HANDOFF.md
M  .agent/RISKS.md
M  .agent/ARCHITECTURE.md
M  .agent/00_START_HERE.md
M  .agent/AGENT_RULES.md
M  .agent/PROJECT_BRIEF.md
M  .agent/README.md
M  .agent/REPO_MAP.md
M  .agent/SETUP_AND_RUN.md
M  .agent/SESSION_BOOTSTRAP.md
M  .agent/WORKFLOWS.md
M  .agent/QUALITY_GATES.md
M  .agent/TASK_PLAYBOOK.md
M  .agent/TOOLS_AND_SKILLS.md
M  .agent/manifest.yaml
M  .agent/settings.local.json
M  .agent/templates/ExecPlan.md
M  .agent/templates/Status.md
M  .agent/runs/gui-rewrite-v1/ExecPlan.md
M  .agent/runs/gui-rewrite-v1/Status.md
M  .agent/runs/backlog-cleanup-v1/ExecPlan.md
M  scripts/smoke_test.py
??  CLAUDE.md
??  .agent/UI_VERIFICATION.md
??  .agent/STOPPING_CRITERIA.md
??  .agent/REFERENCES.md
??  .agent/settings.local.README.md
??  .agent/agents/
??  .agent/skills/ (17 subdirs)
??  .agent/runs/agentic-workflow-overhaul-v1/
??  scripts/check_agent_docs.py
??  tests/unit/test_check_agent_docs.py
```

Plus the pre-existing modifications from the `isp-modes-v1` + prior
initiatives (untouched by this session): `mantisanalysis/*.py`,
`web/src/*.jsx`, `tests/unit/test_isp_*.py`, `tests/web/*.py`.

## Residual risks / open questions for the user

1. **Prose-only enforcement** (`RISKS.md R-0014`): every new gate
   in this overhaul is documented in markdown. An agent that
   skips the docs can bypass them. Closing this requires Claude
   Code hook consent. See `BACKLOG.md` B-0022 / B-0025 / B-0026.
2. **`settings.local.json` self-edit** (`BACKLOG.md B-0026`): the
   file is agent-editable by default. Mitigation hooks need user
   consent.
3. **Same-context reviewers** (`RISKS.md R-0015`): reviewers today
   are briefs loaded into `general-purpose` subagents from the
   same session. Real independence needs harness-level
   `subagent_type` wiring.
4. **Historical initiatives still in `runs/`** — `gui-rewrite-v1`,
   `fpn-rewrite-v1`, `dof-rewrite-v1`, `backlog-cleanup-v1`,
   `analysis-polish-v1`, `plot-style-completion-v1`, `isp-modes-v1`,
   `analysis-page-overhaul-v1`. User decision: archive under
   `_archive/` or leave in `runs/` for discoverability.
