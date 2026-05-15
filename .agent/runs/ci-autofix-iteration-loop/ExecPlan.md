# CI Autofix Iteration Loop — MantisAnalysis

Enhancement to the existing `.github/workflows/auto-fix.yml` + `.github/auto-fix/claude_fix.py` pattern, adding iteration loop machinery learned from the MantisCamUnified L-AUTOFIX rollout (May 2026).

## What was already here (preserved)

The existing autofix in this repo is already sophisticated:

- `auto-fix.yml` triggers on `workflow_run` of `smoke` or `release` (and a manual `workflow_dispatch`).
- Deterministic `ruff --fix` + `ruff format` pre-pass before invoking Claude.
- Optional Claude tool-use loop (`read_file`, `list_dir`, `edit_file`, `write_file`, `finish`) via `.github/auto-fix/claude_fix.py` using `claude-sonnet-4-6`.
- Pre-PR verification: `python scripts/smoke_test.py --tier 1` + `pytest tests/unit`.
- PR creation via `peter-evans/create-pull-request@v7` on success.
- Deduped Issue fallback (reuses an open issue with the same title) on no-fix-possible.

All of the above is preserved. The agentic tool-use approach is actually a strength over MantisCamUnified's single-diff response — better suited to a multi-stack repo (Python + Vite/TS + Storybook).

## What's added in this session (iteration loop)

The existing pattern is one-shot: each CI failure opens a new PR; if that PR's CI fails again, nothing recovers. Operator feedback from the MantisCamUnified rollout: "the auto fix try once and if persist error it just give up" → users want it to keep trying.

Five additions to close the loop:

| # | Where | What |
|---|---|---|
| 1 | `auto-fix.yml` | New `Determine mode` step. Detects whether `FAILED_BRANCH` matches `auto-fix/*` (continuation) or is anything else (first-attempt). |
| 2 | `auto-fix.yml` | New `Iteration check` step (continuation only). Counts `claude-autofix`-authored commits since `origin/HEAD`. Sets `max_reached=true` when count ≥ `MAX_ITERATIONS` (default 10). |
| 3 | `auto-fix.yml` | New `Cap exhausted` step. On max_reached, posts a PR comment + adds `autofix-exhausted` label (auto-created). PR stays open for human takeover. |
| 4 | `auto-fix.yml` | New `Build prior-attempts summary` step (continuation only). Pulls `git log` of prior claude commits on the branch into a text file. |
| 5 | `auto-fix.yml` | New `Push iteration commit to existing PR` step (continuation, when fix succeeded + verify passed). Bypasses `peter-evans` and directly `git commit` + `git push` to the existing branch, then `gh pr comment`s the existing PR. |

Plus the existing PR-creation and Issue-fallback steps are gated to `mode == 'first'`, so they only fire on the initial failure of each unique problem.

In `claude_fix.py`:

- New `--prior-attempts <path>` CLI arg.
- `build_first_message` accepts `prior_attempts` and wraps it in a `<prior_attempts>` block at the top of Claude's first message, with an explicit instruction: "DO NOT repeat any of these patches; if your previous reasoning was wrong, switch approach or call `finish(fixed=false)`."
- `SYSTEM` ground rules updated:
  - Rule 4 promoted: `.github/workflows/*` are FIRST-CLASS fix surfaces (was "never touch unless obviously needed"). Same lesson as MantisCamUnified: many CI failures need a workflow-level fix (missing pip install, wrong setup-python version, missing apt-get).
  - Rule 6 added: never edit built/cached dirs (`outputs/`, `dist/`, `build/`, `node_modules/`, `storybook-static/`).

## Channels

| Channel | Trigger | Outcome on failure |
|---|---|---|
| L-CI (existing `smoke` / `release`) | push + PR | Failure triggers L-AUTOFIX |
| L-AUTOFIX first-attempt | `workflow_run` on smoke/release failure, branch not `auto-fix/*` | Opens new PR `auto-fix/<workflow>-<run-id>` (peter-evans) or Issue (no-fix) |
| L-AUTOFIX continuation | `workflow_run` on smoke/release failure, branch matches `auto-fix/*` | Pushes another commit to same branch (cap = MAX_ITERATIONS = 10) |

`smoke.yml` already runs on every PR (`pull_request:` trigger with no path filter), so each new autofix commit naturally re-validates through smoke. `release.yml` has a more restrictive `paths:` filter; it'll re-run for autofix PRs only if the patch touches packaging-relevant files. That's fine — the smoke matrix is the primary CI gate.

## Progress

