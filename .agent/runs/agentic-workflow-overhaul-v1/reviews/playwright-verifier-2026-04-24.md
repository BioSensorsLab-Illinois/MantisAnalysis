<!-- qt-allowed: Reviewer report content discusses the Qt-era history + blocklist patterns the scanner enforces; subject matter of the review. -->

# playwright-verifier — agentic-workflow-overhaul-v1

Invoked: 2026-04-24 (mid-M8 reviewer loop).

## Summary

Review of UI_VERIFICATION.md, skills/playwright-e2e-verification/SKILL.md, skills/visual-regression/SKILL.md, skills/react-browser-ui-change/SKILL.md Phase 11, and agents/playwright-verifier.md against Playwright best practices and tests/web/conftest.py + pyproject.toml.

Bottom line: the harness is solid. Five P1 real bugs below; all fixable in docs.

## Findings

### P1

1. **pytest-playwright `page` fixture underused.** pyproject.toml pins pytest-playwright which gives a `page` fixture with auto trace/video/screenshot retention. SKILL example used raw sync_playwright(). Recommend switching template to `page` fixture; fall back to sync_playwright only for multi-browser work.

2. **Trace/video flag inconsistency.** SKILL line 143 shows `--tracing=retain-on-failure`; UI_VERIFICATION line 115 shows `--tracing=on`. Pick retain-on-failure everywhere + add `--screenshot=only-on-failure`.

3. **Boot test uses `is_visible()` not web-first.** tests/web/test_web_boot.py:73 violates the harness's own rule. Either fix the test or annotate the boot-mount check as the single sanctioned exception.

4. **`to_have_screenshot` threshold semantics wrong.** visual-regression/SKILL.md uses `threshold=0.2` and calls it "perceptual diff". Actually per-pixel YIQ color-diff tolerance; 0.2 is too loose. Recommend 0.02 + `max_diff_pixel_ratio=0.01`.

5. **No `networkidle` caveat.** MantisAnalysis polls /api/*, so `wait_until='networkidle'` flakes. Recommend `wait_until='domcontentloaded'` + web-first assertion on a known element.

### P2

6. `reduced_motion` mis-spec'd — add doc pointer.
7. No parallelism / worker-isolation guidance for session `web_server` fixture.
8. Agent brief uses JS syntax in examples (`{ name: 'X' }` instead of `name="X"`).
9. Phase 11 thin; restate "web_smoke marker required" + "console listener".
10. Visual-regression first-baseline rule should require its own commit.

### P3

11. Terminology drift (card-level vs. locator-scoped).
12. Severity rubric missing "test claims coverage of a flow it doesn't exercise".

## Proposed additions

- tests/web/test_mode_switch.py exercising USAF → FPN → DoF click.
- conftest.py autouse `page` wrapper installing console/pageerror listeners.

## Disposition (applied by implementer)

- F-17 (page fixture) — **fixed inline**.
- F-18 (trace flag) — **fixed inline** — retain-on-failure + screenshot-only-on-failure.
- F-19 (threshold) — **fixed inline** — 0.02 + max_diff_pixel_ratio.
- F-20 (networkidle) — **fixed inline** — domcontentloaded + web-first assertion.
- F-21 (boot test) — documented as pre-existing, product code untouched by this initiative.
- F-22 (JS → Python) — **fixed inline**.
- F-7 (xdist warning) — added to Must-not in agents/playwright-verifier.md.
- Rest deferred as polish.

<!-- /qt-allowed -->
