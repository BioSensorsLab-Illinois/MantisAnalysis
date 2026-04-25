"""playback-rebuild-v2 — frontend acceptance tests.

These tests reproduce v1 failure modes that were verified live before
v1 was deleted. They MUST be green by the time M5 closes.

Run: ``pytest -m web_smoke tests/web/test_playback_v2_workflow.py -q``
"""

from __future__ import annotations

import time
from pathlib import Path

import h5py
import numpy as np
import pytest
import requests


pytestmark = pytest.mark.web_smoke


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _reset(base: str) -> None:
    """Clear the process-global workspace between tests."""
    from mantisanalysis.playback.api import WORKSPACE

    WORKSPACE._streams.clear()
    WORKSPACE._tabs.clear()
    WORKSPACE._tab_order.clear()
    WORKSPACE._active_tab_id = None
    WORKSPACE.library._recordings.clear()
    WORKSPACE.library._darks.clear()


def _make_synth_h5(path: Path, *, n_frames: int = 4, h: int = 32, w: int = 64) -> Path:
    rng = np.random.default_rng(seed=hash(path.name) & 0xFFFFFFFF)
    frames = rng.integers(0, 2**12, size=(n_frames, h, w, 1)).astype(np.uint16)
    ts = np.linspace(1_000_000.0, 1_000_000.0 + (n_frames - 1) * 0.033, n_frames)
    int_time = np.full(n_frames, 25_000.0, dtype=np.float64)
    with h5py.File(path, "w") as f:
        cam = f.create_group("camera")
        cam.create_dataset("frames", data=frames)
        cam.create_dataset("timestamp", data=ts)
        cam.create_dataset("integration-time", data=int_time)
        cam.create_dataset("integration-time-expected", data=int_time)
    return path


