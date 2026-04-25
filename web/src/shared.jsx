// Shared UI primitives for MantisAnalysis — BioSensors Lab @ UIUC.
// Author: Zhongmin Zhu <j@polarxphotonics.com>
//
// bundler-migration-v1 Phase 3: ES-module native. The final
// `export { … }` statement at the bottom of this file replaces the
// pre-Phase-3 `Object.assign(window, …)` window-globals bridge.
// Every named item re-exported there is also a top-level `const`
// declaration earlier in the file.
import React from 'react';
import domtoimage from 'dom-to-image-more';

const { useState, useEffect, useRef, useMemo, useCallback, createContext, useContext } = React;

// ---------------------------------------------------------------------------
// Brand constants — single source of truth
// ---------------------------------------------------------------------------
const BRAND = {
  name: 'MantisAnalysis',
  tagline: 'Multi-channel imaging bench',
  // `customer` = the lab the software is built FOR (shown in TopBar / status).
  // `authorAffiliation` = Zhongmin's actual employer / company (shown in About).
  customer: 'BioSensors Lab · UIUC',
  lab: 'BioSensors Lab · UIUC', // legacy alias — same value as `customer`
  author: 'Zhongmin Zhu',
  authorAffiliation: 'PolarX Photonics',
  authorEmail: 'j@polarxphotonics.com',
  year: new Date().getFullYear(),
  version: '0.9.2',
  build: '2025.04.b',
};

// Canonical image dimensions across modes (procedural sources + coord mapping)
const IMAGE_DIMS = { W: 720, H: 540 };

// Viewport hook — buckets window width for responsive behavior.
const useViewport = () => {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440));
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  // xs: <960, sm: <1180, md: <1400, lg: >=1400
  const bucket = w < 960 ? 'xs' : w < 1180 ? 'sm' : w < 1400 ? 'md' : 'lg';
  return { w, bucket, isNarrow: w < 1180 };
};

// Shared grid builder used by USAF/FPN/DoF. Ensures the canvas column
// never drops below `minCanvas` px and collapses sidebars when hidden.
const modeGrid = ({
  leftOpen = true,
  rightOpen = true,
  leftW = 320,
  rightW = 368,
  minCanvas = 480,
} = {}) => {
  const L = leftOpen ? `minmax(260px, ${leftW}px)` : '0px';
  const R = rightOpen ? `minmax(300px, ${rightW}px)` : '0px';
  const C = `minmax(${minCanvas}px, 1fr)`;
  return `${L} ${C} ${R}`;
};

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------
const THEMES = {
  light: {
    bg: '#f4f5f7',
    panel: '#ffffff',
    panelAlt: '#fafbfc',
    border: '#e4e7ec',
    borderStrong: '#d0d7de',
    text: '#14181f',
    textMuted: '#5d6773',
    textFaint: '#8b95a1',
    accent: '#1560d9',
    accentHover: '#0c4db0',
    accentSoft: '#e4efff',
    danger: '#cf222e',
    warn: '#b87b00',
    success: '#1a7f37',
    canvasBg: '#0a0a0a',
    chipBg: '#f0f2f5',
    chipBorder: '#e0e4ea',
    inputBg: '#ffffff',
    selection: 'rgba(21,96,217,0.12)',
    shadow: '0 1px 2px rgba(15,20,30,0.04), 0 1px 3px rgba(15,20,30,0.06)',
    shadowLg: '0 8px 32px rgba(15,20,30,0.12), 0 2px 8px rgba(15,20,30,0.08)',
  },
  dark: {
    bg: '#0f1115',
    panel: '#181b21',
    panelAlt: '#1e2128',
    border: '#272b33',
    borderStrong: '#363a44',
    text: '#e8eaed',
    textMuted: '#9aa3af',
    textFaint: '#6a7280',
    accent: '#4a9eff',
    accentHover: '#3b8ae8',
    accentSoft: '#1a2c47',
    danger: '#ff6b6b',
    warn: '#e5a13a',
    success: '#3fb950',
    canvasBg: '#050505',
    chipBg: '#1e2128',
    chipBorder: '#2b2f38',
    inputBg: '#0f1115',
    selection: 'rgba(74,158,255,0.18)',
    shadow: '0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.5)',
    shadowLg: '0 8px 32px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)',
  },
};

// Channel color swatches — shared across modes
const CHANNEL_COLORS = {
  R: '#f04b4b',
  G: '#3aba5e',
  B: '#4a9eff',
  NIR: '#b06bff',
  Y: '#d0d4da',
  // isp-modes-v1: bare pass-through + polarization analyzer hues.
  // Kept visually distinct from R/G/B so multi-channel legends don't blur.
  RAW: '#9aa3af',
  I0: '#f04b4b',
  I45: '#e5a13a',
  I90: '#3aba5e',
  I135: '#6b8df0',
};

// Pick default analysis channels for any source. Replaces the hardcoded
// ['HG-R','HG-G','HG-B','HG-NIR'] defaults that used to live in each
// mode file — works for any ISP mode (bare single/dual, rgb-nir,
// polarization, image).
const defaultAnalysisChannels = (available) => {
  if (!Array.isArray(available) || available.length === 0) return [];
  const hg = available.filter((c) => c.startsWith('HG-'));
  if (hg.length > 0) return hg.slice(0, 4);
  return available.slice(0, 4);
};

// USAF element overlay colors (matplotlib tab10 subset, but slightly tuned)
const ELEMENT_COLORS = ['#3d8eff', '#30b453', '#ff8c1a', '#e5484d', '#a572e6', '#20c5d4'];

const ThemeCtx = createContext(THEMES.light);
const useTheme = () => useContext(ThemeCtx);

// ---------------------------------------------------------------------------
// plotStyle — shared typography / lines / grid / palette / export config
//
// Exposed via PlotStyleCtx + `usePlotStyle()`. Persisted at
// `mantis/plotStyle` so the user's choice survives reloads and follows
// them across USAF / FPN / DoF analysis modals.
//
// Every inline SVG chart in `analysis.jsx` reads these values and
// re-renders on change, so the on-screen rendering and dom-to-image
// export stay identical.
// ---------------------------------------------------------------------------
const DEFAULT_PLOT_STYLE = {
  // Typography
  fontFamily: 'Inter Tight',
  titleSize: 14,
  titleWeight: 600,
  titleItalic: false,
  axisLabelSize: 12,
  axisLabelWeight: 500,
  tickSize: 10,
  tickWeight: 400,
  legendSize: 11,
  legendWeight: 400,
  annotationSize: 9.5,
  // Multiplies font / line width / marker size in place. Chart container
  // dimensions are governed independently by `cardMaxWidth` + `aspect`.
  elementScale: 1.0,
  // Lines / markers
  lineWidth: 1.6,
  markerSize: 7,
  markerStrokeWidth: 0.9,
  // Grid / axes
  showGrid: true,
  gridWidth: 0.5,
  gridOpacity: 0.6,
  axisStrokeWidth: 0.8,
  showLegend: true,
  // Background / card chrome
  cardBackground: 'panel', // 'panel' | 'white' | 'transparent'
  cardBorder: true,
  cardBorderRadius: 8,
  // Layout
  gridGap: 14,
  cardPadding: 10,
  // Chart card width cap (px). Grid cells stop stretching beyond this, so
  // the user can have a 2×2 layout that only occupies part of the modal
  // with empty space on the right / bottom — instead of every card being
  // forced to fill the available 1fr slot. 0 disables the cap.
  cardMaxWidth: 0,
  aspect: 'auto', // 'auto' | '4:3' | '16:9' | '1:1' | '3:4'
  // Background model (analysis-page-overhaul-v1) — unified page → card → body.
  // `pageBackground` sets the modal/page body; `chartBodyBackground` sets
  // the inner SVG surface. 'inherit' lets the surrounding card show through
  // so a single `pageBackground` toggle flips everything coherently.
  pageBackground: 'theme', // 'theme' | 'white' | 'black' | 'transparent' | <hex>
  chartBodyBackground: 'inherit', // 'inherit' | 'panel' | 'white' | 'transparent'
  // Palette — 'channel' = the per-channel colors (default, physics-correct);
  //          other palettes override channel colors with a shared sequential
  //          or cyclic scheme, useful when greyscale printing.
  palette: 'channel',
  // Export
  exportScale: 2, // 1 | 2 | 3 | 4
  exportFormat: 'png', // 'png' | 'svg'
  exportBackground: 'auto', // 'auto' | 'white' | 'transparent'
};

// Available font families. Web-safe generics + Google Fonts we already
// load. Picking anything else falls back via CSS font-stack.
const PLOT_FONT_FAMILIES = [
  { value: 'Inter Tight', label: 'Inter Tight (default)' },
  { value: 'system-ui', label: 'System' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Georgia', label: 'Georgia (serif)' },
  { value: 'Times New Roman', label: 'Times New Roman (serif)' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'ui-monospace', label: 'Monospace' },
];

// Presets — one-click style snapshots the user can bounce between.
const PLOT_STYLE_PRESETS = {
  default: { ...DEFAULT_PLOT_STYLE },
  publication: {
    ...DEFAULT_PLOT_STYLE,
    fontFamily: 'Times New Roman',
    titleSize: 13,
    titleWeight: 600,
    axisLabelSize: 12,
    axisLabelWeight: 500,
    tickSize: 10,
    legendSize: 10,
    legendWeight: 400,
    lineWidth: 1.2,
    markerSize: 5,
    markerStrokeWidth: 0.6,
    gridOpacity: 0.35,
    axisStrokeWidth: 0.9,
    gridWidth: 0.4,
    cardBackground: 'white',
    cardBorder: true,
    cardBorderRadius: 4,
    gridGap: 10,
    cardPadding: 8,
    palette: 'channel',
    exportScale: 3,
    exportBackground: 'white',
  },
  presentation: {
    ...DEFAULT_PLOT_STYLE,
    fontFamily: 'Inter Tight',
    titleSize: 18,
    titleWeight: 700,
    axisLabelSize: 15,
    axisLabelWeight: 600,
    tickSize: 13,
    legendSize: 14,
    legendWeight: 600,
    lineWidth: 2.4,
    markerSize: 10,
    markerStrokeWidth: 1.2,
    gridOpacity: 0.4,
    axisStrokeWidth: 1.2,
    cardBackground: 'panel',
    cardBorderRadius: 10,
    cardPadding: 14,
    gridGap: 18,
    palette: 'channel',
    exportScale: 2,
    exportBackground: 'white',
  },
  compact: {
    ...DEFAULT_PLOT_STYLE,
    fontFamily: 'Inter Tight',
    titleSize: 11,
    titleWeight: 600,
    axisLabelSize: 10,
    axisLabelWeight: 400,
    tickSize: 8,
    legendSize: 9,
    legendWeight: 400,
    lineWidth: 1.2,
    markerSize: 4,
    markerStrokeWidth: 0.5,
    gridOpacity: 0.25,
    axisStrokeWidth: 0.5,
    gridWidth: 0.3,
    cardBackground: 'panel',
    cardBorderRadius: 6,
    cardPadding: 6,
    gridGap: 8,
    exportScale: 2,
    exportBackground: 'auto',
  },
};

const PlotStyleCtx = createContext(null);
const usePlotStyle = () => {
  const ctx = useContext(PlotStyleCtx);
  // Callers outside the analysis modals (sidebars, live mini-charts) get a
  // sensible default so they don't need to render a provider themselves.
  return ctx || { style: DEFAULT_PLOT_STYLE, setStyle: () => {}, resetStyle: () => {} };
};

// Hook — scaled font size helpers. Call `usePlotStyle()` + compute
// whatever size you need. Kept here instead of on each primitive so
// the primitives can be pure presentational components.

// ---------------------------------------------------------------------------
// Styled-SVG primitives that read plotStyle
// ---------------------------------------------------------------------------
// Scale helper — call this on any base font/line/marker size before
// writing it to SVG so the user's `elementScale` knob is respected
// everywhere. Primitives below use it automatically; raw chart bodies
// that still hardcode a `fontSize={9}` should route through this too.
const scaled = (baseSize, style) => {
  const s = style?.elementScale;
  if (!Number.isFinite(s) || s <= 0) return baseSize;
  return baseSize * s;
};

const PlotTitle = ({ x, y, children, color, textAnchor = 'middle', italic }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={scaled(style.titleSize, style)}
      fontWeight={style.titleWeight}
      fontStyle={(italic ?? style.titleItalic) ? 'italic' : 'normal'}
      fontFamily={style.fontFamily}
      fill={color || t.text}
    >
      {children}
    </text>
  );
};

const AxisLabel = ({ x, y, children, color, textAnchor = 'middle', rotation, bold }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={scaled(style.axisLabelSize, style)}
      fontWeight={bold ? 700 : style.axisLabelWeight}
      fontFamily={style.fontFamily}
      fill={color || t.textMuted}
      transform={rotation != null ? `rotate(${rotation} ${x} ${y})` : undefined}
    >
      {children}
    </text>
  );
};

const AxisTick = ({ x, y, children, color, textAnchor = 'middle' }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={scaled(style.tickSize, style)}
      fontWeight={style.tickWeight}
      fontFamily={style.fontFamily}
      fill={color || t.textMuted}
    >
      {children}
    </text>
  );
};

const LegendLabel = ({ x, y, children, color, textAnchor = 'start' }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor}
      fontSize={scaled(style.legendSize, style)}
      fontWeight={style.legendWeight}
      fontFamily={style.fontFamily}
      fill={color || t.textMuted}
    >
      {children}
    </text>
  );
};

// Shared inline HTML legend pill — mirrors LegendLabel's typography for
// <div> placements (e.g. outside the SVG). Useful so the external legend
// chip under a chart reads the same font as the chart itself.
const legendCssFor = (style) => ({
  fontSize: style.legendSize,
  fontWeight: style.legendWeight,
  fontFamily: style.fontFamily,
});

