# TASK_PLAYBOOK

Concrete recipes. These are not theory; they are copy-paste starting
points for common tasks.

## Recipe: add a new channel to the I/O loader

Task: extend `load_any()` to recognize a new camera format.

Files: `mantisanalysis/image_io.py`, `mantisanalysis/extract.py`.

1. Read `image_io.py` `load_any` dispatcher (~line 93).
2. Add a new detector (file-extension or magic-bytes) that routes to a
   new loader.
3. Return key dict matching the established schema (`HG-R`, `LG-G`,
   etc.). **Renames are forbidden** — see AGENT_RULES rule 6.
4. Add a test under `tests/unit/test_bayer.py` or a new
   `tests/unit/test_image_io.py`.
5. Tier 1 + Tier 2 smoke.
6. Update `ARCHITECTURE.md` / `REPO_MAP.md` if a new file was added.

## Recipe: add a new analysis tab to the USAF window

Task: add a 7th tab to the 6-tab USAF analysis window.

Files: `mantisanalysis/usaf_render.py`.

1. Add a new builder function `_build_<name>_tab(parent, app_state,
   measurements, threshold, fig_face, text, accent)` following the
   signature of `_build_mtf_tab` etc.
2. Wire it into `open_analysis_window` right before `if parent is not
   None:` (see line ~710 in current file).
3. Tier 2 smoke generates sample figures — add an assertion in
   `tests/headless/test_figures.py` that your new builder returns a
   Figure.
4. Tier 3 smoke verifies the full window still opens.

## Recipe: add a new mode to the application

Task: introduce a 4th mode (e.g., "Color Calibration").

Files: `mantisanalysis/modes/<name>.py` (new), `scripts/pick_lines_gui.py`.

1. Copy `mantisanalysis/modes/fpn.py` as a starting template.
2. Rename the class; implement:
   - `__init__(self, parent_app, *, theme_provider)`
   - `on_file_loaded()`
   - `on_theme_changed()`
   - Layout with the three-column splitter pattern from `fpn.py`.
3. In `scripts/pick_lines_gui.py` `MainWindow.__init__`:
   - Import the new mode.
   - Add it to `self.stack` as a new page.
   - Add its label to `MainWindow.MODES`.
4. Add a "Run <Mode>" button that constructs a `QMainWindow` child
   analysis window with tabs and export buttons.
5. Add a new `mantisanalysis/<name>_analysis.py` with pure math.
6. Add a new `mantisanalysis/<name>_render.py` with figure builders.
7. Unit tests under `tests/unit/test_<name>_math.py`.
8. Extend `scripts/smoke_test.py` Tier-2 to cover the new builders.
9. Update `.agent/ARCHITECTURE.md`, `.agent/REPO_MAP.md`, `manifest.yaml`.
10. Tier 1/2/3 smoke all green.

## Recipe: fix a sidebar-overflow regression

Task: a card grew wider than the sidebar again.

Files: `mantisanalysis/modes/<mode>.py` or `scripts/pick_lines_gui.py`.

1. Verify the symptom at low default size (1280×800 or your screen).
2. Find the sidebar's `_scrollable(...)` — must have:
   ```python
   sa.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarAsNeeded)
   sa.setMinimumWidth(180)
   body.setMinimumWidth(0)
   ```
3. For the offending widget, cap its max width:
   `widget.setMaximumWidth(180)` or shorten its text.
4. Tier 3 smoke to verify the window still opens cleanly.

## Recipe: add a pytest that mirrors a bug fix

Template:

```python
# tests/unit/test_<bug-area>.py
import pytest
from mantisanalysis.<module> import <fn>

def test_<bug_description>():
    # Arrange
    ...
    # Act
    result = <fn>(...)
    # Assert the behaviour that the bug fix introduced
    assert result == <expected>
```

Run: `python -m pytest tests/unit/test_<bug-area>.py -q`.

## Recipe: make a release tag

1. Update `mantisanalysis/__init__.py` `__version__`.
2. Update `pyproject.toml` `version`.
3. `python -m pytest tests/ -q` and `scripts/smoke_test.py --tier 3`.
4. `git add -A && git commit -m "Release v0.X.Y"`
5. `git tag v0.X.Y`
6. `git push origin main --tags` (manual, do not automate without
   explicit user consent).
7. Update `CHANGELOG_AGENT.md`.

## Recipe: bring a DECISIONS entry in

Template:
```
## D-000N — <one-line title>  (YYYY-MM-DD)

**Context**: <what forced the choice>
**Options**: <options considered>
**Decision**: <what was chosen>
**Consequences**: <what this locks in>
**Revisit**: <trigger that would make us reconsider>
```

Append at the bottom of `.agent/DECISIONS.md`. Bump the D-000N counter.
