// Playback mode — procedural fake data generators
// MantisAnalysis · BioSensors Lab @ UIUC
//
// Deliberately synthetic. A future backend replaces these generators with
// real H5 metadata reads; shape of the returned objects is the contract.

// ---------------------------------------------------------------------------
// Fake streams & files
// ---------------------------------------------------------------------------

// Channels are gated by gain class. A view picks a gain class (HG or LG)
// first, then picks a band within that class. The UI enforces this.
const CHANNELS_HG = ['HG-R', 'HG-G', 'HG-B', 'HG-NIR', 'HG-Y'];
const CHANNELS_LG = ['LG-R', 'LG-G', 'LG-B', 'LG-NIR', 'LG-Y'];
const ALL_CHANNELS = [...CHANNELS_HG, ...CHANNELS_LG];
const BANDS = ['R', 'G', 'B', 'NIR', 'Y'];
const gainClassOf = (ch) => (ch || '').startsWith('LG') ? 'LG' : 'HG';
const bandOf = (ch) => (ch || '').split('-')[1] || 'G';
const makeChannel = (gc, band) => `${gc}-${band}`;
const channelsIn = (gc) => gc === 'LG' ? CHANNELS_LG : CHANNELS_HG;

const COLORMAPS = [
  'viridis', 'inferno', 'magma', 'plasma',
  'cividis', 'turbo', 'gray', 'hot', 'cool',
];

const BLEND_MODES = [
  { value: 'alpha',    label: 'Alpha blend' },
  { value: 'additive', label: 'Additive' },
  { value: 'screen',   label: 'Screen' },
  { value: 'masked',   label: 'Masked pseudocolor' },
];

// Synthetic files — enough variety to exercise continuity/gap/mismatch badges.
const FAKE_FILES_DEFAULT = () => ([
  {
    id: 'f1',
    name: 'recording_001.h5',
    frames: 1200,
    width: 1920, height: 1080,
    channels: CHANNELS_HG,
    exposureMs: 20,
    tsStart: 0,           // seconds into the logical stream
    tsEnd: 40.0,
    fps: 30.0,
    sizeMB: 812,
    status: 'ok',
    warnings: [],
  },
  {
    id: 'f2',
    name: 'recording_002.h5',
    frames: 1200,
    width: 1920, height: 1080,
    channels: CHANNELS_HG,
    exposureMs: 20,
    tsStart: 40.8,        // 0.8 s gap from previous
    tsEnd: 80.8,
    fps: 30.0,
    sizeMB: 812,
    status: 'ok',
    warnings: ['W-GAP-0.8'],
  },
  {
    id: 'f3',
    name: 'recording_003.h5',
    frames: 1400,
    width: 1920, height: 1080,
    channels: CHANNELS_HG,
    exposureMs: 40,       // exposure mismatch
    tsStart: 80.8,
    tsEnd: 80.8 + 1400 / 25, // 56 s at 25 fps
    fps: 25.0,
    sizeMB: 960,
    status: 'ok',
    warnings: ['W-EXP-MISMATCH'],
  },
]);

const FAKE_DARKS_DEFAULT = () => ([
  {
    id: 'd1',
    name: 'dark_20ms_32.h5',
    exposureMs: 20,
    framesAveraged: 32,
    sizeMB: 28,
    status: 'matched',
    matchedToViews: ['v1'],
  },
  {
    id: 'd2',
    name: 'dark_40ms_64.h5',
    exposureMs: 40,
    framesAveraged: 64,
    sizeMB: 52,
    status: 'available',
    matchedToViews: [],
  },
  {
    id: 'd3',
    name: 'dark_10ms_16.h5',
    exposureMs: 10,
    framesAveraged: 16,
    sizeMB: 14,
    status: 'orphan', // no matching recording exposure
    matchedToViews: [],
  },
]);

