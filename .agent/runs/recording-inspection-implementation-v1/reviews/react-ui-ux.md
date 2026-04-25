# react-ui-ux — recording-inspection-implementation-v1 (M12 close)

Reviewed by: `react-ui-ux-reviewer` agent
Date: 2026-04-25

## Scope

Live preview at 1440×900 (light + dark) and 1024×768 in Chromium,
playback flag enabled, synthetic sample loaded. Console clean, no
failed network requests.

## Summary

Three-column layout (Sources / Workspace / Inspector) is conceptually
sound; 9-section Inspector with Basic/Advanced toggle is discoverable.
Implementation **misses several explicit promises in
`UI_IMPLEMENTATION_NOTES.md`** (responsive collapse, handoff
confirmation modal, right-click context menu, focus ring tokens, ARIA
roles on modals). Ships a **dead drop zone** plus **destructive remove
without confirm**.

## Confirmed facts (from browser verification)

- Empty state + sample-load both render correctly.
- Esc closes Export Image modal and focus returns.
- Space / Arrow / Home / End keyboard works.
- Inspector Basic/Advanced toggle works.
- Baseline screenshots accurate, **except `M12_baseline_empty_state_light_1440x900.png`
  is byte-identical to the dark variant** (theme flip never fired).

## Findings

| Sev | Title | File:line | Observed → Fix |
|---|---|---|---|
| P0 | Modals lack `role="dialog"` + `aria-modal="true"` | `web/src/shared.tsx` Modal | DOM scan returns `[]` for `[role="dialog"], [aria-modal]`. Fix: shared `Modal` adds `role="dialog"`, `aria-modal="true"`, `aria-label={label}`. |
| P1 | "Drop .h5 files here" empty-state target is decorative | `web/src/playback/EmptyState.tsx:76-87` + `index.tsx` (no `onDragOver`/`onDrop`) | User drops file → nothing happens. Fix: attach `onDragOver` (preventDefault + visual feedback) and `onDrop` (route to `onRecordingFiles`). |
| P1 | Remove recording / dark frame is destructive without confirm or undo | `web/src/playback/FilePill.tsx:172-179`, `index.tsx:156-162` | Click "Remove" → immediate DELETE → row disappears. Fix: confirm prompt or 10-s undo toast. |
| P1 | `→U / →F / →D` handoff fires immediately, no `HandoffModal` confirm | `web/src/playback/index.tsx:367-383` | Spec §21a promises confirmation modal; live: instant mode-switch. Fix: insert `HandoffModal` OR strike §21a from spec. |
| P1 | Sources panel does NOT collapse to 44px icon rail at sm breakpoint (960–1180px) | `web/src/playback/SourcesPanel.tsx:54-66`; spec §12 | At 1024×768 workspace squeezed to **364 px**; 2×2 cells become 168 px (unusable). Fix: implement `useNarrow` from `shared.tsx`. |
| P1 | M11 handoff buttons (`→U / →F / →D`) have no `title` tooltip | `web/src/playback/ViewerCard.tsx:339-396` | Sighted hover users see only `→U`. Fix: add `title="Send to USAF Resolution"` etc. |
| P1 | No focus-ring token applied — controls fall back to browser default | every custom `<button>` style block | Inspected layout button: outline = `rgb(229,151,0) auto 1px`. Fix: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }` shared helper. |
| P1 | Right-click on ViewerCard does nothing; spec promises a context menu | `web/src/playback/ViewerCard.tsx`; spec line 24 + §21a | `dispatchEvent('contextmenu')`: no `[role="menu"]`. Fix: implement OR strike §21a. |
| P2 | M12 "light theme" baseline screenshot is byte-identical to dark | `screenshots/M12_baseline_empty_state_*.png` | Theme flip never fired. Fix: re-capture with `localStorage['mantis/theme']==="light"` set. |
| P2 | Empty-state "Open recording…" duplicates Sources panel "+ Open" | `EmptyState.tsx:72-74` + `SourcesPanel.tsx:160-167` | Two paths to the same action. Fix: hide one. |
| P2 | Inspector text uses 9.5–10.5 px throughout | `Inspector.tsx:85-90`, multiple | Fatiguing, low for reading. Bump to 11.5 px baseline. |
| P2 | View-Name input and viewer-card name not bound | `Inspector.tsx:633-649` | Editing renames title; "INSPECTOR / HG-G" header still references channel. |
| P2 | 2×2 placeholder spans 1 row only | `ViewerGrid.tsx:188-207` | Bottom row is empty without a CTA. Fix: per-cell placeholder. |
| P3 | Handoff button glyphs at 9 px in 22×22 button | `ViewerCard.tsx:357, 383, 410` | Add 10–11 px or Unicode arrow + initial letter. (P1 size bump to 24 from accessibility report subsumes this.) |
| P3 | No empty state for ViewerGrid before any view added (rare path) | `ViewerGrid.tsx:152-208` | Add "Add first view" CTA. |

## Disposition (M12)

- **P0 (modal ARIA):** subsumed by accessibility-reviewer P0 — apply
  in M12 (`shared.tsx::Modal` add `role="dialog"`, `aria-modal="true"`,
  focus trap, focus return).
- **P1 dead-drop-zone, no-confirm-remove, no-handoff-confirm,
  no-responsive-collapse, missing-`title`-on-handoff, no-focus-ring,
  no-context-menu (7):** several documented in spec but not
  implemented. **Apply minimum:** add `title` tooltip on handoff
  buttons (5-min fix); add `:focus-visible` ring (one shared style);
  fix the baseline-capture light-theme screenshot. **Defer:** drop
  zone, remove confirm, handoff confirmation modal, responsive
  collapse, right-click menu — all material UI work; track as
  `playback-ux-polish-v1` follow-up in BACKLOG.
- **P2/P3:** all to BACKLOG.

## Recommendation

**Do not close M12 before resolving the P0** (modal ARIA, applied
inline in M12 via shared.tsx Modal upgrade) **and the cheap P1
items** (handoff `title`, focus-visible, baseline re-capture). The
larger P1 items (responsive collapse, handoff modal, drop zone,
context menu, remove confirm) are real but represent material UI
work; tracked as a follow-up `playback-ux-polish-v1` initiative.
