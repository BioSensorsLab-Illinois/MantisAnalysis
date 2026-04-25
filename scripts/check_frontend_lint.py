"""Tier-0 frontend lint + format consistency checker.

bundler-migration-v1 Phase 4. Runs Prettier in check mode + ESLint in
max-warnings=9999 mode (errors fail; warnings are noise but tolerated)
against ``web/src/``. Degrades gracefully when ``node_modules/`` hasn't
been populated yet (the user can still run the Python-only Tier 0 gate
without a fresh ``npm install``).

Exit codes:
    0  — clean OR node/deps unavailable (skipped with clear message)
    1  — genuine drift (prettier-reported diff, or eslint errors)

Usage
-----
    python scripts/check_frontend_lint.py            # Tier-0 smoke hook
    python scripts/check_frontend_lint.py --strict   # also fail on warnings
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_SRC = ROOT / "web" / "src"


def _has_node() -> bool:
    return shutil.which("node") is not None


def _has_local_bin(name: str) -> bool:
    return (ROOT / "node_modules" / ".bin" / name).exists()


def _run(argv: list[str], *, timeout: float = 45.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--strict",
        action="store_true",
        help="Fail on eslint warnings too, not just errors.",
    )
    args = ap.parse_args()

    if not WEB_SRC.is_dir():
        print(f"check_frontend_lint: skipped — {WEB_SRC} not found.")
        return 0

    if not _has_node():
        print("check_frontend_lint: skipped — `node` not on PATH. "
              "Install Node >= 20 and run `npm install` to enable this gate.")
        return 0

    if not _has_local_bin("prettier") or not _has_local_bin("eslint"):
        print("check_frontend_lint: skipped — `node_modules/.bin/prettier` "
              "or `.../eslint` missing. Run `npm install` to enable this gate.")
        return 0

    # Prettier check ---------------------------------------------------
    pr = _run([
        "npx", "--no-install", "prettier", "--check",
        "web/src/**/*.{js,jsx,json,css,html}",
    ], timeout=45.0)
    if pr.returncode != 0:
        print("check_frontend_lint: prettier reported drift:")
        print(pr.stdout)
        print(pr.stderr, file=sys.stderr)
        print("Run `npm run format` to fix.")
        return 1

    # ESLint check -----------------------------------------------------
    max_warnings = "0" if args.strict else "9999"
    es = _run([
        "npx", "--no-install", "eslint", "web/src",
        "--max-warnings", max_warnings,
    ], timeout=60.0)
    if es.returncode != 0:
        print("check_frontend_lint: eslint reported errors:")
        print(es.stdout)
        print(es.stderr, file=sys.stderr)
        print("Run `npm run lint` for detail, `npm run lint:fix` for auto-fixes.")
        return 1

    print("check_frontend_lint: prettier + eslint clean (web/src/)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
