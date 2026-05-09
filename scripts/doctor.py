"""B-0012 — onboarding / env-sanity helper.

Runs a set of low-cost checks and prints actionable advice for each.
Intended for:
  * first-time setup (`pip install -e .[dev]` run? playwright chromium?)
  * CI env sanity preamble
  * debugging "why isn't the smoke ladder running here" moments

Usage
-----
    python scripts/doctor.py            # print each check's status; exit 0
    python scripts/doctor.py --strict   # exit non-zero if any check is red

Checks (each prints OK / WARN / FAIL with a fix line):

  1. Python version ≥ 3.10.
  2. Repo root resolves (we're running from inside MantisAnalysis/).
  3. Runtime deps importable (numpy, scipy, h5py, matplotlib, fastapi,
     uvicorn, pydantic, Pillow, tifffile).
  4. Dev deps importable (pytest, ruff, mypy, httpx).
  5. Optional web-smoke: playwright + pytest-playwright (WARN only).
  6. Package installed in editable mode (import mantisanalysis works).
  7. Smoke scripts present + executable (scripts/smoke_test.py,
     scripts/check_agent_docs.py, scripts/check_stopping_criteria.py,
     scripts/check_skill_frontmatter.py, scripts/check_reviewer_evidence.py).
  8. `.agent/` directory exists + symlink `.claude → .agent` intact.
  9. Tier 0 gate passes (scripts/smoke_test.py --tier 0).
"""

from __future__ import annotations

import argparse
import importlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _status(label: str, state: str, detail: str = "") -> None:
    colour = {"OK": "\033[32m", "WARN": "\033[33m", "FAIL": "\033[31m"}.get(state, "")
    reset = "\033[0m" if colour else ""
    print(f"  {colour}{state:<4}{reset}  {label}" + (f"  — {detail}" if detail else ""))


def check_python() -> tuple[bool, bool]:
    """Returns (ok, is_warning_only). Python ≥ 3.10 required."""
    v = sys.version_info
    if v >= (3, 10):
        _status(f"Python {v.major}.{v.minor}.{v.micro}", "OK")
        return True, False
    _status(
        f"Python {v.major}.{v.minor}.{v.micro}",
        "FAIL",
        "pyproject.toml requires >= 3.10. Upgrade Python.",
    )
    return False, False


def check_repo_root() -> tuple[bool, bool]:
    if (ROOT / "pyproject.toml").is_file() and (ROOT / "mantisanalysis").is_dir():
        _status(f"repo root at {ROOT.name}/", "OK")
        return True, False
    _status(
        "repo root",
        "FAIL",
        f"Can't find pyproject.toml + mantisanalysis/ under {ROOT!s}; "
        "run doctor.py from the repo root.",
    )
    return False, False


def _try_import(pkgs: list[str], kind: str, fail_state: str = "FAIL") -> bool:
    """Common helper for dep checks. Returns True if all imported."""
    missing: list[str] = []
    for p in pkgs:
        try:
            importlib.import_module(p)
        except Exception as exc:
            missing.append(f"{p} ({type(exc).__name__})")
    if missing:
        _status(
            f"{kind} deps",
            fail_state,
            f"missing: {', '.join(missing)}. Fix: python -m pip install -e .[dev]",
        )
        return False
    _status(f"{kind} deps ({len(pkgs)})", "OK")
    return True


def check_runtime_deps() -> tuple[bool, bool]:
    ok = _try_import(
        [
            "numpy",
            "scipy",
            "h5py",
            "matplotlib",
            "fastapi",
            "uvicorn",
            "pydantic",
            "PIL",
            "tifffile",
        ],
        "runtime",
    )
    return ok, False


def check_dev_deps() -> tuple[bool, bool]:
    ok = _try_import(["pytest", "ruff", "mypy", "httpx"], "dev")
    return ok, False


def check_web_smoke() -> tuple[bool, bool]:
    """WARN-only: playwright is opt-in."""
    try:
        importlib.import_module("playwright")
        importlib.import_module("pytest_playwright")
        _status("web-smoke (playwright)", "OK")
        return True, True
    except Exception:
        _status(
            "web-smoke (playwright)",
            "WARN",
            "not installed. Fix (optional): pip install -e '.[web-smoke]' && playwright install chromium",
        )
        return True, True  # WARN counts as OK unless --strict


