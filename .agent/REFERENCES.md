# REFERENCES — external sources summarized

Curated external references that inform MantisAnalysis' agent
harness, React UI discipline, browser test design, and
accessibility posture. Each entry is a short summary + the
MantisAnalysis-specific takeaway, not a full transcription. Fetch
the original when you need the full text.

Last curated: 2026-04-24. Links are stable at the given URLs as of
curation; if one rots, favor the summary and move on.

---

## Anthropic — Building effective agents

**Where**: <https://www.anthropic.com/engineering/building-effective-agents>
(also on anthropic.com/research).

**Takeaways for MantisAnalysis**:

- **Simple > clever.** Prefer single model with tools over multi-
  agent orchestration unless the task genuinely needs it. The
  specialist-subagent pattern used here is for review roles, not
  for coordinating primary implementation.
- **Tools with clear docs + examples.** Every agent brief in
  `.agent/agents/` includes a *when-to-invoke*, *output contract*,
  and *severity rubric* — this is the tool-documentation pattern
  applied to reviewer invocation.
- **Gradually add complexity.** The harness ships with Tier 0–5
  today; Tiers 6–8 (visual regression, a11y automation,
  performance) are recommended, not mandatory until an initiative
  earns their cost.
- **Evaluate agent output.** The independent-review-loop skill is
  the core evaluation pattern: reviewers surface findings; the
  implementer resolves; disposition is recorded.

---

## Anthropic — Claude Code best practices

**Where**: <https://docs.claude.com/en/docs/claude-code/> and blog
posts on claude.ai.

**Takeaways**:

- **CLAUDE.md is the always-on context.** Keep it short; push
  detail into skills. MantisAnalysis' root `CLAUDE.md` points at
  `.agent/00_START_HERE.md` and encodes only the project-level
  rules + compaction protocol.
- **Subagents** (`.claude/agents/*.md` or `.agent/agents/*.md`
  via the symlink) define specialist reviewers. Format: YAML
  frontmatter (`name`, `description`, `tools`) + markdown body.
- **Skills** (`.claude/skills/<slug>/SKILL.md`) are conditional
  knowledge loaded on trigger. Description field is what the
  harness matches against user intent.
- **Hooks** run shell commands on events (before/after tool use,
  before submit, etc.). Can enforce a docs-consistency check.
- **Permissions** (`settings.local.json` allow/deny) — allowlist
  routine safe commands so the agent doesn't prompt; never
  allowlist destructive ones.
- **Auto mode vs. permission mode.** For long runs, favor
  permission mode for destructive + push operations and auto for
  verified-safe commands.
- **Checkpoints + multiple sessions.** Branches + `.agent/runs/`
  folders + HANDOFF give multi-session resumability. Worktrees for
  parallel sessions.

---

## Playwright — best practices, locators, assertions, visual comparisons, accessibility testing

**Where**: <https://playwright.dev/docs/best-practices>,
<https://playwright.dev/docs/locators>,
<https://playwright.dev/docs/test-assertions>,
<https://playwright.dev/docs/test-snapshots>,
<https://playwright.dev/docs/accessibility-testing>.

**Takeaways**:

- **User-facing locators.** `get_by_role`, `get_by_label`,
  `get_by_text`, `get_by_placeholder`, `get_by_title`,
  `get_by_test_id`. CSS/XPath last resort.
- **Web-first assertions.** `expect(locator).toBeVisible()` etc.
  retry until matched or timeout. Avoid one-shot reads.
- **No `waitForTimeout`** as a primary wait — flaky. Use
  `waitFor(condition)` or web-first assertions.
- **Console + pageerror** must be wired into every test.
- **Screenshots + `toHaveScreenshot`** for visual regression.
  Baselines committed; `threshold` and `maxDiffPixels` tuned per
  test.
- **Trace + video on failure** — `--tracing=retain-on-failure
  --video=retain-on-failure`. Open with `playwright show-trace`.
- **axe-core integration** via `@axe-core/playwright` (Node) or
  `axe-playwright-python` (Python).

These all map directly onto
[`skills/playwright-e2e-verification`](skills/playwright-e2e-verification/SKILL.md)
and [`skills/visual-regression`](skills/visual-regression/SKILL.md).

---

## React Testing Library — user-centric testing principles

**Where**: <https://testing-library.com/docs/guiding-principles>.

**Takeaways (adapted for MantisAnalysis)**:

