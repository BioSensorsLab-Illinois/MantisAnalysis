"""Marker helper for the UI-verification hook (B-0022).

Called by the PostToolUse hook whenever `Edit` or `Write` touches a
file under `web/src/`. Writes a timestamp to
`.agent/runs/<active>/.ui-edit-marker` so a later Stop hook can
check whether a matching browser-verification screenshot has been
captured since this marker's mtime.

Reads the current initiative from `.agent/HANDOFF.md` "Active
initiative" line or falls back to the most-recently-modified folder
under `.agent/runs/` (excluding `_archive/`).
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / ".agent" / "runs"
HANDOFF = ROOT / ".agent" / "HANDOFF.md"


def _active_initiative() -> Path | None:
    """Best-effort: read HANDOFF.md for an active-initiative pointer,
    else pick the most-recently-modified non-archive run folder."""
    if HANDOFF.is_file():
        text = HANDOFF.read_text(encoding="utf-8")
        # Look for a line like `.agent/runs/<slug>/`
        m = re.search(r"\.agent/runs/([a-zA-Z0-9_-]+)/?", text)
        if m:
            p = RUNS / m.group(1)
            if p.is_dir():
                return p
    # Fallback: pick most recently touched run folder.
    if not RUNS.is_dir():
        return None
    candidates = [p for p in RUNS.iterdir()
                  if p.is_dir() and p.name not in ("_archive",)
                  and not p.name.startswith(".")]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def main() -> int:
    active = _active_initiative()
    if active is None:
        # Silent no-op if no active initiative. Hook should not block.
        return 0
    marker = active / ".ui-edit-marker"
    marker.write_text(
        f"ts={time.time():.3f}\ntriggered_from={sys.argv[1:] or '<hook>'}\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
