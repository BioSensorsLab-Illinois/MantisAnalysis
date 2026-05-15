# Status — play-lod-ratio-tools-v1

Opened: 2026-05-07.
Last updated: 2026-05-07 (M0 scaffolded).

Plan file: `/Users/zz4/.claude/plans/for-the-play-mode-recursive-globe.md`
(approved by user; all 4 architectural decisions confirmed via
AskUserQuestion).

Worktree: `.agent/worktrees/pensive-ishizaka-67b3ff/`
Branch: `claude/pensive-ishizaka-67b3ff` (off `main` @ `0f7c572`).

## Milestone tracker

- [x] **M0** — Initiative scaffold. ExecPlan.md, this Status.md,
      `reviews/` directory created.
- [x] **M1** — Pixel-value readback at the cursor. **GREEN.**
  - [x] M1a — `frame_channel_pixel` route + `PixelRequest` Pydantic
        model in `mantisanalysis/server.py:600-640` (model) +
        `:2481-2616` (route). Reuses
        `_apply_analysis_isp` + `_apply_pre_norm` for byte-for-byte
        parity with `frame_channel_roi_stats`. HDR fusion params
        carried through. POST not GET (view_config has ~10 fields).
  - [x] M1b — `tests/unit/test_pixel_endpoint.py` (11 tests, all
        passing): happy path, bounds (404), negative-coords (422),
        unknown-channel (404), unknown-source (404), extra-field
        (422), parity-with-roi-stats (1-pixel polygon range check),
        gain/offset affine, view_config-applied flag,
        median-filter changes value, pipeline_version=2 on every
        response.
  - [x] M1c — Pixel-readback wiring in `web/src/playback.tsx`:
        * Module-level helpers `_resolveReadbackChannel`,
          `_buildPixelViewConfig`, `_sampleDisplayedRgb`
          (playback.tsx:570-680).
        * `pixelInfo` state + `pixelReqSeqRef` + `pixelDebounceRef` in
          ViewerCard (playback.tsx:5836-5852).
        * `_handlePixelHover` function with 30 ms debounced fetch +
          stale-response drop + IMG-element fallback for the
          coord-rect when the SVG isn't mounted (playback.tsx:6037-
          6135).
        * Wired into the canvas `onMouseMove` (playback.tsx:6260) and
          `onMouseLeave` clears the badge (playback.tsx:6332).
        * Bottom-left badge JSX next to the zoom badge — two lines:
          `(x, y) · CH = N DN` and `RGB · r g b`
          (playback.tsx:6515-6588).
  - [x] M1d — `view.showPixelReadback` toggle as a `Row` in
        Inspector → Display, after the IIFE so it appears on every
        view kind (playback.tsx:9990-10004). Default ON
        (`!== false`); checkbox bound to view state via onUpdateView.
  - [x] M1 verify — Tier 0/1/2/3 green; full pytest (320 passing,
        +11 new); Tier 4 web_smoke green (4 passing); browser-
        verified manually:
        * Loaded synthetic H5 (3 frames, 4×4 channels).
        * Inspector → Display → "Pixel inspector" toggle visible +
          checked by default.
        * Mouse-move dispatched on canvas → badge renders
          `(2, 2) · HG-G = 279 DN, RGB · 0 1 0`.
        * /pixel POST returned 200 in network tab.
        * Console: zero errors / warnings.