// Build the stream from an ordered list of files.
const buildStream = (files, continuityThresholdSec = 1.0) => {
  const active = files.filter((f) => f.status !== 'quarantined');
  const totalFrames = active.reduce((s, f) => s + f.frames, 0);
  const totalDuration = active.reduce((s, f) => s + (f.tsEnd - f.tsStart), 0);
  const boundaries = [];
  let offsetFrame = 0;
  let lastTsEnd = null;
  let gapCount = 0, overlapCount = 0, expMismatchCount = 0;
  const baseExposure = active[0]?.exposureMs;
  for (const f of active) {
    boundaries.push({
      fileId: f.id,
      startFrame: offsetFrame,
      endFrame: offsetFrame + f.frames,
      tsStart: f.tsStart,
      tsEnd: f.tsEnd,
    });
    if (lastTsEnd != null) {
      const gap = f.tsStart - lastTsEnd;
      if (gap > continuityThresholdSec) gapCount++;
      if (gap < -1e-6) overlapCount++;
    }
    if (baseExposure != null && f.exposureMs !== baseExposure) expMismatchCount++;
    lastTsEnd = f.tsEnd;
    offsetFrame += f.frames;
  }
  return {
    name: 'Stream · ' + new Date().toISOString().slice(0, 10),
    files: active,
    allFiles: files, // includes quarantined
    totalFrames,
    totalDuration,
    boundaries,
    issues: { gapCount, overlapCount, expMismatchCount },
    continuityThresholdSec,
    baseExposureMs: baseExposure,
    width: active[0]?.width || 1920,
    height: active[0]?.height || 1080,
    fps: active[0]?.fps || 30,
  };
};

// Given a global frame index, find its source file.
const frameToFile = (stream, frame) => {
  if (!stream) return null;
  for (const b of stream.boundaries) {
    if (frame >= b.startFrame && frame < b.endFrame) {
      return {
        boundary: b,
        file: stream.files.find((f) => f.id === b.fileId),
        localFrame: frame - b.startFrame,
      };
    }
  }
  return null;
};

