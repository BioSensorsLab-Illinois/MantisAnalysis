# RISKS

Known minefields. Each entry has an ID, severity, evidence, and
mitigation. Append new risks as discovered.

---

## R-0001 — Widget classes duplicated  (severity: medium)

**Where**: `scripts/pick_lines_gui.py:338` (`Card`), `:357` (`slider_row`),
`:409` (`ImageCanvas`), `:309` (`apply_transform`) — AND
`mantisanalysis/modes/common.py:20` / `:41` / `:90` / `:249`.

**Symptom**: `USAFPickerApp` uses the local copies; `FPNMode` and
`DoFMode` use the `common.py` copies. Drift between the two
implementations is silent.

**Mitigation today**: documented and pinned in BACKLOG B-0002 + tracked
under `.agent/runs/widget-deduplication/` (open initiative).

**Trigger to reconsider**: any QSS change to `Card` or any
mouse-event change to `ImageCanvas`. **Make the change in BOTH
locations** until B-0002 collapses them.

---

## R-0002 — Sidebar overflow regressions  (severity: medium)

**Where**: every mode sidebar uses `_scrollable(body)` which sets
`setHorizontalScrollBarPolicy(ScrollBarAsNeeded)` +
`setMinimumWidth(180)` + `body.setMinimumWidth(0)`.

**Symptom**: if any of those three settings drops, the sidebar will
expand to fit its widest child and push the window past the screen
edge (observed during this development).

**Mitigation**: `WORKFLOWS.md` § E and § F call this out. Tier-3 smoke
launches at 1280×800 default; visually obvious regressions there.

**Trigger to reconsider**: any new sidebar widget with hard-coded
width or long text. Cap with `setMaximumWidth(...)` and/or
`setWordWrap(True)`.

---

## R-0003 — `USAFPickerApp` is a `QMainWindow`  (severity: medium)

**Where**: `scripts/pick_lines_gui.py:523`.

**Symptom**: `MainWindow.__init__` (line 1755) embeds it via
`takeCentralWidget()` and **monkey-patches** `_update_status` (line 1779)
and `_do_open` (line 1791). Renaming either of these private methods
silently breaks the wiring.

**Mitigation today**: AGENT_RULES rule 5 forbids renames without a
DECISIONS entry. BACKLOG B-0003 plans the demotion to `QWidget`.

---

## R-0004 — Dead code import path: `mantisanalysis/extract.py:split_and_extract`
(severity: low)

**Where**: `mantisanalysis/extract.py:112-117`.

**Symptom**: function is exported but never called. Harmless, but a
fresh agent can spend time tracing why it exists.

**Mitigation**: covered by ruff (`F841` etc.) in CI. Slated for removal
when the next math change touches the module.

---

## R-0005 — Sharpen-to-analysis can produce unphysical Michelson > 1
(severity: low)

**Where**: `mantisanalysis/image_processing.py` (Unsharp mask /
Laplacian / High-pass) + `mantisanalysis/usaf_groups.py:measure_modulation`.

**Symptom**: enabling `Apply sharpening to analysis` with Unsharp Amount
≥ 2 produces percentile-based Michelson values like `1.947` (LG-R smoke).
Mathematically the kernel makes the profile non-positive in spots, so
percentile values can give >1 ratios.

**Mitigation today**: status bar prints a heads-up when the toggle
flips on; values reported as-is to avoid hiding the user's choice.

**Trigger to reconsider**: if the user wants this clamped + warned,
record a DECISIONS entry and add the clamp to `measure_modulation`.

---

## R-0006 — Rotate / flip silently invalidates picks  (severity: low)

**Where**: USAF (`scripts/pick_lines_gui.py:_set_rotation`), FPN
(`mantisanalysis/modes/fpn.py:_set_rotation` clears ROI), DoF
(`mantisanalysis/modes/dof.py:_set_rotation` clears points + lines).

**Symptom**: a user who saves USAF lines JSON, re-opens later at a
different rotation, will see misaligned picks.

**Mitigation**: TBD. Could either (a) re-map coordinates through the
rotation automatically, or (b) refuse to load a JSON whose
`transform.rotation` doesn't match the current view. BACKLOG B-0007.

---

## R-0007 — `dof_render` reaches into `fpn_render` private helpers
(severity: low)

**Where**: `mantisanalysis/dof_render.py:40` —
`from .fpn_render import _color, _ch, _style_axes`.

**Symptom**: any change to those helpers in `fpn_render` silently
affects DoF rendering.

**Mitigation**: BACKLOG B-0005 — hoist the helpers into a neutral
`mantisanalysis/plotting.py`.

---

## R-0008 — Rename husk: empty `rgbnir-analysis/` folder  (severity: cosmetic)

**Where**: `C:\Users\J\BioSensors-Lab\rgbnir-analysis\` (empty).

**Symptom**: Windows held a handle on the original folder root during
the rename, so robocopy moved contents but couldn't delete the empty
husk. Harmless.

**Mitigation**: user to delete manually after closing any Explorer
windows that reference the path. Try: `rmdir /s /q
"C:\Users\J\BioSensors-Lab\rgbnir-analysis"`.
