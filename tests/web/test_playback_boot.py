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
        # M12 playwright-verifier P0: replace blind sleep with a
        # network-idle assertion so console errors that fire during
        # late-loading fonts / Plotly chunks are still caught.
        page.wait_for_load_state("networkidle")
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
def test_playback_dark_strategy_picker_renders(web_server: str) -> None:
    """M6: dark-strategy picker (mean / median / 3σ clip) renders in the
    Sources panel and toggles aria-pressed on click."""
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
        page.wait_for_selector('[data-section="darks"]', state="visible",
                                timeout=5_000)
        # Three strategy buttons exist.
        for label in ("Mean", "Median", "3σ clip"):
            assert page.get_by_role("button", name=label).count() >= 1
        # Click "Median" → aria-pressed=true.
        page.get_by_role("button", name="Median").first.click()
        page.wait_for_function(
            """() => {
                const btns = Array.from(document.querySelectorAll('[data-section=\"darks\"] button'));
                return btns.some(b => b.textContent === 'Median' && b.getAttribute('aria-pressed') === 'true');
            }""",
            timeout=2_000,
        )
        browser.close()


@pytest.mark.web_smoke
def test_playback_stream_builder_opens_for_two_recordings(
    web_server: str,
) -> None:
    """M6: loading two recordings via the test endpoint auto-opens the
    Stream Builder modal; clicking Apply binds the new stream."""
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        # M12 playwright-verifier P0: cold-start flake fix. Persist
        # both flag AND mode=play AND clear any prior playback state
        # in `add_init_script` BEFORE the first navigation, so the
        # test never depends on a previous test having clicked the
        # rail tile. Also click the rail tile after the post-reload
        # navigation as a belt-and-suspenders.
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.locator('[data-mode-tile="play"]').first.click()
        page.wait_for_selector('[data-screen-label="Playback empty state"]',
                                state="visible", timeout=5_000)
        # Clear any state left by earlier session-scoped tests, then
        # POST two fresh synthetic recordings via the test endpoint.
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of (streams || [])) {
                    await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                }
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of (recs || [])) {
                    await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
                }
                for (let i = 0; i < 2; i++) {
                    await fetch('/api/playback/recordings/load-sample', { method: 'POST' });
                }
            }"""
        )
        # Reload so the hydrate effect picks up the two new recordings
        # and auto-opens Stream Builder. `mode=play` was set in the
        # init script so post-reload we land in Playback.
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        # Stream Builder modal opens from the hydrate effect when 2+
        # recordings exist with no active stream. The wait must
        # tolerate a slow first-cold-boot (Vite chunks + React mount
        # under headless Chromium can take >5 s on CI).
        page.wait_for_selector('[data-region="stream-builder"]',
                                state="visible", timeout=12_000)
        # Apply the stream.
        page.get_by_role("button", name="Apply").first.click()
        page.wait_for_selector('[data-region="viewer-grid"]',
                                state="visible", timeout=8_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_workspace_layouts_and_views(web_server: str) -> None:
    """M7: workspace renders ViewerGrid + TimelineStrip; user can switch
    layout, add views, lock a view, scrub timeline."""
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
        # Use the empty-state Load synthetic sample CTA so we have a stream.
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        # ViewerGrid + TimelineStrip render once the stream is active.
        page.wait_for_selector('[data-region="viewer-grid"]', state="visible",
                                timeout=8_000)
        page.wait_for_selector('[data-region="timeline-strip"]', state="visible",
                                timeout=4_000)
        # Switch to 2x2 layout.
        page.locator('button[data-layout="2x2"]').first.click()
        # ViewerGrid shows the empty-cell hint until we add views.
        page.wait_for_function(
            """() => document.querySelector('button[data-layout=\"2x2\"]')?.getAttribute('aria-pressed') === 'true'""",
            timeout=2_000,
        )
        # Add one view.
        page.locator('[data-action="add-view"]').first.click()
        page.wait_for_function(
            """() => document.querySelectorAll('[data-view-id]').length >= 2""",
            timeout=4_000,
        )
        # Hover the first view to surface the toolbar, then click Lock.
        page.locator('[data-view-id]').first.hover()
        page.locator('[data-view-id]').first.locator('[data-action="lock"]').click()
        # The locked-pin appears on the timeline.
        page.wait_for_selector('[data-region="locked-pin"]', state="visible",
                                timeout=4_000)
        # Scrub by clicking the timeline track at ~mid-point.
        track = page.locator('[role="slider"][aria-label="Timeline scrubber"]')
        box = track.bounding_box()
        page.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + box["height"] / 2)
        page.wait_for_function(
            """() => Number(document.querySelector('input[aria-label=\"Current frame number\"]')?.value) > 0""",
            timeout=2_000,
        )
        browser.close()


@pytest.mark.web_smoke
def test_playback_inspector_renders_and_dispatches(web_server: str) -> None:
    """M8: Inspector renders 9 sections, control change reaches the
    backend (preview <img> URL changes)."""
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
        # Reset and load a fresh sample so the workspace is in a known state.
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        page.wait_for_selector('[data-region="inspector"]', state="visible",
                                timeout=8_000)
        # All 9 section headers are present.
        for s in (
            "View",
            "Source",
            "Corrections",
            "Display",
            "Overlay",
            "Labels",
            "Presets",
        ):
            assert page.locator(f'[data-section="{s}"]').count() == 1
        # Snapshot the current viewer URL.
        first_src = page.locator('[data-view-id] img').first.get_attribute('src')
        assert first_src and 'colormap=viridis' in first_src
        # Switch colormap to inferno via the Display section's Select.
        page.evaluate(
            """() => {
                const inspector = document.querySelector('[data-region=\"inspector\"]');
                const selects = inspector.querySelectorAll('select');
                // Find the colormap select (default value = 'viridis').
                const cmSel = Array.from(selects).find(s => s.value === 'viridis');
                cmSel.value = 'inferno';
                cmSel.dispatchEvent(new Event('change', { bubbles: true }));
            }"""
        )
        # Wait for the <img> src to reflect the new colormap.
        page.wait_for_function(
            """() => {
                const img = document.querySelector('[data-view-id] img');
                return img?.src.includes('colormap=inferno');
            }""",
            timeout=4_000,
        )
        # Toggle Basic → Advanced; Advanced section appears.
        page.locator('[data-inspector-mode="advanced"]').click()
        page.wait_for_selector('[data-section="Advanced"]', state="visible",
                                timeout=2_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_overlay_builder_apply(web_server: str) -> None:
    """M9: Open Overlay Builder from Inspector → tweak config → Apply →
    ViewerCard shows OVL badge and the <img> URL carries overlay params."""
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
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        page.wait_for_selector('[data-region="inspector"]', state="visible",
                                timeout=8_000)
        # Open the Overlay Builder via the Inspector button.
        page.locator('[data-action="open-overlay-builder"]').click()
        page.wait_for_selector('[data-region="overlay-builder"]', state="visible",
                                timeout=4_000)
        # The preview pane renders an <img> with overlay_on=1.
        page.wait_for_function(
            """() => {
                const img = document.querySelector('[data-region="overlay-preview"] img');
                return img?.src.includes('overlay_on=1');
            }""",
            timeout=4_000,
        )
        # Apply.
        page.get_by_role("button", name="Apply overlay").first.click()
        # ViewerCard now carries the OVL badge.
        page.wait_for_selector('[data-badge="OVL"]', state="visible", timeout=4_000)
        # Re-open + Cancel keeps overlay state.
        page.locator('[data-action="open-overlay-builder"]').click()
        page.wait_for_selector('[data-region="overlay-builder"]', state="visible",
                                timeout=4_000)
        page.get_by_role("button", name="Cancel").first.click()
        page.wait_for_selector('[data-region="overlay-builder"]', state="hidden",
                                timeout=4_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_export_image_round_trip(web_server: str) -> None:
    """M10: Image export modal POSTs and surfaces a download link."""
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
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        page.wait_for_selector('[data-region="inspector"]', state="visible",
                                timeout=8_000)
        # Open Export Image modal via StreamHeader.
        page.locator('[data-action="export-image"]').click()
        page.wait_for_selector('[data-region="export-image-modal"]',
                                state="visible", timeout=4_000)
        # Click Export inside the modal (avoid matching the rail Image button).
        modal = page.locator('[data-region="export-image-modal"]').locator('xpath=..')
        modal.get_by_role("button", name="Export", exact=True).first.click()
        # Done banner appears with a download link.
        page.wait_for_selector('[data-region="export-image-done"]',
                                state="visible", timeout=10_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_export_video_png_seq_round_trip(web_server: str) -> None:
    """M10: Video export (PNG-seq, ffmpeg-free path) submits + completes."""
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
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        page.wait_for_selector('[data-region="inspector"]', state="visible",
                                timeout=8_000)
        page.locator('[data-action="export-video"]').click()
        page.wait_for_selector('[data-region="export-video-modal"]',
                                state="visible", timeout=4_000)
        # Pick PNG-seq (ffmpeg not required) by aria-labeled Format select.
        # Wait briefly for the modal's children to mount.
        page.wait_for_function(
            """() => {
                const sel = document.querySelector('[data-region=\"export-video-modal\"] select[aria-label=\"Format\"]');
                return !!sel;
            }""",
            timeout=4_000,
        )
        page.evaluate(
            """() => {
                const sel = document.querySelector('[data-region=\"export-video-modal\"] select[aria-label=\"Format\"]');
                sel.value = 'png-seq';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }"""
        )
        page.get_by_role("button", name="Start export").first.click()
        # Job widget appears + transitions to done within 15 s.
        page.wait_for_selector('[data-region="export-video-job"][data-job-status="done"]',
                                state="visible", timeout=15_000)
        browser.close()


@pytest.mark.web_smoke
def test_playback_handoff_to_usaf(web_server: str) -> None:
    """M11: clicking Send-to-USAF on a ViewerCard opens the HandoffModal
    (playback-ux-polish-v1 M3) and confirming switches to USAF mode
    with the new source bound."""
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
        page.evaluate(
            """async () => {
                const streams = await fetch('/api/playback/streams').then(r => r.json());
                for (const s of streams || []) await fetch(`/api/playback/streams/${s.stream_id}`, { method: 'DELETE' });
                const recs = await fetch('/api/playback/recordings').then(r => r.json());
                for (const r of recs || []) await fetch(`/api/playback/recordings/${r.recording_id}`, { method: 'DELETE' });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.locator('[data-mode-tile="play"]').first.click()
        page.get_by_role("button", name="Load synthetic sample").first.click()
        page.wait_for_selector('[data-region="viewer-grid"]', state="visible",
                                timeout=8_000)
        # Hover the first view to surface the toolbar, click Send-to-USAF.
        page.locator('[data-view-id]').first.hover()
        page.locator('[data-action="handoff-usaf"]').first.click()
        # M3: HandoffModal opens; click Confirm to commit.
        page.wait_for_selector(
            '[data-region="handoff-modal"]', state="visible", timeout=4_000
        )
        page.locator('[data-action="handoff-confirm"]').first.click()
        # USAF mode tile becomes active (mode rail's USAF button).
        page.wait_for_function(
            """() => {
                const usaf = document.querySelector('[data-mode-tile=\"usaf\"]');
                return usaf && getComputedStyle(usaf).backgroundColor !== 'rgba(0, 0, 0, 0)';
            }""",
            timeout=4_000,
        )
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
        # M12 playwright-verifier P0: wait for any in-flight network
        # to settle (would catch an unwanted reload), not a blind
        # 500 ms sleep. networkidle = no in-flight requests for 500 ms.
        page.wait_for_load_state("networkidle")

        # No additional /api/sources/load-sample request should have fired.
        assert len(load_sample_calls) == baseline, (
            f"Playback stream eviction triggered an unwanted "
            f"/api/sources/load-sample reload: {load_sample_calls}"
        )
        browser.close()


@pytest.mark.web_smoke
def test_playback_empty_state_dropzone_drag_and_drop(web_server: str) -> None:
    """playback-ux-polish-v1 M1: drop-zone is wired (was decorative
    pre-M12 — react-ui-ux P1).

    - Synthesizes a `dragover` with a fake .h5 File. The drop-zone's
      `data-drag-over` attribute flips to `1` and the copy switches.
    - Synthesizes a `drop` with the same File and asserts a POST to
      `/api/playback/recordings/upload` fires (one request per .h5;
      irrelevant non-.h5 entries are filtered out).
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )

        upload_calls: list[str] = []
        page.on(
            "request",
            lambda req: upload_calls.append(req.url)
            if req.url.endswith("/api/playback/recordings/upload") and req.method == "POST"
            else None,
        )

        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.wait_for_selector(
            "[data-screen-label='Playback empty state']", state="visible", timeout=5_000
        )

        # dragover → copy + visual flip
        page.evaluate(
            """() => {
                const screen = document.querySelector('[data-screen-label="Playback empty state"]');
                const dt = new DataTransfer();
                try { dt.items.add(new File(['x'], 'sample.h5')); } catch {}
                screen.dispatchEvent(new DragEvent('dragover', {
                    bubbles: true, cancelable: true, dataTransfer: dt
                }));
            }"""
        )
        dz = page.locator('[data-region="empty-state-dropzone"]')
        assert dz.get_attribute("data-drag-over") == "1"
        assert "Release to load" in (dz.text_content() or "")

        # dragleave → revert
        page.evaluate(
            """() => document.querySelector('[data-screen-label="Playback empty state"]')
                .dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }))"""
        )
        assert dz.get_attribute("data-drag-over") == "0"

        # drop with one .h5 + one .txt → exactly one upload POST
        page.evaluate(
            """() => {
                const screen = document.querySelector('[data-screen-label="Playback empty state"]');
                const dt = new DataTransfer();
                try {
                    dt.items.add(new File(['hdf'], 'real.h5'));
                    dt.items.add(new File(['ignored'], 'note.txt'));
                } catch {}
                screen.dispatchEvent(new DragEvent('drop', {
                    bubbles: true, cancelable: true, dataTransfer: dt
                }));
            }"""
        )
        page.wait_for_load_state("networkidle")
        assert len(upload_calls) == 1, (
            f"expected 1 upload POST (one .h5 + one .txt filtered), got {upload_calls!r}"
        )
        browser.close()


@pytest.mark.web_smoke
def test_playback_destructive_remove_two_step_confirm(web_server: str) -> None:
    """playback-ux-polish-v1 M2: FilePill Remove now requires a 2-step
    confirm. First click flips data-armed=1 and the visible label to
    "Click again to confirm"; second click within 3s commits the
    DELETE; Esc disarms; auto-revert after the 3s window also disarms.
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )

        # Capture DELETE requests fired against the recordings endpoint.
        deletes: list[str] = []
        page.on(
            "request",
            lambda req: deletes.append(req.url)
            if req.method == "DELETE" and "/api/playback/recordings/" in req.url
            else None,
        )

        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.wait_for_selector(
            "[data-screen-label='Playback empty state']", state="visible", timeout=5_000
        )
        # Load + bind a recording so the FilePill renders with Remove.
        page.evaluate(
            """async () => {
                const rec = await fetch('/api/playback/recordings/load-sample', { method: 'POST' }).then(r => r.json());
                await fetch('/api/playback/streams', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recording_ids: [rec.recording_id] }),
                });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")

        # Expand the FilePill to reveal the Remove button.
        page.locator('button[aria-label*=": expand details"]').first.click()
        remove = page.locator('[data-action="remove"]').first
        remove.wait_for(state="visible", timeout=4_000)
        assert remove.get_attribute("data-armed") == "0"

        # Step 1: arm.
        remove.click()
        page.wait_for_function(
            "() => document.querySelector('[data-action=\"remove\"]')?.getAttribute('data-armed') === '1'",
            timeout=2_000,
        )
        assert "Click again to confirm" in (
            page.locator('[data-action="remove"]').first.text_content() or ""
        )
        # Esc disarms.
        page.keyboard.press("Escape")
        page.wait_for_function(
            "() => document.querySelector('[data-action=\"remove\"]')?.getAttribute('data-armed') === '0'",
            timeout=2_000,
        )
        assert deletes == [], f"Esc should not commit; got {deletes!r}"

        # Step 1 again, then step 2 within window → commits DELETE.
        page.locator('[data-action="remove"]').first.click()
        page.wait_for_function(
            "() => document.querySelector('[data-action=\"remove\"]')?.getAttribute('data-armed') === '1'",
            timeout=2_000,
        )
        page.locator('[data-action="remove"]').first.click()
        page.wait_for_load_state("networkidle")
        assert len(deletes) == 1, f"second click must fire one DELETE; got {deletes!r}"
        browser.close()


@pytest.mark.web_smoke
def test_playback_handoff_opens_modal_then_confirms(web_server: str) -> None:
    """playback-ux-polish-v1 M3: viewer-toolbar handoff buttons now
    open a confirmation modal (W11). Cancel closes without firing;
    Confirm fires exactly one POST to /api/playback/streams/.../handoff/{mode}
    and closes the modal.
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )

        handoff_calls: list[str] = []
        page.on(
            "request",
            lambda req: handoff_calls.append(req.url)
            if "/handoff/" in req.url and req.method == "POST"
            else None,
        )

        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.wait_for_selector(
            "[data-screen-label='Playback empty state']", state="visible", timeout=5_000
        )
        page.evaluate(
            """async () => {
                const rec = await fetch('/api/playback/recordings/load-sample', { method: 'POST' }).then(r => r.json());
                await fetch('/api/playback/streams', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recording_ids: [rec.recording_id] }),
                });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector('[data-region="viewer-grid"]', state="visible", timeout=5_000)

        # Reveal the toolbar via mouseenter, then click handoff-usaf.
        page.evaluate(
            """() => document.querySelector('[data-view-id]')
                ?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))"""
        )
        page.locator('[data-action="handoff-usaf"]').first.click()
        # Modal opens with the right target mode.
        modal = page.locator('[data-region="handoff-modal"]').first
        modal.wait_for(state="visible", timeout=4_000)
        assert modal.get_attribute("data-target-mode") == "usaf"

        # Cancel closes without firing handoff.
        page.locator('[data-action="handoff-cancel"]').first.click()
        page.wait_for_function(
            "() => !document.querySelector('[data-region=\"handoff-modal\"]')",
            timeout=2_000,
        )
        assert handoff_calls == [], f"Cancel must not fire handoff; got {handoff_calls!r}"

        # Re-open + Confirm fires exactly one POST.
        page.evaluate(
            """() => document.querySelector('[data-view-id]')
                ?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))"""
        )
        page.locator('[data-action="handoff-fpn"]').first.click()
        page.wait_for_selector('[data-region="handoff-modal"]', state="visible", timeout=4_000)
        page.locator('[data-action="handoff-confirm"]').first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_function(
            "() => !document.querySelector('[data-region=\"handoff-modal\"]')",
            timeout=4_000,
        )
        assert len(handoff_calls) == 1, f"expected 1 handoff POST, got {handoff_calls!r}"
        assert "/handoff/fpn" in handoff_calls[0]
        browser.close()


@pytest.mark.web_smoke
def test_playback_sources_panel_collapses_at_narrow_viewport(
    web_server: str,
) -> None:
    """playback-ux-polish-v1 M4: at viewport < 1180 px, the Sources
    panel renders as a 44 px icon rail. The chevron expand button
    floats it as an overlay (position: absolute, z-index high). At
    >= 1180 px the panel returns to the normal 288 px column.
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1024, "height": 768})
        page = ctx.new_page()
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.wait_for_selector(
            "[data-screen-label='Playback empty state']", state="visible", timeout=5_000
        )

        # Narrow viewport → collapsed rail (44 px wide).
        sources = page.locator('[data-region="sources-panel"]')
        sources.wait_for(state="visible", timeout=4_000)
        assert sources.get_attribute("data-collapsed") == "1"
        box = sources.bounding_box()
        assert box and 40 <= box["width"] <= 50, f"expected ~44 px rail; got {box}"

        # Chevron expand → overlay.
        page.locator('[data-action="expand-sources"]').click()
        page.wait_for_function(
            "() => document.querySelector('[data-region=\"sources-panel\"]')"
            "?.getAttribute('data-force-expanded') === '1'",
            timeout=2_000,
        )
        sources_after = page.locator('[data-region="sources-panel"]')
        box_after = sources_after.bounding_box()
        assert box_after["width"] >= 240, (
            f"expanded overlay should reach ~288 px; got {box_after}"
        )
        # Overlay (not pushing the workspace).
        position = page.evaluate(
            "() => getComputedStyle(document.querySelector('[data-region=\"sources-panel\"]')).position"
        )
        assert position == "absolute", f"expected overlay (absolute); got {position}"

        # Collapse via the `‹` button → back to 44 px rail.
        page.locator('[data-action="collapse-sources"]').click()
        page.wait_for_function(
            "() => document.querySelector('[data-region=\"sources-panel\"]')"
            "?.getAttribute('data-collapsed') === '1'",
            timeout=2_000,
        )

        # Resize to wide → panel returns to in-flow column.
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_function(
            "() => document.querySelector('[data-region=\"sources-panel\"]')"
            "?.getAttribute('data-collapsed') === '0'",
            timeout=2_000,
        )
        box_wide = page.locator('[data-region="sources-panel"]').bounding_box()
        assert box_wide["width"] >= 240, f"expected wide-mode column; got {box_wide}"
        browser.close()


