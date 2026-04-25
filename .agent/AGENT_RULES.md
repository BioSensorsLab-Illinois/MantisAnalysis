# AGENT_RULES — non-negotiables

Follow these exactly. They exist because ignoring them has caused
pain on this project or adjacent ones.

## Hard rules

1. **Read before editing.** Before changing any file, read it. No
   blind edits.

2. **Smoke is the gate.** Before claiming any non-doc change
   complete, run the mandatory tiers from
   [`QUALITY_GATES.md`](QUALITY_GATES.md). No exceptions. Per change
   type:
   - Analysis math / figures: Tier 1 + 2.
   - Backend / API: Tier 1 + 2 + 3.
   - React UI: Tier 1 + 2 + 3 + 4.
   - Data-heavy / visualization / export: add Tier 8.
   - Substantial UI: add Tier 7.

3. **Verify frontend changes by actually rendering them.** Use
   Claude Preview MCP (`mcp__Claude_Preview__*`). Take screenshots,
   check console, check network, walk the keyboard, flip themes,
   verify empty/loading/error/success states. "Looks correct in the
   diff" is not evidence. See
   [`UI_VERIFICATION.md`](UI_VERIFICATION.md).

4. **Scope discipline.** > 3 files → open an initiative under
   `.agent/runs/<slug>/`. See
   [`skills/execplan-large-feature/SKILL.md`](skills/execplan-large-feature/SKILL.md).

5. **Never change the GSense Bayer constants.** `ORIGIN = (0, 0)`
   and `LOC` at `mantisanalysis/extract.py:25-26` are locked to the
   physical lab setup. If a change seems needed, stop, document in
   `DECISIONS.md`, and confirm with Zhongmin FIRST.

6. **Never change channel key names.** `HG-R`, `HG-G`, `HG-B`,
   `HG-NIR`, `HG-Y`, `LG-R`, `LG-G`, `LG-B`, `LG-NIR`, `LG-Y`, `R`,
   `G`, `B`, `Y`, `L` are consumed everywhere — JSON persistence,
   React mode files, figure code, analysis output. Renames break
   saved-lines JSON + every React consumer.

7. **Analysis math modules stay pure.** `usaf_groups.py`,
   `fpn_analysis.py`, `dof_analysis.py`, `resolution.py`,
   `image_io.py`, `extract.py`, `image_processing.py`,
   `isp_modes.py`, `plotting.py` must not import FastAPI, uvicorn,
   React, or any transport framework — they must remain unit-
   testable in a headless process. The FastAPI layer (`server.py`,
   `session.py`, `figures.py`) is the sole adapter between
   analysis math and the HTTP frontend; it lives at the outermost
   ring.

8. **Every non-doc change updates docs.** Map in
   [`skills/docs-sync/SKILL.md`](skills/docs-sync/SKILL.md). Docs
   drift silently; don't let them.

9. **Decisions get recorded.** Any non-trivial choice →
   `DECISIONS.md` entry with rationale.

10. **Risks get recorded.** Any new minefield → `RISKS.md` entry.

11. **Never commit secrets, credentials, or large binary artifacts.**
    `.gitignore` covers `outputs/`. Real H5 recordings never enter
    git. If you generate > ~1 MB of data, confirm it's ignored
    before commit.

12. **No cosmetic refactors.** Style-only changes burn time and
    obscure review. Ruff handles format on demand; don't
    pre-emptively format unrelated files.

13. **One agent directory: `.agent/`.** The Claude Code harness
    looks for tool-config files at `.claude/`. We satisfy both by
    making `.claude` a **symlink to `.agent`** — every file lives
    once, under `.agent/`, but `.claude/<name>` resolves there too.
    Don't create a real `.claude/` directory.

14. **Independent review before close.** Every non-trivial
    initiative spawns reviewer subagents from `.agent/agents/`;
    findings are consolidated in `Status.md`; P0/P1 are resolved
    before declaring complete. See
    [`skills/independent-review-loop/SKILL.md`](skills/independent-review-loop/SKILL.md).
    **Do not self-certify.**

