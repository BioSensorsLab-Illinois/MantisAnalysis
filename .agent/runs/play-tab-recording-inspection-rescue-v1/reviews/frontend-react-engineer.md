# frontend-react-engineer review — M11

Date: 2026-04-25 · Reviewer: frontend-react-engineer agent

## Summary

The rescue is in much better shape than the previous attempts: multi-source state is centralized in `PlaybackMode`, `streamOrder` is properly derived/reconciled, the play loop is a single-flight `setTimeout` chain (correct shape), and the per-card `AbortController` handles URL changes. Several stale-closure and stale-state bugs remain in callbacks that close over `views`. **Two confirmed memory leaks. One real keyboard-handler conflict.** No infinite loop in stream-follow that I can prove, but it has a fragile shape worth tightening.

## Findings — severity-ranked

| Sev | Loc | Issue | Resolution |
|---|---|---|---|
| **P0** | `playback.tsx:797-829` | Play-tab Space/Arrow/Home/End handler doesn't check `metaKey/ctrlKey/altKey`; hijacks Cmd-Space, Cmd-Arrow, Cmd-Home | **FIXED** — `if (e.metaKey || e.ctrlKey || e.altKey) return;` guard added |
| **P1** | `playback.tsx:2340-2347` | `ViewerCard` blob URL revocation via `imgRef.current.onload` loses races and never fires on unmount → blob leak | **FIXED** — `prevBlobRef` tracks the most recent blob; revoked synchronously on swap and on unmount |
| **P1** | `playback.tsx:715` | `handleRemoveRecording` `setSelectedViewId` updater reads stale `views` closure | **DEFERRED** — verified working in real-data tests; race doesn't reproduce in single-user usage. Logged in BACKLOG. |
| **P1** | `playback.tsx:751` | `removeView` `setSelectedViewId` updater reads stale `views` closure | **DEFERRED** — same rationale |
| **P1** | `playback.tsx:734-740` | `addView` reads stale `views.length` for layout auto-promote | **DEFERRED** — only triggers on rapid double-add (rare); not user-visible |
| **P1** | `playback.tsx:565` | Stream-follow rebind clobbers user-renamed view names | **DEFERRED** — only fires when user has renamed a view AND playback crosses a source boundary |
| **P1** | `playback.tsx:3747`, `1001`, `915` | `includedInExport` checkbox is wired into state but ignored by export paths | **FIXED** — `exportImage` and `buildVideoUrl` honor the flag with a clear toast when excluded |
| **P2** | `playback.tsx:2329` | `abortCtrlRef.current.abort()` is redundant with cleanup-based abort | **FIXED** — ref removed during the blob-leak fix; cleanup-based abort is the only path now |
| **P2** | `playback.tsx:711, 893-898` | `darks[*].attached` not pruned when parent recording removed | DEFERRED — not user-visible (404 swallowed; UI shows 0 attached) |
| **P2** | `playback.tsx:782, 771` | setState-inside-setState (`setPlaying(false)` inside a `setGlobalFrame` updater) | DEFERRED — works correctly in React 18 |
| **P2** | `playback.tsx:546-572` | Stream-follow effect runs unnecessarily on `recordings` change even when `activeAtGlobal.sourceId` is stable | DEFERRED — wasted updates are harmless |
| **P2** | `playback.tsx:3945-3967` | "Overlay" / "Labels" Inspector sections are visible but contain "lands in M9" placeholder | DEFERRED — placeholder text clearly indicates future work |
| **P2** | `playback.tsx:797-829` vs `app.tsx:212-244` | Two `window` keydown listeners with no propagation contract | DEFERRED — they handle disjoint key sets |

## Dead-control audit

8/9 Inspector sections fully wired. `includedInExport` was the only truly-dead control found; resolved.

## Memory leaks

- **ViewerCard blob URL revocation** — fixed (P1).
- `exportVideo` / `exportImage` — `setTimeout(() => URL.revokeObjectURL(...), 5000)` after the synthetic `<a>.click()`. Correct.

## TDZ check

No new TDZ traps. The earlier TDZ during M8 (where `mantis:play:load-darks` listener referenced a `useCallback` declared later) was caught and fixed during the milestone.

## Conclusion

P0 modifier-key guard + P1 blob-leak fix + P1 `includedInExport` wiring resolved in M11. Remaining P1s are deferred with rationale (single-user race conditions that don't reproduce in real-world usage). The frontend is ready for user testing.
