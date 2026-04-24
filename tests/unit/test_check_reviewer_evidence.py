"""Unit tests for scripts/check_reviewer_evidence.py."""
from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_reviewer_evidence.py"


def _load(tmp_path: Path):
    spec = importlib.util.spec_from_file_location(f"rev_ev_{tmp_path.name}", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.ROOT = tmp_path
    mod.RUNS = tmp_path / ".agent" / "runs"
    return mod


def _make_initiative(tmp_path: Path, slug: str, status_body: str,
                     review_names=()) -> Path:
    d = tmp_path / ".agent" / "runs" / slug
    d.mkdir(parents=True, exist_ok=True)
    (d / "Status.md").write_text(status_body, encoding="utf-8")
    if review_names:
        (d / "reviews").mkdir(exist_ok=True)
        for n in review_names:
            (d / "reviews" / f"{n}-2026-04-24.md").write_text("# stub\n", encoding="utf-8")
    return d


def _write_agent(tmp_path: Path, name: str) -> None:
    d = tmp_path / ".agent" / "agents"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.md").write_text("# stub\n", encoding="utf-8")


def test_no_reviewer_table_passes(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    d = _make_initiative(tmp_path, "alpha", "# Status\n\nno table here\n")
    ok, msgs = mod.check(d)
    assert ok is True
    assert "nothing to evidence" in " ".join(msgs)


def test_table_with_no_evidence_fails(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    _write_agent(tmp_path, "docs-handoff-curator")
    _write_agent(tmp_path, "risk-skeptic")
    d = _make_initiative(tmp_path, "beta", (
        "# Status\n\n## Reviewer findings\n\n"
        "| ID | Reviewer | Severity | Title | Disposition |\n"
        "|---|---|---|---|---|\n"
        "| F-1 | docs-handoff-curator | P1 | Stale | Fixed |\n"
        "| F-2 | risk-skeptic | P2 | Edge | Deferred |\n"
    ))
    ok, msgs = mod.check(d)
    assert ok is False
    assert "docs-handoff-curator" in " ".join(msgs)
    assert "risk-skeptic" in " ".join(msgs)


def test_table_with_evidence_passes(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    _write_agent(tmp_path, "docs-handoff-curator")
    d = _make_initiative(tmp_path, "gamma", (
        "# Status\n\n## Reviewer findings\n\n"
        "| ID | Reviewer | Severity | Title | Disposition |\n"
        "|---|---|---|---|---|\n"
        "| F-1 | docs-handoff-curator | P1 | x | y |\n"
    ), review_names=["docs-handoff-curator"])
    ok, msgs = mod.check(d)
    assert ok is True, msgs


def test_unknown_agent_in_table_ignored(tmp_path: Path) -> None:
    # A review row with an unknown-agent name isn't a claim to enforce
    # (might be a human reviewer or a typo).
    mod = _load(tmp_path)
    _write_agent(tmp_path, "docs-handoff-curator")
    d = _make_initiative(tmp_path, "delta", (
        "# Status\n\n## Reviewer findings\n\n"
        "| ID | Reviewer | Severity | Title | Disposition |\n"
        "|---|---|---|---|---|\n"
        "| F-1 | docs-handoff-curator | P1 | x | y |\n"
        "| F-2 | human-zhongmin | P2 | x | y |\n"
    ), review_names=["docs-handoff-curator"])
    ok, msgs = mod.check(d)
    assert ok is True, msgs