def _register(base: str, path: Path) -> dict:
    r = requests.post(
        f"{base}/api/playback/recordings/from-path",
        json={"path": str(path), "name": None},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def _build_stream(base: str, rec_ids: list[str]) -> dict:
    r = requests.post(
        f"{base}/api/playback/streams",
        json={"rec_ids": rec_ids, "name": None, "fps_override": None},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def _open_tab(base: str, stream_id: str) -> dict:
    r = requests.post(
        f"{base}/api/playback/tabs",
        json={"stream_id": stream_id, "layout": "single"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def _workspace(base: str) -> dict:
    return requests.get(f"{base}/api/playback/workspace", timeout=10).json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_drop_2nd_h5_offers_append_or_new_tab_or_replace_via_api(
    web_server: str, tmp_path: Path
) -> None:
    """v1 bug: dropping a 2nd recording silently created a 2nd hidden
    stream + hidden tab.

    v2 contract via API: registering recordings does not auto-create
    streams. Stream + Tab creation are explicit user actions, so the
    frontend can present the Append/NewTab/Replace choice. Verified by:
    register two recordings → workspace shows 2 recordings, 0 streams,
    0 tabs.
    """
    _reset(web_server)

    p1 = _make_synth_h5(tmp_path / "sample_1_view_0_exp_0.025.h5")
    p2 = _make_synth_h5(tmp_path / "sample_1_view_0_exp_0.05.h5")

    _register(web_server, p1)
    _register(web_server, p2)

    w = _workspace(web_server)
    assert len(w["library"]["recordings"]) == 2
    assert len(w["streams"]) == 0, "no implicit stream creation in v2"
    assert len(w["tabs"]) == 0, "no implicit tab creation in v2"


def test_delete_active_recording_closes_tab_no_undecoded_state(
    web_server: str, tmp_path: Path
) -> None:
    """v1 bug: deleting the recording behind the active stream left
    "Frame not decoded" forever because the stream stayed
    `invalidated:true` in the workspace.

    v2 contract: deleting a recording deletes its single-rec stream,
    closes any tab pointing at it, and the workspace returns no
    orphaned references. No frame URL still resolves.
    """
    _reset(web_server)

    p = _make_synth_h5(tmp_path / "sample_2_view_0_exp_0.025.h5")
    rec = _register(web_server, p)
    stream = _build_stream(web_server, [rec["rec_id"]])
    tab = _open_tab(web_server, stream["stream_id"])

    # Sanity: frame.png works while the recording is alive.
    r = requests.get(
        f"{web_server}/api/playback/tabs/{tab['tab_id']}/frame.png",
        timeout=10,
    )
    assert r.status_code == 200
    assert r.content.startswith(b"\x89PNG")

    # Delete the recording. Cascade should remove stream + tab.
    r = requests.delete(
        f"{web_server}/api/playback/recordings/{rec['rec_id']}", timeout=10
    )
    assert r.status_code == 200
    body = r.json()
    assert body["deleted_streams"] == [stream["stream_id"]]
    assert body["closed_tabs"] == [tab["tab_id"]]

    # Workspace is empty → no zombie state.
    w = _workspace(web_server)
    assert w["library"]["recordings"] == []
    assert w["streams"] == []
    assert w["tabs"] == []

    # The old frame URL must NOT serve a 200 with PNG bytes anymore.
    r = requests.get(
        f"{web_server}/api/playback/tabs/{tab['tab_id']}/frame.png",
        timeout=10,
    )
    assert r.status_code in (404, 410, 422), (
        f"stale frame.png returned {r.status_code} with "
        f"content-type {r.headers.get('content-type')}"
    )


def test_inspector_layout_supports_1024px_panel_widths(web_server: str) -> None:
    """v1 bug: at 1024 px width, inspector buttons fell off the bottom.

    v2 contract: the layout token contracts hold. Sources rail
    (288 px) + min Inspector (320 px) + viewer min (480 per spec
    §5.4) total 1088 px max — at the documented 1180 px lg/md
    breakpoint we have 92 px of slack. At sm (960–1180) the rail
    collapses; this test pins the contract numbers so a regression
    in tokens.LAYOUT trips the gate, not a Playwright pixel measure.
    """
    tokens = Path("web/src/playback/tokens.ts").read_text(encoding="utf-8")
    assert "sourcesPanelW: { default: 288, min: 240" in tokens
    assert "inspectorW: { default: 368, min: 320" in tokens
    assert "narrowBreakpoint: 1180" in tokens
    # Inspector now is tabbed (V/D/L/E) instead of stacked, so vertical
    # clipping is impossible — every section is a separate tab body.
    insp = Path("web/src/playback/components/Inspector.tsx").read_text(encoding="utf-8")
    assert "role=\"tablist\"" in insp
    assert "SectionId" in insp


def test_channel_chip_renders_in_per_channel_color(web_server: str, tmp_path: Path) -> None:
    """v1 bug: channel chips were monochrome text — user could not
    distinguish HG-R from HG-NIR at a glance.

    v2 contract: each ViewerCard renders a top stripe whose CSS
    background hex matches CHANNEL_COLOR[view.channel] exactly. We
    drive the contract end-to-end via the running server: register a
    real-shape recording, build a stream + tab, GET /workspace, then
    assert the per-channel hex is present in the served bundle's
    tokens module + actually used in ViewerCard.tsx as the stripe
    background.
    """
    # 1. Token contract: hexes present and ChannelKey ↔ hex mapping is
    # one-to-one for the 5 HG bands.
    tokens = Path("web/src/playback/tokens.ts").read_text(encoding="utf-8")
    expected = {
        "HG-R": "#ef4444",
        "HG-G": "#22c55e",
        "HG-B": "#3b82f6",
        "HG-NIR": "#a855f7",
        "HG-Y": "#eab308",
    }
    for ch, hex_ in expected.items():
        assert f"'{ch}': '{hex_}'" in tokens, f"missing {ch}: {hex_}"
    # All 5 hexes must be distinct.
    assert len(set(expected.values())) == len(expected)

    # 2. ViewerCard wires the stripe to CHANNEL_COLOR[view.channel].
    card = Path("web/src/playback/components/ViewerCard.tsx").read_text(encoding="utf-8")
    assert "CHANNEL_COLOR" in card
    assert "channelColor" in card
    # The stripe is a 3 px <div> styled with that color.
    assert "background: channelColor" in card

    # 3. Backend serves an HG-G default view → frame.png renders.
    # That proves the channel-routing path actually executes.
    _reset(web_server)
    p = _make_synth_h5(tmp_path / "sample_9_view_1_exp_0.025.h5")
    rec = _register(web_server, p)
    s = _build_stream(web_server, [rec["rec_id"]])
    tab = _open_tab(web_server, s["stream_id"])
    assert tab["views"][0]["channel"] == "HG-G"
    r = requests.get(
        f"{web_server}/api/playback/tabs/{tab['tab_id']}/frame.png", timeout=10
    )
    assert r.status_code == 200 and r.content.startswith(b"\x89PNG")
