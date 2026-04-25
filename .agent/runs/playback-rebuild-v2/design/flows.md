# Playback — User Flows

Fourteen flows that cover the persona pain-points in [`spec.md`](./spec.md) §3. Each flow lists entry, steps, UI components, feedback, error branches, and success state.

---

## F1 · First-time user opens Playback

**Persona.** Any.
**Entry.** Mode rail click · `4` keyboard · command palette "Switch to Playback".

1. App transitions to Playback (mode rail highlights the 4th tile).
2. Top bar changes title to "Playback".
3. Center region renders **Empty Mode** (W1) with primary CTA "Open recording."
4. Sources panel shows its own empty state; Inspector is empty.
5. Timeline displays "No stream loaded."

**Feedback.** Toast "Switched to Playback." (Matches existing mode-switch toast.)
**Error.** None reachable.
**Success.** Empty mode visible; user knows what to do next.

---

## F2 · Load one H5 and view RGB

**Persona.** Marcus.
**Entry.** Empty Mode → "Open recording."

1. User clicks **Open recording** or drops an H5 anywhere on the workspace.
2. File-picker dialog returns one H5 path.
3. Sources panel adds a `FilePill` in **loading** state (shimmer row, W2).
4. Stream header chip shows "Building stream…" spinner.
5. On metadata read complete:
   - `FilePill` shows frame count, exposure, duration.
   - Stream chip resolves to "Stream · 1 file · 1200 frames."
   - Viewer grid creates a single default view.
   - Last-used layout is restored; if none, layout preset is **single**.
   - Default view channel is `HG-Y` if present, else `HG-G` (a neutral RGB proxy). For a true "RGB view", Marcus must explicitly pick RGB from the channel chip, which opens the multi-channel RGB view type.
6. Viewer renders the first frame.
7. Inspector binds to the new view with default sections collapsed.

**Feedback.** Toast "Loaded recording_001.h5 · 1200 frames." Status bar shows active stream name.
**Error branches.** File read fails → replace the `FilePill` with the error variant; offer Retry/Remove.
**Success.** Frame 1 visible in a single view; Marcus scrubs to find a good frame.

---

## F3 · Load recording + matching dark frames

**Persona.** Priya.
**Entry.** Sources panel Dark section → "+ Load dark frame."

1. User loads a recording first (F2). Dark correction is **off** by default — view footer shows no DRK badge.
2. User clicks **+ Load dark frame** in the Dark Frames card.
3. File picker → one or more dark H5s.
4. Each dark file is read and averaged into a master dark frame (the UI represents this as one `DarkFrameRow` per input file; averaging is in background, indicated by a spinner in the row).
5. Once averaged, each row shows "Dark · {ms} ms · avg {n}" and a match indicator.
6. If exactly one dark matches the stream's exposure: that row is marked **matched ✓**.
7. User flips the top-level "Apply dark correction" toggle on.
8. The active view's footer picks up the `DRK` badge; Inspector's Corrections section shows the selected dark frame.

**Feedback.** Toast "Dark correction enabled. Dark · 20 ms matched."
**Error branches.**
- No matching dark frame → warning W-DARK-NONE inline on the dark frames card with "Use closest" and "Load dark."
- Ambiguous (multiple matches) → warning W-DARK-AMBIG; user can pick explicitly.
**Success.** View renders with dark correction, badge visible in title bar.

---

## F4 · Load multiple H5 files and build one stream

**Persona.** Priya.
**Entry.** Empty Mode → "Open recording" (multi-select in picker) · or drag multiple files.

1. User picks 3 H5 files.
2. Sources panel adds 3 `FilePill`s in loading state.
3. When metadata is in, system detects the three files are candidates for a single stream (matching channels, adjacent timestamps).
4. **Stream Builder modal** opens automatically (W3) because the grouping is ambiguous or contains warnings. (If the 3 files are trivially continuous with no warnings, Stream Builder does not auto-open — the stream is auto-built and a toast says "3 files combined into one stream.")
5. Stream Builder shows 3 rows with continuity badges:
   - Row 1 · ● Continuous
   - Row 2 · ⚠ 0.8 s gap
   - Row 3 · ⚠ exposure 40 ms
6. Summary card shows total frames, total duration, and warnings.
7. User reviews, optionally changes continuity threshold to 1.0 s (0.8 s gap becomes acceptable).
8. User clicks **Apply.**
9. Modal closes, stream chip shows "Stream · 3 files · 3800 frames · 02:14."

