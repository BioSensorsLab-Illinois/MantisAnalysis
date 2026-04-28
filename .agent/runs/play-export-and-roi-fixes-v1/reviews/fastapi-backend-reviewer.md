# fastapi-backend-reviewer — play-export-and-roi-fixes-v1

Verdict: **fix-then-ship** (all P0/P1 resolved before close).

## Summary of findings

Backend reviewer audited M1+M2+M4 server changes (`mantisanalysis/server.py`,
`mantisanalysis/export_jobs.py`). Verdict was that the architecture was
sound (single-worker executor + Event cancellation + RLock-protected
JobStore + lazy writer with first-frame-locked dims) but had 5 P1 issues
plus several P2/P3 robustness improvements.

## P0/P1 disposition

| Tag | Issue | Resolution |
|---|---|---|
| #1 | Result tempfile not unlinked after `/result` read | Read once, unlink, clear `result_path` — re-fetch now 410s (live verified). |
| #2 | Concurrent `/result` doubles memory | Mitigated by #1's single-read + clear; second reader gets 410. |
| #3 | Cancel race after `writer.close()` discards completed MP4 | Snapshot `cancelled_mid_encode = cancel_event.is_set() and produced < total_frames` before `writer.close()`; only unlink when truly mid-encode. |
| #4 | `sharpen_method` lacks validation | `Literal["Unsharp mask", "Laplacian", "High-pass"]` — 422 at edge (live verified). |
| #5 | `JOBS.shutdown()` never wired | `app.on_event("shutdown")` calls `JOBS.shutdown()`. |
| **D** (risk-skeptic) | No bounds on fps/crf/max_dim/preset | `Field(ge=, le=)` + `Literal[...]` for preset (422 verified live). |

## Live verification

```
422 on bad preset:        Input should be 'ultrafast', ... or 'veryslow'
422 on crf=999:           Input should be less than or equal to 51
422 on bad sharpen_method: Input should be 'Unsharp mask', 'Laplacian' or 'High-pass'
First /result fetch:      HTTP 200 · 5481 bytes (valid MP4)
Second /result fetch:     HTTP 410 · 78 bytes  (tempfile unlinked)
```

## P2/P3 deferred

- `_must_get` runtime errors inside runner — bubble as `error` status
  with type-name + message; acceptable v1 UX. Backlog.
- `_futures` populated but unread — dead state; backlog cleanup.
- `result_media_type` exposed but frontend uses Content-Disposition
  filename; cosmetic.

Files reviewed: `mantisanalysis/server.py`, `mantisanalysis/export_jobs.py`,
`mantisanalysis/image_processing.py`, `web/src/playback.tsx`.
