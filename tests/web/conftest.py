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