// Format seconds as mm:ss.fff
const fmtTime = (sec) => {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
};
const fmtDuration = (sec) => {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// Default viewer configuration
// ---------------------------------------------------------------------------

const DEFAULT_VIEW = (i, preset = {}) => {
  const baseCh = preset.channel || 'HG-G';
  const gc = preset.gainClass || gainClassOf(preset.channels?.[0] || baseCh);
  return ({
  id: `v${i}`,
  name: preset.name || `View ${i}`,
  type: preset.type || 'single', // 'single' | 'rgb' | 'overlay' | 'comparison'
  gainClass: gc,                  // 'HG' | 'LG' — gates all band pickers in this view
  channel: baseCh.startsWith(gc) ? baseCh : makeChannel(gc, bandOf(baseCh)),
  channels: (preset.channels || [makeChannel(gc, 'R'), makeChannel(gc, 'G'), makeChannel(gc, 'B')])
              .map(c => c.startsWith(gc) ? c : makeChannel(gc, bandOf(c))),
  syncToGlobal: preset.syncToGlobal ?? true,
  lockedFrame: preset.lockedFrame ?? null,
  exportInclude: preset.exportInclude ?? true,
  // corrections
  darkOn: preset.darkOn ?? false,
  darkId: preset.darkId ?? null,
  gain: preset.gain ?? 1.0,
  offset: preset.offset ?? 0,
  normalize: preset.normalize ?? false,
  // display
  low: preset.low ?? 30,
  high: preset.high ?? 900,
  colormap: preset.colormap || 'viridis',
  invert: preset.invert ?? false,
  showClipped: preset.showClipped ?? false,
  // rgb grading (only used for rgb view type)
  rgbGains: preset.rgbGains || { r: 1.0, g: 1.0, b: 1.0 },
  rgbOffsets: preset.rgbOffsets || { r: 0, g: 0, b: 0 },
  gamma: preset.gamma ?? 1.0,
  brightness: preset.brightness ?? 0,
  contrast: preset.contrast ?? 1.0,
  saturation: preset.saturation ?? 1.0,
  whiteBalanceK: preset.whiteBalanceK ?? 5500,
  beforeAfter: preset.beforeAfter ?? false,
  // overlay
  overlayEnabled: preset.overlayEnabled ?? false,
  overlay: preset.overlay || {
    baseViewId: null,
    channel: 'HG-NIR',
    low: 300, high: 900,
    blendMode: 'alpha', strength: 0.65,
    belowThr: 'hide', aboveThr: 'saturate',
    overlayColormap: 'inferno',
  },
  // labels
  labels: preset.labels || {
    timestamp: true, frame: true, channel: false, source: false,
    scaleBar: false, badges: true, legend: true,
  },
});
};

const LAYOUT_PRESETS = [
  { id: 'single',     label: 'Single',           cells: [[0, 0, 2, 2]] }, // col, row, cspan, rspan in 2×2 grid
  { id: 'side',       label: 'Side by side',     cells: [[0, 0, 1, 2], [1, 0, 1, 2]] },
  { id: 'stack',      label: 'Stack',            cells: [[0, 0, 2, 1], [0, 1, 2, 1]] },
  { id: '2x2',        label: '2 × 2',            cells: [[0, 0, 1, 1], [1, 0, 1, 1], [0, 1, 1, 1], [1, 1, 1, 1]] },
  { id: '3plus1',     label: '3 + 1',            cells: [[0, 0, 1, 2], [1, 0, 1, 1], [1, 1, 1, 1], [0, 2, 2, 1]], rows: 3 },
];

// ---------------------------------------------------------------------------
// Canonical warning messages
// ---------------------------------------------------------------------------
const WARNINGS = {
  'W-META-TS':     { severity: 'info',    text: (f) => `${f?.name || ''}: missing timestamp metadata.` },
  'W-META-EXP':    { severity: 'warning', text: (f) => `${f?.name || ''}: missing exposure metadata.` },
  'W-EXP-MISMATCH':{ severity: 'warning', text: (ctx) => ctx?.name
                       ? `${ctx.name}: exposure ${ctx.exposureMs} ms differs from stream base.`
                       : `Dark exposure (${ctx?.dark} ms) does not match recording (${ctx?.rec} ms).` },
  'W-SHAPE':       { severity: 'error',   text: (ctx) => `${ctx.name} dimensions (${ctx.dx}×${ctx.dy}) do not match stream (${ctx.sx}×${ctx.sy}).` },
  'W-CHAN':        { severity: 'error',   text: (ctx) => `${ctx.name} is missing channel ${ctx.ch}. Overlay unavailable.` },
  'W-DARK-NONE':   { severity: 'warning', text: (ctx) => `No dark frame available for exposure ${ctx?.ms ?? ctx?.exposureMs ?? '?'} ms.` },
  'W-DARK-AMBIG':  { severity: 'info',    text: (ctx) => `Multiple dark frames match ${ctx.ms} ms. Using most recent.` },
  'W-OVL-SRC':     { severity: 'error',   text: () => `Overlay source is incompatible with base view.` },
  'W-EXPORT-LONG': { severity: 'warning', text: (ctx) => `Export covers ${ctx.n} frames (~${ctx.t} min). Continue?` },
  'W-FRAME-FAIL':  { severity: 'warning', text: (ctx) => `Frame ${ctx.n} failed to decode.` },
  'W-PROC-INVALID':{ severity: 'info',    text: () => `Processing setting out of range; reverted to default.` },
  'W-RANGE-HUGE':  { severity: 'warning', text: (ctx) => `Export range exceeds recommended limit (${ctx.n} frames).` },
  'W-GAP-0.8':     { severity: 'warning', text: (f) => `${f?.name || 'File'}: 0.8 s gap from previous file.` },
};

Object.assign(window, {
  CHANNELS_HG, CHANNELS_LG, ALL_CHANNELS, BANDS,
  gainClassOf, bandOf, makeChannel, channelsIn,
  COLORMAPS, BLEND_MODES,
  FAKE_FILES_DEFAULT, FAKE_DARKS_DEFAULT,
  buildStream, frameToFile, fmtTime, fmtDuration,
  DEFAULT_VIEW, LAYOUT_PRESETS, WARNINGS,
});
