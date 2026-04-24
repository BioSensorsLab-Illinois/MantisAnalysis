"""Verifier for the UI-verification hook (B-0022).

Called by the Stop hook. If `.agent/runs/<active>/.ui-edit-marker`
exists AND no screenshot under `.agent/runs/<active>/screenshots/`
or `outputs/verify/` has an mtime newer than the marker, prints a
loud reminder to stderr.

Exits 0 unconditionally — this is a soft nudge, not a hard block.
A hard block would be too invasive; the implementing agent already
has `AGENT_RULES.md` rule 3 and the stopping criteria to back it up.
The hook's job is to catch the specific slip of editing UI code +
running Tier 1/2 + calling it done without ever booting a browser.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / ".agent" / "runs"
HANDOFF = ROOT / ".agent" / "HANDOFF.md"
VERIFY_FALLBACK = ROOT / "outputs" / "verify"


def _active_initiative() -> Path | None:
    if HANDOFF.is_file():
        text = HANDOFF.read_text(encoding="utf-8")
        m = re.search(r"\.agent/runs/([a-zA-Z0-9_-]+)/?", text)
        if m:
            p = RUNS / m.group(1)
            if p.is_dir():
                return p
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
        return 0
    marker = active / ".ui-edit-marker"
    if not marker.is_file():
        return 0
    marker_mtime = marker.stat().st_mtime
    shots_dir = active / "screenshots"
    newer_shot = False
    for d in (shots_dir, VERIFY_FALLBACK):
        if not d.is_dir():
            continue
        for p in d.iterdir():
            if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg"):
                if p.stat().st_mtime >= marker_mtime:
                    newer_shot = True
                    break
        if newer_shot:
            break
    if not newer_shot:
        print(
            f"⚠  UI-verification reminder: web/src/* was edited in this "
            f"session (marker at {marker.relative_to(ROOT)}) but no "
            f"screenshot has been captured since. Per "
            f".agent/UI_VERIFICATION.md, run the browser-verification "
            f"ladder before declaring done. This is a soft nudge, not a "
            f"block.",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
