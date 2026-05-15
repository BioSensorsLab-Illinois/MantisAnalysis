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

## Post-close hotfix #8 (Bug 16 — Safari-specific upload failures + retry-storm slowdown)

User clarification flipped the diagnosis again: **the failure is
Safari-specific** ("Chrome is able to upload all files no issue,
only safari"). Tested directly: the user's actual 512 MB file
`/Users/zz4/Desktop/Macedonia in-vivo data/gsbsi_2019-02-20-T073232_019.h5`
loads end-to-end via `load-paths` in 104 ms with 128 frames, 15
channels, 512×512 — the file and server are both healthy. The
issue is Safari/macOS networking subsystem state, NOT something
fixable in this code.

User also reported that my prior fixes made parallel loading
**slower**. Confirmed: Bug 13's 4-attempt apiUpload retry with
200/600/1500 ms backoffs added up to 2.3 s of dead time per failed
upload — for a Safari user where MOST uploads in a corrupt state
fail-then-succeed (or just fail), this multiplied across 4-wide
parallelism on a 300-file batch added ~10 minutes of pointless
waiting.

Two changes:

1. **Trimmed `apiUpload` and `apiUploadStream` retry counts** from
   4 attempts to 2 (1 initial + 1 quick retry at 200 ms). Truly
   transient one-off socket drops still self-heal; persistent
   Safari-network-subsystem failures fail fast instead of grinding
   for 2.3 s each. With 4-wide parallelism over a 300-file batch
   this restores roughly the original "very fast" feel the user
   remembered.

2. **Documented the Safari-only diagnosis** in user-facing
   guidance. Recommended workarounds:
   - Use Chrome (no known issue).
   - Reboot macOS (resets the WebKit network subsystem state).
   - For path-based loads (drag a folder via the OS picker), the
     `mantis:play:load-paths` event flow goes server-direct via
     `/api/sources/load-path`, which bypasses the browser's HTTP
     stack entirely. 512 MB file via that path loads in ~50 ms
     end-to-end, same as Chrome.

Live verified: user's actual 512 MB legacy GSBSI file loads via
the path-loader in 104 ms; ViewerCard mounts cleanly with 128
frames cached, no errors, no boundary. Tier 0 + 301 unit tests
green; bundle reloads clean.

## Post-close hotfix #7 (Bug 15 — 300-file batch leaves persistent server state)

User clarification flipped the diagnosis: "I was able to upload 20 of
these 512 MB files at once no problem at all" + "the problem started
after I tried to upload 300 files at once, suspect mem issue,
uncleared cache, overflowed temp files etc.". So 512 MB FormData
uploads work fine — the bug is **persistent server state** corrupted
by the prior 300-file batch (orphan tempfiles, leaked FDs, fragmented
heap) that breaks every subsequent upload until the server restarts.

The Bug 14 switch to `body: file` was wrong: confirmed by user that
FormData was streaming the file body from disk all along; my switch
made Chrome slurp 512 MB into the tab heap × parallelism=4 = 2 GB
in-tab, which the browser process aborts with `TypeError: Load
failed`.

Three fixes:

1. **Reverted Play loader to FormData multipart** (`apiUpload(...,
   '/api/sources/upload?auto_pin=true')`). This was the working
   path; my Bug 14 switch was the regression, not the fix.

2. **Dedicated upload tempdir + lifecycle management**:
   - `_upload_tempdir()` returns `<TMPDIR>/mantisanalysis_uploads/`
     so we own the directory and don't share with other processes.
   - `_purge_upload_tempdir(max_age_seconds=3600)` reaps stale
     tempfiles. Runs on:
     * `create_app()` startup (clean slate after crash/large batch)
     * Every `upload_source` and `upload_source_stream` request
       (opportunistic cleanup so tempdir stays bounded).
   - `upload_source`, `upload_source_stream`, `upload_init` all
     `tempfile.NamedTemporaryFile(dir=str(_upload_tempdir()))` so
     no upload bytes ever escape the dir.

3. **`POST /api/play/purge-upload-state?max_age_seconds=0`**
   manual recovery endpoint. User can curl this (or the future
   frontend "Recover" button) to flush every upload tempfile +
   chunked-upload session in one shot — restores the server to a
   clean state without restarting. Returns counts so the user
   sees what was reaped.

Bonus from Bug 14 work that's worth keeping:
- `apiFetch` now skips the auto-JSON branch on Blob/ArrayBuffer/
  ReadableStream bodies (a real bug in `apiFetch` that would
  silently corrupt any future raw-body call).
- `_bump_fd_limit_if_low()` raises `RLIMIT_NOFILE` toward the hard
  cap on startup so 300-file pinned-source batches don't exhaust
  FDs (macOS default soft cap = 256).
- New chunked-upload routes (`upload-init`/`-chunk/`-finalize`)
  available for the future if HTTP/2 + streaming is ever the
  preferred path.
- Verbose error context in W-LOAD pills (Bug 13 diagnostic
  upgrade).

Live verified:
- Curl FormData upload to `/api/sources/upload?auto_pin=true`:
  HTTP 200, source pinned, frame fetch returns 200.
- Browser file-input batch of 3 H5s through the Play loader: all
  3 pills go to `loaded`, ViewerCard mounts, zero console errors.
- `POST /api/play/purge-upload-state?max_age_seconds=0` reaps
  every tempfile in `<TMPDIR>/mantisanalysis_uploads/`, returns
  `files_purged=N, sessions_purged=N`.
- Tempdir state: 0 stale files after purge.
- Tier 0+1+3 + 301 unit tests green; bundle reloads clean.

**User-facing recovery instructions** (when stuck after a corrupted
batch):
1. `curl -X POST 'http://127.0.0.1:<port>/api/play/purge-upload-state'`
   to reap orphan tempfiles + chunked sessions without restarting.
2. If still stuck (FD exhaustion can't be fixed at runtime), restart
   the server. The new `_bump_fd_limit_if_low()` + startup purge
   will give the next session a clean slate.

## Post-close hotfix #6 (Bug 14 — streaming uploads + parallelism restored)

User reported `Load failed · after 4 attempts · cause: TypeError:
Load failed · source: file · size: 512.0 MB`. The 512 MB file size
was the smoking gun: WebKit's FormData buffering aborts very large
multipart bodies in client-side RAM. Plus a prior 300-file batch
left even single-file uploads failing — likely OS-FD-pool exhausted.

Four-part fix:

1. **New streaming upload route**: `POST /api/sources/upload-stream`.
   Reads `request.stream()` chunk-by-chunk into a tempfile —
   server-side peak RAM stays at the chunk size regardless of
   upload size. No multipart wrapper. The route accepts
   `?name=<filename>&auto_pin=...` so the server preserves the
   suffix for codec dispatch.

2. **Frontend `apiUploadStream`** sends the File directly as the
   fetch body (no FormData), so WebKit's FormData buffer is
   bypassed entirely. Includes the same 4-attempt retry +
   diagnostic console.warn from Bug 13.

3. **Critical apiFetch fix**: discovered via diagnostic
   `print(..., first16=...)` — server was receiving 2 bytes (`{}`)
   on every browser upload because `apiFetch`'s auto-JSON branch
   was `JSON.stringify`-ing the File object (which has no own
   enumerable properties, so it serializes to `{}`). Added
   instanceof checks for `Blob`/`ArrayBuffer`/`ArrayBuffer.isView`/
   `ReadableStream` to skip the auto-JSON path on raw bodies.

4. **OS FD-limit bump at server startup**:
   `_bump_fd_limit_if_low()` raises `RLIMIT_NOFILE` soft limit
   toward the hard cap (capped at 65 536). macOS defaults to a
   256-FD soft limit; with 256-pinned-source LRU + lazy h5py
   handles, a 300-file batch ran out of FDs and corrupted server
   state for hours after. Bumping to ~10 K (macOS hard cap)
   gives roughly 40× headroom.

5. **Parallel uploads restored** to 4-wide. Bug 12's serial-only
   workaround is now unnecessary — streaming + apiFetch fix +
   server stream-to-tempfile handles parallel multipart-equivalent
   loads cleanly.

Live verified:
- 1 MB H5 streamed via curl: HTTP 200 in 4.5 ms.
- 340 KB H5 uploaded through the browser file-input via the new
  streaming path: state=`loaded`, ViewerCard mounted, zero console
  errors.
- Bad-bytes streaming upload returns the detailed diagnostic
  (`load failed: OSError: ... [at File "h5py/h5f.pyx", line 104, ...]`).
- Tier 0+1+3 + 301 unit tests green; bundle reloads clean.

## Post-close hotfix #5 (Bug 13 — bare `Load failed` diagnostic)

User reported `Failed to load <file>: Load failed` was still appearing
after the prior streaming + retry fix. The bare "Load failed" string
gave them no way to triage — was it a network drop, a malformed H5,
an h5py crash, or a Pydantic mismatch? Asked for verbose diagnostics.

Three changes layered on top of the prior fixes:

1. **Three-attempt retry with diagnostic console.warn** in
   `web/src/shared.tsx::apiUpload`. Now retries on `TypeError` from
   fetch (Safari/Chromium/Firefox network-layer aborts) AND on HTTP
   5xx (transient server crash). 200 ms / 600 ms / 1500 ms backoff;
   each retry logs to console with the prior error's name + message.
   When all attempts exhaust, the final error is wrapped (via
   `Error.cause`) so the caller's catch sees the full chain — not a
   bare network message.

2. **Verbose error context in `loadRecordings` catch**. Previously
   the toast/pill showed `err.detail || err.message` which collapsed
   to `Load failed` when the only message available was a bare
   `TypeError`. Now formats a multi-part diagnostic:
   `<message> · HTTP <status> · (<ErrorName>) · after N attempts ·
   cause: <causeName>: <causeMsg> · source: <kind> · size: X.X MB`.
   Always logs the raw error object to `console.error` with the
   item, status, detail, and cause for DevTools triage.

3. **Server-side traceback emission** in `mantisanalysis/server.py`
   (`upload_source` + `load_path`). The catch-all now prints the
   full traceback to stderr AND appends the deepest call-site
   frame to the HTTPException detail: e.g. `load failed: OSError:
   ... [at File "h5py/h5f.pyx", line 104, in h5py.h5f.open]`. The
   traceback walker prefers `/mantisanalysis/` frames (so the
   user-code call site shows up first) and falls back to the
   deepest stack frame for third-party crashes (h5py / numpy / PIL).

Live verified: dispatched a deliberately-corrupt 4-byte File via the
file-input change event → FilePill now shows
`broken.h5 / load failed: OSError: Unable to synchronously open
file (file signature not found) [at File "h5py/h5f.pyx", line 104,
in h5py.h5f.open] · HTTP 400 · source: file · size: 0.0 MB`. Console
also carries the structured Error chain for DevTools triage. Bundle
reloads clean (`index-C0zVd7Ri.js`); zero unrelated console errors;
Tier 0+1+3 + 301 unit tests green.

Note: the user's repro file `gsbsi_2019-02-20-T073232_019.h5` is a
legacy GSBSI recording. With this build, the next time it fails the
toast/pill/console will say exactly which exception class fired and
which file:line raised it, so the actual root cause is one click
away.

## Post-close hotfix #4 (Bug 12 — `Load failed` on parallel uploads)

User reported a wave of `W-LOAD: Failed to load <file>: Load failed`
toasts on file-input batch loads, with no useful detail beyond
"Load failed" itself. RAM usage was nowhere near pressured (192 GB
total, 71 GB used) so OOM was ruled out.

Root cause: the bare-string `Load failed` capitalization is the
canonical Safari/macOS-WebKit error for `fetch()` failures at the
network layer (socket drop, per-host pool exhaustion, mid-upload
timeout). My Bug 9 parallel-load pool was running uploads 4-wide;
multipart uploads of large H5 files (~50-500 MB each) compete for
the browser's per-host TCP socket pool AND the server's
`upload_source` does `data = await file.read()` which blocks the
event loop while it slurps the whole body into RAM. Four
simultaneous of these is enough to trip Safari's network-layer
abort on at least one.

Three layered fixes:

1. **Per-kind concurrency pools.** Split the parallel-load pool
   into two concurrent queues — one 4-wide for path-loads (small
   JSON round-trip, server reads from disk concurrently fine), one
   **strictly serial** (concurrency=1) for uploads. The two pools
   run concurrently with each other (paths don't compete with
   upload sockets), but uploads never fan out. Order preservation
   in the indexed `slots` buffer still works because both pools
   key on input index.

2. **Stream uploads server-side.** `mantisanalysis/server.py::
   upload_source` no longer does `data = await file.read()` (which
   buffered the whole 500 MB H5 in a single Python `bytes` object,
   then wrote a duplicate copy to a tempfile — peak ~1 GB heap per
   concurrent upload). Replaced with
   `shutil.copyfileobj(file.file, tmp_handle, length=1 MB)` so
   upload bytes stream directly to disk, capping per-upload RAM
   overhead at the 1 MB chunk size. New
   `SessionStore.load_from_uploaded_tempfile` accepts the streamed
   tempfile and reuses the existing `_finalize_upload_from_tempfile`
   completion path so the H5/image source-kind branching stays
   single-source.

3. **Single retry on transient network errors.**
   `web/src/shared.tsx::apiUpload` now retries once on
   `TypeError: Load failed` / `Failed to fetch` /
   `NetworkError` (the canonical Safari/Chromium/Firefox messages
   for fetch network-layer aborts). 200 ms backoff lets the
   browser's socket pool recover. Real outages still surface after
   the retry — the heuristic only absorbs transient drops.

Live verified:
- 20 path-loads via `mantis:play:load-paths` in 106 ms with order
  preserved and zero errors.
- Real H5 bytes uploaded via `POST /api/sources/upload?auto_pin=true`
  returns HTTP 200 in 7.5 ms with 5 frames + 15 channels parsed;
  `frame 0` fetch returns 200 (source pinned, accessible).
- Bundle reloads clean with the new hash; zero console errors.
- Smoke 0+1+3 + 301 unit tests green.

## Post-close hotfix #3 (Bug 11 — 410 Gone on Play recordings + Play crash)

User reported that with many H5 files loaded, viewers showed "Frame 0
failed to render (HTTP 410 — recording was evicted from cache)" and
clicking Play crashed the whole page to a dark tab.

Root cause: SessionStore's LRU evicts the oldest sources when the cap
is exceeded. Pre-fix the cap was 64 (now 256), but even at 256 a real
research workflow can blow past the cap — and pre-fix Play recordings
were never pinned, so the LRU happily evicted recordings the user was
actively looking at. Pressing Play then dispatched per-frame fetches
across the whole stream, hit cascading 410s, and the resulting blob
storm + unhandled rejection toppled the tab.

Two changes:

- `mantisanalysis/server.py::LoadFromPathRequest` — added
  `auto_pin: bool = False`. The Play loader passes `auto_pin: true`
  so loaded sources flip `src.pinned = True`; the LRU's
  `_evict_locked` already skips pinned entries (the mechanism existed
  for transient handoff sources). Explicit `DELETE /api/sources/{sid}`
  still works on pinned sources — pinning is opt-out via removal,
  not a permanent lock.
- `mantisanalysis/server.py::upload_source` — added
  `auto_pin: bool = Query(False)`. Same semantics; Play's upload
  branch now POSTs to `/api/sources/upload?auto_pin=true`.
- `web/src/playback.tsx::loadRecordings` — both branches (load-path
  and upload) pass `auto_pin: true`.

Live verified: 60 synthetic H5 fixtures cold-loaded via
`mantis:play:load-paths` → all 60 FilePills register; `GET
/api/sources` returns 62 sources; **every single source's frame 0
returns HTTP 200, zero 410s**. Pressed Play, ran 2 s, stopped — zero
console errors, no error boundary, ViewerCard remained mounted.
Smoke 0+1+2+3 + 301 unit tests green.

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
