# test-coverage — review

2026-04-25 · **Approve with P1 fixes**

127 playback tests (88 unit, 39 Tier 3, 12 Tier 4, 5 Tier 6). Smoke
0–3 PASS; non-web 232/232. **Targeted playback subset reproducibly
fails 1/127** (P1-D).

## Findings

| Sev | Gap | Evidence | Fix |
|---|---|---|---|
| P0-A | mp.Event cancel never exercised — `cancel_job` test omits `cancel_event=`; receiver short-circuits | `tests/unit/test_playback_stream.py:363`; `playback_session.py:700-704` | `test_video_export_cancel_halts_mid_batch` — png-seq, `DELETE /exports/{id}` mid-render, assert `cancelled` and `current_frame < total_frames` |
| P0-B | Double-dark refusal (P1-L) NOT in receiver. `attach_dark_from_*` and `_get_channel_array` ignore `attrs["dark_already_subtracted"]`. Handoff test sends `dark_on=False` so guard never exercised; flag is write-only | written `playback_api.py:1212`; ignored `session.py:147-194`, `server.py:1218-1222`; test `test_playback_api.py:548` | (a) Guard in `_get_channel_array`. (b) `test_handoff_with_dark_blocks_double_subtract` per §17p — `dark_on=True`, attach dark, assert pixels == pre-handoff post-dark |
| P0-C | bare_*/polarization_* handoff path untested. `playback_api.py:1168-1175` raises `422 + W-HANDOFF-NOLUM`; zero stream tests use non-rgb_nir `isp_mode_id` | `test_recording_inspect.py:235` (inspect-only) | `test_handoff_to_usaf_bare_dualgain_returns_W_HANDOFF_NOLUM` |
| P1-D | Tier 3 isolation flake. `client` fixture clears `PLAYBACK_STORE` not `session.STORE`; eviction kills handoff source. Repro: `pytest tests/unit/test_recording_inspect.py tests/unit/test_dark_frame.py tests/unit/test_playback_stream.py tests/unit/test_playback_pipeline.py tests/headless/test_playback_api.py -q` → 1 fail | `test_playback_api.py:34` | Extend fixture: `STORE._items.clear()` + canary |
| P1-E | GIF cap test is a placeholder — does not POST `frame_range > 300`; only checks `"gif" in supported_video_formats`. Comment line 481 admits this. `422 + W-EXPORT-GIF-CAP` at `playback_api.py:1021-1026` is dead | `test_playback_api.py:475-485` | Stream `n_frames>=350`, POST `fmt="gif" frame_range=[0,350]`, assert `422 + W-EXPORT-GIF-CAP` |
| P1-F | WYSIWYG byte-equal covers only `compose=="single"`. 3 presets at `playback_export.py:113-125` with 1-px divider unbroken | `test_playback_api.py:600` | `test_image_export_byte_equal_contactsheet_2views`, `..._grid_2x2` |
| P1-G | Process-global LRU (P0-C) tested single-stream only | `test_playback_stream.py:295` | `test_lru_global_cap_evicts_across_streams` — 4 streams × 80 MB into 256 MB cap |
| P1-H | Preset 64-per-kind cap tested at unit `max_presets_per_kind=3`; prod cap untested via API | `test_playback_stream.py:410` | `test_preset_64_per_kind_lru_via_api` — POST 65, assert 64 returned |
| P2-I | Eviction kind-routing only proves `kind='stream'` does NOT reload; back-compat not asserted | `test_playback_boot.py:573` | `test_playback_eviction_kind_source_still_reloads` |
| P2-J | Video perceptual parity (§17s) unwritten — PNG-seq is lossless | none | §17s gated on `_has_ffmpeg()`: frame 0 PNG vs MP4 first frame; mean < 5 LSB, max < 20 LSB |
| P2-K | CCM det-guard for n=3 collinear untested | `test_playback_api.py:311-351` | `test_ccm_solve_n3_collinear_returns_unstable` |
| P3-L | Visual baselines deliberately do not diff (`test_playback_visual_baselines.py:18-20`). Acceptable |

## Risk-skeptic deltas (claim ≠ reality)

- P0-A "documented" → no test
- P0-B "Tier 4 added" → one direction (P2-I)
- P0-C "widget shows usage" → single-stream (P1-G)
- P1-E "300 + 422" → placeholder
- P1-G "<5/20 LSB" → none (P2-J)
- P1-L "round-trip added" → receiver guard absent (P0-B)
- P2-N "Tier 4 added" → unit-only cap=3 (P1-H)

Verified ✓: P1-J, P1-K, P2-P, P2-R.

## Recommendation

Resolve P0-A/B/C + P1-D before close. P1-E–H same PR. **P0-B most
consequential** — documented contract silently violated by receiver.
