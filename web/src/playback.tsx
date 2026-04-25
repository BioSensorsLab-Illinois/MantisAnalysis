// @ts-nocheck
// Play / Recording Inspection mode — 4th MantisAnalysis mode.
// play-tab-recording-inspection-rescue-v1
//
// Owns the mode's full state (recordings, darks, views, frame, playback).
// Renders the seven-region template layout. M3 stage: empty state +
// stream header + sources panel + multi-file load. ViewerGrid / Inspector /
// Timeline are placeholders (M4+).
import React from 'react';
import {
  useTheme,
  Icon,
  Button,
  Card,
  Row,
  Modal,
  Slider,
  Select,
  Checkbox,
  Spinbox,
  Tip,
  apiFetch,
  apiUpload,
  apiUploadProgress,
  API_BASE,
  useLocalStorageState,
  useViewport,
} from './shared.tsx';

const {
  useState: useStatePb,
  useEffect: useEffectPb,
  useCallback: useCallbackPb,
  useMemo: useMemoPb,
  useRef: useRefPb,
} = React;

// ---------------------------------------------------------------------------
// Helpers — frame URL builders, exposure formatting
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module-level frame blob cache. LRU of url → objectURL. Smashes the
// black-flash-between-frames issue: every ViewerCard's fetch hits this
// cache first; on miss, fetch + populate; on hit, instant. Combined with
// the double-buffered render path (image stays visible until the new src
// loads), playback feels continuous even at 30 FPS.
// ---------------------------------------------------------------------------

const FRAME_CACHE_MAX = 96; // ~96 PNGs at ~150 KB each ≈ 14 MB; cheap
const _frameBlobCache = new Map(); // url → objectURL (insertion order = recency)

const _frameCacheGet = (url) => {
  const v = _frameBlobCache.get(url);
  if (v != null) {
    // Bump recency
    _frameBlobCache.delete(url);
    _frameBlobCache.set(url, v);
  }
  return v;
};

const _frameCachePut = (url, objUrl) => {
  if (_frameBlobCache.has(url)) {
    _frameBlobCache.delete(url);
  }
  _frameBlobCache.set(url, objUrl);
  while (_frameBlobCache.size > FRAME_CACHE_MAX) {
    const oldestKey = _frameBlobCache.keys().next().value;
    const oldestVal = _frameBlobCache.get(oldestKey);
    _frameBlobCache.delete(oldestKey);
    if (oldestVal) URL.revokeObjectURL(oldestVal);
  }
};

// Purge every blob-cache entry whose URL contains a given source id.
// Called when an ISP reconfigure on that source changes the bytes the
// server would now return, but the URL key (which is per-frame +
// per-channel + per-display-state) is unchanged. Without this purge,
// the Play canvas would show the pre-reconfigure image indefinitely
// because we'd never re-fetch.
const _frameCachePurgeForSource = (sourceId) => {
  if (!sourceId) return 0;
  const needle = `/api/sources/${sourceId}/`;
  const dropped = [];
  for (const [k, v] of _frameBlobCache) {
    if (k.includes(needle)) dropped.push([k, v]);
  }
  for (const [k, v] of dropped) {
    _frameBlobCache.delete(k);
    if (v) URL.revokeObjectURL(v);
  }
  return dropped.length;
};

// Fire-and-forget prefetch. Used during playback to pre-warm the next
// frame's blob so the next render is instant.
const _prefetchFrame = async (url) => {
  if (!url || _frameBlobCache.has(url)) return;
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const blob = await r.blob();
    if (_frameBlobCache.has(url)) return;
    const objUrl = URL.createObjectURL(blob);
    _frameCachePut(url, objUrl);
  } catch {
    /* prefetch failures are silent */
  }
};

// M22 — append per-channel RGB grading params. Mutates `q`. Skips
// writes when the value is the backend default. WB Kelvin is treated
// as no-op when null OR within 1 K of D65 (6500).
const _appendGradingQuery = (q, grading) => {
  if (!grading) return;
  const eps = 1e-6;
  const w = (k, v, def) => {
    if (v == null) return;
    if (Math.abs(Number(v) - def) > eps) q.set(k, String(v));
  };
  w('gain_r', grading.gain_r, 1.0);
  w('gain_g', grading.gain_g, 1.0);
  w('gain_b', grading.gain_b, 1.0);
  w('offset_r', grading.offset_r, 0.0);
  w('offset_g', grading.offset_g, 0.0);
  w('offset_b', grading.offset_b, 0.0);
  w('gamma_g', grading.gamma, 1.0);
  w('brightness_g', grading.brightness, 0.0);
  w('contrast_g', grading.contrast, 1.0);
  w('saturation_g', grading.saturation, 1.0);
  if (grading.wb_kelvin != null && Math.abs(Number(grading.wb_kelvin) - 6500) > 1) {
    q.set('wb_kelvin', String(grading.wb_kelvin));
  }
};

// M21 — append burn-in label query params shared by channel + rgb routes.
// Mutates `q`. Skips writes when the value is the backend default so
// the URL stays compact and the browser HTTP cache key stays stable.
const _appendLabelsQuery = (q, labels) => {
  if (!labels) return;
  if (labels.timestamp) q.set('labels_timestamp', 'true');
  if (labels.frame) q.set('labels_frame', 'true');
  if (labels.channel) q.set('labels_channel', 'true');
  if (labels.source_file) q.set('labels_source', 'true');
  if (labels.scale_bar) q.set('labels_scale_bar', 'true');
  if (labels.position && labels.position !== 'bottom-left') {
    q.set('labels_position', labels.position);
  }
  if (labels.font_size && labels.font_size !== 12) {
    q.set('labels_font_size', String(labels.font_size));
  }
};

// M20.1 — append the ISP query params shared by channel + rgb routes.
// Mutates `q`. Skips writes when the value is the backend default so
// the URL stays compact (and the browser HTTP cache key stays stable
// across no-op state changes).
const _appendIspQuery = (q, opts, { gainKey = 'gain' } = {}) => {
  if (opts.normalize && opts.normalize !== 'auto') q.set('normalize', opts.normalize);
  if (opts.blackLevel != null && Math.abs(opts.blackLevel) > 1e-6) {
    q.set('black_level', String(opts.blackLevel));
  }
  if (opts.gain != null && Math.abs(opts.gain - 1.0) > 1e-6) {
    q.set(gainKey, String(opts.gain));
  }
  if (opts.offset != null && Math.abs(opts.offset) > 1e-6) {
    q.set('offset', String(opts.offset));
  }
  if (opts.brightness != null && Math.abs(opts.brightness) > 1e-6) {
    q.set('brightness', String(opts.brightness));
  }
  if (opts.contrast != null && Math.abs(opts.contrast - 1.0) > 1e-6) {
    q.set('contrast', String(opts.contrast));
  }
  if (opts.gamma != null && Math.abs(opts.gamma - 1.0) > 1e-6) {
    q.set('gamma', String(opts.gamma));
  }
};

// M26 — append the non-linear sharpen / FPN ISP-chain query params for
// the per-frame channel + rgb routes. Field names match the FastAPI
// route's `Query(...)` defaults verbatim. Skips defaults so URLs stay
// compact (and the browser HTTP cache key stays stable across no-op
// state changes). Backend gating in `_isp_chain_from_query` short-
// circuits when no stage is active.
const _appendIspChainQuery = (q, isp) => {
  if (!isp) return;
  if (isp.sharpen_method && isp.sharpen_method !== 'None') {
    q.set('sharpen_method', String(isp.sharpen_method));
    if (isp.sharpen_amount != null && Math.abs(isp.sharpen_amount - 1.0) > 1e-6) {
      q.set('sharpen_amount', String(isp.sharpen_amount));
    }
    if (isp.sharpen_radius != null && Math.abs(isp.sharpen_radius - 2.0) > 1e-6) {
      q.set('sharpen_radius', String(isp.sharpen_radius));
    }
  }
  if (isp.denoise_sigma != null && isp.denoise_sigma > 0.05) {
    q.set('denoise_sigma', String(isp.denoise_sigma));
  }
  if (isp.median_size != null && isp.median_size >= 3) {
    q.set('median_size', String(isp.median_size));
  }
  if (isp.gaussian_sigma != null && isp.gaussian_sigma > 0.05) {
    q.set('gaussian_sigma', String(isp.gaussian_sigma));
  }
  if (isp.hot_pixel_thr != null && isp.hot_pixel_thr > 0.5) {
    q.set('hot_pixel_thr', String(isp.hot_pixel_thr));
  }
  if (isp.bilateral) {
    q.set('bilateral', 'true');
  }
};

const frameChannelPngUrl = (sid, frameIdx, channel, opts = {}) => {
  const q = new URLSearchParams();
  if (opts.maxDim) q.set('max_dim', String(opts.maxDim));
  if (opts.colormap && opts.colormap !== 'gray') q.set('colormap', opts.colormap);
  // Forward thresholds independently — the backend's _norm_to_unit
  // accepts either bound alone (the missing side falls back to its
  // 1st/99.5th-percentile auto value). Earlier behavior required BOTH
  // to be non-null which made a single Spinbox change a no-op.
  if (opts.vmin != null) q.set('vmin', String(opts.vmin));
  if (opts.vmax != null) q.set('vmax', String(opts.vmax));
  if (opts.rgbComposite) q.set('rgb_composite', 'true');
  if (opts.applyDark === false) q.set('apply_dark', 'false');
  // M20: forward the show-clipped-pixels toggle so the backend paints
  // magenta on saturated pixels.
  if (opts.showClipping) q.set('show_clipping', 'true');
  // M20.1: forward the ISP pipeline (normalize / black / gain / offset /
  // brightness / contrast / gamma).
  _appendIspQuery(q, opts);
  // M26: forward the non-linear sharpen / FPN chain when the view set it.
  _appendIspChainQuery(q, opts.ispChain);
  // M21: forward burn-in label flags so the backend paints metadata
  // onto the rendered frame in JetBrains Mono.
  _appendLabelsQuery(q, opts.labels);
  // M22: forward per-channel RGB grading (only honored when
  // ?rgb_composite=true; channel-mode requests harmlessly carry the
  // params).
  _appendGradingQuery(q, opts.grading);
  // ISP-version cache-buster. Backend ignores ``_isp_v``; the only
  // effect is to shift the URL key on reconfigure so the frontend
  // blob cache misses and re-fetches.
  if (opts.ispVersion) q.set('_isp_v', String(opts.ispVersion));
  return `${API_BASE}/api/sources/${sid}/frame/${frameIdx}/channel/${encodeURIComponent(channel)}/thumbnail.png?${q.toString()}`;
};

const frameRgbUrl = (sid, frameIdx, gain = 'hg', opts = {}) => {
  const q = new URLSearchParams({ gain });
  if (opts.maxDim) q.set('max_dim', String(opts.maxDim));
  // Forward thresholds — RGB composite endpoint applies vmin/vmax to
  // every per-channel normalize. Backend route requires both to be
  // non-null to take effect, so guard accordingly. Earlier builder
  // dropped them entirely, which made the Inspector Low/High threshold
  // sliders no-ops on every RGB view.
  if (opts.vmin != null && opts.vmax != null) {
    q.set('vmin', String(opts.vmin));
    q.set('vmax', String(opts.vmax));
  }
  if (opts.applyDark === false) q.set('apply_dark', 'false');
  // M20.1: ISP pipeline. The RGB route's `gain` query param is the
  // HG/LG selector — back-end exposes the linear gain as `isp_gain`.
  _appendIspQuery(q, opts, { gainKey: 'isp_gain' });
  // M26: forward the non-linear sharpen / FPN chain when the view set it.
  _appendIspChainQuery(q, opts.ispChain);
  // M21: burn-in labels.
  _appendLabelsQuery(q, opts.labels);
  // M22: per-channel RGB grading + WB Kelvin.
  _appendGradingQuery(q, opts.grading);
  // ISP-version cache-buster.
  if (opts.ispVersion) q.set('_isp_v', String(opts.ispVersion));
  return `${API_BASE}/api/sources/${sid}/frame/${frameIdx}/rgb.png?${q.toString()}`;
};

const frameOverlayUrl = (sid, frameIdx, opts = {}) => {
  const q = new URLSearchParams({
    base_channel: opts.baseChannel || 'HG-R',
    overlay_channel: opts.overlayChannel || 'HG-NIR',
    base_kind: opts.baseKind || 'rgb_composite',
    blend: opts.blend || 'alpha',
    strength: String(opts.strength ?? 0.65),
    overlay_colormap: opts.overlayColormap || 'inferno',
  });
  if (opts.overlayLow != null) q.set('overlay_low', String(opts.overlayLow));
  if (opts.overlayHigh != null) q.set('overlay_high', String(opts.overlayHigh));
  if (opts.maxDim) q.set('max_dim', String(opts.maxDim));
  if (opts.applyDark === false) q.set('apply_dark', 'false');
  // ISP-version cache-buster (overlay route also re-extracts when ISP
  // geometry on the parent source changes).
  if (opts.ispVersion) q.set('_isp_v', String(opts.ispVersion));
  return `${API_BASE}/api/sources/${sid}/frame/${frameIdx}/overlay.png?${q.toString()}`;
};

const formatExposureSet = (exposures_s) => {
  if (!exposures_s || exposures_s.length === 0) return '—';
  const uniq = Array.from(new Set(exposures_s.map((e) => Math.round(e * 1e6) / 1e6)));
  uniq.sort((a, b) => a - b);
  if (uniq.length === 1) {
    const ms = uniq[0] * 1000;
    return ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  }
  return `${uniq.length} expositions`;
};

const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return '—';
  const s = Number(seconds);
  if (s < 60) return `${s.toFixed(2)} s`;
  const mins = Math.floor(s / 60);
  const secs = (s - mins * 60).toFixed(1);
  return `${mins}:${String(secs).padStart(4, '0')}`;
};

const formatPath = (p, max = 56) => {
  if (!p) return '';
  if (p.length <= max) return p;
  const head = Math.floor(max * 0.4);
  const tail = max - head - 1;
  return p.slice(0, head) + '…' + p.slice(p.length - tail);
};

// ---------------------------------------------------------------------------
// Source-mode catalog: maps GUI menu options to backend URL builders.
// The dropdown a user sees is filtered against the source's actual channel
// set, so polarization / grayscale-image / image-RGB sources work without
// special cases. play-tab-recording-inspection-rescue-v1 M4.
// ---------------------------------------------------------------------------