- [x] (2026-05-15) Initiative scaffolded.
- [x] (2026-05-15) `.github/workflows/auto-fix.yml` enhanced (mode detection + iteration check + cap + prior-attempts + continuation push step).
- [x] (2026-05-15) `.github/auto-fix/claude_fix.py` extended with `--prior-attempts`; system prompt's ground rules updated for workflow-fix-surface + built-dirs forbidden list.
- [x] (2026-05-15) Local parse-checks: helper imports cleanly under Python 3.14; CLI shows new arg; workflow YAML parses with 17 steps including the 5 new ones in the right positions.
- [ ] One-time activation by user:
  ```bash
  gh secret set ANTHROPIC_API_KEY --repo BioSensorsLab-Illinois/MantisAnalysis --body "$ANTHROPIC_API_KEY"
  gh api -X PUT /repos/BioSensorsLab-Illinois/MantisAnalysis/actions/permissions/workflow \
      -F can_approve_pull_request_reviews=true
  ```
  (Secret may already be set if the existing autofix was operational.)

## Decision Log

- **Decision**: Preserve the existing agentic Claude tool-use loop (`claude-sonnet-4-6`); do NOT swap to the single-diff opus-4-7 pattern from MantisCamUnified.
  Rationale: The agentic approach explores the repo (read_file, list_dir) and makes targeted edits — better suited to MantisAnalysis's multi-stack surface (Python + Vite + Storybook + tests) where the right file isn't obvious from the failure log alone. Also: sonnet-4-6 is significantly cheaper than opus-4-7, and the agentic loop already involves many API calls per attempt; cost would balloon with opus.
  Date/Author: 2026-05-15.

- **Decision**: Keep `peter-evans/create-pull-request@v7` for first-attempt mode; use raw `git push + gh pr comment` for continuation mode.
  Rationale: peter-evans creates a NEW branch by design — perfect for first-attempt. For continuation we need to push to an EXISTING branch, so raw git is the right tool. Mixing both keeps complexity contained per mode.
  Date/Author: 2026-05-15.

- **Decision**: Continuation mode runs the same `ruff` + `Claude` + `verify` chain as first-attempt; we don't skip the deterministic ruff pre-pass even if it produced no changes last time.
  Rationale: ruff is cheap and idempotent. Skipping it would require state tracking that isn't worth the complexity.
  Date/Author: 2026-05-15.

- **Decision**: Suppress the "Open issue" path in continuation mode.
  Rationale: An issue was opened on the FIRST failure of this branch. If a continuation iteration fails to produce a fix, the PR is still open with its visible commit history. Adding a fresh issue per iteration would create noise.
  Date/Author: 2026-05-15.

- **Decision**: No new `should-run` gate on `smoke.yml`. The existing `smoke.yml` runs on every PR with no path filter — that's also what re-validates autofix PRs. No additional config needed for the iteration loop to work.
  Rationale: Simpler. Cost per autofix iteration ≈ existing smoke matrix cost (4 OS × 4 Python = 16 legs, ~5-10 min each). Acceptable.
  Date/Author: 2026-05-15.

## Plan of Work

### Files modified

- `.github/workflows/auto-fix.yml` — full rewrite with iteration-loop machinery. Net additions: 5 new steps; 3 existing steps gated on `mode.outputs.mode == 'first'`.
- `.github/auto-fix/claude_fix.py` — surgical edits: new `--prior-attempts` arg, `build_first_message` extended, `run()` accepts `prior_attempts_path`, SYSTEM prompt rules 4 + 6 updated.

### Files added

- `.agent/runs/ci-autofix-iteration-loop/{ExecPlan,Status}.md` — this initiative.

## Validation and Acceptance

- ✅ Helper script parses + CLI shows new `--prior-attempts` arg (verified locally).
- ✅ Workflow YAML parses with 17 steps in the right order.
- After merge: first failed `smoke` run on `main` should still open a PR (existing behavior preserved). If THAT PR's smoke fails, a continuation commit should land on the same branch within minutes.
- Cap test (eventually): if Claude can't converge, the 10th iteration should result in `autofix-exhausted` label + PR comment; PR stays open.

## Idempotence and Recovery

- All changes are additive at the workflow level (mode detection branches on top of existing logic). Easy to revert by restoring the prior `auto-fix.yml`.
- The helper's new arg is optional (`default=None`); first-attempt invocations don't pass it and behavior is unchanged.
- Without `ANTHROPIC_API_KEY`, the workflow silently no-ops on the Claude step (preserved existing behavior).

## Notes for Handoff

- The agentic `claude_fix.py` is a strength of this repo's autofix — DON'T replace it with the MantisCamUnified single-diff pattern unless you have a strong reason.
- `MAX_ITERATIONS=10` is at the job level via `env:`. Adjustable in one place if cost shape changes.
- If a future failure recurs across many PRs (same root cause), the dedup Issue mechanism will surface it. Consider that signal stronger than a single autofix PR — it indicates a class of bug Claude can't fix alone.
- Worth porting the L-PR-REVIEW pattern from MantisCamUnified eventually (Claude auto-reviews PRs and posts approve/request-changes). Out of scope for this initiative.
