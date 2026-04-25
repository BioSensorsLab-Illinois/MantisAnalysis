# Performance review — Playback (M1–M11)

Reviewer: performance-reviewer · 2026-04-25 · `:8773` synth + bench 1024² random frames.

## Hot-path map (peak)

| Action | Observed |
|---|---|
| Timeline drag 1 s · 4 viewers | 28 PNG fetches, 4 in-flight |
| Display.Low slider drag 1 s | **51–63 fetches, 0 debounced** |
| Play 30 fps · 2 s · 4 viewers | 216 loads = 108/s (~107 MB/s @ realistic 994 KB) |
| `render_frame` 1024² single+viridis | 53.6 ms · **994 KB PNG** |
| 1024² + overlay | 93 ms · **1.76 MB PNG** |
| 1024² RGB+grade+CCM | **117 ms · 1.1 MB** |
| 2×2 RGB+grade per scrub | **~469 ms wall (4× sequential)** |

## Findings

| ID | Sev | Where | Evidence + fix |
|---|---|---|---|
| F1 | **P0** | `Inspector.tsx:712-924` Sliders → `api.ts:106` `previewPngUrl` → `ViewerCard.tsx:85-96` | 1-s Display.Low drag → 51 distinct PNG fetches (63 burst, 4 in-flight). **No debounce, no AbortController.** With 994 KB / 53–117 ms server cost, every drag = ~6 s backlog + ~60 MB transfer. Violates AGENT_RULES "drag/slider debounce ≥ 80 ms". **Fix:** wrap `view/update` in `useDebounced(80)`; `AbortController.signal` so superseded fetches drop. |
| F2 | **P0** | `playback_export.py:30` imports `ProcessPoolExecutor` (**unused**); `playback_api.py:1051,1117` `_run` is single `threading.Thread` with sequential `store.get_frame`+`render_views_for_frame`. Docstring `playback_export.py:12` claims "ProcessPoolExecutor workers" — **false**. | At 117 ms/frame RGB+grade, 30 fps × 1 s tiled-2×2 1080p ≈ **22 s vs 8-s budget** (TEST_PLAN §Tier 8). `render_frame_for_export` is unwired. **Fix:** route through `ProcessPoolExecutor(max_workers=cpu/2)` reused for the job; or drop the parallelism claim and re-baseline. |
| F3 | **P1** | `index.tsx:179-193` ticker | Dep array includes `state.frame` → `setInterval` torn down + recreated every tick (216 fetches in 2 s). Clamps to ≥ 8 ms (125 fps) past the 60 fps cap. **Fix:** latest-frame `useRef`; deps only `[playing, fps, speed, total_frames]`. Use `requestAnimationFrame`. |
| F4 | **P1** | `ViewerCard.tsx` not in `React.memo`; `index.tsx:341-386` ViewerGrid receives a fresh `views` array per `view/update` | All 4 cards commit per tick (mutation observer: only selected mutates DOM, but all 4 commit). ~3× wasted commits at 4-up. **Fix:** `React.memo(ViewerCard)`; `useCallback` handlers. |
| F5 | **P1** | `previewPngUrl` `api.ts:106` + `playback_api.py:856` `Cache-Control: no-store` | PNG bytes are pure functions of URL; every backward-scrub re-decodes + re-encodes. `_FrameLRU` caches only channel arrays — LUT+PIL encode (≥ 50 ms) reruns. **Fix:** `Cache-Control: max-age=300, immutable`; optionally `lru_cache` on `(stream_id, frame, hash(view))` → PNG bytes. |
| F6 | **P1** | `tests/web/test_playback_perf.py` missing | TEST_PLAN §Tier 8 specced; no automation. F1/F2/F3 will silently re-regress. **Fix:** create per spec. |
| F7 | **P2** | `playback_pipeline.py:246-260` `_apply_colormap` | `importlib.import_module("matplotlib")` + `matplotlib.use("Agg")` per call. **Fix:** hoist; cache cmap by name. |
| F8 | **P2** | `playback_pipeline.py:391-401` `_downscale` | `importlib.import_module("PIL.Image")` per call. **Fix:** hoist. |
| F9 | **P3** | `playback_pipeline.py:578` | `optimize=False` correct (3× faster encode). Pair with F5. |

## Memory & cache

`_FrameLRU` sound: `playback_session.py:422` byte-counting O(channels) on `put` only; `_evict_locked:453` O(1) per pop; `drop_recording:432`/`drop_stream:440` walks ≤ 200 keys at default 2 GB cap. `Inspector.tsx:462` `FrameLruWidget` refreshes on mount only.

## Recommendation

`render_frame` well-factored; WYSIWYG byte-equality test excellent. **F1+F2 block the M11 flag-default flip** — slider drags on real 1024² RGB-graded frames multi-second-stall; §Tier 8 export budget unmet single-threaded. F3–F5 are one-afternoon wins. Recommend a Phase 12 perf pass before defaulting `mantis/playback/enabled=1`.