const GridLine = ({ x1, y1, x2, y2, color, stroke }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  if (!style.showGrid) return null;
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke || color || t.border}
      strokeWidth={style.gridWidth}
      opacity={style.gridOpacity}
    />
  );
};

// Palette resolver. When `palette === 'channel'`, return the canonical
// `channelColor(ch)`; otherwise return a value from the named cyclic
// map so greyscale-safe / colour-blind-safe export paths don't need the
// charts rewritten.
const PLOT_PALETTES = {
  channel: null, // sentinel — resolved per-call
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725', '#73d055', '#238a8d', '#482878'],
  magma: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fcfdbf', '#b63679', '#51127c'],
  'mono-dark': ['#222', '#555', '#888', '#aaa', '#333', '#666', '#999'],
  'mono-light': ['#ddd', '#aaa', '#777', '#444', '#bbb', '#888', '#555'],
};
const plotPaletteColor = (style, channelColorFn, ch, index = 0) => {
  if (!style || style.palette === 'channel') return channelColorFn(ch);
  const arr = PLOT_PALETTES[style.palette];
  if (!arr) return channelColorFn(ch);
  return arr[index % arr.length];
};

// Card chrome helper — returns a style object the chart cards can spread
// to respect the user's card-background / border choices.
const cardChromeFor = (style, t) => {
  const bg =
    style.cardBackground === 'white'
      ? '#ffffff'
      : style.cardBackground === 'transparent'
        ? 'transparent'
        : t.panel;
  return {
    background: bg,
    border: style.cardBorder ? `1px solid ${t.border}` : 'none',
    borderRadius: style.cardBorderRadius,
    padding: style.cardPadding,
  };
};

// analysis-page-overhaul-v1 — unified background model.
// `pageBackground` is the one knob that flips the modal body + cards + SVG
// bodies together when `chartBodyBackground === 'inherit'` and
// `cardBackground === 'panel'` (the cascade chain). `themeFallback` is the
// theme color to use when pageBackground === 'theme'.
const pageBgFor = (style, t, themeFallback) => {
  const pb = style?.pageBackground || 'theme';
  if (pb === 'transparent') return 'transparent';
  if (pb === 'white') return '#ffffff';
  if (pb === 'black') return '#000000';
  if (pb === 'theme') return themeFallback || t.panelAlt;
  if (typeof pb === 'string' && pb.startsWith('#')) return pb;
  return themeFallback || t.panelAlt;
};

// Chart body SVG surface. 'inherit' returns transparent so the surrounding
// card (or page) shows through; other values pin the body to a specific
// color regardless of the card setting.
const chartBodyBgFor = (style, t) => {
  const cb = style?.chartBodyBackground || 'inherit';
  if (cb === 'inherit') return 'transparent';
  if (cb === 'white') return '#ffffff';
  if (cb === 'panel') return t.panel;
  if (cb === 'transparent') return 'transparent';
  return 'transparent';
};

// Canonical channel → color resolver. Mirrors analysis.jsx's local helper
// so code in shared.jsx (<Chart>, renderChartToPng, etc.) can resolve
// channel swatches without reaching back into analysis.jsx. Accepts bare
// bands ('R') or gain-prefixed keys ('HG-R', 'LG-NIR').
const _BAND_FROM = (ch) => {
  if (!ch || typeof ch !== 'string') return '';
  return ch.includes('-') ? ch.split('-').pop() : ch;
};
const channelColor = (ch) => CHANNEL_COLORS[_BAND_FROM(ch)] || '#888';
const _BAND_IDX_FOR_PALETTE = { R: 0, G: 1, B: 2, NIR: 3, Y: 4, L: 5 };
const paletteColor = (style, ch) => {
  const band = _BAND_FROM(ch);
  const idx = _BAND_IDX_FOR_PALETTE[band] ?? 0;
  return plotPaletteColor(style, channelColor, ch, idx);
};

// ---------------------------------------------------------------------------
// Heatmap rendering (native canvas — plot-style-completion-v1)
// ---------------------------------------------------------------------------
//
// Decode the base64-float32 grids the server ships and paint them to a
// <canvas>. Keeps the render on the GPU/CPU path the browser is good at
// without ever hitting a server PNG. Colormaps implemented inline so
// they're tweakable without adding a dependency. Every heatmap respects
// the user's plotStyle (cardPadding, cardBorderRadius, cardBackground).

const decodeFloat32Grid = (grid) => {
  if (!grid?.data || !grid?.dims) return null;
  try {
    const bin = atob(grid.data);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    return {
      data: new Float32Array(buf),
      h: grid.dims[0],
      w: grid.dims[1],
      stats: grid.stats || {},
      stride: grid.stride || [1, 1],
    };
  } catch (e) {
    return null;
  }
};

const decodeUint8Mask = (b64, h, w) => {
  if (!b64 || !h || !w) return null;
  try {
    const bin = atob(b64);
    const a = new Uint8Array(h * w);
    for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  } catch (e) {
    return null;
  }
};

// A small set of perceptually-uniform-ish colormaps. Values are [r,g,b]
// anchor stops at t=0..1; `colormapLUT(name, N)` builds a linear LUT.
const CMAP_STOPS = {
  gray: [
    [0, 0, 0],
    [1, 1, 1],
  ],
  viridis: [
    [0.267, 0.005, 0.329],
    [0.231, 0.318, 0.545],
    [0.127, 0.567, 0.551],
    [0.369, 0.788, 0.383],
    [0.993, 0.906, 0.144],
  ],
  magma: [
    [0.001, 0.0, 0.014],
    [0.232, 0.06, 0.437],
    [0.55, 0.161, 0.506],
    [0.874, 0.288, 0.408],
    [0.987, 0.75, 0.35],
  ],
  inferno: [
    [0.001, 0.0, 0.014],
    [0.34, 0.062, 0.429],
    [0.727, 0.212, 0.331],
    [0.988, 0.539, 0.209],
    [0.988, 1.0, 0.644],
  ],
  plasma: [
    [0.05, 0.029, 0.528],
    [0.452, 0.015, 0.658],
    [0.767, 0.215, 0.505],
    [0.948, 0.527, 0.241],
    [0.94, 0.975, 0.131],
  ],
  cividis: [
    [0.0, 0.138, 0.302],
    [0.235, 0.301, 0.512],
    [0.493, 0.477, 0.475],
    [0.753, 0.691, 0.377],
    [0.995, 0.906, 0.143],
  ],
  turbo: [
    [0.19, 0.072, 0.232],
    [0.255, 0.427, 0.989],
    [0.118, 0.938, 0.732],
    [0.836, 0.951, 0.235],
    [0.961, 0.241, 0.074],
    [0.48, 0.015, 0.011],
  ],
  hot: [
    [0, 0, 0],
    [0.65, 0, 0],
    [1, 0.4, 0],
    [1, 1, 0],
    [1, 1, 1],
  ],
  // Divergent: negative → blue, zero → white, positive → red.
  rdbu: [
    [0.02, 0.188, 0.38],
    [0.55, 0.78, 0.89],
    [1, 1, 1],
    [0.96, 0.54, 0.38],
    [0.65, 0.0, 0.15],
  ],
  // Jet kept for backwards-compat with scientific users who still prefer it.
  jet: [
    [0, 0, 0.5],
    [0, 0, 1],
    [0, 1, 1],
    [1, 1, 0],
    [1, 0, 0],
    [0.5, 0, 0],
  ],
};

const colormapLUT = (name, N = 256) => {
  const stops = CMAP_STOPS[name] || CMAP_STOPS.gray;
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const pos = t * (stops.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(stops.length - 1, i0 + 1);
    const f = pos - i0;
    const [r0, g0, b0] = stops[i0];
    const [r1, g1, b1] = stops[i1];
    out[i * 4 + 0] = Math.round(255 * (r0 + (r1 - r0) * f));
    out[i * 4 + 1] = Math.round(255 * (g0 + (g1 - g0) * f));
    out[i * 4 + 2] = Math.round(255 * (b0 + (b1 - b0) * f));
    out[i * 4 + 3] = 255;
  }
  return out;
};

// HeatmapCanvas — paint a 2-D float32 grid to a <canvas> with a colormap.
// Props:
//   grid:        output of `decodeFloat32Grid(serverGrid)` (or null)
//   cmap:        'gray' | 'viridis' | 'magma' | 'inferno' | 'plasma' |
//                'cividis' | 'turbo' | 'hot' | 'rdbu' | 'jet'
//   divergent:   if true, map [-|vmax|, +|vmax|] symmetrically (for FPN maps)
//   vmin / vmax: explicit scale. Defaults to p1/p99 from grid.stats.
//   logScale:    if true, map log10(1 + value) (good for PSDs)
//   maskDim:     optional Uint8Array kept-mask dim (same shape as grid);
//                cells where maskDim[i]==0 are painted at 30% alpha in red.
//   width/height: CSS pixel size of the output canvas. The backing buffer
//                 is drawn at the source grid resolution and upscaled by
//                 nearest neighbour via image-rendering: pixelated so the
//                 cell structure stays sharp.
//   aspectLock:  if true, keep grid aspect ratio (letterbox).
const HeatmapCanvas = ({
  grid,
  cmap = 'gray',
  divergent = false,
  vmin,
  vmax,
  logScale = false,
  maskDim = null,
  width = 360,
  height = 260,
  aspectLock = true,
  children,
}) => {
  const ref = useRef(null);
  // Decode-once memoized LUT.
  const lut = useMemo(() => colormapLUT(cmap, 256), [cmap]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !grid || !grid.data?.length) return;
    const { w, h, data, stats } = grid;
    let lo = Number.isFinite(vmin) ? vmin : (stats.p1 ?? stats.min ?? 0);
    let hi = Number.isFinite(vmax) ? vmax : (stats.p99 ?? stats.max ?? 1);
    if (logScale) {
      const mag = Math.max(Math.abs(lo), Math.abs(hi), 1e-9);
      lo = 0;
      hi = Math.log10(1 + mag);
    }
    if (divergent) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 1e-9);
      lo = -m;
      hi = +m;
    }
    if (!(hi > lo)) hi = lo + 1;
    // Render at grid resolution, then CSS-upscale.
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const range = hi - lo;
    for (let i = 0; i < data.length; i++) {
      let v = data[i];
      if (!Number.isFinite(v)) {
        d[i * 4] = 30;
        d[i * 4 + 1] = 32;
        d[i * 4 + 2] = 38;
        d[i * 4 + 3] = 255;
        continue;
      }
      if (logScale) v = Math.log10(1 + Math.abs(v));
      let t = (v - lo) / range;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const k = Math.round(t * 255) << 2;
      d[i * 4] = lut[k];
      d[i * 4 + 1] = lut[k + 1];
      d[i * 4 + 2] = lut[k + 2];
      d[i * 4 + 3] = 255;
    }
    if (maskDim && maskDim.length === data.length) {
      for (let i = 0; i < maskDim.length; i++) {
        if (maskDim[i] === 0) {
          // Dim excluded pixels with a red tint at 55% alpha.
          d[i * 4] = Math.min(255, d[i * 4] * 0.5 + 180);
          d[i * 4 + 1] = Math.round(d[i * 4 + 1] * 0.45);
          d[i * 4 + 2] = Math.round(d[i * 4 + 2] * 0.45);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [grid, lut, divergent, vmin, vmax, logScale, maskDim]);

  // Letterbox to grid aspect if requested.
  let cssW = width,
    cssH = height;
  if (aspectLock && grid?.w && grid?.h) {
    const ar = grid.w / grid.h;
    if (width / height > ar) cssW = height * ar;
    else cssH = width / ar;
  }
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <canvas
        ref={ref}
        style={{
          width: cssW,
          height: cssH,
          maxWidth: '100%',
          imageRendering: 'pixelated',
          borderRadius: 4,
          display: 'block',
        }}
      />
      {children && (
        <svg
          viewBox={`0 0 ${cssW} ${cssH}`}
          preserveAspectRatio="none"
          style={{
            position: 'absolute',
            inset: 0,
            width: cssW,
            height: cssH,
            pointerEvents: 'none',
          }}
        >
          {typeof children === 'function'
            ? children({ w: cssW, h: cssH, gridW: grid?.w, gridH: grid?.h })
            : children}
        </svg>
      )}
    </div>
  );
};

// Tiny color-bar legend that pairs with a HeatmapCanvas. Shows 6 tick
// labels (min / -- / median / -- / max) + the cmap gradient.
const HeatmapColorBar = ({ cmap = 'gray', vmin, vmax, label, width = 200, divergent = false }) => {
  const { style } = usePlotStyle();
  const t = useTheme();
  const stops = useMemo(() => {
    const lut = colormapLUT(cmap, 32);
    const grads = [];
    for (let i = 0; i < 32; i++) {
      grads.push(
        `rgb(${lut[i * 4]},${lut[i * 4 + 1]},${lut[i * 4 + 2]}) ${((i / 31) * 100).toFixed(1)}%`
      );
    }
    return `linear-gradient(90deg, ${grads.join(',')})`;
  }, [cmap]);
  let lo = vmin,
    hi = vmax;
  if (divergent) {
    const m = Math.max(Math.abs(lo), Math.abs(hi));
    lo = -m;
    hi = +m;
  }
  const fmt = (v) =>
    Number.isFinite(v)
      ? Math.abs(v) >= 100
        ? v.toFixed(0)
        : Math.abs(v) >= 1
          ? v.toFixed(2)
          : v.toFixed(3)
      : '—';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: style.fontFamily,
        fontSize: scaled(style.legendSize, style),
        color: t.textMuted,
        fontWeight: style.legendWeight,
      }}
    >
      {label && <span>{label}</span>}
      <div
        style={{
          width,
          height: 10,
          borderRadius: 3,
          background: stops,
          border: `1px solid ${t.border}`,
        }}
      />
      <span
        style={{
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: scaled(style.tickSize, style),
        }}
      >
        {fmt(lo)} → {fmt(hi)}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// usePlotStyleState — bootstrap the provider from localStorage