**Feedback.** Toast "Stream ready · 3 files · 3800 frames."
**Error branches.** See F5, F14.
**Success.** Viewer grid ready to add views; timeline shows three file boundaries.

---

## F5 · Fix an incorrect automatic file order

**Persona.** Priya.
**Entry.** Stream Builder (W3) · any time via Stream chip click.

1. User sees the files are in the wrong order (timestamps prove it).
2. User grabs the drag handle of the misplaced row and drops it above another row.
3. Continuity badges recompute. A previously flagged gap resolves to "● Continuous"; a new one may appear depending on timestamps.
4. Summary card updates.
5. User clicks **Apply.**

**Feedback.** The continuity badge animates on change; Summary card transitions values. No toast.
**Error branches.** If reordering leaves an unresolvable gap, summary flags it; user can either accept or pick a different continuity threshold.
**Success.** Stream header reflects the new order; timeline boundaries re-render.

---

## F6 · Open RGB, NIR, and overlay views together

**Persona.** Lan.
**Entry.** Workspace with one stream.

1. User clicks the layout picker → selects **2×2**.
2. Four cards appear. By default, the existing view moves to position 1; positions 2–4 are placeholder cards with a "Pick channel" chip in their title bar.
3. User clicks position 2's channel chip → picks `HG-NIR`. Card renders.
4. User clicks position 3's channel chip → picks `HG-R`. Renders.
5. User clicks position 4's channel chip → picks **Overlay** from the view-type dropdown.
6. The overlay view's title shows "Overlay" placeholder until sources are chosen.
7. Inspector's Overlay section auto-expands; user sets base=view 1 (RGB), overlay=HG-NIR (view 2).
8. Overlay renders with default thresholds.

**Feedback.** Each newly configured view triggers a brief flash of the `RAW` → first processing badge.
**Error branches.** If view 1 is not RGB type, overlay picker warns "Base view must be RGB." User switches view 1 or picks a different base.
**Success.** 2×2 grid with RGB · NIR · HG-R · NIR/RGB overlay.

---

## F7 · Adjust NIR threshold and colormap

**Persona.** Marcus (or Priya during diagnostics).
**Entry.** 2×2 workspace, NIR view selected.

