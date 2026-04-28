# Status — play-export-and-roi-fixes-v1

Last updated: **2026-04-28**.

## Milestone tracker

- [x] **M0** — Initiative scaffold (this file + ExecPlan).
- [x] **M1** — Bugs 2 (labels-in-overlay), 3 (realtime validation), 4 (hi-res quality). Verified: live overlay PNG with `?labels_*=true` differs in size from baseline (labels effective); `/export/video` accepts `?crf=18&preset=slow&isp_gain=2.0&sharpen_method=...` and returns 200 valid MP4; smoke 0+1+2+3 + 290 unit tests green; Vite bundle reloads clean.
- [x] **M2** — Bug 7 (TBR overlay channel picker + skip-gain-on-overlay). Root cause was twofold: (a) `splitSourceMode('overlay_custom').gain` is null → fallback `'HG-G'` (wrong channel), and (b) `view.gain` slider on overlay views is for visual scaling but was being forwarded to `/roi-stats`'s `_apply_pre_norm`, producing values clamped at the GSense 12-bit-in-16-bit saturation max (65520 = 4095 × 16). Fix: TBR channel defaults to `view.overlay.overlayChannel` for overlay views; user-pickable via new `<select>` in the Inspector; `buildViewConfig` skips gain/offset for overlay views. Smoke 0 + 290 unit tests green; bundle reloads clean.
- [x] **M3** — Bug 1 (ROI vertex drag + right-click-delete + double-click-edge-insert). Pointer-state ref added; left-click on a vertex starts drag; pointermove updates polygon in place; right-click on a vertex deletes it (≥3-vertex floor); double-click on an edge inserts a new vertex at the click point. Hover affordance switches the cursor to "grab" near a vertex. Hit-test math reuses `_clientToImagePx` and adapts the screen-px tolerance to image-px via the live letterbox scale. Tier 0 + 290 unit tests green; bundle reloads clean.
- [x] **M4** — Bugs 5 + 6 (multi-source export + job-based progress bar). New `mantisanalysis/export_jobs.py` (JobStore + ExportJob + single-worker executor + cancel + TTL cleanup); 4 new routes (`POST /api/play/exports`, `GET /api/play/exports/{id}`, `GET .../result`, `DELETE .../{id}`); frontend routes through the job endpoint when `recordings.length > 1` and renders a `<progress>` bar with cancel button. Live end-to-end: POST → poll → result fetch → valid MP4 (ISO Media). 11 new unit tests + all 301 existing tests green; smoke 0+1+2+3 green.
- [x] **M5** — Reviewer pass. 3 reviewers spawned (`fastapi-backend-reviewer`, `frontend-react-engineer`, `risk-skeptic`); all returned **fix-then-ship**. P0/P1 batch resolved: Pydantic Field bounds + Literal validators on `MultiSourceVideoRequest` (rejects bad preset/crf/sharpen_method at edge with 422); tempfile unlinked after first `/result` read (re-fetch returns 410 — verified live); cancel-after-success race fixed via `cancelled_mid_encode` snapshot before `writer.close()`; `JOBS.shutdown()` wired to FastAPI shutdown hook; polling loop unmount-safe via `exportPollAbortRef` cancel token + cleanup effect; modal close blocked in `queued`/`running`/`done` states; DELETE failures surfaced via `say()`; Export button disabled while job in flight; `aria-label="Export progress"` + `type="button"` on cancel. P2 items deferred to backlog (vertex-drag at z=32, Spinbox mid-edit pill display, Recompute view-mode mismatch). 301 unit tests pass; smoke 0+1+2+3 green.
- [x] **M6** — Close (smoke + docs sync). HANDOFF + CHANGELOG_AGENT updated; reviewer evidence files written under `reviews/`. All 7 user-reported bugs resolved + verified. **INITIATIVE CLOSED.**

## Post-close hotfix (Bug 8 — H5 load crash)

User reported `Play mode crashed during render` with `ReferenceError:
_trackFetchStart is not defined` immediately on opening any H5 file.

Root cause: the `b01d8f7` extraction of `web/src/playback/frameCache.ts`
left two call sites in `playback.tsx` referencing the OLD module-local
identifiers (`_trackFetchStart`, `_trackFetchEnd`, `_prefetchActive`,
`_MAX_CONCURRENT_PREFETCHES`) that no longer exist in playback.tsx
scope. The bug pre-dated this initiative; it surfaces on the file-
load path which my changes happen to exercise during ViewerCard mount.

Fix:

- `web/src/playback/frameCache.ts` — exposed `trackFetchStart`,
  `trackFetchEnd` (already exported), and added a new
  `isPrefetchSemaphoreSaturated()` getter so the warmer queue can
  back off without spinning.