// ---------------------------------------------------------------------------
const usePlotStyleState = () => {
  const [style, setStyleFull] = useLocalStorageState('plotStyle', DEFAULT_PLOT_STYLE);
  // Merge saved partial style with defaults so a new field added later
  // doesn't read `undefined` and blow up a chart that `.toFixed()`s it.
  const merged = { ...DEFAULT_PLOT_STYLE, ...(style || {}) };
  const setStyle = (patch) => {
    if (typeof patch === 'function')
      setStyleFull((prev) => ({ ...DEFAULT_PLOT_STYLE, ...prev, ...patch(prev) }));
    else setStyleFull((prev) => ({ ...DEFAULT_PLOT_STYLE, ...prev, ...patch }));
  };
  const resetStyle = () => setStyleFull(DEFAULT_PLOT_STYLE);
  return { style: merged, setStyle, resetStyle };
};

// ---------------------------------------------------------------------------
// Icons — 14px stroke, inherits currentColor
// ---------------------------------------------------------------------------
const Icon = ({ name, size = 14, style }) => {
  const s = size;
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style,
  };
  const P = {
    usaf: (
      <g>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d="M5 4v8M7 5v6M9 4v8M11 6v4" />
      </g>
    ),
    fpn: (
      <g>
        <rect x="2.5" y="2.5" width="11" height="11" rx="1" />
        <circle cx="5.5" cy="5.5" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="6" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="7" cy="9" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="11" cy="11" r="0.6" fill="currentColor" stroke="none" />
        <circle cx="4.5" cy="11" r="0.6" fill="currentColor" stroke="none" />
      </g>
    ),
    dof: (
      <g>
        <circle cx="8" cy="8" r="5" />
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15" />
      </g>
    ),
    open: (
      <g>
        <path d="M2 5l2-2h4l1 1h5v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5z" />
      </g>
    ),
    play: (
      <g>
        <path d="M5 3l8 5-8 5V3z" fill="currentColor" />
      </g>
    ),
    sun: (
      <g>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" />
      </g>
    ),
    moon: (
      <g>
        <path d="M13 9a5 5 0 0 1-7-6 5 5 0 1 0 7 6z" />
      </g>
    ),
    close: (
      <g>
        <path d="M4 4l8 8M12 4l-8 8" />
      </g>
    ),
    chevron: (
      <g>
        <path d="M5 6l3 3 3-3" />
      </g>
    ),
    rotate: (
      <g>
        <path d="M2 8a6 6 0 1 1 2 4.5" />
        <path d="M2 12v-3h3" />
      </g>
    ),
    flip: (
      <g>
        <path d="M8 2v12" />
        <path d="M5 5l-2 3 2 3M11 5l2 3-2 3" />
      </g>
    ),
    zoomReset: (
      <g>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d="M6 6h4v4H6z" />
      </g>
    ),
    undo: (
      <g>
        <path d="M6 4L2 8l4 4" />
        <path d="M2 8h8a4 4 0 0 1 4 4" />
      </g>
    ),
    trash: (
      <g>
        <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4.5 4l.5 9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1l.5-9" />
      </g>
    ),
    run: (
      <g>
        <path d="M4 3l9 5-9 5V3z" fill="currentColor" stroke="none" />
      </g>
    ),
    export: (
      <g>
        <path d="M8 2v8M5 6l3-4 3 4M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
      </g>
    ),
    help: (
      <g>
        <circle cx="8" cy="8" r="6" />
        <path d="M6.5 6.5a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.7.7-.7 1.2M8 11.5v.1" />
      </g>
    ),
    keyboard: (
      <g>
        <rect x="1.5" y="4.5" width="13" height="7" rx="1" />
        <path d="M4 7h.01M6 7h.01M8 7h.01M10 7h.01M12 7h.01M4 9.5h8" />
      </g>
    ),
    search: (
      <g>
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l3 3" />
      </g>
    ),
    plus: (
      <g>
        <path d="M8 3v10M3 8h10" />
      </g>
    ),
    minus: (
      <g>
        <path d="M3 8h10" />
      </g>
    ),
    check: (
      <g>
        <path d="M3 8l3 3 7-7" />
      </g>
    ),
    drag: (
      <g>
        <circle cx="6" cy="4" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="10" cy="4" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="6" cy="8" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="10" cy="8" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="6" cy="12" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="10" cy="12" r="0.8" fill="currentColor" stroke="none" />
      </g>
    ),
    sliders: (
      <g>
        <path d="M3 4h7M12 4h1M3 8h2M7 8h6M3 12h8M10 12h3" />
        <circle cx="11" cy="4" r="1" />
        <circle cx="6" cy="8" r="1" />
        <circle cx="9" cy="12" r="1" />
      </g>
    ),
    settings: (
      <g>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1v2M8 13v2M15 8h-2M3 8H1M13 3l-1.5 1.5M4.5 11.5L3 13M13 13l-1.5-1.5M4.5 4.5L3 3" />
      </g>
    ),
    pin: (
      <g>
        <path d="M7 2h2l1 4 2 1v1H4V7l2-1 1-4z" />
        <path d="M8 9v5" />
      </g>
    ),
    eye: (
      <g>
        <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
        <circle cx="8" cy="8" r="2" />
      </g>
    ),
    layers: (
      <g>
        <path d="M8 2l6 3-6 3-6-3 6-3z" />
        <path d="M2 8l6 3 6-3M2 11l6 3 6-3" />
      </g>
    ),
    grid: (
      <g>
        <rect x="2" y="2" width="5" height="5" />
        <rect x="9" y="2" width="5" height="5" />
        <rect x="2" y="9" width="5" height="5" />
        <rect x="9" y="9" width="5" height="5" />
      </g>
    ),
    save: (
      <g>
        <path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <path d="M5 2v4h6V2M5 10h6v5" />
      </g>
    ),
    upload: (
      <g>
        <path d="M8 11V3M5 6l3-3 3 3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
      </g>
    ),
    sparkles: (
      <g>
        <path d="M8 2l1.3 3.7L13 7l-3.7 1.3L8 12l-1.3-3.7L3 7l3.7-1.3L8 2z" />
        <path d="M12.5 11.5l.5 1.5.5-1.5 1.5-.5-1.5-.5-.5-1.5-.5 1.5-1.5.5 1.5.5z" />
      </g>
    ),
    isp: (
      <g>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d="M5 8l2-2 2 3 3-4" />
        <circle cx="5" cy="8" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="12" cy="5" r="0.8" fill="currentColor" stroke="none" />
      </g>
    ),
    hand: (
      <g>
        <path d="M6 7V3.5a1.2 1.2 0 0 1 2.4 0V7M8.4 7V2.5a1.2 1.2 0 0 1 2.4 0V7M10.8 7V3a1.2 1.2 0 0 1 2.4 0V9a5 5 0 0 1-5 5H7a3 3 0 0 1-3-3V7a1.2 1.2 0 0 1 2.4 0" />
      </g>
    ),
    crosshair: (
      <g>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1v3M8 12v3M1 8h3M12 8h3" />
      </g>
    ),
    fit: (
      <g>
        <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />
      </g>
    ),
    info: (
      <g>
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7.5v3.5M8 5.5v.01" />
      </g>
    ),
    cmd: (
      <g>
        <path d="M5 3a2 2 0 1 0 0 4h6a2 2 0 1 0 0-4 2 2 0 0 0-2 2v6a2 2 0 1 0 2-2H5a2 2 0 1 0 0 2 2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
      </g>
    ),
    download: (
      <g>
        <path d="M8 2v8M5 7l3 3 3-3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
      </g>
    ),
    image: (
      <g>
        <rect x="2" y="3" width="12" height="10" rx="1" />
        <circle cx="6" cy="7" r="1.2" />
        <path d="M2 11l3-3 3 3 2-2 3 3" />
      </g>
    ),
    palette: (
      <g>
        <path d="M8 2a6 6 0 1 0 0 12c1 0 1-1 0-1.5-.7-.4-.4-1.5.5-1.5h2a3 3 0 0 0 3-3c0-3.3-2.7-6-6-6z" />
        <circle cx="5.5" cy="7" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="8" cy="5" r="0.8" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="7" r="0.8" fill="currentColor" stroke="none" />
      </g>
    ),
    mantis: (
      <g>
        <path d="M7 13c0-1.5 1-2.5 2-2.5s2 1 2 2.5M8 10.5V9M8 8V6M6 5l2 1 2-1M5.5 4.5l.5 1M10.5 4.5l-.5 1M6.5 3.5l1.5 1 1.5-1" />
      </g>
    ),
  };
  return <svg {...common}>{P[name] || null}</svg>;
};

