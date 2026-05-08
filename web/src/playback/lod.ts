// Limit-of-Detection helper. play-lod-ratio-tools-v1 M5.
//
// Pure function — no React, no DOM, no fetch. Lives next to its only
// consumer (`web/src/analysis/modes/lod_ratio.tsx`). Used by the
// Intensity-mode analysis-modal branch to:
//   - threshold each signal entry against the baseline ROI
//     (μ_blank + k·σ_blank, IUPAC / ICH Q2(R1));
//   - compute SNR = (signal − μ_blank) / σ_blank;
//   - find the LoD = lowest numericValue (concentration / depth /
//     time / …) whose entry passes the threshold AND, when sustained
//     mode is on, every higher-numericValue entry also passes.
//
// Why pure + same-file: parity with the panel's live readout
// (LodRatioPanel computes `intensitySnr` inline using the same
// algebra), and ease of unit-testing without a React renderer.
//
// k presets: {3, 6, 10}. k=3 ≡ "limit of detection"; k=10 ≡
// "limit of quantitation"; k=6 sits between. Plan-confirmed with the
// user (2026-05-07).

export type LodK = 3 | 6 | 10;

export interface LodEntry {
  readonly id: string;
  readonly signalValue: number;
  readonly signalStd?: number | null;
  readonly numericValue?: number | null;
  readonly label?: string | null;
}

export interface LodBaseline {
  readonly mean: number;
  readonly std: number;
  readonly n?: number | null;
}

export interface LodInput {
  readonly baseline: LodBaseline | null;
  readonly entries: ReadonlyArray<LodEntry>;
  readonly k: LodK;
  /** When true, LoD is the lowest numericValue where signal passes
   *  AND every higher-numericValue entry also passes. Default ON to
   *  avoid sporadic-detection false positives. */
  readonly sustained: boolean;
}

export interface LodPerEntry {
  readonly entryId: string;
  readonly signal: number;
  readonly delta: number;
  /** null when baseline missing OR baseline.std ≤ 0 (no valid σ). */
  readonly snr: number | null;
  readonly passes: boolean;
}

/**
 * Diagnostic codes the modal renders as a hard-error banner.
 *
 * - 'no-baseline'         — no baseline ROI set; LoD is undefined.
 * - 'degenerate-baseline' — σ_baseline ≤ 0 (single-pixel polygon or
 *                           pathological constant region). Threshold
 *                           collapses to μ exactly so any signal
 *                           > μ would falsely "pass" — refused.
 *                           Risk-skeptic P0-A (M6).
 * - 'no-numeric'          — no entry carries a numericValue, so
 *                           the LoD search has no x-axis to compare.
 * - 'non-monotonic'       — sustained walk encountered a failing
 *                           entry between two passing entries; the
 *                           LoD reported is the lowest sustained-pass
 *                           value, but the user should be warned
 *                           about the inversion below it.
 *                           Risk-skeptic P1-D (M6).
 */
export type LodDiagnostic =
  | 'no-baseline'
  | 'degenerate-baseline'
  | 'no-numeric'
  | 'non-monotonic';

export interface LodResult {
  /** μ_baseline + k·σ_baseline. null when no baseline supplied,
   *  OR when baseline.std ≤ 0 (degenerate). */
  readonly threshold: number | null;
  readonly k: LodK;
  readonly sustained: boolean;
  readonly perEntry: ReadonlyArray<LodPerEntry>;
  /** The entry that defines the LoD. null when no entry passes,
   *  no baseline is set, baseline σ is degenerate, or no entry has a
   *  numericValue. */
  readonly lod: {
    readonly entryId: string;
    readonly numericValue: number;
    readonly signal: number;
  } | null;
  /** True iff at least one entry crosses the threshold. Useful for
   *  the modal to render a "no detection at any concentration"
   *  diagnostic distinct from "detection only at the highest
   *  concentration". */
  readonly anyPasses: boolean;
  /** Non-fatal warnings about the LoD result. The modal renders a
   *  banner per code so the user knows when the number is suspect
   *  (e.g. degenerate baseline, non-monotonic ladder). Empty array
   *  on the happy path. M6 risk-skeptic findings. */
  readonly diagnostics: ReadonlyArray<LodDiagnostic>;
}

const FINITE = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Compute LoD + per-entry pass/fail for an Intensity-mode dataset.
 *
 * Contract:
 *   - When `baseline` is null, every entry's `passes` is false and
 *     `threshold` / `lod` are null. The caller should render a
 *     "Set a baseline ROI to compute LoD" empty state.
 *   - When `baseline.std` is 0 (degenerate — single-pixel baseline
 *     polygon), `snr` is null but `passes` is still computable
 *     against the threshold (signal > μ).
 *   - Entries with non-finite or missing numericValue are included
 *     in `perEntry` (so the bar chart can show them) but excluded
 *     from the LoD search (no x-axis to compare on).
 *   - When `sustained` is true, the LoD is the lowest numericValue
 *     v* such that EVERY entry with numericValue ≥ v* passes. This
 *     means a single failing entry above v* invalidates v*; the
 *     algorithm walks from the top down.
 *
 * Complexity: O(n log n) to sort + O(n) to search. n is bounded by
 * the user's table size so this isn't a hot path.
 */
