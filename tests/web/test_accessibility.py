"""bundler-migration-v1 Phase 6 — axe-core accessibility smoke.

Goals:
  * Every WCAG A / AA rule that axe-core flags as `critical` or
    `serious` must be zero on the boot page.
  * Moderate / minor violations are logged but non-blocking (for
    this first pass — the goal is to have SOME gate; tightening
    to "zero all violations" is follow-up work once the team has
    absorbed the current baseline).

Run:
    pip install -e '.[web-smoke]'        # now includes axe-playwright-python
    playwright install chromium
    npm install && npm run build
    pytest -m web_smoke tests/web/test_accessibility.py

Skipped gracefully when either Playwright / axe-playwright-python /
the built `web/dist/` are absent.
"""

from __future__ import annotations

from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DIST_INDEX = _REPO_ROOT / "web" / "dist" / "index.html"


@pytest.mark.web_smoke
def test_boot_page_has_no_critical_or_serious_axe_violations(web_server: str) -> None:
    """Run axe-core against the root page and assert zero critical /
    serious violations. Moderate / minor are captured as warnings in
    stdout but don't fail the gate (yet)."""
    pytest.importorskip("playwright")
    pytest.importorskip("axe_playwright_python")

    from axe_playwright_python.sync_playwright import Axe  # noqa: E402
    from playwright.sync_api import sync_playwright  # noqa: E402

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist/index.html not built. Run `npm install && npm run build`.")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(web_server, wait_until="networkidle", timeout=15_000)

        # Let the React tree settle; deferred mounts (ISP fetch, source
        # sample) can change the DOM.
        page.wait_for_timeout(1500)

        axe = Axe()
        # Limit the rule set to WCAG A/AA; skip experimental / best-practice
        # rules for this first-pass gate.
        result = axe.run(
            page,
            options={
                "runOnly": {"type": "tag", "values": ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]},
            },
        )
        browser.close()

    violations = result.response.get("violations", [])
    critical = [v for v in violations if v.get("impact") == "critical"]
    serious = [v for v in violations if v.get("impact") == "serious"]
    moderate = [v for v in violations if v.get("impact") == "moderate"]
    minor = [v for v in violations if v.get("impact") == "minor"]

    def _fmt(v: dict) -> str:
        nodes = v.get("nodes", [])
        targets = [n.get("target", []) for n in nodes[:3]]
        return (
            f"  - [{v.get('impact')}] {v.get('id')}: {v.get('help')}\n"
            f"      help_url: {v.get('helpUrl')}\n"
            f"      {len(nodes)} element(s), first 3 targets: {targets}"
        )

    if moderate or minor:
        print("\n[axe] non-blocking violations (moderate / minor):")
        for v in (*moderate, *minor):
            print(_fmt(v))

    if critical or serious:
        print("\n[axe] existing critical / serious violations (tracked):")
        for v in (*critical, *serious):
            print(_fmt(v))

    # --- Strict gate ----------------------------------------------------
    # B-0026 closure (2026-04-24): all known critical / serious WCAG A/AA
    # violations on the boot page have been remediated. The previous
    # baseline of 2 critical + 3 serious is now zero, and the test fails
    # on any new violation.
    BASELINE_CRITICAL = 0
    BASELINE_SERIOUS = 0

    assert len(critical) <= BASELINE_CRITICAL, (
        f"axe-core found {len(critical)} critical WCAG A/AA violations; "
        f"baseline is {BASELINE_CRITICAL}. See stdout above + helpUrl."
    )
    assert len(serious) <= BASELINE_SERIOUS, (
        f"axe-core found {len(serious)} serious WCAG A/AA violations; "
        f"baseline is {BASELINE_SERIOUS}. See stdout above + helpUrl."
    )
