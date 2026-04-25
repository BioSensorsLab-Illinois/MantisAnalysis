# accessibility — recording-inspection-implementation-v1 (M12 close)

Reviewed by: `accessibility-reviewer` agent
Date: 2026-04-25
Tooling: axe-core 4.10.2 (wcag2a + wcag2aa + wcag22aa) + manual
Tab walk (68 stops) + manual contrast computation + focus-trap probe.

## Scope

`web/src/playback/*.tsx` (16 files) live-mounted with the
`mantis/playback/enabled` flag on, synthetic stream loaded, all four
modals opened (StreamBuilder, OverlayBuilder, ExportImage,
ExportVideo).

## Result

2 axe violations (1 critical, 1 serious). Several P1/P2 manual
findings — primarily modal focus management, accent/warn contrast
on light backgrounds, WCAG 2.2 SC 2.5.8 target size, focus-visible
styling.

## Findings

| Sev | Finding | WCAG SC | File:line | axe rule |
|---|---|---|---|---|
| P0 | `<div role="button" aria-selected="true">` on ViewerCard — `aria-selected` not allowed on `role=button`. | 4.1.2 | `ViewerCard.tsx:119-121` | `aria-allowed-attr` (critical) |
| P0 | `Modal` overlay has no `role="dialog"`, no `aria-modal="true"`, no focus trap, no auto-focus on open, no focus return to trigger on close. After Esc, `document.activeElement === <body>`. | 4.1.2, 2.4.3, 2.4.11 | `web/src/shared.tsx` Modal | n/a |
| P0 | ViewerCard hover toolbar (Lock/Duplicate/→U/→F/→D/Remove) mounted only when `(hover \|\| selected)` — non-selected viewers expose **zero** keyboard-reachable controls. | 2.1.1 | `ViewerCard.tsx:274` | n/a |
| P0 | `<button role=button>` (ViewerCard root) contains nested `<button>` elements (toolbar + handoff). Screen readers cannot reach inner controls. | 4.1.2 | `ViewerCard.tsx:111-440` | `nested-interactive` (serious) |
| P1 | Accent color `#4a9eff` on white = **2.75:1** — fails AA body. Affects: `Open Stream Builder ({n} files)` (`SourcesPanel.tsx:213-220`), `Open Overlay Builder…` (`Inspector.tsx:872-885`), preset Apply (`Inspector.tsx:419`), Save preset (`Inspector.tsx:373`), Export download links (`ExportImageModal.tsx:198-205`, `ExportVideoModal.tsx:286-294`). | 1.4.3 | multiple | (axe missed: tinted bg) |
| P1 | Warn color `#c57f00` on 10%-tint of itself over white = **2.94:1** — fails AA body. Affects: count chip in `StreamHeader.tsx:90-112` and `SourcesPanel.tsx:90-105`, gap-warning in `StreamBuilderModal.tsx:243-247, 419-433`, "ffmpeg not detected" notice in `ExportVideoModal.tsx:194-208`. | 1.4.3 | multiple | (axe missed: same) |
| P1 | Hover-toolbar buttons measured **22 × 22 px** (Lock, Duplicate, →U/F/D, Remove); separated by `gap: 2`. Below WCAG 2.2 SC 2.5.8 minimum 24×24 CSS px. | 2.5.8 | `ViewerCard.tsx:298-440` | n/a (no axe rule) |
| P1 | Export-Video progress bar is a styled `<div>` with no `role="progressbar"`, no `aria-valuenow`, no `aria-valuemin`/`aria-valuemax`, no live region. | 1.3.1, 4.1.2, 4.1.3 | `ExportVideoModal.tsx:260-282` | n/a (decorative div) |
| P1 | No application-defined `:focus` / `:focus-visible` styling exists in the playback bundle. Default Chromium blue ring on a blue accent button drops below 3:1. | 2.4.7, 1.4.11 | `StreamHeader.tsx:127-138`, `TimelineStrip.tsx:296-308`, `EmptyState.tsx:69`, `Inspector.tsx:872-886` | n/a |
| P2 | Empty state container has no `role="status"` / `aria-live`. Toast `<div>` also lacks `role="status"`. | 4.1.3 | `EmptyState.tsx:8-111`, `shared.tsx` Toast (~2207) | n/a |
| P2 | "No files yet." / "No dark frames loaded." use `role="note"` (`SourcesPanel.tsx:172-184, 305-319`); `role="note"` not announced by most screen readers — use `role="status" aria-live="polite"`. | 4.1.3 | `SourcesPanel.tsx:172, 307` | n/a |
| P2 | Two `<input type="file">` (`index.tsx:247-270`) are `display:none` but get focus through Tab as unlabeled file inputs. | 4.1.2 | `index.tsx:247-270` | n/a |
| P2 | Fixed-width sidebars cause workspace horizontal overflow at 200% zoom on viewports ≤ 1024 px. | 1.4.10 (Reflow) | `SourcesPanel.tsx:58-66`, `Inspector.tsx:516-557` | n/a |
| P2 | Sliders' formatted value (e.g., "1.00×", "30 K") is not announced via `aria-valuetext`. | 4.1.2, 4.1.3 | `Inspector.tsx:707-755` (Slider call sites) | n/a |
| P3 | CcmEditor numeric grid: wrap in `<fieldset><legend>Color correction matrix</legend>`. | 1.3.1 | `Inspector.tsx:198-220` | n/a |
| P3 | Inspector section headers correctly use `aria-expanded`; add `aria-controls` for full relationship. | 4.1.2 | `Inspector.tsx:70-118` | n/a |
| P3 | Toast: confirm `role="status" aria-live="polite"` for info/success and `role="alert" aria-live="assertive"` for danger. | 4.1.3 | `shared.tsx` Toast | n/a |

## What passes

- Esc closes every modal.
- All control-bearing primitives have visible text, `aria-label`,
  or wrapping `<label>`.
- Color-blind safety: state never indicated by color alone.
- Keyboard shortcuts (Space, ←/→, Home/End) gated by `typing` check.
- 30 of 32 axe rules pass.

## Disposition (M12)

- **P0 (4 items, axe-blocking):** apply now in M12. Most are
  `ViewerCard.tsx` + `Modal` (`shared.tsx`) and a single change
  each (drop `aria-selected`; mount toolbar always but visually
  hide unless `hover/selected/focus-within`; promote ViewerCard
  root from `role="button"` with nested buttons to a `<div>`
  with a child select-target button or remove `role="button"`
  altogether and use a click-handler on the wrapper; add
  `role="dialog" aria-modal="true"` + focus trap + focus return
  to the Modal primitive).
- **P1 contrast (accent #4a9eff and warn #c57f00):** apply now in
  M12 — bump to AA-passing shades (e.g. accent body to `#1560d9`
  already used elsewhere; warn body to `#8a5a00`).
- **P1 SC 2.5.8 target size:** bump hover-toolbar buttons 22→24 px.
- **P1 progressbar role:** add `role="progressbar"` + valuenow/min/max
  + aria-live to ExportVideoModal.
- **P1 :focus-visible:** add a global `:focus-visible { outline:
  2px solid t.accent; outline-offset: 2px }` in `shared.tsx`.
- **P2/P3:** track in BACKLOG.

## Tooling recommendation

- Wire `@axe-core/playwright` into the existing `tests/web/` Tier 4
  smoke at the moment when `?mantisplaybackenabled=1` is set.
  Acceptance: zero violations of `wcag2a + wcag2aa + wcag22aa`.
- Add Storybook stories `playback/PlaybackMode--empty` and
  `playback/PlaybackMode--workspace`.
