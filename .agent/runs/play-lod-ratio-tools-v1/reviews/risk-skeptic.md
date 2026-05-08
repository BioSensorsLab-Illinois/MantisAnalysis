# risk-skeptic — adversarial review

Verbatim agent output (2026-05-07).

## Premise check

The change adds a Limit-of-Detection workflow that produces a defensible scientific number. The premise is **false in at least three concrete scenarios** where the UI presents a confidently-wrong number with no warning:

1. A degenerate single-pixel baseline collapses σ to 0 and the threshold to μ.
2. The panel does not enforce that the baseline ROI and the signal ROIs share a channel — cross-channel comparisons silently produce a number.
3. The modal's channel-filter logic can drop the baseline entry while keeping signal entries, breaking the LoD without notifying the user.

## Findings

### P0 (BLOCKING — wrong scientific number)

**P0-A. Single-pixel baseline silently collapses threshold to μ.**
- File: `web/src/playback/lod.ts:100-115`
- `threshold = baseline.mean + k * 0 = baseline.mean`. ANY signal a fraction above passes. User publishes "LoD detected" based on a meaningless threshold.
- Mitigation: in `computeLod`, when `baseline.std <= 0` return `threshold=null`, `lod=null`, and a new `diagnostic` field. Modal renders a red error block.

**P0-B. Cross-channel baseline vs signal — no warning, no enforcement.**
- File: `web/src/playback.tsx:12952-12979` (commit), `lod_ratio.tsx:255-276` (modal)
- User sets baseline on `HG-NIR` and adds Intensity entries on `HG-G`. NIR and G have radically different DN floor/noise floor; the threshold is meaningless but looks fine.
- Mitigation: refuse `commitIntensity` when `tbrChannel !== baselineEntry.channel` (or surface a confirmation dialog); modal banner if cross-channel entries exist.

### P1

**P1-C. Channel filter in modal can hide baseline.**
- File: `web/src/analysis/modes/lod_ratio.tsx:206-236`
- Filtering modal to `HG-G` strips baseline drawn on `HG-NIR`. `baselineEntry` becomes null; modal renders "Set a baseline ROI" while panel still shows it.
- Mitigation: `baselineEntry` selected from `allEntries` (unfiltered).

**P1-D. Non-monotonic dataset silently truncates LoD.**
- File: `web/src/playback/lod.ts:147-169`
- A failing entry between two passing entries breaks the sustained chain → LoD reported at the failing-entry boundary.
- Mitigation: `LodResult.diagnostic = 'non-monotonic'` when sustained walk encounters a fail between two passes; modal renders warning chip.

**P1-G. FloatingWindow saved off-screen, no clamp.**
- File: `web/src/playback.tsx:1373-1375`, `web/src/shared.tsx:3132-3196`
- Saved `x=2400` from a 2× monitor → invisible on a 1366-wide laptop.
- Mitigation: clamp on mount: `x = Math.min(x, window.innerWidth - 80)`.

### P2

- P2-E: `|| 0` coercion conflates null/undefined with real-zero signals (`lod_ratio.tsx:259, 268`).
- P2-F: Repeated numericValues (replicates) — sort is stable but tied entries break sustained chain inconsistently.
- P2-H: Two-tab race during v1→v2 migration.
- P2-I: Persist effect serializes 25 KB per keystroke at 50 entries.

### P3

- P3-J: Corrupt v1 raw stays in localStorage forever.
- P3-K: Pixel route flood under fast drag (LoadedSource._lock serializes anyway).

## Hidden coupling

- Modal's `visibleChannels` filter couples baseline lookup to the shell's channel filter (designed for ratio plots).
- `commitIntensity` writes both `signalValue` and `tumorValue` aliases — future cleanup that drops the alias breaks legacy code paths silently.
- `view.tbrDraft.tumorPolygon` still encodes "tumor" naming even in Intensity mode.

## Stale assumptions

- "User will set baseline before any signal." Not enforced.
- "User keeps the same channel for baseline + signals." Not enforced.
- "LoD = literal IUPAC k·σ definition." Holds only for Gaussian noise; Poisson-shot-noise dominant baselines (low-light NIR) under-estimate true noise.
- "Saved window geometry is valid." See P1-G.

## Race conditions / timing

- Two `setTbrEntries` calls in `moveEntry` — verified safe under React 18 functional-updater batching.
- Baseline-replace pair in `commitIntensity` — safe; React batches, no transient two-baseline visible.
- Pixel route + ROI stats route under simultaneous user actions — `LoadedSource._lock` serializes; safe.

## Disposition

**Cannot close as-is.** P0-A and P0-B directly produce numbers that researchers will publish.

Fix recommendation:
- `computeLod` returns a `diagnostic` field; `lod=null` when σ≤0; modal renders red banner.
- `commitIntensity` refuses (or warns) on channel mismatch.
- FloatingWindow mounts clamped to viewport.
- `baselineEntry` lookup uses unfiltered entries.

P1-D ideally lands too. P2/P3 to backlog.
