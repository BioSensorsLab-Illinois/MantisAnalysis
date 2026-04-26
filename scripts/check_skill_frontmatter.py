"""Validator for `.agent/skills/*/SKILL.md` frontmatter.

The Claude Code harness auto-matches skills against user intent via
the `description` and `when_to_use` fields in the YAML frontmatter.
Silent drift in these fields (typos in a referenced agent name, a
description so long it gets truncated, a missing trigger) makes
skills invisible to the matcher.

Enforces
--------
1. Frontmatter exists + parses (between two `---` delimiters).
2. Required fields present: `name`, `description`, `when_to_use`.
3. `description` is ≤ 300 characters (harness matches best on short
   specific descriptions).
4. `when_to_use` is a list (YAML `-` bullets).
5. `related_agents`, when present, resolves to agents that exist
   under `.agent/agents/<name>.md`.
6. The skill's directory name matches the `name` field (so renames
   can't drift the two apart).

Usage
-----
    python scripts/check_skill_frontmatter.py            # scan every skill
    python scripts/check_skill_frontmatter.py <path>     # scan one SKILL.md
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / ".agent" / "skills"
AGENTS = ROOT / ".agent" / "agents"


MAX_DESCRIPTION_LEN = 300


def _parse_frontmatter(text: str) -> dict[str, object] | None:
    """Minimal YAML-ish frontmatter parser sufficient for our schema.

    Handles scalar `key: value` and list `key:` followed by `- item`
    lines. Does NOT handle nested maps, multi-line folds, or anchors.
    Everything we emit from SKILL.md is flat scalars + one list
    (`when_to_use`), so this is adequate.
    """
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end < 0:
        return None
    block = text[3:end].strip()
    out: dict[str, object] = {}
    current_list_key: str | None = None
    for raw in block.splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"):
            continue
        if current_list_key is not None and line.lstrip().startswith("- "):
            out.setdefault(current_list_key, []).append(line.lstrip()[2:].strip())
            continue
        current_list_key = None
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if not val:
            # Likely the start of a list: `when_to_use:`
            current_list_key = key
            out[key] = []
        else:
            out[key] = val
    return out


def _known_agent_names() -> set[str]:
    if not AGENTS.is_dir():
        return set()
    return {p.stem for p in AGENTS.glob("*.md") if p.stem != "README"}


def check_skill(path: Path, known_agents: set[str]) -> list[str]:
    """Return a list of findings for one SKILL.md file."""
    findings: list[str] = []
    text = path.read_text(encoding="utf-8")
    fm = _parse_frontmatter(text)
    if fm is None:
        return [
            f"{path.relative_to(ROOT)}: missing or malformed frontmatter (expected '---' delimited block at top)"
        ]

    for required in ("name", "description", "when_to_use"):
        if required not in fm:
            findings.append(f"{path.relative_to(ROOT)}: frontmatter missing {required!r}")

    name = fm.get("name")
    if isinstance(name, str):
        dir_name = path.parent.name
        if dir_name != name:
            findings.append(
                f"{path.relative_to(ROOT)}: frontmatter name={name!r} but directory is {dir_name!r}"
            )

    desc = fm.get("description")
    if isinstance(desc, str) and len(desc) > MAX_DESCRIPTION_LEN:
        findings.append(
            f"{path.relative_to(ROOT)}: description is {len(desc)} chars "
            f"(max {MAX_DESCRIPTION_LEN}); harness may truncate. Shorten or split."
        )

    triggers = fm.get("when_to_use")
    if triggers is not None and not isinstance(triggers, list):
        findings.append(
            f"{path.relative_to(ROOT)}: when_to_use must be a YAML list, got {type(triggers).__name__}"
        )
    elif isinstance(triggers, list) and not triggers:
        findings.append(f"{path.relative_to(ROOT)}: when_to_use list is empty")

    related = fm.get("related_agents")
    if isinstance(related, str):
        claimed = [a.strip() for a in related.split(",") if a.strip()]
        for agent in claimed:
            if agent not in known_agents:
                findings.append(
                    f"{path.relative_to(ROOT)}: related_agents references {agent!r} "
                    f"which is not under .agent/agents/"
                )
    return findings


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "target",
        nargs="?",
        help="Optional: path to a single SKILL.md. If omitted, scans all skills.",
    )
    args = ap.parse_args()

    known = _known_agent_names()

    paths: list[Path]
    if args.target:
        p = Path(args.target)
        if not p.is_absolute():
            p = ROOT / p
        paths = [p]
    else:
        paths = sorted(SKILLS.glob("*/SKILL.md"))

    if not paths:
        print("no SKILL.md files found")
        return 0

    findings: list[str] = []
    for p in paths:
        findings.extend(check_skill(p, known))

    if findings:
        print("\n".join(findings))
        print(f"\ncheck_skill_frontmatter: FAIL ({len(findings)} issue(s))")
        return 1

    print(f"scanned {len(paths)} SKILL.md files")
    print("check_skill_frontmatter: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
