# frontend-react-engineer — M1–M5 review

Verbatim agent output (2026-05-07).

## Summary

Sound architecture overall. The pixel readback uses a sequence-counter pattern that mirrors the existing TBR `reqSeqRef`, the FloatingWindow / Inspector pill fork is provider-rooted at `PlaybackMode` with a single source-of-truth (`lodRatioWindow.popped`), and the v1→v2 migration is one-shot with retention of `tumor*` aliases. The pure `lod.ts` helper is correctly factored out of the React layer.

Three concern clusters: re-render storm during fast cursor drags, duplicate-`order` edge case in `moveEntry` silently no-ops, and a small set of accessibility / TS-cast / migration robustness items.

## Findings

### P0 — None.

### P1

**P1-1. Pixel-readback re-renders entire `ViewerCard` at ~60 Hz under fast drag.**
- File: `web/src/playback.tsx:6240-6252, 6575`
- `setPixelInfo` always returns a fresh object → React doesn't bail → entire ViewerCard function re-runs on every move.
- Fix: compare prev vs next inside the updater and return `prev` when unchanged; or wrap `<_RoiOverlaySvg>` in `React.memo`.

**P1-2. `moveEntry` silently no-ops when two entries share the same `order` value.**
- File: `web/src/playback.tsx:13306-13321`
- When `a.order === b.order`, the swap writes the same number to both → sort key doesn't change → buttons appear broken.
- Fix: renumber `renderable` 0..n-1 before swapping, OR detect equal `order` and assign `idx, swapIdx` directly.

**P1-3. Pixel-readback debounce is 30 ms, project convention is ≥80 ms.**
- File: `web/src/playback.tsx:6289`
- Other debounced endpoints (USAF measure, FPN compute, polygon-stat fetch) sit at 120 ms.
- Fix: bump to 120 ms.

### P2 (defer to backlog)

- P2-1: Migration: malformed entries become hollow rows (`{}` becomes `{kind:'ratio',...}` with no id/value/polygon). Drop entries lacking id + signalValue/tumorValue.
- P2-2: Migration: orphan v1 key when v2 already exists. Always `removeItem(v1)` after a successful v2 read.
- P2-3: Reorder arrows announce as Unicode glyph names. Add `aria-label="Move entry up/down"`.
- P2-4: `Checkbox` `ariaLabel` cast is a phantom prop (silently dropped). Either extend `Checkbox` or wrap in `<label>`.
- P2-5: Inline-edit fires full localStorage write per keystroke. Debounce 300 ms.

### P3

- Inline chart components in `useTbrModeView` (matches sibling pattern in usaf/fpn).
- Polygon-stat effect re-fires on each pop-in/pop-out toggle (idempotent, infrequent).
- FloatingWindow global listeners not cleaned mid-drag on unmount (pre-existing, out of scope).

## Disposition

**FIX-THEN-SHIP.** P1-1, P1-2, P1-3, P2-3, P2-4 should land before close.
