# Playback — Recording Inspection Mode · UI/UX Design Specification

**Project:** MantisAnalysis · 4th mode  
**Author:** Design agent (commissioned spec)  
**Status:** Ready for implementation handoff  
**Companion files:** [`wireframes.md`](./wireframes.md), [`flows.md`](./flows.md)

This document is the source of truth for visual and interaction design of the new **Playback** mode. It sits alongside the interactive prototype at [`src/playback.jsx`](../../src/playback.jsx), which is the visual reference for everything described here. Where this document and the prototype disagree, the prototype is authoritative for pixel-level rendering; this document is authoritative for structure, flows, and acceptance criteria.

No backend/API surface is specified. The mode is designed against a procedural data model that a future implementation will replace with real H5 I/O.

---

## Table of contents

1. Overview
2. Design goals
3. User personas
4. Information architecture
5. Recommended workspace layout
6. Major screens
7. Component anatomy
8. User flows
9. Wireframe descriptions
10. Interaction states
11. Visual design direction
12. Accessibility checklist
13. Responsive behavior
14. Export workflow
15. Risks and mitigations
16. Milestone plan
17. Final acceptance criteria

---

## 1. Overview

### 1.1 Product concept

**Playback** is the fourth mode of MantisAnalysis, joining USAF Resolution, FPN Analysis, and Depth of Field. It is the application's viewer and inspection surface for H5 camera recordings produced by MantisCam / GSense BSI dual-gain RGB-NIR systems.

Users load one or more H5 files, optionally attach dark-frame H5s, and inspect the resulting logical stream through a multi-window viewer with per-view channel selection, dark correction, colormap/threshold shaping, RGB grading, and NIR-over-RGB overlay. Export produces faithful image or video renders of what the user sees on screen.

### 1.2 What Playback is not

- **Not a scientific processing pipeline.** Pixel math beyond display shaping (dark subtract, gain/offset, colormap mapping, overlay compositing) is out of scope.
- **Not a batch tool.** The design is optimized for interactive inspection of one stream at a time.
- **Not a raw-data exporter.** Exports reflect the rendered view. A separate raw-export affordance is reserved but not part of this scope.
- **Not a calibration UI.** RGB grading is presented as *display correction* — never as color-calibrated ground truth.

### 1.3 Relationship to existing modes

Playback is where users **look at data**. USAF/FPN/DoF are where they **measure data**. A later milestone may let the user right-click any frame in Playback and send it to one of the three analytic modes; that routing is noted in §15 (Risks) as a future hook, not part of this spec.

Visual language, chrome (top bar, mode rail, status bar), theming, keyboard conventions, and primitive components all derive from the existing three modes. Playback pushes the visual language one step denser — more IDE-like — because it carries more persistent state (sources, dark frames, multiple views, a timeline, processing per view) than any other mode.

---

## 2. Design goals

Ordered by priority. When goals conflict, earlier goals win.

1. **State legibility.** The user can, at any moment and without clicking, answer: *which files are loaded, which frame am I on, which channel is each view showing, what processing is applied, and will my export match what I see?*
2. **Controlled density.** More information than any other mode, without visual chaos. Achieve this through grouping, collapse, and the selected-view inspector pattern (not by hiding things in menus).
3. **Honest processing.** Every correction (dark subtract, thresholding, overlay, RGB grading) is visible as a badge on the view it affects and as a detailed row in the inspector. No hidden globals.
4. **Multi-view feels native.** Adding, removing, renaming, and syncing views is low-friction. 1 / 2 / 4 views all read equally well.
5. **Trustworthy export.** The export preview is WYSIWYG. Users never wonder whether their overlay, thresholds, or labels will appear.
6. **Graceful failure.** Every empty, loading, warning, error, and partial-load state is designed and named. Warnings are actionable inline where possible.
7. **Professional restraint.** The visual tone matches a scientific workstation: calm, precise, dense, no emoji, no gratuitous gradients. Color carries meaning and is never the sole signal.
8. **Keyboard-first.** All common navigation (frame stepping, view switching, mode jumping, play/pause, palette) is keyboard-accessible with visible hints.

### 2.1 Non-goals

- Mobile/touch optimization. Pointer + keyboard only. Responsive support stops at "narrow laptop" (~1180 px).
- Collaborative sessions / multi-user cursors.
- Real-time camera feed. Playback is post-capture only.

---

## 3. User personas

### 3.1 Imaging engineer · "Priya"

**Context.** Characterizes new sensor builds. Has ten dark frames of various exposure times, a recording split across three H5 shards because of buffer flushing.

**Needs.**
- Confirm files reassembled in the correct timestamp order with no gaps.
- Switch rapidly between HG-G, HG-NIR, LG-NIR to spot saturation or missing signal.
- Verify the auto-matched dark frame matches the current exposure.
- Export a diagnostic tiled video showing HG-G, HG-NIR, and an NIR/RGB overlay synchronized frame-by-frame for a colleague's report.

**Pain points Playback must solve.**
- Never be in doubt about which dark frame is applied.
- Catch exposure mismatches at file-loading time, not at export time.
- Frame navigation has to stay responsive at multi-thousand-frame streams.

### 3.2 Bench scientist · "Marcus"

**Context.** Uses MantisAnalysis as one tool among many. Loads a single H5, wants a quick RGB preview and a clean image/video for a presentation.

**Needs.**
- Drag-and-drop the file, see a usable RGB view immediately.
- Scrub the timeline, pick a good frame, export it as a PNG with a timestamp label.
- Make a NIR overlay that looks good without having to understand blend modes.

**Pain points Playback must solve.**
- Empty state must be instantly actionable.
- Defaults must produce a recognizable RGB image without any settings tweaking.
- Overlay creation must feel like a recipe, not a photoshop panel.

### 3.3 Power user / firmware developer · "Lan"

