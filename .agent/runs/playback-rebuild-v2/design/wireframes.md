# Playback — Wireframe Descriptions

Companion to [`spec.md`](./spec.md). One section per wireframe, spatially described so a designer or engineer can reconstruct layout without the prototype.

Notation:
- `[A]` = region label from spec §4.1.
- `│` and `─` delimit panels; widths are approximate.
- `•` = bullet/icon. `■` = filled state. `□` = empty state.
- `⋮` = overflow menu. `×` = close.

---

## W1 · Empty Playback

**Region.** Full workspace, no data loaded.

```
┌────────────────────── top bar ──────────────────────┐
│ MantisAnalysis · Playback                  search ⋮ │
├──┬──────────────────────────────────────────────────┤
│M │ Stream header — empty, shows "No stream" chip    │
│R ├──────────────────────────────────────────────────┤
│  │                                                  │
│  │                                                  │
│  │              ┌──────────────────┐                │
│  │              │  recording icon  │                │
│  │              │   (ghosted)      │                │
│  │              └──────────────────┘                │
│  │                                                  │
│  │          Load a recording to begin               │
│  │   H5 camera files · optional dark frames         │
│  │                                                  │
│  │   [ Open recording ]   [ Open dark frame ]       │
│  │                                                  │
│  │         · or drop H5 files anywhere ·            │
│  │                                                  │
│  │   Getting started                                │
│  │   1. Load one or more recording H5 files         │
│  │   2. Optionally load dark frames                 │
│  │   3. Pick a layout and scrub the timeline        │
│  │   4. Adjust processing and export                │
│  │                                                  │
│  ├──────────────────────────────────────────────────┤
│  │ Timeline — empty state "No stream loaded"        │
└──┴──────────────────────────────────────────────────┘
```

Notes:
- Centered message card, 420 px wide, panel background, 1 px border.
- Primary CTA uses `variant="primary"`; secondary is ghost.
- Drag-drop target covers the full `[D]` region; visual feedback is a 2 px dashed accent border when a file is over the viewport.
- Sources and Inspector are present but in their own empty states (see W4 for sources empty detail).

---

## W2 · File loading (active)

**Region.** Sources panel shows shimmer rows while metadata reads; center shows a "Reading metadata" placeholder.

```
┌── Sources ─────────────────┐   ┌── Viewer ──────────────────┐
│ Recordings                 │   │                            │
│ ░░░░░░░░░░░░░░░░░  ███ %   │   │   Reading metadata…        │
│ ░░░░░░░░░░░░░░░░░  ██▒ %   │   │                            │
│ ░░░░░░░░░░░░░░░░░  █▒▒ %   │   │   ┌─── progress ───┐       │
│                            │   │   │████████▒▒▒▒▒▒ │ 62%    │
│ Dark frames                │   │   └────────────────┘       │
│ ░░░░░░░░░░░░░░░░░          │   │                            │
│                            │   │   3 files queued           │
└────────────────────────────┘   │   2 successful · 1 pending │
                                 └────────────────────────────┘
```

Notes:
- Shimmer is a background-position animation on a 2-stop gradient.
- Percentage readout right-aligned in each row uses monospace.
- If any file errors, that row stops shimmering and turns into the "error FilePill" state from W4.

---

## W3 · Stream Builder modal

**Region.** Modal, 720 px wide.

