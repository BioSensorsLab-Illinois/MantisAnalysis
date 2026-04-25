<!-- qt-allowed: Reviewer report content discusses the Qt-era history + blocklist patterns the scanner enforces; subject matter of the review. -->

# react-ui-ux-reviewer — agentic-workflow-overhaul-v1

Invoked: 2026-04-24 (mid-M8 reviewer loop).

## Summary

Review of `.agent/UI_VERIFICATION.md`, `.agent/skills/react-browser-ui-change/SKILL.md`, the (then-extant) `accessibility-check` skill, `.agent/skills/visualization-canvas-image-pipeline/SKILL.md`, and `.agent/agents/react-ui-ux-reviewer.md`.

Macro coverage is complete (states, keyboard, responsive, theme, exports, scientific-UI). But many checks are stated as principles without measurable thresholds — two agents following the docs would produce different pass/fail calls.

## Findings

### P1

1. **Error-state simulation under-specified.** "Simulate by stopping the server" → which failures? Fix: add a 4-option trigger table (connection refused / 404 / mocked 500 / mocked slow 8-s response); require ≥ 2 of 4.

2. **Loading state no threshold.** Fix: require any fetch > 250 ms show skeleton/spinner/disabled; buttons disable during in-flight.

3. **Focus-return-to-trigger asserted once, not tested.** Neither doc has `preview_eval("document.activeElement...")` snippet. Fix: reusable snippet in playwright-e2e-verification; cross-link from accessibility-check.

4. **"Interactions actually move visible output" has no procedure.** Fix: add before/after pixel-hash step in visualization-canvas-image-pipeline Phase 3.

### P2

5. 1024×768 clip criteria vague — define as `scrollWidth > innerWidth` check.
6. Export WYSIWYG lacks concrete assertion — add Pillow size check.
7. Channel-color preservation has no automated check — add preview_eval snippet.

### P3

8. Tab-order log has no artifact — require `screenshots/tab-order.txt`.

### Gaps in the checklist

- Empty-state "guidance, not blank" is not defined.
- Destructive-actions confirmed/undoable missing entirely.
- "Primary action visually primary" absent.

## Disposition (applied by implementer)

- F-23 (error trigger table) — **fixed inline** in UI_VERIFICATION.md.
- F-24 (loading threshold) — **fixed inline** (250 ms rule).
- F-25 (focus-return snippet) — **fixed inline**.
- F-26 (pixel-hash for interactions) — **fixed inline**.
- F-27 (1024×768 criteria) — **fixed inline** (scrollWidth check).
- F-28 (export Pillow size check) — **fixed inline**.
- F-29 (destructive actions + primary-action checks + empty-state definition) — **fixed inline** in UI_VERIFICATION §10.
- 7, 8: deferred as polish.

<!-- /qt-allowed -->
