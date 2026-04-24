"""B-0015 — minimal Playwright smoke.

Goal: catch "the React app crashed on boot" regressions before users do.
Specifically:
  * The root HTML loads and React mounts ≥1 child under `#root`.
  * No uncaught console errors during the first 2 s of life.
  * The three mode-rail buttons (USAF / FPN / DoF) render.

To run:
    pip install -e '.[web-smoke]'
    playwright install chromium
    npm install && npm run build   # post bundler-migration-v1 Phase 3
    pytest -m web_smoke

The fixture is session-scoped so only one uvicorn boot is paid for.
"""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

import pytest


_REPO_ROOT = Path(__file__).resolve().parents[2]
_DIST_INDEX = _REPO_ROOT / "web" / "dist" / "index.html"


def test_isp_modes_api_reachable(web_server: str) -> None:
    """ISP-modes-v1: /api/isp/modes returns the v1 mode set with
    rgb_nir's documented defaults. Doesn't require a browser — plain
    HTTP smoke so it runs under the default pytest invocation, not
    only under ``-m web_smoke``. (The module-scope ``importorskip``
    was moved into ``test_root_page_boots`` so this test is collected
    even in environments that don't have playwright installed.
    See bugfix bug_008.)
    """
    with urllib.request.urlopen(f"{web_server}/api/isp/modes", timeout=5) as r:
        data = json.loads(r.read().decode())
    ids = {m["id"] for m in data}
    assert {"bare_single", "bare_dualgain", "rgb_nir",
            "polarization_single", "polarization_dual"}.issubset(ids)
    rgb_nir = next(m for m in data if m["id"] == "rgb_nir")
    # Locked defaults — match feedback_locked_constants.md.
    assert tuple(rgb_nir["default_origin"]) == (0, 0)
    assert tuple(rgb_nir["default_sub_step"]) == (2, 2)
    assert tuple(rgb_nir["default_outer_stride"]) == (4, 4)
    assert rgb_nir["supports_rgb_composite"] is True
    nir_slot = next(c for c in rgb_nir["channels"] if c["slot_id"] == "nir")
    assert nir_slot["renameable"] is True


@pytest.mark.web_smoke
def test_root_page_boots(web_server: str) -> None:
    # Import-skip lives inside the test body (not at module scope) so
    # the non-browser test_isp_modes_api_reachable above runs without
    # needing playwright installed. See bugfix bug_008.
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright  # noqa: E402

    # bundler-migration-v1 Phase 3 — the server now serves web/dist/
    # as the SPA. Without the build the server returns a friendly
    # "build the frontend first" page, not React — skip in that case
    # so CI that doesn't have Node still passes the non-browser test.
    if not _DIST_INDEX.is_file():
        pytest.skip(
            "web/dist/index.html not built. Run `npm install && npm run build`."
        )

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

    # Filter out benign warnings (React DevTools hint, etc.). The
    # Babel-standalone transformer warning is gone post-Phase 3 but
    # the filter is cheap to keep for older checkouts.
    errors = [
        e
        for e in errors
        if "in-browser Babel transformer" not in e
        and "React DevTools" not in e
    ]
    assert not errors, f"console errors during boot: {errors}"
