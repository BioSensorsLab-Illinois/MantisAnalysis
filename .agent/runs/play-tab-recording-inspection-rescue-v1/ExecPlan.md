# ExecPlan — Play / Recording Inspection Rescue

Trimmed execution view of [`/Users/zz4/.claude/plans/ultra-plan-ultra-effort-virtual-fountain.md`](../../../../../.claude/plans/ultra-plan-ultra-effort-virtual-fountain.md). Read the full plan for context, rationale, and decision log.

## Architecture summary

Backend: extend `LoadedSource` with frame-by-frame extraction; expose `GET /api/sources/{sid}/frames` and `GET /api/sources/{sid}/frame/{i}/...png`. Multi-recording uses the existing multi-source `SessionStore` — no new backend stream object.

Frontend: new file `web/src/playback.tsx` (split into `_panels.tsx` / `_modals.tsx` only if it grows past ~1.5 K LOC). Owns `recordings: Source[]`, `views: ViewState[]`, `globalFrame`, `playState`. Renders the 7-region template layout (mode chrome / stream header / sources / viewer grid / inspector / timeline / notifications). Plug into `app.tsx` mode switcher.

Real-data verification gate: `/Users/zz4/Desktop/day5_breast_subject_1`. 33 H5 files, 10 frames each, 2048×4096 uint16, dual-gain GSense RGB-NIR (see [REAL_DATASET_NOTES.md](./REAL_DATASET_NOTES.md)).

## Files touched

### Backend
- `mantisanalysis/session.py` — `LoadedSource` adds frame metadata + `extract_frame(idx)`; LRU frame cache; dark averaging.
- `mantisanalysis/server.py` — new routes; parameterize `_try_build_rgb_composite_png`.
- `pyproject.toml` — add `imageio[ffmpeg]>=2.30`.

### Frontend
- `web/src/app.tsx` — add `'play'` mode, ModeRail tile, key `4`.
- `web/src/shared.tsx` — minor icon glyph add.
- `web/src/playback.tsx` — **new**, mode entry.
- `web/src/playback_modals.tsx` — **new** (if needed), modal split.

### Tests
- `tests/unit/test_session_frames.py` — frame extraction + multi-source independence.
- `tests/unit/test_play_routes.py` — route round-trips with `httpx.AsyncClient`.
- `tests/web/test_play_smoke.py` — Playwright real-data probe.
- `tests/web/conftest.py` — env-var `MANTIS_PLAY_REAL_DATASET` fixture.

## Milestone gates (each requires real-data screenshot or test PASSED)

| M | Gate |
|---|---|
| M0 | Folder + 5 Markdown files present. ✓ |
| M1 | `pytest tests/unit/test_session_frames.py tests/unit/test_play_routes.py -q` green; live `curl /api/sources/{sid}/frame/0/channel/HG-G/thumbnail.png` returns valid PNG; frame 9 differs from frame 0; frame 10 returns 404. |
| M2 | `pytest -m web_smoke -q` green; pressing `4` in browser shows the stub. Existing modes regression-clean. |
| M3 | Real-data screenshot: 3 FilePills loaded from `day5_breast_subject_1`, console clean. |
| M4 | Real-data screenshots: RGB · HG / NIR · HG / Gray · HG-Y on the same source. |
| M5 | Real-data screenshot: timeline mini-map with 2+ file boundaries; play loop works at 10 FPS for 3 s. |
| M6 | Real-data screenshot: Stream Builder modal with continuity warnings on a multi-exposure stream. |
| M7 | Real-data screenshot: full Inspector with all 9 sections, threshold + colormap demonstrably affecting the canvas. |
| M8 | Synthetic dark fixture test passes; real-dataset shows clean "no dark loaded" warning state. |
| M9 | Real-data screenshots: overlay active in one view; PNG export downloaded and visually matches canvas. |
| M10 | Real-data: MP4 + GIF + PNG-zip exports succeed and open in their respective viewers. |
| M11 | Reviewer files in `reviews/` for all 6 reviewers; P0/P1 findings resolved; `HANDOFF.md` updated; this run's `Status.md` marked all `[x]`. |

## Stop conditions

- Hard stop: any backend test broken in USAF/FPN/DoF (regression). Revert and diagnose.
- Hard stop: real-data load fails with an error that isn't a 404 / 410 / clear validation message.
- Soft stop (ask the user): the plan calls for an architectural decision not pre-resolved (currently none — all 5 product decisions are locked).