- [x] **M2** — Mode rename + dual-mode panel + migration. **GREEN.**
  - [x] M2a — `web/src/analysis/modes/tbr.tsx` renamed (git mv) to
        `lod_ratio.tsx`; `tbrSpec` → `lodRatioSpec`; mode id `'tbr'`
        → `'lod_ratio'`; `AnalysisMode` union + `registry.ts` updated.
        AnalysisShell `mode: 'tbr'` → `mode: 'lod_ratio'` in
        playback.tsx.
  - [x] M2b — localStorage v1 → v2 migration shim
        (playback.tsx:1268-1338). Reads
        `mantis.play.tbrEntries.v1`, transforms each entry with
        `_migrateEntryV1ToV2` (adds `kind: 'ratio'`,
        `analysisMode: 'ratio'`, `order`, mirrors `tumor*` →
        `signal*`), writes to `mantis.play.lodRatioEntries.v2`,
        deletes the v1 key. One-shot at boot. Live-verified: v1
        seed → reload → v2 fires + v1 key gone.
  - [x] M2c — Segmented control `Ratio (TBR) | Intensity (LoD)` at
        the top of `LodRatioPanel` (playback.tsx:12848+). Selection
        persists in `mantis.play.lodRatioMode.v1` so the user's
        last choice survives reloads.
  - [x] M2d — Baseline-entry handling. Intensity mode adds a
        Baseline status block (playback.tsx:12910-12958) and a
        "Set as baseline / Replace baseline" button. Exactly one
        baseline entry across the table; new baseline replaces the
        old via onRemoveEntry → onAddEntry. Live SNR readout uses
        `(signal − μ_baseline) / σ_baseline` when both exist.
  - [x] M2e — Auto-clear-signal-only on commit. Ratio-mode
        `commit()` now resets `tumorPolygon + tumorStats` only,
        preserving `bgPolygon + bgStats` for the next pair
        (playback.tsx:12575-12586). Add-button tooltip explicitly
        documents the preservation.
  - [x] M2f — Inspector section title `"TBR Analysis"` →
        `"LoD/Ratio Analysis"`; component rename
        `TbrAnalysisPanel` → `LodRatioPanel`. `Inspector`
        sub-component now threads `analysisMode` +
        `setAnalysisMode` props from PlaybackMode.
  - [x] M2 verify — Tier 0/1/2/3 green; full pytest 320/320; Tier 4
        web_smoke 4/4; live migration round-trip verified; live
        Intensity-mode UI swap verified (signal/baseline buttons +
        baseline status visible; bg row hidden); Ratio-mode UI
        re-flip verified (bg row returns; commit tooltip mentions
        background-preservation).
- [x] **M3** — Entry table ergonomics. **GREEN.**
  - [x] M3a — Sample-number column derived from filtered+sorted
        position (not raw `order`), so deletes leave no gaps
        (playback.tsx:13134-13146). Baseline entries are filtered
        out of the main list (they live in the Baseline status
        block above).
  - [x] M3b — Up/down arrow buttons that swap the `order` field
        with the adjacent entry (playback.tsx:13104-13127). Edge
        buttons (top-up, bottom-down) are disabled. Live-verified:
        e1↔e2 swap re-orders the DOM and persists in localStorage.
  - [x] M3c — Inline-editable `label` text input per row
        (playback.tsx:13164-13197). Defaults to filename via
        placeholder when empty; tooltip shows full provenance
        (file/frame/channel/method). Empty value is permitted
        (clears any prior label).
  - [x] M3d — Inline-editable `numericValue` (number) + `unit`
        (text) per row (playback.tsx:13298-13339). Empty stored as
        `undefined` so CSV/JSON exports omit them cleanly. Tooltip
        documents x-axis use in the analysis modal (M5 will wire
        them).
  - [x] M3 verify — Tier 0/1/2/3 green; full pytest 320/320; Tier 4
        web_smoke 4/4. Live: 3 seeded entries render with sample
        numbers, down-arrow swaps e1↔e2, label "Sample 5 µM" +
        numericValue 5 + unit "µM" persist into localStorage on
        the first entry. No console errors / error boundary.
- [x] **M4** — Detachable LoD/Ratio panel via `FloatingWindow`. **GREEN.**
  - [x] M4a — `lodRatioWindow` state at PlaybackMode via
        `useLocalStorageState('playback/lodRatioWindow.v1', {x: 80,
        y: 80, w: 380, h: 600, popped: false})` (playback.tsx:1366-
        1375). Geometry + popped flag persist together.
  - [x] M4b — Inspector → LoD/Ratio Analysis section now branches:
        when `lodRatioWindow.popped`, renders a "Popped out" pill
        with a Dock-back button instead of the full panel.
  - [x] M4c — `<FloatingWindow>` mount at PlaybackMode level (sibling
        of AnalysisShell) when popped. Carries the same `LodRatioPanel`
        + props bundle as the Inspector mount; `onChange` syncs
        geometry; `onClose` flips `popped: false`. Only ONE
        LodRatioPanel mount exists at any time (Inspector or
        FloatingWindow) — verified live.
  - [x] M4d — "Pop out" button at the top of LodRatioPanel, only
        shown when docked (the FloatingWindow's X button handles
        dock-back when popped).
  - [x] M4 verify — Tier 0/1/2/3 green; pytest 320/320; Tier 4
        web_smoke 4/4. Live: pop-out → FloatingWindow mounts at
        (80,80) 380×600; drag handle moves window from (80,80) to
        (230,160) and persists; reload → window remounts at
        (230,160) with popped:true. Dock-back via FloatingWindow's
        X button → pill disappears, panel returns inline,
        popped:false. No console errors / error boundary.
