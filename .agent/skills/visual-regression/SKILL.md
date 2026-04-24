---
name: visual-regression
description: Screenshot comparison discipline for MantisAnalysis. Playwright-based today; notes on Storybook/Chromatic if the frontend ever moves to a bundler.
when_to_use:
  - a change is primarily visual (typography sweep, chart styling)
  - preventing layout regressions after a shared-primitive rewrite
  - capturing a baseline for a new screen
outputs:
  - baseline screenshots under tests/web/__baselines__/
  - failure screenshots committed alongside the test, with diff
related_agents: playwright-verifier, react-ui-ux-reviewer
---

# visual-regression

## When to use

- After a chart / card primitive rewrite (e.g.,
  `analysis-page-overhaul-v1` Phase 4).
- After a typography sweep (e.g., Phase 6 of the same initiative).
- When catching unintended layout drift on a surface that has
  multiple themes.

Do NOT use visual regression for:

- Tests that ought to be content-level (use `expect().toHaveText()`).
- Canvas-heavy charts where pixel-exact reproduction is not
  deterministic.

## Current status in MantisAnalysis

- **No visual regression baseline exists yet.** The first initiative
  to adopt it would also need to establish the baseline directory +
  tolerance policy.
- Playwright's built-in screenshot comparison
  (`expect(locator).toHaveScreenshot()`) is the recommended first
  step.
- Storybook + Chromatic is a bigger investment; gated on the bundler
  decision (B-0014).

## Workflow (Playwright-based)

### Step 1 — set deterministic environment

```python
# In the test fixture
context = browser.new_context(
    viewport={"width": 1280, "height": 800},
    device_scale_factor=1,
    reduced_motion="reduce",
)
# Freeze theme: light or dark, not whatever localStorage has cached.
page.evaluate("localStorage.setItem('mantis/theme', 'light')")
page.reload()
```

### Step 2 — capture baseline

On first run:

```python
from playwright.sync_api import Page, expect

@pytest.mark.web_smoke
def test_usaf_analysis_modal_visual(page: Page, web_server: str) -> None:
    # … navigate + open modal …
    expect(page.locator("[role='dialog']")).to_have_screenshot(
        "usaf-analysis-light.png",
        # `threshold` is per-pixel YIQ color-diff tolerance in [0, 1].
        # 0.2 is too loose and masks real regressions; 0.02 is a
        # reasonable default for text + layout. Raise for
        # anti-aliased scientific charts.
        threshold=0.02,
        # `max_diff_pixel_ratio` bounds image-wide divergence as a
        # fraction of total pixels (alternative / companion to
        # `max_diff_pixels`).
        max_diff_pixel_ratio=0.01,
    )
```

First invocation writes the baseline. Commit it under
`tests/web/__baselines__/<test-name>/<snapshot>.png`.

**First-baseline rule.** The initiative that adopts visual regression
commits the baseline in its own commit, NOT as a side effect of an
unrelated change. CHANGELOG line: "visual baseline added for
<surface>". Future regressions have a bisectable baseline to point
at.

### Step 3 — subsequent runs compare

Non-matching runs write an actual/expected/diff triple to
`test-results/` and fail the test. Inspect; either:

- The change was intentional → update the baseline
  (`pytest --update-snapshots -m web_smoke`).
- The change was a regression → fix the code.

### Step 4 — document tolerance

Every baseline has a documented tolerance:

- `threshold=0.02` — per-pixel YIQ color-diff tolerance. Tighter for
  typography / layout, looser (0.05–0.1) for anti-aliased scientific
  charts.
- `max_diff_pixel_ratio=0.01` — image-wide divergence cap (1%).
- `max_diff_pixels=100` — absolute per-image cap. Use only when the
  surface area is small + deterministic.

Pick one image-wide bound (`ratio` or absolute `pixels`); don't
combine them without reason.

### Step 5 — fonts and anti-aliasing

Visual regression is sensitive to font rendering. Mitigations:

- Force a specific font via inline CSS (`ui-monospace, Menlo,
  monospace` already in use).
- Run tests in the same container / OS combination used to generate
  baselines.
- Accept that CI-vs-local differences may require regenerating
  baselines in CI.

## Storybook + Chromatic (future)

If MantisAnalysis adopts a bundler (B-0014), consider Storybook for
component-level docs + interaction tests + accessibility + visual
regression. Chromatic provides the hosted diff + review workflow.

Gates on:

- Bundler migration lands (B-0014).
- Team decides visual-regression budget is worth the Chromatic
  monthly cost or self-hosted infra.

## Acceptance

- [ ] Baseline exists under `tests/web/__baselines__/`.
- [ ] Tolerance documented in the test.
- [ ] Baseline committed to git (it's small; < 100 KB per PNG).
- [ ] Test passes locally.
- [ ] Update procedure documented for when change is intentional.

## Escalation

- Fonts render differently in CI vs. local → document; either
  regenerate baselines in CI, or mark the test local-only.
- Canvas heatmap comparisons fail with tiny numeric differences →
  don't visual-regression canvas; content-assert instead.
- Baselines grow past 10 MB → purge outdated snapshots.
