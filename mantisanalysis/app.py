"""MantisAnalysis app entry-point.

This module exists to give pyproject.toml a stable import path for the
console / GUI script. The actual ~1900-line GUI implementation still
lives in ``scripts/pick_lines_gui.py`` (kept there to minimize churn —
moving the file is a separate restructuring initiative tracked in
``.agent/runs/``).

The shim adds the project's ``scripts/`` directory to ``sys.path`` so
the historical script can be imported as a module, then exports its
``main`` function.

Use either:

    python -m mantisanalysis [path-to-h5-or-image]
    mantisanalysis [path-to-h5-or-image]            # via [project.scripts]
    python scripts/pick_lines_gui.py [...]          # legacy direct entry
"""

from __future__ import annotations

import sys
from pathlib import Path


def _bootstrap_legacy_entry() -> "object":
    """Import scripts/pick_lines_gui.py as a module, regardless of cwd."""
    pkg_root = Path(__file__).resolve().parent.parent
    scripts_dir = pkg_root / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    import pick_lines_gui  # noqa: E402 — sys.path modified above
    return pick_lines_gui


def main(argv: "list[str] | None" = None) -> int:
    """Programmatic entry — call with an explicit argv list. Returns Qt exit code."""
    if argv is None:
        argv = sys.argv
    mod = _bootstrap_legacy_entry()
    return int(mod.main(argv))


def main_argv() -> int:
    """No-arg entry used by pyproject [project.scripts]."""
    return main(sys.argv)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
