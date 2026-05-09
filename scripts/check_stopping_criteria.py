"""Mechanical stopping-criteria gate.

Parses `.agent/runs/<slug>/Status.md` for a "Final verification"
section and fails non-zero if any required-gate checkbox is empty
(`[ ]`) when the initiative claims close.

Invocation
----------
    python scripts/check_stopping_criteria.py <initiative-slug>
    python scripts/check_stopping_criteria.py .agent/runs/<slug>
    python scripts/check_stopping_criteria.py --all            # every active initiative

The canonical check runs against the "Final verification" section
produced by `.agent/templates/Status.md`. An initiative is
considered **closed** when its Progress list has all milestones
checked; an initiative is **active** otherwise. Claims like
"Status: closed" in a commit message / CHANGELOG don't imply this —
the gate looks at Status.md directly.

Deferrals are allowed on a per-check basis using the explicit
marker `N/A — <reason>` on the checklist line. Example::

    - [x] Tier 4 — browser smoke — N/A — harness-only initiative

Without the `N/A` marker, an unchecked line is a hard fail.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / ".agent" / "runs"

# Matches a markdown checkbox line like "- [x] foo" or "- [ ] bar".
CHECK_RE = re.compile(r"^\s*[-*]\s*\[([ xX])\]\s*(.*)$")
# An "N/A" deferral marker anywhere on the line counts as acceptable.
NA_RE = re.compile(r"\bN/?A\b\s*[-—:]?", re.IGNORECASE)
# Section header that starts the final-verification block.
FINAL_HEADER_RE = re.compile(
    r"^#{1,4}\s+Final\s+verification(?:\s+(?:checklist|\([^)]*\)))?\s*$",
    re.IGNORECASE,
)


def _find_status(arg: str) -> Path:
    """Resolve either a slug, a relative path, or an absolute path to the
    Status.md file of an initiative."""
    # Strip trailing slash
    arg = arg.rstrip("/")
    candidates = [
        Path(arg),
        Path(arg) / "Status.md",
        RUNS / arg,
        RUNS / arg / "Status.md",
    ]
    for c in candidates:
        if c.is_file() and c.name == "Status.md":
            return c.resolve()
        if c.is_dir() and (c / "Status.md").is_file():
            return (c / "Status.md").resolve()
    raise SystemExit(f"no Status.md found for {arg!r}")


def _progress_block(text: str) -> list[tuple[bool, str]]:
    """Return (ticked?, line_content) for every checkbox under the first
    "Progress" section."""
    items: list[tuple[bool, str]] = []
    in_block = False
    for line in text.splitlines():
        if re.match(r"^#{1,4}\s+Progress\s*$", line, re.IGNORECASE):
            in_block = True
            continue
        if in_block and re.match(r"^#{1,4}\s+\S", line):
            break
        if not in_block:
            continue
        m = CHECK_RE.match(line)
        if m:
            items.append((m.group(1).lower() == "x", m.group(2).strip()))
    return items


def _final_block(text: str) -> list[tuple[bool, str]] | None:
    """Return (ticked?, content) for every checkbox under the 'Final
    verification' section, or None if that section isn't present."""
    items: list[tuple[bool, str]] = []
    in_block = False
    for line in text.splitlines():
        if FINAL_HEADER_RE.match(line):
            in_block = True
            continue
        if in_block and re.match(r"^##\s+\S", line):
            break
        if not in_block:
            continue
        m = CHECK_RE.match(line)
        if m:
            items.append((m.group(1).lower() == "x", m.group(2).strip()))
    return items if in_block else None


def is_deferral(line: str) -> bool:
    """Lines containing an 'N/A' marker are allowed to stay unticked."""
    return bool(NA_RE.search(line))


def check(status_path: Path) -> tuple[bool, list[str]]:
    """Return (ok, messages) for a single Status.md file."""
    text = status_path.read_text(encoding="utf-8")
    progress = _progress_block(text)
    if not progress:
        return True, [f"{status_path.relative_to(ROOT)}: no Progress block — skipping"]
    # If any progress item is unchecked, the initiative is active — stopping
    # criteria don't apply yet. Report informational.
    open_milestones = [name for (ok, name) in progress if not ok]
    if open_milestones:
        return True, [
            f"{status_path.relative_to(ROOT)}: active "
            f"({len(open_milestones)} open milestone(s)); stopping criteria "
            "not yet applicable."
        ]
    # Closed initiative — require a Final verification block with every
    # non-deferral item ticked.
    final = _final_block(text)
    if final is None:
        return False, [
            f"{status_path.relative_to(ROOT)}: all milestones done but no "
            "'Final verification' block; cannot close — see "
            ".agent/STOPPING_CRITERIA.md"
        ]
    missing = [name for (ok, name) in final if not ok and not is_deferral(name)]
    if missing:
        messages = [f"{status_path.relative_to(ROOT)}: final verification incomplete:"]
        for m in missing[:12]:
            messages.append(f"  - [ ] {m}")
        if len(missing) > 12:
            messages.append(f"  ... and {len(missing) - 12} more")
        return False, messages
    return True, [
        f"{status_path.relative_to(ROOT)}: OK ({len(final)} checks; "
        f"{sum(1 for (ok, _) in final if ok)} ticked, "
        f"{sum(1 for (_, n) in final if is_deferral(n))} deferred)"
    ]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("target", nargs="?", help="Initiative slug or path")
    g.add_argument(
        "--all", action="store_true", help="Scan every initiative folder under .agent/runs/"
    )
    args = ap.parse_args()

    paths: list[Path]
    if args.all:
        paths = sorted(RUNS.glob("*/Status.md"))
        paths = [p for p in paths if p.parent.name != "_archive"]
    else:
        paths = [_find_status(args.target)]

    failed = False
    for p in paths:
        ok, msgs = check(p)
        for m in msgs:
            print(m)
        if not ok:
            failed = True

    if failed:
        print("\ncheck_stopping_criteria: FAIL")
        return 1
    print("\ncheck_stopping_criteria: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
