# .agent/ — MantisAnalysis operating layer

This folder holds everything a fresh agent needs to operate the
repository without tribal knowledge. It is the single source of truth
for project intelligence. Humans should also read it, but its primary
audience is future coding agents.

**Start with `00_START_HERE.md`.** Everything else is either an
explanation you consult or an action you take.

## File index

| File | Kind | Purpose |
|---|---|---|
| `00_START_HERE.md` | entry | First-read file. Orientation + bootstrap. |
| `README.md` | index | This file. |
| `PROJECT_BRIEF.md` | explain | 1-page product overview. |
| `ARCHITECTURE.md` | explain | Layered view of the codebase. |
| `REPO_MAP.md` | explain | Every top-level path + what lives in it. |
| `SETUP_AND_RUN.md` | action | Exact commands to install, run, test. |
| `WORKFLOWS.md` | action | End-to-end recipes per change class. |
| `AGENT_RULES.md` | constraint | Non-negotiables. |
| `TASK_PLAYBOOK.md` | action | Recipes for common task types. |
| `QUALITY_GATES.md` | constraint | Smoke tiers + acceptance criteria. |
| `DECISIONS.md` | log | Why the repo is the way it is. |
| `RISKS.md` | log | Known minefields + mitigations. |
| `BACKLOG.md` | log | Explicit work that remains. |
| `HANDOFF.md` | state | Latest session handoff pointer. |
| `TOOLS_AND_SKILLS.md` | inventory | What tooling is configured + how. |
| `SESSION_BOOTSTRAP.md` | action | Copy-paste session-start commands. |
| `CHANGELOG_AGENT.md` | log | What each agent session has done. |
| `manifest.yaml` | data | Machine-readable project summary. |

## Sub-folders (initiative & skill system)

| Folder | Purpose |
|---|---|
| `skills/` | Repo-local reusable skill files — YAML-frontmatter markdown. |
| `templates/` | `ExecPlan.md` + `Status.md` seed templates for new initiatives. |
| `runs/` | Active + archived initiatives. Each folder has `ExecPlan.md` + `Status.md`. `_archive/` for closed. |

## Update rules (durable)

1. When workflow truth changes → update `00_START_HERE.md` + `AGENT_RULES.md` first.
2. When code truth changes → update `ARCHITECTURE.md` + `REPO_MAP.md` + `manifest.yaml`.
3. When a session ends → update `HANDOFF.md` + `CHANGELOG_AGENT.md` + the active initiative's `Status.md`.
4. When a decision is made that changes the plan → `DECISIONS.md` entry.
5. When a new risk is discovered → `RISKS.md` entry.
6. When work is identified but not done → `BACKLOG.md` entry.
7. When tooling is added, removed, or reconfigured → `TOOLS_AND_SKILLS.md` entry.

**Docs drift silently if you forget this. Don't forget.**
