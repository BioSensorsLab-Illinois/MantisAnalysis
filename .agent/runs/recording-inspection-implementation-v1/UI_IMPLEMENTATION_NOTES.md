# UI_IMPLEMENTATION_NOTES — recording-inspection-implementation-v1

> Companion to ExecPlan / DATA_MODEL / API_DESIGN.
> Authoritative for the React surface. Cross-references the design at
> `design/playback/{spec.md, flows.md, wireframes.md}` and the prototype
> at `playback*.jsx` (extracted in `/tmp/design-template/`).

Last updated: 2026-04-24

## 1. File layout

```
web/src/playback/
├── index.tsx                 — PlaybackMode entry; orchestrates panels + modals
├── state.tsx                 — usePlaybackState reducer + PlaybackCtx + actions
├── data.tsx                  — channel/colormap/blend constants + helpers
├── pipeline.ts               — client-side fallback render (small + low-res)
├── api.ts                    — typed wrappers around /api/playback/*
├── panels/
│   ├── SourcesPanel.tsx
│   ├── StreamHeader.tsx
│   ├── ViewerGrid.tsx
│   ├── ViewerCard.tsx
│   ├── ViewerCardContextMenu.tsx       # right-click: Send to USAF/FPN/DoF, Lock, Duplicate, Remove
│   ├── TimelineStrip.tsx
│   ├── Inspector.tsx                   # 9-section collapsible stack
│   ├── inspector/                      # one file per section
│   │   ├── ViewSection.tsx
│   │   ├── SourceSection.tsx
│   │   ├── CorrectionsSection.tsx
│   │   ├── DisplaySection.tsx
│   │   ├── RGBGradingSection.tsx       # gain/offset/γ/B/C/saturation + WB + CCM
│   │   ├── OverlaySection.tsx
│   │   ├── LabelsSection.tsx
│   │   ├── PresetsSection.tsx
│   │   ├── AdvancedSection.tsx         # frame-LRU size, decode stats, debug
│   │   └── BasicAdvancedSwitch.tsx
│   ├── ccm/
│   │   ├── CCMEditor.tsx               # 3×3 matrix grid + det display
│   │   ├── CCMFromPatch.tsx            # click-pixels-to-fit workflow
│   │   └── CCMPresetPicker.tsx
│   ├── ProcessingBadge.tsx
│   ├── BandPicker.tsx
│   ├── FilePill.tsx
│   ├── DarkFrameRow.tsx
│   ├── DarkStrategyPicker.tsx          # mean / median / sigma-clipped
│   ├── MiniHistogram.tsx
│   ├── WarningModalOnce.tsx            # once-per-session "we're guessing" modal
│   └── EmptyState.tsx
└── modals/
    ├── StreamBuilderModal.tsx
    ├── OverlayBuilderModal.tsx
    ├── ExportImageModal.tsx
    ├── ExportVideoModal.tsx            # GIF + MP4 + APNG + PNG-seq, parallel workers
    ├── HandoffModal.tsx                # confirm Send-to-mode target + frame
    └── WarningCenter.tsx
```

All files compile under the existing TypeScript / Vite pipeline. We
seed each new file *without* `@ts-nocheck` so Phase 5c progresses.
Where a shared.tsx export still needs a type bridge, we import as
`(unknown as Type)` and document it inline; do not add new
`@ts-nocheck` directives.

## 2. App-shell integration

Per risk-skeptic P0-B + P1-K, M5 makes three changes to the
existing app shell, all gated behind a feature flag:

```tsx
// web/src/app.tsx
import { PlaybackMode } from './playback';

// Feature flag (M5–M10 ship behind it; M11 flips default true)
const PLAYBACK_ENABLED =
  typeof window !== 'undefined' &&
  (window.localStorage.getItem('mantis/playback/enabled') === '1' ||
   /* M11+ default flips to true here */ false);

const modes = [
  { id: 'usaf', label: 'USAF',     title: 'USAF Resolution (1)',   icon: 'usaf' },
  { id: 'fpn',  label: 'FPN',      title: 'FPN Analysis (2)',      icon: 'fpn' },
  { id: 'dof',  label: 'DoF',      title: 'Depth of Field (3)',    icon: 'dof' },
  ...(PLAYBACK_ENABLED ? [
    { id: 'play', label: 'Playback', title: 'Recording Inspection (4)', icon: 'film' },
  ] : []),
];

// keyboard (also flag-gated)
else if (PLAYBACK_ENABLED && e.key === '4') setMode('play');

// command palette
...(PLAYBACK_ENABLED ? [
  { id: 'mode.play', label: 'Switch to Playback', kbd: '4', icon: 'film',
    run: () => setMode('play') },
] : []),

// branch (PlaybackMode has its own PlaybackStore so 'source' is not required)
{PLAYBACK_ENABLED && mode === 'play' && (
  <PlaybackMode
    onStatusChange={onStatusChange}
    say={say}
    onOpenFile={() => fileInputRef.current?.click()}
  />
)}
```

**Eviction listener fix (risk-skeptic P0-B + P3-W).** M5 also
edits two files:

1. `web/src/shared.tsx::apiFetch` widens the `sidMatch` regex:

   ```ts
   const sidMatch =
     url.match(/\/api\/(sources|playback\/streams|playback\/recordings|playback\/darks|playback\/exports)\/([a-z0-9]+)/i);
   const kindFromUrl = sidMatch?.[1].includes('/streams') ? 'stream' :
                       sidMatch?.[1].includes('/recordings') ? 'recording' :
                       sidMatch?.[1].includes('/darks') ? 'dark' :
                       sidMatch?.[1].includes('/exports') ? 'job' : 'source';
   window.dispatchEvent(new CustomEvent('mantis:source-evicted', {
     detail: { source_id: sidMatch?.[2], kind: kindFromUrl },
   }));
   ```

2. `web/src/app.tsx::onEvicted` listener (lines 159–173) filters:

   ```ts
   const onEvicted = async (ev) => {
     const { source_id: sid, kind = 'source' } = ev.detail || {};
     if (kind !== 'source') return;          // Playback handles its own kinds
     if (sid && source && sid !== source.source_id) return;
     // …existing reload-sample path…
   };
   ```

The Playback reducer subscribes to the same event and routes on
`kind ∈ {'stream','recording','dark','job'}` to clear local cache.

**Playback rail-tile icon.** `Icon` does not currently expose a
`film` glyph. M5 adds it to `shared.tsx`'s `Icon` switch — a
simple SVG film-strip — and adds a Storybook story per docs-sync.

## 3. Component map (region → component)

Per spec.md §4.1:

| Spec region | Component | File |
|---|---|---|
| A · Mode chrome | (existing TopBar / ModeRail / StatusBar) | `web/src/app.tsx` |
| B · Stream header | `StreamHeader`, `StreamChip` | `panels/StreamHeader.tsx` |
| C · Sources | `SourcesPanel`, `FilePill`, `DarkFrameRow` | `panels/SourcesPanel.tsx`, `panels/FilePill.tsx`, `panels/DarkFrameRow.tsx` |
| D · Viewer | `ViewerGrid`, `ViewerCard`, `ProcessingBadge` | `panels/ViewerGrid.tsx`, `panels/ViewerCard.tsx`, `panels/ProcessingBadge.tsx` |
| E · Inspector | `Inspector`, `Inspector*Tab` | `panels/Inspector*.tsx` |
| F · Timeline | `TimelineStrip` | `panels/TimelineStrip.tsx` |
| G · Notifications | inline banners + `WarningCenter` modal | `panels/SourcesPanel.tsx`, `modals/WarningCenter.tsx` |

Modals:

| Spec | Component | File |
|---|---|---|
| Stream Builder | `StreamBuilderModal` | `modals/StreamBuilderModal.tsx` |
| Overlay Builder | `OverlayBuilderModal` | `modals/OverlayBuilderModal.tsx` |
| Export · Image | `ExportImageModal` | `modals/ExportImageModal.tsx` |
| Export · Video | `ExportVideoModal` | `modals/ExportVideoModal.tsx` |
| Warning Center | `WarningCenter` | `modals/WarningCenter.tsx` |

## 4. State plan

- One reducer in `state.tsx`. The full shape is in
  [`DATA_MODEL.md` §5](DATA_MODEL.md#5-react-state-shape).
- One `PlaybackCtx`. Components read via `usePlayback()` /
  `usePlaybackDispatch()`.
- Actions are typed; reducer is exhaustive and logs a warning on
  unknown action types (development build only).
- All side effects (HTTP fetches, polling) live in custom hooks
  (`useRecordingActions`, `useStreamActions`, `useExportPolling`)
  that wrap `dispatch`.
- localStorage persistence via `useLocalStorageState` from `shared.tsx`
  for the keys listed in DATA_MODEL §5.

Why a reducer over `useState` per field:

- 25+ pieces of state, half of them coupled (changing layout resets
  selection; changing stream invalidates every view's `lockedFrame`).
- Action log makes debugging multi-step flows tractable.
- The export polling hook needs to dispatch many small updates
  without prop-drilling.

## 5. Frame request pattern

Each ViewerCard's preview is a single `<img>` whose `src` is built
from the active stream id, current frame, and the view's serialized
processing settings:

```ts
const url = previewPngUrl(streamId, frame, view);
//          → /api/playback/streams/{id}/frame/{n}.png?... (per API_DESIGN)
```

Implementation details:

- Use `useDebounced(view, 30)` so rapid slider drag doesn't stampede
  the server. 30 ms keeps perceived latency low.
- The `<img>` `loading="lazy"` is OFF (we want eager). Default
  decoding via `decoding="async"`.
- The `<img onLoad>` and `<img onError>` events drive the card's
  `state` (`ok` / `loading` / `failed`). The `loading` overlay
  shimmer is gated on the gap between `src` change and `load`.
- Cancel in-flight loads when `src` changes (browsers do this
  automatically; we just dedupe via a `Set<string>` of in-flight URLs
  in `pendingFrameRequests`).
- **Race-aware `onLoad` (risk-skeptic P3-X)**: track an integer
  `epoch` per card; bump on each `src` change. Stale `onLoad`
  callbacks (whose epoch != current) are discarded so a late
  `<img>` load from a previous slider position doesn't overwrite
  a newer view.
- A locked view's `frame` substitutes `view.lockedFrame` for `frame`
  when constructing the URL.
- An RGB view sends `view_type=rgb&channels=HG-R,HG-G,HG-B`.

## 6. Scrubbing performance plan

Spec.md R3 mitigation. Three layers:

1. **Mini-map track** rendered once per stream change. CSS-only ticks
   via `linear-gradient` per boundary. No re-render on scrub.
2. **Detail track + playhead** uses a single absolutely-positioned
   `<div>` with `left: ${pct}%`. Only the playhead's `style.left`
   changes during scrub; React re-renders are limited to the track
   wrapper and the transport readout.
3. **Frame image** is rate-limited to 30 fps via `requestAnimationFrame`
   loop in `TimelineStrip` while `playing`. While scrubbing pointer
   events, we throttle `dispatch({type:'frame/set'})` to one update
   per ~33 ms, debouncing the URL construction.

We add `React.memo` to `ViewerCard` and pass `view` and `frame` as
props; the equality compare uses a hand-rolled `viewEqual` that
compares only fields that affect the URL.

## 7. Empty / loading / error / failure states

Per spec.md §10:

| State | Surface | Component |
|---|---|---|
| Empty mode | `EmptyState` (centered hero) | `panels/EmptyState.tsx` |
| Loading metadata | shimmer rows in SourcesPanel | `SourcesPanel` shimmer |
| Building stream | progress overlay on `StreamHeader` | `StreamHeader.tsx` |
| Frame loading | shimmer overlay on `ViewerCanvas` | `ViewerCard.tsx` |
| Frame failed | "Frame not decoded" + retry button | `ViewerCard.tsx` |
| Stream evicted | toast + auto-clear | `state.tsx` reducer |
| Export running | progress card in modal | `ExportVideoModal.tsx` |

`MANTIS_PLAYBACK_TEST=1` exposes a "Load synthetic stream" button on
the empty state so reviewers can navigate without an OS file picker.

## 8. Layout presets

Identical math to the prototype's `LAYOUT_PRESETS`. `ViewerGrid` uses
CSS Grid `gridTemplateColumns: repeat(2, 1fr)` and per-cell
`gridColumn / gridRow` from the preset's `cells` array. The
"3+1" preset uses 2-col × 3-row grid.

When the user switches preset:

1. Persist the new preset to `mantis/playback/layout`.
2. Visible views = `views.slice(0, preset.cells.length)`.
3. Out-of-range views remain in state (so 2×2 → side-by-side keeps
   views 1 and 2; switching back to 2×2 restores 3 and 4 if still
   present).

## 9. Inspector — 9 collapsible sections (spec.md §7.1.8)

Per user 2026-04-24: pivoted to the spec's 9-section collapsible
inspector for more functions per real estate. A Basic / Advanced
segmented at the top hides Presets / Advanced / parts of RGB
grading from novices; persisted under
`mantis/playback/inspectorMode`.

| # | Section | Key controls | Always visible? |
|---|---|---|---|
| 1 | View | Name, type, sync, lock, export-include | Yes |
| 2 | Source | Stream chip, gain class, band picker, frame mode | Yes |
| 3 | Corrections | Dark on/off, dark-id select, gain, offset, normalize | Yes |
| 4 | Display | Low/high thresholds, colormap, invert, clipping, mini-histogram | Yes |
| 5 | RGB grading | gain/offset RGB, γ, B/C, saturation, WB (k/patch), **CCM editor** | view.type === 'rgb' |
| 6 | Overlay | source, low/high, blend, strength, colormap, below/above, builder link | Yes |
| 7 | Labels | timestamp, frame, channel, source, scale-bar, badges, legend | Yes |
| 8 | Presets | Save / Load / Copy-settings-to-other-views | Basic+Advanced |
| 9 | Advanced | frame-LRU size, decode stats, view-fps, raw debug fields | Advanced only |

Each section uses the existing `Card` primitive with a chevron
header. Collapsed-state map persisted per view-type
(`single` / `rgb` / `overlay` / `comparison`) under
`mantis/playback/inspector/<type>` so navigating between views with
similar shape feels predictable.

The CCM editor inside section 5:

```
RGB grading                                            [before ⇌ after]
…
CCM (Color Correction Matrix)              [□] enabled
   ┌─────────────────────────────┐
   │  1.000   0.000   0.000      │
   │  0.000   1.000   0.000      │
   │  0.000   0.000   1.000      │
   └─────────────────────────────┘
   det = 1.000 ✓
   [ Auto from patch… ]   [ Load preset ▾ ]   [ Reset ]

   ⓘ Display correction. Not calibrated unless you pin a known
     target. CCMs with |det| < 1e-3 are refused to keep colors
     stable.
```

`Auto from patch…` opens an inline CCMFromPatch flow: user clicks
≥3 patch locations on the active frame, supplies a target reference
(picker preset list or sRGB values), the client posts to
`POST /api/playback/ccm/from-patch`, then writes the resulting
matrix into the editor.

## 10. Keyboard shortcut map

- Global: `1` USAF, `2` FPN, `3` DoF, `4` Playback, `?` help, `⌘K`
  palette, `⌘O` open file, `Shift+I` ISP settings.
- Playback-only (when mode === 'play' and no input is focused):
  - `Space` play/pause
  - `←` / `→` step −1/+1
  - `Shift+←` / `Shift+→` step −10/+10
  - `Home` / `End` first / last frame
  - `[` / `]` cycle view selection (prev/next)
  - `Enter` open selected view's overflow menu (focus the title bar)
  - `L` toggle lock on selected view
  - `+` add view
  - `Esc` close any open Playback modal
- Inspector tabs accept arrow keys when focused.

## 11. Accessibility notes

- All buttons, sliders, selects, checkboxes have `aria-label` (or
  `aria-labelledby`). Reuse the patterns from the existing
  `Slider`/`Checkbox`/`Select` primitives — they already accept
  `ariaLabel` props.
- ViewerCard's `aria-selected="true"` when selected.
- Live regions: `role="status" aria-live="polite"` for warnings;
  `role="alert" aria-live="assertive"` for errors.
- Color-blind: every state pairs color with icon (warn ⚠, error ✕,
  info ⓘ); processing badges use 3-letter codes, never color alone.
- Focus ring: `2px outline solid t.accent` on every interactive
  element, matching the existing primitives. Modals trap focus.
- axe-core baseline tightened to 0 critical / 0 serious WCAG A/AA in
  `tests/web/test_accessibility.py`.
- Sliders announce value on change (existing `Slider` already does
  this; we verify in the inspector).

## 12. Responsive behavior

Per spec.md §13:

- `lg` ≥ 1400 — full layout.
- `md` 1180–1400 — Sources at min 240 px, Inspector at min 320 px.
- `sm` 960–1180 — Sources collapses to 44 px icon rail; Inspector
  auto-collapses on modal open and on view-selection change at this
  breakpoint.
- `xs` < 960 — blocking message "Playback requires a wider viewport
  (≥ 960 px)."

We reuse `useViewport` from `shared.tsx` and add a Playback-specific
`useNarrow` selector that returns `viewport.width < 1180`.

The mini-map row is hidden at `sm` by default with a "Show mini-map"
link in the detail row.

## 13. Theme + tokens

Per spec.md §11. **No new tokens.** All Playback components read
`useTheme()` and the existing token set:

- `bg`, `panel`, `panelAlt`, `chipBg`, `chipBorder`, `border`,
  `borderStrong`, `text`, `textMuted`, `textFaint`, `accent`,
  `accentHover`, `accentSoft`, `warn`, `danger`, `success`,
  `inputBg`, `shadow`, `shadowLg`.

Viewer card backgrounds are `#0a0a0a` (near-black) regardless of
theme — perceptual choice for imagery, matches the prototype.

Channel colors come from `CHANNEL_COLORS` (already exported from
`shared.tsx`).

## 14. Reused primitives

From `shared.tsx`:

- `Card`, `Row`, `Slider`, `Select`, `Button`, `Segmented`,
  `Checkbox`, `Spinbox`, `ChannelChip`, `Tip`, `Kbd`, `Modal`,
  `Toast`, `Icon`.
- `useLocalStorageState`, `useDragCapture`, `useViewport`,
  `useDebounced`.
- API: `apiFetch`, `apiUpload`, `API_BASE`, `colormapStripUrl`.
- `SourceCtx` / `useSource` — *not* reused; we have our own
  `PlaybackCtx`.
- Theme: `useTheme`, `useTokens`.

We do NOT reuse the existing `analysis/shell` since the Playback mode
is not an analysis modal.

## 15. Testing seams

- Every view-affecting action goes through the reducer; tests can
  stamp specific states and assert the rendered DOM matches.
- Network calls live in `api.ts` so Playwright can mock them via
  route interception if needed (default: hit the real synthetic
  endpoint).
- The `MANTIS_PLAYBACK_TEST=1` flag exposes a deterministic
  empty-state CTA wired to `/api/playback/streams/from-sample`.

## 16. Wireframe parity checklist

| # | Wireframe | Component(s) | Implemented |
|---|---|---|---|
| W1 | Empty Playback | EmptyState | M5 |
| W2 | File loading | SourcesPanel shimmer | M6 |
| W3 | Stream Builder | StreamBuilderModal | M6 |
| W4 | Dark-frame manager | SourcesPanel.Dark + DarkFrameRow | M6 |
| W5 | Workspace · single | ViewerGrid (single preset) | M7 |
| W6 | Workspace · 2×2 | ViewerGrid (2x2) | M7 |
| W7 | Selected-view inspector | Inspector + 6 tabs | M8 |
| W8 | Timeline | TimelineStrip | M7 |
| W9 | Overlay panel inline | InspectorOverlay | M9 |
| W10 | Overlay Builder | OverlayBuilderModal | M9 |
| W11 | RGB correction | InspectorCorrect (RGB section) | M8 |
| W12 | Export Image | ExportImageModal | M10 |
| W13 | Export Video | ExportVideoModal + progress | M10 |
| W14 | Warning Center | WarningCenter | M11 |
| W15 | Narrow layout | responsive collapse | M11 |

## 17. Behaviors preserved from existing app

- `mantis:source-evicted` listener pattern (R-0009). Per
  planner-architect P1-4: **single canonical event name.** Field
  shape extends to `detail.kind: 'source' | 'stream' |
  'recording' | 'dark' | 'job'`, default `'source'` for
  back-compat. No new event names. The Playback reducer routes
  on `kind`.
- `useDebounced` for slider-driven URL construction.
- `apiFetch` 410 → toast → reload sample pattern.
- Theme-token-driven styling via `useTheme()`; no inline color
  literals except the canvas background.

## 18. Behaviors deferred / hidden until ready

When we can't implement a control fully in the first pass, we either
hide it or disable it with a truthful tooltip. **No dead buttons.**

| Control | First-pass behavior | When fully wired |
|---|---|---|
| "Save preset…" / "Load preset…" / "Copy to…" | **Fully wired in M8** (per user 2026-04-24) | M8 |
| CCM editor (3×3 + det display) | **Fully wired in M8** | M8 |
| "Auto from patch" CCM workflow | Functional in M8 — pick ≥3 patches → fit | M8 |
| "Auto white balance" button (Kelvin) | Functional in M8 | M8 |
| "WB by patch" (calibrated, click neutral pixel) | **Fully wired in M8** | M8 |
| "Send to USAF / FPN / DoF" right-click | Functional in M11 | M11 |
| "Open in folder" after export | Linux/macOS via `xdg-open` / `open`; Windows via `start`; falls back to a notice | M10 |
| Visual-regression baselines | **Established in M11–M12 via Playwright `to_have_screenshot()`** | M11–M12 |
| Soft view-count limit (>6 hint) | M11 | M11 |
| Hard view-count limit (12) | Enforced from M7 | M7 |
| Realtime camera feed | `view.live=true` reserved field; `live_stream_supported=false` | future initiative |

## 19. Visual details (stand-out items from prototype)

- ViewerCard uses a glass effect on its top-left identity chip
  (`backdropFilter: blur(6px)`) — keep.
- Bottom-left timestamp pill is a glass chip with monospace font.
- Hover toolbar appears at `top-right + 34px` on `chromeVisible`
  (selected || hover); not on `top-right` to avoid overlapping the
  badge stack.
- File-name pill bottom-center on hover; bumps to `bottom: 34` if
  the timestamp pill is also visible.
- Mini-histogram in the Display tab: 48 procedural bars seeded by
  `view.id + view.channel`. Replaced with real histogram from
  `/api/playback/streams/{id}/frame/{n}/range` once the inspector
  has a frame ready.
- Locked-pin marker on timeline: 2 px amber line with a 4 px square
  cap.

## 20. Risks specific to UI

| Risk | Mitigation |
|---|---|
| Reducer mistakes invalidate every view on benign actions | Exhaustive `viewEqual` in `React.memo`; tests for stable identity |
| Inspector tabs feel deep | Use chip badges in title bar to surface "what's applied" without opening inspector |
| Overlay misconfiguration on small screens | Auto-open Overlay Builder on a small-viewport `view.overlayEnabled = true` toggle |
| Export modal blocks workspace | Make modal non-blocking visually for progress (cancel / minimize) — minimize lands in M10 if straightforward, otherwise modal stays |
| Dark CTA on a stream with no exposure data | Disable the auto-match toggle with explanation; require manual pick |

## 21a. Send-to-mode handoff UX

Per user 2026-04-24, in-scope and lands at M11.

**Trigger**: right-click any ViewerCard → context menu "Send to" →
submenu USAF / FPN / DoF.

**Flow**:

1. Right-click → submenu opens with three target modes.
2. Click target → `HandoffModal` opens with a confirmation
   summarizing: source view name, channel set, frame index,
   exposure, dark-correction state, target mode.
3. User confirms → client `POST /api/playback/streams/{sid}/handoff/{mode}`
   with `{ frame, view, preserve_dark, name }`.
4. Server renders the active frame to a `LoadedSource`, registers
   it in the analysis `STORE`, returns `source_id`.
5. Client switches mode (`setMode(target)`) and binds the new
   source via the existing `setSource(...)` hook.
6. Toast: "Sent to USAF · 1 source"; preserves frame + ISP state.

**Channel-key schema preserved**: the rendered frame's channel
dict matches what `image_io.load_any_detail` would emit, so the
analysis modes see no schema delta.

## 21b. Once-per-session warning modal

Per user 2026-04-24: every fallback heuristic in
`recording.inspect_recording` (top-level dataset, single-frame,
synthesized timestamp, etc.) raises a **modal** the first time per
session, not just an inline chip. Modal persists per-session-state
in React (`Map<warning_code, dismissed_at>`); subsequent triggers
of the same code surface only as inline chips. The modal title is
"We're guessing — confirm before continuing" with the canonical
message, the file path, the inferred value, and Apply / Cancel
buttons.

## 22. Storybook stories (M11)

Per user 2026-04-24, in-scope. Author stories under
`web/src/stories/playback/` (P2-8) — same pattern as the existing
`Brand.stories.tsx`, `Buttons.stories.tsx`,
`ChannelChip.stories.tsx`. The existing
`npm run build-storybook` picks them up; no new Storybook config
needed.

Author stories for:

- `ProcessingBadge` — every variant (RAW/DRK/NRM/LUT/RGB/OVL/LCK/EXP).
- `FilePill` — collapsed / expanded / loading / loaded / warning /
  error / partial / quarantined.
- `DarkFrameRow` — matched / available / orphan / mismatched /
  ambiguous; mean / median / sigma-clipped strategies.
- `StreamChip` — default / hover / open / warning.
- `ViewerCard` — selected / unselected / locked / loading / failed /
  RGB / overlay / clipped.
- `BandPicker` — all 5 ISP modes' channel sets.
- `MiniHistogram` — synthetic and real-shape variants.

Each story uses the existing theme provider pattern from
`Brand.stories.tsx` / `Buttons.stories.tsx`; verifies dark theme +
all four accents.

`npm run build-storybook` runs as a Tier 0 sub-check.

## 23. Open questions

- (Open) Should ViewerCards show file boundaries via a tiny chip in
  the timestamp pill (e.g. `f3210 · 02:14 · rec_002.h5`)? Spec.md
  doesn't mandate; prototype's hover-only pattern is good enough for
  M7. Decision deferred to M7 sign-off.
- (Open) Should Inspector tab order be persistent? Currently no — tab
  selection is session-only. Spec.md §4.3 implies "Inspector section
  collapse states" are persisted; tab selection isn't a collapse. We
  keep session-only.
