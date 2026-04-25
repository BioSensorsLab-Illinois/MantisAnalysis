// @ts-nocheck
// bundler-migration-v1 Phase 5b finish (2026-04-24): mass-migrated .jsx
// → .tsx. Body kept as-is under @ts-nocheck so a 23 K-line, 85-export
// tree can move to TypeScript in one commit without per-file rewrite.
// Remove @ts-nocheck per file in follow-up sessions to incrementally
// type primitives + components. tsc still parses and bundles the file;
// only the strict type-checking is muted.
// Analysis results modal — native vector charts + HTML tables only.
// Big charts use Plotly.js (interactive, hover, SVG-export). Many-small
// charts (per-line profile cards, per-group mini-MTFs, G×E heatmap cells)
// use inline SVG so we don't pay Plotly's per-instance cost dozens of
// times per tab. No rasterized PNG plots anywhere.

// bundler-migration-v1 Phase 3: ES-module native.
import React from 'react';
import Plotly from 'plotly.js-dist-min';
import domtoimage from 'dom-to-image-more';
import {
  useTheme,
  Icon,
  _Row,
  Button,
  ChannelChip,
  Segmented,
  Tip,
  useLocalStorageState,
  exportJSON,
  exportCSV,
  apiFetch,
  ExportLayoutPicker,
  gridStyleFor,
  PlotStyleCtx,
  usePlotStyle,
  usePlotStyleState,
  scaled,
  PlotStylePanel,
  HeatmapCanvas,
  HeatmapColorBar,
  decodeFloat32Grid,
  channelColor,
  paletteColor,
  Chart,
} from './shared.tsx';

const {
  useState: useStateA,
  useEffect: useEffectA,
  useMemo: useMemoA,
  useRef: useRefA,
  useCallback: useCallbackA,
} = React;

// ---------------------------------------------------------------------------
// Shared grid-tab frame + layout picker
//
// Most analysis-modal tabs render N per-(channel × ROI) / per-line /
// per-group cards. Before hitting "Export PNG" the user usually wants a
// specific layout (1×N landscape strip, 2×N for slides, auto for screen).
// `GridTabFrame` provides the surrounding header + the ExportLayoutPicker
// and sets `gridTemplateColumns` via `gridStyleFor(layout, n)`.
// Caller passes an optional caption (rendered on the left) and children
// (the grid cells, typically an Array of React nodes).
// ---------------------------------------------------------------------------
const GridTabFrame = ({
  caption,
  n,
  children,
  minCardPx = 380,
  extraControls,
  storageKey = 'analysis/defaultLayout',
}) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const [layout, setLayout] = useLocalStorageState(storageKey, 'auto');
  return (
    <div>
      <div
        data-no-export
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 10,
          fontSize: 11,
          color: t.textMuted,
          flexWrap: 'wrap',
        }}
      >
        {caption && <span>{caption}</span>}
        {extraControls}
        <span style={{ flex: 1 }} />
        <ExportLayoutPicker value={layout} onChange={setLayout} n={n} />
      </div>
      {/* Grid gap + `gridStyleFor` layout both come from plotStyle so the
          Publication preset's tight grid actually tightens the layout in
          real time, and the user's manual Gap slider is respected. */}
      <div
        style={{
          display: 'grid',
          ...gridStyleFor(layout, n, minCardPx, style.gridGap, style.cardMaxWidth),
        }}
      >
        {children}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Plotly wrapper
// ---------------------------------------------------------------------------
const plotlyReady = () =>
  typeof Plotly !== 'undefined' && Plotly && typeof Plotly.newPlot === 'function';

const PlotlyChart = ({ data, layout, config, style }) => {
  const ref = useRefA(null);
  const t = useTheme();
  useEffectA(() => {
    if (!ref.current || !plotlyReady()) return;
    const merged = {
      paper_bgcolor: t.panel,
      plot_bgcolor: t.panelAlt,
      font: {
        family: 'Inter Tight, -apple-system, system-ui, sans-serif',
        size: 12,
        color: t.text,
      },
      margin: { l: 60, r: 16, t: 28, b: 50 },
      autosize: true,
      ...layout,
      xaxis: {
        gridcolor: t.border,
        zerolinecolor: t.border,
        linecolor: t.borderStrong,
        tickcolor: t.textMuted,
        ...(layout?.xaxis || {}),
      },
      yaxis: {
        gridcolor: t.border,
        zerolinecolor: t.border,
        linecolor: t.borderStrong,
        tickcolor: t.textMuted,
        ...(layout?.yaxis || {}),
      },
      legend: { bgcolor: 'rgba(0,0,0,0)', font: { color: t.text }, ...(layout?.legend || {}) },
    };
    const mergedConfig = {
      responsive: true,
      displaylogo: false,
      toImageButtonOptions: { format: 'svg', filename: 'mantis_chart', scale: 2 },
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      ...config,
    };
    Plotly.newPlot(ref.current, data, merged, mergedConfig);
    return () => {
      try {
        Plotly.purge(ref.current);
      } catch {
        /* noop */
      }
    };
  }, [data, layout, config, t.text, t.panel, t.panelAlt, t.border]);
  return <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 280, ...style }} />;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// `channelColor` and `paletteColor` are imported from shared.jsx — single
// source of truth post bundler-migration-v1 Phase 3. The shared versions
// are functionally identical to the previous local copies (same band
// resolution, same `_BAND_IDX_FOR_PALETTE` table {R,G,B,NIR,Y,L}).

const lpmmFor = (g, e) => Math.pow(2, g + (e - 1) / 6);

// Sample a matplotlib-style colormap as an array of CSS colors. We do this in
// JS (rather than calling the server per cell) so the heatmap recolors
// instantly when the user switches palettes.
const COLOR_MAPS = {
  jet: [
    [0, '#00007f'],
    [0.125, '#0000ff'],
    [0.375, '#00ffff'],
    [0.625, '#ffff00'],
    [0.875, '#ff0000'],
    [1, '#7f0000'],
  ],
  turbo: [
    [0, '#30123b'],
    [0.15, '#4145ab'],
    [0.3, '#26bce1'],
    [0.5, '#a6f54b'],
    [0.7, '#fdbb2a'],
    [0.85, '#f56b14'],
    [1, '#7a0403'],
  ],
  viridis: [
    [0, '#440154'],
    [0.25, '#3b528b'],
    [0.5, '#21918c'],
    [0.75, '#5ec962'],
    [1, '#fde725'],
  ],
  magma: [
    [0, '#000004'],
    [0.25, '#3b0f70'],
    [0.5, '#8c2981'],
    [0.75, '#de4968'],
    [1, '#fcfdbf'],
  ],
  inferno: [
    [0, '#000004'],
    [0.25, '#420a68'],
    [0.5, '#932667'],
    [0.75, '#dd513a'],
    [1, '#fcffa4'],
  ],
  plasma: [
    [0, '#0d0887'],
    [0.25, '#6a00a8'],
    [0.5, '#b12a90'],
    [0.75, '#e16462'],
    [1, '#fca636'],
  ],
  cividis: [
    [0, '#00204c'],
    [0.25, '#414d6b'],
    [0.5, '#7d7c78'],
    [0.75, '#c5b471'],
    [1, '#fde737'],
  ],
  hot: [
    [0, '#000000'],
    [0.33, '#ff0000'],
    [0.66, '#ffff00'],
    [1, '#ffffff'],
  ],
  cool: [
    [0, '#00ffff'],
    [1, '#ff00ff'],
  ],
  gray: [
    [0, '#000000'],
    [1, '#ffffff'],
  ],
};
const sampleCmap = (name, t) => {
  const stops = COLOR_MAPS[name] || COLOR_MAPS.jet;
  const u = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [u0, c0] = stops[i],
      [u1, c1] = stops[i + 1];
    if (u <= u1) {
      const k = (u - u0) / Math.max(1e-9, u1 - u0);
      const lerp = (a, b) => Math.round(a + (b - a) * k);
      const hex = (s) => [
        parseInt(s.slice(1, 3), 16),
        parseInt(s.slice(3, 5), 16),
        parseInt(s.slice(5, 7), 16),
      ];
      const [r0, g0, b0] = hex(c0),
        [r1, g1, b1] = hex(c1);
      const r = lerp(r0, r1),
        g = lerp(g0, g1),
        b = lerp(b0, b1);
      return `rgb(${r},${g},${b})`;
    }
  }
  return stops[stops.length - 1][1];
};

const measurementToRow = (ch, spec, m) => {
  if (!m) return null;
  const meanArr = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
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

// ---------------------------------------------------------------------------
// BgColorPicker — small inline picker used inside the analysis modal's
// filter bar. Lets the user choose the tab-body background AND the PNG
// export background in one stroke, so what they see is what they export.
//
//   `null`             → match theme (panelAlt)
//   '#ffffff'/'#000000'→ literal hex
//   'transparent'      → no fill (PNG keeps alpha; live view shows checker)
//   any custom hex     → via the native <input type="color">
//
// Persisted via the caller's setBgColor (typically useLocalStorageState),
// so the choice carries across sessions without per-modal re-config.
// ---------------------------------------------------------------------------
const BgColorPicker = ({ bgColor, setBgColor }) => {
  const t = useTheme();
  const presets = [
    { id: null, label: 'Theme', swatch: t.panelAlt, title: 'Match the current app theme' },
    {
      id: '#ffffff',
      label: 'White',
      swatch: '#ffffff',
      title: 'Solid white — best for journals/print',
    },
    {
      id: '#000000',
      label: 'Black',
      swatch: '#000000',
      title: 'Solid black — best for dark-themed slides',
    },
    {
      id: 'transparent',
      label: 'Clear',
      swatch: 'transparent',
      title: 'Transparent — exports a PNG with alpha',
    },
  ];
  // Custom hex — only shown as the active swatch when a non-preset is set.
  const isCustom = bgColor && !presets.some((p) => p.id === bgColor);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: t.textMuted,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        Background
      </span>
      {presets.map((p) => {
        const active = bgColor === p.id;
        return (
          <button
            key={String(p.id)}
            onClick={() => setBgColor(p.id)}
            title={p.title}
            style={{
              width: 22,
              height: 22,
              padding: 0,
              border: `2px solid ${active ? t.accent : t.border}`,
              borderRadius: 4,
              cursor: 'pointer',
              background:
                p.id === 'transparent'
                  ? 'linear-gradient(45deg, #d8dbe0 25%, #ffffff 25% 50%, #d8dbe0 50% 75%, #ffffff 75%) 0/8px 8px'
                  : p.swatch,
            }}
          />
        );
      })}
      <Tip title="Custom — pick any hex color">
        <input
          type="color"
          value={isCustom ? bgColor : bgColor || '#ffffff'}
          onChange={(e) => setBgColor(e.target.value)}
          style={{
            width: 24,
            height: 24,
            padding: 0,
            border: `2px solid ${isCustom ? t.accent : t.border}`,
            borderRadius: 4,
            cursor: 'pointer',
            background: 'transparent',
          }}
        />
      </Tip>
    </span>
  );
};

// ---------------------------------------------------------------------------
// Root modal
// ---------------------------------------------------------------------------
const AnalysisModal = ({ run, onClose, onToast }) => {
  if (!run) return null;
  if (run.mode === 'usaf')
    return <USAFAnalysisModal run={run} onClose={onClose} onToast={onToast} />;
  if (run.mode === 'fpn') return <FPNAnalysisModal run={run} onClose={onClose} onToast={onToast} />;
  if (run.mode === 'dof') return <DoFAnalysisModal run={run} onClose={onClose} onToast={onToast} />;
  return <LegacyPngModal run={run} onClose={onClose} onToast={onToast} />;
};

// ---------------------------------------------------------------------------
// USAF analysis — six tabs
// ---------------------------------------------------------------------------
const USAFAnalysisModal = ({ run, onClose, onToast }) => {
  const t = useTheme();
  const plotStyleState = usePlotStyleState();
  const [styleOpen, setStyleOpen] = useStateA(false);
  const { response = {} } = run;
  const allChannels = response.channels || [];
  const allSpecs = response.specs || [];
  const measurements = response.measurements || {};
  const _thumbnails = response.channel_thumbnails || {};
  const perChLim = response.per_channel_detection_limit || {};
  const serverThreshold = Number(response.threshold ?? 0.3);

  // Filter state.
  const [chans, setChans] = useStateA(allChannels);
  const [gainFilter, setGainFilter] = useStateA('all'); // all | HG | LG
  const [dirFilter, setDirFilter] = useStateA('all'); // all | H | V
  const [threshold, setThreshold] = useStateA(serverThreshold);
  const [tab, setTab] = useStateA('mtf');
  // User-pickable background color for the tab body — chosen so the
  // exported PNG matches the publication / screenshot context. `null`
  // means "use theme default" (panelAlt). Persisted across sessions so
  // the user only sets it once for their workflow.
  const [bgColor, setBgColor] = useLocalStorageState('analysis/bgColor', null);
  const effectiveBg = bgColor || t.panelAlt;

  const visibleChannels = useMemoA(() => {
    const base = chans.filter((c) => allChannels.includes(c));
    if (gainFilter === 'all') return base;
    return base.filter((c) => c.startsWith(gainFilter + '-'));
  }, [chans, gainFilter, allChannels]);

  const keptIdx = useMemoA(
    () =>
      allSpecs
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => dirFilter === 'all' || s.direction === dirFilter)
        .map(({ i }) => i),
    [allSpecs, dirFilter]
  );

  const tabs = [
    { key: 'mtf', label: 'MTF curves' },
    { key: 'profiles', label: 'Profile gallery' },
    { key: 'table', label: 'Summary table' },
    { key: 'heatmap', label: 'Detection heatmap' },
    { key: 'group', label: 'Group sweep' },
    { key: 'fft', label: 'FFT / MTF' },
  ];

  const exportCSVRows = useCallbackA(() => {
    const rows = [];
    for (const ch of visibleChannels) {
      for (const i of keptIdx) {
        const r = measurementToRow(ch, allSpecs[i], measurements[ch]?.[i]);
        if (r) rows.push(r);
      }
    }
    if (!rows.length) {
      onToast?.('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-usaf-${Date.now()}.csv`, rows);
    onToast?.(`Exported ${rows.length} rows to CSV`, 'success');
  }, [visibleChannels, keptIdx, measurements, allSpecs, onToast]);

  const exportJSONRaw = useCallbackA(() => {
    exportJSON(`mantis-usaf-${Date.now()}.json`, {
      kind: 'mantis-usaf-analysis',
      version: 2,
      exportedAt: new Date().toISOString(),
      channels: visibleChannels,
      specs: keptIdx.map((i) => allSpecs[i]),
      threshold,
      measurements: Object.fromEntries(
        visibleChannels.map((ch) => [ch, keptIdx.map((i) => measurements[ch]?.[i] ?? null)])
      ),
      per_channel_detection_limit: Object.fromEntries(
        visibleChannels.map((ch) => [ch, perChLim[ch] ?? null])
      ),
    });
    onToast?.('Exported analysis JSON', 'success');
  }, [visibleChannels, keptIdx, measurements, allSpecs, threshold, perChLim, onToast]);

  // USAF tab export — delegates to the shared mantisExport so per-card
  // PNG buttons and the top-bar PNG button behave identically.
  const tabBodyRef = useRefA(null);
  const exportPNG = useCallbackA(async () => {
    const node = tabBodyRef.current;
    if (!node) {
      onToast?.('Export unavailable', 'danger');
      return;
    }
    try {
      onToast?.('Rendering…');
      const res = await mantisExport(
        node,
        `mantis-${tab}-${Date.now()}`,
        plotStyleState.style,
        effectiveBg
      );
      onToast?.(`Exported ${tab} as ${res.format.toUpperCase()} (${res.scale}×)`, 'success');
    } catch (err) {
      onToast?.(`Export failed: ${err.message || err}`, 'danger');
    }
  }, [tab, effectiveBg, onToast, plotStyleState.style]);

  return (
    <PlotStyleCtx.Provider value={plotStyleState}>
      <div
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
                USAF analysis — {keptIdx.length} line{keptIdx.length !== 1 ? 's' : ''} ×{' '}
                {visibleChannels.length} channel{visibleChannels.length !== 1 ? 's' : ''}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  marginTop: 1,
                }}
              >
                server detection limit @ {(serverThreshold * 100).toFixed(0)}% ·{' '}
                {Object.entries(perChLim)
                  .map(([c, v]) => `${c}: ${v != null ? v.toFixed(2) + ' lp/mm' : '—'}`)
                  .join('  ·  ')}
              </div>
            </div>
            <PlotStylePanel open={false} onToggle={() => setStyleOpen((s) => !s)} />
            <Button icon="image" onClick={exportPNG} title="Capture the active tab as a PNG image">
              PNG
            </Button>
            <Button icon="download" onClick={exportCSVRows} title="Flat per-(channel × line) CSV">
              CSV
            </Button>
            <Button
              icon="download"
              onClick={exportJSONRaw}
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
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Channels
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allChannels.map((c) => (
                <ChannelChip
                  key={c}
                  id={c.includes('-') ? c : `HG-${c}`}
                  multi
                  selected={chans.includes(c)}
                  onToggle={() =>
                    setChans((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                    )
                  }
                  size="sm"
                />
              ))}
              <Button size="xs" onClick={() => setChans(allChannels)}>
                All
              </Button>
              <Button size="xs" onClick={() => setChans([])}>
                None
              </Button>
            </div>
            {allChannels.some((c) => c.startsWith('HG-')) && (
              <>
                <span
                  style={{
                    fontSize: 10,
                    color: t.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginLeft: 6,
                  }}
                >
                  Gain
                </span>
                <Segmented
                  value={gainFilter}
                  onChange={setGainFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'HG', label: 'HG' },
                    { value: 'LG', label: 'LG' },
                  ]}
                />
              </>
            )}
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Direction
            </span>
            <Segmented
              value={dirFilter}
              onChange={setDirFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'H', label: 'H' },
                { value: 'V', label: 'V' },
              ]}
            />
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Threshold
            </span>
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.01}
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              style={{ width: 160 }}
              className="rgbnir-slider"
            />
            <span
              style={{
                fontSize: 11,
                color: t.text,
                fontFamily: 'ui-monospace,Menlo,monospace',
                minWidth: 42,
              }}
            >
              {(threshold * 100).toFixed(0)}%
            </span>
            <BgColorPicker bgColor={bgColor} setBgColor={setBgColor} />
          </div>

          {/* Tab bar */}
          <div
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
            {tabs.map((x) => (
              <button
                key={x.key}
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

          {/* Tab body — wrapped in a ref'd container so Export PNG can target it. */}
          <div
            ref={tabBodyRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              padding: 16,
              background: bgColor === 'transparent' ? 'transparent' : effectiveBg,
              backgroundImage:
                bgColor === 'transparent'
                  ? 'linear-gradient(45deg, #d8dbe0 25%, transparent 25%), linear-gradient(-45deg, #d8dbe0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8dbe0 75%), linear-gradient(-45deg, transparent 75%, #d8dbe0 75%)'
                  : undefined,
              backgroundSize: bgColor === 'transparent' ? '16px 16px' : undefined,
              backgroundPosition:
                bgColor === 'transparent' ? '0 0, 0 8px, 8px -8px, -8px 0px' : undefined,
            }}
          >
            {tab === 'mtf' && (
              <MTFCurvesTab
                channels={visibleChannels}
                specs={allSpecs}
                keptIdx={keptIdx}
                measurements={measurements}
                threshold={threshold}
                perChLim={perChLim}
              />
            )}
            {tab === 'profiles' && (
              <ProfileGalleryTab
                channels={visibleChannels}
                specs={allSpecs}
                keptIdx={keptIdx}
                measurements={measurements}
                threshold={threshold}
              />
            )}
            {tab === 'table' && (
              <SummaryTableTab
                channels={visibleChannels}
                specs={allSpecs}
                keptIdx={keptIdx}
                measurements={measurements}
                threshold={threshold}
              />
            )}
            {tab === 'heatmap' && (
              <DetectionHeatmapTab
                channels={visibleChannels}
                specs={allSpecs}
                measurements={measurements}
                threshold={threshold}
                dirFilter={dirFilter}
              />
            )}
            {tab === 'group' && (
              <GroupSweepTab
                channels={visibleChannels}
                specs={allSpecs}
                keptIdx={keptIdx}
                measurements={measurements}
                threshold={threshold}
              />
            )}
            {tab === 'fft' && (
              <FFTMTFTab
                channels={visibleChannels}
                specs={allSpecs}
                keptIdx={keptIdx}
                measurements={measurements}
                threshold={threshold}
              />
            )}
          </div>
        </div>
      </div>
    </PlotStyleCtx.Provider>
  );
};

// ===========================================================================
// 1. MTF curves — per-channel subplot grid + style toolbar
// ===========================================================================
// User-selectable visual style. Each option configures both stroke and marker
// rendering on the small per-channel SVG charts. `lines+markers` is the
// default — most informative for sparse measurement points.
const MTF_STYLES = {
  'lines+markers': { line: true, marker: true, desc: 'Lines + markers' },
  lines: { line: true, marker: false, desc: 'Lines only' },
  markers: { line: false, marker: true, desc: 'Markers only (scatter)' },
  stairs: { line: true, marker: true, desc: 'Stair-step', stairs: true },
};
const MTF_DASHES = {
  solid: '',
  dashed: '6 4',
  dotted: '2 3',
  dashdot: '6 3 2 3',
};
// Marker shape — independent per direction. Pick distinct shapes for H
// and V so the two series stay legible even when they overlap.
const MTF_MARKERS = {
  circle: 'circle ●',
  square: 'square ■',
  triangle: 'triangle ▲',
  diamond: 'diamond ◆',
  cross: 'cross ✕',
  plus: 'plus ✚',
};

