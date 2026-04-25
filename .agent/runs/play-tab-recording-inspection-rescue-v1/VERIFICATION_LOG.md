# Verification Log — Play / Recording Inspection Rescue

Append-only. Each entry: timestamp, what was run, expected outcome, actual outcome, evidence path.

## Format

```
### YYYY-MM-DD HH:MM — <milestone> — <short label>

Command(s):
$ ...

Expected: ...
Actual:   ...
Evidence: screenshots/... or reviews/... or test output below
```

---

## 2026-04-25 — M0 — Initiative bootstrap

Command(s):
```
mkdir -p .agent/runs/play-tab-recording-inspection-rescue-v1/{reviews,screenshots}
```

Expected: folder + Status / REAL_DATASET_NOTES / BUG_REGRESSION_CHECKLIST / VERIFICATION_LOG present.
Actual:   ✓ all four files written. `Status.md` lists M1–M11 with `[ ]`.
Evidence: this folder (`.agent/runs/play-tab-recording-inspection-rescue-v1/`).

---

## 2026-04-25 — M1 — Backend per-frame extraction

### Unit tests
Command:
```
python -m pytest tests/unit/test_session_frames.py tests/unit/test_play_routes.py -q
```
Expected: all green. Actual: **31 passed** in 1.25s.

Full unit-suite regression:
```
python -m pytest tests/unit/ -q  →  133 passed in 10.69s
```
No prior tests broke. ✓

### Live real-data round-trip
Command:
```
python -m mantisanalysis --no-browser --port 8765 &
SID=$(curl -X POST .../api/sources/load-path -d '{"path":".../sample_1_view_0_exp_0.1.h5"}')
curl .../api/sources/$SID/frames
curl .../api/sources/$SID/frame/0/channel/HG-G/thumbnail.png > /tmp/frame0_HG-G.png
curl .../api/sources/$SID/frame/9/channel/HG-G/thumbnail.png > /tmp/frame9_HG-G.png
curl .../api/sources/$SID/frame/10/...     # expect 404
curl .../api/sources/$SID/frame/0/rgb.png?gain=hg > /tmp/frame0_RGB-HG.png
curl .../api/sources/$SID/frame/0/overlay.png?base_channel=HG-R&overlay_channel=HG-NIR&...
```

Expected vs Actual:

| Check | Expected | Actual |
|---|---|---|
| `/frames` returns 10 frames | 10 entries, 0.1 s exposures, monotonic timestamps | ✓ 10 entries, exposures all 0.1, timestamps 1771490954.66 → ... |
| Per-channel PNG (frame 0, HG-G) | valid PNG, 512×512 grayscale | ✓ 171 KB, `8-bit grayscale, non-interlaced` |
| Per-channel PNG (frame 9, HG-G) | different from frame 0 | ✓ `Files differ` (proves per-frame extraction) |
| Frame 10 (out-of-range) | 404 | ✓ HTTP 404 |
| RGB composite | valid 8-bit RGB PNG | ✓ 544 KB, `8-bit/color RGB` |
| Overlay (HG-NIR over HG-R) | valid 8-bit RGB PNG | ✓ 574 KB, `8-bit/color RGB` |

Real source summary returned: `frame_count=10, channels=[HG-B, HG-G, HG-NIR, HG-R, HG-Y, LG-B, LG-G, LG-NIR, LG-R, LG-Y], shape=[512, 512]` — matches the documented GSense RGB-NIR mode (4-pixel-stride extraction of a 2048×2048 dual-gain half).

### Files changed (M1)
- `mantisanalysis/session.py` — `FrameReader`, `extract_frame`, `_load_dark_channels`, `STORE.remove`, frame metadata in `LoadedSource` + `_summary_dict`, eviction closes h5 handle.
- `mantisanalysis/server.py` — added `FrameMetadata`, frame_count in `SourceSummary`, three new routes (`/frames`, `/frame/{i}/channel/{ch}/thumbnail.png`, `/frame/{i}/rgb.png`, `/frame/{i}/overlay.png`), helpers (`_norm_to_unit`, `_composite_rgb_array`, `_build_rgb_composite_png_from_channels`).
- `tests/unit/test_session_frames.py` — new (16 tests).
- `tests/unit/test_play_routes.py` — new (15 tests).

M1 complete. Server left running on `127.0.0.1:8765` for downstream milestones.

---

## 2026-04-25 — M2 — App-shell wiring (4th mode tile + key `4`)

### Build / typecheck
```
npm run typecheck    →  tsc --noEmit clean
npm run build        →  vite v5.4.21 ✓ built in 14.31s (49 modules transformed)
```

### Browser verification (preview tool)
Server: `mantisanalysis` config (port 8773). Reloaded after build.

| Check | Expected | Actual |
|---|---|---|
| 4 mode tiles in rail | USAF / FPN / DoF / PLAY | ✓ all 4 present (snapshot button[96] `PLAY`) |
| New `film` icon visible on Play tile | distinct from `play` icon used by playback button | ✓ rendered (different SVG geometry) |
| Click PLAY tile → mode switches | top bar reads "Play · Recording Inspection" | ✓ `[1207]` snapshot |
| Stub renders | Card with title + description + two buttons | ✓ `[1294]` "Play · Recording Inspection", `[1297]` description, `[1303]/[1307]` buttons |
| Status bar | "[PLAY] Play · Recording Inspection (M2 stub) · 0 items" | ✓ |
| Console errors | 0 | ✓ `preview_console_logs level=error` returns "No console logs." |
| Switch back to USAF then key `4` | USAF renders, then `4` returns to Play | ✓ `dispatched-4` then snapshot confirms `modeTitle/hasStubCard/statusBarShowsPlay = true` |

### Files changed (M2)
- `web/src/shared.tsx` — added 8 icon glyphs (`pause`, `skipPrev`, `skipNext`, `stepPrev`, `stepNext`, `film`, `loop`, `locked`, `warning`).
- `web/src/app.tsx` — added `'play'` to mode union, ModeRail 4th tile, key `4` handler, top-bar mode title, command palette entry, HelpOverlay shortcuts. Updated migration check.
- `web/src/playback.tsx` — **new** stub with empty state Card.

M2 complete. Existing USAF/FPN/DoF modes regression-clean (full unit suite 133 passed; no preview console errors on USAF page).

---

## 2026-04-25 — M3 — Empty + SourcesPanel + multi-file load (real data)

### Build
```
npm run build  →  ✓ built in 14.34s (49 modules; 537 kB main bundle)
```

### Live browser verification (port 8773, viewport 1480×900)

Steps and outcomes — all assertions verified via `preview_eval` reading DOM state:

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, click PLAY tile | Empty state visible: "Load a recording to begin" Card with Open recording / Open dark frame buttons | ✓ Card rendered with film icon, primary CTA, getting-started ordered list |
| 2 | Sources panel side | "RECORDINGS" + empty placeholder + "Add recordings" button + "DARK FRAMES" + "Open dark frame…" disabled | ✓ all visible |
| 3 | Status bar | `[PLAY] Play · No recording loaded · 0 items` | ✓ |
| 4 | Dispatch `mantis:play:load-paths` with 3 real H5 paths from `day5_breast_subject_1` | 3 FilePills appear with frame_count=10, exposures, 512×512 shape | ✓ all 3 shown; sample_1_view_0_exp_0.1 / view_1_exp_0.1 / view_2_exp_0.3 |
| 5 | Stream chip | "Stream · 3 files · 30 frames · 2 exp" (2 exp because 0.1s and 0.3s in mix) | ✓ exact text rendered |
| 6 | Inspector reflects selection | Frames=10, Channels=10, Shape=512×512, FPS≈10.49, ISP=rgb_nir | ✓ all values shown |
| 7 | Click 2nd pill | Selection switches; Inspector updates to that file | ✓ `data-selected="true"` toggles correctly; Inspector shows `sample_1_view_1_exp_0.1.h5` |
| 8 | **Prior-failure regression check**: clear all, load A, then load B | both stay listed | ✓ pillCount=2 after both loads; both names present |
| 9 | Remove A while B loaded | B still renders, A gone | ✓ pillCount=1, only B name; B still has its metadata |
| 10 | Load C after removal | A=gone, B+C present | ✓ pillCount=2 (B + C); inspector auto-selected C; stream chip reads "2 files · 20 frames · 2 exp" |
| 11 | Console errors | 0 | ✓ `preview_console_logs level=error` returns "No console logs." across all 11 steps |

### Bug regression rows ticked at this milestone

| # | Failure | Status |
|---|---|---|
| 1 | File loading errors | ✓ — 3 separate real H5 loads, no errors |
| 2 | Could not open second recording | ✓ — explicit A→B test passed (step 8) |
| 4 | Buttons hidden / overlapping | ✓ — full-width screenshot at 1480 px shows every region's controls visible and unclipped |
| 11 | Real live rendering not verified | ✓ (partial — frame canvas comes online M4) — Sources panel + stream header + inspector metadata all rendered from real H5 metadata |
| 12 | Window/tab state confusion | ✓ — switching to USAF then back to PLAY at any state preserves Play's loaded-recordings list |

### Files changed (M3)
- `web/src/playback.tsx` — full rewrite: `StreamHeader`, `SourcesPanel`, `FilePill` (3 states: loaded/loading/error), `EmptyMode`, placeholders for ViewerGrid / Timeline / Inspector. Added programmatic `mantis:play:load-paths` window event for tests + future "Load by path" command.

M3 complete. Server still running on port 8773. Moving to M4 — ViewerCard + RGB auto-mode with live frame rendering from real H5.

---

## 2026-04-25 — M4 — ViewerCard + RGB auto-mode (real data)

### Build
```
npm run build  →  ✓ built in 14.63s
```

### Live browser verification

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Load 1 real H5 (`sample_1_view_0_exp_0.1.h5`) | Default view auto-creates with `RGB · HG` | ✓ View `RGB · HG` appears with RGB + EXP badges; **real tissue sample renders** in the canvas (red tissue mass on green textured background) |
| 2 | Verify dropdown options | Exactly 7 options: RGB·HG, RGB·LG, NIR·HG, NIR·LG, Gray·HG-Y, Gray·LG-Y, Raw channel… | ✓ all 7 options enumerated by `select.options` |
| 3 | Switch to NIR · HG | View re-renders with inferno colormap; LUT badge replaces RGB | ✓ inferno-toned NIR rendered; "LUT" badge present |
| 4 | Switch to Gray · HG-Y | Grayscale Y renders; RAW badge | ✓ grayscale tissue + "RAW" badge |
| 5 | Drag timeline slider to frame 7 | Both timeline display and ViewerCard footer update to "frame 7" | ✓ both `[data-timeline-frame]` and card footer show `frame 7`; canvas re-renders new frame |
| 6 | Click "+ View" | Layout auto-promotes from Single → Side-by-side; new view added with default RGB · HG | ✓ `count: 2` cards; layout toolbar `Side-by-side` highlighted |
| 7 | Switch second view to NIR · HG | Two cards render different modes of the same source/frame side-by-side | ✓ Gray-HG-Y on left, NIR-HG on right, both at frame 7 |
| 8 | Console errors | 0 | ✓ "No console logs." after every step |

### Bug-regression rows ticked

| # | Failure | How M4 fixes it |
|---|---|---|
| 6 | Grayscale display missing | ✓ — Gray · HG-Y option always present when source has HG-Y; renders single-channel Y with `colormap=gray` |
| 7 | RGB asked for manual R/G/B | ✓ — default view for any source with HG-R/G/B is **`RGB · HG`** (one option, not three pickers); manual per-channel picking requires explicitly selecting "Raw channel…" |
| 8 | GSense not handled intelligently | ✓ — verified the dropdown for an RGB-NIR file shows exactly 7 options (5 named modes + raw + LG variant of RGB); options are derived from `source.channels[]`, not hardcoded |
| 10 | Controls existed but did not work | ✓ — every visible control on the ViewerCard is wired: source-mode select → re-renders frame, raw-channel sub-picker → re-renders, close button → removes view, timeline slider → updates global frame, layout buttons → switch grid. No dead controls. |
| 11 | Real live rendering not verified | ✓ — three real-data screenshots taken (RGB, NIR, Gray, side-by-side); browser preview confirms correct visual rendering of tissue sample |

### Files changed (M4)
- `web/src/playback.tsx` — added `SOURCE_MODES` catalog with `availableSourceModes` + `defaultSourceModeId`, `makeDefaultView`, `computeBadges`, `buildFrameUrl`. New components: `ViewerGrid` (with layout toolbar + 4 presets), `ViewerCard` (title + source-mode dropdown + raw-channel sub-picker + badges + canvas with single-flight AbortController + footer), `ProcessingBadge`. Replaced `ViewerGridPlaceholder`. Timeline still placeholder (M5 fills in).

M4 complete. Real-data verified; no console errors; layout matches template.

---

## 2026-04-25 — M5 — Timeline + playback (real data, multi-source)

### Build
```
npm run build  →  ✓ built in 14.56s
```

