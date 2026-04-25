"""Tier 3 round-trip tests for the /api/playback/* namespace (M4).

Boots the FastAPI app via `fastapi.testclient.TestClient` and exercises:

  - GET  /api/playback/health
  - POST /api/playback/recordings/load-path
  - POST /api/playback/streams
  - GET  /api/playback/streams/{sid}/frame/{n}.png
  - GET  /api/playback/streams/{sid}/lookup
  - DELETE /api/playback/recordings/{rid} (invalidates the stream)

Test-only endpoints are exercised when MANTIS_PLAYBACK_TEST=1 is set
*before* the server module is imported (per risk-skeptic P1-I).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

# Per risk-skeptic P1-I, the test-only routes must be gated at app
# construction time. Set the env var BEFORE importing the server.
os.environ["MANTIS_PLAYBACK_TEST"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from mantisanalysis.playback_session import PLAYBACK_STORE  # noqa: E402
from mantisanalysis.server import create_app  # noqa: E402
from tests.unit._h5_fixtures import write_synthetic_recording  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    # Reset the singleton store before each test for isolation.
    PLAYBACK_STORE._recordings.clear()
    PLAYBACK_STORE._darks.clear()
    PLAYBACK_STORE._streams.clear()
    PLAYBACK_STORE._jobs.clear()
    PLAYBACK_STORE._frame_lru.clear()
    return TestClient(create_app())


@pytest.fixture()
def synth_h5(tmp_path: Path) -> Path:
    p = tmp_path / "rec.h5"
    write_synthetic_recording(p, n_frames=8, h=32, w=64,
                              exposure_us=20_000, fps=30.0)
    return p


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------


def test_health_ok(client: TestClient) -> None:
    r = client.get("/api/playback/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "viridis" in body["supported_colormaps"]
    assert "gif" in body["supported_video_formats"]
    assert body["live_stream_supported"] is False
    assert body["test_endpoints_enabled"] is True
    assert "rgb_nir" in body["supported_isp_modes"]


def test_health_lists_all_5_isp_modes(client: TestClient) -> None:
    r = client.get("/api/playback/health")
    body = r.json()
    expected = {"rgb_nir", "bare_single", "bare_dualgain",
                "polarization_single", "polarization_dual"}
    assert expected.issubset(set(body["supported_isp_modes"]))


# ---------------------------------------------------------------------------
# Recording inspect / load-path / list / delete
# ---------------------------------------------------------------------------


def test_inspect_returns_meta_payload(client: TestClient, synth_h5: Path) -> None:
    r = client.post("/api/playback/recordings/inspect",
                     json={"path": str(synth_h5)})
    assert r.status_code == 200
    body = r.json()
    assert body["frame_count"] == 8
    assert "HG-G" in body["channels"]
    assert body["errors"] == []


def test_inspect_missing_file_returns_meta_with_error(client: TestClient,
                                                      tmp_path: Path) -> None:
    """Inspect is non-throwing — file-not-found shows up in `errors`."""
    r = client.post("/api/playback/recordings/inspect",
                     json={"path": str(tmp_path / "nope.h5")})
    assert r.status_code == 200
    assert any(e["code"] == "E-LAYOUT" for e in r.json()["errors"])


def test_load_path_registers_recording(client: TestClient, synth_h5: Path
                                        ) -> None:
    r = client.post("/api/playback/recordings/load-path",
                     json={"path": str(synth_h5)})
    assert r.status_code == 200
    body = r.json()
    assert "recording_id" in body
    assert body["frame_count"] == 8

    # List should include it.
    rl = client.get("/api/playback/recordings")
    assert rl.status_code == 200
    assert any(r2["recording_id"] == body["recording_id"] for r2 in rl.json())


def test_load_path_missing_file_404(client: TestClient, tmp_path: Path) -> None:
    r = client.post("/api/playback/recordings/load-path",
                     json={"path": str(tmp_path / "nope.h5")})
    assert r.status_code in (404, 422)


# ---------------------------------------------------------------------------
# Streams
# ---------------------------------------------------------------------------


def test_build_stream_round_trip(client: TestClient, synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    rid = rec["recording_id"]
    r = client.post("/api/playback/streams", json={
        "recording_ids": [rid],
        "name": "test stream",
        "continuity_threshold_s": 1.0,
    })
    assert r.status_code == 200
    sid = r.json()["stream_id"]

    g = client.get(f"/api/playback/streams/{sid}")
    assert g.status_code == 200
    assert g.json()["total_frames"] == 8


def test_stream_lookup(client: TestClient, synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    r = client.get(f"/api/playback/streams/{sid}/lookup", params={"frame": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["frame"] == 3
    assert body["recording_id"] == rec["recording_id"]
    assert body["local_frame"] == 3


def test_delete_recording_invalidates_stream(client: TestClient,
                                              synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    d = client.delete(f"/api/playback/recordings/{rec['recording_id']}")
    assert d.status_code == 200
    assert sid in d.json()["stream_ids_invalidated"]


# ---------------------------------------------------------------------------
# Frame PNG (the WYSIWYG endpoint)
# ---------------------------------------------------------------------------


def test_frame_png_returns_image(client: TestClient, synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    r = client.get(f"/api/playback/streams/{sid}/frame/0.png", params={
        "channel": "HG-G",
        "colormap": "viridis",
        "low": 0,
        "high": 255,
    })
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert r.headers.get("cache-control") == "no-store"


def test_frame_png_out_of_range_returns_422(client: TestClient,
                                              synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    r = client.get(f"/api/playback/streams/{sid}/frame/99.png")
    assert r.status_code == 422


def test_frame_png_unknown_stream_returns_404(client: TestClient) -> None:
    r = client.get("/api/playback/streams/abc123/frame/0.png")
    assert r.status_code == 404


def test_frame_png_with_overlay_rgb(client: TestClient, synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    r = client.get(f"/api/playback/streams/{sid}/frame/0.png", params={
        "view_type": "rgb",
        "channels": "HG-R,HG-G,HG-B",
        "low": 0,
        "high": 255,
        "overlay_on": "1",
        "overlay_channel": "HG-NIR",
        "overlay_low": 0,
        "overlay_high": 255,
        "overlay_blend": "alpha",
        "overlay_strength": 0.5,
        "overlay_cmap": "inferno",
    })
    assert r.status_code == 200
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# Test-only synthetic endpoints (gated)
# ---------------------------------------------------------------------------


def test_load_sample_recording_round_trip(client: TestClient) -> None:
    r = client.post("/api/playback/recordings/load-sample")
    assert r.status_code == 200
    rid = r.json()["recording_id"]
    g = client.get(f"/api/playback/recordings/{rid}")
    assert g.status_code == 200


def test_load_sample_dark_round_trip(client: TestClient) -> None:
    r = client.post("/api/playback/darks/load-sample")
    assert r.status_code == 200
    body = r.json()
    assert body["frames_averaged"] > 0


def test_full_synthetic_chain_inspect_to_render(client: TestClient) -> None:
    """Sample → stream → frame.png in a single test, the way M5+ tests
    the workspace loop."""
    rec = client.post("/api/playback/recordings/load-sample").json()
    sid = client.post("/api/playback/streams",
                       json={"recording_ids": [rec["recording_id"]]}
                       ).json()["stream_id"]
    r = client.get(f"/api/playback/streams/{sid}/frame/0.png")
    assert r.status_code == 200
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n"


# ---------------------------------------------------------------------------
# Eviction → 410
# ---------------------------------------------------------------------------


def test_get_recording_after_eviction_returns_410(client: TestClient,
                                                    synth_h5: Path) -> None:
    rec = client.post("/api/playback/recordings/load-path",
                       json={"path": str(synth_h5)}).json()
    rid = rec["recording_id"]
    client.delete(f"/api/playback/recordings/{rid}")
    g = client.get(f"/api/playback/recordings/{rid}")
    assert g.status_code == 410
    body = g.json()
    assert body["detail"]["kind"] == "recording"
    assert body["detail"]["evicted_id"] == rid


# ---------------------------------------------------------------------------
# Health: ffmpeg gate must not crash even when imageio_ffmpeg is absent
# ---------------------------------------------------------------------------


def test_health_ffmpeg_gate_does_not_crash(client: TestClient) -> None:
    r = client.get("/api/playback/health")
    assert r.status_code == 200
    body = r.json()
    # Either present or absent, but the field is always there.
    assert "ffmpeg_available" in body
    assert isinstance(body["ffmpeg_available"], bool)
