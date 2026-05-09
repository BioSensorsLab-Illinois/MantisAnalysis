"""Unit tests for scripts/check_skill_frontmatter.py."""

from __future__ import annotations

import importlib.util
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_skill_frontmatter.py"


def _load(tmp_path: Path):
    spec = importlib.util.spec_from_file_location(f"skill_fm_{tmp_path.name}", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.ROOT = tmp_path
    mod.SKILLS = tmp_path / ".agent" / "skills"
    mod.AGENTS = tmp_path / ".agent" / "agents"
    return mod


def _write_skill(tmp_path: Path, slug: str, frontmatter: str, body: str = "# body\n") -> Path:
    d = tmp_path / ".agent" / "skills" / slug
    d.mkdir(parents=True, exist_ok=True)
    p = d / "SKILL.md"
    p.write_text(f"---\n{frontmatter}\n---\n\n{body}", encoding="utf-8")
    return p


def _write_agent(tmp_path: Path, name: str) -> None:
    d = tmp_path / ".agent" / "agents"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.md").write_text("# stub\n", encoding="utf-8")


def test_valid_skill_passes(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    _write_agent(tmp_path, "some-reviewer")
    p = _write_skill(
        tmp_path,
        "good-skill",
        (
            "name: good-skill\n"
            "description: valid description\n"
            "when_to_use:\n  - trigger one\n  - trigger two\n"
            "related_agents: some-reviewer"
        ),
    )
    findings = mod.check_skill(p, {"some-reviewer"})
    assert findings == []


def test_missing_frontmatter_flagged(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    d = tmp_path / ".agent" / "skills" / "no-fm"
    d.mkdir(parents=True)
    p = d / "SKILL.md"
    p.write_text("# nothing here\n", encoding="utf-8")
    findings = mod.check_skill(p, set())
    assert any("missing or malformed frontmatter" in f for f in findings)


def test_name_directory_mismatch_flagged(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    p = _write_skill(
        tmp_path, "dir-name", ("name: wrong-name\ndescription: x\nwhen_to_use:\n  - trig")
    )
    findings = mod.check_skill(p, set())
    assert any("directory is 'dir-name'" in f for f in findings)


def test_description_too_long_flagged(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    long_desc = "A" * (mod.MAX_DESCRIPTION_LEN + 1)
    p = _write_skill(
        tmp_path,
        "long-desc",
        (f"name: long-desc\ndescription: {long_desc}\nwhen_to_use:\n  - trig"),
    )
    findings = mod.check_skill(p, set())
    assert any("chars (max" in f for f in findings)


def test_broken_related_agent_flagged(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    p = _write_skill(
        tmp_path,
        "broken-ref",
        (
            "name: broken-ref\n"
            "description: x\n"
            "when_to_use:\n  - trig\n"
            "related_agents: nonexistent-reviewer"
        ),
    )
    findings = mod.check_skill(p, {"other-reviewer"})
    assert any("nonexistent-reviewer" in f for f in findings)


def test_empty_when_to_use_flagged(tmp_path: Path) -> None:
    mod = _load(tmp_path)
    p = _write_skill(
        tmp_path, "empty-triggers", ("name: empty-triggers\ndescription: x\nwhen_to_use:\n")
    )
    findings = mod.check_skill(p, set())
    assert any("when_to_use list is empty" in f for f in findings)
