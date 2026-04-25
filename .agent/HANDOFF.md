# HANDOFF — current live state pointer

Last updated: **2026-04-27**, mid-flight on **play-tab-recording-inspection-rescue-v1
Phase 2**. **Groups P + R + H all COMPLETE; Group A in flight (M28 + M29 ✓; M30 next)**. M12
through M29 all shipped on top of the closed Phase 1 rescue. **M29 included a P0 hotfix
sweep for legacy gsbsi-prefix H5 files: ~1 fps playback fixed via `/dset` in-memory slurp;
raw resolution + bit depth now displayed on FilePill and ViewerCard footer.** Two hotfix
sweeps along the way addressed user-reported issues (thresholds restored on
every mode, HG vs LG normalization fixed by switching default to `'none'`,
all Play checkboxes correctly reflect state, Display section is now
RGB-aware, brightness/contrast/gamma duplicates removed from Corrections,
TopBar suppresses cross-mode source chip in Play, dark-correction checkbox
honors `has_dark`). Play mode was rebuilt against the Anthropic-hosted
design template and verified live on real GSense data.

## Current state of the working tree

- Branch: `main`.
- Active initiative: **play-tab-recording-inspection-rescue-v1** (Group A in flight; M28 + M29 + M30 ✓ + ISP-refresh / source-mode restructure hotfix sweep; M31 next).
- Active modes: **USAF, FPN, DoF, Play** (4 modes; Play is the new 4th mode).
- Initiative folder: [.agent/runs/play-tab-recording-inspection-rescue-v1/](runs/play-tab-recording-inspection-rescue-v1/).
- Phase 2 progress: **Group P (M12-M19) ✓; Group R (M20-M24) ✓; Group H (M25-M27) ✓; Group A (M28-M32): M28 + M29 ✓**. M28 shipped the server-side presets store. M29 ships the 4-step Overlay Builder wizard + a P0 hotfix sweep for legacy gsbsi-prefix H5 files (the un-chunked `/dset` is now slurped into RAM at first open so playback hits 50+ fps headroom instead of ~1 fps; FilePill + ViewerCard footer now display raw resolution / bit depth / per-channel resolution). M30 (right-click frame → Send to USAF/FPN/DoF) is next.

## What just shipped (play-tab-recording-inspection-rescue-v1)

12 milestones (M0–M11) in one session. Highlights:

- **Backend** ([mantisanalysis/session.py](../mantisanalysis/session.py),
  [mantisanalysis/server.py](../mantisanalysis/server.py)) — `LoadedSource.extract_frame`
  per-frame extraction with lazy `FrameReader` (h5py handle held open per source);
  64 MB LRU frame cache bounded at 16 entries; per-source `RLock` for thread-safe
  cache mutation under FastAPI threadpool. New routes: `/api/sources/{sid}/frames`,
  `/frame/{i}/channel/{ch}/thumbnail.png`, `/frame/{i}/rgb.png`,
  `/frame/{i}/overlay.png`, `/export/video?format=mp4|gif|zip`. Dark-frame loader
  averages all frames in the dark H5 before extraction.
- **Frontend** ([web/src/playback.tsx](../web/src/playback.tsx)) — full 7-region
  template layout: StreamHeader, SourcesPanel (recordings + dark frames),
  ViewerGrid (Single / Side-by-side / Stack / 2×2), ViewerCard with title-bar
  source-mode dropdown + ProcessingBadges + footer, Inspector with 8 sections
  (View / Source / Corrections / Display / RGB grading / Overlay / Labels /
  Advanced), TimelineStrip with mini-map + slider + play/pause + FPS + Loop,
  Stream Builder modal, Export Video modal, Warning Center modal.
- **Source-mode dropdown** — for GSense H5 enumerates 9 options (RGB · HG/LG,
  NIR · HG/LG, Gray · HG-Y/LG-Y, RGB+NIR overlay · HG/LG, Raw channel…) all
  derived from `source.channels[]`. Default = `RGB · HG`. **Kills the prior
  "manual R/G/B picker" failure.**
