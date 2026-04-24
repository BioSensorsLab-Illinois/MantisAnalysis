---
name: playwright-e2e-verification
description: How to write and run Playwright browser tests in MantisAnalysis. User-facing locators, web-first assertions, screenshots, console/network checks, trace/video retention on failure.
when_to_use:
  - adding or updating a test under tests/web/
  - reproducing a UI regression as an automated test
  - closing a UI initiative (Playwright must cover the new flow)
outputs:
  - a passing test under tests/web/
  - documented run command + wall time
  - trace/video retention pattern configured
related_agents: playwright-verifier, react-ui-ux-reviewer
---

# playwright-e2e-verification

## When to use

- After any React UI change that introduces a new user flow or
  changes an existing one.
- To capture a bug fix as a regression test.
- Before closing a UI-heavy initiative.

## Install (one-time per workstation)

```bash
pip install -e '.[web-smoke]'
playwright install chromium
```

This is opt-in per `pyproject.toml [project.optional-dependencies].web-smoke`.
~300 MB download for chromium; CI doesn't install this by default.

## Workflow

### Step 1 — identify the test file

- Boot-level test → `tests/web/test_web_boot.py` (already exists).
- Feature flow → new file `tests/web/test_<feature>.py`.
- Mode-specific flow → `tests/web/test_<mode>_<feature>.py`.

### Step 2 — use the pytest-playwright `page` fixture + session `web_server`

Preferred shape — `pytest-playwright` provides a per-test `page`
fixture with auto trace / video / screenshot retention. The existing
`tests/web/conftest.py` provides `web_server`. Compose them:

```python
# tests/web/test_<feature>.py
from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

pytest.importorskip("playwright")

@pytest.mark.web_smoke
def test_<feature>(page: Page, web_server: str) -> None:
    errors: list[str] = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    # Avoid wait_until='networkidle' — the app has long-lived polling
    # on /api/*/compute endpoints. Use 'domcontentloaded' + assert on a
    # known element.
    page.goto(web_server, wait_until="domcontentloaded", timeout=15_000)
    expect(page.get_by_role("button", name="USAF")).to_be_visible()

    page.get_by_role("button", name="USAF").click()
    expect(page.get_by_text("Detection limit")).to_be_visible()

    # Filter benign warnings
    errors = [e for e in errors
              if "in-browser Babel transformer" not in e
              and "React DevTools" not in e]
    assert not errors, f"console errors: {errors}"
```

Fallback — when you need to configure the browser context
explicitly (e.g., a custom viewport or device-scale-factor that
pytest-playwright can't supply via its CLI flags), use
`sync_playwright()` directly; otherwise prefer the fixture shape
above.

```python
# Example of the fallback, for multi-viewport or emulation work.
from playwright.sync_api import sync_playwright, expect

@pytest.mark.web_smoke
def test_<feature>_multi_viewport(web_server: str) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for width, height in [(1024, 768), (1280, 800), (1920, 1080)]:
            context = browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
                reduced_motion="reduce",
            )
            page = context.new_page()
            page.goto(web_server, wait_until="domcontentloaded")
            expect(page.get_by_role("button", name="USAF")).to_be_visible()
            context.close()
        browser.close()
```

### Step 3 — locators (best practices)

Preference order:

1. `get_by_role('<role>', name='<accessible-name>')`
2. `get_by_label('<label-text>')`
3. `get_by_text('<visible-text>')`
4. `get_by_placeholder('<placeholder>')`
5. `get_by_title('<title>')`
6. `get_by_test_id('<data-testid>')` — only if 1–5 don't fit; add the
   test ID in source.
7. CSS / XPath — avoid. If no accessible hook exists, add one in
   source (role, aria-label, or data-testid) instead of using a
   brittle selector.

### Step 4 — assertions (web-first)

Use assertions that auto-retry:

- `expect(locator).to_be_visible()`
- `expect(locator).to_have_text(...)`
- `expect(locator).to_contain_text(...)`
- `expect(locator).to_be_enabled()`
- `expect(locator).to_be_disabled()`
- `expect(page).to_have_url(...)`

Do NOT use:

- `page.wait_for_timeout(n)` as a primary wait — flaky.
- `locator.inner_text() == 'foo'` — no retry.
- Manual polling loops.

Exception: a bounded `wait_for_timeout(1500)` is acceptable as a
post-interaction settle gate before asserting "no console errors"
(see existing `test_web_boot.py`).

### Step 5 — screenshots for layout

```python
page.screenshot(path="outputs/web-smoke/<feature>.png", full_page=True)
```

Save under `outputs/web-smoke/` (git-ignored). Reference from
`Status.md` if reviewers need to see them.

### Step 6 — network + console

For flows that hit `/api/*`:

```python
responses = []
page.on("response", lambda r: responses.append((r.url, r.status)))
# … do the flow …
bad = [(url, status) for url, status in responses if status >= 400]
assert not bad, f"failed requests: {bad}"
```

### Step 7 — trace / video / screenshot on failure

```bash
pytest -m web_smoke \
  --tracing=retain-on-failure \
  --video=retain-on-failure \
  --screenshot=only-on-failure
```

All three are `pytest-playwright` CLI flags. Traces saved under
`test-results/`; open with `playwright show-trace
test-results/<test-name>/trace.zip`.

Do NOT use `--tracing=on` for every test — it records traces even on
pass and balloons `test-results/`.

### Step 8 — run

```bash
pytest -m web_smoke -q
```

Wall-time expectation: < 10 s per test after cold boot (first test
pays ~3 s for uvicorn spin-up, reused across session).

### Step 9 — record in Status.md

Document:

- Test file name.
- What flow it covers.
- Run command + observed wall time.
- Any viewports / themes / ISP modes exercised.

## Acceptance

- [ ] Test passes locally (`pytest -m web_smoke`).
- [ ] Uses accessible locators, not CSS.
- [ ] Uses web-first assertions.
- [ ] Console + pageerror listeners attached.
- [ ] No `page.wait_for_timeout` used as a primary wait.
- [ ] Wall time < 10 s (or justified).
- [ ] Boot-level tests still pass.

## Escalation

- Flake detected (test passes 9/10 times) → fix root cause; do not
  retry in CI.
- Locator fallback to CSS required → add ARIA or data-testid in
  source; update the test.
- Test requires a real H5 recording → out of scope for CI-able tests;
  use a synthetic fixture.