const MTFCurvesTab = ({ channels, specs, keptIdx, measurements, threshold, perChLim }) => {
  const t = useTheme();
  const [style, setStyle] = useStateA('lines+markers');
  // H and V get independent stroke + marker pickers so a chart with both
  // series stays unambiguous (color = channel; shape/dash = direction).
  const [dashH, setDashH] = useStateA('solid');
  const [dashV, setDashV] = useStateA('dashed');
  const [markerH, setMarkerH] = useStateA('circle');
  const [markerV, setMarkerV] = useStateA('square');
  const [logX, setLogX] = useStateA(true);
  const [mtfLayout, setMtfLayout] = useLocalStorageState('analysis/usaf/mtfLayout', 'auto');

  // Compute shared x-range across all channels so the small charts visually compare.
  const xRange = useMemoA(() => {
    const lps = [];
    for (const ch of channels)
      for (const i of keptIdx) {
        const m = measurements[ch]?.[i];
        if (m?.lp_mm) lps.push(m.lp_mm);
      }
    if (!lps.length) return [0.5, 50];
    return [Math.max(0.5, Math.min(...lps) / 1.6), Math.max(...lps) * 1.8];
  }, [channels, keptIdx, measurements]);

  if (!channels.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No channels match the current filter.
      </div>
    );
  }
  return (
    <div>
      {/* Per-tab toolbar — marked [data-no-export] so the PNG capture skips it. */}
      <div
        data-no-export
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          padding: '8px 10px',
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Style
        </span>
        <Segmented
          value={style}
          onChange={setStyle}
          options={Object.keys(MTF_STYLES).map((k) => ({ value: k, label: MTF_STYLES[k].desc }))}
        />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginLeft: 6,
          }}
        >
          H stroke
        </span>
        <Segmented
          value={dashH}
          onChange={setDashH}
          options={Object.keys(MTF_DASHES).map((k) => ({ value: k, label: k }))}
        />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginLeft: 6,
          }}
        >
          V stroke
        </span>
        <Segmented
          value={dashV}
          onChange={setDashV}
          options={Object.keys(MTF_DASHES).map((k) => ({ value: k, label: k }))}
        />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginLeft: 6,
          }}
        >
          H marker
        </span>
        <Segmented
          value={markerH}
          onChange={setMarkerH}
          options={Object.keys(MTF_MARKERS).map((k) => ({
            value: k,
            label: MTF_MARKERS[k].split(' ')[0],
          }))}
        />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginLeft: 6,
          }}
        >
          V marker
        </span>
        <Segmented
          value={markerV}
          onChange={setMarkerV}
          options={Object.keys(MTF_MARKERS).map((k) => ({
            value: k,
            label: MTF_MARKERS[k].split(' ')[0],
          }))}
        />
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginLeft: 6,
          }}
        >
          X-axis
        </span>
        <Segmented
          value={logX ? 'log' : 'lin'}
          onChange={(v) => setLogX(v === 'log')}
          options={[
            { value: 'log', label: 'log' },
            { value: 'lin', label: 'linear' },
          ]}
        />
        <span style={{ flex: 1 }} />
        <ExportLayoutPicker value={mtfLayout} onChange={setMtfLayout} n={channels.length} />
      </div>
      <div
        style={{
          display: 'grid',
          gap: 14,
          ...gridStyleFor(mtfLayout, channels.length, 380, undefined, style.cardMaxWidth),
        }}
      >
        {channels.map((ch) => (
          <MiniMTFChart
            key={ch}
            channel={ch}
            specs={specs}
            keptIdx={keptIdx}
            measurements={measurements}
            threshold={threshold}
            detectionLimit={perChLim[ch] ?? null}
            xRange={xRange}
            drawStyle={MTF_STYLES[style]}
            dashPatternH={MTF_DASHES[dashH]}
            dashPatternV={MTF_DASHES[dashV]}
            markerH={markerH}
            markerV={markerV}
            logX={logX}
          />
        ))}
      </div>
    </div>
  );
};

// SVG marker shape primitive — keeps the visual size consistent across
// shapes (~6 px box) and threads a tooltip with G/E/lp_mm/Mich.
// `style` is the plotStyle object; fed in so `scaled()` can honor the
// user's Element-scale knob. Defaults to an empty object so undefined
// is never bound.
const MarkerShape = ({ shape, x, y, color, m, size = 7, style = {} }) => {
  const r = size / 2;
  const tooltip = `G${m.spec?.group ?? ''}E${m.spec?.element ?? ''} · ${m.lp_mm.toFixed(2)} lp/mm · M=${m.modulation_5pt.toFixed(3)}`;
  const stroke = '#fff',
    sw = 0.9;
  switch (shape) {
    case 'square':
      return (
        <rect
          x={x - r}
          y={y - r}
          width={size}
          height={size}
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        >
          <title>{tooltip}</title>
        </rect>
      );
    case 'triangle':
      return (
        <polygon
          points={`${x},${y - r * 1.15} ${x - r},${y + r * 0.85} ${x + r},${y + r * 0.85}`}
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        >
          <title>{tooltip}</title>
        </polygon>
      );
    case 'diamond':
      return (
        <polygon
          points={`${x},${y - r * 1.1} ${x + r * 1.1},${y} ${x},${y + r * 1.1} ${x - r * 1.1},${y}`}
          fill={color}
          stroke={stroke}
          strokeWidth={sw}
        >
          <title>{tooltip}</title>
        </polygon>
      );
    case 'cross':
      return (
        <g>
          <line
            x1={x - r}
            y1={y - r}
            x2={x + r}
            y2={y + r}
            stroke={color}
            strokeWidth={scaled(2, style)}
          />
          <line
            x1={x - r}
            y1={y + r}
            x2={x + r}
            y2={y - r}
            stroke={color}
            strokeWidth={scaled(2, style)}
          />
          <title>{tooltip}</title>
        </g>
      );
    case 'plus':
      return (
        <g>
          <line
            x1={x - r * 1.1}
            y1={y}
            x2={x + r * 1.1}
            y2={y}
            stroke={color}
            strokeWidth={scaled(2, style)}
          />
          <line
            x1={x}
            y1={y - r * 1.1}
            x2={x}
            y2={y + r * 1.1}
            stroke={color}
            strokeWidth={scaled(2, style)}
          />
          <title>{tooltip}</title>
        </g>
      );
    case 'circle':
    default:
      return (
        <circle cx={x} cy={y} r={r} fill={color} stroke={stroke} strokeWidth={sw}>
          <title>{tooltip}</title>
        </circle>
      );
  }
};

