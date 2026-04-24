<!-- qt-allowed: Reviewer report content discusses the Qt-era history + blocklist patterns the scanner enforces; subject matter of the review. -->

# test-coverage-reviewer — agentic-workflow-overhaul-v1

Invoked: 2026-04-24 (mid-M8 reviewer loop).

## Summary

The new Tier-0 gate (`scripts/check_agent_docs.py` + `smoke_test.py::tier0`) shipped with **zero unit tests**. That's the only net-new test-relevant surface in this initiative, and it has functional gaps that will cause silent false-negatives. Current state: `pytest -q` 65/65; `--tier 0` passes in ~0.5 s. Recommend one new file (`tests/unit/test_check_agent_docs.py`, ~8 tests) plus small patches to `QT_PATTERNS`, `MANIFEST_PATH_RE`, and `CMD_PATH_RE`.

## Findings

### P1

1. **No tests for scripts/check_agent_docs.py.** The checker blocks every session. False-negative here silently lets drift ship. Add `tests/unit/test_check_agent_docs.py` with 8 tests: qt_drift_detected, qt_allowed_block_suppresses, unterminated_allow_flagged, multiple_allow_blocks, manifest_missing_path, cmd_path_missing, self_reference_exemption, tier0_subprocess_wrapper_bubbles_failure.

2. **QT_PATTERNS incomplete.** Grep surfaces: QtWidgets, QtCore, QtGui, pyqtgraph, pytest-qt, QSettings, QAction, QComboBox, QTabWidget, QDialog, QLabel, QSpinBox, Q[H/V/Grid]Layout, exec_(), Qt.AlignCenter, Signal(, Slot(. Extend with a Qt-family regex + explicit entries.

### P2

3. qt-allowed same-line open+close is ambiguous; document or handle.
4. MANIFEST_PATH_RE only catches `- path:` entries, not `important_docs:` values or top-level scalars.
5. CMD_PATH_RE misses bare `pytest` invocations, `uvicorn`, `mantisanalysis` entry-point, `playwright install`.
6. QUALITY_GATES.md vs skills/quality-gates/SKILL.md divergence on Tier 0 invocation (direct vs wrapper).

### P3

7. Tier 0 description "Any .agent/ edit" vs manifest.yaml "mandatory_always" — align wording.

## Disposition (applied by implementer)

- F-30 (unit tests) — **fixed inline** — `tests/unit/test_check_agent_docs.py` with 10 tests, all green.
- F-31 (QT_PATTERNS) — **fixed inline** — 10+ new patterns.
- F-32 (PYTEST_PATH_RE tighter + template placeholders) — **fixed inline**.
- F-33 (MANIFEST scan of important_docs + top-level scalars) — **fixed inline**.
- 3, 6, 7: deferred as polish.

<!-- /qt-allowed -->
