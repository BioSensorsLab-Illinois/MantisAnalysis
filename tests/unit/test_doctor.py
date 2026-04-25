"""B-0012 — scripts/doctor.py smoke.

We don't assert exit 0 because some CI / dev environments legitimately
lack `ruff` or `mypy` and the doctor reports that honestly. We just
assert the script imports cleanly, its check list is complete, and
subprocess-invoking it doesn't blow up.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "doctor.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("doctor_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_doctor_module_imports() -> None:
    mod = _load_module()
    # CHECKS is a list of (label, fn) pairs. Expect ≥ 8 checks.
    assert hasattr(mod, "CHECKS")
    assert isinstance(mod.CHECKS, list)
    assert len(mod.CHECKS) >= 8
    for label, fn in mod.CHECKS:
        assert isinstance(label, str)
        assert callable(fn)


def test_doctor_check_repo_root_is_ok() -> None:
    """The one check that MUST pass in-repo: repo root resolves."""
    mod = _load_module()
    ok, _ = mod.check_repo_root()
    assert ok is True


def test_doctor_subprocess_runs() -> None:
    """Running doctor.py as a subprocess doesn't crash with a traceback."""
    proc = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True,
        text=True,
        timeout=45,
    )
    # Exit 0 or 1 is OK (1 = some env check failed — legitimate).
    # 2 = strict-mode warning exit. None of these are crashes.
    # A Python traceback would appear in stderr.
    assert proc.returncode in (0, 1, 2), (
        f"unexpected exit: {proc.returncode}, stderr={proc.stderr!r}"
    )
    # No unhandled exception should reach stderr.
    assert "Traceback" not in proc.stderr, proc.stderr
