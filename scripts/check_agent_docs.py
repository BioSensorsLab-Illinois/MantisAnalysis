"""Tier-0 agent-doc consistency checker for MantisAnalysis.

Scans `.agent/*.md`, `CLAUDE.md`, and `AGENTS.md` for:

  1. Stale PySide/Qt current-UI claims (the app became FastAPI +
     React per D-0009; any current-state reference is drift).
     Archived / historical blocks are allowed when wrapped in the
     explicit marker pair:

         <!-- qt-allowed: <reason> -->
         ...
         <!-- /qt-allowed -->

  2. Documented shell / Python commands that point at files that
     don't exist.

  3. `.agent/manifest.yaml` module list + `important_docs:` block
     entries that don't exist on disk.

  4. Cross-references to `.agent/agents/<name>.md` and
     `.agent/skills/<slug>/SKILL.md` that resolve to real files.

  5. qt-allowed region size sanity — a region may not span more
     than a capped fraction of the file (default 95%) or a capped
     line count (default 2000 lines), whichever is reached first,
     UNLESS the file is an explicitly-historical log
     (CHANGELOG_AGENT.md, BACKLOG.md, DECISIONS.md, RISKS.md,
     anything under `runs/_archive/` or a named historical
     initiative). This prevents "wrap the whole repo in qt-allowed
     to mute the scanner" escape while allowing legitimate
     append-only history.

Exits 0 on clean, non-zero on drift. Designed to be fast + noise-
free so it can run in every session-start, every doc edit, and the
`python scripts/smoke_test.py --tier 0` gate.

Usage
-----
    python scripts/check_agent_docs.py            # default scan
    python scripts/check_agent_docs.py --strict   # also forbid TODO markers
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Iterable, List, Tuple

ROOT = Path(__file__).resolve().parent.parent

# Sanity: the script was moved + the check would become inert. Fail loud.
_REQUIRED = [ROOT / ".agent", ROOT / "CLAUDE.md"]
for _p in _REQUIRED:
    if not _p.exists():
        raise SystemExit(
            f"check_agent_docs.py: cannot resolve ROOT={ROOT}; missing {_p}. "
            "Run from the repo root (or via `python scripts/check_agent_docs.py`)."
        )

# Patterns that indicate the old PySide/Qt desktop layer. Any match
# outside an allowlisted block is drift.
QT_PATTERNS = [
    r"\bPySide6\b",
    r"\bPyQt5\b",
    r"\bPyQt6\b",
    r"\bQMainWindow\b",
    r"\bQWidget\b",
    r"\bQApplication\b",
    r"\bQScrollArea\b",
    r"\bQSS\b",
    r"\bpick_lines_gui\b",
    # `mantisanalysis/modes/` was the Qt-mode-widget tree deleted in D-0014.
    r"mantisanalysis/modes/",
    # Common Qt imports / plumbing that could sneak back in.
    r"\bQt(?:Widgets|Core|Gui|OpenGL)\b",
    r"\bpyqtgraph\b",
    r"\bpytest-qt\b",
    r"\bQSettings\b",
    r"\bQAction\b",
    r"\bQComboBox\b",
    r"\bQTabWidget\b",
    r"\bQDialog\b",
    r"\bQLabel\b",
    r"\bQSpinBox\b",
    r"\bQVBoxLayout\b",
    r"\bQHBoxLayout\b",
    r"\bQGridLayout\b",
]

# Tokens that appear in TOOLS_AND_SKILLS.md as "removed / rejected"
# rows. These are legitimate status entries (`❌` removed + rationale),
# not live drift. Skip them at scan time.
REMOVED_TOOL_LINE_HINTS = ("❌", "Removed", "deleted in D-0009")

# Files to scan. All `.md` under `.agent/` + repo-root CLAUDE.md + AGENTS.md.
DOC_GLOBS = [
    ".agent/*.md",
    ".agent/**/*.md",
    "CLAUDE.md",
    "AGENTS.md",
]

ALLOW_OPEN = re.compile(r"<!--\s*qt-allowed(?::[^>]*)?\s*-->")
ALLOW_CLOSE = re.compile(r"<!--\s*/qt-allowed\s*-->")

# qt-allowed region size caps (anti-mute-the-scanner guard).
QT_ALLOW_MAX_LINES = 2000
QT_ALLOW_MAX_FRACTION = 0.95

# Files where large historical qt-allowed regions are legitimate
# (append-only logs + archived initiatives). The size cap is not
# applied to these.
QT_ALLOW_EXEMPT_FILES = {
    ".agent/CHANGELOG_AGENT.md",
    ".agent/BACKLOG.md",
    ".agent/DECISIONS.md",
    ".agent/RISKS.md",
    ".agent/HANDOFF.md",  # first-session audit file at repo root too
}
QT_ALLOW_EXEMPT_DIRS = {
    ".agent/runs/_archive",
    ".agent/runs/gui-rewrite-v1",
    ".agent/runs/fpn-rewrite-v1",
    ".agent/runs/dof-rewrite-v1",
    ".agent/runs/backlog-cleanup-v1",
    ".agent/runs/analysis-polish-v1",
    ".agent/runs/analysis-page-overhaul-v1",
    ".agent/runs/plot-style-completion-v1",
    ".agent/runs/isp-modes-v1",
    ".agent/runs/isp-modes-v1-bugfixes-v1",
    ".agent/runs/agentic-workflow-overhaul-v1",
    ".agent/runs/harness-mechanical-v1",
    ".agent/runs/recording-inspection-implementation-v1",
    ".agent/runs/playback-ux-polish-v1",
    ".agent/runs/bundler-migration-v1",
    ".agent/runs/correctness-sweep-v1",
}


def _is_exempt(p: Path) -> bool:
    rel = p.relative_to(ROOT).as_posix()
    if rel in QT_ALLOW_EXEMPT_FILES:
        return True
    for d in QT_ALLOW_EXEMPT_DIRS:
        if rel.startswith(d + "/"):
            return True
    return False


def collect_docs() -> List[Path]:
    seen: List[Path] = []
    for pattern in DOC_GLOBS:
        for p in ROOT.glob(pattern):
            if p.is_file() and p not in seen:
                seen.append(p)
    return seen


def scan_qt_drift(paths: Iterable[Path]) -> List[Tuple[Path, int, str, str]]:
    """Return (file, lineno, line, matched_pattern) for Qt-drift hits
    that are NOT inside an explicit qt-allowed block, AND report
    oversized qt-allowed regions as pseudo-hits."""
    hits: List[Tuple[Path, int, str, str]] = []
    compiled = [re.compile(p) for p in QT_PATTERNS]
    for p in paths:
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        lines = text.splitlines()
        total_lines = len(lines)
        in_allow = False
        allow_start = 0
        allow_line_count = 0
        # Skip self-reference: this file LISTS the forbidden patterns.
        if p.name == "check_agent_docs.py":
            continue
        for i, line in enumerate(lines, start=1):
            if ALLOW_OPEN.search(line):
                in_allow = True
                allow_start = i
                allow_line_count = 0
                continue
            if ALLOW_CLOSE.search(line):
                # Region size cap check — skipped for known-historical files.
                if total_lines > 0 and not _is_exempt(p):
                    frac = allow_line_count / total_lines
                    if (
                        allow_line_count > QT_ALLOW_MAX_LINES
                        or frac > QT_ALLOW_MAX_FRACTION
                    ):
                        hits.append(
                            (
                                p,
                                allow_start,
                                f"<qt-allowed region too large: {allow_line_count} lines, "
                                f"{frac:.0%} of file>",
                                "<oversized-allowlist>",
                            )
                        )
                in_allow = False
                allow_line_count = 0
                continue
            if in_allow:
                allow_line_count += 1
                continue
            # Allow TOOLS_AND_SKILLS status rows that document a removed
            # tool (e.g., `pytest-qt | ❌ | Removed | ...`).
            if all(h in line for h in ("❌",)) and any(
                hint in line for hint in REMOVED_TOOL_LINE_HINTS
            ):
                continue
            for pat in compiled:
                m = pat.search(line)
                if m:
                    hits.append((p, i, line.rstrip(), m.group(0)))
                    break
        # Unterminated allow block = false-negative risk; treat as drift.
        if in_allow:
            hits.append(
                (
                    p,
                    0,
                    "<qt-allowed block left open — add matching close tag>",
                    "<unterminated>",
                )
            )
    return hits


# --- command / path existence checks ---------------------------------------

# Capture "python scripts/<name>.py" or "python -m mantisanalysis..." etc.
CMD_PATH_RE = re.compile(
    r"(?:^|\s|`)python\s+(?:-m\s+([a-zA-Z0-9_.]+)|(scripts/[a-zA-Z0-9_/.-]+\.py))",
)

# Known --tier flag set. Extend when smoke_test.py gains new tiers.
KNOWN_SMOKE_TIERS = {"0", "1", "2", "3", "4"}
# Capture documented `scripts/smoke_test.py --tier N` invocations.
# The `[0-9{]` anchor ensures we only grab the value — digits or a
# template placeholder token like `{0|1|2|3|4}` — and stop before
# trailing punctuation / backticks / parens.
SMOKE_TIER_RE = re.compile(
    r"scripts/smoke_test\.py\s+--tier[=\s]+([0-9{][^\s`)\].,]*)",
)
# Documented `--strict` usage for check_agent_docs.py (only valid flag today).
CHECK_DOCS_FLAG_RE = re.compile(
    r"scripts/check_agent_docs\.py(?:\s+(--\S+))*",
)
KNOWN_CHECK_DOCS_FLAGS = {"--strict"}

# Capture "pytest tests/..." invocations. Matches both `python -m pytest <path>`
# and bare `pytest <path>`. Requires a concrete path — either ending in `.py`
# or a directory-like fragment that does NOT end in a placeholder marker
# like `_` or `-` (which catches template placeholders such as
# `tests/web/test_<feature>.py`).
PYTEST_PATH_RE = re.compile(
    r"(?:python\s+-m\s+)?pytest\s+(tests/[a-zA-Z0-9_/-]+\.py|tests/[a-zA-Z0-9_-]+/?)(?=[\s)`]|$)",
)


def scan_command_paths(paths: Iterable[Path]) -> List[Tuple[Path, int, str]]:
    """Return (file, lineno, missing-target) for documented commands
    whose target file / module doesn't resolve.

    Conservative: only checks `scripts/*.py` paths (files we own),
    `python -m <mantisanalysis...>` modules, and `pytest tests/...`
    directories.
    """
    missing: List[Tuple[Path, int, str]] = []
    for p in paths:
        if _is_exempt(p):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        # Skip self-reference.
        if p.name == "check_agent_docs.py":
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            for m in CMD_PATH_RE.finditer(line):
                module, path = m.group(1), m.group(2)
                if path:
                    target = ROOT / path
                    if not target.is_file():
                        missing.append((p, i, path))
                elif module and module.startswith("mantisanalysis"):
                    pkg = ROOT / "mantisanalysis"
                    if not pkg.is_dir():
                        missing.append((p, i, "mantisanalysis (package missing)"))
            for m in PYTEST_PATH_RE.finditer(line):
                rel = m.group(1)
                # Trim trailing `::` selectors.
                base = rel.split("::", 1)[0].rstrip("/")
                # Skip template placeholders that end with `_` or `-`
                # (e.g. `test_<feature>` where < breaks the match and we
                # get `test_` alone) — already filtered by regex, but
                # double-check.
                if base.endswith("_") or base.endswith("-"):
                    continue
                target = ROOT / base
                if not target.exists():
                    missing.append((p, i, rel))
            # Validate smoke-test.py --tier flag values (B-0028).
            for m in SMOKE_TIER_RE.finditer(line):
                val = m.group(1).strip("`").strip("'\"")
                # Allow template placeholders like `{0|1|2|3|4}` or N
                if val.startswith("{") or val in ("N",):
                    continue
                if val not in KNOWN_SMOKE_TIERS:
                    missing.append((p, i, f"smoke_test.py --tier {val} (invalid tier; known: {sorted(KNOWN_SMOKE_TIERS)})"))
    return missing


# --- manifest existence ----------------------------------------------------

MANIFEST = ROOT / ".agent" / "manifest.yaml"
MANIFEST_PATH_RE = re.compile(r"-\s*path:\s*([^\s]+)")
MANIFEST_IMPORTANT_DOC_RE = re.compile(
    r"^\s*[a-zA-Z_][a-zA-Z0-9_]*:\s*(\.[a-zA-Z0-9_/.-]+\.[a-zA-Z0-9]+)\s*(?:#.*)?$"
)
MANIFEST_TOP_SCALAR_RE = re.compile(
    r"^\s*(?:handoff|user_readme)\s*:\s*([^\s#]+)"
)


def scan_manifest() -> List[str]:
    """Return list of manifest-referenced paths that don't exist."""
    if not MANIFEST.is_file():
        return []
    missing: List[str] = []
    in_important = False
    for i, line in enumerate(MANIFEST.read_text().splitlines(), start=1):
        # `- path: <x>` entries under major_modules:
        m = MANIFEST_PATH_RE.search(line)
        if m:
            rel = m.group(1)
            target = ROOT / rel
            if not target.exists():
                missing.append(f"{MANIFEST.relative_to(ROOT)}:{i} path does not exist: {rel}")
            continue
        # Detect entering / leaving important_docs: block.
        stripped = line.rstrip()
        if stripped.rstrip(":") == "important_docs" and stripped.endswith(":"):
            in_important = True
            continue
        if in_important and line and not line.startswith(" "):
            in_important = False
        if in_important:
            m2 = MANIFEST_IMPORTANT_DOC_RE.match(line)
            if m2:
                rel = m2.group(1)
                if not (ROOT / rel).exists():
                    missing.append(
                        f"{MANIFEST.relative_to(ROOT)}:{i} important_docs target does not exist: {rel}"
                    )
        # Top-level scalars we care about.
        m3 = MANIFEST_TOP_SCALAR_RE.match(line)
        if m3:
            rel = m3.group(1)
            if not (ROOT / rel).exists():
                missing.append(
                    f"{MANIFEST.relative_to(ROOT)}:{i} top-level target does not exist: {rel}"
                )
    return missing


