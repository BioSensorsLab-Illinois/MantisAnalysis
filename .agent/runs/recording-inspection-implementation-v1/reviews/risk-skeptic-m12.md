# risk-skeptic — recording-inspection-implementation-v1 (M12 audit)

Reviewed by: `risk-skeptic` agent
Date: 2026-04-25
Disposition: **Pause** — 1 P0 regression confirmed, 5 P1, 5 P2

## Premise check

Implementation claims that the M0 P0/P1 mitigations are in place.
Two of three P0s do hold:
- **rs-P0-B** (kind-routing) intact in
  `web/src/shared.tsx:2430-2462` + `web/src/app.tsx:159-180` +
  `web/src/playback/state.tsx:251-269`.
- **rs-P0-C** (process-global LRU) is correctly a single `OrderedDict`
  on `PLAYBACK_STORE._frame_lru` at `playback_session.py:375-457`.

**rs-P0-A is undone**: the export path uses neither `Manager().Event()`
nor `ProcessPoolExecutor`. The plan as documented is fiction.

## Findings

| ID | Sev | Title | File:line | Exploit |
|---|---|---|---|---|
| A1 | **P0** | rs-P0-A regressed: bare `multiprocessing.Event()` + threaded export | `playback_api.py:1040, 1117` | `cancel_event=multiprocessing.Event()` (no Manager); `_run` is `threading.Thread`, not `ProcessPoolExecutor`. `playback_export.render_frame_for_export` is unreachable dead code. The "cross-process cancel" mitigation is fiction. If anyone scales the worker out per the docstring at `:1050`, cancel will silently no-op. |
| A2 | P1 | Cancel mid-encode leaves partial output file orphaned | `playback_api.py:1063-1117` | `_frames()` checks `cancel_event.is_set()` between frames and returns; `imageio_ffmpeg.write_frames` flushes partial output to `out_path`; `_run` belatedly sets status=`cancelled` but the half-written `.mp4`/`.gif`/`.zip` is never unlinked. `outputs/playback/` grows without bound. |
| A3 | P1 | Handoff `LoadedSource` missing `raw_frame`, `path`, `isp_mode_id`, `isp_config` | `playback_api.py:1204-1214` | Default `isp_mode_id="rgb_nir"`, `isp_config={}`, `raw_frame=None`. Response payload at `:1223` reports correct `stream.isp_mode_id`, but `LoadedSource.isp_mode_id` lies. `STORE.update_isp` (`session.py:280-294`) tries to re-extract from `raw_frame=None` → crash or silent no-op. The "handoff frozen at this frame" UX cannot be re-extracted. |
| A4 | P1 | Bare `multiprocessing.Event()` on macOS spawn-default + uvicorn `--workers N>1` | `playback_api.py:1040` | Per-job bare Event; under multi-worker, the cancel DELETE may hit a different worker than the one running `_run` → silent no-op. The Manager fix needs Manager kept alive at process scope. |
| A5 | P1 | `match_dark_by_exposure` allows `exposure=0.0` dark to "always match" | `dark_frame.py:351` | `target_abs = max(abs(float(target)), eps)`; with target=0.0 numerator is 0 → `delta_pct=0` regardless of dark exposure. Dark with missing/zero exposure auto-attaches incorrectly. |
| A6 | P1 | `extract_frame` worker-process payload sets `frame_count=local_frame+1` to bypass bounds | `playback_export.py:188-208` | Cute trick to pass the bounds check at `recording.py:466`. Today dead because A1 means the worker never runs; if A1 is fixed by switching to ProcessPool, this becomes live and a stale `frame_idx` can silently re-extract a different frame. |
| B1 | P2 | `STORE._items[src.source_id] = src` reaches into private attrs of session.py | `playback_api.py:1215-1217` | Lock contract upheld (RLock), but bypasses `STORE.load_from_path/load_from_bytes` invariants. Pure encapsulation break. Add `STORE.register_loaded(src)`. |
| B2 | P2 | `useLocalStorageState` swallows `JSON.parse` errors silently | `web/src/shared.tsx:2214-2229` | Corrupted `mantis/playback/*` revert to default with no warning. No data loss beyond UI prefs. |
| B3 | P2 | `has_ffmpeg()` in `playback_export.py` has no cache; reruns 5 s subprocess every video export | `playback_export.py:155-165` ; `playback_api.py:1027` | Two parallel implementations. The 503 gate at `:1027-1031` calls the export-module one (uncached). Burst exports serialize 5 s each. |
| B4 | P2 | Empty / single-frame stream + `range=(0,0)` mp4 path edge cases | `playback_export.py:295-311` | Cancel-before-first-frame swallows the cancel signal in the `failed` overwrite at `:1113-1115`. Single-frame H.264 mp4 may be undecodable. |
| B5 | P2 | `frame_lru.set_cap` releases entries but Python GC delay → RSS doesn't drop | `playback_session.py:408-411, 453-456` | Inspector "Memory" widget shows `current_bytes=200 MB` while `top` reports 1.5 GB RSS for ~10 s. Document or call `gc.collect()`. |

## Stale assumptions caught

- "Handoff sends raw extracted channels (post-dark, pre-display)" — but
  `LoadedSource.raw_frame=None` means the receiving mode cannot
  re-extract. The naming "raw" is overloaded.
- `tests/headless/test_playback_api.py:544-557` only cover the no-dark
  branch of handoff. The dark-attach + double-dark refusal contract
  from rs-P1-L is not exercised end-to-end.

## Race / timing

- `cancel_event.set()` (DELETE `/exports/{id}`) races `_run`'s
  `write_video` body — `imageio_ffmpeg.write_frames` doesn't poll the
  event; the writer drains its buffer, finalizes the moov atom, then
  `_run` belatedly marks `cancelled` but the file is complete. UI
  says cancelled, file is on disk.

## Disposition (M12)

**Pause** until A1 is either restored (Manager + ProcessPool) or
honestly downgraded in docs + dead code removed.

- **A1 (P0):** **fix now in M12 by honest downgrade** — the threaded
  export works correctly for the local single-user use case (the
  documented target audience); restore Manager + ProcessPool would
  add complexity unjustified by the use case. Action: rewrite the
  rs-P0-A docstrings to say "thread-only Event, single-process; Manager
  + ProcessPool deferred to a future scale-out initiative", remove the
  dead `render_frame_for_export` + ProcessPoolExecutor import from
  `playback_export.py`, file the scale-out as a BACKLOG item.
- **A2 (P1):** **fix now in M12** — add `try/finally` to unlink the
  partial output on cancel/fail in `_run`.
- **A3 (P1):** **fix now in M12** — pass `isp_mode_id` and a fresh
  `isp_config` from the stream into the new `LoadedSource`. Skip
  `raw_frame` (re-extract from raw bayer is out of scope for handoff;
  the handoff is "frozen frame as-is").
- **A4 (P1):** documented in A1's downgrade — single-process is the
  supported deployment.
- **A5 (P1):** **fix now in M12** — add `if abs(target) < eps: return
  None, "no exposure metadata"` early in `match_dark_by_exposure`.
- **A6 (P1):** subsumed by A1 (dead code removed).
- **B1-B5 (P2):** track in BACKLOG.

## Disposition rollup

**Land the four inline fixes (A1 docstring + dead-code removal, A2
unlink, A3 isp_mode_id, A5 exposure guard) in M12.** Track the rest
in BACKLOG. The three "real" production scale-out fixes (Manager,
multi-worker, ProcessPool) become a separate `playback-multiproc-v1`
follow-up if the deployment story ever changes.
