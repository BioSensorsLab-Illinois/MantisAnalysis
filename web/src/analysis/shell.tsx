// analysis-page-overhaul-v1 — unified <AnalysisShell>.
// Type-clean. Replaces the three near-duplicate modal functions retired
// in Phase 8 final. The only mount path post-cutover; mounted from
// `app.tsx` with `key={run.mode}` so per-mode hook compositions stay
// stable across mode swaps (Rules of Hooks).
//
// Owns: modal chrome (backdrop + panel + header), filter-bar shared
// chunks (channels + gain + BgColorPicker), tab rail, tab body w/
// ref + bg-color logic, PNG/CSV/JSON export wiring, PlotStyleCtx
// provider root, Esc-to-close listener.
//
// Per-mode state + tab dispatch + filter extras + counts/subtitle
// + CSV/JSON shape lives inside each ModeSpec.useModeView hook.
//
// PNG export goes through `renderChartToPng` (Phase 1 primitive),
// not `mantisExport` (Phase 5 collapsed both paths onto one pipeline).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as _shared from '../shared.tsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const useTheme: () => Theme = _s.useTheme;
const Icon = _s.Icon as React.ComponentType<{ name: string; size?: number }>;
const Button = _s.Button as React.ComponentType<{
  size?: 'xs' | 'sm' | 'md';
  variant?: 'primary' | 'subtle' | 'danger';
  icon?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  children?: React.ReactNode;
}>;
const PlotStylePanel = _s.PlotStylePanel as React.ComponentType<{
  open: boolean;
  onToggle: () => void;
}>;
const PlotStyleCtx = _s.PlotStyleCtx as React.Context<PlotStyleState | null>;
const usePlotStyleState = _s.usePlotStyleState as () => PlotStyleState;
const useLocalStorageState = _s.useLocalStorageState as <T>(
  key: string,
  initial: T
) => [T, (next: T | ((prev: T) => T)) => void];
const renderChartToPng = _s.renderChartToPng as (
  node: Element | null,
  opts?: {
    filename?: string;
    style?: PlotStyle;
    themeFallbackBg?: string;
  }
) => Promise<{ format: 'png' | 'svg'; scale: number } | undefined>;

interface Theme {
  panel: string;
  panelAlt: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentSoft: string;
  shadowLg: string;
  warn: string;
  [key: string]: string;
}

interface PlotStyle {
  fontFamily: string;
  exportScale?: number;
  exportFormat?: 'png' | 'svg';
  exportBackground?: string;
  [key: string]: unknown;
}

interface PlotStyleState {
  style: PlotStyle;
  setStyle: (patch: Partial<PlotStyle> | ((prev: PlotStyle) => Partial<PlotStyle>)) => void;
  resetStyle: () => void;
}

import { BgColorPicker, ChannelFilterRow, GainFilterRow, tabBodyBgStyle } from './filterbar';
import { MODE_REGISTRY } from './registry';
import type { AnalysisShellProps, FilterCommonState, GainFilter } from './types';

