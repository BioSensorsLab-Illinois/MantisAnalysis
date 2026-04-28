// analysis-page-overhaul-v1 Phase 3 — typed mode registry.

import { dofSpec } from './modes/dof';
import { fpnSpec } from './modes/fpn';
import { tbrSpec } from './modes/tbr';
import { usafSpec } from './modes/usaf';
import type { AnalysisMode, ModeSpec } from './types';

export const MODE_REGISTRY: Readonly<Record<AnalysisMode, ModeSpec>> = {
  usaf: usafSpec,
  fpn: fpnSpec,
  dof: dofSpec,
  tbr: tbrSpec,
};
