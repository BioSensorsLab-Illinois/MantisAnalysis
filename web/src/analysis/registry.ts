// analysis-page-overhaul-v1 Phase 3 — typed mode registry.

import { dofSpec } from './modes/dof';
import { fpnSpec } from './modes/fpn';
import { lodRatioSpec } from './modes/lod_ratio';
import { usafSpec } from './modes/usaf';
import type { AnalysisMode, ModeSpec } from './types';

export const MODE_REGISTRY: Readonly<Record<AnalysisMode, ModeSpec>> = {
  usaf: usafSpec,
  fpn: fpnSpec,
  dof: dofSpec,
  // play-lod-ratio-tools-v1 M2 — was 'tbr' (Tumor-to-Background Ratio
  // only). Generalized to 'lod_ratio' to host both Ratio (TBR) and
  // Intensity (LoD) analyses; localStorage v1 entries auto-migrate to
  // v2 in playback.tsx.
  lod_ratio: lodRatioSpec,
};
