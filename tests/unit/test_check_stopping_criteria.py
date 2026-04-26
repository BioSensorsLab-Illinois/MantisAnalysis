"""Unit tests for scripts/check_stopping_criteria.py."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_stopping_criteria.py"


def _load(tmp_path: Path):
    spec = importlib.util.spec_from_file_location(
        f"chk_stop_{tmp_path.name}",
        SCRIPT,
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    # Re-anchor ROOT so relative_to() works against tmp.
    mod.ROOT = tmp_path
    mod.RUNS = tmp_path / ".agent" / "runs"
    return mod


def _write_status(tmp_path: Path, slug: str, body: str) -> Path:
    d = tmp_path / ".agent" / "runs" / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / "Status.md"
    p.write_text(body, encoding="utf-8")
    return p


def test_active_initiative_returns_ok_with_info(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    status = _write_status(
        tmp_path, "alpha", ("# Status — alpha\n\n## Progress\n\n- [x] M1\n- [ ] M2\n- [ ] M3\n")
    )
    ok, msgs = mod.check(status)
    assert ok is True
    assert "active" in " ".join(msgs)


def test_closed_without_final_block_fails(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    status = _write_status(
        tmp_path, "beta", ("# Status — beta\n\n## Progress\n\n- [x] M1\n- [x] M2\n")
    )
    ok, msgs = mod.check(status)
    assert ok is False
    assert "Final verification" in " ".join(msgs)


def test_closed_with_all_ticks_passes(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    status = _write_status(
        tmp_path,
        "gamma",
        (
            "# Status — gamma\n\n## Progress\n\n- [x] M1\n\n"
            "## Final verification\n\n- [x] Tier 0\n- [x] Tier 1\n- [x] pytest green\n"
        ),
    )
    ok, msgs = mod.check(status)
    assert ok is True, msgs


def test_na_deferral_allowed_without_tick(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    status = _write_status(
        tmp_path,
        "delta",
        (
            "# Status — delta\n\n## Progress\n\n- [x] M1\n\n"
            "## Final verification\n\n- [x] Tier 0\n- [ ] Tier 4 — browser smoke — N/A — harness-only\n"
        ),
    )
    ok, msgs = mod.check(status)
    assert ok is True, msgs


def test_untouched_na_without_marker_fails(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    status = _write_status(
        tmp_path,
        "epsilon",
        (
            "# Status — epsilon\n\n## Progress\n\n- [x] M1\n\n"
            "## Final verification\n\n- [x] Tier 0\n- [ ] Tier 1\n"
        ),
    )
    ok, msgs = mod.check(status)
    assert ok is False
    assert "Tier 1" in " ".join(msgs)
