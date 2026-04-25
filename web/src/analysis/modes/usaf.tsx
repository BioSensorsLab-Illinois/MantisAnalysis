// analysis-page-overhaul-v1 Phase 3 — USAF mode spec.
// Type-clean. Holds USAF-only state (Direction filter, Threshold) and
// delegates tab rendering to `_USAFTabBody` in analysis.tsx (a
// `@ts-nocheck`-bridge that Phase 4 retires once chart bodies move
// into `web/src/analysis/charts/`).

import React, { useCallback, useMemo, useState } from 'react';
import * as _shared from '../../shared.tsx';
import * as _analysis from '../../analysis.tsx';
import { FilterLabel } from '../filterbar';
import type { FilterCommonState, ModeHelpers, ModeSpec, ModeView, RunRecord } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const Segmented = _s.Segmented as React.ComponentType<{
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}>;
const exportCSV = _s.exportCSV as (filename: string, rows: ReadonlyArray<unknown>) => void;
const exportJSON = _s.exportJSON as (filename: string, payload: unknown) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _a = _analysis as any;
const _USAFTabBody = _a._USAFTabBody as React.ComponentType<Record<string, unknown>>;

interface UsafResponse {
  channels?: readonly string[];
  specs?: readonly UsafSpec[];
  measurements?: Record<string, ReadonlyArray<UsafMeasurement | null | undefined>>;
  channel_thumbnails?: Record<string, string>;
  per_channel_detection_limit?: Record<string, number | null>;
  threshold?: number;
}

interface UsafSpec {
  group: number;
  element: number;
  direction: 'H' | 'V';
  p0: readonly [number, number];
  p1: readonly [number, number];
}

interface UsafMeasurement {
  lp_mm: number;
  modulation_5pt: number;
  modulation_pct: number;
  modulation_fft: number;
  modulation_minmax: number;
  samples_per_cycle: number;
  reliability: number;
  bars_bright: number;
  bar_values: readonly number[];
  gap_values: readonly number[];
  profile_min: number;
  profile_max: number;
  profile_p10: number;
  profile_p90: number;
  line_length_px: number;
  n_samples: number;
  bar_indices: readonly number[];
  gap_indices: readonly number[];
}

type DirFilter = 'all' | 'H' | 'V';

const measurementToRow = (
  ch: string,
  spec: UsafSpec,
  m: UsafMeasurement | null | undefined
): Record<string, unknown> | null => {
  if (!m) return null;
  const meanArr = (a: readonly number[]): number =>
    a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
  return {
    channel: ch,
    group: spec.group,
    element: spec.element,
    direction: spec.direction,
    p0_x: spec.p0[0],
    p0_y: spec.p0[1],
    p1_x: spec.p1[0],
    p1_y: spec.p1[1],
    lp_mm: +m.lp_mm.toFixed(4),
    michelson_5pt: +m.modulation_5pt.toFixed(6),
    michelson_percentile: +m.modulation_pct.toFixed(6),
    michelson_fft: +m.modulation_fft.toFixed(6),
    michelson_minmax: +m.modulation_minmax.toFixed(6),
    samples_per_cycle: +m.samples_per_cycle.toFixed(3),
    reliability: m.reliability,
    bars_bright: m.bars_bright,
    bar_values_mean: +meanArr(m.bar_values).toFixed(2),
    gap_values_mean: +meanArr(m.gap_values).toFixed(2),
    profile_min: +m.profile_min.toFixed(2),
    profile_max: +m.profile_max.toFixed(2),
    profile_p10: +m.profile_p10.toFixed(2),
    profile_p90: +m.profile_p90.toFixed(2),
    line_length_px: +m.line_length_px.toFixed(2),
    n_samples: m.n_samples,
    bar_indices: m.bar_indices.join('|'),
    gap_indices: m.gap_indices.join('|'),
  };
};

