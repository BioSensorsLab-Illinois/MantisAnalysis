# settings.local.json — permissions rationale

Claude Code looks up `.claude/settings.local.json` for the project's
permission allowlist. `.claude` is a symlink to `.agent`, so the
canonical file is `.agent/settings.local.json`.

## Philosophy

- Allowlist only **exact** command strings — no regex wildcards.
- Every entry is a *routine, safe, read-only-or-bounded* operation
  an agent runs often enough that prompting hurts velocity.
- Never allowlist destructive operations (reset --hard, force push,
  rm -rf outside git-ignored areas, curl | bash, etc.).
- Never allowlist network operations that could exfiltrate data.
- User approval remains required for:
  - Any `git push` (first push of `main` is the B-0010 consent
    gate).
  - Any mutation of external state (GitHub API writes, etc.).
  - Any destructive filesystem operation.
  - Anything that changes `settings.local.json` itself (for that
    matter, this file is intentionally short so a human can audit
    it at a glance).

## Current allowlist rationale

Each entry in `settings.local.json` maps to one row below. If you
add a new entry, add a row here too.

| Command | Why allowed | Risks if misused |
|---|---|---|
| `Bash(python scripts/smoke_test.py --tier 0)` | Tier-0 doc consistency; runs often; no side effects. | None: read-only scan of `.agent/*.md`. |
| `Bash(python scripts/smoke_test.py --tier 1)` | Tier-1 import check; runs often; no side effects. | None: `import` of modules only. |
| `Bash(python scripts/smoke_test.py --tier 2)` | Tier-2 headless figures; writes to `outputs/smoke/` (git-ignored). | Bounded disk writes to `outputs/`. |
| `Bash(python scripts/smoke_test.py --tier 3)` | Tier-3 FastAPI TestClient; in-process only. | None: no network listener opened. |
| `Bash(python -m pytest -q)` | Full test suite; routine. | Bounded: writes to `.pytest_cache`. |
| `Bash(python -m pytest tests/unit/ -q)` | Unit subset. | Same as above. |
| `Bash(python -m pytest tests/headless/ -q)` | Headless figure tests. | Same. |
| `Bash(pytest -m web_smoke -q)` *(not allowlisted today)* | Opt-in Playwright smoke. Requires explicit user approval per invocation — chromium launch is heavy. | Opens chromium in-process on loopback port. |
| `Bash(python scripts/check_agent_docs.py)` | Docs-consistency checker; pure read. | None. |
| `Bash(python -m ruff check mantisanalysis scripts tests)` | Lint; no write unless `--fix`. | None in check-only. |
| `Bash(python -m ruff format --check mantisanalysis scripts tests)` | Format-check; no write. | None. |
| `Bash(python -m mypy mantisanalysis)` | Type-check; no write. | None. |
| `Bash(git status -sb)` | Routine state read. | None. |
| `Bash(git diff)` / `Bash(git diff --cached)` / `Bash(git diff --stat)` | Routine state read. | None. |
| `Bash(git log --oneline -20)` | Routine state read. | None. |
| `Bash(git log -1 --stat)` | Routine state read. | None. |
| `Bash(git branch --show-current)` | Routine state read. | None. |

## What is deliberately NOT allowlisted

- `git push *` — requires explicit user consent per B-0010 /
  AGENT_RULES irreversible-action rules.
- `git reset --hard *`, `git clean -fd`, `git checkout -- *` —
  destructive; user consent required.
- `git rebase *` — history rewrite; user consent required.
- `rm -rf *`, `rm -f *`, `mv *` — filesystem mutation beyond
  routine; explicit call.
- `pip install *` — network + env mutation; user sees the install
  command.
- `curl *`, `wget *` — network; consider implications.
- `playwright install *` — ~300 MB download; user decision.
- `python -m mantisanalysis *` — starts a server; user should see
  the port.

## How to propose an additional allowlist entry

1. Run the command by hand; confirm it's safe + routine.
2. Add it to `settings.local.json` with the exact invocation string.
3. Add a matching row in the table above with rationale + risks.
4. Consider whether the command belongs in a skill's workflow as
   well (so future agents know to run it without prompting anyway).

## How to remove an entry

1. Delete from `settings.local.json`.
2. Delete the row from the table.
3. Note in `CHANGELOG_AGENT.md` why it was removed (e.g., "entry
   was too permissive" or "command no longer exists").

## Hook proposals (not yet installed)

These are *candidates* for `.agent/settings.json` hooks. They're
documented here because a hook adds automation the agent cannot
override, so every hook deserves a public rationale.

| Hook event | Command | Why | Risk |
|---|---|---|---|
| `PreToolUse` on `Bash(git push*)` | run `scripts/check_agent_docs.py` + `scripts/smoke_test.py --tier 0` | ensure docs aren't drifting before a push | noise if tier 0 gets noisy |
| `PostToolUse` on `Edit(.agent/*.md)` | run `scripts/check_agent_docs.py` | surface new drift immediately | noise on ongoing edits |
| `Stop` | print HANDOFF next-action + dirty-file count | help the user resume cleanly | none |

None are installed today. Install requires `settings.json` (global
to the repo) edits + user consent.
