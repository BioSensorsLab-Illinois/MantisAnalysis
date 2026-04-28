# risk-skeptic — play-export-and-roi-fixes-v1

Verdict: **fix-then-ship** (all P0/P1 resolved before close).

## Summary

Adversarial review of the multi-source export + ROI edit + TBR fixes.
Found 1 P0 (input validation gap), 3 P1s (concurrency, tempfile race,
cancel-after-success), and 4 P2/P3 robustness items.

## P0/P1 disposition

| Tag | Issue | Resolution |
|---|---|---|
| **D** (P0) | `MultiSourceVideoRequest` had no bounds on numeric fields; `preset` accepted arbitrary strings forwarded to ffmpeg CLI args | `Field(ge=, le=)` on fps/crf/max_dim/sharpen/etc + `Literal[...]` on preset/render/gain/blend/sharpen_method/format. Live-verified 422 on bad preset, crf=999, bad sharpen_method. |
| **A** (P1) | Second Export click spawned a parallel job; UI raced two polling closures | (a) `exportJob` guard short-circuits `exportVideo` when a job is in flight + says warning; (b) Export button disabled when `!!exportJob`; (c) defensive abort-token cleanup of any prior polling closure. |
| **B/C** (P1) | Tempfile race after success and cancel-after-success deletes a fully-encoded MP4 | (B) `/result` reads bytes once + unlinks tempfile + clears `result_path` (verified: re-fetch 410s); (C) snapshot `cancelled_mid_encode = cancel_event.is_set() and produced < total_frames` BEFORE `writer.close()`; only unlink when produced fell short. |

## P2/P3 deferred to backlog

- **E** Vertex drag at z=32 — hit-test tolerance shrinks proportionally
  to zoom but rendered circle scales too. Acceptable v1; backlog item
  for an explicit "scale tolerance with zoom" pass.
- **F** Spinbox frameCount mid-edit can show nonsense values — pre-PR
  behavior; cosmetic. Backlog.
- **G** TBR Recompute uses live `buildViewConfig` even when entry
  was committed under a different overlay-ness — entry stays pinned by
  sourceId/frame/channel/polygon; recompute semantics intentionally
  follow the live view per existing v2 design. Backlog: surface a
  "view kind changed" warning in the Recompute tooltip.
- **H** Long exports lack ETA hint — backlog feature.
- Hidden coupling: `_JOBS` singleton survives uvicorn `--reload`
  re-import → orphaned. Documented; production deployments don't use
  `--reload`.

## Verification

```
422 on out-of-range preset:        verified live
422 on out-of-range crf:           verified live
422 on bad sharpen_method:         verified live
Re-fetch /result returns 410:      verified live (tempfile cleaned)
Export button disabled while job:  verified via JSX disabled prop
Polling loop abort on unmount:     verified via cleanup useEffect
```

Files reviewed: `mantisanalysis/server.py`, `mantisanalysis/export_jobs.py`,
`web/src/playback.tsx`, `web/src/analysis/modes/tbr.tsx`.
