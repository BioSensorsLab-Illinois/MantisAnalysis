# fastapi-backend review — Playback (M1-M11)

Scope: `mantisanalysis/{recording,dark_frame,playback_session,
playback_pipeline,playback_export,playback_api}.py`, wire-up
`server.py:407-409`, contract vs `web/src/playback/api.ts`.

## Summary

Sound: rule-7 purity holds; `PlaybackStore` is one `RLock` so the
recursive `get_frame → get_stream → get_recording` chain can't
deadlock; `cancel_event = multiprocessing.Event()`; `_FrameLRU`
clamps + drains on shrink; 410+`{detail,evicted_id,kind}` per §7
wired. Two P0s: WYSIWYG breaks on export (dark forced None); M11
handoff pokes `STORE._items` directly.

## Findings

| Sev | File:Line | Finding |
|-----|-----------|---------|
| P0 | `playback_api.py:973`,`:1079`; `playback_export.py:89` | **WYSIWYG broken on dark.** Export passes `dark=None`; preview at `:851` passes auto-matched `master.channels`. Same view + `dark_on=true` → preview is dark-subtracted, export isn't. Byte-equality test (`tests/headless/test_playback_api.py:580`) only passes because `_DEFAULT_VIEW.dark_on=False`. |
| P0 | `playback_api.py:1215-1217` | **Handoff bypasses `SessionStore` API.** `STORE._items[id]=src; STORE._evict_locked()` skips `_remember_evicted_locked`; follow-up GET on this id post-eviction returns 404 not 410 (R-0009 / §7 broken). Add `SessionStore.register_external(src)`; "private-attr poke" pattern is wrong. |
| P1 | `playback_api.py:1212`,`:1225` | **`dark_already_subtracted` wire-only.** Returned in JSON + stored in `attrs` as strings. `LoadedSource` has no field; USAF/FPN/DoF dark-attach (`session.py:147-202`) never reads it. §6a / planner-architect P1-L gate doesn't exist. |
| P1 | `playback_api.py` (whole) | **Missing routes.** No `PUT /streams/{sid}` (§4 reorder/quarantine), no `GET /darks/match` (§3), no `GET /streams/{sid}/frame/{n}/range` (§5). `update_stream` doesn't exist. `POST /streams/from-sample` (§9) absent. |
| P1 | `playback_api.py:1138-1163` | **Handoff request is `Dict[str,Any]`.** `int(req.get("frame", 0))` silently coerces missing/wrong-typed frame instead of 422. Promote to `HandoffRequest(BaseModel)`; add typed response model. |
| P1 | `playback_api.py:1022-1030`,`:1169-1175` | **Error detail nesting.** `HTTPException(422, {"detail":...,"code":...})` produces `{"detail":{"detail":"...","code":"..."}}` — FastAPI nests the second arg. Frontend can't read `body.code === "W-EXPORT-GIF-CAP"` / `"W-HANDOFF-NOLUM"`. Use `detail={"message":...,"code":...}`. |
| P1 | `playback_api.py:1027` | **APNG missing from ffmpeg gate.** §6 lists `mp4|apng` for 503; code only checks `("mp4",)`. Pillow APNG needs no ffmpeg → amend spec or include `"apng"`. |
| P1 | `playback_api.py:286-307` | **`fmt` shadows spec's `format`.** §6 uses `"format"`. `Field(..., alias="format")` or rename. |
| P2 | `playback_api.py:296` | `views: List[Dict[str,Any]]` skips validation; malformed view → runtime `KeyError`. Promote `ViewState` to Pydantic. |
| P2 | `playback_pipeline.py:94`; `playback_api.py:881` | `solve_ccm_from_patches` returns `residual_rms=NaN` when `n<3`; JSON-NaN invalid. Force `0.0`/`None` when `stable=False`. |
| P2 | `playback_session.py:766-780` | `_evict_streams_locked` skips pinned streams but counts them; all 4 pinned + 5th added → no eviction. |
| P2 | `playback_api.py:1245` | `mime_for[".png"]→"image/apng"` also matches PNG-seq inner `.png`. Branch on `job.request["fmt"]`. |
| P2 | `playback_api.py:681-687` | `delete_recording` doesn't 410 on already-evicted ids; inconsistent with `:677`. |

## Informational

- Rule 7 + rule 6 schema clean (`recording.extract_frame:477-481`,
  `dark_frame.average_dark_h5:240-244` synthesize HG-Y/LG-Y only
  for `rgb_nir`).
- `RLock` reentrancy at `playback_session.py:656-668` intentional.
- `multiprocessing.Event` wired `:1040`; `cancel_job` (`:700-706`)
  flips `status` then `set()`s — fine.
