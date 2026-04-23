"""B-0015 — minimal Playwright smoke.

Goal: catch "the React app crashed on boot" regressions before users do.
Specifically:
  * The root HTML loads and React mounts ≥1 child under `#root`.
  * No uncaught console errors during the first 2 s of life.
  * The three mode-rail buttons (USAF / FPN / DoF) render.

To run:
    pip install -e '.[web-smoke]'
    playwright install chromium
    pytest -m web_smoke

The fixture is session-scoped so only one uvicorn boot is paid for.
"""

from __future__ import annotations

import pytest

playwright = pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402


@pytest.mark.web_smoke
def test_root_page_boots(web_server: str) -> None:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        page.on(
            "console",
            lambda msg: errors.append(msg.text) if msg.type == "error" else None,
        )
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.goto(web_server, wait_until="networkidle", timeout=15_000)

        # React should have mounted into #root.
        root_children = page.evaluate(
            "() => document.querySelector('#root')?.children?.length ?? 0"
        )
        assert root_children >= 1, (
            f"React failed to mount (0 children in #root). Console: {errors}"
        )

        # Three mode-rail buttons render.
        for label in ("USAF", "FPN", "DoF"):
            assert page.get_by_role("button", name=label).first.is_visible(), (
                f"mode-rail button '{label}' missing"
            )

        # Let a few frames tick to catch deferred errors.
        page.wait_for_timeout(1500)

        browser.close()

    # Filter out benign warnings that Babel standalone emits on every boot.
    errors = [
        e
        for e in errors
        if "in-browser Babel transformer" not in e
        and "React DevTools" not in e
    ]
    assert not errors, f"console errors during boot: {errors}"