// One small per-channel MTF chart (inline SVG, no Plotly per cell to keep
// dozens of these snappy). Style is shared; stroke + marker are per
// direction so H and V can be drawn with distinct visual treatments. The
// inline legend hides the H or V chip when that series has no data points.
const MiniMTFChart = ({
  channel,
  specs,
  keptIdx,
  measurements,
  threshold,
  detectionLimit,
  xRange,
  drawStyle = MTF_STYLES['lines+markers'],
  dashPatternH = '',
  dashPatternV = '6 4',
  markerH = 'circle',
  markerV = 'square',
  logX = true,
}) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 360,
    H = 220,
    PAD_L = 44,
    PAD_R = 14,
    PAD_T = 14,
    PAD_B = 36;
  const color = channelColor(channel);
  // X-axis: log or linear, pivots on the whole tick set.
  const xMin = logX ? Math.log10(xRange[0]) : xRange[0];
  const xMax = logX ? Math.log10(xRange[1]) : xRange[1];
  const xToPx = (lp) => {
    const v = logX ? Math.log10(Math.max(0.001, lp)) : lp;
    return PAD_L + ((v - xMin) / (xMax - xMin)) * (W - PAD_L - PAD_R);
  };
  const yToPx = (m) => PAD_T + (1 - Math.max(0, Math.min(1, m))) * (H - PAD_T - PAD_B);

  // Group points by direction (H vs V) so we render two series.
  const series = ['H', 'V'].map((dir) => {
    const pts = keptIdx
      .filter((i) => specs[i].direction === dir)
      .map((i) => measurements[channel]?.[i])
      .filter((m) => m?.lp_mm != null && m?.modulation_5pt != null)
      .sort((a, b) => a.lp_mm - b.lp_mm)
      .map((m) => ({ x: xToPx(m.lp_mm), y: yToPx(m.modulation_5pt), m }));
    return { dir, pts };
  });

  // Build the polyline points for a given direction. For "stairs" mode,
  // we emit a step-after path: each y is held constant until the next x.
  const polylinePts = (pts) => {
    if (!pts.length) return '';
    if (drawStyle.stairs) {
      const out = [`${pts[0].x},${pts[0].y}`];
      for (let i = 1; i < pts.length; i++) {
        out.push(`${pts[i].x},${pts[i - 1].y}`);
        out.push(`${pts[i].x},${pts[i].y}`);
      }
      return out.join(' ');
    }
    return pts.map((p) => `${p.x},${p.y}`).join(' ');
  };

  const xTicks = (
    logX
      ? [0.5, 1, 2, 5, 10, 20, 50, 100, 200]
      : [
          ...new Set(
            [
              xRange[0],
              xRange[0] + (xRange[1] - xRange[0]) / 4,
              xRange[0] + (xRange[1] - xRange[0]) / 2,
              xRange[0] + (3 * (xRange[1] - xRange[0])) / 4,
              xRange[1],
            ].map((v) => Math.round(v * 100) / 100)
          ),
        ]
  ).filter((v) => v >= xRange[0] && v <= xRange[1]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Chart
      channel={channel}
      sub={`det. limit ${detectionLimit != null ? `${detectionLimit.toFixed(2)} lp/mm` : '—'}`}
      exportName={`mantis-usaf-mtf-${channel}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', background: 'transparent', borderRadius: 4 }}
      >
        {/* Y grid + labels */}
        {yTicks.map((yv) => {
          const y = yToPx(yv);
          return (
            <g key={`y${yv}`}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
              />
              <text
                x={PAD_L - 5}
                y={y + 3}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="end"
              >
                {yv.toFixed(2)}
              </text>
            </g>
          );
        })}
        {/* X tick lines + labels */}
        {xTicks.map((xv) => {
          const x = xToPx(xv);
          return (
            <g key={`x${xv}`}>
              <line
                x1={x}
                y1={PAD_T}
                x2={x}
                y2={H - PAD_B}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
              />
              <text
                x={x}
                y={H - PAD_B + 13}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="middle"
              >
                {xv}
              </text>
            </g>
          );
        })}
        {/* Threshold dashed line */}
        <line
          x1={PAD_L}
          y1={yToPx(threshold)}
          x2={W - PAD_R}
          y2={yToPx(threshold)}
          stroke={t.warn}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
          strokeDasharray="4 3"
        />
        <text
          x={W - PAD_R - 4}
          y={yToPx(threshold) - 4}
          fontSize={scaled(style.tickSize, style)}
          fill={t.warn}
          textAnchor="end"
        >
          t={(threshold * 100).toFixed(0)}%
        </text>
        {/* Detection-limit vertical */}
        {detectionLimit != null && detectionLimit >= xRange[0] && detectionLimit <= xRange[1] && (
          <g>
            <line
              x1={xToPx(detectionLimit)}
              y1={PAD_T}
              x2={xToPx(detectionLimit)}
              y2={H - PAD_B}
              stroke={color}
              strokeWidth={scaled(style.lineWidth, style)}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          </g>
        )}
        {/* Curves — stroke and marker per direction. */}
        {series.map(
          ({ dir, pts }) =>
            pts.length > 0 && (
              <g key={dir}>
                {drawStyle.line && (
                  <polyline
                    points={polylinePts(pts)}
                    fill="none"
                    stroke={color}
                    strokeWidth={scaled(style.lineWidth, style)}
                    strokeDasharray={dir === 'H' ? dashPatternH : dashPatternV}
                  />
                )}
                {drawStyle.marker &&
                  pts.map((p, i) => {
                    const shape = dir === 'H' ? markerH : markerV;
                    return (
                      <MarkerShape
                        key={i}
                        shape={shape}
                        x={p.x}
                        y={p.y}
                        color={color}
                        m={p.m}
                        style={style}
                      />
                    );
                  })}
              </g>
            )
        )}
        {/* Axis labels */}
        <text
          x={PAD_L + (W - PAD_L - PAD_R) / 2}
          y={H - 4}
          fontSize={scaled(style.axisLabelSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
        >
          spatial frequency (lp/mm, log)
        </text>
        <text
          x={11}
          y={PAD_T + (H - PAD_T - PAD_B) / 2}
          fontSize={scaled(style.axisLabelSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
          transform={`rotate(-90 11 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
        >
          Michelson (5-pt)
        </text>
        {/* Legend — hide direction chips when their series has no data;
            visible chips reflect the actual stroke + marker chosen in the
            toolbar so the legend stays in sync with the rendered curves. */}
        {(() => {
          const hasH = series.find((s) => s.dir === 'H')?.pts.length > 0;
          const hasV = series.find((s) => s.dir === 'V')?.pts.length > 0;
          const items = [];
          if (hasH) items.push({ dir: 'H', dash: dashPatternH, shape: markerH });
          if (hasV) items.push({ dir: 'V', dash: dashPatternV, shape: markerV });
          if (items.length === 0) return null;
          return (
            <g transform={`translate(${PAD_L + 4}, ${PAD_T + 6})`}>
              {items.map((it, idx) => {
                const x0 = idx * 36;
                return (
                  <g key={it.dir} transform={`translate(${x0}, 0)`}>
                    {drawStyle.line && (
                      <line
                        x1={0}
                        y1={5}
                        x2={14}
                        y2={5}
                        stroke={color}
                        strokeWidth={scaled(style.lineWidth, style)}
                        strokeDasharray={it.dash}
                      />
                    )}
                    {drawStyle.marker && (
                      <MarkerShape
                        shape={it.shape}
                        x={7}
                        y={5}
                        color={color}
                        m={{ spec: {}, lp_mm: 0, modulation_5pt: 0 }}
                        size={6}
                        style={style}
                      />
                    )}
                    <text x={18} y={8} fontSize={scaled(style.tickSize, style)} fill={t.textMuted}>
                      {it.dir}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}
      </svg>
    </Chart>
  );
};

// ===========================================================================
// 2. Profile gallery — compact pass/fail-bordered cards
// ===========================================================================
const ProfileGalleryTab = ({ channels, specs, keptIdx, measurements, threshold }) => {
  const t = useTheme();
  if (!keptIdx.length || !channels.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No lines / channels match the current filter.
      </div>
    );
  }
  // Flatten to (line × channel) cards.
  const cards = [];
  for (const i of keptIdx)
    for (const ch of channels) {
      cards.push({ i, ch, spec: specs[i], m: measurements[ch]?.[i] });
    }
  return (
    <GridTabFrame
      caption={`${cards.filter((c) => c.m).length} profiles · ${cards.filter((c) => c.m && c.m.modulation_5pt >= threshold).length} pass · click any card to focus`}
      n={cards.length}
      minCardPx={220}
      storageKey="analysis/usaf/profilesLayout"
    >
      {cards.map(({ i, ch, spec, m }) => (
        <ProfileCard key={`${ch}_${i}`} ch={ch} spec={spec} m={m} threshold={threshold} />
      ))}
    </GridTabFrame>
  );
};

const ProfileCard = ({ ch, spec, m, threshold }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const color = paletteColor(style, ch);
  const W = 200,
    H = 70;
  if (!m) {
    return (
      <Chart
        channel={ch}
        sub={`· G${spec.group}E${spec.element}${spec.direction} — no data`}
        noExport
        style={{ opacity: 0.5 }}
      >
        <div style={{ minHeight: H }} />
      </Chart>
    );
  }
  const pass = m.modulation_5pt >= threshold;
  const belowNyq = m.samples_per_cycle < 3;
  const borderColor = belowNyq ? '#d97706' : pass ? t.success : t.danger;
  const profile = m.profile || [];
  const N = profile.length;
  const vRaw = m.profile_max - m.profile_min;
  const yMin = m.profile_min - vRaw * 0.1;
  const yMax = m.profile_max + vRaw * 0.1;
  const range = yMax - yMin || 1;
  const pts = profile
    .map((v, idx) => `${(idx / (N - 1 || 1)) * W},${(1 - (v - yMin) / range) * H}`)
    .join(' ');
  // Bar/gap markers from server detection.
  const marks = [
    ...(m.bar_indices || []).map((j) => ({ j, kind: 'bar' })),
    ...(m.gap_indices || []).map((j) => ({ j, kind: 'gap' })),
  ];
  return (
    <Chart
      channel={ch}
      sub={`· G${spec.group}E${spec.element}${spec.direction}`}
      exportName={`mantis-usaf-profile-${ch}-G${spec.group}E${spec.element}${spec.direction}`}
      style={{ border: `2px solid ${borderColor}` }}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          <span>{m.lp_mm.toFixed(2)} lp/mm</span>
          <span style={{ color: borderColor, fontWeight: 600 }}>
            M={m.modulation_5pt.toFixed(3)} {belowNyq ? '⚠' : pass ? '✓' : '✗'}
          </span>
        </div>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        style={{ background: t.panelAlt, borderRadius: 3 }}
      >
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={scaled(style.lineWidth, style)}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {marks.map(({ j, kind }, k) => {
          const x = (j / (N - 1 || 1)) * W;
          return (
            <line
              key={k}
              x1={x}
              y1={0}
              x2={x}
              y2={H}
              stroke={kind === 'bar' ? '#ffd54f' : '#4a9eff'}
              strokeWidth={scaled(style.axisStrokeWidth, style)}
              strokeDasharray="2 2"
              opacity={0.55}
            />
          );
        })}
      </svg>
    </Chart>
  );
};

// ===========================================================================
// 3. Summary table — sortable HTML
// ===========================================================================
const SummaryTableTab = ({ channels, specs, keptIdx, measurements, threshold }) => {
  const t = useTheme();
  const [sortCol, setSortCol] = useStateA('order');
  const [sortDir, setSortDir] = useStateA('asc');
  const rows = useMemoA(() => {
    const out = [];
    for (const ch of channels)
      for (const i of keptIdx) {
        out.push({ order: out.length, ch, spec: specs[i], m: measurements[ch]?.[i] });
      }
    return out;
  }, [channels, keptIdx, specs, measurements]);
  const sorted = useMemoA(() => {
    const c = [...rows];
    const key =
      {
        order: (r) => r.order,
        channel: (r) => r.ch,
        g: (r) => r.spec.group,
        e: (r) => r.spec.element,
        d: (r) => r.spec.direction,
        lpmm: (r) => r.m?.lp_mm ?? -1,
        mich: (r) => r.m?.modulation_5pt ?? -1,
        pct: (r) => r.m?.modulation_pct ?? -1,
        fft: (r) => r.m?.modulation_fft ?? -1,
        mm: (r) => r.m?.modulation_minmax ?? -1,
        spc: (r) => r.m?.samples_per_cycle ?? -1,
      }[sortCol] || ((r) => r.order);
    c.sort((a, b) => {
      const va = key(a),
        vb = key(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * (sortDir === 'asc' ? 1 : -1);
    });
    return c;
  }, [rows, sortCol, sortDir]);
  const setSort = (col) =>
    sortCol === col
      ? setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      : (setSortCol(col), setSortDir('asc'));
  // Mich (P10/P90) intentionally omitted: it reads ~1 for any line that
  // crosses bright surround + dark bars regardless of bar/gap structure,
  // so it's misleading on USAF profiles. Still in the JSON export for
  // anyone scripting against the raw values.
  const cols = [
    { key: 'channel', label: 'Channel', align: 'left' },
    { key: 'g', label: 'G' },
    { key: 'e', label: 'E' },
    { key: 'd', label: 'D' },
    { key: 'lpmm', label: 'lp/mm' },
    { key: 'mich', label: 'Mich (5-pt)' },
    { key: 'fft', label: 'Mich (FFT)' },
    { key: 'mm', label: 'Mich (min/max)' },
    { key: 'spc', label: 's/cyc' },
    { key: 'pass', label: 'Pass' },
  ];
  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${t.border}`,
          fontSize: 12,
          color: t.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span>
          {sorted.length} rows · {channels.length} channel{channels.length !== 1 ? 's' : ''} ×{' '}
          {keptIdx.length} line{keptIdx.length !== 1 ? 's' : ''}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5 }}>click a header to sort</span>
      </div>
      <div style={{ maxHeight: 'calc(94vh - 320px)', overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'ui-monospace,Menlo,monospace',
            fontSize: 12,
          }}
        >
          <thead style={{ position: 'sticky', top: 0, background: t.panelAlt, zIndex: 1 }}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => c.key !== 'pass' && setSort(c.key)}
                  style={{
                    textAlign: c.align || 'right',
                    padding: '8px 12px',
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    color: t.textMuted,
                    borderBottom: `1px solid ${t.border}`,
                    cursor: c.key !== 'pass' ? 'pointer' : 'default',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const m = r.m;
              const below = m && m.samples_per_cycle < 3;
              const pass = m && m.modulation_5pt >= threshold;
              const mColor = !m ? t.textFaint : below ? '#d97706' : pass ? t.success : t.danger;
              const rowBg = idx % 2 === 0 ? t.panel : t.panelAlt;
              const chColor = channelColor(r.ch);
              return (
                <tr key={idx} style={{ background: rowBg, borderBottom: `1px solid ${t.border}` }}>
                  <td
                    style={{
                      padding: '7px 12px',
                      color: chColor,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{ width: 7, height: 7, borderRadius: '50%', background: chColor }}
                    />
                    {r.ch}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {r.spec.group}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {r.spec.element}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {r.spec.direction}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {m ? m.lp_mm.toFixed(2) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: mColor,
                      fontWeight: 600,
                    }}
                  >
                    {m ? m.modulation_5pt.toFixed(3) : '—'}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {m ? m.modulation_fft.toFixed(3) : '—'}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {m ? m.modulation_minmax.toFixed(3) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: below ? '#d97706' : t.textMuted,
                    }}
                  >
                    {m ? m.samples_per_cycle.toFixed(1) : '—'}
                  </td>
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: pass ? t.success : t.danger,
                      fontWeight: 600,
                    }}
                  >
                    {m ? (pass ? '✓' : '✗') : '—'}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  style={{ padding: 40, textAlign: 'center', color: t.textFaint }}
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ===========================================================================
// 4. Detection heatmap — REAL G×E Michelson matrix per channel + colorbar
// ===========================================================================
const DetectionHeatmapTab = ({ channels, specs, measurements, threshold, dirFilter }) => {
  const t = useTheme();
  const [cmap, setCmap] = useStateA('jet');
  // Build {channel: {g_e_dir: michelson}}. dir filter already applied via keptIdx isn't used
  // here because heatmap shows the matrix structure; we average H+V if both picked.
  // NB: the early return for `!channels.length` must come AFTER the useMemoA
  // below so the hook order stays stable across renders (rules-of-hooks).
  const matrix = useMemoA(() => {
    const out = {};
    for (const ch of channels) {
      const cell = {};
      specs.forEach((s, i) => {
        if (dirFilter !== 'all' && s.direction !== dirFilter) return;
        const m = measurements[ch]?.[i];
        if (!m) return;
        const k = `${s.group}_${s.element}`;
        if (!cell[k]) cell[k] = { sum: 0, n: 0, samples_per_cycle: 0 };
        cell[k].sum += m.modulation_5pt;
        cell[k].n += 1;
        cell[k].samples_per_cycle = Math.min(
          cell[k].samples_per_cycle || Infinity,
          m.samples_per_cycle
        );
      });
      out[ch] = cell;
    }
    return out;
  }, [channels, specs, measurements, dirFilter]);
  if (!channels.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No channels match the current filter.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Colormap
        </span>
        <select
          value={cmap}
          onChange={(e) => setCmap(e.target.value)}
          style={{
            background: t.chipBg,
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11.5,
            fontFamily: 'inherit',
          }}
        >
          {Object.keys(COLOR_MAPS).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <span
          style={{ fontSize: 11, color: t.textMuted, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          rows = USAF group · cols = element 1–6 · cell value = mean Mich (5-pt) over all picked H/V
          at that G/E
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${channels.length}, minmax(220px, 1fr)) 56px`,
          gap: 14,
        }}
      >
        {channels.map((ch) => (
          <HeatmapPanel
            key={ch}
            channel={ch}
            cells={matrix[ch] || {}}
            cmap={cmap}
            threshold={threshold}
          />
        ))}
        <Colorbar cmap={cmap} threshold={threshold} t={t} />
      </div>
    </div>
  );
};

const HeatmapPanel = ({ channel, cells, cmap, threshold }) => {
  const t = useTheme();
  const groups = [0, 1, 2, 3, 4, 5];
  const elements = [1, 2, 3, 4, 5, 6];
  return (
    <Chart channel={channel} exportName={`mantis-usaf-heatmap-${channel}`}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '24px repeat(6, 1fr)',
          gap: 1,
          alignItems: 'stretch',
        }}
      >
        <div />
        {elements.map((e) => (
          <div
            key={e}
            style={{ fontSize: 9.5, color: t.textFaint, textAlign: 'center', padding: 2 }}
          >
            E{e}
          </div>
        ))}
        {groups.map((g) => (
          <React.Fragment key={g}>
            <div
              style={{
                fontSize: 9.5,
                color: t.textFaint,
                textAlign: 'center',
                padding: 2,
                alignSelf: 'center',
              }}
            >
              G{g}
            </div>
            {elements.map((e) => {
              const cell = cells[`${g}_${e}`];
              if (!cell) {
                return (
                  <div
                    key={e}
                    style={{
                      aspectRatio: '1/1',
                      background: t.panelAlt,
                      border: `1px dashed ${t.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 8,
                      color: t.textFaint,
                    }}
                  >
                    —
                  </div>
                );
              }
              const v = cell.sum / cell.n;
              const bg = sampleCmap(cmap, v);
              const fg = v > 0.5 ? '#000' : '#fff';
              const isPass = v >= threshold;
              return (
                <div
                  key={e}
                  title={`${channel} · G${g}E${e} · M=${v.toFixed(3)} · ${isPass ? 'PASS' : 'FAIL'} · n=${cell.n} pick${cell.n !== 1 ? 's' : ''}`}
                  style={{
                    aspectRatio: '1/1',
                    background: bg,
                    color: fg,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                    fontWeight: 600,
                    border: `1px solid ${isPass ? '#1a7f37' : 'rgba(0,0,0,0.18)'}`,
                  }}
                >
                  <span>{v.toFixed(2)}</span>
                  {!isPass && <span style={{ fontSize: 8, opacity: 0.7 }}>FAIL</span>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </Chart>
  );
};

const Colorbar = ({ cmap, threshold, t }) => {
  // Vertical colorbar with threshold tick.
  const stops = COLOR_MAPS[cmap] || COLOR_MAPS.jet;
  const _grad = stops.map(([u, c]) => `${c} ${(1 - u) * 100}%`).join(', ');
  return (
    <div style={{ position: 'relative', minHeight: 200 }}>
      <div
        style={{
          position: 'absolute',
          top: 22,
          bottom: 16,
          left: 0,
          width: 16,
          background: `linear-gradient(to top, ${stops.map(([u, c]) => `${c} ${u * 100}%`).join(', ')})`,
          borderRadius: 3,
          border: `1px solid ${t.border}`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 4,
          left: 18,
          fontSize: 9,
          color: t.textMuted,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        1.00
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 18,
          fontSize: 9,
          color: t.textMuted,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        0.00
      </div>
      <div
        style={{
          position: 'absolute',
          top: `calc(22px + ${(1 - threshold) * 100}% - 22px * ${1 - threshold})`,
          left: 0,
          width: 22,
          height: 1,
          background: t.text,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: `calc(22px + ${(1 - threshold) * 100}% - 22px * ${1 - threshold} - 6px)`,
          left: 18,
          fontSize: 9,
          color: t.text,
          fontWeight: 600,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        {(threshold * 100).toFixed(0)}%
      </div>
    </div>
  );
};

// ===========================================================================
// 5. Group sweep — 6 mini-charts (one per group)
// ===========================================================================
const GroupSweepTab = ({ channels, specs, keptIdx, measurements, threshold }) => {
  const groups = [0, 1, 2, 3, 4, 5];
  return (
    <GridTabFrame
      caption="Each panel = one USAF group. X-axis = element 1–6. Y-axis = Michelson (5-pt). One curve per channel."
      n={groups.length}
      minCardPx={260}
      storageKey="analysis/usaf/groupSweepLayout"
    >
      {groups.map((g) => (
        <GroupMiniChart
          key={g}
          group={g}
          channels={channels}
          specs={specs}
          keptIdx={keptIdx}
          measurements={measurements}
          threshold={threshold}
        />
      ))}
    </GridTabFrame>
  );
};

const GroupMiniChart = ({ group, channels, specs, keptIdx, measurements, threshold }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 260,
    H = 170,
    PAD_L = 36,
    PAD_R = 12,
    PAD_T = 14,
    PAD_B = 30;
  const elements = [1, 2, 3, 4, 5, 6];
  const xToPx = (e) => PAD_L + ((e - 1) / 5) * (W - PAD_L - PAD_R);
  const yToPx = (m) => PAD_T + (1 - Math.max(0, Math.min(1, m))) * (H - PAD_T - PAD_B);
  // Per-channel mean per element (averaging H + V).
  const series = channels.map((ch) => {
    const pts = elements.map((e) => {
      const vals = keptIdx
        .filter((i) => specs[i].group === group && specs[i].element === e)
        .map((i) => measurements[ch]?.[i]?.modulation_5pt)
        .filter((v) => v != null);
      return { e, m: vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null };
    });
    return { ch, color: paletteColor(style, ch), pts };
  });
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <Chart
      title={`Group ${group}`}
      sub={`${lpmmFor(group, 1).toFixed(2)} – ${lpmmFor(group, 6).toFixed(2)} lp/mm`}
      exportName={`mantis-usaf-group-${group}`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width="100%">
        {yTicks.map((yv) => {
          const y = yToPx(yv);
          return (
            <g key={yv}>
              <line
                x1={PAD_L}
                y1={y}
                x2={W - PAD_R}
                y2={y}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
              />
              <text
                x={PAD_L - 5}
                y={y + 3}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="end"
              >
                {yv}
              </text>
            </g>
          );
        })}
        {elements.map((e) => (
          <text
            key={e}
            x={xToPx(e)}
            y={H - PAD_B + 12}
            fontSize={scaled(style.tickSize, style)}
            fill={t.textMuted}
            textAnchor="middle"
          >
            E{e}
          </text>
        ))}
        <line
          x1={PAD_L}
          y1={yToPx(threshold)}
          x2={W - PAD_R}
          y2={yToPx(threshold)}
          stroke={t.warn}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
          strokeDasharray="3 2"
        />
        {series.map(({ ch, color, pts }) => {
          const def = pts.filter((p) => p.m != null);
          if (!def.length) return null;
          return (
            <g key={ch}>
              <polyline
                points={def.map((p) => `${xToPx(p.e)},${yToPx(p.m)}`).join(' ')}
                fill="none"
                stroke={color}
                strokeWidth={scaled(style.lineWidth, style)}
              />
              {def.map((p, i) => (
                <circle
                  key={i}
                  cx={xToPx(p.e)}
                  cy={yToPx(p.m)}
                  r={2.5}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={scaled(style.markerStrokeWidth, style)}
                >
                  <title>{`${ch} · G${group}E${p.e} · M=${p.m.toFixed(3)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
    </Chart>
  );
};

// ===========================================================================
// 6. FFT / MTF — view toggle (CTF, Coltman MTF, FFT spectra)
// ===========================================================================
const FFTMTFTab = ({ channels, specs, keptIdx, measurements, threshold }) => {
  const t = useTheme();
  const [view, setView] = useStateA('ctf'); // ctf | coltman | fft
  if (!channels.length || !keptIdx.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No data to display.
      </div>
    );
  }
  return (
    <div>
      <div
        data-no-export
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          padding: '8px 10px',
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          View
        </span>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'ctf', label: 'MTF (CTF)' },
            { value: 'coltman', label: 'MTF (Coltman)' },
            { value: 'fft', label: 'FFT spectra' },
          ]}
        />
        <span style={{ flex: 1 }} />
        <span
          style={{ fontSize: 10.5, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          CTF = raw 5-point Michelson · Coltman = (π/4)·CTF (sine-wave MTF approximation) · FFT =
          per-line spectra
        </span>
      </div>
      {view === 'fft' ? (
        <FFTSpectraGrid
          channels={channels}
          specs={specs}
          keptIdx={keptIdx}
          measurements={measurements}
        />
      ) : (
        <FFTMTFOverlay
          channels={channels}
          specs={specs}
          keptIdx={keptIdx}
          measurements={measurements}
          threshold={threshold}
          coltman={view === 'coltman'}
        />
      )}
    </div>
  );
};

const FFTMTFOverlay = ({ channels, specs, keptIdx, measurements, threshold, coltman }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const data = [];
  for (const ch of channels) {
    for (const dir of ['H', 'V']) {
      const pts = keptIdx
        .filter((i) => specs[i].direction === dir)
        .map((i) => measurements[ch]?.[i])
        .filter((m) => m?.lp_mm != null && m?.modulation_5pt != null)
        .sort((a, b) => a.lp_mm - b.lp_mm);
      if (!pts.length) continue;
      const factor = coltman ? Math.PI / 4 : 1;
      const color = paletteColor(style, ch);
      data.push({
        type: 'scatter',
        mode: 'lines+markers',
        x: pts.map((p) => p.lp_mm),
        y: pts.map((p) => p.modulation_5pt * factor),
        name: `${ch} ${dir}`,
        line: { color, width: 1.8, dash: dir === 'V' ? 'dash' : 'solid' },
        marker: {
          color,
          size: 8,
          symbol: dir === 'V' ? 'square' : 'circle',
          line: { color: '#fff', width: 1 },
        },
        hovertemplate: '%{x:.2f} lp/mm<br>%{y:.3f}<extra>%{fullData.name}</extra>',
      });
    }
  }
  return (
    <div
      style={{
        height: 'calc(94vh - 320px)',
        minHeight: 480,
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        padding: 8,
      }}
    >
      <PlotlyChart
        data={data}
        layout={{
          xaxis: { type: 'log', title: { text: 'spatial frequency (lp/mm @ chart)' } },
          yaxis: {
            title: {
              text: coltman ? 'MTF (Coltman, sine-wave approx.)' : 'CTF (5-point Michelson)',
            },
            range: [0, coltman ? 0.85 : 1.05],
          },
          shapes: [
            {
              type: 'line',
              xref: 'paper',
              yref: 'y',
              x0: 0,
              x1: 1,
              y0: threshold * (coltman ? Math.PI / 4 : 1),
              y1: threshold * (coltman ? Math.PI / 4 : 1),
              line: { color: t.warn, width: 1, dash: 'dash' },
            },
          ],
          legend: { orientation: 'h', y: -0.18, x: 0 },
          margin: { l: 70, r: 30, t: 20, b: 90 },
        }}
      />
    </div>
  );
};

const FFTSpectraGrid = ({ channels, specs, keptIdx, measurements }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  // Per-line FFT magnitude using a small client-side DFT (profiles are short).
  const fftMag = (profile) => {
    const N = profile.length;
    if (N < 4) return { f: [], m: [] };
    const mean = profile.reduce((a, b) => a + b, 0) / N;
    const p = profile.map((v) => v - mean);
    const K = Math.min(Math.floor(N / 2) + 1, 256);
    const f = new Array(K),
      m = new Array(K);
    let mx = 0;
    for (let k = 0; k < K; k++) {
      let re = 0,
        im = 0;
      const w = (-2 * Math.PI * k) / N;
      for (let n = 0; n < N; n++) {
        re += p[n] * Math.cos(w * n);
        im += p[n] * Math.sin(w * n);
      }
      const mag = Math.sqrt(re * re + im * im);
      f[k] = k / N;
      m[k] = mag;
      if (mag > mx) mx = mag;
    }
    if (mx > 0) for (let k = 0; k < K; k++) m[k] /= mx;
    return { f, m };
  };
  return (
    <GridTabFrame n={keptIdx.length} minCardPx={360} storageKey="analysis/usaf/fftSpectraLayout">
      {keptIdx.map((i) => {
        const spec = specs[i];
        const W = 340,
          H = 180,
          PAD_L = 36,
          PAD_R = 10,
          PAD_T = 12,
          PAD_B = 30;
        const xToPx = (f) => PAD_L + (f / 0.5) * (W - PAD_L - PAD_R);
        const yToPx = (mv) => PAD_T + (1 - Math.max(0, Math.min(1, mv))) * (H - PAD_T - PAD_B);
        const m0 = channels.map((c) => measurements[c]?.[i]).find(Boolean);
        const fExp = m0?.f_expected_cy_per_sample || 0;
        return (
          <Chart
            key={i}
            title={`G${spec.group}E${spec.element}${spec.direction}`}
            sub={`f_expected = ${fExp.toFixed(4)} cy/sample`}
            exportName={`mantis-usaf-fft-G${spec.group}E${spec.element}${spec.direction}`}
          >
            <svg viewBox={`0 0 ${W} ${H}`} width="100%">
              {[0, 0.25, 0.5, 0.75, 1].map((yv) => (
                <g key={yv}>
                  <line
                    x1={PAD_L}
                    y1={yToPx(yv)}
                    x2={W - PAD_R}
                    y2={yToPx(yv)}
                    stroke={t.border}
                    strokeWidth={scaled(style.gridWidth, style)}
                  />
                  <text
                    x={PAD_L - 5}
                    y={yToPx(yv) + 3}
                    fontSize={scaled(style.tickSize, style)}
                    fill={t.textMuted}
                    textAnchor="end"
                  >
                    {yv}
                  </text>
                </g>
              ))}
              {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((xv) => (
                <text
                  key={xv}
                  x={xToPx(xv)}
                  y={H - PAD_B + 12}
                  fontSize={scaled(style.tickSize, style)}
                  fill={t.textMuted}
                  textAnchor="middle"
                >
                  {xv}
                </text>
              ))}
              {fExp > 0 && (
                <line
                  x1={xToPx(fExp)}
                  y1={PAD_T}
                  x2={xToPx(fExp)}
                  y2={H - PAD_B}
                  stroke={t.textMuted}
                  strokeWidth={scaled(style.axisStrokeWidth, style)}
                  strokeDasharray="3 2"
                />
              )}
              {channels.map((ch) => {
                const m = measurements[ch]?.[i];
                if (!m?.profile?.length) return null;
                const { f, m: ma } = fftMag(m.profile);
                if (!f.length) return null;
                const color = paletteColor(style, ch);
                const pts = f.map((fx, k) => `${xToPx(fx)},${yToPx(ma[k])}`).join(' ');
                return (
                  <polyline
                    key={ch}
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={scaled(style.lineWidth, style)}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
              <text
                x={(PAD_L + W - PAD_R) / 2}
                y={H - 4}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="middle"
              >
                freq (cy/sample)
              </text>
            </svg>
          </Chart>
        );
      })}
    </GridTabFrame>
  );
};

// ===========================================================================
// FPN analysis modal — native-vector tabs driven by the /api/fpn/analyze
// full JSON payload (measurements per channel × per ROI, plus base64 PNGs
// for the 2-D maps / autocorrelation / power spectrum).
//
// Tabs:
//   1. Summary         — per-channel × per-ROI metric grid (sortable table)
//   2. Row / Col means — overlaid 1-D profiles with ±1σ bands
//   3. 1-D PSDs        — row + col spectra with peak markers
//   4. 2-D FPN maps    — grid of server-rendered divergent PNGs
//   5. 2-D power spect.— server-rendered log-magnitude FFT maps
//   6. Autocorrelation — server-rendered autocorrelation heatmaps
//   7. Hot / cold pix  — per-channel × per-ROI hot/cold scatter PNG + top-N list
//   8. ROI comparison  — bar chart of DSNU / PRNU / σ_row / σ_col across ROIs
// ===========================================================================
const FPNAnalysisModal = ({ run, onClose, onToast }) => {
  const t = useTheme();
  const plotStyleState = usePlotStyleState();
  const [styleOpen, setStyleOpen] = useStateA(false);
  const { response = {} } = run;
  const allChannels = response.channels || [];
  const allRois = response.rois || [];
  const measurements = response.measurements || {};
  const _thumbnails = response.channel_thumbnails || {};
  const _figures = response.figures || {};
  const settings = response.settings || {};

  const [chans, setChans] = useStateA(allChannels);
  const [gainFilter, setGainFilter] = useStateA('all');
  const [roiIdxFilter, setRoiIdxFilter] = useStateA('all'); // 'all' or specific idx
  const [tab, setTab] = useStateA('summary');
  // Same user-pickable background as the USAF modal — shared localStorage
  // key so the user only sets the color once across both modals.
  const [bgColor, setBgColor] = useLocalStorageState('analysis/bgColor', null);
  const effectiveBg = bgColor || t.panelAlt;
  // Display unit — 'DN' shows raw digital numbers (12-bit / 14-bit / 16-bit
  // sensors all just show the integer); '%DR' divides by FULL_DR (default
  // 65535 for the GSense 16-bit ADC) and shows percentages, which is what
  // most journals use to compare FPN across cameras with different bit
  // depths. Persisted across sessions.
  const FULL_DR = 65535;
  const [unit, setUnit] = useLocalStorageState('analysis/fpn/unit', 'DN');
  // ROI label overrides — lets the user double-click a ROI cell in the
  // result page and rename it without re-running analysis. Keyed by the
  // ROI index in run.rois. Falls through to run.rois[i].label.
  const [roiLabelOverrides, setRoiLabelOverrides] = useStateA({});

  const visibleChannels = useMemoA(() => {
    const base = chans.filter((c) => allChannels.includes(c));
    if (gainFilter === 'all') return base;
    return base.filter((c) => c.startsWith(gainFilter + '-'));
  }, [chans, gainFilter, allChannels]);

  const visibleRoiIdx = useMemoA(() => {
    if (roiIdxFilter === 'all') return allRois.map((_, i) => i);
    return [parseInt(roiIdxFilter)];
  }, [roiIdxFilter, allRois]);

  const tabs = [
    { key: 'summary', label: 'Summary' },
    { key: 'hist', label: 'Histograms' },
    { key: 'profiles', label: 'Row / Col means' },
    { key: 'psd1d', label: '1-D PSDs' },
    { key: 'map', label: '2-D FPN maps' },
    { key: 'psd', label: '2-D power spectrum' },
    { key: 'autocorr', label: 'Autocorrelation' },
    { key: 'hotpix', label: 'Hot / cold pixels' },
    { key: 'compare', label: 'ROI comparison' },
  ];

  // CSV export of the per-channel × per-ROI metric table.
  const exportCSVRows = useCallbackA(() => {
    const rows = [];
    for (const ch of visibleChannels) {
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
      onToast?.('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-fpn-${Date.now()}.csv`, rows);
    onToast?.(`Exported ${rows.length} rows to CSV`, 'success');
  }, [visibleChannels, visibleRoiIdx, measurements, allRois, onToast, run.rois]);

  const exportJSONRaw = useCallbackA(() => {
    exportJSON(`mantis-fpn-${Date.now()}.json`, {
      kind: 'mantis-fpn-analysis',
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: visibleChannels,
      rois: allRois,
      settings,
      measurements: Object.fromEntries(
        visibleChannels.map((ch) => [ch, visibleRoiIdx.map((i) => measurements[ch]?.[i] ?? null)])
      ),
    });
    onToast?.('Exported analysis JSON', 'success');
  }, [visibleChannels, visibleRoiIdx, measurements, allRois, settings, onToast]);

  // FPN tab export — shared path.
  const tabBodyRef = useRefA(null);
  const exportPNG = useCallbackA(async () => {
    const node = tabBodyRef.current;
    if (!node) {
      onToast?.('Export unavailable', 'danger');
      return;
    }
    try {
      onToast?.('Rendering…');
      const res = await mantisExport(
        node,
        `mantis-fpn-${tab}-${Date.now()}`,
        plotStyleState.style,
        effectiveBg
      );
      onToast?.(`Exported ${tab} as ${res.format.toUpperCase()} (${res.scale}×)`, 'success');
    } catch (err) {
      onToast?.(`Export failed: ${err.message || err}`, 'danger');
    }
  }, [tab, effectiveBg, onToast, plotStyleState.style]);

  const roiLabel = (i) => roiLabelOverrides[i] ?? (run.rois?.[i]?.label || `ROI-${i + 1}`);
  const setRoiLabel = (i, label) => setRoiLabelOverrides((prev) => ({ ...prev, [i]: label }));

  return (
    <PlotStyleCtx.Provider value={plotStyleState}>
      <div
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
                FPN analysis — {allRois.length} ROI{allRois.length !== 1 ? 's' : ''} ×{' '}
                {visibleChannels.length} channel{visibleChannels.length !== 1 ? 's' : ''}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  marginTop: 1,
                }}
              >
                drift={settings.drift_order || 'none'} · hot |z|={settings.hot_sigma ?? 4} · outlier
                cuts {(settings.lo_pct || 0).toFixed(1)} / {(settings.hi_pct || 0).toFixed(1)}%
                {settings.median_size
                  ? ` · median ${settings.median_size}×${settings.median_size}`
                  : ''}
                {settings.gaussian_sigma > 0.05
                  ? ` · gauss σ=${settings.gaussian_sigma.toFixed(2)}`
                  : ''}
                {settings.bilateral ? ' · bilateral' : ''}
              </div>
            </div>
            <PlotStylePanel open={false} onToggle={() => setStyleOpen((s) => !s)} />
            <Button icon="image" onClick={exportPNG} title="Capture the active tab as a PNG">
              PNG
            </Button>
            <Button icon="download" onClick={exportCSVRows} title="Flat per-(channel × ROI) CSV">
              CSV
            </Button>
            <Button
              icon="download"
              onClick={exportJSONRaw}
              title="Round-trippable raw analysis JSON"
            >
              JSON
            </Button>
            <Button variant="subtle" icon="close" onClick={onClose} size="sm" title="Close (Esc)" />
          </div>
          {styleOpen && <PlotStylePanel open={true} onToggle={() => setStyleOpen(false)} />}

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
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Channels
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allChannels.map((c) => (
                <ChannelChip
                  key={c}
                  id={c.includes('-') ? c : `HG-${c}`}
                  multi
                  selected={chans.includes(c)}
                  onToggle={() =>
                    setChans((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                    )
                  }
                  size="sm"
                />
              ))}
              <Button size="xs" onClick={() => setChans(allChannels)}>
                All
              </Button>
              <Button size="xs" onClick={() => setChans([])}>
                None
              </Button>
            </div>
            {allChannels.some((c) => c.startsWith('HG-')) && (
              <>
                <span
                  style={{
                    fontSize: 10,
                    color: t.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginLeft: 6,
                  }}
                >
                  Gain
                </span>
                <Segmented
                  value={gainFilter}
                  onChange={setGainFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'HG', label: 'HG' },
                    { value: 'LG', label: 'LG' },
                  ]}
                />
              </>
            )}
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              ROI
            </span>
            <Segmented
              value={roiIdxFilter}
              onChange={setRoiIdxFilter}
              options={[
                { value: 'all', label: 'All' },
                ...allRois.map((_, i) => ({ value: String(i), label: roiLabel(i) })),
              ]}
            />
            {/* Display unit — DN (raw counts) or %DR (percentage of full
              0..65535 dynamic range). Affects every DN-valued metric in
              the table + histograms + profiles for at-a-glance comparison
              across cameras with different bit depths. */}
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Unit
            </span>
            <Tip
              title={`DN = raw digital number · %DR = percent of full dynamic range (0..${FULL_DR})`}
            >
              <Segmented
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'DN', label: 'DN' },
                  { value: 'pctDR', label: '% DR' },
                ]}
              />
            </Tip>
            <BgColorPicker bgColor={bgColor} setBgColor={setBgColor} />
          </div>

          <div
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
            {tabs.map((x) => (
              <button
                key={x.key}
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

          <div
            ref={tabBodyRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              padding: 16,
              background: bgColor === 'transparent' ? 'transparent' : effectiveBg,
              backgroundImage:
                bgColor === 'transparent'
                  ? 'linear-gradient(45deg, #d8dbe0 25%, transparent 25%), linear-gradient(-45deg, #d8dbe0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8dbe0 75%), linear-gradient(-45deg, transparent 75%, #d8dbe0 75%)'
                  : undefined,
              backgroundSize: bgColor === 'transparent' ? '16px 16px' : undefined,
              backgroundPosition:
                bgColor === 'transparent' ? '0 0, 0 8px, 8px -8px, -8px 0px' : undefined,
            }}
          >
            {tab === 'summary' && (
              <FPNSummaryTab
                channels={visibleChannels}
                measurements={measurements}
                rois={allRois}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
                setRoiLabel={setRoiLabel}
                unit={unit}
                fullDR={FULL_DR}
              />
            )}
            {tab === 'hist' && (
              <FPNHistogramsTab
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
                unit={unit}
                fullDR={FULL_DR}
              />
            )}
            {tab === 'profiles' && (
              <FPNProfilesTab
                channels={visibleChannels}
                measurements={measurements}
                rois={allRois}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
              />
            )}
            {tab === 'psd1d' && (
              <FPNPSD1DTab
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
              />
            )}
            {tab === 'map' && (
              <FPNFigureGrid
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
                figKey="map"
                caption="Blue = below, red = above. Scale centered on zero."
              />
            )}
            {tab === 'psd' && (
              <FPNFigureGrid
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
                figKey="psd"
                caption="Bright lines = banding, bright points = periodic structure."
              />
            )}
            {tab === 'autocorr' && (
              <FPNFigureGrid
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
                figKey="autocorr"
                caption="Center spike = signal power, off-center peaks = periodic spatial structure."
              />
            )}
            {tab === 'hotpix' && (
              <FPNHotPixTab
                channels={visibleChannels}
                measurements={measurements}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
              />
            )}
            {tab === 'compare' && (
              <FPNCompareTab
                channels={visibleChannels}
                measurements={measurements}
                rois={allRois}
                visibleRoiIdx={visibleRoiIdx}
                roiLabel={roiLabel}
              />
            )}
          </div>
        </div>
      </div>
    </PlotStyleCtx.Provider>
  );
};

// ---------------------------------------------------------------------------
// FPN Summary — flat sortable HTML table, color-coded pass/fail
//
// New: ROI cell is double-click-editable (label override propagates to every
// other tab via the shared roiLabel() function). Unit toggle (DN / %DR)
// reformats every DN-valued metric. Column selector (cog icon) lets the
// user hide/show any column; selection persists per modal session.
// ---------------------------------------------------------------------------
const FPNSummaryTab = ({
  channels,
  measurements,
  rois,
  visibleRoiIdx,
  roiLabel,
  setRoiLabel,
  unit = 'DN',
  fullDR = 65535,
}) => {
  const t = useTheme();
  const [sortCol, setSortCol] = useStateA('order');
  const [sortDir, setSortDir] = useStateA('asc');
  const [editingI, setEditingI] = useStateA(null); // ROI index being renamed
  const [showColMenu, setShowColMenu] = useStateA(false);
  // Persisted column visibility — defaults to all visible. Stored as a
  // map { colKey: bool } so adding columns later doesn't surprise users.
  const [hiddenCols, setHiddenCols] = useLocalStorageState('analysis/fpn/hiddenCols', {});

  // --- Unit-aware formatting helpers -------------------------------------
  // pctDR mode divides DN by fullDR and shows percentage; helps compare
  // FPN across cameras with different bit depths. PRNU is already a
  // percentage of mean_signal so it's never re-scaled.
  const fmtDN = (v, decimals = 3) =>
    v == null
      ? '—'
      : unit === 'pctDR'
        ? `${((v / fullDR) * 100).toFixed(decimals + 1)}`
        : v.toFixed(decimals);
  const muHdr = unit === 'pctDR' ? 'μ %DR' : 'μ DN';
  const dsnuHdr = unit === 'pctDR' ? 'DSNU %DR' : 'DSNU';
  const sigHdr = (axis) => (unit === 'pctDR' ? `σ ${axis} %DR` : `σ ${axis}`);

  const rowsAll = useMemoA(() => {
    const out = [];
    for (const ch of channels)
      for (const i of visibleRoiIdx) {
        const m = measurements[ch]?.[i];
        out.push({ order: out.length, ch, i, m, label: roiLabel(i), roi: rois[i] });
      }
    return out;
  }, [channels, visibleRoiIdx, measurements, rois, roiLabel]);
  const sorted = useMemoA(() => {
    const c = [...rowsAll];
    const key =
      {
        order: (r) => r.order,
        channel: (r) => r.ch,
        label: (r) => r.label,
        px: (r) => (r.roi?.[2] - r.roi?.[0]) * (r.roi?.[3] - r.roi?.[1]) || 0,
        mean: (r) => r.m?.mean_signal ?? -1,
        dsnu: (r) => r.m?.dsnu_dn ?? -1,
        prnu: (r) => r.m?.prnu_pct ?? -1,
        row: (r) => r.m?.row_noise_dn ?? -1,
        col: (r) => r.m?.col_noise_dn ?? -1,
        res: (r) => r.m?.residual_pixel_noise_dn ?? -1,
        hot: (r) => r.m?.hot_pixel_count ?? -1,
        cold: (r) => r.m?.cold_pixel_count ?? -1,
        rowOnly: (r) => r.m?.dsnu_row_only_dn ?? -1,
        colOnly: (r) => r.m?.dsnu_col_only_dn ?? -1,
        rowFreq: (r) => r.m?.row_peak_freq ?? -1,
        colFreq: (r) => r.m?.col_peak_freq ?? -1,
      }[sortCol] || ((r) => r.order);
    c.sort((a, b) => {
      const va = key(a),
        vb = key(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * (sortDir === 'asc' ? 1 : -1);
    });
    return c;
  }, [rowsAll, sortCol, sortDir]);
  const setSort = (col) =>
    sortCol === col
      ? setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      : (setSortCol(col), setSortDir('asc'));

  // Column registry — new entries can be added here freely; the visibility
  // map auto-tolerates missing keys (treats as "visible").
  const allCols = [
    { key: 'channel', label: 'Channel', align: 'left' },
    { key: 'label', label: 'ROI', align: 'left' },
    { key: 'px', label: 'Pixels' },
    { key: 'mean', label: muHdr },
    { key: 'dsnu', label: dsnuHdr },
    { key: 'prnu', label: 'PRNU %' },
    { key: 'row', label: sigHdr('row') },
    { key: 'col', label: sigHdr('col') },
    { key: 'res', label: sigHdr('res') },
    { key: 'rowOnly', label: unit === 'pctDR' ? 'σ row-only %DR' : 'σ row-only' },
    { key: 'colOnly', label: unit === 'pctDR' ? 'σ col-only %DR' : 'σ col-only' },
    { key: 'rowFreq', label: 'row peak (cy/row)' },
    { key: 'colFreq', label: 'col peak (cy/col)' },
    { key: 'hot', label: 'hot' },
    { key: 'cold', label: 'cold' },
  ];
  const cols = allCols.filter((c) => !hiddenCols[c.key]);

  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        data-no-export
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${t.border}`,
          fontSize: 12,
          color: t.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          position: 'relative',
        }}
      >
        <span>
          {sorted.length} rows · {channels.length} channels × {visibleRoiIdx.length} ROIs
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5 }}>
          double-click a ROI cell to rename · click a header to sort
        </span>
        <Tip title="Show / hide columns">
          <button
            onClick={() => setShowColMenu((v) => !v)}
            style={{
              background: t.chipBg,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: 4,
              padding: '3px 8px',
              cursor: 'pointer',
              fontSize: 10.5,
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Icon name="settings" size={11} /> Columns ({cols.length}/{allCols.length})
          </button>
        </Tip>
        {showColMenu && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 14,
              zIndex: 5,
              background: t.panel,
              border: `1px solid ${t.borderStrong}`,
              borderRadius: 6,
              padding: 8,
              boxShadow: t.shadowLg,
              minWidth: 200,
              maxHeight: 320,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginBottom: 6,
              }}
            >
              Show columns
            </div>
            {allCols.map((c) => (
              <label
                key={c.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 6px',
                  cursor: 'pointer',
                  fontSize: 11.5,
                  color: t.text,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = t.panelAlt)}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={!hiddenCols[c.key]}
                  onChange={(e) =>
                    setHiddenCols((prev) => ({ ...prev, [c.key]: !e.target.checked }))
                  }
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <span style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11 }}>
                  {c.label}
                </span>
              </label>
            ))}
            <div
              style={{
                display: 'flex',
                gap: 4,
                marginTop: 6,
                paddingTop: 6,
                borderTop: `1px solid ${t.border}`,
              }}
            >
              <Button size="xs" onClick={() => setHiddenCols({})}>
                All
              </Button>
              <Button
                size="xs"
                onClick={() => setHiddenCols(Object.fromEntries(allCols.map((c) => [c.key, true])))}
              >
                None
              </Button>
              <span style={{ flex: 1 }} />
              <Button size="xs" onClick={() => setShowColMenu(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
      <div style={{ maxHeight: 'calc(94vh - 320px)', overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'ui-monospace,Menlo,monospace',
            fontSize: 12,
          }}
        >
          <thead style={{ position: 'sticky', top: 0, background: t.panelAlt, zIndex: 1 }}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort(c.key)}
                  style={{
                    textAlign: c.align || 'right',
                    padding: '8px 12px',
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    color: t.textMuted,
                    borderBottom: `1px solid ${t.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => {
              const m = r.m;
              const prnu = m?.prnu_pct;
              const prnuColor = !m
                ? t.textFaint
                : prnu < 0.5
                  ? t.success
                  : prnu < 1.0
                    ? t.warn
                    : t.danger;
              const chColor = channelColor(r.ch);
              const px = (r.roi?.[2] - r.roi?.[0]) * (r.roi?.[3] - r.roi?.[1]);
              const cellByKey = {
                channel: (
                  <td
                    style={{
                      padding: '7px 12px',
                      color: chColor,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{ width: 7, height: 7, borderRadius: '50%', background: chColor }}
                    />
                    {r.ch}
                  </td>
                ),
                label: (
                  <td style={{ padding: '7px 12px', color: t.text }} title="double-click to rename">
                    {editingI === r.i ? (
                      <input
                        autoFocus
                        defaultValue={r.label}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.target.blur();
                          if (e.key === 'Escape') setEditingI(null);
                        }}
                        onBlur={(e) => {
                          setRoiLabel?.(r.i, e.target.value.trim() || `ROI-${r.i + 1}`);
                          setEditingI(null);
                        }}
                        style={{
                          width: '100%',
                          background: t.inputBg,
                          color: t.text,
                          border: `1px solid ${t.accent}`,
                          borderRadius: 3,
                          fontSize: 12,
                          fontFamily: 'inherit',
                          padding: '1px 4px',
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setEditingI(r.i);
                        }}
                        style={{ cursor: setRoiLabel ? 'text' : 'default' }}
                      >
                        {r.label}
                      </span>
                    )}
                  </td>
                ),
                px: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {px || '—'}
                  </td>
                ),
                mean: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {fmtDN(m?.mean_signal, 1)}
                  </td>
                ),
                dsnu: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {fmtDN(m?.dsnu_dn)}
                  </td>
                ),
                prnu: (
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: prnuColor,
                      fontWeight: 600,
                    }}
                  >
                    {m ? m.prnu_pct.toFixed(3) : '—'}
                  </td>
                ),
                row: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {fmtDN(m?.row_noise_dn)}
                  </td>
                ),
                col: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {fmtDN(m?.col_noise_dn)}
                  </td>
                ),
                res: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {fmtDN(m?.residual_pixel_noise_dn)}
                  </td>
                ),
                rowOnly: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {fmtDN(m?.dsnu_row_only_dn)}
                  </td>
                ),
                colOnly: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {fmtDN(m?.dsnu_col_only_dn)}
                  </td>
                ),
                rowFreq: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {m?.row_peak_freq != null ? m.row_peak_freq.toFixed(4) : '—'}
                  </td>
                ),
                colFreq: (
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {m?.col_peak_freq != null ? m.col_peak_freq.toFixed(4) : '—'}
                  </td>
                ),
                hot: (
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: (m?.hot_pixel_count || 0) > 0 ? t.warn : t.textMuted,
                    }}
                  >
                    {m?.hot_pixel_count ?? '—'}
                  </td>
                ),
                cold: (
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: (m?.cold_pixel_count || 0) > 0 ? t.accent : t.textMuted,
                    }}
                  >
                    {m?.cold_pixel_count ?? '—'}
                  </td>
                ),
              };
              return (
                <tr
                  key={idx}
                  style={{
                    background: idx % 2 === 0 ? t.panel : t.panelAlt,
                    borderBottom: `1px solid ${t.border}`,
                  }}
                >
                  {cols.map((c) => (
                    <React.Fragment key={c.key}>{cellByKey[c.key]}</React.Fragment>
                  ))}
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  style={{ padding: 40, textAlign: 'center', color: t.textFaint }}
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FPN Histograms — bar chart of pixel-value distribution per ROI/channel.
// Reads `hist_bin_edges` + `hist_counts` from the per-ROI compute response.
// X-axis honors the modal-level DN ↔ %DR toggle.
// ---------------------------------------------------------------------------
const FPNHistogramsTab = ({
  channels,
  measurements,
  visibleRoiIdx,
  roiLabel,
  unit = 'DN',
  fullDR = 65535,
}) => {
  const t = useTheme();
  if (!channels.length || !visibleRoiIdx.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        Pick at least one channel + ROI.
      </div>
    );
  }
  return (
    <div>
      <div
        data-no-export
        style={{
          fontSize: 11,
          color: t.textMuted,
          marginBottom: 10,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        256-bin histogram of kept ROI pixels (PRE-drift). One panel per channel × ROI.
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 14,
        }}
      >
        {channels.flatMap((ch) =>
          visibleRoiIdx.map((i) => {
            const m = measurements[ch]?.[i];
            return (
              <FPNHistChart
                key={`${ch}-${i}`}
                channel={ch}
                roiName={roiLabel(i)}
                measurement={m}
                unit={unit}
                fullDR={fullDR}
              />
            );
          })
        )}
      </div>
    </div>
  );
};

const FPNHistChart = ({ channel, roiName, measurement, unit, fullDR }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 320,
    H = 180,
    PAD_L = 40,
    PAD_R = 8,
    PAD_T = 14,
    PAD_B = 28;
  const color = channelColor(channel);
  const xfmt = (v) => (unit === 'pctDR' ? `${((v / fullDR) * 100).toFixed(1)}%` : v.toFixed(0));
  if (!measurement?.hist_counts || !measurement?.hist_bin_edges) {
    return (
      <Chart channel={channel} sub={`· ${roiName}`} noExport>
        <div
          style={{
            color: t.textFaint,
            textAlign: 'center',
            paddingTop: 40,
            paddingBottom: 40,
            fontSize: 10.5,
          }}
        >
          (no data)
        </div>
      </Chart>
    );
  }
  const counts = measurement.hist_counts;
  const edges = measurement.hist_bin_edges;
  const lo = edges[0],
    hi = edges[edges.length - 1];
  const maxCount = Math.max(...counts) || 1;
  const xToPx = (v) => PAD_L + ((v - lo) / (hi - lo || 1)) * (W - PAD_L - PAD_R);
  const yToPx = (c) => PAD_T + (1 - c / maxCount) * (H - PAD_T - PAD_B);
  // Tick the x-axis at 5 evenly-spaced positions
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => lo + f * (hi - lo));

  // Stats lines: mean (±1σ) overlay if available
  const mean = measurement.mean_signal;
  const std = measurement.residual_pixel_noise_dn;

  return (
    <Chart
      channel={channel}
      sub={`· ${roiName} — μ=${xfmt(mean)} · σ_res=${xfmt(std)}`}
      exportName={`mantis-fpn-hist-${channel}-${roiName}`}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', background: 'transparent', borderRadius: 4 }}
      >
        {/* Y grid (3 lines) */}
        {[0, 0.5, 1].map((f) => {
          const y = PAD_T + (1 - f) * (H - PAD_T - PAD_B);
          return (
            <line
              key={f}
              x1={PAD_L}
              y1={y}
              x2={W - PAD_R}
              y2={y}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
            />
          );
        })}
        {/* Bars */}
        {counts.map((c, i) => {
          const x0 = xToPx(edges[i]);
          const x1 = xToPx(edges[i + 1]);
          const y = yToPx(c);
          return (
            <rect
              key={i}
              x={x0}
              y={y}
              width={Math.max(0.5, x1 - x0)}
              height={Math.max(0, H - PAD_B - y)}
              fill={color}
              fillOpacity={0.85}
            />
          );
        })}
        {/* Mean line */}
        {mean != null && mean >= lo && mean <= hi && (
          <line
            x1={xToPx(mean)}
            y1={PAD_T}
            x2={xToPx(mean)}
            y2={H - PAD_B}
            stroke={t.text}
            strokeWidth={scaled(style.axisStrokeWidth, style)}
            strokeDasharray="4 3"
          />
        )}
        {/* X tick labels */}
        {xTicks.map((v, i) => (
          <text
            key={i}
            x={xToPx(v)}
            y={H - PAD_B + 14}
            fontSize={scaled(style.tickSize, style)}
            fill={t.textMuted}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {xfmt(v)}
          </text>
        ))}
        {/* Y axis label */}
        <text
          x={PAD_L - 6}
          y={PAD_T + 4}
          fontSize={scaled(style.tickSize, style)}
          fill={t.textFaint}
          textAnchor="end"
        >
          {maxCount}
        </text>
        <text
          x={PAD_L - 6}
          y={H - PAD_B}
          fontSize={scaled(style.tickSize, style)}
          fill={t.textFaint}
          textAnchor="end"
        >
          0
        </text>
        {/* X axis label */}
        <text
          x={PAD_L + (W - PAD_L - PAD_R) / 2}
          y={H - 4}
          fontSize={scaled(style.tickSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
        >
          pixel value ({unit === 'pctDR' ? `% of ${fullDR}` : 'DN'})
        </text>
      </svg>
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// FPN Row/Col mean profiles — per-(channel × ROI) SVG cards
// ---------------------------------------------------------------------------
const FPNProfilesTab = ({ channels, measurements, _rois, visibleRoiIdx, roiLabel }) => {
  const t = useTheme();
  const cards = [];
  for (const i of visibleRoiIdx)
    for (const ch of channels) {
      const m = measurements[ch]?.[i];
      if (!m || m.error) continue;
      cards.push({ i, ch, m, label: roiLabel(i) });
    }
  if (!cards.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No measured data for the current filter.
      </div>
    );
  }
  return (
    <GridTabFrame
      caption={`${cards.length} profile cards · rows = y-index, cols = x-index · dashed = ROI mean`}
      n={cards.length}
      minCardPx={340}
      storageKey="analysis/fpn/profilesLayout"
    >
      {cards.map(({ i, ch, m, label }) => (
        <RowColCard key={`${ch}_${i}`} ch={ch} label={label} m={m} />
      ))}
    </GridTabFrame>
  );
};

const RowColCard = ({ ch, label, m }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const color = paletteColor(style, ch);
  const W = 320,
    H = 95,
    PAD_L = 30,
    PAD_R = 6,
    PAD_T = 6,
    PAD_B = 16;
  const plot = (label, values, stds) => {
    const vs = (values || []).map((v) => (v == null ? NaN : v));
    const valid = vs.filter(Number.isFinite);
    if (!valid.length) return null;
    const lo = Math.min(...valid),
      hi = Math.max(...valid);
    const mid = (lo + hi) / 2,
      range = Math.max(1e-9, hi - lo) * 1.15;
    const yMin = mid - range / 2,
      yMax = mid + range / 2;
    const N = vs.length;
    const xOf = (i) => PAD_L + (i / Math.max(1, N - 1)) * (W - PAD_L - PAD_R);
    const yOf = (v) => PAD_T + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD_T - PAD_B);
    const pts = vs
      .map((v, i) => (Number.isFinite(v) ? `${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}` : null))
      .filter(Boolean)
      .join(' ');
    // ±σ band (stds is same length)
    const bandPts = [];
    if (stds?.length) {
      for (let i = 0; i < N; i++) {
        const v = vs[i],
          s = stds[i];
        if (!Number.isFinite(v) || !Number.isFinite(s)) continue;
        bandPts.push(`${xOf(i).toFixed(2)},${yOf(v - s).toFixed(2)}`);
      }
      for (let i = N - 1; i >= 0; i--) {
        const v = vs[i],
          s = stds[i];
        if (!Number.isFinite(v) || !Number.isFinite(s)) continue;
        bandPts.push(`${xOf(i).toFixed(2)},${yOf(v + s).toFixed(2)}`);
      }
    }
    return (
      <g>
        {bandPts.length > 2 && (
          <polygon points={bandPts.join(' ')} fill={color} fillOpacity={0.13} stroke="none" />
        )}
        <line
          x1={PAD_L}
          y1={yOf(m.mean_signal)}
          x2={W - PAD_R}
          y2={yOf(m.mean_signal)}
          stroke={t.textFaint}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
          strokeDasharray="3 3"
        />
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth={scaled(style.lineWidth, style)}
        />
        <text
          x={PAD_L + 3}
          y={PAD_T + 9}
          fontSize={scaled(style.tickSize, style)}
          fill={t.textMuted}
        >
          {label}
        </text>
      </g>
    );
  };
  return (
    <Chart
      channel={ch}
      sub={`· ${label} — μ=${m.mean_signal.toFixed(1)} · σ=${m.dsnu_dn.toFixed(2)} · PRNU=${m.prnu_pct.toFixed(3)}%`}
      exportName={`mantis-fpn-rowcol-${ch}-${label}`}
      footer={
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          <span>σ_row = {m.row_noise_dn.toFixed(3)} DN</span>
          <span>σ_col = {m.col_noise_dn.toFixed(3)} DN</span>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateRows: 'auto auto', gap: 3 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          style={{ background: 'transparent', borderRadius: 4 }}
        >
          {plot('rows →', m.row_means, m.row_stds)}
        </svg>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          style={{ background: 'transparent', borderRadius: 4 }}
        >
          {plot('cols →', m.col_means, m.col_stds)}
        </svg>
      </div>
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// FPN 1-D PSDs — row + col spectra overlay per ROI (one plot per ROI,
// one trace per channel)
// ---------------------------------------------------------------------------
const FPNPSD1DTab = ({ channels, measurements, visibleRoiIdx, roiLabel }) => {
  const t = useTheme();
  if (!visibleRoiIdx.length || !channels.length) {
    return <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>No data.</div>;
  }
  return (
    <GridTabFrame
      caption={`${visibleRoiIdx.length} ROI${visibleRoiIdx.length === 1 ? '' : 's'} × ${channels.length} channel${channels.length === 1 ? '' : 's'} · axis 0 → ½ cy · peaks = periodic banding`}
      n={visibleRoiIdx.length}
      minCardPx={360}
      storageKey="analysis/fpn/psd1dLayout"
    >
      {(() =>
        visibleRoiIdx.map((i) => (
          <Chart key={i} title={roiLabel(i)} exportName={`mantis-fpn-psd1d-${roiLabel(i)}`}>
            <PSD1DChart axis="row" channels={channels} roiIdx={i} measurements={measurements} />
            <PSD1DChart axis="col" channels={channels} roiIdx={i} measurements={measurements} />
          </Chart>
        )))()}
    </GridTabFrame>
  );
};

const PSD1DChart = ({ axis, channels, roiIdx, measurements }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 340,
    H = 120,
    PAD_L = 36,
    PAD_R = 10,
    PAD_T = 10,
    PAD_B = 24;
  const key =
    axis === 'row'
      ? ['row_freq', 'row_psd', 'row_peak_freq']
      : ['col_freq', 'col_psd', 'col_peak_freq'];
  // Collect per-channel (freq, psd) drops DC
  const series = channels
    .map((ch) => {
      const m = measurements[ch]?.[roiIdx];
      if (!m || m.error) return null;
      const f = (m[key[0]] || []).slice(1);
      const p = (m[key[1]] || []).slice(1);
      if (!f.length || !p.length) return null;
      return { ch, f, p, peak: m[key[2]] };
    })
    .filter(Boolean);
  if (!series.length) return null;
  // Log y-axis based on pooled range
  let lo = Infinity,
    hi = -Infinity;
  for (const s of series)
    for (const v of s.p) {
      const l = Math.log10((v || 1e-12) + 1e-12);
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
  const range = Math.max(1e-9, hi - lo);
  const xToPx = (fx) => PAD_L + (fx / 0.5) * (W - PAD_L - PAD_R);
  const yToPx = (pv) =>
    PAD_T + (1 - (Math.log10((pv || 1e-12) + 1e-12) - lo) / range) * (H - PAD_T - PAD_B);
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: t.textFaint,
          marginBottom: 2,
          marginTop: 4,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        {axis === 'row' ? 'row-mean PSD' : 'col-mean PSD'}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ background: 'transparent', borderRadius: 4 }}
      >
        {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((fv) => (
          <g key={fv}>
            <line
              x1={xToPx(fv)}
              y1={PAD_T}
              x2={xToPx(fv)}
              y2={H - PAD_B}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
            />
            <text
              x={xToPx(fv)}
              y={H - PAD_B + 12}
              fontSize={scaled(style.tickSize, style)}
              fill={t.textMuted}
              textAnchor="middle"
            >
              {fv}
            </text>
          </g>
        ))}
        {series.map((s) => {
          const color = channelColor(s.ch);
          const pts = s.f
            .map((fx, i) => `${xToPx(fx).toFixed(2)},${yToPx(s.p[i]).toFixed(2)}`)
            .join(' ');
          return (
            <g key={s.ch}>
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth={scaled(style.lineWidth, style)}
                vectorEffect="non-scaling-stroke"
                opacity={0.9}
              />
              {s.peak > 0 && (
                <g>
                  <line
                    x1={xToPx(s.peak)}
                    y1={PAD_T}
                    x2={xToPx(s.peak)}
                    y2={H - PAD_B}
                    stroke={color}
                    strokeWidth={scaled(style.axisStrokeWidth, style)}
                    strokeDasharray="3 2"
                    opacity={0.7}
                  />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 10, marginTop: 3, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span
            key={s.ch}
            style={{
              fontSize: 9.5,
              color: channelColor(s.ch),
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            ● {s.ch} peak {s.peak ? s.peak.toFixed(4) : '—'}
          </span>
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// FPN native heatmap tabs (plot-style-completion-v1) — map / psd / autocorr
// render the server-shipped 2-D grids on a <canvas> in real time. The
// `figKey` prop is kept so the existing tab dispatch lines up, but every
// tab is now fully native (no server PNG).
// ---------------------------------------------------------------------------
const FPN_TAB_SPEC = {
  map: { gridKey: 'fpn_map_grid', cmap: 'rdbu', divergent: true, label: 'FPN map (image − μ)' },
  psd: { gridKey: 'psd_log_grid', cmap: 'magma', divergent: false, label: 'log-magnitude 2-D FFT' },
  autocorr: {
    gridKey: 'autocorr_grid',
    cmap: 'rdbu',
    divergent: true,
    label: 'normalized 2-D autocorrelation',
  },
};

const FPNFigureGrid = ({ channels, measurements, visibleRoiIdx, roiLabel, figKey, caption }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const spec = FPN_TAB_SPEC[figKey] || FPN_TAB_SPEC.map;
  const [cmap, setCmap] = useStateA(spec.cmap);
  const cards = [];
  for (const i of visibleRoiIdx)
    for (const ch of channels) {
      const m = measurements[ch]?.[i];
      const gridRaw = m?.[spec.gridKey];
      if (!gridRaw) continue;
      cards.push({ ch, i, m, gridRaw, label: roiLabel(i) });
    }
  if (!cards.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No {spec.label} data for the current selection.
      </div>
    );
  }
  const cmapOptions = spec.divergent
    ? [
        { value: 'rdbu', label: 'RdBu' },
        { value: 'turbo', label: 'Turbo' },
        { value: 'viridis', label: 'Viridis' },
        { value: 'gray', label: 'Gray' },
      ]
    : [
        { value: 'magma', label: 'Magma' },
        { value: 'viridis', label: 'Viridis' },
        { value: 'inferno', label: 'Inferno' },
        { value: 'plasma', label: 'Plasma' },
        { value: 'cividis', label: 'Cividis' },
        { value: 'gray', label: 'Gray' },
      ];
  return (
    <div>
      <div
        data-no-export
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          fontFamily: style.fontFamily,
          color: t.textMuted,
          fontSize: scaled(style.legendSize, style),
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600 }}>Colormap</span>
        <Segmented value={cmap} onChange={setCmap} options={cmapOptions} />
        {caption && <span style={{ marginLeft: 8 }}>{caption}</span>}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fit, minmax(420px, 1fr))`,
          gap: style.gridGap,
        }}
      >
        {cards.map(({ ch, i, m, gridRaw, label }) => (
          <FPNHeatmapCard
            key={`${ch}_${i}`}
            ch={ch}
            label={label}
            m={m}
            gridRaw={gridRaw}
            spec={spec}
            cmap={cmap}
          />
        ))}
      </div>
    </div>
  );
};

// Module-level DN formatter (raw — no %DR branch; the FPN summary tab
// has its own `fmtDN` that knows about the unit toggle).
const fmtDN0 = (v, d = 3) => (v == null || !Number.isFinite(v) ? '—' : v.toFixed(d));

const FPNHeatmapCard = ({ ch, label, m, gridRaw, spec, cmap }) => {
  const grid = useMemoA(() => decodeFloat32Grid(gridRaw), [gridRaw]);
  if (!grid) return null;
  const vmin = grid.stats.p1 ?? grid.stats.min;
  const vmax = grid.stats.p99 ?? grid.stats.max;
  const sub = spec.divergent
    ? `${spec.label} · σ = ${fmtDN0(m?.std ?? 0)}`
    : `${spec.label} · ${grid.w}×${grid.h} cells`;
  return (
    <Chart
      channel={ch}
      sub={`· ${label} — ${sub}`}
      footer={
        <HeatmapColorBar
          cmap={cmap}
          vmin={vmin}
          vmax={vmax}
          divergent={spec.divergent}
          label={spec.divergent ? 'DN − μ' : 'log(1+|F|)'}
        />
      }
    >
      <HeatmapCanvas
        grid={grid}
        cmap={cmap}
        divergent={spec.divergent}
        vmin={vmin}
        vmax={vmax}
        width={460}
        height={340}
        aspectLock={true}
      />
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// FPN hot / cold pixels — native: ROI image on canvas + SVG markers at the
// outlier coordinates + a compact HTML top-N table.
// ---------------------------------------------------------------------------
const FPNHotPixTab = ({ channels, measurements, visibleRoiIdx, roiLabel }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const cards = [];
  for (const i of visibleRoiIdx)
    for (const ch of channels) {
      const m = measurements[ch]?.[i];
      if (!m) continue;
      cards.push({ ch, i, m, label: roiLabel(i) });
    }
  if (!cards.length) {
    return <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>No data.</div>;
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(460px, 1fr))`,
        gap: style.gridGap,
      }}
    >
      {cards.map(({ ch, i, m, label }) => (
        <HotPixCard key={`${ch}_${i}`} ch={ch} label={label} m={m} />
      ))}
    </div>
  );
};

const HotPixCard = ({ ch, label, m }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const grid = useMemoA(() => decodeFloat32Grid(m?.image_grid), [m]);
  const hot = m?.top_hot || [];
  const cold = m?.top_cold || [];
  // The server may have strided the image down; we need to map original-ROI
  // pixel coords to the canvas (grid) coords using the same stride.
  const imgStrideY = m?.image_grid?.stride?.[0] || 1;
  const imgStrideX = m?.image_grid?.stride?.[1] || 1;
  return (
    <Chart channel={ch} sub={`· ${label}`} footer={<HotColdList m={m} />}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 6,
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: scaled(style.legendSize, style),
          fontWeight: style.legendWeight,
          color: m.hot_pixel_count > 0 ? t.warn : t.textMuted,
        }}
      >
        <span>hot {m?.hot_pixel_count ?? 0}</span>
        <span>cold {m?.cold_pixel_count ?? 0}</span>
        <span style={{ color: t.textMuted }}>
          |z| &gt; {(m?.settings?.hot_sigma ?? 4).toFixed(1)}
        </span>
      </div>
      <HeatmapCanvas
        grid={grid}
        cmap="gray"
        width={460}
        height={Math.round(460 * ((grid?.h || 1) / (grid?.w || 1)))}
        aspectLock={true}
      >
        {({ w: cssW, h: cssH, gridW, gridH }) => {
          if (!gridW || !gridH) return null;
          const xOf = (px) => (px / imgStrideX / gridW) * cssW;
          const yOf = (py) => (py / imgStrideY / gridH) * cssH;
          return (
            <g>
              {hot.map((p, idx) => (
                <circle
                  key={`h${idx}`}
                  cx={xOf(p.x)}
                  cy={yOf(p.y)}
                  r={Math.max(2, style.markerSize / 2)}
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth={style.markerStrokeWidth + 1}
                  opacity={0.9}
                >
                  <title>{`hot #${idx + 1} y=${p.y} x=${p.x} · ${fmtDN0(p.value)} · z=+${p.z.toFixed(2)}`}</title>
                </circle>
              ))}
              {cold.map((p, idx) => (
                <rect
                  key={`c${idx}`}
                  x={xOf(p.x) - style.markerSize / 2}
                  y={yOf(p.y) - style.markerSize / 2}
                  width={style.markerSize}
                  height={style.markerSize}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={style.markerStrokeWidth + 1}
                  opacity={0.9}
                >
                  <title>{`cold #${idx + 1} y=${p.y} x=${p.x} · ${fmtDN0(p.value)} · z=${p.z.toFixed(2)}`}</title>
                </rect>
              ))}
            </g>
          );
        }}
      </HeatmapCanvas>
    </Chart>
  );
};

const HotColdList = ({ m }) => {
  const t = useTheme();
  if (!m) return null;
  const hot = m.top_hot || [];
  const cold = m.top_cold || [];
  if (!hot.length && !cold.length) {
    return (
      <div style={{ fontSize: 10.5, color: t.success, textAlign: 'center', padding: '4px 0' }}>
        No outliers at the current |z| threshold.
      </div>
    );
  }
  const renderList = (list, color, label) => (
    <div>
      <div
        style={{
          fontSize: 10,
          color: t.textMuted,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 2,
        }}
      >
        {label} <span style={{ color }}>({list.length})</span>
      </div>
      <div
        style={{
          maxHeight: 100,
          overflow: 'auto',
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: 10,
          color: t.textMuted,
          lineHeight: 1.4,
        }}
      >
        {list.slice(0, 20).map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 8 }}>
            <span style={{ width: 28 }}>#{i + 1}</span>
            <span style={{ width: 72 }}>
              y={p.y} x={p.x}
            </span>
            <span style={{ width: 64 }}>{fmtDN0(p.value)}</span>
            <span style={{ color }}>
              z={p.z >= 0 ? '+' : ''}
              {p.z.toFixed(2)}
            </span>
          </div>
        ))}
        {list.length > 20 && <div style={{ color: t.textFaint }}>… {list.length - 20} more</div>}
      </div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {renderList(hot, '#ef4444', 'Hottest')}
      {renderList(cold, '#3b82f6', 'Coldest')}
    </div>
  );
};

// ---------------------------------------------------------------------------
// FPN compare — grouped bar chart: metric × ROI, one group per channel
// ---------------------------------------------------------------------------
const FPNCompareTab = ({ channels, measurements, _rois, visibleRoiIdx, roiLabel }) => {
  const t = useTheme();
  if (!channels.length || !visibleRoiIdx.length) {
    return <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>No data.</div>;
  }
  const metrics = [
    { key: 'dsnu_dn', label: 'DSNU (DN)', color: '#1f77b4' },
    { key: 'prnu_pct', label: 'PRNU (%)', color: '#d62728' },
    { key: 'row_noise_dn', label: 'σ row (DN)', color: '#2ca02c' },
    { key: 'col_noise_dn', label: 'σ col (DN)', color: '#9467bd' },
    { key: 'residual_pixel_noise_dn', label: 'σ res (DN)', color: '#ff7f0e' },
  ];
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: t.textMuted,
          marginBottom: 10,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        One panel per metric · bars grouped by ROI · colours = channel
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: 14,
        }}
      >
        {metrics.map((mm) => (
          <MetricBars
            key={mm.key}
            metric={mm}
            channels={channels}
            measurements={measurements}
            visibleRoiIdx={visibleRoiIdx}
            roiLabel={roiLabel}
          />
        ))}
      </div>
    </div>
  );
};