- `web/src/playback.tsx` — imported `trackFetchStart as
  _trackFetchStart` + `trackFetchEnd as _trackFetchEnd` +
  `isPrefetchSemaphoreSaturated as _isPrefetchSemaphoreSaturated`;
  replaced the broken `_prefetchActive >= _MAX_CONCURRENT_PREFETCHES`
  check with the new getter call.

Live verified: H5 fixture (24 KB GSense-shaped synthetic) loaded via
`mantis:play:load-paths` event → recording added, ViewerCard mounted,
Inspector shows VIEW/SOURCE/CORRECTIONS, cache reports
`3/3492 frames cached`, **zero console errors, no error boundary**.
Tier 0 + 301 tests green.

## Post-close enhancement #1 (Bug 10 — persistent TBR table)

User asked: "make TBR table persistent and retain all entries even
if I removed all h5 recording from the page".

Two changes:

- `web/src/playback.tsx::PlaybackMode` — `tbrEntries` is now seeded
  from `localStorage['mantis.play.tbrEntries.v1']` on mount and
  written back on every mutation. Versioned key so a future schema
  change can drop legacy entries cleanly. Round-trip is cheap
  (entries are small numeric records, no images), and the
  no-debounce write ensures a tab close right after a commit
  doesn't lose the entry.
- `web/src/playback.tsx::Inspector` empty state — when no view is
  selected (e.g. user removed all recordings) AND `tbrEntries` is
  non-empty, render a primary "Open TBR table (N entries)" button
  so the persisted research data stays accessible regardless of
  whether any recording is loaded.

Recording removal already left `tbrEntries` untouched (the filter
runs on the recordings array, not the entries array), so survival
across recording removal was a UX-access fix only — pre-this-change
the entries existed in memory but had no visible entry point once
the Inspector unmounted.

Live verified: seeded `[{rec_a.h5}, {rec_b.h5}]` into localStorage,
hard-reloaded → empty Inspector shows "Open TBR table (2 entries)";
clicking opens the analysis modal with mean=1.91, median=1.82, n=2.
Added a third entry via localStorage round-trip + reload → button
updates to "Open TBR table (3 entries)". Zero console errors.
Tier 0 + 301 tests green.

## Post-close hotfix #2 (Bug 9 — parallel load + large-batch stability)

User reported the Play loader was serial (one file at a time, slow on
big batches) and crashed on large batches.

Two changes:

- `mantisanalysis/session.py::SessionStore.__init__` — bumped
  `max_entries` from 64 to 256 and `evicted_memory` from 256 to
  1024 so users can keep 100+ recordings in one session without
  the LRU evicting mid-batch (which surfaces as 410 Gone on a
  viewer's frame fetch and trips the error boundary).
- `web/src/playback.tsx::loadRecordings` — replaced the serial
  `for (i in items) await loadOne(i)` walker with a bounded-
  concurrency Promise pool (`MAX_PARALLEL_LOADS = 4`). Workers
  pull off a shared cursor; each item's result lands in an indexed
  slot. After all workers exit, `slots` is drained in input order
  so the recordings array preserves the user's pick order even
  when the network races finish out-of-order.

Live verified: 50 synthetic H5 fixtures loaded cold via
`mantis:play:load-paths` in **210 ms**, all 50 FilePills appear in
correct numeric order (00 → 49), zero console errors, no error
boundary, ViewerCard auto-bound to recording 00, cache reports
`3/3492 frames cached`. Tier 0 + 301 tests green; bundle reloads
clean.

## Active context

- **Branch:** `main` (47 ahead of `origin/main`, never pushed — B-0010 still open).
- **Working tree at start:** clean (TBR/mask + CI/CD commits just landed: `722f624`, `19250e6`).
- **Next concrete action:** edit `mantisanalysis/server.py::frame_overlay` to accept `labels_*` Query params and call `_maybe_burn_labels` after the composite RGB is built; mirror the channel/RGB routes' parameter list.

## Open design choices (resolved)

| # | Question | Resolution |
|---|---|---|
| 5 | Multi-file export | One MP4 covering all sources in cascade order. |
| 6 | Progress bar | Job-based (`POST` → `job_id` → poll). |
| 7 | TBR overlay channel | User-pick, default = overlay's colormapped channel. |
| 1 | Vertex edit gestures | Drag + right-click-delete + double-click-edge-insert. |

## Reviewer pending

Will spawn at M5: `fastapi-backend-reviewer`, `frontend-react-engineer`,
`risk-skeptic`, `playwright-verifier`, `react-ui-ux-reviewer`,
`performance-reviewer`.