**Context.** Debugging a recording that "looks weird." Needs to see HG and LG side-by-side, inspect metadata, test whether the weirdness is display or capture.

**Needs.**
- Open HG-R, HG-G, HG-B, HG-NIR in a 2×2, toggle dark correction per view.
- Lock one view to a specific frame and scrub another for comparison.
- Inspect per-frame metadata (source file, timestamp, exposure) to correlate anomalies with file boundaries.

**Pain points Playback must solve.**
- Multi-view must support independent frame state (locked views).
- Metadata for the currently shown frame must be always-visible, not modal.
- Copying processing settings between views must be one click.

---

## 4. Information architecture

### 4.1 Top-level regions

Every screen in Playback is composed of seven regions. They map one-to-one onto concrete components and onto the visual wireframes in [`wireframes.md`](./wireframes.md).

| Region | Purpose | Persistent? |
|---|---|---|
| **A. Mode chrome** | App top bar + mode rail + status bar. Inherited from the app shell. | Always |
| **B. Stream header** | Stream chip, global frame readout, active-stream metadata, stream actions (open builder, edit). | Always |
| **C. Sources panel** | Left column: recording files list, dark frames list, continuity status. | Persistent, collapsible |
| **D. Viewer grid** | Center: one or more `ViewerCard`s in a layout preset. | Always |
| **E. Inspector** | Right column: details of the *selected* view. Sections for Source, Corrections, Display, RGB, Overlay, Labels, Presets, Advanced. | Persistent, collapsible |
| **F. Timeline** | Bottom: mini-map, zoomable scrubber, playback controls, range selection for export. | Always |
| **G. Notifications** | Warning/error center (toasts + inline banners) and export progress. Surfaces from top-right. | On-demand |

### 4.2 Modal surfaces

Modal screens stop the workspace flow. Keep the list short and deliberate.

- **Stream Builder.** Reopenable any time from the stream chip. Manages file list, order, continuity thresholds, overrides.
- **Overlay Builder.** Guided wizard for overlays when the per-view inline controls are not enough. Launchable from the inspector's Overlay section.
- **Export · Image.** Guided panel for tiled or per-view image exports.
- **Export · Video.** Guided panel for video exports with frame-range selection, FPS, codec.
- **Warning Center.** Full list of current warnings when the status chip is opened.

### 4.3 Persistent vs. session state

**Persistent (localStorage):**
- Last layout preset used.
- Theme, accent, sidebar variant.
- Inspector section collapse states.
- Default dark-correction on/off.
- Default colormap and thresholds per channel band (R/G/B/NIR/Y).

**Session-only:**
- Loaded file list.
- Loaded dark-frame pool.
- Per-view processing state.
- Current frame index.
- Range selection.

Rationale: the user's *preferences* should survive a refresh; their *loaded data* should not silently re-apply to a new recording.

### 4.4 Mental model of a "stream"

A **stream** is the user's conceptual video. Under the hood it may be one file or a concatenation of several. The UI always refers to "the stream" in the singular at the frame-navigation level. The Stream Builder is where the plurality of files becomes visible; everywhere else, "stream" hides that complexity.

A **frame index** is global across the stream (1 … N). The user's primary currency.

A **source file** is the H5 that currently produced the displayed frame. Shown in badges and the status bar, never used for navigation.

---

## 5. Recommended workspace layout

### 5.1 Recommendation

**Layout A — dense, IDE-like.** Left Sources · Center Viewer Grid · Right Inspector · Bottom Timeline. Top Stream Header spans the full width.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ A · Mode chrome (top bar, 50 px · status bar, 26 px)                        │
├──┬────────────────────────────────────────────────────────────────────────┤
│M │ B · Stream header (44 px)                                               │
│o ├─────────┬──────────────────────────────────────┬───────────────────────┤
│d │ C       │ D · Viewer grid                      │ E · Inspector         │
│e │ Sources │   ┌──────────┐ ┌──────────┐          │                       │
│  │ panel   │   │ view 1   │ │ view 2   │          │                       │
│r │         │   └──────────┘ └──────────┘          │                       │
│a │         │   ┌──────────┐ ┌──────────┐          │                       │
│i │         │   │ view 3   │ │ view 4 * │          │                       │
│l │         │   └──────────┘ └──────────┘          │                       │
│  ├─────────┴──────────────────────────────────────┴───────────────────────┤
│  │ F · Timeline (120 px)                                                   │
├──┴────────────────────────────────────────────────────────────────────────┤
│ A · Status bar                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Why this over the alternative

The alternative (Layout B — top stream bar, full-width viewer, sources in a drawer, inspector collapsible) has a cleaner canvas but is wrong for Playback's primary users. Reasoning:

- **Sources are high-traffic for Priya and Lan.** Burying them behind a drawer icon adds a click to every file-level verification. Keeping them left-docked reflects the actual workflow.
- **Inspector is where settings live.** Collapsible-only made it too easy for novice users to miss the controls entirely. Docked-right with per-section collapse strikes the balance: dense when needed, quiet when not.
- **The viewer grid is wide, not tall.** 2×2 and side-by-side are the common layouts; 1920×1080 recordings with ~16:9 aspect thrive in wide center panes. Bottom-docked timeline leaves center-width unconstrained.
- **Parallel to existing modes.** USAF/FPN/DoF all use three-column layouts. Layout A is the natural extension; Layout B would be a new paradigm inside the app for no user benefit.

### 5.3 Where Layout B wins

One case: at narrow laptop widths (<1180 px), Layout B's "sources in a drawer" model becomes the better layout. See §13 (Responsive) — below the breakpoint, Playback collapses to Layout B implicitly: the sources panel becomes a drawer, and the inspector auto-collapses into a floating overlay.

### 5.4 Default proportions