# --- cross-reference scanner ----------------------------------------------

# Match `.agent/agents/<name>.md` and `.agent/skills/<slug>/SKILL.md`
# references in docs. Very conservative: only counts references that
# look like a path (so `rg "risk-skeptic"` in prose isn't flagged).
AGENT_REF_RE = re.compile(r"\.agent/agents/([a-z][a-z0-9-]+)\.md")
SKILL_REF_RE = re.compile(r"\.agent/skills/([a-z][a-z0-9-]+)/SKILL\.md")
# Also catch the relative-path forms used inside agents/skills.
AGENT_REF_REL_RE = re.compile(r"(?:\.\./)?agents/([a-z][a-z0-9-]+)\.md")
SKILL_REF_REL_RE = re.compile(r"(?:\.\./)?skills/([a-z][a-z0-9-]+)/SKILL\.md")


def scan_cross_references(paths: Iterable[Path]) -> List[Tuple[Path, int, str]]:
    """Return (file, lineno, broken-reference) for agent/skill
    references that don't resolve to real files.

    Skips files exempted from the qt-allowed size cap (closed
    initiative folders + append-only logs) — broken cross-references
    in archived material are archaeology, not live drift.
    """
    missing: List[Tuple[Path, int, str]] = []
    agents_dir = ROOT / ".agent" / "agents"
    skills_dir = ROOT / ".agent" / "skills"
    known_agents = {p.stem for p in agents_dir.glob("*.md")} if agents_dir.is_dir() else set()
    known_skills = {p.name for p in skills_dir.iterdir() if p.is_dir()} if skills_dir.is_dir() else set()
    for p in paths:
        if _is_exempt(p):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            for rx in (AGENT_REF_RE, AGENT_REF_REL_RE):
                for m in rx.finditer(line):
                    name = m.group(1)
                    if name == "README" or name in known_agents:
                        continue
                    missing.append((p, i, f"agents/{name}.md (broken cross-reference)"))
            for rx in (SKILL_REF_RE, SKILL_REF_REL_RE):
                for m in rx.finditer(line):
                    slug = m.group(1)
                    if slug in known_skills:
                        continue
                    missing.append((p, i, f"skills/{slug}/SKILL.md (broken cross-reference)"))
    return missing


