"""Playwright web-smoke fixtures.

Boot the real FastAPI app on an ephemeral port, yield the URL to tests,
and tear the server down at session end. Skipped gracefully when the
`playwright` package isn't installed (the package is an optional extra —
see `[project.optional-dependencies].web-smoke` in pyproject.toml).
"""

from __future__ import annotations

import os
import socket
import threading
import time
from typing import Iterator

import pytest

# recording-inspection-implementation-v1 risk-skeptic P1-I:
# The /api/playback/recordings/load-sample (and dark / stream) test-only
# routes are gated by MANTIS_PLAYBACK_TEST=1, read at FastAPI app
# construction time. The conftest module imports
# `mantisanalysis.server` once per session — the env var must be set
# *before* that import or the test routes never mount. Setting it here
# (before any fixture body runs) ensures every web_smoke test file
# sees the gate as enabled.
os.environ.setdefault("MANTIS_PLAYBACK_TEST", "1")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _server_alive(port: int, timeout_s: float = 10.0) -> bool:
    import urllib.error
    import urllib.request

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/health", timeout=1
            ) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            time.sleep(0.15)
    return False


@pytest.fixture(scope="session")
def web_server() -> Iterator[str]:
    """Start `mantisanalysis.server:app` via uvicorn in a background thread."""
    try:
        import uvicorn

        from mantisanalysis.server import app
    except ImportError as e:  # pragma: no cover
        pytest.skip(f"mantisanalysis server deps missing: {e}")

    port = _free_port()
    config = uvicorn.Config(
        app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    if not _server_alive(port):
        server.should_exit = True
        thread.join(timeout=2)
        pytest.fail(f"FastAPI server did not come up on port {port}")
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=4)


@pytest.fixture(autouse=True)
def _reset_state_between_web_tests(web_server: str) -> Iterator[None]:
    """recording-inspection-implementation-v1 M12 playwright-verifier
    P0 + test-coverage P1-D: hoist the per-test state cleanup into a
    conftest autouse fixture. The session-scoped `web_server` shares
    one `PlaybackStore` and one analysis-mode `STORE` across all
    Tier 4 tests. Ad-hoc cleanup inside individual tests was
    inconsistent and caused the cold-start flake on
    `test_playback_stream_builder_opens_for_two_recordings`.

    Pokes the in-process singletons directly (cheaper + more
    deterministic than HTTP DELETE round-trips). Safe because both
    stores live in the same process as the test runner under the
    threaded uvicorn fixture.
    """
    try:
        from mantisanalysis.playback_session import PLAYBACK_STORE
        from mantisanalysis.session import STORE as _ANALYSIS_STORE

        PLAYBACK_STORE._recordings.clear()
        PLAYBACK_STORE._darks.clear()
        PLAYBACK_STORE._streams.clear()
        PLAYBACK_STORE._jobs.clear()
        PLAYBACK_STORE._frame_lru.clear()
        with _ANALYSIS_STORE._lock:
            _ANALYSIS_STORE._items.clear()
            _ANALYSIS_STORE._evicted.clear()
    except Exception:
        # If the modules are not importable (e.g. partial install),
        # the test will skip itself anyway.
        pass
    yield