export function computeLod(input: LodInput): LodResult {
  const { baseline, entries, k, sustained } = input;
  const diagnostics: LodDiagnostic[] = [];

  // M6 risk-skeptic P0-A: refuse to compute when σ ≤ 0. A degenerate
  // baseline polygon (single pixel, or constant region after
  // dark-subtract) collapses the threshold to μ, which would let
  // ANY positive signal "pass" — a publishable false LoD. Raise a
  // hard diagnostic and zero out the threshold + lod so the modal
  // refuses to render a number.
  let threshold: number | null = null;
  if (!baseline) {
    diagnostics.push('no-baseline');
  } else if (!FINITE(baseline.mean) || !FINITE(baseline.std)) {
    diagnostics.push('degenerate-baseline');
  } else if (baseline.std <= 0) {
    diagnostics.push('degenerate-baseline');
  } else {
    threshold = baseline.mean + k * baseline.std;
  }

  const perEntry: LodPerEntry[] = entries.map((e) => {
    const sig = FINITE(e.signalValue) ? e.signalValue : NaN;
    const mu = baseline && FINITE(baseline.mean) ? baseline.mean : NaN;
    const sd = baseline && FINITE(baseline.std) ? baseline.std : NaN;
    const delta = FINITE(sig) && FINITE(mu) ? sig - mu : NaN;
    const snr =
      FINITE(delta) && FINITE(sd) && sd > 0 ? delta / sd : null;
    const passes =
      threshold !== null && FINITE(sig) ? sig > threshold : false;
    return {
      entryId: e.id,
      signal: sig,
      delta: FINITE(delta) ? delta : 0,
      snr,
      passes,
    };
  });

  const anyPasses = perEntry.some((p) => p.passes);

  // Find the LoD. Sustained mode walks high → low: start from the
  // highest numericValue and step down, tracking the lowest value
  // for which all observed (so-far) entries pass. Non-sustained
  // mode just picks the lowest numericValue with passes=true.
  let lod: LodResult['lod'] = null;
  if (threshold !== null) {
    const passById = new Map(perEntry.map((p) => [p.entryId, p] as const));
    const numericEntries = entries
      .map((e) => ({
        id: e.id,
        numericValue: FINITE(e.numericValue ?? NaN) ? (e.numericValue as number) : null,
        signal: FINITE(e.signalValue) ? e.signalValue : NaN,
      }))
      .filter(
        (e): e is { id: string; numericValue: number; signal: number } =>
          e.numericValue !== null && FINITE(e.signal)
      )
      .sort((a, b) => a.numericValue - b.numericValue);

    if (numericEntries.length === 0) {
      // No x-axis to compare on — but we did compute threshold +
      // anyPasses. Tag the result so the modal can hide the LoD KPI
      // and surface a "label entries with numericValue to compute LoD"
      // banner.
      if (entries.length > 0) {
        diagnostics.push('no-numeric');
      }
    } else if (sustained) {
      // Walk top → bottom; once we hit a failing entry, anything
      // below it is invalid. The lowest valid candidate is the
      // first non-failing entry encountered after a contiguous
      // top-of-list pass run.
      let candidate: { id: string; numericValue: number; signal: number } | null = null;
      let sawFail = false;
      for (let i = numericEntries.length - 1; i >= 0; i--) {
        const e = numericEntries[i];
        const p = passById.get(e.id);
        if (p && p.passes) {
          candidate = e;
        } else {
          // Failing entry breaks the sustained chain; stop.
          sawFail = true;
          break;
        }
      }
      if (candidate) {
        lod = {
          entryId: candidate.id,
          numericValue: candidate.numericValue,
          signal: candidate.signal,
        };
      }
      // M6 risk-skeptic P1-D: detect non-monotonic ladders. After we
      // hit the first failing entry walking top→bottom, look for any
      // FURTHER passing entry below it — that's an inversion (lower
      // concentration passes, mid concentration fails, higher passes
      // again). Common with sensor saturation, lens artifact, or
      // misordered samples. The reported sustained LoD is still
      // correct (anchored to the highest contiguous pass run); this
      // diagnostic tells the modal to show a warning chip listing
      // the offending lower-than-LoD passes.
      if (sawFail) {
        // We exited the sustained loop early; check entries below
        // the failure point for any pass.
        for (const e of numericEntries) {
          if (lod && e.numericValue >= lod.numericValue) continue;
          const p = passById.get(e.id);
          if (p && p.passes) {
            diagnostics.push('non-monotonic');
            break;
          }
        }
      }
    } else {
      // Non-sustained: lowest numericValue with passes=true.
      for (const e of numericEntries) {
        const p = passById.get(e.id);
        if (p && p.passes) {
          lod = {
            entryId: e.id,
            numericValue: e.numericValue,
            signal: e.signal,
          };
          break;
        }
      }
    }
  }

  return {
    threshold,
    k,
    sustained,
    perEntry,
    lod,
    anyPasses,
    diagnostics,
  };
}
