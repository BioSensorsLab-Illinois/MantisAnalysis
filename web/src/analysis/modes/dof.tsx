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
const apiFetch = _s.apiFetch as (
  path: string,
  opts?: { method?: string; body?: unknown }
) => Promise<DoFResponse>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _a = _analysis as any;
const _DoFTabBody = _a._DoFTabBody as React.ComponentType<Record<string, unknown>>;
const DOF_UNIT_OPTS = _a._DOF_UNIT_OPTS as ReadonlyArray<{ value: string; label: string }>;
const dofIsCalibrated = _a._dofIsCalibrated as (ln: unknown) => boolean;

interface DoFResponse {
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
  bootstrap?: boolean;
  compute_all_metrics?: boolean;
  fit_tilt_plane?: boolean;
  calibration?: { unit?: string } | null;
  n_boot?: number;
}

const useDofModeView = (
  run: RunRecord,
  common: FilterCommonState,
  { onToast }: ModeHelpers
): ModeView => {
  const t = useTheme();
  // DoF re-runs analysis when Metric flips — response is local state.
  const [response, setResponse] = useState<DoFResponse>((run.response || {}) as DoFResponse);
  const [_reRunning, setReRunning] = useState<boolean>(false);
  const results = useMemo<NonNullable<DoFResponse['results']>>(
    () => response.results || {},
    [response.results]
  );
  const settings = useMemo<DoFSettings>(() => response.settings || {}, [response.settings]);

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
    settings.metric || run.metric || 'laplacian'
  );
  const [unitPref, setUnitPref] = useState<string>('auto');
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

  // Re-run analysis on the server when Metric flips. Same body shape as
  // the original DoFAnalysisModal effect (analysis.tsx 4645).
  useEffect(() => {
    const current = response?.settings?.metric;
    if (!current || current === metricFilter) return;
    if (!run?.source?.source_id || !run?.channels?.length) return;
    let alive = true;
    setReRunning(true);
    onToast(`Re-running analysis with ${metricFilter}…`);
    const body = {
      source_id: run.source.source_id,
      channels: run.channels,
      points: (run.points || []).map((p) => ({
        x: p.x,
        y: p.y,
        label: p.label || '',
      })),
      lines: (run.lines || []).map((l) => ({ p0: l.p0, p1: l.p1 })),
      metric: metricFilter,
      half_window: settings.half_window,
      threshold: settings.threshold,
      calibration: settings.calibration || run.calibration || null,
      isp: run.isp || null,
      compute_all_metrics: !!settings.compute_all_metrics,
      bootstrap: !!settings.bootstrap,
      n_boot: settings.n_boot || 100,
      fit_tilt_plane: !!settings.fit_tilt_plane,
      include_pngs: false,
    };
    apiFetch('/api/dof/analyze', { method: 'POST', body })
      .then((res) => {
        if (alive) {
          setResponse(res);
          onToast(`Switched to ${metricFilter}`, 'success');
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          const msg =
            (err as { detail?: string; message?: string })?.detail ||
            (err as Error)?.message ||
            String(err);
          onToast(`Re-run failed: ${msg}`, 'danger');
        }
      })
      .finally(() => {
        if (alive) setReRunning(false);
      });
    return () => {
      alive = false;
    };
    // Match original deps — only metricFilter triggers the re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricFilter]);

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
    tiltAngleDeg,
    tiltFactor,
    lineLabel,
    pointLabel,
  ]);

  const onExportJSON = useCallback(() => {
    exportJSON(`mantis-dof-${Date.now()}.json`, {
      kind: 'mantis-dof-analysis',
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: common.visibleChannels,
      lines: allLines,
      points: allPoints,
      settings,
      display: {
        unit_pref: unitPref,
        tilt_angle_deg: tiltAngleDeg,
        tilt_factor: tiltFactor,
      },
      results: Object.fromEntries(common.visibleChannels.map((ch) => [ch, results[ch] ?? null])),
    });
    onToast('Exported analysis JSON', 'success');
  }, [
    common.visibleChannels,
    allLines,
    allPoints,
    settings,
    results,
    onToast,
    unitPref,
    tiltAngleDeg,
    tiltFactor,
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
      {settings.compute_all_metrics && (
        <>
          <FilterLabel marginLeft={6}>Metric</FilterLabel>
          <Segmented
            value={metricFilter}
            onChange={setMetricFilter}
            options={[
              { value: 'laplacian', label: 'Laplacian' },
              { value: 'brenner', label: 'Brenner' },
              { value: 'tenengrad', label: 'Tenengrad' },
              { value: 'fft_hf', label: 'FFT-HF' },
            ]}
          />
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
      {((settings.threshold ?? 0) * 100).toFixed(0)}%{settings.bootstrap ? ' · bootstrap' : ''}
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
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    ),
    [
      common.tab,
      common.visibleChannels,
      results,
      visibleLineIdx,
      lineLabel,
      pointLabel,
      unitPref,
      tiltFactor,
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
    { key: 'gaussian', label: 'Gaussian fits' },
    { key: 'metric', label: 'Metric compare' },
    { key: 'chromatic', label: 'Chromatic shift' },
    { key: 'heatmap', label: 'Focus heatmaps' },
    { key: 'points', label: 'Points / tilt' },
  ],
  pngFilename: (tab) => `mantis-dof-${tab}-${Date.now()}`,
  useModeView: useDofModeView,
};
