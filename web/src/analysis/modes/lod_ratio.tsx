// TBR mode spec — registered into the same AnalysisShell that powers
// USAF / FPN / DoF, so the TBR analysis report inherits the modal
// chrome (header, filter bar, tab rail, body), the PNG/CSV/JSON
// export pipeline, the channel + gain filters, the plot-style panel,
// and the Esc-to-close behaviour.
//
// Each entry in `run.response.tbr_entries` is a TBR measurement
// committed from the Inspector → TBR Analysis section in Play. The
// shell's `chans` filter is repurposed as a per-CHANNEL filter on
// the entries (so a stream that mixes HG-G and HDR-Y measurements
// can be sliced by channel before reading the plots).

import React, { useCallback, useMemo } from 'react';
import * as _shared from '../../shared.tsx';
import { FilterLabel } from '../filterbar';
import { computeLod, type LodK } from '../../playback/lod';
import type { FilterCommonState, ModeHelpers, ModeSpec, ModeView, RunRecord } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const useTheme = _s.useTheme as () => Record<string, string>;
const exportCSV = _s.exportCSV as (filename: string, rows: ReadonlyArray<unknown>) => void;
const exportJSON = _s.exportJSON as (filename: string, payload: unknown) => void;
const Segmented = _s.Segmented as React.ComponentType<{
  value: string | number;
  onChange: (v: string | number) => void;
  options: ReadonlyArray<{ value: string | number; label: string }>;
}>;
// play-lod-ratio-tools-v1 M5 — Intensity-mode controls (k segmented +
// sustained checkbox). Reuses shared primitives so visual style
// matches the rest of the inspector / modal.
const Checkbox = _s.Checkbox as React.ComponentType<{
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel?: string;
}>;
const useLocalStorageState = _s.useLocalStorageState as <T>(
  key: string,
  initial: T
) => [T, (v: T | ((prev: T) => T)) => void];

interface TbrEntry {
  id: string;
  // play-lod-ratio-tools-v1 M2 — discriminator across the unified
  // entry shape. v1-migrated rows + Ratio commits get 'ratio';
  // Intensity commits get 'intensity'; the single shared baseline
  // ROI is 'baseline' and lives outside the renderable list.
  kind?: 'ratio' | 'intensity' | 'baseline';
  analysisMode?: 'ratio' | 'intensity';
  // play-lod-ratio-tools-v1 M3 — flexible naming. Optional; the UI
  // falls back to sourceFile when label is missing.
  label?: string;
  numericValue?: number;
  unit?: string;
  order?: number;
  // Canonical v2 names (signalPolygon/signalValue/...) + legacy
  // tumor* aliases for v1-migrated entries.
  signalPolygon?: ReadonlyArray<readonly [number, number]>;
  signalValue?: number;
  signalStd?: number;
  signalN?: number;
  sourceFile?: string;
  sourceId?: string;
  frameIndex: number;
  channel: string;
  method: 'mean' | 'percentile' | 'mode';
  percentile?: number;
  applyDark?: boolean;
  blackLevel?: number;
  // v2: snapshot of the linear ISP chain (gain / offset / sharpen / FPN)
  // active when this entry was committed. Absent on v1 entries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewConfig?: Record<string, any>;
  pipelineVersion?: number;
  recomputedAt?: string;
  tumorValue: number;
  tumorStd: number;
  tumorN: number;
  bgValue: number;
  bgStd: number;
  bgN: number;
  ratio: number;
  ratioStd: number;
  createdAt?: string;
}

interface TbrResponse {
  channels?: readonly string[];
  tbr_entries?: readonly TbrEntry[];
}

const TUMOR_COLOR = '#ff5b5b';
const BG_COLOR = '#3ecbe5';

// --- Stat helpers -----------------------------------------------------------
const safeMean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
const safeStd = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = safeMean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const pctOf = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  const i = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)));
  return sorted[i];
};

const fmtInt = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : String(Math.round(Number(v)));
const fmt2 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(2);
const fmt1 = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(1);

// --- Inline SVG chart primitives (Plotly-free) -----------------------------
interface PlotProps {
  width?: number;
  height?: number;
  children?: React.ReactNode;
}

const PlotCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  children,
}) => {
  const t = useTheme();
  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 0,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.4 }}>{subtitle}</div>
      )}
      {children}
    </div>
  );
};