| Region | Default | Min | Max |
|---|---|---|---|
| Mode rail (A) | 56 px | — | — |
| Top bar (A) | 50 px | — | — |
| Stream header (B) | 44 px | — | — |
| Sources (C) | 288 px | 240 px | 360 px |
| Viewer grid (D) | flex | 480 px | — |
| Inspector (E) | 368 px | 320 px | 440 px |
| Timeline (F) | 120 px | 96 px | 200 px |
| Status bar (A) | 26 px | — | — |

Sources and Inspector are user-resizable with drag handles. Timeline has a three-state height (compact 96 / normal 120 / zoomed 200).

---

## 6. Major screens

The following screens are fully realized in the prototype (`src/playback.jsx`), selectable from the in-mode screen switcher at the top of the viewer grid.

1. **Empty mode** — no stream loaded, primary CTA to load an H5.
2. **Loading metadata** — file picker active; opening and reading H5 metadata.
3. **Workspace · single view** — one stream loaded, one viewer, default layout fallback.
4. **Workspace · 2×2 comparison** — Priya and Lan's primary working view.
5. **Workspace · RGB + NIR side-by-side** — Marcus's common layout.
6. **Workspace · with overlay** — NIR-over-RGB overlay active in one view.
7. **Stream Builder modal** — multi-file ordering with continuity badges.
8. **Dark-frame manager panel** — opened from the Sources panel's dark section.
9. **Selected-view Inspector · RGB view** — full inspector with RGB grading expanded.
10. **Selected-view Inspector · single-channel view** — different section set, no RGB.
11. **Overlay Builder modal** — guided overlay creation.
12. **Export · Image modal** — tiled/per-view image export.
13. **Export · Video modal** — range-select + FPS + progress.
14. **Warning Center** — full list when there are multiple warnings.
15. **Narrow-window layout** — responsive collapse.

Full wireframe descriptions for each are in [`wireframes.md`](./wireframes.md).

---

## 7. Component anatomy

### 7.1 New Playback-specific components

All components are built inside `src/playback.jsx` using `shared.jsx` primitives. None require changes to `shared.jsx`.

#### 7.1.1 `StreamChip`

**Location:** Stream header (B). Also acts as the trigger for the Stream Builder modal.

**Anatomy.**
- Left: small stack-of-sheets icon.
- Middle: stream name (auto-generated "Stream · 2025-04-24 · 3 files" or user-edited).
- Right chip set: frame count, total duration, file count, optional warning dot.
- Hover: full-name tooltip.
- Click: opens Stream Builder.
- Right-click or overflow menu: Rename · Replace files · Detach stream.

**States.** Default · Hover · Open (Stream Builder active) · Warning (red dot, tooltip enumerates issues).

#### 7.1.2 `FilePill`

A row in the Sources panel representing one loaded recording file.

**Anatomy.**
- Drag handle (`drag` icon).
- File name (monospace, truncated center-ellipsis).
- Right-side: frame count · exposure badge · warning dot.
- Expander caret → expanded metadata: frame count, dimensions, channels, timestamp range, FPS, size on disk, any warnings with inline fix-it buttons.

**States.** Collapsed · Expanded · Loading · Loaded · Warning · Error · Partial (some frames failed to index).

#### 7.1.3 `DarkFrameRow`

A row in the Dark Frames section.

**Anatomy.**
- Dark-frame icon.
- Label (auto: "Dark · 20 ms · avg 32"; user-editable).
- Exposure badge.
- "Matched to view N" indicator when auto-match succeeded.
- Remove button.

**States.** Default · Auto-matched · Manually pinned · Mismatched exposure · Ambiguous (multiple darks at same exposure).

#### 7.1.4 `ViewerCard`

The core unit of the viewer grid.

**Anatomy.**
```
┌───────────────────────────────────────────┐
│ Title bar:  [name] · [channel] · badges  ⋮│
├───────────────────────────────────────────┤
│                                           │
│              canvas area                  │
│                                           │
│ [frame/time readout · sync/lock badge ]   │
└───────────────────────────────────────────┘
```

- **Title bar.** View name (inline-editable), channel chip, processing badges (Raw · Dark · Norm · LUT · RGB · Overlay · Locked · Export), overflow menu.
- **Canvas area.** Image content, optional overlay legend in bottom-left, optional clipping indicator in bottom-right.
- **Footer strip.** Frame index / timestamp / source file (compact mono), sync state badge.

**States.**

| State | Visual |
|---|---|
| Unselected | 1 px neutral border |
| Selected | 2 px accent border + accent-soft background on title bar |
| Locked | 2 px warm-amber border + lock icon in badges |
| Loading frame | shimmer overlay on canvas, badges dim |
| Frame unavailable | canvas shows "Frame not decoded" placeholder, badges dim, retry button |
| Export-included | small dot in title bar |

**Quick actions (in title bar overflow menu):** Duplicate · Remove · Rename · Copy settings to… · Lock to current frame · Include in export.

#### 7.1.5 `ProcessingBadge`

Small monospace chip, 3 letters. Present in the ViewerCard title bar.

| Badge | Meaning | Color on |
|---|---|---|
| `RAW` | Raw channel, no processing | neutral |
| `DRK` | Dark-corrected | accent |
| `NRM` | Normalized (min/max) | accent |
| `LUT` | Non-linear colormap applied | accent |
| `RGB` | RGB grading applied | accent |
| `OVL` | Overlay layer active | warn |
| `LCK` | Locked to specific frame | warn |
| `EXP` | Included in current export | success |

A hover tooltip explains each badge. Badges appear left-to-right in a fixed order regardless of activation order, so badge layout stays stable.

#### 7.1.6 `ViewerGrid`

Container for `ViewerCard`s. Manages layout presets, drag-reorder, selection.