// ---------------------------------------------------------------------------
// Card — collapsible sidebar container
// ---------------------------------------------------------------------------
const Card = ({
  title,
  icon,
  children,
  defaultOpen = true,
  pinned = false,
  actions,
  dense = false,
}) => {
  const t = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 8,
        marginBottom: 8,
        overflow: 'hidden',
      }}
    >
      <button
        data-drag-handle
        onClick={() => !pinned && setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          background: 'transparent',
          border: 'none',
          cursor: pinned ? 'default' : 'pointer',
          color: t.textMuted,
          textAlign: 'left',
        }}
      >
        {icon && (
          <span style={{ color: t.textFaint, display: 'flex' }}>
            <Icon name={icon} size={13} />
          </span>
        )}
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: t.textMuted,
            flex: 1,
          }}
        >
          {title}
        </span>
        {actions}
        {!pinned && (
          <span
            style={{
              color: t.textFaint,
              display: 'flex',
              transform: open ? 'rotate(0)' : 'rotate(-90deg)',
              transition: 'transform .15s',
            }}
          >
            <Icon name="chevron" size={12} />
          </span>
        )}
      </button>
      {open && <div style={{ padding: dense ? '2px 10px 10px' : '4px 10px 12px' }}>{children}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Row — generic labeled row
// ---------------------------------------------------------------------------
const Row = ({ label, children, align = 'center' }) => {
  const t = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: align,
        gap: 10,
        marginTop: 8,
        minHeight: 24,
        minWidth: 0,
      }}
    >
      {label && (
        <div style={{ flex: '0 0 78px', fontSize: 11.5, color: t.textMuted, lineHeight: '24px' }}>
          {label}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {children}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Slider with HUD tooltip on drag (per redesign note)
// ---------------------------------------------------------------------------
const Slider = ({
  label,
  min,
  max,
  step = 0.01,
  value,
  onChange,
  format = (v) => v.toFixed(2),
  unit = '',
}) => {
  const t = useTheme();
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11.5,
          color: t.textMuted,
          marginBottom: 4,
        }}
      >
        <span style={{ flex: 1 }}>{label}</span>
        {editing ? (
          <input
            autoFocus
            type="number"
            defaultValue={value}
            min={min}
            max={max}
            step={step}
            onBlur={(e) => {
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              width: 60,
              fontSize: 11.5,
              padding: '1px 4px',
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.accent}`,
              borderRadius: 3,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{
              fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
              fontSize: 11,
              color: t.text,
              cursor: 'text',
              padding: '1px 4px',
              borderRadius: 3,
              background: 'transparent',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = t.chipBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {format(value)}
            {unit}
          </span>
        )}
      </div>
      <div style={{ position: 'relative', height: 18, display: 'flex', alignItems: 'center' }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: 4,
            background: t.chipBg,
            borderRadius: 2,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${pct}%`,
            height: 4,
            background: t.accent,
            borderRadius: 2,
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onTouchStart={() => setDragging(true)}
          onTouchEnd={() => setDragging(false)}
          style={{
            width: '100%',
            appearance: 'none',
            background: 'transparent',
            height: 18,
            position: 'relative',
            zIndex: 1,
            margin: 0,
            cursor: 'pointer',
          }}
          className="rgbnir-slider"
        />
        {dragging && (
          <div
            style={{
              position: 'absolute',
              left: `calc(${pct}% - 20px)`,
              bottom: 22,
              background: t.text,
              color: t.panel,
              fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
              fontSize: 10.5,
              padding: '2px 6px',
              borderRadius: 3,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {format(value)}
            {unit}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Select — styled combobox
// ---------------------------------------------------------------------------
const Select = ({ value, options, onChange, size = 'sm' }) => {
  const t = useTheme();
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          appearance: 'none',
          WebkitAppearance: 'none',
          background: t.inputBg,
          color: t.text,
          border: `1px solid ${t.border}`,
          borderRadius: 4,
          fontSize: size === 'sm' ? 11.5 : 12.5,
          padding: size === 'sm' ? '3px 22px 3px 8px' : '5px 24px 5px 10px',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {options.map((o) =>
          typeof o === 'string' ? (
            <option key={o} value={o}>
              {o}
            </option>
          ) : (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          )
        )}
      </select>
      <span
        style={{
          position: 'absolute',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          color: t.textFaint,
          pointerEvents: 'none',
          display: 'flex',
        }}
      >
        <Icon name="chevron" size={12} />
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Button — primary / ghost / accent / danger
// ---------------------------------------------------------------------------
const Button = ({
  variant = 'ghost',
  icon,
  iconRight,
  size = 'sm',
  children,
  onClick,
  disabled,
  title,
  fullWidth,
  active,
}) => {
  const t = useTheme();
  const [hover, setHover] = useState(false);
  const styles = {
    primary: {
      bg: hover && !disabled ? t.accentHover : t.accent,
      fg: '#fff',
      border: 'transparent',
    },
    ghost: {
      bg: active ? t.chipBg : hover ? t.chipBg : 'transparent',
      fg: t.text,
      border: t.border,
    },
    subtle: {
      bg: hover ? t.chipBg : 'transparent',
      fg: t.textMuted,
      border: 'transparent',
    },
    danger: {
      bg: hover ? 'rgba(207,34,46,0.08)' : 'transparent',
      fg: t.danger,
      border: t.border,
    },
  }[variant];
  const pad = size === 'xs' ? '3px 8px' : size === 'lg' ? '9px 14px' : '5px 10px';
  const fs = size === 'xs' ? 11 : size === 'lg' ? 13 : 11.5;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: pad,
        fontSize: fs,
        fontWeight: variant === 'primary' ? 500 : 450,
        background: styles.bg,
        color: styles.fg,
        border: `1px solid ${styles.border}`,
        borderRadius: 5,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : 'auto',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        transition: 'background .1s',
      }}
    >
      {icon && <Icon name={icon} size={fs - 1} />}
      {children}
      {iconRight && <Icon name={iconRight} size={fs - 1} />}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Channel chip — compact per-channel swatch
// ---------------------------------------------------------------------------
const parseChannel = (id) => {
  const [gain, band] = id.split('-');
  return { gain, band };
};

const ChannelChip = ({ id, selected, onToggle, multi = false, size = 'md' }) => {
  const t = useTheme();
  const { gain, band } = parseChannel(id);
  const color = CHANNEL_COLORS[band] || '#888';
  const compact = size === 'sm';
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '3px 6px' : '4px 8px',
        background: selected ? t.accentSoft : t.chipBg,
        color: selected ? t.accent : t.text,
        border: `1px solid ${selected ? t.accent : t.chipBorder}`,
        borderRadius: 5,
        cursor: 'pointer',
        fontSize: compact ? 10.5 : 11,
        fontWeight: 500,
        fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
        minWidth: 0,
      }}
    >
      <span
        style={{
          width: compact ? 8 : 10,
          height: compact ? 8 : 10,
          borderRadius: '50%',
          background: color,
          boxShadow: band === 'Y' ? 'inset 0 0 0 1px rgba(0,0,0,.2)' : 'none',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: compact ? 9 : 9.5, opacity: 0.6, fontWeight: 400 }}>{gain}</span>
      <span>{band}</span>
      {multi && selected && <Icon name="check" size={10} style={{ marginLeft: 1 }} />}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------
const Segmented = ({ value, options, onChange, size = 'sm', fullWidth = false }) => {
  const t = useTheme();
  return (
    <div
      style={{
        display: fullWidth ? 'flex' : 'inline-flex',
        background: t.chipBg,
        border: `1px solid ${t.chipBorder}`,
        borderRadius: 6,
        padding: 2,
        gap: 2,
        maxWidth: '100%',
        boxSizing: 'border-box',
      }}
    >
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const label = typeof o === 'string' ? o : o.label;
        const active = val === value;
        return (
          <button
            key={val}
            onClick={() => onChange(val)}
            style={{
              padding: size === 'xs' ? '2px 8px' : '3px 10px',
              fontSize: size === 'xs' ? 10.5 : 11.5,
              fontWeight: active ? 500 : 400,
              background: active ? t.panel : 'transparent',
              color: active ? t.text : t.textMuted,
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              boxShadow: active ? t.shadow : 'none',
              fontFamily: 'inherit',
              flex: fullWidth ? 1 : '0 0 auto',
              minWidth: 0,
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------
const Checkbox = ({ checked, onChange, label, disabled, hint }) => {
  const t = useTheme();
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          background: checked ? t.accent : t.inputBg,
          border: `1px solid ${checked ? t.accent : t.borderStrong}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: 1,
          color: '#fff',
        }}
      >
        {checked && <Icon name="check" size={10} />}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => !disabled && onChange(e.target.checked)}
        style={{ display: 'none' }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, color: t.text, lineHeight: 1.4 }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 1 }}>{hint}</div>}
      </div>
    </label>
  );
};

// ---------------------------------------------------------------------------
// Spinbox (small numeric stepper)
// ---------------------------------------------------------------------------
const Spinbox = ({ value, min, max, step = 1, onChange, width = 54 }) => {
  const t = useTheme();
  const clamp = (v) => Math.max(min, Math.min(max, v));
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        border: `1px solid ${t.border}`,
        borderRadius: 4,
        overflow: 'hidden',
        background: t.inputBg,
      }}
    >
      <button
        onClick={() => onChange(clamp(value - step))}
        style={{
          border: 'none',
          background: 'transparent',
          color: t.textMuted,
          padding: '2px 6px',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        −
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(clamp(v));
        }}
        style={{
          width,
          border: 'none',
          background: 'transparent',
          color: t.text,
          fontSize: 11.5,
          textAlign: 'center',
          padding: '3px 0',
          fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
          outline: 'none',
        }}
      />
      <button
        onClick={() => onChange(clamp(value + step))}
        style={{
          border: 'none',
          background: 'transparent',
          color: t.textMuted,
          padding: '2px 6px',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        +
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Mono stat block
// ---------------------------------------------------------------------------
const StatBlock = ({ items, emphasis }) => {
  const t = useTheme();
  return (
    <div
      style={{
        fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
        fontSize: 11.5,
        background: t.panelAlt,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        padding: '8px 10px',
        lineHeight: 1.55,
      }}
    >
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 8,
            color: it.muted ? t.textFaint : t.text,
            fontSize: it.key === emphasis ? 13 : 11.5,
            fontWeight: it.key === emphasis ? 600 : 400,
            padding: it.key === emphasis ? '2px 0' : 0,
          }}
        >
          <span style={{ color: it.muted ? t.textFaint : t.textMuted }}>{it.label}</span>
          <span style={{ color: it.color || (it.muted ? t.textFaint : t.text) }}>{it.value}</span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// HUD — floating badge (positioned by parent)
// ---------------------------------------------------------------------------
const HUD = ({ children, style }) => {
  return (
    <div
      style={{
        position: 'absolute',
        background: 'rgba(20,24,31,0.88)',
        color: '#fff',
        backdropFilter: 'blur(8px)',
        padding: '5px 9px',
        borderRadius: 5,
        fontSize: 11,
        fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
        border: '1px solid rgba(255,255,255,0.08)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Canvas Chrome — toolbar overlay (rotation, flip, zoom reset, etc.)
// ---------------------------------------------------------------------------
const CanvasToolbar = ({ children, position = 'top-right' }) => {
  const positions = {
    'top-right': { top: 10, right: 10 },
    'top-left': { top: 10, left: 10 },
    'bottom-right': { bottom: 10, right: 10 },
    'bottom-left': { bottom: 10, left: 10 },
  };
  return (
    <div
      style={{
        position: 'absolute',
        ...positions[position],
        display: 'flex',
        gap: 2,
        padding: 3,
        background: 'rgba(20,24,31,0.72)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 6,
        zIndex: 4,
      }}
    >
      {children}
    </div>
  );
};

const CanvasBtn = ({ icon, active, onClick, title, label }) => (
  <button
    onClick={onClick}
    title={title}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: label ? '5px 8px' : 5,
      background: active ? 'rgba(74,158,255,0.25)' : 'transparent',
      color: active ? '#8ebfff' : '#cbd3df',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 11,
      fontFamily: 'inherit',
    }}
  >
    {icon && <Icon name={icon} size={12} />}
    {label}
  </button>
);

// ---------------------------------------------------------------------------
// Generate procedural image data URL for canvas backgrounds
// ---------------------------------------------------------------------------
const makeUSAFImage = (w = 720, h = 540) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // dark background
  ctx.fillStyle = '#0f0f10';
  ctx.fillRect(0, 0, w, h);
  // subtle vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, w * 0.7);
  g.addColorStop(0, 'rgba(40,42,48,0.3)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // draw USAF-like bar groups
  const drawGroup = (cx, cy, barW, bars = 3) => {
    ctx.fillStyle = '#c8ccd4';
    // horizontal bars (3)
    const gap = barW;
    const totalH = bars * barW + (bars - 1) * gap;
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(cx - barW * 2, cy - totalH / 2 + i * (barW + gap), barW * 4, barW);
    }
    // vertical bars (3), offset to the right
    for (let i = 0; i < bars; i++) {
      ctx.fillRect(cx + barW * 3 - totalH / 2 + i * (barW + gap), cy - barW * 2, barW, barW * 4);
    }
  };
  // Group 0, Group 1, Group 2, ... decreasing bar width
  const groups = [
    { cx: 130, cy: 140, w: 22 }, // G0
    { cx: 260, cy: 130, w: 14 }, // G1
    { cx: 360, cy: 135, w: 9 }, // G2
    { cx: 440, cy: 140, w: 6 }, // G3
    { cx: 500, cy: 145, w: 4 }, // G4
    { cx: 550, cy: 150, w: 2.6 }, // G5
  ];
  groups.forEach((g) => drawGroup(g.cx, g.cy, g.w));
  // element sub-groups (smaller nested)
  for (let i = 0; i < 6; i++) {
    const row = Math.floor(i / 3);
    const col = i % 3;
    drawGroup(160 + col * 90, 300 + row * 100, 12 - i * 1.5);
  }
  // a tilted secondary target suggestion
  ctx.save();
  ctx.translate(w * 0.75, h * 0.7);
  ctx.rotate(0.18);
  for (let i = 0; i < 6; i++) {
    drawGroup(30 * i, 0, Math.max(1.2, 9 - i * 1.2));
  }
  ctx.restore();
  // faint chart frame
  ctx.strokeStyle = 'rgba(200,204,212,0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(30, 30, w - 60, h - 60);
  // noise
  const id = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    id.data[i] = Math.max(0, Math.min(255, id.data[i] + n));
    id.data[i + 1] = Math.max(0, Math.min(255, id.data[i + 1] + n));
    id.data[i + 2] = Math.max(0, Math.min(255, id.data[i + 2] + n));
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
};

const makeFPNImage = (w = 720, h = 540) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  // uniform mid gray
  ctx.fillStyle = '#3a3d45';
  ctx.fillRect(0, 0, w, h);
  // row FPN (horizontal banding)
  for (let y = 0; y < h; y++) {
    const rb = (Math.random() - 0.5) * 6 + Math.sin(y * 0.3) * 2;
    ctx.fillStyle = `rgba(255,255,255,${Math.abs(rb) / 120})`;
    if (rb > 0) ctx.fillRect(0, y, w, 1);
    else {
      ctx.fillStyle = `rgba(0,0,0,${Math.abs(rb) / 120})`;
      ctx.fillRect(0, y, w, 1);
    }
  }
  // column FPN
  for (let x = 0; x < w; x++) {
    const cb = (Math.random() - 0.5) * 4 + Math.cos(x * 0.12) * 1.5;
    if (cb > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.abs(cb) / 140})`;
      ctx.fillRect(x, 0, 1, h);
    } else {
      ctx.fillStyle = `rgba(0,0,0,${Math.abs(cb) / 140})`;
      ctx.fillRect(x, 0, 1, h);
    }
  }
  // Hot pixels
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  ctx.fillStyle = '#000';
  for (let i = 0; i < 25; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  // noise
  const id = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 30;
    id.data[i] = Math.max(0, Math.min(255, id.data[i] + n));
    id.data[i + 1] = Math.max(0, Math.min(255, id.data[i + 1] + n));
    id.data[i + 2] = Math.max(0, Math.min(255, id.data[i + 2] + n));
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png');
};

const makeDoFImage = (w = 720, h = 540) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0a0a0b';
  ctx.fillRect(0, 0, w, h);
  // tilted plane of thin lines (DoF target with moiré in middle)
  const cx = w / 2,
    cy = h / 2;
  for (let i = 0; i < 180; i++) {
    const y = i * 3 - 20;
    // focus sharpness varies with y (tilted target)
    const dy = Math.abs(y - cy) / cy;
    const blur = Math.min(3, dy * 3.5);
    ctx.filter = `blur(${blur}px)`;
    ctx.strokeStyle = `rgba(210,214,220,${0.5 + (1 - dy) * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, y);
    ctx.lineTo(w - 60, y + 10);
    ctx.stroke();
  }
  ctx.filter = 'none';
  // vertical reference lines
  ctx.strokeStyle = 'rgba(210,214,220,0.15)';
  for (let x = 80; x < w - 80; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 40);
    ctx.lineTo(x, h - 40);
    ctx.stroke();
  }
  // noise + vignette
  const g = ctx.createRadialGradient(cx, cy, 100, cx, cy, w * 0.7);
  g.addColorStop(0, 'rgba(30,32,36,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
};

// ---------------------------------------------------------------------------
// Export globals
// ---------------------------------------------------------------------------
// sharpness-per-cycle color helper
const sCycColor = (v, t) => (v >= 4 ? t.success : v >= 2 ? t.warn : t.danger);

// ---------------------------------------------------------------------------
// Shared primitives added in the refactor pass
// ---------------------------------------------------------------------------

// Tip — hover-title wrapper (was previously defined locally in usaf.jsx)
const Tip = ({ title, children }) => (
  <span title={title} style={{ display: 'contents' }}>
    {children}
  </span>
);

// Kbd — inline keyboard pill
const Kbd = ({ children, tone = 'default' }) => {
  const t = useTheme();
  const bgs = {
    default: { bg: t.chipBg, fg: t.text, border: t.chipBorder },
    dim: { bg: 'rgba(255,255,255,0.08)', fg: '#cbd3df', border: 'rgba(255,255,255,0.1)' },
  };
  const s = bgs[tone] || bgs.default;
  return (
    <kbd
      style={{
        fontFamily: 'JetBrains Mono, ui-monospace, Menlo, monospace',
        fontSize: 10.5,
        padding: '1px 6px',
        borderRadius: 4,
        background: s.bg,
        color: s.fg,
        border: `1px solid ${s.border}`,
        borderBottomWidth: 2,
      }}
    >
      {children}
    </kbd>
  );
};

// Modal — dimmed overlay with click-outside
const Modal = ({ children, onClose, width = 480, label, padding = 20 }) => {
  const t = useTheme();
  useEffect(() => {
    const h = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      aria-label={label}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,10,14,0.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: t.panel,
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          padding,
          width,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '92vh',
          overflow: 'auto',
          boxShadow: t.shadowLg,
          color: t.text,
        }}
      >
        {children}
      </div>
    </div>
  );
};

// Toast — transient floating message (renders via portal-free positioning)
const Toast = ({ msg, kind = 'info', onDone, duration = 2200 }) => {
  const t = useTheme();
  // Stabilize onDone via ref — otherwise every parent re-render passes a
  // fresh closure, which re-fires the effect and restarts the auto-dismiss
  // timer forever. This is exactly the "Running DoF analysis on 4
  // channels…" stuck-at-the-bottom bug.
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  useEffect(() => {
    const id = setTimeout(() => onDoneRef.current?.(), duration);
    return () => clearTimeout(id);
  }, [msg, duration]);
  const colors = {
    info: { bg: t.accent, fg: '#fff' },
    warn: { bg: t.warn, fg: '#fff' },
    success: { bg: t.success, fg: '#fff' },
    danger: { bg: t.danger, fg: '#fff' },
  }[kind];
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 38,
        left: '50%',
        transform: 'translateX(-50%)',
        background: colors.bg,
        color: colors.fg,
        padding: '7px 14px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        boxShadow: t.shadowLg,
        zIndex: 200,
        animation: 'mantisToastIn .18s ease-out',
      }}
    >
      {msg}
    </div>
  );
};

// ---------------------------------------------------------------------------
// useLocalStorageState — persisted state with namespace
// ---------------------------------------------------------------------------
const LS_PREFIX = 'mantis/';
const useLocalStorageState = (key, initial) => {
  const fullKey = LS_PREFIX + key;
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw != null) return JSON.parse(raw);
    } catch {}
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(v));
    } catch {}
  }, [fullKey, v]);
  return [v, setV];
};

// ---------------------------------------------------------------------------
// useImageMouse — pointer→image-coord helper shared across modes.
// Replaces the three separate `toImg` helpers.
// ---------------------------------------------------------------------------
const useImageMouse = (
  canvasRef,
  zoom = 1,
  pan = [0, 0],
  rotation = 0,
  flipH = false,
  flipV = false
) => {
  // Map raw client coords to image-space (0..IMAGE_DIMS.W, 0..IMAGE_DIMS.H)
  // For modes without pan/zoom/rotation, callers just pass defaults and get the naive mapping.
  return useCallback(
    (ev) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return [0, 0];
      // Naive (no rotation/zoom/pan) — we keep the simple mapping here and let
      // individual modes apply inverse transforms if they need hi-fidelity picking.
      const x = Math.max(
        0,
        Math.min(IMAGE_DIMS.W, ((ev.clientX - r.left) / r.width) * IMAGE_DIMS.W)
      );
      const y = Math.max(
        0,
        Math.min(IMAGE_DIMS.H, ((ev.clientY - r.top) / r.height) * IMAGE_DIMS.H)
      );
      return [Math.round(x), Math.round(y)];
    },
    [canvasRef]
  );
};

// ---------------------------------------------------------------------------
// useDragCapture — window-level capture/release. Replaces the repeated
// onMouseMove/onMouseUp-listener plumbing in all three mode files.
// ---------------------------------------------------------------------------
const useDragCapture = () => {
  return useCallback((onMove, onUp) => {
    const mv = (e) => onMove?.(e);
    const up = (e) => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      onUp?.(e);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  }, []);
};

// Distance from point to line segment (used by USAF + DoF right-click delete)
const distSegment = (p, a, b) => {
  const [x, y] = p,
    [ax, ay] = a,
    [bx, by] = b;
  const dx = bx - ax,
    dy = by - ay;
  const tt = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy + 1e-6)));
  return Math.hypot(x - (ax + tt * dx), y - (ay + tt * dy));
};

// ---------------------------------------------------------------------------
// CSV / JSON export helpers
// ---------------------------------------------------------------------------
const downloadBlob = (filename, mime, text) => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
};
const exportJSON = (filename, obj) =>
  downloadBlob(filename, 'application/json', JSON.stringify(obj, null, 2));
const exportCSV = (filename, rows) => {
  if (!rows.length) return downloadBlob(filename, 'text/csv', '');
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))];
  downloadBlob(filename, 'text/csv', lines.join('\n'));
};

// Read a user-selected image file → data URL
const pickImageFile = () =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, size: f.size, dataUrl: reader.result });
      reader.readAsDataURL(f);
    };
    input.click();
  });

// Inject a one-time stylesheet for toast animation + selection + slider thumb
if (typeof document !== 'undefined' && !document.getElementById('mantis-style')) {
  const st = document.createElement('style');
  st.id = 'mantis-style';
  st.textContent = `
    @keyframes mantisToastIn { from { opacity: 0; transform: translate(-50%, 6px); } to { opacity: 1; transform: translate(-50%, 0); } }
    .rgbnir-slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: var(--thumb, #1560d9); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,.2); cursor: pointer; }
    .rgbnir-slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: var(--thumb, #1560d9); border: 2px solid #fff; cursor: pointer; }
    ::selection { background: rgba(74,158,255,0.3); }
  `;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------------------
// Server API layer — all modes talk to the FastAPI backend through these.
// ---------------------------------------------------------------------------

const API_BASE = (() => {
  try {
    const u = new URL(window.location.href);
    const override = u.searchParams.get('api');
    if (override) return override.replace(/\/$/, '');
  } catch {}
  // When the page is opened as file:// the origin is 'null'; fall back to
  // the uvicorn default so you can `python -m mantisanalysis` in one
  // terminal and open the HTML directly for hot tweaks.
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:8765';
  return window.location.origin;
})();

// Pydantic 422s surface `detail` as an array of
// `{loc, msg, type, input}` entries; older 400 / 500 paths return a
// plain string. Flatten either case to a human-readable one-liner so
// callers that do `${err.detail}` don't render "[object Object]".
const formatApiDetail = (d) => {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        if (!e) return '';
        if (typeof e === 'string') return e;
        // Pydantic entry
        const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== 'body').join('.') : '';
        const msg = e.msg || e.message || e.type || JSON.stringify(e);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof d === 'object') {
    if (d.msg) return d.msg;
    try {
      return JSON.stringify(d);
    } catch {
      return String(d);
    }
  }
  return String(d);
};

const apiFetch = async (path, init = {}) => {
  const url = `${API_BASE}${path}`;
  const opts = { ...init };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  if (!r.ok) {
    const rawDetail = data?.detail ?? data?.message ?? text ?? `${r.status}`;
    const detail = formatApiDetail(rawDetail);
    const err = new Error(`${path} → ${r.status}: ${detail}`);
    err.status = r.status;
    err.detail = detail; // always a string now — safe to interpolate
    err.rawDetail = rawDetail; // callers that want the structured form still have it
    // R-0009: 410 Gone means the backing source was LRU-evicted on the
    // server. Broadcast a window event so SourceCtx (or any listener)
    // can flush the cached source_id and auto-recover via load-sample.
    if (r.status === 410 && typeof window !== 'undefined') {
      try {
        const sidMatch = path.match(/\/api\/sources\/([a-z0-9]+)/i);
        window.dispatchEvent(
          new CustomEvent('mantis:source-evicted', {
            detail: { path, source_id: sidMatch ? sidMatch[1] : null, detail },
          })
        );
      } catch {
        /* non-DOM environments (tests) are fine */
      }
    }
    throw err;
  }
  return data;
};

const apiUpload = async (path, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return apiFetch(path, { method: 'POST', body: fd });
};

const channelPngUrl = (
  sourceId,
  channel,
  maxDim = 1600,
  isp = null,
  colormap = 'gray',
  vmin = null,
  vmax = null,
  rgbComposite = false
) => {
  const q = new URLSearchParams({ max_dim: String(maxDim) });
  if (colormap && colormap !== 'gray') q.set('colormap', colormap);
  if (isp) {
    // USAF / sharpen chain
    if (isp.sharpen_method) q.set('sharpen_method', isp.sharpen_method);
    if (isp.sharpen_amount != null) q.set('sharpen_amount', String(isp.sharpen_amount));
    if (isp.sharpen_radius != null) q.set('sharpen_radius', String(isp.sharpen_radius));
    if (isp.denoise_sigma) q.set('denoise_sigma', String(isp.denoise_sigma));
    if (isp.black_level) q.set('black_level', String(isp.black_level));
    // FPN / smoothing chain — passed straight through to the same ISP
    // params on the server so the canvas previews exactly the FPN
    // analysis preprocessing.
    if (isp.median_size) q.set('median_size', String(isp.median_size));
    if (isp.gaussian_sigma) q.set('gaussian_sigma', String(isp.gaussian_sigma));
    if (isp.hot_pixel_thr) q.set('hot_pixel_thr', String(isp.hot_pixel_thr));
    if (isp.bilateral) q.set('bilateral', 'true');
  }
  // vmin / vmax both required to take effect server-side. Either-or is ignored.
  if (vmin != null && vmax != null && vmax > vmin) {
    q.set('vmin', String(vmin));
    q.set('vmax', String(vmax));
  }
  // ISP-modes-v1: RGB composite request — the server builds an R/G/B
  // PNG from the mode's RGB slots. The URL's ``channel`` arg carries
  // a HG-/LG- prefix hint so dual-gain sources can preview either gain.
  // When the active mode doesn't support composites, the server quietly
  // falls back to the single-channel grayscale path.
  if (rgbComposite) q.set('rgb_composite', 'true');
  return `${API_BASE}/api/sources/${sourceId}/channel/${encodeURIComponent(channel)}/thumbnail.png?${q.toString()}`;
};

// URL helper for the vertical colormap-strip PNG (top = high). Cached for
// 24h server-side; safe to use directly as <img src>.
const colormapStripUrl = (name, w = 16, h = 256) =>
  `${API_BASE}/api/colormap/${encodeURIComponent(name || 'gray')}.png?w=${w}&h=${h}`;

// ---------------------------------------------------------------------------
// CanvasColorbar — overlays the main canvas with the active colormap,
// labelled by the current vmin / vmax (which may be percentile-derived
// defaults or user-pinned values). Renders in screen pixels (position:
// absolute) so it stays put while the canvas image pans/zooms underneath.
//
// NOTE: name-spaced "CanvasColorbar" to avoid clashing with the unrelated
// `Colorbar` used inside the analysis modal (analysis.jsx) which has a
// totally different API.
// ---------------------------------------------------------------------------
const CanvasColorbar = ({ colormap, vmin, vmax, h = 220, w = 14, side = 'right' }) => {
  const t = useTheme();
  if (vmin == null || vmax == null || vmax <= vmin) return null;
  const fmt = (v) => {
    const a = Math.abs(v);
    if (a >= 10000 || (a > 0 && a < 0.01)) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    if (a >= 1) return v.toFixed(1);
    return v.toFixed(3);
  };
  const mid = (vmin + vmax) / 2;
  const pos = side === 'right' ? { right: 12 } : { left: 12 };
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        ...pos,
        display: 'flex',
        alignItems: 'stretch',
        gap: 6,
        background: t.panel + 'cc',
        backdropFilter: 'blur(4px)',
        padding: '6px 8px',
        borderRadius: 5,
        border: `1px solid ${t.borderStrong}`,
        pointerEvents: 'none',
        zIndex: 4,
        boxShadow: t.shadow,
      }}
    >
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          border: `1px solid ${t.borderStrong}`,
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <img
          src={colormapStripUrl(colormap, 16, 256)}
          alt={`${colormap} colormap`}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          fontSize: 9.5,
          color: t.text,
          fontFamily: 'ui-monospace,Menlo,monospace',
          minWidth: 36,
          textAlign: 'left',
        }}
      >
        <span title={`vmax = ${vmax}`}>{fmt(vmax)}</span>
        <span style={{ color: t.textFaint }} title={`midpoint = ${mid}`}>
          {fmt(mid)}
        </span>
        <span title={`vmin = ${vmin}`}>{fmt(vmin)}</span>
      </div>
    </div>
  );
};

// Source context — distributes the currently-selected source to mode components.
const SourceCtx = createContext(null);
const useSource = () => useContext(SourceCtx);

// File-filter context — distributes the global filter map + the user's
// current selection so any mode can render its own filter dropdown next to
// auxiliary file inputs (e.g. dark-frame Load) and stay in sync with the
// top-bar Open dropdown. The provider lives in app.jsx.
const FileFilterCtx = createContext({ filters: {}, current: 'all', set: () => {} });
const useFileFilter = () => useContext(FileFilterCtx);

// Debounced value — used to throttle live-stat API calls while dragging.
const useDebounced = (value, delayMs = 200) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
};

// ---------------------------------------------------------------------------
// DraggablePanelList — HTML5 drag-and-drop reordering for sidebar Cards.
//
// Caller supplies an `order` array of string ids + a `setOrder` setter
// (typically `useLocalStorageState` so the layout survives reloads), plus
// a `panels` map { id → JSX }. Each panel is wrapped in a draggable
// container that exposes a small grab-handle on hover (top-left corner).
// On drop, the list is reordered in-place and the new order persists.
//
// Why HTML5 DnD: zero deps, works without touching the existing Card
// component, and the visual feedback (drag image, drop indicator) is
// browser-native. We only do reorder-within-the-same-list, not cross-list.
// ---------------------------------------------------------------------------
const DraggablePanelList = ({ order, setOrder, panels }) => {
  const t = useTheme();
  const [draggingId, setDraggingId] = useState(null);
  const [overId, setOverId] = useState(null);
  // Per-id draggable flag, toggled by onMouseDown. We can't filter inside
  // onDragStart because dragstart fires on the wrapper element (its
  // event.target is the wrapper itself, not the descendant the user clicked
  // on) — so checking `e.target.closest(...)` always misses the slider/
  // button. Instead we set `draggable=false` BEFORE the browser's drag
  // gesture begins (on mousedown) when the gesture originates outside the
  // panel's title row, then restore on mouseup. The header element is
  // marked with [data-drag-handle] in the Card component.
  const [draggableMap, setDraggableMap] = useState({});

  const onMouseDown = (id) => (e) => {
    const inHandle = !!(e.target?.closest && e.target.closest('[data-drag-handle]'));
    setDraggableMap((m) => (m[id] === inHandle ? m : { ...m, [id]: inHandle }));
  };
  const onMouseUp = (id) => () => {
    // Restore the default (draggable=true) so the next mousedown starts
    // fresh — `onMouseDown` will turn it off again if the next gesture
    // begins outside the title row.
    setDraggableMap((m) => (m[id] === undefined ? m : { ...m, [id]: undefined }));
  };
  const onDragStart = (id) => (e) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', id);
    } catch {}
  };
  const onDragOver = (id) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== overId) setOverId(id);
  };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (!draggingId || draggingId === id) return;
    const next = order.filter((x) => x !== draggingId);
    const at = next.indexOf(id);
    next.splice(at < 0 ? next.length : at, 0, draggingId);
    setOrder(next);
    setDraggingId(null);
    setOverId(null);
  };
  const onDragEnd = () => {
    setDraggingId(null);
    setOverId(null);
  };

  // Filter to known panels (in case localStorage holds a stale id from a
  // previous session that no longer exists), then append any panel keys
  // that have appeared since the saved order was written.
  const known = order.filter((id) => panels[id]);
  for (const id of Object.keys(panels)) {
    if (!known.includes(id)) known.push(id);
  }

  return (
    <>
      {known.map((id) => {
        const isDragging = id === draggingId;
        const isOver = id === overId && overId !== draggingId;
        // Default draggable=true so first-mousedown-inside-title-row works;
        // onMouseDown flips it to false when the gesture starts elsewhere.
        const draggable = draggableMap[id] !== false;
        return (
          <div
            key={id}
            draggable={draggable}
            onMouseDown={onMouseDown(id)}
            onMouseUp={onMouseUp(id)}
            onDragStart={onDragStart(id)}
            onDragOver={onDragOver(id)}
            onDrop={onDrop(id)}
            onDragEnd={onDragEnd}
            style={{
              position: 'relative',
              opacity: isDragging ? 0.45 : 1,
              borderTop: isOver ? `2px solid ${t.accent}` : '2px solid transparent',
              transition: 'opacity .12s, border-color .12s',
            }}
            title="Drag the title row to reorder this panel"
          >
            {panels[id]}
          </div>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------------------
// FloatingWindow — a draggable + resizable floating panel.
//
// Used when the user "pops out" a sidebar card so it can sit anywhere on
// screen instead of locked into the side strip. State (x, y, w, h) is
// owned by the caller via `useLocalStorageState` so the position survives
// reloads. The header is the drag-handle; the bottom-right corner is the
// resize handle. Click the close (×) button to dock back.
// ---------------------------------------------------------------------------
const FloatingWindow = ({ title, icon, x, y, w, h, onChange, onClose, children }) => {
  const t = useTheme();
  const startDrag = (e) => {
    e.preventDefault();
    const sx = e.clientX,
      sy = e.clientY,
      x0 = x,
      y0 = y;
    document.body.style.cursor = 'grabbing';
    const move = (ev) =>
      onChange({
        x: Math.max(0, x0 + ev.clientX - sx),
        y: Math.max(0, y0 + ev.clientY - sy),
        w,
        h,
      });
    const up = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const startResize = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX,
      sy = e.clientY,
      w0 = w,
      h0 = h;
    document.body.style.cursor = 'nwse-resize';
    const move = (ev) =>
      onChange({
        x,
        y,
        w: Math.max(220, w0 + ev.clientX - sx),
        h: Math.max(160, h0 + ev.clientY - sy),
      });
    const up = () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        width: w,
        height: h,
        zIndex: 60,
        background: t.panel,
        border: `1px solid ${t.borderStrong}`,
        borderRadius: 8,
        boxShadow: t.shadowLg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        onMouseDown={startDrag}
        style={{
          padding: '6px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${t.border}`,
          background: t.panelAlt,
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
        title="Drag to move · click × to dock back to the sidebar"
      >
        {icon && <Icon name={icon} size={12} style={{ color: t.textMuted }} />}
        <span
          style={{
            fontSize: 11,
            color: t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            flex: 1,
          }}
        >
          {title}
        </span>
        <button
          onClick={onClose}
          title="Dock back into the sidebar"
          style={{
            background: 'transparent',
            border: 'none',
            color: t.textMuted,
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
          }}
        >
          <Icon name="close" size={11} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>{children}</div>
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: 'nwse-resize',
          background: `linear-gradient(135deg, transparent 0 50%, ${t.borderStrong} 50% 60%, transparent 60% 70%, ${t.borderStrong} 70% 80%, transparent 80% 100%)`,
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// ExportLayoutPicker — compact segmented control for "N-plot grid" tabs
//
// Many analysis-modal tabs render a grid of per-(channel × ROI) cards.
// When the user hits "Export PNG", dom-to-image-more rasterizes whatever
// layout is on screen. This control lets the user pick the arrangement
// (1×N, 2×N, auto, N×1, 4×1, 2×2, ...) before exporting so the produced
// PNG fits their PowerPoint / report column.
//
// `n` = number of items in the grid. The component proposes the sensible
// layouts for that N (always includes "auto" which keeps
// auto-fill / min-card-width responsive behavior).
// `value` / `onChange` — layout id. `id` keys: 'auto', '1xN', '2xN',
// '3xN', '4xN', 'Nx1'.
//
// `gridStyleFor(layout, n, minCardPx = 300)` returns a `{gridTemplateColumns}`
// object ready to spread into a caller's `style`. Keeping the math here
// means USAF / FPN / DoF modals all behave the same way.
// ---------------------------------------------------------------------------
const LAYOUT_OPTIONS = [
  { id: 'auto', label: 'auto', cols: null }, // responsive auto-fill
  { id: '1xN', label: '1 × N', cols: 1 },
  { id: '2xN', label: '2 cols', cols: 2 },
  { id: '3xN', label: '3 cols', cols: 3 },
  { id: '4xN', label: '4 cols', cols: 4 },
  { id: 'Nx1', label: 'N × 1', cols: 'wide' }, // single horizontal row
];

// Hide options whose column count exceeds n (doesn't make sense to
// request "4 cols" for 2 items).
const layoutsForCount = (n) =>
  LAYOUT_OPTIONS.filter((o) => o.cols === null || o.cols === 'wide' || o.cols <= Math.max(1, n));

const gridStyleFor = (layout, n, minCardPx = 300, gap, cardMaxWidth = 0) => {
  const opt = LAYOUT_OPTIONS.find((o) => o.id === layout) || LAYOUT_OPTIONS[0];
  const base = Number.isFinite(gap) ? { gap } : {};
  // When the user caps card width (style.cardMaxWidth > 0), upper bound
  // each track at that px value instead of 1fr stretching. Flush-left
  // packing so unused space goes on the right + bottom, matching how a
  // "make cards smaller" control usually behaves.
  const hasCap = Number.isFinite(cardMaxWidth) && cardMaxWidth > 0;
  const upper = hasCap ? `${cardMaxWidth}px` : '1fr';
  const justify = hasCap ? { justifyContent: 'flex-start' } : {};
  if (opt.cols === null) {
    return {
      ...base,
      ...justify,
      gridTemplateColumns: `repeat(auto-fill, minmax(${minCardPx}px, ${upper}))`,
    };
  }
  if (opt.cols === 'wide') {
    // N × 1: one row, all items. Width per card: distribute viewport
    // minus a safety margin.
    return {
      ...base,
      ...justify,
      gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(220px, ${upper}))`,
    };
  }
  return {
    ...base,
    ...justify,
    gridTemplateColumns: `repeat(${opt.cols}, minmax(200px, ${upper}))`,
  };
};

// ---------------------------------------------------------------------------
// PlotStylePanel — publication-grade style editor (toolbar)
//
// Collapsible horizontal bar that lives in each analysis modal below the
// filter row. User edits typography / lines / grid / layout / palette /
// export in realtime; every inline-SVG chart in the modal re-renders
// because the primitives above read from `usePlotStyle()`.
//
// Sections fold into an "Aa" pill when the open flag is false so the
// modal retains vertical space for charts.
// ---------------------------------------------------------------------------
// Slider + readout — hoisted to module level so each render of the
// enclosing PlotStylePanel doesn't remount it. Remounting was wiping
// the internal `draft` state on every keystroke + losing pointer
// capture on the <input type="range">, which is why the sliders
// appeared un-draggable and the text inputs lost their cursor almost
// immediately. Keeping it as a stable component fixes both.
const PlotStyleNum = ({ label, value, min, max, step = 1, onChange, width = 110 }) => {
  const t = useTheme();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);
  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
    else setDraft(String(value));
  };
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10.5,
        color: t.textMuted,
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ width, accentColor: t.accent, cursor: 'pointer' }}
      />
      <input
        type="text"
        value={draft}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            e.target.blur();
          } else if (e.key === 'Escape') {
            setDraft(String(value));
            e.target.blur();
          }
        }}
        style={{
          width: 44,
          padding: '2px 4px',
          fontSize: 10.5,
          fontFamily: 'ui-monospace,Menlo,monospace',
          textAlign: 'right',
          background: t.inputBg,
          color: t.text,
          border: `1px solid ${t.border}`,
          borderRadius: 3,
        }}
      />
    </label>
  );
};

const PlotStylePanel = ({ open, onToggle }) => {
  const t = useTheme();
  const { style, setStyle, resetStyle } = usePlotStyle();

  // Alias kept short so the JSX below doesn't need a rewrite — references
  // the hoisted component.
  const Num = PlotStyleNum;

  const pillBtn = (label, onClick, active) => (
    <button
      onClick={onClick}
      key={label}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: active ? 600 : 450,
        background: active ? t.accent : t.chipBg,
        color: active ? '#fff' : t.text,
        border: `1px solid ${active ? t.accent : t.chipBorder}`,
        borderRadius: 5,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );

  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Edit plot style — fonts, sizes, palette, layout, export"
        style={{
          padding: '5px 10px',
          fontSize: 11,
          background: t.chipBg,
          color: t.text,
          border: `1px solid ${t.chipBorder}`,
          borderRadius: 5,
          cursor: 'pointer',
          fontFamily: 'inherit',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <Icon name="palette" size={12} />
        Style
      </button>
    );
  }

  return (
    <div
      style={{
        padding: '10px 14px',
        background: t.panelAlt,
        borderTop: `1px solid ${t.border}`,
        borderBottom: `1px solid ${t.border}`,
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 18,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          fontSize: 11,
        }}
      >
        {/* Presets */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Preset
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {Object.keys(PLOT_STYLE_PRESETS).map((k) =>
              pillBtn(
                k[0].toUpperCase() + k.slice(1),
                () => setStyle({ ...PLOT_STYLE_PRESETS[k] }),
                false
              )
            )}
            <button
              onClick={() => {
                if (confirm('Reset plot style to defaults?')) resetStyle();
              }}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                color: t.danger,
                background: 'transparent',
                border: `1px solid ${t.chipBorder}`,
                borderRadius: 5,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reset
            </button>
            <button
              onClick={onToggle}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                color: t.textMuted,
                background: 'transparent',
                border: `1px solid ${t.chipBorder}`,
                borderRadius: 5,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Hide
            </button>
          </div>
        </div>

        {/* Typography */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Typography
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={style.fontFamily}
              onChange={(e) => setStyle({ fontFamily: e.target.value })}
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '3px 6px',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {PLOT_FONT_FAMILIES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <Num
              label="Title"
              value={style.titleSize}
              min={8}
              max={32}
              step={0.5}
              onChange={(v) => setStyle({ titleSize: v })}
            />
            <Num
              label="Axis"
              value={style.axisLabelSize}
              min={6}
              max={28}
              step={0.5}
              onChange={(v) => setStyle({ axisLabelSize: v })}
            />
            <Num
              label="Tick"
              value={style.tickSize}
              min={5}
              max={20}
              step={0.5}
              onChange={(v) => setStyle({ tickSize: v })}
            />
            <Num
              label="Legend"
              value={style.legendSize}
              min={5}
              max={22}
              step={0.5}
              onChange={(v) => setStyle({ legendSize: v })}
            />
          </div>
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginTop: 4,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 10, color: t.textFaint }}>weight:</span>
            <select
              value={style.titleWeight}
              onChange={(e) => setStyle({ titleWeight: parseInt(e.target.value) })}
              title="Title font weight"
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              {[300, 400, 500, 600, 700, 800].map((w) => (
                <option key={w} value={w}>
                  title {w}
                </option>
              ))}
            </select>
            <select
              value={style.axisLabelWeight}
              onChange={(e) => setStyle({ axisLabelWeight: parseInt(e.target.value) })}
              title="Axis label font weight"
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              {[300, 400, 500, 600, 700].map((w) => (
                <option key={w} value={w}>
                  axis {w}
                </option>
              ))}
            </select>
            <select
              value={style.legendWeight}
              onChange={(e) => setStyle({ legendWeight: parseInt(e.target.value) })}
              title="Legend font weight"
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              {[300, 400, 500, 600, 700].map((w) => (
                <option key={w} value={w}>
                  legend {w}
                </option>
              ))}
            </select>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10.5,
                color: t.text,
              }}
            >
              <input
                type="checkbox"
                checked={style.titleItalic}
                onChange={(e) => setStyle({ titleItalic: e.target.checked })}
                style={{ margin: 0 }}
              />
              title italic
            </label>
          </div>
        </div>

        {/* Scale */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Scale
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Tip title="Multiply every font, line width, and marker size at once. Chart dimensions stay the same — text just occupies more of the chart area.">
              <Num
                label="Elements ×"
                value={style.elementScale}
                min={0.5}
                max={3.0}
                step={0.05}
                onChange={(v) => setStyle({ elementScale: v })}
                width={60}
              />
            </Tip>
          </div>
        </div>

        {/* Lines & markers */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Lines
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Num
              label="Line"
              value={style.lineWidth}
              min={0.5}
              max={6}
              step={0.1}
              onChange={(v) => setStyle({ lineWidth: v })}
            />
            <Num
              label="Marker"
              value={style.markerSize}
              min={2}
              max={16}
              step={0.5}
              onChange={(v) => setStyle({ markerSize: v })}
            />
            <Num
              label="Axis"
              value={style.axisStrokeWidth}
              min={0.2}
              max={3}
              step={0.1}
              onChange={(v) => setStyle({ axisStrokeWidth: v })}
            />
          </div>
        </div>

        {/* Grid */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Grid
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10.5,
                color: t.text,
              }}
            >
              <input
                type="checkbox"
                checked={style.showGrid}
                onChange={(e) => setStyle({ showGrid: e.target.checked })}
                style={{ margin: 0 }}
              />
              show
            </label>
            <Num
              label="Width"
              value={style.gridWidth}
              min={0.1}
              max={2}
              step={0.1}
              onChange={(v) => setStyle({ gridWidth: v })}
            />
            <Num
              label="Opacity"
              value={style.gridOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setStyle({ gridOpacity: v })}
            />
          </div>
        </div>

        {/* Layout */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Layout
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Num
              label="Gap"
              value={style.gridGap}
              min={0}
              max={32}
              step={1}
              onChange={(v) => setStyle({ gridGap: v })}
            />
            <Num
              label="Padding"
              value={style.cardPadding}
              min={0}
              max={30}
              step={1}
              onChange={(v) => setStyle({ cardPadding: v })}
            />
            <Tip title="Cap each chart card's width (px). Cells stop stretching at this size, so a 2×2 layout can leave empty space on the right + bottom. 0 = no cap.">
              <Num
                label="Card max"
                value={style.cardMaxWidth}
                min={0}
                max={1200}
                step={20}
                onChange={(v) => setStyle({ cardMaxWidth: v })}
                width={130}
              />
            </Tip>
            <select
              value={style.cardBackground}
              onChange={(e) => setStyle({ cardBackground: e.target.value })}
              title="Card background"
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              <option value="panel">panel bg</option>
              <option value="white">white</option>
              <option value="transparent">transparent</option>
            </select>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10.5,
                color: t.text,
              }}
            >
              <input
                type="checkbox"
                checked={style.cardBorder}
                onChange={(e) => setStyle({ cardBorder: e.target.checked })}
                style={{ margin: 0 }}
              />
              border
            </label>
            <Num
              label="Radius"
              value={style.cardBorderRadius}
              min={0}
              max={24}
              step={1}
              onChange={(v) => setStyle({ cardBorderRadius: v })}
            />
          </div>
        </div>

        {/* Palette */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Palette
          </div>
          <select
            value={style.palette}
            onChange={(e) => setStyle({ palette: e.target.value })}
            title="Color palette used for series across the charts. `channel` = the canonical per-channel colours; other palettes override them with greyscale-safe / print-safe swatches."
            style={{
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: 3,
              padding: '3px 6px',
              fontSize: 11,
            }}
          >
            <option value="channel">channel (default)</option>
            <option value="viridis">viridis</option>
            <option value="magma">magma</option>
            <option value="mono-dark">mono — dark</option>
            <option value="mono-light">mono — light</option>
          </select>
        </div>

        {/* Export */}
        <div>
          <div
            style={{
              fontSize: 9.5,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Export
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={style.exportScale}
              onChange={(e) => setStyle({ exportScale: parseFloat(e.target.value) })}
              title="Pixel-density multiplier for the exported PNG. 3× is typical for print."
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              {[1, 2, 3, 4].map((s) => (
                <option key={s} value={s}>
                  {s}× scale
                </option>
              ))}
            </select>
            <select
              value={style.exportFormat}
              onChange={(e) => setStyle({ exportFormat: e.target.value })}
              title="PNG rasterizes the rendered tab; SVG keeps vectors for perfect scaling. SVG only covers inline charts — server PNGs stay raster."
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              <option value="png">PNG (raster)</option>
              <option value="svg">SVG (vector)</option>
            </select>
            <select
              value={style.exportBackground}
              onChange={(e) => setStyle({ exportBackground: e.target.value })}
              title="Canvas colour behind the exported charts."
              style={{
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                padding: '2px 4px',
                fontSize: 11,
              }}
            >
              <option value="auto">auto (theme)</option>
              <option value="white">white</option>
              <option value="transparent">transparent</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

const ExportLayoutPicker = ({ value, onChange, n, label = 'Layout' }) => {
  const t = useTheme();
  const options = layoutsForCount(n);
  if (n <= 1) return null; // nothing to arrange
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: t.textMuted,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <Tip title="Rearranges the plots in this tab into the chosen grid. Useful before you hit Export PNG — dom-to-image captures whatever layout is on screen.">
        <Segmented
          value={value}
          options={options.map((o) => ({ value: o.id, label: o.label }))}
          onChange={onChange}
        />
      </Tip>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ResizeHandle — a thin draggable vertical bar for resizing side panels.
//
// Owns the start-width snapshot + cumulative-delta math so the caller just
// passes `value` + `onChange(next)` + bounds. `side` picks which edge the
// handle sits on (default "right" = right edge of a panel, for resizing
// a LEFT-side sidebar). `grow` picks whether dragging right grows the
// panel (+1, left-sidebar semantics) or shrinks it (-1, right-sidebar
// semantics). `cursor: col-resize` is pinned globally during the drag so
// it doesn't flicker over child elements.
// ---------------------------------------------------------------------------
const ResizeHandle = ({
  value,
  onChange,
  min = 200,
  max = 800,
  side = 'right',
  grow = 1,
  width = 6,
}) => {
  const t = useTheme();
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = value; // snapshot at drag start, stable for the whole drag
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev) => {
      const delta = ev.clientX - startX;
      const next = Math.max(min, Math.min(max, startW + grow * delta));
      onChange(next);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setDragging(false);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const pos =
    side === 'right' ? { right: -Math.floor(width / 2) } : { left: -Math.floor(width / 2) };
  const bg = dragging ? t.accent : hover ? t.accent + '66' : 'transparent';
  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={side === 'right' ? 'Drag to resize left panel' : 'Drag to resize right panel'}
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        ...pos,
        width,
        cursor: 'col-resize',
        zIndex: 5,
        background: bg,
        transition: 'background .12s',
      }}
    />
  );
};

// ===========================================================================
// analysis-page-overhaul-v1 — Foundation primitives
// ---------------------------------------------------------------------------
// New exports that later phases migrate every analysis-modal chart onto:
//   - `tokens(style, t)` / `useTokens()`: one memoized dict of inline-style
//     objects (title, axisLabel, tick, legend, gridLine, axisLine, line,
//     marker) so chart bodies stop repeating `fontSize={scaled(...)}` boiler.
//   - `useChartGeom({ W, H, PAD, xDomain, yDomain, yFlipped })`: geometry
//     hook that honors `style.aspect` and returns `{ W, H, PAD, plotW,
//     plotH, xOf, yOf }`. No args → reads from `<Chart>` context.
//   - `<Chart title sub footer channel exportName aspect>`: single chart
//     primitive. Card chrome + title row + per-card PNG button + aspect-
//     bounded body + a `ChartGeomCtx` child SVG code reads geometry from.
//   - `<Page themeFallback>`: `PlotStyleCtx.Provider` wrapper that also
//     applies the resolved `pageBackground` to the wrapped container. If
//     `plotStyleState` isn't passed, mints its own.
//   - `renderChartToPng(node, opts)`: new export path. Pure-SVG roots
//     serialize directly (XMLSerializer → Blob → Image → canvas); canvas
//     + SVG overlays composite; HTML-heavy falls back to `renderNodeToPng`
//     (dom-to-image). No `width="100%"` collapse. No CORS panics on
//     Google Fonts — cloned SVGs inline the document's font rules.
// Old helpers (`cardChromeFor`, `ChartCard`, `mantisExport`) remain live
// until Phase 4 / Phase 5 migrate every caller.
// ===========================================================================

const tokens = (style, t) => {
  const s = style || DEFAULT_PLOT_STYLE;
  return {
    title: {
      fontSize: scaled(s.titleSize, s),
      fontWeight: s.titleWeight,
      fontStyle: s.titleItalic ? 'italic' : 'normal',
      fontFamily: s.fontFamily,
      fill: t.text,
    },
    axisLabel: {
      fontSize: scaled(s.axisLabelSize, s),
      fontWeight: s.axisLabelWeight,
      fontFamily: s.fontFamily,
      fill: t.textMuted,
    },
    tick: {
      fontSize: scaled(s.tickSize, s),
      fontWeight: s.tickWeight,
      fontFamily: s.fontFamily,
      fill: t.textMuted,
    },
    legend: {
      fontSize: scaled(s.legendSize, s),
      fontWeight: s.legendWeight,
      fontFamily: s.fontFamily,
      fill: t.textMuted,
    },
    annotation: {
      fontSize: scaled(s.annotationSize, s),
      fontFamily: s.fontFamily,
      fill: t.textMuted,
    },
    gridLine: {
      stroke: t.border,
      strokeWidth: s.gridWidth,
      opacity: s.gridOpacity,
    },
    axisLine: {
      stroke: t.border,
      strokeWidth: s.axisStrokeWidth,
      fill: 'none',
    },
    line: {
      strokeWidth: s.lineWidth,
      fill: 'none',
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
    },
    marker: {
      strokeWidth: s.markerStrokeWidth,
    },
    showGrid: !!s.showGrid,
    showLegend: s.showLegend !== false,
    palette: s.palette || 'channel',
  };
};

const useTokens = () => {
  const { style } = usePlotStyle();
  const t = useTheme();
  return useMemo(() => tokens(style, t), [style, t]);
};

// Geometry context. `<Chart>` provides; `useChartGeom()` without args reads.
const _ASPECT_RATIOS = {
  auto: null,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '3:4': 3 / 4,
};

const ChartGeomCtx = createContext(null);

const _computeGeom = ({
  W = 400,
  H = 240,
  PAD = { l: 48, r: 12, t: 14, b: 34 },
  xDomain,
  yDomain,
  yFlipped = false,
  aspect = 'auto',
} = {}) => {
  const ratio = _ASPECT_RATIOS[aspect];
  let outW = W;
  let outH = H;
  if (ratio != null && ratio > 0) outH = Math.max(60, Math.round(W / ratio));
  const plotW = Math.max(1, outW - PAD.l - PAD.r);
  const plotH = Math.max(1, outH - PAD.t - PAD.b);
  const xOf = xDomain
    ? (v) => {
        const span = xDomain[1] - xDomain[0];
        const n = span !== 0 ? (v - xDomain[0]) / span : 0;
        return PAD.l + n * plotW;
      }
    : null;
  const yOf = yDomain
    ? (v) => {
        const span = yDomain[1] - yDomain[0];
        const n = span !== 0 ? (v - yDomain[0]) / span : 0;
        return yFlipped ? PAD.t + n * plotH : PAD.t + plotH - n * plotH;
      }
    : null;
  return { W: outW, H: outH, PAD, plotW, plotH, xOf, yOf };
};

const useChartGeom = (opts) => {
  // Hooks must run in the same order every render — call all of them first,
  // then pick the winning value.
  const ctx = useContext(ChartGeomCtx);
  const { style } = usePlotStyle();
  const explicit = useMemo(
    () => (opts ? _computeGeom({ aspect: style?.aspect || 'auto', ...opts }) : null),
    [style?.aspect, opts ? JSON.stringify(opts) : null]
  );
  const fallback = useMemo(
    () => _computeGeom({ aspect: style?.aspect || 'auto' }),
    [style?.aspect]
  );
  if (explicit) return explicit;
  if (ctx) return ctx;
  return fallback;
};

// ---------------------------------------------------------------------------
// renderChartToPng — SVG-first export pipeline
// ---------------------------------------------------------------------------
// Path 1 (SVG-only node): serialize the inner <svg> directly, rasterize via
//   an in-memory <img> + <canvas>. Deterministic; no DOM traversal; no CORS
//   trap on Google Fonts.
// Path 2 (canvas + SVG composite, e.g. heatmap cards): paint each <canvas>
//   at its bounding-rect position, then paint each <svg> overlay on top.
// Path 3 (HTML-heavy, e.g. Summary tab table): renderNodeToPng → dom-to-
//   image with the same `copyDefaultStyles:false, cacheBust:true` hardening
//   that `mantisExport` already uses.

const _blobDownload = (blob, filename, ext) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  return { format: ext, bytes: blob.size };
};

const _canvasToPng = (canvas, filename) =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('canvas toBlob returned null'));
        return;
      }
      resolve(_blobDownload(blob, filename, 'png'));
    }, 'image/png');
  });

// Clone an <svg> and return a self-contained, rasterizable markup string.
// Fonts are inlined as a <style> block copying `font-family` from the
// original's computed style so the offscreen Image renders the same face.
const _serializeSvg = (svg) => {
  const rect = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  // Force exact viewBox→canvas mapping so polyline/dots/axes stay aligned.
  if (clone.getAttribute('viewBox')) {
    clone.setAttribute('preserveAspectRatio', 'none');
  }
  // Inline the font-family from the original so offscreen rasterization
  // doesn't drop to sans-serif. We don't @font-face-embed Google Fonts;
  // that's Phase 5 territory. Falls back to ui-sans-serif cleanly.
  const cs = window.getComputedStyle(svg);
  const ff = cs.fontFamily || 'Inter Tight, ui-sans-serif, system-ui, sans-serif';
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = `svg, svg * { font-family: ${ff}; }`;
  clone.insertBefore(styleEl, clone.firstChild);
  const xml = new XMLSerializer().serializeToString(clone);
  return { xml, w, h };
};

const _loadSvgAsImage = (xml) =>
  new Promise((resolve, reject) => {
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });

const _resolveExportBg = (style, themeFallback) => {
  const pb = style?.exportBackground;
  if (pb === 'transparent') return null;
  if (pb === 'white') return '#ffffff';
  return themeFallback || '#ffffff';
};

const renderChartToPng = async (node, opts = {}) => {
  if (!node) throw new Error('no node to render');
  const {
    filename = `mantis-chart-${Date.now()}`,
    style = DEFAULT_PLOT_STYLE,
    themeFallbackBg,
  } = opts;
  const scale = Number.isFinite(style.exportScale) ? style.exportScale : 2;
  const format = style.exportFormat === 'svg' ? 'svg' : 'png';
  const bg = _resolveExportBg(style, themeFallbackBg);

  // SVG export format: skip the raster path entirely — serialize the node
  // (or its only <svg>) and download.
  if (format === 'svg') {
    return renderNodeToPng(node, { filename, style, themeFallbackBg });
  }

  // Hide export-hostile UI (per-card buttons, tab toolbars, etc.) while
  // rasterizing. Restores on finally so the live DOM is untouched.
  const hidden = [...node.querySelectorAll('[data-no-export]')];
  const prevDisp = hidden.map((n) => n.style.display);
  hidden.forEach((n) => {
    n.style.display = 'none';
  });
  await Promise.resolve();

  try {
    const svgs = [...node.querySelectorAll('svg')];
    const canvases = [...node.querySelectorAll('canvas')];
    // Path 1: single SVG, no canvas → direct serialize.
    if (svgs.length === 1 && canvases.length === 0) {
      const { xml, w, h } = _serializeSvg(svgs[0]);
      const img = await _loadSvgAsImage(xml);
      const out = document.createElement('canvas');
      out.width = Math.round(w * scale);
      out.height = Math.round(h * scale);
      const ctx = out.getContext('2d');
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, out.width, out.height);
      }
      ctx.drawImage(img, 0, 0, out.width, out.height);
      return await _canvasToPng(out, filename);
    }
    // Path 2: any canvas present, or multiple SVGs → composite by
    // bounding-rect position relative to `node`.
    if (canvases.length > 0 || svgs.length > 1) {
      const rect = node.getBoundingClientRect();
      const W = Math.max(1, Math.round(rect.width * scale));
      const H = Math.max(1, Math.round(rect.height * scale));
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const ctx = out.getContext('2d');
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
      }
      // Paint canvases first (the heatmap raster layer).
      for (const c of canvases) {
        const r = c.getBoundingClientRect();
        const dx = Math.round((r.left - rect.left) * scale);
        const dy = Math.round((r.top - rect.top) * scale);
        const dw = Math.max(1, Math.round(r.width * scale));
        const dh = Math.max(1, Math.round(r.height * scale));
        try {
          ctx.drawImage(c, dx, dy, dw, dh);
        } catch {
          /* tainted canvas */
        }
      }
      // Paint SVGs on top, in document order.
      for (const s of svgs) {
        const r = s.getBoundingClientRect();
        const dx = Math.round((r.left - rect.left) * scale);
        const dy = Math.round((r.top - rect.top) * scale);
        const dw = Math.max(1, Math.round(r.width * scale));
        const dh = Math.max(1, Math.round(r.height * scale));
        const { xml } = _serializeSvg(s);
        const img = await _loadSvgAsImage(xml);
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      return await _canvasToPng(out, filename);
    }
    // Path 3: no SVG and no canvas → HTML-only card. Fall back to dom-to-image.
    return await renderNodeToPng(node, { filename, style, themeFallbackBg });
  } finally {
    hidden.forEach((n, i) => {
      n.style.display = prevDisp[i] || '';
    });
  }
};

// HTML-heavy fallback — uses dom-to-image-more with the same hardening
// `mantisExport` already uses. Kept here so both paths share the filename
// + style + bg resolution.
const renderNodeToPng = async (node, opts = {}) => {
  if (!node) throw new Error('no node to render');
  const dti = domtoimage;
  if (!dti) throw new Error('dom-to-image not loaded');
  const {
    filename = `mantis-chart-${Date.now()}`,
    style = DEFAULT_PLOT_STYLE,
    themeFallbackBg,
  } = opts;
  const scale = Number.isFinite(style.exportScale) ? style.exportScale : 2;
  const format = style.exportFormat === 'svg' ? 'svg' : 'png';
  const bg =
    style.exportBackground === 'transparent'
      ? 'transparent'
      : style.exportBackground === 'white'
        ? '#ffffff'
        : themeFallbackBg || '#ffffff';
  const hidden = [...node.querySelectorAll('[data-no-export]')];
  const prevDisp = hidden.map((n) => n.style.display);
  hidden.forEach((n) => {
    n.style.display = 'none';
  });
  // Lock inner SVG pixel sizes so dom-to-image's data-URL SVG image doesn't
  // collapse `width="100%"` to 300 × 150 on serialize.
  const svgs = [...node.querySelectorAll('svg')];
  const origAttrs = svgs.map((s) => {
    const r = s.getBoundingClientRect();
    const prev = {
      w: s.getAttribute('width'),
      h: s.getAttribute('height'),
      pa: s.getAttribute('preserveAspectRatio'),
    };
    if (r.width && r.height) {
      s.setAttribute('width', String(Math.round(r.width)));
      s.setAttribute('height', String(Math.round(r.height)));
      s.setAttribute('preserveAspectRatio', 'none');
    }
    return { svg: s, prev };
  });
  void node.offsetHeight;
  const dopts = {
    scale,
    width: node.scrollWidth,
    height: node.scrollHeight,
    copyDefaultStyles: false,
    cacheBust: true,
  };
  if (bg !== 'transparent') dopts.bgcolor = bg;
  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`export timed out after ${ms / 1000}s`)), ms)
      ),
    ]);
  try {
    let blob;
    if (format === 'svg') {
      const dataUrl = await withTimeout(dti.toSvg(node, dopts), 15000);
      const svgText = decodeURIComponent(
        dataUrl.replace(/^data:image\/svg\+xml;charset=utf-8,/, '')
      );
      blob = new Blob([svgText], { type: 'image/svg+xml' });
    } else {
      blob = await withTimeout(dti.toBlob(node, dopts), 15000);
    }
    return _blobDownload(blob, filename, format);
  } finally {
    hidden.forEach((n, i) => {
      n.style.display = prevDisp[i] || '';
    });
    origAttrs.forEach(({ svg, prev }) => {
      if (prev.w == null) svg.removeAttribute('width');
      else svg.setAttribute('width', prev.w);
      if (prev.h == null) svg.removeAttribute('height');
      else svg.setAttribute('height', prev.h);
      if (prev.pa == null) svg.removeAttribute('preserveAspectRatio');
      else svg.setAttribute('preserveAspectRatio', prev.pa);
    });
  }
};

// ---------------------------------------------------------------------------
// <Chart> — the single chart primitive.
// ---------------------------------------------------------------------------
// Props:
//   title, sub, footer, channel, exportName, aspect, noExport, children
//   geom: { W, H, PAD, xDomain, yDomain, yFlipped } — optional; when
//         provided, `<Chart>` computes geometry once and exposes it to
//         child SVG code via `useChartGeom()`. Without `geom`, children
//         either call `useChartGeom({W,H,...})` with their own opts or
//         fall back to a bare default.
const Chart = ({
  title,
  sub,
  footer,
  channel,
  exportName,
  aspect,
  noExport = false,
  geom,
  chartBg, // optional override for body background
  children,
  className,
  style: extraCssStyle,
}) => {
  const t = useTheme();
  const { style } = usePlotStyle();
  const tok = useMemo(() => tokens(style, t), [style, t]);
  const chrome = cardChromeFor(style, t);
  const cardRef = useRef(null);

  const resolvedAspect = aspect || style?.aspect || 'auto';
  const ratio = _ASPECT_RATIOS[resolvedAspect];
  const geomValue = useMemo(() => {
    if (!geom) return null;
    return _computeGeom({ aspect: resolvedAspect, ...geom });
  }, [resolvedAspect, geom && JSON.stringify(geom)]);

  const displayTitle = title || channel;
  const hasHeader = displayTitle || sub || !noExport;

  const onExport = async () => {
    const base = exportName || (channel ? `mantis-${channel}` : 'mantis-chart');
    const name = `${base}-${Date.now()}`.replace(/\s+/g, '_').toLowerCase();
    try {
      await renderChartToPng(cardRef.current, {
        filename: name,
        style,
        themeFallbackBg: t.panel,
      });
    } catch (err) {
      console.error('Chart export failed', err);
    }
  };

  const bodyStyle = {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    background: chartBg || chartBodyBgFor(style, t),
    aspectRatio: ratio != null ? `${ratio}` : undefined,
    display: 'flex',
    flexDirection: 'column',
  };

  const content = (
    <div
      ref={cardRef}
      className={className}
      style={{
        ...chrome,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: style.cardBorder ? `0 1px 2px ${t.shadow || 'rgba(0,0,0,0.04)'}` : 'none',
        ...extraCssStyle,
      }}
    >
      {hasHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            marginBottom: 6,
            flexWrap: 'wrap',
          }}
        >
          {channel && (
            <>
              <span
                style={{
                  width: scaled(9, style),
                  height: scaled(9, style),
                  borderRadius: '50%',
                  background: paletteColor(style, channel),
                  flexShrink: 0,
                }}
              />
              <span style={{ ...tok.title }}>{channel}</span>
            </>
          )}
          {title && !channel && <span style={{ ...tok.title }}>{title}</span>}
          {sub && <span style={{ ...tok.legend, color: t.textMuted }}>{sub}</span>}
          <span style={{ flex: 1 }} />
          {!noExport && (
            <button
              data-no-export
              onClick={onExport}
              title="Download this chart as an image (tight crop)"
              style={{
                background: 'transparent',
                border: `1px solid ${t.border}`,
                color: t.textMuted,
                borderRadius: 4,
                padding: '2px 6px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 10.5,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon name="export" size={10} />
              PNG
            </button>
          )}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
      {footer && (
        <div
          style={{
            marginTop: 6,
            ...tok.legend,
            color: t.textMuted,
            lineHeight: 1.5,
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );

  if (geomValue) {
    return <ChartGeomCtx.Provider value={geomValue}>{content}</ChartGeomCtx.Provider>;
  }
  return content;
};

// ---------------------------------------------------------------------------
// <Page> — PlotStyleCtx provider + resolved page background.
// ---------------------------------------------------------------------------
// Use it to wrap the analysis-modal body. If `plotStyleState` is passed
// (from an existing `usePlotStyleState()` call), the Provider forwards it
// untouched; otherwise `<Page>` mints its own so callers can drop it in
// without plumbing state manually.
const Page = ({
  plotStyleState, // optional; must match PlotStyleCtx's expected shape
  themeFallback, // resolves the 'theme' pageBackground token
  as: Tag = 'div',
  style: cssStyle,
  children,
  ...rest
}) => {
  const t = useTheme();
  // Hooks must run unconditionally — always mint a local state; if the
  // caller passed `plotStyleState`, that wins below.
  const ownState = usePlotStyleState();
  const value = plotStyleState || ownState;
  const style = value?.style || DEFAULT_PLOT_STYLE;
  const bg = pageBgFor(style, t, themeFallback);
  return (
    <PlotStyleCtx.Provider value={value}>
      <Tag style={{ background: bg, ...cssStyle }} {...rest}>
        {children}
      </Tag>
    </PlotStyleCtx.Provider>
  );
};

export {
  THEMES,
  CHANNEL_COLORS,
  ELEMENT_COLORS,
  BRAND,
  IMAGE_DIMS,
  ThemeCtx,
  useTheme,
  defaultAnalysisChannels,
  Icon,
  Card,
  Row,
  Slider,
  Select,
  Button,
  ChannelChip,
  Segmented,
  Checkbox,
  Spinbox,
  StatBlock,
  HUD,
  CanvasToolbar,
  CanvasBtn,
  parseChannel,
  sCycColor,
  makeUSAFImage,
  makeFPNImage,
  makeDoFImage,
  Tip,
  Kbd,
  Modal,
  Toast,
  useLocalStorageState,
  useImageMouse,
  useDragCapture,
  useViewport,
  modeGrid,
  distSegment,
  downloadBlob,
  exportJSON,
  exportCSV,
  pickImageFile,
  // server API
  API_BASE,
  apiFetch,
  apiUpload,
  channelPngUrl,
  formatApiDetail,
  colormapStripUrl,
  SourceCtx,
  useSource,
  useDebounced,
  FileFilterCtx,
  useFileFilter,
  // layout
  ResizeHandle,
  DraggablePanelList,
  FloatingWindow,
  ExportLayoutPicker,
  gridStyleFor,
  layoutsForCount,
  LAYOUT_OPTIONS,
  // plotStyle (analysis-polish-v1)
  PlotStyleCtx,
  usePlotStyle,
  usePlotStyleState,
  DEFAULT_PLOT_STYLE,
  PLOT_STYLE_PRESETS,
  PLOT_FONT_FAMILIES,
  PLOT_PALETTES,
  PlotTitle,
  AxisLabel,
  AxisTick,
  LegendLabel,
  GridLine,
  scaled,
  legendCssFor,
  plotPaletteColor,
  cardChromeFor,
  PlotStylePanel,
  CanvasColorbar,
  // Heatmap primitives (plot-style-completion-v1)
  HeatmapCanvas,
  HeatmapColorBar,
  decodeFloat32Grid,
  decodeUint8Mask,
  colormapLUT,
  CMAP_STOPS,
  // analysis-page-overhaul-v1 foundation primitives
  Chart,
  Page,
  ChartGeomCtx,
  useChartGeom,
  tokens,
  useTokens,
  channelColor,
  paletteColor,
  pageBgFor,
  chartBodyBgFor,
  renderChartToPng,
  renderNodeToPng,
};