const SOURCE_MODES = [
  // ---------- HIGH GAIN ----------
  {
    id: 'rgb_hg',
    label: 'Visible (RGB)',
    group: 'High Gain',
    kind: 'rgb',
    gain: 'hg',
    requires: ['HG-R', 'HG-G', 'HG-B'],
    badge: 'RGB',
  },
  {
    id: 'nir_hg',
    label: 'NIR',
    group: 'High Gain',
    kind: 'channel',
    channel: 'HG-NIR',
    defaultColormap: 'inferno',
    badge: 'LUT',
  },
  {
    id: 'gray_hgy',
    label: 'Chroma (Y)',
    group: 'High Gain',
    kind: 'channel',
    channel: 'HG-Y',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_hg_r',
    label: 'Raw — Red',
    group: 'High Gain',
    kind: 'channel',
    channel: 'HG-R',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_hg_g',
    label: 'Raw — Green',
    group: 'High Gain',
    kind: 'channel',
    channel: 'HG-G',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_hg_b',
    label: 'Raw — Blue',
    group: 'High Gain',
    kind: 'channel',
    channel: 'HG-B',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  // ---------- LOW GAIN ----------
  {
    id: 'rgb_lg',
    label: 'Visible (RGB)',
    group: 'Low Gain',
    kind: 'rgb',
    gain: 'lg',
    requires: ['LG-R', 'LG-G', 'LG-B'],
    badge: 'RGB',
  },
  {
    id: 'nir_lg',
    label: 'NIR',
    group: 'Low Gain',
    kind: 'channel',
    channel: 'LG-NIR',
    defaultColormap: 'inferno',
    badge: 'LUT',
  },
  {
    id: 'gray_lgy',
    label: 'Chroma (Y)',
    group: 'Low Gain',
    kind: 'channel',
    channel: 'LG-Y',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_lg_r',
    label: 'Raw — Red',
    group: 'Low Gain',
    kind: 'channel',
    channel: 'LG-R',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_lg_g',
    label: 'Raw — Green',
    group: 'Low Gain',
    kind: 'channel',
    channel: 'LG-G',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'raw_lg_b',
    label: 'Raw — Blue',
    group: 'Low Gain',
    kind: 'channel',
    channel: 'LG-B',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  // ---------- HDR ----------  (M25 — saturation-aware fusion of HG+LG)
  {
    id: 'rgb_hdr',
    label: 'Visible (RGB)',
    group: 'HDR',
    kind: 'rgb',
    gain: 'hdr',
    requires: ['HDR-R', 'HDR-G', 'HDR-B'],
    badge: 'HDR',
  },
  {
    id: 'nir_hdr',
    label: 'NIR',
    group: 'HDR',
    kind: 'channel',
    channel: 'HDR-NIR',
    requires: ['HDR-NIR'],
    defaultColormap: 'inferno',
    badge: 'HDR',
  },
  {
    id: 'gray_hdry',
    label: 'Chroma (Y)',
    group: 'HDR',
    kind: 'channel',
    channel: 'HDR-Y',
    requires: ['HDR-Y'],
    defaultColormap: 'gray',
    badge: 'HDR',
  },
  // ---------- IMAGE FALLBACKS ----------
  {
    id: 'gray_l',
    label: 'Grayscale (L)',
    group: 'Image',
    kind: 'channel',
    channel: 'L',
    defaultColormap: 'gray',
    badge: 'RAW',
  },
  {
    id: 'rgb_image',
    label: 'RGB',
    group: 'Image',
    kind: 'rgb_image',
    requires: ['R', 'G', 'B'],
    badge: 'RGB',
  },
  // ---------- OVERLAYS ----------
  {
    id: 'overlay_nir_hg',
    label: 'NIR over RGB · HG',
    group: 'Overlay',
    kind: 'overlay',
    requires: ['HG-R', 'HG-G', 'HG-B', 'HG-NIR'],
    baseGain: 'hg',
    overlayChannel: 'HG-NIR',
    defaultColormap: 'inferno',
    badge: 'OVL',
  },
  {
    id: 'overlay_nir_lg',
    label: 'NIR over RGB · LG',
    group: 'Overlay',
    kind: 'overlay',
    requires: ['LG-R', 'LG-G', 'LG-B', 'LG-NIR'],
    baseGain: 'lg',
    overlayChannel: 'LG-NIR',
    defaultColormap: 'inferno',
    badge: 'OVL',
  },
  {
    id: 'overlay_custom',
    label: 'Custom overlay…',
    group: 'Overlay',
    kind: 'overlay',
    requires: ['HG-R', 'HG-G', 'HG-B'],
    baseGain: 'hg',
    overlayChannel: 'HG-NIR',
    defaultColormap: 'inferno',
    badge: 'OVL',
  },
  // ---------- ESCAPE HATCH ----------
  // Manual channel picker for any unrecognized layout.
  { id: 'raw', label: 'Pick channel…', group: 'Other', kind: 'raw', badge: 'RAW' },
];

const availableSourceModes = (recording) => {
  if (!recording || !recording.channels) return [];
  const chs = new Set(recording.channels);
  return SOURCE_MODES.filter((m) => {
    if (m.kind === 'raw') return true;
    if (m.kind === 'rgb' || m.kind === 'rgb_image') return m.requires.every((c) => chs.has(c));
    if (m.kind === 'channel') return chs.has(m.channel);
    if (m.kind === 'overlay') return m.requires.every((c) => chs.has(c));
    return false;
  });
};

const defaultSourceModeId = (recording) => {
  // Honor the recording's gain preference (set in the Sources panel)
  // when picking a default for a new view. Visible (RGB) is the most
  // generally-useful starting point; if the gain doesn't expose RGB,
  // fall back to the legacy availability ordering.
  const gainPref = recording?.gainPref || null;
  if (gainPref) {
    const preferred = composeSourceMode(gainPref, 'rgb');
    const avail = new Set(availableSourceModes(recording).map((m) => m.id));
    if (avail.has(preferred)) return preferred;
  }
  const order = [
    'rgb_hg',
    'rgb_lg',
    'rgb_image',
    'nir_hg',
    'gray_hgy',
    'gray_lgy',
    'gray_l',
    'nir_lg',
    'raw',
  ];
  const avail = new Set(availableSourceModes(recording).map((m) => m.id));
  for (const id of order) if (avail.has(id)) return id;
  return 'raw';
};

const sourceModeMeta = (id) =>
  SOURCE_MODES.find((m) => m.id === id) || SOURCE_MODES[SOURCE_MODES.length - 1];

// Gain selector lives outside the channel dropdown for GSense-style
// recordings. Returns the subset of ('HG', 'LG', 'HDR') the recording
// actually exposes — driven entirely by the channel set, so non-GSense
// (image-only, polarization-only) sources naturally show no gain tabs.
const availableGains = (recording) => {
  if (!recording || !recording.channels) return [];
  const chs = new Set(recording.channels);
  const gains = [];
  if (['HG-R', 'HG-G', 'HG-B'].some((c) => chs.has(c))) gains.push('HG');
  if (['LG-R', 'LG-G', 'LG-B'].some((c) => chs.has(c))) gains.push('LG');
  if (['HDR-R', 'HDR-G', 'HDR-B'].some((c) => chs.has(c))) gains.push('HDR');
  return gains;
};

// Decompose a source-mode id into (gain, channelKind). channelKind is
// stable across gains so a "Visible (RGB)" view stays Visible (RGB)
// when the user flips HG↔LG↔HDR. Returns nulls for non-gain modes
// (overlays, image, raw escape hatch) so the title bar can fall back
// to the legacy flat dropdown for those.
const _CHANNEL_KIND_BY_ID = {
  rgb_hg: 'rgb',
  rgb_lg: 'rgb',
  rgb_hdr: 'rgb',
  nir_hg: 'nir',
  nir_lg: 'nir',
  nir_hdr: 'nir',
  gray_hgy: 'chroma',
  gray_lgy: 'chroma',
  gray_hdry: 'chroma',
  raw_hg_r: 'raw_r',
  raw_lg_r: 'raw_r',
  raw_hg_g: 'raw_g',
  raw_lg_g: 'raw_g',
  raw_hg_b: 'raw_b',
  raw_lg_b: 'raw_b',
};
const _GAIN_BY_ID = {
  rgb_hg: 'HG',
  nir_hg: 'HG',
  gray_hgy: 'HG',
  raw_hg_r: 'HG',
  raw_hg_g: 'HG',
  raw_hg_b: 'HG',
  rgb_lg: 'LG',
  nir_lg: 'LG',
  gray_lgy: 'LG',
  raw_lg_r: 'LG',
  raw_lg_g: 'LG',
  raw_lg_b: 'LG',
  rgb_hdr: 'HDR',
  nir_hdr: 'HDR',
  gray_hdry: 'HDR',
};

const splitSourceMode = (id) => ({
  gain: _GAIN_BY_ID[id] || null,
  channelKind: _CHANNEL_KIND_BY_ID[id] || null,
});

// Compose (gain, channelKind) → source-mode id. HDR doesn't expose pre-Bayer
// raw R/G/B, so falls back to `rgb_hdr` if a raw_* was selected and the
// user switches to HDR.
const composeSourceMode = (gain, channelKind) => {
  const g = (gain || '').toUpperCase();
  const c = channelKind || 'rgb';
  if (g === 'HDR') {
    if (c === 'rgb') return 'rgb_hdr';
    if (c === 'nir') return 'nir_hdr';
    if (c === 'chroma') return 'gray_hdry';
    return 'rgb_hdr';
  }
  if (g === 'LG') {
    return (
      {
        rgb: 'rgb_lg',
        nir: 'nir_lg',
        chroma: 'gray_lgy',
        raw_r: 'raw_lg_r',
        raw_g: 'raw_lg_g',
        raw_b: 'raw_lg_b',
      }[c] || 'rgb_lg'
    );
  }
  return (
    {
      rgb: 'rgb_hg',
      nir: 'nir_hg',
      chroma: 'gray_hgy',
      raw_r: 'raw_hg_r',
      raw_g: 'raw_hg_g',
      raw_b: 'raw_hg_b',
    }[c] || 'rgb_hg'
  );
};

// Channel-kind catalog used by the per-gain dropdown. HDR hides the
// Raw entries because the fused channels don't expose them.
const CHANNEL_KIND_OPTIONS = [
  { id: 'rgb', label: 'Visible (RGB)' },
  { id: 'nir', label: 'NIR' },
  { id: 'chroma', label: 'Chroma (Y)' },
  { id: 'raw_r', label: 'Raw — Red' },
  { id: 'raw_g', label: 'Raw — Green' },
  { id: 'raw_b', label: 'Raw — Blue' },
];

const channelKindOptionsForGain = (gain, recording) => {
  const all =
    gain === 'HDR'
      ? CHANNEL_KIND_OPTIONS.filter((o) => !o.id.startsWith('raw_'))
      : CHANNEL_KIND_OPTIONS;
  return all.filter((o) => {
    const id = composeSourceMode(gain, o.id);
    const meta = SOURCE_MODES.find((m) => m.id === id);
    if (!meta) return false;
    if (meta.kind === 'rgb') {
      return (meta.requires || []).every((c) => (recording?.channels || []).includes(c));
    }
    if (meta.kind === 'channel') {
      return (recording?.channels || []).includes(meta.channel);
    }
    return false;
  });
};

// Stable hash of a recording's source-side ISP state. When ISP geometry
// changes via reconfigure_isp, this token shifts so URLs change → the
// React useEffect / useMemo re-fires and the per-URL blob cache misses.
// Without this, a reconfigure produces fresh server bytes but the
// frontend keeps showing the cached pre-reconfigure image (every URL
// query param is per-view-state, none of which changed).
const _ispVersionToken = (recording) => {
  if (!recording) return '';
  const cfg = recording.isp_config || {};
  const o = cfg.origin || [0, 0];
  const ss = cfg.sub_step || [0, 0];
  const os = cfg.outer_stride || [0, 0];
  const names = cfg.channel_name_overrides || {};
  const locs = cfg.channel_loc_overrides || {};
  const nameKeys = Object.keys(names)
    .sort()
    .map((k) => `${k}=${names[k]}`)
    .join(',');
  const locKeys = Object.keys(locs)
    .sort()
    .map((k) => `${k}=${(locs[k] || []).join('x')}`)
    .join(',');
  return [
    recording.isp_mode_id || '',
    o[0],
    o[1],
    ss[0],
    ss[1],
    os[0],
    os[1],
    nameKeys,
    locKeys,
  ].join('|');
};

const buildFrameUrl = (recording, view, frameIdx) => {
  if (!recording) return null;
  const sid = recording.source_id;
  const mode = sourceModeMeta(view.sourceMode);
  const opts = {
    maxDim: 1600,
    applyDark: view.applyDark !== false,
    vmin: view.vmin,
    vmax: view.vmax,
    // ISP-version cache-buster (does not affect server output — the
    // backend ignores `_isp_v`. URL key shifts whenever the source-side
    // ISP geometry changes, forcing the blob cache to miss).
    ispVersion: _ispVersionToken(recording),
    // M20: clipping toggle propagates to all renderable URL kinds
    // (the channel thumbnail honors it; rgb / overlay fall through
    // unchanged for now — RGB clipping wires in alongside per-channel
    // grading at M22).
    showClipping: !!view.showClipping,
    // M20.1: ISP pipeline forwarded to backend so HG vs LG show their
    // true relative brightness when normalize='none', plus standard
    // photographic corrections (black-level subtract → gain → offset →
    // normalize → brightness → contrast → gamma → colormap).
    normalize: view.normalize || 'auto',
    blackLevel: view.blackLevel ?? 0,
    gain: view.gain ?? 1.0,
    offset: view.offset ?? 0,
    brightness: view.ispBrightness ?? 0,
    contrast: view.ispContrast ?? 1.0,
    gamma: view.gamma ?? 1.0,
    // M21: per-view burn-in label flags. Default off; backend renders
    // unmodified PNG when no flag is set.
    labels: view.labels || null,
    // M22: per-channel RGB grading. Only honored by RGB / RGB-composite
    // render paths; channel-mode requests harmlessly carry the params.
    grading: view.grading || null,
    // M26: per-view non-linear sharpen / FPN chain. Defaults are no-op
    // so omitting fields renders the standard look.
    ispChain: view.isp || null,
  };
  if (mode.kind === 'rgb' || mode.kind === 'rgb_image') {
    return frameRgbUrl(sid, frameIdx, mode.kind === 'rgb_image' ? 'hg' : mode.gain, opts);
  }
  if (mode.kind === 'channel') {
    return frameChannelPngUrl(sid, frameIdx, mode.channel, {
      ...opts,
      colormap: view.colormap || mode.defaultColormap || 'gray',
    });
  }
  if (mode.kind === 'overlay') {
    // Overlay mode: base + overlay are configured by the Inspector.
    // view.overlay = {
    //   baseKind: 'rgb_composite' | 'single_channel',
    //   baseGain: 'hg' | 'lg',                // when baseKind=rgb_composite
    //   baseChannel: 'HG-Y' | ...,             // when baseKind=single_channel
    //   overlayChannel: 'HG-NIR' | 'LG-NIR' | …,
    //   overlayColormap: 'inferno' | …,
    //   blend: 'alpha' | 'screen' | 'additive',
    //   strength: 0..1,
    //   overlayLow: number | null,             // optional vmin
    //   overlayHigh: number | null,            // optional vmax
    // }
    // Falls back to NIR-over-HG-RGB defaults inherited from the legacy
    // overlay_nir_hg / overlay_nir_lg quick-pick modes.
    const ov = view.overlay || {};
    const legacyDefaultGain = mode.baseGain || 'hg';
    const legacyOverlayChannel = mode.overlayChannel || 'HG-NIR';
    const baseKind = ov.baseKind || 'rgb_composite';
    const baseGain = (ov.baseGain || legacyDefaultGain).toLowerCase();
    const baseChannel =
      baseKind === 'rgb_composite'
        ? baseGain === 'lg'
          ? 'LG-R'
          : 'HG-R'
        : ov.baseChannel || (baseGain === 'lg' ? 'LG-Y' : 'HG-Y');
    const overlayChannel = ov.overlayChannel || legacyOverlayChannel;
    return frameOverlayUrl(sid, frameIdx, {
      baseChannel,
      overlayChannel,
      baseKind,
      overlayColormap: ov.overlayColormap || view.colormap || mode.defaultColormap || 'inferno',
      blend: ov.blend || 'alpha',
      strength: ov.strength ?? 0.6,
      overlayLow: ov.overlayLow ?? null,
      overlayHigh: ov.overlayHigh ?? null,
      maxDim: opts.maxDim,
      applyDark: opts.applyDark,
      ispVersion: opts.ispVersion,
    });
  }
  // raw — user picks a channel via view.rawChannel
  if (view.rawChannel) {
    return frameChannelPngUrl(sid, frameIdx, view.rawChannel, {
      ...opts,
      colormap: view.colormap || 'gray',
    });
  }
  return null;
};

// ---------------------------------------------------------------------------
// M18 — canonical W-* warning catalog. Every emit site (continuity
// detection, FilePill load, dark attach, overlay validation, export
// pipeline, processing config validator) tags its row with one of the
// codes below. The Warning Center renders each row through this map so
// the user sees a consistent headline + action regardless of where the
// warning came from. `headline` is shown in bold above the per-emit
// detail text; `action` is rendered as an inline button. Actions:
//   - 'inspect-file'    → close modal + scroll/select the bound FilePill
//   - 'open-stream-builder' → close modal + open the Stream Builder
//   - 'clear-range'     → wipe the timeline rangeSelection
//   - 'open-export'     → close modal + open ExportVideoModal
//   - 'open-inspector'  → close modal + select the offending view
//   - 'dismiss'         → no-op (modal stays put; row dismissal is
//                         handled by the FilePill chip path, not here)
//
// All 12 canonical codes from the plan are present; legacy codes
// (W-GAP / W-OVERLAP / W-LOAD / W-DARK) get templates too because the
// existing emit sites already use them.
// ---------------------------------------------------------------------------

const WARNING_TEMPLATES = {
  // Per-file metadata warnings (M16)
  'W-META-TS': {
    severity: 'warning',
    headline: 'Missing per-frame timestamps',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  'W-META-EXP': {
    severity: 'warning',
    headline: 'Missing per-frame exposure',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  'W-FRAME-FAIL': {
    severity: 'warning',
    headline: 'Per-frame metadata read failed',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  // Stream continuity (M11)
  'W-GAP': {
    severity: 'warning',
    headline: 'Gap between recordings',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-OVERLAP': {
    severity: 'warning',
    headline: 'Recordings overlap in time',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-EXP-MISMATCH': {
    severity: 'warning',
    headline: 'Exposure differs across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-SHAPE': {
    severity: 'error',
    headline: 'Frame dimensions differ across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-CHAN': {
    severity: 'warning',
    headline: 'Channel layout differs across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  // Dark frame (M11 + new)
  'W-DARK-NONE': {
    severity: 'info',
    headline: 'No dark frames loaded',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
  'W-DARK': {
    severity: 'error',
    headline: 'Dark attach failed',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
  'W-DARK-AMBIG': {
    severity: 'warning',
    headline: 'Dark requested but none attached',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  // Overlay (M18)
  'W-OVL-SRC': {
    severity: 'warning',
    headline: 'Overlay source channel is missing',
    action: { kind: 'open-inspector', label: 'Open Inspector' },
  },
  // Export pipeline (M18)
  'W-EXPORT-LONG': {
    severity: 'info',
    headline: 'Export will be long',
    action: { kind: 'open-export', label: 'Adjust export' },
  },
  'W-RANGE-HUGE': {
    severity: 'warning',
    headline: 'Range covers many frames',
    action: { kind: 'clear-range', label: 'Clear range' },
  },
  // Processing config (M18)
  'W-PROC-INVALID': {
    severity: 'warning',
    headline: 'Processing config is invalid',
    action: { kind: 'open-inspector', label: 'Open Inspector' },
  },
  // File load (M11)
  'W-LOAD': {
    severity: 'error',
    headline: 'File load failed',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
};

// ---------------------------------------------------------------------------
// Continuity detection — pure function, used by Stream Builder + stream
// header warning chip. Returns one warning per *transition* (between
// adjacent recordings in the order). Resolved decision #2: default
// threshold 1.0 s, user-overridable in the modal.
// ---------------------------------------------------------------------------

const detectContinuity = (orderedRecs, thresholdS = 1.0) => {
  const warnings = [];
  for (let i = 1; i < orderedRecs.length; i++) {
    const prev = orderedRecs[i - 1];
    const cur = orderedRecs[i];
    if (!prev || !cur) continue;
    const prevLastTs = (prev.timestamps && prev.timestamps[prev.timestamps.length - 1]) || 0;
    const curFirstTs = (cur.timestamps && cur.timestamps[0]) || 0;
    if (prevLastTs > 0 && curFirstTs > 0) {
      const gap = curFirstTs - prevLastTs;
      if (gap > thresholdS) {
        warnings.push({
          between: [i - 1, i],
          type: 'gap',
          severity: 'warning',
          detail: `${gap.toFixed(2)} s gap between ${prev.name} and ${cur.name}`,
        });
      } else if (gap < -thresholdS) {
        warnings.push({
          between: [i - 1, i],
          type: 'overlap',
          severity: 'warning',
          detail: `${(-gap).toFixed(2)} s overlap (${prev.name} ends after ${cur.name} starts)`,
        });
      }
    }
    // Exposure mismatch (use the median exposure if present)
    const prevExp = prev.exposures_s?.[0];
    const curExp = cur.exposures_s?.[0];
    if (prevExp != null && curExp != null && Math.abs(prevExp - curExp) > 1e-6) {
      warnings.push({
        between: [i - 1, i],
        // M18: code is 'exp-mismatch' (canonical W-EXP-MISMATCH),
        // renamed from the legacy 'exposure'/'W-EXPOSURE' to match the
        // 12-code catalog.
        type: 'exp-mismatch',
        severity: 'warning',
        detail: `Exposure differs: ${(prevExp * 1000).toFixed(1)} ms → ${(curExp * 1000).toFixed(1)} ms`,
      });
    }
    // Shape mismatch
    if (
      prev.shape &&
      cur.shape &&
      (prev.shape[0] !== cur.shape[0] || prev.shape[1] !== cur.shape[1])
    ) {
      warnings.push({
        between: [i - 1, i],
        type: 'shape',
        severity: 'error',
        detail: `Dimensions differ: ${prev.shape[1]}×${prev.shape[0]} vs ${cur.shape[1]}×${cur.shape[0]}`,
      });
    }
    // M18 — channel-layout mismatch. Two sources in a stream that
    // expose different channel sets (e.g. an RGB image alongside a
    // GSense recording) can't share a unified ViewerCard render path,
    // so flag it.
    if (prev.channels && cur.channels) {
      const a = new Set(prev.channels);
      const b = new Set(cur.channels);
      const onlyA = [...a].filter((c) => !b.has(c));
      const onlyB = [...b].filter((c) => !a.has(c));
      if (onlyA.length > 0 || onlyB.length > 0) {
        const sample = [...onlyA.slice(0, 3), ...onlyB.slice(0, 3)].join(', ');
        warnings.push({
          between: [i - 1, i],
          type: 'chan',
          severity: 'warning',
          detail: `Channel layout differs (e.g. ${sample}); switching streams may drop bound views`,
        });
      }
    }
  }
  return warnings;
};

// ---------------------------------------------------------------------------
// View factory + processing-badge helpers
// ---------------------------------------------------------------------------

let _viewCounter = 0;
const newViewId = () => `view-${Date.now().toString(36)}-${++_viewCounter}`;

const makeDefaultView = (recording, opts = {}) => {
  const modeId = opts.sourceMode || defaultSourceModeId(recording);
  const meta = sourceModeMeta(modeId);
  return {
    id: newViewId(),
    name: opts.name || `${meta.label}`,
    sourceId: recording?.source_id || null,
    sourceMode: modeId,
    rawChannel: meta.kind === 'raw' ? null : null,
    colormap: meta.defaultColormap || 'gray',
    vmin: null,
    vmax: null,
    invert: false,
    applyDark: true,
    // M20 — Display / Corrections defaults. `showClipping` is the
    // magenta-on-saturated-pixels toggle.
    showClipping: false,
    // M20.1 — canvas-overlay histogram (drawn over the bottom-right
    // of the ViewerCard's canvas in addition to the side-panel one).
    showCanvasHistogram: false,
    // M20.1/M22 — server-side ISP pipeline. Defaults render the data
    // at its TRUE relative brightness (no auto-percentile boost), so
    // HG (bright) and LG (dim) show their actual hardware levels.
    // The Inspector Low/High threshold sliders override the default
    // bounds regardless of mode — this is the user-friendly threshold
    // path.
    normalize: 'none',
    blackLevel: 0,
    gain: 1.0,
    offset: 0,
    ispBrightness: 0,
    ispContrast: 1.0,
    gamma: 1.0,
    isLocked: false,
    lockedFrame: null,
    includedInExport: true,
    // Display grading (CSS filter) — applied to the <img> element directly.
    // Server-side per-channel grading would round-trip the values into
    // /api/sources/{sid}/frame/{i}/... — M9 if backend support is added.
    brightness: 1.0,
    contrast: 1.0,
    saturation: 1.0,
    showRaw: false, // before/after toggle — hides the grading filter
    // M21 — burn-in label config (per-view). Defaults are all off so
    // existing renders stay unchanged until the user toggles a flag.
    labels: {
      timestamp: false,
      frame: false,
      channel: false,
      source_file: false,
      scale_bar: false,
      position: 'bottom-left',
      font_size: 12,
    },
    // M22 — server-side per-channel RGB grading. Defaults are no-op.
    grading: {
      gain_r: 1.0,
      gain_g: 1.0,
      gain_b: 1.0,
      offset_r: 0.0,
      offset_g: 0.0,
      offset_b: 0.0,
      gamma: 1.0,
      brightness: 0.0,
      contrast: 1.0,
      saturation: 1.0,
      wb_kelvin: null, // null = no WB shift
    },
    // M26 — server-side non-linear sharpen / FPN chain. Defaults are
    // no-op (`_isp_chain_from_query` short-circuits when no stage active).
    isp: {
      sharpen_method: 'None',
      sharpen_amount: 1.0,
      sharpen_radius: 2.0,
      denoise_sigma: 0.0,
      median_size: 0,
      gaussian_sigma: 0.0,
      hot_pixel_thr: 0.0,
      bilateral: false,
    },
    // Flexible overlay config — read by buildFrameUrl when sourceMode kind === 'overlay'.
    // Inspector's Overlay section reads/writes this struct.
    overlay: {
      baseKind: 'rgb_composite',
      baseGain: meta.baseGain || 'hg',
      baseChannel: null,
      overlayChannel: meta.overlayChannel || null,
      overlayColormap: meta.defaultColormap || 'inferno',
      blend: 'alpha',
      strength: 0.6,
      overlayLow: null,
      overlayHigh: null,
    },
  };
};

const computeBadges = (view, recording) => {
  const meta = sourceModeMeta(view.sourceMode);
  const badges = [];
  if (meta.kind === 'overlay') {
    badges.push({ code: 'RGB', tone: 'accent', tip: 'RGB base' });
    badges.push({ code: 'OVL', tone: 'warn', tip: `Overlay: ${meta.overlayChannel}` });
  } else if (meta.kind === 'rgb' || meta.kind === 'rgb_image') {
    badges.push({ code: 'RGB', tone: 'accent', tip: 'RGB composite' });
  } else if (view.colormap && view.colormap !== 'gray') {
    badges.push({ code: 'LUT', tone: 'accent', tip: `Colormap: ${view.colormap}` });
  } else {
    badges.push({ code: 'RAW', tone: 'neutral', tip: 'Single-channel raw' });
  }
  if (view.applyDark && recording?.has_dark) {
    badges.push({ code: 'DRK', tone: 'accent', tip: 'Dark-corrected' });
  }
  if (view.vmin != null && view.vmax != null) {
    badges.push({
      code: 'NRM',
      tone: 'accent',
      tip: `Normalized [${view.vmin.toFixed(0)}–${view.vmax.toFixed(0)}]`,
    });
  }
  if (view.isLocked) {
    badges.push({ code: 'LCK', tone: 'warn', tip: `Locked to frame ${view.lockedFrame}` });
  }
  if (view.includedInExport) {
    badges.push({ code: 'EXP', tone: 'success', tip: 'Included in current export' });
  }
  return badges;
};

// ---------------------------------------------------------------------------
// Source / dark / view types
// ---------------------------------------------------------------------------
//
// `Recording` = one loaded H5 source plus its per-frame metadata.
// `Dark` = a loaded dark file attached to a parent recording. M8 fleshes out.
// `View` = one ViewerCard's display state. M4+ uses this.
// ---------------------------------------------------------------------------

const fetchFrameMeta = async (sid) => {
  return apiFetch(`/api/sources/${sid}/frames`, { method: 'GET' });
};

// ---------------------------------------------------------------------------
// Top-level mode
// ---------------------------------------------------------------------------

export const PlaybackMode = ({
  onStatusChange,
  say,
  fileFilter: globalFileFilter,
  onSwitchSource,
}) => {
  const t = useTheme();

  // --- State -------------------------------------------------------------
  const [recordings, setRecordings] = useStatePb([]); // Recording[]
  const [loadingFiles, setLoadingFiles] = useStatePb([]); // [{ name, progress }]
  const [errorFiles, setErrorFiles] = useStatePb([]); // [{ name, message }]
  const [selectedRecId, setSelectedRecId] = useStatePb(null);
  // Multi-select for the "Delete from disk" flow. Holds the set of
  // recording source_ids the user has ticked. Independent from
  // `selectedRecId` (which is the single "active" recording the
  // viewer/inspector binds to).
  const [markedRecIds, setMarkedRecIds] = useStatePb(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useStatePb(false);
  const toggleMarked = useCallbackPb((sourceId) => {
    setMarkedRecIds((prev) => {
      const next = new Set(prev);
      if (next.has(sourceId)) next.delete(sourceId);
      else next.add(sourceId);
      return next;
    });
  }, []);
  const clearMarked = useCallbackPb(() => setMarkedRecIds(new Set()), []);
  const [views, setViews] = useStatePb([]); // View[]; ordered by display position
  const [selectedViewId, setSelectedViewId] = useStatePb(null);
  const [layoutPreset, setLayoutPreset] = useStatePb('single'); // single | side | stack | 2x2
  const [globalFrame, setGlobalFrame] = useStatePb(0); // 0..(totalFrames-1)
  // Stream order — ordered list of source_ids. v1 keeps display order ===
  // load order; M6 lets the user reorder via the Stream Builder modal.
  const [streamOrder, setStreamOrder] = useStatePb([]);
  // Playback state
  const [playing, setPlaying] = useStatePb(false);
  const [fps, setFps] = useLocalStorageState('playback/fps', 10);
  const [loop, setLoop] = useLocalStorageState('playback/loop', true); // resolved decision #3
  // Inspector / Sources collapse states are persisted across sessions per spec §4.3.
  const [sourcesCollapsed, setSourcesCollapsed] = useLocalStorageState(
    'playback/sourcesCollapsed',
    false
  );
  const [inspectorCollapsed, setInspectorCollapsed] = useLocalStorageState(
    'playback/inspectorCollapsed',
    false
  );
  // M15 — auto-collapse Sources / Inspector at viewport ≤ 1180 px.
  // The auto-rule fires on bucket transitions only (never on mount or
  // on resizes within the same bucket), so the persisted localStorage
  // value remains the source of truth at reload time. Per-panel
  // `touched` refs latch a manual toggle so subsequent transitions
  // defer to the user — they reset on the next bucket cross, giving
  // the auto-rule another shot in the new regime. (See plan §M15
  // verification gate: "respect user's manual override".)
  const { isNarrow } = useViewport();
  const prevIsNarrowRef = useRefPb(isNarrow);
  const sourcesTouchedRef = useRefPb(false);
  const inspectorTouchedRef = useRefPb(false);
  useEffectPb(() => {
    if (prevIsNarrowRef.current === isNarrow) return;
    prevIsNarrowRef.current = isNarrow;
    if (!sourcesTouchedRef.current) setSourcesCollapsed(isNarrow);
    if (!inspectorTouchedRef.current) setInspectorCollapsed(isNarrow);
    sourcesTouchedRef.current = false;
    inspectorTouchedRef.current = false;
  }, [isNarrow, setSourcesCollapsed, setInspectorCollapsed]);
  // Stream Builder modal state (M6)
  const [streamBuilderOpen, setStreamBuilderOpen] = useStatePb(false);
  // Export Video modal (M10)
  const [exportVideoOpen, setExportVideoOpen] = useStatePb(false);
  // M23 — tiled image export modal (multi-view PNG composite).
  const [exportImageOpen, setExportImageOpen] = useStatePb(false);
  // Warning Center modal (M11)
  const [warningCenterOpen, setWarningCenterOpen] = useStatePb(false);
  // M17: range-brush on the timeline mini-map. `null` = no brush (full
  // stream is the export default); `[start, end]` (inclusive global
  // frame indices) = brush active. Two amber handles on the mini-map
  // and a shaded fill between them. Used by ExportVideoModal as the
  // default range and to lock its start/end Spinboxes when active.
  const [rangeSelection, setRangeSelection] = useStatePb(null);
  // M16: per-source warnings the user dismissed via the FilePill chip
  // close button. Session-only — dismissals don't persist across reloads
  // because the underlying H5 metadata is unchanged. The same warning
  // still appears in the Warning Center modal regardless.
  // Map: source_id → Set<warning code>.
  const [dismissedWarnings, setDismissedWarnings] = useStatePb({});
  // M28: server-side presets store (~/.mantisanalysis/playback-presets.json).
  // Persisted across sessions; multiple users on the same host get separate
  // files (mode 0600). Frontend owns the `fields` schema; backend round-trips.
  const [presets, setPresets] = useStatePb([]);
  const [savePresetOpen, setSavePresetOpen] = useStatePb(false);
  // M29: 4-step Overlay Builder wizard. Holds the id of the view being
  // configured; null when closed. Same backend as the inline overlay
  // configurator — the modal just gives a more guided UX.
  const [overlayBuilderViewId, setOverlayBuilderViewId] = useStatePb(null);
  useEffectPb(() => {
    let cancelled = false;
    apiFetch('/api/playback/presets', { method: 'GET' })
      .then((body) => {
        if (cancelled) return;
        setPresets(Array.isArray(body?.presets) ? body.presets : []);
      })
      .catch(() => {
        // Network error is non-fatal — leave the local list empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // M28 — replace the persisted preset list with a new one. Optimistic:
  // local state updates immediately, server PUT happens in the background.
  // On error we re-fetch so the local view doesn't drift.
  const replacePresets = useCallbackPb(
    async (next) => {
      setPresets(next);
      try {
        await apiFetch('/api/playback/presets', {
          method: 'PUT',
          body: JSON.stringify({ presets: next }),
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        // Re-fetch on failure to recover the canonical list.
        try {
          const body = await apiFetch('/api/playback/presets', { method: 'GET' });
          setPresets(Array.isArray(body?.presets) ? body.presets : []);
        } catch {
          /* ignore */
        }
      }
    },
    [setPresets]
  );
  // M28 — whitelist of view-state fields a preset captures. Excludes
  // identity (id / sourceId / sourceMode / name / lockedFrame / isLocked /
  // includedInExport) so loading a preset never destabilizes the view's
  // binding to its source. Fields chosen mirror the M13 copy-settings-to
  // whitelist plus the M22 grading + M21 labels + M26 ISP-chain structs.
  const PRESET_FIELDS = [
    'colormap',
    'invert',
    'showClipping',
    'showCanvasHistogram',
    'vmin',
    'vmax',
    'normalize',
    'blackLevel',
    'gain',
    'offset',
    'ispBrightness',
    'ispContrast',
    'gamma',
    'brightness',
    'contrast',
    'saturation',
    'rawChannel',
    'applyDark',
    'overlay',
    'grading',
    'labels',
    'isp',
  ];
  const captureViewFields = useCallbackPb((view) => {
    if (!view) return {};
    const out = {};
    for (const k of PRESET_FIELDS) {
      if (view[k] !== undefined) out[k] = view[k];
    }
    return out;
  }, []);
  const savePreset = useCallbackPb(
    async (name, sourceView) => {
      if (!sourceView) return;
      const id = `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newPreset = {
        id,
        name: String(name || '').slice(0, 80) || 'Untitled',
        view_type: sourceView.sourceMode,
        fields: captureViewFields(sourceView),
        created_at: Date.now() / 1000,
      };
      await replacePresets([...presets, newPreset]);
    },
    [presets, replacePresets, captureViewFields]
  );
  const deletePreset = useCallbackPb(
    async (id) => {
      const next = presets.filter((p) => p.id !== id);
      setPresets(next);
      try {
        await apiFetch(`/api/playback/presets/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        });
      } catch {
        /* ignore — re-fetch on next mount */
      }
    },
    [presets, setPresets]
  );
  const dismissWarning = useCallbackPb((sourceId, code) => {
    setDismissedWarnings((prev) => {
      const next = { ...prev };
      const existing = next[sourceId] ? new Set(next[sourceId]) : new Set();
      existing.add(code);
      next[sourceId] = existing;
      return next;
    });
  }, []);
  // Per-recording gain selector lives in the Sources panel. Switching
  // gain (HG / LG / HDR) on a recording walks every view bound to it
  // and rebases its source-mode using the existing channel-kind it had
  // (Visible / NIR / Chroma / Raw R/G/B). Channel kind is preserved so
  // the user's intent ("show me the NIR") survives the gain flip; only
  // the half/fusion the channel is sourced from changes.
  const setRecordingGain = useCallbackPb((sourceId, gain) => {
    setRecordings((prev) =>
      prev.map((r) => (r.source_id === sourceId ? { ...r, gainPref: gain } : r))
    );
    setViews((prev) =>
      prev.map((v) => {
        if (v.sourceId !== sourceId) return v;
        const split = splitSourceMode(v.sourceMode);
        if (!split.channelKind) return v;
        // HDR has no raw splits. If the user had Raw — Red/Green/Blue
        // selected and switches to HDR, fall back to Visible (RGB).
        let kind = split.channelKind;
        if (gain === 'HDR' && String(kind).startsWith('raw_')) kind = 'rgb';
        const newMode = composeSourceMode(gain, kind);
        const newMeta = sourceModeMeta(newMode);
        return {
          ...v,
          sourceMode: newMode,
          colormap: v.colormap || newMeta.defaultColormap || 'gray',
          // Only refresh the auto-generated name; user-edited names
          // stay as-is so a custom "ROI 3 close-up" survives the flip.
          name: v.name && v.name !== sourceModeMeta(v.sourceMode).label ? v.name : newMeta.label,
        };
      })
    );
  }, []);
  const [continuityThreshold, setContinuityThreshold] = useLocalStorageState(
    'playback/continuityThresholdS',
    1.0
  );
  // Darks loaded as a frontend-managed list. Backend stores one dark per
  // source; this list tracks which darks the user picked AND which sources
  // they're currently attached to. M8.
  const [darks, setDarks] = useStatePb([]); // [{ id, name, file_size, attached: Set<sid> }]
  const [loadingDarks, setLoadingDarks] = useStatePb([]); // [{ name }]
  const [darkErrors, setDarkErrors] = useStatePb([]); // [{ name, message }]
  const darkInputRef = useRefPb(null);

  // --- Derived -----------------------------------------------------------
  const allExposures = useMemoPb(() => {
    const set = new Set();
    recordings.forEach((r) =>
      (r.exposures_s || []).forEach((e) => set.add(Math.round(e * 1e6) / 1e6))
    );
    return Array.from(set).sort((a, b) => a - b);
  }, [recordings]);

  // --- Stream order: sync with recordings -------------------------------
  // Whenever recordings list changes, reconcile streamOrder so it
  // contains exactly the active source_ids in the order the user
  // either set (M6) or first loaded (default).
  useEffectPb(() => {
    setStreamOrder((prev) => {
      const presentIds = new Set(recordings.map((r) => r.source_id));
      const kept = prev.filter((sid) => presentIds.has(sid));
      const seen = new Set(kept);
      const appended = recordings.filter((r) => !seen.has(r.source_id)).map((r) => r.source_id);
      return [...kept, ...appended];
    });
  }, [recordings]);

  // --- Global → local frame mapping ------------------------------------
  const orderedRecordings = useMemoPb(
    () => streamOrder.map((sid) => recordings.find((r) => r.source_id === sid)).filter(Boolean),
    [streamOrder, recordings]
  );
  const totalFrames = useMemoPb(
    () => orderedRecordings.reduce((acc, r) => acc + (r.frame_count || 1), 0) || 1,
    [orderedRecordings]
  );
  const sourceOffsets = useMemoPb(() => {
    const m = new Map();
    let cum = 0;
    for (const r of orderedRecordings) {
      m.set(r.source_id, cum);
      cum += r.frame_count || 1;
    }
    return m;
  }, [orderedRecordings]);
  // Resolve the active source for the current global frame (the one that
  // owns this index in the concatenated stream).
  const activeAtGlobal = useMemoPb(() => {
    let cum = 0;
    for (const r of orderedRecordings) {
      const next = cum + (r.frame_count || 1);
      if (globalFrame < next) return { sourceId: r.source_id, local: globalFrame - cum };
      cum = next;
    }
    if (orderedRecordings.length > 0) {
      const last = orderedRecordings[orderedRecordings.length - 1];
      return { sourceId: last.source_id, local: (last.frame_count || 1) - 1 };
    }
    return { sourceId: null, local: 0 };
  }, [globalFrame, orderedRecordings]);

  const localFrameForView = useCallbackPb(
    (view) => {
      if (view.isLocked && view.lockedFrame != null) return view.lockedFrame;
      // Stream-follow: when the view's source matches the active source
      // at the current global index, use the local index. (Auto-rebind
      // logic below ensures unlocked views follow the active source as
      // playback crosses boundaries, so this is usually true.)
      if (view.sourceId === activeAtGlobal.sourceId) return activeAtGlobal.local;
      // Fallback (shouldn't happen for unlocked views thanks to
      // auto-rebind): clamp the view to its own source's range.
      const offset = sourceOffsets.get(view.sourceId);
      const rec = recordings.find((r) => r.source_id === view.sourceId);
      if (offset == null || !rec) return 0;
      const local = globalFrame - offset;
      const lastIdx = (rec.frame_count || 1) - 1;
      return Math.max(0, Math.min(lastIdx, local));
    },
    [activeAtGlobal, sourceOffsets, recordings, globalFrame]
  );

  // Stream-follow behavior: when the active source changes (via play loop
  // crossing a boundary OR scrubbing), unlocked views auto-rebind to the
  // new active source. This keeps the canvas tracking what the timeline
  // says is "active". Locked views stay on their pinned source. Manual
  // per-view source pinning would set `view.isLocked = true`.
  useEffectPb(() => {
    if (!activeAtGlobal.sourceId) return;
    setViews((prev) => {
      let changed = false;
      const next = prev.map((v) => {
        if (v.isLocked) return v;
        if (v.sourceId === activeAtGlobal.sourceId) return v;
        const newRec = recordings.find((r) => r.source_id === activeAtGlobal.sourceId);
        if (!newRec) return v;
        // Preserve the user's source-mode choice when valid for the new
        // source; otherwise fall back to that source's default.
        const avail = new Set(availableSourceModes(newRec).map((m) => m.id));
        const newMode = avail.has(v.sourceMode) ? v.sourceMode : defaultSourceModeId(newRec);
        const meta = sourceModeMeta(newMode);
        changed = true;
        return {
          ...v,
          sourceId: newRec.source_id,
          sourceMode: newMode,
          name: meta.label,
          rawChannel: meta.kind === 'raw' ? v.rawChannel : null,
          // Preserve user-chosen colormap across stream-follow rebind.
          colormap: v.colormap || meta.defaultColormap,
        };
      });
      return changed ? next : prev;
    });
  }, [activeAtGlobal.sourceId, recordings]);

  // --- Status bar ---------------------------------------------------------
  useEffectPb(() => {
    if (recordings.length === 0) {
      onStatusChange?.('Play · No recording loaded', 0);
    } else {
      onStatusChange?.(
        `Play · ${recordings.length} file${recordings.length === 1 ? '' : 's'} · ${totalFrames} frame${totalFrames === 1 ? '' : 's'}`,
        recordings.length
      );
    }
  }, [recordings.length, totalFrames, onStatusChange]);

  // --- Multi-file open ----------------------------------------------------
  const fileInputRef = useRefPb(null);

  const handleOpenClick = () => fileInputRef.current?.click();

  // Shared loader: takes a list of {kind:'file', file} or {kind:'path', path, name}.
  // Powers both the file-picker flow and the programmatic load-by-path hook
  // (used by tests and the future "Load by path" command-palette entry).
  const loadRecordings = useCallbackPb(
    async (items) => {
      if (!items || items.length === 0) return;
      const names = items.map((it) => (it.kind === 'file' ? it.file.name : it.name || it.path));
      setLoadingFiles((prev) => [...prev, ...names.map((n) => ({ name: n }))]);
      const newRecordings = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const displayName = names[i];
        try {
          let summary;
          if (it.kind === 'file') {
            summary = await apiUpload('/api/sources/upload', it.file);
          } else {
            summary = await apiFetch('/api/sources/load-path', {
              method: 'POST',
              body: { path: it.path, name: it.name || null },
            });
          }
          let meta = null;
          try {
            meta = await fetchFrameMeta(summary.source_id);
          } catch {
            meta = null;
          }
          // Default gain preference: prefer HG, fall back to LG, then
          // HDR, then null (non-GSense). Lives on the recording so the
          // Sources panel owns the gain selector and per-view dropdowns
          // only show channel kinds (Visible/NIR/Chroma/Raw R/G/B).
          const recChannels = summary.channels || [];
          const has = (k) => recChannels.includes(k);
          let initialGain = null;
          if (['HG-R', 'HG-G', 'HG-B'].some(has)) initialGain = 'HG';
          else if (['LG-R', 'LG-G', 'LG-B'].some(has)) initialGain = 'LG';
          else if (['HDR-R', 'HDR-G', 'HDR-B'].some(has)) initialGain = 'HDR';
          newRecordings.push({
            source_id: summary.source_id,
            name: summary.name,
            kind: summary.kind,
            channels: summary.channels,
            shape: summary.shape,
            // Raw mosaic dimensions before channel split — lets the
            // FilePill show "raw file resolution" alongside the
            // per-channel `shape` (which is post-extraction).
            raw_shape: summary.raw_shape || summary.shape,
            raw_dtype: summary.raw_dtype || 'uint16',
            raw_bit_depth: summary.raw_bit_depth || 16,
            path: summary.path,
            has_dark: !!summary.has_dark,
            dark_name: summary.dark_name,
            isp_mode_id: summary.isp_mode_id,
            isp_channel_map: summary.isp_channel_map || {},
            rgb_composite_available: !!summary.rgb_composite_available,
            frame_count: summary.frame_count || (meta?.frame_count ?? 1),
            exposures_s: meta?.exposures_s ?? [],
            timestamps: meta?.timestamps ?? [],
            duration_s: meta?.duration_s ?? 0,
            fps_estimate: meta?.fps_estimate ?? 0,
            file_size: it.kind === 'file' ? it.file.size : null,
            loaded_at: summary.loaded_at,
            // M16: forward backend-emitted load-time warnings
            // (W-META-TS, W-META-EXP, W-FRAME-FAIL) so the FilePill
            // can chip them and the Warning Center can aggregate.
            warnings: summary.warnings || [],
            // Recording-level gain preference (HG / LG / HDR) — set
            // once in the Sources panel and applies to every view
            // bound to this recording.
            gainPref: initialGain,
          });
        } catch (err) {
          setErrorFiles((prev) => [
            ...prev,
            { name: displayName, message: err.detail || err.message },
          ]);
          say?.(`Failed to load ${displayName}: ${err.detail || err.message}`, 'danger');
        } finally {
          setLoadingFiles((prev) => prev.filter((lf) => lf.name !== displayName));
        }
      }
      if (newRecordings.length > 0) {
        setRecordings((prev) => [...prev, ...newRecordings]);
        setSelectedRecId((prev) => prev ?? newRecordings[0].source_id);
        // Auto-create a default view when the first recording loads
        // and there are no views yet. Subsequent recordings don't
        // auto-add a view — the user can hit "+ View" or pick a
        // different recording in the existing view's source dropdown.
        setViews((prevViews) => {
          if (prevViews.length > 0) return prevViews;
          const firstRec = newRecordings[0];
          const v = makeDefaultView(firstRec);
          setSelectedViewId(v.id);
          return [v];
        });
        say?.(
          `Loaded ${newRecordings.length} recording${newRecordings.length === 1 ? '' : 's'}.`,
          'success'
        );
      }
    },
    [say]
  );

  const handleFilesChosen = useCallbackPb(
    (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      loadRecordings(files.map((file) => ({ kind: 'file', file })));
    },
    [loadRecordings]
  );

  // Programmatic load-by-path hook — listens for a custom window event so
  // tests, the future "Load Play sample" command, and a "Load by path"
  // command-palette entry can drive recording loading without the browser
  // file picker. Detail shape: { paths: string[] }.
  useEffectPb(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const paths = (ev?.detail?.paths || []).filter((p) => typeof p === 'string');
      if (paths.length === 0) return;
      loadRecordings(paths.map((p) => ({ kind: 'path', path: p })));
    };
    window.addEventListener('mantis:play:load-paths', handler);
    return () => window.removeEventListener('mantis:play:load-paths', handler);
  }, [loadRecordings]);

  // ISP reconfigure on a Play recording → server-side bytes for every
  // /frame/.../*.png URL changed, but the URL keys didn't (they only
  // depend on per-view display state, not the source's ISP geometry).
  // Purge this source's blob-cache entries AND patch the recording's
  // isp_mode_id / isp_config / channels so the Source-mode dropdown
  // reflects the new mode. Subsequent buildFrameUrl(...) calls will
  // miss the cache and re-fetch the freshly-extracted image.
  useEffectPb(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const detail = ev?.detail || {};
      const sid = detail.source_id;
      if (!sid) return;
      _frameCachePurgeForSource(sid);
      setRecordings((prev) =>
        prev.map((r) =>
          r.source_id === sid
            ? {
                ...r,
                isp_mode_id: detail.isp_mode_id || r.isp_mode_id,
                isp_config: detail.isp_config || r.isp_config,
                channels: detail.channels || r.channels,
                shape: detail.shape || r.shape,
              }
            : r
        )
      );
    };
    window.addEventListener('mantis:source-reconfigured', handler);
    return () => window.removeEventListener('mantis:source-reconfigured', handler);
  }, []);

  // Mirror the selected Play recording into the GLOBAL active source so
  // shared surfaces (the ISP Settings dialog, the StatusBar source chip)
  // bind to the right recording when the user is in Play. Without this,
  // opening ISP Settings on a legacy or modern Play recording showed the
  // sample's defaults (sub_step=2 / outer_stride=4) because the dialog
  // reads its source from `useSource()` (the global SourceCtx).
  useEffectPb(() => {
    if (!onSwitchSource) return;
    const rec = recordings.find((r) => r.source_id === selectedRecId);
    if (rec) onSwitchSource(rec);
  }, [recordings, selectedRecId, onSwitchSource]);

  // (Programmatic dark-load-by-path hook is registered below, after the
  // dark callbacks it references — keeps the TDZ at bay.)

  const handleRemoveRecording = useCallbackPb(
    async (sid) => {
      try {
        await apiFetch(`/api/sources/${sid}`, { method: 'DELETE' });
      } catch (err) {
        // 404 means it was already gone server-side — fine. Log otherwise.
        if (err.status !== 404) {
          say?.(`Could not remove on server: ${err.detail || err.message}`, 'warning');
        }
      }
      setRecordings((prev) => prev.filter((r) => r.source_id !== sid));
      setSelectedRecId((prev) => (prev === sid ? null : prev));
      // Drop any views bound to this recording — they have no data to show.
      setViews((prev) => prev.filter((v) => v.sourceId !== sid));
      setSelectedViewId((prev) => {
        const stillExists = views.find((v) => v.id === prev && v.sourceId !== sid);
        return stillExists ? prev : null;
      });
    },
    [say, views]
  );

  // Multi-select "Delete from disk" — DESTRUCTIVE. Calls the backend
  // route which closes the FrameReader handle, drops each recording
  // from STORE, then `Path.unlink()`s the file. Per-row results so a
  // permission failure on one file doesn't block the rest.
  const handleDeleteMarkedFromDisk = useCallbackPb(async () => {
    const ids = [...markedRecIds];
    if (ids.length === 0) {
      setDeleteConfirmOpen(false);
      return;
    }
    const paths = ids
      .map((sid) => recordings.find((r) => r.source_id === sid)?.path)
      .filter(Boolean);
    if (paths.length === 0) {
      say?.(
        'None of the marked recordings have a known disk path (likely uploaded files).',
        'warning'
      );
      setDeleteConfirmOpen(false);
      return;
    }
    try {
      const resp = await apiFetch('/api/sources/delete-files', {
        method: 'POST',
        body: { paths },
      });
      const results = resp?.results || [];
      const ok = results.filter((r) => r.status === 'deleted').length;
      const missing = results.filter((r) => r.status === 'missing').length;
      const failed = results.filter((r) => r.status === 'error');
      // Drop each successfully-deleted recording from local state.
      const deletedPaths = new Set(
        results.filter((r) => r.status === 'deleted').map((r) => r.path)
      );
      setRecordings((prev) => prev.filter((r) => !r.path || !deletedPaths.has(r.path)));
      setViews((prev) => {
        const stillBound = new Set(
          recordings.filter((r) => r.path && deletedPaths.has(r.path)).map((r) => r.source_id)
        );
        return prev.filter((v) => !stillBound.has(v.sourceId));
      });
      setMarkedRecIds(new Set());
      if (failed.length > 0) {
        say?.(
          `Deleted ${ok} file${ok === 1 ? '' : 's'} from disk; ${failed.length} failed.`,
          'warning'
        );
      } else if (missing > 0) {
        say?.(`Deleted ${ok} file${ok === 1 ? '' : 's'}; ${missing} were already gone.`, 'success');
      } else {
        say?.(`Deleted ${ok} file${ok === 1 ? '' : 's'} from disk.`, 'success');
      }
    } catch (err) {
      say?.(`Delete failed: ${err.detail || err.message}`, 'danger');
    } finally {
      setDeleteConfirmOpen(false);
    }
  }, [markedRecIds, recordings, say]);

  // ---- View management -------------------------------------------------
  const updateView = useCallbackPb((viewId, patch) => {
    setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, ...patch } : v)));
  }, []);

  const addView = useCallbackPb(() => {
    const rec = recordings.find((r) => r.source_id === selectedRecId) || recordings[0];
    if (!rec) return;
    const v = makeDefaultView(rec);
    setViews((prev) => [...prev, v]);
    setSelectedViewId(v.id);
    // Auto-promote layout if user is now in multi-view territory
    setLayoutPreset((prev) => {
      const newCount = views.length + 1;
      if (prev === 'single' && newCount === 2) return 'side';
      if (prev === 'single' && newCount > 2) return '2x2';
      if (prev === 'side' && newCount > 2) return '2x2';
      return prev;
    });
  }, [recordings, selectedRecId, views.length]);

  const removeView = useCallbackPb(
    (viewId) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== viewId);
        return next;
      });
      setSelectedViewId((prev) => {
        if (prev !== viewId) return prev;
        const remaining = views.filter((v) => v.id !== viewId);
        return remaining[0]?.id || null;
      });
    },
    [views]
  );

  // M13: duplicate a view + place the copy adjacent to the original.
  // Cloned view gets a fresh id, inherits all display state, and starts
  // unlocked / not-included-in-export by default to avoid surprises.
  const duplicateView = useCallbackPb((viewId) => {
    setViews((prev) => {
      const idx = prev.findIndex((v) => v.id === viewId);
      if (idx < 0) return prev;
      const original = prev[idx];
      const clone = {
        ...original,
        id: newViewId(),
        name: `${original.name} (copy)`,
        isLocked: false,
        lockedFrame: null,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, clone);
      return next;
    });
  }, []);

  // M13: copy a set of display fields from one view to a target list of
  // view ids. Whitelisted fields per the plan: colormap, vmin/vmax,
  // brightness/contrast/saturation, overlay struct, applyDark, invert,
  // labels. Excludes name / sourceMode / sourceId / lockedFrame so the
  // user doesn't accidentally repoint a target view at a different source.
  const copyViewSettingsTo = useCallbackPb(
    (sourceViewId, targetViewIds) => {
      const source = views.find((v) => v.id === sourceViewId);
      if (!source) return;
      const patch = {
        colormap: source.colormap,
        vmin: source.vmin,
        vmax: source.vmax,
        invert: source.invert,
        brightness: source.brightness,
        contrast: source.contrast,
        saturation: source.saturation,
        showRaw: source.showRaw,
        applyDark: source.applyDark,
        overlay: source.overlay,
        labels: source.labels,
      };
      setViews((prev) => prev.map((v) => (targetViewIds.includes(v.id) ? { ...v, ...patch } : v)));
    },
    [views]
  );

  // ---- Frame clamp + playback loop -------------------------------------
  // Clamp globalFrame whenever totalFrames changes so we never point past
  // the end of the (possibly shrunk) stream.
  useEffectPb(() => {
    setGlobalFrame((cur) => Math.max(0, Math.min(cur, totalFrames - 1)));
    // M17: if a brush range is set and the stream just shrank past its
    // bounds, drop the brush rather than silently clamping to a range
    // the user didn't choose.
    setRangeSelection((cur) => {
      if (!cur) return cur;
      if (cur[0] > totalFrames - 1 || cur[1] > totalFrames - 1) return null;
      return cur;
    });
  }, [totalFrames]);

  // setTimeout-chained play loop. Single chain — abort on `playing=false`,
  // FPS change, loop change, or stream-size change. No setInterval (avoids
  // request pileup if frame fetch slows past 1000/FPS).
  useEffectPb(() => {
    if (!playing) return undefined;
    if (totalFrames <= 1) {
      setPlaying(false);
      return undefined;
    }
    let cancelled = false;
    const stepMs = Math.max(8, Math.round(1000 / Math.max(1, fps)));
    const tick = () => {
      if (cancelled) return;
      let nextFrame = null;
      setGlobalFrame((cur) => {
        const nxt = cur + 1;
        if (nxt >= totalFrames) {
          if (loop) {
            nextFrame = 0;
            return 0;
          }
          setPlaying(false);
          return cur;
        }
        nextFrame = nxt;
        return nxt;
      });
      // Prefetch the frame AFTER the one we just advanced to, for every
      // active view. Browser-side cache hit on the next tick = no flash.
      if (nextFrame != null) {
        const lookahead = (nextFrame + 1) % totalFrames;
        for (const view of views) {
          const rec = recordings.find((r) => r.source_id === view.sourceId);
          if (!rec) continue;
          const url = buildFrameUrl(rec, view, lookahead);
          if (url) _prefetchFrame(url);
        }
      }
      if (!cancelled) setTimeout(tick, stepMs);
    };
    const id = setTimeout(tick, stepMs);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [playing, fps, loop, totalFrames, views, recordings]);

  // ---- Keyboard shortcuts (only while Play tab is mounted) -------------
  useEffectPb(() => {
    const onKey = (e) => {
      const t2 = e.target;
      const typing =
        t2 && (t2.tagName === 'INPUT' || t2.tagName === 'TEXTAREA' || t2.isContentEditable);
      if (typing) return;
      // M11 reviewer P0: never preventDefault on system shortcuts —
      // Cmd/Ctrl/Alt + Space|Arrow|Home|End are owned by the OS or
      // browser (Spotlight, history, scroll). Skip our handler when any
      // modifier is held.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Mode keys (1/2/3/4) are owned by App; we only handle play-tab keys.
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        setGlobalFrame((c) => Math.max(0, c - step));
        setPlaying(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        setGlobalFrame((c) => Math.min(totalFrames - 1, c + step));
        setPlaying(false);
      } else if (e.key === 'Home') {
        e.preventDefault();
        setGlobalFrame(0);
        setPlaying(false);
      } else if (e.key === 'End') {
        e.preventDefault();
        setGlobalFrame(Math.max(0, totalFrames - 1));
        setPlaying(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totalFrames]);

  const handleRetryError = useCallbackPb((name) => {
    setErrorFiles((prev) => prev.filter((e) => e.name !== name));
    // Just clear — user can re-open the file. Real auto-retry would need
    // to re-trigger the picker which the browser blocks programmatically.
  }, []);

  // ---- Dark-frame management (M8) --------------------------------------
  const handleOpenDarkClick = useCallbackPb(() => {
    darkInputRef.current?.click();
  }, []);

  const refreshSourceSummary = useCallbackPb(async (sid) => {
    try {
      const sum = await apiFetch(`/api/sources/${sid}`, { method: 'GET' });
      setRecordings((prev) =>
        prev.map((r) =>
          r.source_id === sid
            ? {
                ...r,
                has_dark: !!sum.has_dark,
                dark_name: sum.dark_name,
                dark_path: sum.dark_path,
              }
            : r
        )
      );
    } catch (err) {
      // ignore — UI just won't reflect the latest has_dark state.
    }
  }, []);

  const attachDarkToSource = useCallbackPb(
    async (sid, file) => {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/sources/${sid}/dark/upload`, { method: 'POST', body: fd });
      await refreshSourceSummary(sid);
    },
    [refreshSourceSummary]
  );

  const handleDarkFilesChosen = useCallbackPb(
    async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      if (recordings.length === 0) {
        say?.('Load a recording first — darks are attached to a recording.', 'warning');
        return;
      }
      // Default attach target: the active recording at the timeline's
      // global frame. Fallback: first recording.
      const target =
        recordings.find((r) => r.source_id === activeAtGlobal.sourceId) ||
        recordings.find((r) => r.source_id === selectedRecId) ||
        recordings[0];
      if (!target) return;
      setLoadingDarks((prev) => [...prev, ...files.map((f) => ({ name: f.name }))]);
      const newDarks = [];
      for (const f of files) {
        try {
          await attachDarkToSource(target.source_id, f);
          newDarks.push({
            id: `dark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            name: f.name,
            file_size: f.size,
            attached: new Set([target.source_id]),
          });
          say?.(`Dark frame ${f.name} attached to ${target.name}.`, 'success');
        } catch (err) {
          setDarkErrors((prev) => [...prev, { name: f.name, message: err.detail || err.message }]);
          say?.(`Failed to attach dark ${f.name}: ${err.detail || err.message}`, 'danger');
        } finally {
          setLoadingDarks((prev) => prev.filter((lf) => lf.name !== f.name));
        }
      }
      if (newDarks.length > 0) {
        setDarks((prev) => [...prev, ...newDarks]);
      }
    },
    [recordings, activeAtGlobal.sourceId, selectedRecId, attachDarkToSource, say]
  );

  // M23 — build the tiled-image-export payload for a list of views.
  // Mirrors `buildFrameUrl` field-by-field so the exported tile matches
  // the live ViewerCard render byte-for-byte (modulo PNG re-encode).
  // NOTE: declared BEFORE the video/image export callbacks so their
  // dependency arrays don't trigger TDZ on `buildTiledViewSpec`.
  const buildTiledViewSpec = useCallbackPb(
    (v) => {
      if (!v) return null;
      const rec = recordings.find((r) => r.source_id === v.sourceId);
      if (!rec) return null;
      const meta = sourceModeMeta(v.sourceMode);
      const localFrame =
        v.isLocked && v.lockedFrame != null
          ? v.lockedFrame
          : v.sourceId === activeAtGlobal.sourceId
            ? activeAtGlobal.local
            : 0;
      const baseRender =
        meta.kind === 'rgb' || meta.kind === 'rgb_image'
          ? 'rgb_composite'
          : meta.kind === 'overlay'
            ? 'overlay'
            : 'channel';
      const channel =
        meta.kind === 'channel' ? meta.channel : meta.kind === 'raw' ? v.rawChannel : null;
      const ov = v.overlay || {};
      const grading = v.grading || {};
      const isp = v.isp || {};
      return {
        source_id: rec.source_id,
        frame_index: localFrame,
        render: baseRender,
        gain: meta.gain || 'hg',
        channel,
        colormap: v.colormap || meta.defaultColormap || 'gray',
        invert: !!v.invert,
        show_clipping: !!v.showClipping,
        vmin: v.vmin ?? null,
        vmax: v.vmax ?? null,
        normalize: v.normalize || 'none',
        black_level: v.blackLevel ?? 0,
        isp_gain: v.gain ?? 1.0,
        offset: v.offset ?? 0,
        isp_brightness: v.ispBrightness ?? 0,
        isp_contrast: v.ispContrast ?? 1.0,
        isp_gamma: v.gamma ?? 1.0,
        apply_dark: v.applyDark !== false && rec.has_dark,
        // M26 — sharpen / FPN chain (mirrors view.isp). When fields are
        // at default, backend gating short-circuits, so unconditionally
        // emitting the keys is safe.
        sharpen_method:
          isp.sharpen_method && isp.sharpen_method !== 'None' ? isp.sharpen_method : null,
        sharpen_amount: isp.sharpen_amount ?? 1.0,
        sharpen_radius: isp.sharpen_radius ?? 2.0,
        denoise_sigma: isp.denoise_sigma ?? 0.0,
        median_size: isp.median_size ?? 0,
        gaussian_sigma: isp.gaussian_sigma ?? 0.0,
        hot_pixel_thr: isp.hot_pixel_thr ?? 0.0,
        bilateral: !!isp.bilateral,
        base_kind: ov.baseKind || 'rgb_composite',
        base_channel:
          (ov.baseKind || 'rgb_composite') === 'rgb_composite'
            ? (ov.baseGain || meta.baseGain || 'hg').toLowerCase() === 'lg'
              ? 'LG-R'
              : 'HG-R'
            : ov.baseChannel ||
              ((ov.baseGain || meta.baseGain || 'hg').toLowerCase() === 'lg' ? 'LG-Y' : 'HG-Y'),
        overlay_channel: ov.overlayChannel || meta.overlayChannel || null,
        overlay_low: ov.overlayLow ?? null,
        overlay_high: ov.overlayHigh ?? null,
        overlay_colormap: ov.overlayColormap || v.colormap || meta.defaultColormap || 'inferno',
        blend: ov.blend || 'alpha',
        strength: ov.strength ?? 0.6,
        grading_gain_r: grading.gain_r ?? 1.0,
        grading_gain_g: grading.gain_g ?? 1.0,
        grading_gain_b: grading.gain_b ?? 1.0,
        grading_offset_r: grading.offset_r ?? 0,
        grading_offset_g: grading.offset_g ?? 0,
        grading_offset_b: grading.offset_b ?? 0,
        grading_gamma: grading.gamma ?? 1.0,
        grading_brightness: grading.brightness ?? 0,
        grading_contrast: grading.contrast ?? 1.0,
        grading_saturation: grading.saturation ?? 1.0,
        grading_wb_kelvin: grading.wb_kelvin ?? null,
        label_timestamp: !!v.labels?.timestamp,
        label_frame: !!v.labels?.frame,
        label_channel: !!v.labels?.channel,
        label_source: !!v.labels?.source_file,
        label_scale_bar: !!v.labels?.scale_bar,
        label_position: v.labels?.position || 'bottom-left',
        label_font_size: v.labels?.font_size || 12,
        title: v.name || meta.label,
      };
    },
    [recordings, activeAtGlobal]
  );

  // ---- Video export (M10) ---------------------------------------------
  const buildVideoUrl = useCallbackPb(
    (opts) => {
      const v = views.find((vv) => vv.id === selectedViewId) || views[0];
      if (!v) return null;
      // M11 reviewer P1: skip when the view is excluded from export.
      if (v.includedInExport === false) return null;
      const rec = recordings.find((r) => r.source_id === v.sourceId);
      if (!rec) return null;
      const meta = sourceModeMeta(v.sourceMode);
      const q = new URLSearchParams({
        format: opts.format,
        start: String(opts.start),
        end: String(opts.end),
        fps: String(opts.fps),
        max_dim: '1280',
      });
      if (meta.kind === 'rgb' || meta.kind === 'rgb_image') {
        q.set('render', 'rgb_composite');
        q.set('gain', meta.kind === 'rgb_image' ? 'hg' : meta.gain);
      } else if (meta.kind === 'channel') {
        q.set('render', 'channel');
        q.set('channel', meta.channel);
        q.set('colormap', v.colormap || meta.defaultColormap || 'gray');
      } else if (meta.kind === 'overlay') {
        const ov = v.overlay || {};
        const baseKind = ov.baseKind || 'rgb_composite';
        const baseGain = (ov.baseGain || meta.baseGain || 'hg').toLowerCase();
        const baseChannel =
          baseKind === 'rgb_composite'
            ? baseGain === 'lg'
              ? 'LG-R'
              : 'HG-R'
            : ov.baseChannel || (baseGain === 'lg' ? 'LG-Y' : 'HG-Y');
        q.set('render', 'overlay');
        q.set('base_channel', baseChannel);
        q.set('base_kind', baseKind);
        q.set('overlay_channel', ov.overlayChannel || meta.overlayChannel || 'HG-NIR');
        q.set(
          'overlay_colormap',
          ov.overlayColormap || v.colormap || meta.defaultColormap || 'inferno'
        );
        q.set('blend', ov.blend || 'alpha');
        q.set('strength', String(ov.strength ?? 0.6));
        if (ov.overlayLow != null) q.set('overlay_low', String(ov.overlayLow));
        if (ov.overlayHigh != null) q.set('overlay_high', String(ov.overlayHigh));
      } else if (meta.kind === 'raw' && v.rawChannel) {
        q.set('render', 'channel');
        q.set('channel', v.rawChannel);
        q.set('colormap', v.colormap || 'gray');
      } else {
        return null;
      }
      if (v.vmin != null) q.set('vmin', String(v.vmin));
      if (v.vmax != null) q.set('vmax', String(v.vmax));
      if (v.applyDark === false) q.set('apply_dark', 'false');
      return `${API_BASE}/api/sources/${rec.source_id}/export/video?${q.toString()}`;
    },
    [views, selectedViewId, recordings]
  );

  const exportVideo = useCallbackPb(
    async (opts) => {
      // M24 — multi-view stream → tiled video endpoint; single-view
      // stays on the legacy /export/video URL builder.
      const tiled = (opts.tiled ?? views.length > 1) && views.length > 1;
      let url;
      let body = null;
      if (tiled) {
        const exportable = views.filter((v) => v.includedInExport !== false);
        const specs = exportable.map(buildTiledViewSpec).filter(Boolean);
        if (specs.length === 0) {
          say?.(
            'No views available to export — toggle "Include in export" or load a recording.',
            'warning'
          );
          return;
        }
        url = `${API_BASE}/api/sources/export/video-tiled`;
        body = {
          views: specs,
          layout: opts.layout || 'auto',
          gap_px: 6,
          background: '#000000',
          fps: opts.fps || 10,
          start: opts.start ?? 0,
          end: opts.end ?? null,
          format: opts.format || 'mp4',
        };
      } else {
        url = buildVideoUrl(opts);
        if (!url) {
          say?.('Could not build video export URL — pick a view first.', 'warning');
          return;
        }
      }
      try {
        say?.(
          `Rendering ${opts.format.toUpperCase()} (${opts.end - opts.start + 1} frames${tiled ? ' tiled' : ''})…`,
          'info'
        );
        const r = await fetch(
          url,
          body
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : undefined
        );
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`${r.status}: ${text.slice(0, 200)}`);
        }
        const blob = await r.blob();
        const objUrl = URL.createObjectURL(blob);
        // Filename comes from the server's Content-Disposition; browser
        // honors the download attribute as a fallback.
        const dispo = r.headers.get('Content-Disposition') || '';
        const m = dispo.match(/filename="([^"]+)"/);
        const filename = m ? m[1] : `play_export.${opts.format === 'zip' ? 'zip' : opts.format}`;
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
        say?.(`Exported ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
        setExportVideoOpen(false);
      } catch (err) {
        say?.(`Video export failed: ${err.message || err}`, 'danger');
      }
    },
    [buildVideoUrl, buildTiledViewSpec, views, say]
  );

  // M23 — POST the tiled-image-export request and download the result.
  const exportImageTiled = useCallbackPb(
    async ({ scope, layout, format, gap, background }) => {
      let chosen = [];
      if (scope === 'selected') {
        const v = views.find((vv) => vv.id === selectedViewId);
        if (v) chosen = [v];
      } else if (Array.isArray(scope)) {
        chosen = scope.map((id) => views.find((v) => v.id === id)).filter(Boolean);
      } else {
        chosen = views.filter((v) => v.includedInExport !== false);
      }
      if (chosen.length === 0) {
        say?.('No views selected for export.', 'warning');
        return;
      }
      const specs = chosen.map(buildTiledViewSpec).filter(Boolean);
      if (specs.length === 0) {
        say?.('No views could be rendered (missing recording bindings).', 'warning');
        return;
      }
      try {
        say?.(
          `Rendering tiled ${format.toUpperCase()} (${specs.length} views, ${layout} layout)…`,
          'info'
        );
        const r = await fetch(`${API_BASE}/api/sources/export/image-tiled`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            views: specs,
            layout: layout || 'auto',
            gap_px: gap ?? 6,
            background: background || '#000000',
            format: format || 'png',
          }),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`${r.status}: ${text.slice(0, 200)}`);
        }
        const blob = await r.blob();
        const objUrl = URL.createObjectURL(blob);
        const dispo = r.headers.get('Content-Disposition') || '';
        const m = dispo.match(/filename="([^"]+)"/);
        const filename = m ? m[1] : `play_tiled.${format || 'png'}`;
        const a = document.createElement('a');
        a.href = objUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
        say?.(`Exported ${filename} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`, 'success');
        setExportImageOpen(false);
      } catch (err) {
        say?.(`Tiled export failed: ${err.message || err}`, 'danger');
      }
    },
    [views, selectedViewId, buildTiledViewSpec, say]
  );

  // ---- Image export (M9) ----------------------------------------------
  const exportImage = useCallbackPb(async () => {
    const v = views.find((vv) => vv.id === selectedViewId) || views[0];
    if (!v) {
      say?.('No view to export.', 'warning');
      return;
    }
    // M11 reviewer P1: respect the Inspector's "Include in export" toggle.
    if (v.includedInExport === false) {
      say?.(
        'Selected view is excluded from export — toggle "Include in export" in the Inspector.',
        'warning'
      );
      return;
    }
    const rec = recordings.find((r) => r.source_id === v.sourceId);
    if (!rec) {
      say?.('Selected view has no recording bound.', 'warning');
      return;
    }
    const localFrame =
      v.isLocked && v.lockedFrame != null
        ? v.lockedFrame
        : v.sourceId === activeAtGlobal.sourceId
          ? activeAtGlobal.local
          : 0;
    const url = buildFrameUrl(rec, v, localFrame);
    if (!url) {
      say?.('Could not build export URL for this view.', 'danger');
      return;
    }
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      const baseName = rec.name.replace(/\.h5$/i, '');
      const frameStr = String(localFrame).padStart(4, '0');
      a.download = `${baseName}_f${frameStr}_${v.sourceMode}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
      say?.(`Exported ${a.download}`, 'success');
    } catch (err) {
      say?.(`Export failed: ${err.message}`, 'danger');
    }
  }, [views, selectedViewId, recordings, activeAtGlobal, say]);

  const handleRemoveDark = useCallbackPb(
    async (darkId) => {
      const dark = darks.find((d) => d.id === darkId);
      if (!dark) return;
      // Detach from each recording it was attached to.
      for (const sid of dark.attached) {
        try {
          await apiFetch(`/api/sources/${sid}/dark`, { method: 'DELETE' });
          await refreshSourceSummary(sid);
        } catch (err) {
          // 404 means already gone server-side — fine.
        }
      }
      setDarks((prev) => prev.filter((d) => d.id !== darkId));
    },
    [darks, refreshSourceSummary]
  );

  // Stale source_id recovery — when a ViewerCard's frame fetch returns
  // 404, the backend doesn't know the source (typically a backend restart
  // after the user loaded the file). Mark the recording with an error
  // flag so its FilePill turns red AND the ViewerCard's error overlay
  // explains what to do. We DO NOT auto-clear the recording — that
  // crashed React's commit phase during fast unmount under realistic
  // 404 sequences. The user can hit "Retry" or "×" themselves.
  useEffectPb(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const sid = ev?.detail?.source_id;
      if (!sid) return;
      setRecordings((prev) =>
        prev.map((r) => (r.source_id === sid ? { ...r, server_lost: true } : r))
      );
    };
    window.addEventListener('mantis:play:source-not-found', handler);
    return () => window.removeEventListener('mantis:play:source-not-found', handler);
  }, []);

  // Programmatic dark-load-by-path hook — registered AFTER refreshSourceSummary
  // so its deps array doesn't trigger a TDZ. Detail:
  // { paths: string[], targetSid?: string }. Used by tests and a future
  // "Load dark by path" command.
  useEffectPb(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = async (ev) => {
      const paths = (ev?.detail?.paths || []).filter((p) => typeof p === 'string');
      if (paths.length === 0) return;
      const sid =
        ev?.detail?.targetSid ||
        activeAtGlobal?.sourceId ||
        selectedRecId ||
        recordings[0]?.source_id;
      if (!sid) {
        say?.('No recording loaded — load a recording first.', 'warning');
        return;
      }
      const newDarks = [];
      setLoadingDarks((prev) => [...prev, ...paths.map((p) => ({ name: p.split('/').pop() }))]);
      for (const p of paths) {
        const name = p.split('/').pop();
        try {
          await apiFetch(`/api/sources/${sid}/dark/load-path`, {
            method: 'POST',
            body: { path: p, name },
          });
          await refreshSourceSummary(sid);
          newDarks.push({
            id: `dark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            name,
            file_size: null,
            attached: new Set([sid]),
          });
        } catch (err) {
          setDarkErrors((prev) => [...prev, { name, message: err.detail || err.message }]);
        } finally {
          setLoadingDarks((prev) => prev.filter((lf) => lf.name !== name));
        }
      }
      if (newDarks.length > 0) {
        setDarks((prev) => [...prev, ...newDarks]);
        say?.(
          `${newDarks.length} dark frame${newDarks.length === 1 ? '' : 's'} attached.`,
          'success'
        );
      }
    };
    window.addEventListener('mantis:play:load-darks', handler);
    return () => window.removeEventListener('mantis:play:load-darks', handler);
  }, [activeAtGlobal?.sourceId, selectedRecId, recordings, refreshSourceSummary, say]);

  const accept = globalFileFilter?.filters?.[globalFileFilter.current]?.accept || '.h5,.hdf5';

  // --- Layout proportions (per spec §5.4) ---------------------------------
  const sourcesWidth = sourcesCollapsed ? 44 : 288;
  const inspectorWidth = inspectorCollapsed ? 44 : 420;

  // --- Render -------------------------------------------------------------
  return (
    <div
      data-mode="play"
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: t.bg,
        color: t.text,
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* hidden file input — multi-select to load several recordings at once */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesChosen}
      />
      {/* hidden file input — dark frame H5 (averaged on the backend) */}
      <input
        ref={darkInputRef}
        type="file"
        accept={accept}
        multiple
        style={{ display: 'none' }}
        onChange={handleDarkFilesChosen}
      />

      <StreamHeader
        recordings={orderedRecordings}
        totalFrames={totalFrames}
        allExposures={allExposures}
        continuityWarnings={detectContinuity(orderedRecordings, continuityThreshold)}
        onOpen={handleOpenClick}
        onOpenStreamBuilder={() => setStreamBuilderOpen(true)}
        onExportImage={() => {
          // M23 — multi-view stream → open the tiled-export modal.
          // Single-view → just save the current frame.
          if (views.length > 1) setExportImageOpen(true);
          else exportImage();
        }}
        onOpenExportVideo={() => setExportVideoOpen(true)}
        onOpenWarningCenter={() => setWarningCenterOpen(true)}
        warningCount={
          detectContinuity(orderedRecordings, continuityThreshold).length +
          errorFiles.length +
          darkErrors.length +
          // M16: include per-source load-time warnings (W-META-TS, etc.)
          // in the overall count so the StreamHeader chip badges match
          // what the Warning Center modal shows.
          recordings.reduce((acc, r) => acc + (r.warnings?.length || 0), 0)
        }
        warningHasError={
          errorFiles.length > 0 ||
          darkErrors.length > 0 ||
          detectContinuity(orderedRecordings, continuityThreshold).some(
            (w) => w.severity === 'error'
          )
        }
        canExport={views.length > 0}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'row',
          background: t.bg,
        }}
      >
        <SourcesPanel
          width={sourcesWidth}
          collapsed={sourcesCollapsed}
          onToggleCollapse={() => {
            // M15: latch manual touch so the auto-rule defers to the
            // user until the next viewport bucket transition.
            sourcesTouchedRef.current = true;
            setSourcesCollapsed((c) => !c);
          }}
          recordings={recordings}
          loadingFiles={loadingFiles}
          errorFiles={errorFiles}
          selectedRecId={selectedRecId}
          onSelect={setSelectedRecId}
          onRemove={handleRemoveRecording}
          onOpen={handleOpenClick}
          onRetry={handleRetryError}
          darks={darks}
          loadingDarks={loadingDarks}
          darkErrors={darkErrors}
          onOpenDark={handleOpenDarkClick}
          onRemoveDark={handleRemoveDark}
          onOpenWarningCenter={() => setWarningCenterOpen(true)}
          dismissedWarnings={dismissedWarnings}
          onDismissWarning={dismissWarning}
          onSetGain={setRecordingGain}
          // Multi-select "Delete from disk" — destructive flow.
          markedRecIds={markedRecIds}
          onToggleMarked={toggleMarked}
          onClearMarked={clearMarked}
          onOpenDeleteConfirm={() => setDeleteConfirmOpen(true)}
          // Recording whose frame is currently rendered on the canvas
          // (mapped from globalFrame via sourceOffsets). FilePill renders
          // a "now playing" indicator on this row.
          activeRecId={activeAtGlobal.sourceId || null}
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: t.bg,
            borderLeft: `1px solid ${t.border}`,
            borderRight: `1px solid ${t.border}`,
          }}
        >
          {recordings.length === 0 ? (
            <EmptyMode onOpen={handleOpenClick} />
          ) : (
            <>
              <ViewerGrid
                recordings={recordings}
                views={views}
                selectedViewId={selectedViewId}
                layoutPreset={layoutPreset}
                onSelectView={setSelectedViewId}
                onUpdateView={updateView}
                onAddView={addView}
                onRemoveView={removeView}
                onDuplicateView={duplicateView}
                onCopyViewSettings={copyViewSettingsTo}
                onSetLayout={setLayoutPreset}
                localFrameForView={localFrameForView}
                globalFrame={globalFrame}
                sourceOffsets={sourceOffsets}
              />
              <TimelineStrip
                orderedRecordings={orderedRecordings}
                totalFrames={totalFrames}
                globalFrame={globalFrame}
                onSetFrame={setGlobalFrame}
                playing={playing}
                onTogglePlay={() => setPlaying((p) => !p)}
                fps={fps}
                onSetFps={setFps}
                loop={loop}
                onToggleLoop={() => setLoop((l) => !l)}
                activeAtGlobal={activeAtGlobal}
                lockedViews={views.filter((v) => v.isLocked && v.lockedFrame != null)}
                sourceOffsets={sourceOffsets}
                rangeSelection={rangeSelection}
                onSetRangeSelection={setRangeSelection}
              />
            </>
          )}
        </div>

        <Inspector
          width={inspectorWidth}
          collapsed={inspectorCollapsed}
          onToggleCollapse={() => {
            // M15: latch manual touch (see SourcesPanel toggle).
            inspectorTouchedRef.current = true;
            setInspectorCollapsed((c) => !c);
          }}
          selectedView={views.find((v) => v.id === selectedViewId) || null}
          selectedRecording={(() => {
            const view = views.find((v) => v.id === selectedViewId);
            return view ? recordings.find((r) => r.source_id === view.sourceId) : null;
          })()}
          onUpdateView={updateView}
          fps={fps}
          totalFrames={totalFrames}
          // M20: pass enough state for the Display histogram to know
          // which frame to fetch. The Inspector computes the
          // selectedView's local frame from globalFrame + sourceOffsets
          // (mirroring ViewerCard's `effectiveFrame`).
          globalFrame={globalFrame}
          sourceOffsets={sourceOffsets}
          // M28 — server-side presets.
          presets={presets}
          onOpenSavePreset={() => setSavePresetOpen(true)}
          onDeletePreset={deletePreset}
          // M29 — overlay builder modal opener.
          onOpenOverlayBuilder={() => setOverlayBuilderViewId(selectedViewId)}
          // Recording-level gain selector (HG / LG / HDR) — lives in the
          // Inspector "Source" section. Writes to recording.gainPref and
          // rebases all views bound to that recording.
          onSetGain={setRecordingGain}
        />
      </div>
      {streamBuilderOpen && (
        <StreamBuilderModal
          orderedRecordings={orderedRecordings}
          continuityThreshold={continuityThreshold}
          onChangeThreshold={setContinuityThreshold}
          onApply={(newOrder) => {
            setStreamOrder(newOrder);
            setStreamBuilderOpen(false);
            say?.('Stream order updated.', 'success');
          }}
          onClose={() => setStreamBuilderOpen(false)}
          onRemove={handleRemoveRecording}
        />
      )}
      {exportVideoOpen && (
        <ExportVideoModal
          rangeSelection={rangeSelection}
          onClearRange={() => setRangeSelection(null)}
          totalFrames={totalFrames}
          fps={fps}
          viewCount={views.length}
          onExport={exportVideo}
          onClose={() => setExportVideoOpen(false)}
        />
      )}
      {exportImageOpen && (
        <ExportImageModal
          views={views}
          selectedViewId={selectedViewId}
          onExport={exportImageTiled}
          onClose={() => setExportImageOpen(false)}
        />
      )}
      {warningCenterOpen && (
        <WarningCenterModal
          onAction={(action) => {
            // M18: action-button handlers from the canonical
            // WARNING_TEMPLATES catalog. The WC row passes its action
            // kind here; we map to the appropriate side-effect.
            if (action === 'open-stream-builder') {
              setWarningCenterOpen(false);
              setStreamBuilderOpen(true);
              return;
            }
            if (action === 'open-export') {
              setWarningCenterOpen(false);
              setExportVideoOpen(true);
              return;
            }
            if (action === 'clear-range') {
              setRangeSelection(null);
              return;
            }
            if (action === 'inspect-file' || action === 'open-inspector') {
              // Pass-through: the WC-row picks the source / view; here
              // we just close the modal so the user sees the highlight.
              setWarningCenterOpen(false);
              return;
            }
            // 'dismiss' and unknown actions: no-op.
          }}
          warnings={[
            ...detectContinuity(orderedRecordings, continuityThreshold).map((w) => {
              // M18: map continuity 'type' → canonical W-* code.
              const codeFromType = {
                gap: 'W-GAP',
                overlap: 'W-OVERLAP',
                'exp-mismatch': 'W-EXP-MISMATCH',
                shape: 'W-SHAPE',
                chan: 'W-CHAN',
              };
              return {
                ...w,
                source: 'stream',
                code: codeFromType[w.type] || `W-${w.type.toUpperCase()}`,
              };
            }),
            ...errorFiles.map((e) => ({
              severity: 'error',
              source: 'file',
              code: 'W-LOAD',
              detail: `Failed to load ${e.name}: ${e.message}`,
            })),
            ...darkErrors.map((e) => ({
              severity: 'error',
              source: 'dark',
              code: 'W-DARK',
              detail: `Failed to attach dark ${e.name}: ${e.message}`,
            })),
            ...(recordings.length > 0 && darks.length === 0
              ? [
                  {
                    severity: 'info',
                    source: 'dark',
                    code: 'W-DARK-NONE',
                    detail: 'No dark frames loaded — dark correction unavailable.',
                  },
                ]
              : []),
            // M16: per-source warnings (W-META-TS, W-META-EXP, W-FRAME-FAIL,
            // ...). Always included regardless of FilePill dismissal —
            // dismissing only hides the chip; the Warning Center stays
            // authoritative.
            ...recordings.flatMap((rec) =>
              (rec.warnings || []).map((w) => ({
                severity: w.severity || 'warning',
                source: 'file',
                code: w.code,
                detail: w.detail || '',
                file: rec.name,
              }))
            ),
            // M18 — frontend-derived per-view / per-export warnings:
            //   * W-OVL-SRC — view in overlay mode whose configured
            //     overlay channel isn't on the bound recording.
            //   * W-PROC-INVALID — view with both vmin/vmax set but
            //     vmin >= vmax.
            //   * W-DARK-AMBIG — recording has dark requested
            //     (`applyDark !== false`) but no dark attached.
            //   * W-RANGE-HUGE — rangeSelection covers > 1000 frames.
            ...views.flatMap((v) => {
              const out = [];
              const rec = recordings.find((r) => r.source_id === v.sourceId);
              const meta = sourceModeMeta(v.sourceMode);
              if (meta.kind === 'overlay' && rec) {
                const ovChan = v.overlay?.overlayChannel || meta.overlayChannel;
                if (ovChan && !(rec.channels || []).includes(ovChan)) {
                  out.push({
                    severity: 'warning',
                    source: 'view',
                    code: 'W-OVL-SRC',
                    detail: `View "${v.name}" overlay channel "${ovChan}" is not on ${rec.name}.`,
                    file: rec.name,
                  });
                }
              }
              if (v.vmin != null && v.vmax != null && v.vmin >= v.vmax) {
                out.push({
                  severity: 'warning',
                  source: 'view',
                  code: 'W-PROC-INVALID',
                  detail: `View "${v.name}": Low threshold (${v.vmin}) ≥ High threshold (${v.vmax}); auto-percentile will be used.`,
                  file: rec?.name,
                });
              }
              if (rec && v.applyDark !== false && !rec.has_dark) {
                out.push({
                  severity: 'warning',
                  source: 'dark',
                  code: 'W-DARK-AMBIG',
                  detail: `View "${v.name}" has dark correction enabled but ${rec.name} has no dark attached — correction is a no-op.`,
                  file: rec.name,
                });
              }
              return out;
            }),
            // W-RANGE-HUGE / W-EXPORT-LONG — derive from rangeSelection
            // and total stream duration. Heuristic thresholds chosen to
            // be loud enough to flag accidents (e.g. user forgot to
            // brush a range on a 5000-frame stream) but quiet otherwise.
            ...(rangeSelection && rangeSelection[1] - rangeSelection[0] + 1 > 1000
              ? [
                  {
                    severity: 'warning',
                    source: 'export',
                    code: 'W-RANGE-HUGE',
                    detail: `Range covers ${rangeSelection[1] - rangeSelection[0] + 1} frames — exports will be slow and large. Brush a smaller range or clear it.`,
                  },
                ]
              : []),
            ...(totalFrames > 1500
              ? [
                  {
                    severity: 'info',
                    source: 'export',
                    code: 'W-EXPORT-LONG',
                    detail: `Stream has ${totalFrames} frames — a full-stream export will be slow. Use the timeline range brush to narrow it.`,
                  },
                ]
              : []),
          ]}
          onClose={() => setWarningCenterOpen(false)}
        />
      )}
      <SavePresetModal
        open={savePresetOpen}
        onClose={() => setSavePresetOpen(false)}
        view={views.find((v) => v.id === selectedViewId) || null}
        onSave={(name) =>
          savePreset(
            name,
            views.find((v) => v.id === selectedViewId)
          )
        }
      />
      {(() => {
        const wizardView = views.find((v) => v.id === overlayBuilderViewId);
        if (!wizardView) return null;
        const wizardRec = recordings.find((r) => r.source_id === wizardView.sourceId);
        return (
          <OverlayBuilderModal
            view={wizardView}
            recording={wizardRec}
            onClose={() => setOverlayBuilderViewId(null)}
            onApply={(nextOverlay) => {
              updateView(wizardView.id, { overlay: nextOverlay });
              setOverlayBuilderViewId(null);
            }}
          />
        );
      })()}
      <DeleteFromDiskConfirmModal
        open={deleteConfirmOpen}
        recordings={recordings.filter((r) => markedRecIds.has(r.source_id))}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteMarkedFromDisk}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// StreamHeader — top strip 44 px
// ---------------------------------------------------------------------------

const StreamHeader = ({
  recordings,
  totalFrames,
  allExposures,
  continuityWarnings = [],
  onOpen,
  onOpenStreamBuilder,
  onExportImage,
  onOpenExportVideo,
  onOpenWarningCenter,
  warningCount = 0,
  warningHasError = false,
  canExport = false,
}) => {
  const t = useTheme();
  const empty = recordings.length === 0;
  const hasWarn = continuityWarnings.length > 0;
  const hasError = continuityWarnings.some((w) => w.severity === 'error');
  const warningColor = warningHasError ? t.danger : t.warn;
  return (
    <div
      style={{
        height: 44,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 14px',
        borderBottom: `1px solid ${t.border}`,
        background: t.panel,
        whiteSpace: 'nowrap',
        minWidth: 0,
      }}
    >
      {empty ? (
        <span
          style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          No stream loaded
        </span>
      ) : (
        <button
          data-stream-chip
          onClick={onOpenStreamBuilder}
          title={'Open Stream Builder · ' + recordings.map((r) => r.name).join(' / ')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 10px',
            background: t.accentSoft,
            color: t.accent,
            border: `1px solid ${hasError ? t.danger : hasWarn ? t.warn : t.border}`,
            borderRadius: 5,
            fontSize: 11,
            fontFamily: 'ui-monospace,Menlo,monospace',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          <Icon name="layers" size={12} />
          <span style={{ fontWeight: 600, color: t.accent }}>
            Stream · {recordings.length} file{recordings.length === 1 ? '' : 's'}
          </span>
          <span style={{ color: t.textFaint }}>·</span>
          <span style={{ color: t.accent }}>{totalFrames} frames</span>
          {allExposures.length > 1 && (
            <>
              <span style={{ color: t.textFaint }}>·</span>
              <span style={{ color: t.warn }} title="Multiple exposures across stream">
                {allExposures.length} exp
              </span>
            </>
          )}
          {hasWarn && (
            <span
              data-stream-warn-dot
              title={`${continuityWarnings.length} continuity warning${continuityWarnings.length === 1 ? '' : 's'} — click to inspect`}
              style={{
                display: 'inline-flex',
                width: 8,
                height: 8,
                borderRadius: 4,
                background: hasError ? t.danger : t.warn,
                marginLeft: 4,
                flexShrink: 0,
              }}
            />
          )}
        </button>
      )}
      <div style={{ flex: 1 }} />
      <button
        onClick={onOpenWarningCenter}
        title={
          warningCount > 0
            ? `${warningCount} warning${warningCount === 1 ? '' : 's'} — click to inspect`
            : 'No warnings — click to view (history)'
        }
        data-warning-center-button
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 8px',
          background: warningCount > 0 ? `${warningColor}15` : 'transparent',
          color: warningCount > 0 ? warningColor : t.textFaint,
          border: `1px solid ${warningCount > 0 ? warningColor : t.chipBorder}`,
          borderRadius: 4,
          fontSize: 11,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <Icon name="warning" size={11} />
        {warningCount > 0 ? warningCount : 'No warnings'}
      </button>
      <Button
        icon="export"
        size="sm"
        onClick={onExportImage}
        disabled={!canExport}
        title={canExport ? 'Export current view as PNG' : 'No view to export'}
        data-export-button
      >
        PNG
      </Button>
      <Button
        icon="film"
        size="sm"
        onClick={onOpenExportVideo}
        disabled={!canExport}
        title={canExport ? 'Export current view as MP4 / GIF / PNG zip' : 'No view to export'}
        data-export-video-button
      >
        Video…
      </Button>
      <Button
        icon="open"
        size="sm"
        onClick={onOpen}
        title="Open recording (multi-select supported)"
      >
        Open recording…
      </Button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// SourcesPanel — left column 288 px, collapsible to 44 px
// ---------------------------------------------------------------------------

const SourcesPanel = ({
  width,
  collapsed,
  onToggleCollapse,
  recordings,
  loadingFiles,
  errorFiles,
  selectedRecId,
  onSelect,
  onRemove,
  onOpen,
  onRetry,
  darks = [],
  loadingDarks = [],
  darkErrors = [],
  onOpenDark,
  onRemoveDark,
  onOpenWarningCenter,
  dismissedWarnings,
  onDismissWarning,
  onSetGain,
  // Multi-select "Delete from disk" props.
  markedRecIds,
  onToggleMarked,
  onClearMarked,
  onOpenDeleteConfirm,
  // Source whose frame is currently displayed on the canvas.
  activeRecId,
}) => {
  const t = useTheme();
  if (collapsed) {
    return (
      <div
        style={{
          width,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 0',
          gap: 8,
          background: t.panel,
          borderRight: `1px solid ${t.border}`,
        }}
      >
        <button
          onClick={onToggleCollapse}
          title="Expand sources panel"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textMuted,
            padding: 6,
            borderRadius: 4,
          }}
        >
          <Icon name="layers" size={16} />
        </button>
        <div
          style={{ fontSize: 9, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          {recordings.length}
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.panel,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: 30,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderBottom: `1px solid ${t.border}`,
          background: t.panel,
          gap: 6,
        }}
      >
        <Icon name="layers" size={12} style={{ color: t.textMuted }} />
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: t.textMuted,
          }}
        >
          Sources
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onToggleCollapse}
          title="Collapse panel"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textFaint,
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Icon name="chevron" size={11} style={{ transform: 'rotate(90deg)' }} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 8px 24px' }}>
        <SectionHeader label="Recordings" count={recordings.length} />
        {recordings.length === 0 && loadingFiles.length === 0 && errorFiles.length === 0 && (
          <EmptySection
            text="No files loaded yet."
            actionLabel="Open recording…"
            onAction={onOpen}
            icon="open"
          />
        )}
        {loadingFiles.map((lf) => (
          <FilePill key={`loading-${lf.name}`} state="loading" name={lf.name} />
        ))}
        {errorFiles.map((ef) => (
          <FilePill
            key={`error-${ef.name}`}
            state="error"
            name={ef.name}
            errorMessage={ef.message}
            onRemove={() => onRetry(ef.name)}
          />
        ))}
        {recordings.map((rec) => (
          <FilePill
            key={rec.source_id}
            state="loaded"
            name={rec.name}
            recording={rec}
            selected={rec.source_id === selectedRecId}
            onSelect={() => onSelect(rec.source_id)}
            onRemove={() => onRemove(rec.source_id)}
            dismissedWarnings={dismissedWarnings}
            onDismissWarning={onDismissWarning}
            onOpenWarningCenter={onOpenWarningCenter}
            onSetGain={onSetGain}
            marked={markedRecIds?.has(rec.source_id)}
            onToggleMarked={() => onToggleMarked?.(rec.source_id)}
            isPlaying={rec.source_id === activeRecId}
          />
        ))}
        {markedRecIds && markedRecIds.size > 0 && (
          <div
            data-marked-toolbar
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              padding: '6px 8px',
              marginTop: 6,
              borderRadius: 5,
              background: t.warnSoft || t.chipBg,
              border: `1px solid ${t.warn || t.border}`,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: t.text,
                flex: 1,
                fontWeight: 500,
              }}
            >
              {markedRecIds.size} selected
            </span>
            <Button
              size="sm"
              variant="subtle"
              onClick={onClearMarked}
              data-marked-clear
              title="Clear selection"
            >
              Clear
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon="close"
              onClick={onOpenDeleteConfirm}
              data-marked-delete
              title="Permanently delete the selected files from disk"
            >
              Delete from disk…
            </Button>
          </div>
        )}
        <div style={{ height: 8 }} />
        <Button
          icon="plus"
          variant="subtle"
          onClick={onOpen}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Add recordings
        </Button>

        <div style={{ height: 16 }} />
        <SectionHeader label="Dark frames" count={darks.length} />
        {darks.length === 0 && loadingDarks.length === 0 && darkErrors.length === 0 && (
          <EmptySection
            text="No dark frames loaded. Dark correction unavailable."
            actionLabel="Open dark frame…"
            onAction={onOpenDark}
            icon="image"
            disabled={recordings.length === 0}
            hint={recordings.length === 0 ? 'Load a recording first.' : null}
          />
        )}
        {loadingDarks.map((lf) => (
          <DarkFrameRow key={`loading-${lf.name}`} state="loading" name={lf.name} />
        ))}
        {darkErrors.map((ef) => (
          <DarkFrameRow
            key={`error-${ef.name}`}
            state="error"
            name={ef.name}
            errorMessage={ef.message}
          />
        ))}
        {darks.map((d) => (
          <DarkFrameRow
            key={d.id}
            state="loaded"
            name={d.name}
            attachedCount={d.attached.size}
            recordings={recordings}
            attached={d.attached}
            onRemove={() => onRemoveDark(d.id)}
          />
        ))}
        {darks.length > 0 && (
          <Button
            icon="plus"
            variant="subtle"
            onClick={onOpenDark}
            style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
          >
            Add dark frames
          </Button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DarkFrameRow — one row per loaded dark file. play-tab-recording-
// inspection-rescue-v1 M8.
// ---------------------------------------------------------------------------

const DarkFrameRow = ({
  state,
  name,
  errorMessage,
  attachedCount = 0,
  recordings = [],
  attached = new Set(),
  onRemove,
}) => {
  const t = useTheme();
  const stateIcon =
    state === 'loading' ? (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${t.accent} 0%, ${t.accentSoft} 100%)`,
          flexShrink: 0,
        }}
      />
    ) : state === 'error' ? (
      <Icon name="warning" size={11} style={{ color: t.danger, flexShrink: 0 }} />
    ) : (
      <Icon name="check" size={11} style={{ color: t.success, flexShrink: 0 }} />
    );
  const borderColor = state === 'error' ? t.danger : t.border;
  const attachedNames = Array.from(attached)
    .map((sid) => recordings.find((r) => r.source_id === sid)?.name)
    .filter(Boolean);
  return (
    <div
      data-dark-row
      data-state={state}
      style={{
        marginBottom: 6,
        background: state === 'error' ? `${t.danger}10` : t.panel,
        border: `1px solid ${borderColor}`,
        borderRadius: 6,
        padding: '8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
      }}
    >
      {stateIcon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'ui-monospace,Menlo,monospace',
            color: state === 'error' ? t.danger : t.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={name}
        >
          {name}
        </div>
        {state === 'loaded' && (
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              fontFamily: 'ui-monospace,Menlo,monospace',
              marginTop: 1,
            }}
            title={attachedNames.join('\n')}
          >
            attached to {attachedCount} recording{attachedCount === 1 ? '' : 's'}
          </div>
        )}
        {state === 'loading' && (
          <div style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>Averaging frames…</div>
        )}
        {state === 'error' && (
          <div style={{ fontSize: 10, color: t.danger, marginTop: 2 }} title={errorMessage}>
            {errorMessage || 'Failed to attach.'}
          </div>
        )}
      </div>
      {onRemove && (
        <button
          onClick={onRemove}
          title="Remove dark frame"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textFaint,
            padding: 2,
          }}
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
};

const SectionHeader = ({ label, count }) => {
  const t = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
        padding: '0 4px',
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: t.text,
        }}
      >
        {label}
      </span>
      {count > 0 && (
        <span
          style={{
            fontSize: 9.5,
            padding: '1px 6px',
            background: t.chipBg,
            color: t.textMuted,
            borderRadius: 8,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
};

const EmptySection = ({ text, actionLabel, onAction, icon, disabled = false, hint = null }) => {
  const t = useTheme();
  return (
    <div
      style={{
        padding: '12px 10px',
        border: `1px dashed ${t.border}`,
        borderRadius: 6,
        marginBottom: 8,
        textAlign: 'center',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ fontSize: 11, color: t.textMuted, marginBottom: hint ? 4 : 8 }}>{text}</div>
      {hint && <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 8 }}>{hint}</div>}
      {actionLabel && (
        <Button
          icon={icon}
          size="sm"
          onClick={onAction}
          disabled={disabled}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// FilePill — one row per recording (loaded / loading / error)
// ---------------------------------------------------------------------------

const FilePill = ({
  state,
  name,
  recording,
  errorMessage,
  selected,
  onSelect,
  onRemove,
  dismissedWarnings,
  onDismissWarning,
  onOpenWarningCenter,
  // Per-recording gain selector (HG / LG / HDR). Lives in the Sources
  // panel — clicking a tab flips every view bound to this recording to
  // the new gain (channel kind preserved). Set to null when the
  // recording exposes no gain options (image-only, polarization, etc.).
  onSetGain,
  // Multi-select tick for the "Delete from disk" flow.
  marked,
  onToggleMarked,
  // True when this recording's frame is currently rendered on the
  // canvas (i.e. the global timeline cursor is inside this source's
  // frame range). Drives a leading green stripe + a ▶ icon next to
  // the file name so the user can see at a glance which file the
  // playhead is in.
  isPlaying,
}) => {
  const t = useTheme();
  const [expanded, setExpanded] = useStatePb(false);
  // M16: which warning code the user clicked (to expand its detail row).
  const [openWarningCode, setOpenWarningCode] = useStatePb(null);
  // Live warnings list = backend-supplied warnings minus session dismissals.
  const dismissedSet =
    (recording && dismissedWarnings && dismissedWarnings[recording.source_id]) || null;
  const liveWarnings = (recording?.warnings || []).filter(
    (w) => !dismissedSet || !dismissedSet.has(w.code)
  );
  const hasWarnings = liveWarnings.length > 0;

  const borderColor =
    state === 'error'
      ? t.danger
      : selected
        ? t.accent
        : hasWarnings && state === 'loaded'
          ? t.warn
          : t.border;

  const bg =
    state === 'error'
      ? `${t.danger}10` // 10 = ~6% alpha
      : selected
        ? t.accentSoft
        : t.panel;

  const stateIcon =
    state === 'loading' ? (
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          background: `linear-gradient(90deg, ${t.accent} 0%, ${t.accentSoft} 100%)`,
          animation: 'mantis-pulse 1.2s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
    ) : state === 'error' ? (
      <Icon name="warning" size={11} style={{ color: t.danger, flexShrink: 0 }} />
    ) : (
      <Icon name="check" size={11} style={{ color: t.success, flexShrink: 0 }} />
    );

  const headerRow = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: state === 'loaded' ? 'pointer' : 'default',
        padding: '8px 10px',
        minWidth: 0,
      }}
      onClick={() => state === 'loaded' && onSelect?.()}
    >
      {state === 'loaded' && onToggleMarked && (
        <input
          type="checkbox"
          checked={!!marked}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onToggleMarked()}
          title="Mark for delete-from-disk"
          data-file-pill-mark
          style={{
            width: 14,
            height: 14,
            margin: 0,
            cursor: 'pointer',
            flexShrink: 0,
            accentColor: t.warn || t.accent,
          }}
        />
      )}
      {stateIcon}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontFamily: 'ui-monospace,Menlo,monospace',
            color: state === 'error' ? t.danger : t.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          title={isPlaying ? `Currently displayed · ${name}` : name}
        >
          {isPlaying && (
            <span
              data-file-pill-playing
              aria-label="Currently displayed"
              style={{
                color: t.success || t.accent,
                flexShrink: 0,
                fontSize: 9,
                lineHeight: 1,
              }}
            >
              ▶
            </span>
          )}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {name}
          </span>
        </div>
        {state === 'loaded' && recording && (
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              fontFamily: 'ui-monospace,Menlo,monospace',
              marginTop: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={(() => {
              const rs = recording.raw_shape || recording.shape || [0, 0];
              const ps = recording.shape || [0, 0];
              const bd = recording.raw_bit_depth || 16;
              const dt = recording.raw_dtype || 'uint16';
              return (
                `Raw frame: ${rs[1]} × ${rs[0]} (${bd}-bit ${dt})\n` +
                `Per-channel: ${ps[1]} × ${ps[0]}\n` +
                `Frames: ${recording.frame_count}`
              );
            })()}
          >
            {recording.frame_count} fr · {formatExposureSet(recording.exposures_s)} ·{' '}
            {recording.raw_shape?.[1] ?? recording.shape?.[1]}×
            {recording.raw_shape?.[0] ?? recording.shape?.[0]}
            {recording.raw_bit_depth && recording.raw_bit_depth !== 16
              ? ` · ${recording.raw_bit_depth}b`
              : ''}
          </div>
        )}
        {/* Per-recording gain selector + channel pickers live in the
            Inspector "Source" section. The FilePill stays focused on
            file metadata + warnings. */}
        {state === 'loading' && (
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              marginTop: 1,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            Loading metadata…
          </div>
        )}
        {state === 'error' && (
          <div
            style={{
              fontSize: 10,
              color: t.danger,
              marginTop: 2,
              whiteSpace: 'normal',
            }}
            title={errorMessage}
          >
            {errorMessage || 'Failed to load.'}
          </div>
        )}
      </div>
      {state === 'loaded' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((x) => !x);
          }}
          title={expanded ? 'Collapse' : 'Expand metadata'}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textFaint,
            padding: 2,
          }}
        >
          <Icon
            name="chevron"
            size={11}
            style={{
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform .15s',
            }}
          />
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove?.();
        }}
        title={state === 'error' ? 'Dismiss' : 'Remove'}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: t.textFaint,
          padding: 2,
        }}
      >
        <Icon name="close" size={10} />
      </button>
    </div>
  );

  // M16: warning chip stack — rendered between the header row and the
  // (already-existing) expanded metadata block. Each chip is clickable;
  // click toggles a small detail row with the canonical W-* detail text
  // plus an "Open in Warning Center" deep-link and a "Dismiss" close.
  const warningStack = hasWarnings && state === 'loaded' && (
    <div
      data-file-pill-warnings
      style={{
        padding: '0 10px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {liveWarnings.map((w) => {
          const open = openWarningCode === w.code;
          const sev = w.severity || 'warning';
          const chipColor = sev === 'error' ? t.danger : sev === 'info' ? t.textMuted : t.warn;
          return (
            <button
              key={w.code}
              data-file-pill-warning-chip
              data-warning-code={w.code}
              onClick={(e) => {
                e.stopPropagation();
                setOpenWarningCode((c) => (c === w.code ? null : w.code));
              }}
              title={w.detail}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                fontSize: 9.5,
                fontFamily: 'ui-monospace,Menlo,monospace',
                background: open ? `${chipColor}22` : `${chipColor}11`,
                color: chipColor,
                border: `1px solid ${chipColor}55`,
                borderRadius: 3,
                cursor: 'pointer',
                lineHeight: 1.4,
              }}
            >
              <Icon name={sev === 'error' ? 'warning' : 'info'} size={9} />
              <span>{w.code}</span>
            </button>
          );
        })}
      </div>
      {openWarningCode &&
        (() => {
          const w = liveWarnings.find((x) => x.code === openWarningCode);
          if (!w) return null;
          return (
            <div
              data-file-pill-warning-detail
              data-warning-code={w.code}
              style={{
                fontSize: 10,
                color: t.textMuted,
                background: t.chipBg,
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                padding: '6px 8px',
                lineHeight: 1.4,
              }}
            >
              <div style={{ marginBottom: 4 }}>{w.detail}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenWarningCenter?.();
                  }}
                  style={{
                    background: t.panel,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    color: t.text,
                    cursor: 'pointer',
                    padding: '2px 8px',
                    fontSize: 10,
                    fontFamily: 'inherit',
                  }}
                >
                  Inspect in Warning Center
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (recording && onDismissWarning) {
                      onDismissWarning(recording.source_id, w.code);
                    }
                    setOpenWarningCode(null);
                  }}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    color: t.textMuted,
                    cursor: 'pointer',
                    padding: '2px 8px',
                    fontSize: 10,
                    fontFamily: 'inherit',
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          );
        })()}
    </div>
  );

  const detail = expanded && state === 'loaded' && recording && (
    <div
      style={{
        padding: '6px 12px 10px',
        fontSize: 10,
        color: t.textMuted,
        fontFamily: 'ui-monospace,Menlo,monospace',
        lineHeight: 1.5,
        borderTop: `1px solid ${t.border}`,
      }}
    >
      <KV k="ID" v={recording.source_id} />
      <KV k="Channels" v={recording.channels?.join(', ') || '—'} />
      <KV k="ISP mode" v={recording.isp_mode_id || '—'} />
      <KV k="RGB composite" v={recording.rgb_composite_available ? 'available' : 'not available'} />
      {recording.duration_s > 0 && <KV k="Duration" v={formatDuration(recording.duration_s)} />}
      {recording.fps_estimate > 0 && <KV k="FPS (est)" v={recording.fps_estimate.toFixed(2)} />}
      {recording.file_size && (
        <KV k="Size" v={`${(recording.file_size / (1024 * 1024)).toFixed(1)} MB`} />
      )}
      {recording.path && <KV k="Path" v={formatPath(recording.path, 44)} title={recording.path} />}
    </div>
  );

  return (
    <div
      style={{
        marginBottom: 6,
        background: bg,
        border: `1px solid ${isPlaying ? t.success || t.accent : borderColor}`,
        borderRadius: 6,
        overflow: 'hidden',
        position: 'relative',
        // 3-px green stripe on the left edge when this recording's
        // frame is currently displayed on the canvas. Subtle enough
        // not to fight the existing selected/warning border colors but
        // unambiguous at a glance ("which file is the playhead in?").
        boxShadow: isPlaying ? `inset 3px 0 0 0 ${t.success || t.accent}` : undefined,
        paddingLeft: isPlaying ? 3 : 0,
      }}
      data-file-pill
      data-state={state}
      data-selected={selected ? 'true' : 'false'}
      data-playing={isPlaying ? 'true' : 'false'}
      data-warning-count={hasWarnings ? liveWarnings.length : 0}
    >
      {headerRow}
      {warningStack}
      {detail}
    </div>
  );
};