const useUsafModeView = (
  run: RunRecord,
  common: FilterCommonState,
  { onToast }: ModeHelpers
): ModeView => {
  const response = useMemo<UsafResponse>(
    () => (run.response || {}) as UsafResponse,
    [run.response]
  );
  const allSpecs = useMemo<readonly UsafSpec[]>(() => response.specs || [], [response.specs]);
  const measurements = useMemo<NonNullable<UsafResponse['measurements']>>(
    () => response.measurements || {},
    [response.measurements]
  );
  const perChLim = useMemo<NonNullable<UsafResponse['per_channel_detection_limit']>>(
    () => response.per_channel_detection_limit || {},
    [response.per_channel_detection_limit]
  );
  const serverThreshold = Number(response.threshold ?? 0.3);

  const [dirFilter, setDirFilter] = useState<DirFilter>('all');
  const [threshold, setThreshold] = useState<number>(serverThreshold);

  const keptIdx = useMemo<readonly number[]>(
    () =>
      allSpecs
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => dirFilter === 'all' || s.direction === dirFilter)
        .map(({ i }) => i),
    [allSpecs, dirFilter]
  );

  const onExportCSV = useCallback(() => {
    const rows: Array<Record<string, unknown>> = [];
    for (const ch of common.visibleChannels) {
      for (const i of keptIdx) {
        const r = measurementToRow(ch, allSpecs[i], measurements[ch]?.[i]);
        if (r) rows.push(r);
      }
    }
    if (!rows.length) {
      onToast('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-usaf-${Date.now()}.csv`, rows);
    onToast(`Exported ${rows.length} rows to CSV`, 'success');
  }, [common.visibleChannels, keptIdx, measurements, allSpecs, onToast]);

  const onExportJSON = useCallback(() => {
    exportJSON(`mantis-usaf-${Date.now()}.json`, {
      kind: 'mantis-usaf-analysis',
      version: 2,
      exportedAt: new Date().toISOString(),
      channels: common.visibleChannels,
      specs: keptIdx.map((i) => allSpecs[i]),
      threshold,
      measurements: Object.fromEntries(
        common.visibleChannels.map((ch) => [ch, keptIdx.map((i) => measurements[ch]?.[i] ?? null)])
      ),
      per_channel_detection_limit: Object.fromEntries(
        common.visibleChannels.map((ch) => [ch, perChLim[ch] ?? null])
      ),
    });
    onToast('Exported analysis JSON', 'success');
  }, [common.visibleChannels, keptIdx, measurements, allSpecs, threshold, perChLim, onToast]);

  const filterExtras = (
    <>
      <FilterLabel marginLeft={6}>Direction</FilterLabel>
      <Segmented
        value={dirFilter}
        onChange={(v) => setDirFilter(v as DirFilter)}
        options={[
          { value: 'all', label: 'All' },
          { value: 'H', label: 'H' },
          { value: 'V', label: 'V' },
        ]}
      />
      <FilterLabel marginLeft={6}>Threshold</FilterLabel>
      <input
        type="range"
        min={0.05}
        max={0.95}
        step={0.01}
        value={threshold}
        onChange={(e) => setThreshold(parseFloat(e.target.value))}
        style={{ width: 160 }}
        className="rgbnir-slider"
        aria-label="Detection threshold"
      />
      <span
        style={{
          fontSize: 11,
          fontFamily: 'ui-monospace,Menlo,monospace',
          minWidth: 42,
        }}
      >
        {(threshold * 100).toFixed(0)}%
      </span>
    </>
  );

  const countsText = (
    <>
      USAF analysis — {keptIdx.length} line{keptIdx.length !== 1 ? 's' : ''} ×{' '}
      {common.visibleChannels.length} channel
      {common.visibleChannels.length !== 1 ? 's' : ''}
    </>
  );

  const subtitleText = (
    <>
      server detection limit @ {(serverThreshold * 100).toFixed(0)}% ·{' '}
      {Object.entries(perChLim)
        .map(([c, v]) => `${c}: ${v != null ? v.toFixed(2) + ' lp/mm' : '—'}`)
        .join('  ·  ')}
    </>
  );

  const renderTab = useCallback(
    () => (
      <_USAFTabBody
        tab={common.tab}
        visibleChannels={common.visibleChannels}
        allSpecs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
        perChLim={perChLim}
        dirFilter={dirFilter}
      />
    ),
    [
      common.tab,
      common.visibleChannels,
      allSpecs,
      keptIdx,
      measurements,
      threshold,
      perChLim,
      dirFilter,
    ]
  );

  return {
    filterExtras,
    countsText,
    subtitleText,
    renderTab,
    onExportCSV,
    onExportJSON,
  };
};

export const usafSpec: ModeSpec = {
  id: 'usaf',
  defaultTab: 'mtf',
  tabs: [
    { key: 'mtf', label: 'MTF curves' },
    { key: 'profiles', label: 'Profile gallery' },
    { key: 'table', label: 'Summary table' },
    { key: 'heatmap', label: 'Detection heatmap' },
    { key: 'group', label: 'Group sweep' },
    { key: 'fft', label: 'FFT / MTF' },
  ],
  pngFilename: (tab) => `mantis-${tab}-${Date.now()}`,
  useModeView: useUsafModeView,
};