15. **Stopping criteria are binding.** Before declaring major work
    complete, every item in
    [`STOPPING_CRITERIA.md`](STOPPING_CRITERIA.md) applicable to the
    change type must be satisfied. Deferrals allowed only with
    explicit BACKLOG entry + user consent for P1 waivers.

16. **Context compaction preserves state.** Before a context
    compaction, write the essentials (branch, initiative, milestone,
    modified files, pending checks, open findings, next concrete
    action) into `Status.md` AND mention them in the chat. See
    [`skills/context-handoff/SKILL.md`](skills/context-handoff/SKILL.md).

## When the user is angry / cursing — STOP and audit

If the user is cursing, swearing, or emphatically frustrated ("wtf",
"fucking", repeated exclamation marks, "you are making things worse",
"you broke X", "this is shit", capitals-screaming), it is a strong
signal that the most recent change made things **worse than before**,
not better. Standard response:

1. **Stop adding new code.** Do not pile fix-on-fix. Acknowledge the
   regression in one sentence.
2. **Re-read the user's literal request.** If they pointed at a
   specific surface ("source panel", "header bar", "the dropdown"),
   that surface IS where they want the control — not a "consistent"
   alternative you preferred.
3. **Audit the specific change cited.** Open the file you most
   recently edited. Re-read the diff. Identify what the user pushed
   back on. Strip the regression first; only then propose a forward fix.
4. **Cast the redesign wide enough.** If the user says "do a whole
   audit", touch every related surface in one pass — don't leave half
   the regression in place.
5. **Keep verifying live until they agree.** "Looks fine in tests"
   doesn't matter when the screenshot in their hand says otherwise.

Curse words AND repeated exclamation are the trigger. A single "!"
or a calm correction is just normal feedback — no escalation needed.

## Soft rules (prefer)

- Prefer targeted edits over rewrites.
- Prefer naming consistency with existing code over "better" names.
- Prefer matplotlib's `Agg` backend for any non-interactive work
  (tests, CI).
- Prefer early returns over nested conditionals.
- Prefer stateless pure functions in `*_analysis.py`.
- Prefer accessible locators (role, label, text) in Playwright tests
  over CSS selectors.
- Prefer web-first assertions (`expect(...).to_be_visible()`) over
  `page.wait_for_timeout(n)`.
- Prefer server-emitted data over client-side computation — the
  single source of truth is FastAPI.

## Quitting-the-session rules

Before ending a session, update:

- [`HANDOFF.md`](HANDOFF.md) — current branch, current focus, open
  dirty files, next concrete step.
- [`CHANGELOG_AGENT.md`](CHANGELOG_AGENT.md) — one-line entry with
  date, scope, and outcome.
- The active initiative's `Status.md` in `.agent/runs/<slug>/`.

Full procedure: [`skills/context-handoff/SKILL.md`](skills/context-handoff/SKILL.md).

## Irreversible-action rules

Before any of these, pause and confirm with user OR clearly document:

- `git push --force`
- `git push` of a new branch (first push of `main` is the B-0010
  gate).
- `git reset --hard`
- `git clean -fd`
- `rm -rf` of anything not in `outputs/`, `build/`, `test-results/`,
  or cache dirs
- deleting any `.agent/` file
- changing the GSense Bayer constants
- changing the channel key schema
- changing any public function signature in `mantisanalysis/*.py`
  (public = imported by `server.py`, `figures.py`, `session.py`, or
  any `tests/`)
- dropping / replacing a `pyproject.toml` dependency without
  justification

See [`skills/safe-git-and-worktrees/SKILL.md`](skills/safe-git-and-worktrees/SKILL.md).

## Long-running autonomous work

For extended unsupervised runs, hard-rule 14 is not optional: every
major milestone ends with reviewer passes appropriate to the change
type. See [`WORKFLOWS.md`](WORKFLOWS.md) § "Long-running autonomous
work" for the full protocol.
