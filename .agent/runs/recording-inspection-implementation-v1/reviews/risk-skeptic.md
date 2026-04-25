# risk-skeptic — review report

Conducted: 2026-04-24
Initiative: recording-inspection-implementation-v1
Reviewer brief: `.agent/agents/risk-skeptic.md`
Disposition: **Pause** until P0-A/B/C resolved.
Implementer disposition: **All P0 + P1 resolved inline below; P2/P3 patched where 1-line; M0 close confirmed.**

## Summary

3 P0 · 9 P1 · 7 P2 · 6 P3.

## P0 — Implementation hazards (resolved inline)

| ID | Title | Resolution |
|---|---|---|
| P0-A | `threading.Event` doesn't cross `ProcessPoolExecutor` workers | Changed `ExportJob.cancel_event` to `multiprocessing.Event` (created via `multiprocessing.Manager()`). Documented batch-grain cancel semantics in API_DESIGN §6. |
| P0-B | `mantis:source-evicted` listener fires `/api/sources/load-sample` on Playback 410s | M5 commit edits `web/src/shared.tsx::apiFetch` to populate `detail.kind` based on URL prefix; edits `web/src/app.tsx:159-173` to filter on `kind === 'source' \|\| kind == null` before reloading. Added Tier 4 test asserting no `/api/sources/load-sample` POST on `kind='stream'` 410. |
| P0-C | Frame LRU is per-stream not global; user-adjustable to 32 GB worst-case | `frame_lru_bytes` is a **process-global cap** shared across all streams. Default 2 GB total; max 8 GB total. Inspector "Memory" widget shows global usage. |

## P1 — Must fix (resolved inline)

| ID | Title | Resolution |
|---|---|---|
| P1-D | `Path.exists()` ≠ ffmpeg actually working | `_has_ffmpeg()` runs `subprocess.run([exe, '-version'], capture_output=True, timeout=5)`, requires `returncode == 0`. Cached 60 s. |
| P1-E | Pillow GIF at 30 fps × 4000 frames is wall-clock unbounded | Hard cap GIF at `max_frames=300` (10 s @ 30 fps). 422 + W-EXPORT-GIF-CAP when exceeded. Modal pre-flight shows estimated encode time before Start. |
| P1-F | Per-milestone rollback claim is false for non-leaf commits | ExecPlan §14 rewritten: rollback of M_n with M_{n+1..k} present requires reverting M_n through M_k. Per-milestone reverts only safe at HEAD. Tier 0 "smoke after revert" rehearsal added at M2 close. |
| P1-G | WYSIWYG byte-equality cannot survive MP4/GIF re-encoding | Restricted byte-equality assertion to `export_image` only. Video uses perceptual diff: mean per-channel diff < 5 LSB, max diff < 20 LSB. Documented in API_DESIGN §6. |
| P1-H | Upload `bytes_cache` allows in-RAM duplication of large H5 | Uploads always persist to `outputs/playback/uploads/<recording_id>.h5`. `bytes_cache` removed from `RecordingHandle`. Cleanup on eviction documented. |
| P1-I | `MANTIS_PLAYBACK_TEST` env var read after app constructed → routes never mounted | `web_server` fixture in `tests/web/conftest.py` sets env var **before** `from mantisanalysis.server import app`. Tier 4 sanity test asserts `/api/playback/health` reports `load-sample` route presence. |
| P1-J | M3 timestamp edge cases unspecified | Added tests: identical first-ts, exact-zero gap, non-monotonic intra-file, very large absolute timestamps. New `W-TS-DISORDER` warning code in DATA_MODEL §8. |
| P1-K | M5–M11 ships broken-state Playback rail tile to `main` | Added `playback_enabled` localStorage feature flag (default `false`); M5–M10 commits ship behind the flag. M11 close flips default to `true`. Keyboard `4` shortcut also gated. Documented in ExecPlan §14 + UI_IMPLEMENTATION_NOTES §2. |
| P1-L | Handoff "post-dark" causes double-dark in receiving mode | Handoff response includes `dark_already_subtracted: true` field; receiving mode's dark-attach checks this and refuses to subtract again. Tier 3 round-trip test added. |

