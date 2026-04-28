# RISKS

Project-level risks. Each gets a unique `R-000N` ID. Append-only;
do not renumber. Closed risks stay in place with the closure date so
the ID space is stable across sessions.

## R-0010 — Keyboard / screen-reader regressions in Play tab uncaught by automated suite (2026-04-28)

**Severity**: Medium. **Likelihood**: Medium.

**Context**: The deletion of `tests/web/test_accessibility.py` (D-0018)
removed the only automated a11y regression net. The new Play surface
includes canvas ROI drawing, slider-on-canvas controls, right-click
context menus, and a 9-section Inspector — none of which are
keyboard-test covered.

**Mitigation (manual)**:
- Tier-4 boot test (`tests/web/test_web_boot.py::test_play_tab_boots`)
  proves the tab renders without console errors but does not exercise
  keyboard navigation.
- UI-initiative reviewers manually spot-check Tab traversal + Esc
  behavior on every modal touched by their change.
- Lighthouse spot-check at release time.

**Re-arm trigger**: User-reported keyboard or screen-reader regression
→ reopen with a targeted axe-smoke for the affected surface.

---

(No prior active risks at this checkpoint — see project-cycle history.)
