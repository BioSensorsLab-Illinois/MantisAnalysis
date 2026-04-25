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
- [x] **M2** — Destructive-action 2-step confirm pattern. New
      `web/src/playback/ConfirmRemoveButton.tsx` primitive (text or
      icon mode) replaces every Playback "Remove" call site
      (FilePill, DarkFrameRow, ViewerCard). First click arms (red
      bg + label "Click again to confirm"); second click within 3 s
      commits; auto-revert at 3 s; Esc disarms. `data-action=remove`,
      `data-armed`, `aria-pressed` for tests + AT. New Tier 4 test
      `test_playback_destructive_remove_two_step_confirm` exercises
      arm + Esc-disarm + arm + commit. Browser-verified via preview
      MCP.
- [x] **M3** — HandoffModal (W11) shipped at
      `web/src/playback/HandoffModal.tsx`. Viewer-toolbar
      `→U/→F/→D` buttons now dispatch `modal/open` with kind
      `handoff` instead of firing `playbackApi.handoff` immediately.
      The modal renders a structured summary (View name, Channels,
      Frame, Timestamp, Exposure, Dark correction, Source stream,
      ISP mode), error banner, Cancel + Send buttons. Send fires
      the same `playbackApi.handoff` + `onConfirmed` callback the
      old inline path used; Cancel/Esc closes without dispatching.
      Existing M11 test updated to click Confirm; new M3 test
      `test_playback_handoff_opens_modal_then_confirms` exercises
      Cancel + Confirm. Browser-verified via preview MCP.
- [x] **M4** — Responsive collapse for Sources panel. New
      `CollapsedSourcesRail` sub-component renders a 44 px icon
      rail (chevron expand · recordings tile with badge · darks
      tile with badge) when `useViewport().isNarrow` (viewport <
      1180 px). Chevron expand sets `forceExpanded=true` →
      panel re-renders at 288 px wide as an `position: absolute`
      overlay over the workspace (z-index 50, top: 34 px below
      stream header, left: 44 px past mode rail) so the workspace
      keeps its width. Collapse `‹` button in the expanded
      header reverts. At ≥ 1180 px the panel returns to its
      normal in-flow column. Tracked via `data-collapsed` and
      `data-force-expanded` attrs. New Tier 4 test exercises all
      transitions (narrow → collapsed → overlay → collapsed →
      wide → in-flow). Browser-verified via preview MCP at 1024
      and 1440 widths.
- [ ] **M5** — ViewerCardContextMenu (right-click → Send to
      USAF/FPN/DoF, Lock, Duplicate, Remove).
- [ ] **M6** — Inspector body text 10 → 11.5 px (M12 react-ui-ux P2)
      + per-cell layout placeholder + close.

## Tests run

| Date | Command | Result | Wall time |
|---|---|---|---|
| 2026-04-25 | M0 — initiative scaffold | n/a | n/a |
| 2026-04-25 | M1 — Tier 0 + pytest -q (263 PASS) + web_smoke (22 PASS, +1) | PASS | ~55s + ~42s |
| 2026-04-25 | M2 — Tier 0 + pytest -q (264 PASS) + web_smoke (23 PASS, +1) | PASS | ~56s + ~44s |
| 2026-04-25 | M3 — Tier 0 + pytest -q (265 PASS) + web_smoke (24 PASS, +1) | PASS | ~58s + ~46s |
| 2026-04-25 | M4 — Tier 0 + pytest -q (266 PASS) + web_smoke (25 PASS, +1) | PASS | ~59s + ~47s |

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
