// analysis-page-overhaul-v1 Phase 3 — FPN mode spec.
// Type-clean. Holds FPN-only state (ROI filter, Unit, ROI label
// overrides) and delegates tab rendering to `_FPNTabBody`.

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
const Tip = _s.Tip as React.ComponentType<{ title: string; children: React.ReactNode }>;
const useLocalStorageState = _s.useLocalStorageState as <T>(
  key: string,
  initial: T
) => [T, (next: T | ((prev: T) => T)) => void];
const exportCSV = _s.exportCSV as (filename: string, rows: ReadonlyArray<unknown>) => void;
const exportJSON = _s.exportJSON as (filename: string, payload: unknown) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _a = _analysis as any;
const _FPNTabBody = _a._FPNTabBody as React.ComponentType<Record<string, unknown>>;

interface FpnResponse {
  channels?: readonly string[];
  rois?: ReadonlyArray<readonly [number, number, number, number]>;
  measurements?: Record<string, ReadonlyArray<FpnMeasurement | null | undefined>>;
  settings?: FpnSettings;
}

interface FpnMeasurement {
  error?: string;
  n_kept: number;
  n_total: number;
  mean_signal: number;
  dsnu_dn: number;
  prnu_pct: number;
  row_noise_dn: number;
  col_noise_dn: number;
  residual_pixel_noise_dn: number;
  dsnu_row_only_dn: number;
  dsnu_col_only_dn: number;
  row_peak_freq: number;
  col_peak_freq: number;
  hot_pixel_count: number;
  cold_pixel_count: number;
  drift_order: number;
}

interface FpnSettings {
  drift_order?: number | string;
  hot_sigma?: number;
  lo_pct?: number;
  hi_pct?: number;
  median_size?: number;
  gaussian_sigma?: number;
  bilateral?: boolean;
}

const FULL_DR = 65535;