- **Loop = ON by default** (resolved decision #3) wraps cleanly; loop OFF hard-stops.
- **Image + video export** — browser download via `Content-Disposition`. Filename
  pattern `{stream}_f{NNNN}-{NNNN}_{render}.{ext}`. MP4 / GIF / PNG-zip all working
  on real data.

Reviewer findings (frontend-react-engineer + fastapi-backend-reviewer) summarized
in [.agent/runs/play-tab-recording-inspection-rescue-v1/reviews/](runs/play-tab-recording-inspection-rescue-v1/reviews/).
P0s + critical P1s applied. Remaining P1/P2 deferred with rationale.

## Smoke status, last verified 2026-04-27 (after M30 + ISP-refresh + source-mode restructure)

- Tier 0 — agent-doc + lint + typecheck PASS
- `pytest -q` — **258 / 258 passing**
- `npm run build` — Vite production build clean
- Live browser verification — 11 (Phase 1) + 19 (M12 through M30) milestones +
  12 hotfix sweeps (the latest: now-playing indicator on the FilePill
  — green left-edge stripe + green ▶ glyph + tooltip when the global
  timeline playhead is inside that recording's frame range)
  logged in
  [VERIFICATION_LOG.md](runs/play-tab-recording-inspection-rescue-v1/VERIFICATION_LOG.md).

## Where to pick up next

**M30 — Right-click frame → Send to USAF/FPN/DoF** (Group A · Advanced).
Per plan §M30: NEW `STORE.create_transient_from_frame(parent_sid, idx)`
returns a new image-kind source whose channels are the parent's
`extract_frame(idx)` output (auto-evicted after 30 min idle). NEW
`POST /api/playback/handoff` accepting `{source_id, frame_index,
target_mode}` returns the new transient `source_id`. Frontend
`ViewerCard` `onContextMenu` opens a popover with USAF/FPN/DoF; click
posts the handoff and dispatches `mantis:switch-source`. `app.tsx`
listens for the event and switches mode + selected source. Gate: scrub
to frame 5 → right-click → Send to USAF → app switches modes with the
synthetic source loaded; original Play recording stays intact.

**M29 follow-up notes**: The 4-step Overlay Builder is reachable via
`Open Overlay Builder…` at the top of the Inspector Overlay section
when the active source-mode is overlay-kind. The modal mirrors the
inline OverlayConfigurator field-for-field but only commits on Apply.
The legacy-gsbsi P0 fix slurps `/dset` into `LegacyFrameReader._mem` on
first open (≈60 ms, 537 MB) — RAM cost is the dataset size, which is
within reasonable budget for "load everything into memory" semantics.
If a user loads multiple legacy files at once and hits RAM pressure,
the existing `SessionStore.max_entries` LRU + `close_frame_reader`
hook cleanly drops `_mem` on eviction. New `LoadedSource.raw_shape /
raw_dtype / raw_bit_depth` fields are surfaced through the
`SourceSummary` Pydantic and rendered on the FilePill (raw mosaic
resolution + bit-depth chip when ≠ 16) and ViewerCard footer
(per-channel rendered resolution).

Earlier deferred items in
[BUG_REGRESSION_CHECKLIST.md](runs/play-tab-recording-inspection-rescue-v1/BUG_REGRESSION_CHECKLIST.md)
remain valid follow-ups (stale-`views`-closure cleanups, stream-follow
rebind name-preservation).

Other modes (USAF / FPN / DoF) are unchanged and regression-clean.

## Outstanding deferred work

- B-0010 — push initial commit + remote tracking (pending consent).
- B-0018 — real-sample validation sweep (now partially satisfied for Play; USAF/FPN/DoF still pending).
- Phase 5c — drop `@ts-nocheck` per file (multi-session, paired with feature work).
- Play-mode P1/P2 polish from M11 reviewer pass (see CHECKLIST).

## Residual risks / open questions

- New backend dep `imageio[ffmpeg]>=2.30` added to `pyproject.toml` for video
  export. Existing virtualenvs need `pip install -e .` to pick it up. The route
  surfaces HTTP 503 with a fallback hint when the codec is unavailable.
- `_load_dark_channels` reads all frames into memory; for typical lab darks
  (≤200 MB) this is fine. Documented in CHECKLIST P2.
