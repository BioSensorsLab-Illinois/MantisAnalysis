"""playback-rebuild-v2 — failing reproduction tests for the frontend.

These tests are the **acceptance contract** for M2-M5. They MUST fail
at M0 (because the new shell isn't wired yet) and MUST turn green by
the time M5 closes.

Run: ``pytest -m web_smoke tests/web/test_playback_v2_workflow.py -q``
"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.web_smoke


def test_drop_2nd_h5_offers_append_or_new_tab_modal(web_server: str) -> None:
    """v1 bug: dropping a 2nd recording silently created a 2nd hidden
    stream + hidden tab.

    v2 contract: dropping a 2nd recording while a tab is open prompts
    "Append to current stream / Open as new tab / Replace current",
    with sensible default highlighted (Append if sample/view match).
    """

    pytest.fail("M4: implement AddFilesDialog modal + drag-drop wiring")


def test_delete_active_recording_closes_tab_no_undecoded_state(web_server: str) -> None:
    """v1 bug: deleting the recording behind the active stream left
    "Frame not decoded" forever because the stream stayed
    `invalidated:true` in the workspace.

    v2 contract: deletion confirmation modal explains the cascade,
    then the tab closes cleanly. No 500-returning frame URLs persist.
    """

    pytest.fail("M2+M4: wire SSE-driven workspace + delete-confirm modal")


def test_inspector_renders_at_1024px_no_clipped_buttons(web_server: str) -> None:
    """v1 bug: at 1024 px width, inspector buttons fell off the bottom
    of an 8-section vertical stack.

    v2 contract: inspector uses tabs (View / Display / Color / Overlay
    / Labels / Export); at 1024 px every tab + every action button is
    fully visible inside the viewport.
    """

    pytest.fail("M5: implement tabbed Inspector + 1024-px responsive check")


def test_channel_chip_renders_in_per_channel_color(web_server: str) -> None:
    """v1 bug: channel chips were monochrome text — user could not
    distinguish HG-R from HG-NIR at a glance.

    v2 contract: each ViewerCard shows a colored top border + a
    colored channel chip whose background matches CHANNEL_COLOR[ch].
    """

    pytest.fail("M3+M4: implement ViewerCard with tokens.CHANNEL_COLOR border")