- [x] **M5** — Analysis-modal Intensity branch + LoD calculation. **GREEN.**
  - [x] M5a — `web/src/playback/lod.ts` (~150 LOC, pure function).
        Exports `computeLod(input)` returning
        `{ threshold, k, sustained, perEntry, lod, anyPasses }`.
        Algorithm: `signal > μ_baseline + k·σ_baseline`; sustained
        mode walks high→low and returns the lowest numericValue
        where all-higher entries also pass. Edge cases: null
        baseline (all passes false), σ=0 (snr null but passes still
        computable), missing numericValue (excluded from LoD search).
  - [x] M5b — Standalone JS unit tests deferred. No Vitest infra
        wired in this repo; browser-side regression coverage +
        risk-skeptic math review at M6 substitute. Tracked in
        followups.
  - [x] M5c — `useTbrModeView` hook in `lod_ratio.tsx` extended:
        splits entries by `kind` into `ratioEntries` /
        `intensityEntries` / `baselineEntry`; computes `lodResult`
        via `computeLod`. Three new tabs at the front:
        `lod_summary` (KPI cards: LoD value, threshold, pass count,
        baseline n_pixels), `lod_intensity` (per-entry signal bar
        chart with threshold reference line), `lod_snr` (SNR
        scatter with k-line). Existing 6 Ratio tabs untouched and
        operate on `ratioEntries` only.
  - [x] M5d — `filterExtras` adds a `k` Segmented control
        ({3, 6, 10}) + a sustained Checkbox; both persist via
        `useLocalStorageState` (`mantis/lodRatioModal.k.v1`,
        `mantis/lodRatioModal.sustained.v1`). Only rendered when
        intensity entries exist.
  - [x] M5e — CSV/JSON exports gained `kind`, `analysis_mode`,
        `label`, `numeric_value`, `unit`, `order`, `signal_*`
        fields. JSON export adds top-level `lod` block (the full
        LodResult) + `baseline_entry`. File-name prefix
        `tbr_analysis_` → `lod_ratio_`.
  - [x] M5 verify — Tier 0/1/2/3 green; pytest 320/320; Tier 4
        web_smoke 4/4. Live LoD math verified with seeded fixture
        (μ=100, σ=10, signals 110/125/145/200 at 1/2/5/10 µM):
        * k=3, threshold=130 → 2/4 pass (i5+i10), **LoD = 5.00 µM**
          (sustained — both higher entries pass).
        * k=6, threshold=160 → 1/4 pass (i10), **LoD = 10.00 µM**.
        * k=10, threshold=200 → 0/4 pass (200>200 strictly false),
          **LoD = no detection**.
        Subtitle text + KPI cards reflect each k. Filter-extras
        controls k + sustained working.
