# Status — playback-ux-polish-v1

> Updated at every milestone. Never delete prior content; append.

Opened: 2026-04-25
Last updated: 2026-04-25 (initiative open; M0 audit done; M1
in-progress)

## Current branch

`main` — per user policy from
`recording-inspection-implementation-v1`, working directly on
main; per-milestone commit; push only on explicit consent.

## Active initiative

`.agent/runs/playback-ux-polish-v1/`

## Origin

B-0030 in `.agent/BACKLOG.md`. Captures the 5 deferred react-ui-ux
P1s that the M12 close of
`recording-inspection-implementation-v1` filed as a follow-up
initiative. Prerequisite for B-0032 (Playback feature-flag default
flip).

## Milestones

- [x] **M0** — initiative open + scope (folded into M1 commit).
- [x] **M1** — Drop-zone wiring on the Playback empty-state hero:
      `onDragOver`/`onDragLeave`/`onDrop` route to existing
      `onRecordingFiles`; non-`.h5` entries filtered. `data-region=
      empty-state-dropzone` + `data-drag-over` for tests; aria-label
      added; copy and accent-color flip while dragging. New Tier 4
      Playwright test exercises dragover + drop + filter (one .h5 +
      one .txt → one upload POST). Browser-verified via preview MCP.
- [ ] **M2** — Destructive-action confirm/undo on FilePill +
      DarkFrameRow + ViewerCard Remove.
- [ ] **M3** — HandoffModal between toolbar click and dispatch
      (W11; per UI_IMPLEMENTATION_NOTES §21a).
- [ ] **M4** — Responsive collapse: Sources panel → 44 px icon
      rail at viewport < 1180 px.
- [ ] **M5** — ViewerCardContextMenu (right-click → Send to
      USAF/FPN/DoF, Lock, Duplicate, Remove).
- [ ] **M6** — Inspector body text 10 → 11.5 px (M12 react-ui-ux P2)
      + per-cell layout placeholder + close.

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-04-25 | M0 — initiative scaffold | n/a | n/a |
| 2026-04-25 | M1 — Tier 0 + pytest -q (263 PASS) + web_smoke (22 PASS, +1) | PASS | ~55s + ~42s |

## Smoke status (from prior initiative close)

- Tier 0: ✅
- Tier 1: ✅ (21 modules)
- Tier 2: ✅
- Tier 3: ✅ (45 playback Tier 3 tests)
- Tier 4: ✅ (21 web_smoke)
- pytest: ✅ (262/262)
- npm build/lint/typecheck/build-storybook: ✅

## Stop / resume notes

Each milestone is one commit; the milestone descriptions in
"Milestones" double as resume hints. If the session stops mid-Mn,
read the per-milestone notes section at the bottom for current
edit state.

## Per-milestone notes

(empty — populated as milestones progress)
