---
name: docs-sync
description: Which docs to update when which kind of change lands. Enforces the "every non-doc change updates docs" rule without becoming performative.
when_to_use:
  - any non-trivial code change
  - before closing any initiative
  - after a review finding that surfaces doc drift
outputs:
  - consistent docs — no file contradicts another
  - no dead references (paths, commands, functions)
  - Status.md reflects what was touched
related_agents: docs-handoff-curator
---

# docs-sync

## When to use

Per `AGENT_RULES.md` rule 8: "Every non-doc change updates docs."

This skill is the *map* — which doc to touch for which kind of code
change.

## The mapping

| Change | Primary doc | Secondary docs |
|---|---|---|
| New FastAPI route | `ARCHITECTURE.md` "Analysis response shape" | `README.md` curl examples; manifest.yaml |
| New Pydantic schema field | `ARCHITECTURE.md` | — |
| New channel key | `AGENT_RULES.md` rule 6 (would require user approval first); `ARCHITECTURE.md` invariant #3; `README.md` channel layout table |
| New React mode | `ARCHITECTURE.md` Web GUI section; `REPO_MAP.md` tree; manifest.yaml |
| New React component (shared primitive) | `ARCHITECTURE.md` if it changes the layered view; otherwise leave |
| New analysis math module | `ARCHITECTURE.md` layer; `REPO_MAP.md`; manifest.yaml; new test file |
| New ISP mode | `ARCHITECTURE.md` Web GUI section; `README.md` channel layout if new channel; `RISKS.md` if it weakens an invariant; `DECISIONS.md` entry |
| New dependency | `pyproject.toml`; `TOOLS_AND_SKILLS.md` row; `SETUP_AND_RUN.md` if install changed; `DECISIONS.md` why added |
| Dropped / removed code | `REPO_MAP.md`; manifest.yaml; `ARCHITECTURE.md` if the box is gone; `CHANGELOG_AGENT.md` |
| Renamed file / function | Every reference in `.agent/` + `README.md` + cross-project imports |
| New CLI flag on `mantisanalysis` | `SETUP_AND_RUN.md`; `README.md`; `manifest.yaml commands` |
| New entry point | `pyproject.toml [project.scripts]`; `SETUP_AND_RUN.md`; manifest.yaml |
| New skill | `.agent/skills/<slug>/SKILL.md`; `.agent/skills/README.md` roster |
| New agent | `.agent/agents/<slug>.md`; `.agent/agents/README.md` roster |
| New smoke tier | `scripts/smoke_test.py`; `QUALITY_GATES.md`; manifest.yaml `quality_gates` |
| Session ended | `HANDOFF.md`; active initiative's `Status.md`; `CHANGELOG_AGENT.md` |
| Architecture change | `ARCHITECTURE.md`; `DECISIONS.md`; `REPO_MAP.md`; manifest.yaml |
| New risk discovered | `RISKS.md`; cross-reference from affected `AGENT_RULES.md` / workflow |
| Risk closed / obsolete | `RISKS.md` mark "CLOSED <date>"; leave for history |
| New backlog item | `BACKLOG.md` with `B-000N` |
| Item completed | `BACKLOG.md` mark "CLOSED <date>"; cross-reference the initiative |

## The anti-performative rule

Don't update a doc that doesn't need updating. Each doc change must
correspond to a real change in the code or the ops model. A
tick-the-box-looking doc update is worse than no update because it
masks real drift.

If a reviewer says "update the docs" and you find nothing relevant to
update, say so in the response. That's a legitimate outcome.

## Cross-reference integrity

After a change, scan for dead references:

```bash
# Every .agent/*.md link target exists
grep -rEho '\[.*\]\([^)]+\)' .agent/ | grep -oE '\([^)]+\)' | tr -d '()' | sort -u | while read -r t; do [ -e "$t" ] || echo "DEAD: $t"; done

# Every file:line reference still has a relevant line
grep -rE '[a-zA-Z0-9_/.-]+\.(py|jsx|md):[0-9]+' .agent/ | while read -r line; do …; done
```

(Lightweight versions — `scripts/check_agent_docs.py` enforces the
sharper checks for Tier 0.)

## Doc update etiquette

- Make the update in the same commit as the code change that
  motivates it. Separate doc-only commits are fine if you're sweeping
  drift, but never land code without the matching doc.
- Keep doc sentences short. Long paragraphs turn into multi-rewrite
  jobs under normal velocity.
- Link instead of copy-paste. If a command exists in
  `SETUP_AND_RUN.md`, don't re-spell it in `WORKFLOWS.md`.
- Keep the always-loaded docs (`00_START_HERE.md`, `AGENT_RULES.md`,
  `CLAUDE.md`) short. Push detail into skills.

## Acceptance

- [ ] Every row in the mapping applicable to this change has been
      addressed (or explicitly skipped with rationale).
- [ ] `python scripts/smoke_test.py --tier 0` passes — catches stale
      Qt-era references, broken command paths, and missing manifest
      files in one gate.
- [ ] `ls` every path referenced in REPO_MAP.
- [ ] Every command in SETUP_AND_RUN resolves (file exists, flag is
      valid).

## Escalation

- Doc is so stale it needs a rewrite, not an update → open a
  `docs-sync-v<N>` initiative.
- Doc describes a feature that doesn't exist → remove or mark
  explicitly "Planned — B-000N".
