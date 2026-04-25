// analysis-page-overhaul-v1 Phase 3 — type-clean island.
// No `@ts-nocheck`. Every public surface here is fully typed.
//
// Lives at `web/src/analysis/`. Phase 4 moves chart bodies into this
// subtree; Phase 5 collapses the export pipeline; Phase 6 drops
// `@ts-nocheck` from `analysis.tsx` once it's small enough.

import type React from 'react';

export type AnalysisMode = 'usaf' | 'fpn' | 'dof';

export type ToastLevel = 'success' | 'warn' | 'danger';
export type ToastFn = (msg: string, level?: ToastLevel) => void;

// `RunRecord` is the contract between the picker pages (USAF/FPN/DoF
// `*.tsx`) and the analysis modal. Each mode has its own response
// shape; the typed registry uses `unknown`-narrowing inside the mode
// hook, never at the shell boundary.
export interface RunRecord {
  mode: AnalysisMode;
  response?: AnalysisResponse;
  rois?: ReadonlyArray<{ readonly label?: string }>;
  lines?: ReadonlyArray<{
    readonly p0?: readonly [number, number];
    readonly p1?: readonly [number, number];
    readonly label?: string;
  }>;
  points?: ReadonlyArray<{ readonly x: number; readonly y: number; readonly label?: string }>;
  source?: { readonly source_id?: string };
  channels?: readonly string[];
  metric?: string;
  isp?: unknown;
  calibration?: unknown;
  tilt_angle_deg?: number;
}

export interface AnalysisResponse {
  channels?: readonly string[];
  // Mode-specific payload — narrowed inside each ModeSpec's hook.
  [key: string]: unknown;
}

export interface TabDef {
  readonly key: string;
  readonly label: string;
}

// Filter state common to every mode. Lives in the shell.
export interface FilterCommonState {
  readonly chans: readonly string[];
  readonly setChans: (
    next: readonly string[] | ((prev: readonly string[]) => readonly string[])
  ) => void;
  readonly gainFilter: GainFilter;
  readonly setGainFilter: (v: GainFilter) => void;
  readonly bgColor: string | null;
  readonly setBgColor: (v: string | null) => void;
  readonly tab: string;
  readonly setTab: (v: string) => void;
  readonly visibleChannels: readonly string[];
  readonly allChannels: readonly string[];
}

export type GainFilter = 'all' | 'HG' | 'LG';

// What a mode hook returns to the shell. Pure data — the shell does
// the rendering. Mode-specific state (Direction, ROI, Line, Metric,
// Unit, Tilt, Threshold, …) lives inside the mode hook closure.
export interface ModeView {
  readonly filterExtras: React.ReactNode;
  readonly countsText: React.ReactNode;
  readonly subtitleText: React.ReactNode;
  readonly renderTab: () => React.ReactNode;
  readonly onExportCSV: () => void;
  readonly onExportJSON: () => void;
}

export interface ModeHelpers {
  readonly onToast: ToastFn;
}

export interface ModeSpec {
  readonly id: AnalysisMode;
  readonly defaultTab: string;
  readonly tabs: ReadonlyArray<TabDef>;
  readonly pngFilename: (tab: string) => string;
  readonly useModeView: (
    run: RunRecord,
    common: FilterCommonState,
    helpers: ModeHelpers
  ) => ModeView;
}

// Shell props — used by both the live mount and the Storybook story.
export interface AnalysisShellProps {
  readonly run: RunRecord;
  readonly onClose: () => void;
  readonly onToast: ToastFn;
}
