// analysis-page-overhaul-v1 Phase 3 — DoF mode spec.
// Type-clean. Holds DoF-only state (Line filter, Metric, Unit, Tilt
// angle, live response cache) and delegates tab rendering to
// `_DoFTabBody`.
//
// New in Phase 3: DoF gains `BgColorPicker` parity by virtue of the
// shell mounting it for every mode (was previously missing — see
// inventory §F).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
const useTheme = _s.useTheme as () => {
  panel: string;
  border: string;
  text: string;
  textFaint: string;
  textMuted: string;
  warn: string;
  [key: string]: string;
};
const exportCSV = _s.exportCSV as (filename: string, rows: ReadonlyArray<unknown>) => void;
const exportJSON = _s.exportJSON as (filename: string, payload: unknown) => void;
const Checkbox = _s.Checkbox as React.ComponentType<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  hint?: string;
}>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _a = _analysis as any;
const _DoFTabBody = _a._DoFTabBody as React.ComponentType<Record<string, unknown>>;
const DOF_UNIT_OPTS = _a._DOF_UNIT_OPTS as ReadonlyArray<{ value: string; label: string }>;
const dofIsCalibrated = _a._dofIsCalibrated as (ln: unknown) => boolean;

interface DoFResponse {
  channels?: readonly string[];
  results?: Record<string, DoFChannelResult | undefined>;
  metric_results?: Record<string, DoFMetricSnapshot | undefined>;
  settings?: DoFSettings;
}

interface DoFMetricSnapshot {
  channels?: readonly string[];
  results?: Record<string, DoFChannelResult | undefined>;
  settings?: DoFSettings;
}

interface DoFChannelResult {
  lines?: readonly unknown[];
  points?: readonly DoFPointResult[];
}

interface DoFPointResult {
  x: number;
  y: number;
  focus?: number;
  focus_norm?: number;
}

interface DoFSettings {
  metric?: string;
  half_window?: number;
  threshold?: number;
  profile_threshold?: number;
  bootstrap?: boolean;
  compute_all_metrics?: boolean;
  fit_tilt_plane?: boolean;
  calibration?: { unit?: string } | null;
  n_boot?: number;
}

const FOCUS_METRIC_OPTIONS = [
  { value: 'laplacian', label: 'Laplacian' },
  { value: 'brenner', label: 'Brenner' },
  { value: 'tenengrad', label: 'Tenengrad' },
  { value: 'fft_hf', label: 'FFT-HF' },
] as const;

