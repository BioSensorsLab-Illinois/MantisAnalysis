# playwright-verifier — recording-inspection-implementation-v1 (M12 close)

Reviewed by: `playwright-verifier` agent
Date: 2026-04-25

## Scope

- `tests/web/test_playback_boot.py` (16 web_smoke tests, M5–M11)
- `tests/web/test_playback_visual_baselines.py` (5 baseline-capture tests, M12)
- `tests/web/conftest.py` (web_server fixture)

## Summary

Test design is broadly sound — `data-region` / `data-action` /
`data-section` / `data-mode-tile` attributes give stable
accessibility-equivalent selectors, and the empty-state CTA is
reached via `get_by_role`. Real P0/P1 issues around state
leakage, web-first assertion discipline, console-error hygiene,
and one wait-strategy bug that explains the cold-start flake.

## Coverage gaps (untested user flows)

- CCM auto-from-patches (Inspector → Corrections section)
- Frame-LRU cap slider (Advanced section)
- GIF export size cap + error banner
- Dark strategy effective on the rendered img (only `aria-pressed`
  is asserted, not the preview img URL/pixels)
- Stream Builder Cancel path (only Apply is tested)
- Inspector preset Save / Load
- Overlay Builder field edits before Apply
- `4` keypress shortcut (docstring promises it; no test asserts)
- Console-error absence in 7/13 active tests

## Findings

| Sev | File:Line | Issue | One-line patch |
|---|---|---|---|
| P0 | `test_playback_boot.py:172–224` | **Cold-start flake explained.** Test 5 relies on `mode=play` being persisted from a previous test; on a cold first-run the empty state never appears within 5s because mode is `usaf`. | Set `mantis/mode=play` in localStorage in `add_init_script` before reload + click the rail tile after reload. |
| P0 | `test_playback_boot.py:97 + 607` | `page.wait_for_timeout(500)` used as a primary wait strategy — flaky on slow CI. Cardinal sin per `playwright-e2e-verification/SKILL.md`. | Replace with `expect(page.locator(...)).to_be_visible()` (L97) and `wait_for_load_state("networkidle")` then re-assert request count (L607). |
| P0 | `conftest.py:53` + `test_playback_visual_baselines.py:44–80` | Session-scoped `web_server` shares one `PlaybackStore` across all 16+5 tests; cleanup is per-test, ad-hoc, and not universal. M5/M6/eviction tests don't clean up. | Hoist cleanup helper into `conftest.py` as a function-scoped autouse fixture that DELETEs `streams + recordings + darks` before each test. |
| P1 | `test_playback_boot.py:92, 130, 154, 218, 222, 260, 262, 281, 325, 363, 401, 414, 458, 464, 501, 521, 556` | `page.wait_for_selector` instead of web-first `expect(...).to_be_visible()`. | Replace with `expect(page.locator(sel)).to_be_visible(timeout=N)`. |
| P1 | `test_playback_boot.py:228–291, 295–364, 368–422, 426–466, 469–523, 527–569, 573–614` | Console / pageerror not attached in 7 of 13 active tests; a console flood would not fail these tests. | Add `page.on("console"...)` + `page.on("pageerror"...)` + final `assert not errors` in each test. Factor into helper. |
| P1 | `test_playback_boot.py:339–351` | DOM-script colormap dispatch bypasses the user-facing locator. | Add `aria-label="Colormap"` to the source `<select>` and use `page.get_by_label("Colormap").select_option("inferno")`. |
| P1 | `test_playback_boot.py:561–568` | Computed-style assertion on USAF tile couples the test to CSS. | Add `aria-pressed="true"` / `data-active="true"` and assert via attribute. |
| P1 | `test_playback_visual_baselines.py:91` | `page.wait_for_timeout(800)` "let the preview img cycle" — primary wait strategy. Baselines may differ across timing. | `page.wait_for_function("() => Array.from(document.querySelectorAll('[data-view-id] img')).every(i=>i.naturalWidth>0)", timeout=4000)`. |
| P1 | `test_playback_boot.py:587–613` | Eviction test never confirms the workspace is mounted before dispatching. | Click the Playback rail tile + assert empty state visible *before* taking the baseline count + dispatching. |
| P2 | `test_playback_boot.py:461` | `modal.locator('xpath=..')` walk-up is brittle. | Add `data-action="export-confirm"` to the modal's primary CTA and target it directly. |
| P2 | `test_playback_visual_baselines.py:75` | Reload + immediate `wait_for_selector` — fonts may not have settled, baselines may differ across runs. | Add `page.evaluate("document.fonts.ready")` before `page.screenshot(...)`. |
| P2 | `test_playback_visual_baselines.py:170` | Unicode `2 × 2` button name; brittle to source rename. | Use the existing `[data-layout="2x2"]` selector. |
| P2 | `test_playback_boot.py` (all) | Each test re-launches Chromium (~0.6s × 13 wasted). | Migrate to `def test_x(page: Page, web_server: str)`. |
| P2 | `test_playback_visual_baselines.py:1–23` | Docstring correctly says "does NOT diff against prior baselines". No action. | — |
| P2 | `test_playback_boot.py:97–103` | Babel-transformer filter is dead code post-Phase 3 Vite cutover. | Drop or downgrade. |

## Proposed additions

1. `test_playback_dark_strategy_changes_image_url`
2. `test_playback_ccm_auto_from_patches`
3. `test_playback_export_video_gif_size_cap_banner`
4. `test_playback_4_keypress_shortcut_with_flag`
5. `test_playback_stream_builder_cancel`
6. `test_playback_no_console_errors_across_all_tabs`

## Disposition (M12)

- **P0-1 (cold-start flake fix):** apply now in M12. Add init-script
  to set `mantis/mode=play` + reclick rail tile after reload.
- **P0-2 (wait_for_timeout removal):** apply now in M12 — replace
  the two flagged sites with web-first assertions.
- **P0-3 (state-cleanup autouse fixture):** apply now in M12. Hoist
  into conftest.
- **P1 batch:** track in BACKLOG (test-cleanup-v1 follow-up
  initiative). Resolving inline doubles M12 surface area; ship the
  cleanup as a focused follow-up.
- **P2 batch:** also BACKLOG.
- **Coverage proposals 1–6:** add to BACKLOG with one-line stubs;
  none gate the initiative close (the existing 16+5 tests already
  cover the M0 P0/P1 risks).
