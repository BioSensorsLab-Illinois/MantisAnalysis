"""Tier-0 frontend lint + format + typecheck consistency checker.

bundler-migration-v1 Phase 4 (Prettier + ESLint) + Phase 5
(TypeScript). Runs:

  1. Prettier in check mode (errors fail)
  2. ESLint with max-warnings=9999 (errors fail, warnings tolerated)
  3. tsc --noEmit (errors fail) when a tsconfig.json is present

Degrades gracefully when ``node_modules/`` hasn't been populated yet
(the user can still run the Python-only Tier 0 gate without a fresh
``npm install``).

Exit codes:
    0  — clean OR node/deps unavailable (skipped with clear message)
    1  — genuine drift (prettier diff, eslint errors, or tsc errors)

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

    has_tsc = _has_local_bin("tsc")
    has_tsconfig = (ROOT / "tsconfig.json").is_file()

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

    # TypeScript type-check -------------------------------------------
    # `tsc --noEmit` only runs when both a tsconfig.json and the
    # typescript binary are present, so a pre-Phase-5 checkout still
    # passes this gate. The type checker is authoritative for .ts/.tsx
    # only — .jsx files have `checkJs: false` and are not type-checked.
    tsc_msg = ""
    if has_tsc and has_tsconfig:
        tc = _run([
            "npx", "--no-install", "tsc", "--noEmit",
        ], timeout=90.0)
        if tc.returncode != 0:
            print("check_frontend_lint: tsc reported type errors:")
            print(tc.stdout)
            print(tc.stderr, file=sys.stderr)
            print("Run `npm run typecheck` for detail.")
            return 1
        tsc_msg = " + tsc"

    print(f"check_frontend_lint: prettier + eslint{tsc_msg} clean (web/src/)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