const useDofModeView = (
  run: RunRecord,
  common: FilterCommonState,
  { onToast }: ModeHelpers
): ModeView => {
  const t = useTheme();
  const response = useMemo<DoFResponse>(() => (run.response || {}) as DoFResponse, [run.response]);
  const isImportedSnapshot = !!run.imported_analysis;
  const baseSettings = useMemo<DoFSettings>(() => response.settings || {}, [response.settings]);
  const metricSnapshots = useMemo<NonNullable<DoFResponse['metric_results']>>(
    () => response.metric_results || {},
    [response.metric_results]
  );
  const cachedMetricOptions = useMemo(
    () => FOCUS_METRIC_OPTIONS.filter((opt) => !!metricSnapshots[opt.value]?.results),
    [metricSnapshots]
  );

  const allLines = useMemo(() => run.lines || [], [run.lines]);
  const allPoints = useMemo(() => run.points || [], [run.points]);
  const lineLabel = useCallback(
    (i: number): string => allLines[i]?.label || `L${i + 1}`,
    [allLines]
  );
  const pointLabel = useCallback(
    (i: number): string => allPoints[i]?.label || `p${i + 1}`,
    [allPoints]
  );

  const [lineIdxFilter, setLineIdxFilter] = useState<string>('all');
  const [metricFilter, setMetricFilter] = useState<string>(
    baseSettings.metric || run.metric || 'laplacian'
  );
  const activeSnapshot = useMemo<DoFMetricSnapshot | DoFResponse>(() => {
    const cached = metricSnapshots[metricFilter];
    if (cached?.results) {
      return {
        channels: cached.channels || response.channels,
        results: cached.results,
        settings: {
          ...baseSettings,
          ...(cached.settings || {}),
          metric: metricFilter,
        },
      };
    }
    return response;
  }, [baseSettings, metricFilter, metricSnapshots, response]);
  const results = useMemo<NonNullable<DoFResponse['results']>>(
    () => activeSnapshot.results || {},
    [activeSnapshot]
  );
  const settings = useMemo<DoFSettings>(
    () => activeSnapshot.settings || baseSettings || {},
    [activeSnapshot, baseSettings]
  );
  const selectedMetric =
    settings.metric || metricFilter || run.metric || baseSettings.metric || 'laplacian';
  const [unitPref, setUnitPref] = useState<string>(run.displayUnit || 'auto');
  const [showMetricBand, setShowMetricBand] = useState<boolean>(run.show_metric_band !== false);
  const [showProfileBand, setShowProfileBand] = useState<boolean>(run.show_profile_band !== false);
  const [showMetricPeak, setShowMetricPeak] = useState<boolean>(run.show_metric_peak !== false);
  const [showProfilePeak, setShowProfilePeak] = useState<boolean>(!!run.show_profile_peak);
  useEffect(() => {
    setShowMetricBand(run.show_metric_band !== false);
    setShowProfileBand(run.show_profile_band !== false);
    setShowMetricPeak(run.show_metric_peak !== false);
    setShowProfilePeak(!!run.show_profile_peak);
  }, [run.show_metric_band, run.show_profile_band, run.show_metric_peak, run.show_profile_peak]);
  const [tiltAngleDeg, setTiltAngleDeg] = useState<number>(Number(run.tilt_angle_deg) || 0);
  const tiltFactor = useMemo<number>(() => {
    const d = Math.min(89, Math.max(0, Number(tiltAngleDeg) || 0));
    if (d === 0) return 1;
    return 1 / Math.cos((d * Math.PI) / 180);
  }, [tiltAngleDeg]);
  const anyCalibrated = useMemo<boolean>(
    () => Object.values(results).some((r) => (r?.lines || []).some(dofIsCalibrated)),
    [results]
  );

  const visibleLineIdx = useMemo<readonly number[]>(() => {
    const n = allLines.length;
    if (lineIdxFilter === 'all') return Array.from({ length: n }, (_, i) => i);
    return [parseInt(lineIdxFilter, 10)];
  }, [lineIdxFilter, allLines.length]);

  const onExportCSV = useCallback(() => {
    const rows: Array<Record<string, unknown>> = [];
    for (const ch of common.visibleChannels) {
      const r = results[ch];
      if (!r) continue;
      (r.lines || []).forEach((ln: unknown, i: number) => {
        if (!visibleLineIdx.includes(i)) return;
        const lnAny = ln as Record<string, unknown>;
        const g = (lnAny.gaussian || {}) as Record<string, unknown>;
        const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
        rows.push({
          channel: ch,
          kind: 'line',
          line_idx: i,
          label: lineLabel(i),
          p0_x: (lnAny.p0 as number[] | undefined)?.[0],
          p0_y: (lnAny.p0 as number[] | undefined)?.[1],
          p1_x: (lnAny.p1 as number[] | undefined)?.[0],
          p1_y: (lnAny.p1 as number[] | undefined)?.[1],
          peak_position_px: num(lnAny.peak_position_px)?.toFixed(4),
          dof_low_px: lnAny.dof_low_px,
          dof_high_px: lnAny.dof_high_px,
          dof_width_px: num(lnAny.dof_width_px)?.toFixed(4),
          profile_threshold: lnAny.profile_threshold ?? settings.profile_threshold,
          profile_peak_position_px: num(lnAny.profile_peak_position_px)?.toFixed(4),
          profile_dof_low_px: lnAny.profile_dof_low_px,
          profile_dof_high_px: lnAny.profile_dof_high_px,
          profile_dof_width_px: num(lnAny.profile_dof_width_px)?.toFixed(4),
          profile_dof_left_bounded: lnAny.profile_dof_left_bounded,
          profile_dof_right_bounded: lnAny.profile_dof_right_bounded,
          gauss_converged: g.converged ? 1 : 0,
          gauss_mu_px: num(g.mu)?.toFixed(4),
          gauss_sigma_px: num(g.sigma)?.toFixed(4),
          gauss_fwhm_px: num(g.fwhm)?.toFixed(4),
          gauss_r2: num(g.r_squared)?.toFixed(4),
          peak_ci95_lo_px: num((lnAny.peak_ci95_px as number[] | undefined)?.[0])?.toFixed(4),
          peak_ci95_hi_px: num((lnAny.peak_ci95_px as number[] | undefined)?.[1])?.toFixed(4),
          dof_ci95_lo_px: num((lnAny.dof_width_ci95_px as number[] | undefined)?.[0])?.toFixed(4),
          dof_ci95_hi_px: num((lnAny.dof_width_ci95_px as number[] | undefined)?.[1])?.toFixed(4),
          unit_name: lnAny.unit_name || '',
          peak_position_unit: lnAny.peak_position_unit,
          dof_width_unit: lnAny.dof_width_unit,
          tilt_angle_deg: tiltAngleDeg,
          tilt_factor: tiltFactor.toFixed(6),
        });
      });
      (r.points || []).forEach((pt, i) => {
        rows.push({
          channel: ch,
          kind: 'point',
          point_idx: i,
          label: pointLabel(i),
          x: pt.x,
          y: pt.y,
          focus: pt.focus?.toExponential?.(4),
          focus_norm: pt.focus_norm?.toFixed?.(4),
        });
      });
    }
    if (!rows.length) {
      onToast('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-dof-${Date.now()}.csv`, rows);
    onToast(`Exported ${rows.length} rows`, 'success');
  }, [
    common.visibleChannels,
    visibleLineIdx,
    results,
    onToast,
    settings,
    tiltAngleDeg,
    tiltFactor,
    lineLabel,
    pointLabel,
  ]);

  const onExportJSON = useCallback(() => {
    const exportChannels = (response.channels || run.channels || common.allChannels).filter(
      (ch) => !!results[ch] || Object.values(metricSnapshots).some((snap) => !!snap?.results?.[ch])
    );
    const metricResultEntries = Object.entries(metricSnapshots)
      .filter(([, snap]) => !!snap?.results)
      .map(([metricName, snap]) => [
        metricName,
        {
          channels: exportChannels.filter((ch) => !!snap?.results?.[ch]),
          results: Object.fromEntries(
            exportChannels.map((ch) => [ch, snap?.results?.[ch] ?? null])
          ),
          settings: snap?.settings || { ...settings, metric: metricName },
        },
      ]);
    exportJSON(`mantis-dof-${Date.now()}.json`, {
      kind: 'mantis-dof-analysis',
      version: 2,
      exportedAt: new Date().toISOString(),
      source: run.source || null,
      channels: exportChannels,
      lines: allLines,
      points: allPoints,
      settings,
      display: {
        unit_pref: unitPref,
        tilt_angle_deg: tiltAngleDeg,
        tilt_factor: tiltFactor,
        show_metric_band: showMetricBand,
        show_profile_band: showProfileBand,
        show_metric_peak: showMetricPeak,
        show_profile_peak: showProfilePeak,
      },
      results: Object.fromEntries(exportChannels.map((ch) => [ch, results[ch] ?? null])),
      ...(metricResultEntries.length
        ? { metric_results: Object.fromEntries(metricResultEntries) }
        : {}),
    });
    onToast('Exported analysis JSON', 'success');
  }, [
    response.channels,
    run.channels,
    common.allChannels,
    allLines,
    allPoints,
    settings,
    results,
    metricSnapshots,
    onToast,
    unitPref,
    tiltAngleDeg,
    tiltFactor,
    showMetricBand,
    showProfileBand,
    showMetricPeak,
    showProfilePeak,
  ]);

  const filterExtras = (
    <>
      <FilterLabel marginLeft={6}>Line</FilterLabel>
      <Segmented
        value={lineIdxFilter}
        onChange={setLineIdxFilter}
        options={[
          { value: 'all', label: 'All' },
          ...allLines.map((_, i) => ({ value: String(i), label: lineLabel(i) })),
        ]}
      />
      {cachedMetricOptions.length > 1 && (
        <>
          <FilterLabel marginLeft={6}>Metric</FilterLabel>
          <Segmented
            value={metricFilter}
            onChange={setMetricFilter}
            options={cachedMetricOptions}
          />
        </>
      )}
      {cachedMetricOptions.length <= 1 && (settings.compute_all_metrics || isImportedSnapshot) && (
        <>
          <FilterLabel marginLeft={6}>Metric</FilterLabel>
          <span
            title={
              isImportedSnapshot
                ? 'Imported analysis JSON is a frozen snapshot. This file contains only this full metric result.'
                : 'This run contains only this full metric result. Enable All 4 metrics before Run Analysis to switch without recomputing.'
            }
            style={{
              fontSize: 10,
              color: t.textFaint,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            {settings.metric || metricFilter} only
          </span>
        </>
      )}
      <FilterLabel marginLeft={6}>Unit</FilterLabel>
      <Segmented value={unitPref} onChange={setUnitPref} options={DOF_UNIT_OPTS} />
      {unitPref !== 'auto' && unitPref !== 'px' && !anyCalibrated && (
        <span
          title="No line is calibrated — values will fall back to pixels."
          style={{
            fontSize: 10,
            color: t.warn,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          calibration missing
        </span>
      )}
      <FilterLabel marginLeft={6}>Tilt</FilterLabel>
      <input
        type="number"
        min={0}
        max={89}
        step={0.5}
        value={tiltAngleDeg}
        disabled={!anyCalibrated}
        title={
          anyCalibrated
            ? 'Target tilt θ (°). Peak / σ / FWHM / DoF scale by 1/cos(θ).'
            : 'Calibrate a reference first to apply tilt correction.'
        }
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!Number.isFinite(v)) {
            setTiltAngleDeg(0);
            return;
          }
          setTiltAngleDeg(Math.min(89, Math.max(0, v)));
        }}
        style={{
          width: 60,
          padding: '4px 6px',
          fontSize: 12,
          fontFamily: 'ui-monospace,Menlo,monospace',
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 4,
          color: anyCalibrated ? t.text : t.textFaint,
          opacity: anyCalibrated ? 1 : 0.55,
        }}
        aria-label="Tilt angle in degrees"
      />
      <span
        style={{
          fontSize: 10,
          color: t.textFaint,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        °
      </span>
      <FilterLabel marginLeft={6}>Overlays</FilterLabel>
      <Checkbox checked={showMetricBand} onChange={setShowMetricBand} label="Metric band" />
      <Checkbox checked={showProfileBand} onChange={setShowProfileBand} label="Profile band" />
      <Checkbox checked={showMetricPeak} onChange={setShowMetricPeak} label="Metric peak" />
      <Checkbox checked={showProfilePeak} onChange={setShowProfilePeak} label="Profile peak" />
    </>
  );

  const countsText = (
    <>
      DoF analysis — {common.visibleChannels.length} channel
      {common.visibleChannels.length !== 1 ? 's' : ''} × {allLines.length} line
      {allLines.length !== 1 ? 's' : ''} · {allPoints.length} point
      {allPoints.length !== 1 ? 's' : ''}
      {tiltFactor !== 1 && (
        <span
          style={{
            marginLeft: 8,
            fontSize: 11,
            fontWeight: 500,
            color: t.warn,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          (tilt-corrected θ={tiltAngleDeg}°, ×{tiltFactor.toFixed(3)})
        </span>
      )}
    </>
  );

  const subtitleText = (
    <>
      metric={settings.metric} · half-win={settings.half_window}px · threshold=
      {((settings.threshold ?? 0) * 100).toFixed(0)}% · profile-thr=
      {((settings.profile_threshold ?? 0.5) * 100).toFixed(0)}%
      {settings.bootstrap ? ' · bootstrap' : ''}
      {settings.compute_all_metrics ? ' · 4-metric sweep' : ''}
      {settings.fit_tilt_plane ? ' · tilt plane' : ''}
      {settings.calibration ? ` · cal px/${settings.calibration.unit}` : ' · uncalibrated'}
    </>
  );

  const renderTab = useCallback(
    () => (
      <_DoFTabBody
        tab={common.tab}
        visibleChannels={common.visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        pointLabel={pointLabel}
        metric={selectedMetric}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
        showMetricBand={showMetricBand}
        showProfileBand={showProfileBand}
        showMetricPeak={showMetricPeak}
        showProfilePeak={showProfilePeak}
      />
    ),
    [
      common.tab,
      common.visibleChannels,
      results,
      visibleLineIdx,
      lineLabel,
      pointLabel,
      selectedMetric,
      unitPref,
      tiltFactor,
      showMetricBand,
      showProfileBand,
      showMetricPeak,
      showProfilePeak,
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

export const dofSpec: ModeSpec = {
  id: 'dof',
  defaultTab: 'summary',
  tabs: [
    { key: 'summary', label: 'Summary' },
    { key: 'lines', label: 'Line scans' },
    { key: 'raw', label: 'Raw profiles' },
    { key: 'gaussian', label: 'Gaussian fits' },
    { key: 'metric', label: 'Metric compare' },
    { key: 'chromatic', label: 'Chromatic shift' },
    { key: 'heatmap', label: 'Focus heatmaps' },
    { key: 'points', label: 'Points / tilt' },
  ],
  pngFilename: (tab) => `mantis-dof-${tab}-${Date.now()}`,
  useModeView: useDofModeView,
};
