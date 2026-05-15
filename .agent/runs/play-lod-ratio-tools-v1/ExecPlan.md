# ExecPlan — Play-mode LoD/Ratio tools v1

Six user-asked features bundled into one initiative because they all
hang off the same Inspector → TBR Analysis surface in
[web/src/playback.tsx](../../../web/src/playback.tsx) and share entry
state, polygon-drawing infrastructure, and the canvas pointer surface.
Splitting them would force three rounds of localStorage migration and
three reviewer passes; one initiative does it once.

The full design rationale + decisions live in
[/Users/zz4/.claude/plans/for-the-play-mode-recursive-globe.md](../../../../../../.claude/plans/for-the-play-mode-recursive-globe.md)
(plan file approved 2026-05-07).

## Six features → six milestones

1. **Pixel-value readback** at the cursor (M1).
2. **Reorder + sample number** in the entry table (M3).
3. **Auto-clear signal-only** on commit, keep background ROI (M3).
4. **Rename "TBR Analysis" → "LoD/Ratio Analysis"** with two modes
   (Ratio = current TBR; Intensity = LoD), k·σ-rule LoD criterion
   k ∈ {3, 6, 10}, default k=3 (M2 + M5).
5. **Flexible naming** — per-entry label + numeric value + unit (M3).
6. **Detachable panel** via existing FloatingWindow (M4).

## Architecture summary

### Backend (`mantisanalysis/server.py`)

New route at the same `/api/sources/{sid}/frame/{fi}/channel/{ch}/`
stem as `roi-stats`:

```
POST /api/sources/{sid}/frame/{fi}/channel/{ch}/pixel
body: { x: int, y: int, apply_dark, black_level, view_config, hdr_* }
→ { value: float, channel: str, x: int, y: int, pipeline_version: 2 }
```

Reuses the **exact** pipeline of `frame_channel_roi_stats` (server.py:2310):
extract_frame → optional dark subtract → `_apply_analysis_isp` →
`_apply_pre_norm` → `arr[y, x]`. Bounds-checked (404 on out-of-frame).
Same HDR fusion params + ROIStatsViewConfig schema. `PixelRequest`
Pydantic model with `extra='forbid'`.

POST not GET because the body carries view_config (~10 fields) and
GET URL length grows uncomfortably with HDR + ISP params.

### Frontend (`web/src/playback.tsx` + helpers)

**M1 — Pixel readback (~150 LOC delta).** New
`usePixelReadback(sourceId, frameIndex, channel, viewConfigSig)` hook
that owns:

- `mousemove` listener on the canvas-area div (shares the same
  bounds-rect math as `clientToImagePx` from `playback/RoiOverlay.tsx`).
- 30 ms debounced fetch to `/pixel`.
- Per-request seq counter to drop stale responses (mirrors
  `reqSeqRef` in `TbrAnalysisPanel`).
- Display-RGB sampling from the `<img>` via a hidden canvas.

Renders a bottom-left badge (same pattern as the zoom badge at
playback.tsx:6389):

```
(x, y) · CH-NAME = 12345 (DN)
RGB displayed: 230 215 200
```

Toggle in Inspector → Display: a "Pixel inspector" checkbox bound to
`view.showPixelReadback` (default true). Hidden when no recording is
loaded or the toggle is off.

**M2 — Mode rename + state migration.**

- `web/src/analysis/types.ts`: `'tbr'` → `'lod_ratio'` in the
  `AnalysisMode` union.
- `web/src/analysis/registry.ts`: `tbr: tbrSpec` →
  `lod_ratio: lodRatioSpec`.
