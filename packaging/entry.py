"""PyInstaller entry point.

Plain `mantisanalysis.app.main()` shim — kept as a tiny standalone module
so PyInstaller has a top-level script to freeze. It also suppresses the
console window close noise that Windows users see when the launcher
exits quickly on a startup error.
"""

from __future__ import annotations

import multiprocessing
import sys


def _pause_on_error(rc: int) -> None:
    if rc == 0:
        return
    if sys.platform.startswith("win") and sys.stdin and sys.stdin.isatty():
        try:
            input(f"\n[MantisAnalysis exited with code {rc} — press Enter to close]")
        except EOFError:
            pass


def main() -> int:
    # Required on Windows when the frozen exe spawns helper processes
    # (uvicorn worker pools, matplotlib multiprocessing pickle paths).
    multiprocessing.freeze_support()

    from mantisanalysis.app import main as _app_main

    try:
        return int(_app_main() or 0)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    rc = main()
    _pause_on_error(rc)
    sys.exit(rc)