const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  accent?: boolean;
}> = ({ label, value, hint, accent }) => {
  const t = useTheme();
  return (
    <div
      style={{
        background: accent ? t.accentSoft : t.panelAlt,
        border: `1px solid ${accent ? t.accent : t.border}`,
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          letterSpacing: 0.6,
          color: t.textFaint,
          fontWeight: 600,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: accent ? t.accent : t.text,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        {value}
      </span>
      {hint && <span style={{ fontSize: 10, color: t.textMuted }}>{hint}</span>}
    </div>
  );
};

// --- Mode hook --------------------------------------------------------------
const useTbrModeView = (
  run: RunRecord,
  common: FilterCommonState,
  helpers: ModeHelpers
): ModeView => {
  const t = useTheme();
  const resp = (run.response || {}) as TbrResponse;
  const allEntries: readonly TbrEntry[] = resp.tbr_entries || [];

  // Apply the shell's channel filter to entries. Note: this includes
  // ratio + intensity + baseline kinds; downstream consumers split
  // by kind via the derivations below.
  const visible = useMemo<readonly TbrEntry[]>(
    () =>
      common.visibleChannels.length === 0
        ? allEntries
        : allEntries.filter((e) => common.visibleChannels.includes(e.channel)),
    [allEntries, common.visibleChannels]
  );

  // play-lod-ratio-tools-v1 M5 — split by kind. v1-migrated entries
  // get kind='ratio' from the migration shim; v2 entries carry their
  // own discriminator. Default to 'ratio' for any legacy row that
  // somehow reached here without a kind so the existing Ratio plots
  // keep working.
  const ratioEntries = useMemo<readonly TbrEntry[]>(
    () =>
      visible.filter(
        (e) => (e.kind ?? 'ratio') === 'ratio'
      ),
    [visible]
  );
  const intensityEntries = useMemo<readonly TbrEntry[]>(
    () => visible.filter((e) => e.kind === 'intensity'),
    [visible]
  );
  // M6 risk-skeptic P1-C — baseline lookup must use the UNFILTERED
  // entries set, not the channel-filtered `visible`. If the user
  // applies a channel chip filter that doesn't include the
  // baseline's channel, we'd otherwise drop the baseline and the
  // modal would render "Set a baseline ROI" while the panel still
  // shows it. The threshold + LoD calculation is meaningful only
  // when baseline + signal share a channel anyway (panel-side
  // P0-B guard enforces that on commit).
  const baselineEntry = useMemo<TbrEntry | null>(
    () => allEntries.find((e) => e.kind === 'baseline') ?? null,
    [allEntries]
  );

  // The legacy `entries` symbol (used by every ratio plot below) is
  // now the ratio-only slice. Kept under the same name so the rest
  // of the file is unchanged. play-lod-ratio-tools-v1 M5.
  const entries = ratioEntries;

  // ---- LoD state (Intensity-mode controls) ---------------------
  // k ∈ {3, 6, 10}. Default 3 = limit of detection (IUPAC). Persisted
  // so the user's last choice survives reloads.
  const [kSigma, setKSigma] = useLocalStorageState<LodK>(
    'mantis/lodRatioModal.k.v1',
    3
  );
  const [sustained, setSustained] = useLocalStorageState<boolean>(
    'mantis/lodRatioModal.sustained.v1',
    true
  );

  const lodResult = useMemo(() => {
    const baseSrc = baselineEntry;
    const baseline = baseSrc
      ? {
          mean: (baseSrc.signalValue ?? baseSrc.tumorValue) || 0,
          std: (baseSrc.signalStd ?? baseSrc.tumorStd) || 0,
          n: baseSrc.signalN ?? baseSrc.tumorN ?? null,
        }
      : null;
    return computeLod({
      baseline,
      entries: intensityEntries.map((e) => ({
        id: e.id,
        signalValue: (e.signalValue ?? e.tumorValue) || 0,
        signalStd: e.signalStd ?? e.tumorStd ?? null,
        numericValue: e.numericValue ?? null,
        label: e.label ?? null,
      })),
      k: kSigma,
      sustained,
    });
  }, [baselineEntry, intensityEntries, kSigma, sustained]);

  const ratios = useMemo<readonly number[]>(
    () => entries.map((e) => e.ratio).filter((v) => Number.isFinite(v)),
    [entries]
  );

  const summary = useMemo(() => {
    if (ratios.length === 0) return null;
    const sorted = [...ratios].sort((a, b) => a - b);
    const mean = safeMean(ratios);
    const std = safeStd(ratios);
    return {
      n: ratios.length,
      mean,
      std,
      sem: std / Math.sqrt(Math.max(1, ratios.length)),
      median: pctOf(sorted, 0.5),
      q1: pctOf(sorted, 0.25),
      q3: pctOf(sorted, 0.75),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      ci95Lo: mean - 1.96 * (std / Math.sqrt(Math.max(1, ratios.length))),
      ci95Hi: mean + 1.96 * (std / Math.sqrt(Math.max(1, ratios.length))),
      fracBright: ratios.filter((r) => r > 1).length / ratios.length,
    };
  }, [ratios]);

  const groupBy = useCallback(
    (keyFn: (e: TbrEntry) => string) => {
      const m = new Map<string, TbrEntry[]>();
      for (const e of entries) {
        const k = keyFn(e);
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(e);
      }
      return [...m.entries()]
        .map(([key, arr]) => {
          const rs = arr.map((x) => x.ratio).filter(Number.isFinite);
          if (rs.length === 0) return null;
          return { key, n: rs.length, mean: safeMean(rs), std: safeStd(rs) };
        })
        .filter((x): x is { key: string; n: number; mean: number; std: number } => Boolean(x))
        .sort((a, b) => b.mean - a.mean);
    },
    [entries]
  );
  const byFile = useMemo(() => groupBy((e) => e.sourceFile || '?'), [groupBy]);
  const byChannel = useMemo(() => groupBy((e) => e.channel || '?'), [groupBy]);

  // ---- chart geometry ----
  const W = 880;
  const H = 340;
  const PAD = { l: 60, r: 28, t: 24, b: 48 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;

  const ratioMax = useMemo(
    () => Math.max(0.001, ...ratios.map((r, i) => r + (entries[i]?.ratioStd || 0))) * 1.1,
    [ratios, entries]
  );
  const ratioYScale = useCallback(
    (v: number) => PAD.t + innerH - (v / ratioMax) * innerH,
    [ratioMax, innerH]
  );
  const intensityMax = useMemo(
    () => Math.max(0.001, ...entries.flatMap((e) => [e.tumorValue || 0, e.bgValue || 0])) * 1.1,
    [entries]
  );

  // ---- chart components ----
  const Axis = ({
    ticks,
    vmax,
    vmin = 0,
    suffix = '',
  }: {
    ticks: number;
    vmax: number;
    vmin?: number;
    suffix?: string;
  }) => (
    <>
      {Array.from({ length: ticks + 1 }, (_, i) => i / ticks).map((f, i) => {
        const y = PAD.t + innerH * (1 - f);
        const v = vmin + (vmax - vmin) * f;
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} stroke={t.border} strokeDasharray="3,3" />
            <text x={PAD.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
              {Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2)}
              {suffix}
            </text>
          </g>
        );
      })}
    </>
  );

  const RatioBarChart = () => (
    <svg viewBox={`0 0 ${W} ${H}`} data-tbr-bar-chart style={{ width: '100%', height: H }}>
      <Axis ticks={5} vmax={ratioMax} />
      {ratioMax > 1 && (
        <g>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={ratioYScale(1)}
            y2={ratioYScale(1)}
            stroke={t.warn || '#e5a13a'}
            strokeDasharray="6,3"
          />
          <text
            x={W - PAD.r - 4}
            y={ratioYScale(1) - 4}
            fontSize="10"
            fill={t.warn || '#e5a13a'}
            textAnchor="end"
          >
            TBR=1
          </text>
        </g>
      )}
      {entries.map((e, i) => {
        const barW = innerW / Math.max(1, entries.length);
        const x = PAD.l + i * barW;
        const y = ratioYScale(e.ratio);
        const h = PAD.t + innerH - y;
        const errTop = ratioYScale(e.ratio + (e.ratioStd || 0));
        const errBot = ratioYScale(Math.max(0, e.ratio - (e.ratioStd || 0)));
        return (
          <g key={e.id}>
            <rect
              x={x + barW * 0.15}
              y={y}
              width={barW * 0.7}
              height={Math.max(0, h)}
              fill={t.accent}
              opacity={0.9}
              rx={2}
            />
            <line
              x1={x + barW * 0.5}
              x2={x + barW * 0.5}
              y1={errTop}
              y2={errBot}
              stroke={t.text}
              strokeWidth={1.2}
            />
            <line
              x1={x + barW * 0.35}
              x2={x + barW * 0.65}
              y1={errTop}
              y2={errTop}
              stroke={t.text}
              strokeWidth={1.2}
            />
            <line
              x1={x + barW * 0.35}
              x2={x + barW * 0.65}
              y1={errBot}
              y2={errBot}
              stroke={t.text}
              strokeWidth={1.2}
            />
            <text
              x={x + barW * 0.5}
              y={H - PAD.b + 14}
              textAnchor="middle"
              fontSize="9.5"
              fill={t.textMuted}
            >
              {i + 1}
            </text>
          </g>
        );
      })}
      <text
        x={PAD.l - 44}
        y={PAD.t + innerH / 2}
        fontSize="11"
        fill={t.textMuted}
        transform={`rotate(-90 ${PAD.l - 44} ${PAD.t + innerH / 2})`}
      >
        TBR ratio
      </text>
      <text x={W / 2} y={H - 6} fontSize="11" fill={t.textMuted} textAnchor="middle">
        entry #
      </text>
    </svg>
  );

  const TumorVsBgChart = () => {
    const yMax = intensityMax;
    const yScale = (v: number) => PAD.t + innerH - (v / yMax) * innerH;
    const groupW = innerW / Math.max(1, entries.length);
    const subW = groupW * 0.4;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} data-tbr-tumor-bg-chart style={{ width: '100%', height: H }}>
        <Axis ticks={5} vmax={yMax} />
        {entries.map((e, i) => {
          const xT = PAD.l + i * groupW + groupW * 0.1;
          const xB = xT + subW + 4;
          const yT = yScale(e.tumorValue || 0);
          const yB = yScale(e.bgValue || 0);
          const errLine = (cx: number, val: number, std: number) => {
            const top = yScale(val + (std || 0));
            const bot = yScale(Math.max(0, val - (std || 0)));
            return (
              <g>
                <line x1={cx} x2={cx} y1={top} y2={bot} stroke={t.text} strokeWidth={1} />
                <line x1={cx - 3} x2={cx + 3} y1={top} y2={top} stroke={t.text} strokeWidth={1} />
                <line x1={cx - 3} x2={cx + 3} y1={bot} y2={bot} stroke={t.text} strokeWidth={1} />
              </g>
            );
          };
          return (
            <g key={e.id}>
              <rect
                x={xT}
                y={yT}
                width={subW}
                height={Math.max(0, PAD.t + innerH - yT)}
                fill={TUMOR_COLOR}
                opacity={0.9}
                rx={2}
              />
              <rect
                x={xB}
                y={yB}
                width={subW}
                height={Math.max(0, PAD.t + innerH - yB)}
                fill={BG_COLOR}
                opacity={0.9}
                rx={2}
              />
              {errLine(xT + subW / 2, e.tumorValue || 0, e.tumorStd || 0)}
              {errLine(xB + subW / 2, e.bgValue || 0, e.bgStd || 0)}
              <text
                x={PAD.l + i * groupW + groupW / 2}
                y={H - PAD.b + 14}
                textAnchor="middle"
                fontSize="9.5"
                fill={t.textMuted}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
        {/* Legend */}
        <g>
          <rect
            x={W - PAD.r - 160}
            y={PAD.t + 4}
            width={12}
            height={12}
            fill={TUMOR_COLOR}
            rx={2}
          />
          <text x={W - PAD.r - 142} y={PAD.t + 14} fontSize="11" fill={t.text}>
            Tumor
          </text>
          <rect x={W - PAD.r - 80} y={PAD.t + 4} width={12} height={12} fill={BG_COLOR} rx={2} />
          <text x={W - PAD.r - 62} y={PAD.t + 14} fontSize="11" fill={t.text}>
            Background
          </text>
        </g>
        <text
          x={PAD.l - 44}
          y={PAD.t + innerH / 2}
          fontSize="11"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 44} ${PAD.t + innerH / 2})`}
        >
          intensity (DN)
        </text>
      </svg>
    );
  };

  const ScatterChart = () => {
    const lim = intensityMax;
    const xScale = (v: number) => PAD.l + (v / lim) * innerW;
    const yScale = (v: number) => PAD.t + innerH - (v / lim) * innerH;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} data-tbr-scatter-chart style={{ width: '100%', height: H }}>
        {Array.from({ length: 6 }, (_, i) => i / 5).map((f, i) => {
          const y = PAD.t + innerH * (1 - f);
          const x = PAD.l + innerW * f;
          const v = lim * f;
          return (
            <g key={i}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y}
                y2={y}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <line
                x1={x}
                x2={x}
                y1={PAD.t}
                y2={PAD.t + innerH}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <text x={PAD.l - 8} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2)}
              </text>
              <text x={x} y={H - PAD.b + 14} textAnchor="middle" fontSize="10" fill={t.textFaint}>
                {Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(2)}
              </text>
            </g>
          );
        })}
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(lim)}
          y2={yScale(lim)}
          stroke={t.warn || '#e5a13a'}
          strokeDasharray="6,3"
        />
        {entries.map((e, i) => (
          <g key={e.id}>
            <circle
              cx={xScale(e.bgValue || 0)}
              cy={yScale(e.tumorValue || 0)}
              r={5}
              fill={t.accent}
              stroke="#fff"
              strokeWidth={1.2}
            />
            <text
              x={xScale(e.bgValue || 0) + 7}
              y={yScale(e.tumorValue || 0) - 7}
              fontSize="9.5"
              fill={t.textMuted}
            >
              {i + 1}
            </text>
          </g>
        ))}
        <text
          x={PAD.l - 44}
          y={PAD.t + innerH / 2}
          fontSize="11"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 44} ${PAD.t + innerH / 2})`}
        >
          tumor intensity
        </text>
        <text x={W / 2} y={H - 6} fontSize="11" fill={t.textMuted} textAnchor="middle">
          background intensity
        </text>
      </svg>
    );
  };

  const Histogram = () => {
    if (ratios.length === 0) return null;
    const lo = Math.min(...ratios);
    const hi = Math.max(...ratios);
    const span = Math.max(1e-6, hi - lo);
    const N = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(ratios.length) * 2)));
    const bins = new Array(N).fill(0);
    for (const r of ratios) {
      const k = Math.min(N - 1, Math.max(0, Math.floor(((r - lo) / span) * N)));
      bins[k] += 1;
    }
    const maxC = Math.max(1, ...bins);
    const barW = innerW / N;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} data-tbr-hist style={{ width: '100%', height: H }}>
        <Axis ticks={5} vmax={maxC} />
        {bins.map((c, i) => {
          const x = PAD.l + i * barW;
          const h = (c / maxC) * innerH;
          const y = PAD.t + innerH - h;
          return (
            <rect
              key={i}
              x={x + 1}
              y={y}
              width={Math.max(1, barW - 2)}
              height={h}
              fill={t.accent}
              opacity={0.9}
              rx={2}
            />
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const x = PAD.l + innerW * f;
          return (
            <text
              key={f}
              x={x}
              y={H - PAD.b + 14}
              textAnchor="middle"
              fontSize="10"
              fill={t.textFaint}
            >
              {fmt2(lo + span * f)}
            </text>
          );
        })}
        {summary && (
          <>
            <line
              x1={PAD.l + ((summary.mean - lo) / span) * innerW}
              x2={PAD.l + ((summary.mean - lo) / span) * innerW}
              y1={PAD.t}
              y2={PAD.t + innerH}
              stroke={t.text}
              strokeWidth={1.5}
            />
            <line
              x1={PAD.l + ((summary.median - lo) / span) * innerW}
              x2={PAD.l + ((summary.median - lo) / span) * innerW}
              y1={PAD.t}
              y2={PAD.t + innerH}
              stroke={t.warn || '#e5a13a'}
              strokeDasharray="4,3"
              strokeWidth={1.5}
            />
            <text x={W - PAD.r - 110} y={PAD.t + 14} fontSize="11" fill={t.text}>
              — mean
            </text>
            <text x={W - PAD.r - 110} y={PAD.t + 28} fontSize="11" fill={t.warn || '#e5a13a'}>
              -- median
            </text>
          </>
        )}
        <text
          x={PAD.l - 44}
          y={PAD.t + innerH / 2}
          fontSize="11"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 44} ${PAD.t + innerH / 2})`}
        >
          count
        </text>
        <text x={W / 2} y={H - 6} fontSize="11" fill={t.textMuted} textAnchor="middle">
          TBR ratio
        </text>
      </svg>
    );
  };

  const BoxPlot = () => {
    if (!summary) return null;
    const yMin = Math.min(0, summary.min - (summary.std || 0));
    const yMax = Math.max(summary.max + (summary.std || 0), 1.1);
    const span = Math.max(1e-6, yMax - yMin);
    const yScale = (v: number) => PAD.t + innerH - ((v - yMin) / span) * innerH;
    const cx = PAD.l + innerW * 0.5;
    const halfW = 90;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} data-tbr-box-plot style={{ width: '100%', height: H }}>
        <Axis ticks={5} vmax={yMax} vmin={yMin} />
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yScale(1)}
          y2={yScale(1)}
          stroke={t.warn || '#e5a13a'}
          strokeDasharray="6,3"
        />
        <line
          x1={cx}
          x2={cx}
          y1={yScale(summary.min)}
          y2={yScale(summary.q1)}
          stroke={t.text}
          strokeWidth={1.5}
        />
        <line
          x1={cx}
          x2={cx}
          y1={yScale(summary.q3)}
          y2={yScale(summary.max)}
          stroke={t.text}
          strokeWidth={1.5}
        />
        <line
          x1={cx - 30}
          x2={cx + 30}
          y1={yScale(summary.min)}
          y2={yScale(summary.min)}
          stroke={t.text}
          strokeWidth={1.5}
        />
        <line
          x1={cx - 30}
          x2={cx + 30}
          y1={yScale(summary.max)}
          y2={yScale(summary.max)}
          stroke={t.text}
          strokeWidth={1.5}
        />
        <rect
          x={cx - halfW}
          y={yScale(summary.q3)}
          width={2 * halfW}
          height={yScale(summary.q1) - yScale(summary.q3)}
          fill={t.accentSoft}
          stroke={t.accent}
          strokeWidth={1.5}
          rx={3}
        />
        <line
          x1={cx - halfW}
          x2={cx + halfW}
          y1={yScale(summary.median)}
          y2={yScale(summary.median)}
          stroke={t.accent}
          strokeWidth={2.5}
        />
        <polygon
          points={`${cx},${yScale(summary.mean) - 7} ${cx + 7},${yScale(summary.mean)} ${cx},${yScale(summary.mean) + 7} ${cx - 7},${yScale(summary.mean)}`}
          fill={t.text}
        />
        {ratios.map((r, i) => {
          const jitter = ((i % 9) - 4) * 8;
          return (
            <circle
              key={i}
              cx={cx + jitter}
              cy={yScale(r)}
              r={3.5}
              fill={t.accent}
              opacity={0.65}
              stroke="#fff"
              strokeWidth={0.8}
            />
          );
        })}
        <text
          x={PAD.l - 44}
          y={PAD.t + innerH / 2}
          fontSize="11"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 44} ${PAD.t + innerH / 2})`}
        >
          TBR ratio
        </text>
        <text x={cx} y={H - 6} fontSize="11" fill={t.textMuted} textAnchor="middle">
          all entries (n={summary.n})
        </text>
      </svg>
    );
  };

  // ---- per-tab body ----
  const renderTab = useCallback((): React.ReactNode => {
    // play-lod-ratio-tools-v1 M5 — Intensity-mode tabs. Render before
    // the legacy ratio empty-state branch so a session that only has
    // Intensity entries still renders something useful.
    if (
      common.tab === 'lod_summary' ||
      common.tab === 'lod_intensity' ||
      common.tab === 'lod_snr'
    ) {
      if (intensityEntries.length === 0) {
        return (
          <div style={{ padding: 24, fontSize: 13, color: t.textMuted }}>
            No Intensity entries match the current channel filter. Switch the LoD/Ratio panel to
            Intensity mode and add a baseline + at least one signal ROI.
          </div>
        );
      }
      if (common.tab === 'lod_summary') {
        // M6 risk-skeptic P0-A / P1-C / P1-D — surface every diagnostic
        // as a colored banner so the user cannot miss a degenerate
        // baseline, missing baseline, or non-monotonic ladder.
        const diagnosticBanners = lodResult.diagnostics.map((code) => {
          const [bg, fg, msg] = (() => {
            switch (code) {
              case 'no-baseline':
                return [
                  '#3a2a2a',
                  '#f7d96e',
                  'No baseline ROI set. Switch to Intensity mode in the LoD/Ratio panel and click "Set as baseline" on a signal-free region. The LoD calculation cannot proceed without a baseline.',
                ];
              case 'degenerate-baseline':
                return [
                  '#4a1f1f',
                  '#ff8a8a',
                  'Baseline σ is zero or non-finite (single-pixel polygon, or fully-constant region). Threshold collapses to μ and any positive signal would falsely pass — the LoD is REFUSED. Re-draw the baseline ROI to cover ≥ ~50 representative pixels with non-trivial variance.',
                ];
              case 'no-numeric':
                return [
                  '#2f2a14',
                  '#f7d96e',
                  'No entries carry a numeric value (concentration / depth / time). Click each row in the LoD/Ratio panel and fill in the value + unit fields so the LoD search has an x-axis to compare on.',
                ];
              case 'non-monotonic':
                return [
                  '#2f2a14',
                  '#f7a83a',
                  'Non-monotonic ladder detected: at least one entry below the reported LoD also passes the threshold. This usually indicates sensor saturation, a lens artifact, or a misordered sample. The sustained-LoD is anchored to the highest contiguous pass run — review the SNR tab for outliers.',
                ];
              default:
                return ['#2f2a14', '#f7d96e', `Diagnostic: ${code}`];
            }
          })();
          return (
            <div
              key={code}
              data-lod-diagnostic={code}
              style={{
                padding: 10,
                fontSize: 12,
                lineHeight: 1.45,
                color: fg,
                background: bg,
                border: `1px solid ${fg}`,
                borderRadius: 4,
              }}
            >
              <strong style={{ marginRight: 6 }}>{code}:</strong>
              {msg}
            </div>
          );
        });
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {diagnosticBanners.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {diagnosticBanners}
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                gap: 10,
              }}
            >
              <StatCard
                label="LoD"
                value={
                  lodResult.lod
                    ? `${fmt2(lodResult.lod.numericValue)}${
                        // Try to use any entry's unit (assumes one
                        // unit per dataset; users would mix units
                        // rarely and at their own risk).
                        intensityEntries.find((e) => e.unit)?.unit
                          ? ' ' + intensityEntries.find((e) => e.unit)?.unit
                          : ''
                      }`
                    : lodResult.diagnostics.includes('degenerate-baseline')
                      ? 'refused — degenerate baseline'
                      : lodResult.anyPasses
                        ? '— (no numeric ladder)'
                        : 'no detection'
                }
                hint={`k = ${lodResult.k}${
                  lodResult.sustained ? ' · sustained' : ' · single-pass'
                }`}
                accent
              />
              <StatCard
                label="Threshold (μ + k·σ)"
                value={
                  lodResult.threshold != null ? fmtInt(lodResult.threshold) : '—'
                }
                hint={
                  baselineEntry
                    ? `μ=${fmtInt(
                        baselineEntry.signalValue ?? baselineEntry.tumorValue
                      )} σ=${fmtInt(
                        baselineEntry.signalStd ?? baselineEntry.tumorStd
                      )}`
                    : 'no baseline set'
                }
              />
              <StatCard
                label="entries pass / total"
                value={`${
                  lodResult.perEntry.filter((p) => p.passes).length
                } / ${lodResult.perEntry.length}`}
              />
              <StatCard
                label="baseline n_pixels"
                value={
                  baselineEntry
                    ? String(
                        baselineEntry.signalN ?? baselineEntry.tumorN ?? '—'
                      )
                    : '—'
                }
              />
            </div>
            {!baselineEntry && (
              <div
                style={{
                  padding: 12,
                  fontSize: 12,
                  color: t.textMuted,
                  border: `1px solid ${t.border}`,
                  borderRadius: 4,
                  background: t.chipBg,
                }}
                data-lod-no-baseline-msg
              >
                Set a Baseline ROI in the LoD/Ratio panel (Intensity mode) to compute LoD.
                Without a baseline, no SNR or detection threshold can be derived.
              </div>
            )}
          </div>
        );
      }
      if (common.tab === 'lod_intensity') {
        // Per-entry intensity bar chart with the threshold line.
        // Reuses the same chart geometry as the ratio bar chart.
        const intensityVals = intensityEntries.map(
          (e) => (e.signalValue ?? e.tumorValue) || 0
        );
        const yMax =
          Math.max(
            0.001,
            ...intensityVals,
            lodResult.threshold ?? 0
          ) * 1.15;
        const yScale = (v: number) =>
          PAD.t + innerH - (Math.max(0, v) / yMax) * innerH;
        const barW = innerW / Math.max(1, intensityEntries.length);
        return (
          <PlotCard
            title="Per-entry signal intensity"
            subtitle={
              lodResult.threshold != null
                ? `Dashed amber line marks the LoD threshold (μ_baseline + ${lodResult.k}·σ_baseline). Bars above pass.`
                : 'Set a baseline ROI to overlay the LoD threshold.'
            }
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              data-lod-intensity-chart
              style={{ width: '100%', height: H }}
            >
              {/* y-axis grid */}
              {[0, 0.25, 0.5, 0.75, 1].map((f) => {
                const y = PAD.t + innerH * (1 - f);
                return (
                  <g key={f}>
                    <line
                      x1={PAD.l}
                      x2={W - PAD.r}
                      y1={y}
                      y2={y}
                      stroke={t.border}
                      strokeDasharray="3,3"
                    />
                    <text
                      x={PAD.l - 6}
                      y={y + 3}
                      textAnchor="end"
                      fontSize="10"
                      fill={t.textFaint}
                    >
                      {fmtInt(yMax * f)}
                    </text>
                  </g>
                );
              })}
              {/* threshold reference line */}
              {lodResult.threshold != null && (
                <g>
                  <line
                    x1={PAD.l}
                    x2={W - PAD.r}
                    y1={yScale(lodResult.threshold)}
                    y2={yScale(lodResult.threshold)}
                    stroke="#e5a13a"
                    strokeDasharray="6,3"
                    strokeWidth={1.4}
                  />
                  <text
                    x={W - PAD.r - 6}
                    y={yScale(lodResult.threshold) - 5}
                    fontSize="10"
                    fill="#e5a13a"
                    textAnchor="end"
                  >
                    LoD = μ + {lodResult.k}σ
                  </text>
                </g>
              )}
              {intensityEntries.map((e, i) => {
                const v = (e.signalValue ?? e.tumorValue) || 0;
                const y = yScale(v);
                const h = Math.max(0, PAD.t + innerH - y);
                const passes =
                  lodResult.perEntry.find((p) => p.entryId === e.id)?.passes;
                const isLod = lodResult.lod?.entryId === e.id;
                return (
                  <g key={e.id}>
                    <rect
                      x={PAD.l + i * barW + barW * 0.15}
                      y={y}
                      width={barW * 0.7}
                      height={h}
                      fill={isLod ? '#e5a13a' : passes ? '#3ecbe5' : '#5d6773'}
                      opacity={0.9}
                    />
                    <text
                      x={PAD.l + i * barW + barW * 0.5}
                      y={H - PAD.b + 14}
                      textAnchor="middle"
                      fontSize="9.5"
                      fill={t.textMuted}
                    >
                      {e.label || (e.numericValue != null ? fmt2(e.numericValue) : i + 1)}
                    </text>
                  </g>
                );
              })}
              <text
                x={PAD.l - 42}
                y={PAD.t + innerH / 2}
                fontSize="10.5"
                fill={t.textMuted}
                transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
              >
                signal (DN)
              </text>
            </svg>
          </PlotCard>
        );
      }
      if (common.tab === 'lod_snr') {
        // SNR scatter: x=numericValue (or entry index), y=snr; with k-line.
        const snrVals = lodResult.perEntry
          .map((p) => p.snr)
          .filter((v): v is number => Number.isFinite(v ?? NaN));
        if (snrVals.length === 0) {
          return (
            <div style={{ padding: 24, fontSize: 13, color: t.textMuted }}>
              SNR is undefined when the baseline standard deviation is zero (or no baseline
              is set). Set a baseline ROI with a non-degenerate polygon to populate this view.
            </div>
          );
        }
        const yMaxSnr = Math.max(lodResult.k * 1.5, ...snrVals.map((v) => Math.abs(v))) * 1.1;
        const useNumericX = intensityEntries.every((e) => Number.isFinite(e.numericValue ?? NaN));
        const xVals = useNumericX
          ? intensityEntries.map((e) => e.numericValue as number)
          : intensityEntries.map((_, i) => i);
        const xMin = Math.min(...xVals);
        const xMax = Math.max(...xVals, xMin + 1);
        const xScale = (v: number) =>
          PAD.l + ((v - xMin) / (xMax - xMin || 1)) * innerW;
        const ySnrScale = (v: number) =>
          PAD.t + innerH / 2 - (v / yMaxSnr) * (innerH / 2);
        const unit = intensityEntries.find((e) => e.unit)?.unit || '';
        return (
          <PlotCard
            title="SNR by entry"
            subtitle={`SNR = (signal − μ_baseline) / σ_baseline. Dashed line marks SNR = ${lodResult.k}; points above pass.`}
          >
            <svg
              viewBox={`0 0 ${W} ${H}`}
              data-lod-snr-chart
              style={{ width: '100%', height: H }}
            >
              {/* y=0 axis */}
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={ySnrScale(0)}
                y2={ySnrScale(0)}
                stroke={t.border}
              />
              {/* SNR=k threshold */}
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={ySnrScale(lodResult.k)}
                y2={ySnrScale(lodResult.k)}
                stroke="#e5a13a"
                strokeDasharray="6,3"
                strokeWidth={1.4}
              />
              <text
                x={W - PAD.r - 6}
                y={ySnrScale(lodResult.k) - 5}
                fontSize="10"
                fill="#e5a13a"
                textAnchor="end"
              >
                SNR = {lodResult.k}
              </text>
              {/* points */}
              {intensityEntries.map((e, i) => {
                const p = lodResult.perEntry.find((pp) => pp.entryId === e.id);
                if (!p || p.snr == null) return null;
                const cx = xScale(xVals[i]);
                const cy = ySnrScale(p.snr);
                const isLod = lodResult.lod?.entryId === e.id;
                return (
                  <g key={e.id}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={isLod ? 6 : 4}
                      fill={isLod ? '#e5a13a' : p.passes ? '#3ecbe5' : '#5d6773'}
                      stroke="#fff"
                      strokeWidth={1}
                    />
                    {(isLod || p.passes) && (
                      <text
                        x={cx + 6}
                        y={cy - 6}
                        fontSize="9"
                        fill={t.textMuted}
                      >
                        {e.label || `#${i + 1}`}
                      </text>
                    )}
                  </g>
                );
              })}
              <text
                x={PAD.l - 42}
                y={PAD.t + innerH / 2}
                fontSize="10.5"
                fill={t.textMuted}
                transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
              >
                SNR
              </text>
              <text
                x={W / 2}
                y={H - 6}
                fontSize="10.5"
                fill={t.textMuted}
                textAnchor="middle"
              >
                {useNumericX
                  ? `numeric value${unit ? ` (${unit})` : ''}`
                  : 'entry index'}
              </text>
            </svg>
          </PlotCard>
        );
      }
    }
    // Legacy Ratio-mode branches (entries.length === 0 means no Ratio
    // entries; the legacy "no entries" empty state still works when
    // both kinds are absent).
    if (entries.length === 0) {
      return (
        <div style={{ padding: 24, fontSize: 13, color: t.textMuted }}>
          No Ratio entries match the current channel filter. Use Inspector → LoD/Ratio Analysis
          (Ratio mode) to draw a Signal and a Background ROI on a frame, then click
          &ldquo;Add to table&rdquo;.
        </div>
      );
    }
    if (common.tab === 'overview') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {summary && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
              }}
            >
              <StatCard label="n entries" value={summary.n} />
              <StatCard
                label="mean TBR"
                value={fmt2(summary.mean)}
                hint={`±${fmt2(summary.sem)} SEM`}
                accent
              />
              <StatCard label="median TBR" value={fmt2(summary.median)} />
              <StatCard label="std" value={fmt2(summary.std)} />
              <StatCard
                label="CI 95% (mean)"
                value={`${fmt2(summary.ci95Lo)} – ${fmt2(summary.ci95Hi)}`}
              />
              <StatCard label="IQR" value={`${fmt2(summary.q1)} – ${fmt2(summary.q3)}`} />
              <StatCard label="min – max" value={`${fmt2(summary.min)} – ${fmt2(summary.max)}`} />
              <StatCard
                label="TBR > 1"
                value={`${(summary.fracBright * 100).toFixed(0)}%`}
                hint="fraction with contrast"
              />
            </div>
          )}
          <PlotCard
            title="TBR by entry"
            subtitle="Bars are ratio, error bars are propagated ratio std, dashed amber line marks TBR=1 (no contrast)."
          >
            <RatioBarChart />
          </PlotCard>
        </div>
      );
    }
    if (common.tab === 'tumorvbg') {
      return (
        <PlotCard
          title="Tumor vs Background intensity"
          subtitle="Side-by-side absolute intensities for each entry. Identical heights → no contrast."
        >
          <TumorVsBgChart />
        </PlotCard>
      );
    }
    if (common.tab === 'scatter') {
      return (
        <PlotCard
          title="Scatter — tumor vs background"
          subtitle="Points above the dashed amber y=x line have TBR > 1."
        >
          <ScatterChart />
        </PlotCard>
      );
    }
    if (common.tab === 'distribution') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlotCard
            title="Histogram of TBR ratios"
            subtitle="Sturges-style binning · solid line = mean · dashed amber = median."
          >
            <Histogram />
          </PlotCard>
          <PlotCard
            title="Box plot"
            subtitle="Q1 / median / Q3 + whiskers + jittered raw points + diamond mean."
          >
            <BoxPlot />
          </PlotCard>
        </div>
      );
    }
    if (common.tab === 'grouping') {
      const renderGroup = (
        title: string,
        rows: ReadonlyArray<{ key: string; n: number; mean: number; std: number }>
      ) => (
        <PlotCard
          title={title}
          subtitle="Mean ratio per group · bar width is normalised to the maximum group mean."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((g) => {
              const mx = Math.max(0.001, ...rows.map((x) => x.mean));
              const w = (g.mean / mx) * 100;
              return (
                <div key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'baseline',
                      fontFamily: 'ui-monospace,Menlo,monospace',
                      fontSize: 11.5,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        color: t.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={g.key}
                    >
                      {g.key}
                    </span>
                    <span style={{ color: t.textFaint }}>n={g.n}</span>
                    <span style={{ color: t.accent, fontWeight: 700, fontSize: 13 }}>
                      {fmt2(g.mean)}
                    </span>
                    <span style={{ color: t.textFaint }}>±{fmt2(g.std)}</span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      background: t.chipBg,
                      borderRadius: 3,
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ width: `${w}%`, height: '100%', background: t.accent }} />
                  </div>
                </div>
              );
            })}
          </div>
        </PlotCard>
      );
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {renderGroup('By file', byFile)}
          {renderGroup('By channel', byChannel)}
        </div>
      );
    }
    if (common.tab === 'table') {
      return (
        <PlotCard
          title="Per-entry detail"
          subtitle={`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} after filter.`}
        >
          <div
            style={{
              maxHeight: 480,
              overflowY: 'auto',
              fontFamily: 'ui-monospace,Menlo,monospace',
              fontSize: 11.5,
              border: `1px solid ${t.border}`,
              borderRadius: 4,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 2fr 0.6fr 0.6fr 0.6fr 1fr 1fr 1fr',
                gap: 6,
                padding: '6px 8px',
                background: t.chipBg,
                color: t.textMuted,
                fontWeight: 600,
                borderBottom: `1px solid ${t.border}`,
                position: 'sticky',
                top: 0,
              }}
            >
              <span>#</span>
              <span>file · channel</span>
              <span style={{ textAlign: 'right' }}>frame</span>
              <span style={{ textAlign: 'right' }}>n(T)</span>
              <span style={{ textAlign: 'right' }}>n(B)</span>
              <span style={{ textAlign: 'right' }}>tumor</span>
              <span style={{ textAlign: 'right' }}>bg</span>
              <span style={{ textAlign: 'right' }}>ratio</span>
            </div>
            {entries.map((e, i) => (
              <div
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 2fr 0.6fr 0.6fr 0.6fr 1fr 1fr 1fr',
                  gap: 6,
                  padding: '6px 8px',
                  color: t.text,
                  borderBottom: i === entries.length - 1 ? 'none' : `1px solid ${t.border}`,
                }}
              >
                <span style={{ color: t.textFaint }}>{i + 1}</span>
                <span
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  title={
                    (e.pipelineVersion ?? 1) < 2
                      ? `${e.sourceFile} · ${e.channel} (legacy pipeline — dark + black_level only)`
                      : `${e.sourceFile} · ${e.channel}`
                  }
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.sourceFile} · {e.channel}
                  </span>
                  {(e.pipelineVersion ?? 1) < 2 && (
                    <span
                      data-tbr-stale
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        color: '#f0a020',
                        border: '1px solid #f0a020',
                        borderRadius: 3,
                        padding: '0 4px',
                        flex: '0 0 auto',
                      }}
                    >
                      v1
                    </span>
                  )}
                </span>
                <span style={{ textAlign: 'right' }}>{e.frameIndex}</span>
                <span style={{ textAlign: 'right' }}>{e.tumorN}</span>
                <span style={{ textAlign: 'right' }}>{e.bgN}</span>
                <span style={{ textAlign: 'right' }}>
                  {fmtInt(e.tumorValue)}±{fmtInt(e.tumorStd)}
                </span>
                <span style={{ textAlign: 'right' }}>
                  {fmtInt(e.bgValue)}±{fmtInt(e.bgStd)}
                </span>
                <span style={{ textAlign: 'right', color: t.accent, fontWeight: 700 }}>
                  {fmt1(e.ratio)}±{fmt1(e.ratioStd)}
                </span>
              </div>
            ))}
          </div>
        </PlotCard>
      );
    }
    return null;
  }, [
    common.tab,
    entries,
    summary,
    byFile,
    byChannel,
    t,
    ratioMax,
    intensityMax,
    intensityEntries,
    baselineEntry,
    lodResult,
    PAD.t,
    PAD.l,
    PAD.r,
    PAD.b,
    innerH,
    innerW,
  ]);

  // ---- filter extras (k + sustained controls — Intensity-mode only) ----
  const filterExtras = useMemo<React.ReactNode>(() => {
    if (intensityEntries.length === 0) return null;
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        data-lod-filter-extras
      >
        <FilterLabel>k</FilterLabel>
        <Segmented
          value={kSigma}
          onChange={(v) => setKSigma(Number(v) as LodK)}
          options={[
            { value: 3, label: 'k=3' },
            { value: 6, label: 'k=6' },
            { value: 10, label: 'k=10' },
          ]}
        />
        <Checkbox
          checked={sustained}
          onChange={(v) => setSustained(!!v)}
          ariaLabel="Sustained criterion"
        />
        <span
          style={{ fontSize: 11, color: t.textMuted }}
          title="When ON, LoD is the lowest numeric value where all entries at-or-above also pass. When OFF, LoD is just the lowest passing entry."
        >
          sustained
        </span>
      </div>
    );
  }, [intensityEntries.length, kSigma, sustained, t.textMuted, setKSigma, setSustained]);

  // ---- exports ----
  const onExportCSV = useCallback(() => {
    // Export every visible entry (ratio + intensity + baseline) so
    // CSV consumers see the full dataset. Each row tags itself via
    // `kind` so downstream tooling can split. play-lod-ratio-tools-v1 M5e.
    if (visible.length === 0) {
      helpers.onToast('No entries to export', 'warn');
      return;
    }
    const rows = visible.map((e, i) => ({
      n: i + 1,
      kind: e.kind ?? 'ratio',
      analysis_mode: e.analysisMode ?? 'ratio',
      label: e.label ?? '',
      numeric_value: e.numericValue ?? '',
      unit: e.unit ?? '',
      order: e.order ?? i,
      file: e.sourceFile,
      frame: e.frameIndex,
      channel: e.channel,
      method: e.method,
      percentile: e.method === 'percentile' ? e.percentile : '',
      apply_dark: e.applyDark ? 1 : 0,
      black_level: e.blackLevel,
      signal_value: e.signalValue ?? e.tumorValue,
      signal_std: e.signalStd ?? e.tumorStd,
      signal_n: e.signalN ?? e.tumorN,
      bg_value: e.bgValue ?? '',
      bg_std: e.bgStd ?? '',
      bg_n: e.bgN ?? '',
      ratio: e.ratio ?? '',
      ratio_std: e.ratioStd ?? '',
      created_at: e.createdAt,
    }));
    exportCSV(`lod_ratio_${Date.now()}.csv`, rows);
  }, [visible, helpers]);

  const onExportJSON = useCallback(() => {
    if (visible.length === 0) {
      helpers.onToast('No entries to export', 'warn');
      return;
    }
    exportJSON(`lod_ratio_${Date.now()}.json`, {
      mode: 'lod_ratio',
      generated_at: new Date().toISOString(),
      ratio_summary: summary,
      ratio_by_file: byFile,
      ratio_by_channel: byChannel,
      lod: lodResult,
      baseline_entry: baselineEntry,
      entries: visible,
    });
  }, [visible, summary, byFile, byChannel, lodResult, baselineEntry, helpers]);

  // play-lod-ratio-tools-v1 M5 — countsText now reports both kinds
  // so the user sees at a glance how the table splits. Subtitle
  // shows the LoD when an Intensity dataset is present, falling back
  // to the legacy Ratio summary otherwise.
  const countsText = (() => {
    const parts: string[] = [];
    if (entries.length > 0) parts.push(`${entries.length} ratio`);
    if (intensityEntries.length > 0) parts.push(`${intensityEntries.length} intensity`);
    if (baselineEntry) parts.push('1 baseline');
    if (parts.length === 0) parts.push('0 entries');
    return `LoD/Ratio · ${parts.join(' · ')} (of ${allEntries.length} total)`;
  })();
  const subtitleText = (() => {
    if (intensityEntries.length > 0 && lodResult.threshold != null) {
      const lodTxt = lodResult.lod
        ? `LoD = ${fmt2(lodResult.lod.numericValue)}${
            intensityEntries.find((e) => e.unit)?.unit
              ? ' ' + intensityEntries.find((e) => e.unit)?.unit
              : ''
          }`
        : 'no LoD found';
      return `${lodTxt} · k=${lodResult.k}${
        lodResult.sustained ? ' · sustained' : ''
      } · ${lodResult.perEntry.filter((p) => p.passes).length}/${
        lodResult.perEntry.length
      } pass`;
    }
    return summary
      ? `mean ${fmt2(summary.mean)} · median ${fmt2(summary.median)} · n=${summary.n}`
      : 'no entries';
  })();

  return {
    filterExtras,
    countsText,
    subtitleText,
    renderTab,
    onExportCSV,
    onExportJSON,
  };
};