export const AnalysisShell: React.FC<AnalysisShellProps> = ({ run, onClose, onToast }) => {
  const t = useTheme();
  const plotStyleState = usePlotStyleState();
  const [styleOpen, setStyleOpen] = useState<boolean>(false);

  const spec = MODE_REGISTRY[run.mode];

  const allChannels = useMemo<readonly string[]>(
    () => (run.response?.channels as readonly string[] | undefined) || [],
    [run.response]
  );

  const [chans, setChansRaw] = useState<readonly string[]>(allChannels);
  const setChans: FilterCommonState['setChans'] = useCallback((next) => {
    setChansRaw((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);
  const [gainFilter, setGainFilter] = useState<GainFilter>('all');
  const [bgColor, setBgColor] = useLocalStorageState<string | null>('analysis/bgColor', null);
  const [tab, setTab] = useState<string>(spec?.defaultTab ?? '');
  const effectiveBg = bgColor || t.panelAlt;

  const visibleChannels = useMemo<readonly string[]>(() => {
    const base = chans.filter((c) => allChannels.includes(c));
    if (gainFilter === 'all') return base;
    return base.filter((c) => c.startsWith(gainFilter + '-'));
  }, [chans, gainFilter, allChannels]);

  const common: FilterCommonState = useMemo(
    () => ({
      chans,
      setChans,
      gainFilter,
      setGainFilter,
      bgColor,
      setBgColor,
      tab,
      setTab,
      visibleChannels,
      allChannels,
    }),
    [chans, setChans, gainFilter, bgColor, setBgColor, tab, visibleChannels, allChannels]
  );

  // Mode hook MUST be called unconditionally (Rules of Hooks).
  // If `spec` is missing (unknown mode), fall back to a no-op view.
  const view = spec ? spec.useModeView(run, common, { onToast }) : NULL_VIEW;

  // Esc-to-close — the "(Esc)" hint on the close button stops being a lie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabBodyRef = useRef<HTMLDivElement | null>(null);
  const exportPNG = useCallback(async () => {
    const node = tabBodyRef.current;
    if (!node) {
      onToast('Export unavailable', 'danger');
      return;
    }
    if (!spec) return;
    try {
      onToast('Rendering…');
      const filename = spec.pngFilename(tab);
      const res = await renderChartToPng(node, {
        filename,
        style: plotStyleState.style,
        themeFallbackBg: effectiveBg,
      });
      const fmt = (res?.format ?? 'png').toUpperCase();
      const scale = plotStyleState.style.exportScale ?? 2;
      onToast(`Exported ${tab} as ${fmt} (${scale}×)`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onToast(`Export failed: ${msg}`, 'danger');
    }
  }, [tab, effectiveBg, onToast, plotStyleState.style, spec]);

  if (!run) return null;
  if (!spec) {
    // Unknown mode — render nothing rather than crash. Phase 8 deletes
    // the LegacyPngModal fallback in analysis.tsx; until then, the
    // dispatch in `analysis.tsx::AnalysisModal` covers the case.
    return null;
  }

  return (
    <PlotStyleCtx.Provider value={plotStyleState}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${run.mode.toUpperCase()} analysis results`}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(10,12,18,0.62)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 80,
          padding: 24,
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 1500,
            height: '94vh',
            background: t.panel,
            border: `1px solid ${t.border}`,
            borderRadius: 10,
            boxShadow: t.shadowLg,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: plotStyleState.style.fontFamily,
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 18px',
              borderBottom: `1px solid ${t.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background: t.accentSoft,
                color: t.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="run" size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: t.text }}>
                {view.countsText}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  marginTop: 1,
                }}
              >
                {view.subtitleText}
              </div>
            </div>
            <PlotStylePanel open={false} onToggle={() => setStyleOpen((s) => !s)} />
            <Button icon="image" onClick={exportPNG} title="Capture the active tab as a PNG image">
              PNG
            </Button>
            <Button icon="download" onClick={view.onExportCSV} title="Flat per-row CSV">
              CSV
            </Button>
            <Button
              icon="download"
              onClick={view.onExportJSON}
              title="Round-trippable raw analysis JSON"
            >
              JSON
            </Button>
            <Button variant="subtle" icon="close" onClick={onClose} size="sm" title="Close (Esc)" />
          </div>
          {styleOpen && <PlotStylePanel open={true} onToggle={() => setStyleOpen(false)} />}

          {/* Filter bar */}
          <div
            style={{
              padding: '10px 18px',
              borderBottom: `1px solid ${t.border}`,
              background: t.panelAlt,
              display: 'flex',
              gap: 14,
              alignItems: 'center',
              flexWrap: 'wrap',
              flexShrink: 0,
            }}
          >
            <ChannelFilterRow
              allChannels={allChannels}
              selected={chans}
              onChange={(next) => setChans(next)}
            />
            <GainFilterRow allChannels={allChannels} value={gainFilter} onChange={setGainFilter} />
            {view.filterExtras}
            <BgColorPicker bgColor={bgColor} setBgColor={setBgColor} />
          </div>

          {/* Tab rail */}
          <div
            role="tablist"
            aria-label={`${run.mode.toUpperCase()} analysis tabs`}
            style={{
              display: 'flex',
              borderBottom: `1px solid ${t.border}`,
              background: t.panelAlt,
              padding: '0 8px',
              gap: 2,
              overflowX: 'auto',
              flexShrink: 0,
            }}
          >
            {spec.tabs.map((x) => (
              <button
                key={x.key}
                role="tab"
                aria-selected={tab === x.key}
                onClick={() => setTab(x.key)}
                style={{
                  padding: '10px 14px',
                  fontSize: 12.5,
                  fontWeight: tab === x.key ? 600 : 450,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: tab === x.key ? t.accent : t.textMuted,
                  borderBottom: `2px solid ${tab === x.key ? t.accent : 'transparent'}`,
                  marginBottom: -1,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {x.label}
              </button>
            ))}
          </div>

          {/* Tab body */}
          <div
            ref={tabBodyRef}
            role="tabpanel"
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              padding: 16,
              ...tabBodyBgStyle(bgColor, effectiveBg),
            }}
          >
            {view.renderTab()}
          </div>
        </div>
      </div>
    </PlotStyleCtx.Provider>
  );
};

const NULL_VIEW = {
  filterExtras: null,
  countsText: 'Unknown analysis mode',
  subtitleText: '',
  renderTab: () => null,
  onExportCSV: () => undefined,
  onExportJSON: () => undefined,
} as const;

export default AnalysisShell;