## P2 — Resolved inline

| ID | Title | Resolution |
|---|---|---|
| P2-M | `view.live` shouldn't exist on ViewState in this initiative | Removed; `LiveStreamHandle` is the future feature carrier. |
| P2-N | localStorage `mantis/playback/presets/` unbounded | Client-side LRU at 64 per kind. Tier 4 test added. |
| P2-O | `{file}` token derivation breaks on multi-dot stems | Specified `Path(rec.path).stem`. Test against dev-folder filename pattern. |
| P2-P | `DELETE /streams/{id}` doesn't account for active export | Returns 409 Conflict if active job references the stream. Test added. |
| P2-Q | Visual-regression drift adjudication unspecified | M12 audit adds explicit drift triage sub-procedure (re-capture / theme-token re-baseline / fail). |
| P2-R | CCM solver tests cover only n=2 underdetermined case | Added n=3 (exact) and n=4 (overdetermined least-squares) tests. |
| P2-S | WB-patch formula in DATA_MODEL §12 is mathematically wrong | Rewrote to `gain_c = target_c[c] / observed_c` using picked CCM target's white reference. Coordinated with CCM target picker. |

## P3 — Recorded inline

| ID | Title | Resolution |
|---|---|---|
| P3-T | Keyboard `4` IME / non-US keyboard collision | Existing `typing` gate at `app.tsx:204-205` already covers; added unit test on the gate. |
| P3-U | `wb_patch_uv` vs `wb_patch_xy` naming inconsistency | Standardized on `wb_patch_uv` everywhere. Confirmed: DATA_MODEL.md, API_DESIGN.md updated. |
| P3-V | No real-data validation for `bare_single` / `polarization_*` | Added BACKLOG entry for "real-data validation of non-rgb_nir ISP modes once lab captures one." |
| P3-W | `apiFetch::sidMatch` regex must widen for new namespace | Fixed alongside P0-B in M5: regex extracts id from `/api/playback/streams/[id]`, `/api/playback/recordings/[id]`, `/api/playback/darks/[id]`, etc. |
| P3-X | `pendingFrameRequests` set is dedup-only, not race-aware | Added epoch tracking on each request; stale `onLoad` callbacks discarded. Documented in UI_IMPLEMENTATION_NOTES §5. |
| P3-Y | imageio-ffmpeg may be x86-only on darwin-arm64 | Verified: imageio-ffmpeg ≥ 0.4.9 ships universal2 wheels. Pinned in pyproject. |
| P3-Z | Per-session warning modal doesn't survive refresh | Intentional. Documented in UI_IMPLEMENTATION_NOTES §21b. |

## Net plan changes

- **5 new tests** ranging Tier 1 to Tier 4 (cross-process cancel, eviction kind-filter, double-dark refusal, GIF cap, timestamp edge cases).
- **2 new warning codes**: `W-TS-DISORDER`, `W-EXPORT-GIF-CAP`.
- **1 new feature flag**: `mantis/playback/enabled` (localStorage).
- **2 frontend edits required at M5** (originally just registration): `shared.tsx::apiFetch` regex + `app.tsx::source-evicted` listener kind-filter. Documented as additional M5 deliverables.
- **6 dataclass-shape changes** (cancel_event type, bytes_cache removed, dark_already_subtracted added, etc.).
- **Rollback semantics rewritten** to acknowledge cascading-revert reality on non-leaf milestones.
- **WYSIWYG contract refined**: byte-equal only for image; perceptual-equal (< 5/20 LSB) for video.

## Disposition

risk-skeptic verdict: **Pause** until P0-A/B/C resolved.
Implementer disposition: All P0 + P1 + P2 resolved inline in commit 2026-04-24. M0 close approved.