**Layout presets** (user-switchable from the grid toolbar):
- **Single** — one view fills the grid.
- **Side-by-side (1×2)** — two views horizontal.
- **Stack (2×1)** — two views vertical.
- **2×2** — four views.
- **3+1** — three small views plus one large (RGB-centric).
- **Custom** — user resizes cells via drag handles.

The grid toolbar also hosts: add-view button, layout picker, sync-all toggle, screen switcher (prototype only).

#### 7.1.7 `TimelineStrip`

Bottom dock.

**Anatomy from top to bottom:**
1. **Mini-map row.** Full-stream scaled strip showing file boundaries (vertical ticks), the current visible range (brightened), gap markers (red notches), and a brush handle to zoom the detail row.
2. **Detail row.** Zoomed scrubber with frame ticks, file-boundary labels, range-selection handles, the current-frame marker (a tall caret), and any locked-view pins (amber caret).
3. **Playback controls row.** Play/pause, step −1 / +1, first / last, frame number input, timestamp, FPS selector, speed selector, loop toggle.

**States.** No stream · Paused · Playing · Scrubbing · Loading frame · Range selected · Gap encountered during playback.

#### 7.1.8 `Inspector`

The right panel is a stack of `Card`s (reused from `shared.jsx`), one per section:

1. **View** — name, type, sync/lock, export include.
2. **Source** — stream (read-only chip), channel selector (chips by HG-* and LG-*), frame mode (live/locked).
3. **Corrections** — dark correction toggle + selected dark frame; gain; offset; normalization on/off.
4. **Display** — low threshold; high threshold; colormap; invert; clipping-display toggle; histogram.
5. **RGB grading** — only visible when view type is RGB. Per-channel gains/offsets, gamma, brightness/contrast/saturation, white-balance controls, before/after toggle, presets.
6. **Overlay** — base view, overlay channel, threshold low/high, blend mode, blend strength, color/LUT, below-threshold behavior, above-threshold behavior, enabled toggle, "Open overlay builder…" deep-link.
7. **Labels** — which badges/labels burn into the exported view (timestamp, frame index, channel name, source file, scale bar, processing badges).
8. **Presets** — Save · Load · Copy settings to other views.
9. **Advanced** — debug info, per-view FPS, decode stats.

Sections collapse independently. Collapse state is persisted per view *type* (RGB / single-channel / overlay / comparison) so the inspector feels consistent when selection jumps.

#### 7.1.9 `WarningBadge`

Severity-tinted icon + text.

| Severity | Icon | Color | Behavior |
|---|---|---|---|
| **Info** | `info` | accent | silent; shown inline; no status-chip dot |
| **Warning** | `help` (rendered as `!` variant) | warn | inline banner or pill; contributes a dot to status chip |
| **Error** | `close` in circle | danger | inline banner with primary recovery CTA |
| **Blocking** | full-bleed banner | danger | blocks interaction with the affected surface until resolved |

Every warning type listed in §10.4 has a canonical message, severity, and at least one inline action.

### 7.2 Reuse from `shared.jsx`

- `Card`, `Row`, `Slider`, `Select`, `Button`, `Segmented`, `Checkbox`, `Spinbox`, `ChannelChip`, `StatBlock`, `HUD`, `CanvasToolbar`, `CanvasBtn`, `Tip`, `Kbd`, `Modal`, `Toast`, `Icon`.
- `useLocalStorageState`, `useDragCapture`, `useViewport`, `useImageMouse`.
- Theme tokens: all colors, spacing, typography.
- Procedural image generators (`makeUSAFImage` etc.) serve as placeholder canvas textures in the prototype.

No new color tokens, typography, or spacing are introduced.

---

## 8. User flows

Full walkthroughs live in [`flows.md`](./flows.md). Fourteen flows are documented, one per persona pain-point. This section summarizes the entry points and success criteria.

| # | Flow | Persona | Entry | Success |
|---|---|---|---|---|
| F1 | First-time open Playback | Any | Mode rail · key `4` | Empty state visible, CTA buttons clear |
| F2 | Load one H5 and view RGB | Marcus | Empty state → Open file | RGB view rendering within 2 clicks |
| F3 | Load recording + dark frames | Priya | Sources panel → Load dark | Dark correction auto-enabled, badge visible |
| F4 | Build multi-file stream | Priya | Open multiple → Stream Builder opens automatically | Continuous stream, no gaps/overlaps |
| F5 | Fix wrong automatic order | Priya | Stream Builder · Drag row | Stream becomes continuous; warning clears |
| F6 | Open RGB, NIR, and overlay together | Lan | Layout → 2×2 | Three views configured; overlay view legible |
| F7 | Adjust NIR threshold and colormap | Marcus | Select NIR view → Display section | Threshold preview updates live |
| F8 | Create NIR-over-RGB overlay | Marcus | Inspector Overlay → Open Builder | Overlay active; legend rendered |
| F9 | Apply RGB color correction | Marcus | RGB view → RGB grading section | Before/after toggle works; export reflects change |
| F10 | Lock one view while scrubbing | Lan | View overflow → Lock to frame | Locked view pinned; other views scrub freely |
| F11 | Export active views as tiled PNG | Priya | Stream header → Export → Image | WYSIWYG preview; file downloaded |
| F12 | Export selected views as video | Priya | Stream header → Export → Video | Range, FPS confirmed; progress visible; success summary |
| F13 | Handle missing dark-frame warning | Priya | Warning banner inline | Close match recommended; one-click accept |
| F14 | Handle incompatible files | Priya | Stream Builder | File quarantined with explanation; stream proceeds without it |

---

## 9. Wireframe descriptions

Summarized here; full text in [`wireframes.md`](./wireframes.md).

