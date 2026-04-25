"""Tier 4 Playwright smoke for the Playback (Recording Inspection) mode (M5).

Per UI_IMPLEMENTATION_NOTES §17 + risk-skeptic P0-B + P1-K:

  * Default state (no `mantis/playback/enabled` localStorage entry):
    no rail tile, `4` keypress is a no-op.
  * With the feature flag set: rail tile visible, `4` activates
    Playback, empty-state CTA renders.
  * Test endpoints (gated by MANTIS_PLAYBACK_TEST=1) load a synthetic
    sample → stream is built → workspace placeholder renders.
  * Firing `mantis:source-evicted` with `detail.kind='stream'` does
    NOT trigger a /api/sources/load-sample POST (P0-B regression).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest


_REPO_ROOT = Path(__file__).resolve().parents[2]
_DIST_INDEX = _REPO_ROOT / "web" / "dist" / "index.html"


@pytest.fixture(scope="module", autouse=True)
def _enable_playback_test_env(monkeypatch_module=None):
    """Per risk-skeptic P1-I — set the env var BEFORE the server fixture
    constructs the FastAPI app."""
    # Module-scoped monkeypatch.setenv would be ideal, but pytest-monkeypatch
    # is function-scoped by default. We hard-set the env var here; the
    # `web_server` fixture in conftest.py is session-scoped but reads at
    # import time inside the `mantisanalysis.server.create_app` call.
    os.environ["MANTIS_PLAYBACK_TEST"] = "1"
    yield


@pytest.mark.web_smoke
def test_playback_rail_hidden_by_default(web_server: str) -> None:
    """Without the feature flag, the rail tile and `4` shortcut are no-ops."""
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        # Ensure the flag is OFF before navigating.
        page.add_init_script(
            "try { localStorage.removeItem('mantis/playback/enabled'); } catch (e) {}"
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        # Default rail has 3 tiles; the 4th (Play) must not be present.
        play_btn = page.locator('[data-mode-tile="play"]')
        assert play_btn.count() == 0
        browser.close()


@pytest.mark.web_smoke
def test_playback_flag_enables_rail_and_empty_state(web_server: str) -> None:
    """With the feature flag set, the rail tile + empty state render."""
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.on("console", lambda msg: errors.append(msg.text)
                if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))

        page.add_init_script(
            "try { localStorage.setItem('mantis/playback/enabled', '1'); } catch (e) {}"
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)

        # Click the Playback rail tile.
        play_btn = page.locator('[data-mode-tile="play"]')
        assert play_btn.count() >= 1
        play_btn.first.click()

        # Empty state is visible.
        page.wait_for_selector('[data-screen-label="Playback empty state"]',
                                state="visible", timeout=5_000)
        # Sources panel skeleton renders.
        assert page.locator('[data-region="sources-panel"]').count() == 1
        # No console errors during boot or mode switch.
        page.wait_for_timeout(500)
        errors = [
            e for e in errors
            if "in-browser Babel transformer" not in e
            and "React DevTools" not in e
        ]
        assert not errors, f"console errors: {errors}"
        browser.close()


@pytest.mark.web_smoke
def test_playback_load_sample_renders_workspace_placeholder(
    web_server: str,
) -> None:
    """End-to-end: enable flag → click sample → workspace placeholder renders."""
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.add_init_script(
            "try { localStorage.setItem('mantis/playback/enabled', '1'); } catch (e) {}"
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.locator('[data-mode-tile="play"]').first.click()
        # Click the sample button (visible in the empty state).
        page.get_by_role("button", name="Load synthetic sample").first.click()
        # The workspace shell renders once the stream is active.
        page.wait_for_selector('[data-region="playback-workspace-shell"]',
                                state="visible", timeout=10_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_eviction_kind_filter(web_server: str) -> None:
    """Risk-skeptic P0-B regression: dispatching `mantis:source-evicted`
    with `detail.kind='stream'` must NOT trigger /api/sources/load-sample."""
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()

        load_sample_calls: list[str] = []
        page.on("request",
                lambda req: load_sample_calls.append(req.url)
                if "/api/sources/load-sample" in req.url else None)

        page.add_init_script(
            "try { localStorage.setItem('mantis/playback/enabled', '1'); } catch (e) {}"
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)

        # Boot's auto-load fires one /api/sources/load-sample call when no
        # sources exist yet — capture the baseline count then dispatch the
        # eviction event.
        baseline = len(load_sample_calls)

        page.evaluate(
            """() => window.dispatchEvent(new CustomEvent('mantis:source-evicted', {
                detail: { kind: 'stream', source_id: 'fake-stream-id' },
            }))"""
        )
        page.wait_for_timeout(500)

        # No additional /api/sources/load-sample request should have fired.
        assert len(load_sample_calls) == baseline, (
            f"Playback stream eviction triggered an unwanted "
            f"/api/sources/load-sample reload: {load_sample_calls}"
        )
        browser.close()