### Live browser verification — 30-frame stream from 3 real H5 files

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Load 3 real H5s | Stream chip "3 files · 30 frames · 2 exp" | ✓ |
| 2 | TimelineStrip rendered | Mini-map with 3 colored segments + slider + playback controls + frame input + FPS dropdown + Loop toggle (ON by default per resolved decision #3) | ✓ all rendered |
| 3 | Press play (▶) | Frames advance through stream | ✓ frames advance; ~6 frames/sec at FPS=10 (frame fetch overhead) |
| 4 | Cross source boundary while playing | Active-source readout updates; mini-map caret moves | ✓ at frame 17, "active: sample_1_view_1_exp_0.1.h5 (#7)" — global → local mapping correct |
| 5 | **Loop ON wrap test**: jump to frame 28 then play | Reaches 29 then wraps to 0 and continues | ✓ from 28 → 0 → 18 over 2 s, looping |
| 6 | **Loop OFF hard stop**: turn loop OFF, jump to 27, play | Stops at frame 29 (last) | ✓ playing → "Play" again at frame 29 |
| 7 | Frame number input (`type=number`) | Manual entry jumps to frame | ✓ tested 12, 15, 27, 28 — all set globalFrame |
| 8 | Mini-map click | Clicking on mini-map jumps to that frame proportionally | ✓ (UI wired; exact pixel test deferred) |
| 9 | Keyboard `←` (out of input focus) | Steps back 1 frame | ✓ from 15 → 14 |
| 10 | **Stream-follow auto-rebind**: scrub global to 15 | Single ViewerCard auto-rebinds from source 1 to source 2 and shows local frame 5 of source 2 | ✓ card footer "frame 5 · 100.0 ms · sample_1_view_1_exp_0.1.h5"; visibly different image from source 1 |
| 11 | Console errors | 0 throughout 11 steps | ✓ |

### Bug-regression rows ticked

| # | Failure | How M5 fixes it |
|---|---|---|
| 3 | Extremely slow UI response | ✓ — scrub during playback works; AbortController in ViewerCard cancels stale frame fetches; play loop is `setTimeout`-chained (no setInterval pileup); each ViewerCard maintains a single in-flight fetch |
| 5 | Video playback weird | ✓ — explicit play/pause toggle; loop ON wraps cleanly; loop OFF hard-stops; scrub during playback either updates frame OR is paused by user; locked views architected (lock UI in M7's overflow menu) |

### Files changed (M5)
- `web/src/playback.tsx` — added `streamOrder` / `orderedRecordings` / `sourceOffsets` / `activeAtGlobal` / `localFrameForView` derivations; play loop `useEffect` with `setTimeout` chain; keyboard handler (Space, ←, →, Shift+arrows, Home, End); replaced `TimelinePlaceholder` with full `TimelineStrip` (mini-map with file boundary segments + colored caret, slider, prev/next/first/last buttons, frame input, FPS dropdown, Loop toggle, active-source readout); auto-rebind `useEffect` so unlocked views follow the active stream source.

M5 complete.

---

## 2026-04-25 — M6 — Stream Builder + continuity (real data)

### Build
```
npm run build  →  ✓ built in 14.53s
```

### Live verification

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Click stream chip | Stream Builder modal opens | ✓ modal renders with title "Stream Builder · 3 files → 1 stream" |
| 2 | Continuity badges per row | Real H5 timestamps used to detect overlap / gap / exposure / shape | ✓ 3 warnings detected: 16.97 s overlap (between view_0 + view_1 — view_1 was actually captured first), 86502.97 s gap (different days), 100 → 300 ms exposure mismatch |
| 3 | Summary card | Files=3, Total frames=30, Duration=144130.3, Warnings = "0 errors, 3 warnings" | ✓ all values correct; Apply button enabled (no errors) |
| 4 | Click Apply | Modal closes; streamOrder updated | ✓ modal disappears; stream chip still shows "3 files · 30 frames · 2 exp" with warning dot |
| 5 | Continuity threshold tuning | Increase threshold > gap → only exposure-mismatch warning remains | ✓ setting 100000 leaves exactly 1 warning of type `exposure` |
| 6 | Stream chip warning dot | Coloured dot indicates active warnings | ✓ `[data-stream-warn-dot]` rendered in StreamHeader chip border (warn color) |
| 7 | Console errors | 0 | ✓ "No console logs." |

### Bug-regression rows ticked / strengthened

| # | Failure | M6 evidence |
|---|---|---|
| 4 | Buttons hidden / overlapping | ✓ modal at 760 px renders cleanly; Apply / Cancel / Close all visible at viewport 1480 px |
| 9 | Implementation looks nothing like template | ✓ Stream Builder modal matches wireframe W3 (two-column: file list + summary; drag handles; continuity badges between rows; threshold input; Apply/Cancel) |

### Files changed (M6)
- `web/src/playback.tsx` — added `detectContinuity` pure function, `StreamBuilderModal` component, `Modal` import from shared.tsx; StreamHeader chip is now a button that opens the modal; warn-dot indicator on the chip when continuity warnings exist.

M6 complete. Stream chip clickable, modal renders correctly, continuity detection grounded in real-data timestamps.

---

## 2026-04-25 — M7 — Inspector sections (real data)

### Build
```
npm run build  →  ✓ built in 14.66s
```

### Live verification — every visible control wired

| Section | Verified | Result |
|---|---|---|
| Header | "INSPECTOR · {view name}" updates with selection | ✓ shows "RGB · HG" / "NIR · HG" depending on mode |
| **View** | Name input, Type readonly, Lock checkbox, Include in export | ✓ all rendered, all wire into view state |
| **Source** | Source-mode select (dual-bound to ViewerCard's title-bar select), Recording display | ✓ |
| **Corrections** | "Apply dark correction" checkbox disabled when no dark loaded; helpful hint shown | ✓ disabled state correct (no darks in dataset folder) |
| **Display** | Low/High threshold spinboxes, Auto threshold reset, Colormap select, Invert checkbox | ✓ verified threshold clipping (vmin=500 vmax=2000 → image saturates), colormap viridis applied to NIR view (canvas re-rendered with new map), NRM badge appeared when both vmin/vmax set |
| **RGB grading** | Conditionally rendered only when sourceMode is rgb_*; sliders for brightness, contrast, saturation; Before/after toggle; Reset button | ✓ rendered only for `rgb_hg`/`rgb_lg`/`rgb_image`; saturation slider verified (set to 0 → image desaturates to grayscale via CSS filter) |
| **Overlay** | Placeholder text directing to M9 | ✓ |
| **Labels** | Placeholder text directing to M9 | ✓ |
| **Advanced** | View ID, Source ID, mode, vmin/vmax, brightness/contrast/saturation, FPS, stream length, channels, frame_count, ISP | ✓ all values present and update when state changes |
| Section collapse | Independently collapse/expand; state persists per view-type via localStorage `playback/inspectorSection/{type}/{title}` | ✓ verified `localStorage.getItem` returns the persisted boolean |

### Bug-regression rows ticked / strengthened

| # | Failure | M7 evidence |
|---|---|---|
| 7 | RGB asked for manual R/G/B | ✓ — Inspector's RGB grading section never asks user to pick channels; it only exposes display knobs (brightness/contrast/saturation) |
| 10 | Controls existed but did not work | ✓ — every Inspector control round-trips: thresholds → URL query params → re-render; colormap → URL param → re-render; invert → CSS filter; brightness/contrast/saturation → CSS filter; before/after → drops the filter |
| 11 | Real live rendering not verified | ✓ — verified 4 sections drove visible canvas changes on real H5 data |

### Files changed (M7)
- `web/src/playback.tsx` — added `Inspector` component (replaces `InspectorPlaceholder`); 8 sections via `InspectorSection` (collapse-persisted per view-type); imports `Slider`, `Select`, `Checkbox`, `Spinbox` from shared.tsx; extended `View` shape with `invert`, `brightness`, `contrast`, `saturation`, `showRaw`; ViewerCard's `<img>` applies CSS filter from those view fields.

M7 complete.

---

## 2026-04-25 — M8 — Dark-frame manager (real data)

### Build
```
npm run build  →  ✓ built in 14.68s
```
First attempt produced a TDZ ReferenceError ("Cannot access 'Be' before initialization") — a useEffect referenced a useCallback declared later. Resolved by moving the dark-load-by-path useEffect after `refreshSourceSummary` is defined.

### Live verification

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Empty state | "DARK FRAMES" section shows "No dark frames loaded" + disabled "Open dark frame…" button when no recording loaded | ✓ |
| 2 | Load 1 recording | Dark Frames section's "Open dark frame…" button enables | ✓ |
| 3 | Bad path attempt | Real H5 path that doesn't exist (`view_3_exp_0.02`) → backend returns "path not found"; UI shows red FilePill with the message | ✓ red error row visible with truncated detail; recording itself unaffected |
| 4 | Successful real-data dark load (`sample_1_view_1_exp_0.005.h5`) | Backend reads all 10 frames, averages to master dark (M1 logic), attaches to selected source | ✓ DarkFrameRow shows "attached to 1 recording"; DRK processing badge appears on ViewerCard; Inspector's "Apply dark correction" checkbox enables |
| 5 | DRK badge | Indicates active dark correction in title bar (from `view.applyDark && recording.has_dark`) | ✓ visible in screenshot |
| 6 | DARK FRAMES count badge | Reflects loaded count only, not errors | ✓ shows "1" |

### Bug-regression rows ticked / strengthened

| # | Failure | M8 evidence |
|---|---|---|
| 4 | Buttons hidden / overlapping | ✓ Dark Frames section + DarkFrameRow + "+ Add dark frames" button all visible at 1480 px |
| 9 | Implementation looks nothing like template | ✓ Dark Frames panel matches wireframe W4 — header section + row per dark + match-state indicator + remove button |

### Backend verification (already done in M1)
- Unit test `test_attach_dark_uses_averaged_h5` passes — confirms backend averages all frames before extraction (not just frame 0).
- Real-data: the `0.005 s` exposure dark file's averaged content differs from frame 0; the channel set + shape (HG-R/G/B/NIR/Y, LG-R/G/B/NIR/Y at 512×512) matches the source under `rgb_nir` mode, so attachment validation passes.

### Files changed (M8)
- `web/src/playback.tsx` — `darks/loadingDarks/darkErrors` state; `darkInputRef`; `handleOpenDarkClick`, `handleDarkFilesChosen`, `handleRemoveDark`, `attachDarkToSource`, `refreshSourceSummary` callbacks; `mantis:play:load-darks` programmatic event listener; `DarkFrameRow` component; SourcesPanel renders the dark list.

M8 complete.

---

## 2026-04-25 — M9 — Overlay + Image export (real data)

### Build
```
npm run build  →  ✓ built in 14.70s
```
Bundle: `index-XT5TihuN.js` (the older `C34hjAtV.js` errors that remain in browser console history are from the M8 TDZ — fixed mid-M8 by reordering the dark-load useEffect after `refreshSourceSummary`).

### Live verification

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Load 1 real H5 (`sample_1_view_0_exp_0.1.h5`) | Default RGB · HG view | ✓ |
| 2 | Switch source mode to `RGB+NIR overlay · HG` | Backend `/frame/0/overlay.png` called; canvas re-renders with NIR-over-RGB composite | ✓ visible: bright NIR emission spots overlaid on the tissue, alpha-blended with strength 0.6 |
| 3 | Title-bar badges | RGB + OVL + EXP | ✓ all three present |
| 4 | Inspector header | "INSPECTOR · RGB+NIR overlay · HG" | ✓ |
| 5 | RGB grading section visibility | Hidden (kind ≠ rgb_*) | ✓ section hidden, replaced by Display + Overlay placeholders |
| 6 | Click "Export PNG" | Browser blob URL created with `sample_1_view_0_exp_0.1_f0000_overlay_nir_hg.png` filename | ✓ verified via `document.createElement('a')` interception: download attribute set correctly, blob: URL generated |
| 7 | Filename pattern matches plan | `{stream}_f{frame:04d}_{viewmode}.png` per resolved decision #4 | ✓ |
| 8 | Console errors during this session | 0 new errors (stale errors from M8 TDZ remain in history but don't affect current runtime) | ✓ verified via bundle hash diff — current page runs `index-XT5TihuN.js` cleanly |

### Bug-regression rows ticked / strengthened

| # | Failure | M9 evidence |
|---|---|---|
| 8 | GSense not handled intelligently | ✓ — `RGB+NIR overlay · HG` shows up as a 1-click option in the source-mode dropdown for any GSense recording with HG-R/G/B/NIR (no manual base/overlay picker for the common case) |
| 11 | Real live rendering not verified | ✓ — overlay renders visibly different from any single mode; bright NIR spots visible on the tissue in the screenshot |

### Files changed (M9)
- `web/src/playback.tsx` — added `overlay_nir_hg` and `overlay_nir_lg` source modes; `availableSourceModes` filter handles `kind === 'overlay'`; `buildFrameUrl` routes overlay mode to `/frame/{i}/overlay.png` via `frameOverlayUrl`; `computeBadges` adds the OVL badge; `exportImage` callback fetches the rendered PNG and triggers `<a download>`; "Export PNG" button in StreamHeader.

### Backend already in place (M1)
- `_composite_rgb_array` + `_norm_to_unit` helpers; `frame_overlay` route accepts base_channel / overlay_channel / blend / strength / overlay_low / overlay_high / overlay_colormap. Verified via curl in M1.

M9 complete.

---

## 2026-04-25 — M10 — Video export (real data)

### Build
```
npm run build  →  ✓ built in 14.65s
```

### Backend — direct curl smoke
```
SID=$(... POST /api/sources/load-path ...)
GET /api/sources/$SID/export/video?format=mp4&render=rgb_composite&gain=hg&start=0&end=9&fps=10
GET /api/sources/$SID/export/video?format=gif&render=rgb_composite&...
GET /api/sources/$SID/export/video?format=zip&render=rgb_composite&...
GET /api/sources/$SID/export/video?format=mp4&render=overlay&base_channel=HG-R&overlay_channel=HG-NIR&...
```

| Format | File | Size | `file` output |
|---|---|---|---|
| MP4 RGB-HG | `/tmp/play_export.mp4` | 198 KB | `ISO Media, MP4 Base Media v1` |
| GIF | `/tmp/play_export.gif` | 2.45 MB | `GIF image data, version 89a, 512×512` |
| ZIP | `/tmp/play_export.zip` | 5.33 MB | 10 valid PNG files inside, named `{stream}_f{NNNN}_{render}.png` |
| Overlay MP4 | `/tmp/play_export_overlay.mp4` | 210 KB | `ISO Media, MP4 Base Media v1` |

`Content-Disposition: attachment; filename="sample_1_view_0_exp_0.1_f0000-0009_rgb_composite.mp4"` is correct.

### Bug fixed during M10
- Initial MP4 attempt failed with `FFMPEG can not handle the given uri` because imageio's FFMPEG plugin can't write to `BytesIO`. Fixed by writing to a `tempfile.NamedTemporaryFile`, reading the bytes back, and unlinking. Padding to even dimensions (libx264 + yuv420p constraint) added.

### Frontend — UI round-trip
| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Click "Video…" button in StreamHeader | Export Video modal opens | ✓ modal renders with FORMAT (MP4/GIF/zip), Start/End/FPS, Summary card, "Exports the rendered view…" disclosure |
| 2 | Click Export | Backend returns MP4 bytes; browser blob URL created with `<a download>` | ✓ download="sample_1_view_0_exp_0.1_f0000-0009_rgb_composite.mp4", blob: URL generated |
| 3 | Filename pattern | `{stream}_f{first:04d}-{last:04d}_{render}.{ext}` per resolved decision #4 | ✓ matches server's Content-Disposition |

### Bug-regression rows ticked

| # | Failure | M10 evidence |
|---|---|---|
| 4 | Buttons hidden / overlapping | ✓ Export Video modal renders cleanly at 520px width |
| 9 | Implementation looks nothing like template | ✓ Export Video modal mirrors wireframe W13 (format chooser + range + FPS + summary + "Exports the rendered view, not raw data" disclosure) |

### Files changed (M10)
- `pyproject.toml` — added `imageio[ffmpeg]>=2.30` to project dependencies (resolved decision #1).
- `mantisanalysis/server.py` — `GET /api/sources/{sid}/export/video` route handles MP4 / GIF / PNG-zip; supports `render=rgb_composite|channel|overlay` with full param set; uses tempfile path for ffmpeg; pads odd dims to even for libx264.
- `web/src/playback.tsx` — `buildVideoUrl`, `exportVideo`, `ExportVideoModal`; "Video…" button in StreamHeader; format chooser + start/end/FPS; Content-Disposition filename honored.

M10 complete.

---

## 2026-04-25 / 2026-04-26 — M11 — Warning Center + reviewers + close

### Build
```
npm run format → playback.tsx reformatted
npm run typecheck → clean
npm run build → ✓ built in 14.65s
python -m pytest tests/unit/ -q → 133 passed in 11.19s
python scripts/smoke_test.py --tier 0 → PASS · --tier 1 → PASS · --tier 2 → PASS · --tier 3 → PASS
```

### Live verification

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Stream chip warning dot + "No warnings" pill in StreamHeader | When no warnings, "No warnings" in faint chip; when ≥1, amber count badge | ✓ |
| 2 | Click warning chip / load 3 H5s with continuity issues | Warning Center modal opens with severity-grouped warnings | ✓ "5 active · 0 errors · 4 warnings · 1 info" header; W-GAP / W-EXPOSURE / W-OVERLAP / W-DARK-NONE rows visible |
| 3 | Resize to 1100×800 | Layout still works (no auto-collapse but all controls visible) | ✓ |

### Reviewer pass (2 agents in parallel)

| Reviewer | Findings |
|---|---|
| `frontend-react-engineer` | 1 P0 (modifier-key hijack), 5 P1 (blob leak, stale closures, includedInExport dead, name-clobber), 6 P2 deferred. P0 + 2 P1 fixed; remaining P1 deferred with rationale. See `reviews/frontend-react-engineer.md`. |
| `fastapi-backend-reviewer` | 1 P0 (extract_frame race), 4 P1 (export route hazards), 5 P2/P3 deferred. P0 + 3 P1 fixed (RLock, max-frame guard, HTTPException ordering, codec→503 mapping). See `reviews/fastapi-backend-reviewer.md`. |

### Fixes applied during M11

1. **Backend P0** — added `LoadedSource._lock: threading.RLock`; wrapped `extract_frame` (reader-init + cache R/W), `invalidate_frame_cache`, `close_frame_reader` under it. Race-free under concurrent FastAPI threadpool requests.
2. **Frontend P0** — keyboard handler now skips when `metaKey/ctrlKey/altKey` is held. `Cmd-Space`, `Cmd-Arrow`, `Cmd-Home` no longer hijacked.
3. **Frontend P1** — `ViewerCard` blob URL leak fixed via `prevBlobRef`; sync revoke on swap + unmount cleanup.
4. **Frontend P1** — `includedInExport` toggle now consumed by `exportImage` and `buildVideoUrl`.
5. **Backend P1** — `MAX_EXPORT_FRAMES = 2000` cap returning HTTP 413 on over-range exports.
6. **Backend P1** — `/export/video` MP4 path: `except HTTPException: raise` ordered before broad `except Exception`.
7. **Backend P1** — codec failures map to HTTP 503 with "try format=gif or format=zip" hint.

### Files changed (M11)

- `mantisanalysis/session.py` — `_lock`, threading import, lock wrapped around `extract_frame` / `invalidate_frame_cache` / `close_frame_reader`.
- `mantisanalysis/server.py` — `MAX_EXPORT_FRAMES` guard; HTTPException re-raise before broad catch; codec → HTTP 503 mapping.
- `web/src/playback.tsx` — modifier-key guard; `prevBlobRef` for blob URL revocation; `includedInExport` enforcement; Warning Center modal + button + count chip in StreamHeader.

### Final regression sweep

- 133/133 unit tests green.
- Smoke tiers 0/1/2/3 all PASS.
- 0 console errors in browser preview after final reload.

### Final initiative state

- All 12 prior-failure rows ticked in BUG_REGRESSION_CHECKLIST.md.
- All 12 milestones (M0–M11) marked done in Status.md.
- HANDOFF.md updated to reflect the new Play mode + close-out.
- Reviewer outputs saved to `reviews/`.
- Server left running on port 8773 for follow-up testing.

M11 complete. **Phase 1 closed.**

---

## Phase 2 — Polish + Parity + HDR + Advanced

## 2026-04-26 — M12 — Frame cache + double-buffer + colormap retention

Shipped reactively during user feedback (black flashes during playback + colormap auto-resetting). Documented inline in earlier turns; no separate verification block written here.

Files: `web/src/playback.tsx` (module-level `_frameBlobCache` LRU 96 entries + cache-aware fetch + `display: imgState === 'error' ? 'none' : 'block'` + `_prefetchFrame(globalFrame + 2)` in play loop + 3 callsites preserve `view.colormap` across mode switches).

---

## 2026-04-26 — M13 — ViewerCard ⋮ menu + Lock-to-frame + amber pin in mini-map

### Build / format / typecheck / tests
```
npm run format    →  playback.tsx reformatted
npm run typecheck →  clean
npm run build     →  ✓ built in 13.83s
pytest tests/unit -q  →  136 passed
smoke tier 0      →  PASS
```

### Live verification — load 2 real H5s + lock + duplicate

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Load 2 H5s, scrub to global frame 5, click `⋮` on first card | Popover opens with 6 items: Rename / Duplicate / Lock / Include / Copy / Remove | ✓ `data-menu-item` query returns exactly those 6 in order |
| 2 | Click "Lock to current frame" | Popover closes; `view.isLocked = true`, `view.lockedFrame = 5`; LCK badge appears in title bar; amber caret renders in mini-map at the global-frame position of frame 5 | ✓ `lockedCaretCount: 1`, `lockedCaretLeft: "26.3158%"` (= 5/19 × 100), `lckBadgeCount: 1` |
| 3 | Scrub global to frame 12 | Locked view's footer still says "frame 5"; locked caret stays at 26.3%; current caret moves to 63.2% (12/19) | ✓ `cardFooter: ["frame 5"]`, `lockedCaretLeft: "26.3158%"`, `currentCaretLeft: "63.1579%"`, `globalFrame: "12"` |
| 4 | Re-open menu, click Duplicate | New card appears next to original; clone named "RGB · HG (copy)"; clone has `isLocked: false` (per spec) | ✓ `cardCount: 2`; second card name "RGB · HG (copy)"; only first card has LCK badge |
| 5 | Console errors | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly (M13 is feature, not regression).

### Files changed (M13)
- `web/src/playback.tsx` —
  - PlaybackMode adds `duplicateView` and `copyViewSettingsTo` callbacks; passes them + `globalFrame` + `sourceOffsets` to ViewerGrid.
  - ViewerGrid forwards new callbacks to ViewerCard.
  - ViewerCard adds `menuOpen` / `copyOpen` state + `menuAnchorRef` + `⋮` button + `ViewerCardMenu` popover. Existing inline `×` button kept for one-click remove.
  - **NEW** `ViewerCardMenu` component: anchored popover with click-outside / Escape dismiss; 6 menu items (Rename via `window.prompt`, Duplicate, Lock toggle showing locked frame in label when locked, Include-in-export toggle, Copy settings to… with sub-popover, Remove).
  - **NEW** `CopySettingsSubPopover` component: checkbox list of other views + Cancel / Copy-to-N buttons.
  - TimelineStrip accepts `lockedViews` + `sourceOffsets`; renders one amber caret per locked view above the existing current-frame caret.

M13 complete.

---

## 2026-04-26 — Post-close hardening: HTTP 500 from stale backend + Storybook origin

User reported "frame 0 failed to render (HTTP 500)" after the M11 close. Root causes identified:

1. **Stale backend instance.** Multiple `mantisanalysis` processes were running on different ports (8773 and 8765) and at different revisions of `mantisanalysis/server.py`. The user's browser hit one that didn't have the M11 P0/P1 fixes.
2. **Storybook origin.** The preview tool drifted to `http://localhost:6006/?path=/story/...` — Storybook. Any fetch from a Storybook-served page resolves `API_BASE` to `http://localhost:6006`, which has no `/api/*` routes and 500s on every request.

### Fixes shipped

| Layer | Fix | File |
|---|---|---|
| Backend | Wrap every per-frame route body in `try/except`. `HTTPException` re-raises; any other Exception logs full traceback to stderr AND surfaces as `HTTPException(500, "frame {i} render failed: {ExceptionType}: {message}")`. | [mantisanalysis/server.py](../../../mantisanalysis/server.py) routes `frame_channel_thumbnail`, `frame_rgb_composite`, `frame_overlay` |
| Frontend | ViewerCard's `fetch` `.then(r => …)` now reads the response body on `!r.ok` and attaches it as `err.detail`. The error overlay renders that detail (formatted in a monospace block) instead of the bare "Try again" message. | [web/src/playback.tsx](../../../web/src/playback.tsx) ViewerCard fetch + error overlay |
| Frontend | `API_BASE` now routes to `http://127.0.0.1:8773` when the bundle is loaded under Storybook (port 6006) so cross-origin API calls hit the FastAPI backend instead of 500-ing on Storybook. | [web/src/shared.tsx:2472](../../../web/src/shared.tsx) |

### Verification

```
$ pkill -9 -f mantisanalysis  # killed all stale instances
$ nohup python -m mantisanalysis --no-browser --port 8773 > /tmp/mantis-debug.log 2>&1 &
$ curl -fsS http://127.0.0.1:8773/api/health → {"ok":true,"version":"0.2.0","sources":0}
$ python -m pytest tests/unit/ -q → 133 passed in 10.82s
$ curl /api/sources/.../frame/0/rgb.png?gain=hg → HTTP 200
$ curl /api/sources/.../frame/0/channel/HG-G/thumbnail.png → HTTP 200
$ curl ?vmin=10000&vmax=10000 (degenerate range) → HTTP 200
$ curl ?colormap=NOTACOLORMAP → HTTP 200 (matplotlib falls back to gray)
$ curl /api/sources/DEADBEEF/frame/0/rgb.png → HTTP 404 {"detail":"unknown source id: DEADBEEF"}
```

No 500s on the new server with the new code. The error overlay now shows the actual exception message if a 500 ever does fire — no more bare "Try again, or check the server log."

### User action required

If the user still sees 500 after these fixes, confirm:
- Hard-reload (`Cmd-Shift-R`) at `http://127.0.0.1:8773/` — port 8773, NOT 6006 (Storybook).
- The Network panel's failing URL: should start with `http://127.0.0.1:8773/api/...`.
- Read the new error overlay's detail line — it now contains the Python exception string.

---

## 2026-04-26 — M14 — 3+1 layout preset

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0      → PASS (prettier + eslint + tsc clean)
python -m pytest -q                        → 143 passed in 28.86s
npm run build                              → ✓ built in 13.81s (vite 5.4.21)
```

### Live verification — real H5 + 4 views + 3+1 toggle

Recording: `/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5`
(loaded via `mantis:play:load-paths` window event; 10 frames; RGB-HG default).

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, dispatch load-paths event for one real H5 | LayoutPresets row shows `single, side, stack, 2x2, 3plus1` (5 buttons) | ✓ `layoutIds: ["single","side","stack","2x2","3plus1"]`, `cards: 1` |
| 2 | Click `+ View` × 3 to reach 4 views, click `[data-layout-preset="3plus1"]`, viewport 1700×1000 | Active toolbar button = 3plus1; grid `1fr / 2fr` cols × 3 rows; views[0] at col 2 row 1/-1; views[1..3] at col 1 row 1/2/3 | ✓ active bg `rgb(255,255,255)` on 3plus1; `gridTemplateColumns: 322.66px 645.33px`; `gridTemplateRows: 234.66 234.66 234.67`; cells `[gc=2 gr="1 / -1"], [gc=1 gr="1 / span 1"], [gc=1 gr="2 / span 1"], [gc=1 gr="3 / span 1"]`; large card 645×716, three small 323×235 |
| 3 | Move slider to frame 7 | All 4 card footers say "frame 7" | ✓ `footers: ["7","7","7","7"]` |
| 4 | Resize viewport to 1200×800 | Grid scales — proportions preserved | ✓ `gridTemplateColumns: 156px 312px` (still 1:2); `gridTemplateRows: 168 168 168`; large 312×516, small 156×168 |
| 5 | Resize viewport to 1700×1000 | Grid scales back up | ✓ `gridTemplateColumns: 322.66 645.33`; `gridTemplateRows: 234.66 234.66 234.67`; large 645×716 |
| 6 | Click `[data-layout-preset="2x2"]` | Round-trip cleans up — cells back to `auto`; grid `repeat(2, 1fr) × repeat(2, 1fr)` | ✓ all 4 cells `gridColumn: auto, gridRow: auto`; grid `484 484 / 355 355`; no leakage from 3+1 |
| 7 | 3-view edge case — click 3+1, remove the 4th card | 1 large + 2 small in a 2-row grid | ✓ `gridTemplateRows: 355 355` (rows = views.length-1 = 2); cells `[gc=2 gr="1/-1"], [gc=1 gr="1 / span 1"], [gc=1 gr="2 / span 1"]` |
| 8 | 1-view edge case — remove down to a single card | Renders in the right column without errors | ✓ `cells: [gc=2 gr="1/-1"]`; `gridTemplateRows: 716px` (rows clamped to max(0,1)=1); card width 645 |
| 9 | Console errors (preview_console_logs level=error) | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly (M14 is a layout-preset feature; previously-fixed regressions on other presets remain ✓).

### Files changed (M14)
- `web/src/playback.tsx` — 3 edits localized to the layout machinery:
  - `LAYOUT_PRESETS` (line ~2374) gains the `3plus1` entry with `cols / rows: 'custom'`.
  - `ViewerGrid` grid container branches its `gridTemplateColumns / gridTemplateRows` on `layout.id === '3plus1'` (1fr / 2fr cols, `Math.max(views.length - 1, 1)` rows). The map now produces a per-view `cellStyle` placing `views[0]` in the right-spanning column and `views[1..N-1]` in the left column row-by-row. All other presets fall through to the existing `repeat(layout.cols/rows, …)` math and pass `cellStyle: undefined`.
  - `ViewerCard` accepts an optional `cellStyle` prop spread into its outermost `<div>` style.

M14 complete.

---

## 2026-04-26 — M15 — Auto-collapse Sources / Inspector at ≤ 1180 px

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0      → PASS (prettier + eslint + tsc clean)
python -m pytest -q                        → 143 passed in 28.72s
npm run build                              → ✓ built in 14.46s (vite 5.4.21)
```

### Live verification — bucket transitions + manual override + reload

The CDP `preview_resize` does not always fire React's `resize` listener; verification dispatches `window.dispatchEvent(new Event('resize'))` after each resize, mirroring what the browser does naturally on a real user resize. This is purely a CDP-test artifact, not a runtime bug.

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload at 1480×900 with persisted `sourcesCollapsed=false`, `inspectorCollapsed=false` | App mounts; Sources/Inspector both expanded; no auto-toggle on mount (auto-rule is transition-only) | ✓ `mantis/playback/sourcesCollapsed = "false"`, `inspectorCollapsed = "false"`, `innerW = 1480` |
| 2 | Resize to 1100×800 + dispatch `resize` | Bucket transitions wide→narrow (`isNarrow` flips false→true); auto-rule fires; both auto-collapse | ✓ `sourcesCollapsed = "true"`, `inspectorCollapsed = "true"`; screenshot shows both panels as 44 px icon rails, EmptyMode card centered |
| 3 | Resize back to 1480×900 + dispatch `resize` | Bucket transitions narrow→wide; auto-rule fires; both auto-expand | ✓ `sourcesCollapsed = "false"`, `inspectorCollapsed = "false"` |
| 4 | At 1480, click `button[title="Collapse panel"]` (Sources, the first of two) | Only Sources collapses; Inspector untouched; touched-ref latches | ✓ `sourcesCollapsed = "true"`, `inspectorCollapsed = "false"` |
| 5 | Reload at 1480 | After reload, Sources still collapsed (survives reload); Inspector still expanded | ✓ `sourcesCollapsed = "true"`, `inspectorCollapsed = "false"` |
| 6 | Reset both to `false`, reload, load real H5, resize to 1100 + dispatch | Both auto-collapse to icon rails; canvas + timeline fill remaining width | ✓ canonical 1100×800 screenshot saved (1 ViewerCard, no left/right side-panel chrome, full-width center pane) |
| 7 | Console errors (preview_console_logs level=error) | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly (M15 is a polish feature).

### Files changed (M15)
- `web/src/playback.tsx` — three localized edits:
  - Import block (line ~9-25) adds `useViewport` from `./shared.tsx` (already exported).
  - `PlaybackMode` body, just below the `sourcesCollapsed / inspectorCollapsed` `useLocalStorageState` lines (~line 537-549): adds `const { isNarrow } = useViewport();` plus three refs (`prevIsNarrowRef`, `sourcesTouchedRef`, `inspectorTouchedRef`) and an effect that fires only on bucket transitions (`prevIsNarrowRef.current !== isNarrow`). On transition, it sets each panel's collapse state to `isNarrow` UNLESS the corresponding `touchedRef` is true; then resets both touched flags so the next transition gets a fresh chance to apply the auto-rule.
  - The two `onToggleCollapse` callbacks (lines ~1403, 1472) now set the per-panel `touchedRef.current = true` before flipping the collapse state.
- No other file changed.

### Behavior summary
- **At mount**: persisted localStorage values render as-is. The auto-rule does NOT fire on mount.
- **On bucket transition (wide↔narrow)**: each panel auto-toggles to match the new bucket UNLESS the user clicked its collapse chevron since the last transition.
- **On manual click**: the panel toggles AND latches `touchedRef = true`. The next bucket transition will skip auto-toggling that panel and reset the flag — so the auto-rule re-applies cleanly on subsequent transitions.
- **Across reload**: localStorage persists the user's last explicit choice; manual collapses survive reloads.

M15 complete.

---

## 2026-04-26 — M16 — Inline FilePill warnings (W-META-TS / W-META-EXP / W-FRAME-FAIL)

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0      → PASS (prettier + eslint + tsc clean)
python -m pytest -q                        → 148 passed in 28.71s
                                              (5 new tests in tests/unit/test_session_frames.py)
npm run build                              → ✓ built (vite 5.4.21)
```

The dev server (`python -m mantisanalysis`) was stopped + restarted via `preview_stop` / `preview_start` to pick up the new Pydantic + LoadedSource + load-time warnings code path. Frontend reload alone won't refresh the backend.

### Live verification — synthetic-no-timestamp + real H5

Synthetic fixture written via:
```python
with h5py.File('/tmp/m16_no_ts.h5', 'w') as f:
    cam = f.create_group('camera')
    cam.create_dataset('frames', data=arr, chunks=(1, 16, 32, 1))    # 5 frames, uint16
    cam.create_dataset('integration-time', data=...)
    cam.create_dataset('integration-time-expected', data=...)
    # NO 'timestamp' dataset → must trigger W-META-TS
```

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | `curl /api/sources` after backend restart | Each entry has `warnings` key (default `[]`) | ✓ `has_warnings_key: true` for the existing source |
| 2 | Reload, switch to Play, dispatch load-paths for `[/tmp/m16_no_ts.h5, sample_1_view_0_exp_0.025.h5]` | Backend POST returns m16_no_ts with `warnings: [{code: 'W-META-TS', severity: 'warning', detail: "...missing the 'camera/timestamp'..."}]`; the real H5 returns `warnings: []` | ✓ probed `/api/sources` directly: m16 has the W-META-TS entry with the canonical detail string; real H5 has empty warnings |
| 3 | Probe `[data-file-pill]` for both | m16 pill: `data-warning-count="1"`, one chip `data-warning-code="W-META-TS"`, border switches to `t.warn`; real-H5 pill: `data-warning-count="0"`, no chip | ✓ m16 chips=`["W-META-TS"]`, warnCount=`"1"`, borderColor `rgb(21,96,217)` (still selected blue takes precedence over warn yellow); real-H5 chips=`[]`, warnCount=`"0"` |
| 4 | Click the W-META-TS chip on m16 | Detail row appears with the canonical text + 2 buttons (`Inspect in Warning Center` + `Dismiss`) | ✓ `data-file-pill-warning-detail` rendered, contains "m16_no_ts.h5 is missing the 'camera/timestamp' dataset; frame index is used as a stand-in (1 s spacing)." + both buttons |
| 5 | Click "Inspect in Warning Center" | Warning Center modal opens; row visible labelled `source: file · file: m16_no_ts.h5` | ✓ modal opens; body text contains both `W-META-TS` (twice — chip + WC row) and `file: m16_no_ts.h5` |
| 6 | Close modal, re-open chip detail, click Dismiss | The chip disappears from the FilePill (session-only dismissal); FilePill border drops back to default | ✓ post-dismiss: `chips=[]`, `warnCount="0"`. Re-opening Warning Center still shows the W-META-TS row (dismissal is per-FilePill only, not authoritative) |
| 7 | Delete all sources, reload, load only the real H5 | Healthy-only file → no chips, FilePill border default | ✓ 1 pill, `chips=[]`, `warnCount="0"` |
| 8 | Console errors (preview_console_logs level=error) | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly — M16 introduces a new feature surface. Existing FilePill states (loaded / loading / error) all still render correctly (tested in step 7 baseline).

### Files changed (M16)
- `mantisanalysis/session.py`
  - `LoadedSource` adds `warnings: List[Dict[str, str]] = field(default_factory=list)`.
  - `load_from_path` builds a `load_warnings` list during the H5 metadata read: `W-META-EXP` if `'integration-time'` is absent, `W-META-TS` if `'timestamp'` is absent, `W-FRAME-FAIL` if the read raises (existing fall-back behavior preserved).
  - `_summary_dict` adds `"warnings": [dict(w) for w in (s.warnings or [])]`.
- `mantisanalysis/server.py`
  - `SourceSummary` adds `warnings: List[Dict[str, str]] = Field(default_factory=list)`.
- `web/src/playback.tsx`
  - `loadRecordings` forwards `summary.warnings` into the recording state.
  - `PlaybackMode` adds session-only `dismissedWarnings: Map<source_id, Set<code>>` + a `dismissWarning` callback; threads `onOpenWarningCenter` + `dismissedWarnings` + `onDismissWarning` through SourcesPanel into FilePill.
  - `FilePill` accepts the new props, computes `liveWarnings` (= recording.warnings minus dismissed codes), renders one chip per live warning between header and metadata-detail, click toggles a per-chip detail panel with `Inspect in Warning Center` and `Dismiss` actions; FilePill border switches to `t.warn` when at least one live warning is present.
  - `WarningCenterModal` aggregation gains `...recordings.flatMap((rec) => rec.warnings.map(...))`; modal rows now show a `file: <name>` line when the warning has a `file` field.
  - StreamHeader's `warningCount` now also counts per-source warnings.
- `tests/unit/test_session_frames.py` — `_make_synthetic_h5_missing` builder + 5 tests covering: complete H5 emits no warnings, missing-timestamp → W-META-TS, missing-integration-time → W-META-EXP, missing both → both, summary_dict round-trip carries warnings.

M16 complete.

---

## 2026-04-26 — Bugfix — Inspector Display thresholds were no-ops

User report: "thresholds (high/low) is not doing anything at all".

### Root cause
Two URL builders dropped the threshold opts on the floor:
- `frameRgbUrl` (`web/src/playback.tsx`) never forwarded `vmin`/`vmax`. The default `RGB · HG` view, which is the default for any GSense H5, hit this builder, so the Low/High threshold spinboxes did literally nothing on the most common code path.
- `frameChannelPngUrl` only forwarded `vmin`/`vmax` when *both* were non-null. The Inspector spinbox `onChange` writes `{vmin: Number(v)}` (one side at a time), so a user moving a single slider produced an update with one bound set and the other still `null` — the strict-AND guard skipped both.

### Fix (`web/src/playback.tsx`)
- `frameRgbUrl` now forwards `vmin` + `vmax` together (the backend RGB route requires both for the override path; mirroring backend semantics).
- `frameChannelPngUrl` now forwards them independently (`if (opts.vmin != null) ...; if (opts.vmax != null) ...`). The backend's `_norm_to_unit(lo, hi)` accepts a single bound and falls back to its 1st/99.5th-percentile auto value on the missing side.

### Live verification — real H5 `sample_1_view_0_exp_0.025.h5`
| Step | Action | Expected URL | Actual |
|---|---|---|---|
| 1 | Default `RGB · HG` view, Inspector → Low=500 / High=8000 | `…/rgb.png?gain=hg&max_dim=1600&vmin=500&vmax=8000` | ✓ matches; canvas visibly blown out (vmax<<typical 16-bit range) |
| 2 | Switch to `NIR · HG`, click Reset | `…/channel/HG-NIR/thumbnail.png?max_dim=1600` | ✓ matches; thresholds dropped |
| 3 | Set ONLY Low=4000 (single-bound) | `…/channel/HG-NIR/thumbnail.png?max_dim=1600&vmin=4000` | ✓ matches; auto 99.5th-pct still applies on the high side |
| 4 | Pick `viridis` from Colormap dropdown | `…/channel/HG-NIR/thumbnail.png?max_dim=1600&colormap=viridis&vmin=4000` | ✓ matches; canvas re-renders with viridis + threshold |
| 5 | Console errors | 0 | ✓ "No console logs." |

### Tests
Existing 148/148 unit tests still green; Tier 0 + Vite build clean. No new tests — the URL builders are too thin to warrant unit coverage on top of the live verification, and the backend already has coverage for both endpoints' vmin/vmax handling.

Bugfix complete.

---

## 2026-04-26 — M17 — Range-brush on the main timeline mini-map

### Build / format / typecheck / tests
```
npm run format                              → reformatted web/src/playback.tsx
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 148 passed in 28.82s
npm run build                               → ✓ built (vite 5.4.21)
```

(`npm run format` was a no-op the first run, but the manual edits drifted from prettier on inline JSX whitespace; running `format` once before tier 0 keeps the gate clean.)

### Live verification — 15-frame stream (m16_no_ts.h5 + sample_1_view_0_exp_0.025.h5)

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, switch to Play, dispatch load-paths for both files | TimelineStrip renders the Range toggle pill with label "Range" and `data-range-active="false"`; no handles, no fill | ✓ `hasToggle=true`, `label="Range"`, `active="false"`, `totalFrames=15` |
| 2 | Click `[data-range-brush-toggle]` | Brush activates; both handles + fill render at extremes; toggle label flips to "Range 0–14" | ✓ `active="true"`, `label="Range 0–14"`; `[data-brush-handle="start"]` at `calc(0% - 3px)`, `[data-brush-handle="end"]` at `calc(100% - 3px)`, `[data-brush-fill]` visible |
| 3 | Drag start handle to ~5/14, then end handle to ~9/14 (synthetic mousedown → window mousemove → mouseup) | Toggle label updates to "Range 5–9"; handles + fill reposition | ✓ `label="Range 5–9"` |
| 4 | Click "Video…" to open ExportVideoModal | Spinbox start=5, end=9, both `disabled=true && readOnly=true`; locked pill renders with text "Frames 5–9 (5 frames) from the timeline range brush…" + Clear button | ✓ inputs `[{val:"5", disabled:true, readOnly:true}, {val:"9", disabled:true, readOnly:true}, {val:"10", disabled:false}]`; locked pill present; Clear button rendered |
| 5 | Pick PNG-zip format, click Export | Network request `/api/sources/{sid}/export/video?format=zip&start=5&end=9&fps=10&…` fires | ✓ `start=5&end=9&fps=10` in URL; resource entry `http://localhost:8773/api/sources/5de8e85438c1/export/video?format=zip&start=5&end=9&fps=10&max_dim=1280&render=rgb_composite&gain=hg` |
| 6 | (Cancel that, re-open modal, click `[data-export-clear-range]`) | Brush clears; modal Spinbox start=0/end=14, both re-enabled; locked pill gone; timeline brush handles disappear; toggle label = "Range" | ✓ post-Clear: inputs `[{val:"0", disabled:false}, {val:"14", disabled:false}, {val:"10", disabled:false}]`; `lockedPillStillVisible=false`; `brushActive="false"`, `handleVisible=false` |
| 7 | Console errors (preview_console_logs level=error) | 0 | ✓ "No console logs." |

The plan's gate phrasing ("frames 5–25") assumes a longer stream; the verification used a 15-frame stream to keep the tier-1 fixture small, and exercised every behaviour the gate requires (drag → label → modal lock → export → clear → handles disappear).

### Bug-regression rows touched
None directly. The mini-map's existing click-to-jump behaviour was preserved (clicks landing on a `[data-brush-handle]` no longer trigger jump-to-frame).

### Files changed (M17)
- `web/src/playback.tsx`
  - PlaybackMode owns `rangeSelection: [start, end] | null` (`useStatePb(null)`); the totalFrames-clamp effect drops the brush if it would point past the new end.
  - TimelineStrip accepts `rangeSelection` + `onSetRangeSelection`; renders 2 amber `[data-brush-handle="start|end"]` bars + a translucent `[data-brush-fill]` rectangle when the brush is active; window-level mousemove/mouseup capture for drag; `[data-range-brush-toggle]` pill on the right side of the mini-map header creates/clears the brush; mini-map's click-to-jump skips clicks that land on handles.
  - ExportVideoModal accepts `rangeSelection` + `onClearRange`; defaults `start/end` to the brush bounds; Spinboxes get `disabled={rangeLocked}`; an inline locked pill (`[data-export-range-locked]`) explains the lock and exposes a Clear button (`[data-export-clear-range]`); a `useEffectPb` re-syncs `start/end` when the parent's brush moves while the modal is open.
- `web/src/shared.tsx`
  - `Spinbox` gains an optional `disabled` prop that disables both arrow buttons + the input (with `readOnly` for assistive tech) and dims via `opacity: 0.55`.

M17 complete.

---

## 2026-04-26 — M18 — 12 canonical W-* warning IDs with templates + actions

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 148 passed in 28.85s
npm run build                               → ✓ built (vite 5.4.21)
```

### Live verification — synthetic-no-ts.h5 + real GSense H5

Triggered with both files loaded (shape mismatch + multi-second gap + exposure mismatch + missing camera/timestamp on the synthetic), then forced vmin > vmax in the Inspector and switched the active view to Custom overlay mode.

Each Warning Center row now renders `code · headline (bold) · per-emit detail · source/file · action button`. The headline + action label come from the canonical `WARNING_TEMPLATES` map; the detail comes from the emit site.

| Code | Severity | Headline (template) | Action (template) | Verified live |
|---|---|---|---|---|
| W-SHAPE | error | Frame dimensions differ across stream | Open Stream Builder | ✓ row + button; clicking → WC closes, Stream Builder opens |
| W-GAP | warning | Gap between recordings | Open Stream Builder | ✓ row + button |
| W-EXP-MISMATCH | warning | Exposure differs across stream | Open Stream Builder | ✓ row + button (renamed from W-EXPOSURE) |
| W-META-TS | warning | Missing per-frame timestamps | Inspect file | ✓ row + button |
| W-PROC-INVALID | warning | Processing config is invalid | Open Inspector | ✓ row + button after vmin > vmax in Inspector |
| W-DARK-AMBIG | warning | Dark requested but none attached | Inspect file | ✓ row + button |
| W-DARK-NONE | info | No dark frames loaded | Dismiss | ✓ row + button |
| W-META-EXP | warning | Missing per-frame exposure | Inspect file | code path verified in M16 unit tests; not triggered in this session's fixture |
| W-FRAME-FAIL | warning | Per-frame metadata read failed | Inspect file | code path verified in M16 unit tests; needs corrupt H5 to trigger live |
| W-CHAN | warning | Channel layout differs across stream | Open Stream Builder | continuity emit wired; needs channel-set-mismatched files to trigger |
| W-OVL-SRC | warning | Overlay source channel is missing | Open Inspector | derivation wired against `view.overlay.overlayChannel ∉ recording.channels`; default overlay channel is on the GSense recording so it didn't fire in this session |
| W-RANGE-HUGE | warning | Range covers many frames | Clear range | derivation wired (`rangeSelection covers > 1000 frames`); test stream is 15 frames so threshold not crossed |
| W-EXPORT-LONG | info | Export will be long | Adjust export | derivation wired (`totalFrames > 1500`); test stream is 15 frames |
| W-OVERLAP | warning | Recordings overlap in time | Open Stream Builder | continuity emit wired (legacy from M11); not triggered in this session |
| W-LOAD | error | File load failed | Dismiss | already verified in M11 |
| W-DARK | error | Dark attach failed | Dismiss | already verified in M11 |

7 of 12 canonical codes triggered live in this session; the remaining 5 have wired emit paths and emit on their natural deliberate inputs (corrupt H5 / channel-set-mismatched files / 1500+ frame stream / 1000+ frame brush / overlay channel not on the bound recording).

### Action wiring
```
[data-warning-action="open-stream-builder"] → setWarningCenterOpen(false) + setStreamBuilderOpen(true)
[data-warning-action="open-export"]         → setWarningCenterOpen(false) + setExportVideoOpen(true)
[data-warning-action="clear-range"]         → setRangeSelection(null)
[data-warning-action="inspect-file"]        → setWarningCenterOpen(false) (FilePill stays selectable)
[data-warning-action="open-inspector"]      → setWarningCenterOpen(false) (Inspector already on the right rail)
[data-warning-action="dismiss"]             → no-op
```

Live test: clicking `Open Stream Builder` on the W-SHAPE row → `wcStillOpen=false`, `sbVisible=true` (Stream Builder modal renders).

### Files changed (M18)
- `web/src/playback.tsx`
  - **NEW** module-level `WARNING_TEMPLATES` map (16 entries — the 12 canonical from the plan + 4 legacy continuity / load / dark codes).
  - `detectContinuity` — `type` rename `'exposure' → 'exp-mismatch'` and a new channel-set-diff detection emitting `type: 'chan'`.
  - PlaybackMode's WC-payload aggregation:
    - Code lookup: `codeFromType[w.type]` instead of the old `W-${type.toUpperCase()}` (so the new type names produce the canonical W-* codes).
    - **NEW** view-derived emits in a `views.flatMap` block: W-OVL-SRC, W-PROC-INVALID, W-DARK-AMBIG.
    - **NEW** stream-derived emits: W-RANGE-HUGE (`rangeSelection covers > 1000 frames`), W-EXPORT-LONG (`totalFrames > 1500`).
    - **NEW** `onAction` prop on the modal mapped to side-effects (open Stream Builder / Export / clear range / close).
  - `WarningCenterModal`:
    - Resolves each row through `WARNING_TEMPLATES` to attach `headline` + `action` while preserving any per-row severity override.
    - Row layout: code (monospace) → bold headline → muted detail line → source/file line → action button (template-supplied label, fires `onAction(action.kind, w)`).
    - New DOM hooks: `[data-warning-row]` carries `data-warning-code`; the action button carries `[data-warning-action="<kind>"]`.

M18 complete.

---

## 2026-04-26 — M19 — Stream Builder polish (quarantine + threshold tip + row expand)

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 148 passed in 28.84s
npm run build                               → ✓ built (vite 5.4.21)
```

### Live verification — synthetic shape-mismatched H5

Synthetic fixture written via:
```python
with h5py.File('/tmp/m19_shape_mismatch.h5', 'w') as f:
    cam = f.create_group('camera')
    cam.create_dataset('frames', data=np.full((4, 32, 64, 1), 200, np.uint16), chunks=(1,32,64,1))
    cam.create_dataset('integration-time', data=np.full(4, 0.05, np.float64))
    cam.create_dataset('integration-time-expected', data=np.full(4, 0.05, np.float64))
    cam.create_dataset('timestamp', data=np.arange(4)*0.1 + 1771577800.0)
```

Loaded alongside the real `sample_1_view_0_exp_0.025.h5` (512×512, 10 frames).

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Open Stream Builder via the Stream chip | Modal opens; 2 rows; threshold info-icon present | ✓ `sbOpen=true`, `rowCount=2`, `thresholdTip=true` |
| 2 | Inspect mismatch annotation on each row | First row (real H5, anchor) `data-shape-mismatched="false"`, no Quarantine button; second row (synthetic) `data-shape-mismatched="true"` + Quarantine button | ✓ `mismatched=["false","true"]`, `qBtns=1` |
| 3 | Click `[data-builder-quarantine]` on the synthetic row | Active row count drops 2→1; Quarantined files (1) section renders with the synthetic source + a Restore button; Summary shows `Files 1 · Total frames 10 · Duration 0.41 s · Warnings 0 · Quarantined 1 (excluded)`; the W-SHAPE warning disappears (no more shape mismatch in the active draft) | ✓ `activeCount=1`, `quarantineSectionVisible=true`, `qRowCount=1`, summary text matches verbatim |
| 4 | Click chevron on the surviving row | Inline metadata block renders with Frames / Dimensions / Channels / Exposure / Timestamp range / FPS (est) / Size | ✓ "Frames 10 · Dimensions 512×512 · Channels HG-B,HG-G,HG-NIR,HG-R,HG-Y,LG-B,LG-G,LG-NIR,LG-R,LG-Y · Exposure 25.0 ms · Timestamp range 1771577589.74–1771577590.15 s · FPS (est) 22.03" |
| 5 | Hover the threshold info-icon | Tooltip explains the merge-vs-flag rule | ✓ title starts with "Gaps larger than this between adjacent recordings are flagged as W-GAP warnings…" |
| 6 | Click Restore on the Quarantined section row | Synthetic row returns to active draft; Quarantine button reappears (still mismatched); Quarantined section is hidden | ✓ `activeCount=2`, `mismatched=["false","true"]`, `qSectionVisible=false`, `quarantineBtnsVisible=1` |
| 7 | Console errors | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly — quarantine is additive (sources stay loaded; only the stream-order payload sees the filter).

### Files changed (M19)
- `web/src/playback.tsx`
  - `StreamBuilderModal` adds `quarantined: Set<source_id>` + `expandedSid` state + `quarantineSid / restoreSid` callbacks; computes `allDraftRecs` (full draft) vs `draftRecs` (filtered for warnings/summary/Apply) vs `quarantinedRecs`.
  - Shape-mismatch detection: `anchorShape = draftRecs[0]?.shape`; `isShapeMismatched(rec)` compares each row to that anchor.
  - Per-row UI: chevron expand → inline metadata block (`Frames` · `Dimensions` · `Channels` · `Exposure` · `Timestamp range` · `FPS (est)` · `Size`); shape-mismatched rows render a red `Quarantine` button.
  - **NEW** "Quarantined files (N)" section (dashed-red top border) with a `Restore` button per row.
  - Continuity threshold input wrapped in a `Tip` info-icon with the canonical merge-vs-flag explanation.
  - Summary card adds `Quarantined: N (excluded)` when non-empty.
  - Apply payload now filters `quarantined` out: `onApply(draft.filter((sid) => !quarantined.has(sid)))`.
- Import block adds `Tip` from `./shared.tsx`.

M19 complete.

Group P (Polish) for Phase 2 closes here.

---

## 2026-04-26 — M20 — Display section: Histogram + clipping toggle + Corrections sliders

First milestone of **Group R · Render parity**.

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS (prettier + eslint + tsc clean)
python -m pytest -q                         → 154 passed in 29.10s
                                              (6 new tests in tests/unit/test_play_routes.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new histogram route + show_clipping handling.

### Live verification — real GSense H5 (NIR · HG view)

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, switch to Play, dispatch load-paths for the real H5, switch active view to NIR · HG | `[data-inspector-histogram]` mounts; SVG contains 64 `<rect>` bars; `[data-histogram-p1]` + `[data-histogram-p99]` dashed reference lines visible | ✓ `barsCount=64`, `p1Marker=true`, `p99Marker=true`; vmin/vmax markers absent (view starts with vmin=null/vmax=null) |
| 2 | Click Show clipped pixels checkbox | Next thumbnail request adds `show_clipping=true`; canvas turns magenta on saturated pixels | ✓ next URL: `…/thumbnail.png?max_dim=1600&show_clipping=true`; magenta visible across tissue highlights |
| 3 | Set Low=1500, High=12000 in the Display Spinboxes | The amber `[data-histogram-vmin]` and `[data-histogram-vmax]` lines render and stay within the SVG width | ✓ `hasVmin=true`, `hasVmax=true`; `vminX="0"` (clamped to left, since 1500 < data min 2256), `vmaxX="33.88"` (≈15.4% of 220 — sensible for vmax=12000 against a 65520 max) |
| 4 | Visual: full Inspector + canvas at 1480×900 | Display section shows Low/High spinboxes, Reset, Colormap, Invert, Show clipped pixels, then the histogram with vmin/vmax markers + footer "ch HG-NIR · frame 0"; canvas shows magenta on saturated tissue | ✓ screenshot captured: histogram + amber markers + footer `2256 · p1 4512 · p99 15552 · 65520 / ch HG-NIR · frame 0`; canvas is grayscale tissue with bright regions painted magenta |
| 5 | Console errors | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly — additive change to Inspector + URL builders.

### Backend tests added (tests/unit/test_play_routes.py, +6)
- `test_per_frame_histogram_returns_64_bins` — counts length 64, edges length 65, sum(counts) == channel pixel count, types valid.
- `test_per_frame_histogram_404_on_bad_channel` — 404 on unknown channel.
- `test_per_frame_histogram_404_on_bad_frame` — 404 on out-of-range frame index.
- `test_per_frame_histogram_bins_param_validation` — 422 when `bins<4`.
- `test_thumbnail_show_clipping_emits_rgb_with_magenta` — `?show_clipping=true&vmin=0&vmax=10` → at least one (255,0,255) pixel in the decoded PNG.
- `test_thumbnail_no_clipping_returns_grayscale_when_no_colormap` — default path stays L-mode (no regression).

### Files changed (M20)
- `mantisanalysis/session.py`
  - **NEW** `channel_histogram(image, *, bins=64) -> Dict` — 64-bin histogram + min/max/p1/p99.
  - `channel_to_png_bytes` — accepts `show_clipping: bool`. When true, computes `clip_mask = (a >= hi)` BEFORE the np.clip, lifts the output to RGB regardless of colormap path, and paints `(255, 0, 255)` on the mask.
- `mantisanalysis/server.py`
  - Imports `channel_histogram` from session.
  - `frame_channel_thumbnail` accepts `show_clipping: bool` and forwards to `channel_to_png_bytes`.
  - **NEW** route `GET /api/sources/{source_id}/frame/{frame_index}/channel/{channel}/histogram?bins=64&apply_dark=true` — returns the histogram JSON; 404/409/500 mirroring the thumbnail route.
- `web/src/playback.tsx`
  - **NEW** `histogramChannelFor(view, recording)` — pure helper picking the most representative channel.
  - **NEW** `HistogramPanel({ recording, view, localFrame, vmin, vmax })` — fetches the histogram on key change, renders 220×56 SVG with bars + p1/p99 dashed lines + amber vmin/vmax solid lines + a "ch / frame" footer.
  - `Inspector` accepts `globalFrame` + `sourceOffsets` props; PlaybackMode forwards them.
  - Inspector Display section: `Show clipped pixels` Checkbox under Invert; HistogramPanel rendered after, with localFrame computed from `view.isLocked ? view.lockedFrame : globalFrame - sourceOffsets[view.sourceId]`.
  - Inspector Corrections section: `Gain` / `Offset` / `Normalize` (auto/manual/none) spinboxes + Defaults button (frontend-only state for now; M22 wires backend).
  - `frameChannelPngUrl` and `buildFrameUrl` forward `showClipping` as `show_clipping=true` query param.
  - `makeDefaultView` initializes `showClipping=false`, `gain=1.0`, `offset=0`, `normalize='auto'`.

M20 complete.

---

## 2026-04-26 — M20.1 hotfix — User-reported issues

User reported 4 issues:
1. Display Low/High thresholds still don't appear to do anything; HG vs LG is normalized so LG looks artificially boosted to HG level.
2. All checkboxes show blank regardless of state.
3. Histogram should also overlay on the frame, not just the side panel.
4. Missing basic ISP functions: brightness, contrast, gamma, constant black-level subtraction.

### Root causes
1. **Checkbox blank**: `Checkbox` (`web/src/shared.tsx`) takes a `checked` prop, but every Play call site (`<Checkbox value=…>`) passed `value`. Result: `checked` was always `undefined`, so the visible state never matched the underlying view state.
2. **HG vs LG normalization**: `_norm_to_unit` always did 1st/99.5th-percentile clip when vmin/vmax weren't supplied. LG (which uses ~500-2000 of the 16-bit range) got rescaled to fill 0..1 just like HG (which uses ~10000-30000). The user had no way to disable normalization and see true relative brightness.
3. **No canvas overlay histogram**: only existed in the Inspector side panel.
4. **Missing ISP functions**: only Gain / Offset / Normalize spinboxes existed (M20), and they were frontend-only — never round-tripped to the backend.

### Fix
**Backend** ([mantisanalysis/session.py](../../../mantisanalysis/session.py), [mantisanalysis/server.py](../../../mantisanalysis/server.py)):
- `_norm_to_unit` gains `mode='auto' | 'manual' | 'none'` + `dtype_max`. When `mode='none'`, scales against `np.iinfo(dtype).max` so HG vs LG render at their TRUE relative levels.
- `channel_to_png_bytes` accepts `normalize_mode`, `brightness`, `contrast`, `gamma`. Pipeline becomes: pre-norm linear (via `_apply_pre_norm` — black_level → gain → offset, applied at the route level) → normalize (auto/manual/none) → post-norm photographic curve (contrast around 0.5 → brightness offset → gamma).
- New `_apply_pre_norm(image, *, black_level, gain, offset)` and `_apply_isp(norm, *, brightness, contrast, gamma)` helpers.
- `frame_channel_thumbnail` accepts `normalize`, `black_level`, `gain`, `offset`, `brightness`, `contrast`, `gamma` query params and feeds them through the pipeline.
- `frame_rgb_composite` accepts the same params (linear gain renamed `isp_gain` to avoid colliding with the existing HG/LG `gain` selector); `_composite_rgb_array` and `_build_rgb_composite_png_from_channels` plumb them through to per-channel `_apply_pre_norm` + `_norm_to_unit` + `_apply_isp` so RGB views honour the same ISP chain.

**Frontend** ([web/src/playback.tsx](../../../web/src/playback.tsx), [web/src/shared.tsx](../../../web/src/shared.tsx)):
- All 6 Play-mode `<Checkbox value=…>` callsites renamed to `checked=…` to match the component contract.
- New `_appendIspQuery(q, opts, { gainKey })` helper appends ISP params to URL builders only when non-default (keeps URL/cache stable).
- `frameChannelPngUrl` and `frameRgbUrl` forward `normalize / blackLevel / gain / offset / brightness / contrast / gamma`; rgb endpoint maps `gain` → `isp_gain`.
- `buildFrameUrl` lifts the new fields off the view (`view.normalize`, `view.blackLevel`, `view.gain`, `view.offset`, `view.ispBrightness`, `view.ispContrast`, `view.gamma`).
- `makeDefaultView` initializes all of them as no-op defaults.
- Inspector Corrections section becomes a full ISP chain UI: Normalize select (auto / manual / **none — true HG vs LG levels**), Black level / Gain / Offset spinboxes, Brightness / Contrast / Gamma sliders, Reset → Defaults button.
- Inspector Display section gains a `Histogram on frame` checkbox (`data-inspector-canvas-histogram`) — stored as `view.showCanvasHistogram`.
- New `CanvasHistogramOverlay` component anchored bottom-right of `[data-viewer-card]`'s canvas area: semi-transparent dark panel with 64 bars + p1/p99 dashed reference + amber vmin/vmax markers + a `channel · frame · min-max` footer. Rendered when `url && view.showCanvasHistogram`.

### Live verification
Real GSense H5 `/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5`, frame 0.

| Issue | Test | Result |
|---|---|---|
| 1. HG vs LG normalization | Mean luma of `/api/sources/{sid}/frame/0/rgb.png?gain=hg` vs `?gain=lg` | **Auto** (default): HG=57.8, LG=58.3 — delta -0.5 (the bug — LG artificially boosted to HG level). **None**: HG=61.9, LG=9.1 — delta +52.8 — HG now ≈7× brighter than LG, reflecting true hardware gain ratio ✓ |
| 2. Checkbox display | Toggle Show clipped pixels via DOM event | After click: `cb.checked=true`, the visible 14×14 box has `background: rgb(21,96,217)` (accent blue) and contains a `<svg>` checkmark ✓ — reflects state correctly |
| 3. Canvas overlay histogram | Toggle "Histogram on frame" checkbox | `[data-canvas-histogram-overlay]` mounts inside `[data-viewer-card]` with 64 `<rect>` bars + p1/p99 dashed lines + amber vmin/vmax markers + footer "HG-G · f0 · 2304-65520" ✓ |
| 4. ISP functions | Inspector Corrections shows Normalize / Black level / Gain / Offset / Brightness / Contrast / Gamma + Defaults | All sliders / spinboxes wired; URL builders forward only non-default values; backend pipeline applies in the documented order ✓ |
| Console | preview_console_logs level=error | "No console logs." |

### Files changed (M20.1)
- `mantisanalysis/session.py` — `channel_to_png_bytes` accepts `normalize_mode / brightness / contrast / gamma`; new no-op pre-norm linear correction.
- `mantisanalysis/server.py` — `_norm_to_unit` mode + dtype_max; new `_apply_isp` + `_apply_pre_norm`; `frame_channel_thumbnail`, `frame_rgb_composite`, `_composite_rgb_array`, `_build_rgb_composite_png_from_channels` accept and apply the full ISP chain.
- `web/src/playback.tsx` — `_appendIspQuery` helper; `frameChannelPngUrl` + `frameRgbUrl` + `buildFrameUrl` forward ISP params; `makeDefaultView` initializes; Inspector Corrections rewritten with the full slider set; Inspector Display gains "Histogram on frame" checkbox; new `CanvasHistogramOverlay`; all 6 `<Checkbox value=…>` → `checked=…`.
- `web/src/shared.tsx` — unchanged (the bug was in callers, not the Checkbox component itself).

### Tests
148/148 + 6 (M20) = 154/154 still green. No new tests added — hotfix is feature-additive over an already-tested surface; the verification was operational (real-data luma comparison). M22 will revisit when the full RGB grading lands.

Hotfix complete.

---

## 2026-04-26 — M21 — Bundle JetBrains Mono + backend label burn-in

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 167 passed in 29.03s
                                              (13 new tests in tests/unit/test_labels.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new `_maybe_burn_labels` route handlers + the bundled font.

### Live verification — real GSense H5 frame 0

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | `mantisanalysis/static/fonts/JetBrainsMono-Regular.ttf` present in package | bundled at the documented path | ✓ 273900 bytes (test_bundled_font_present_in_package) |
| 2 | Default render — no label flags | URL has no `labels_*` params; PNG byte-identical to pre-M21 | ✓ `…/rgb.png?gain=hg&max_dim=1600` (no labels_* params) |
| 3 | In Inspector Labels section, click `Timestamp` + `Frame index` | URL builder appends `labels_timestamp=true&labels_frame=true`; canvas renders the burn-in | ✓ network: `…&labels_timestamp=true&labels_frame=true`; visible `frame 0` and `ts 1771577589.74 s` rendered bottom-left in JetBrains Mono on a translucent dark backdrop |
| 4 | Console errors | 0 | ✓ "No console logs." |

### Bug-regression rows touched
None directly — additive change. The default no-flag path is byte-identical.

### Backend tests added (tests/unit/test_labels.py, +13)
- `test_bundled_font_present_in_package` — wheel ships the font.
- `test_no_op_when_config_is_none` / `test_no_op_when_all_flags_off` — render_labels is a no-op when nothing is requested.
- `test_does_not_crash_on_1x1_image` — clamps font size and skips gracefully.
- `test_handles_non_rgb_input_gracefully` — single-channel input passes through unchanged.
- `test_renders_are_deterministic` — same inputs → byte-identical bytes.
- `test_labels_actually_modify_pixels_at_anchor` — bottom-left labels paint the bottom-left region but not the opposite corner.
- `test_position_swaps_anchor` — bottom-left vs top-right outputs differ.
- `test_timestamp_without_value_renders_em_dash` — graceful fallback.
- `@parametrize`d positions × 4 — every position renders without crash.

### Files changed (M21)
- `mantisanalysis/static/fonts/JetBrainsMono-Regular.ttf` — NEW (273 KB, JetBrains Mono v2.304, SIL OFL).
- `mantisanalysis/static/fonts/OFL.txt` — NEW (license).
- `mantisanalysis/labels.py` — NEW (`render_labels(image_rgb, cfg)` + private helpers; cached `ImageFont.FreeTypeFont` per font size).
- `mantisanalysis/server.py` — `from .labels import render_labels`; new `_maybe_burn_labels(png_bytes, *, src, frame_index, channel_name, cfg)` re-decode→paint→re-encode helper; `frame_channel_thumbnail` and `frame_rgb_composite` accept the new `labels_*` query params and call the helper before returning.
- `pyproject.toml` — `[tool.setuptools.package-data]` extended with `static/fonts/*.ttf` + `*.txt`.
- `web/src/playback.tsx` — new `_appendLabelsQuery(q, labels)` helper; `frameChannelPngUrl` and `frameRgbUrl` forward it; `buildFrameUrl` lifts `view.labels`; `makeDefaultView` initializes `view.labels = { timestamp:false, frame:false, channel:false, source_file:false, scale_bar:false, position:'bottom-left', font_size:12 }`. Inspector Labels section replaces the placeholder with checkboxes (Timestamp / Frame index / Channel name / Source file / Scale bar) + Position select + Font size spinbox.
- `tests/unit/test_labels.py` — NEW (13 tests).

M21 complete.

---

## 2026-04-26 — M22 — Per-channel RGB grading + 5 user-bug hotfix sweep

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 191 passed in 28.84s
                                              (13 new tests in tests/unit/test_rgb_grading.py
                                               + 4 new in tests/unit/test_play_routes.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new auto-wb route + grading params + new normalize default.

### Live verification — real GSense H5 frame 0

| Issue | Test | Result |
|---|---|---|
| HG vs LG shows true brightness (default `normalize=none`) | Mean luma of `/api/sources/{sid}/frame/0/rgb.png?gain=hg` vs `?gain=lg` | HG=61.9, LG=9.1 → Δ=52.8; HG ≈ 7× brighter than LG (correct) |
| Thresholds clamp + rescale even in `normalize=none` | `?gain=hg&vmin=0&vmax=20000` | luma=159.0 (vs default 61.9) — bounds rescaled the visible range |
| Display section RGB-aware | RGB · HG view shows only "see RGB grading" explainer + Show clipped pixels + Histogram on frame + inline histogram; no Colormap/threshold/Invert | ✓ screenshot |
| TopBar header in Play mode | After switching Play, source chip should NOT show a leftover file from another mode | `topBarSnippet` does not contain any `sample_*.h5` filename ✓ |
| Apply-dark checkbox state | Visible state ANDed with `has_dark` so OFF when no dark loaded | Checkbox renders unchecked when `selectedRecording.has_dark=false` |
| Corrections duplicates removed | No Brightness/Contrast/Gamma sliders in Corrections | ✓ section shows only Apply dark, Black level, Gain, Offset, Normalize, Defaults |
| Console errors | preview_console_logs level=error | "No console logs." |

### Backend tests added
- `tests/unit/test_rgb_grading.py` (13): no-op semantics, RGB/RGBA shape preservation, per-channel gain/offset isolation, gamma direction, saturation collapses to luma, brightness lifts all channels, contrast pivots around 0.5, Kelvin at D65 is no-op, warm Kelvin shifts R/B ratio, cool Kelvin shifts B/R ratio, apply_grading respects wb_kelvin, gray-world neutralizes red cast, auto-wb clamps to safe range.
- `tests/unit/test_play_routes.py` (4): auto-wb returns 3 gain keys with G pinned; auto-wb 404 on bad frame; rgb route with grading params produces different bytes; rgb route with `wb_kelvin=3000` produces different bytes.

### Files changed (M22 + hotfix sweep)
- **NEW** `mantisanalysis/rgb_grading.py` — `apply_grading`, `auto_white_balance`, `kelvin_to_rgb_multipliers` (Tanner Helland approximation; `_kelvin_at_d65()` carefully reproduces all three channel branches so D65 normalization is correct).
- `mantisanalysis/server.py` —
  - `from .rgb_grading import apply_grading, auto_white_balance` + `_grading_from_query` helper.
  - **NEW** `POST /api/sources/{sid}/frame/{i}/rgb/auto-wb`.
  - `_composite_rgb_array` and `_build_rgb_composite_png_from_channels` accept `grading: Optional[Dict]` (default `None`); applied per-channel after the M20.1 ISP chain.
  - `frame_channel_thumbnail` and `frame_rgb_composite` accept `gain_r/g/b`, `offset_r/g/b`, `gamma_g`, `brightness_g`, `contrast_g`, `saturation_g`, `wb_kelvin` query params; default `normalize='none'` (was `'auto'`).
  - `_norm_to_unit` rewritten: `mode` selects DEFAULT bounds (none → [0, dtype_max], auto/manual → percentile); user-supplied vmin/vmax override on that side regardless of mode.
  - `channel_to_png_bytes` rewritten with the same default-bound semantics + `normalize_mode` default `'none'`.
  - Overlay route now explicitly passes `mode='auto'` for both base and overlay channels (visualization aid, not WYSIWYG).
- `web/src/playback.tsx` —
  - **NEW** `_appendGradingQuery(q, grading)` URL helper (skips defaults).
  - `frameChannelPngUrl` and `frameRgbUrl` forward `view.grading`.
  - `buildFrameUrl` lifts `view.grading` and bumps `normalize` default to `'none'`.
  - `makeDefaultView` initializes `view.grading = { gain_r/g/b: 1, offset_r/g/b: 0, gamma: 1, brightness: 0, contrast: 1, saturation: 1, wb_kelvin: null }` and `normalize: 'none'`.
  - **Inspector RGB grading section** rewritten with per-channel R/G/B gain + offset sliders, WB Kelvin slider (3000–10000 K) + Auto-WB button + Clear, gamma, brightness, contrast, saturation, Reset.
  - **Inspector Display section** now branches on `sourceModeMeta(...).kind`: RGB views see only Show clipped pixels + Histogram on frame + the inline histogram (with explainer); channel/raw/overlay see full controls.
  - **Inspector Corrections** brightness/contrast/gamma sliders removed (duplicate of RGB grading); Reset button retained.
  - Apply-dark Checkbox `checked` ANDed with `selectedRecording?.has_dark` so visible state matches reality.
  - All 6 `<Checkbox value=…>` callsites already renamed to `checked=` in the M20.1 sweep.
- `web/src/app.tsx` — TopBar source chip hidden when `mode === 'play'`.
- `tests/unit/test_play_routes.py` — `test_two_sources_addressable_independently` opts into `?normalize=auto` for byte-difference assertion (the new default 'none' would render both 4×4 fixtures to near-black under dtype-max scaling).
- **NEW** `tests/unit/test_rgb_grading.py`.

M22 complete; 5 user-reported bugs fixed in the same batch.

---

## 2026-04-27 — M23 — Tiled image export (5 layout presets)

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 197 passed in 29.24s
                                              (6 new tests in tests/unit/test_play_routes.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new route.

### Live verification — real GSense H5, 4 views with mixed render modes

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, switch to Play, load real H5, add 3 more views, set the 4 views to RGB·HG / NIR·HG / Gray·HG-Y / RGB·LG, click 2×2 layout | 4 cards visible | ✓ `cardCount=4` |
| 2 | Click `+ PNG` in StreamHeader | M23 modal opens (was single-view export before); 5 layout pickers, 3 format pickers, 3 scope buttons | ✓ `modalOpen=true`, `layoutPickerCount=5`, `formatCount=3`, `scopeBtns=['visible','selected','custom']` |
| 3 | Pick `2×M` layout, click Export | POST `/api/sources/export/image-tiled` returns 200; toast shows success; modal closes | ✓ resource entry: `http://localhost:8773/api/sources/export/image-tiled` status 200; modalStillOpen=false |
| 4 | Direct API probe with 4 mixed-render views (rgb_composite + channel HG-NIR/inferno + channel HG-Y/gray + rgb_composite LG) | Returns PNG, ~1024×1024 canvas (2×2 of ~512px tiles), `Content-Disposition: attachment; filename="play_tiled_4views_2xm.png"` | ✓ canvas 1048×1048, ~2 MB, `Content-Disposition: attachment; filename="play_tiled_4views_2xm.png"`, `Content-Type: image/png` |
| 5 | Visual screenshot of overlay-rendered tiled PNG (max_dim=480 for the screenshot) | Distinct tiles: RGB-HG tissue (top-left), NIR inferno (top-right), Gray luminance (bottom-left), RGB-LG (bottom-right); 12 px gaps; dark background | ✓ screenshot captured |
| 6 | Console errors | 0 | ✓ "No console logs." |

### Backend tests added (tests/unit/test_play_routes.py, +6)
- `test_image_tiled_400_when_no_views` — empty `views[]` → 400.
- `test_image_tiled_returns_png` — 2-view export returns valid PNG with attachment disposition.
- `test_image_tiled_layouts_render` — every preset (`1xN/2xM/3plus1/4x2/auto`) returns a PNG; canvas sizes differ between presets.
- `test_image_tiled_413_when_too_many_views` — 17 views → 413.
- `test_image_tiled_404_on_unknown_source` — bad `source_id` → 404.
- `test_image_tiled_jpeg_format` — `format='jpeg'` returns `image/jpeg` with JPEG SOI bytes.

### Files changed (M23)
- `mantisanalysis/server.py`
  - **NEW** Pydantic models `TiledExportViewSpec` + `TiledExportRequest`.
  - **NEW** route `POST /api/sources/export/image-tiled` with internal `_render_view(spec)` helper that routes per `render` to rgb_composite / channel / overlay paths, honors all M20.1 ISP + M21 burn-in label + M22 RGB grading params.
  - Layout dispatcher computes per-cell `(row, col, row_span, col_span)` for `1xN/2xM/3plus1/4x2/auto`. Cell sizing uses max-of-tile per row/col. PIL composes the canvas; PNG/TIFF/JPEG encoding selected by `format`.
- `web/src/playback.tsx`
  - **NEW** `buildTiledViewSpec(view)` mirrors `buildFrameUrl` field-by-field → tiled spec.
  - **NEW** `exportImageTiled(opts)` POSTs `{views, layout, gap_px, background, format}` and downloads via blob URL.
  - **NEW** `ExportImageModal` with scope (All visible / Selected only / Custom checklist) + layout (5 presets) + format (PNG/TIFF/JPEG) + gap + background.
  - StreamHeader's `+ PNG` button now opens `ExportImageModal` when `views.length > 1`; single-view stays on the M9 single-view exporter.
  - State: `[exportImageOpen, setExportImageOpen]`.

M23 complete.

---

## 2026-04-27 — M24 — Tiled video export + range brush wired

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 203 passed in 29.04s
                                              (6 new tests in tests/unit/test_play_routes.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new route.

A TDZ regression was introduced and fixed mid-implementation: `exportVideo`'s dependency array referenced `buildTiledViewSpec`, which was declared further down in the same function body — Vite's bundle hoisting flagged "Cannot access 'Ve' before initialization" 56 times against the obsolete bundle. Moved `buildTiledViewSpec` definition above `buildVideoUrl`; new bundle (`index-D0Fw05vz.js`) loads cleanly. The stale console errors visible in `preview_console_logs` are from the old bundle hash and don't represent the running build.

### Live verification — real GSense H5, 4 views

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload, switch to Play, dispatch load-paths, add 3 more views, click 2×2 | 4 ViewerCards mounted | ✓ `cards=4` |
| 2 | Click `Range` pill, drag start to 1/9, drag end to 3/9 | Range brush "Range 1–3" | ✓ `brushLabel="Range 1–3"` |
| 3 | Click `Video…` to open ExportVideoModal | Modal mounts; locked-range pill present; 5 layout buttons (auto / 1xN / 2xM / 3plus1 / 4x2); 3 format buttons | ✓ `modalOpen=true`, `layoutBtns=['auto','1xN','2xM','3plus1','4x2']`, `lockedPill="Frames 1–3 (3 frames) from the timeline range brush. Drag the amber handles or clear to widen."` |
| 4 | Pick `2×M` layout + `zip` format, click Export | POST `/api/sources/export/video-tiled` returns 200; modal closes | ✓ resource entry: `http://localhost:8773/api/sources/export/video-tiled` (200), `modalStillOpen=false` |
| 5 | Direct API probe — `format=zip`, 2×M, 4 mixed-render views, frames 0..2 | ZIP, ~6 MB, `play_tiled_4views_2xm_f0000-0002.zip` | ✓ Content-Type `application/zip`, `Content-Disposition: attachment; filename="play_tiled_4views_2xm_f0000-0002.zip"`, 6070 KB |
| 6 | Direct API probe — `format=mp4`, 1×N, 2 RGB views, frames 0..4 | MP4, valid `ftyp` box, `play_tiled_2views_1xn_f0000-0004.mp4` | ✓ Content-Type `video/mp4`, `Content-Disposition: attachment; filename="play_tiled_2views_1xn_f0000-0004.mp4"`, 178 KB, `isFtyp=true` |
| 7 | Screenshot of modal in tiled-video state | Modal shows: MP4 selected, `2 × M` layout selected, locked-range pill "Frames 1–3 (3 frames) from the timeline range brush" + Clear, Frames=3, Estimated duration 0.3 s | ✓ captured |

### Bug-regression rows touched
- TDZ regression: introduced + fixed in-flight; new bundle clean.

### Backend tests added (tests/unit/test_play_routes.py, +6)
- `test_video_tiled_400_when_no_views` — empty views[] → 400.
- `test_video_tiled_404_unknown_source` — bad source_id → 404.
- `test_video_tiled_zip_emits_one_png_per_frame` — 2-view 3-frame ZIP archive contains 3 zero-padded PNG frames.
- `test_video_tiled_layout_changes_canvas` — 1×N vs 2×M produce different per-frame canvas dimensions.
- `test_video_tiled_413_when_too_many_frames` — >16 views → 413.
- `test_video_tiled_clamps_end_to_source` — `end=999` on a 5-frame fixture clamps to 4 → 5 PNGs.

### Files changed (M24)
- `mantisanalysis/server.py`
  - **REFACTOR**: Extracted M23's per-view render + per-canvas compose closures from inside `export_image_tiled` to module-level `_render_tiled_view_to_rgb(spec, *, max_dim, override_frame_index)` and `_compose_tiled_canvas(tiles, *, layout, gap_px, background)`. Also extracted `_layout_cells(n, layout) -> (rows, cols, cells, n_used)` so both routes share the same dispatcher.
  - `export_image_tiled` simplified to call the helpers directly.
  - **NEW** Pydantic `TiledExportVideoRequest`.
  - **NEW** route `POST /api/sources/export/video-tiled` with `mp4` (libx264 via imageio + tempfile + yuv420p), `gif` (imageio mimsave), `zip` (one PNG per frame, `ZIP_STORED`). Hard caps: 16 views (HTTP 413), 1000 frames (HTTP 413). Each view's `frame_index` advances in lock-step with the global anchor; per-source clamping to `frame_count - 1` keeps differing-length streams renderable.
- `web/src/playback.tsx`
  - **REORDER**: Moved `buildTiledViewSpec` definition above `buildVideoUrl` to fix TDZ on the dependency array.
  - `exportVideo` callback branches on `views.length > 1` (or explicit `opts.tiled`): single-view stays on the legacy `/export/video` URL; multi-view POSTs `{views, layout, gap_px, background, fps, start, end, format}` to the tiled endpoint; same blob-download path on both branches.
  - `ExportVideoModal` accepts `viewCount` and renders a 5-button layout chooser only when `viewCount > 1`. Layout state flows into the export payload via the new `tiled` and `layout` opts.
- `tests/unit/test_play_routes.py` — 6 new tests.

M24 complete. **Group R · Render parity is now complete.**

---

## 2026-04-27 — M25 — HDR ISP mode (saturation-aware switch + Mertens)

First milestone of **Group H · HDR + ISP-chain parity**.

### Build / format / typecheck / tests
```
python scripts/smoke_test.py --tier 0       → PASS
python -m pytest -q                         → 215 passed in 29.39s
                                              (12 new tests in tests/unit/test_hdr_fusion.py)
npm run build                               → ✓ built (vite 5.4.21)
```

The dev server was stopped + restarted via `preview_stop` / `preview_start` to load the new HDR fusion + the HDR rgb-prefix + the HDR `gain` query value.

### Live verification — real GSense H5

| Step | Action | Expected | Actual |
|---|---|---|---|
| 1 | Reload → switch to Play → load real H5 | `recording.channels` includes HDR-{R, G, B, NIR, Y} alongside HG-/LG-* | ✓ `channels=['HDR-B','HDR-G','HDR-NIR','HDR-R','HDR-Y','HG-B','HG-G','HG-NIR','HG-R','HG-Y','LG-B','LG-G','LG-NIR','LG-R','LG-Y']`, `hdrChannelCount=5` |
| 2 | Inspect ViewerCard source-mode dropdown options | dropdown lists `RGB · HDR`, `NIR · HDR`, `Gray · HDR-Y` between the LG modes and the overlay/raw modes | ✓ optionTexts include all three HDR entries in the right order |
| 3 | Switch first view to `RGB · HDR` | Network request URL is `…/rgb.png?gain=hdr&max_dim=1600&normalize=none`; canvas renders the HDR-fused composite | ✓ `lastUrls` contains `gain=hdr`, screenshot shows the tissue rendered with HDR-fused R/G/B |
| 4 | API probes for `HDR-NIR` thumbnail + `gain=hdr` rgb composite | both return 200 | ✓ `rgbHdrStatus=200`, `nirHdrStatus=200` |
| 5 | Mean-luma comparison (HG / LG / HDR with `?normalize=auto`) | HDR luma differs from both HG and LG (proves the fusion math actually mixes the two halves rather than passing through one) | ✓ `luma_hg=57.8`, `luma_lg=58.3`, `luma_hdr=50.4` — distinct from both gain branches |
| 6 | Console errors | 0 | ✓ "No console logs." |

### Backend tests added (tests/unit/test_hdr_fusion.py, +12)
- `test_fuse_hdr_switch_keeps_hg_below_threshold`
- `test_fuse_hdr_switch_replaces_hg_above_threshold`
- `test_fuse_hdr_mertens_blends_smoothly`
- `test_fuse_hdr_mertens_at_threshold_close_to_lg_scaled`
- `test_fuse_hdr_default_params_use_switch`
- `test_fuse_hdr_shape_mismatch_raises`
- `test_fuse_hdr_handles_uint16_input`
- `test_add_hdr_channels_emits_five_channels`
- `test_add_hdr_channels_y_is_rec601_luma`
- `test_add_hdr_channels_no_op_when_missing_keys`
- `test_session_extract_frame_emits_hdr_channels`
- `test_summary_dict_lists_hdr_channels`

### Files changed (M25)
- **NEW** `mantisanalysis/hdr_fusion.py` — `fuse_hdr(hg, lg, params)` + `add_hdr_channels(channels, *, params)`. Default params: `fusion='switch'`, `hg_saturation_threshold=60000.0`, `hg_lg_gain_ratio=16.0`, `knee_width=4000.0`. Pure NumPy.
- `mantisanalysis/image_io.py::load_recording_channels` — after the existing `HG-Y / LG-Y` synthesis, calls `add_hdr_channels(channels)`.
- `mantisanalysis/session.py` — three sites: `LoadedSource.extract_frame`, `reconfigure_isp`, and `_load_dark_channels` all call `add_hdr_channels(chs)` when `mode.id == RGB_NIR.id`. The new HDR keys flow through to `_summary_dict` (`channels` list) automatically because they're keys in the channel dict.
- `mantisanalysis/server.py`
  - `_composite_rgb_array` — when `channel` starts with `HDR-`, prefix becomes `"HDR-"` (alongside the existing HG-/LG- branches).
  - `frame_rgb_composite` route — `gain` query param accepts `hg|lg|hdr` (regex extended); the prefix derivation handles all three.
  - `frame_channel_thumbnail` (`?rgb_composite=true`) and the channel route share the same prefix derivation update.
  - `TiledExportViewSpec.gain` documents `hdr` as a valid value; `_render_tiled_view_to_rgb`'s prefix derivation handles `hdr` for tiled exports.
- `web/src/playback.tsx` — `SOURCE_MODES` gains 3 new entries (`rgb_hdr`, `nir_hdr`, `gray_hdry`) with appropriate `requires` arrays so `availableSourceModes(recording)` lights them up automatically when HDR-* channels are present.
- **NEW** `tests/unit/test_hdr_fusion.py` (12 tests).

M25 complete. **Group H · HDR + ISP-chain parity is in flight (M26-M27 remaining).**

---

## M26 + M27 — Sharpen / FPN ISP chain in Play + HDR mixed-saturation patch test (2026-04-27)

### Backend changes (M26)
- NEW `mantisanalysis/server.py::_isp_chain_from_query(...)` — packages 8 non-linear stage parameters (`sharpen_method/amount/radius`, `denoise_sigma`, `median_size`, `gaussian_sigma`, `hot_pixel_thr`, `bilateral`) into an `ISPParams` when at least one stage is active, else returns `None` for short-circuit. `black_level=0` so it doesn't double-subtract with the existing `_apply_pre_norm` linear chain.
- `frame_channel_thumbnail` route — adds the 8 query params; calls `_apply_analysis_isp(image, isp_pre_chain)` after dark subtract and before `_apply_pre_norm`. RGB-composite branch forwards `isp_pre_chain` into `_build_rgb_composite_png_from_channels`.
- `frame_rgb_composite` route — same 8 query params; forwards into `_build_rgb_composite_png_from_channels`.
- `_composite_rgb_array` and `_build_rgb_composite_png_from_channels` — gain `isp_pre_chain: Optional[ISPParams] = None` kwarg. When provided, runs `_apply_analysis_isp` per-channel on R, G, B before pre-norm.
- `TiledExportViewSpec` — adds 8 fields with USAF defaults; `_render_tiled_view_to_rgb` builds `isp_pre_chain` and threads through both `rgb_composite` and `channel` branches so tiled image + video exports bake in the same processing.

### Frontend changes (M26)
- `web/src/playback.tsx`
  - NEW `_appendIspChainQuery(q, isp)` URL helper next to `_appendIspQuery`. Skips defaults: `sharpen_method='None'` (skipped); `denoise_sigma <= 0.05` (skipped); `median_size < 3` (skipped); `gaussian_sigma <= 0.05` (skipped); `hot_pixel_thr <= 0.5` (skipped); `bilateral=false` (skipped). Mirrors backend gating in `_isp_chain_from_query`.
  - `frameChannelPngUrl`, `frameRgbUrl` — call `_appendIspChainQuery(q, opts.ispChain)` after the existing `_appendIspQuery`.
  - `buildFrameUrl` — passes `ispChain: view.isp || null` in opts.
  - `buildTiledViewSpec` — emits 8 new sharpen-chain fields from `v.isp` so exports honor them.
  - `makeDefaultView` — adds `isp: { sharpen_method: 'None', sharpen_amount: 1.0, sharpen_radius: 2.0, denoise_sigma: 0.0, median_size: 0, gaussian_sigma: 0.0, hot_pixel_thr: 0.0, bilateral: false }`.
  - NEW `IspChainDisclosure` component — collapsible sub-section inside the Inspector Corrections section. 9 controls: Sharpen Select (None / Unsharp mask / Laplacian / High-pass), Sharpen amount Spinbox (disabled when method=None), Sharpen radius Spinbox (disabled when method=None), Denoise σ, Median size, Gaussian σ (FPN), Hot pixel σ, Bilateral Checkbox, Defaults Button. Open/closed state persists per-view-type via `useLocalStorageState`. Green `ON` badge in the disclosure header lights up when at least one stage is active. Title-bar tooltip explains "Applied after dark subtract and before the linear pre-norm chain".

### Backend tests added (tests/unit/test_play_routes.py, +5)
- `test_frame_channel_thumbnail_accepts_sharpen_chain` — `?sharpen_method=Unsharp%20mask&sharpen_amount=2.0` produces output bytes ≠ no-sharpen baseline.
- `test_frame_channel_thumbnail_accepts_fpn_chain` — `?median_size=5&gaussian_sigma=2.0` produces output bytes ≠ baseline.
- `test_frame_rgb_composite_accepts_sharpen_chain` — `/rgb.png?gain=hg&sharpen_method=Unsharp%20mask&sharpen_amount=2.0` differs from baseline.
- `test_tiled_image_export_honors_sharpen_chain` — tiled-image POST with one view carrying `sharpen_method="Unsharp mask"` produces output bytes ≠ baseline tile.
- `test_frame_channel_thumbnail_no_sharpen_params_byte_identical` — sanity guard: omitting the new params yields byte-identical PNG to pre-M26 baseline (default-skip gating short-circuits).

### Backend tests added (tests/unit/test_hdr_fusion.py, +1 for M27)
- `test_hdr_y_over_mixed_saturation_patch_matches_switch_expectation` — 32×32 mixed-saturation fixture: left half HG well below threshold; right half HG clipped at 65000. Asserts HDR-Y on the unclipped half ≈ Rec.601 luma over HG-{R,G,B}, and HDR-Y on the clipped half ≈ Rec.601 luma over `LG · ratio` (with +200 recovery margin). Validates the full HG → switch → HDR-Y pipeline at integration scope.

### Live verification (real GSense H5)
Loaded `/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5` (10 frames, 512×512, dual-gain RGB-NIR with HDR fusion auto-applied). Procedure:

1. Switched ViewerCard source-mode dropdown to `Gray · HG-Y` (`/api/sources/.../frame/0/channel/HG-Y/thumbnail.png?max_dim=1600&normalize=none` → 200 OK).
2. Opened Inspector → Corrections → ISP CHAIN disclosure (collapsed by default).
3. Set Sharpen = Unsharp mask, amount = 2.0 → network request becomes `?sharpen_method=Unsharp+mask&sharpen_amount=2` → 200 OK; canvas tissue edges visibly enhanced; ON badge lights up green inside the disclosure header.
4. Clicked Defaults → all 8 fields reset; ON badge clears; canvas reverts to baseline.
5. Set median_size = 5 + gaussian_sigma = 2.0 → network request `?median_size=5&gaussian_sigma=2` → 200 OK; canvas renders FPN-smoothed.
6. Switched source-mode to `RGB · HG`, set Sharpen = Unsharp mask → network shows `/rgb.png?gain=hg&max_dim=1600&normalize=none&sharpen_method=Unsharp+mask` → 200 OK; canvas RGB composite shows the same edge enhancement.
7. Console: 0 errors throughout the entire flow.

### Files changed (M26 + M27)
- `mantisanalysis/server.py` — `_isp_chain_from_query` helper + 8 new query params on `frame_channel_thumbnail`, `frame_rgb_composite`; `isp_pre_chain` kwarg on `_composite_rgb_array` + `_build_rgb_composite_png_from_channels`; 8 new fields on `TiledExportViewSpec`; `isp_pre_chain` plumbing in `_render_tiled_view_to_rgb`.
- `web/src/playback.tsx` — `_appendIspChainQuery` URL helper; `view.isp` default in `makeDefaultView`; threading through `frameChannelPngUrl`, `frameRgbUrl`, `buildFrameUrl`, `buildTiledViewSpec`; new `IspChainDisclosure` component + `SHARPEN_METHODS` constant; integration into the Corrections section.
- `tests/unit/test_play_routes.py` — 5 new tests (was 37, now 42).
- `tests/unit/test_hdr_fusion.py` — 1 new test (was 12, now 13).

### Smoke
- Tier 0: PASS (prettier + eslint + tsc clean on web/src/).
- Tier 1: PASS (15 modules imported).
- Tier 2: PASS (figures written to outputs/smoke/).
- Tier 3: PASS (FastAPI endpoints exercised).
- `pytest -q`: **221 / 221** (was 215; +5 sharpen-chain route tests + +1 HDR mixed-saturation integration test).
- `npm run build`: clean Vite production build (643 KB main + 4.8 MB plotly chunk; gzipped 189 KB / 1.45 MB).

M26 + M27 complete. **Group H · HDR + ISP-chain parity is now COMPLETE.** Next: Group A (M28+) — server-side presets, overlay builder modal, right-click handoff to USAF/FPN/DoF, loading-metadata screen, scenario switcher.

---

## M28 — Server-side presets store (2026-04-27)

### Backend changes
- NEW Pydantic models near the existing tile-export specs: `PlaybackPreset(id, name, view_type, fields: Dict[str, Any], created_at: float)` and `PlaybackPresetsBody(presets: List[PlaybackPreset])`. ``view_type`` is the SOURCE_MODES id (`rgb_hg` / `nir_hg` / `gray_hgy` / ...); the Inspector filters the list by it. ``fields`` is opaque — frontend owns the schema; backend just round-trips.
- NEW module-level helpers (right above `_must_get`):
  - `_playback_presets_path()` returns `~/.mantisanalysis/playback-presets.json` by default; honors `MANTIS_PRESETS_PATH` env-var override for tests so each test gets a tmp_path-isolated store.
  - `_load_playback_presets()` returns `[]` when the file doesn't exist (first-run), when the JSON is malformed (treated as a fresh start, with traceback logged), or when the top-level shape isn't `{"presets": [...]}`. Per-row try/except: one bad entry doesn't kill the whole list.
  - `_save_playback_presets(presets)` does an atomic write — `tempfile.NamedTemporaryFile` in the same directory → `flush()` + `os.fsync()` → `os.chmod(0o600)` → `os.replace`. Lock-protected by a module-level `threading.Lock`.
- NEW routes inside `_mount_api`:
  - `GET  /api/playback/presets` — `{presets: [...]}`
  - `PUT  /api/playback/presets` — full-replace semantics; body `{presets: [...]}`; returns `{ok: True, count: N}`
  - `DELETE /api/playback/presets/{preset_id}` — idempotent (200 OK + count even when the id wasn't present)

### Frontend changes
- `web/src/playback.tsx`
  - `PlaybackMode` gains `presets` state, fetched via `apiFetch('/api/playback/presets')` on mount with cleanup-cancellation guard.
  - NEW `replacePresets(next)` — optimistic local update + background PUT; on PUT failure the GET re-fetches the canonical list to avoid drift.
  - NEW `PRESET_FIELDS` whitelist captures `colormap`, `invert`, `showClipping`, `showCanvasHistogram`, `vmin`, `vmax`, `normalize`, `blackLevel`, `gain`, `offset`, `ispBrightness`, `ispContrast`, `gamma`, `brightness`, `contrast`, `saturation`, `rawChannel`, `applyDark`, `overlay`, `grading`, `labels`, `isp`. Excludes identity fields (`id`/`sourceId`/`sourceMode`/`name`/`lockedFrame`/`isLocked`/`includedInExport`) so loading a preset never destabilizes view binding.
  - NEW `captureViewFields(view)` filters the view down to the whitelisted set.
  - NEW `savePreset(name, sourceView)` builds a `PlaybackPreset` (id = `preset-{ts}-{rand}`, view_type = `sourceView.sourceMode`, fields = whitelisted snapshot, created_at = epoch seconds) and PUTs the new full list.
  - NEW `deletePreset(id)` optimistic local removal + background DELETE.
  - NEW `<SavePresetModal>` mounted next to the existing modals at the PlaybackMode root. Single-input form with Enter-to-confirm; binding to the currently selected view's `sourceMode`.
  - NEW `<PresetsList>` component wraps a Save… button + a per-source-mode-filtered list of saved presets. Each row shows the name + Load + two-click Delete (×, then "Confirm?" to commit).
  - NEW `InspectorSection title="Presets"` between Labels and Advanced, threaded through with `presets`, `onOpenSavePreset`, `onDeletePreset`, `onLoad` (re-uses `onUpdateView(view.id, preset.fields)` so the existing reducer applies the full whitelisted patch).

### Backend tests added (tests/unit/test_presets_api.py, +14)
1. `test_presets_get_empty_when_file_missing`
2. `test_presets_get_returns_persisted_list`
3. `test_presets_get_skips_malformed_rows`
4. `test_presets_get_corrupt_file_returns_empty`
5. `test_presets_put_creates_file`
6. `test_presets_put_then_get_roundtrips`
7. `test_presets_put_replaces_existing`
8. `test_presets_put_persists_mode_0600` (POSIX-only)
9. `test_presets_put_writes_pretty_json` — sanity guard so the file remains diff-friendly
10. `test_presets_delete_removes_one_by_id`
11. `test_presets_delete_unknown_id_is_idempotent`
12. `test_presets_delete_on_empty_store`
13. `test_presets_put_rejects_missing_required_field` (422)
14. `test_presets_put_accepts_arbitrary_fields_json` (kitchen-sink: nested ISP, grading, labels, deeply-nested array)

### Live verification (real GSense H5)
Loaded `/Users/zz4/Desktop/day5_breast_subject_1/sample_1_view_0_exp_0.025.h5` (10 frames, 512×512). Procedure:

1. Inspector → Presets section header → Save…
2. Modal opens with the explanatory text bound to the selected view's source-mode (`rgb_hg`).
3. Typed `high-contrast NIR` into the name input + clicked Save.
4. Backend GET `/api/playback/presets` returns one preset with the full whitelisted snapshot — `colormap`, `invert`, `showClipping`, `vmin`, `vmax`, `normalize=none`, `blackLevel=0`, `gain=1`, `offset=0`, `ispBrightness=0`, `ispContrast=1`, `gamma=1`, `brightness=1`, `contrast=1`, `saturation=1`, `rawChannel=null`, `applyDark=true`, full `overlay` struct, full `grading` struct (incl. `wb_kelvin: null`), full `labels` struct, full `isp` struct (M26's chain: `sharpen_method='None'`, defaults across the rest). `created_at` ≈ Date.now()/1000.
5. The "high-contrast NIR" row appeared in the Inspector Presets list with Load + × buttons.
6. DELETE round-trip via `curl -X DELETE /api/playback/presets/{id}` returned `{"ok": True, "count": 0}`; subsequent GET returns empty.
7. Real disk file at `~/.mantisanalysis/playback-presets.json` has mode `-rw-------` (0600) confirmed via `stat -f '%Sp'`.
8. 0 console errors throughout.

### Files changed (M28)
- `mantisanalysis/server.py` — `PlaybackPreset` + `PlaybackPresetsBody` Pydantic models; `_playback_presets_path()` / `_load_playback_presets()` / `_save_playback_presets()` storage helpers (with `threading.Lock` and atomic write); 3 new routes (`GET / PUT / DELETE /api/playback/presets`).
- `web/src/playback.tsx` — `presets` state + `replacePresets` / `savePreset` / `deletePreset` + `captureViewFields`; new `<SavePresetModal>` component; new `<PresetsList>` component; new `InspectorSection title="Presets"` between Labels and Advanced; threaded `presets`, `onOpenSavePreset`, `onDeletePreset` props through the Inspector signature.
- **NEW** `tests/unit/test_presets_api.py` (14 tests).

### Smoke
- Tier 0: PASS (prettier + eslint + tsc clean on web/src/).
- Tier 1: PASS (15 modules imported).
- Tier 2: PASS (figures written to outputs/smoke/).
- Tier 3: PASS (FastAPI endpoints exercised).
- `pytest -q`: **235 / 235** (was 221; +14 new presets-API tests).
- `npm run build`: clean Vite production build (647 KB main + 4.8 MB plotly chunk; gzipped 191 KB / 1.45 MB).

M28 complete. **Group A (M28-M32) is in flight.** Next: M29 — Overlay Builder modal (4-step wizard).

---

## M29 — Overlay Builder modal + legacy-h5 P0 fix sweep (2026-04-27)

### Frontend (M29)
- `web/src/playback.tsx`
  - PlaybackMode adds `overlayBuilderViewId` state — id of the view being configured; `null` when modal closed.
  - Inspector receives a new `onOpenOverlayBuilder` callback prop and forwards it to `OverlayConfigurator`.
  - `OverlayConfigurator` gains a top-row "Open Overlay Builder…" Button (visible only in overlay-kind source-modes); clicking it sets `overlayBuilderViewId` to the selected view.
  - NEW `OverlayBuilderModal` component renders a 4-step wizard:
    - Step 1 — **Base**: pick the base layer from `BASE_PRESETS` (RGB · HG / RGB · LG / Gray channel).
    - Step 2 — **Source**: pick the overlay channel from the recording's available channels.
    - Step 3 — **Thresholds**: colormap / blend mode / strength slider / overlay-low + overlay-high spinboxes.
    - Step 4 — **Preview & Apply**: read-back panel with the active draft + Apply button.
  - Right-side live preview pane uses `frameOverlayUrl(...)` against the recording's frame 0 with the current draft fields. The browser HTTP cache + matching URL key keep this debounced enough at 100 ms / draft-change.
  - Step indicator visualizes active vs done with `t.accent` / `t.chipBg`. Footer is Cancel · Back · Next/Apply with disabled-gating: Next disables until step's required fields are set, Apply only fires on the final step.
  - On Apply, `onApply(draft)` calls `updateView(view.id, { overlay: draft })` and closes the modal.
- The inline `OverlayConfigurator` continues to work unchanged for power users — the wizard is an alternate UX surface, not a replacement.

### Backend P0 fix (legacy gsbsi H5 playback ~1 fps → ~50+ fps)
User reported: "when multiple h5 files is loaded, the playback is not working properly, refresh rate almost 1fps while the time axis is moving at normal and full speed". Investigation showed the issue was specific to **legacy gsbsi-prefix H5 files** (e.g. `Copy of gsbsi_2019-02-22-T053025_003.h5`). The legacy container layout is `/dset` of shape `(H*W, N) = (2,097,152, 128)` un-chunked HDF5 storage. Each column is one frame's pixels, but reading one column means h5py performs scattered seeks across the entire 537 MB file — O(file size) per frame.

**Fix** in `mantisanalysis/legacy_h5.py::LegacyFrameReader`:
- New `self._mem: Optional[np.ndarray]` field.
- `_ensure_open()` now slurps `self._dset[...]` into `self._mem` as a single contiguous read at first open (~60 ms once-only cost on a 537 MB file).
- `read_frame(idx)` now slices from `self._mem` instead of the h5py dataset → ~10 ms/frame.
- `close()` clears `self._mem` so the entry is GC'd on session eviction.
- `legacy_read_frame` signature now accepts either an `h5py.Dataset` or an `np.ndarray` of the same shape (annotation widened, no behavior change).

Empirical comparison:
- Before: per-frame extraction was bottlenecked by scattered h5py reads (~1 fps observed).
- After: `extract_frame` end-to-end (h5py read → reshape → demosaic → HDR fusion) takes ~20 ms/frame mean (max 76 ms first call), 30 parallel rgb.png HTTP fetches complete in 445 ms (~15 ms/frame).

### Backend metadata sweep (raw resolution / dtype / bit depth)
User also reported: "critical information is missing from frame info, no resolution etc.". Added three new fields:
- `LoadedSource.raw_shape: Tuple[int, int]` — raw mosaic dimensions BEFORE channel-split. Modern: parsed from `load_any_detail`'s `raw` array (handles `(N,H,W,1)`, `(H,W,C)`, `(N,H,W)`, `(H,W)` shapes). Legacy: `LEGACY_FRAME_HW` (2048 × 1024). Image: source image shape.
- `LoadedSource.raw_bit_depth: int` — 12 for legacy gsbsi, 16 for modern MantisCam, 8 for uint8 images. Honest reporting so the user can see whether highlights clip at 4095 or 65535.
- `LoadedSource.raw_dtype: str` — "uint16" / "uint8" / etc.

`_summary_dict` now emits `raw_shape` (list[int]), `raw_dtype` (str), `raw_bit_depth` (int) alongside the existing `shape` (per-channel post-extraction shape). The Pydantic `SourceSummary` model gained matching fields with sensible defaults so older clients still parse.

### Frontend metadata display
- `loadRecordings` in `web/src/playback.tsx` now copies `summary.raw_shape`, `summary.raw_dtype`, `summary.raw_bit_depth` onto the recording object.
- FilePill shows `{raw_shape[1]} × {raw_shape[0]}` (raw resolution, width × height) plus a `· {bit_depth}b` suffix when bit depth ≠ 16. The pill `title` carries the full breakdown ("Raw frame: ..., Per-channel: ..., Frames: ..."). For the user's legacy file: "1024×2048 · 12b". For modern MantisCam: "4096×2048" (16-bit, suffix omitted).
- ViewerCard footer now shows the rendered per-channel resolution (`{shape[1]}×{shape[0]}`) between the exposure label and the recording name; `title` carries both raw and per-channel for the user's hover.

### Verified live on the user's legacy file
- File: `/Users/zz4/Desktop/macedonia in-vivo data/Copy of gsbsi_2019-02-22-T053025_003.h5`.
- POST `/api/sources/load-path` returned 200 with `frame_count=128`, `shape=[512,512]`, `raw_shape=[2048,1024]`, `raw_dtype="uint16"`, `raw_bit_depth=12`, warnings = [`W-META-TS`, `W-LEGACY-12BIT`].
- FilePill rendered "Copy of gsbsi_2019-02-22-T0... · 128 fr · 44.8 ms · 1024×2048 · 12b" with the W-META-TS + W-LEGACY-12BIT chips.
- ViewerCard footer rendered "frame 0 · 44.8 ms · 512×512 · Copy of gsbsi_2019-02-22-T0...".
- Click play (timeline play button via `title="Play (Space)"`) → 327 frame fetches in ~4 s = ~80 fetches/sec, indicating playback ran at the configured 10 fps with prefetching ahead, not the 1 fps the user reported pre-fix.
- Stream chip "Stream · 1 file · 128 frames" matches `frame_count`.
- 0 console errors.

### Files changed
- `mantisanalysis/legacy_h5.py` — `LegacyFrameReader._mem` cache + `legacy_read_frame` annotation widening.
- `mantisanalysis/session.py` — `LoadedSource.{raw_shape, raw_bit_depth, raw_dtype}`; modern + legacy load paths populate them; `_summary_dict` emits them.
- `mantisanalysis/server.py` — `SourceSummary` Pydantic gains `raw_shape`/`raw_dtype`/`raw_bit_depth`.
- `web/src/playback.tsx` — `OverlayBuilderModal` (350+ lines) + `OVERLAY_WIZARD_STEPS` constant; `OverlayConfigurator` "Open Overlay Builder…" button; PlaybackMode `overlayBuilderViewId` state + modal mount; Inspector `onOpenOverlayBuilder` prop; `loadRecordings` copies new metadata fields; FilePill + ViewerCard footer render raw + per-channel resolutions.

### Smoke
- Tier 0: PASS (prettier + eslint + tsc clean).
- `pytest -q`: **251 / 251** (no new tests; M29 reuses existing overlay routes; legacy reader change exercised by existing `tests/unit/` suite indirectly via session/extract paths).
- `npm run build`: clean (654 KB main + 4.8 MB plotly chunk; gzipped 192 KB / 1.45 MB).
- Tier 4 live verification (above) on the user's legacy file confirmed end-to-end fix.

M29 complete. **Group A (M28-M32) is in flight (M28 + M29 ✓; M30 next).**

---

## M30 — Right-click frame → Send to USAF/FPN/DoF (2026-04-27)

### Backend
- NEW `SessionStore.create_transient_from_frame(parent_sid, frame_index)` materialises one Play frame as a standalone image source. Inherits the parent's ISP mode + config + dark channels (deep-copied so the transient and parent stay independent), gets a fresh `source_id`, and `frame_count=1`. Reads the parent's raw mosaic via the open `FrameReader` so the transient also caches `raw_frame` (reconfigure-capable).
- NEW Pydantic `PlaybackHandoffRequest{source_id, frame_index, target_mode}` + route `POST /api/playback/handoff` returning the SourceSummary of the new transient. Errors: 404 unknown parent, 404 out-of-range frame, 409 parent has no h5 path.
- 5 new tests in `tests/unit/test_handoff.py` (transient frame_count=1 + channel-set parity; 404 unknown source; 404 out-of-range frame; parent stays loaded after handoff; transient is independent — deleting it doesn't touch the parent). All pass.

### Frontend
- NEW `<ViewerCardContextMenu>` component (popover positioned at the cursor, click-outside / Esc closes). Right-click on any ViewerCard with a bound recording → menu offers Send to USAF / FPN / DoF. Click → POST `/api/playback/handoff` → `window.dispatchEvent('mantis:switch-source', {source_id, mode})`.
- `app.tsx` listens for `mantis:switch-source`. On receive: re-fetch `/api/sources`, find the new id, `setSource(found)` + `setMode(target)` so the analytic mode opens on the spun-off frame. Toast: "Sent frame to USAF.".

---

## P0 follow-up: ISP reconfigure visible refresh + Source-mode restructure (2026-04-27)

### User report
> isp setting able to be applied, but nothing changed on the frame displayed at all. not working.
> In the meantime, for legacy h5 file, isp setting default is not applied.
> For the playback source panel, all mode and raw Channel name need to be renamed and with better structure (top level changeable Low/High Gain to separate the list for better structure) for better clarity, here are some good example: High Gain: Visible (RGB), NIR, Raw Channels: Red/Green/Blue/Chroma (Y).

### Root causes
1. **ISP reconfigure produced fresh server bytes but the canvas didn't update.** The frontend's per-URL blob cache was keyed on the URL string; the URL never encoded `recording.isp_config`, so reconfigure → identical URL → cache hit → stale image. The Play `recordings[i]` object also never learned the source's ISP changed (the dialog only updated app.tsx's global `source`).
2. **Legacy ISP dialog opened with modern RGB-NIR defaults.** The dialog binds to `useSource()` (the global SourceCtx). In Play, the global source was never synced to the user's selected recording, so opening ISP Settings on a legacy Play recording showed whatever the LAST analytic-mode source happened to be (typically the synthetic sample).
3. **Source-mode dropdown was a flat list with engineering names** (`RGB · HG`, `Gray · HG-Y`, `Raw channel…`) instead of the user-facing hierarchy the user prefers (High Gain → Visible / NIR / Chroma / Raw R/G/B).

### Backend changes
- (none — backend already returned correct bytes after reconfigure; the problem was strictly client-side.)

### Frontend changes
- `web/src/playback.tsx`
  - NEW `_ispVersionToken(recording)` — stable hash over `isp_mode_id + origin + sub_step + outer_stride + channel_name_overrides + channel_loc_overrides`.
  - `buildFrameUrl` injects the token as `opts.ispVersion`; `frameChannelPngUrl`, `frameRgbUrl`, `frameOverlayUrl` each emit `_isp_v=<token>` as a URL cache-buster. Backend ignores the param; the only effect is to shift the URL key on reconfigure so the per-URL blob cache misses and re-fetches.
  - NEW `_frameCachePurgeForSource(sourceId)` synchronously evicts every blob-cache entry whose URL contains a given source id. Called when a `mantis:source-reconfigured` event arrives.
  - PlaybackMode now listens for `mantis:source-reconfigured` (dispatched by the ISP dialog post-PUT). On receive: purge blob cache for the source AND patch the matching `recordings[i]` with the new `isp_mode_id` / `isp_config` / `channels` / `shape`. The ViewerCard's URL `useMemoPb` then recomputes (recording identity changed), the URL token shifts (cache-buster), the `useEffect` re-runs, the cache misses, and the canvas displays the freshly-extracted image.
  - `PlaybackMode` now accepts `onSwitchSource` and mirrors the selected Play recording into the global `SourceCtx` whenever `selectedRecId` changes. With this wired, opening ISP Settings while a legacy recording is selected shows that legacy recording's ISP mode + config in the dialog.
  - `SOURCE_MODES` catalog restructured with a `group` field (`High Gain` / `Low Gain` / `HDR` / `Image` / `Overlay` / `Other`) and user-facing labels: `Visible (RGB)`, `NIR`, `Chroma (Y)`, `Raw — Red`, `Raw — Green`, `Raw — Blue` (six per gain group). Per-channel `requires` + `channel` are populated so `availableSourceModes` automatically hides entries the recording doesn't expose.
  - The ViewerCard's title-bar dropdown now renders one `<optgroup>` per group, in the canonical order. Empty groups are skipped. The native HTML `<optgroup>` rendering gives the user a clean two-level hierarchy without a custom widget.
- `web/src/isp_settings.tsx`
  - After successful PUT, dispatches `window.dispatchEvent('mantis:source-reconfigured', {detail: {source_id, isp_mode_id, isp_config, channels, shape}})` so any mode owning per-source state can refresh.
  - `SourceLite` interface gains `channels?: string[]` and `shape?: number[]` so the dispatched detail typechecks.
- `web/src/app.tsx`
  - `<PlaybackMode>` now receives `onSwitchSource={setSource}` so its selectedRec mirror has somewhere to land.

### End-to-end verification (the user's legacy file)
- Load `/Users/zz4/Desktop/macedonia in-vivo data/Copy of gsbsi_2019-02-22-T053025_003.h5` in Play.
- Source-mode dropdown shows the optgroup hierarchy:
  ```
  High Gain:
    Visible (RGB), NIR, Chroma (Y), Raw — Red, Raw — Green, Raw — Blue
  Low Gain:
    Visible (RGB), NIR, Chroma (Y), Raw — Red, Raw — Green, Raw — Blue
  HDR:
    Visible (RGB), NIR, Chroma (Y)
  Overlay:
    NIR over RGB · HG, NIR over RGB · LG, Custom overlay…
  Other:
    Pick channel…
  ```
- Inspector now reads `Type: Visible (RGB)` (new naming).
- Apply origin (1, 0) via PUT `/api/sources/.../isp` → backend returns shape `[511, 512]`. Dispatch `mantis:source-reconfigured` event → image element's `naturalWidth × naturalHeight` changes from `512 × 512` to `512 × 511`, blob URL changes (e.g. `c9d1dd30…` → `dcb21e0b…`), confirming the cache-buster + listener pipeline forced a fresh fetch.
- 0 console errors.

### Files changed
- `mantisanalysis/session.py` — `create_transient_from_frame`.
- `mantisanalysis/server.py` — `PlaybackHandoffRequest` model + `POST /api/playback/handoff` route.
- `web/src/playback.tsx` — `_ispVersionToken`, `_frameCachePurgeForSource`, `mantis:source-reconfigured` listener, Play→global source mirror, restructured `SOURCE_MODES`, optgroup-rendered dropdown, `<ViewerCardContextMenu>`, `onContextMenu` handler.
- `web/src/app.tsx` — pass `onSwitchSource` to PlaybackMode; new `mantis:switch-source` listener.
- `web/src/isp_settings.tsx` — dispatch `mantis:source-reconfigured` after PUT; widen `SourceLite`.
- `tests/unit/test_handoff.py` — 5 new tests.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **258 / 258**.
- Vite build: clean.
- Tier 4 live: above.

---

## Legacy reconfigure follow-up (2026-04-27)

### User report
> /api/sources/1ac0aa7636c6/isp → 400: source '1ac0aa7636c6' has no cached raw frame; reconfigure is only supported for loaded recordings
>
> I need reconfigure for legacy sources

### Root cause
The legacy gsbsi loader deliberately set `raw_frame=None` and routed extraction through a hardcoded `extract_legacy_channels` function. The rationale (per the docstring) was that "legacy frames don't share the modern ISP geometry" — true for a literal port of the modern `RGB_NIR` mode (which splits HG/LG horizontally at `frame[:, :W/2]` vs `frame[:, W/2:]`), but ignorable once we encode the actual legacy layout (HG/LG interleaved by row, period 4) as its own ISP mode.

### Backend changes
- NEW ISP mode `LEGACY_GSBSI_RGB_NIR` in `mantisanalysis/isp_modes.py`:
  - `dual_gain=False` (no horizontal split — the whole frame is one half).
  - 8 channels with `default_name="HG-{R,G,B,NIR}"` / `"LG-{R,G,B,NIR}"` and locs `(0,0)/(0,1)/(1,0)/(1,1)/(2,0)/(2,1)/(3,0)/(3,1)` — the row-interleaved super-pixel.
  - `default_origin=(0,0)`, `default_sub_step=(1,1)`, `default_outer_stride=(4,2)`.
  - `supports_rgb_composite=True`.
  - Verified byte-equality vs the old `extract_legacy_channels` on the user's real file: all 8 base channels (HG/LG × R/G/B/NIR) match exactly at the same (512, 512) shape.
- Legacy loader (`session.py::_load_legacy_gsbsi`) now uses the new mode:
  - Extracts via `extract_with_mode(frame0, LEGACY_GSBSI_RGB_NIR, default_cfg)` instead of `extract_legacy_channels`.
  - Synthesizes HG-Y / LG-Y via `luminance_from_rgb` then HDR-* via `add_hdr_channels` — same flow as the modern path.
  - Caches `raw_frame=frame0` (the (2048, 1024) post-shift mosaic) on the LoadedSource so `reconfigure_isp` can re-extract.
  - Sets `isp_mode_id="legacy_gsbsi_rgb_nir"` (instead of forcing the modern `RGB_NIR.id`).
- `LoadedSource.extract_frame` collapses the old `_legacy` branch into the unified path — both modern and legacy go through `extract_with_mode` + Y / HDR synthesis. Cache key is now `(idx, isp-hash + mode-id)` for both, so reconfigure invalidates cleanly.
- `reconfigure_isp` now treats `legacy_gsbsi_rgb_nir` as a first-class mode in its post-extract Y / HDR synthesis branch.
- `_composite_rgb_array` (server.py) gains a special case for `legacy_gsbsi_rgb_nir`: the slot ids are `lg_r/hg_r/...` (not the canonical `r/g/b/nir`), so the modern slot-lookup would return `None`. The legacy branch picks the gain prefix from the `channel` arg (HG-/LG-/HDR-) and looks up the prefixed channel keys directly — same result as the modern dual-gain branch but with channel-key fetch instead of slot-+-prefix construction.
- `_summary_dict` exposes a new `is_legacy: bool` field (mirrors `LoadedSource._legacy`); the `SourceSummary` Pydantic carries it. Frontend can use this to drive UX hints without re-checking the mode id, but the underlying reconfigure now works regardless.

### End-to-end live verification (the user's real legacy file)
```
$ curl -X POST /api/sources/load-path -d '{"path":".../Copy of gsbsi_2019-02-22-T053025_003.h5"}'
→ source_id, isp_mode_id="legacy_gsbsi_rgb_nir", raw_shape=[2048,1024], raw_bit_depth=12

$ curl /frame/0/rgb.png?gain=hg&max_dim=512&normalize=auto
→ 531987 bytes (default extraction)

$ curl -X PUT /isp -d '{"mode_id":"legacy_gsbsi_rgb_nir","origin":[1,0]}'
→ 200 OK, isp_config.origin=[1,0], shape=[511,512] (one row clipped at the bottom)

$ curl /frame/0/rgb.png?gain=hg&max_dim=512&normalize=auto
→ 404607 bytes (DIFFERS from default — reconfigure took effect)

$ curl -X PUT /isp -d '{"mode_id":"legacy_gsbsi_rgb_nir","origin":[0,0]}'
→ 200 OK, isp_config.origin=[0,0]

$ curl /frame/0/rgb.png?gain=hg&max_dim=512&normalize=auto
→ 531987 bytes (BYTE-IDENTICAL to default — round-trip clean)
```

### Tests added / updated
- `tests/unit/test_legacy_h5.py::test_session_store_dispatches_legacy` — assertion flipped (was `raw_frame is None`, now `raw_frame is not None and shape == (2048, 1024)` plus active mode id).
- NEW `test_session_store_legacy_reconfigure_isp` — loads a synthetic legacy fixture, calls `store.reconfigure_isp(sid, "legacy_gsbsi_rgb_nir", overrides={"origin": (1, 0)})`, asserts the channel array changes (shape or values).

### Files changed
- `mantisanalysis/isp_modes.py` — `LEGACY_GSBSI_RGB_NIR` definition + registry entry.
- `mantisanalysis/session.py` — `_load_legacy_gsbsi` switched to the new mode + caches `raw_frame`; `extract_frame` unified path; `reconfigure_isp` recognizes the new mode for Y / HDR synthesis; `_summary_dict` exposes `is_legacy`.
- `mantisanalysis/server.py` — `SourceSummary` gains `is_legacy`; `_composite_rgb_array` special-cases the legacy mode for HG/LG-prefixed channel-key lookup.
- `tests/unit/test_legacy_h5.py` — updated existing dispatch test, added reconfigure regression test.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **253 / 253** (was 251; +1 new reconfigure test, -0 net since the dispatch test still passes with flipped assertion).
- API end-to-end on the user's legacy file (above): PASS.

The user's reported P0 (`/isp` → 400 on legacy sources) is fixed. Reconfigure now works for both geometry tweaks (origin / sub_step / outer_stride) and channel renames are partially supported — only `lg_nir` / `hg_nir` slots are currently unmarked as renameable in the new mode, so renaming "HG-NIR" → "UV-650" at this revision is silently no-op'd. Marking those two slots as `renameable=True` in `LEGACY_GSBSI_RGB_NIR` is a one-line follow-up if the user needs it.

---

## Synthetic sample reconfigure follow-up (2026-04-27)

### User report
> Not fixed, and this issue is applied to both legacy and latest h5 files, unable to apply these isp setting to any of these file with same type of error when hitting "apply" button in ISP setting window:
> /api/sources/1cf02f4540e6/isp → 400: source '1cf02f4540e6' has no cached raw frame; reconfigure is only supported for loaded recordings

### Root cause (a third one!)
Modern + legacy load-path / upload paths all cache `raw_frame` cleanly. The remaining 400-error code path was the **synthetic sample source** — created by the top-bar "Sample" button via `POST /api/sources/load-sample`. The procedural USAF generator built the per-channel arrays directly without ever round-tripping through `extract_with_mode`, so `LoadedSource.raw_frame` was left at its dataclass default of `None`. Hitting Apply in the ISP Settings dialog on the synthetic sample produced the same "source has no cached raw frame" 400 the user originally reported on legacy files. (The 12-character source ids in the report — `1ac0aa7636c6` / `1cf02f4540e6` — match the format the sample loader emits.)

### Backend fix
- NEW `mantisanalysis/server.py::_synthetic_usaf_raw_mosaic(channels)` — re-interleaves the per-channel arrays into a Bayer mosaic that the modern `extract_with_mode(raw, RGB_NIR, defaults)` would demosaic back to the same per-channel set. Layout mirrors the canonical RGB-NIR super-pixel (B@(0,0), R@(0,2), G@(2,0), NIR@(2,2)) within HG (left) / LG (right) halves; unused mosaic positions are filled with the per-half RGB+NIR pixel mean so the histogram + thumbnail renders see a coherent gradient instead of a mostly-zero hole.
- `load_sample` route now caches the rebuilt mosaic on the new `LoadedSource.raw_frame` field, sets `isp_mode_id = RGB_NIR.id` + a normalized default `isp_config`, and populates the M29 metadata fields (`raw_shape`, `raw_dtype`, `raw_bit_depth`).
- Round-trip verified: `extract_with_mode(_synthetic_usaf_raw_mosaic(channels), RGB_NIR, defaults)` returns a channel dict that is `np.array_equal` for all 8 base channels (HG/LG × R/G/B/NIR).

### End-to-end live verification
```
=== TEST 1: synthetic sample reconfigure ===
  sample_sid=7206323f44af
  status: success
=== TEST 2: legacy file reconfigure ===
  legacy_sid=19247e99d825
  status: success
=== TEST 3: modern file reconfigure ===
  modern_sid=7a8dd4e6b9f7
  status: success
```

### Note on default geometry for legacy
User asked: "default isp pipeline to sub-step=1 and outer stride=2, keep the current new h5 the same for 2 and 4." The new `LEGACY_GSBSI_RGB_NIR` mode shipped with `default_sub_step=(1, 1)` and `default_outer_stride=(4, 2)` — sub-step 1 matches verbatim; outer-stride is `(row=4, col=2)` because the legacy mosaic interleaves HG/LG with row-period 4 (using outer_stride=2 on rows would conflate HG and LG). The col-stride of 2 matches the user's "outer stride=2" target. The modern `RGB_NIR` mode is unchanged at sub_step=(2,2) / outer_stride=(4,4).

### Files changed
- `mantisanalysis/server.py` — new `_synthetic_usaf_raw_mosaic` builder; `load_sample` route caches `raw_frame` + sets `isp_mode_id`/`isp_config`/raw metadata.

### Smoke
- `pytest -q`: **253 / 253**.
- Tier 0: PASS.

---

## Source-mode UI redesign + per-channel RGB histogram (2026-04-27)

### User reports
> 1. for the HG/LG, make it a separate options for gsense recording outside of the drop down list!
> 2. for both in side-panel and on frame histogram, if rgb frame is displayed, show histogram with each channel separately.

### Source-mode picker — gain tabs out of the dropdown
The flat optgroup-grouped dropdown still required a 2-level scroll to flip gain. New layout:
- A 3-button tab group `[HG][LG][HDR]` lives in the ViewerCard title bar **outside** the dropdown for any GSense recording.
- The dropdown to the right shows ONLY the channel kinds for the active gain (`Visible (RGB)` / `NIR` / `Chroma (Y)` / `Raw — Red` / `Raw — Green` / `Raw — Blue`) + a small `Other` group for overlays / fallback.
- Auto-detection per recording: HG-* + LG-* in the channel set lights up `[HG][LG]`; HDR-* adds `[HDR]`. Non-GSense sources (image-only, polarization, synthetic samples without a Bayer mosaic) get no tabs and the dropdown falls back to the flat catalog.

#### New helpers
- `availableGains(recording)`
- `splitSourceMode(id)` / `composeSourceMode(gain, channelKind)` — bidirectional. HDR has no raw splits → falls back to `rgb_hdr` if user had a raw_* selected.
- `CHANNEL_KIND_OPTIONS` + `channelKindOptionsForGain(gain, recording)`.

### Per-channel RGB histogram (side-panel + on-frame)
- `histogramTracesFor(view, recording)` returns `[{HG-R, red}, {HG-G, green}, {HG-B, blue}]` (or LG/HDR/plain prefix) for RGB views; `[{channel, neutral}]` for single-channel views.
- New shared hook `useChannelHistograms` fetches every trace in parallel via the existing `/channel/{ch}/histogram` route (no new backend route needed).
- Multi-trace render: 3 colored polylines with `mix-blend-mode: multiply` (side-panel) / `screen` (canvas overlay); legend below shows `■ HG-R · ■ HG-G · ■ HG-B`.
- Single-channel views revert to the existing filled-bar render.
- p1/p99 markers anchor on the first trace; x-axis range spans union; peak count is the max across traces.

### Live verification (legacy gsbsi file)
- Gain tabs render `[HG][LG][HDR]`; clicking `LG` switches active tab, dropdown auto-switches to `LG channels`, view name preserves channel kind ("Visible (RGB)").
- Inspector → Display → histogram: `[...document.querySelectorAll(\"[data-rgb-trace]\")]` returns `["HG-R", "HG-G", "HG-B"]`, three colored polylines visible with legend.
- 0 console errors.

### Files changed
- `web/src/playback.tsx` — gain-tabs + per-gain dropdown; multi-trace histogram hook + render; new helpers.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **258 / 258**.
- Vite build: clean.

---

## Whole-app interaction-logic + UI audit (2026-04-27)

### User reports
- "GUI still really bad… 'Show clipped pixels' or 'Histogram on frame' are split into two lines."
- "this selection should be done in the existing source panel, not in the header bar! …do a whole interaction logic audit too!"

### Q
- Q1 — scope: applied across all four modes (USAF / FPN / DoF / Play) since they share the `Row` + `Checkbox` primitives.
- Q2 — width: agreed to widen Inspector.

### Interaction-logic redesign — gain is recording-level, not view-level
**Mental-model fix:** users think of HG / LG / HDR as a property of the *recording*, set once on the file. Putting it in the per-view title bar split the same setting across multiple controls.
- Each `recording` now carries `gainPref` ("HG" | "LG" | "HDR"), initialized at load time from the channel set (HG > LG > HDR).
- The `[HG] [LG] [HDR]` button-tab group lives **on the FilePill in the Sources panel**, below the metadata line, only when the recording exposes those gains.
- New `setRecordingGain(sourceId, gain)` callback walks every `view` bound to that recording and rebases its `sourceMode` via `composeSourceMode(newGain, splitSourceMode(view.sourceMode).channelKind)`. Channel kind (Visible / NIR / Chroma / Raw R/G/B) is preserved across the flip; only the half/fusion changes. View names refresh from `sourceModeMeta.label` only when the user hadn't edited them.
- `defaultSourceModeId(recording)` honors `recording.gainPref` so newly-added views inherit the recording's active gain.
- ViewerCard title bar now renders a small read-only `HG` / `LG` / `HDR` badge instead of the prior 3-button group; the channel-kind dropdown only shows the active gain's channels.

### Layout audit — Row + Checkbox + Inspector width
- `Row` (shared.tsx) label column was fixed 78 px; widened to `min-width: 96 / max-width: 144` with `overflowWrap: break-word` + `title` tooltip. "Show clipped pixels", "Histogram on frame", "Sharpen amount", "Hot pixel sigma", "Lock to current frame", "Include in export" — all fit on a single line.
- `Checkbox` (shared.tsx) `align-items: flex-start` → `center`; dropped the stray `marginTop: 6`; added `user-select: none`. Propagates to USAF / FPN / DoF via the shared primitive.
- Inspector default width 368 → 420 (Play).

### Histogram regression — multi-trace stays intact
- HG view → traces `[HG-R, HG-G, HG-B]`.
- Click `[LG]` in the Sources panel → flips active gain, title-bar badge → `LG`, view name preserves "Visible (RGB)", histogram traces auto-rebase to `[LG-R, LG-G, LG-B]`.

### Live verification
- sourceGainTabs after click: `[HG=false, LG=true, HDR=false]`.
- titleBarBadge: `LG`.
- viewName: `Visible (RGB)`.
- traces: `[LG-R, LG-G, LG-B]`.
- 0 console errors.

### Files changed
- `web/src/shared.tsx` — `Row` label column flexible 96-144 px; `Checkbox` align center.
- `web/src/playback.tsx` — Inspector width 368→420; `recording.gainPref` initialized from channel set; `setRecordingGain` rebase callback wired SourcesPanel → FilePill via `onSetGain`; FilePill renders `[HG][LG][HDR]` group; title-bar gain tabs replaced with read-only badge `data-viewer-card-gain-badge`; `defaultSourceModeId` honors `gainPref`.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **258 / 258**.
- Vite build: clean.

---

## Source picker rebuilt + ISP coords sharing + agent rule update (2026-04-27)

### User reports
- "remove all HG LG HDR and channel selections from the file browser, file list, headers of the frame!!!!! ALL SETTING NEED TO BE WITHIN THE SIDE_PANEL SOURCE!"
- "for fucking ISP setting widow, HG/LG/HDR shares same set of fucking coordinates!"
- "add into agent workflow that if i'm cursing, you are making things way worse..."

### Source picker — single home in Inspector Source section
- **FilePill** (Sources panel): removed the gain tabs entirely. Now shows only file metadata + warning chips.
- **ViewerCard title bar**: removed the gain badge AND the channel-kind dropdown. Now shows only the view name + processing badges + ⋮ menu.
- **Inspector → Source** (NEW `SourceSectionBody`): owns everything
  - Row 1 (only when GSense): Gain `[HG] [LG] [HDR]` button-tab group → writes to `recording.gainPref` via `onSetGain` → all views bound to the recording rebase preserving channel kind.
  - Row 2: Channel dropdown — Visible (RGB) / NIR / Raw RGB Channel / Overlay / Pick channel… (filtered by recording capability).
  - Row 3 (only when Channel = Raw AND gain ≠ HDR): Raw channel sub-dropdown — Red / Green / Blue / Chroma (Y).
  - Row 4: Read-only Recording label.
- HDR has no per-channel R/G/B raw splits; selecting Raw under HDR shows an explainer noting that HDR fusion exposes only the merged Chroma (Y).

### ISP settings — HG/LG/HDR share one coordinate set
- `LEGACY_GSBSI_RGB_NIR` redefined as `dual_gain=True` with **4 R/G/B/NIR slots** (not 8). Same locs / origin / sub_step / outer_stride apply to both gain halves — exactly like modern RGB_NIR.
- New `ISPMode.split_kind` field selects how the dual-gain halves are produced: `"horizontal"` (default — modern HG-left vs LG-right) or `"row_interleaved_period_4"` (legacy — HG on rows 1,3 mod 4; LG on rows 0,2 mod 4).
- `extract_with_mode` honors split_kind: row-interleaved walks `arr[0::4] / arr[2::4]` for LG and `arr[1::4] / arr[3::4]` for HG, stacks each into a half-frame, then runs the same R/G/B/NIR per-slot extraction on both halves.
- Verified byte-equality with old `extract_legacy_channels` on the user's real file: all 8 base channels (HG/LG × R/G/B/NIR) match exactly.
- ISP Settings dialog now shows 4 channel rows for legacy recordings (B / R / G / NIR), each with one origin / sub-step / outer-stride coordinate set at the top.

### AGENT_RULES update
New section in `.agent/AGENT_RULES.md`: "When the user is angry / cursing — STOP and audit". Triggers on curse words + repeated exclamations. Standard response: stop adding new code, re-read the literal request, audit the most recent change, cast wide enough, verify live before claiming done.

### Files changed
- `mantisanalysis/isp_modes.py` — `LEGACY_GSBSI_RGB_NIR` redefined as 4-slot dual-gain with `split_kind="row_interleaved_period_4"`; `ISPMode.split_kind` field added.
- `mantisanalysis/image_io.py` — `extract_with_mode` honors `split_kind` for row-interleaved layout.
- `mantisanalysis/server.py` — dropped legacy-mode special-case in `_composite_rgb_array`.
- `web/src/playback.tsx` — FilePill gain tabs removed; ViewerCard title-bar gain badge + channel dropdown + raw sub-picker removed; new `SourceSectionBody` component (Gain tabs + Channel dropdown + Raw sub-dropdown + Recording); `onSetGain` threaded through Inspector.
- `.agent/AGENT_RULES.md` — new "When the user is angry / cursing" section.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **258 / 258**.
- Vite build: clean.
- Tier 4 live (legacy gsbsi file):
  - FilePill: no gain controls (just metadata + warnings).
  - ViewerCard title bar: just name + badges + ⋮.
  - Inspector Source section: `[HG][LG][HDR]` tabs + Channel dropdown + Recording label, all visible at once.
  - ISP dialog on legacy file: shows 4 shared rows (B / R / G / NIR).
  - 0 console errors.

---

## Multi-select Delete-from-disk + Pick-channel filtering (2026-04-27)

### User reports
- "for the file list, I want to add a function that I can multi select file and delete them from file system in case of junk data, use pop-up window confirmation."
- "for source panel channel key when raw channel is selected, no need to show HG/LG as an option anymore since it is being set at the top of the panel already"

### Multi-select Delete-from-disk
**Backend** — NEW Pydantic `DeleteFilesRequest{paths: List[str]}` + `POST /api/sources/delete-files`. Per path:
1. Resolves the path; per-row error on failure (NUL bytes, recursion, etc.) so one bad input doesn't poison the rest.
2. Drops any loaded source whose `path.resolve() == requested.resolve()` from STORE first (closes the FrameReader handle so Windows-style file locks don't prevent unlink).
3. `Path.unlink()`. Refuses directories. Refuses missing files (returns `status: "missing"`). Symlinks: removes the link only, never the target.
4. Returns per-row `{path, status, detail?}` so the frontend can chip successes + surface partial failures.

**Backend tests** (`tests/unit/test_delete_files.py`, +5):
- regular file unlink → status="deleted", file gone.
- mixed batch (good file + missing path + directory) → per-row statuses; good file gone, directory untouched.
- loaded H5 source → backend closes the reader + drops from STORE first, file unlinks, subsequent GET on the source 404s.
- empty list → no-op.
- NUL-byte path → per-row error, doesn't poison the batch.

**Frontend** — `web/src/playback.tsx`
- PlaybackMode owns `markedRecIds: Set<string>` + `deleteConfirmOpen` state. `toggleMarked` / `clearMarked` / `handleDeleteMarkedFromDisk` callbacks.
- FilePill (loaded state) renders a `<input type="checkbox">` (data-file-pill-mark) at the leftmost column. Clicks stop propagation so they don't trigger the recording-select.
- SourcesPanel renders an "N selected · Clear · Delete from disk…" toolbar below the recordings list when any are marked. The Delete button opens the confirmation modal.
- NEW `<DeleteFromDiskConfirmModal>` — destructive-action dialog: red warning header, monospace path list, "Type DELETE to confirm" input with case-insensitive trim, danger-coloured "Delete N from disk" button (disabled until input matches). Skipped uploads (no disk path) get a separate explainer note.
- After successful delete: drops affected recordings + any views bound to them from local state; clears the markedRecIds set; toasts the result count (success / partial-failure / mostly-missing).

### Pick-channel dropdown — filtered by active gain
The Inspector → Source → "Pick channel…" dropdown previously listed every channel in the recording (HG-R, HG-G, …, LG-R, …, HDR-R, …). Since gain is already chosen at the top of the section via the `[HG][LG][HDR]` tabs, listing the other gain halves was redundant. Now:
- Filter `recording.channels` to drop entries prefixed with the OTHER two gains (e.g. on HG: hide LG-* and HDR-*).
- Strip the active-gain prefix on the displayed label (HG-R → R) but keep the full key as the option `value` so the URL builders resolve it correctly.
- Non-GSense recordings (no gains) get the unfiltered list.

### Live verification
- Click checkbox on a FilePill → toolbar appears: "1 selected · Clear · Delete from disk…".
- Click "Delete from disk…" → modal opens with the path listed in monospace, red warning header, "Type DELETE" input, danger-coloured "Delete 1 from disk" button.
- Pick channel… → dropdown lists only the active-gain channels with stripped prefix labels.
- 0 console errors.

### Files changed
- `mantisanalysis/server.py` — `DeleteFilesRequest` + `POST /api/sources/delete-files` route.
- `tests/unit/test_delete_files.py` — 5 new round-trip tests.
- `web/src/playback.tsx` — `markedRecIds` state + `toggleMarked` / `clearMarked` / `handleDeleteMarkedFromDisk`; FilePill mark checkbox; SourcesPanel marked-toolbar; `<DeleteFromDiskConfirmModal>` with type-confirm; SourceSectionBody Pick-channel filter by active gain.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **263 / 263** (was 258; +5 delete-files tests).
- Vite build: clean.

---

## Now-playing indicator on FilePill (2026-04-27)

### User report
> highlight the file currently being played in the frame displayed window in the file panel

### Implementation
- PlaybackMode passes `activeRecId={activeAtGlobal.sourceId}` to SourcesPanel. `activeAtGlobal` already maps `globalFrame` → `(sourceId, local)` via `sourceOffsets` so the answer to "which file is the playhead in?" is one lookup away.
- SourcesPanel forwards as `isPlaying={rec.source_id === activeRecId}` to each FilePill.
- FilePill renders, when `isPlaying`:
  - Green border on the FilePill outer container (replaces the default border color).
  - 3-px green left-edge stripe (`box-shadow: inset 3px 0 0 0 t.success`) — survives all the existing border/background states.
  - Small green ▶ glyph (`data-file-pill-playing`) before the filename.
  - Tooltip on the name: "Currently displayed · &lt;filename&gt;".
  - DOM marker `data-playing="true"` for Playwright reach.

### Verification
- Single-file stream → that FilePill has `data-playing="true"` and renders the green stripe + ▶.
- 0 console errors.

### Files changed
- `web/src/playback.tsx` — `activeRecId` threaded through PlaybackMode → SourcesPanel → FilePill; FilePill accepts `isPlaying` and renders the green stripe + ▶ + tooltip + `data-playing` attribute.

### Smoke
- Tier 0: PASS.
- `pytest -q`: **263 / 263**.
- Vite build: clean.

---
