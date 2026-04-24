"""Unit tests for scripts/check_agent_docs.py (Tier-0 gate).

Covers: Qt-drift detection, qt-allowed block behavior (open/close,
nested, multiple, unterminated, oversized), manifest path existence,
command-path existence, cross-reference resolution, and the
subprocess wrapper in scripts/smoke_test.py::tier0.

These tests run against synthetic docs written into a tmp_path —
they do NOT scan the real .agent/ tree. That keeps them hermetic +
fast + not dependent on repo state.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_agent_docs.py"


def _load_checker(monkeypatch: pytest.MonkeyPatch, root: Path):
    """Load scripts/check_agent_docs.py with ROOT pointing at `root`.

    The module uses `Path(__file__).resolve().parent.parent` to
    locate ROOT at import time + asserts `.agent/` and CLAUDE.md
    exist. We prepare `root` accordingly, then import the module.
    """
    (root / ".agent").mkdir(parents=True, exist_ok=True)
    (root / "CLAUDE.md").write_text("# placeholder\n", encoding="utf-8")
    scripts_dir = root / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    shim = scripts_dir / "check_agent_docs.py"
    shim.write_text(SCRIPT.read_text(encoding="utf-8"), encoding="utf-8")

    spec = importlib.util.spec_from_file_location(
        f"check_agent_docs_{root.name}", shim
    )
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_qt_drift_detected_in_plain_doc(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "drift.md"
    doc.write_text(
        "# Drift\n\nThis still uses PySide6 widgets.\n",
        encoding="utf-8",
    )
    hits = mod.scan_qt_drift([doc])
    assert hits, "PySide6 mention should be flagged"
    assert hits[0][3] == "PySide6"


def test_qt_allowed_block_suppresses_hits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "history.md"
    doc.write_text(
        "# History\n\n"
        "<!-- qt-allowed: archaeology -->\n"
        "The old PySide6 window used QMainWindow.\n"
        "<!-- /qt-allowed -->\n"
        "And today we use React.\n",
        encoding="utf-8",
    )
    hits = mod.scan_qt_drift([doc])
    assert not hits, f"Content inside qt-allowed block should be skipped, got: {hits}"


def test_unterminated_allow_block_flagged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "broken.md"
    doc.write_text(
        "# Broken\n\n"
        "<!-- qt-allowed: should be closed -->\n"
        "PySide6 stuff.\n",
        encoding="utf-8",
    )
    hits = mod.scan_qt_drift([doc])
    patterns = [h[3] for h in hits]
    assert "<unterminated>" in patterns, f"Expected unterminated marker, got {patterns}"


def test_multiple_allow_blocks_in_one_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "two-blocks.md"
    doc.write_text(
        "<!-- qt-allowed -->\nPySide6\n<!-- /qt-allowed -->\n"
        "Drift here: PySide6 reference that is live.\n"
        "<!-- qt-allowed -->\nQMainWindow\n<!-- /qt-allowed -->\n",
        encoding="utf-8",
    )
    hits = mod.scan_qt_drift([doc])
    # Exactly one hit: the line between the two blocks.
    assert len(hits) == 1, f"Expected exactly one drift hit, got {len(hits)}: {hits}"
    assert hits[0][3] == "PySide6"


def test_manifest_missing_path_flagged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    (tmp_path / ".agent" / "manifest.yaml").write_text(
        "major_modules:\n"
        "  - path: mantisanalysis/does_not_exist.py\n"
        "    role: fake\n"
        "  - path: CLAUDE.md\n"
        "    role: entry\n",
        encoding="utf-8",
    )
    # Force the module's MANIFEST global to point at the tmp manifest.
    mod.MANIFEST = tmp_path / ".agent" / "manifest.yaml"
    mod.ROOT = tmp_path
    missing = mod.scan_manifest()
    assert any("does_not_exist.py" in s for s in missing)
    assert not any("CLAUDE.md" in s for s in missing)


def test_cmd_path_missing_flagged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "cmds.md"
    doc.write_text(
        "Run: `python scripts/doesnotexist.py`\n"
        "Also: `python scripts/check_agent_docs.py`\n",
        encoding="utf-8",
    )
    misses = mod.scan_command_paths([doc])
    targets = [m[2] for m in misses]
    assert "scripts/doesnotexist.py" in targets
    # `check_agent_docs.py` exists in the shim dir inside tmp_path.
    assert all("check_agent_docs.py" not in t for t in targets)


def test_pytest_template_placeholders_not_flagged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Template placeholders like `pytest tests/web/test_<feature>.py`
    must NOT be flagged as missing paths — the angle brackets break
    the match and leave `test_` dangling; the regex should reject it.
    """
    mod = _load_checker(monkeypatch, tmp_path)
    doc = tmp_path / ".agent" / "tmpl.md"
    doc.write_text(
        "Template: `pytest tests/web/test_<feature>.py`\n"
        "Template: `python -m pytest tests/unit/test_<bug>.py`\n",
        encoding="utf-8",
    )
    misses = mod.scan_command_paths([doc])
    assert not misses, f"Template placeholders should be ignored, got {misses}"