1. **Empty Playback** — Centered illustration-free message card with two buttons (primary: Open recording; secondary: Open dark frame) and onboarding list.
2. **File loading (active)** — Empty state replaced by Sources-panel shimmer rows; center pane shows "Reading metadata…" placeholder with a progress bar per file.
3. **Stream Builder modal** — Two-column layout: left file list with drag handles, continuity badges, gap/overlap indicators; right summary card with stream name, total frame count, duration, and apply button.
4. **Dark-frame manager** — Inline panel inside Sources panel; header row for toggle + auto-match, body is a list of `DarkFrameRow` cards with match-state chips.
5. **Main workspace with one view** — Single `ViewerCard` filling the grid, inspector shows that view's full section stack.
6. **Main workspace with 2×2 views** — Four cards in a 2×2 grid, one selected (accent border), inspector bound to selected view.
7. **Selected-view inspector** — Right column with all sections; sections collapsed/expanded; RGB section visible only for RGB view.
8. **Timeline/navigation** — Mini-map + detail + playback controls rows, file boundary markers, locked-view pin.
9. **Overlay configuration (inline)** — Inspector Overlay section expanded, all controls visible, "Open overlay builder…" link at the bottom.
10. **Overlay Builder modal** — Four-step wizard: Base → Overlay source → Thresholds → Preview & apply.
11. **RGB correction panel** — Inspector RGB section expanded, per-channel sliders, before/after toggle, presets dropdown.
12. **Export · Image modal** — Scope selector (all / selected / overlay), layout preview (separate / tiled), per-slice options, filename pattern, output location, Export button.
13. **Export · Video modal** — Same scope selector + range selector (brush over mini-map) + FPS / codec / label inclusion + progress state with Cancel.
14. **Warning Center** — Modal listing all active warnings grouped by severity; each row has an inline action.
15. **Narrow-window layout** — Sources becomes a left-edge rail of icons; Inspector floats right as a slide-over; Timeline compacts to compact mode.

---

## 10. Interaction states

### 10.1 Mode-level states

| State | Condition | Surface |
|---|---|---|
| Empty | No files loaded | Empty mode screen (Wireframe 1) |
| Building stream | Stream Builder confirming | Progress overlay on Stream header |
| Ready | Stream present, frame decoded | Workspace |
| Scrubbing | User dragging timeline | Pause playback; HUD shows target frame/time |
| Playing | Play active | Timeline current marker animates; FPS readout live |
| Locked-view active | ≥1 view locked | Locked views keep their frame; others follow global |
| Export running | Export in progress | Progress card in notifications; export CTA disabled |

### 10.2 Per-view states

Covered in §7.1.4.

### 10.3 Per-file states

Covered in §7.1.2.

### 10.4 Warnings catalog

| ID | Message template | Severity | Primary action | Secondary action |
|---|---|---|---|---|
| W-META-TS | "{file}: missing timestamp metadata." | Info | Inspect file | Dismiss |
| W-META-EXP | "{file}: missing exposure metadata." | Warning | Inspect file | Dismiss |
| W-EXP-MISMATCH | "Dark frame exposure ({dark}ms) does not match current frame ({rec}ms)." | Warning | Use closest dark | Disable dark |
| W-SHAPE | "{file} dimensions ({dx}×{dy}) do not match stream ({sx}×{sy})." | Error | Quarantine file | Replace file |
| W-CHAN | "{file} is missing channel {ch}. Overlay unavailable." | Error | Pick another channel | Remove file |
| W-DARK-NONE | "No dark frame available for exposure {ms}ms." | Warning | Load dark | Use closest |
| W-DARK-AMBIG | "Multiple dark frames match {ms}ms. Using most recent." | Info | Pick explicitly | — |
| W-OVL-SRC | "Overlay source is incompatible with base view." | Error | Pick another base | Disable overlay |
| W-EXPORT-LONG | "Export covers {n} frames (~{t} min). Continue?" | Warning | Continue | Narrow range |
| W-FRAME-FAIL | "Frame {n} failed to decode." | Warning | Retry | Skip frame |
| W-PROC-INVALID | "Processing setting out of range; reverted to default." | Info | — | — |
| W-RANGE-HUGE | "Export range exceeds recommended limit ({n} frames)." | Warning | Continue anyway | Narrow range |

### 10.5 Loading states

| Where | Treatment |
|---|---|
| File metadata read | Shimmer rows in Sources panel; top bar shows a small spinner chip |
| Frame decode | Per-view shimmer overlay; footer reads "Loading frame {n}…" |
| Dark frame load | Inline row in Dark section with spinner |
| Building stream | Modal stays open; confirm button replaced by spinner |
| Export render | Progress card in notifications region |

### 10.6 Empty states

| Where | Message | Action |
|---|---|---|
| Mode | "No recording loaded." | Open recording · Open dark frame |
| Sources · recordings | "No files yet." | Open recording |
| Sources · dark frames | "No dark frames loaded. Dark correction unavailable." | Open dark frame |
| Viewer · no views | "Add a view to start inspecting." | Add view |
| Export range | "No range selected. Using full stream." | Select range |
| Warning center | "No warnings." | — |

### 10.7 Failure states

| Where | Message | Recovery |
|---|---|---|
| File failed to load | "Could not read {file}." | Retry · Remove |
| Partial load | "{n}/{N} frames indexed in {file}." | Use partial · Reload |
| Frame decode failed | "Frame {n} unavailable." | Next frame · Retry |
| Overlay can't be created | "Base and overlay sources are not aligned." | Pick different source |
| Export failed | "Export stopped after {n} frames." | Resume · Retry · Abort |
| Export cancelled | "Export cancelled by user." | Restart · Close |

---

## 11. Visual design direction

### 11.1 Tone

Scientific workstation. Calm, precise, professional. More data-dense than the other three modes, but never loud. No emoji, no decorative imagery. Color carries meaning; it is never the only signal for state (a color change is always paired with an icon, label, or pattern).

### 11.2 Tokens (inherited)

All from `shared.jsx` · `THEMES`:

- **Backgrounds:** `bg` (app), `panel` (cards/panels), `panelAlt` (nested panels, mono stat blocks), `canvasBg` (viewer interiors).
- **Text:** `text`, `textMuted`, `textFaint`.
- **Accent:** `accent`, `accentHover`, `accentSoft` — configurable (blue · violet · teal · amber) from Tweaks.
- **Status:** `warn`, `danger`, `success`.
- **Channel colors:** `CHANNEL_COLORS` · R / G / B / NIR / Y.
- **Shadows:** `shadow`, `shadowLg`.

### 11.3 Typography

- **UI text.** Inter Tight, 11–13 px, 400/500/600 weights. Uppercase 10.5 px with tracking for section labels.
- **Monospace / numeric.** JetBrains Mono or ui-monospace, 10.5–11.5 px. Used for: frame numbers, timestamps, coordinates, file names (when truncation matters), metadata rows.
- **Display.** `MantisAnalysis` wordmark in the top bar uses -0.15 tracking and 650 weight. No display type elsewhere.

### 11.4 Spacing and rhythm

- Base unit: **4 px**. Multiples of 4 for padding, 8 for margins between cards.
- Sidebar card padding: 8/10 px vertical/horizontal.
- Viewer card padding: 0 on canvas; 8 px on title bar and footer.
- Inspector row min-height: 24 px.
- Modal outer padding: 20 px; inner section gap: 16 px.

### 11.5 Component style

- **Cards.** 1 px `border` stroke, 8 px radius. No drop shadows on inline cards; only modals and dropdowns use `shadowLg`.
- **Buttons.** Ghost default. Primary only on terminal CTAs (Confirm stream, Export, Close builder). 5 px radius.
- **Badges.** Mono, 10 px, 3-letter code when applicable, 4 px radius. Exactly one color accent.
- **Sliders.** Thumb is accent-colored, rail is chip-background, filled portion is accent. HUD bubble appears while dragging.
- **Timeline.** Mini-map tick color: `textFaint`. Current frame: accent caret. Gap marker: 2 px notch in `danger`. Locked pins: `warn`.

### 11.6 Viewer background

`canvasBg` (near-black) for both themes. Viewer cards in dark theme match; in light theme they stay dark-on-light (an intentional inversion for perceptual contrast on imagery). Border of the viewer card in light theme uses `borderStrong`.

### 11.7 Selected-view highlight

- 2 px inset `accent` border on the card.
- Title bar background shifts from `panel` to `accentSoft` with `accent` text.
- Inspector right panel shows a small accent dot beside "View · {name}" header.

### 11.8 Warning color mapping

| Severity | Stroke | Fill | Icon |
|---|---|---|---|
| Info | `accent` | `accentSoft` | `info` |
| Warning | `warn` | `rgba(warn, 0.12)` | variant `!` |
| Error | `danger` | `rgba(danger, 0.10)` | `close`-in-circle |
| Blocking | `danger` | `rgba(danger, 0.15)` | full banner |

### 11.9 Overlay legend style

Small rectangular chip in the bottom-left of an overlay view's canvas:

```
┌─────────────────────┐
│ NIR · 350–900 · 65% │
│ [colormap gradient] │
└─────────────────────┘
```

Monospace, semi-transparent panel background, 1 px border in `rgba(255,255,255,0.1)`. Hidden when the view is not an overlay view. Can be toggled off from Labels section.

### 11.10 Light/dark theme behavior

Playback is fully dual-themed. Light theme uses a near-black canvas (perceptual choice) with light chrome. Dark theme matches the rest of the app. Accent swatch is configurable in both. Theme preference respects the app-wide setting; Playback does not override.

---

## 12. Accessibility checklist

Hand this section to the implementation engineer as a review gate.

### 12.1 Keyboard

- [ ] `Tab` / `Shift-Tab` traverses: top bar → mode rail → sources panel → viewer grid → inspector → timeline → status bar.
- [ ] Arrow keys inside the timeline move the frame index by 1; `Shift+Arrow` moves by 10; `Home`/`End` jump to first/last.
- [ ] `Space` toggles play/pause when the timeline or any viewer has focus.
- [ ] `[` and `]` step through viewer selection; `Enter` opens the focused card's overflow menu.
- [ ] `Escape` closes modals, overlays, overflow menus. Never closes the app.
- [ ] `4` from anywhere outside an input switches to Playback (matching existing `1`/`2`/`3`).
- [ ] `⌘K` opens the command palette, which includes every Playback action with a shortcut hint.
- [ ] `?` shows the shortcut overlay, scoped to Playback.

### 12.2 Focus

- [ ] Visible focus ring (2 px accent outline) on every interactive element.
- [ ] Focus is trapped inside modals; `Esc` returns focus to the trigger.
- [ ] Focus persists after layout changes (e.g. switching presets).

### 12.3 Screen readers

- [ ] Every icon-only button has a `title` and `aria-label`.
- [ ] Sliders and number inputs have explicit labels and announce value on change.
- [ ] Warnings are announced via a live region (`aria-live="polite"` for info/warning; `assertive` for errors).
- [ ] Selected-view state is exposed as `aria-selected="true"` on the card.
- [ ] Modal trigger elements reference the modal via `aria-controls` and `aria-expanded`.

### 12.4 Color and contrast

- [ ] All text meets WCAG AA against its background (4.5:1 body / 3:1 large).
- [ ] Warnings pair color with icon and text. A user who cannot see color can still distinguish severity.
- [ ] Channel colors have distinct icons/labels (R, G, B, NIR, Y) in addition to swatches.
- [ ] Processing badges display a 3-letter code, not color alone.

### 12.5 Target sizes

- [ ] Interactive elements ≥ 24 px tall for pointer; button pads ≥ 28 px effective.
- [ ] Timeline handles ≥ 12 px wide with 12 px extra hit area.
- [ ] Viewer selection: clicking anywhere on the card selects it (not only the title bar).

