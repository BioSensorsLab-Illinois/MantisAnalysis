"""Enforce reviewer-output evidence artifacts.

When an initiative claims reviewer findings in its `Status.md`
"Reviewer findings" table, the matching reviewer report must exist
on disk under `.agent/runs/<slug>/reviews/<agent>-*.md`. Without this
anchor, an agent could fabricate findings without actually invoking
a reviewer. See `.agent/RISKS.md` R-0014 + `BACKLOG.md` B-0024.

Usage
-----
    python scripts/check_reviewer_evidence.py <initiative-slug>
    python scripts/check_reviewer_evidence.py .agent/runs/<slug>
    python scripts/check_reviewer_evidence.py --all
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / ".agent" / "runs"

# Match reviewer names that appear as a column value in a markdown
# table row. A row looks like:
#     | F-1 | docs-handoff-curator | P1 | Title | Disposition |
# We grab the second column after F-#, capped to agent-slug characters.
ROW_RE = re.compile(
    r"^\|\s*F-\d+\s*\|\s*([a-z][a-z0-9-]+)\s*\|",
    re.IGNORECASE | re.MULTILINE,
)


def _known_agent_names() -> set[str]:
    d = ROOT / ".agent" / "agents"
    if not d.is_dir():
        return set()
    return {p.stem for p in d.glob("*.md") if p.stem != "README"}


def reviewers_claimed(status_text: str, known: set[str]) -> set[str]:
    claimed: set[str] = set()
    for m in ROW_RE.finditer(status_text):
        name = m.group(1).lower()
        if name in known:
            claimed.add(name)
    return claimed


def reviewers_evidenced(initiative_dir: Path) -> set[str]:
    reviews = initiative_dir / "reviews"
    if not reviews.is_dir():
        return set()
    out: set[str] = set()
    for p in reviews.glob("*.md"):
        # File convention: <agent-slug>-<date>.md OR <agent-slug>.md
        base = p.stem
        # Strip trailing -YYYY-MM-DD or -YYYYMMDD if present
        base = re.sub(r"-\d{4}-?\d{2}-?\d{2}$", "", base)
        out.add(base.lower())
    return out


def check(initiative_dir: Path) -> tuple[bool, list[str]]:
    status = initiative_dir / "Status.md"
    if not status.is_file():
        return True, [f"{initiative_dir.name}: no Status.md — skipping"]
    text = status.read_text(encoding="utf-8")
    known = _known_agent_names()
    claimed = reviewers_claimed(text, known)
    if not claimed:
        return True, [
            f"{initiative_dir.name}: no reviewer findings table — OK (nothing to evidence)"
        ]
    evidenced = reviewers_evidenced(initiative_dir)
    missing = sorted(claimed - evidenced)
    if missing:
        msgs = [f"{initiative_dir.name}: reviewer evidence missing:"]
        for name in missing:
            msgs.append(
                f"  - reviewer {name!r} has findings in Status.md but no report under "
                f".agent/runs/{initiative_dir.name}/reviews/{name}*.md"
            )
        return False, msgs
    return True, [f"{initiative_dir.name}: OK ({len(claimed)} reviewer(s) claimed, all evidenced)"]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("target", nargs="?", help="Initiative slug or path to its folder")
    g.add_argument("--all", action="store_true")
    args = ap.parse_args()

    dirs: list[Path]
    if args.all:
        dirs = [
            p
            for p in sorted(RUNS.iterdir())
            if p.is_dir() and p.name not in ("_archive",) and not p.name.startswith(".")
        ]
    else:
        p = Path(args.target)
        if p.is_dir():
            dirs = [p.resolve()]
        elif (RUNS / args.target).is_dir():
            dirs = [(RUNS / args.target).resolve()]
        else:
            raise SystemExit(f"initiative folder not found: {args.target!r}")

    failed = False
    for d in dirs:
        ok, msgs = check(d)
        for m in msgs:
            print(m)
        if not ok:
            failed = True

    if failed:
        print("\ncheck_reviewer_evidence: FAIL")
        return 1
    print("\ncheck_reviewer_evidence: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