def test_cross_reference_broken_agent_flagged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    mod = _load_checker(monkeypatch, tmp_path)
    (tmp_path / ".agent" / "agents").mkdir()
    (tmp_path / ".agent" / "agents" / "real-agent.md").write_text("x\n", encoding="utf-8")
    (tmp_path / ".agent" / "skills").mkdir()
    (tmp_path / ".agent" / "skills" / "real-skill").mkdir()
    (tmp_path / ".agent" / "skills" / "real-skill" / "SKILL.md").write_text("x\n", encoding="utf-8")

    doc = tmp_path / ".agent" / "links.md"
    doc.write_text(
        "See [real-agent](.agent/agents/real-agent.md).\n"
        "Broken: [fake](.agent/agents/fake-agent.md).\n"
        "See [real-skill](.agent/skills/real-skill/SKILL.md).\n"
        "Broken: [fake](.agent/skills/fake-skill/SKILL.md).\n",
        encoding="utf-8",
    )
    # Re-anchor ROOT so the scanner rediscovers known_agents / known_skills.
    mod.ROOT = tmp_path
    misses = mod.scan_cross_references([doc])
    broken = [m[2] for m in misses]
    assert any("fake-agent" in b for b in broken)
    assert any("fake-skill" in b for b in broken)
    assert not any("real-agent" in b for b in broken)
    assert not any("real-skill" in b for b in broken)


def test_self_reference_exemption(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """`scripts/check_agent_docs.py` itself contains the Qt pattern
    list verbatim. The scanner must skip its own file so the Tier-0
    gate doesn't flag the definitions that make it work.
    """
    mod = _load_checker(monkeypatch, tmp_path)
    # Create a fake "docs" list that includes check_agent_docs.py by name.
    fake = tmp_path / "check_agent_docs.py"
    fake.write_text(
        "# a file named check_agent_docs.py with PySide6 inside\n",
        encoding="utf-8",
    )
    hits = mod.scan_qt_drift([fake])
    assert not hits, "Script's own file should be skipped"


def test_tier0_wrapper_pass_via_smoke(tmp_path: Path):
    """Integration: run `python scripts/smoke_test.py --tier 0` against
    the real repo. This verifies the end-to-end wrapper returns 0 when
    the docs are clean (which they are, per the initiative's invariant).
    """
    repo_root = Path(__file__).resolve().parents[2]
    proc = subprocess.run(
        [sys.executable, "scripts/smoke_test.py", "--tier", "0"],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc.returncode == 0, (
        f"Tier 0 wrapper failed: stdout={proc.stdout!r} stderr={proc.stderr!r}"
    )
    assert "tier 0: PASS" in proc.stdout