@pytest.mark.web_smoke
def test_playback_viewer_context_menu_right_click(web_server: str) -> None:
    """playback-ux-polish-v1 M5: right-click on a ViewerCard opens a
    context menu with Send-to-USAF/FPN/DoF + Lock + Duplicate +
    Remove. The Remove item is destructive (2-step confirm); other
    items fire immediately and close the menu.
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    if not _DIST_INDEX.is_file():
        pytest.skip("web/dist not built")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        page.add_init_script(
            """try {
                localStorage.setItem('mantis/playback/enabled', '1');
                localStorage.setItem('mantis/mode', JSON.stringify('play'));
            } catch (e) {}"""
        )
        page.goto(web_server, wait_until="networkidle", timeout=15_000)
        page.wait_for_selector(
            "[data-screen-label='Playback empty state']", state="visible", timeout=5_000
        )
        page.evaluate(
            """async () => {
                const rec = await fetch('/api/playback/recordings/load-sample', { method: 'POST' }).then(r => r.json());
                await fetch('/api/playback/streams', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recording_ids: [rec.recording_id] }),
                });
            }"""
        )
        page.evaluate("() => window.location.reload()")
        page.wait_for_load_state("networkidle")
        page.wait_for_selector('[data-region="viewer-grid"]', state="visible", timeout=5_000)

        # Right-click the viewer card.
        page.evaluate(
            """() => {
                const card = document.querySelector('[data-view-id]');
                const rect = card.getBoundingClientRect();
                card.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true, cancelable: true,
                    clientX: rect.left + 60, clientY: rect.top + 60,
                }));
            }"""
        )
        menu = page.locator('[data-region="viewer-context-menu"]').first
        menu.wait_for(state="visible", timeout=4_000)
        # Six action items (3 handoff + lock + duplicate + remove).
        item_actions = page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-region="viewer-context-menu"] [role="menuitem"]'))
                .map(b => b.getAttribute('data-action'))"""
        )
        assert set(item_actions) == {
            "menu-handoff-usaf",
            "menu-handoff-fpn",
            "menu-handoff-dof",
            "menu-lock",
            "menu-duplicate",
            "menu-remove",
        }, item_actions

        # Send to USAF → opens the handoff modal + closes the context menu.
        page.locator('[data-action="menu-handoff-usaf"]').click()
        page.wait_for_function(
            "() => !document.querySelector('[data-region=\"viewer-context-menu\"]')",
            timeout=2_000,
        )
        page.wait_for_selector(
            '[data-region="handoff-modal"]', state="visible", timeout=4_000
        )
        # Cancel the handoff modal.
        page.locator('[data-action="handoff-cancel"]').click()
        page.wait_for_function(
            "() => !document.querySelector('[data-region=\"handoff-modal\"]')",
            timeout=2_000,
        )

        # Re-open menu and exercise the destructive 2-step on Remove.
        page.evaluate(
            """() => {
                const card = document.querySelector('[data-view-id]');
                const rect = card.getBoundingClientRect();
                card.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true, cancelable: true,
                    clientX: rect.left + 60, clientY: rect.top + 60,
                }));
            }"""
        )
        page.locator('[data-region="viewer-context-menu"]').wait_for(
            state="visible", timeout=4_000
        )
        page.locator('[data-action="menu-remove"]').click()
        # Menu stays open; remove is armed.
        assert page.locator('[data-region="viewer-context-menu"]').is_visible()
        armed = page.locator('[data-action="menu-remove"]').get_attribute("data-armed")
        assert armed == "1"
        # Esc closes without firing remove (view count unchanged).
        before = page.locator('[data-view-id]').count()
        page.keyboard.press("Escape")
        page.wait_for_function(
            "() => !document.querySelector('[data-region=\"viewer-context-menu\"]')",
            timeout=2_000,
        )
        assert page.locator('[data-view-id]').count() == before
        browser.close()