- `web/src/analysis/modes/tbr.tsx` → `lod_ratio.tsx` rename.
- localStorage migration:
  - `mantis.play.tbrEntries.v1` is read once at boot.
  - Each entry rewritten with `kind: 'ratio'`, `analysisMode: 'ratio'`,
    `tumorPolygon` → `signalPolygon`, `tumorValue` → `signalValue`,
    `tumorStd` → `signalStd`, `tumorN` → `signalN`,
    `order: index` (preserves user's existing order).
  - Written to `mantis.play.lodRatioEntries.v2`. Old key deleted.

- New unified `Entry` type with `kind: 'ratio' | 'intensity' | 'baseline'`.
- Inspector panel renamed `TbrAnalysisPanel` → `LodRatioPanel`.
- Mode segmented control at top: `Ratio` / `Intensity`.
- Intensity mode adds a "Baseline" ROI button (replaces "Background"
  in the workflow). One baseline entry across all Intensity entries;
  enforced at commit + via "Set as baseline" radio in the table.

**M3 — Table ergonomics (auto-clear, reorder, naming).**

- After successful commit in Ratio mode, only `signalPolygon` +
  `signalStats` clear; `bgPolygon` + `bgStats` survive (matches user
  request 3).
- Per-row inline-editable inputs:
  - `<input type="text">` for label.
  - `<input type="number">` for numericValue.
  - `<input type="text">` for unit (e.g. "µM").
- Each row shows its `#` (sample number, derived from `order` field).
- Up/down arrow buttons reorder by mutating `order`, then re-sort.
- "Set as baseline" radio (Intensity mode) per row, exclusive.

**M4 — Detachable panel via FloatingWindow.**

- `useLocalStorageState('mantis.play.lodRatioPanel.window.v1', {
   x: 80, y: 80, w: 420, h: 580, popped: false })`.
- Pop-out icon in the Inspector section header. When `popped`,
  Inspector section collapses to a single "Open in floating window"
  pill; the full panel renders inside `<FloatingWindow>` at the saved
  geometry.
- The pop-out wraps the **entire panel** — Mode toggle + Channel/
  Method/Percentile + Signal/Background/Baseline ROI buttons + live
  readout + entry table + Add button.
- Drawing on the canvas continues to work because the canvas is in a
  different element.

**M5 — Analysis modal Intensity branch.**

- `web/src/analysis/modes/lod_ratio.tsx` honors `run.response.analysisMode`.
- Ratio branch ≈ today's TBR plots (4 tabs: Bar / Tumor-vs-Bg / Scatter / Histogram).
- Intensity branch — new tabs:
  - **LoD Summary** — KPI cards (LoD value, k used, baseline μ ± σ,
    n_pass / n_total) + the entry table reproduced for export.
  - **Per-entry intensity** — bar chart of `signalValue` ordered by
    user's `order` (or by numericValue if all entries have one) with a
    horizontal reference line at `μ_baseline + k·σ_baseline`.
  - **SNR / detection** — scatter of `(numericValue, snr)` with the
    `snr = k` line; entries above pass.
- Export CSV / JSON gain `kind`, `analysisMode`, `label`,
  `numericValue`, `unit`, `lod` summary block.

### LoD calculation helper

`web/src/playback/lod.ts` — pure function:

```ts
export interface LodInput {
  baseline: { mean: number; std: number; n: number };
  entries: Array<{ id: string; signalValue: number; numericValue?: number }>;
  k: 3 | 6 | 10;
  sustained: boolean;
}
export interface LodResult {
  lod: { entryId: string; numericValue?: number } | null;
  threshold: number;            // μ_baseline + k·σ_baseline
  perEntry: Array<{
    entryId: string;
    signal: number;
    delta: number;              // signal − baseline.mean
    snr: number;                // delta / baseline.std
    passes: boolean;
  }>;
}
export function computeLod(input: LodInput): LodResult;
```

Sustained logic: sort entries by `numericValue` (ascending; entries
without `numericValue` sort to the end and are excluded from the LoD
search). For each candidate, check if it AND every higher-value entry
pass the threshold. The lowest such `numericValue` is the LoD.

If `sustained === false`, LoD is just the minimum `numericValue` whose
entry passes.

If no entry passes, `lod = null`.

## Files touched

### New files
- `mantisanalysis/server.py` (new route + models — additive, no
  rename).
- `tests/unit/test_pixel_endpoint.py` — backend route tests.
- `tests/web/test_play_lod_ratio.py` — Playwright UI tests.
- `web/src/playback/lod.ts` — pure LoD math helper.
- `web/src/analysis/modes/lod_ratio.tsx` (renamed from `tbr.tsx`).

### Modified
- `mantisanalysis/server.py` — new endpoint only, additive.
- `web/src/playback.tsx` — TbrAnalysisPanel → LodRatioPanel rewrite,
  pixel-readback hook, FloatingWindow wrap, Inspector display toggle,
  localStorage migration.
- `web/src/analysis/types.ts` — AnalysisMode union.
- `web/src/analysis/registry.ts` — registry key.
- (deleted) `web/src/analysis/modes/tbr.tsx` (renamed).

### Docs
- `.agent/HANDOFF.md` — pointer.
- `.agent/CHANGELOG_AGENT.md` — entry on close.
- `.agent/DECISIONS.md` — rename + LoD k=3 default + entry-shape
  unification.
- `.agent/BACKLOG.md` — close TBR ergonomics; open SNR-criterion +
  cal-curve fit follow-ups.

## Reviewer plan (M6)

Spawn three reviewers in parallel:

1. **fastapi-backend-reviewer** — new `/pixel` route, schema, parity
   with `roi-stats`, error handling, HDR fusion.
2. **frontend-react-engineer** — `LodRatioPanel` rewrite, the unified
   `Entry` shape, FloatingWindow wiring, mode segmented control,
   inline-edit accessibility, performance under long entry lists
   (>50 entries).
3. **risk-skeptic** — localStorage migration edge cases (corrupt v1
   data, partial v2 entries, downgrade attempts), pixel-readback
   request flooding under fast mousemove, baseline-entry uniqueness
   under add/delete/duplicate.

Address all P0/P1 findings before close. P2 items go to the backlog.

## Out of scope (deferred to backlog)

- SNR-style LoD criterion as a parallel framework.
- Calibration-curve fit (LoD = 3.3·σ/slope).
- Per-channel pixel-readback table (showing all 8 channels at the
  cursor location simultaneously).
- Drag-and-drop reorder (using HTML5 DnD via `DraggablePanelList`)
  if the arrow-button approach proves ergonomic enough.
