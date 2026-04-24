# .agent/ — MantisAnalysis operating layer

Everything a fresh agent needs to operate the repository without
tribal knowledge. Single source of truth for project intelligence.
Humans may read these docs; the primary audience is future coding
agents.

**Start at [`00_START_HERE.md`](00_START_HERE.md).** Everything else
is either context you consult or an action you take.

## Top-level index

| File | Kind | Purpose |
|---|---|---|
| [`00_START_HERE.md`](00_START_HERE.md) | entry | First-read file. Orientation + bootstrap. |
| [`README.md`](README.md) | index | This file. |
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | explain | 1-page product overview. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | explain | Layered view of the codebase. |
| [`REPO_MAP.md`](REPO_MAP.md) | explain | Every top-level path + what lives in it. |
| [`SETUP_AND_RUN.md`](SETUP_AND_RUN.md) | action | Exact commands to install, run, test. |
| [`WORKFLOWS.md`](WORKFLOWS.md) | action | End-to-end recipes per change class. |
| [`AGENT_RULES.md`](AGENT_RULES.md) | constraint | Non-negotiables. |
| [`TASK_PLAYBOOK.md`](TASK_PLAYBOOK.md) | action | Recipes for common task types. |
| [`QUALITY_GATES.md`](QUALITY_GATES.md) | constraint | Tier ladder + acceptance. |
| [`UI_VERIFICATION.md`](UI_VERIFICATION.md) | constraint | Browser-verification protocol. |
| [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) | constraint | Before-close checklist. |
| [`REFERENCES.md`](REFERENCES.md) | explain | External reference summaries (Anthropic, Playwright, WCAG). |
| [`DECISIONS.md`](DECISIONS.md) | log | Why the repo is the way it is. |
| [`RISKS.md`](RISKS.md) | log | Known minefields + mitigations. |
| [`BACKLOG.md`](BACKLOG.md) | log | Explicit work that remains. |
| [`HANDOFF.md`](HANDOFF.md) | state | Latest session handoff pointer. |
| [`TOOLS_AND_SKILLS.md`](TOOLS_AND_SKILLS.md) | inventory | What tooling is configured + how. |
| [`SESSION_BOOTSTRAP.md`](SESSION_BOOTSTRAP.md) | action | Shell cheat-sheet for session start. |
| [`CHANGELOG_AGENT.md`](CHANGELOG_AGENT.md) | log | What each agent session has done. |
| [`manifest.yaml`](manifest.yaml) | data | Machine-readable project summary. |
| [`settings.local.json`](settings.local.json) | config | Permission allowlist. |
| [`settings.local.README.md`](settings.local.README.md) | explain | Rationale for each allowlist entry. |
| [`launch.json`](launch.json) | config | Claude Preview MCP server config. |

## Sub-folders

| Folder | Purpose |
|---|---|
| [`agents/`](agents/) | 10 specialist reviewer briefs. See [`agents/README.md`](agents/README.md). |
| [`skills/`](skills/) | 17 reusable workflow skills. See [`skills/README.md`](skills/README.md). |
| [`templates/`](templates/) | `ExecPlan.md` + `Status.md` seed templates for new initiatives. |
| [`runs/`](runs/) | Active + archived initiatives. Each folder has `ExecPlan.md` + `Status.md`. `_archive/` for closed. |

## The three-tier context model

1. **Always-loaded** (short + critical): `CLAUDE.md` (root),
   `00_START_HERE.md`, `AGENT_RULES.md`, `HANDOFF.md`.
2. **On-demand reference** (consult when relevant): the `.md` files
   in this folder — architecture, quality gates, workflows, etc.
3. **Conditional workflow** (load per change class): `skills/*/SKILL.md`.
4. **Specialist review** (spawn per reviewer need): `agents/*.md`.

Keep the always-loaded tier short so future agents don't waste
context budget. Push detail into skills + agents + reference docs.

## Update rules (durable)

1. When workflow truth changes → update `00_START_HERE.md` +
   `AGENT_RULES.md` first.
2. When code truth changes → update `ARCHITECTURE.md` +
   `REPO_MAP.md` + `manifest.yaml`.
3. When a session ends → update `HANDOFF.md` + `CHANGELOG_AGENT.md`
   + the active initiative's `Status.md`.
4. When a decision is made that changes the plan → `DECISIONS.md`
   entry.
5. When a new risk is discovered → `RISKS.md` entry.
6. When work is identified but not done → `BACKLOG.md` entry.
7. When tooling is added, removed, or reconfigured →
   `TOOLS_AND_SKILLS.md` entry.

Full mapping: [`skills/docs-sync/SKILL.md`](skills/docs-sync/SKILL.md).

**Docs drift silently if you forget this. Tier 0 (`python scripts/smoke_test.py --tier 0`)
is the automated catch — run it on every session-start and before
every close.**
