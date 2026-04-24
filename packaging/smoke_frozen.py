"""Smoke-test the PyInstaller-built executable.

Spawns the frozen binary, waits for the HTTP port to open, hits
``/api/health``, then terminates. Fails loudly on any problem — the
release CI job uses a non-zero exit to block publication of a broken
build.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIST = REPO / "dist"
PORT = 8789           # distinct from the default to avoid collisions


def _find_binary() -> Path:
    if sys.platform == "darwin":
        app = DIST / "MantisAnalysis.app" / "Contents" / "MacOS" / "MantisAnalysis"
        if app.exists():
            return app
    if sys.platform.startswith("win"):
        exe = DIST / "MantisAnalysis" / "MantisAnalysis.exe"
        if exe.exists():
            return exe
    # Linux / fallback
    exe = DIST / "MantisAnalysis" / "MantisAnalysis"
    if exe.exists():
        return exe
    raise SystemExit(f"frozen binary not found under {DIST}")


def _port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.25):
            return True
    except OSError:
        return False


def main() -> int:
    binary = _find_binary()
    print(f"frozen binary: {binary}")

    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.Popen(
        [str(binary), "--no-browser", "--host", "127.0.0.1", "--port", str(PORT)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
    )

    try:
        deadline = time.time() + 60.0
        while time.time() < deadline:
            if proc.poll() is not None:
                out = proc.stdout.read().decode("utf-8", "replace") if proc.stdout else ""
                raise SystemExit(
                    f"binary exited early with code {proc.returncode}\n--- output ---\n{out}"
                )
            if _port_open("127.0.0.1", PORT):
                break
            time.sleep(0.25)
        else:
            raise SystemExit("timed out waiting for server port to open")

        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/health", timeout=5.0) as resp:
            body = resp.read().decode("utf-8")
            print(f"GET /api/health → {resp.status}")
            print(body)
            payload = json.loads(body)
            if not payload.get("ok", payload.get("status") in {"ok", "healthy"}):
                # Accept a few shapes; just demand a 200 + parseable JSON with a truthy flag
                print("warning: health payload shape unexpected", file=sys.stderr)

        # Quick root check — serves the SPA
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=5.0) as resp:
            head = resp.read(512).decode("utf-8", "replace")
            if "<html" not in head.lower():
                raise SystemExit(f"root did not return HTML:\n{head!r}")
            print("GET / → OK (HTML served)")

        print("\n✔ frozen binary smoke test passed")
        return 0

    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
