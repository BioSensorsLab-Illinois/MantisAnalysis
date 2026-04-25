# frontend-react — recording-inspection-implementation-v1 (M12 close)

Reviewed by: `frontend-react-engineer` agent
Date: 2026-04-25

## Scope

Playback frontend (M5–M11): `web/src/playback/*` (16 files) +
`web/src/app.tsx` integration + `ProcessingBadge.stories.tsx`.

## Summary

Well-organized: state lives in a single reducer behind `PlaybackCtx`,
network calls are funneled through `api.ts`, modals mount conditionally
via `state.modal.kind`, and the per-card race-aware epoch keeps stale
`<img>` loads from clobbering newer ones. Real correctness issues
exist: stale closures in the eviction listener and the play-head
ticker, a misordered epoch snapshot in the `<img>` callbacks, a
leaking poll loop in `ExportVideoModal`, and the `Inspector` re-renders
the entire 9-section tree on every keystroke into any one section.

## Findings

| ID | Sev | File:Line | Issue | Fix |
|---|---|---|---|---|
| F1 | P0 | `web/src/playback/state.tsx:254-269` | Eviction listener re-subscribes whenever `state.streams` changes; handler closes over a stale snapshot. | Move filtering into the reducer (`stream/evict` action keyed on `id`); subscribe with `[]` deps. |
| F2 | P1 | `web/src/playback/index.tsx:179-193` | Play-head `setInterval` depends on `state.frame`. Each tick tears down + recreates the interval → drift / jitter at 60 fps. | Use a `useRef` for "current frame"; depend only on transport state. |
| F3 | P1 | `web/src/playback/ViewerCard.tsx:143-150` | `onLoad={((cur) => () => handleLoad(cur))(epoch.current)}` captures epoch at render time; `useEffect` bumps `epoch.current` *after* the next render → stuck `loading` opacity. | Read `epoch.current` directly inside the handler; bump epoch in `useLayoutEffect`. |
| F4 | P1 | `web/src/playback/ExportVideoModal.tsx:119-140` | `pollJob` `setTimeout` cleanup never wired; modal close mid-poll → setState on unmounted. Cancel button doesn't stop the poll. | Track `setTimeout` id in `useRef`; clear in `useEffect` cleanup keyed on open job id. |
| F5 | P1 | `web/src/playback/index.tsx:43-72` | `onRecordingFiles` loop computes `newCount = state.recordings.length + files.length` from a stale closure snapshot. | Track `count++` locally in the loop. |
| F6 | P1 | `web/src/playback/Inspector.tsx:502-980` | All 9 sections re-render on every dispatch → CCM det recomputed, `PresetsPanel` and `FrameLruWidget` remount. | `React.memo` per section body; pass only the slice each needs. |
| F7 | P1 | `web/src/playback/Inspector.tsx:332-334, 463-465` | `PresetsPanel` / `FrameLruWidget` `useEffect(() => refresh(), [])` with no abort guard — setState on unmounted. | Add an `alive` flag. |
| F8 | P1 | `web/src/playback/api.ts:106-151` | `previewPngUrl` not debounced; slider drag in Inspector → instant URL rebuild → image network stampede. | `useDebounced(view, 30)` inside `ViewerCard` before `useMemo`. |
| F9 | P1 | `web/src/playback/ViewerCard.tsx:85-88` | `useMemo` for `url` keyed on `view` object identity, not content; every unrelated dispatch creates a fresh URL. | Hand-rolled `viewSig(view)` returning a stable string of URL-affecting fields. |
| F10 | P1 | `web/src/playback/index.tsx:196-231` | Keyboard `useEffect` reads `state.frame` and depends on it; listener reattached every frame → drift. | Use a ref for latest frame; depend only on transport state. |
| F11 | P2 | `web/src/playback/state.tsx:1` + 14 others | `// @ts-nocheck` blanketed across every new playback file (UI_IMPLEMENTATION_NOTES §1 says don't). | Track removal in follow-up. |
| F12 | P2 | `web/src/playback/state.tsx:225-227` | `case 'reset'` returns `{ ...initialState }` with arrays — fragile shared-array contract. | `freshInitial()` factory. |
| F13 | P2 | `web/src/playback/TimelineStrip.tsx:63-93` | Pointer drag listeners on `window` w/o `setPointerCapture`; release-off-window leaks listeners. | `setPointerCapture(ev.pointerId)` + `pointerup` on the track itself. |
| F14 | P2 | `web/src/playback/TimelineStrip.tsx:96` | `step()` inline arrow → fresh identity per render. | `useCallback`. |
| F15 | P2 | `web/src/playback/StreamBuilderModal.tsx:49-71` | Live-preview POSTs `/api/playback/streams` per slider keystroke → stream-build stampede. | `useDebounced(threshold, 200)`. |
| F16 | P2 | `web/src/playback/Inspector.tsx:148-155` | Det recomputed per keystroke. Subsumed by F6. | (deeper fix is F6) |
| F17 | P2 | `web/src/playback/api.ts:11` | Error-shape `??` chains duplicated in 6 catch sites. | Centralize `errMsg(err)` helper. |
| F18 | P3 | `web/src/playback/index.tsx:71, 192, 230` | 3 `eslint-disable react-hooks/exhaustive-deps` directives mask F1/F2/F10. | Remove after fixes land. |
| F19 | P3 | `web/src/playback/ViewerCard.tsx:289-438` | 6 near-identical hover-toolbar buttons with copy-pasted styles. | Extract `HoverToolbarButton`. |
| F20 | P3 | `web/src/playback/Inspector.tsx:331` | `PresetsPanel.refresh` silent on 500. | Surface via `say(...)`. |
| F21 | P3 | `web/src/playback/index.tsx:206-211, 215-218` | Two rapid arrow keys may collapse → one frame. | Refs (per F10) or updater fn. |

## What looks correct

- Eviction kind-routing in `app.tsx:159-180` correctly filters
  `kind !== 'source'`.
- Modal mount discipline at `index.tsx:406-428` is right: at most one
  modal open, all conditioned on `state.modal?.kind`.
- `previewPngUrl` correctly omits non-RGB / non-overlay parameters
  when not in those modes (`api.ts:122, 137`).
- Storybook story is self-contained.
- Keyboard handler skips when typing in INPUT/TEXTAREA/isContentEditable.

## Disposition (M12)

- **F1 (P0):** apply now in M12. Move eviction filtering into the
  reducer; subscribe once.
- **F2, F3, F4, F8, F9, F10 (P1, performance/correctness on the hot
  path):** apply now in M12. These are user-facing jank/stutter and
  pollutes the network log.
- **F5, F6, F7 (P1, less hot):** track in BACKLOG; not blocking the
  initiative close. The auto-builder branch (F5) only fires on
  multi-file uploads — the single-recording flow tested by Playwright
  works.
- **F11–F21 (P2/P3):** track in BACKLOG.