// play-lod-ratio-tools-v1 M2 — was `tbrSpec`. Renamed to
// `lodRatioSpec` along with the analysis-mode id `'tbr'` →
// `'lod_ratio'`. M5 added three Intensity-mode tabs at the front:
// LoD Summary (KPI cards), Intensity (per-entry bar with threshold
// reference line), SNR (scatter with k-line). The legacy Ratio
// tabs follow; both groups render an empty-state when no entries
// of their kind are present.
export const lodRatioSpec: ModeSpec = {
  id: 'lod_ratio',
  defaultTab: 'lod_summary',
  tabs: [
    { key: 'lod_summary', label: 'LoD Summary' },
    { key: 'lod_intensity', label: 'Intensity' },
    { key: 'lod_snr', label: 'SNR' },
    { key: 'overview', label: 'Ratio Overview' },
    { key: 'tumorvbg', label: 'Signal vs Background' },
    { key: 'scatter', label: 'Scatter' },
    { key: 'distribution', label: 'Distribution' },
    { key: 'grouping', label: 'By file / channel' },
    { key: 'table', label: 'Table' },
  ],
  pngFilename: (tab) => `lod_ratio_${tab || 'overview'}_${Date.now()}.png`,
  useModeView: useTbrModeView,
};

export default lodRatioSpec;