### 12.6 Motion

- [ ] Animations ≤ 200 ms and use CSS transitions, not keyframed sweeps.
- [ ] Respect `prefers-reduced-motion`: disable shimmer loaders and toast slide-ins.
- [ ] Playback animation speed is user-controlled (FPS selector).

---

## 13. Responsive behavior

### 13.1 Breakpoints

Mirrors `useViewport` in `shared.jsx`:

- **lg** ≥ 1400 px — full Layout A, all panels visible.
- **md** 1180–1400 px — full Layout A, sources panel at minimum width.
- **sm** 960–1180 px — Layout A', sources collapses to icon rail; inspector remains but cannot exceed 320 px.
- **xs** < 960 px — below minimum supported. Show a blocking message: "Playback requires a wider viewport."

### 13.2 Panel collapse rules

- **Sources.** Collapses to a 44 px icon rail at `sm`. Icons trigger slide-over overlays for the recordings list and dark-frame manager.
- **Inspector.** At `sm`, inspector auto-collapses when any modal opens and re-opens on modal close. At `md` and below, all inspector sections default to collapsed except View and Source.
- **Timeline.** Mini-map row is optional at `sm`; hide it by default with a "show mini-map" affordance in the detail row.

### 13.3 Viewer grid degradation

- At `sm`: 2×2 becomes 1×4 horizontal carousel with visible pagination; 3+1 becomes 1×4 plus a "focus" button to promote one view to fill.
- Single-view layout is always available and is the responsive fallback.

### 13.4 Modal behavior

- Modals max out at 720 px wide. At `sm`, all modals become full-viewport sheets with a close header.
- Stream Builder and Export modals are single-column at `sm`; two-column at `md` and above.

### 13.5 Many-viewer behavior

Above 4 views, the grid scrolls vertically within the viewer region. The mini-map in the timeline still reflects the stream regardless of how many views are open.

---

## 14. Export workflow

### 14.1 Principles

1. **WYSIWYG.** Every processing setting visible on the viewer is present in the exported output unless the user opts out.
2. **Labeled by default, not decorated.** Timestamp and frame index are on by default; channel name and source file are off by default.
3. **No raw exports in this scope.** A separate "Export raw data" surface is a future hook, clearly differentiated by wording and iconography when it lands.
4. **One export at a time.** Running an export disables the Export buttons and shows a progress card in notifications.

### 14.2 Image export · user contract

Given: currently selected views, current frame, current labels settings.

User chooses:
- **Scope.** All visible views · selected views · a specific view.
- **Layout.** Separate files · tiled composition. Tiled offers preset grids (1×N, 2×M, etc.) plus a custom arrangement.
- **Labels.** Per-view: timestamp, frame index, channel name, source file, scale bar, processing badges. Global: filename, export note.
- **Format.** PNG · TIFF · JPEG (for JPEG, warn "lossy for scientific imagery").
- **Filename pattern.** Tokens: `{stream}`, `{frame}`, `{timestamp}`, `{view}`, `{channel}`, `{date}`.
- **Location.** Folder picker; last-used remembered.
- **Preview.** Live preview updates as settings change.

Progression: single modal, three sections stacked (Scope → Labels/format → Output). Preview pinned to the right.

### 14.3 Video export · user contract

Given: currently selected views, current range or full stream.

User chooses:
- **Scope.** Same as image.
- **Frame range.** Brushable mini-map inside the modal, or manual start/end frames or timestamps. Default: current range selection if any, else full stream.
- **Output FPS.** Presets (native · 30 · 60 · 24) + custom numeric.
- **Playback speed baked in.** Separate from output FPS — speed 2× baked means half as many output frames for the same duration.
- **Per-view or tiled.** Same as image.
- **Format.** MP4 (H.264) · MOV · GIF (with size warning) · PNG sequence.
- **Label inclusion.** Same as image; adds an optional burn-in of "rendered view" watermark when any label is on.
- **Estimate.** Shows estimated duration, frame count, and approximate file size before confirming.

Progression: single modal, three sections (Scope & range → Output → Labels). Cancellable at any time. On completion, offers "Show in folder" and "Open file."

### 14.4 Progress and completion

- In-modal progress bar with frame `{n}/{N}` and ETA.
- Cancel button halts immediately; completed frames are retained in a tmp folder the user can reach via "Show partial output."
- Success: green check + "Saved to {path}." 4-second auto-dismiss unless user hovers.
- Failure: danger banner with the last successful frame number and a retry-from-there CTA.

### 14.5 Honesty about what's exported

Every export modal includes a one-line disclosure above the primary button:

> Exports the rendered view, not raw data. Processing settings (dark correction, thresholds, overlays, RGB grading) are baked in.

---

## 15. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Per-view inspector feels complex to new users | High | Medium | Collapse sections by default for non-RGB views; provide an "All controls" vs "Basic controls" segmented at the top of the inspector |
| R2 | Multi-view state becomes confusing (who's locked, who's synced) | High | High | Processing-badge + footer sync/lock indicator + global synced-views count in the stream header |
| R3 | Timeline feels laggy on multi-thousand-frame streams | Medium | High | Mini-map pre-renders; detail row virtualizes tick marks; debounce scrub updates |
| R4 | Users confuse RGB grading with calibrated correction | Medium | High | Explicit label "Display grading — not color-calibrated"; keep the before/after toggle prominent; reserve `Calibration` wording for a future calibrated-profile feature |
| R5 | Export WYSIWYG drifts from live view | Medium | High | Single render pipeline shared by viewer and export; label strip in the export preview matches the viewer exactly |
| R6 | Dark correction applied without user awareness | Low | High | No auto-enable on first-load; enabling dark correction is a deliberate toggle; dark-corrected views carry the `DRK` badge |
| R7 | Stream Builder's continuity algorithm surprises users | Medium | Medium | Show the continuity threshold value next to the detection result; allow manual override; give each decision a plain-language explanation in hover |
| R8 | Too many open views slow the viewer grid | Medium | Medium | Soft limit of 6 views with a "you have many views open" hint at 7+; hard limit of 12 |
| R9 | Narrow-window layout leaves inspector unreachable | Medium | Medium | Auto-open inspector when a view is first selected at `sm` size; floating inspector uses a tap-outside-to-dismiss pattern |
| R10 | Export runs during scrub are confusing | Low | Medium | Disable scrub during export; dim timeline with a "Exporting…" overlay; document in the status bar |
| R11 | "Send this frame to USAF/FPN/DoF" (future feature) may invalidate Playback's mental model | Low | Low | Keep Playback self-contained; add routing as an explicit right-click affordance later, not woven into defaults |