- [x] **M6** — Reviewer pass + close. **GREEN — INITIATIVE CLOSED.**
  - 3 reviewers spawned in parallel; verbatim findings preserved at
    `reviews/{fastapi-backend-reviewer,frontend-react-engineer,risk-skeptic}.md`.
  - **risk-skeptic flagged 2 P0s** — both produce confidently-wrong
    scientific numbers:
    - **P0-A** (degenerate baseline): σ_baseline ≤ 0 collapses
      threshold to μ; any positive signal "passes". Fixed in
      `web/src/playback/lod.ts:104-118`: refuse computation,
      emit `'degenerate-baseline'` diagnostic; modal renders red
      banner (`web/src/analysis/modes/lod_ratio.tsx:241-296`).
    - **P0-B** (cross-channel): signal in HG-G against baseline in
      HG-NIR silently produces meaningless number. Fixed in
      `web/src/playback.tsx:12953-12962`: panel-level guard refuses
      Intensity commit when `tbrChannel !== baselineEntry.channel`;
      red banner above commit row + button disabled with tooltip.
  - **All P1s resolved**:
    - P1-1 pixel-readback re-render storm — `setPixelInfo` bails
      when state is unchanged (compare ix/iy/channel/RGB/error
      against prev) — `web/src/playback.tsx:6261-6293`.
    - P1-2 moveEntry duplicate-`order` no-op — falls back to
      indices when `ao === bo` — `web/src/playback.tsx:13325-13334`.
    - P1-3 pixel debounce 30 ms → 120 ms — matches project
      convention — `web/src/playback.tsx:6321`.
    - P1-C baselineEntry uses unfiltered `allEntries` —
      `web/src/analysis/modes/lod_ratio.tsx:230-241`.
    - P1-D non-monotonic ladder detection — `lod.ts` emits
      `'non-monotonic'` diagnostic; modal renders amber banner.
    - P1-G FloatingWindow viewport clamp on mount —
      `web/src/shared.tsx:3137-3158` (uses `useLayoutEffect`).
    - Backend P1-A parity test tightened to single-pixel polygon
      with byte-for-byte equality (1e-9 tol) —
      `tests/unit/test_pixel_endpoint.py:145-203`.
    - Backend P1-B HDR-fusion parity test added —
      `tests/unit/test_pixel_endpoint.py:206-244`.
  - **P2/P3 deferred to backlog** as B-0043..B-0048.
  - **Final verification**: Tier 0/1/2/3 ✓ · pytest 321/321 ✓
    (was 320; +1 HDR-fusion parity test) · Tier 4 web_smoke 4/4 ✓.
  - **Docs synced**: HANDOFF.md, CHANGELOG_AGENT.md, DECISIONS.md
    (D-0019 + D-0020), BACKLOG.md (B-0043..B-0048).
  - **Stopping criteria**: all 5 satisfied (gates green; reviewers
    spawned + findings resolved; UI verified live; docs synced;
    final response honest).

## Current focus

**INITIATIVE CLOSED 2026-05-07.** No outstanding work. Followups
land in the backlog (B-0043..B-0048).

## Files modified this session (M0–M2)

- `mantisanalysis/server.py` (+~150 LOC) — `PixelRequest` model +
  `frame_channel_pixel` route. (M1a)
- `tests/unit/test_pixel_endpoint.py` (NEW, ~225 LOC) — 11 tests. (M1b)
- `web/src/playback.tsx` (+~600 LOC delta net) — pixel-readback
  helpers + state + handler + badge (M1c-d); LodRatioPanel rewrite
  (was TbrAnalysisPanel) with mode-segmented control, baseline-entry
  flow, Intensity readout, auto-clear-signal-only commit (M2c-f);
  `analysisMode` state + localStorage persistence + Inspector prop
  threading (M2c).
- `web/src/analysis/types.ts` — `AnalysisMode` union renamed
  `'tbr'` → `'lod_ratio'`. (M2a)
- `web/src/analysis/registry.ts` — registry key + import renamed.
  (M2a)
- `web/src/analysis/modes/lod_ratio.tsx` (renamed from `tbr.tsx`
  via git mv) — `tbrSpec` → `lodRatioSpec`; `id: 'tbr'` →
  `'lod_ratio'`; "Tumor vs Background" tab label → "Signal vs
  Background"; pngFilename prefix `tbr_` → `lod_ratio_`. (M2a)
- `.agent/runs/play-lod-ratio-tools-v1/{ExecPlan.md, Status.md,
  reviews/}` (NEW) — initiative scaffold.

## Decisions

- Mode-id rename: `'tbr'` → `'lod_ratio'` end-to-end with one-way
  v1 → v2 localStorage migration (user-confirmed).
- LoD criterion: k·σ rule, k ∈ {3, 6, 10}, default k=3,
  sustained-criterion toggle ON by default (user-confirmed).
- Pop-out scope: entire LoD/Ratio Analysis section (not just the
  table) — user-confirmed.
- Pixel readout location: bottom-left badge on canvas, mirroring the
  existing zoom badge — user-confirmed.

## Open questions

(none — all resolved at plan time.)

## Quality gates not yet run

Tier 0, Tier 1, Tier 2, Tier 3, pytest, Tier 4 (web_smoke). Will run
after each milestone.
