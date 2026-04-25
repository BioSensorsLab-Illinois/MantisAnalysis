# fastapi-backend-reviewer review — M11

Date: 2026-04-25 · Reviewer: fastapi-backend-reviewer agent

## Summary

New Play / Recording-Inspection routes layer cleanly on top of the existing single-frame surface. Pydantic schemas, 404/410 distinctions, PNG content-types, dark-frame averaging, and FrameReader lifecycle on remove + LRU eviction are all sound. The 31 new tests cover cache bounds, multi-source independence, and the R-0009 410-vs-404 contract.

**Found 1 P0 (data-corruption / cross-source thread race), 4 P1 (export route hazards + cache-key edge case), and several P2/P3 polish items.**

## Findings — severity-ranked

| Sev | File:Line | Issue | Resolution |
|---|---|---|---|
| **P0** | `mantisanalysis/session.py:188-236` | `extract_frame` racy under concurrent FastAPI threadpool requests on the same source — could leak h5 handles or corrupt the OrderedDict cache | **FIXED** — added `LoadedSource._lock: threading.RLock`, wrapped reader-init + cache R/W and `invalidate_frame_cache` / `close_frame_reader` under the lock |
| **P1** | `mantisanalysis/session.py:219` | `_hash_isp_config` JSON-serializes with `default=lambda x: list(x)` which fails on non-iterable scalars | DEFERRED — not currently reachable (config is always JSON-shaped from `normalize_config`); left as defensive note |
| **P1** | `mantisanalysis/server.py:993-1225` | `/export/video` buffers everything in memory; no max-frame guard | **FIXED** — added `MAX_EXPORT_FRAMES = 2000` cap returning HTTP 413 |
| **P1** | `mantisanalysis/server.py:1175-1179` | `/export/video` MP4 path's broad `except Exception` swallows `HTTPException` from `render_frame` into a 500 | **FIXED** — `except HTTPException: raise` runs first |
| **P1** | `mantisanalysis/server.py:1165-1179` | libx264 / ffmpeg-not-installed → generic 500 instead of 503 | **FIXED** — `(RuntimeError, OSError, ImportError)` mapped to HTTP 503 with explicit "try format=gif or format=zip" hint |
| **P2** | `mantisanalysis/session.py:601-620` | `_load_dark_channels` reads ALL frames into RAM | DEFERRED — typical lab darks are ≤200 MB; documented assumption |
| **P2** | `mantisanalysis/server.py:1147,1195` | `import imageio` inside route function rather than module top | KEPT INTENTIONAL — lazy import keeps cold-start cheap and tolerates installs without imageio |
| **P2** | `mantisanalysis/server.py:495-503` | `delete_source` reaches into `STORE._items` directly | DEFERRED — pre-existing pattern, not a regression from this initiative |
| **P2** | `mantisanalysis/server.py:490-492` | `load_sample` mutates `STORE._items` directly | DEFERRED — pre-existing pattern, not a regression from this initiative |
| **P3** | `mantisanalysis/server.py:74` | `SourceSummary.frame_count: int = 1` backward-compat | OK — verified USAF/FPN/DoF frontends don't reference it; default `1` is correct |
| **P3** | `mantisanalysis/session.py:46-47` | `FrameReader` docstring claimed thread-safety it didn't have | UPDATED — comment now references the new per-source `_lock` |
| **P3** | `mantisanalysis/session.py:201-206` | `extract_frame` returns `self.channels` for non-H5 sources by reference | DEFERRED — documented; callers don't mutate |

## Contract alignment (frontend ↔ backend)

`web/src/playback.tsx` consumes: `frame_count`, `exposures_s`, `timestamps`, `duration_s`, `fps_estimate`. All five fields are emitted by `FrameMetadata` and/or `SourceSummary`. **No drift detected.** The frontend defensively coalesces `r.frame_count || 1` and `?? []` for arrays — robust to missing fields under 410 / network errors.

## Existing-route byte-identicality

`/api/sources/{sid}/channel/{ch}/thumbnail.png` and `/range`: `_channel_image` and `channel_to_png_bytes` are unchanged. Frame-0 of an H5 source still goes through `src.channels[ch]` (the cached extraction at load time), NOT `extract_frame(0)`. **Legacy callers see byte-identical responses.** Confirmed by USAF/FPN/DoF unit tests still passing.

## Conclusion

P0 RLock + 3 P1 export route fixes resolved in M11. Backend is ready for user testing. Concurrent multi-request safety is now correct. Export route is bounded and surfaces the right status codes.
