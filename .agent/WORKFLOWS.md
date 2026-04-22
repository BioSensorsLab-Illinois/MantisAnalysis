# WORKFLOWS

End-to-end recipes for each common change class. Every workflow ends
with the smoke gate.

## A. Session start (every session)

```bash
cd /c/Users/J/BioSensors-Lab/MantisAnalysis
cat .agent/00_START_HERE.md .agent/AGENT_RULES.md
git status -sb
ls .agent/runs/ 2>/dev/null
python scripts/smoke_test.py --tier 1
python scripts/smoke_test.py --tier 2
```

If Tier 1 or Tier 2 fails → fix or revert before starting new work.

## B. Non-trivial work (> 3 files) — initiative

1. `cp -r .agent/templates/ExecPlan.md .agent/runs/<slug>/ExecPlan.md`
2. `cp .agent/templates/Status.md .agent/runs/<slug>/Status.md`
3. `git checkout -b <slug>`
4. Fill ExecPlan's `Goal` and first `Milestone`.
5. Make changes in small commits; update Status.md at each milestone.
6. Run Tier 1 + Tier 2 after each milestone; Tier 3 at end.
7. On finish → move `.agent/runs/<slug>` into `.agent/runs/_archive/`.
8. Update `CHANGELOG_AGENT.md`.

## C. Analysis-math change (pure NumPy/SciPy)

Example: a new Michelson estimator.

1. Edit `mantisanalysis/<module>_analysis.py` or `usaf_groups.py`.
2. **Never import `PySide6` or `matplotlib.pyplot` in these modules.**
3. Add or extend a unit test under `tests/unit/`.
4. `python -m pytest tests/unit/ -q`.
5. `python scripts/smoke_test.py --tier 1`.
6. `python scripts/smoke_test.py --tier 2` — figures should still build.
7. If you added new dataclass fields: also extend
   `tests/headless/test_figures.py` to verify render modules still use
   them correctly.
8. Update `.agent/ARCHITECTURE.md` if the change alters a key invariant.

## D. Figure-builder change (matplotlib / render.py)

1. Edit `mantisanalysis/<module>_render.py`.
2. Theme-aware: take `fig_face` and `text` as kwargs and propagate.
3. `python scripts/smoke_test.py --tier 2` and inspect the PNGs in
   `outputs/smoke/` visually if the change is cosmetic.
4. `python -m pytest tests/headless/ -q`.

## E. UI (Qt) change

1. Edit `scripts/pick_lines_gui.py` (for USAFPickerApp / MainWindow /
   THEMES / QSS) or `mantisanalysis/modes/<name>.py` (for FPN / DoF).
2. If the change touches a sidebar layout, re-verify the sidebar
   overflow fix: `QScrollArea` must use
   `setHorizontalScrollBarPolicy(ScrollBarAsNeeded)` +
   `setMinimumWidth(180)` + `body.setMinimumWidth(0)`. See RISK R-0002.
3. If the change touches QSS, confirm it in both themes (light + dark).
4. Tier-3 smoke: `python scripts/smoke_test.py --tier 3` must exit 0.
5. Open the app live and verify the modified control behaves correctly
   — no substitute for this on Qt work.

## F. I/O change (`image_io.py`, `extract.py`)

1. Changing the channel key schema is a CONTRACT change. See
   `AGENT_RULES.md` rule 6. If you must, record a DECISIONS entry and
   update every call site.
2. `python -m pytest tests/unit/test_bayer.py -q`.
3. Tier 1 + Tier 2.
4. Load a real H5 file in the GUI to spot-check.

## G. Theme / QSS change (`pick_lines_gui.THEMES`, `make_qss`,
`apply_palette`)

1. Always update both `light` and `dark` palette dicts (same keys).
2. Every new key must be referenced by name in the QSS template at
   `scripts/pick_lines_gui.py:135-246`.
3. Tier 3 smoke; then open the GUI and switch View → Theme between
   Light and Dark.

## H. Packaging / dependency change

1. Update `pyproject.toml` `[project].dependencies` or
   `[project.optional-dependencies].dev`.
2. Mirror into `requirements.txt` for compatibility.
3. `pip install -e .[dev]` → succeeds.
4. Tier 1 smoke.
5. Record in `DECISIONS.md` if adding a new top-level dep.

## I. CI change (`.github/workflows/`)

1. Keep the Tier 1 leg mandatory on all platforms.
2. Tier 2 runs on Linux (Agg backend — no display needed).
3. Tier 3 can be added once a clean xvfb-run setup is in place; don't
   add before (flaky CI is worse than no CI).

## J. Release / tag

See `.agent/TASK_PLAYBOOK.md` § Release.

## K. Ending a session

See `AGENT_RULES.md` → *Quitting-the-session rules*.
