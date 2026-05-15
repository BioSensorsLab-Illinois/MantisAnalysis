# Status — CI Autofix Iteration Loop (MantisAnalysis)

## Current Branch

- `main`

## Current Focus

- Add the MantisCamUnified-pattern iteration loop on top of this repo's existing `auto-fix.yml` + `claude_fix.py`. Failing `smoke` / `release` workflow on an `auto-fix/*` branch now pushes another commit to the same PR (up to 10) instead of being one-shot.

## Progress

- [x] (2026-05-15) Initiative scaffolded (ExecPlan + Status).
- [x] (2026-05-15) `.github/workflows/auto-fix.yml` enhanced: 5 new steps for mode detection, iteration check, cap exhaustion, prior-attempts builder, continuation-mode push. Existing first-attempt steps gated on `mode == 'first'`.
- [x] (2026-05-15) `.github/auto-fix/claude_fix.py` extended:
  - new `--prior-attempts <path>` CLI arg
  - `build_first_message` wraps prior-attempts into a `<prior_attempts>` block at the top of the user message
  - `run()` reads the file and forwards
  - SYSTEM prompt updated: rule 4 promotes `.github/workflows/*` to FIRST-CLASS fix surface (was forbidden by default); rule 6 adds `outputs/`, `dist/`, `build/`, `node_modules/`, `storybook-static/` to the don't-edit list
- [x] (2026-05-15) Local parse-checks: helper parses + `--help` shows new arg; workflow YAML parses with 17 steps.
- [ ] Activation (user): `gh secret set ANTHROPIC_API_KEY` + `gh api ... actions/permissions/workflow`.

## Blockers

- **One-time activation by user** (gh CLI, no UI):
  ```bash
  # ANTHROPIC_API_KEY — likely already set if the existing autofix has fired before
  gh secret set ANTHROPIC_API_KEY \
    --repo BioSensorsLab-Illinois/MantisAnalysis \
    --body "$ANTHROPIC_API_KEY"

  # Allow GitHub Actions to create + approve PRs (peter-evans needs this)
  gh api -X PUT \
    /repos/BioSensorsLab-Illinois/MantisAnalysis/actions/permissions/workflow \
    -F can_approve_pull_request_reviews=true
  ```

## Known Checks Still Required

- After merge: first failed `smoke` or `release` on `main` should still open an `auto-fix/...` PR (existing first-attempt behavior preserved).
- THE NEW BEHAVIOR: if that PR's CI fails, a continuation commit should land on the same branch within minutes, with a `:arrows_counterclockwise: Auto-fix iteration N/10` comment on the PR.
- Eventually (after 10 failed iterations): `autofix-exhausted` label appears + final cap comment posted; PR stays open.
- No regression: the existing dedup Issue fallback (when Claude can't fix the FIRST failure) still works — verify by reading any first-attempt run where Claude returned without edits.

## Next Steps

1. Commit + push from `main`.
2. (User, when ready) Confirm secrets / PR-toggle activation.
3. Wait for the next real CI failure to exercise the loop end-to-end.

## Uncommitted Files

- `.github/workflows/auto-fix.yml` (modified — substantial enhancement)
- `.github/auto-fix/claude_fix.py` (modified — `--prior-attempts` + system-prompt updates)
- `.agent/runs/ci-autofix-iteration-loop/ExecPlan.md` (new)
- `.agent/runs/ci-autofix-iteration-loop/Status.md` (new)

## Notes for Handoff

- The agentic `claude_fix.py` (tool-use loop with `read_file` / `edit_file` / `finish`) is preserved — it's better suited to this repo's multi-stack surface than the single-diff approach used in MantisCamUnified's helper.
- `MAX_ITERATIONS=10` is set at the job level via `env:`. To change it, edit the `env:` block at the top of `auto-fix.yml`.
- Continuation mode bypasses `peter-evans/create-pull-request@v7` (which always creates new branches) and uses raw `git commit` + `git push origin HEAD:$BRANCH` to land on the existing autofix branch.
- The Issue-fallback path is intentionally suppressed in continuation mode — the existing PR (with visible commit history) is the right surface for "I tried, here's what failed", not a fresh issue per iteration.
- L-PR-REVIEW pattern from MantisCamUnified (Claude auto-reviews every PR) is a candidate future extension to this repo. Out of scope here.