---

## 16. Milestone plan

Ordered for sequential design → implementation handoff. Each milestone has a concrete deliverable inside this project.

### M0 — Audit & token lock
**Deliverable.** §2, §3, §11.  
**Done when.** All tokens, typography, spacing, and existing primitives are inventoried and the design direction is locked.

### M1 — IA & layout recommendation
**Deliverable.** §4, §5.  
**Done when.** Recommended layout is committed with rationale, alternative documented, proportions fixed.

### M2 — Empty & loading states
**Deliverable.** Prototype screens 1–2; wireframes 1–2.  
**Done when.** A user with no data can reach a state that tells them what to do next, with at most one dead-end.

### M3 — Sources panel & file list
**Deliverable.** `FilePill`, `DarkFrameRow`, Sources panel; wireframe 4.  
**Done when.** Loading one file, loading many, loading dark frames, and removing each work visually; warning states render.

### M4 — Stream Builder
**Deliverable.** Stream Builder modal; wireframe 3; flow F4/F5/F14.  
**Done when.** Users can reorder, see continuity, see gaps, override grouping, quarantine incompatible files.

### M5 — Viewer grid & view card
**Deliverable.** `ViewerGrid`, `ViewerCard`, all layout presets; wireframes 5, 6.  
**Done when.** Single, 1×2, 2×1, 2×2, 3+1 layouts render and preserve selection through layout changes.

### M6 — Selected-view inspector
**Deliverable.** Inspector with all nine sections; wireframes 7, 9, 11.  
**Done when.** Section collapse persists per view-type; RGB-only sections appear conditionally; Copy-settings-to works.

### M7 — Timeline & navigation
**Deliverable.** `TimelineStrip`; wireframe 8.  
**Done when.** Mini-map, detail row, playback controls, range selection, file boundary markers, locked pins all behave.

### M8 — Overlay workflow
**Deliverable.** Per-view Overlay section + Overlay Builder modal; wireframes 9, 10.  
**Done when.** Quick inline overlay works; guided builder produces an identical result; overlay legend renders.

### M9 — Export modals
**Deliverable.** Image and Video export; wireframes 12, 13.  
**Done when.** Both modals show WYSIWYG preview, progress, cancel, and success/failure states.

### M10 — Warnings center & states
**Deliverable.** Warning Center modal, inline banners, severity treatments; wireframe 14.  
**Done when.** Every warning in §10.4 has a canonical template and an inline action; Warning Center aggregates them.

### M11 — Responsive & accessibility
**Deliverable.** Narrow-window layout, keyboard map, focus states, screen-reader labels; wireframe 15.  
**Done when.** The a11y checklist in §12 is fully green; layout degrades gracefully through `lg` → `sm`.

### M12 — Acceptance review
**Deliverable.** Final walk-through of §17.  
**Done when.** Every acceptance criterion in §17 maps to a concrete prototype screen and a spec section.

---

## 17. Final acceptance criteria

The UI/UX design is accepted as complete when:

### 17.1 Content

- [x] A written product concept that frames the mode against its siblings.
- [x] Prioritized design goals with explicit non-goals.
- [x] Three personas, each with needs, context, and pain points.
- [x] Information architecture with named regions and persistence rules.
- [x] A recommended workspace layout with an explicit trade-off narrative against the alternative.
- [x] A catalog of fifteen screens covering every state, each matched to a wireframe.
- [x] Component anatomy for all new Playback-specific components.
- [x] Fourteen user flows cross-referenced to personas.
- [x] Full wireframe descriptions in a companion document.
- [x] Interaction-state matrices for mode, view, file, warning, loading, empty, failure.
- [x] Visual direction with tokens, typography, spacing, and component style rules.
- [x] Accessibility checklist specific to Playback's new surfaces.
- [x] Responsive breakpoints with panel-collapse rules.
- [x] Export workflow spec for image and video, with honesty disclosure.
- [x] Risks with concrete mitigations.
- [x] Milestone plan with per-milestone deliverables.

### 17.2 Prototype

The prototype at `src/playback.jsx` must:

- [ ] Register as the fourth mode in the app shell alongside USAF/FPN/DoF.
- [ ] Expose all 15 screens through an in-mode screen switcher, so a reviewer can see each without scripting data.
- [ ] Reuse only `shared.jsx` primitives; no new color tokens.
- [ ] Render consistently in light and dark themes with all four accent options.
- [ ] Keyboard-operable for frame stepping, play/pause, and mode switching.
- [ ] Include at least one canonical warning, loading, empty, and failure state per major surface.
- [ ] Show processing badges, the overlay legend, and the export preview using the same rendering path.

### 17.3 Handoff

- [x] Spec, wireframes, and flows all present in `design/playback/`.
- [ ] Each spec section references the prototype screen that demonstrates it.
- [ ] A future engineer can read §4, §5, §7, §10, §14 and build the backend data model implied by these screens without guessing user intent.

---

*End of specification.*