def check_editable_install() -> tuple[bool, bool]:
    try:
        mod = importlib.import_module("mantisanalysis")
        mod_path = Path(mod.__file__).parent
        expected = ROOT / "mantisanalysis"
        if mod_path.resolve() == expected.resolve():
            _status(
                "mantisanalysis (editable install)",
                "OK",
                f"{getattr(mod, '__version__', 'unknown')}",
            )
            return True, False
        _status(
            "mantisanalysis editable install",
            "WARN",
            f"imports from {mod_path}, not {expected}. Fix: pip install -e . (from repo root)",
        )
        return True, True
    except Exception as exc:
        _status(
            "mantisanalysis editable install",
            "FAIL",
            f"import failed: {type(exc).__name__}: {exc}. Fix: pip install -e .[dev]",
        )
        return False, False


def check_scripts() -> tuple[bool, bool]:
    required = [
        "smoke_test.py",
        "check_agent_docs.py",
        "check_stopping_criteria.py",
        "check_skill_frontmatter.py",
        "check_reviewer_evidence.py",
    ]
    missing = [p for p in required if not (ROOT / "scripts" / p).is_file()]
    if missing:
        _status(
            "scripts/",
            "FAIL",
            f"missing: {', '.join(missing)}. Did you clone a partial tree?",
        )
        return False, False
    _status(f"scripts/ ({len(required)} harness scripts)", "OK")
    return True, False


def check_agent_layer() -> tuple[bool, bool]:
    agent_dir = ROOT / ".agent"
    claude_link = ROOT / ".claude"
    if not agent_dir.is_dir():
        _status(
            ".agent/",
            "FAIL",
            "directory missing. The agentic operating layer "
            "lives here; reclone or restore from history.",
        )
        return False, False
    if not claude_link.exists():
        _status(
            ".claude → .agent symlink",
            "WARN",
            "symlink missing. Fix: ln -s .agent .claude",
        )
        return True, True
    try:
        target = claude_link.resolve()
        if target != agent_dir.resolve():
            _status(
                ".claude → .agent symlink",
                "WARN",
                f"points at {target}, expected {agent_dir}. "
                "Fix: rm .claude && ln -s .agent .claude",
            )
            return True, True
    except OSError as exc:
        _status(".claude → .agent symlink", "WARN", str(exc))
        return True, True
    _status(".agent/ + .claude symlink", "OK")
    return True, False


def _which(cmd: str) -> str | None:
    """Minimal shutil.which wrapper that's typed for None on miss."""
    import shutil

    return shutil.which(cmd)


def check_node_npm() -> tuple[bool, bool]:
    """bundler-migration-v1 Phase 3: Node ≥ 20 + npm.

    The frontend is now ES-module-bundled by Vite and served from
    ``web/dist/``. Without Node the app cannot be built, so any missing
    or below-floor Node install is a FAIL.
    """
    node = _which("node")
    if node is None:
        _status(
            "Node (>= 20) + npm",
            "FAIL",
            "Node not found. Needed for `npm install` + `npm run build`. "
            "Install Node >= 20 — without it the SPA cannot be built or served.",
        )
        return False, False
    try:
        version_raw = subprocess.run(
            [node, "--version"],
            capture_output=True,
            text=True,
            timeout=5,
        ).stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        _status("Node", "FAIL", f"{node} didn't respond to --version")
        return False, False
    try:
        major = int(version_raw.lstrip("v").split(".")[0])
    except (ValueError, IndexError):
        major = 0
    npm = _which("npm")
    if major < 20:
        _status(
            "Node + npm",
            "FAIL",
            f"{version_raw} is below the floor of Node 20. package.json engines pins >= 20.",
        )
        return False, False
    if npm is None:
        _status("npm", "FAIL", "npm not on PATH; Node without npm is unusual.")
        return False, False
    _status(f"Node {version_raw} + npm (at {npm})", "OK")
    return True, False