const KV = ({ k, v, title }) => {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 2 }} title={title}>
      <span style={{ color: t.textFaint, minWidth: 76 }}>{k}</span>
      <span
        style={{
          color: t.text,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {v}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Empty mode (center area when no recordings loaded)
// ---------------------------------------------------------------------------

const EmptyMode = ({ onOpen }) => {
  const t = useTheme();
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <Card style={{ maxWidth: 520, padding: '32px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: t.accentSoft,
              color: t.accent,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="film" size={20} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: t.text, lineHeight: 1.2 }}>
              Load a recording to begin
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 3 }}>
              H5 camera files · optional dark frames
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <Button icon="open" variant="primary" onClick={onOpen}>
            Open recording
          </Button>
          <Button icon="image" variant="subtle" onClick={() => null}>
            Open dark frame
          </Button>
        </div>
        <div
          style={{
            fontSize: 11,
            color: t.textFaint,
            textAlign: 'center',
            marginBottom: 16,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          · or drop H5 files anywhere ·
        </div>
        <div
          style={{
            fontSize: 11,
            color: t.textMuted,
            lineHeight: 1.65,
            borderTop: `1px solid ${t.border}`,
            paddingTop: 14,
          }}
        >
          <div style={{ fontWeight: 600, color: t.text, marginBottom: 6 }}>Getting started</div>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            <li>Load one or more recording H5 files</li>
            <li>Optionally load dark frames</li>
            <li>Pick a layout and scrub the timeline</li>
            <li>Adjust processing and export</li>
          </ol>
        </div>
      </Card>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ViewerGrid — center area; renders 1+ ViewerCards in a layout preset.
// ---------------------------------------------------------------------------

const LAYOUT_PRESETS = [
  { id: 'single', label: 'Single', icon: 'grid', cols: 1, rows: 1 },
  { id: 'side', label: 'Side-by-side', icon: 'grid', cols: 2, rows: 1 },
  { id: 'stack', label: 'Stack', icon: 'grid', cols: 1, rows: 2 },
  { id: '2x2', label: '2 × 2', icon: 'grid', cols: 2, rows: 2 },
  // M14 — 3+1 preset: views[0] fills the right (large) column spanning
  // all rows; views[1..N-1] stack in the left (small) column, one per row.
  // cols/rows are 'custom' here — ViewerGrid branches on layout.id.
  { id: '3plus1', label: '3+1', icon: 'grid', cols: 'custom', rows: 'custom' },
];

const ViewerGrid = ({
  recordings,
  views,
  selectedViewId,
  layoutPreset,
  onSelectView,
  onUpdateView,
  onAddView,
  onRemoveView,
  onDuplicateView,
  onCopyViewSettings,
  onSetLayout,
  localFrameForView,
  globalFrame,
  sourceOffsets,
}) => {
  const t = useTheme();
  const layout = LAYOUT_PRESETS.find((l) => l.id === layoutPreset) || LAYOUT_PRESETS[0];
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.canvasBg || '#0a0a0a',
      }}
    >
      {/* Grid toolbar */}
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          background: t.panel,
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: t.textMuted,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Layout
        </span>
        <div style={{ display: 'flex', gap: 2, background: t.chipBg, borderRadius: 5, padding: 2 }}>
          {LAYOUT_PRESETS.map((l) => (
            <button
              key={l.id}
              onClick={() => onSetLayout(l.id)}
              title={l.label}
              data-layout-preset={l.id}
              style={{
                padding: '3px 8px',
                fontSize: 10.5,
                background: layoutPreset === l.id ? t.panel : 'transparent',
                color: layoutPreset === l.id ? t.text : t.textMuted,
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <span
          style={{ fontSize: 10.5, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          {views.length} view{views.length === 1 ? '' : 's'}
        </span>
        <Button icon="plus" size="sm" variant="subtle" onClick={onAddView} title="Add view">
          View
        </Button>
      </div>
      {/* Grid */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          // M14 — 3+1 preset uses a 1fr/2fr split with one row per "small"
          // view (at least 1 row even with views.length≤1 so the large
          // cell still gets rendered). All other presets stay on the
          // existing repeat() math.
          ...(layout.id === '3plus1'
            ? {
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
                gridTemplateRows: `repeat(${Math.max(views.length - 1, 1)}, minmax(0, 1fr))`,
              }
            : {
                gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
              }),
          gap: 6,
          padding: 6,
          background: t.canvasBg || '#0a0a0a',
        }}
      >
        {views.map((view, idx) => {
          // M14 — in 3+1 mode, place views[0] in the right column spanning
          // every row, and views[1..N-1] in the left column, one row each.
          const cellStyle =
            layout.id === '3plus1'
              ? idx === 0
                ? { gridColumn: '2', gridRow: '1 / -1' }
                : { gridColumn: '1', gridRow: `${idx} / span 1` }
              : undefined;
          return (
            <ViewerCard
              key={view.id}
              view={view}
              recording={recordings.find((r) => r.source_id === view.sourceId) || null}
              recordings={recordings}
              selected={view.id === selectedViewId}
              onSelect={() => onSelectView(view.id)}
              onUpdate={(patch) => onUpdateView(view.id, patch)}
              onRemove={() => onRemoveView(view.id)}
              onDuplicate={() => onDuplicateView(view.id)}
              onCopySettingsTo={(targetIds) => onCopyViewSettings(view.id, targetIds)}
              otherViews={views.filter((v) => v.id !== view.id)}
              localFrame={localFrameForView(view)}
              globalFrame={globalFrame}
              sourceOffsets={sourceOffsets}
              cellStyle={cellStyle}
            />
          );
        })}
        {views.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              gridRow: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: t.textFaint,
              fontSize: 12,
            }}
          >
            <Button icon="plus" onClick={onAddView}>
              Add a view to start inspecting
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ViewerCard — title bar (name · source-mode · badges · ⋮) + canvas + footer.
// ---------------------------------------------------------------------------

const ViewerCard = ({
  view,
  recording,
  recordings,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onDuplicate,
  onCopySettingsTo,
  otherViews,
  localFrame,
  globalFrame,
  sourceOffsets,
  cellStyle,
}) => {
  const t = useTheme();
  const [imgState, setImgState] = useStatePb('idle'); // 'idle' | 'loading' | 'ok' | 'error'
  const [errStatus, setErrStatus] = useStatePb(null); // HTTP status on failure
  const [errDetail, setErrDetail] = useStatePb(null); // server-supplied detail message
  const [retryNonce, setRetryNonce] = useStatePb(0);
  const [menuOpen, setMenuOpen] = useStatePb(false); // M13: overflow ⋮ menu
  const [copyOpen, setCopyOpen] = useStatePb(false); // M13: copy-settings sub-popover
  // M30: right-click context menu — Send to USAF / FPN / DoF.
  const [ctxMenu, setCtxMenu] = useStatePb(null); // null | { x, y }
  const menuAnchorRef = useRefPb(null);
  const imgRef = useRefPb(null);
  // M11 reviewer P1: track the most recent blob URL so we can revoke it
  // synchronously when the next one is assigned, AND on unmount. The
  // earlier onload-based revoke leaked under fast scrubbing.
  const prevBlobRef = useRefPb(null);

  // Use the parent-computed local frame (handles locked views and global→
  // local mapping for multi-source streams).
  const effectiveFrame = view.isLocked && view.lockedFrame != null ? view.lockedFrame : localFrame;

  const url = useMemoPb(
    () => buildFrameUrl(recording, view, effectiveFrame),
    [recording, view, effectiveFrame]
  );

  // Single-flight: when the URL changes, kick off a fresh fetch and abort
  // the previous one via the cleanup. The browser's HTTP cache + the
  // backend's per-source LRU mean repeat frames are near-instant.
  useEffectPb(() => {
    if (!url) {
      setImgState('idle');
      return undefined;
    }
    // Cache hit: assign the existing blob URL synchronously, no fetch.
    // Keeps playback continuous when revisiting frames (loop, scrub-back).
    const cached = _frameCacheGet(url);
    if (cached) {
      if (imgRef.current && imgRef.current.src !== cached) {
        imgRef.current.src = cached;
      }
      setImgState('ok');
      setErrStatus(null);
      setErrDetail(null);
      return undefined;
    }
    // Cache miss — DON'T flip to 'loading' if we already have a frame
    // showing; just fetch in the background and swap the src on success.
    // This kills the black-flash-between-frames during playback.
    setImgState((prev) => (prev === 'ok' ? 'ok' : 'loading'));
    setErrStatus(null);
    setErrDetail(null);
    const ctrl = new AbortController();
    let alive = true;
    fetch(url, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const e = new Error(`${r.status}`);
          e.status = r.status;
          // Read the detail body so the overlay can show what actually failed.
          try {
            const txt = await r.text();
            try {
              const j = JSON.parse(txt);
              e.detail = j?.detail || j?.message || txt;
            } catch {
              e.detail = txt?.slice(0, 400) || null;
            }
          } catch {}
          throw e;
        }
        return r.blob();
      })
      .then((blob) => {
        if (!alive) return;
        const objUrl = URL.createObjectURL(blob);
        // Cache OWNS the blob URL now — don't revoke on swap; cache LRU
        // handles revocation for both this frame and the previously-shown
        // frame eventually. (prevBlobRef is no longer used; the
        // module-level cache is the single source of truth.)
        _frameCachePut(url, objUrl);
        if (imgRef.current) {
          imgRef.current.src = objUrl;
        }
        setImgState('ok');
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (!alive) return;
        setErrStatus(err.status || null);
        setErrDetail(err.detail || null);
        setImgState('error');
        // 404 = backend doesn't know this source_id (typically backend
        // restarted after the frontend cached the id). Tell the parent
        // so it can drop the stale recording and prompt re-load.
        if (err.status === 404 && recording && typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('mantis:play:source-not-found', {
              detail: { source_id: recording.source_id, name: recording.name },
            })
          );
        }
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [url, retryNonce, recording?.source_id]);

  // (Module-level frame cache owns blob-URL lifetimes now; ViewerCard
  // unmount no longer revokes anything — that would kill cache hits for
  // other cards bound to the same URL.)

  const borderColor = selected ? t.accent : view.isLocked ? t.warn : t.border;
  const titleBg = selected ? t.accentSoft : t.panel;
  const titleColor = selected ? t.accent : t.text;

  const recForDropdown = recording;
  const sourceModes = availableSourceModes(recForDropdown);
  const meta = sourceModeMeta(view.sourceMode);
  // Gain selector (HG / LG / HDR) lives outside the channel dropdown for
  // GSense-like recordings. The dropdown then only shows the channel
  // *kind* (Visible / NIR / Chroma / Raw splits) for the active gain.
  // Non-GSense sources (image-only, polarization, synthetic samples)
  // get an empty `gains` list and the title bar falls back to the flat
  // dropdown rendering.
  const gainsForRecording = availableGains(recForDropdown);
  const { gain: currentGain, channelKind: currentChannelKind } = splitSourceMode(view.sourceMode);
  const channelKindOptions = currentGain
    ? channelKindOptionsForGain(currentGain, recForDropdown)
    : [];
  const fallbackModes = sourceModes.filter(
    (m) => m.group === 'Overlay' || m.group === 'Image' || m.group === 'Other'
  );
  const badges = computeBadges(view, recForDropdown);
  const exposureLabel = recording?.per_frame_exposures_s?.[effectiveFrame]
    ? formatExposureSet([recording.per_frame_exposures_s[effectiveFrame]])
    : recording?.exposures_s?.[effectiveFrame]
      ? formatExposureSet([recording.exposures_s[effectiveFrame]])
      : '';

  return (
    <div
      data-viewer-card
      data-view-id={view.id}
      data-selected={selected ? 'true' : 'false'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: t.panel,
        border: `${selected ? 2 : 1}px solid ${borderColor}`,
        borderRadius: 6,
        overflow: 'hidden',
        minWidth: 0,
        minHeight: 0,
        cursor: selected ? 'default' : 'pointer',
        // M14 — ViewerGrid passes a grid placement object for the 3+1
        // preset (large view spans the right column; small views fill
        // a single row in the left column). Other presets pass nothing
        // and the default auto-flow placement applies.
        ...(cellStyle || {}),
      }}
      onClick={() => !selected && onSelect()}
      onContextMenu={(e) => {
        // M30 — right-click on the card opens "Send to USAF/FPN/DoF".
        // Only meaningful when the card is bound to a recording with a
        // valid frame; ignore otherwise so the browser's own menu shows.
        if (!recording) return;
        e.preventDefault();
        if (!selected) onSelect();
        setCtxMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Title bar */}
      <div
        style={{
          height: 30,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          background: titleBg,
          borderBottom: `1px solid ${t.border}`,
          minWidth: 0,
        }}
      >
        <Icon name="film" size={11} style={{ color: titleColor, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: titleColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flexShrink: 1,
            minWidth: 0,
          }}
          title={view.name}
        >
          {view.name}
        </span>
        {/* Gain selector + channel pickers live in the Inspector
            "Source" section. The title bar stays focused on the view
            name + processing badges + ⋮ menu. */}
        <div style={{ flex: 1, minWidth: 0 }} />
        {/* Processing badges */}
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
          {badges.map((b) => (
            <ProcessingBadge key={b.code} code={b.code} tone={b.tone} tip={b.tip} />
          ))}
        </div>
        {/* ⋮ overflow menu — M13 */}
        <button
          ref={menuAnchorRef}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((m) => !m);
            setCopyOpen(false);
          }}
          title="More actions"
          data-viewercard-menu-button
          aria-haspopup="menu"
          aria-expanded={menuOpen ? 'true' : 'false'}
          style={{
            background: menuOpen ? t.chipBg : 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textMuted,
            padding: '0 4px',
            fontSize: 14,
            lineHeight: 1,
            fontFamily: 'inherit',
          }}
        >
          ⋮
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Remove view"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textFaint,
            padding: 2,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Icon name="close" size={10} />
        </button>
      </div>
      {menuOpen && (
        <ViewerCardMenu
          view={view}
          globalFrame={globalFrame}
          localFrame={effectiveFrame}
          otherViews={otherViews}
          onClose={() => {
            setMenuOpen(false);
            setCopyOpen(false);
          }}
          copyOpen={copyOpen}
          onOpenCopy={() => setCopyOpen(true)}
          onCloseCopy={() => setCopyOpen(false)}
          onUpdate={onUpdate}
          onDuplicate={onDuplicate}
          onRemove={onRemove}
          onCopySettingsTo={onCopySettingsTo}
        />
      )}
      {ctxMenu && (
        <ViewerCardContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          recording={recording}
          frameIndex={effectiveFrame}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {/* Canvas area */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: t.canvasBg || '#0a0a0a',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {!recording && <div style={{ color: t.textFaint, fontSize: 11 }}>No recording bound</div>}
        {recording && !url && (
          <div style={{ color: t.textFaint, fontSize: 11 }}>
            {meta.kind === 'raw' && !view.rawChannel
              ? 'Pick a channel from the title bar'
              : 'No URL'}
          </div>
        )}
        {url && (
          <img
            ref={imgRef}
            alt={`${view.name} frame ${effectiveFrame}`}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              // Keep the image visible during the next-frame fetch —
              // the previous frame stays on-screen until the new one
              // arrives. No more black flash during playback.
              display: imgState === 'error' ? 'none' : 'block',
              imageRendering: 'pixelated',
              filter: view.showRaw
                ? 'none'
                : `brightness(${view.brightness}) contrast(${view.contrast}) saturate(${view.saturation})${view.invert ? ' invert(1)' : ''}`,
              transition: 'filter 0.1s linear',
            }}
          />
        )}
        {/* M20.1 — canvas-overlay histogram (bottom-right of the
            canvas). Off by default; toggled in Inspector Display. */}
        {url && view.showCanvasHistogram && (
          <CanvasHistogramOverlay
            recording={recording}
            view={view}
            localFrame={effectiveFrame}
            vmin={view.vmin}
            vmax={view.vmax}
          />
        )}
        {imgState === 'loading' && (
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              padding: '3px 7px',
              color: '#fff',
              fontSize: 10,
              fontFamily: 'ui-monospace,Menlo,monospace',
              background: 'rgba(0,0,0,0.55)',
              borderRadius: 3,
              pointerEvents: 'none',
            }}
            title={`Loading frame ${effectiveFrame}`}
          >
            ↺ frame {effectiveFrame}
          </div>
        )}
        {imgState === 'error' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: 16,
              textAlign: 'center',
              maxWidth: 360,
            }}
            data-frame-error
          >
            <Icon name="warning" size={18} style={{ color: t.danger }} />
            <div style={{ color: t.danger, fontSize: 12, fontWeight: 600 }}>
              Frame {effectiveFrame} failed to render
              {errStatus ? ` (HTTP ${errStatus})` : ''}
            </div>
            {errStatus === 404 && (
              <div style={{ color: t.textMuted, fontSize: 11, lineHeight: 1.5 }}>
                The backend doesn&apos;t know this recording any more — usually because the server
                was restarted after the file was loaded. Re-open the recording from disk to fix.
              </div>
            )}
            {errStatus === 410 && (
              <div style={{ color: t.textMuted, fontSize: 11, lineHeight: 1.5 }}>
                This recording was evicted from the server&apos;s cache. Re-open it from disk.
              </div>
            )}
            {errStatus !== 404 && errStatus !== 410 && (
              <div
                style={{
                  color: t.textMuted,
                  fontSize: 11,
                  lineHeight: 1.5,
                  maxWidth: 480,
                  wordBreak: 'break-word',
                  fontFamily: errDetail ? 'ui-monospace,Menlo,monospace' : 'inherit',
                }}
                title={errDetail || undefined}
              >
                {errDetail || 'Try again, or check the server log.'}
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRetryNonce((n) => n + 1);
              }}
              data-retry-frame
              style={{
                padding: '4px 12px',
                fontSize: 11,
                background: t.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
      {/* Footer strip — frame index / time / source */}
      <div
        style={{
          height: 22,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 8px',
          background: t.panel,
          borderTop: `1px solid ${t.border}`,
          fontSize: 10,
          fontFamily: 'ui-monospace,Menlo,monospace',
          color: t.textMuted,
          minWidth: 0,
        }}
      >
        <span style={{ color: t.text }}>frame {effectiveFrame}</span>
        {exposureLabel && (
          <>
            <span>·</span>
            <span>{exposureLabel}</span>
          </>
        )}
        {recording && (
          <>
            <span>·</span>
            <span
              style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              title={(() => {
                const rs = recording.raw_shape || recording.shape || [0, 0];
                const ps = recording.shape || [0, 0];
                const bd = recording.raw_bit_depth || 16;
                return (
                  `Raw: ${rs[1]} × ${rs[0]} (${bd}-bit)\n` + `Per-channel: ${ps[1]} × ${ps[0]}`
                );
              })()}
            >
              {recording.shape?.[1] ?? '?'}×{recording.shape?.[0] ?? '?'}
            </span>
            <span>·</span>
            <span
              style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                flex: 1,
              }}
              title={recording.name}
            >
              {recording.name}
            </span>
          </>
        )}
        {view.isLocked && <span style={{ color: t.warn, fontWeight: 600 }}>· LOCKED</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// ViewerCardContextMenu — right-click menu offering "Send to USAF / FPN /
// DoF". Posts /api/playback/handoff to materialise the current frame as a
// transient image source, then dispatches a window event so app.tsx
// switches the active mode + selected source. play-tab-recording-
// inspection-rescue-v1 M30.
// ---------------------------------------------------------------------------

const ViewerCardContextMenu = ({ x, y, recording, frameIndex, onClose }) => {
  const t = useTheme();
  const ref = useRefPb(null);
  // Click-outside / Esc closes the menu. Run in capture phase so a click
  // on a menu item runs its onClick before the close handler unmounts.
  useEffectPb(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDocClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  // Clamp the popover inside the viewport so right-clicking near a
  // window edge doesn't spill the menu off-screen.
  const w = 220;
  const h = 110;
  const left = Math.min(x, window.innerWidth - w - 8);
  const top = Math.min(y, window.innerHeight - h - 8);
  const send = async (target) => {
    if (!recording?.source_id) {
      onClose();
      return;
    }
    try {
      const transient = await apiFetch('/api/playback/handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: recording.source_id,
          frame_index: Number(frameIndex || 0),
          target_mode: target,
        }),
      });
      window.dispatchEvent(
        new CustomEvent('mantis:switch-source', {
          detail: { source_id: transient?.source_id, mode: target },
        })
      );
    } catch (err) {
      // Best-effort; the user sees no toast in this minimal wiring,
      // but app.tsx's existing /api/sources error handler will surface
      // any 4xx if the dispatched event ID can't be resolved.
      console.error('handoff failed', err);
    }
    onClose();
  };
  const targets = [
    { id: 'usaf', label: 'Send to USAF' },
    { id: 'fpn', label: 'Send to FPN' },
    { id: 'dof', label: 'Send to DoF' },
  ];
  return (
    <div
      ref={ref}
      data-viewer-card-context-menu
      style={{
        position: 'fixed',
        top,
        left,
        zIndex: 60,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
        padding: 4,
        width: w,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: t.textFaint,
          padding: '4px 8px 6px 8px',
        }}
      >
        Frame {frameIndex} · Send to mode
      </div>
      {targets.map((tg) => (
        <button
          key={tg.id}
          onClick={() => send(tg.id)}
          data-viewer-card-context-target={tg.id}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '6px 10px',
            border: 'none',
            background: 'transparent',
            color: t.text,
            fontSize: 12,
            cursor: 'pointer',
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = t.chipBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          {tg.label}
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ViewerCardMenu — overflow popover anchored to the title-bar ⋮ button.
// Actions: Rename · Duplicate · Lock to current frame · Include in export ·
// Copy settings to… (sub-popover) · Remove. play-tab-recording-inspection-
// rescue-v1 M13.
// ---------------------------------------------------------------------------

const ViewerCardMenu = ({
  view,
  globalFrame,
  localFrame,
  otherViews,
  onClose,
  copyOpen,
  onOpenCopy,
  onCloseCopy,
  onUpdate,
  onDuplicate,
  onRemove,
  onCopySettingsTo,
}) => {
  const t = useTheme();
  const popoverRef = useRefPb(null);

  // Click-outside / Escape to close. Bind once per mount.
  useEffectPb(() => {
    if (typeof window === 'undefined') return undefined;
    const onDocClick = (e) => {
      if (!popoverRef.current) return;
      if (popoverRef.current.contains(e.target)) return;
      // Don't close if the click landed on the ⋮ anchor (the anchor's
      // onClick already handles toggling).
      if (e.target.closest && e.target.closest('[data-viewercard-menu-button]')) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    // Defer one tick so the open click doesn't immediately close us.
    const id = setTimeout(() => {
      window.addEventListener('mousedown', onDocClick, true);
      window.addEventListener('keydown', onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', onDocClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const itemStyle = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    background: 'transparent',
    color: t.text,
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontSize: 11.5,
    fontFamily: 'inherit',
  };
  const itemHoverBg = (e) => {
    e.currentTarget.style.background = t.chipBg;
  };
  const itemUnhoverBg = (e) => {
    e.currentTarget.style.background = 'transparent';
  };

  const handleRename = () => {
    const next = window.prompt('Rename view:', view.name);
    if (next != null && next.trim() !== '' && next !== view.name) {
      onUpdate({ name: next.trim() });
    }
    onClose();
  };
  const handleLockToggle = () => {
    if (view.isLocked) {
      onUpdate({ isLocked: false, lockedFrame: null });
    } else {
      // Lock to the local frame currently shown by this view.
      onUpdate({ isLocked: true, lockedFrame: localFrame });
    }
    onClose();
  };
  const handleIncludeToggle = () => {
    onUpdate({ includedInExport: !view.includedInExport });
    onClose();
  };
  const handleDuplicate = () => {
    onDuplicate();
    onClose();
  };
  const handleRemove = () => {
    onRemove();
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      data-viewercard-menu
      role="menu"
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 32, // just below the 30 px title bar
        right: 6,
        minWidth: 220,
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        boxShadow: t.shadowLg || '0 8px 24px rgba(0,0,0,0.3)',
        padding: 4,
        zIndex: 50,
      }}
    >
      <button
        onClick={handleRename}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        style={itemStyle}
        data-menu-item="rename"
      >
        <Icon name="settings" size={11} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Rename…</span>
      </button>
      <button
        onClick={handleDuplicate}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        style={itemStyle}
        data-menu-item="duplicate"
      >
        <Icon name="layers" size={11} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Duplicate view</span>
      </button>
      <button
        onClick={handleLockToggle}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        style={itemStyle}
        data-menu-item="lock"
      >
        <Icon
          name={view.isLocked ? 'locked' : 'pin'}
          size={11}
          style={{ color: view.isLocked ? t.warn : t.textMuted, flexShrink: 0 }}
        />
        <span style={{ flex: 1 }}>
          {view.isLocked ? `Unlock (locked at frame ${view.lockedFrame})` : 'Lock to current frame'}
        </span>
      </button>
      <button
        onClick={handleIncludeToggle}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        style={itemStyle}
        data-menu-item="include"
      >
        <Icon
          name={view.includedInExport ? 'check' : 'close'}
          size={11}
          style={{
            color: view.includedInExport ? t.success : t.textMuted,
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1 }}>
          {view.includedInExport ? 'Excluded from export' : 'Include in export'}
        </span>
      </button>
      <div style={{ height: 1, background: t.border, margin: '4px 0' }} />
      <button
        onClick={() => onOpenCopy()}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        disabled={otherViews.length === 0}
        style={{ ...itemStyle, opacity: otherViews.length === 0 ? 0.5 : 1 }}
        data-menu-item="copy"
        title={
          otherViews.length === 0
            ? 'No other views to copy to'
            : `Copy display settings to ${otherViews.length} other view${otherViews.length === 1 ? '' : 's'}`
        }
      >
        <Icon name="export" size={11} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Copy settings to…</span>
        <span style={{ color: t.textFaint }}>›</span>
      </button>
      <div style={{ height: 1, background: t.border, margin: '4px 0' }} />
      <button
        onClick={handleRemove}
        onMouseEnter={itemHoverBg}
        onMouseLeave={itemUnhoverBg}
        style={{ ...itemStyle, color: t.danger }}
        data-menu-item="remove"
      >
        <Icon name="trash" size={11} style={{ color: t.danger, flexShrink: 0 }} />
        <span style={{ flex: 1 }}>Remove view</span>
      </button>
      {copyOpen && (
        <CopySettingsSubPopover
          otherViews={otherViews}
          onCancel={onCloseCopy}
          onCommit={(targetIds) => {
            onCopySettingsTo(targetIds);
            onCloseCopy();
            onClose();
          }}
        />
      )}
    </div>
  );
};

const CopySettingsSubPopover = ({ otherViews, onCancel, onCommit }) => {
  const t = useTheme();
  const [selected, setSelected] = useStatePb(() => new Set(otherViews.map((v) => v.id)));
  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div
      data-copy-settings-popover
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        top: 0,
        right: '100%',
        marginRight: 4,
        minWidth: 220,
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        boxShadow: t.shadowLg || '0 8px 24px rgba(0,0,0,0.3)',
        padding: 8,
        zIndex: 51,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          color: t.textMuted,
          marginBottom: 6,
        }}
      >
        Copy display settings to
      </div>
      {otherViews.length === 0 && (
        <div style={{ fontSize: 11, color: t.textFaint, padding: 8 }}>No other views.</div>
      )}
      {otherViews.map((v) => (
        <label
          key={v.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 6px',
            cursor: 'pointer',
            fontSize: 11.5,
            color: t.text,
            borderRadius: 3,
          }}
        >
          <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v.name}
          </span>
        </label>
      ))}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 8,
          paddingTop: 6,
          borderTop: `1px solid ${t.border}`,
          justifyContent: 'flex-end',
        }}
      >
        <Button size="sm" variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => onCommit(Array.from(selected))}
          disabled={selected.size === 0}
        >
          Copy to {selected.size}
        </Button>
      </div>
    </div>
  );
};

const PROCESSING_BADGE_TONES = {
  neutral: { bg: 'chipBg', fg: 'textMuted' },
  accent: { bg: 'accentSoft', fg: 'accent' },
  warn: { bg: 'warn', fg: '#fff' },
  success: { bg: 'success', fg: '#fff' },
};

const ProcessingBadge = ({ code, tone = 'neutral', tip }) => {
  const t = useTheme();
  const map = PROCESSING_BADGE_TONES[tone] || PROCESSING_BADGE_TONES.neutral;
  const bg = map.bg.startsWith('#') ? map.bg : t[map.bg];
  const fg = map.fg.startsWith('#') ? map.fg : t[map.fg];
  return (
    <span
      title={tip || code}
      data-processing-badge={code}
      style={{
        fontSize: 9,
        padding: '1px 5px',
        borderRadius: 3,
        background: bg,
        color: fg,
        fontFamily: 'ui-monospace,Menlo,monospace',
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {code}
    </span>
  );
};

// ---------------------------------------------------------------------------
// TimelineStrip — bottom-docked: mini-map + slider + playback controls.
// play-tab-recording-inspection-rescue-v1 M5
// ---------------------------------------------------------------------------

const FPS_PRESETS = [1, 5, 10, 15, 30, 60];
// Stable color seed for stream segments — same source always gets the same color.
const STREAM_COLORS = ['#5d8aa8', '#8aa05d', '#a8745d', '#5da890', '#a85d8a', '#8a5da8'];

const TimelineStrip = ({
  orderedRecordings,
  totalFrames,
  globalFrame,
  onSetFrame,
  playing,
  onTogglePlay,
  fps,
  onSetFps,
  loop,
  onToggleLoop,
  activeAtGlobal,
  lockedViews = [],
  sourceOffsets,
  rangeSelection = null,
  onSetRangeSelection,
}) => {
  const t = useTheme();
  // Mini-map segment widths normalized to total
  const segments = orderedRecordings.map((r, i) => ({
    sid: r.source_id,
    name: r.name,
    frames: r.frame_count || 1,
    color: STREAM_COLORS[i % STREAM_COLORS.length],
  }));
  const cumOffsets = (() => {
    const o = [];
    let cum = 0;
    for (const s of segments) {
      o.push(cum);
      cum += s.frames;
    }
    return o;
  })();

  const onFrameInput = (raw) => {
    const n = Math.max(0, Math.min(totalFrames - 1, Number(raw) || 0));
    onSetFrame(n);
  };

  const minimapPosition = totalFrames > 1 ? (globalFrame / (totalFrames - 1)) * 100 : 0;

  // M17 — range brush. Two amber drag handles + a shaded fill between
  // them, rendered only when `rangeSelection` is non-null. Drag uses
  // window-level mousemove/mouseup so the user can keep moving past
  // the mini-map's bounds without losing capture.
  const minimapRef = useRefPb(null);
  const startBrushDrag = useCallbackPb(
    (which) => (e) => {
      e.stopPropagation();
      e.preventDefault();
      const el = minimapRef.current;
      if (!el || totalFrames < 2) return;
      const rect = el.getBoundingClientRect();
      const lastFrame = totalFrames - 1;
      const compute = (clientX) => {
        const x = (clientX - rect.left) / rect.width;
        return Math.round(Math.max(0, Math.min(1, x)) * lastFrame);
      };
      const onMove = (ev) => {
        const f = compute(ev.clientX);
        onSetRangeSelection?.((cur) => {
          const cs = cur || [0, lastFrame];
          if (which === 'start') return [Math.min(f, cs[1]), cs[1]];
          return [cs[0], Math.max(f, cs[0])];
        });
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [onSetRangeSelection, totalFrames]
  );
  const brushActive = !!rangeSelection;
  const brushStart = rangeSelection ? rangeSelection[0] : 0;
  const brushEnd = rangeSelection ? rangeSelection[1] : Math.max(0, totalFrames - 1);
  const brushLeftPct = totalFrames > 1 ? (brushStart / (totalFrames - 1)) * 100 : 0;
  const brushRightPct = totalFrames > 1 ? (brushEnd / (totalFrames - 1)) * 100 : 100;

  return (
    <div
      data-timeline-strip
      style={{
        height: 120,
        flexShrink: 0,
        background: t.panel,
        borderTop: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        padding: '6px 12px',
        gap: 6,
      }}
    >
      {/* Mini-map row — proportional segments per source, current-frame caret. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="film" size={11} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 10,
            color: t.textMuted,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          Timeline
        </span>
        <div
          data-minimap
          ref={minimapRef}
          title="Mini-map · click to jump"
          style={{
            flex: 1,
            height: 16,
            position: 'relative',
            background: t.chipBg,
            borderRadius: 3,
            overflow: 'hidden',
            cursor: 'pointer',
            display: 'flex',
            border: `1px solid ${t.border}`,
          }}
          onClick={(e) => {
            // Ignore clicks that landed on a brush handle (handles
            // stop propagation but we double-check via dataset).
            if (e.target.dataset?.brushHandle) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const target = Math.round(x * (totalFrames - 1));
            onFrameInput(target);
          }}
        >
          {segments.map((s, i) => (
            <div
              key={s.sid}
              title={`${s.name} · ${s.frames} frame${s.frames === 1 ? '' : 's'}`}
              style={{
                width: `${(s.frames / totalFrames) * 100}%`,
                height: '100%',
                background: s.color,
                opacity: 0.55,
                borderRight: i < segments.length - 1 ? `1.5px solid ${t.bg}` : 'none',
                position: 'relative',
              }}
            />
          ))}
          {/* Locked-view amber carets — one per locked view (M13). Each
              caret maps the view's locked GLOBAL frame onto the mini-map.
              Tooltip shows the view name + frame. */}
          {lockedViews.map((v) => {
            const offset = sourceOffsets?.get(v.sourceId) ?? 0;
            const lockedGlobal = offset + (v.lockedFrame || 0);
            const left = totalFrames > 1 ? (lockedGlobal / (totalFrames - 1)) * 100 : 0;
            return (
              <div
                key={v.id}
                data-locked-caret={v.id}
                title={`${v.name} · locked at frame ${lockedGlobal}`}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  top: -2,
                  bottom: -2,
                  width: 3,
                  background: t.warn,
                  boxShadow: `0 0 0 1px ${t.bg}`,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
          {/* M17 — brush fill + handles when a range is active. Fill is
              a translucent amber rectangle between the two handles;
              handles are 6 px amber bars. Rendered above segments and
              locked carets but below the current-frame caret so the
              live playhead stays visible. */}
          {brushActive && (
            <>
              <div
                data-brush-fill
                style={{
                  position: 'absolute',
                  left: `${brushLeftPct}%`,
                  width: `${Math.max(0, brushRightPct - brushLeftPct)}%`,
                  top: 0,
                  bottom: 0,
                  background: `${t.warn}33`,
                  borderTop: `1px solid ${t.warn}`,
                  borderBottom: `1px solid ${t.warn}`,
                  pointerEvents: 'none',
                }}
              />
              <div
                data-brush-handle="start"
                title={`Range start · frame ${brushStart}`}
                onMouseDown={startBrushDrag('start')}
                style={{
                  position: 'absolute',
                  left: `calc(${brushLeftPct}% - 3px)`,
                  top: -3,
                  bottom: -3,
                  width: 6,
                  background: t.warn,
                  boxShadow: `0 0 0 1px ${t.bg}`,
                  cursor: 'ew-resize',
                  borderRadius: 2,
                  zIndex: 2,
                }}
              />
              <div
                data-brush-handle="end"
                title={`Range end · frame ${brushEnd}`}
                onMouseDown={startBrushDrag('end')}
                style={{
                  position: 'absolute',
                  left: `calc(${brushRightPct}% - 3px)`,
                  top: -3,
                  bottom: -3,
                  width: 6,
                  background: t.warn,
                  boxShadow: `0 0 0 1px ${t.bg}`,
                  cursor: 'ew-resize',
                  borderRadius: 2,
                  zIndex: 2,
                }}
              />
            </>
          )}
          {/* Current-frame caret (rendered above locked carets so the
              live position stays visible when overlapping). */}
          <div
            data-current-caret
            style={{
              position: 'absolute',
              left: `${minimapPosition}%`,
              top: -1,
              bottom: -1,
              width: 2,
              background: t.accent,
              boxShadow: `0 0 0 1px ${t.bg}`,
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />
        </div>
        <span
          style={{
            fontSize: 10,
            color: t.textFaint,
            fontFamily: 'ui-monospace,Menlo,monospace',
            flexShrink: 0,
          }}
        >
          {totalFrames} frames
        </span>
        {/* M17 — Range brush toggle. Click to create a brush at full
            extents (which the user can then drag in); click again or
            click the × to clear. When active, shows the selected frame
            count for at-a-glance feedback. */}
        <button
          data-range-brush-toggle
          data-range-active={brushActive ? 'true' : 'false'}
          onClick={() => {
            if (totalFrames < 2) return;
            if (brushActive) onSetRangeSelection?.(null);
            else onSetRangeSelection?.([0, totalFrames - 1]);
          }}
          title={
            brushActive
              ? `Brush range — frames ${brushStart}–${brushEnd} (${brushEnd - brushStart + 1}). Click to clear.`
              : 'Set an export range — drag the amber handles after enabling.'
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 6px',
            fontSize: 10,
            fontFamily: 'inherit',
            background: brushActive ? `${t.warn}22` : t.chipBg,
            color: brushActive ? t.warn : t.textMuted,
            border: `1px solid ${brushActive ? t.warn : t.chipBorder}`,
            borderRadius: 3,
            cursor: totalFrames < 2 ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            opacity: totalFrames < 2 ? 0.5 : 1,
          }}
          disabled={totalFrames < 2}
        >
          <Icon name={brushActive ? 'close' : 'plus'} size={9} />
          <span>{brushActive ? `Range ${brushStart}–${brushEnd}` : 'Range'}</span>
        </button>
      </div>

      {/* Slider row */}
      <input
        type="range"
        min={0}
        max={Math.max(0, totalFrames - 1)}
        value={Math.min(globalFrame, totalFrames - 1)}
        onChange={(e) => onFrameInput(e.target.value)}
        data-timeline-slider
        aria-label="Frame slider"
        style={{ width: '100%' }}
      />

      {/* Controls row — first / prev / play-pause / next / last + frame input + FPS + loop */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <ControlIconButton
          icon="skipPrev"
          title="First frame (Home)"
          onClick={() => onSetFrame(0)}
          disabled={globalFrame === 0}
        />
        <ControlIconButton
          icon="stepPrev"
          title="Previous frame (←)"
          onClick={() => onSetFrame(Math.max(0, globalFrame - 1))}
          disabled={globalFrame === 0}
        />
        <button
          onClick={onTogglePlay}
          data-play-toggle
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 26,
            background: playing ? t.warn : t.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={13} />
        </button>
        <ControlIconButton
          icon="stepNext"
          title="Next frame (→)"
          onClick={() => onSetFrame(Math.min(totalFrames - 1, globalFrame + 1))}
          disabled={globalFrame >= totalFrames - 1}
        />
        <ControlIconButton
          icon="skipNext"
          title="Last frame (End)"
          onClick={() => onSetFrame(totalFrames - 1)}
          disabled={globalFrame >= totalFrames - 1}
        />

        <span style={{ fontSize: 10, color: t.textMuted, marginLeft: 8 }}>frame</span>
        <input
          type="number"
          min={0}
          max={Math.max(0, totalFrames - 1)}
          value={globalFrame}
          onChange={(e) => onFrameInput(e.target.value)}
          data-frame-input
          style={{
            width: 64,
            padding: '3px 6px',
            fontSize: 11,
            fontFamily: 'ui-monospace,Menlo,monospace',
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 4,
            background: t.chipBg,
            color: t.text,
          }}
        />
        <span
          style={{ fontSize: 10, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          / {totalFrames - 1}
        </span>

        <div style={{ width: 1, height: 18, background: t.border, margin: '0 4px' }} />

        <span style={{ fontSize: 10, color: t.textMuted }}>FPS</span>
        <select
          value={fps}
          onChange={(e) => onSetFps(Number(e.target.value))}
          data-fps-select
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            background: t.chipBg,
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 4,
            padding: '2px 8px',
            fontSize: 11,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {FPS_PRESETS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <button
          onClick={onToggleLoop}
          data-loop-toggle
          title={
            loop ? 'Loop on (click to disable)' : 'Loop off — playback hard stops at last frame'
          }
          aria-pressed={loop ? 'true' : 'false'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 8px',
            background: loop ? t.accentSoft : t.chipBg,
            color: loop ? t.accent : t.textMuted,
            border: `1px solid ${loop ? t.accent : t.chipBorder}`,
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 10.5,
            fontFamily: 'inherit',
          }}
        >
          <Icon name="loop" size={11} />
          <span>Loop</span>
        </button>

        <div style={{ flex: 1, minWidth: 8 }} />
        {activeAtGlobal?.sourceId && (
          <span
            style={{
              fontSize: 10,
              color: t.textMuted,
              fontFamily: 'ui-monospace,Menlo,monospace',
              maxWidth: 280,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title="Active source for current global frame"
          >
            active:{' '}
            {orderedRecordings.find((r) => r.source_id === activeAtGlobal.sourceId)?.name || ''} (#
            {activeAtGlobal.local})
          </span>
        )}
      </div>
    </div>
  );
};

const ControlIconButton = ({ icon, title, onClick, disabled }) => {
  const t = useTheme();
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-control={icon}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        background: t.chipBg,
        color: disabled ? t.textFaint : t.text,
        border: `1px solid ${t.chipBorder}`,
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
};

// ---------------------------------------------------------------------------
// Export Video modal — pick format / range / FPS, then trigger download.
// play-tab-recording-inspection-rescue-v1 M10.
// ---------------------------------------------------------------------------

const VIDEO_FORMATS = [
  { id: 'mp4', label: 'MP4 (H.264)', description: 'Best compatibility · smallest file' },
  { id: 'gif', label: 'GIF', description: 'Loops in any browser · larger file' },
  { id: 'zip', label: 'PNG sequence (.zip)', description: 'Frame-by-frame, no compression' },
];

const ExportVideoModal = ({
  totalFrames,
  fps: defaultFps,
  onExport,
  onClose,
  rangeSelection = null,
  onClearRange,
  viewCount = 1,
}) => {
  const t = useTheme();
  const [format, setFormat] = useStatePb('mp4');
  // M17: when a brush is active, default to its bounds; otherwise default
  // to the full stream. Spinboxes below are locked when `rangeLocked` is
  // true, with a Clear button that maps to the parent's onClearRange.
  const rangeLocked = !!rangeSelection;
  const [start, setStart] = useStatePb(rangeSelection ? rangeSelection[0] : 0);
  const [end, setEnd] = useStatePb(
    rangeSelection ? rangeSelection[1] : Math.max(0, totalFrames - 1)
  );
  // Sync local Spinbox state with the parent brush whenever the user
  // drags handles while the modal is open.
  useEffectPb(() => {
    if (rangeSelection) {
      setStart(rangeSelection[0]);
      setEnd(rangeSelection[1]);
    }
  }, [rangeSelection?.[0], rangeSelection?.[1]]);
  const [outFps, setOutFps] = useStatePb(defaultFps || 10);
  const [busy, setBusy] = useStatePb(false);
  // M24: tiled video export — layout chooser visible when 2+ views.
  // Default 'auto' picks a sensible grid based on N.
  const tiledAvailable = viewCount > 1;
  const [layout, setLayout] = useStatePb('auto');

  const frameCount = Math.max(1, end - start + 1);
  const estDuration = frameCount / Math.max(0.1, outFps);

  return (
    <Modal onClose={onClose} width={520}>
      <div data-export-video-modal>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Icon name="film" size={16} style={{ color: t.accent }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Export video</div>
          <div style={{ flex: 1 }} />
          <Button icon="close" variant="subtle" size="sm" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 6,
              }}
            >
              Format
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {VIDEO_FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  data-format={f.id}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: format === f.id ? t.accentSoft : t.chipBg,
                    color: format === f.id ? t.accent : t.text,
                    border: `1px solid ${format === f.id ? t.accent : t.chipBorder}`,
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{f.label}</div>
                  <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 2 }}>
                    {f.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* M24 — layout chooser, only when 2+ views are exportable.
              Chosen layout drives the tiled-video composite; single-view
              skips this section and goes through the legacy
              /export/video URL path. */}
          {tiledAvailable && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.4,
                  textTransform: 'uppercase',
                  color: t.textMuted,
                  marginBottom: 6,
                }}
              >
                Layout ({viewCount} views)
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'auto', label: 'Auto' },
                  { id: '1xN', label: '1 × N' },
                  { id: '2xM', label: '2 × M' },
                  { id: '3plus1', label: '3 + 1' },
                  { id: '4x2', label: '4 × 2' },
                ].map((L) => (
                  <button
                    key={L.id}
                    onClick={() => setLayout(L.id)}
                    data-tiled-video-layout={L.id}
                    style={{
                      padding: '5px 10px',
                      fontSize: 11,
                      background: layout === L.id ? t.accentSoft : t.chipBg,
                      color: layout === L.id ? t.accent : t.text,
                      border: `1px solid ${layout === L.id ? t.accent : t.chipBorder}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {L.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Start frame">
              <Spinbox
                value={start}
                onChange={(v) => setStart(Math.max(0, Math.min(end, Number(v) || 0)))}
                min={0}
                max={end}
                step={1}
                data-start-frame
                disabled={rangeLocked}
              />
            </Row>
            <Row label="End frame">
              <Spinbox
                value={end}
                onChange={(v) => setEnd(Math.max(start, Math.min(totalFrames - 1, Number(v) || 0)))}
                min={start}
                max={totalFrames - 1}
                step={1}
                data-end-frame
                disabled={rangeLocked}
              />
            </Row>
          </div>
          {/* M17 — when a brush range is active, the start/end Spinboxes
              are locked (the brush is authoritative). This pill explains
              that and exposes a Clear button that drops back to full-
              stream defaults. */}
          {rangeLocked && (
            <div
              data-export-range-locked
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: t.warn,
                background: `${t.warn}11`,
                border: `1px solid ${t.warn}55`,
                borderRadius: 4,
                padding: '6px 10px',
              }}
            >
              <Icon name="info" size={11} />
              <span style={{ flex: 1 }}>
                Frames {start}–{end} ({frameCount} frames) from the timeline range brush. Drag the
                amber handles or clear to widen.
              </span>
              <button
                data-export-clear-range
                onClick={() => {
                  onClearRange?.();
                  setStart(0);
                  setEnd(Math.max(0, totalFrames - 1));
                }}
                style={{
                  background: 'transparent',
                  border: `1px solid ${t.warn}55`,
                  borderRadius: 3,
                  color: t.warn,
                  padding: '2px 8px',
                  fontSize: 10.5,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          )}

          <Row label="FPS">
            <Spinbox
              value={outFps}
              onChange={(v) => setOutFps(Math.max(0.1, Math.min(120, Number(v) || 10)))}
              min={0.1}
              max={120}
              step={1}
              data-out-fps
            />
          </Row>

          <Card style={{ padding: '10px 12px' }}>
            <KV k="Frames" v={frameCount} />
            <KV k="Estimated duration" v={`${estDuration.toFixed(1)} s`} />
            <KV k="Format" v={format.toUpperCase()} />
          </Card>

          <div
            style={{
              fontSize: 11,
              color: t.textFaint,
              padding: 8,
              background: t.chipBg,
              borderRadius: 4,
            }}
          >
            Exports the rendered view, not raw data. Processing settings (dark correction,
            thresholds, overlays) are baked in.
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="export"
              data-export-go
              disabled={busy || frameCount < 1 || totalFrames <= 0}
              onClick={async () => {
                setBusy(true);
                await onExport({
                  format,
                  start,
                  end,
                  fps: outFps,
                  // M24 — pass the layout + tiled flag so the parent
                  // exporter routes to the tiled endpoint when 2+ views.
                  layout,
                  tiled: tiledAvailable,
                });
                setBusy(false);
              }}
            >
              {busy ? 'Rendering…' : 'Export'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Export Image (tiled) modal — pick scope (all visible / selected /
// custom), layout, format. play-tab-recording-inspection-rescue-v1 M23.
// ---------------------------------------------------------------------------

const TILED_LAYOUTS = [
  { id: 'auto', label: 'Auto', description: 'Pick a sensible grid based on N' },
  { id: '1xN', label: '1 × N', description: 'Single row of every view' },
  { id: '2xM', label: '2 × M', description: 'Two columns × ⌈N/2⌉ rows' },
  { id: '3plus1', label: '3 + 1', description: 'Three small + one large (4 views)' },
  { id: '4x2', label: '4 × 2', description: 'Four columns × two rows (caps at 8)' },
];

const TILED_FORMATS = [
  { id: 'png', label: 'PNG', description: 'Lossless · best compatibility' },
  { id: 'tiff', label: 'TIFF', description: 'Lossless · larger file' },
  { id: 'jpeg', label: 'JPEG', description: 'Lossy · smallest file (q92)' },
];

const ExportImageModal = ({ views, selectedViewId, onExport, onClose }) => {
  const t = useTheme();
  const [layout, setLayout] = useStatePb('auto');
  const [format, setFormat] = useStatePb('png');
  const [scope, setScope] = useStatePb('visible'); // 'visible' | 'selected' | 'custom'
  const [customSet, setCustomSet] = useStatePb(() => new Set(views.map((v) => v.id)));
  const [gap, setGap] = useStatePb(6);
  const [background, setBackground] = useStatePb('#000000');
  const [busy, setBusy] = useStatePb(false);

  const visibleCount = views.filter((v) => v.includedInExport !== false).length;
  const customCount = customSet.size;
  const effectiveCount =
    scope === 'visible' ? visibleCount : scope === 'selected' ? 1 : customCount;

  return (
    <Modal onClose={onClose} width={560}>
      <div data-export-image-modal>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Icon name="image" size={16} style={{ color: t.accent }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Export image (tiled)</div>
          <div style={{ flex: 1 }} />
          <Button icon="close" variant="subtle" size="sm" onClick={onClose} disabled={busy}>
            Close
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Scope */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 6,
              }}
            >
              Views to export
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'visible', label: `All visible (${visibleCount})` },
                { id: 'selected', label: 'Selected only' },
                { id: 'custom', label: `Custom (${customCount})` },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => setScope(s.id)}
                  data-scope={s.id}
                  style={{
                    padding: '5px 10px',
                    background: scope === s.id ? t.accentSoft : t.chipBg,
                    color: scope === s.id ? t.accent : t.text,
                    border: `1px solid ${scope === s.id ? t.accent : t.chipBorder}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 11,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {scope === 'custom' && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  border: `1px solid ${t.border}`,
                  borderRadius: 4,
                  maxHeight: 140,
                  overflowY: 'auto',
                }}
              >
                {views.map((v) => {
                  const checked = customSet.has(v.id);
                  return (
                    <label
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '3px 0',
                        fontSize: 11,
                        color: t.text,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          setCustomSet((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(v.id);
                            else next.delete(v.id);
                            return next;
                          });
                        }}
                      />
                      <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{v.name}</span>
                      <span style={{ color: t.textFaint, fontSize: 10 }}>· {v.sourceMode}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Layout */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 6,
              }}
            >
              Layout
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
              {TILED_LAYOUTS.map((L) => (
                <button
                  key={L.id}
                  onClick={() => setLayout(L.id)}
                  data-layout={L.id}
                  style={{
                    padding: '8px 10px',
                    background: layout === L.id ? t.accentSoft : t.chipBg,
                    color: layout === L.id ? t.accent : t.text,
                    border: `1px solid ${layout === L.id ? t.accent : t.chipBorder}`,
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{L.label}</div>
                  <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>
                    {L.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 6,
              }}
            >
              Format
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {TILED_FORMATS.map((F) => (
                <button
                  key={F.id}
                  onClick={() => setFormat(F.id)}
                  data-tiled-format={F.id}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    background: format === F.id ? t.accentSoft : t.chipBg,
                    color: format === F.id ? t.accent : t.text,
                    border: `1px solid ${format === F.id ? t.accent : t.chipBorder}`,
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{F.label}</div>
                  <div style={{ fontSize: 10, color: t.textMuted, marginTop: 2 }}>
                    {F.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Gap + background */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Row label="Gap (px)">
              <Spinbox
                value={gap}
                onChange={(v) => setGap(Math.max(0, Math.min(64, Number(v) || 0)))}
                min={0}
                max={64}
                step={1}
              />
            </Row>
            <Row label="Background">
              <input
                type="text"
                value={background}
                onChange={(e) => setBackground(e.target.value || '#000000')}
                style={{
                  width: 90,
                  padding: '3px 6px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  border: `1px solid ${t.chipBorder}`,
                  borderRadius: 4,
                  background: t.panel,
                  color: t.text,
                }}
              />
            </Row>
          </div>

          <Card style={{ padding: '10px 12px' }}>
            <KV k="Effective views" v={effectiveCount} />
            <KV k="Layout" v={layout} />
            <KV k="Format" v={format.toUpperCase()} />
          </Card>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="subtle" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="export"
              data-tiled-export-go
              disabled={busy || effectiveCount < 1}
              onClick={async () => {
                setBusy(true);
                let s;
                if (scope === 'visible') s = 'visible';
                else if (scope === 'selected') s = 'selected';
                else s = Array.from(customSet);
                await onExport({
                  scope: s,
                  layout,
                  format,
                  gap,
                  background,
                });
                setBusy(false);
              }}
            >
              {busy ? 'Rendering…' : 'Export'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Warning Center modal — aggregates per-source / per-dark / continuity
// warnings into one inspectable list. play-tab-recording-inspection-
// rescue-v1 M11.
// ---------------------------------------------------------------------------

const WarningCenterModal = ({ warnings, onClose, onAction }) => {
  const t = useTheme();
  // M18: any per-row severity from the emit site overrides the template
  // default, but if a row arrives without `severity` (back-compat), the
  // canonical template value applies.
  const resolved = warnings.map((w) => {
    const tpl = WARNING_TEMPLATES[w.code] || null;
    return {
      ...w,
      severity: w.severity || tpl?.severity || 'warning',
      headline: tpl?.headline || null,
      action: tpl?.action || null,
    };
  });
  const grouped = {
    error: resolved.filter((w) => w.severity === 'error'),
    warning: resolved.filter((w) => w.severity === 'warning'),
    info: resolved.filter((w) => w.severity === 'info'),
  };
  const total = resolved.length;
  const sevColor = (s) => (s === 'error' ? t.danger : s === 'warning' ? t.warn : t.accent);
  const sevIcon = (s) => (s === 'error' ? 'close' : s === 'warning' ? 'warning' : 'info');
  return (
    <Modal onClose={onClose} width={560}>
      <div data-warning-center-modal>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Icon
            name="warning"
            size={16}
            style={{
              color: total > 0 ? (grouped.error.length > 0 ? t.danger : t.warn) : t.textFaint,
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Warnings</div>
          <span style={{ fontSize: 11, color: t.textMuted }}>
            {total} active · {grouped.error.length} error{grouped.error.length === 1 ? '' : 's'} ·{' '}
            {grouped.warning.length} warning{grouped.warning.length === 1 ? '' : 's'} ·{' '}
            {grouped.info.length} info
          </span>
          <div style={{ flex: 1 }} />
          <Button icon="close" variant="subtle" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {total === 0 && (
          <div style={{ fontSize: 12, color: t.textFaint, padding: '24px 0', textAlign: 'center' }}>
            No active warnings.
          </div>
        )}
        {['error', 'warning', 'info'].map(
          (sev) =>
            grouped[sev].length > 0 && (
              <div key={sev} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: sevColor(sev),
                    marginBottom: 8,
                  }}
                >
                  {sev}s ({grouped[sev].length})
                </div>
                {grouped[sev].map((w, i) => (
                  <div
                    key={`${sev}-${i}`}
                    data-warning-row={sev}
                    data-warning-code={w.code}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      background: `${sevColor(sev)}10`,
                      border: `1px solid ${sevColor(sev)}`,
                      borderRadius: 5,
                      marginBottom: 6,
                    }}
                  >
                    <Icon
                      name={sevIcon(sev)}
                      size={13}
                      style={{ color: sevColor(sev), flexShrink: 0, marginTop: 1 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* M18: canonical headline (template-supplied) +
                          detail (emit-site supplied). The headline is
                          what stays consistent between emit sites for
                          the same code; the detail carries per-event
                          specifics. */}
                      <div style={{ fontSize: 11, color: t.text, lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontFamily: 'ui-monospace,Menlo,monospace',
                            fontSize: 10.5,
                            color: t.textMuted,
                            marginRight: 6,
                          }}
                        >
                          {w.code}
                        </span>
                        {w.headline && (
                          <span style={{ fontWeight: 600, color: t.text }}>{w.headline}</span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: t.textMuted,
                          lineHeight: 1.5,
                          marginTop: 2,
                        }}
                      >
                        {w.detail}
                      </div>
                      {(w.source || w.file) && (
                        <div
                          style={{
                            fontSize: 10,
                            color: t.textFaint,
                            marginTop: 2,
                            fontFamily: 'ui-monospace,Menlo,monospace',
                          }}
                        >
                          {w.source && <>source: {w.source}</>}
                          {w.source && w.file && <> · </>}
                          {w.file && <>file: {w.file}</>}
                        </div>
                      )}
                      {w.action && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            data-warning-action={w.action.kind}
                            onClick={() => onAction?.(w.action.kind, w)}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${sevColor(sev)}55`,
                              borderRadius: 3,
                              color: sevColor(sev),
                              cursor: 'pointer',
                              padding: '2px 10px',
                              fontSize: 10.5,
                              fontFamily: 'inherit',
                            }}
                          >
                            {w.action.label}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Stream Builder modal — drag-reorder + continuity warnings + summary.
// play-tab-recording-inspection-rescue-v1 M6
// ---------------------------------------------------------------------------

const StreamBuilderModal = ({
  orderedRecordings,
  continuityThreshold,
  onChangeThreshold,
  onApply,
  onClose,
  onRemove,
}) => {
  const t = useTheme();
  // Local working copy — only commit on Apply.
  const [draft, setDraft] = useStatePb(orderedRecordings.map((r) => r.source_id));
  const [thresh, setThresh] = useStatePb(continuityThreshold);
  const [dragIdx, setDragIdx] = useStatePb(null);
  // M19: quarantined source ids — present in `orderedRecordings` (so the
  // user keeps them in Sources) but excluded from the active stream.
  // Authoritative for the Apply payload + the Summary card.
  const [quarantined, setQuarantined] = useStatePb(new Set());
  // M19: which row's per-row metadata block is expanded. One at a time.
  const [expandedSid, setExpandedSid] = useStatePb(null);

  const allDraftRecs = useMemoPb(
    () => draft.map((sid) => orderedRecordings.find((r) => r.source_id === sid)).filter(Boolean),
    [draft, orderedRecordings]
  );
  const draftRecs = useMemoPb(
    () => allDraftRecs.filter((r) => !quarantined.has(r.source_id)),
    [allDraftRecs, quarantined]
  );
  const quarantinedRecs = useMemoPb(
    () => allDraftRecs.filter((r) => quarantined.has(r.source_id)),
    [allDraftRecs, quarantined]
  );
  // M19: shape mismatch detection — any row whose shape differs from
  // the first surviving (non-quarantined) row gets a red border +
  // Quarantine button. The "first surviving" anchor matches the way
  // the rendering pipeline treats it: views bind to a shape-consistent
  // base and the rest of the stream is expected to match.
  const anchorShape = draftRecs[0]?.shape || null;
  const isShapeMismatched = (rec) =>
    anchorShape != null &&
    rec.shape != null &&
    (rec.shape[0] !== anchorShape[0] || rec.shape[1] !== anchorShape[1]);
  const warnings = useMemoPb(() => detectContinuity(draftRecs, thresh), [draftRecs, thresh]);
  const totalFrames = draftRecs.reduce((acc, r) => acc + (r.frame_count || 1), 0);
  const totalDuration = (() => {
    if (draftRecs.length < 2) return draftRecs[0]?.duration_s || 0;
    const first = draftRecs[0]?.timestamps?.[0];
    const last =
      draftRecs[draftRecs.length - 1]?.timestamps?.[
        draftRecs[draftRecs.length - 1]?.timestamps?.length - 1
      ];
    if (first == null || last == null)
      return draftRecs.reduce((acc, r) => acc + (r.duration_s || 0), 0);
    return Math.max(0, last - first);
  })();
  const errorCount = warnings.filter((w) => w.severity === 'error').length;
  const warnCount = warnings.length - errorCount;

  // M19: quarantine helpers — take/restore by source_id. Operate on a
  // fresh Set each call so React's setState diffing fires.
  const quarantineSid = (sid) =>
    setQuarantined((prev) => {
      const next = new Set(prev);
      next.add(sid);
      return next;
    });
  const restoreSid = (sid) =>
    setQuarantined((prev) => {
      const next = new Set(prev);
      next.delete(sid);
      return next;
    });

  const onDrop = (dropIdx) => {
    if (dragIdx == null || dragIdx === dropIdx) {
      setDragIdx(null);
      return;
    }
    const next = [...draft];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(dropIdx, 0, moved);
    setDraft(next);
    setDragIdx(null);
  };

  const transitionsBeforeRow = (idx) => warnings.filter((w) => w.between[1] === idx);

  return (
    <Modal onClose={onClose} width={760}>
      <div data-stream-builder-modal>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Icon name="layers" size={16} style={{ color: t.accent }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Stream Builder</div>
          <span
            style={{
              fontSize: 11,
              color: t.textMuted,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            {draftRecs.length} file{draftRecs.length === 1 ? '' : 's'} → 1 stream
          </span>
          <div style={{ flex: 1 }} />
          <Button icon="close" variant="subtle" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: 18 }}>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 8,
              }}
            >
              Files (drag to reorder)
            </div>
            {draftRecs.length === 0 && (
              <div style={{ fontSize: 11, color: t.textFaint, padding: 12 }}>
                No files in stream.
              </div>
            )}
            {draftRecs.map((rec, idx) => {
              const trans = transitionsBeforeRow(idx);
              const mismatched = isShapeMismatched(rec);
              const expanded = expandedSid === rec.source_id;
              const rowBorder = mismatched ? t.danger : t.border;
              return (
                <div key={rec.source_id}>
                  {idx > 0 && (
                    <div
                      style={{
                        marginLeft: 24,
                        marginBottom: 4,
                        marginTop: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      {trans.length === 0 ? (
                        <span
                          style={{
                            fontSize: 10,
                            color: t.success,
                            fontFamily: 'ui-monospace,Menlo,monospace',
                          }}
                        >
                          ● Continuous
                        </span>
                      ) : (
                        trans.map((w, wi) => (
                          <span
                            key={wi}
                            data-continuity-warning={w.type}
                            style={{
                              fontSize: 10,
                              color: w.severity === 'error' ? t.danger : t.warn,
                              fontFamily: 'ui-monospace,Menlo,monospace',
                            }}
                          >
                            {w.severity === 'error' ? '✖' : '⚠'} {w.detail}
                          </span>
                        ))
                      )}
                    </div>
                  )}
                  <div
                    draggable
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDrop(idx);
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    data-builder-row
                    data-row-index={idx}
                    data-shape-mismatched={mismatched ? 'true' : 'false'}
                    data-row-expanded={expanded ? 'true' : 'false'}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: dragIdx === idx ? t.accentSoft : t.panel,
                      border: `1px solid ${rowBorder}`,
                      borderRadius: 5,
                      cursor: 'grab',
                      marginBottom: 2,
                    }}
                  >
                    <Icon name="drag" size={11} style={{ color: t.textFaint, flexShrink: 0 }} />
                    {/* M19: chevron expander — clicking reveals raw metadata. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSid((cur) => (cur === rec.source_id ? null : rec.source_id));
                      }}
                      data-builder-row-expand
                      title={expanded ? 'Collapse metadata' : 'Expand metadata'}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: t.textMuted,
                        padding: 0,
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        name="chevron"
                        size={11}
                        style={{
                          transform: expanded ? 'rotate(180deg)' : 'none',
                          transition: 'transform .15s',
                        }}
                      />
                    </button>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        color: t.text,
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                      }}
                      title={rec.name}
                    >
                      {rec.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: mismatched ? t.danger : t.textMuted,
                        fontFamily: 'ui-monospace,Menlo,monospace',
                      }}
                    >
                      {rec.frame_count} fr · {formatExposureSet(rec.exposures_s)}
                    </span>
                    {/* M19: Quarantine button for shape-mismatched rows.
                        Moves the row out of the active stream into the
                        Quarantined section without removing it from
                        Sources. */}
                    {mismatched && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          quarantineSid(rec.source_id);
                          if (expandedSid === rec.source_id) setExpandedSid(null);
                        }}
                        data-builder-quarantine
                        data-source-id={rec.source_id}
                        title={`Quarantine — exclude from stream (shape ${rec.shape?.[1]}×${rec.shape?.[0]} ≠ stream ${anchorShape?.[1]}×${anchorShape?.[0]})`}
                        style={{
                          background: `${t.danger}11`,
                          border: `1px solid ${t.danger}55`,
                          borderRadius: 3,
                          color: t.danger,
                          cursor: 'pointer',
                          padding: '2px 8px',
                          fontSize: 10.5,
                          fontFamily: 'inherit',
                        }}
                      >
                        Quarantine
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setDraft((d) => d.filter((sid) => sid !== rec.source_id));
                        onRemove?.(rec.source_id);
                      }}
                      title="Remove from stream and from session"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: t.textFaint,
                        padding: 2,
                      }}
                    >
                      <Icon name="trash" size={11} />
                    </button>
                  </div>
                  {/* M19: per-row metadata expand. Shows raw frames/dims/
                      channels/exposure/timestamp/fps/file-size in a
                      monospace block. Stays inline (below the row) to
                      avoid a 3-column layout shift. */}
                  {expanded && (
                    <div
                      data-builder-row-metadata
                      data-source-id={rec.source_id}
                      style={{
                        marginTop: 2,
                        marginBottom: 6,
                        padding: '8px 12px 10px',
                        background: t.chipBg,
                        border: `1px solid ${t.border}`,
                        borderRadius: 5,
                        fontSize: 10.5,
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        color: t.textMuted,
                        lineHeight: 1.55,
                      }}
                    >
                      <KV k="Frames" v={rec.frame_count ?? '—'} />
                      <KV
                        k="Dimensions"
                        v={
                          rec.shape
                            ? `${rec.shape[1]}×${rec.shape[0]}${mismatched ? ' (mismatch)' : ''}`
                            : '—'
                        }
                      />
                      <KV k="Channels" v={rec.channels?.join(', ') || '—'} />
                      <KV k="Exposure" v={formatExposureSet(rec.exposures_s)} />
                      <KV
                        k="Timestamp range"
                        v={
                          rec.timestamps && rec.timestamps.length > 0
                            ? `${rec.timestamps[0].toFixed(2)}–${rec.timestamps[rec.timestamps.length - 1].toFixed(2)} s`
                            : '—'
                        }
                      />
                      <KV k="FPS (est)" v={rec.fps_estimate ? rec.fps_estimate.toFixed(2) : '—'} />
                      <KV
                        k="Size"
                        v={
                          rec.file_size != null
                            ? `${(rec.file_size / (1024 * 1024)).toFixed(1)} MB`
                            : '—'
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {/* M19: Quarantined files section — only visible when at
                least one source has been pulled out of the stream.
                Each row is a Restore button that returns the file to
                the active stream draft (re-validating on the next
                render so a still-mismatched row will get its
                Quarantine button back). */}
            {quarantinedRecs.length > 0 && (
              <div
                data-builder-quarantined-section
                style={{
                  marginTop: 14,
                  paddingTop: 10,
                  borderTop: `1px dashed ${t.danger}55`,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: t.danger,
                    marginBottom: 6,
                  }}
                >
                  Quarantined files ({quarantinedRecs.length})
                </div>
                {quarantinedRecs.map((rec) => (
                  <div
                    key={rec.source_id}
                    data-builder-quarantined-row
                    data-source-id={rec.source_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      background: `${t.danger}08`,
                      border: `1px dashed ${t.danger}55`,
                      borderRadius: 5,
                      marginBottom: 2,
                      opacity: 0.85,
                    }}
                  >
                    <Icon name="warning" size={11} style={{ color: t.danger, flexShrink: 0 }} />
                    <span
                      style={{
                        fontSize: 11.5,
                        fontFamily: 'ui-monospace,Menlo,monospace',
                        color: t.text,
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        minWidth: 0,
                      }}
                      title={rec.name}
                    >
                      {rec.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: t.textFaint,
                        fontFamily: 'ui-monospace,Menlo,monospace',
                      }}
                    >
                      {rec.shape ? `${rec.shape[1]}×${rec.shape[0]}` : '—'}
                    </span>
                    <button
                      onClick={() => restoreSid(rec.source_id)}
                      data-builder-restore
                      data-source-id={rec.source_id}
                      title="Restore to stream"
                      style={{
                        background: 'transparent',
                        border: `1px solid ${t.border}`,
                        borderRadius: 3,
                        color: t.text,
                        cursor: 'pointer',
                        padding: '2px 8px',
                        fontSize: 10.5,
                        fontFamily: 'inherit',
                      }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              style={{
                marginTop: 10,
                padding: '8px 10px',
                background: t.chipBg,
                borderRadius: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 10.5, color: t.textMuted }}>Continuity threshold</span>
              {/* M19: info-icon Tip — explains the merge-vs-flag rule. */}
              <Tip
                title={
                  'Gaps larger than this between adjacent recordings are flagged as W-GAP warnings. ' +
                  'Smaller gaps are silently merged into one stream. Same rule for overlaps (W-OVERLAP) — ' +
                  'increase the threshold to be more permissive, decrease it to flag tighter discontinuities.'
                }
              >
                <span
                  data-threshold-info-icon
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    background: t.chipBorder,
                    color: t.textMuted,
                    cursor: 'help',
                  }}
                >
                  <Icon name="info" size={9} />
                </span>
              </Tip>
              <input
                type="number"
                min={0}
                step={0.1}
                value={thresh}
                onChange={(e) => setThresh(Number(e.target.value) || 0)}
                data-continuity-threshold
                style={{
                  width: 70,
                  padding: '2px 6px',
                  fontSize: 11,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  border: `1px solid ${t.chipBorder}`,
                  borderRadius: 4,
                  background: t.panel,
                  color: t.text,
                }}
              />
              <span style={{ fontSize: 10.5, color: t.textFaint }}>
                seconds — gaps larger than this are flagged
              </span>
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: 8,
              }}
            >
              Summary
            </div>
            <Card style={{ padding: '10px 12px' }}>
              <KV k="Files" v={draftRecs.length} />
              <KV k="Total frames" v={totalFrames} />
              <KV k="Duration" v={formatDuration(totalDuration)} />
              <KV
                k="Warnings"
                v={
                  warnings.length === 0
                    ? '0'
                    : `${errorCount} error${errorCount === 1 ? '' : 's'}, ${warnCount} warning${warnCount === 1 ? '' : 's'}`
                }
              />
              {/* M19: quarantined count is part of Summary so the user
                  always sees how many sources are being kept out. */}
              {quarantinedRecs.length > 0 && (
                <KV k="Quarantined" v={`${quarantinedRecs.length} (excluded)`} />
              )}
            </Card>
            {warnings.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 4,
                  background: errorCount > 0 ? `${t.danger}10` : `${t.warn}10`,
                  border: `1px solid ${errorCount > 0 ? t.danger : t.warn}`,
                  fontSize: 10.5,
                  color: t.text,
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {errorCount > 0 ? '✖ Errors block apply' : '⚠ Warnings'}
                </div>
                <ul style={{ paddingLeft: 16, margin: 0 }}>
                  {warnings.map((w, i) => (
                    <li key={i}>{w.detail}</li>
                  ))}
                </ul>
              </div>
            )}
            <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
              <Button
                variant="primary"
                // M19: Apply payload now excludes quarantined sids so
                // PlaybackMode sees only the curated stream order. The
                // quarantined sources stay in `recordings`/`Sources` —
                // the user can still view them individually, just not
                // as part of this stream.
                onClick={() => onApply(draft.filter((sid) => !quarantined.has(sid)))}
                disabled={errorCount > 0}
                title={errorCount > 0 ? 'Resolve errors to apply' : 'Apply this order'}
              >
                Apply
              </Button>
              <Button variant="subtle" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const COLORMAPS = [
  'gray',
  'viridis',
  'inferno',
  'magma',
  'plasma',
  'cividis',
  'turbo',
  'jet',
  'hot',
  'cool',
];

// M20 — derive the histogram channel for a view. Histogram is most
// useful per-channel, so we pick the most representative channel for
// the selected source mode. Returns null when no useful single-channel
// view exists (caller renders a hint instead).
const histogramChannelFor = (view, recording) => {
  if (!view || !recording) return null;
  const meta = sourceModeMeta(view.sourceMode);
  if (meta.kind === 'channel') return meta.channel;
  if (meta.kind === 'raw') return view.rawChannel || null;
  if (meta.kind === 'overlay') {
    const ovChan = view.overlay?.overlayChannel || meta.overlayChannel || null;
    return ovChan && (recording.channels || []).includes(ovChan) ? ovChan : null;
  }
  // RGB modes — pick the green channel as a representative single-channel
  // sample. The histogram is still useful as a luminance proxy.
  if (meta.kind === 'rgb' || meta.kind === 'rgb_image') {
    const gain = (meta.gain || 'hg').toLowerCase();
    const candidate = gain === 'lg' ? 'LG-G' : 'HG-G';
    if ((recording.channels || []).includes(candidate)) return candidate;
    // image-RGB sources expose 'G'.
    if ((recording.channels || []).includes('G')) return 'G';
  }
  return null;
};

// Per-channel histogram support for RGB views. Returns an ordered list
// of `{channel, color}` entries so the renderer can overlay one trace
// per primary. Single-channel views get a length-1 list with a neutral
// color; RGB / RGB-image / RGB-HDR views get R/G/B in red/green/blue.
const histogramTracesFor = (view, recording) => {
  if (!view || !recording) return [];
  const meta = sourceModeMeta(view.sourceMode);
  const chs = recording.channels || [];
  const has = (k) => chs.includes(k);
  if (meta.kind === 'rgb' || meta.kind === 'rgb_image') {
    const gain = (meta.gain || 'hg').toLowerCase();
    const prefix = gain === 'lg' ? 'LG-' : gain === 'hdr' ? 'HDR-' : has('HG-R') ? 'HG-' : '';
    const triples = [
      { channel: `${prefix}R`, color: '#e0413c' },
      { channel: `${prefix}G`, color: '#43a047' },
      { channel: `${prefix}B`, color: '#3878d6' },
    ];
    if (triples.every((tr) => has(tr.channel))) return triples;
    // image-RGB sources expose plain "R"/"G"/"B".
    const plain = [
      { channel: 'R', color: '#e0413c' },
      { channel: 'G', color: '#43a047' },
      { channel: 'B', color: '#3878d6' },
    ];
    if (plain.every((tr) => has(tr.channel))) return plain;
    // Fall through to single-channel fallback.
  }
  const single = histogramChannelFor(view, recording);
  if (single) return [{ channel: single, color: '#9aa3ad' }];
  return [];
};

// Shared fetch helper: pull one or more channel histograms in parallel
// for a given recording + frame. Each trace returns ``{channel, color,
// hist}``; failed individual fetches are silently dropped.
const useChannelHistograms = (recording, traces, localFrame) => {
  const [data, setData] = useStatePb([]);
  // Memoize the trace key so the effect's dep array uses a stable
  // primitive; otherwise the inline array recreates each render.
  const tracesKey = (traces || []).map((tr) => tr.channel).join('|');
  useEffectPb(() => {
    if (!recording || !traces || traces.length === 0 || localFrame == null) {
      setData([]);
      return undefined;
    }
    let alive = true;
    Promise.all(
      traces.map((tr) =>
        apiFetch(
          `/api/sources/${recording.source_id}/frame/${localFrame}/channel/${encodeURIComponent(tr.channel)}/histogram?bins=64`
        )
          .then((d) => ({ channel: tr.channel, color: tr.color, hist: d }))
          .catch(() => null)
      )
    ).then((rows) => {
      if (alive) setData(rows.filter(Boolean));
    });
    return () => {
      alive = false;
    };
  }, [recording?.source_id, tracesKey, localFrame]);
  return data;
};

// Build an SVG <polyline> path for a histogram trace at the given W/H.
// Returns the `points` string + the per-trace bin-edge mapping so all
// markers (p1 / p99 / vmin / vmax) line up to the FIRST trace's
// edge-range (single source of truth for the x-axis when multiple
// channels share an axis).
const _polylinePoints = (counts, peak, W, H) => {
  if (!counts || counts.length === 0) return '';
  const bw = W / counts.length;
  return counts
    .map((c, i) => {
      const x = (i + 0.5) * bw;
      const y = H - (c / peak) * (H - 4);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
};

// M20.1 — CanvasHistogramOverlay: a compact, semi-transparent histogram
// chart anchored bottom-right of the ViewerCard canvas. For RGB views,
// renders three colored line traces (R/G/B) overlaid; for single-channel
// views, renders a single trace in neutral grey. Toggled by
// `view.showCanvasHistogram`.
const CanvasHistogramOverlay = ({ recording, view, localFrame, vmin, vmax }) => {
  const t = useTheme();
  const traces = histogramTracesFor(view, recording);
  const histRows = useChannelHistograms(recording, traces, localFrame);
  if (!recording || histRows.length === 0) return null;
  const W = 200;
  const H = 60;
  // x-axis range: span the union across all traces so each polyline is
  // plotted on the same scale.
  let min = Infinity;
  let max = -Infinity;
  let peak = 0;
  for (const row of histRows) {
    const h = row.hist || {};
    if (h.min != null && h.min < min) min = h.min;
    if (h.max != null && h.max > max) max = h.max;
    const localPeak = Math.max(1, ...(h.counts || []));
    if (localPeak > peak) peak = localPeak;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const range = max > min ? max - min : 1;
  const xForVal = (v) => ((v - min) / range) * W;
  const vMinMark = vmin != null ? Math.max(0, Math.min(W, xForVal(vmin))) : null;
  const vMaxMark = vmax != null ? Math.max(0, Math.min(W, xForVal(vmax))) : null;
  const isMulti = histRows.length > 1;
  return (
    <div
      data-canvas-histogram-overlay
      style={{
        position: 'absolute',
        bottom: 8,
        right: 8,
        background: 'rgba(0, 0, 0, 0.62)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        borderRadius: 4,
        padding: '4px 6px 5px',
        pointerEvents: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        border: `1px solid rgba(255,255,255,0.08)`,
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
        {/* Single-channel: filled bars in neutral grey for readability.
            Multi-channel (RGB): line traces in red/green/blue with a
            screen blend so overlap stays visible. */}
        {!isMulti &&
          (histRows[0]?.hist?.counts || []).map((c, i) => {
            const bw = W / (histRows[0].hist.counts.length || 1);
            const bh = (c / peak) * (H - 4);
            return (
              <rect
                key={i}
                x={i * bw}
                y={H - bh}
                width={Math.max(0.5, bw - 0.5)}
                height={bh}
                fill="#bcd"
                opacity={0.88}
              />
            );
          })}
        {isMulti &&
          histRows.map((row) => (
            <polyline
              key={row.channel}
              data-rgb-trace={row.channel}
              points={_polylinePoints(row.hist?.counts || [], peak, W, H)}
              fill="none"
              stroke={row.color}
              strokeWidth={1.4}
              strokeOpacity={0.92}
              style={{ mixBlendMode: 'screen' }}
            />
          ))}
        {/* p1 / p99 hairlines — anchored to the first trace's bounds. */}
        {histRows[0]?.hist?.p1 != null && (
          <line
            x1={xForVal(histRows[0].hist.p1)}
            x2={xForVal(histRows[0].hist.p1)}
            y1={0}
            y2={H}
            stroke="#fff"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        )}
        {histRows[0]?.hist?.p99 != null && (
          <line
            x1={xForVal(histRows[0].hist.p99)}
            x2={xForVal(histRows[0].hist.p99)}
            y1={0}
            y2={H}
            stroke="#fff"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        )}
        {vMinMark != null && (
          <line x1={vMinMark} x2={vMinMark} y1={0} y2={H} stroke={t.warn} strokeWidth={1.5} />
        )}
        {vMaxMark != null && (
          <line x1={vMaxMark} x2={vMaxMark} y1={0} y2={H} stroke={t.warn} strokeWidth={1.5} />
        )}
      </svg>
      <div
        style={{
          fontSize: 9,
          color: 'rgba(255,255,255,0.78)',
          fontFamily: 'ui-monospace,Menlo,monospace',
          marginTop: 1,
          textAlign: 'right',
        }}
      >
        {histRows.map((row) => row.channel).join(' / ')} · f{localFrame} · {Math.round(min)}–
        {Math.round(max)}
      </div>
    </div>
  );
};

// M20 — HistogramPanel: per-channel 64-bin histogram(s) fetched from the
// backend with vmin/vmax markers overlaid. RGB views render three
// overlaid line traces (R/G/B in red/green/blue); single-channel views
// render filled bars in neutral grey. Re-fetches on (sourceId, traces,
// localFrame) change.
const HistogramPanel = ({ recording, view, localFrame, vmin, vmax }) => {
  const t = useTheme();
  const traces = histogramTracesFor(view, recording);
  const histRows = useChannelHistograms(recording, traces, localFrame);
  if (!recording || !view) return null;
  if (traces.length === 0) {
    return (
      <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 0' }}>
        Histogram available for single-channel + RGB views.
      </div>
    );
  }
  if (histRows.length === 0) {
    return (
      <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 0' }}>Loading histogram…</div>
    );
  }
  const W = 220;
  const H = 56;
  let min = Infinity;
  let max = -Infinity;
  let peak = 0;
  for (const row of histRows) {
    const h = row.hist || {};
    if (h.min != null && h.min < min) min = h.min;
    if (h.max != null && h.max > max) max = h.max;
    const localPeak = Math.max(1, ...(h.counts || []));
    if (localPeak > peak) peak = localPeak;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const range = max > min ? max - min : 1;
  const xForVal = (v) => ((v - min) / range) * W;
  const vMinMark = vmin != null ? Math.max(0, Math.min(W, xForVal(vmin))) : null;
  const vMaxMark = vmax != null ? Math.max(0, Math.min(W, xForVal(vmax))) : null;
  const isMulti = histRows.length > 1;
  const firstHist = histRows[0]?.hist || {};
  return (
    <div data-inspector-histogram style={{ padding: '4px 0' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        style={{ display: 'block', background: t.chipBg, borderRadius: 3 }}
      >
        {!isMulti &&
          (firstHist.counts || []).map((c, i) => {
            const bw = W / firstHist.counts.length;
            const bh = (c / peak) * (H - 4);
            return (
              <rect
                key={i}
                x={i * bw}
                y={H - bh}
                width={Math.max(0.5, bw - 0.5)}
                height={bh}
                fill={t.textMuted}
                opacity={0.55}
              />
            );
          })}
        {isMulti &&
          histRows.map((row) => (
            <polyline
              key={row.channel}
              data-rgb-trace={row.channel}
              points={_polylinePoints(row.hist?.counts || [], peak, W, H)}
              fill="none"
              stroke={row.color}
              strokeWidth={1.4}
              strokeOpacity={0.92}
              style={{ mixBlendMode: 'multiply' }}
            />
          ))}
        {firstHist.p1 != null && (
          <line
            x1={xForVal(firstHist.p1)}
            x2={xForVal(firstHist.p1)}
            y1={0}
            y2={H}
            stroke={t.textFaint}
            strokeDasharray="2 2"
            strokeWidth={1}
            data-histogram-p1
          />
        )}
        {firstHist.p99 != null && (
          <line
            x1={xForVal(firstHist.p99)}
            x2={xForVal(firstHist.p99)}
            y1={0}
            y2={H}
            stroke={t.textFaint}
            strokeDasharray="2 2"
            strokeWidth={1}
            data-histogram-p99
          />
        )}
        {vMinMark != null && (
          <line
            x1={vMinMark}
            x2={vMinMark}
            y1={0}
            y2={H}
            stroke={t.warn}
            strokeWidth={1.5}
            data-histogram-vmin
          />
        )}
        {vMaxMark != null && (
          <line
            x1={vMaxMark}
            x2={vMaxMark}
            y1={0}
            y2={H}
            stroke={t.warn}
            strokeWidth={1.5}
            data-histogram-vmax
          />
        )}
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 2,
          fontSize: 9.5,
          color: t.textFaint,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        <span>{Math.round(min)}</span>
        <span>
          p1 {Math.round(firstHist.p1 ?? 0)} · p99 {Math.round(firstHist.p99 ?? 0)}
        </span>
        <span>{Math.round(max)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 2,
          fontSize: 10,
          color: t.textFaint,
        }}
      >
        {isMulti ? (
          histRows.map((row) => (
            <span
              key={row.channel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'ui-monospace,Menlo,monospace',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 9,
                  height: 2.5,
                  background: row.color,
                  borderRadius: 1,
                }}
              />
              {row.channel}
            </span>
          ))
        ) : (
          <span>
            ch{' '}
            <span style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>
              {histRows[0]?.channel}
            </span>
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>frame {localFrame}</span>
      </div>
    </div>
  );
};

const Inspector = ({
  onSetGain,
  width,
  collapsed,
  onToggleCollapse,
  selectedView,
  selectedRecording,
  onUpdateView,
  fps,
  totalFrames,
  globalFrame,
  sourceOffsets,
  // M28 — presets
  presets = [],
  onOpenSavePreset,
  onDeletePreset,
  // M29 — overlay builder
  onOpenOverlayBuilder,
}) => {
  const t = useTheme();
  if (collapsed) {
    return (
      <div
        style={{
          width: 44,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 0',
          gap: 8,
          background: t.panel,
          borderLeft: `1px solid ${t.border}`,
        }}
      >
        <button
          onClick={onToggleCollapse}
          title="Expand inspector"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textMuted,
            padding: 6,
          }}
        >
          <Icon name="sliders" size={16} />
        </button>
      </div>
    );
  }
  return (
    <div
      data-inspector
      style={{
        width,
        flexShrink: 0,
        background: t.panel,
        borderLeft: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 30,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <Icon name="sliders" size={12} style={{ color: t.textMuted }} />
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: t.textMuted,
          }}
        >
          Inspector
        </div>
        {selectedView && (
          <span
            style={{
              fontSize: 10,
              color: t.accent,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            · {selectedView.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onToggleCollapse}
          title="Collapse panel"
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: t.textFaint,
            padding: 2,
          }}
        >
          <Icon name="chevron" size={11} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {!selectedView && (
          <div style={{ padding: 20, textAlign: 'center', color: t.textFaint, fontSize: 11.5 }}>
            No selection. Pick a view.
          </div>
        )}
        {selectedView && (
          <>
            <InspectorSection
              title="View"
              icon="eye"
              defaultOpen={true}
              viewType={selectedView.sourceMode}
            >
              <Row label="Name">
                <input
                  type="text"
                  value={selectedView.name}
                  onChange={(e) => onUpdateView(selectedView.id, { name: e.target.value })}
                  data-inspector-name
                  style={{
                    width: '100%',
                    padding: '3px 6px',
                    fontSize: 11,
                    border: `1px solid ${t.chipBorder}`,
                    background: t.chipBg,
                    color: t.text,
                    borderRadius: 4,
                  }}
                />
              </Row>
              <Row label="Type">
                <span style={{ fontSize: 11, color: t.text }}>
                  {sourceModeMeta(selectedView.sourceMode).label}
                </span>
              </Row>
              <Row label="Lock to current frame">
                <Checkbox
                  checked={!!selectedView.isLocked}
                  onChange={(v) =>
                    onUpdateView(selectedView.id, {
                      isLocked: v,
                      lockedFrame: v ? (selectedView.lockedFrame ?? null) : null,
                    })
                  }
                  data-inspector-lock
                />
              </Row>
              <Row label="Include in export">
                <Checkbox
                  checked={!!selectedView.includedInExport}
                  onChange={(v) => onUpdateView(selectedView.id, { includedInExport: v })}
                />
              </Row>
            </InspectorSection>

            <InspectorSection title="Source" icon="layers" viewType={selectedView.sourceMode}>
              <SourceSectionBody
                view={selectedView}
                recording={selectedRecording}
                onUpdateView={onUpdateView}
                onSetGain={onSetGain}
              />
            </InspectorSection>

            <InspectorSection
              title="Corrections"
              icon="settings"
              viewType={selectedView.sourceMode}
            >
              <Row label="Apply dark correction">
                {/* M22 hotfix: visually clamp checked-state to has_dark
                    so the user doesn't see "checked" when no dark is
                    attached. The view-state `applyDark` default is
                    `true` so the instant a dark is attached, correction
                    kicks in — but until then the checkbox shows OFF. */}
                <Checkbox
                  checked={!!selectedView.applyDark && !!selectedRecording?.has_dark}
                  onChange={(v) => onUpdateView(selectedView.id, { applyDark: v })}
                  disabled={!selectedRecording?.has_dark}
                  data-inspector-dark
                />
              </Row>
              {!selectedRecording?.has_dark && (
                <div style={{ fontSize: 10, color: t.textFaint, padding: '2px 0' }}>
                  No dark frame loaded — load one in the Sources panel to enable.
                </div>
              )}
              {/* M20.1 — full ISP pipeline (HG vs LG fix). Pipeline:
                    out_raw = clip(raw - black_level, 0, ∞) * gain + offset
                    out_norm = normalize(out_raw, mode=normalize, vmin/vmax)
                    out = gamma(brightness + contrast*(out_norm - 0.5) + 0.5)
                  Defaults are no-op so existing renders stay identical
                  until the user moves a slider.

                  `Normalize = none` is the key fix for the user's
                  reported HG vs LG issue: it scales against the data
                  type's full positive range, so HG (bright) appears
                  bright and LG (dim) appears dim — instead of the
                  auto-percentile boost that made them look identical.
              */}
              <Row label="Normalize">
                <Select
                  value={selectedView.normalize || 'auto'}
                  onChange={(v) => onUpdateView(selectedView.id, { normalize: v })}
                  options={[
                    { value: 'auto', label: 'Auto (1st / 99.5th percentile)' },
                    { value: 'manual', label: 'Manual (vmin / vmax)' },
                    { value: 'none', label: 'None (true HG vs LG levels)' },
                  ]}
                  data-inspector-normalize
                />
              </Row>
              <Row label="Black level">
                <Spinbox
                  value={selectedView.blackLevel ?? 0}
                  onChange={(v) => onUpdateView(selectedView.id, { blackLevel: Number(v) })}
                  min={0}
                  max={65535}
                  step={10}
                  data-inspector-black-level
                />
              </Row>
              <Row label="Gain">
                <Spinbox
                  value={selectedView.gain ?? 1.0}
                  onChange={(v) => onUpdateView(selectedView.id, { gain: Number(v) })}
                  min={0}
                  max={64}
                  step={0.1}
                  data-inspector-gain
                />
              </Row>
              <Row label="Offset">
                <Spinbox
                  value={selectedView.offset ?? 0}
                  onChange={(v) => onUpdateView(selectedView.id, { offset: Number(v) })}
                  min={-65535}
                  max={65535}
                  step={10}
                  data-inspector-offset
                />
              </Row>
              {/* M22 hotfix — Brightness / Contrast / Gamma moved
                  exclusively to the RGB Grading section (where they
                  apply to per-channel R/G/B grading). The earlier
                  copies here were duplicates and never visibly
                  changed RGB renders (the post-norm channel-route
                  curve was the right place for them on grayscale,
                  not RGB). For non-RGB views the per-channel
                  channel-route still honors brightness/contrast/
                  gamma via URL params; the UI for those will be
                  surfaced in a future "Tone" section if needed. */}
              <Row label="Reset">
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() =>
                    onUpdateView(selectedView.id, {
                      normalize: 'none',
                      blackLevel: 0,
                      gain: 1.0,
                      offset: 0,
                    })
                  }
                  title="Reset Corrections (linear pre-norm chain) to defaults"
                >
                  Defaults
                </Button>
              </Row>
              {/* M26 — non-linear sharpen / FPN ISP chain. Collapsed
                  by default to keep Corrections readable; opens to the
                  same controls USAF/FPN expose in their left panels.
                  Applied server-side after dark-subtract and before
                  the linear pre-norm chain. */}
              <IspChainDisclosure
                viewType={selectedView.sourceMode}
                isp={selectedView.isp}
                onChange={(patch) =>
                  onUpdateView(selectedView.id, {
                    isp: { ...selectedView.isp, ...patch },
                  })
                }
                onReset={() =>
                  onUpdateView(selectedView.id, {
                    isp: {
                      sharpen_method: 'None',
                      sharpen_amount: 1.0,
                      sharpen_radius: 2.0,
                      denoise_sigma: 0.0,
                      median_size: 0,
                      gaussian_sigma: 0.0,
                      hot_pixel_thr: 0.0,
                      bilateral: false,
                    },
                  })
                }
              />
            </InspectorSection>

            <InspectorSection
              title="Display"
              icon="sliders"
              defaultOpen={true}
              viewType={selectedView.sourceMode}
            >
              {/* M22 — Display section is conditional on view kind:
                  RGB views hide Colormap / Invert / vmin / vmax (none
                  of which apply meaningfully to a per-channel RGB
                  composite — those go through the RGB Grading section
                  via gain_r/g/b instead). Show clipped pixels +
                  Histogram on frame stay on every view. The histogram
                  itself is always informative. */}
              {(() => {
                const meta = sourceModeMeta(selectedView.sourceMode);
                const isRgb = meta.kind === 'rgb' || meta.kind === 'rgb_image';
                if (isRgb) {
                  return (
                    <>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: t.textMuted,
                          padding: '2px 0 4px',
                          lineHeight: 1.5,
                        }}
                      >
                        For per-channel range, gain, and color tuning, see the{' '}
                        <strong>RGB grading</strong> section. The Display section here only carries
                        view-wide toggles.
                      </div>
                      <Row label="Show clipped pixels">
                        <Checkbox
                          checked={!!selectedView.showClipping}
                          onChange={(v) => onUpdateView(selectedView.id, { showClipping: v })}
                          data-inspector-show-clipping
                        />
                      </Row>
                      <Row label="Histogram on frame">
                        <Checkbox
                          checked={!!selectedView.showCanvasHistogram}
                          onChange={(v) =>
                            onUpdateView(selectedView.id, { showCanvasHistogram: v })
                          }
                          data-inspector-canvas-histogram
                        />
                      </Row>
                      <HistogramPanel
                        recording={selectedRecording}
                        view={selectedView}
                        localFrame={(() => {
                          if (!selectedView || !selectedRecording) return 0;
                          if (selectedView.isLocked && selectedView.lockedFrame != null) {
                            return selectedView.lockedFrame;
                          }
                          const off = sourceOffsets?.get(selectedView.sourceId) ?? 0;
                          const local = (globalFrame ?? 0) - off;
                          return Math.max(
                            0,
                            Math.min(local, (selectedRecording.frame_count || 1) - 1)
                          );
                        })()}
                        vmin={selectedView.vmin}
                        vmax={selectedView.vmax}
                      />
                    </>
                  );
                }
                // channel / raw / overlay views — full Display surface.
                return (
                  <>
                    <Row label="Low threshold">
                      <Spinbox
                        value={selectedView.vmin ?? 0}
                        onChange={(v) => onUpdateView(selectedView.id, { vmin: Number(v) })}
                        min={0}
                        max={65535}
                        step={1}
                        data-inspector-vmin
                      />
                    </Row>
                    <Row label="High threshold">
                      <Spinbox
                        value={selectedView.vmax ?? 65535}
                        onChange={(v) => onUpdateView(selectedView.id, { vmax: Number(v) })}
                        min={0}
                        max={65535}
                        step={1}
                        data-inspector-vmax
                      />
                    </Row>
                    <Row label="Auto thresholds">
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => onUpdateView(selectedView.id, { vmin: null, vmax: null })}
                        title="Clear vmin/vmax — fall back to mode default (dtype-max for none, percentile for auto)"
                      >
                        Reset
                      </Button>
                    </Row>
                    <Row label="Colormap">
                      <Select
                        value={selectedView.colormap || 'gray'}
                        onChange={(v) => onUpdateView(selectedView.id, { colormap: v })}
                        options={COLORMAPS.map((c) => ({ value: c, label: c }))}
                        data-inspector-colormap
                      />
                    </Row>
                    <Row label="Invert">
                      <Checkbox
                        checked={!!selectedView.invert}
                        onChange={(v) => onUpdateView(selectedView.id, { invert: v })}
                        data-inspector-invert
                      />
                    </Row>
                    <Row label="Show clipped pixels">
                      <Checkbox
                        checked={!!selectedView.showClipping}
                        onChange={(v) => onUpdateView(selectedView.id, { showClipping: v })}
                        data-inspector-show-clipping
                      />
                    </Row>
                    <Row label="Histogram on frame">
                      <Checkbox
                        checked={!!selectedView.showCanvasHistogram}
                        onChange={(v) => onUpdateView(selectedView.id, { showCanvasHistogram: v })}
                        data-inspector-canvas-histogram
                      />
                    </Row>
                    <HistogramPanel
                      recording={selectedRecording}
                      view={selectedView}
                      localFrame={(() => {
                        if (!selectedView || !selectedRecording) return 0;
                        if (selectedView.isLocked && selectedView.lockedFrame != null) {
                          return selectedView.lockedFrame;
                        }
                        const off = sourceOffsets?.get(selectedView.sourceId) ?? 0;
                        const local = (globalFrame ?? 0) - off;
                        return Math.max(
                          0,
                          Math.min(local, (selectedRecording.frame_count || 1) - 1)
                        );
                      })()}
                      vmin={selectedView.vmin}
                      vmax={selectedView.vmax}
                    />
                  </>
                );
              })()}
            </InspectorSection>

            {(sourceModeMeta(selectedView.sourceMode).kind === 'rgb' ||
              sourceModeMeta(selectedView.sourceMode).kind === 'rgb_image') && (
              <InspectorSection
                title="RGB grading"
                icon="palette"
                viewType={selectedView.sourceMode}
              >
                {/* M22 — full server-side grading. Per-channel R/G/B
                    gain + offset, gamma, brightness, contrast,
                    saturation, WB Kelvin (with Auto-WB button). All
                    state lives on `view.grading`; URL builders forward
                    only non-default fields. CSS-filter brightness/
                    contrast/saturation from M12 are deprecated by
                    this section but still applied to the <img> for
                    legacy views without a `grading` struct. */}
                {(() => {
                  const g = selectedView.grading || {};
                  const setG = (patch) =>
                    onUpdateView(selectedView.id, {
                      grading: { ...(selectedView.grading || {}), ...patch },
                    });
                  const autoWb = async () => {
                    if (!selectedRecording) return;
                    try {
                      const meta = sourceModeMeta(selectedView.sourceMode);
                      const gain = meta?.gain || 'hg';
                      const localFrame =
                        selectedView.isLocked && selectedView.lockedFrame != null
                          ? selectedView.lockedFrame
                          : Math.max(
                              0,
                              Math.min(
                                (globalFrame ?? 0) -
                                  (sourceOffsets?.get(selectedView.sourceId) ?? 0),
                                (selectedRecording.frame_count || 1) - 1
                              )
                            );
                      const r = await apiFetch(
                        `/api/sources/${selectedRecording.source_id}/frame/${localFrame}/rgb/auto-wb?gain=${gain}`,
                        { method: 'POST' }
                      );
                      if (r && typeof r === 'object') {
                        setG({
                          gain_r: r.gain_r ?? 1.0,
                          gain_g: r.gain_g ?? 1.0,
                          gain_b: r.gain_b ?? 1.0,
                        });
                      }
                    } catch (err) {
                      // Surface as a toast-equivalent via console; modal
                      // would be too disruptive for an interactive control.
                      console.warn('Auto-WB failed:', err);
                    }
                  };
                  return (
                    <>
                      <Row label="Gain R">
                        <Slider
                          value={g.gain_r ?? 1.0}
                          onChange={(v) => setG({ gain_r: Number(v) })}
                          min={0}
                          max={4}
                          step={0.02}
                          data-inspector-gain-r
                        />
                      </Row>
                      <Row label="Gain G">
                        <Slider
                          value={g.gain_g ?? 1.0}
                          onChange={(v) => setG({ gain_g: Number(v) })}
                          min={0}
                          max={4}
                          step={0.02}
                          data-inspector-gain-g
                        />
                      </Row>
                      <Row label="Gain B">
                        <Slider
                          value={g.gain_b ?? 1.0}
                          onChange={(v) => setG({ gain_b: Number(v) })}
                          min={0}
                          max={4}
                          step={0.02}
                          data-inspector-gain-b
                        />
                      </Row>
                      <Row label="Offset R">
                        <Slider
                          value={g.offset_r ?? 0}
                          onChange={(v) => setG({ offset_r: Number(v) })}
                          min={-0.5}
                          max={0.5}
                          step={0.01}
                          data-inspector-offset-r
                        />
                      </Row>
                      <Row label="Offset G">
                        <Slider
                          value={g.offset_g ?? 0}
                          onChange={(v) => setG({ offset_g: Number(v) })}
                          min={-0.5}
                          max={0.5}
                          step={0.01}
                          data-inspector-offset-g
                        />
                      </Row>
                      <Row label="Offset B">
                        <Slider
                          value={g.offset_b ?? 0}
                          onChange={(v) => setG({ offset_b: Number(v) })}
                          min={-0.5}
                          max={0.5}
                          step={0.01}
                          data-inspector-offset-b
                        />
                      </Row>
                      <Row label="WB Kelvin">
                        <Slider
                          value={g.wb_kelvin ?? 6500}
                          onChange={(v) => setG({ wb_kelvin: Number(v) })}
                          min={3000}
                          max={10000}
                          step={50}
                          data-inspector-wb-kelvin
                        />
                      </Row>
                      <Row label="Gamma">
                        <Slider
                          value={g.gamma ?? 1.0}
                          onChange={(v) => setG({ gamma: Number(v) })}
                          min={0.2}
                          max={3.0}
                          step={0.02}
                          data-inspector-grading-gamma
                        />
                      </Row>
                      <Row label="Brightness">
                        <Slider
                          value={g.brightness ?? 0}
                          onChange={(v) => setG({ brightness: Number(v) })}
                          min={-0.5}
                          max={0.5}
                          step={0.01}
                          data-inspector-grading-brightness
                        />
                      </Row>
                      <Row label="Contrast">
                        <Slider
                          value={g.contrast ?? 1.0}
                          onChange={(v) => setG({ contrast: Number(v) })}
                          min={0.2}
                          max={3.0}
                          step={0.02}
                          data-inspector-grading-contrast
                        />
                      </Row>
                      <Row label="Saturation">
                        <Slider
                          value={g.saturation ?? 1.0}
                          onChange={(v) => setG({ saturation: Number(v) })}
                          min={0}
                          max={3.0}
                          step={0.02}
                          data-inspector-grading-saturation
                        />
                      </Row>
                      <Row label="White balance">
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={autoWb}
                            data-inspector-auto-wb
                            title="Auto white balance (gray-world)"
                          >
                            Auto
                          </Button>
                          <Button
                            size="sm"
                            variant="subtle"
                            onClick={() => setG({ wb_kelvin: null })}
                            title="Clear WB shift"
                          >
                            Clear
                          </Button>
                        </div>
                      </Row>
                      <Row label="Reset">
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() =>
                            setG({
                              gain_r: 1.0,
                              gain_g: 1.0,
                              gain_b: 1.0,
                              offset_r: 0,
                              offset_g: 0,
                              offset_b: 0,
                              gamma: 1.0,
                              brightness: 0,
                              contrast: 1.0,
                              saturation: 1.0,
                              wb_kelvin: null,
                            })
                          }
                          data-inspector-grading-reset
                        >
                          Defaults
                        </Button>
                      </Row>
                      <div
                        style={{ fontSize: 10, color: t.textFaint, marginTop: 4, lineHeight: 1.5 }}
                      >
                        Server-rendered — colors burn into export.
                      </div>
                    </>
                  );
                })()}
              </InspectorSection>
            )}

            <InspectorSection
              title="Overlay"
              icon="layers"
              viewType={selectedView.sourceMode}
              defaultOpen={sourceModeMeta(selectedView.sourceMode).kind === 'overlay'}
            >
              <OverlayConfigurator
                view={selectedView}
                recording={selectedRecording}
                onUpdate={(patch) => onUpdateView(selectedView.id, patch)}
                onOpenBuilder={onOpenOverlayBuilder}
              />
            </InspectorSection>

            <InspectorSection title="Labels" icon="check" viewType={selectedView.sourceMode}>
              {/* M21 — burn-in labels rendered server-side in JetBrains
                  Mono. Each checkbox toggles a single line (or, for
                  scale bar, a small reference bar) on the rendered
                  PNG. Position controls all label items together. */}
              {(() => {
                const labels = selectedView.labels || {};
                const setLabel = (k, v) =>
                  onUpdateView(selectedView.id, {
                    labels: { ...(selectedView.labels || {}), [k]: v },
                  });
                return (
                  <>
                    <Row label="Timestamp">
                      <Checkbox
                        checked={!!labels.timestamp}
                        onChange={(v) => setLabel('timestamp', v)}
                        data-inspector-labels-timestamp
                      />
                    </Row>
                    <Row label="Frame index">
                      <Checkbox
                        checked={!!labels.frame}
                        onChange={(v) => setLabel('frame', v)}
                        data-inspector-labels-frame
                      />
                    </Row>
                    <Row label="Channel name">
                      <Checkbox
                        checked={!!labels.channel}
                        onChange={(v) => setLabel('channel', v)}
                        data-inspector-labels-channel
                      />
                    </Row>
                    <Row label="Source file">
                      <Checkbox
                        checked={!!labels.source_file}
                        onChange={(v) => setLabel('source_file', v)}
                        data-inspector-labels-source
                      />
                    </Row>
                    <Row label="Scale bar">
                      <Checkbox
                        checked={!!labels.scale_bar}
                        onChange={(v) => setLabel('scale_bar', v)}
                        data-inspector-labels-scale
                      />
                    </Row>
                    <Row label="Position">
                      <Select
                        value={labels.position || 'bottom-left'}
                        onChange={(v) => setLabel('position', v)}
                        options={[
                          { value: 'bottom-left', label: 'Bottom left' },
                          { value: 'bottom-right', label: 'Bottom right' },
                          { value: 'top-left', label: 'Top left' },
                          { value: 'top-right', label: 'Top right' },
                        ]}
                        data-inspector-labels-position
                      />
                    </Row>
                    <Row label="Font size">
                      <Spinbox
                        value={labels.font_size ?? 12}
                        onChange={(v) =>
                          setLabel('font_size', Math.max(6, Math.min(64, Number(v) || 12)))
                        }
                        min={6}
                        max={64}
                        step={1}
                        data-inspector-labels-font-size
                      />
                    </Row>
                  </>
                );
              })()}
            </InspectorSection>

            <InspectorSection title="Presets" icon="layers" viewType={selectedView.sourceMode}>
              <PresetsList
                view={selectedView}
                presets={presets}
                onSave={onOpenSavePreset}
                onLoad={(preset) => onUpdateView(selectedView.id, preset.fields || {})}
                onDelete={onDeletePreset}
              />
            </InspectorSection>

            <InspectorSection title="Advanced" icon="info" viewType={selectedView.sourceMode}>
              <div
                style={{
                  fontSize: 10,
                  color: t.textMuted,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  lineHeight: 1.6,
                }}
              >
                <KV k="View ID" v={selectedView.id} />
                <KV k="Source ID" v={selectedView.sourceId} />
                <KV k="Mode" v={selectedView.sourceMode} />
                <KV
                  k="vmin/vmax"
                  v={`${selectedView.vmin ?? 'auto'} / ${selectedView.vmax ?? 'auto'}`}
                />
                <KV
                  k="Brightness/Contrast/Sat"
                  v={`${selectedView.brightness?.toFixed(2)}/${selectedView.contrast?.toFixed(2)}/${selectedView.saturation?.toFixed(2)}`}
                />
                <KV k="Stream FPS" v={fps} />
                <KV k="Stream length" v={`${totalFrames} frames`} />
                {selectedRecording && (
                  <>
                    <KV k="Channels" v={(selectedRecording.channels || []).join(', ')} />
                    <KV k="Frame count" v={selectedRecording.frame_count} />
                    <KV k="ISP" v={selectedRecording.isp_mode_id} />
                  </>
                )}
              </div>
            </InspectorSection>
          </>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// OverlayConfigurator — full base + overlay + blend + thresholds + colormap
// inside the Inspector's Overlay section. Reads/writes view.overlay.
// ---------------------------------------------------------------------------

const BASE_PRESETS = [
  {
    id: 'rgb_hg',
    label: 'RGB · HG',
    kind: 'rgb_composite',
    baseGain: 'hg',
    requires: ['HG-R', 'HG-G', 'HG-B'],
  },
  {
    id: 'rgb_lg',
    label: 'RGB · LG',
    kind: 'rgb_composite',
    baseGain: 'lg',
    requires: ['LG-R', 'LG-G', 'LG-B'],
  },
  { id: 'gray_hgy', label: 'Gray · HG-Y', kind: 'single_channel', channel: 'HG-Y' },
  { id: 'gray_lgy', label: 'Gray · LG-Y', kind: 'single_channel', channel: 'LG-Y' },
  { id: 'gray_l', label: 'Gray · L', kind: 'single_channel', channel: 'L' },
];

const baseLayerOptions = (recording) => {
  if (!recording) return [];
  const chs = new Set(recording.channels || []);
  return BASE_PRESETS.filter((p) => {
    if (p.kind === 'rgb_composite') return p.requires.every((c) => chs.has(c));
    if (p.kind === 'single_channel') return chs.has(p.channel);
    return false;
  });
};

const overlayChannelOptions = (recording) => {
  if (!recording) return [];
  // Anything single-channel-ish from this source. Excludes RGB triplets
  // (those are bases). Synthesized luminance + NIR + raw single channels
  // all qualify.
  return (recording.channels || []).filter((c) => true);
};

const OVERLAY_BLEND_MODES = ['alpha', 'screen', 'additive'];
const OVERLAY_COLORMAPS = [
  'inferno',
  'magma',
  'plasma',
  'viridis',
  'turbo',
  'jet',
  'hot',
  'cool',
  'gray',
];

const OverlayConfigurator = ({ view, recording, onUpdate, onOpenBuilder }) => {
  const t = useTheme();
  const meta = sourceModeMeta(view.sourceMode);
  const isOverlayMode = meta.kind === 'overlay';
  const ov = view.overlay || {};
  const setOv = (patch) => onUpdate({ overlay: { ...ov, ...patch } });

  if (!isOverlayMode) {
    return (
      <div style={{ fontSize: 11, color: t.textMuted, padding: '4px 0', lineHeight: 1.55 }}>
        Switch the view&apos;s source mode to <em>NIR-HG over RGB-HG</em>,{' '}
        <em>NIR-LG over RGB-LG</em>, or <em>Custom overlay…</em> to enable per-view overlay
        controls. The overlay endpoint is live —{' '}
        <code
          style={{
            background: t.chipBg,
            padding: '0 4px',
            borderRadius: 3,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          /frame/{'{i}'}/overlay.png
        </code>
        .
      </div>
    );
  }

  const bases = baseLayerOptions(recording);
  // Resolve current "base preset" id from the overlay struct
  const baseId =
    ov.baseKind === 'rgb_composite'
      ? ov.baseGain === 'lg'
        ? 'rgb_lg'
        : 'rgb_hg'
      : (() => {
          const ch = ov.baseChannel;
          if (ch === 'HG-Y') return 'gray_hgy';
          if (ch === 'LG-Y') return 'gray_lgy';
          if (ch === 'L') return 'gray_l';
          return 'rgb_hg';
        })();

  const setBaseFromPreset = (presetId) => {
    const p = BASE_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    if (p.kind === 'rgb_composite') {
      setOv({ baseKind: 'rgb_composite', baseGain: p.baseGain, baseChannel: null });
    } else {
      setOv({ baseKind: 'single_channel', baseChannel: p.channel });
    }
  };

  const channels = overlayChannelOptions(recording);

  return (
    <div data-overlay-configurator>
      {onOpenBuilder && (
        <div style={{ marginBottom: 8 }}>
          <Button
            size="sm"
            variant="ghost"
            icon="layers"
            onClick={onOpenBuilder}
            fullWidth
            data-overlay-open-builder
            title="Open the 4-step Overlay Builder wizard"
          >
            Open Overlay Builder…
          </Button>
        </div>
      )}
      <Row label="Base layer">
        <Select
          value={baseId}
          onChange={setBaseFromPreset}
          options={bases.map((b) => ({ value: b.id, label: b.label }))}
          data-overlay-base
        />
      </Row>
      <Row label="Overlay channel">
        <Select
          value={ov.overlayChannel || ''}
          onChange={(v) => setOv({ overlayChannel: v })}
          options={[
            { value: '', label: '— pick —' },
            ...channels.map((c) => ({ value: c, label: c })),
          ]}
          data-overlay-channel
        />
      </Row>
      <Row label="Overlay colormap">
        <Select
          value={ov.overlayColormap || 'inferno'}
          onChange={(v) => setOv({ overlayColormap: v })}
          options={OVERLAY_COLORMAPS.map((c) => ({ value: c, label: c }))}
          data-overlay-colormap
        />
      </Row>
      <Row label="Blend mode">
        <Select
          value={ov.blend || 'alpha'}
          onChange={(v) => setOv({ blend: v })}
          options={OVERLAY_BLEND_MODES.map((b) => ({ value: b, label: b }))}
          data-overlay-blend
        />
      </Row>
      <Row label="Strength">
        <Slider
          value={ov.strength ?? 0.6}
          onChange={(v) => setOv({ strength: Number(v) })}
          min={0}
          max={1}
          step={0.02}
          data-overlay-strength
        />
      </Row>
      <Row label="Overlay low">
        <Spinbox
          value={ov.overlayLow ?? 0}
          onChange={(v) => setOv({ overlayLow: v === '' || v == null ? null : Number(v) })}
          min={0}
          max={65535}
          step={1}
          data-overlay-low
        />
      </Row>
      <Row label="Overlay high">
        <Spinbox
          value={ov.overlayHigh ?? 65535}
          onChange={(v) => setOv({ overlayHigh: v === '' || v == null ? null : Number(v) })}
          min={0}
          max={65535}
          step={1}
          data-overlay-high
        />
      </Row>
      <Row label="Reset thresholds">
        <Button
          size="sm"
          variant="subtle"
          onClick={() => setOv({ overlayLow: null, overlayHigh: null })}
          title="Use 1st / 99.5th percentile auto-clip"
        >
          Auto
        </Button>
      </Row>
      <div
        style={{
          marginTop: 8,
          padding: 8,
          background: t.chipBg,
          borderRadius: 4,
          fontSize: 10.5,
          lineHeight: 1.5,
          color: t.textMuted,
        }}
      >
        Overlay = colormapped {ov.overlayChannel || '?'} composited on top of{' '}
        <strong>
          {ov.baseKind === 'rgb_composite'
            ? `RGB · ${(ov.baseGain || 'hg').toUpperCase()}`
            : ov.baseChannel}
        </strong>
        . HDR base/overlay would synthesise an HG/LG-merged Y channel — not in the project&apos;s
        ISP modes today; documented as a follow-up.
      </div>
    </div>
  );
};

// SourceSectionBody — owns the entire source picker UI. Lives in the
// Inspector "Source" section. All gain + channel + raw-channel choices
// happen here; the FilePill stays minimal (file metadata + warnings)
// and the ViewerCard title bar carries only the view name + ⋮ menu.
//
// Layout:
//   [HG] [LG] [HDR]   ← per-recording gainPref (button-tabs)
//   Channel: [Visible (RGB) ▾]   ← per-view category
//   Raw channel: [Red ▾]          ← only when Channel = Raw RGB Channel
const SourceSectionBody = ({ view, recording, onUpdateView, onSetGain }) => {
  const t = useTheme();
  if (!view) return null;
  const gains = availableGains(recording);
  const activeGain = recording?.gainPref || (gains[0] ?? null);
  const meta = sourceModeMeta(view.sourceMode);
  const split = splitSourceMode(view.sourceMode);
  // Top-level channel category. The Source section exposes:
  //   visible (Visible RGB) · nir (NIR) · raw (Red/Green/Blue/Chroma Y)
  //   plus overlay / image / other for non-GSense sources.
  let category = null;
  if (meta.kind === 'rgb' || meta.kind === 'rgb_image') category = 'visible';
  else if (split.channelKind === 'nir') category = 'nir';
  else if (split.channelKind === 'chroma' || String(split.channelKind || '').startsWith('raw_'))
    category = 'raw';
  else if (meta.kind === 'overlay') category = 'overlay';
  else if (meta.id === 'gray_l') category = 'image';
  else category = 'other';
  // Sub-pick within "raw" → Red / Green / Blue / Chroma (Y).
  const rawSubKind =
    split.channelKind === 'chroma'
      ? 'chroma'
      : split.channelKind === 'raw_r'
        ? 'red'
        : split.channelKind === 'raw_g'
          ? 'green'
          : split.channelKind === 'raw_b'
            ? 'blue'
            : 'red';
  const setCategory = (cat) => {
    const gain = activeGain || 'HG';
    let newMode;
    if (cat === 'visible') newMode = composeSourceMode(gain, 'rgb');
    else if (cat === 'nir') newMode = composeSourceMode(gain, 'nir');
    else if (cat === 'raw') {
      // Default sub-kind = Chroma (Y); HDR has no raw splits so stays at Chroma.
      newMode = composeSourceMode(gain, 'chroma');
    } else if (cat === 'overlay') newMode = 'overlay_custom';
    else if (cat === 'image') newMode = 'gray_l';
    else newMode = 'raw';
    const newMeta = sourceModeMeta(newMode);
    onUpdateView(view.id, {
      sourceMode: newMode,
      colormap: view.colormap || newMeta.defaultColormap || 'gray',
      name: newMeta.label,
    });
  };
  const setRawSubKind = (sub) => {
    const gain = activeGain || 'HG';
    let kind;
    if (sub === 'red') kind = 'raw_r';
    else if (sub === 'green') kind = 'raw_g';
    else if (sub === 'blue') kind = 'raw_b';
    else kind = 'chroma';
    const newMode = composeSourceMode(gain, kind);
    const newMeta = sourceModeMeta(newMode);
    onUpdateView(view.id, {
      sourceMode: newMode,
      colormap: view.colormap || newMeta.defaultColormap || 'gray',
      name: newMeta.label,
    });
  };
  // Build the top-level dropdown options. Always show Visible/NIR/Raw
  // when the recording is GSense; append Overlay / Image fallbacks when
  // the recording exposes them.
  const categoryOptions = [];
  if (gains.length > 0) {
    categoryOptions.push({ value: 'visible', label: 'Visible (RGB)' });
    categoryOptions.push({ value: 'nir', label: 'NIR' });
    categoryOptions.push({ value: 'raw', label: 'Raw RGB Channel' });
  }
  // Overlay only when the recording has at least one overlay-eligible channel set.
  if (
    (recording?.channels || []).some((c) => c === 'HG-NIR' || c === 'LG-NIR' || c === 'HDR-NIR')
  ) {
    categoryOptions.push({ value: 'overlay', label: 'Overlay (NIR over RGB)' });
  }
  if ((recording?.channels || []).includes('L')) {
    categoryOptions.push({ value: 'image', label: 'Grayscale (L)' });
  }
  // Always available — escape hatch for unrecognized layouts.
  categoryOptions.push({ value: 'other', label: 'Pick channel…' });
  return (
    <>
      {gains.length > 0 && (
        <Row label="Gain">
          <div
            data-source-gain-tabs
            style={{
              display: 'inline-flex',
              gap: 0,
              background: t.chipBg,
              border: `1px solid ${t.chipBorder}`,
              borderRadius: 4,
              padding: 2,
            }}
            role="group"
            aria-label="Gain"
          >
            {gains.map((g) => {
              const isActive = g === activeGain;
              return (
                <button
                  key={g}
                  data-source-gain={g}
                  data-active={isActive ? 'true' : 'false'}
                  onClick={() => {
                    if (isActive) return;
                    onSetGain?.(recording.source_id, g);
                  }}
                  title={
                    g === 'HG'
                      ? 'High Gain — bright, saturates earlier'
                      : g === 'LG'
                        ? 'Low Gain — dim, more headroom'
                        : 'HDR — saturation-aware fusion of HG + LG'
                  }
                  style={{
                    background: isActive ? t.accent : 'transparent',
                    color: isActive ? '#fff' : t.text,
                    border: 'none',
                    borderRadius: 3,
                    padding: '3px 12px',
                    fontSize: 11,
                    fontWeight: isActive ? 600 : 500,
                    cursor: isActive ? 'default' : 'pointer',
                    fontFamily: 'inherit',
                    minWidth: 36,
                  }}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </Row>
      )}
      <Row label="Channel">
        <Select
          value={category}
          onChange={setCategory}
          options={categoryOptions}
          data-inspector-channel-category
        />
      </Row>
      {category === 'raw' && activeGain !== 'HDR' && (
        <Row label="Raw channel">
          <Select
            value={rawSubKind}
            onChange={setRawSubKind}
            options={[
              { value: 'red', label: 'Red' },
              { value: 'green', label: 'Green' },
              { value: 'blue', label: 'Blue' },
              { value: 'chroma', label: 'Chroma (Y)' },
            ]}
            data-inspector-raw-subchannel
          />
        </Row>
      )}
      {category === 'raw' && activeGain === 'HDR' && (
        <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 0' }}>
          HDR fusion exposes only the merged Chroma (Y) channel; per-channel R/G/B aren&apos;t
          available under HDR.
        </div>
      )}
      {category === 'other' && (
        <Row label="Channel key">
          <Select
            value={view.rawChannel || ''}
            onChange={(v) => onUpdateView(view.id, { rawChannel: v || null })}
            options={(() => {
              // Gain is already chosen at the top of the Source section,
              // so the channel-key dropdown filters out the other gain
              // halves' prefixed entries. Active gain HG → show only
              // HG-* (and unprefixed channels like "L"); LG → LG-*;
              // HDR → HDR-*. Non-GSense recordings (no gains) get the
              // unfiltered list.
              const all = recording?.channels || [];
              if (!activeGain) {
                return [
                  { value: '', label: '— pick —' },
                  ...all.map((c) => ({ value: c, label: c })),
                ];
              }
              const otherPrefixes = ['HG-', 'LG-', 'HDR-'].filter((p) => p !== `${activeGain}-`);
              const matching = all.filter((c) => !otherPrefixes.some((p) => c.startsWith(p)));
              // Strip the active-gain prefix on the LABEL (still keep
              // the full channel key as the value so the URL builders
              // resolve correctly).
              return [
                { value: '', label: '— pick —' },
                ...matching.map((c) => ({
                  value: c,
                  label: c.startsWith(`${activeGain}-`) ? c.slice(activeGain.length + 1) : c,
                })),
              ];
            })()}
            data-inspector-raw-channel
          />
        </Row>
      )}
      <Row label="Recording">
        <span
          style={{
            fontSize: 10.5,
            color: t.textMuted,
            fontFamily: 'ui-monospace,Menlo,monospace',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flex: 1,
          }}
          title={recording?.name || ''}
        >
          {recording?.name || '—'}
        </span>
      </Row>
    </>
  );
};

const InspectorSection = ({ title, icon, viewType, defaultOpen = false, children }) => {
  const t = useTheme();
  // Per-view-type collapse persistence — spec §7.1.8.
  const storageKey = `playback/inspectorSection/${viewType || 'default'}/${title}`;
  const [open, setOpen] = useLocalStorageState(storageKey, defaultOpen);
  return (
    <div
      data-inspector-section={title}
      style={{
        marginBottom: 8,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        background: t.bg,
      }}
    >
      <button
        onClick={() => setOpen((x) => !x)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          background: t.panel,
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer',
          color: t.text,
          fontFamily: 'inherit',
        }}
      >
        <Icon name={icon || 'chevron'} size={11} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: t.text,
            flex: 1,
            textAlign: 'left',
          }}
        >
          {title}
        </span>
        <Icon
          name="chevron"
          size={10}
          style={{
            color: t.textFaint,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .15s',
          }}
        />
      </button>
      {open && <div style={{ padding: '8px 10px' }}>{children}</div>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// M26 — non-linear sharpen / FPN ISP chain disclosure inside Corrections.
// Collapsed by default; persists open/closed per-view-type. Mirrors the
// controls USAF / FPN expose in their left panels. The 8 fields are
// forwarded to the per-frame channel + RGB routes via `_appendIspChainQuery`
// and to tiled exports via `buildTiledViewSpec`.
// ---------------------------------------------------------------------------

const SHARPEN_METHODS = [
  { value: 'None', label: 'None' },
  { value: 'Unsharp mask', label: 'Unsharp mask' },
  { value: 'Laplacian', label: 'Laplacian' },
  { value: 'High-pass', label: 'High-pass' },
];

const IspChainDisclosure = ({ viewType, isp, onChange, onReset }) => {
  const t = useTheme();
  const storageKey = `playback/ispChainOpen/${viewType || 'default'}`;
  const [open, setOpen] = useLocalStorageState(storageKey, false);
  const v = isp || {};
  const sharpenActive = v.sharpen_method && v.sharpen_method !== 'None';
  const anyActive =
    sharpenActive ||
    (v.denoise_sigma ?? 0) > 0.05 ||
    (v.median_size ?? 0) >= 3 ||
    (v.gaussian_sigma ?? 0) > 0.05 ||
    (v.hot_pixel_thr ?? 0) > 0.5 ||
    !!v.bilateral;
  return (
    <div
      data-inspector-isp-chain
      style={{
        marginTop: 8,
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        background: t.bg,
      }}
    >
      <button
        onClick={() => setOpen((x) => !x)}
        title="Non-linear ISP chain (sharpen + FPN smoothing). Applied after dark subtract and before the linear pre-norm chain."
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: 5,
          cursor: 'pointer',
          color: t.text,
          fontFamily: 'inherit',
        }}
      >
        <Icon name="sliders" size={10} style={{ color: t.textMuted, flexShrink: 0 }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: 0.3,
            textTransform: 'uppercase',
            color: t.textMuted,
            flex: 1,
            textAlign: 'left',
          }}
        >
          ISP chain
        </span>
        {anyActive && (
          <span
            data-inspector-isp-chain-active
            title="ISP chain has at least one active stage"
            style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 9,
              background: t.accent,
              color: t.bg,
              fontWeight: 600,
            }}
          >
            ON
          </span>
        )}
        <Icon
          name="chevron"
          size={9}
          style={{
            color: t.textFaint,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .15s',
          }}
        />
      </button>
      {open && (
        <div style={{ padding: '4px 8px 8px 8px' }}>
          <Row label="Sharpen">
            <Select
              value={v.sharpen_method || 'None'}
              onChange={(val) => onChange({ sharpen_method: val })}
              options={SHARPEN_METHODS}
              data-inspector-isp-chain-sharpen-method
            />
          </Row>
          <Row label="Sharpen amount">
            <Spinbox
              value={v.sharpen_amount ?? 1.0}
              onChange={(val) => onChange({ sharpen_amount: Number(val) })}
              min={0}
              max={8}
              step={0.1}
              disabled={!sharpenActive}
              data-inspector-isp-chain-sharpen-amount
            />
          </Row>
          <Row label="Sharpen radius">
            <Spinbox
              value={v.sharpen_radius ?? 2.0}
              onChange={(val) => onChange({ sharpen_radius: Number(val) })}
              min={0.5}
              max={10}
              step={0.1}
              disabled={!sharpenActive}
              data-inspector-isp-chain-sharpen-radius
            />
          </Row>
          <Row label="Denoise σ">
            <Spinbox
              value={v.denoise_sigma ?? 0.0}
              onChange={(val) => onChange({ denoise_sigma: Number(val) })}
              min={0}
              max={6}
              step={0.1}
              data-inspector-isp-chain-denoise-sigma
            />
          </Row>
          <Row label="Median size">
            <Spinbox
              value={v.median_size ?? 0}
              onChange={(val) => onChange({ median_size: Number(val) })}
              min={0}
              max={15}
              step={2}
              data-inspector-isp-chain-median-size
            />
          </Row>
          <Row label="Gaussian σ (FPN)">
            <Spinbox
              value={v.gaussian_sigma ?? 0.0}
              onChange={(val) => onChange({ gaussian_sigma: Number(val) })}
              min={0}
              max={20}
              step={0.1}
              data-inspector-isp-chain-gaussian-sigma
            />
          </Row>
          <Row label="Hot pixel σ">
            <Spinbox
              value={v.hot_pixel_thr ?? 0.0}
              onChange={(val) => onChange({ hot_pixel_thr: Number(val) })}
              min={0}
              max={50}
              step={0.5}
              data-inspector-isp-chain-hot-pixel-thr
            />
          </Row>
          <Row label="Bilateral">
            <Checkbox
              checked={!!v.bilateral}
              onChange={(val) => onChange({ bilateral: !!val })}
              data-inspector-isp-chain-bilateral
            />
          </Row>
          <Row label="Reset">
            <Button
              size="sm"
              variant="subtle"
              onClick={onReset}
              title="Reset the ISP chain (sharpen + FPN smoothing) to defaults"
              data-inspector-isp-chain-defaults
            >
              Defaults
            </Button>
          </Row>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// M28 — Presets list inside the Inspector. Filters the persisted presets
// by the current view's source-mode so loading a preset always lands on
// a compatible target. Save opens a modal at the PlaybackMode level.
// ---------------------------------------------------------------------------

const PresetsList = ({ view, presets, onSave, onLoad, onDelete }) => {
  const t = useTheme();
  const [confirmDeleteId, setConfirmDeleteId] = useStatePb(null);
  const matching = (presets || []).filter((p) => p.view_type === view?.sourceMode);
  return (
    <div data-inspector-presets>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          onClick={onSave}
          fullWidth
          data-inspector-presets-save
          title="Save the current view's settings as a named preset"
        >
          Save…
        </Button>
      </div>
      {matching.length === 0 ? (
        <div
          style={{
            fontSize: 10,
            color: t.textFaint,
            padding: '4px 0',
            fontStyle: 'italic',
          }}
        >
          No presets for{' '}
          <code style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{view?.sourceMode}</code>{' '}
          yet.
        </div>
      ) : (
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
          data-inspector-presets-list
        >
          {matching.map((p) => (
            <div
              key={p.id}
              data-inspector-preset-row
              data-preset-id={p.id}
              style={{
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                padding: '4px 6px',
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                background: t.bg,
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: t.text,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={p.name}
              >
                {p.name}
              </span>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => onLoad(p)}
                title={`Apply preset "${p.name}" to this view`}
                data-inspector-preset-load
              >
                Load
              </Button>
              {confirmDeleteId === p.id ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    onDelete(p.id);
                    setConfirmDeleteId(null);
                  }}
                  title="Click again to confirm deletion"
                  data-inspector-preset-delete-confirm
                >
                  Confirm?
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="subtle"
                  onClick={() => setConfirmDeleteId(p.id)}
                  title={`Delete preset "${p.name}"`}
                  data-inspector-preset-delete
                >
                  ×
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// M28 — Save Preset modal. Single text input for the name. Submits via
// PlaybackMode's `savePreset` callback.
// ---------------------------------------------------------------------------

// Confirmation modal for the multi-select "Delete from disk" flow. The
// user has already ticked recordings in the Sources panel; this modal
// shows the file list one more time and forces them to type-confirm
// before the destructive action runs. Per AGENT_RULES, irreversible
// disk-level deletes always need explicit confirmation.
const DeleteFromDiskConfirmModal = ({ open, recordings, onClose, onConfirm }) => {
  const t = useTheme();
  const [confirmText, setConfirmText] = useStatePb('');
  useEffectPb(() => {
    if (open) setConfirmText('');
  }, [open]);
  if (!open) return null;
  const haveDiskPaths = (recordings || []).filter((r) => !!r.path);
  const noDiskPaths = (recordings || []).filter((r) => !r.path);
  const canConfirm = haveDiskPaths.length > 0 && confirmText.trim().toUpperCase() === 'DELETE';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${haveDiskPaths.length} file${haveDiskPaths.length === 1 ? '' : 's'} from disk?`}
      width={600}
      data-delete-from-disk-modal
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            fontSize: 12,
            color: t.danger,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="warning" size={14} />
          This permanently removes the files from your filesystem. Cannot be undone.
        </div>
        {haveDiskPaths.length > 0 && (
          <div
            data-delete-paths-list
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              padding: '6px 10px',
              border: `1px solid ${t.border}`,
              borderRadius: 4,
              background: t.chipBg,
              fontFamily: 'ui-monospace,Menlo,monospace',
              fontSize: 11,
              color: t.text,
              lineHeight: 1.55,
            }}
          >
            {haveDiskPaths.map((r) => (
              <div
                key={r.source_id}
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={r.path}
              >
                {r.path}
              </div>
            ))}
          </div>
        )}
        {noDiskPaths.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: t.textMuted,
              padding: '6px 10px',
              borderRadius: 4,
              background: t.chipBg,
              border: `1px solid ${t.border}`,
            }}
          >
            {noDiskPaths.length} marked recording
            {noDiskPaths.length === 1 ? '' : 's'} have no disk path (uploaded files); they will be
            skipped.
          </div>
        )}
        <Row label="Confirm">
          <input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            data-delete-confirm-input
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 12.5,
              fontFamily: 'inherit',
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: 4,
            }}
          />
        </Row>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!canConfirm}
            onClick={onConfirm}
            data-delete-confirm-button
          >
            Delete {haveDiskPaths.length} from disk
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const SavePresetModal = ({ open, onClose, onSave, view }) => {
  const t = useTheme();
  const [name, setName] = useStatePb('');
  useEffectPb(() => {
    if (open) setName('');
  }, [open]);
  if (!open) return null;
  const trimmed = name.trim();
  return (
    <Modal open={open} onClose={onClose} title="Save preset" data-save-preset-modal>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textMuted }}>
          Capture the current view&apos;s display + ISP + grading + label settings as a named
          preset. The preset is bound to the source-mode{' '}
          <code style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{view?.sourceMode}</code> and
          only appears under matching views.
        </div>
        <Row label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. high-contrast NIR"
            maxLength={80}
            data-save-preset-name
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed) {
                onSave(trimmed);
                onClose();
              }
            }}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 12.5,
              fontFamily: 'inherit',
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: 4,
            }}
          />
        </Row>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!trimmed}
            onClick={() => {
              onSave(trimmed);
              onClose();
            }}
            data-save-preset-confirm
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// M29 — Overlay Builder modal (4-step wizard).
//
// Four steps mirror the inline OverlayConfigurator one-to-one:
//   1. Base       — pick the base layer (RGB · HG / RGB · LG / Gray channel)
//   2. Source     — pick the overlay channel
//   3. Thresholds — colormap + blend mode + strength + low/high vmin/vmax
//   4. Preview    — show the current frame's overlay PNG; Apply commits
//                   the draft into `view.overlay`.
//
// All steps are gated: the wizard's Next button disables until the
// minimum required fields for the step are set. Back/Forward preserves
// the in-modal draft. Apply only writes once on the final step.
// ---------------------------------------------------------------------------

const OVERLAY_WIZARD_STEPS = [
  { id: 'base', label: 'Base', n: 1 },
  { id: 'source', label: 'Source', n: 2 },
  { id: 'thresholds', label: 'Thresholds', n: 3 },
  { id: 'preview', label: 'Preview & Apply', n: 4 },
];

const OverlayBuilderModal = ({ view, recording, onClose, onApply }) => {
  const t = useTheme();
  const [stepIdx, setStepIdx] = useStatePb(0);
  const [draft, setDraft] = useStatePb(() => ({
    baseKind: 'rgb_composite',
    baseGain: 'hg',
    baseChannel: null,
    overlayChannel: null,
    overlayColormap: 'inferno',
    blend: 'alpha',
    strength: 0.6,
    overlayLow: null,
    overlayHigh: null,
    ...(view?.overlay || {}),
  }));
  // Reset draft + stepIdx whenever the modal re-opens for a different
  // view (the parent unmounts/remounts on close+reopen for different
  // view-ids, so this is just defensive).
  useEffectPb(() => {
    setStepIdx(0);
  }, [view?.id]);
  const setDraftField = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const bases = baseLayerOptions(recording);
  const channels = overlayChannelOptions(recording);
  const baseId =
    draft.baseKind === 'rgb_composite'
      ? draft.baseGain === 'lg'
        ? 'rgb_lg'
        : 'rgb_hg'
      : (() => {
          const ch = draft.baseChannel;
          if (ch === 'HG-Y') return 'gray_hgy';
          if (ch === 'LG-Y') return 'gray_lgy';
          if (ch === 'L') return 'gray_l';
          return 'rgb_hg';
        })();
  const setBaseFromPreset = (presetId) => {
    const p = BASE_PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    if (p.kind === 'rgb_composite') {
      setDraftField({
        baseKind: 'rgb_composite',
        baseGain: p.baseGain,
        baseChannel: null,
      });
    } else {
      setDraftField({ baseKind: 'single_channel', baseChannel: p.channel });
    }
  };
  // Validation per step. The Next button stays disabled until the
  // minimum fields for the current step are set.
  const stepReady = [
    !!baseId, // step 1: base picked (always true since seeded)
    !!draft.overlayChannel, // step 2: overlay channel chosen
    true, // step 3: thresholds always have defaults
    true, // step 4: preview — Apply is the action
  ];
  const step = OVERLAY_WIZARD_STEPS[stepIdx];
  const previewSrc = (() => {
    if (!recording || !draft.overlayChannel) return null;
    const baseChannel =
      draft.baseKind === 'rgb_composite'
        ? draft.baseGain === 'lg'
          ? 'LG-R'
          : 'HG-R'
        : draft.baseChannel || 'HG-Y';
    return frameOverlayUrl(recording.source_id, 0, {
      baseChannel,
      overlayChannel: draft.overlayChannel,
      baseKind: draft.baseKind,
      overlayColormap: draft.overlayColormap || 'inferno',
      blend: draft.blend || 'alpha',
      strength: draft.strength ?? 0.6,
      overlayLow: draft.overlayLow ?? null,
      overlayHigh: draft.overlayHigh ?? null,
      maxDim: 480,
      applyDark: view?.applyDark !== false,
    });
  })();
  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Overlay Builder"
      width={720}
      data-overlay-builder-modal
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Step indicator */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            paddingBottom: 8,
            borderBottom: `1px solid ${t.border}`,
          }}
          data-overlay-builder-stepper
        >
          {OVERLAY_WIZARD_STEPS.map((s, i) => {
            const active = i === stepIdx;
            const done = i < stepIdx;
            return (
              <div
                key={s.id}
                data-overlay-builder-step={s.id}
                data-active={active}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  fontSize: 11,
                  fontWeight: active ? 600 : 400,
                  textAlign: 'center',
                  borderRadius: 4,
                  background: active ? t.accent : done ? t.chipBg : 'transparent',
                  color: active ? t.bg : done ? t.text : t.textFaint,
                  border: `1px solid ${active ? t.accent : t.border}`,
                }}
              >
                {s.n}. {s.label}
              </div>
            );
          })}
        </div>

        {/* Step body */}
        <div style={{ display: 'flex', gap: 16, minHeight: 280 }}>
          {/* Left: controls */}
          <div
            style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}
            data-overlay-builder-body
          >
            {step.id === 'base' && (
              <>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>
                  Pick the base layer the overlay will composite on top of.
                </div>
                <Row label="Base layer">
                  <Select
                    value={baseId}
                    onChange={setBaseFromPreset}
                    options={bases.map((b) => ({ value: b.id, label: b.label }))}
                    data-overlay-builder-base
                  />
                </Row>
              </>
            )}
            {step.id === 'source' && (
              <>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>
                  Pick the channel rendered as the colormapped overlay.
                </div>
                <Row label="Overlay channel">
                  <Select
                    value={draft.overlayChannel || ''}
                    onChange={(v) => setDraftField({ overlayChannel: v || null })}
                    options={[
                      { value: '', label: '— pick —' },
                      ...channels.map((c) => ({ value: c, label: c })),
                    ]}
                    data-overlay-builder-channel
                  />
                </Row>
              </>
            )}
            {step.id === 'thresholds' && (
              <>
                <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 4 }}>
                  Tune the colormap, blend, and value range. Leave thresholds blank for the auto 1st
                  / 99.5th percentile clip.
                </div>
                <Row label="Colormap">
                  <Select
                    value={draft.overlayColormap || 'inferno'}
                    onChange={(v) => setDraftField({ overlayColormap: v })}
                    options={OVERLAY_COLORMAPS.map((c) => ({ value: c, label: c }))}
                    data-overlay-builder-colormap
                  />
                </Row>
                <Row label="Blend mode">
                  <Select
                    value={draft.blend || 'alpha'}
                    onChange={(v) => setDraftField({ blend: v })}
                    options={OVERLAY_BLEND_MODES.map((b) => ({ value: b, label: b }))}
                    data-overlay-builder-blend
                  />
                </Row>
                <Row label="Strength">
                  <Slider
                    value={draft.strength ?? 0.6}
                    onChange={(v) => setDraftField({ strength: Number(v) })}
                    min={0}
                    max={1}
                    step={0.02}
                    data-overlay-builder-strength
                  />
                </Row>
                <Row label="Overlay low">
                  <Spinbox
                    value={draft.overlayLow ?? 0}
                    onChange={(v) =>
                      setDraftField({
                        overlayLow: v === '' || v == null ? null : Number(v),
                      })
                    }
                    min={0}
                    max={65535}
                    step={1}
                    data-overlay-builder-low
                  />
                </Row>
                <Row label="Overlay high">
                  <Spinbox
                    value={draft.overlayHigh ?? 65535}
                    onChange={(v) =>
                      setDraftField({
                        overlayHigh: v === '' || v == null ? null : Number(v),
                      })
                    }
                    min={0}
                    max={65535}
                    step={1}
                    data-overlay-builder-high
                  />
                </Row>
              </>
            )}
            {step.id === 'preview' && (
              <div
                style={{
                  fontSize: 11.5,
                  color: t.textMuted,
                  lineHeight: 1.55,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                }}
              >
                <div>
                  <strong style={{ color: t.text }}>Base:</strong>{' '}
                  {draft.baseKind === 'rgb_composite'
                    ? `RGB · ${(draft.baseGain || 'hg').toUpperCase()}`
                    : draft.baseChannel}
                </div>
                <div>
                  <strong style={{ color: t.text }}>Overlay:</strong> {draft.overlayChannel || '—'}{' '}
                  · {draft.overlayColormap}
                </div>
                <div>
                  <strong style={{ color: t.text }}>Blend:</strong> {draft.blend} · strength{' '}
                  {Number(draft.strength ?? 0.6).toFixed(2)}
                </div>
                <div>
                  <strong style={{ color: t.text }}>Thresholds:</strong>{' '}
                  {draft.overlayLow ?? 'auto'} / {draft.overlayHigh ?? 'auto'}
                </div>
              </div>
            )}
          </div>

          {/* Right: live preview pane (debounced via stable URL key) */}
          <div
            style={{
              width: 320,
              minHeight: 240,
              borderRadius: 4,
              border: `1px solid ${t.border}`,
              background: t.chipBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
            data-overlay-builder-preview
          >
            {previewSrc ? (
              <img
                src={previewSrc}
                alt="Overlay preview"
                style={{
                  maxWidth: '100%',
                  maxHeight: '100%',
                  display: 'block',
                }}
              />
            ) : (
              <span
                style={{
                  fontSize: 11,
                  color: t.textFaint,
                  textAlign: 'center',
                  padding: 12,
                }}
              >
                {recording
                  ? 'Pick an overlay channel in step 2 to preview.'
                  : 'No recording bound to this view.'}
              </span>
            )}
          </div>
        </div>

        {/* Footer — Back / Next / Apply */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingTop: 8,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <Button size="sm" variant="ghost" onClick={onClose} data-overlay-builder-cancel>
            Cancel
          </Button>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button
              size="sm"
              variant="ghost"
              disabled={stepIdx === 0}
              onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              data-overlay-builder-back
            >
              Back
            </Button>
            {stepIdx < OVERLAY_WIZARD_STEPS.length - 1 ? (
              <Button
                size="sm"
                variant="primary"
                disabled={!stepReady[stepIdx]}
                onClick={() => setStepIdx((i) => Math.min(OVERLAY_WIZARD_STEPS.length - 1, i + 1))}
                data-overlay-builder-next
              >
                Next
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.overlayChannel}
                onClick={() => onApply(draft)}
                data-overlay-builder-apply
              >
                Apply overlay
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default PlaybackMode;
