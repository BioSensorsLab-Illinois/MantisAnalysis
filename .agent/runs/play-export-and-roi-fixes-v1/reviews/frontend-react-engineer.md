# frontend-react-engineer — play-export-and-roi-fixes-v1

Verdict: **fix-then-ship** (all P0/P1 resolved before close).

## Summary

Frontend reviewer audited the M1–M4 changes to `web/src/playback.tsx`:
labels-on-overlay URL wiring, `buildVideoUrl` quality bump + ISP
forwarding, multi-source export modal + polling, ROI vertex drag/delete/
insert handlers, TBR overlay channel picker. Verdict: state + data flow
mostly clean; one polling-loop unmount hazard plus two UX hardenings
in the same modal.

## P0/P1 disposition

| Tag | Issue | Resolution |
|---|---|---|
| **P1-A** | Polling loop unmount-unsafe + double-Export hazard | Added `exportPollAbortRef` ref + cleanup `useEffect` flips `aborted=true` on unmount; every `setExportJob` and every `await` in the polling closure consults the token via `safeSetJob` / early returns; a fresh export call aborts the prior token. |
| **P1-B** | Modal close allowed mid-`queued` / post-`done` | `onClose` now blocks when status ∈ {`queued`, `running`, `done`}. |
| **P1-C** | `onCancelJob` swallowed DELETE errors | Both non-2xx response and network failure now `say()` a warning. |
| **P2-C** | `<progress>` lacked accessible name | `aria-label="Export progress"` added. |
| **P2-D** | Cancel button missing `type="button"` | Added; defensive against future form context. |

## P2/P3 deferred

- **P2-A** Spinbox state not re-clamped when totalFrames changes mid-modal
  (existing pre-PR behavior). Backlog.
- **P2-B** Vertex hit-tolerance hard-coded to 12 CSS px — adequate at
  typical zooms (1×–4×); risk-skeptic E covers extreme zoom case
  separately. Backlog.
- **P3-A** `_appendLabelsQuery` early-returns on falsy input — verified
  in source (line 107). No change needed.
- **P3-B** Banner hides when exportJob non-null — cosmetic. Backlog.

## Verification

- Tier 0 (prettier + eslint + tsc) green.
- 301 unit tests pass.
- Bundle reloads clean with no console errors.
- Live screenshot confirms Play tab renders cleanly post-fixes.

Files reviewed: `web/src/playback.tsx`.