const useFpnModeView = (
  run: RunRecord,
  common: FilterCommonState,
  { onToast }: ModeHelpers
): ModeView => {
  const response = useMemo<FpnResponse>(() => (run.response || {}) as FpnResponse, [run.response]);
  const allRois = useMemo<ReadonlyArray<readonly [number, number, number, number]>>(
    () => (response.rois || []) as ReadonlyArray<readonly [number, number, number, number]>,
    [response.rois]
  );
  const measurements = useMemo<NonNullable<FpnResponse['measurements']>>(
    () => response.measurements || {},
    [response.measurements]
  );
  const settings = useMemo<FpnSettings>(() => response.settings || {}, [response.settings]);

  const [roiIdxFilter, setRoiIdxFilter] = useState<string>('all');
  const [unit, setUnit] = useLocalStorageState<'DN' | 'pctDR'>('analysis/fpn/unit', 'DN');
  const [roiLabelOverrides, setRoiLabelOverrides] = useState<Record<number, string>>({});

  const visibleRoiIdx = useMemo<readonly number[]>(() => {
    if (roiIdxFilter === 'all') return allRois.map((_, i) => i);
    return [parseInt(roiIdxFilter, 10)];
  }, [roiIdxFilter, allRois]);

  const roiLabel = useCallback(
    (i: number): string => roiLabelOverrides[i] ?? (run.rois?.[i]?.label || `ROI-${i + 1}`),
    [roiLabelOverrides, run.rois]
  );
  const setRoiLabel = useCallback((i: number, label: string) => {
    setRoiLabelOverrides((prev) => ({ ...prev, [i]: label }));
  }, []);

  const onExportCSV = useCallback(() => {
    const rows: Array<Record<string, unknown>> = [];
    for (const ch of common.visibleChannels) {
      const chMeas = measurements[ch] || [];
      for (const i of visibleRoiIdx) {
        const m = chMeas[i];
        const roi = allRois[i] || [];
        if (!m || m.error) continue;
        rows.push({
          channel: ch,
          roi_idx: i,
          roi_label: run.rois?.[i]?.label ?? '',
          y0: roi[0],
          x0: roi[1],
          y1: roi[2],
          x1: roi[3],
          n_kept: m.n_kept,
          n_total: m.n_total,
          mean_dn: +m.mean_signal.toFixed(3),
          dsnu_dn: +m.dsnu_dn.toFixed(4),
          prnu_pct: +m.prnu_pct.toFixed(6),
          row_noise_dn: +m.row_noise_dn.toFixed(4),
          col_noise_dn: +m.col_noise_dn.toFixed(4),
          residual_sigma_dn: +m.residual_pixel_noise_dn.toFixed(4),
          sigma_row_only_dn: +m.dsnu_row_only_dn.toFixed(4),
          sigma_col_only_dn: +m.dsnu_col_only_dn.toFixed(4),
          row_peak_freq_cy: +m.row_peak_freq.toFixed(6),
          col_peak_freq_cy: +m.col_peak_freq.toFixed(6),
          hot_pixel_count: m.hot_pixel_count,
          cold_pixel_count: m.cold_pixel_count,
          drift_order: m.drift_order,
        });
      }
    }
    if (!rows.length) {
      onToast('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-fpn-${Date.now()}.csv`, rows);
    onToast(`Exported ${rows.length} rows to CSV`, 'success');
  }, [common.visibleChannels, visibleRoiIdx, measurements, allRois, onToast, run.rois]);

  const onExportJSON = useCallback(() => {
    exportJSON(`mantis-fpn-${Date.now()}.json`, {
      kind: 'mantis-fpn-analysis',
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: common.visibleChannels,
      rois: allRois,
      settings,
      measurements: Object.fromEntries(
        common.visibleChannels.map((ch) => [
          ch,
          visibleRoiIdx.map((i) => measurements[ch]?.[i] ?? null),
        ])
      ),
    });
    onToast('Exported analysis JSON', 'success');
  }, [common.visibleChannels, visibleRoiIdx, measurements, allRois, settings, onToast]);

  const filterExtras = (
    <>
      <FilterLabel marginLeft={6}>ROI</FilterLabel>
      <Segmented
        value={roiIdxFilter}
        onChange={setRoiIdxFilter}
        options={[
          { value: 'all', label: 'All' },
          ...allRois.map((_, i) => ({ value: String(i), label: roiLabel(i) })),
        ]}
      />
      <FilterLabel marginLeft={6}>Unit</FilterLabel>
      <Tip title={`DN = raw digital number · %DR = percent of full dynamic range (0..${FULL_DR})`}>
        <Segmented
          value={unit}
          onChange={(v) => setUnit(v as 'DN' | 'pctDR')}
          options={[
            { value: 'DN', label: 'DN' },
            { value: 'pctDR', label: '% DR' },
          ]}
        />
      </Tip>
    </>
  );

  const countsText = (
    <>
      FPN analysis — {allRois.length} ROI{allRois.length !== 1 ? 's' : ''} ×{' '}
      {common.visibleChannels.length} channel
      {common.visibleChannels.length !== 1 ? 's' : ''}
    </>
  );

  const subtitleText = (
    <>
      drift={String(settings.drift_order ?? 'none')} · hot |z|={settings.hot_sigma ?? 4} · outlier
      cuts {(settings.lo_pct ?? 0).toFixed(1)} / {(settings.hi_pct ?? 0).toFixed(1)}%
      {settings.median_size ? ` · median ${settings.median_size}×${settings.median_size}` : ''}
      {(settings.gaussian_sigma ?? 0) > 0.05
        ? ` · gauss σ=${(settings.gaussian_sigma as number).toFixed(2)}`
        : ''}
      {settings.bilateral ? ' · bilateral' : ''}
    </>
  );

  const renderTab = useCallback(
    () => (
      <_FPNTabBody
        tab={common.tab}
        visibleChannels={common.visibleChannels}
        measurements={measurements}
        allRois={allRois}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        setRoiLabel={setRoiLabel}
        unit={unit}
        fullDR={FULL_DR}
      />
    ),
    [
      common.tab,
      common.visibleChannels,
      measurements,
      allRois,
      visibleRoiIdx,
      roiLabel,
      setRoiLabel,
      unit,
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

export const fpnSpec: ModeSpec = {
  id: 'fpn',
  defaultTab: 'summary',
  tabs: [
    { key: 'summary', label: 'Summary' },
    { key: 'hist', label: 'Histograms' },
    { key: 'profiles', label: 'Row / Col means' },
    { key: 'psd1d', label: '1-D PSDs' },
    { key: 'map', label: '2-D FPN maps' },
    { key: 'psd', label: '2-D power spectrum' },
    { key: 'autocorr', label: 'Autocorrelation' },
    { key: 'hotpix', label: 'Hot / cold pixels' },
    { key: 'compare', label: 'ROI comparison' },
  ],
  pngFilename: (tab) => `mantis-fpn-${tab}-${Date.now()}`,
  useModeView: useFpnModeView,
};