const MetricBars = ({ metric, channels, measurements, visibleRoiIdx, roiLabel }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 400,
    H = 220,
    PAD_L = 40,
    PAD_R = 14,
    PAD_T = 10,
    PAD_B = 50;
  // Collect values
  const rows = visibleRoiIdx.map((i) =>
    channels.map((ch) => {
      const m = measurements[ch]?.[i];
      return m && !m.error ? (m[metric.key] ?? 0) : 0;
    })
  );
  const all = rows.flat();
  const yMax = Math.max(...all, 1e-6) * 1.15 || 1;
  const groupW = (W - PAD_L - PAD_R) / Math.max(1, visibleRoiIdx.length);
  const barW = Math.max(2, (groupW - 4) / Math.max(1, channels.length));
  const yToPx = (v) => PAD_T + (1 - v / yMax) * (H - PAD_T - PAD_B);
  const yTicks = 5;
  return (
    <Chart title={metric.label} exportName={`mantis-fpn-compare-${metric.key}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ background: 'transparent', borderRadius: 4 }}
      >
        {Array.from({ length: yTicks + 1 }, (_, k) => (yMax * k) / yTicks).map((yv, k) => (
          <g key={k}>
            <line
              x1={PAD_L}
              y1={yToPx(yv)}
              x2={W - PAD_R}
              y2={yToPx(yv)}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
            />
            <text
              x={PAD_L - 5}
              y={yToPx(yv) + 3}
              fontSize={scaled(style.tickSize, style)}
              fill={t.textMuted}
              textAnchor="end"
            >
              {yv.toFixed(2)}
            </text>
          </g>
        ))}
        {visibleRoiIdx.map((i, gi) => (
          <g key={i} transform={`translate(${PAD_L + gi * groupW}, 0)`}>
            {channels.map((ch, ci) => {
              const v = rows[gi][ci];
              const color = paletteColor(style, ch);
              const x = 2 + ci * barW;
              const y = yToPx(v);
              return (
                <g key={ch}>
                  <rect
                    x={x}
                    y={y}
                    width={barW - 1}
                    height={H - PAD_B - y}
                    fill={color}
                    opacity={0.88}
                  >
                    <title>{`${ch} · ${roiLabel(i)}: ${v.toFixed(4)}`}</title>
                  </rect>
                </g>
              );
            })}
            <text
              x={groupW / 2}
              y={H - PAD_B + 14}
              fontSize={scaled(style.tickSize, style)}
              fill={t.textMuted}
              textAnchor="middle"
            >
              {roiLabel(i)}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        {channels.map((ch) => (
          <span
            key={ch}
            style={{
              fontSize: 10,
              color: paletteColor(style, ch),
              fontFamily: 'ui-monospace,Menlo,monospace',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: paletteColor(style, ch),
              }}
            />
            {ch}
          </span>
        ))}
      </div>
    </Chart>
  );
};

// ===========================================================================
// DoF analysis modal — native-vector tabs driven by the /api/dof/analyze
// multi-channel JSON payload (per-channel DoFChannelResult + per-ROI
// base64 PNGs for heatmaps / line scans / Gaussian fits / tilt plane).
//
// Tabs:
//   1. Summary            — per-channel × per-line metric table
//   2. Line scans         — overlaid focus curves with Gaussian fit
//   3. Gaussian fits      — server-rendered PNGs (per channel × per line)
//   4. Metric comparison  — all 4 metrics overlaid per line per channel
//   5. Chromatic shift    — peak position per channel (error bars = CI95)
//   6. Focus heatmaps     — server PNGs, per channel
//   7. Points / tilt      — per-channel focus bar chart + tilt plane PNG
//   8. Stability          — per-line DoF-width vs half-window curve (client)
// ===========================================================================
const DoFAnalysisModal = ({ run, onClose, onToast }) => {
  const t = useTheme();
  const plotStyleState = usePlotStyleState();
  const [styleOpen, setStyleOpen] = useStateA(false);
  // Response is state, not prop, so we can re-post /api/dof/analyze when
  // the user flips the top-bar Metric control and refresh every tab with
  // the newly-computed data.
  const [response, setResponse] = useStateA(run.response || {});
  const [_reRunning, setReRunning] = useStateA(false);
  const allChannels = response.channels || [];
  const results = response.results || {};
  const _thumbnails = response.channel_thumbnails || {};
  const _figures = response.figures || {};
  const settings = response.settings || {};

  // A list of user-drawn line specs we echoed back in `run.lines`.
  const allLines = run.lines || [];
  const allPoints = run.points || [];
  const lineLabel = (i) => allLines[i]?.label || `L${i + 1}`;
  const pointLabel = (i) => allPoints[i]?.label || `p${i + 1}`;

  const [chans, setChans] = useStateA(allChannels);
  const [gainFilter, setGainFilter] = useStateA('all');
  const [lineIdxFilter, setLineIdxFilter] = useStateA('all');
  const [tab, setTab] = useStateA('summary');
  // Primary metric filter — drives the whole analysis. Seeded from the
  // run's settings so initial render matches what the picker computed.
  // Changing it re-POSTs /api/dof/analyze with the new metric so every
  // tab (Summary / Lines / Gaussian / Heatmap / Chromatic / Points) gets
  // rebuilt against the new metric, not just the Metric-compare tab.
  const [metricFilter, setMetricFilter] = useStateA(
    run.response?.settings?.metric || run.metric || 'laplacian'
  );
  const [unitPref, setUnitPref] = useStateA('auto'); // B-0020
  // Tab-body background — shared with USAF / FPN via the `analysis/bgColor`
  // key so the user's preset (theme / white / black / transparent / custom
  // hex) carries across all three modals.
  const [bgColor, setBgColor] = useLocalStorageState('analysis/bgColor', null);
  const effectiveBg = bgColor || t.panelAlt;
  // B-0021 — live tilt-angle override. Seeded from the run payload. Clamped
  // to [0, 89]° in the input. tiltFactor = 1 / cos(θ·π/180); 1 when θ=0 so
  // uncalibrated / opted-out runs stay unaffected.
  const [tiltAngleDeg, setTiltAngleDeg] = useStateA(Number(run.tilt_angle_deg) || 0);
  const tiltFactor = useMemoA(() => {
    const d = Math.min(89, Math.max(0, Number(tiltAngleDeg) || 0));
    if (d === 0) return 1;
    return 1 / Math.cos((d * Math.PI) / 180);
  }, [tiltAngleDeg]);
  const anyCalibrated = useMemoA(
    () => Object.values(results).some((r) => (r?.lines || []).some(dofIsCalibrated)),
    [results]
  );

  // Re-run analysis on the server when the top-bar Metric flips so every
  // tab uses the new metric's peak / DoF / Gaussian / heatmap numbers.
  // Seeded from `settings.metric`, so nothing fires on first render.
  useEffectA(() => {
    const current = response?.settings?.metric;
    if (!current || current === metricFilter) return;
    if (!run?.source?.source_id || !run?.channels?.length) return;
    let alive = true;
    setReRunning(true);
    onToast?.(`Re-running analysis with ${metricFilter}…`);
    const body = {
      source_id: run.source.source_id,
      channels: run.channels,
      points: (run.points || []).map((p) => ({ x: p.x, y: p.y, label: p.label || '' })),
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
          onToast?.(`Switched to ${metricFilter}`, 'success');
        }
      })
      .catch((err) => {
        if (alive) onToast?.(`Re-run failed: ${err.detail || err.message}`, 'danger');
      })
      .finally(() => {
        if (alive) setReRunning(false);
      });
    return () => {
      alive = false;
    };
  }, [metricFilter]);

  const visibleChannels = useMemoA(() => {
    const base = chans.filter((c) => allChannels.includes(c));
    if (gainFilter === 'all') return base;
    return base.filter((c) => c.startsWith(gainFilter + '-'));
  }, [chans, gainFilter, allChannels]);

  const visibleLineIdx = useMemoA(() => {
    const n = allLines.length;
    if (lineIdxFilter === 'all') return Array.from({ length: n }, (_, i) => i);
    return [parseInt(lineIdxFilter)];
  }, [lineIdxFilter, allLines.length]);

  const tabs = [
    { key: 'summary', label: 'Summary' },
    { key: 'lines', label: 'Line scans' },
    { key: 'gaussian', label: 'Gaussian fits' },
    { key: 'metric', label: 'Metric compare' },
    { key: 'chromatic', label: 'Chromatic shift' },
    { key: 'heatmap', label: 'Focus heatmaps' },
    { key: 'points', label: 'Points / tilt' },
  ];

  const exportCSVRows = useCallbackA(() => {
    const rows = [];
    for (const ch of visibleChannels) {
      const r = results[ch];
      if (!r) continue;
      (r.lines || []).forEach((ln, i) => {
        if (!visibleLineIdx.includes(i)) return;
        const g = ln.gaussian || {};
        rows.push({
          channel: ch,
          kind: 'line',
          line_idx: i,
          label: lineLabel(i),
          p0_x: ln.p0?.[0],
          p0_y: ln.p0?.[1],
          p1_x: ln.p1?.[0],
          p1_y: ln.p1?.[1],
          peak_position_px: ln.peak_position_px?.toFixed?.(4),
          dof_low_px: ln.dof_low_px,
          dof_high_px: ln.dof_high_px,
          dof_width_px: ln.dof_width_px?.toFixed?.(4),
          gauss_converged: g.converged ? 1 : 0,
          gauss_mu_px: g.mu?.toFixed?.(4),
          gauss_sigma_px: g.sigma?.toFixed?.(4),
          gauss_fwhm_px: g.fwhm?.toFixed?.(4),
          gauss_r2: g.r_squared?.toFixed?.(4),
          peak_ci95_lo_px: ln.peak_ci95_px?.[0]?.toFixed?.(4),
          peak_ci95_hi_px: ln.peak_ci95_px?.[1]?.toFixed?.(4),
          dof_ci95_lo_px: ln.dof_width_ci95_px?.[0]?.toFixed?.(4),
          dof_ci95_hi_px: ln.dof_width_ci95_px?.[1]?.toFixed?.(4),
          unit_name: ln.unit_name || '',
          peak_position_unit: ln.peak_position_unit,
          dof_width_unit: ln.dof_width_unit,
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
      onToast?.('Nothing to export', 'warn');
      return;
    }
    exportCSV(`mantis-dof-${Date.now()}.csv`, rows);
    onToast?.(`Exported ${rows.length} rows`, 'success');
  }, [visibleChannels, visibleLineIdx, results, allLines, allPoints, onToast]);

  const exportJSONRaw = useCallbackA(() => {
    exportJSON(`mantis-dof-${Date.now()}.json`, {
      kind: 'mantis-dof-analysis',
      version: 1,
      exportedAt: new Date().toISOString(),
      channels: visibleChannels,
      lines: allLines,
      points: allPoints,
      settings,
      display: { unit_pref: unitPref, tilt_angle_deg: tiltAngleDeg, tilt_factor: tiltFactor },
      results: Object.fromEntries(visibleChannels.map((ch) => [ch, results[ch] ?? null])),
    });
    onToast?.('Exported analysis JSON', 'success');
  }, [
    visibleChannels,
    allLines,
    allPoints,
    settings,
    results,
    onToast,
    unitPref,
    tiltAngleDeg,
    tiltFactor,
  ]);

  const tabBodyRef = useRefA(null);
  const exportPNG = useCallbackA(async () => {
    const node = tabBodyRef.current;
    if (!node) {
      onToast?.('Export unavailable', 'danger');
      return;
    }
    try {
      onToast?.('Rendering…');
      const res = await mantisExport(
        node,
        `mantis-dof-${tab}-${Date.now()}`,
        plotStyleState.style,
        effectiveBg
      );
      onToast?.(`Exported ${tab} as ${res.format.toUpperCase()} (${res.scale}×)`, 'success');
    } catch (err) {
      onToast?.(`Export failed: ${err.message}`, 'danger');
    }
  }, [tab, effectiveBg, onToast, plotStyleState.style]);

  return (
    <PlotStyleCtx.Provider value={plotStyleState}>
      <div
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
                DoF analysis — {visibleChannels.length} channel
                {visibleChannels.length !== 1 ? 's' : ''} × {allLines.length} line
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
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  marginTop: 1,
                }}
              >
                metric={settings.metric} · half-win={settings.half_window}px · threshold=
                {(settings.threshold * 100).toFixed(0)}%{settings.bootstrap ? ' · bootstrap' : ''}
                {settings.compute_all_metrics ? ' · 4-metric sweep' : ''}
                {settings.fit_tilt_plane ? ' · tilt plane' : ''}
                {settings.calibration
                  ? ` · cal px/${settings.calibration.unit}`
                  : ' · uncalibrated'}
              </div>
            </div>
            <PlotStylePanel open={false} onToggle={() => setStyleOpen((s) => !s)} />
            <Button icon="image" onClick={exportPNG} title="Capture the active tab as a PNG">
              PNG
            </Button>
            <Button
              icon="download"
              onClick={exportCSVRows}
              title="Flat per-(channel × line/point) CSV"
            >
              CSV
            </Button>
            <Button
              icon="download"
              onClick={exportJSONRaw}
              title="Round-trippable raw analysis JSON"
            >
              JSON
            </Button>
            <Button variant="subtle" icon="close" onClick={onClose} size="sm" title="Close (Esc)" />
          </div>
          {styleOpen && <PlotStylePanel open={true} onToggle={() => setStyleOpen(false)} />}

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
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
              }}
            >
              Channels
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allChannels.map((c) => (
                <ChannelChip
                  key={c}
                  id={c.includes('-') ? c : `HG-${c}`}
                  multi
                  selected={chans.includes(c)}
                  onToggle={() =>
                    setChans((prev) =>
                      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                    )
                  }
                  size="sm"
                />
              ))}
              <Button size="xs" onClick={() => setChans(allChannels)}>
                All
              </Button>
              <Button size="xs" onClick={() => setChans([])}>
                None
              </Button>
            </div>
            {allChannels.some((c) => c.startsWith('HG-')) && (
              <>
                <span
                  style={{
                    fontSize: 10,
                    color: t.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginLeft: 6,
                  }}
                >
                  Gain
                </span>
                <Segmented
                  value={gainFilter}
                  onChange={setGainFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'HG', label: 'HG' },
                    { value: 'LG', label: 'LG' },
                  ]}
                />
              </>
            )}
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Line
            </span>
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
                <span
                  style={{
                    fontSize: 10,
                    color: t.textMuted,
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    marginLeft: 6,
                  }}
                >
                  Metric
                </span>
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
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Unit
            </span>
            <Segmented value={unitPref} onChange={setUnitPref} options={DOF_UNIT_OPTS} />
            {unitPref !== 'auto' && unitPref !== 'px' && !anyCalibrated && (
              <span
                title="No line is calibrated — values will fall back to pixels."
                style={{ fontSize: 10, color: t.warn, fontFamily: 'ui-monospace,Menlo,monospace' }}
              >
                calibration missing
              </span>
            )}
            <span
              style={{
                fontSize: 10,
                color: t.textMuted,
                fontWeight: 600,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                marginLeft: 6,
              }}
            >
              Tilt
            </span>
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
            <BgColorPicker bgColor={bgColor} setBgColor={setBgColor} />
          </div>

          <div
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
            {tabs.map((x) => (
              <button
                key={x.key}
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

          <div
            ref={tabBodyRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              padding: 16,
              background: bgColor === 'transparent' ? 'transparent' : effectiveBg,
              backgroundImage:
                bgColor === 'transparent'
                  ? 'linear-gradient(45deg, #d8dbe0 25%, transparent 25%), linear-gradient(-45deg, #d8dbe0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d8dbe0 75%), linear-gradient(-45deg, transparent 75%, #d8dbe0 75%)'
                  : undefined,
              backgroundSize: bgColor === 'transparent' ? '16px 16px' : undefined,
              backgroundPosition:
                bgColor === 'transparent' ? '0 0, 0 8px, 8px -8px, -8px 0px' : undefined,
            }}
          >
            {tab === 'summary' && (
              <DoFSummaryTab
                channels={visibleChannels}
                results={results}
                visibleLineIdx={visibleLineIdx}
                lineLabel={lineLabel}
                pointLabel={pointLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
            {tab === 'lines' && (
              <DoFLinesTab
                channels={visibleChannels}
                results={results}
                visibleLineIdx={visibleLineIdx}
                lineLabel={lineLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
            {tab === 'gaussian' && (
              <DoFGaussianTab
                channels={visibleChannels}
                results={results}
                visibleLineIdx={visibleLineIdx}
                lineLabel={lineLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
            {tab === 'metric' && (
              <DoFMetricCompareTab
                channels={visibleChannels}
                results={results}
                visibleLineIdx={visibleLineIdx}
                lineLabel={lineLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
            {tab === 'chromatic' && (
              <DoFChromaticTab
                channels={visibleChannels}
                results={results}
                visibleLineIdx={visibleLineIdx}
                lineLabel={lineLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
            {tab === 'heatmap' && (
              <DoFHeatmapTab
                channels={visibleChannels}
                results={results}
                lineLabel={lineLabel}
                pointLabel={pointLabel}
              />
            )}
            {tab === 'points' && (
              <DoFPointsTab
                channels={visibleChannels}
                results={results}
                pointLabel={pointLabel}
                unitPref={unitPref}
                tiltFactor={tiltFactor}
              />
            )}
          </div>
        </div>
      </div>
    </PlotStyleCtx.Provider>
  );
};

// ---------------------------------------------------------------------------
// Calibration helpers — pick the unit value off a line result when present,
// fall back to px. Used by every DoF modal tab so numbers display in the
// calibrated unit the user set on the picker.
//
// B-0020 — `unitPref` lets the user override the native unit from the modal:
//   'auto' → use whatever the line was calibrated in (picker default)
//   'px'   → always pixels
//   'μm' | 'mm' | 'cm' → convert from native → target via μm base;
//                        falls back to px when the line is uncalibrated.
// ---------------------------------------------------------------------------
const DOF_UNIT_IN_UM = { μm: 1, um: 1, mm: 1000, cm: 10000 };
const DOF_UNIT_OPTS = [
  { value: 'auto', label: 'Auto' },
  { value: 'px', label: 'px' },
  { value: 'μm', label: 'μm' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
];
const dofLineUnit = (ln) => ln?.unit_name || null;
const dofLinePerUnit = (ln) => ln?.px_per_unit || null;
const dofIsCalibrated = (ln) => !!(dofLineUnit(ln) && dofLinePerUnit(ln));
const dofDisplayUnit = (ln, pref = 'auto') => {
  if (pref === 'px') return 'px';
  if (pref === 'auto') return dofIsCalibrated(ln) ? dofLineUnit(ln) : 'px';
  return dofIsCalibrated(ln) && DOF_UNIT_IN_UM[pref] ? pref : 'px';
};
const dofToDisplay = (ln, px, pref = 'auto') => {
  if (px == null || !Number.isFinite(px)) return null;
  const target = dofDisplayUnit(ln, pref);
  if (target === 'px') return px;
  const native = dofLineUnit(ln);
  const per = dofLinePerUnit(ln);
  const nativeInUm = DOF_UNIT_IN_UM[native];
  const targetInUm = DOF_UNIT_IN_UM[target];
  if (!per || per <= 0 || !nativeInUm || !targetInUm) return px;
  return ((px / per) * nativeInUm) / targetInUm;
};
const dofDefaultDigits = (unit) => (unit === 'px' ? 2 : unit === 'μm' ? 1 : unit === 'mm' ? 3 : 4);
const dofFmt = (ln, px, prefOrDigits, maybeDigits) => {
  // Backward-compat: old call sites used dofFmt(ln, px, d). Detect that form
  // by inspecting the 3rd arg — a number means "pref is auto, d is that".
  const pref = typeof prefOrDigits === 'string' ? prefOrDigits : 'auto';
  const dPx =
    typeof prefOrDigits === 'number'
      ? prefOrDigits
      : typeof maybeDigits === 'number'
        ? maybeDigits
        : 2;
  if (px == null || !Number.isFinite(px)) return '—';
  const target = dofDisplayUnit(ln, pref);
  const v = dofToDisplay(ln, px, pref);
  if (v == null || !Number.isFinite(v)) return '—';
  const d = target === 'px' ? dPx : dofDefaultDigits(target);
  return `${v.toFixed(d)} ${target}`;
};

// ---------------------------------------------------------------------------
// DoF Summary — sortable table
// ---------------------------------------------------------------------------
// B-0021 — helper: scale a raw-pixel value by the tilt factor before
// formatting. Null / non-finite pass through unchanged so `dofFmt` can
// render an em-dash.
const dofScaled = (px, tiltFactor = 1) =>
  px == null || !Number.isFinite(px) ? px : px * tiltFactor;

const DoFSummaryTab = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  _pointLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  const [sortCol, setSortCol] = useStateA('order');
  const [sortDir, setSortDir] = useStateA('asc');
  const rows = useMemoA(() => {
    const out = [];
    for (const ch of channels) {
      const r = results[ch];
      if (!r) continue;
      (r.lines || []).forEach((ln, i) => {
        if (!visibleLineIdx.includes(i)) return;
        out.push({
          order: out.length,
          kind: 'line',
          ch,
          i,
          ln,
          label: lineLabel(i),
          g: ln.gaussian || {},
        });
      });
    }
    return out;
  }, [channels, results, visibleLineIdx, lineLabel]);
  const sorted = useMemoA(() => {
    const c = [...rows];
    const key =
      {
        order: (r) => r.order,
        channel: (r) => r.ch,
        label: (r) => r.label,
        peak: (r) => (r.g.converged ? r.g.mu : r.ln.peak_position_px) ?? -1,
        sigma: (r) => r.g.sigma ?? -1,
        fwhm: (r) => r.g.fwhm ?? -1,
        dof: (r) => r.ln.dof_width_px ?? -1,
        r2: (r) => r.g.r_squared ?? -1,
      }[sortCol] || ((r) => r.order);
    c.sort((a, b) => {
      const va = key(a),
        vb = key(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * (sortDir === 'asc' ? 1 : -1);
    });
    return c;
  }, [rows, sortCol, sortDir]);
  const setSort = (col) =>
    sortCol === col
      ? setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      : (setSortCol(col), setSortDir('asc'));

  // If every row has calibrated-unit data, re-label the column headers so
  // the user sees "Peak (µm)" / "DoF width (µm)" directly. Mixed calibrated/
  // uncalibrated falls back to the generic "Peak" / "DoF width" label; we
  // show per-row unit suffix in the cells themselves anyway. B-0020: when
  // the user overrides the unit preference from the filter bar, prefer that.
  const allHaveUnit = rows.length > 0 && rows.every((r) => dofLineUnit(r.ln));
  const displayedUnits = rows.map((r) => dofDisplayUnit(r.ln, unitPref));
  const allSameDisp =
    displayedUnits.length > 0 && displayedUnits.every((u) => u === displayedUnits[0]);
  const unitLabel = allSameDisp ? displayedUnits[0] : allHaveUnit ? rows[0].ln.unit_name : 'px';
  const cols = [
    { key: 'channel', label: 'Channel', align: 'left' },
    { key: 'label', label: 'Line', align: 'left' },
    { key: 'peak', label: `Peak (${unitLabel})` },
    { key: 'sigma', label: `σ (${unitLabel})` },
    { key: 'fwhm', label: `FWHM (${unitLabel})` },
    { key: 'dof', label: `DoF (${unitLabel})` },
    { key: 'r2', label: 'R²' },
  ];
  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          borderBottom: `1px solid ${t.border}`,
          fontSize: 12,
          color: t.textMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <span>
          {sorted.length} rows · {channels.length} channels × {visibleLineIdx.length} lines
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5 }}>click a header to sort</span>
      </div>
      <div style={{ maxHeight: 'calc(94vh - 320px)', overflow: 'auto' }}>
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontFamily: 'ui-monospace,Menlo,monospace',
            fontSize: 12,
          }}
        >
          <thead style={{ position: 'sticky', top: 0, background: t.panelAlt, zIndex: 1 }}>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => setSort(c.key)}
                  style={{
                    textAlign: c.align || 'right',
                    padding: '8px 12px',
                    fontSize: 10.5,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    fontWeight: 600,
                    color: t.textMuted,
                    borderBottom: `1px solid ${t.border}`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.label}
                  {sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => {
              const chColor = channelColor(row.ch);
              const r2 = row.g.r_squared;
              const r2Color =
                r2 == null ? t.textFaint : r2 >= 0.9 ? t.success : r2 >= 0.7 ? t.warn : t.danger;
              return (
                <tr
                  key={idx}
                  style={{
                    background: idx % 2 === 0 ? t.panel : t.panelAlt,
                    borderBottom: `1px solid ${t.border}`,
                  }}
                >
                  <td
                    style={{
                      padding: '7px 12px',
                      color: chColor,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{ width: 7, height: 7, borderRadius: '50%', background: chColor }}
                    />
                    {row.ch}
                  </td>
                  <td style={{ padding: '7px 12px', color: t.text }}>{row.label}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {dofFmt(
                      row.ln,
                      dofScaled(row.g.converged ? row.g.mu : row.ln.peak_position_px, tiltFactor),
                      unitPref,
                      2
                    )}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.textMuted }}>
                    {dofFmt(row.ln, dofScaled(row.g.sigma, tiltFactor), unitPref, 2)}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {dofFmt(row.ln, dofScaled(row.g.fwhm, tiltFactor), unitPref, 2)}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'right', color: t.text }}>
                    {dofFmt(row.ln, dofScaled(row.ln.dof_width_px, tiltFactor), unitPref, 2)}
                  </td>
                  <td
                    style={{
                      padding: '7px 12px',
                      textAlign: 'right',
                      color: r2Color,
                      fontWeight: 600,
                    }}
                  >
                    {r2?.toFixed?.(3) ?? '—'}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={cols.length}
                  style={{ padding: 40, textAlign: 'center', color: t.textFaint }}
                >
                  No lines to display.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DoF Lines — per-line overlay of all channels
// ---------------------------------------------------------------------------
const DoFLinesTab = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  if (!visibleLineIdx.length) {
    return <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>No lines.</div>;
  }
  return (
    <GridTabFrame
      caption="Each panel = one line · curves = per-channel normalized focus · dashed = Gaussian fit · green band = DoF at threshold"
      n={visibleLineIdx.length}
      minCardPx={420}
      storageKey="analysis/dof/linesLayout"
    >
      {visibleLineIdx.map((i) => (
        <LineOverlayChart
          key={i}
          idx={i}
          channels={channels}
          results={results}
          label={lineLabel(i)}
          unitPref={unitPref}
          tiltFactor={tiltFactor}
        />
      ))}
    </GridTabFrame>
  );
};

const LineOverlayChart = ({ idx, channels, results, label, unitPref = 'auto', tiltFactor = 1 }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 420,
    H = 260,
    PAD_L = 44,
    PAD_R = 14,
    PAD_T = 14,
    PAD_B = 36;
  // Collect per-channel line data.
  const series = channels
    .map((ch) => {
      const lr = results[ch]?.lines?.[idx];
      if (!lr || !lr.positions_px?.length) return null;
      return { ch, lr };
    })
    .filter(Boolean);
  if (!series.length) return null;
  // Axis unit: whatever `dofDisplayUnit` picks for the first series (all
  // series share a frame here, so we anchor on the first). Per-series
  // conversion uses that line's own `px_per_unit`. `toAxisFor` also folds
  // in the B-0021 tilt multiplier so displayed axis values are sample-
  // plane distances, not image-plane.
  const unitName = dofDisplayUnit(series[0].lr, unitPref);
  const toAxisFor = (lr) => (px) => {
    const v = dofToDisplay(lr, dofScaled(px, tiltFactor), unitPref);
    return v == null ? px : v;
  };
  const xsOf = (s) => s.lr.positions_px.map(toAxisFor(s.lr));
  const xMin = 0;
  const xMax = Math.max(
    ...series.map((s) => {
      const xs = xsOf(s);
      return xs[xs.length - 1];
    })
  );
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - Math.max(0, Math.min(1, y))) * (H - PAD_T - PAD_B);
  const xTicks = [
    xMin,
    xMin + (xMax - xMin) / 4,
    xMin + (xMax - xMin) / 2,
    xMin + (3 * (xMax - xMin)) / 4,
    xMax,
  ].map((v) => Math.round(v));
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const threshold = results[channels[0]]?.threshold ?? 0.5;

  return (
    <Chart sub={label} exportName={`mantis-dof-line-${label}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: 'transparent', borderRadius: 4, display: 'block' }}
      >
        {style.showGrid &&
          yTicks.map((y) => (
            <g key={y}>
              <line
                x1={PAD_L}
                y1={yOf(y)}
                x2={W - PAD_R}
                y2={yOf(y)}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
                opacity={style.gridOpacity}
              />
              <text
                x={PAD_L - 4}
                y={yOf(y) + 3}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="end"
                fontFamily={style.fontFamily}
              >
                {y.toFixed(2)}
              </text>
            </g>
          ))}
        {style.showGrid &&
          xTicks.map((x) => (
            <g key={x}>
              <line
                x1={xOf(x)}
                y1={PAD_T}
                x2={xOf(x)}
                y2={H - PAD_B}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
                opacity={style.gridOpacity}
              />
              <text
                x={xOf(x)}
                y={H - PAD_B + 13}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="middle"
                fontFamily={style.fontFamily}
              >
                {x}
              </text>
            </g>
          ))}
        <line
          x1={PAD_L}
          y1={yOf(threshold)}
          x2={W - PAD_R}
          y2={yOf(threshold)}
          stroke={t.warn}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
          strokeDasharray="4 3"
        />
        {series.map(({ ch, lr }) => {
          const color = paletteColor(style, ch);
          const xs = xsOf({ lr });
          const toAxisX = toAxisFor(lr);
          const pts = xs.map((x, i) => `${xOf(x)},${yOf(lr.focus_norm[i])}`).join(' ');
          const g = lr.gaussian;
          let gpts = null;
          if (g?.converged) {
            const peakRaw = Math.max(...lr.focus);
            gpts = lr.positions_px
              .map((px, i) => {
                const m = g.amp * Math.exp(-((px - g.mu) ** 2) / (2 * g.sigma ** 2)) + g.baseline;
                return `${xOf(xs[i])},${yOf(m / peakRaw)}`;
              })
              .join(' ');
          }
          const peakX = g?.converged ? g.mu : lr.peak_position_px;
          return (
            <g key={ch}>
              {lr.dof_low_px != null && lr.dof_high_px != null && (
                <rect
                  x={xOf(toAxisX(lr.dof_low_px))}
                  y={PAD_T}
                  width={xOf(toAxisX(lr.dof_high_px)) - xOf(toAxisX(lr.dof_low_px))}
                  height={H - PAD_T - PAD_B}
                  fill={color}
                  opacity={0.06}
                />
              )}
              <polyline
                points={pts}
                fill="none"
                stroke={color}
                strokeWidth={scaled(style.lineWidth, style)}
              />
              {gpts && (
                <polyline
                  points={gpts}
                  fill="none"
                  stroke={color}
                  strokeWidth={scaled(style.lineWidth, style)}
                  strokeDasharray="5 3"
                  opacity={0.7}
                />
              )}
              {peakX != null && (
                <g>
                  <line
                    x1={xOf(toAxisX(peakX))}
                    y1={yOf(1)}
                    x2={xOf(toAxisX(peakX))}
                    y2={yOf(0)}
                    stroke={color}
                    strokeWidth={scaled(style.axisStrokeWidth, style)}
                    opacity={0.5}
                    strokeDasharray="3 3"
                  />
                  <circle
                    cx={xOf(toAxisX(peakX))}
                    cy={yOf(1.02)}
                    r={2.5}
                    fill={color}
                    stroke="#fff"
                    strokeWidth={scaled(style.markerStrokeWidth, style)}
                  />
                </g>
              )}
              {lr.peak_ci95_px && (
                <line
                  x1={xOf(toAxisX(lr.peak_ci95_px[0]))}
                  y1={yOf(0.02)}
                  x2={xOf(toAxisX(lr.peak_ci95_px[1]))}
                  y2={yOf(0.02)}
                  stroke={color}
                  strokeWidth={scaled(style.lineWidth, style)}
                  opacity={0.7}
                />
              )}
            </g>
          );
        })}
        <text
          x={PAD_L + (W - PAD_L - PAD_R) / 2}
          y={H - 4}
          fontSize={scaled(style.axisLabelSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
        >
          position along line ({unitName})
        </text>
        <text
          x={11}
          y={PAD_T + (H - PAD_T - PAD_B) / 2}
          fontSize={scaled(style.axisLabelSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
          transform={`rotate(-90 11 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
        >
          normalized focus
        </text>
      </svg>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {series.map(({ ch, lr }) => {
          const g = lr.gaussian;
          const peakPx = g?.converged ? g.mu : lr.peak_position_px;
          return (
            <span
              key={ch}
              style={{
                fontSize: scaled(style.legendSize, style),
                fontWeight: style.legendWeight,
                color: paletteColor(style, ch),
                fontFamily: 'ui-monospace,Menlo,monospace',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <span
                style={{
                  width: Math.max(6, scaled(style.legendSize, style) * 0.8),
                  height: Math.max(6, scaled(style.legendSize, style) * 0.8),
                  borderRadius: '50%',
                  background: paletteColor(style, ch),
                }}
              />
              {ch}: peak {dofFmt(lr, dofScaled(peakPx, tiltFactor), unitPref, 1)}
              {lr.dof_width_px != null &&
                `, DoF ${dofFmt(lr, dofScaled(lr.dof_width_px, tiltFactor), unitPref, 1)}`}
            </span>
          );
        })}
      </div>
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// DoF Metric compare — per-line × per-channel overlay of the 4 metrics
// ---------------------------------------------------------------------------
const DoFMetricCompareTab = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  const cards = [];
  for (const i of visibleLineIdx)
    for (const ch of channels) {
      const lr = results[ch]?.lines?.[i];
      if (!lr?.metric_sweep) continue;
      cards.push({ i, ch, lr, label: lineLabel(i) });
    }
  if (!cards.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No multi-metric data. Enable &ldquo;All 4 metrics&rdquo; before running analysis.
      </div>
    );
  }
  return (
    <GridTabFrame
      caption="One panel per (channel × line) · 4 metrics overlaid · peaks should agree if the DoF estimate is robust."
      n={cards.length}
      minCardPx={380}
      storageKey="analysis/dof/metricCompareLayout"
    >
      {cards.map(({ ch, i, lr, label }) => (
        <MetricOverlayChart
          key={`${ch}_${i}`}
          ch={ch}
          lr={lr}
          label={label}
          unitPref={unitPref}
          tiltFactor={tiltFactor}
        />
      ))}
    </GridTabFrame>
  );
};

const MetricOverlayChart = ({ ch, lr, label, unitPref = 'auto', tiltFactor = 1 }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 380,
    H = 220,
    PAD_L = 40,
    PAD_R = 12,
    PAD_T = 14,
    PAD_B = 30;
  const METRIC_COLORS = {
    laplacian: '#1f77b4',
    brenner: '#d62728',
    tenengrad: '#2ca02c',
    fft_hf: '#9467bd',
  };
  const xsPx = lr.positions_px || [];
  if (!xsPx.length) return null;
  const unitName = dofDisplayUnit(lr, unitPref);
  const toAxis = (px) => {
    const v = dofToDisplay(lr, dofScaled(px, tiltFactor), unitPref);
    return v == null ? px : v;
  };
  const xs = xsPx.map(toAxis);
  const xMax = xs[xs.length - 1];
  const xOf = (x) => PAD_L + (x / (xMax || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - Math.max(0, Math.min(1, y))) * (H - PAD_T - PAD_B);
  return (
    <Chart channel={ch} sub={`· ${label}`} exportName={`mantis-dof-metric-${ch}-${label}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: 'transparent', borderRadius: 4, display: 'block' }}
      >
        {style.showGrid &&
          [0, 0.5, 1].map((y) => (
            <line
              key={y}
              x1={PAD_L}
              y1={yOf(y)}
              x2={W - PAD_R}
              y2={yOf(y)}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
              opacity={style.gridOpacity}
            />
          ))}
        {['laplacian', 'brenner', 'tenengrad', 'fft_hf'].map((m) => {
          const msw = lr.metric_sweep?.[m];
          if (!msw?.focus_norm) return null;
          const pts = xs.map((x, i) => `${xOf(x)},${yOf(msw.focus_norm[i])}`).join(' ');
          const peakAxis = msw.peak_position_px != null ? toAxis(msw.peak_position_px) : null;
          return (
            <g key={m}>
              <polyline
                points={pts}
                fill="none"
                stroke={METRIC_COLORS[m]}
                strokeWidth={scaled(style.lineWidth, style)}
                opacity={0.9}
              />
              {peakAxis != null && (
                <line
                  x1={xOf(peakAxis)}
                  y1={PAD_T}
                  x2={xOf(peakAxis)}
                  y2={H - PAD_B}
                  stroke={METRIC_COLORS[m]}
                  strokeWidth={scaled(style.axisStrokeWidth, style)}
                  strokeDasharray="3 2"
                  opacity={0.6}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
        {['laplacian', 'brenner', 'tenengrad', 'fft_hf'].map((m) => {
          const msw = lr.metric_sweep?.[m];
          if (!msw) return null;
          return (
            <span
              key={m}
              style={{
                fontSize: scaled(style.legendSize, style),
                fontWeight: style.legendWeight,
                color: METRIC_COLORS[m],
                fontFamily: 'ui-monospace,Menlo,monospace',
              }}
            >
              ● {m} peak {dofFmt(lr, dofScaled(msw.peak_position_px, tiltFactor), unitPref, 1)}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 4,
          fontSize: scaled(style.legendSize, style),
          fontWeight: style.legendWeight,
          color: t.textFaint,
          fontFamily: style.fontFamily,
        }}
      >
        position along line ({unitName})
      </div>
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// DoF Chromatic shift — native visualization + server PNG reference
// ---------------------------------------------------------------------------
const DoFChromaticTab = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  if (!visibleLineIdx.length || channels.length < 2) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        Need ≥2 channels and ≥1 line to show chromatic shift.
      </div>
    );
  }
  return (
    <div>
      <div
        style={{
          fontSize: scaled(style.legendSize, style),
          color: t.textMuted,
          fontWeight: style.legendWeight,
          marginBottom: 10,
          fontFamily: style.fontFamily,
        }}
      >
        Peak position per channel per line. Error bars = 95% bootstrap CI. Spread across channels =
        chromatic focus shift.
      </div>
      {/* Single chart — bound width so it stops ballooning to fill a wide
          modal (otherwise the viewBox scales, and so do all the SVG
          labels inside). Center it for balance. */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: '100%', maxWidth: 640 }}>
          <ChromaticShiftChart
            channels={channels}
            results={results}
            visibleLineIdx={visibleLineIdx}
            lineLabel={lineLabel}
            unitPref={unitPref}
            tiltFactor={tiltFactor}
          />
        </div>
      </div>
    </div>
  );
};

const ChromaticShiftChart = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 400,
    H = 260,
    PAD_L = 50,
    PAD_R = 16,
    PAD_T = 14,
    PAD_B = 40;
  const xOf = (i) => PAD_L + ((i + 0.5) / Math.max(1, visibleLineIdx.length)) * (W - PAD_L - PAD_R);
  // B-0020 — honour the modal-level unit preference. Each line still carries
  // its own `px_per_unit`, so we convert per-line via `dofToDisplay`. The
  // axis label uses the first line's display unit as the representative.
  // B-0021 — also applies tilt correction before the unit conversion so axis
  // values sit in sample-plane space.
  const firstLn = results[channels[0]]?.lines?.[visibleLineIdx[0]];
  const unitName = firstLn ? dofDisplayUnit(firstLn, unitPref) : 'px';
  const asAxis = (ln, px) => {
    const v = dofToDisplay(ln, dofScaled(px, tiltFactor), unitPref);
    return v == null ? px : v;
  };

  const allPeaks = [];
  for (const ch of channels) {
    const r = results[ch];
    for (const i of visibleLineIdx) {
      const ln = r?.lines?.[i];
      if (!ln) continue;
      const peak = ln.gaussian?.converged ? ln.gaussian.mu : ln.peak_position_px;
      if (peak != null) allPeaks.push(asAxis(ln, peak));
    }
  }
  if (!allPeaks.length) return null;
  const yMin = Math.min(...allPeaks) * 0.9;
  const yMax = Math.max(...allPeaks) * 1.1;
  const yOf = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  return (
    <Chart sub={`Peak position per channel (${unitName})`} exportName="mantis-dof-chromatic">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: 'transparent', borderRadius: 4, display: 'block' }}
      >
        {style.showGrid &&
          [yMin, (yMin + yMax) / 2, yMax].map((y) => (
            <g key={y}>
              <line
                x1={PAD_L}
                y1={yOf(y)}
                x2={W - PAD_R}
                y2={yOf(y)}
                stroke={t.border}
                strokeWidth={scaled(style.gridWidth, style)}
                opacity={style.gridOpacity}
              />
              <text
                x={PAD_L - 4}
                y={yOf(y) + 3}
                fontSize={scaled(style.tickSize, style)}
                fill={t.textMuted}
                textAnchor="end"
                fontFamily={style.fontFamily}
              >
                {y.toFixed(unitName === 'μm' ? 1 : 3)}
              </text>
            </g>
          ))}
        {visibleLineIdx.map((idx, i) => {
          const x = xOf(i);
          return channels.map((ch, ci) => {
            const ln = results[ch]?.lines?.[idx];
            if (!ln) return null;
            const peakPx = ln.gaussian?.converged ? ln.gaussian.mu : ln.peak_position_px;
            if (peakPx == null) return null;
            const peak = asAxis(ln, peakPx);
            const color = paletteColor(style, ch);
            const xOffset = (ci - (channels.length - 1) / 2) * 6;
            const ci95 = ln.peak_ci95_px;
            return (
              <g key={`${idx}_${ch}`}>
                {ci95 && (
                  <line
                    x1={x + xOffset}
                    y1={yOf(asAxis(ln, ci95[0]))}
                    x2={x + xOffset}
                    y2={yOf(asAxis(ln, ci95[1]))}
                    stroke={color}
                    strokeWidth={scaled(style.lineWidth, style)}
                    opacity={0.7}
                  />
                )}
                <circle
                  cx={x + xOffset}
                  cy={yOf(peak)}
                  r={scaled(style.markerSize / 2, style)}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={scaled(style.markerStrokeWidth, style)}
                >
                  <title>{`${ch} · ${lineLabel(idx)}: peak ${dofFmt(ln, dofScaled(peakPx, tiltFactor), unitPref, 3)}`}</title>
                </circle>
              </g>
            );
          });
        })}
        {visibleLineIdx.map((idx, i) => (
          <text
            key={idx}
            x={xOf(i)}
            y={H - PAD_B + 16}
            fontSize={scaled(style.axisLabelSize, style)}
            fill={t.textMuted}
            textAnchor="middle"
          >
            {lineLabel(idx)}
          </text>
        ))}
        <text
          x={11}
          y={PAD_T + (H - PAD_T - PAD_B) / 2}
          fontSize={scaled(style.axisLabelSize, style)}
          fill={t.textMuted}
          textAnchor="middle"
          transform={`rotate(-90 11 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
        >
          peak position ({unitName})
        </text>
      </svg>
      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
        {channels.map((ch) => (
          <span
            key={ch}
            style={{
              fontSize: scaled(style.legendSize, style),
              fontWeight: style.legendWeight,
              color: paletteColor(style, ch),
              fontFamily: 'ui-monospace,Menlo,monospace',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span
              style={{
                width: Math.max(6, scaled(style.legendSize, style) * 0.8),
                height: Math.max(6, scaled(style.legendSize, style) * 0.8),
                borderRadius: '50%',
                background: paletteColor(style, ch),
              }}
            />
            {ch}
          </span>
        ))}
      </div>
    </Chart>
  );
};

// ---------------------------------------------------------------------------
// Generic DoF figure grid (heatmaps / Gaussian fits / etc.)
// ---------------------------------------------------------------------------
// ===========================================================================
// Native DoF tabs (plot-style-completion-v1) — no server-rendered images.
// All three of these replace the old DoFFigureGrid / DoFPointsTab PNG paths.
// Every inline SVG + canvas reads from plotStyle for typography, line width,
// grid, markers, card chrome, and palette.
// ===========================================================================

// Shared card chrome + title for all DoF/FPN native tab cards.
// Single export path — used by per-card PNG buttons and the modal's
// top-bar PNG button. dom-to-image-more supports a native `scale`
// option, so we drop the old transform-scale hack that was shifting
// SVG <text> on export. Honors plotStyle.exportScale / exportFormat /
// exportBackground. `copyDefaultStyles: false` avoids the deep
// getComputedStyle walk that trips over the Google-Fonts cross-origin
// stylesheet and can stall the export forever.
const mantisExport = async (node, filename, plotStyle, themeFallbackBg) => {
  if (!node) throw new Error('no node to export');
  const dti = domtoimage;
  if (!dti) throw new Error('dom-to-image not loaded');
  const ps = plotStyle || {};
  const scale = Number.isFinite(ps.exportScale) ? ps.exportScale : 2;
  const format = ps.exportFormat === 'svg' ? 'svg' : 'png';
  const bg =
    ps.exportBackground === 'transparent'
      ? 'transparent'
      : ps.exportBackground === 'white'
        ? '#ffffff'
        : themeFallbackBg || '#ffffff';
  // Hide any `data-no-export` bits (per-card download buttons, tab
  // toolbars) so they don't appear in the exported image.
  const hidden = [...node.querySelectorAll('[data-no-export]')];
  const prevDisp = hidden.map((n) => n.style.display);
  hidden.forEach((n) => {
    n.style.display = 'none';
  });
  // Freeze inner <svg> pixel sizes before serialization. Charts render with
  // `width="100%"` at browse time, but dom-to-image rasterizes via a data-
  // URL SVG image where percentage widths collapse to the default 300×150,
  // shifting polyline / circle / text into different pixel positions
  // depending on which child measures first. Lock all child SVGs to their
  // on-screen pixel size so polyline + dots + axes stay aligned.
  const svgs = [...node.querySelectorAll('svg')];
  const origSvgAttrs = svgs.map((s) => {
    const r = s.getBoundingClientRect();
    const prev = {
      w: s.getAttribute('width'),
      h: s.getAttribute('height'),
      pa: s.getAttribute('preserveAspectRatio'),
    };
    if (r.width && r.height) {
      s.setAttribute('width', String(Math.round(r.width)));
      s.setAttribute('height', String(Math.round(r.height)));
      // Force exact viewBox→canvas mapping so there's no letterbox drift.
      s.setAttribute('preserveAspectRatio', 'none');
    }
    return { svg: s, prev };
  });
  void node.offsetHeight;
  const opts = {
    scale,
    width: node.scrollWidth,
    height: node.scrollHeight,
    copyDefaultStyles: false,
    cacheBust: true,
  };
  if (bg !== 'transparent') opts.bgcolor = bg;
  // 15-second watchdog so a hung stylesheet walk can't freeze the UI.
  const withTimeout = (promise, ms) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`export timed out after ${ms / 1000}s`)), ms)
      ),
    ]);
  let blob;
  try {
    if (format === 'svg') {
      const dataUrl = await withTimeout(dti.toSvg(node, opts), 15000);
      const svgText = decodeURIComponent(
        dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, '')
      );
      blob = new Blob([svgText], { type: 'image/svg+xml' });
    } else {
      blob = await withTimeout(dti.toBlob(node, opts), 15000);
    }
  } finally {
    hidden.forEach((n, i) => {
      n.style.display = prevDisp[i] || '';
    });
    // Restore original SVG attributes so on-screen layout snaps back.
    origSvgAttrs.forEach(({ svg, prev }) => {
      if (prev.w == null) svg.removeAttribute('width');
      else svg.setAttribute('width', prev.w);
      if (prev.h == null) svg.removeAttribute('height');
      else svg.setAttribute('height', prev.h);
      if (prev.pa == null) svg.removeAttribute('preserveAspectRatio');
      else svg.setAttribute('preserveAspectRatio', prev.pa);
    });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { format, scale, bytes: blob.size };
};

// analysis-page-overhaul-v1 Phase 4 Wave A (this commit) — `ChartCard` is
// gone. All 8 callers ported to `<Chart>` (shared.tsx). Per-card PNG now
// flows through `renderChartToPng` instead of the local `mantisExport`,
// which partially advances Phase 5; `mantisExport` retires when the modal-
// level (USAF/FPN/DoF) Export PNG buttons follow in Phase 5.

// Native SVG Gaussian fit chart. For each (channel × line) we have the raw
// focus samples (`ln.focus_norm`), the fit parameters (`ln.gaussian`), and
// the bootstrap CI (`ln.peak_ci95_px` + `ln.dof_width_ci95_px`). We sample
// the fit curve client-side at 120 evenly-spaced positions along the line.
const DoFGaussianTab = ({
  channels,
  results,
  visibleLineIdx,
  lineLabel,
  unitPref = 'auto',
  tiltFactor = 1,
}) => {
  const t = useTheme();
  const cards = [];
  for (const ch of channels) {
    for (const i of visibleLineIdx) {
      const ln = results[ch]?.lines?.[i];
      if (!ln || !ln.positions_px?.length) continue;
      cards.push({ ch, i, ln });
    }
  }
  if (!cards.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No lines with sampled focus data.
      </div>
    );
  }
  return (
    <GridTabFrame
      caption="Gaussian fit overlay per (channel × line). Solid = normalized focus; dashed = parametric Gaussian fit; shaded band = ±95% bootstrap CI on the peak."
      n={cards.length}
      minCardPx={440}
      storageKey="analysis/dof/gaussianLayout"
    >
      {cards.map(({ ch, i, ln }) => (
        <GaussianFitChart
          key={`${ch}_${i}`}
          ch={ch}
          ln={ln}
          label={lineLabel(i)}
          unitPref={unitPref}
          tiltFactor={tiltFactor}
        />
      ))}
    </GridTabFrame>
  );
};

const GaussianFitChart = ({ ch, ln, label, unitPref = 'auto', tiltFactor = 1 }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const W = 460,
    H = 260,
    PAD_L = 50,
    PAD_R = 14,
    PAD_T = 20,
    PAD_B = 44;
  const color = paletteColor(style, ch);
  const g = ln.gaussian || {};
  const converged = !!g.converged;
  const xsPx = ln.positions_px;
  const xsAxis = xsPx.map((px) => dofToDisplay(ln, dofScaled(px, tiltFactor), unitPref) ?? px);
  const unitName = dofDisplayUnit(ln, unitPref);

  const xMin = 0;
  const xMax = Math.max(...xsAxis);
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - Math.max(0, Math.min(1, y))) * (H - PAD_T - PAD_B);

  // Sample the parametric fit curve at N positions for a smooth overlay.
  const fitSamples = converged
    ? Array.from({ length: 120 }, (_, k) => {
        const frac = k / 119;
        const px = xsPx[0] + frac * (xsPx[xsPx.length - 1] - xsPx[0]);
        const raw = g.amp * Math.exp(-((px - g.mu) ** 2) / (2 * g.sigma ** 2)) + g.baseline;
        const peakRaw = Math.max(...ln.focus);
        return {
          ax: dofToDisplay(ln, dofScaled(px, tiltFactor), unitPref) ?? px,
          y: raw / peakRaw,
        };
      })
    : null;

  const peakAxis = converged ? dofToDisplay(ln, dofScaled(g.mu, tiltFactor), unitPref) : null;
  const ci = ln.peak_ci95_px
    ? [
        dofToDisplay(ln, dofScaled(ln.peak_ci95_px[0], tiltFactor), unitPref),
        dofToDisplay(ln, dofScaled(ln.peak_ci95_px[1], tiltFactor), unitPref),
      ]
    : null;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, xMax * 0.25, xMax * 0.5, xMax * 0.75, xMax];

  const fmt = (v) =>
    Number.isFinite(v)
      ? unitName === 'px'
        ? v.toFixed(1)
        : v.toFixed(unitName === 'μm' ? 1 : 3)
      : '—';

  return (
    <Chart
      channel={ch}
      sub={
        <>
          · {label}
          {unitName !== 'px' && ` · ${unitName}`}
          {tiltFactor !== 1 &&
            ` · θ=${((Math.acos(1 / tiltFactor) * 180) / Math.PI || 0).toFixed(0)}°`}
        </>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ background: 'transparent', borderRadius: 4, display: 'block' }}
      >
        {style.showGrid &&
          yTicks.map((y) => (
            <line
              key={`gy${y}`}
              x1={PAD_L}
              y1={yOf(y)}
              x2={W - PAD_R}
              y2={yOf(y)}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
              opacity={style.gridOpacity}
            />
          ))}
        {style.showGrid &&
          xTicks.map((x) => (
            <line
              key={`gx${x}`}
              x1={xOf(x)}
              y1={PAD_T}
              x2={xOf(x)}
              y2={H - PAD_B}
              stroke={t.border}
              strokeWidth={scaled(style.gridWidth, style)}
              opacity={style.gridOpacity}
            />
          ))}
        {/* Axes */}
        <line
          x1={PAD_L}
          y1={H - PAD_B}
          x2={W - PAD_R}
          y2={H - PAD_B}
          stroke={t.textMuted}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
        />
        <line
          x1={PAD_L}
          y1={PAD_T}
          x2={PAD_L}
          y2={H - PAD_B}
          stroke={t.textMuted}
          strokeWidth={scaled(style.axisStrokeWidth, style)}
        />
        {/* CI band on peak */}
        {ci && ci[0] != null && ci[1] != null && (
          <rect
            x={xOf(ci[0])}
            y={PAD_T}
            width={Math.max(1, xOf(ci[1]) - xOf(ci[0]))}
            height={H - PAD_T - PAD_B}
            fill={color}
            opacity={0.12}
          />
        )}
        {/* DoF band */}
        {ln.dof_low_px != null && ln.dof_high_px != null && (
          <rect
            x={xOf(dofToDisplay(ln, dofScaled(ln.dof_low_px, tiltFactor), unitPref))}
            y={PAD_T}
            width={Math.max(
              1,
              xOf(dofToDisplay(ln, dofScaled(ln.dof_high_px, tiltFactor), unitPref)) -
                xOf(dofToDisplay(ln, dofScaled(ln.dof_low_px, tiltFactor), unitPref))
            )}
            height={H - PAD_T - PAD_B}
            fill="#1a7f37"
            opacity={0.1}
          />
        )}
        {/* Samples */}
        <polyline
          points={xsAxis.map((x, k) => `${xOf(x)},${yOf(ln.focus_norm[k])}`).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={scaled(style.lineWidth, style)}
          opacity={0.95}
          vectorEffect="non-scaling-stroke"
        />
        {xsAxis.map((x, k) => (
          <circle
            key={k}
            cx={xOf(x)}
            cy={yOf(ln.focus_norm[k])}
            r={style.markerSize / 2.4}
            fill={color}
            stroke="#fff"
            strokeWidth={scaled(style.markerStrokeWidth, style)}
          />
        ))}
        {/* Fit curve */}
        {fitSamples && (
          <polyline
            points={fitSamples.map((s) => `${xOf(s.ax)},${yOf(s.y)}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth={scaled(style.lineWidth, style)}
            strokeDasharray="6 4"
            opacity={0.75}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Peak marker */}
        {peakAxis != null && (
          <g>
            <line
              x1={xOf(peakAxis)}
              y1={PAD_T}
              x2={xOf(peakAxis)}
              y2={H - PAD_B}
              stroke={color}
              strokeWidth={scaled(style.axisStrokeWidth, style)}
              strokeDasharray="3 3"
              opacity={0.7}
            />
            <circle
              cx={xOf(peakAxis)}
              cy={yOf(1)}
              r={style.markerSize / 1.5}
              fill={color}
              stroke="#fff"
              strokeWidth={scaled(style.markerStrokeWidth, style)}
            />
          </g>
        )}
        {/* Tick labels */}
        {yTicks.map((y) => (
          <text
            key={`ty${y}`}
            x={PAD_L - 6}
            y={yOf(y) + scaled(style.tickSize, style) * 0.35}
            fontSize={scaled(style.tickSize, style)}
            fill={t.textMuted}
            fontFamily={style.fontFamily}
            textAnchor="end"
          >
            {y.toFixed(2)}
          </text>
        ))}
        {xTicks.map((x) => (
          <text
            key={`tx${x.toFixed(1)}`}
            x={xOf(x)}
            y={H - PAD_B + scaled(style.tickSize, style) * 1.4}
            fontSize={scaled(style.tickSize, style)}
            fill={t.textMuted}
            fontFamily={style.fontFamily}
            textAnchor="middle"
          >
            {fmt(x)}
          </text>
        ))}
        {/* Axis labels */}
        <text
          x={PAD_L + (W - PAD_L - PAD_R) / 2}
          y={H - 4}
          fontSize={scaled(style.axisLabelSize, style)}
          fontWeight={style.axisLabelWeight}
          fill={t.textMuted}
          fontFamily={style.fontFamily}
          textAnchor="middle"
        >
          position along line ({unitName})
        </text>
        <text
          x={12}
          y={PAD_T + (H - PAD_T - PAD_B) / 2}
          fontSize={scaled(style.axisLabelSize, style)}
          fontWeight={style.axisLabelWeight}
          fill={t.textMuted}
          fontFamily={style.fontFamily}
          textAnchor="middle"
          transform={`rotate(-90 12 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
        >
          normalized focus
        </text>
      </svg>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          marginTop: 8,
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: scaled(style.legendSize, style),
          fontWeight: style.legendWeight,
          color: t.textMuted,
        }}
      >
        {converged ? (
          <>
            <span>
              μ{' '}
              <b style={{ color: t.text }}>
                {dofFmt(ln, dofScaled(g.mu, tiltFactor), unitPref, 2)}
              </b>
            </span>
            <span>
              σ{' '}
              <b style={{ color: t.text }}>
                {dofFmt(ln, dofScaled(g.sigma, tiltFactor), unitPref, 2)}
              </b>
            </span>
            <span>
              FWHM{' '}
              <b style={{ color: t.text }}>
                {dofFmt(ln, dofScaled(g.fwhm, tiltFactor), unitPref, 2)}
              </b>
            </span>
            <span>
              R²{' '}
              <b
                style={{
                  color: g.r_squared >= 0.9 ? t.success : g.r_squared >= 0.7 ? t.warn : t.danger,
                }}
              >
                {g.r_squared?.toFixed?.(3) ?? '—'}
              </b>
            </span>
            {ln.dof_width_px != null && (
              <span>
                DoF{' '}
                <b style={{ color: t.text }}>
                  {dofFmt(ln, dofScaled(ln.dof_width_px, tiltFactor), unitPref, 2)}
                </b>
              </span>
            )}
          </>
        ) : (
          <span>fit did not converge</span>
        )}
      </div>
    </Chart>
  );
};

// Native focus heatmap — canvas + SVG overlay for picks.
const DoFHeatmapTab = ({ channels, results, lineLabel, pointLabel }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const [cmap, setCmap] = useStateA('viridis');
  const cards = channels.filter((ch) => results[ch]?.heatmap_grid);
  if (!cards.length) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No focus heatmap data. Re-run analysis — the compute must have been fast enough to skip the
        heatmap pass.
      </div>
    );
  }
  return (
    <div>
      <div
        data-no-export
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
          fontFamily: style.fontFamily,
          fontSize: scaled(style.legendSize, style),
          color: t.textMuted,
        }}
      >
        <span style={{ fontWeight: 600 }}>Colormap</span>
        <Segmented
          value={cmap}
          onChange={setCmap}
          options={[
            { value: 'viridis', label: 'Viridis' },
            { value: 'magma', label: 'Magma' },
            { value: 'inferno', label: 'Inferno' },
            { value: 'plasma', label: 'Plasma' },
            { value: 'turbo', label: 'Turbo' },
            { value: 'cividis', label: 'Cividis' },
            { value: 'gray', label: 'Gray' },
          ]}
        />
      </div>
      <GridTabFrame
        caption="Per-channel focus heatmap over the whole image. Brightest region = best focus. Picked points + lines overlay in white."
        n={cards.length}
        minCardPx={460}
        storageKey="analysis/dof/heatmapLayout"
      >
        {cards.map((ch) => (
          <DoFHeatmapCard
            key={ch}
            ch={ch}
            r={results[ch]}
            cmap={cmap}
            lineLabel={lineLabel}
            pointLabel={pointLabel}
          />
        ))}
      </GridTabFrame>
    </div>
  );
};

const DoFHeatmapCard = ({ ch, r, cmap, _lineLabel, _pointLabel }) => {
  const { style } = usePlotStyle();
  const grid = useMemoA(() => decodeFloat32Grid(r.heatmap_grid), [r.heatmap_grid]);
  if (!grid) return null;
  const step = r.heatmap_step || 48;
  const imgH = r.image_grid?.dims?.[0]
    ? r.image_grid.dims[0] * (r.image_grid.stride?.[0] || 1)
    : grid.h * step;
  const imgW = r.image_grid?.dims?.[1]
    ? r.image_grid.dims[1] * (r.image_grid.stride?.[1] || 1)
    : grid.w * step;
  // Map image-space px → canvas-space px (canvas is drawn at grid resolution
  // then CSS-scaled; overlays use viewBox aligned to the heatmap grid).
  const toCv = (imgPx, imgSize, gridSize) => (imgPx / imgSize) * gridSize;
  return (
    <Chart
      channel={ch}
      sub={`${r.metric} · half-win=${r.half_window}px · threshold=${(r.threshold * 100).toFixed(0)}%`}
      footer={
        <>
          best-focus cell marked ×; {(r.points || []).length} pts · {(r.lines || []).length} lines
          overlaid
        </>
      }
    >
      <HeatmapCanvas
        grid={grid}
        cmap={cmap}
        width={480}
        height={Math.round(480 * (grid.h / grid.w))}
        aspectLock={true}
      >
        {({ w: cssW, h: cssH, gridW, gridH }) => {
          if (!gridW || !gridH) return null;
          // Mark global max
          let pk = 0,
            pv = -Infinity;
          for (let i = 0; i < grid.data.length; i++) {
            if (grid.data[i] > pv) {
              pv = grid.data[i];
              pk = i;
            }
          }
          const py = Math.floor(pk / gridW);
          const px = pk - py * gridW;
          const xOf = (ix) => (ix / gridW) * cssW;
          const yOf = (iy) => (iy / gridH) * cssH;
          return (
            <g>
              {(r.lines || []).map((ln, i) => {
                const x0 = toCv(ln.p0[0], imgW, gridW);
                const y0 = toCv(ln.p0[1], imgH, gridH);
                const x1 = toCv(ln.p1[0], imgW, gridW);
                const y1 = toCv(ln.p1[1], imgH, gridH);
                return (
                  <g key={i}>
                    <line
                      x1={xOf(x0)}
                      y1={yOf(y0)}
                      x2={xOf(x1)}
                      y2={yOf(y1)}
                      stroke="#ffd54f"
                      strokeWidth={scaled(style.lineWidth, style)}
                      opacity={0.92}
                    />
                    <circle
                      cx={xOf(x0)}
                      cy={yOf(y0)}
                      r={style.markerSize / 2}
                      fill="#ffd54f"
                      stroke="#fff"
                      strokeWidth={scaled(style.markerStrokeWidth, style)}
                    />
                    <circle
                      cx={xOf(x1)}
                      cy={yOf(y1)}
                      r={style.markerSize / 2}
                      fill="#ffd54f"
                      stroke="#fff"
                      strokeWidth={scaled(style.markerStrokeWidth, style)}
                    />
                  </g>
                );
              })}
              {(r.points || []).map((pt, i) => {
                const xi = toCv(pt.x, imgW, gridW);
                const yi = toCv(pt.y, imgH, gridH);
                return (
                  <g key={i}>
                    <circle
                      cx={xOf(xi)}
                      cy={yOf(yi)}
                      r={style.markerSize / 1.5}
                      fill="#1f77b4"
                      stroke="#fff"
                      strokeWidth={scaled(style.markerStrokeWidth, style)}
                    />
                    {pt.label && (
                      <text
                        x={xOf(xi) + 6}
                        y={yOf(yi) - 4}
                        fontSize={scaled(style.legendSize, style)}
                        fontFamily={style.fontFamily}
                        fill="#fff"
                        stroke="#000"
                        strokeWidth={0.4}
                        paintOrder="stroke"
                      >
                        {pt.label}
                      </text>
                    )}
                  </g>
                );
              })}
              {/* Peak marker */}
              <g transform={`translate(${xOf(px + 0.5)}, ${yOf(py + 0.5)})`}>
                <line
                  x1={-8}
                  y1={-8}
                  x2={8}
                  y2={8}
                  stroke="#fff"
                  strokeWidth={style.axisStrokeWidth * 2}
                />
                <line
                  x1={-8}
                  y1={8}
                  x2={8}
                  y2={-8}
                  stroke="#fff"
                  strokeWidth={style.axisStrokeWidth * 2}
                />
              </g>
            </g>
          );
        }}
      </HeatmapCanvas>
      <div style={{ marginTop: 6 }}>
        <HeatmapColorBar
          cmap={cmap}
          vmin={grid.stats.p1 ?? grid.stats.min}
          vmax={grid.stats.p99 ?? grid.stats.max}
          label={`focus (${r.metric})`}
        />
      </div>
    </Chart>
  );
};

// Points + tilt diagnostic tab. Bar chart of focus per point, plus a native
// SVG tilt-plane visualization using the server's `tilt_plane` coefficients.
const DoFPointsTab = ({ channels, results, pointLabel, _unitPref = 'auto', _tiltFactor = 1 }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const hasPoints = channels.some((ch) => (results[ch]?.points || []).length > 0);
  if (!hasPoints) {
    return (
      <div style={{ color: t.textFaint, textAlign: 'center', paddingTop: 40 }}>
        No picked points. Drop ≥1 point on the DoF picker, then re-run.
      </div>
    );
  }
  return (
    <GridTabFrame
      caption="Per-channel focus at each picked point (normalized) + bilinear tilt-plane diagnostic where available."
      n={channels.length}
      minCardPx={480}
      storageKey="analysis/dof/pointsLayout"
    >
      {channels.map((ch) => {
        const r = results[ch];
        const pts = r?.points || [];
        const tilt = r?.tilt_plane;
        return (
          <Chart
            key={ch}
            channel={ch}
            sub={`${pts.length} points${tilt ? ` · tilt ${tilt.tilt_direction_deg?.toFixed?.(1) ?? '—'}°, R²=${tilt.r_squared?.toFixed?.(3) ?? '—'}` : ''}`}
          >
            <PointsBarChart points={pts} pointLabel={pointLabel} color={paletteColor(style, ch)} />
            {tilt && <TiltPlaneSVG r={r} color={paletteColor(style, ch)} />}
          </Chart>
        );
      })}
    </GridTabFrame>
  );
};

const PointsBarChart = ({ points, pointLabel, color }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  if (!points?.length) {
    return (
      <div
        style={{
          fontSize: scaled(style.legendSize, style),
          color: t.textFaint,
          padding: 6,
          fontFamily: style.fontFamily,
        }}
      >
        (no points)
      </div>
    );
  }
  const W = 460,
    H = 180,
    PAD_L = 44,
    PAD_R = 12,
    PAD_T = 12,
    PAD_B = 48;
  const slot = (W - PAD_L - PAD_R) / Math.max(1, points.length);
  const barW = Math.max(8, slot - 6);
  const yOf = (f) => PAD_T + (1 - Math.max(0, Math.min(1, f))) * (H - PAD_T - PAD_B);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      style={{ background: 'transparent', borderRadius: 4, display: 'block' }}
    >
      {style.showGrid &&
        yTicks.map((y) => (
          <line
            key={y}
            x1={PAD_L}
            y1={yOf(y)}
            x2={W - PAD_R}
            y2={yOf(y)}
            stroke={t.border}
            strokeWidth={scaled(style.gridWidth, style)}
            opacity={style.gridOpacity}
          />
        ))}
      <line
        x1={PAD_L}
        y1={H - PAD_B}
        x2={W - PAD_R}
        y2={H - PAD_B}
        stroke={t.textMuted}
        strokeWidth={scaled(style.axisStrokeWidth, style)}
      />
      <line
        x1={PAD_L}
        y1={PAD_T}
        x2={PAD_L}
        y2={H - PAD_B}
        stroke={t.textMuted}
        strokeWidth={scaled(style.axisStrokeWidth, style)}
      />
      {yTicks.map((y) => (
        <text
          key={`l${y}`}
          x={PAD_L - 5}
          y={yOf(y) + scaled(style.tickSize, style) * 0.35}
          fontSize={scaled(style.tickSize, style)}
          fill={t.textMuted}
          fontFamily={style.fontFamily}
          textAnchor="end"
        >
          {y.toFixed(2)}
        </text>
      ))}
      {points.map((pt, i) => {
        const x = PAD_L + i * slot + (slot - barW) / 2;
        const y = yOf(pt.focus_norm);
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={H - PAD_B - y}
              fill={color}
              opacity={0.85}
              rx={2}
            >
              <title>{`${pointLabel(i)}: ${(pt.focus_norm * 100).toFixed(1)}%`}</title>
            </rect>
            <text
              x={x + barW / 2}
              y={H - PAD_B + scaled(style.tickSize, style) * 1.5}
              fontSize={scaled(style.tickSize, style)}
              fill={t.textMuted}
              fontFamily={style.fontFamily}
              textAnchor="middle"
            >
              {pointLabel(i)}
            </text>
            <text
              x={x + barW / 2}
              y={y - 4}
              fontSize={scaled(style.annotationSize, style)}
              fill={t.textMuted}
              fontFamily="ui-monospace,Menlo,monospace"
              textAnchor="middle"
            >
              {(pt.focus_norm * 100).toFixed(0)}%
            </text>
          </g>
        );
      })}
      <text
        x={PAD_L + (W - PAD_L - PAD_R) / 2}
        y={H - 6}
        fontSize={scaled(style.axisLabelSize, style)}
        fontWeight={style.axisLabelWeight}
        fill={t.textMuted}
        fontFamily={style.fontFamily}
        textAnchor="middle"
      >
        point
      </text>
      <text
        x={12}
        y={PAD_T + (H - PAD_T - PAD_B) / 2}
        fontSize={scaled(style.axisLabelSize, style)}
        fontWeight={style.axisLabelWeight}
        fill={t.textMuted}
        fontFamily={style.fontFamily}
        textAnchor="middle"
        transform={`rotate(-90 12 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}
      >
        normalized focus
      </text>
    </svg>
  );
};

// Native tilt-plane diagnostic. Draws the picked points as scatter markers
// on the (x, y) image plane, shaded by their predicted plane value, plus
// an arrow indicating the gradient direction.
const TiltPlaneSVG = ({ r, color }) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const tilt = r?.tilt_plane;
  const pts = r?.points || [];
  if (!tilt || pts.length < 3) return null;
  const W = 460,
    H = 240,
    PAD = 20;
  const xs = pts.map((p) => p.x),
    ys = pts.map((p) => p.y);
  const xmin = Math.min(...xs),
    xmax = Math.max(...xs);
  const ymin = Math.min(...ys),
    ymax = Math.max(...ys);
  const xOf = (x) => PAD + ((x - xmin) / (xmax - xmin || 1)) * (W - 2 * PAD);
  const yOf = (y) => PAD + ((y - ymin) / (ymax - ymin || 1)) * (H - 2 * PAD);
  const cx = (xOf(xmin) + xOf(xmax)) / 2;
  const cy = (yOf(ymin) + yOf(ymax)) / 2;
  const dirRad = ((tilt.tilt_direction_deg || 0) * Math.PI) / 180;
  const L = Math.min(W, H) / 3;
  const ax = cx + Math.cos(dirRad) * L;
  const ay = cy + Math.sin(dirRad) * L;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      style={{ background: 'transparent', borderRadius: 4, marginTop: 8, display: 'block' }}
    >
      <rect
        x={PAD - 2}
        y={PAD - 2}
        width={W - 2 * PAD + 4}
        height={H - 2 * PAD + 4}
        fill="none"
        stroke={t.border}
        strokeWidth={scaled(style.axisStrokeWidth, style)}
      />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={xOf(p.x)}
          cy={yOf(p.y)}
          r={style.markerSize}
          fill={color}
          stroke="#fff"
          strokeWidth={scaled(style.markerStrokeWidth, style)}
          opacity={0.85}
        >
          <title>{`${p.label || '#' + (i + 1)} (${p.x.toFixed(0)}, ${p.y.toFixed(0)}): focus ${p.focus_norm.toFixed(3)}`}</title>
        </circle>
      ))}
      {/* Gradient arrow */}
      <defs>
        <marker
          id={`arr-${r.name}`}
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" fill={t.text} />
        </marker>
      </defs>
      <line
        x1={cx}
        y1={cy}
        x2={ax}
        y2={ay}
        stroke={t.text}
        strokeWidth={scaled(style.lineWidth, style)}
        markerEnd={`url(#arr-${r.name})`}
      />
      <text
        x={ax + 6}
        y={ay - 2}
        fontSize={scaled(style.annotationSize, style)}
        fill={t.text}
        fontFamily="ui-monospace,Menlo,monospace"
      >
        {(tilt.slope_mag_per_px ?? 0).toExponential(2)}/px
      </text>
      <text
        x={PAD}
        y={H - PAD / 2 + 4}
        fontSize={scaled(style.annotationSize, style)}
        fill={t.textMuted}
        fontFamily={style.fontFamily}
      >
        tilt plane fit — arrow = steepest focus change direction
      </text>
    </svg>
  );
};

// ===========================================================================
// Legacy modal for modes that haven't been migrated (none left; here for safety)
// ===========================================================================
const LegacyPngModal = ({ run, onClose, _onToast }) => {
  const t = useTheme();
  const { mode, response = {} } = run;
  const tabs = useMemoA(() => {
    if (mode === 'fpn') {
      const figs = response.figures || {};
      return [
        { key: 'fpn-overview', label: 'Overview', png: figs.overview },
        { key: 'fpn-rowcol', label: 'Row + Col FPN', png: figs.rowcol },
        { key: 'fpn-map', label: '2-D FPN map', png: figs.map },
        { key: 'fpn-psd', label: 'Power spectrum', png: figs.psd },
      ];
    }
    if (mode === 'dof') {
      const figs = response.figures || {};
      return [
        { key: 'dof-heatmap', label: 'Focus heatmap', png: figs.heatmap },
        { key: 'dof-line', label: 'Line scan', png: figs.linescan },
        { key: 'dof-points', label: 'Picked points', png: figs.points },
      ];
    }
    return [];
  }, [mode, response]);
  const [tab, setTab] = useStateA(0);
  const current = tabs[tab] || {};
  const title = mode === 'fpn' ? 'FPN analysis' : 'DoF analysis';
  return (
    <div
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
          maxWidth: 1400,
          height: '92vh',
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          boxShadow: t.shadowLg,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${t.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: t.accentSoft,
              color: t.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="run" size={14} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>{title}</div>
          </div>
          <Button variant="subtle" icon="close" onClick={onClose} size="sm" />
        </div>
        <div
          style={{
            display: 'flex',
            borderBottom: `1px solid ${t.border}`,
            background: t.panelAlt,
            padding: '0 8px',
            gap: 2,
          }}
        >
          {tabs.map((x, i) => (
            <button
              key={x.key}
              onClick={() => setTab(i)}
              style={{
                padding: '10px 14px',
                fontSize: 12,
                fontWeight: tab === i ? 600 : 450,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: tab === i ? t.accent : t.textMuted,
                borderBottom: `2px solid ${tab === i ? t.accent : 'transparent'}`,
                marginBottom: -1,
                fontFamily: 'inherit',
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, background: t.panelAlt }}>
          {current.png ? (
            <img
              src={`data:image/png;base64,${current.png}`}
              alt={current.label}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(92vh - 180px)',
                borderRadius: 6,
                background: '#fff',
              }}
            />
          ) : (
            <div style={{ color: t.textFaint, textAlign: 'center', padding: 40 }}>No figure.</div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// analysis-page-overhaul-v1 Phase 3 — bridge exports for the new shell
// (`web/src/analysis/`). Each `_*TabBody` dispatches the active tab to the
// chart components that still live in this module. Phase 4 moves the chart
// bodies into `web/src/analysis/charts/` and these bridges retire.
// Underscore prefix marks them as cross-module bridges, not public API.
// ---------------------------------------------------------------------------
const _USAFTabBody = ({
  tab,
  visibleChannels,
  allSpecs,
  keptIdx,
  measurements,
  threshold,
  perChLim,
  dirFilter,
}) => {
  if (tab === 'mtf')
    return (
      <MTFCurvesTab
        channels={visibleChannels}
        specs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
        perChLim={perChLim}
      />
    );
  if (tab === 'profiles')
    return (
      <ProfileGalleryTab
        channels={visibleChannels}
        specs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
      />
    );
  if (tab === 'table')
    return (
      <SummaryTableTab
        channels={visibleChannels}
        specs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
      />
    );
  if (tab === 'heatmap')
    return (
      <DetectionHeatmapTab
        channels={visibleChannels}
        specs={allSpecs}
        measurements={measurements}
        threshold={threshold}
        dirFilter={dirFilter}
      />
    );
  if (tab === 'group')
    return (
      <GroupSweepTab
        channels={visibleChannels}
        specs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
      />
    );
  if (tab === 'fft')
    return (
      <FFTMTFTab
        channels={visibleChannels}
        specs={allSpecs}
        keptIdx={keptIdx}
        measurements={measurements}
        threshold={threshold}
      />
    );
  return null;
};

const _FPNTabBody = ({
  tab,
  visibleChannels,
  measurements,
  allRois,
  visibleRoiIdx,
  roiLabel,
  setRoiLabel,
  unit,
  fullDR,
}) => {
  if (tab === 'summary')
    return (
      <FPNSummaryTab
        channels={visibleChannels}
        measurements={measurements}
        rois={allRois}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        setRoiLabel={setRoiLabel}
        unit={unit}
        fullDR={fullDR}
      />
    );
  if (tab === 'hist')
    return (
      <FPNHistogramsTab
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        unit={unit}
        fullDR={fullDR}
      />
    );
  if (tab === 'profiles')
    return (
      <FPNProfilesTab
        channels={visibleChannels}
        measurements={measurements}
        rois={allRois}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
      />
    );
  if (tab === 'psd1d')
    return (
      <FPNPSD1DTab
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
      />
    );
  if (tab === 'map')
    return (
      <FPNFigureGrid
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        figKey="map"
        caption="Blue = below, red = above. Scale centered on zero."
      />
    );
  if (tab === 'psd')
    return (
      <FPNFigureGrid
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        figKey="psd"
        caption="Bright lines = banding, bright points = periodic structure."
      />
    );
  if (tab === 'autocorr')
    return (
      <FPNFigureGrid
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
        figKey="autocorr"
        caption="Center spike = signal power, off-center peaks = periodic spatial structure."
      />
    );
  if (tab === 'hotpix')
    return (
      <FPNHotPixTab
        channels={visibleChannels}
        measurements={measurements}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
      />
    );
  if (tab === 'compare')
    return (
      <FPNCompareTab
        channels={visibleChannels}
        measurements={measurements}
        rois={allRois}
        visibleRoiIdx={visibleRoiIdx}
        roiLabel={roiLabel}
      />
    );
  return null;
};

const _DoFTabBody = ({
  tab,
  visibleChannels,
  results,
  visibleLineIdx,
  lineLabel,
  pointLabel,
  unitPref,
  tiltFactor,
}) => {
  if (tab === 'summary')
    return (
      <DoFSummaryTab
        channels={visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        pointLabel={pointLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  if (tab === 'lines')
    return (
      <DoFLinesTab
        channels={visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  if (tab === 'gaussian')
    return (
      <DoFGaussianTab
        channels={visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  if (tab === 'metric')
    return (
      <DoFMetricCompareTab
        channels={visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  if (tab === 'chromatic')
    return (
      <DoFChromaticTab
        channels={visibleChannels}
        results={results}
        visibleLineIdx={visibleLineIdx}
        lineLabel={lineLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  if (tab === 'heatmap')
    return (
      <DoFHeatmapTab
        channels={visibleChannels}
        results={results}
        lineLabel={lineLabel}
        pointLabel={pointLabel}
      />
    );
  if (tab === 'points')
    return (
      <DoFPointsTab
        channels={visibleChannels}
        results={results}
        pointLabel={pointLabel}
        unitPref={unitPref}
        tiltFactor={tiltFactor}
      />
    );
  return null;
};

export {
  AnalysisModal,
  _USAFTabBody,
  _FPNTabBody,
  _DoFTabBody,
  DOF_UNIT_OPTS as _DOF_UNIT_OPTS,
  dofIsCalibrated as _dofIsCalibrated,
};
export default AnalysisModal;