1. User clicks the NIR view — it becomes selected (accent border).
2. Inspector updates to the NIR view.
3. User expands **Display** section (or it's already open).
4. User drags the Low threshold slider. A HUD bubble shows the current value. The view updates live (< 100 ms).
5. User changes colormap from `viridis` to `inferno`. The view re-renders.
6. User toggles "show clipped pixels." Clipped pixels appear in magenta overlay on the canvas.

**Feedback.** Slider HUD, live canvas update, badge in title bar switches from `RAW` to `LUT`.
**Error branches.** Low > High → the slider constrains itself; a quiet tooltip warns "Low must be below High."
**Success.** NIR view shows desired contrast; badges reflect LUT.

---

## F8 · Create NIR-over-RGB overlay via builder

**Persona.** Marcus.
**Entry.** Inspector Overlay section → "Open Overlay Builder…"

1. User is on an RGB view.
2. Inspector Overlay section expanded; user clicks "Open Overlay Builder…"
3. **Overlay Builder** (W10) opens with Base pre-filled (current view).
4. Step 2 · User picks `HG-NIR` as overlay channel.
5. Step 3 · User adjusts Low/High thresholds using sliders paired with a live histogram.
6. Step 4 · Live preview shows the composite. User tweaks blend strength.
7. User clicks **Apply overlay.**
8. Modal closes; the RGB view gains an `OVL` badge and renders the composite.
9. Overlay legend chip appears bottom-left of the canvas.

**Feedback.** Preview pane updates continuously; on apply, toast "Overlay applied."
**Error branches.** Base and overlay must be spatially aligned. Misalignment → W-OVL-SRC. User picks a different base.
**Success.** RGB view shows NIR overlay with legend.

---

## F9 · Apply RGB color correction

**Persona.** Marcus.
**Entry.** RGB view selected · Inspector RGB grading section.

1. User expands **RGB grading.**
2. User clicks **Auto white balance.** WB runs once against the current frame; three channel gains snap to new values.
3. User nudges Gamma slider.
4. User toggles **before/after** at the section header; the view briefly shows raw, then corrected.
5. User clicks **Save…** to save a preset; enters a name.

**Feedback.** Badges pick up `RGB` in title bar. Toast "Preset saved."
**Error branches.** Before/after toggle during export is disabled (view is locked by export rendering).
**Success.** View looks good; preset persisted in the session.

---

## F10 · Lock one view while scrubbing another

**Persona.** Lan.
**Entry.** 2×2 workspace.

1. User wants to compare frame 100 (view A, RGB) against a scrubbed sequence.
2. User selects view A → overflow menu → **Lock to current frame.**
3. View A's border turns amber; `LCK` badge appears in title.
4. Timeline shows an amber pin at frame 100.
5. User drags the global frame marker. Views B/C/D follow; view A stays at frame 100.

**Feedback.** Locked view's footer shows "LCK · frame 100" instead of the live frame readout.
**Error branches.** Trying to play while a view is locked — playback warns once "1 view is locked and won't update." User acknowledges or unlocks.
**Success.** A–B comparison possible.

---

## F11 · Export active views as a tiled PNG

**Persona.** Priya.
**Entry.** Stream header → Export menu → **Image.**

1. **Export · Image** modal (W12) opens with Scope = All visible views, Layout = Tiled 2×2.
2. User reviews preview — WYSIWYG.
3. User includes Labels: timestamp, frame, processing badges.
4. User picks PNG, sets filename pattern, picks output folder.
5. User clicks **Export image.**
6. Progress is minimal (single frame) — modal shows a brief spinner.
7. Success: toast "Saved to {path}." Modal closes.

**Feedback.** Toast on success.
**Error branches.**
- Disk write fails → modal stays open with error banner "Could not write file. Check folder permissions." Retry/Cancel.
- Filename pattern invalid → inline error under the pattern field.
**Success.** PNG saved.

---

## F12 · Export selected views as a video

**Persona.** Priya.
**Entry.** Stream header → Export menu → **Video.**

1. **Export · Video** modal (W13) opens. Scope defaulted to Selected; frame range defaulted to current range-selection if any, else full stream.
2. User brushes the mini-map inside the modal to narrow the range.
3. User sets FPS = 30, Speed baked = 1×, Layout = Tiled 2×2, Format = MP4.
4. Estimate reads "01:44 · ~42 MB."
5. User clicks **Export video.**
6. Settings column is replaced by the progress column: "frame 428/3120 · 13.7% · eta 00:54."
7. User watches or switches to another task.
8. On completion, success card: "Saved to {path}." Buttons: Show in folder · Open file.

**Feedback.** Progress bar, ETA.
**Error branches.**
- Cancel → modal shows "Export cancelled. Partial output available at {tmp}." Buttons: Restart · Close.
- Encode fails → danger banner with the last successful frame and Retry-from-there CTA.
- User tries to scrub during export → timeline shows "Export running" overlay; input ignored.
**Success.** Video saved; file opens on request.

---

## F13 · Handle missing dark-frame warning

**Persona.** Priya.
**Entry.** Inline banner on the Dark Frames card after loading a recording with no matching dark.

1. After F2, a banner appears inside the Dark Frames card: "No dark frame available for 20 ms exposure. [Use closest] [Load dark]."
2. User clicks **Use closest.** The system picks the dark whose exposure is nearest (say 40 ms); that row becomes "matched (approx)" with a warn-colored badge.
3. Badge in any dark-corrected view becomes `DRK~` (approx variant).
4. Or: user clicks **Load dark** and goes through F3 for the missing exposure.

**Feedback.** Toast on either branch.
**Error branches.** If the "Use closest" difference is too large (configurable, default >25 %), the UI warns "Closest dark differs by 50 %. Proceed?" with Continue/Cancel.
**Success.** Dark correction resolved or deliberately skipped.

---

## F14 · Handle incompatible files

**Persona.** Priya.
**Entry.** Stream Builder after loading a bad file, or sources-panel FilePill error banner.

1. User added a 4th file that has a different frame size than the others.
2. Stream Builder shows the row with a red border, badge `✖ shape mismatch`, and an inline card explaining which dimension disagrees.
3. Buttons offered: **Quarantine** (keep the file in the sources panel but exclude it from the stream), **Replace file**, **Remove**.
4. User clicks **Quarantine.**
5. Row moves to a "Quarantined files" section at the bottom of the builder, dimmed.
6. Stream Builder continues with the remaining 3 files.
7. User clicks **Apply.**

**Feedback.** Toast "1 file quarantined." Sources panel tags the file with a "not in stream" badge.
**Error branches.** If all files are incompatible → Stream Builder blocks Apply and shows "No compatible files to build a stream. Remove or replace."
**Success.** Stream built from the compatible subset; Priya aware of which file is excluded and why.

---

*End of flows.*
