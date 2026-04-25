"""Launcher — starts the local FastAPI server and opens the browser.

Exposed as the `mantisanalysis` console script via pyproject.toml. For
library use, import `mantisanalysis.server.app` directly and mount it
with your own ASGI runner.
"""

from __future__ import annotations

import argparse
import logging
import sys
import threading
import time
import webbrowser

log = logging.getLogger("mantisanalysis")


def _open_browser_when_ready(url: str, host: str, port: int, timeout_s: float = 8.0) -> None:
    """Poll the health endpoint, then open the default browser."""
    import socket

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.25):
                break
        except OSError:
            time.sleep(0.1)
    webbrowser.open(url, new=1)


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="mantisanalysis",
        description="Launch the MantisAnalysis web GUI (local server + browser).",
    )
    parser.add_argument(
        "path", nargs="?", default=None, help="optional image / H5 file to auto-load at startup"
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true", help="do not auto-open the browser")
    parser.add_argument(
        "--reload", action="store_true", help="uvicorn auto-reload on source change (dev only)"
    )
    args = parser.parse_args(argv)

    # Pre-seed a source from a given path so the UI shows it on first load.
    if args.path:
        from pathlib import Path

        from .session import STORE

        p = Path(args.path).expanduser()
        if p.exists():
            try:
                STORE.load_from_path(p)
            except Exception as exc:
                print(f"warning: failed to pre-load {p}: {exc}", file=sys.stderr)
        else:
            print(f"warning: {p} not found; skipping pre-load", file=sys.stderr)

    url = f"http://{args.host}:{args.port}/"
    print(f"MantisAnalysis → {url}")
    if not args.no_browser:
        threading.Thread(
            target=_open_browser_when_ready,
            args=(url, args.host, args.port),
            daemon=True,
        ).start()

    import uvicorn

    # Importing the app lazily means `python -m mantisanalysis --help` stays fast.
    uvicorn.run(
        "mantisanalysis.server:app",
        host=args.host,
        port=args.port,
        reload=bool(args.reload),
        log_level="info",
    )
    return 0


def main_argv() -> int:
    return main(None)


if __name__ == "__main__":
    sys.exit(main())
