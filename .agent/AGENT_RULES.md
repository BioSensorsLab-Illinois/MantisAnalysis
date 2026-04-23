# AGENT_RULES — non-negotiables

Follow these exactly. They exist because ignoring them has caused pain
on this and adjacent projects.

## Hard rules

1. **Read before editing.** Before changing any file, read it. No blind
   edits.
2. **Smoke is the gate.** Before claiming any non-doc change complete,
   run `python scripts/smoke_test.py --tier 1` AND `--tier 2`. If either
   fails, fix or revert. No exceptions.
3. **Preserve working behavior** unless there is a specific, documented
   reason to change it.
4. **Scope discipline.** If a task leads to more than three files you
   think you should change, stop and scope it as an initiative under
   `.agent/runs/<slug>/`.
5. **Never change the GSense Bayer constants.** `ORIGIN` and `LOC` at
   `mantisanalysis/extract.py:25-26` are locked to the physical lab
   setup. If a change seems needed, document it in `.agent/DECISIONS.md`
   and confirm with Zhongmin FIRST.
6. **Never change channel key names.** `HG-R`, `HG-G`, …, `LG-Y`, `R`,
   `G`, `B`, `Y`, `L` are consumed everywhere — JSON persistence, figure
   code, analysis output. Renames break saved-lines JSON.
7. **Analysis math modules stay pure NumPy/SciPy.** `usaf_groups.py`,
   `fpn_analysis.py`, `dof_analysis.py`, `resolution.py`, `image_io.py`,
   `extract.py`, `image_processing.py` must not import Qt, FastAPI, or
   any other UI/transport framework — they need to remain unit-testable
   in a headless process. The FastAPI layer (`server.py`, `session.py`,
   `figures.py`) is the only adapter between analysis math and the HTTP
   frontend; it lives at the outermost ring.
8. **Every non-doc change updates docs.** If you change architecture →
   `ARCHITECTURE.md` + `REPO_MAP.md`. If you change workflow →
   `WORKFLOWS.md`. If you change commands → `SETUP_AND_RUN.md`. If you
   change rules → this file. Docs drift silently; don't let them.
9. **Decisions get recorded.** Any deviation from Phase 1 plan or any
   non-trivial choice → `.agent/DECISIONS.md` entry with rationale.
10. **Risks get recorded.** If you find a new minefield, add it to
    `.agent/RISKS.md`.
11. **Never commit secrets, credentials, or large binary artifacts.**
    `.gitignore` covers `outputs/`. If you generate > ~1 MB of data,
    confirm it's ignored before commit.
12. **No cosmetic refactors.** Style-only changes burn time and
    obscure review. Ruff handles format on demand; don't pre-emptively
    format unrelated files.
13. **One agentic-workflow directory: `.agent/`.** The Claude Code
    framework looks for tool-config files (`launch.json`,
    `settings.local.json`) at `.claude/`. We satisfy both by making
    `.claude` a **symlink to `.agent`** — every file lives once, under
    `.agent/`, but `.claude/<name>` resolves there too. Don't create a
    real `.claude/` directory: keep the symlink so there is one source
    of truth.
14. **Verify frontend changes by actually rendering them.** The
    Claude Preview MCP (`mcp__Claude_Preview__*`) launches the local
    server (config in `.agent/launch.json`) and lets the agent
    screenshot, evaluate JS, and inspect the live DOM. After any
    non-trivial UI change, take a screenshot and look at it before
    claiming the work done. "Looks correct in the diff" is not
    sufficient evidence.

## Soft rules (prefer)

- Prefer targeted edits over rewrites.
- Prefer naming consistency with existing code over "better" names.
- Prefer matplotlib's `Agg` backend for any non-interactive work (tests,
  CI).
- Prefer early returns over nested conditionals.
- Prefer stateless pure functions in `*_analysis.py`.

## Quitting-the-session rules

Before ending a session, update:

- `.agent/HANDOFF.md` → current branch, current focus, open dirty files,
  next concrete step.
- `.agent/CHANGELOG_AGENT.md` → one-line entry with date, scope, and
  outcome.
- The active initiative's `Status.md` in `.agent/runs/<slug>/`.

## Irreversible-action rules

Before any of these, pause and confirm with user or clearly document:

- `git push --force`
- `git reset --hard`
- `rm -rf` of anything not in `outputs/` or `build/` or cache dirs
- deleting any `.agent/` file
- changing the GSense Bayer constants
- changing the channel key schema
- changing any public function signature in `mantisanalysis/*.py`