> "The more your tests resemble the way your software is used,
> the more confidence they can give you."

- Test behavior, not implementation. A test should survive a
  component refactor if the behavior is unchanged.
- Query by what the user sees, not by internal structure. React
  Testing Library leads with `screen.getByRole`,
  `screen.getByLabelText`, etc. — the same pattern Playwright
  adopted for its locator ladder.
- Avoid shallow rendering / mocking children; test as close to
  reality as reasonable.
- `act`-wrap state updates (handled automatically by modern
  Testing Library utilities).

MantisAnalysis doesn't use React Testing Library today (no JS test
runner), but the principles transfer to Playwright test authoring.

---

## Storybook — interaction, accessibility, visual testing

**Where**: <https://storybook.js.org/docs/writing-tests/interaction-testing>,
<https://storybook.js.org/docs/writing-tests/accessibility-testing>,
<https://storybook.js.org/docs/writing-tests/visual-testing>.

**Takeaways**:

- Storybook lets components render in isolation with explicit state
  combinations (primary, disabled, loading, error).
- **Interaction tests** use `play` functions to simulate user
  actions; backed by Testing Library under the hood.
- **Accessibility addon** runs axe-core on every story; surfaces
  violations in the preview.
- **Chromatic** is the hosted visual-regression companion — diffs
  each story across PRs.

**Gated** for MantisAnalysis on B-0014 (bundler migration). Without
Vite or esbuild, Storybook won't slot in cleanly. Document as
recommended; don't install today.

---

## W3C — WCAG 2.2 Quick Reference

**Where**: <https://www.w3.org/WAI/WCAG22/quickref/>.

**Takeaways (kept here as informational; the project does not enforce
WCAG via an axe-core gate or accessibility skill — verification is
live render only)**:

- **1.1.1** Non-text alternatives. `alt` on images.
- **1.3.1** Info + relationships. `<label for>`, heading hierarchy.
- **1.4.3** Contrast (min). 4.5:1 body; 3:1 large text.
- **1.4.4** Resize text. 200% zoom no loss.
- **1.4.11** Non-text contrast. 3:1 for controls / graphical info.
- **2.1.1** Keyboard. Every function reachable.
- **2.1.2** No keyboard trap.
- **2.4.3** Focus order.
- **2.4.7** Focus visible.
- **2.4.11** *(new in 2.2)* Focused control not obscured.
- **2.5.7** *(new in 2.2)* Dragging has non-drag alternative.
- **2.5.8** *(new in 2.2)* Target size ≥ 24×24 CSS px.
- **3.3.1** Error identification in text, not color alone.
- **3.3.7** *(new in 2.2)* Redundant entry — don't make the user
  retype info already provided.
- **4.1.2** Name / role / value for custom widgets.
- **4.1.3** Status messages via `aria-live` / `role="status"`.

**MantisAnalysis-specific focus**: drag interactions (ROI, USAF
lines, DoF points) need non-drag alternatives (2.5.7). Canvas
interactions are the hardest category here; current gap is
documented, not ignored.

---

## Vite — for the bundler-migration decision (B-0014)

**Where**: <https://vitejs.dev/guide/>.

**Takeaways**:

- Dev server with instant HMR; production bundle with Rollup.
- ES modules native → no Babel standalone needed in browser.
- Plays well with React (via `@vitejs/plugin-react`).
- Enables npm + lockfile + Storybook + dev-time TypeScript.

**For MantisAnalysis**: this is the bundler we use as of
`bundler-migration-v1` Phases 1-8 (all shipped 2026-04-24, D-0017).
`npm run build` emits `web/dist/`; FastAPI serves it at `/`.
`npm run dev` runs the Vite dev server on `:5173` with `/api`
proxied to FastAPI on `:8765`. Storybook on `@storybook/react-vite`
runs via `npm run storybook` on `:6006`.

---

## How to update this file

- When the harness starts using a new external reference, add a
  short summary here.
- When a link rots, update to a stable mirror; keep the summary so
  readers don't need to click.
- When a reference no longer applies (e.g., if Storybook is
  rejected after a bundler decision), move it to an
  `## Archived` section rather than deleting; future agents
  benefit from knowing it was considered.

## Anti-pattern: copy-pasting external text

Don't inline full pages here. Summarize enough to make the
reference useful + link. The goal is "pointer with actionable
takeaway", not a mirror.