def check_frontend_lint_config() -> tuple[bool, bool]:
    """bundler-migration-v1 Phase 4 + 5: ESLint + Prettier + TypeScript
    must be wired up.

    We check for the config files + the presence of the devDependencies
    in package.json. We do NOT run the linter / type checker here —
    that's slow; `npm run lint` / `npm run format:check` / `npm run
    typecheck` are the CI gates.
    """
    eslint_cfg = ROOT / "eslint.config.js"
    prettier_cfg = ROOT / ".prettierrc.json"
    tsconfig = ROOT / "tsconfig.json"
    pkg = ROOT / "package.json"

    missing = []
    if not eslint_cfg.is_file():
        missing.append("eslint.config.js")
    if not prettier_cfg.is_file():
        missing.append(".prettierrc.json")
    if not tsconfig.is_file():
        missing.append("tsconfig.json")

    if missing:
        _status(
            "Frontend lint/format/typecheck config",
            "WARN",
            f"missing: {', '.join(missing)}. Phase 4/5 not fully installed.",
        )
        return True, True

    if pkg.is_file():
        import json as _json

        try:
            data = _json.loads(pkg.read_text(encoding="utf-8"))
        except Exception:
            data = {}
        dev = data.get("devDependencies", {})
        need = {
            "eslint",
            "prettier",
            "typescript",
            "eslint-plugin-react",
            "eslint-plugin-react-hooks",
            "typescript-eslint",
            "@types/react",
        }
        absent = [p for p in need if p not in dev]
        if absent:
            _status(
                "Frontend lint/format/typecheck devDeps",
                "WARN",
                f"missing in package.json devDependencies: {absent}",
            )
            return True, True

    _status(
        "ESLint + Prettier + TypeScript configured "
        "(eslint.config.js + .prettierrc.json + tsconfig.json)",
        "OK",
    )
    return True, False


def check_tier0() -> tuple[bool, bool]:
    script = ROOT / "scripts" / "smoke_test.py"
    if not script.is_file():
        _status("Tier 0 gate", "FAIL", "scripts/smoke_test.py missing")
        return False, False
    try:
        proc = subprocess.run(
            [sys.executable, str(script), "--tier", "0"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            timeout=30,
        )
    except subprocess.TimeoutExpired:
        _status("Tier 0 gate", "FAIL", "timed out after 30 s")
        return False, False
    if proc.returncode == 0:
        _status("Tier 0 gate", "OK")
        return True, False
    _status(
        "Tier 0 gate",
        "FAIL",
        f"exit {proc.returncode}. Run: python scripts/smoke_test.py --tier 0",
    )
    return False, False


CHECKS = [
    ("Python version", check_python),
    ("Repo root", check_repo_root),
    ("Runtime deps", check_runtime_deps),
    ("Dev deps", check_dev_deps),
    ("Web-smoke deps (optional)", check_web_smoke),
    ("Node + npm (required post bundler-migration-v1)", check_node_npm),
    ("Frontend lint/format/typecheck (Phase 4+5)", check_frontend_lint_config),
    ("Editable install", check_editable_install),
    ("Harness scripts", check_scripts),
    ("Agent layer", check_agent_layer),
    ("Tier 0 gate", check_tier0),
]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument(
        "--strict", action="store_true", help="Exit non-zero if any check is WARN (not just FAIL)."
    )
    args = ap.parse_args()

    print(f"MantisAnalysis doctor — {ROOT}")
    print()
    any_fail = False
    any_warn = False
    for _label, fn in CHECKS:
        try:
            ok, is_warn = fn()
        except Exception as exc:
            _status(_label, "FAIL", f"check crashed: {type(exc).__name__}: {exc}")
            any_fail = True
            continue
        if not ok:
            any_fail = True
        elif is_warn:
            any_warn = True
    print()
    if any_fail:
        print("doctor: some checks FAILED — see advice above.")
        return 1
    if any_warn and args.strict:
        print("doctor: warnings present + --strict, exiting non-zero.")
        return 2
    print("doctor: OK — repo is ready.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