```
┌──────────────────────── Stream Builder ────────────────────────× ┐
│                                                                  │
│  3 files → 1 stream · [stream name ▼]                            │
│                                                                  │
│ ┌── Files (drag to reorder) ──────────────┐  ┌── Summary ──────┐ │
│ │                                         │  │                 │ │
│ │ ⁝ recording_001.h5     ● Continuous     │  │ Stream name     │ │
│ │   1200 frames · 20 ms · 00:00 – 00:40   │  │ Stream · 04-24  │ │
│ │                                         │  │                 │ │
│ │ ⁝ recording_002.h5     ⚠ 0.8 s gap      │  │ Total           │ │
│ │   1200 frames · 20 ms · 00:41 – 01:21   │  │ 4×××× frames    │ │
│ │                                         │  │ 02:14 duration  │ │
│ │ ⁝ recording_003.h5     ⚠ exposure 40 ms │  │                 │ │
│ │   1400 frames · 40 ms · 01:21 – 02:14   │  │ Warnings        │ │
│ │                                         │  │ • 1 gap         │ │
│ │ Continuity threshold  [ 1.00 s ] …      │  │ • 1 exposure    │ │
│ │ [ Auto-detect groups ]                  │  │                 │ │
│ └─────────────────────────────────────────┘  │ [ Apply ]       │ │
│                                              └─────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

Notes:
- Drag handle at row start. Row shows name + continuity badge + 2-line metadata.
- Continuity threshold numeric field has an info icon that explains "frames closer than this are merged; gaps beyond this are flagged."
- Summary card sticks to the right; Apply button disabled while there's at least one Error-severity warning.
- When a row is selected (click), a third column appears showing raw metadata: frame count, dims, channels, bits, exposure, timestamp range, FPS estimate, file size.

---

## W4 · Dark-frame manager

**Region.** Inside Sources panel `[C]`; second `Card` after Recordings.

```
┌── Dark frames ──────────────────── ⚙ ─┐
│ ■ Apply dark correction                │
│   Auto-match by exposure  [ on ]       │
│                                        │
│ ● Dark · 20 ms · avg 32    matched ✓   │
│   frames.h5 · 32 frames averaged       │
│                                        │
│ ● Dark · 40 ms · avg 64                │
│   frames_40.h5 · 64 frames averaged    │
│                                        │
│ ⚠ Dark · 10 ms · avg 16                │
│   no matching recording                │
│                                        │
│ [ + Load dark frame ]                  │
└────────────────────────────────────────┘
```

Notes:
- Top-level toggle controls the default. Each view can still override independently.
- "Auto-match by exposure" is a secondary toggle. When off, each view must pick its dark explicitly.
- Rows show a colored dot left: green (matched), neutral (available but unused), warn (mismatched/ambiguous).
- Remove affordance appears on hover as a small `trash` icon.

---

## W5 · Main workspace · single view

```
┌─ Sources ─┐┌──── Viewer (full) ───────────────┐┌─ Inspector ─┐
│           ││ ┌──────────── Stream header ────┐││             │
│ Recording ││ │ [stream chip] frame 124/4000  │││ View        │
│  001.h5   ││ │               00:04.127 s     │││  name       │
│  002.h5   ││ │ [+view]  [layout:single ▾]   ┘││             │
│  003.h5   ││                                   ││ Source      │
│           ││ ┌── ViewerCard ──────────────────┐││ channel chip │
│ Dark      ││ │ RGB · HG-*    RAW DRK NRM LUT  │││             │
│  20ms ✓   ││ │                                │││ Corrections │
│  40ms     ││ │                                │││ dark: ✓     │
│           ││ │       [image canvas]           │││             │
│           ││ │                                │││ Display     │
│           ││ │                                │││ thresholds  │
│           ││ │  frame 124 · 00:04.127 · src1  │││             │
│           ││ └────────────────────────────────┘││ RGB grading │
│           ││                                   ││             │
│           ││                                   ││ Labels      │
│           ││                                   ││             │
│           ││                                   ││ Advanced    │
│           │└────────────────────────── timeline ┴─────────────┤
│           │ ◀◀ ◀ ▶ ▶▶    ▁▂▃▅█▇▅▂▁   │  frame 124  fps 30 ▾ │
└───────────┴───────────────────────────────────────────────────┘
```

Notes:
- Single-view layout still shows the grid toolbar; `+view`, layout picker, sync-all toggle.
- Inspector shows all RGB-relevant sections. Section titles are the uppercase labels from `Card`.

---

## W6 · Main workspace · 2×2 comparison

```
┌─ Sources ─┐┌──── Viewer grid ─────────────────┐┌─ Inspector ─┐
│           ││ [layout: 2×2 ▾]  [+ view]  sync  ││ View        │
│           ││                                   ││  name       │
│           ││ ┌──────────┐  ┌──────────┐        ││             │
│           ││ │ HG-R  RAW│  │ HG-G  RAW│        ││ Source      │
│           ││ │          │  │          │        ││ channel     │
│           ││ │  canvas  │  │  canvas  │        ││             │
│           ││ │          │  │          │        ││ Corrections │
│           ││ └──────────┘  └──────────┘        ││             │
│           ││ ┌──────────┐  ┌─●────────┐        ││ Display     │
│           ││ │ HG-B  RAW│  │ HG-NIR   │        ││             │
│           ││ │          │  │ LUT OVL  │        ││ Overlay     │
│           ││ │  canvas  │  │ [preview]│        ││             │
│           ││ │          │  │          │        ││ Labels      │
│           ││ └──────────┘  └──────────┘ (sel.) ││             │
└───────────┴───────────────────────────────────┴─────────────┘
```

Notes:
- Bottom-right card is selected (`●` accent dot, 2 px accent border).
- Each card title: channel name + badges. Selected card is reflected in the Inspector header.
- `sync` toggle in the grid toolbar syncs all non-locked views to the global frame.

---

## W7 · Selected-view inspector (full)

```
┌───────────── Inspector · HG-NIR ●  ─────┐
│                                          │
│ ▸ VIEW                                   │
│   Name  [ NIR view          ]            │
│   Type  Single-channel                   │
│   Sync  [■] global   Lock  [□]           │
│   Export include [■]                     │
│                                          │
│ ▸ SOURCE                                 │
│   Stream  [ Stream · 04-24 ]  (chip)     │
│   Channel [ ChannelChip HG-NIR ]         │
│   Frame   [ Live / Lock to 124 ]         │
│                                          │
│ ▸ CORRECTIONS                            │
│   Dark  [■] matched · Dark 20 ms ▾       │
│   Gain      [slider]      1.00           │
│   Offset    [slider]     -12             │
│   Normalize [□]                          │
│                                          │
│ ▸ DISPLAY                                │
│   Low       [slider]      30             │
│   High      [slider]     900             │
│   Colormap  [ viridis ▾ ]  invert [□]    │
│   Clipping  [□] show clipped pixels      │
│   Histogram [─min───peak────max─]        │
│                                          │
│ ▸ OVERLAY                                │
│   Base       [ RGB view ▾ ]              │
│   Channel    [ HG-NIR ▾ ]                │
│   Low/High   [slider] [slider]           │
│   Blend      [ alpha ▾ ] strength 0.65   │
│   Below thr  [ hide ▾ ]                  │
│   Above thr  [ saturate ▾ ]              │
│   Enabled    [■]                         │
│   [ Open Overlay Builder… ]              │
│                                          │
│ ▸ LABELS                                 │
│   [■] timestamp  [■] frame  [□] channel  │
│   [□] source file  [□] scale bar         │
│   [■] processing badges                  │
│                                          │
│ ▸ PRESETS                                │
│   [ Save… ]  [ Load ▾ ]  [ Copy to… ]    │
│                                          │
│ ▸ ADVANCED                               │
│   decode time  12 ms                     │
│   view fps     30.2                      │
│                                          │
└──────────────────────────────────────────┘
```

Notes:
- Sections use `Card` primitive. Collapsed sections show just the title row.
- RGB grading card appears instead of or in addition to Display when view type is RGB.
- `Copy to…` opens a small popover listing other views with checkboxes.

---

## W8 · Timeline/navigation bar

```
┌── Timeline ────────────────────────────────────────────────┐
│ Mini-map                                                    │
│ ┃┃┃      ┃┃              ┃┃         ┃                      │
│ ┃┃┃██████┃┃██████×××××××××┃┃████████┃█████████             │
│                                                             │
│ Detail (zoom ← mini-map brush)                              │
│ frame 124 ▼         ┃ ●                      ◆locked 312   │
│ 0 · · · · · 100 · · · · · 200 · · · · · 300 · · · · · 400 │
│                                                             │
│ ◀◀  ◀  ▶ / ❚❚  ▶  ▶▶    frame [124] time 00:04.127         │
│ fps [30 ▾]   speed [1× ▾]   loop [□]   range [none▾]       │
└─────────────────────────────────────────────────────────────┘
```

Notes:
- `┃` = file-boundary tick. `█` = frame fill (opacity encodes file membership).
- `×` = gap marker (red).
- `●` = current frame marker (accent caret). `◆` = locked-view pin (amber).
- Brush on mini-map zooms detail row. Range selection via two handles on detail row.
- Playback controls row is full-width; FPS and speed are separate (FPS = output rate, speed = scrub multiplier).

---

## W9 · Overlay configuration panel (inline)

Equivalent to the OVERLAY section in W7. Differences when expanded:

- The "Enabled" toggle becomes a header-level switch.
- A small "preview" thumbnail appears next to the blend controls, showing the current overlay composition at reduced size.
- The "Open Overlay Builder…" link is visually distinct (accent-tinted).

---

## W10 · Overlay Builder modal

**Region.** Modal, 720 px wide, four tab-like steps.

```
┌──────────── Overlay Builder ────────────×┐
│  1 Base · 2 Source · 3 Thresholds · 4 Preview                     │
│                                                                    │
│ ┌── Step ─────────────────┐  ┌── Live preview ────────────────┐   │
│ │                         │  │                                 │   │
│ │ [Base view ▾]           │  │   [canvas: base + overlay]     │   │
│ │                         │  │                                 │   │
│ │ Overlay channel          │  │   legend: NIR · 350–900 · 65% │   │
│ │ [ HG-NIR ▾ ]            │  │                                 │   │
│ │                         │  │                                 │   │
│ │ Thresholds              │  │                                 │   │
│ │ Low  [slider]            │  │                                 │   │
│ │ High [slider]            │  │                                 │   │
│ │                         │  │                                 │   │
│ │ Blend mode              │  │                                 │   │
│ │ [ alpha / additive /    │  │                                 │   │
│ │   screen / masked ]     │  │                                 │   │
│ │                         │  │                                 │   │
│ │ Strength [slider]        │  │                                 │   │
│ └─────────────────────────┘  └────────────────────────────────┘   │
│                                                                    │
│                    [ Cancel ]   [ ← Back ]   [ Apply overlay ]    │
└────────────────────────────────────────────────────────────────────┘
```

Notes:
- Step titles at top act as both indicator and nav; clicking a past step returns to it with settings preserved.
- Preview pane pinned to the right; updates live as settings change (≤100 ms debounce).
- "Apply overlay" creates (or updates) the overlay configuration on the target view and closes the modal.

---

## W11 · RGB correction panel

Inside the RGB GRADING section of the inspector, expanded:

```
│ ▸ RGB GRADING                  [before ⇌ after]  │
│   Per-channel gain                               │
│   R  [slider]   1.00                             │
│   G  [slider]   1.00                             │
│   B  [slider]   1.00                             │
│   Per-channel offset                             │
│   R  [slider]   0                                │
│   G  [slider]   0                                │
│   B  [slider]   0                                │
│   Gamma       [slider]   1.00                    │
│   Brightness  [slider]   0                       │
│   Contrast    [slider]   1.00                    │
│   Saturation  [slider]   1.00                    │
│   White balance                                  │
│   [ auto ]  [ 5500 K ▾ ]                         │
│   Color matrix [ open editor… ]                  │
│   Presets  [ Save… ]  [ Load ▾ ]                 │
│                                                  │
│ ⓘ Display grading — not color calibrated.        │
```

Notes:
- Before/after toggle at the top right of the section header swaps the canvas to raw.
- Auto white balance is a button, not a toggle; runs once against the current frame.
- The disclosure line is always visible at the bottom of the section.

---

## W12 · Export · Image modal

**Region.** Modal, 840 px wide, two-column.

```
┌──────────── Export · Image ────────────×┐
│                                                                    │
│ ┌── Settings ────────────────┐  ┌── Preview ─────────────────────┐│
│ │ Scope                       │  │                                ││
│ │ ( ) All views  (•) Selected │  │   [ tiled preview ]            ││
│ │                             │  │                                ││
│ │ Layout                       │  │                                ││
│ │ ( ) Separate files           │  │                                ││
│ │ (•) Tiled                    │  │                                ││
│ │   arrangement [ 2×2 ▾ ]      │  │                                ││
│ │                             │  │                                ││
│ │ Labels                       │  │                                ││
│ │ [■] timestamp [■] frame      │  │                                ││
│ │ [□] channel  [□] source      │  │                                ││
│ │ [■] processing badges        │  │                                ││
│ │ [□] scale bar                │  │                                ││
│ │                             │  │                                ││
│ │ Format  [ PNG ▾ ]            │  │                                ││
│ │ Filename  [ {stream}_f{frame}  │                                ││
│ │            _{date}           ]  │                                ││
│ │ Output folder  [ … ]         │  │                                ││
│ └─────────────────────────────┘  └────────────────────────────────┘│
│                                                                    │
│ ⓘ Exports the rendered view, not raw data.                        │
│                               [ Cancel ]   [ Export image ]       │
└────────────────────────────────────────────────────────────────────┘
```

Notes:
- Preview is pixel-accurate to the exported file.
- Filename preview updates live below the pattern field.
- JPEG choice surfaces a warning banner "Lossy format — use PNG or TIFF for scientific imagery."

---

## W13 · Export · Video modal

**Region.** Modal, 840 px wide, two-column.

```
┌──────────── Export · Video ────────────×┐
│                                                                    │
│ ┌── Settings ────────────────┐  ┌── Preview ─────────────────────┐│
│ │ Scope                       │  │   [ tiled preview, frame 124 ]││
│ │ ( ) All  (•) Selected       │  │                                ││
│ │                             │  │                                ││
│ │ Frame range                  │  │                                ││
│ │ [──mini-map with brush──]    │  │                                ││
│ │ start [ 80 ]  end [ 3200 ]   │  │                                ││
│ │ 3120 frames · 01:44          │  │                                ││
│ │                             │  │                                ││
│ │ Output                       │  │                                ││
│ │ Format  [ MP4 (H.264) ▾ ]    │  │                                ││
│ │ FPS     [ 30 ▾ ]             │  │                                ││
│ │ Speed baked [ 1× ▾ ]          │  │                                ││
│ │ Layout  [ Tiled 2×2 ▾ ]      │  │                                ││
│ │                             │  │                                ││
│ │ Labels  (same set as image)  │  │                                ││
│ │                             │  │                                ││
│ │ Est. duration  01:44         │  │                                ││
│ │ Est. size      ~42 MB        │  │                                ││
│ └─────────────────────────────┘  └────────────────────────────────┘│
│                                                                    │
│ ⓘ Exports the rendered view, not raw data.                        │
│                               [ Cancel ]   [ Export video ]       │
└────────────────────────────────────────────────────────────────────┘
```

Progress state (same modal, replaces settings column):

```
│ ┌── Rendering ───────────────┐  ┌── Preview ────────────────────┐│
│ │                             │  │   [ live frame being rendered ]
│ │   frame 428 / 3120          │  │                                ││
│ │   [████████▒▒▒▒▒▒▒] 13.7%   │  │                                ││
│ │   elapsed 00:08 · eta 00:54 │  │                                ││
│ │                             │  │                                ││
│ │ [ Cancel ]                  │  │                                ││
│ └─────────────────────────────┘  └────────────────────────────────┘│
```

---

## W14 · Warning Center

**Region.** Modal, 560 px wide.

```
┌──────────── Warnings ────────────×┐
│ 4 active warnings                           [ clear dismissed ] │
│                                                                  │
│ ❶ Errors (1)                                                     │
│   ✖ file shape mismatch                                          │
│     recording_bad.h5 is 1024×768, stream is 1920×1080            │
│     [ Quarantine ]  [ Replace file ]                             │
│                                                                  │
│ ❷ Warnings (2)                                                   │
│   ⚠ dark exposure mismatch                                       │
│     Current 20 ms, only 40 ms dark available                     │
│     [ Use closest ]  [ Disable dark ]                            │
│                                                                  │
│   ⚠ export range long                                            │
│     4000 frames will render for ~2 min                           │
│     [ Continue ]  [ Narrow range ]                               │
│                                                                  │
│ ❸ Info (1)                                                       │
│   ⓘ ambiguous dark frame                                         │
│     Two 20 ms dark frames available. Using most recent.          │
│     [ Pick explicitly ]                                          │
└──────────────────────────────────────────────────────────────────┘
```

Notes:
- Accessible from the warning chip in the status bar (when any warning is active) and from the top-bar notifications icon.
- Dismissed items stay in history for the session; cleared by the top-right action.

---

## W15 · Narrow-window responsive layout

At width ≤ 1180 px:

```
┌────────────── top bar ───────────────┐
│ MantisAnalysis · Playback         ⋮ │
├──┬───────────────────────────────────┤
│M │ Stream header                     │
│R ├──┬────────────────────────────┬──┤
│  │  │                            │  │
│  │S │ Viewer (no inspector)     │I │
│  │o │                            │n │
│  │u │                            │s │
│  │r │                            │p │
│  │c │                            │. │
│  │e │                            │→ │
│  │s │                            │  │
│  │↓ │                            │  │
│  │  ├────────────────────────────┤  │
│  │  │ Timeline (compact)         │  │
│  ├──┴────────────────────────────┴──┤
│  │ Status bar                        │
└──┴───────────────────────────────────┘
```

- Sources panel collapses to a 44 px icon rail (↓ icon expands it as a slide-over).
- Inspector is hidden by default; triggered by selecting any view or via the top-right `inspector` chip.
- Timeline mini-map is hidden; a "show mini-map" link in the detail row restores it.
- Modals become full-viewport sheets with a close header.

---

*End of wireframes.*