# --- orchestration ---------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Also forbid TODO markers in .agent/*.md",
    )
    args = ap.parse_args()

    docs = collect_docs()
    print(f"scanning {len(docs)} doc files...")

    qt_hits = scan_qt_drift(docs)
    cmd_misses = scan_command_paths(docs)
    manifest_misses = scan_manifest()
    xref_misses = scan_cross_references(docs)

    failed = False

    if qt_hits:
        failed = True
        print("\nPySide/Qt drift (should be rewritten or enclosed in qt-allowed blocks):")
        for path, lineno, line, pat in qt_hits:
            rel = path.relative_to(ROOT)
            print(f"  {rel}:{lineno}  [{pat}]  {line[:120]}")

    if cmd_misses:
        failed = True
        print("\nDocumented commands pointing at missing targets:")
        for path, lineno, target in cmd_misses:
            rel = path.relative_to(ROOT)
            print(f"  {rel}:{lineno}  missing: {target}")

    if manifest_misses:
        failed = True
        print("\nmanifest.yaml references to files that don't exist:")
        for line in manifest_misses:
            print(f"  {line}")

    if xref_misses:
        failed = True
        print("\nBroken agent/skill cross-references:")
        for path, lineno, target in xref_misses:
            rel = path.relative_to(ROOT)
            print(f"  {rel}:{lineno}  {target}")

    if args.strict:
        todo_hits: List[Tuple[Path, int, str]] = []
        for p in docs:
            try:
                text = p.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for i, line in enumerate(text.splitlines(), start=1):
                if re.search(r"\b(TODO|FIXME|XXX)\b", line):
                    todo_hits.append((p, i, line.rstrip()))
        if todo_hits:
            failed = True
            print("\nTODO / FIXME / XXX markers (strict mode):")
            for path, lineno, line in todo_hits:
                rel = path.relative_to(ROOT)
                print(f"  {rel}:{lineno}  {line[:120]}")

    if failed:
        print("\ncheck_agent_docs: FAIL")
        return 1

    print("check_agent_docs: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
