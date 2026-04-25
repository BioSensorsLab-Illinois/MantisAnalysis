"""recording-inspection-implementation-v1 M12 — visual-regression baselines.

Captures canonical PNG screenshots of the Playback mode under known
states (empty / sample loaded / 2x2 layout / dark mode / inspector
expanded) and writes them to
`.agent/runs/recording-inspection-implementation-v1/screenshots/`.

This is an opt-in test:

- Marked `web_smoke` so it runs in the existing CI lane.
- Marked `slow` so local quick runs can `-m "web_smoke and not slow"`
  to skip it.
- Idempotent: rerunning overwrites the baselines (intentional, per
  ExecPlan §11 — baselines change as the UI evolves; the test just
  guarantees they exist and are captured at canonical states).

What this test is NOT:
- It does NOT diff against prior baselines. That's a follow-up
  visual-regression-infra-v1 initiative (BACKLOG.md). Today, the
  baselines on disk are the *evidence* a reviewer can inspect.
- It does NOT exercise the export modals or the Stream Builder
  (those have dedicated Playwright tests in test_playback_boot.py).
"""

from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = [pytest.mark.web_smoke]

_BASELINE_DIR = Path(
    "/Users/zz4/BSL/MantisAnalysis/.agent/runs/"
    "recording-inspection-implementation-v1/screenshots"
)


def _ensure_dir() -> Path:
    _BASELINE_DIR.mkdir(parents=True, exist_ok=True)
    return _BASELINE_DIR


def _enable_playback(page, web_server: str, theme: str = "light") -> None:
    """Set the feature-flag, force the requested theme, clear any stale
    Playback state, and reload.

    `theme` defaults to 'light'. The previous baseline-capture relied
    purely on `color_scheme` browser context; the app also persists
    `mantis/theme` in localStorage and that wins, so without setting
    the localStorage entry both 'light' and 'dark' baseline tests
    end up rendering whatever the app last persisted (P2 from M12
    react-ui-ux review).
    """
    # Wipe server-side PlaybackStore so a session-scoped re-run starts clean.
    import urllib.request
    try:
        for kind in ("streams", "recordings", "darks"):
            with urllib.request.urlopen(
                f"{web_server}/api/playback/{kind}", timeout=2
            ) as r:
                if r.status == 200:
                    import json
                    items = json.loads(r.read())
                    for item in items:
                        ident = item.get(
                            kind[:-1] + "_id"
                        ) or item.get("id")
                        if not ident:
                            continue
                        req = urllib.request.Request(
                            f"{web_server}/api/playback/{kind}/{ident}",
                            method="DELETE",
                        )
                        try:
                            urllib.request.urlopen(req, timeout=2)
                        except Exception:
                            pass
    except Exception:
        pass
    page.evaluate(
        "(theme) => { "
        "  localStorage.setItem('mantis/playback/enabled', '1'); "
        "  localStorage.setItem('mantis/theme', JSON.stringify(theme)); "
        "  localStorage.setItem('mantis/mode', JSON.stringify('play')); "
        "}",
        theme,
    )
    page.reload(wait_until="domcontentloaded")
    page.wait_for_selector("[data-mode-tile='play']", timeout=5_000)
    page.click("[data-mode-tile='play']")
    page.wait_for_selector(
        "[data-screen-label='Playback empty state']", timeout=5_000
    )
    # Wait for fonts to settle so baselines don't differ by glyph
    # rendering (M12 playwright-verifier P2).
    page.evaluate("() => document.fonts && document.fonts.ready")


def _load_synthetic_sample(page) -> None:
    btn = page.get_by_role(
        "button", name="Load synthetic sample", exact=True
    )
    btn.wait_for(state="visible", timeout=5_000)
    btn.click()
    page.wait_for_selector("[data-region='viewer-grid']", timeout=10_000)
    # M12 playwright-verifier P1: wait for the preview img to actually
    # paint (naturalWidth>0), not a blind sleep. Baselines must include
    # the rendered preview, not the loading state.
    page.wait_for_function(
        "() => Array.from(document.querySelectorAll('[data-view-id] img'))"
        ".every(i => i.naturalWidth > 0)",
        timeout=8_000,
    )
    page.evaluate("() => document.fonts && document.fonts.ready")


def test_baseline_empty_state_light(web_server: str) -> None:
    pw = pytest.importorskip("playwright.sync_api")
    out = _ensure_dir()
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="light",
        )
        page = ctx.new_page()
        page.goto(web_server)
        _enable_playback(page, web_server)
        page.screenshot(
            path=str(out / "M12_baseline_empty_state_light_1440x900.png"),
            full_page=False,
        )
        ctx.close()
        browser.close()


def test_baseline_empty_state_dark(web_server: str) -> None:
    pw = pytest.importorskip("playwright.sync_api")
    out = _ensure_dir()
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="dark",
        )
        page = ctx.new_page()
        page.goto(web_server)
        _enable_playback(page, web_server, theme="dark")
        page.screenshot(
            path=str(out / "M12_baseline_empty_state_dark_1440x900.png"),
            full_page=False,
        )
        ctx.close()
        browser.close()


def test_baseline_sample_loaded_single_layout(web_server: str) -> None:
    pw = pytest.importorskip("playwright.sync_api")
    out = _ensure_dir()
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="light",
        )
        page = ctx.new_page()
        page.goto(web_server)
        _enable_playback(page, web_server)
        _load_synthetic_sample(page)
        page.screenshot(
            path=str(out / "M12_baseline_sample_loaded_single_1440x900.png"),
            full_page=False,
        )
        ctx.close()
        browser.close()


def test_baseline_sample_loaded_2x2_layout(web_server: str) -> None:
    pw = pytest.importorskip("playwright.sync_api")
    out = _ensure_dir()
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            color_scheme="light",
        )
        page = ctx.new_page()
        page.goto(web_server)
        _enable_playback(page, web_server)
        _load_synthetic_sample(page)
        page.get_by_role("button", name="2 × 2").click()
        page.wait_for_timeout(400)
        page.screenshot(
            path=str(out / "M12_baseline_sample_loaded_2x2_1440x900.png"),
            full_page=False,
        )
        ctx.close()
        browser.close()


def test_baseline_responsive_1024(web_server: str) -> None:
    """Narrow-window baseline at 1024 px wide (per UI plan §narrow)."""
    pw = pytest.importorskip("playwright.sync_api")
    out = _ensure_dir()
    with pw.sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1024, "height": 768},
            color_scheme="light",
        )
        page = ctx.new_page()
        page.goto(web_server)
        _enable_playback(page, web_server)
        _load_synthetic_sample(page)
        page.screenshot(
            path=str(out / "M12_baseline_responsive_1024x768.png"),
            full_page=False,
        )
        ctx.close()
        browser.close()
