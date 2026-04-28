// @ts-nocheck
// Play / Recording Inspection mode — 4th MantisAnalysis mode.
// play-tab-recording-inspection-rescue-v1
//
// Owns the mode's full state (recordings, darks, views, frame, playback).
// Renders the seven-region template layout. M3 stage: empty state +
// stream header + sources panel + multi-file load. ViewerGrid / Inspector /
// Timeline are placeholders (M4+).
import React from 'react';
import { AnalysisShell } from './analysis/shell.tsx';
// B-0037: module-level frame cache extracted to its own file. The
// public surface re-exports as the same names callers used (with
// the underscore-prefixed ones aliased so existing call sites in
// playback.tsx don't need to change).
import {
  setFrameCacheBudgetMB,
  getFrameCacheBudgetMB,
  getAvgBlobKbEstimate,
  DEFAULT_CACHE_BUDGET_MB as _DEFAULT_CACHE_BUDGET_MB,
  frameCacheMaxEntries as _frameCacheMaxEntries,
  frameCachePrefetchWindow as _frameCachePrefetchWindow,
  frameCacheHas as _frameCacheHas,
  frameCacheCurrentSize as _frameCacheCurrentSize,
  frameCacheGet as _frameCacheGet,
  frameCachePut as _frameCachePut,
  frameCachePurgeForSource as _frameCachePurgeForSource,
  isPrefetchInflight as _isPrefetchInflight,
  prefetchFrame as _prefetchFrame,
} from './playback/frameCache.ts';
// B-0037 Phase 2-4 module extractions.
import {
  SOURCE_MODES,
  availableSourceModes,
  defaultSourceModeId,
  sourceModeMeta,
  availableGains,
  splitSourceMode,
  composeSourceMode,
  CHANNEL_KIND_OPTIONS,
  channelKindOptionsForGain,
} from './playback/sourceModes.ts';
import {
  clientToImagePx as _clientToImagePx,
  RoiOverlaySvg as _RoiOverlaySvg,
} from './playback/RoiOverlay.tsx';
import { WarningCenterModal, WARNING_TEMPLATES } from './playback/modals/WarningCenterModal.tsx';
import { DeleteFromDiskConfirmModal, SavePresetModal } from './playback/modals/SmallModals.tsx';
import {
  useTheme,
  Icon,
  Button,
  Card,
  Row,
  Modal,
  Slider,
  Select,
  Segmented,
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

// ---------------------------------------------------------------------------
// Helpers — frame URL builders, exposure formatting
// ---------------------------------------------------------------------------
//
// Module-level frame blob cache + prefetch semaphore + EWMA blob-size
// estimator now live in ./playback/frameCache.ts (B-0037 extraction).
// playback.tsx imports the public surface at the top of the file. The
// underscore-prefixed aliases preserve every existing call site.

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
  // B-0040: HDR fusion override (only meaningful for HDR-* channels).
  if (opts.hdrFusion && opts.hdrFusion !== 'switch') {
    q.set('hdr_fusion', String(opts.hdrFusion));
  }
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
  // B-0040: HDR fusion override (only meaningful when gain='hdr').
  if (opts.hdrFusion && opts.hdrFusion !== 'switch') {
    q.set('hdr_fusion', String(opts.hdrFusion));
  }
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
  // Polygon ROI for the overlay (image-pixel coords). Backend
  // rasterizes via PIL.ImageDraw.polygon; outside the polygon the
  // overlay is invisible and the base shows through.
  if (Array.isArray(opts.maskPolygon) && opts.maskPolygon.length >= 3) {
    q.set('mask_polygon', JSON.stringify(opts.maskPolygon));
  }
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

// Source-mode catalog + helpers extracted to ./playback/sourceModes.ts (B-0037 Phase 2).

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
    // B-0040: HDR fusion mode override. Only honored for HDR-* channels;
    // routes drop the param otherwise. Default 'switch' is byte-identical
    // to the prior behaviour.
    hdrFusion: view.hdrFusion || 'switch',
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
      maskPolygon: Array.isArray(ov.maskPolygon) ? ov.maskPolygon : null,
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
// WARNING_TEMPLATES + WarningCenterModal moved to ./playback/modals/WarningCenterModal.tsx (B-0037 Phase 4).

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
    // Per-view zoom + pan (mouse-wheel zoom, double-click resets).
    zoom: 1,
    panX: 0,
    panY: 0,
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
      // ROI polygon for the overlay (image-pixel coords). When
      // populated with ≥ 3 vertices, the backend renders the
      // overlay only inside the polygon and lets the base show
      // through outside.
      maskPolygon: [],
    },
    // Per-view "draw the overlay ROI" mode — the canvas turns into
    // a vertex-picker; click adds vertices, double-click exits.
    overlayDrawMode: false,
    // Per-view TBR Analysis draft. The user picks a Tumor ROI then
    // a Background ROI, sees live stats for each, then commits the
    // pair into the parent's `tbrEntries` table. tbrDraftRole drives
    // which polygon the canvas vertex-picker is currently filling.
    tbrDraft: {
      tumorPolygon: [],
      bgPolygon: [],
      method: 'mean', // 'mean' | 'percentile' | 'mode'
      percentile: 50,
      tumorStats: null, // { computed_value, std, mean, n_pixels, ... }
      bgStats: null,
      channel: null, // optional override (defaults to current view channel)
    },
    tbrDraftRole: null, // null | 'tumor' | 'background'
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
  const [recordings, setRecordings] = React.useState([]); // Recording[]
  const [loadingFiles, setLoadingFiles] = React.useState([]); // [{ name, progress }]
  const [errorFiles, setErrorFiles] = React.useState([]); // [{ name, message }]
  const [selectedRecId, setSelectedRecId] = React.useState(null);
  // Multi-select for the "Delete from disk" flow. Holds the set of
  // recording source_ids the user has ticked. Independent from
  // `selectedRecId` (which is the single "active" recording the
  // viewer/inspector binds to).
  const [markedRecIds, setMarkedRecIds] = React.useState(() => new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  // Anchor for shift+click range selection — the source_id of the most
  // recently toggled (non-shift) recording. Shift+click on another
  // recording selects every entry between the anchor and the click in
  // current visual order, mirroring Finder/Explorer behaviour.
  const markAnchorRef = React.useRef(null);
  const toggleMarked = React.useCallback(
    (sourceId, opts = {}) => {
      const isShift = !!opts.shiftKey;
      setMarkedRecIds((prev) => {
        const next = new Set(prev);
        if (isShift && markAnchorRef.current) {
          // Range select: walk the *current* recordings list (display
          // order) from anchor → click and ADD every recording in
          // between. We add (never remove) so shift+click is purely
          // additive — matches Finder/Explorer multi-select semantics.
          const order = recordings.map((r) => r.source_id);
          const a = order.indexOf(markAnchorRef.current);
          const b = order.indexOf(sourceId);
          if (a !== -1 && b !== -1) {
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            for (let i = lo; i <= hi; i++) next.add(order[i]);
            return next;
          }
        }
        if (next.has(sourceId)) next.delete(sourceId);
        else next.add(sourceId);
        markAnchorRef.current = sourceId;
        return next;
      });
    },
    [recordings]
  );
  const clearMarked = React.useCallback(() => {
    setMarkedRecIds(new Set());
    markAnchorRef.current = null;
  }, []);
  // Prune any source_ids in `markedRecIds` that no longer correspond to a
  // live recording. Without this, a recording that vanishes by any
  // route (delete, remove, server eviction) leaves a phantom entry in
  // the marked-set and the header badge shows "Delete (1)" against an
  // empty file list. Also reset the anchor when its source disappears.
  React.useEffect(() => {
    const live = new Set(recordings.map((r) => r.source_id));
    setMarkedRecIds((prev) => {
      let changed = false;
      const next = new Set();
      for (const sid of prev) {
        if (live.has(sid)) next.add(sid);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (markAnchorRef.current && !live.has(markAnchorRef.current)) {
      markAnchorRef.current = null;
    }
  }, [recordings]);
  const [views, setViews] = React.useState([]); // View[]; ordered by display position
  const [selectedViewId, setSelectedViewId] = React.useState(null);
  const [layoutPreset, setLayoutPreset] = React.useState('single'); // single | side | stack | 2x2
  const [globalFrame, setGlobalFrame] = React.useState(0); // 0..(totalFrames-1)
  // Stream order — ordered list of source_ids. v1 keeps display order ===
  // load order; M6 lets the user reorder via the Stream Builder modal.
  const [streamOrder, setStreamOrder] = React.useState([]);
  // Playback state
  const [playing, setPlaying] = React.useState(false);
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
  const prevIsNarrowRef = React.useRef(isNarrow);
  const sourcesTouchedRef = React.useRef(false);
  const inspectorTouchedRef = React.useRef(false);
  React.useEffect(() => {
    if (prevIsNarrowRef.current === isNarrow) return;
    prevIsNarrowRef.current = isNarrow;
    if (!sourcesTouchedRef.current) setSourcesCollapsed(isNarrow);
    if (!inspectorTouchedRef.current) setInspectorCollapsed(isNarrow);
    sourcesTouchedRef.current = false;
    inspectorTouchedRef.current = false;
  }, [isNarrow, setSourcesCollapsed, setInspectorCollapsed]);
  // Stream Builder modal state (M6)
  const [streamBuilderOpen, setStreamBuilderOpen] = React.useState(false);
  // Export Video modal (M10)
  const [exportVideoOpen, setExportVideoOpen] = React.useState(false);
  // M23 — tiled image export modal (multi-view PNG composite).
  const [exportImageOpen, setExportImageOpen] = React.useState(false);
  // Warning Center modal (M11)
  const [warningCenterOpen, setWarningCenterOpen] = React.useState(false);
  // M17: range-brush on the timeline mini-map. `null` = no brush (full
  // stream is the export default); `[start, end]` (inclusive global
  // frame indices) = brush active. Two amber handles on the mini-map
  // and a shaded fill between them. Used by ExportVideoModal as the
  // default range and to lock its start/end Spinboxes when active.
  const [rangeSelection, setRangeSelection] = React.useState(null);
  // M16: per-source warnings the user dismissed via the FilePill chip
  // close button. Session-only — dismissals don't persist across reloads
  // because the underlying H5 metadata is unchanged. The same warning
  // still appears in the Warning Center modal regardless.
  // Map: source_id → Set<warning code>.
  const [dismissedWarnings, setDismissedWarnings] = React.useState({});
  // M28: server-side presets store (~/.mantisanalysis/playback-presets.json).
  // Persisted across sessions; multiple users on the same host get separate
  // files (mode 0600). Frontend owns the `fields` schema; backend round-trips.
  const [presets, setPresets] = React.useState([]);
  const [savePresetOpen, setSavePresetOpen] = React.useState(false);
  // M29: 4-step Overlay Builder wizard. Holds the id of the view being
  // configured; null when closed. Same backend as the inline overlay
  // configurator — the modal just gives a more guided UX.
  const [overlayBuilderViewId, setOverlayBuilderViewId] = React.useState(null);
  // TBR Analysis (Tumor / Background ratio). Top-level table of
  // committed entries (sourceFile, frameIndex, channel, tumor stats,
  // bg stats, ratio). Draft/in-progress measurement lives on the
  // active view (see view.tbrDraft) so it picks up the per-view ROI
  // drawing tool.
  const [tbrEntries, setTbrEntries] = React.useState([]);
  const [tbrAnalysisOpen, setTbrAnalysisOpen] = React.useState(false);
  React.useEffect(() => {
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
  const replacePresets = React.useCallback(
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
  const captureViewFields = React.useCallback((view) => {
    if (!view) return {};
    const out = {};
    for (const k of PRESET_FIELDS) {
      if (view[k] !== undefined) out[k] = view[k];
    }
    return out;
  }, []);
  const savePreset = React.useCallback(
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
  const deletePreset = React.useCallback(
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
  const dismissWarning = React.useCallback((sourceId, code) => {
    setDismissedWarnings((prev) => {
      const next = { ...prev };
      const existing = next[sourceId] ? new Set(next[sourceId]) : new Set();
      existing.add(code);
      next[sourceId] = existing;
      return next;
    });
  }, []);
  // Gain (HG / LG / HDR) is PER-VIEW: clicking a Gain tab in the
  // Inspector flips ONLY the currently selected view's source-mode.
  // Each view independently shows HG, LG, or HDR for the same
  // recording (e.g. side-by-side HG vs LG comparison). The
  // recording's `gainPref` still tracks the most recent choice on
  // this source so newly-spawned views default to the same gain,
  // but per-view edits never propagate to siblings.
  const setRecordingGain = React.useCallback(
    (sourceId, gain) => {
      setRecordings((prev) =>
        prev.map((r) => (r.source_id === sourceId ? { ...r, gainPref: gain } : r))
      );
      setViews((prev) =>
        prev.map((v) => {
          if (v.id !== selectedViewId) return v;
          if (v.sourceId !== sourceId) return v;
          if (v.isLocked) return v;
          const split = splitSourceMode(v.sourceMode);
          if (!split.channelKind) return v;
          let kind = split.channelKind;
          if (gain === 'HDR' && String(kind).startsWith('raw_')) kind = 'rgb';
          const newMode = composeSourceMode(gain, kind);
          const newMeta = sourceModeMeta(newMode);
          return {
            ...v,
            sourceMode: newMode,
            colormap: v.colormap || newMeta.defaultColormap || 'gray',
            name: v.name && v.name !== sourceModeMeta(v.sourceMode).label ? v.name : newMeta.label,
          };
        })
      );
    },
    [selectedViewId]
  );
  const [continuityThreshold, setContinuityThreshold] = useLocalStorageState(
    'playback/continuityThresholdS',
    1.0
  );
  // Darks loaded as a frontend-managed list. Backend stores one dark per
  // source; this list tracks which darks the user picked AND which sources
  // they're currently attached to. M8.
  const [darks, setDarks] = React.useState([]); // [{ id, name, file_size, attached: Set<sid> }]
  const [loadingDarks, setLoadingDarks] = React.useState([]); // [{ name }]
  const [darkErrors, setDarkErrors] = React.useState([]); // [{ name, message }]
  const darkInputRef = React.useRef(null);

  // --- Derived -----------------------------------------------------------
  const allExposures = React.useMemo(() => {
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
  React.useEffect(() => {
    setStreamOrder((prev) => {
      const presentIds = new Set(recordings.map((r) => r.source_id));
      const kept = prev.filter((sid) => presentIds.has(sid));
      const seen = new Set(kept);
      const appended = recordings.filter((r) => !seen.has(r.source_id)).map((r) => r.source_id);
      return [...kept, ...appended];
    });
  }, [recordings]);

  // --- Global → local frame mapping ------------------------------------
  const orderedRecordings = React.useMemo(
    () => streamOrder.map((sid) => recordings.find((r) => r.source_id === sid)).filter(Boolean),
    [streamOrder, recordings]
  );
  const totalFrames = React.useMemo(
    () => orderedRecordings.reduce((acc, r) => acc + (r.frame_count || 1), 0) || 1,
    [orderedRecordings]
  );
  const sourceOffsets = React.useMemo(() => {
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
  const activeAtGlobal = React.useMemo(() => {
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

  const localFrameForView = React.useCallback(
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
  React.useEffect(() => {
    if (!activeAtGlobal.sourceId) return;
    setViews((prev) => {
      let changed = false;
      const next = prev.map((v) => {
        if (v.isLocked) return v;
        if (v.sourceId === activeAtGlobal.sourceId) return v;
        const newRec = recordings.find((r) => r.source_id === activeAtGlobal.sourceId);
        if (!newRec) return v;
        // Preserve the user's source-mode choice when valid for the new
        // source; otherwise fall back to that source's default. The
        // spread `...v` carries over every Inspector setting (vmin/vmax,
        // grading, isp chain, labels, overlay, applyDark, …) so the only
        // identity that flips on a stream-follow rebind is the source-id
        // pointer + the source-mode-derived label fallback.
        const avail = new Set(availableSourceModes(newRec).map((m) => m.id));
        const newMode = avail.has(v.sourceMode) ? v.sourceMode : defaultSourceModeId(newRec);
        const meta = sourceModeMeta(newMode);
        changed = true;
        return {
          ...v,
          sourceId: newRec.source_id,
          sourceMode: newMode,
          // Keep the view's user-typed name when present; only fall back
          // to the meta label when the user hasn't named the view.
          name: v.name || meta.label,
          rawChannel: meta.kind === 'raw' ? v.rawChannel : null,
          // Preserve user-chosen colormap across stream-follow rebind.
          colormap: v.colormap || meta.defaultColormap,
        };
      });
      return changed ? next : prev;
    });
  }, [activeAtGlobal.sourceId, recordings]);

  // --- Status bar ---------------------------------------------------------
  React.useEffect(() => {
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
  const fileInputRef = React.useRef(null);

  // `handleOpenClick` is declared FURTHER DOWN, after `loadRecordings`,
  // because the File System Access API path needs to call into it.
  // Declaring it here would hit a TDZ on every render. See below.

  // Shared loader: takes a list of {kind:'file', file} or {kind:'path', path, name}.
  // Powers both the file-picker flow and the programmatic load-by-path hook
  // (used by tests and the future "Load by path" command-palette entry).
  const loadRecordings = React.useCallback(
    async (items) => {
      if (!items || items.length === 0) return;
      const names = items.map((it) => (it.kind === 'file' ? it.file.name : it.name || it.path));
      // Stable per-load id so two files with the SAME basename (e.g.
      // duplicates dragged from two folders) don't both clear on the
      // first .filter pass.
      const loadIds = items.map(
        (_, idx) => `lf-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`
      );
      setLoadingFiles((prev) => [
        ...prev,
        ...names.map((n, idx) => ({ id: loadIds[idx], name: n })),
      ]);
      const newRecordings = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const displayName = names[i];
        const loadId = loadIds[i];
        try {
          let summary;
          if (it.kind === 'file') {
            summary = await apiUpload('/api/sources/upload', it.file);
            // The browser hides the original disk path of an uploaded
            // file (security), so the server can only see the upload
            // tempfile. Ask the backend to scan the user's HOME for a
            // matching name + size and bind that path to the source so
            // the delete flow unlinks the user's ACTUAL file, not the
            // tempfile copy.
            try {
              const located = await apiFetch('/api/files/locate', {
                method: 'POST',
                body: { name: it.file.name, size: it.file.size },
              });
              const match = (located?.matches || [])[0];
              if (match?.path) {
                try {
                  const attached = await apiFetch(`/api/sources/${summary.source_id}/attach-path`, {
                    method: 'POST',
                    body: { path: match.path },
                  });
                  if (attached?.path) summary.path = attached.path;
                } catch {
                  // Non-fatal: the source is still loaded, just won't
                  // get disk-delete capability for the original file.
                }
              }
            } catch {
              /* locate failure is non-fatal — recording still loads */
            }
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
            // FileSystemFileHandle (when the user opened via showOpenFilePicker)
            // — used by the delete flow to call `.remove()` and actually
            // unlink the file from the user's filesystem in place. Not
            // serializable; only present on this in-memory recording.
            fileHandle: it.handle || null,
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
          setLoadingFiles((prev) => prev.filter((lf) => lf.id !== loadId));
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

  const handleFilesChosen = React.useCallback(
    (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      loadRecordings(files.map((file) => ({ kind: 'file', file })));
    },
    [loadRecordings]
  );

  // Open via the File System Access API so we get FileSystemFileHandle
  // objects we can later call `.remove()` on — that actually deletes
  // the user's source file from disk, not just our upload tempfile.
  // Falls back to the legacy `<input type="file">` (upload-only path)
  // when the API isn't available (Safari, older Firefox).
  const handleOpenClick = React.useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function') {
      fileInputRef.current?.click();
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Recording files',
            accept: {
              'application/octet-stream': ['.h5', '.hdf5'],
              'image/png': ['.png'],
              'image/tiff': ['.tif', '.tiff'],
              'image/jpeg': ['.jpg', '.jpeg'],
            },
          },
        ],
      });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      // Some browsers (Safari, older Firefox) gate the API behind a
      // user-permission prompt that throws SecurityError; fall back
      // to the upload input.
      fileInputRef.current?.click();
      return;
    }
    if (!handles || handles.length === 0) return;
    const items = [];
    for (const handle of handles) {
      try {
        const file = await handle.getFile();
        items.push({ kind: 'file', file, handle });
      } catch {
        // Permission revoked between picker and getFile — skip.
      }
    }
    if (items.length > 0) loadRecordings(items);
  }, [loadRecordings]);

  // Programmatic load-by-path hook — listens for a custom window event so
  // tests, the future "Load Play sample" command, and a "Load by path"
  // command-palette entry can drive recording loading without the browser
  // file picker. Detail shape: { paths: string[] }.
  React.useEffect(() => {
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
  // Live-current-recordings ref so the source-reconfigured fan-out can read
  // the latest list without recreating the listener on every change.
  const recordingsRef = React.useRef([]);
  React.useEffect(() => {
    recordingsRef.current = recordings;
  }, [recordings]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = async (ev) => {
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
      // Fan the same Filter & Channel Specification out to every OTHER
      // loaded recording so the user doesn't have to re-apply per file.
      // Triggering recording stays the canonical / authoritative one (its
      // server-returned summary already updated state above); the others
      // get the same mode_id + overrides PUT to their own /isp endpoint
      // serially so we get an atomic per-source rebuild and a meaningful
      // failure surface if any one source can't accept the config.
      if (!detail.isp_mode_id || !detail.isp_config) return;
      const cfg = detail.isp_config || {};
      const targets = (recordingsRef.current || []).filter(
        (r) => r && r.source_id && r.source_id !== sid
      );
      // Aggregate per-target outcomes so a partial failure surfaces as
      // a single toast at the end instead of a silent split-brain
      // (originating recording on the new mode, one or more siblings
      // still on the old mode). Without this the user might export a
      // tiled video and find one tile rendered with the previous
      // channel layout.
      const succeededNames = [];
      const failed = [];
      for (const target of targets) {
        try {
          const updated = await apiFetch(`/api/sources/${target.source_id}/isp`, {
            method: 'PUT',
            body: {
              mode_id: detail.isp_mode_id,
              origin: cfg.origin,
              sub_step: cfg.sub_step,
              outer_stride: cfg.outer_stride,
              channel_name_overrides: cfg.channel_name_overrides || {},
              channel_loc_overrides: cfg.channel_loc_overrides || {},
            },
          });
          _frameCachePurgeForSource(target.source_id);
          setRecordings((prev) =>
            prev.map((r) =>
              r.source_id === target.source_id
                ? {
                    ...r,
                    isp_mode_id: updated?.isp_mode_id || r.isp_mode_id,
                    isp_config: updated?.isp_config || r.isp_config,
                    channels: updated?.channels || r.channels,
                    shape: updated?.shape || r.shape,
                  }
                : r
            )
          );
          succeededNames.push(target.name || target.source_id);
        } catch (err) {
          // Non-fatal: log and continue. The user can re-apply manually
          // from the Filter & Channel Specification dialog if a sibling
          // file rejected the config (e.g. raw shape mismatch).
          // eslint-disable-next-line no-console
          console.warn(
            'Filter & Channel fan-out failed for',
            target.source_id,
            err?.detail || err?.message || err
          );
          failed.push({
            name: target.name || target.source_id,
            detail: err?.detail || err?.message || String(err),
          });
        }
      }
      if (targets.length > 0) {
        if (failed.length === 0) {
          say?.(
            `Filter & Channel applied to ${succeededNames.length} other recording${
              succeededNames.length === 1 ? '' : 's'
            }.`,
            'success'
          );
        } else if (succeededNames.length === 0) {
          say?.(
            `Filter & Channel fan-out failed on ${failed.length} recording${
              failed.length === 1 ? '' : 's'
            }: ${failed.map((f) => f.name).join(', ')}.`,
            'danger'
          );
        } else {
          say?.(
            `Filter & Channel: ${succeededNames.length} of ${targets.length} updated. ` +
              `Failed: ${failed.map((f) => f.name).join(', ')}.`,
            'warning'
          );
        }
      }
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
  React.useEffect(() => {
    if (!onSwitchSource) return;
    const rec = recordings.find((r) => r.source_id === selectedRecId);
    if (rec) onSwitchSource(rec);
  }, [recordings, selectedRecId, onSwitchSource]);

  // (Programmatic dark-load-by-path hook is registered below, after the
  // dark callbacks it references — keeps the TDZ at bay.)

  // Per-FilePill ✕ — SESSION-ONLY remove. NEVER touches the user's
  // disk file. Passes `delete_disk_file=false` so the backend just
  // drops the source from STORE and (for an upload) cleans up its
  // own /tmp tempfile, leaving the user's original on-disk file
  // alone. Disk-level deletion only happens through the Delete
  // button + confirmation modal.
  // Given a *snapshot* of the pre-removal orderedRecordings array, the
  // current globalFrame, and the set of source ids about to disappear,
  // pick the new globalFrame so the playhead behaves like the user
  // expects:
  //
  //   • if the source the cursor is currently inside SURVIVES → keep
  //     the cursor's local-within-that-source position and just
  //     recompute the global index in the post-removal stream.
  //   • if the cursor's source is being removed → walk FORWARD from
  //     that source's slot looking for the first surviving source and
  //     jump to its START.
  //   • if there is no surviving source AFTER → walk BACKWARD looking
  //     for the first surviving source before it and jump to ITS START.
  //   • if everything is being removed → globalFrame = 0.
  const computePostDeleteGlobalFrame = React.useCallback(
    (preOrdered, currentGlobalFrame, removed) => {
      if (!preOrdered || preOrdered.length === 0) return 0;
      // Find the cursor's pre-removal slot + local-within-that-source.
      let cursorIdx = -1;
      let cursorLocal = 0;
      let cum = 0;
      for (let i = 0; i < preOrdered.length; i++) {
        const r = preOrdered[i];
        const n = r.frame_count || 1;
        if (currentGlobalFrame < cum + n) {
          cursorIdx = i;
          cursorLocal = currentGlobalFrame - cum;
          break;
        }
        cum += n;
      }
      if (cursorIdx === -1) {
        // Cursor was past the end of the stream — fall back to the
        // last surviving source's last frame, computed below.
        cursorIdx = preOrdered.length - 1;
        cursorLocal = (preOrdered[cursorIdx].frame_count || 1) - 1;
      }
      // Build the surviving ordered list + a per-source new offset.
      const survivors = preOrdered.filter((r) => !removed.has(r.source_id));
      if (survivors.length === 0) return 0;
      const offsetOf = (sid) => {
        let acc = 0;
        for (const r of survivors) {
          if (r.source_id === sid) return acc;
          acc += r.frame_count || 1;
        }
        return -1;
      };
      const cursorRec = preOrdered[cursorIdx];
      // Case A: cursor's source survived — same source + same local.
      if (!removed.has(cursorRec.source_id)) {
        const off = offsetOf(cursorRec.source_id);
        if (off >= 0) {
          const localCap = (cursorRec.frame_count || 1) - 1;
          return off + Math.max(0, Math.min(localCap, cursorLocal));
        }
      }
      // Case B: walk forward in the ORIGINAL order for the next survivor.
      for (let j = cursorIdx + 1; j < preOrdered.length; j++) {
        if (!removed.has(preOrdered[j].source_id)) {
          return offsetOf(preOrdered[j].source_id);
        }
      }
      // Case C: no survivor after — walk backward.
      for (let j = cursorIdx - 1; j >= 0; j--) {
        if (!removed.has(preOrdered[j].source_id)) {
          return offsetOf(preOrdered[j].source_id);
        }
      }
      return 0;
    },
    []
  );

  const handleRemoveRecording = React.useCallback(
    async (sid) => {
      try {
        await apiFetch(`/api/sources/${sid}?delete_disk_file=false`, {
          method: 'DELETE',
        });
      } catch (err) {
        // 404 means it was already gone server-side — fine. Log otherwise.
        if (err.status !== 404) {
          say?.(`Could not remove on server: ${err.detail || err.message}`, 'warning');
        }
      }
      // Snapshot pre-removal ordering so the cursor-relocation math
      // sees the file's prior position before we mutate state.
      const preOrdered = orderedRecordings;
      const preGlobal = globalFrame;
      const removed = new Set([sid]);
      const nextGlobal = computePostDeleteGlobalFrame(preOrdered, preGlobal, removed);
      setRecordings((prev) => prev.filter((r) => r.source_id !== sid));
      setSelectedRecId((prev) => (prev === sid ? null : prev));
      // Drop any views bound to this recording — they have no data to show.
      setViews((prev) => prev.filter((v) => v.sourceId !== sid));
      setSelectedViewId((prev) => {
        const stillExists = views.find((v) => v.id === prev && v.sourceId !== sid);
        return stillExists ? prev : null;
      });
      setGlobalFrame(nextGlobal);
    },
    [say, views, orderedRecordings, globalFrame, computePostDeleteGlobalFrame]
  );

  // Multi-select "Delete" — DESTRUCTIVE. Per-recording cleanup:
  //   1. If the recording carries a FileSystemFileHandle (opened via
  //      showOpenFilePicker), upgrade to readwrite permission and call
  //      `handle.remove()` — that actually unlinks the file from the
  //      user's filesystem at the original picker location.
  //   2. Then DELETE /api/sources/{sid} so the backend drops the
  //      source from STORE AND unlinks any tempfile it owns.
  // The browser-side handle delete is the only path that can reach the
  // user's original file when the upload pipeline owns a tempfile copy
  // (browsers don't expose the original disk path for security).
  const handleDeleteMarkedFromDisk = React.useCallback(async () => {
    const ids = [...markedRecIds];
    if (ids.length === 0) {
      setDeleteConfirmOpen(false);
      return;
    }
    const markedRecs = ids
      .map((sid) => recordings.find((r) => r.source_id === sid))
      .filter(Boolean);
    const removedSids = new Set();
    let okUserPath = 0;
    let okHandle = 0;
    const failed = [];
    for (const rec of markedRecs) {
      // Try the local-disk delete FIRST (browser-side handle, then
      // backend unlink-by-path). Whatever path actually unlinks the
      // user's file on their computer counts as success; everything
      // else (only-tempfile, no-on-disk-artifact, permission denied,
      // anything) counts as a FAILURE because the user's stated goal
      // is "delete the file on my computer".
      let userFileDeleted = false;
      let userFileErr = null;
      // Path 1: FileSystemFileHandle.remove() — works on files opened
      // through showOpenFilePicker.
      if (!userFileDeleted && rec.fileHandle && typeof rec.fileHandle.remove === 'function') {
        try {
          let perm = 'granted';
          if (typeof rec.fileHandle.requestPermission === 'function') {
            try {
              perm = await rec.fileHandle.requestPermission({ mode: 'readwrite' });
            } catch {
              perm = 'granted';
            }
          }
          if (perm === 'granted') {
            await rec.fileHandle.remove();
            userFileDeleted = true;
            okHandle += 1;
          } else {
            userFileErr = 'permission denied';
          }
        } catch (err) {
          userFileErr = err?.message || String(err);
        }
      }
      // Path 2 / Path 3: server-side unlink. The DELETE route only
      // counts as a USER-FILE delete when it reports `deleted_kind:
      // 'user_path'`; tempfile deletes don't count toward the user's
      // stated goal.
      try {
        // Opt INTO disk deletion explicitly — the per-FilePill ✕
        // route uses `delete_disk_file=false` to leave the user's
        // disk file alone, and the backend default is now also
        // `false`. The bulk-delete confirm modal IS the consent;
        // pass `true` here so the user's file is unlinked.
        const resp = await apiFetch(`/api/sources/${rec.source_id}?delete_disk_file=true`, {
          method: 'DELETE',
        });
        // Always drop the source from the session — its frame reader
        // is now closed and STORE has forgotten it; keeping the row
        // in the panel would just confuse the user.
        removedSids.add(rec.source_id);
        if (!userFileDeleted) {
          if (resp?.deleted_kind === 'user_path') {
            userFileDeleted = true;
            okUserPath += 1;
          } else {
            failed.push({
              name: rec.name,
              message:
                resp?.delete_error ||
                userFileErr ||
                'no on-disk path is known for this recording (was it loaded via the legacy file picker?)',
            });
          }
        }
      } catch (err) {
        if (err.status === 404) {
          removedSids.add(rec.source_id);
          if (!userFileDeleted) {
            failed.push({
              name: rec.name,
              message: userFileErr || 'source already gone on the server, no disk file unlinked',
            });
          }
        } else {
          failed.push({ name: rec.name, message: err.detail || err.message });
        }
      }
    }
    if (removedSids.size > 0) {
      // Snapshot the pre-removal ordering + cursor BEFORE state mutation
      // so the relocation math sees the original positions of every
      // removed source.
      const nextGlobal = computePostDeleteGlobalFrame(orderedRecordings, globalFrame, removedSids);
      setRecordings((prev) => prev.filter((r) => !removedSids.has(r.source_id)));
      setViews((prev) => prev.filter((v) => !removedSids.has(v.sourceId)));
      setSelectedRecId((prev) => (prev && removedSids.has(prev) ? null : prev));
      setSelectedViewId((prev) => {
        const stillExists = views.find((v) => v.id === prev && !removedSids.has(v.sourceId));
        return stillExists ? prev : null;
      });
      setMarkedRecIds(new Set([...markedRecIds].filter((sid) => !removedSids.has(sid))));
      setGlobalFrame(nextGlobal);
    }
    const totalUnlinked = okUserPath + okHandle;
    const summary = [];
    if (totalUnlinked > 0) summary.push(`${totalUnlinked} deleted from your computer`);
    if (failed.length > 0) summary.push(`${failed.length} could NOT be deleted from disk`);
    if (summary.length > 0) {
      say?.(summary.join(' · '), failed.length > 0 ? 'danger' : 'success');
    }
    setDeleteConfirmOpen(false);
  }, [
    markedRecIds,
    recordings,
    views,
    say,
    orderedRecordings,
    globalFrame,
    computePostDeleteGlobalFrame,
  ]);

  // ---- View management -------------------------------------------------
  const updateView = React.useCallback((viewId, patch) => {
    setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, ...patch } : v)));
  }, []);

  const addView = React.useCallback(() => {
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

  const removeView = React.useCallback(
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
  const duplicateView = React.useCallback((viewId) => {
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
  const copyViewSettingsTo = React.useCallback(
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
  React.useEffect(() => {
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
  React.useEffect(() => {
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
      // No per-tick prefetch — the eager-warmer effect (above) walks
      // every (view × frame) URL once on recording-load / settings-
      // change, so the cache is populated end-to-end before the user
      // hits Play. The previous per-tick lookahead chased the playhead
      // and bobbed in/out of cache hits at high FPS; centralizing
      // population in the warmer kills the thrash AND the visual
      // jumping between cached/uncached frames.
      if (!cancelled) setTimeout(tick, stepMs);
    };
    const id = setTimeout(tick, stepMs);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // Deliberately exclude `views` and `recordings`: the play-loop body
    // never reads them (it only advances the global frame index). Adding
    // them to the dep list interrupted the loop on every overlay /
    // grading / label edit, dropping frames at high FPS. The eager
    // warmer effect handles URL-set changes separately.
  }, [playing, fps, loop, totalFrames]);

  // ---- Eager cache warmer ---------------------------------------------
  // Walk every (view × frame) URL once in the background so the cache
  // is full before the user hits Play. Re-runs whenever the URL set
  // changes (new recording, source-mode flip, ISP/grading edit). Honors
  // the prefetch concurrency semaphore so it never starves the user-
  // facing per-view fetch. The previous per-tick lookahead approach
  // chased the playhead and bobbed in and out of cache hits at high
  // FPS; eager warming guarantees that once the green-bar finishes,
  // every frame is a hit forever.
  //
  // Stable signature key over (view, recording) URL-relevant fields so
  // we don't restart on benign React re-renders (e.g. selectedViewId
  // changes, layout flips). When the key is identical to the previous
  // run, the warmer no-ops; when it changes, we cancel and restart.
  // CHEAP warmer key — only the fields that actually change the URL
  // TEMPLATE (mode + display + ISP geometry). The big nested objects
  // (labels / grading / isp / overlay) are excluded because JSON.
  // stringify-ing them per render on N views allocates serious memory
  // (and a stream of 18+ recordings was crashing the renderer on the
  // recompute). The cache-key already encodes the full URL anyway, so
  // a stale warmer-key just means the warmer over-walks; not a bug.
  const warmerKey = React.useMemo(() => {
    const parts = [];
    for (const v of views) {
      const rec = recordings.find((r) => r.source_id === v.sourceId);
      if (!rec) continue;
      // Include overlay + grading + isp signatures so the warmer
      // restarts whenever the URL TEMPLATE changes (otherwise the
      // pre-warmed blobs go stale the moment the user edits the
      // overlay polygon / threshold / grading / ISP chain, and
      // playback grinds to a halt at server speed). We use a tiny
      // signature, NOT the full struct, to keep this string short
      // and avoid burning megabytes per render on big sessions.
      const ov = v.overlay || {};
      const polyLen = Array.isArray(ov.maskPolygon) ? ov.maskPolygon.length : 0;
      const ovSig = `${ov.overlayChannel || ''}/${ov.overlayLow ?? ''}/${ov.overlayHigh ?? ''}/${ov.overlayColormap || ''}/${ov.blend || ''}/${ov.strength ?? ''}/p${polyLen}`;
      const g = v.grading || {};
      const gSig = `${g.gain_r ?? 1}/${g.gain_g ?? 1}/${g.gain_b ?? 1}/${g.gamma ?? 1}/${g.brightness ?? 0}/${g.contrast ?? 1}/${g.saturation ?? 1}/${g.wb_kelvin ?? ''}`;
      const ip = v.isp || {};
      const ipSig = `${ip.sharpen_method || ''}/${ip.sharpen_amount ?? ''}/${ip.denoise_sigma ?? ''}/${ip.median_size ?? ''}/${ip.gaussian_sigma ?? ''}`;
      // B-0040 — fold HDR fusion into the warmer key so a fusion
      // toggle change restarts pre-warming with the new URL set.
      const hdrSig = v.hdrFusion || 'switch';
      parts.push(
        `${v.id}|${rec.source_id}|${rec.frame_count}|${v.sourceMode}|${v.colormap || ''}|${v.normalize || ''}|${v.vmin ?? ''}|${v.vmax ?? ''}|${v.blackLevel ?? ''}|${ovSig}|${gSig}|${ipSig}|${hdrSig}|${_ispVersionToken(rec)}`
      );
    }
    return parts.join('||');
  }, [views, recordings]);

  React.useEffect(() => {
    if (totalFrames <= 0 || views.length === 0) return undefined;
    let cancelled = false;
    // 100 ms debounce so a slider drag (warmerKey churning at 50 fps)
    // doesn't restart the warmer on every tick. Only the LATEST
    // warmerKey gets the walk; intermediate ones cancel cleanly. The
    // per-card AbortController fetch is unaffected — the slider
    // canvas update is still immediate.
    const debounceTimer = setTimeout(runWarmer, 100);
    function runWarmer() {
      if (cancelled) return;
      // BOUNDED warm queue. With ~400 KB per cached PNG, a 1 GB budget
      // holds ~2.5K entries. Loading 18 legacy H5s × 128 frames × N
      // views easily blows past that. We cap the queue at HALF the cache
      // capacity (so the trim loop doesn't immediately evict what we
      // just warmed) and walk views ROUND-ROBIN, prioritising the first
      // view's first frames so the active stream is always warm even
      // when later views/sources never get their turn.
      const cacheCap = _frameCacheMaxEntries();
      const queueCap = Math.max(64, Math.floor(cacheCap / 2));
      const perViewBudget = Math.max(1, Math.floor(queueCap / Math.max(1, views.length)));
      const warmQueue = [];
      let stop = false;
      // Round-robin frame index across views so frame 0 of every view is
      // queued before frame 1 of the first view — matters when the user
      // is scrubbing across the multi-view grid.
      const maxLocal = views.reduce((m, v) => {
        const rec = recordings.find((r) => r.source_id === v.sourceId);
        const c = rec?.frame_count || 0;
        return c > m ? c : m;
      }, 0);
      for (let i = 0; i < maxLocal && !stop; i++) {
        for (const view of views) {
          if (warmQueue.length >= queueCap) {
            stop = true;
            break;
          }
          const rec = recordings.find((r) => r.source_id === view.sourceId);
          if (!rec) continue;
          const localCount = rec.frame_count || 0;
          if (localCount <= 0) continue;
          if (view.isLocked && view.lockedFrame != null) {
            if (i === 0) warmQueue.push({ rec, view, localFrame: view.lockedFrame });
            continue;
          }
          if (i >= localCount) continue;
          if (i >= perViewBudget) continue;
          warmQueue.push({ rec, view, localFrame: i });
        }
      }
      // Walk the queue, dispatching prefetches as the semaphore allows.
      // Yields aggressively so the React event loop stays responsive
      // even when the queue is in the thousands.
      let pos = 0;
      const tick = async () => {
        while (!cancelled && pos < warmQueue.length) {
          if (_prefetchActive >= _MAX_CONCURRENT_PREFETCHES) {
            await new Promise((r) => setTimeout(r, 25));
            continue;
          }
          const { rec, view, localFrame } = warmQueue[pos++];
          const url = buildFrameUrl(rec, view, localFrame);
          if (url && !_frameCacheHas(url) && !_isPrefetchInflight(url)) {
            _prefetchFrame(url);
          }
          // Yield to the event loop every few dispatches so React
          // re-renders + user input don't get blocked on huge streams.
          if (pos % 4 === 0) {
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      };
      tick();
    } // end runWarmer
    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmerKey, totalFrames]);

  // ---- Keyboard shortcuts (only while Play tab is mounted) -------------
  React.useEffect(() => {
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

  const handleRetryError = React.useCallback((name) => {
    setErrorFiles((prev) => prev.filter((e) => e.name !== name));
    // Just clear — user can re-open the file. Real auto-retry would need
    // to re-trigger the picker which the browser blocks programmatically.
  }, []);

  // ---- Dark-frame management (M8) --------------------------------------
  const handleOpenDarkClick = React.useCallback(() => {
    darkInputRef.current?.click();
  }, []);

  const refreshSourceSummary = React.useCallback(async (sid) => {
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

  const attachDarkToSource = React.useCallback(
    async (sid, file) => {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/sources/${sid}/dark/upload`, { method: 'POST', body: fd });
      await refreshSourceSummary(sid);
    },
    [refreshSourceSummary]
  );

  const handleDarkFilesChosen = React.useCallback(
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
      // Per-file stable load id so duplicate basenames don't both clear
      // on the first .filter pass.
      const darkLoadIds = files.map(
        (_, idx) => `ld-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`
      );
      setLoadingDarks((prev) => [
        ...prev,
        ...files.map((f, idx) => ({ id: darkLoadIds[idx], name: f.name })),
      ]);
      const newDarks = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const loadId = darkLoadIds[i];
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
          setLoadingDarks((prev) => prev.filter((lf) => lf.id !== loadId));
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
  const buildTiledViewSpec = React.useCallback(
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
        // Polygon ROI for the per-tile overlay render. Image-pixel coords;
        // backend rasterizes against the channel array's native shape so
        // alignment with what the user drew on the canvas is exact.
        mask_polygon:
          meta.kind === 'overlay' && Array.isArray(ov.maskPolygon) && ov.maskPolygon.length >= 3
            ? ov.maskPolygon
            : null,
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
  const buildVideoUrl = React.useCallback(
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
        // Polygon ROI: when the overlay view carries a drawn mask, the
        // exported video honors it the same way the per-frame display
        // does — overlay only inside the polygon, base RGB outside.
        if (Array.isArray(ov.maskPolygon) && ov.maskPolygon.length >= 3) {
          q.set('mask_polygon', JSON.stringify(ov.maskPolygon));
        }
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

  const exportVideo = React.useCallback(
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
  const exportImageTiled = React.useCallback(
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
  const exportImage = React.useCallback(async () => {
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

  const handleRemoveDark = React.useCallback(
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
  React.useEffect(() => {
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
  React.useEffect(() => {
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
      // Per-path stable load id so duplicate basenames don't both
      // clear on the first .filter pass.
      const darkLoadIds = paths.map(
        (_, idx) => `ld-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`
      );
      setLoadingDarks((prev) => [
        ...prev,
        ...paths.map((p, idx) => ({ id: darkLoadIds[idx], name: p.split('/').pop() })),
      ]);
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const loadId = darkLoadIds[i];
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
          setLoadingDarks((prev) => prev.filter((lf) => lf.id !== loadId));
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
          // TBR Analysis — table of committed entries lives at this
          // level so the modal can read the full set in one place.
          tbrEntries={tbrEntries}
          setTbrEntries={setTbrEntries}
          setTbrAnalysisOpen={setTbrAnalysisOpen}
        />
      </div>
      {tbrAnalysisOpen && (
        <AnalysisShell
          run={{
            mode: 'tbr',
            response: {
              channels: Array.from(new Set(tbrEntries.map((e) => e.channel))).sort(),
              tbr_entries: tbrEntries,
            },
          }}
          onClose={() => setTbrAnalysisOpen(false)}
          onToast={(msg, level) => say?.(msg, level || 'info')}
        />
      )}
      <PlayCacheStatusBar recordingsLoading={loadingFiles.length} />
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
              // Apply commits the overlay config AND switches the view to
              // the custom-overlay render path so the configuration takes
              // effect immediately even when the user opened the builder
              // from a non-overlay source mode.
              const meta = sourceModeMeta('overlay_custom');
              updateView(wizardView.id, {
                overlay: nextOverlay,
                sourceMode: 'overlay_custom',
                colormap: wizardView.colormap || meta.defaultColormap || 'inferno',
                name: wizardView.name || meta.label,
              });
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
      {/* The "Open recording…" button used to live here; removed per
          user request. Files now load through the SourcesPanel (left
          column) "Open recording…" button on the empty state, the +
          Add recordings tile, the ⌘K palette, the ⌘O shortcut, or
          drag-drop into the empty state. */}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginBottom: 8,
            padding: '0 4px',
          }}
        >
          <SectionHeader label="Recordings" count={recordings.length} />
          <div style={{ flex: 1 }} />
          {recordings.length > 0 && (
            <>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  // Mark every recording (or clear all if everything is
                  // already marked) — convenience for the user who wants
                  // to delete the entire stream in one shot.
                  const allMarked = markedRecIds && markedRecIds.size === recordings.length;
                  if (allMarked) {
                    onClearMarked?.();
                  } else {
                    for (const r of recordings) {
                      if (!markedRecIds?.has(r.source_id)) {
                        onToggleMarked?.(r.source_id, { shiftKey: false });
                      }
                    }
                  }
                }}
                data-recordings-select-all
                title="Select all (or clear) for delete"
              >
                {markedRecIds && markedRecIds.size === recordings.length ? 'Clear' : 'Select all'}
              </Button>
              <Button
                size="xs"
                variant="danger"
                icon="close"
                disabled={!markedRecIds || markedRecIds.size === 0}
                onClick={onOpenDeleteConfirm}
                data-recordings-delete-header
                title={
                  markedRecIds && markedRecIds.size > 0
                    ? `Permanently delete the ${markedRecIds.size} selected file${markedRecIds.size === 1 ? '' : 's'} from your computer`
                    : 'Tick recordings then click here to delete the actual files from your computer (shift+click for range)'
                }
              >
                Delete{markedRecIds && markedRecIds.size > 0 ? ` (${markedRecIds.size})` : ''}
              </Button>
            </>
          )}
        </div>
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
            onToggleMarked={(opts) => onToggleMarked?.(rec.source_id, opts)}
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
  const [expanded, setExpanded] = React.useState(false);
  // M16: which warning code the user clicked (to expand its detail row).
  const [openWarningCode, setOpenWarningCode] = React.useState(null);
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
          onChange={(e) => {
            // Read the modifier from the synthetic event's nativeEvent.
            // Shift+click → expand to a contiguous range from the anchor;
            // plain click → single toggle. Letting the native check
            // toggle happen first keeps the DOM in sync; the parent
            // state replaces it on the next render either way.
            const shift = !!(e.nativeEvent && e.nativeEvent.shiftKey);
            onToggleMarked({ shiftKey: shift });
          }}
          title="Mark for delete (shift+click for range)"
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
  const [imgState, setImgState] = React.useState('idle'); // 'idle' | 'loading' | 'ok' | 'error'
  const [errStatus, setErrStatus] = React.useState(null); // HTTP status on failure
  const [errDetail, setErrDetail] = React.useState(null); // server-supplied detail message
  const [retryNonce, setRetryNonce] = React.useState(0);
  const [menuOpen, setMenuOpen] = React.useState(false); // M13: overflow ⋮ menu
  const [copyOpen, setCopyOpen] = React.useState(false); // M13: copy-settings sub-popover
  // M30: right-click context menu — Send to USAF / FPN / DoF.
  const [ctxMenu, setCtxMenu] = React.useState(null); // null | { x, y }
  const menuAnchorRef = React.useRef(null);
  const imgRef = React.useRef(null);
  // SVG overlay used for accurate screen-px → image-px hit-testing
  // (the IMG element's getBoundingClientRect doesn't account for
  // objectFit:contain letterboxing). The SVG has the same viewBox
  // as the image, so getScreenCTM().inverse() returns the precise
  // mapping even at any zoom + pan.
  const svgRef = React.useRef(null);
  // Middle-button drag-pan state. Held in a ref so mousemove updates
  // don't re-render every frame; we commit the new (panX, panY) to
  // view state on mouseup or on each frame via rAF.
  const dragRef = React.useRef(null); // { startClientX, startClientY, startPanX, startPanY } | null
  // M11 reviewer P1: track the most recent blob URL so we can revoke it
  // synchronously when the next one is assigned, AND on unmount. The
  // earlier onload-based revoke leaked under fast scrubbing.
  const prevBlobRef = React.useRef(null);

  // Use the parent-computed local frame (handles locked views and global→
  // local mapping for multi-source streams).
  const effectiveFrame = view.isLocked && view.lockedFrame != null ? view.lockedFrame : localFrame;

  const url = React.useMemo(
    () => buildFrameUrl(recording, view, effectiveFrame),
    [recording, view, effectiveFrame]
  );

  // Single-flight: when the URL changes, kick off a fresh fetch and abort
  // the previous one via the cleanup. The browser's HTTP cache + the
  // backend's per-source LRU mean repeat frames are near-instant.
  React.useEffect(() => {
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
    let counted = false;
    _trackFetchStart();
    counted = true;
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
        _frameCachePut(url, objUrl, blob?.size);
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
      })
      .finally(() => {
        if (counted) {
          counted = false;
          _trackFetchEnd();
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
      {/* Canvas area — wheel-zoom + middle/space-drag-pan. The zoom +
          pan are PER-VIEW so each ViewerCard scales independently. */}
      <div
        data-canvas-area
        style={{
          flex: 1,
          minHeight: 0,
          background: t.canvasBg || '#0a0a0a',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          // Default: no special cursor (canvas is for viewing). Crosshair
          // only when actively drawing an ROI; the grab cursor used to
          // show whenever zoomed in but that was distracting and the
          // pan happens via middle-mouse-drag, not a wheel-click handle.
          cursor: view.overlayDrawMode || view.tbrDraftRole ? 'crosshair' : 'default',
        }}
        onMouseDown={(e) => {
          // Middle-button drag pans the image. Browsers bind middle-
          // click to autoscroll on Linux/Windows; preventDefault sup-
          // presses that. We set capture on the canvas-area so the
          // mousemove/mouseup keep firing even when the cursor leaves
          // the element mid-drag.
          if (e.button !== 1 || !url) return;
          e.preventDefault();
          dragRef.current = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            startPanX: view.panX || 0,
            startPanY: view.panY || 0,
          };
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore */
          }
          e.currentTarget.style.cursor = 'grabbing';
        }}
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          const d = dragRef.current;
          onUpdate({
            panX: d.startPanX + (e.clientX - d.startClientX),
            panY: d.startPanY + (e.clientY - d.startClientY),
          });
        }}
        onMouseUp={(e) => {
          if (e.button !== 1 || !dragRef.current) return;
          e.preventDefault();
          dragRef.current = null;
          e.currentTarget.style.cursor =
            view.overlayDrawMode || view.tbrDraftRole ? 'crosshair' : 'default';
        }}
        onMouseLeave={(e) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          e.currentTarget.style.cursor =
            view.overlayDrawMode || view.tbrDraftRole ? 'crosshair' : 'default';
        }}
        onContextMenu={(e) => {
          // The native context menu on right-click is already
          // owned by ViewerCard's right-click → Send-to handler;
          // suppress here so middle-click on macOS (which Chrome
          // sometimes maps to right-click on touchpads) doesn't
          // pop the menu mid-pan.
          if (dragRef.current) e.preventDefault();
        }}
        onClick={(e) => {
          // Polygon-vertex picker. Active when overlay-mask or TBR
          // ROI draw mode is on. Hit-test math + letterbox handling
          // lives in ./playback/RoiOverlay.tsx so the math has one
          // owner — see that file's header for why getScreenCTM()
          // can't be used here.
          if (!url || !recording?.shape || !svgRef.current) return;
          const drawingOverlay = !!view.overlayDrawMode;
          const tbrRole = view.tbrDraftRole;
          if (!drawingOverlay && !tbrRole) return;
          const ih = recording.shape[0] || 1;
          const iw = recording.shape[1] || 1;
          const hit = _clientToImagePx({
            svgEl: svgRef.current,
            imageW: iw,
            imageH: ih,
            clientX: e.clientX,
            clientY: e.clientY,
          });
          if (!hit) return;
          const { ix, iy } = hit;
          if (drawingOverlay) {
            const ov = view.overlay || {};
            const prev = Array.isArray(ov.maskPolygon) ? ov.maskPolygon : [];
            onUpdate({ overlay: { ...ov, maskPolygon: [...prev, [ix, iy]] } });
          } else if (tbrRole === 'tumor' || tbrRole === 'background') {
            const draft = view.tbrDraft || {};
            const key = tbrRole === 'tumor' ? 'tumorPolygon' : 'bgPolygon';
            const prev = Array.isArray(draft[key]) ? draft[key] : [];
            onUpdate({ tbrDraft: { ...draft, [key]: [...prev, [ix, iy]] } });
          }
          e.stopPropagation();
        }}
        onWheel={(e) => {
          // Mouse-wheel zoom centred on the cursor. preventDefault
          // stops the browser from scrolling the inspector when the
          // wheel hits the canvas. Step is ±10% per notch — clamped
          // to [0.1, 32]× so the user can zoom WAY in on a USAF bar
          // and back out without losing the image.
          if (!url) return;
          e.preventDefault();
          e.stopPropagation();
          const cur = view.zoom || 1;
          const factor = Math.exp(-e.deltaY * 0.0015);
          const next = Math.max(0.1, Math.min(32, cur * factor));
          if (Math.abs(next - cur) < 1e-4) return;
          // Pivot zoom around the cursor: shift pan so the point
          // under the mouse stays under the mouse after the scale.
          const rect = e.currentTarget.getBoundingClientRect();
          const cx = e.clientX - rect.left - rect.width / 2;
          const cy = e.clientY - rect.top - rect.height / 2;
          const ratio = next / cur;
          const px = view.panX || 0;
          const py = view.panY || 0;
          const nextPanX = cx - (cx - px) * ratio;
          const nextPanY = cy - (cy - py) * ratio;
          onUpdate({ zoom: next, panX: nextPanX, panY: nextPanY });
        }}
        onDoubleClick={(e) => {
          // Double-click resets zoom + pan to fit-to-canvas. While
          // drawing an ROI, double-click does NOTHING (the legacy
          // double-click-to-finish behaviour was removed in favour
          // of an explicit Done button in the Inspector — accidental
          // double-clicks were committing half-finished polygons).
          if (!url) return;
          if (view.overlayDrawMode || view.tbrDraftRole) return;
          e.preventDefault();
          e.stopPropagation();
          if ((view.zoom || 1) === 1 && !view.panX && !view.panY) return;
          onUpdate({ zoom: 1, panX: 0, panY: 0 });
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
              // Pan + zoom transform applied via CSS so the image
              // stays GPU-composited (no JS reflow per wheel notch).
              transform: `translate(${view.panX || 0}px, ${view.panY || 0}px) scale(${view.zoom || 1})`,
              transformOrigin: 'center center',
              filter: view.showRaw
                ? 'none'
                : `brightness(${view.brightness}) contrast(${view.contrast}) saturate(${view.saturation})${view.invert ? ' invert(1)' : ''}`,
              transition: 'filter 0.1s linear',
              willChange: 'transform',
            }}
          />
        )}
        {url && (view.zoom || 1) > 1.001 && (
          <div
            style={{
              position: 'absolute',
              left: 8,
              bottom: 8,
              padding: '2px 6px',
              fontSize: 10,
              fontFamily: 'ui-monospace,Menlo,monospace',
              background: 'rgba(0,0,0,0.55)',
              color: '#fff',
              borderRadius: 3,
              pointerEvents: 'none',
            }}
          >
            {(view.zoom || 1).toFixed(2)}×
          </div>
        )}
        {/* ROI polygon overlay (overlay-mode mask AND TBR Tumor /
            Background drafts). Render delegated to RoiOverlaySvg —
            see ./playback/RoiOverlay.tsx for the JSX. */}
        {url && recording?.shape && (
          <_RoiOverlaySvg
            ref={svgRef}
            imageW={recording.shape[1] || 1}
            imageH={recording.shape[0] || 1}
            overlayPts={
              meta.kind === 'overlay' && Array.isArray((view.overlay || {}).maskPolygon)
                ? (view.overlay || {}).maskPolygon
                : []
            }
            tumorPts={
              Array.isArray((view.tbrDraft || {}).tumorPolygon)
                ? (view.tbrDraft || {}).tumorPolygon
                : []
            }
            bgPts={
              Array.isArray((view.tbrDraft || {}).bgPolygon) ? (view.tbrDraft || {}).bgPolygon : []
            }
            panX={view.panX}
            panY={view.panY}
            zoom={view.zoom}
            hint={
              view.overlayDrawMode || view.tbrDraftRole
                ? `click to add vertex · ESC / Enter to finish · Backspace to undo${
                    view.tbrDraftRole ? ` · drawing ${view.tbrDraftRole.toUpperCase()}` : ''
                  }`
                : null
            }
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
  const ref = React.useRef(null);
  // Click-outside / Esc closes the menu. Run in capture phase so a click
  // on a menu item runs its onClick before the close handler unmounts.
  React.useEffect(() => {
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
  const popoverRef = React.useRef(null);

  // Click-outside / Escape to close. Bind once per mount.
  React.useEffect(() => {
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
  const [selected, setSelected] = React.useState(() => new Set(otherViews.map((v) => v.id)));
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

const FPS_PRESETS = [1, 2, 5, 10, 15, 24, 30, 48, 60, 90, 120, 240];
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
  const minimapRef = React.useRef(null);
  const startBrushDrag = React.useCallback(
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
  const [format, setFormat] = React.useState('mp4');
  // M17: when a brush is active, default to its bounds; otherwise default
  // to the full stream. Spinboxes below are locked when `rangeLocked` is
  // true, with a Clear button that maps to the parent's onClearRange.
  const rangeLocked = !!rangeSelection;
  const [start, setStart] = React.useState(rangeSelection ? rangeSelection[0] : 0);
  const [end, setEnd] = React.useState(
    rangeSelection ? rangeSelection[1] : Math.max(0, totalFrames - 1)
  );
  // Sync local Spinbox state with the parent brush whenever the user
  // drags handles while the modal is open.
  React.useEffect(() => {
    if (rangeSelection) {
      setStart(rangeSelection[0]);
      setEnd(rangeSelection[1]);
    }
  }, [rangeSelection?.[0], rangeSelection?.[1]]);
  const [outFps, setOutFps] = React.useState(defaultFps || 10);
  const [busy, setBusy] = React.useState(false);
  // M24: tiled video export — layout chooser visible when 2+ views.
  // Default 'auto' picks a sensible grid based on N.
  const tiledAvailable = viewCount > 1;
  const [layout, setLayout] = React.useState('auto');

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
              onChange={(v) => setOutFps(Math.max(0.1, Math.min(240, Number(v) || 10)))}
              min={0.1}
              max={240}
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
  const [layout, setLayout] = React.useState('auto');
  const [format, setFormat] = React.useState('png');
  const [scope, setScope] = React.useState('visible'); // 'visible' | 'selected' | 'custom'
  const [customSet, setCustomSet] = React.useState(() => new Set(views.map((v) => v.id)));
  const [gap, setGap] = React.useState(6);
  const [background, setBackground] = React.useState('#000000');
  const [busy, setBusy] = React.useState(false);

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
  const [draft, setDraft] = React.useState(orderedRecordings.map((r) => r.source_id));
  const [thresh, setThresh] = React.useState(continuityThreshold);
  const [dragIdx, setDragIdx] = React.useState(null);
  // M19: quarantined source ids — present in `orderedRecordings` (so the
  // user keeps them in Sources) but excluded from the active stream.
  // Authoritative for the Apply payload + the Summary card.
  const [quarantined, setQuarantined] = React.useState(new Set());
  // M19: which row's per-row metadata block is expanded. One at a time.
  const [expandedSid, setExpandedSid] = React.useState(null);

  const allDraftRecs = React.useMemo(
    () => draft.map((sid) => orderedRecordings.find((r) => r.source_id === sid)).filter(Boolean),
    [draft, orderedRecordings]
  );
  const draftRecs = React.useMemo(
    () => allDraftRecs.filter((r) => !quarantined.has(r.source_id)),
    [allDraftRecs, quarantined]
  );
  const quarantinedRecs = React.useMemo(
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
  const warnings = React.useMemo(() => detectContinuity(draftRecs, thresh), [draftRecs, thresh]);
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
//
// Forwards the active view's ISP corrections (black_level, gain,
// offset, sharpen / denoise / median / gauss / hot-pixel / bilateral)
// so the histogram represents the post-ISP frame the user is actually
// looking at on the canvas — without this the on-screen histogram
// showed pre-correction DN counts and the vmin/vmax markers landed
// on the wrong bins after any Corrections edit.
const useChannelHistograms = (recording, traces, localFrame, view) => {
  const [data, setData] = React.useState([]);
  const tracesKey = (traces || []).map((tr) => tr.channel).join('|');
  // Build a stable signature of the post-ISP-relevant view fields so
  // the effect re-fires when (and only when) the rendered pixels
  // actually change.
  const ispSig = React.useMemo(() => {
    if (!view) return '';
    const ip = view.isp || {};
    return [
      view.applyDark === false ? '0' : '1',
      view.blackLevel ?? 0,
      view.gain ?? 1,
      view.offset ?? 0,
      ip.sharpen_method || '',
      ip.sharpen_amount ?? '',
      ip.sharpen_radius ?? '',
      ip.denoise_sigma ?? '',
      ip.median_size ?? '',
      ip.gaussian_sigma ?? '',
      ip.hot_pixel_thr ?? '',
      ip.bilateral ? '1' : '0',
    ].join('|');
  }, [view]);
  React.useEffect(() => {
    if (!recording || !traces || traces.length === 0 || localFrame == null) {
      setData([]);
      return undefined;
    }
    const v = view || {};
    const ip = v.isp || {};
    const buildUrl = (ch) => {
      const q = new URLSearchParams({ bins: '64' });
      if (v.applyDark === false) q.set('apply_dark', 'false');
      if (v.blackLevel != null && v.blackLevel !== 0) q.set('black_level', String(v.blackLevel));
      if (v.gain != null && Math.abs(v.gain - 1) > 1e-6) q.set('gain', String(v.gain));
      if (v.offset != null && v.offset !== 0) q.set('offset', String(v.offset));
      if (ip.sharpen_method && ip.sharpen_method !== 'None') {
        q.set('sharpen_method', ip.sharpen_method);
        if (ip.sharpen_amount != null) q.set('sharpen_amount', String(ip.sharpen_amount));
        if (ip.sharpen_radius != null) q.set('sharpen_radius', String(ip.sharpen_radius));
      }
      if (ip.denoise_sigma) q.set('denoise_sigma', String(ip.denoise_sigma));
      if (ip.median_size) q.set('median_size', String(ip.median_size));
      if (ip.gaussian_sigma) q.set('gaussian_sigma', String(ip.gaussian_sigma));
      if (ip.hot_pixel_thr) q.set('hot_pixel_thr', String(ip.hot_pixel_thr));
      if (ip.bilateral) q.set('bilateral', 'true');
      return `/api/sources/${recording.source_id}/frame/${localFrame}/channel/${encodeURIComponent(ch)}/histogram?${q.toString()}`;
    };
    let alive = true;
    Promise.all(
      traces.map((tr) =>
        apiFetch(buildUrl(tr.channel))
          .then((d) => ({ channel: tr.channel, color: tr.color, hist: d }))
          .catch(() => null)
      )
    ).then((rows) => {
      if (alive) setData(rows.filter(Boolean));
    });
    return () => {
      alive = false;
    };
  }, [recording?.source_id, tracesKey, localFrame, ispSig]);
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
  // (forwards `view` into useChannelHistograms below so the overlay
  // histogram reflects the post-ISP frame)
  const t = useTheme();
  const traces = histogramTracesFor(view, recording);
  const histRows = useChannelHistograms(recording, traces, localFrame, view);
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
  const histRows = useChannelHistograms(recording, traces, localFrame, view);
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
  // TBR Analysis — table state lives at PlaybackMode level so the
  // analysis modal can read every committed entry.
  tbrEntries = [],
  setTbrEntries,
  setTbrAnalysisOpen,
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
              <GradeRow
                label="Black level"
                value={selectedView.blackLevel ?? 0}
                onChange={(v) => onUpdateView(selectedView.id, { blackLevel: Number(v) })}
                min={0}
                max={65535}
                step={1}
                format={(v) => Math.round(Number(v)).toString()}
                testId="inspector-black-level"
              />
              <GradeRow
                label="Gain"
                value={selectedView.gain ?? 1.0}
                onChange={(v) => onUpdateView(selectedView.id, { gain: Number(v) })}
                min={0}
                max={64}
                step={0.05}
                format={(v) => Number(v).toFixed(2)}
                testId="inspector-gain"
              />
              <GradeRow
                label="Offset"
                value={selectedView.offset ?? 0}
                onChange={(v) => onUpdateView(selectedView.id, { offset: Number(v) })}
                min={-65535}
                max={65535}
                step={1}
                format={(v) => Math.round(Number(v)).toString()}
                testId="inspector-offset"
              />
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
                    <GradeRow
                      label="Low threshold"
                      value={selectedView.vmin ?? 0}
                      onChange={(v) => onUpdateView(selectedView.id, { vmin: Number(v) })}
                      min={0}
                      max={65535}
                      step={1}
                      format={(v) => Math.round(Number(v)).toString()}
                      testId="inspector-vmin"
                    />
                    <GradeRow
                      label="High threshold"
                      value={selectedView.vmax ?? 65535}
                      onChange={(v) => onUpdateView(selectedView.id, { vmax: Number(v) })}
                      min={0}
                      max={65535}
                      step={1}
                      format={(v) => Math.round(Number(v)).toString()}
                      testId="inspector-vmax"
                    />
                    <Row label="Auto thresholds">
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={async () => {
                          // Snap vmin/vmax to the channel's 1st / 99th
                          // percentile so the slider numbers reflect
                          // what the canvas actually clips at.
                          const ch =
                            sourceModeMeta(selectedView.sourceMode).kind === 'channel'
                              ? sourceModeMeta(selectedView.sourceMode).channel
                              : selectedView.rawChannel;
                          if (!selectedRecording || !ch) {
                            onUpdateView(selectedView.id, { vmin: null, vmax: null });
                            return;
                          }
                          try {
                            const r = await apiFetch(
                              `/api/sources/${selectedRecording.source_id}/channel/${encodeURIComponent(ch)}/range`
                            );
                            onUpdateView(selectedView.id, {
                              vmin: Math.round(r?.p1 ?? r?.min ?? 0),
                              vmax: Math.round(r?.p99 ?? r?.max ?? 65535),
                            });
                          } catch {
                            onUpdateView(selectedView.id, { vmin: null, vmax: null });
                          }
                        }}
                        title="Snap to 1st / 99th percentile of the active channel"
                      >
                        Auto
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
                  const fmt2 = (v) => Number(v).toFixed(2);
                  const fmtKelvin = (v) => `${Math.round(Number(v))} K`;
                  return (
                    <>
                      <GradeRow
                        label="Gain R"
                        value={g.gain_r ?? 1.0}
                        onChange={(v) => setG({ gain_r: Number(v) })}
                        min={0}
                        max={4}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-gain-r"
                      />
                      <GradeRow
                        label="Gain G"
                        value={g.gain_g ?? 1.0}
                        onChange={(v) => setG({ gain_g: Number(v) })}
                        min={0}
                        max={4}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-gain-g"
                      />
                      <GradeRow
                        label="Gain B"
                        value={g.gain_b ?? 1.0}
                        onChange={(v) => setG({ gain_b: Number(v) })}
                        min={0}
                        max={4}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-gain-b"
                      />
                      <GradeRow
                        label="Offset R"
                        value={g.offset_r ?? 0}
                        onChange={(v) => setG({ offset_r: Number(v) })}
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        format={fmt2}
                        testId="inspector-offset-r"
                      />
                      <GradeRow
                        label="Offset G"
                        value={g.offset_g ?? 0}
                        onChange={(v) => setG({ offset_g: Number(v) })}
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        format={fmt2}
                        testId="inspector-offset-g"
                      />
                      <GradeRow
                        label="Offset B"
                        value={g.offset_b ?? 0}
                        onChange={(v) => setG({ offset_b: Number(v) })}
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        format={fmt2}
                        testId="inspector-offset-b"
                      />
                      <GradeRow
                        label="WB Kelvin"
                        value={g.wb_kelvin ?? 6500}
                        onChange={(v) => setG({ wb_kelvin: Number(v) })}
                        min={3000}
                        max={10000}
                        step={50}
                        format={fmtKelvin}
                        testId="inspector-wb-kelvin"
                      />
                      <GradeRow
                        label="Gamma"
                        value={g.gamma ?? 1.0}
                        onChange={(v) => setG({ gamma: Number(v) })}
                        min={0.2}
                        max={3.0}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-grading-gamma"
                      />
                      <GradeRow
                        label="Brightness"
                        value={g.brightness ?? 0}
                        onChange={(v) => setG({ brightness: Number(v) })}
                        min={-0.5}
                        max={0.5}
                        step={0.01}
                        format={fmt2}
                        testId="inspector-grading-brightness"
                      />
                      <GradeRow
                        label="Contrast"
                        value={g.contrast ?? 1.0}
                        onChange={(v) => setG({ contrast: Number(v) })}
                        min={0.2}
                        max={3.0}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-grading-contrast"
                      />
                      <GradeRow
                        label="Saturation"
                        value={g.saturation ?? 1.0}
                        onChange={(v) => setG({ saturation: Number(v) })}
                        min={0}
                        max={3.0}
                        step={0.02}
                        format={fmt2}
                        testId="inspector-grading-saturation"
                      />
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginTop: 8,
                          flexWrap: 'wrap',
                          alignItems: 'center',
                        }}
                      >
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={autoWb}
                          data-inspector-auto-wb
                          title="Auto white balance (gray-world)"
                        >
                          Auto WB
                        </Button>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => setG({ wb_kelvin: null })}
                          title="Clear WB shift"
                        >
                          Clear WB
                        </Button>
                        <div style={{ flex: 1 }} />
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
                      </div>
                      <div
                        style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.5 }}
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

            <InspectorSection
              title="TBR Analysis"
              icon="grid"
              viewType={selectedView.sourceMode}
              defaultOpen={false}
            >
              <TbrAnalysisPanel
                view={selectedView}
                recording={selectedRecording}
                localFrame={
                  selectedView.isLocked && selectedView.lockedFrame != null
                    ? selectedView.lockedFrame
                    : Math.max(
                        0,
                        Math.min(
                          (globalFrame ?? 0) - (sourceOffsets?.get(selectedView.sourceId) ?? 0),
                          (selectedRecording?.frame_count || 1) - 1
                        )
                      )
                }
                entries={tbrEntries}
                onUpdateView={(patch) => onUpdateView(selectedView.id, patch)}
                onAddEntry={(entry) => setTbrEntries((prev) => [...prev, entry])}
                onRemoveEntry={(id) => setTbrEntries((prev) => prev.filter((e) => e.id !== id))}
                onUpdateEntry={(id, patch) =>
                  setTbrEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
                }
                onOpenAnalysis={() => setTbrAnalysisOpen(true)}
              />
            </InspectorSection>

            <InspectorSection title="Advanced" icon="info" viewType={selectedView.sourceMode}>
              <FrameCacheBudgetControl />
              <div
                style={{
                  fontSize: 10,
                  color: t.textMuted,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  lineHeight: 1.6,
                  marginTop: 10,
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
        Every overlay is configured through the 4-step Overlay Builder. Click below to pick the base
        layer, the overlay channel, the blend mode, and the thresholds; on Apply, this view switches
        to the custom-overlay render path.
        {onOpenBuilder && (
          <div style={{ marginTop: 8 }}>
            <Button
              size="sm"
              variant="primary"
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
      <GradeRow
        label="Overlay low"
        value={ov.overlayLow ?? 0}
        onChange={(v) => setOv({ overlayLow: Number(v) })}
        min={0}
        max={65535}
        step={1}
        format={(v) => Math.round(Number(v)).toString()}
        testId="overlay-low"
      />
      <GradeRow
        label="Overlay high"
        value={ov.overlayHigh ?? 65535}
        onChange={(v) => setOv({ overlayHigh: Number(v) })}
        min={0}
        max={65535}
        step={1}
        format={(v) => Math.round(Number(v)).toString()}
        testId="overlay-high"
      />
      <Row label="Auto thresholds">
        <Button
          size="sm"
          variant="subtle"
          onClick={async () => {
            // Fetch 1st / 99.5th percentile defaults from the actual
            // overlay channel + write them into the slider state so
            // the user SEES the numbers they're now using (the old
            // behaviour set both fields to null and rendered with the
            // server-side default — confusing because the inputs went
            // blank-zero).
            const ch = ov.overlayChannel;
            if (!recording || !ch) {
              setOv({ overlayLow: null, overlayHigh: null });
              return;
            }
            try {
              const r = await apiFetch(
                `/api/sources/${recording.source_id}/channel/${encodeURIComponent(ch)}/range`
              );
              const lo = r?.p1 ?? r?.min ?? 0;
              const hi = r?.p99 ?? r?.max ?? 65535;
              setOv({
                overlayLow: Math.round(lo),
                overlayHigh: Math.round(hi),
              });
            } catch {
              setOv({ overlayLow: null, overlayHigh: null });
            }
          }}
          title="Snap low/high to the 1st / 99th percentile of the overlay channel"
        >
          Auto
        </Button>
      </Row>
      <Row label="ROI polygon">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            size="sm"
            variant={view.overlayDrawMode ? 'primary' : 'subtle'}
            onClick={() =>
              onUpdate({
                overlayDrawMode: !view.overlayDrawMode,
                // Starting fresh: clear any previous polygon so the
                // user always begins on an empty canvas.
                overlay: view.overlayDrawMode ? ov : { ...ov, maskPolygon: [] },
              })
            }
            title="Click on the canvas to drop polygon vertices; double-click finishes."
            data-overlay-draw-toggle
          >
            {view.overlayDrawMode ? 'Finish' : 'Draw ROI…'}
          </Button>
          <Button
            size="sm"
            variant="subtle"
            disabled={!Array.isArray(ov.maskPolygon) || ov.maskPolygon.length === 0}
            onClick={() => {
              setOv({ maskPolygon: [] });
              if (view.overlayDrawMode) onUpdate({ overlayDrawMode: false });
            }}
            title="Remove the polygon ROI; overlay applies to the whole frame."
          >
            Clear
          </Button>
          <span style={{ fontSize: 10.5, color: t.textFaint }}>
            {Array.isArray(ov.maskPolygon) && ov.maskPolygon.length > 0
              ? `${ov.maskPolygon.length} pts · overlay only inside`
              : 'no ROI · overlay everywhere'}
          </span>
        </div>
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
  const meta = sourceModeMeta(view.sourceMode);
  const split = splitSourceMode(view.sourceMode);
  // The view's own sourceMode is the canonical source of truth for what is
  // ACTUALLY rendered on the canvas. The recording's `gainPref` is just a
  // hint for picking a default when a fresh view spawns. Reading view first
  // keeps the Inspector Gain segmented control in sync with the rendered
  // image after stream-follow rebinds across file boundaries — without
  // this, crossing into a recording whose `gainPref` is null (or a stale
  // default) would snap the Gain UI back to HG even though the view is
  // still rendering LG / HDR per its preserved sourceMode.
  const viewGain = (split.gain || '').toUpperCase();
  const activeGain =
    viewGain && gains.includes(viewGain) ? viewGain : recording?.gainPref || (gains[0] ?? null);
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
        <>
          {/* B-0040 — HDR fusion mode toggle. 'switch' is the
              cached default (hard threshold; visible seam at HG
              saturation). 'mertens' re-fuses at render time with a
              smoothstep blend so the seam disappears. The backend
              honors the param only for HDR-* channels; non-HDR
              renders ignore it. */}
          <Row label="Fusion">
            <Segmented
              value={view.hdrFusion || 'switch'}
              onChange={(v) => onUpdateView(view.id, { hdrFusion: v })}
              options={[
                { value: 'switch', label: 'Hard switch' },
                { value: 'mertens', label: 'Smooth (Mertens)' },
              ]}
              data-inspector-hdr-fusion
            />
          </Row>
          <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 0' }}>
            HDR fusion exposes only the merged Chroma (Y) channel; per-channel R/G/B aren&apos;t
            available under HDR. Smooth (Mertens) blends near the HG saturation knee — try it if the
            hard-switch seam is visible on your data.
          </div>
        </>
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

// GradeRow — single-row label / slider / numeric for the RGB Grading panel.
// The shared `Slider` primitive stacks label-row + track on two lines, and
// wrapping it in a `Row` adds a third for the section's own label column,
// which left the grading panel with 3 visual rows per parameter. This puts
// label, slider, and click-to-edit numeric on a single line.
const GradeRow = ({ label, value, onChange, min, max, step, format, testId }) => {
  const t = useTheme();
  const [editing, setEditing] = React.useState(false);
  const safeFormat = format || ((v) => Number(v).toFixed(2));
  const numericText = safeFormat(value);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 4,
        minHeight: 22,
        minWidth: 0,
      }}
    >
      <span
        style={{
          flex: '0 0 auto',
          minWidth: 64,
          maxWidth: 88,
          fontSize: 11,
          color: t.textMuted,
          lineHeight: 1.2,
        }}
        title={typeof label === 'string' ? label : undefined}
      >
        {label}
      </span>
      <input
        type="range"
        aria-label={typeof label === 'string' ? label : 'value slider'}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="rgbnir-slider"
        data-testid={testId}
        style={{
          flex: 1,
          minWidth: 0,
          height: 18,
          appearance: 'none',
          WebkitAppearance: 'none',
          background: 'transparent',
          cursor: 'pointer',
          margin: 0,
        }}
      />
      {editing ? (
        <input
          type="number"
          autoFocus
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
            flex: '0 0 auto',
            width: 56,
            fontSize: 11,
            padding: '1px 4px',
            background: t.inputBg,
            color: t.text,
            border: `1px solid ${t.accent}`,
            borderRadius: 3,
            fontFamily: 'ui-monospace,Menlo,monospace',
            textAlign: 'right',
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            flex: '0 0 auto',
            minWidth: 44,
            fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
            fontSize: 10.5,
            color: t.text,
            textAlign: 'right',
            cursor: 'text',
            padding: '1px 4px',
            borderRadius: 3,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = t.chipBg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          title="Click to type a value"
        >
          {numericText}
        </span>
      )}
    </div>
  );
};

// FrameCacheBudgetControl — Inspector → Advanced setting that lets the
// user pick how much RAM the frame blob cache may consume. The ceiling
// is fetched from /api/system/info (which reads the host OS via psutil
// or sysctl on macOS), capped at 80% of physical RAM. Falls back to
// `navigator.deviceMemory` (bucketed/capped at 8 GB on Chromium) only
// if the API call fails. The value persists in localStorage and
// applies live (the LRU trim runs immediately when shrunk). Default
// of 64 MB matches the prior implicit budget (~384 entries × 150 KB).
// TbrAnalysisPanel — Inspector section. Owns the per-view drafting
// flow for tumor + background ROIs and the entry-commit button. The
// committed entries themselves live at PlaybackMode level so they
// survive view switches and feed the TBR analysis modal.
//
// Pipeline matches the rest of the inspector ISP chain: the backend
// /roi-stats route applies dark subtraction + black_level BEFORE
// computing the requested statistic (mean / percentile / mode). TBR
// = tumor_value / background_value; ratio std uses standard error
// propagation σ_R/R = sqrt((σ_T/T)² + (σ_B/B)²).
const TbrAnalysisPanel = ({
  view,
  recording,
  localFrame,
  entries,
  onUpdateView,
  onAddEntry,
  onRemoveEntry,
  onUpdateEntry,
  onOpenAnalysis,
}) => {
  const t = useTheme();
  const draft = view?.tbrDraft || {};
  const drawRole = view?.tbrDraftRole || null;
  // The TBR is computed on the channel the user is viewing. RGB views
  // fall back to the green channel (strongest tissue signal in vis).
  const meta = view ? sourceModeMeta(view.sourceMode) : null;
  const split = view ? splitSourceMode(view.sourceMode) : { gain: '', channelKind: '' };
  const gainPrefix = (split.gain || 'HG').toUpperCase();
  const tbrChannel =
    draft.channel ||
    (meta?.kind === 'channel'
      ? meta.channel
      : meta?.kind === 'raw' && view?.rawChannel
        ? view.rawChannel
        : `${gainPrefix}-G`);
  const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(2));
  const setDraft = (patch) => onUpdateView({ tbrDraft: { ...draft, ...patch } });
  const setRole = (role) => onUpdateView({ tbrDraftRole: role });
  // Snapshot the linear ISP knobs the canvas applies so /roi-stats can
  // run sharpen/FPN/gain/offset on the same array. Tone curve
  // (brightness/contrast/gamma) is intentionally omitted — TBR stays
  // in physical-DN-scaled-by-gain units.
  const buildViewConfig = (v) => {
    if (!v) return {};
    const ip = v.isp || {};
    return {
      gain: v.gain ?? 1.0,
      offset: v.offset ?? 0.0,
      sharpen_method: ip.sharpen_method || null,
      sharpen_amount: ip.sharpen_amount ?? 1.0,
      sharpen_radius: ip.sharpen_radius ?? 2.0,
      denoise_sigma: ip.denoise_sigma ?? 0.0,
      median_size: ip.median_size ?? 0,
      gaussian_sigma: ip.gaussian_sigma ?? 0.0,
      hot_pixel_thr: ip.hot_pixel_thr ?? 0.0,
      bilateral: !!ip.bilateral,
    };
  };
  // Stable signature so the auto-recompute effect re-fires whenever any
  // ISP knob the canvas honors changes. JSON.stringify of view_config is
  // small (<200 chars) and avoids tracking each field separately. Memo
  // the recompute so a slider drag doesn't pay the JSON.stringify cost
  // on every parent re-render.
  const viewConfigSig = React.useMemo(
    () => JSON.stringify(buildViewConfig(view)),
    // buildViewConfig only reads view.isp, view.gain, view.offset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view?.isp, view?.gain, view?.offset]
  );
  // Monotonic per-kind counter used to drop stale /roi-stats responses.
  // apiFetch has no AbortSignal plumbing, so a slider drag that triggers
  // many requests can land out-of-order; we only keep the response from
  // the *latest* dispatched request per kind ('tumor' / 'background').
  const reqSeqRef = React.useRef({ tumor: 0, background: 0 });
  const computeStats = async (kind) => {
    if (!recording) return;
    const polygon = kind === 'tumor' ? draft.tumorPolygon : draft.bgPolygon;
    if (!Array.isArray(polygon) || polygon.length < 3) return;
    const seq = ++reqSeqRef.current[kind];
    try {
      const body = {
        polygon,
        method: draft.method || 'mean',
        percentile: draft.percentile ?? 50,
        apply_dark: view?.applyDark !== false,
        black_level: view?.blackLevel ?? 0,
        view_config: buildViewConfig(view),
      };
      const stats = await apiFetch(
        `/api/sources/${recording.source_id}/frame/${localFrame}/channel/${encodeURIComponent(tbrChannel)}/roi-stats`,
        { method: 'POST', body }
      );
      // Drop stale response: a newer dispatch has been issued.
      if (seq !== reqSeqRef.current[kind]) return;
      if (kind === 'tumor') setDraft({ tumorStats: stats });
      else setDraft({ bgStats: stats });
    } catch (err) {
      if (seq !== reqSeqRef.current[kind]) return;
      const msg = err?.detail || err?.message || String(err);
      if (kind === 'tumor') setDraft({ tumorStats: { __error: msg } });
      else setDraft({ bgStats: { __error: msg } });
    }
  };
  // ESC / Enter while drawing exits draw mode (alternative to clicking
  // Done). ESC + Backspace can also pop the last vertex (matches the
  // Undo button). Listener is bound at window level + only acts when
  // an ROI is being drawn — typing in another input is unaffected.
  React.useEffect(() => {
    if (!drawRole) return undefined;
    const onKey = (e) => {
      const tgt = e.target;
      const typing =
        tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      if (typing && e.key !== 'Escape') return;
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        setRole(null);
      } else if (e.key === 'Backspace' && !typing) {
        e.preventDefault();
        e.stopPropagation();
        const polyKey = drawRole === 'tumor' ? 'tumorPolygon' : 'bgPolygon';
        const cur = draft[polyKey] || [];
        if (cur.length > 0) setDraft({ [polyKey]: cur.slice(0, -1) });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawRole, draft.tumorPolygon, draft.bgPolygon]);
  // Re-run stats automatically when polygon vertices, method, percentile,
  // black_level, apply_dark, or any ISP/gain/offset knob honored by the
  // canvas changes AND we have ≥ 3 vertices. viewConfigSig collapses the
  // ISP chain into one stable string so a slider drag triggers exactly
  // one effect fire.
  //
  // Debounced 120 ms so rapid-clicking polygon vertices doesn't pelt
  // the server with one POST per vertex. ``reqSeqRef`` already drops
  // out-of-order responses; the debounce trims the request count too.
  React.useEffect(() => {
    if (!Array.isArray(draft.tumorPolygon) || draft.tumorPolygon.length < 3) return;
    const t = setTimeout(() => computeStats('tumor'), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(draft.tumorPolygon || []),
    draft.method,
    draft.percentile,
    view?.applyDark,
    view?.blackLevel,
    viewConfigSig,
    tbrChannel,
    recording?.source_id,
    localFrame,
  ]);
  React.useEffect(() => {
    if (!Array.isArray(draft.bgPolygon) || draft.bgPolygon.length < 3) return;
    const t = setTimeout(() => computeStats('background'), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    JSON.stringify(draft.bgPolygon || []),
    draft.method,
    draft.percentile,
    view?.applyDark,
    view?.blackLevel,
    viewConfigSig,
    tbrChannel,
    recording?.source_id,
    localFrame,
  ]);
  const tumorVal = draft.tumorStats?.computed_value;
  const tumorStd = draft.tumorStats?.std;
  const bgVal = draft.bgStats?.computed_value;
  const bgStd = draft.bgStats?.std;
  const ratio =
    tumorVal != null && bgVal && Number.isFinite(bgVal) && bgVal !== 0 ? tumorVal / bgVal : null;
  const ratioStd =
    ratio != null && tumorVal && bgVal
      ? ratio * Math.sqrt(((tumorStd || 0) / tumorVal) ** 2 + ((bgStd || 0) / bgVal) ** 2)
      : null;
  const canAdd =
    draft.tumorStats &&
    !draft.tumorStats.__error &&
    draft.bgStats &&
    !draft.bgStats.__error &&
    ratio != null;
  const commit = () => {
    if (!canAdd || !recording) return;
    // Pipeline version follows the larger of the two stat responses; if
    // either stat is missing the field, the entry inherits v1 semantics.
    const tumorPipe = draft.tumorStats?.pipeline_version ?? 1;
    const bgPipe = draft.bgStats?.pipeline_version ?? 1;
    const entry = {
      id: `tbr_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      sourceFile: recording.name,
      sourceId: recording.source_id,
      frameIndex: localFrame,
      channel: tbrChannel,
      method: draft.method || 'mean',
      percentile: draft.percentile ?? 50,
      applyDark: view?.applyDark !== false,
      blackLevel: view?.blackLevel ?? 0,
      // Snapshot of the linear ISP chain that produced these stats so
      // the analysis modal can show "which ISP was active" and a
      // Recompute action knows the diff against the live view.
      viewConfig: buildViewConfig(view),
      pipelineVersion: Math.min(tumorPipe, bgPipe),
      tumorPolygon: draft.tumorPolygon,
      bgPolygon: draft.bgPolygon,
      tumorValue: tumorVal,
      tumorStd: tumorStd,
      tumorMean: draft.tumorStats?.mean,
      tumorMedian: draft.tumorStats?.median,
      tumorMode: draft.tumorStats?.mode,
      tumorPercentileValue: draft.tumorStats?.percentile_value,
      tumorN: draft.tumorStats?.n_pixels,
      bgValue: bgVal,
      bgStd: bgStd,
      bgMean: draft.bgStats?.mean,
      bgMedian: draft.bgStats?.median,
      bgMode: draft.bgStats?.mode,
      bgPercentileValue: draft.bgStats?.percentile_value,
      bgN: draft.bgStats?.n_pixels,
      ratio,
      ratioStd,
      createdAt: new Date().toISOString(),
    };
    onAddEntry(entry);
    // Reset draft so the user can immediately measure another pair.
    onUpdateView({
      tbrDraft: {
        ...draft,
        tumorPolygon: [],
        bgPolygon: [],
        tumorStats: null,
        bgStats: null,
      },
      tbrDraftRole: null,
    });
  };
  // Recompute a committed entry under the current live view_config. Used
  // to refresh v1 entries (committed before the linear-ISP fix) onto v2
  // semantics, or to compare a v2 entry against the user's latest knobs.
  // The entry's polygon, frame, channel, and source stay locked; only
  // the post-extract math changes.
  const [recomputingId, setRecomputingId] = React.useState(null);
  const recomputeEntry = async (entry) => {
    if (!entry || !entry.sourceId || !onUpdateEntry) return;
    setRecomputingId(entry.id);
    try {
      const baseUrl = `/api/sources/${entry.sourceId}/frame/${entry.frameIndex}/channel/${encodeURIComponent(entry.channel)}/roi-stats`;
      const cfg = buildViewConfig(view);
      const baseBody = {
        method: entry.method || 'mean',
        percentile: entry.percentile ?? 50,
        apply_dark: view?.applyDark !== false,
        black_level: view?.blackLevel ?? 0,
        view_config: cfg,
      };
      // Local names are *T / *B (not tumorStd / bgStd) on purpose: the
      // outer TbrAnalysisPanel scope already binds `tumorStd` and
      // `bgStd` to draft.{tumorStats,bgStats}?.std (used for the live
      // ratioStd display). Using the same names here would silently
      // shadow and write the *draft's* std into the entry instead of
      // the recomputed std.
      const [statsT, statsB] = await Promise.all([
        apiFetch(baseUrl, {
          method: 'POST',
          body: { ...baseBody, polygon: entry.tumorPolygon },
        }),
        apiFetch(baseUrl, {
          method: 'POST',
          body: { ...baseBody, polygon: entry.bgPolygon },
        }),
      ]);
      const tV = statsT?.computed_value;
      const bV = statsB?.computed_value;
      const tStd = statsT?.std ?? 0;
      const bStd = statsB?.std ?? 0;
      const newRatio = bV && Number.isFinite(bV) && bV !== 0 && tV != null ? tV / bV : null;
      const newRatioStd =
        newRatio != null && tV && bV
          ? newRatio * Math.sqrt((tStd / tV) ** 2 + (bStd / bV) ** 2)
          : null;
      onUpdateEntry(entry.id, {
        applyDark: view?.applyDark !== false,
        blackLevel: view?.blackLevel ?? 0,
        viewConfig: cfg,
        pipelineVersion: Math.min(statsT?.pipeline_version ?? 1, statsB?.pipeline_version ?? 1),
        tumorValue: tV,
        tumorStd: tStd,
        tumorMean: statsT?.mean,
        tumorMedian: statsT?.median,
        tumorMode: statsT?.mode,
        tumorPercentileValue: statsT?.percentile_value,
        tumorN: statsT?.n_pixels,
        bgValue: bV,
        bgStd: bStd,
        bgMean: statsB?.mean,
        bgMedian: statsB?.median,
        bgMode: statsB?.mode,
        bgPercentileValue: statsB?.percentile_value,
        bgN: statsB?.n_pixels,
        ratio: newRatio,
        ratioStd: newRatioStd,
        recomputedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Keep the entry untouched on failure; the user can retry.
      // eslint-disable-next-line no-console
      console.warn('TBR recompute failed', err);
    } finally {
      setRecomputingId(null);
    }
  };
  if (!view) return <div style={{ fontSize: 11, color: t.textMuted }}>No view selected.</div>;
  // Format helpers per user spec: tumor / bg as integers, ratio as 1
  // decimal place. NaN / null fall back to em-dash.
  const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(Number(v))));
  const fmtRatio = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(1));
  const TUMOR_COLOR = '#ff5b5b';
  const BG_COLOR = '#3ecbe5';
  // Coloured ROI buttons. The default Button component uses muted
  // chrome that visually disappears on the dark inspector — so the
  // Tumor / Background actions render as native <button> with the
  // ROI tint, white text, and a clear active state.
  const roiBtnBase = {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    borderRadius: 4,
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minWidth: 64,
    color: '#fff',
    boxShadow: '0 1px 0 rgba(0,0,0,0.25)',
  };
  // Idle Draw button: still tinted but much brighter so the user can
  // see at a glance that the action is enabled. Active state pulses
  // with a thicker outline so the user knows the canvas is now armed.
  const roiBtnFor = (color, active) => ({
    ...roiBtnBase,
    background: color,
    opacity: active ? 1 : 0.92,
    outline: active ? `2px solid ${color}` : 'none',
    outlineOffset: 2,
    boxShadow: active
      ? `0 0 0 2px ${color}66, 0 1px 0 rgba(0,0,0,0.25)`
      : '0 1px 0 rgba(0,0,0,0.25)',
  });
  const ghostBtn = {
    ...roiBtnBase,
    background: 'transparent',
    color: t.textMuted,
    border: `1px solid ${t.border}`,
  };
  const roiRow = (kind, color, polyKey, statsKey, label) => {
    const polygon = draft[polyKey] || [];
    const stats = draft[statsKey];
    const drawing = drawRole === kind;
    return (
      <div
        data-tbr-roi-row={kind}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 8px',
          background: t.chipBg,
          border: `1px solid ${drawing ? color : t.border}`,
          borderRadius: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: t.text }}>{label}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: t.textFaint }}>
            {polygon.length} pt{polygon.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {drawing ? (
            <>
              <button
                style={roiBtnFor(color, true)}
                onClick={() => setRole(null)}
                data-tbr-done={kind}
                title="Stop drawing — keep the current polygon"
              >
                Done
              </button>
              <button
                style={ghostBtn}
                onClick={() => {
                  setDraft({ [polyKey]: [], [statsKey]: null });
                  setRole(null);
                }}
                data-tbr-cancel={kind}
                title="Discard the in-progress polygon"
              >
                Cancel
              </button>
              <button
                style={ghostBtn}
                disabled={polygon.length === 0}
                onClick={() => setDraft({ [polyKey]: polygon.slice(0, -1) })}
                title="Remove the last vertex"
              >
                Undo
              </button>
            </>
          ) : (
            <>
              <button
                style={roiBtnFor(color, false)}
                onClick={() => setRole(kind)}
                data-tbr-draw={kind}
              >
                {polygon.length >= 3 ? 'Re-draw' : 'Draw ROI'}
              </button>
              <button
                style={ghostBtn}
                disabled={polygon.length === 0}
                onClick={() => setDraft({ [polyKey]: [], [statsKey]: null })}
              >
                Clear
              </button>
            </>
          )}
        </div>
        <div
          style={{
            fontSize: 11,
            color: stats?.__error ? t.danger : t.text,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          {stats?.__error
            ? stats.__error
            : stats?.computed_value != null
              ? `${fmtInt(stats.computed_value)} ± ${fmtInt(stats.std)} · n=${stats.n_pixels}`
              : 'draw ≥ 3 vertices to compute'}
        </div>
      </div>
    );
  };
  return (
    <div data-tbr-panel style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.45 }}>
        Stats are computed AFTER the view&rsquo;s Corrections (dark subtract + black level).
        Channel: <strong>{tbrChannel}</strong>.
      </div>
      <Row label="Method">
        <Select
          value={draft.method || 'mean'}
          onChange={(v) => setDraft({ method: v })}
          options={[
            { value: 'mean', label: 'Mean' },
            { value: 'percentile', label: 'Percentile' },
            { value: 'mode', label: 'Mode' },
          ]}
        />
      </Row>
      {draft.method === 'percentile' && (
        <Row label="Percentile">
          <Spinbox
            value={draft.percentile ?? 50}
            min={0}
            max={100}
            step={1}
            onChange={(v) => setDraft({ percentile: Math.max(0, Math.min(100, Number(v) || 0)) })}
          />
        </Row>
      )}
      {roiRow('tumor', TUMOR_COLOR, 'tumorPolygon', 'tumorStats', 'Tumor ROI')}
      {roiRow('background', BG_COLOR, 'bgPolygon', 'bgStats', 'Background ROI')}
      <div
        style={{
          fontSize: 12,
          color: t.text,
          fontFamily: 'ui-monospace,Menlo,monospace',
          padding: '6px 10px',
          background: ratio != null ? t.accentSoft : t.chipBg,
          border: `1px solid ${ratio != null ? t.accent : t.border}`,
          borderRadius: 4,
          textAlign: 'center',
          fontWeight: 600,
          letterSpacing: 0.4,
        }}
      >
        TBR ={' '}
        {ratio != null ? (
          <>
            <span style={{ fontSize: 14 }}>{fmtRatio(ratio)}</span>
            <span style={{ color: t.textMuted, fontWeight: 400 }}> ± {fmtRatio(ratioStd)}</span>
          </>
        ) : (
          '—'
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          disabled={!canAdd}
          onClick={commit}
          data-tbr-add
          title="Append the (tumor, background, ratio) measurement to the TBR table."
          style={{
            ...roiBtnBase,
            background: canAdd ? t.accent : t.chipBg,
            color: canAdd ? '#fff' : t.textFaint,
            cursor: canAdd ? 'pointer' : 'not-allowed',
            flex: 1,
          }}
        >
          Add to table
        </button>
        <button
          disabled={!entries || entries.length === 0}
          onClick={onOpenAnalysis}
          data-tbr-analysis
          style={{
            ...ghostBtn,
            cursor: entries && entries.length > 0 ? 'pointer' : 'not-allowed',
            opacity: entries && entries.length > 0 ? 1 : 0.4,
          }}
        >
          Open Analysis…
        </button>
      </div>
      {entries && entries.length > 0 && (
        <div
          data-tbr-table
          style={{
            marginTop: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              color: t.textMuted,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              padding: '0 2px',
            }}
          >
            <span>Entries</span>
            <span style={{ color: t.textFaint, fontWeight: 400 }}>({entries.length})</span>
          </div>
          {entries.map((e, i) => (
            <div
              key={e.id}
              data-tbr-entry={e.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '6px 8px',
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                background: t.panel,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                    color: t.textFaint,
                    minWidth: 18,
                  }}
                >
                  #{i + 1}
                </span>
                <span
                  style={{
                    fontSize: 11.5,
                    color: t.text,
                    fontWeight: 500,
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={`${e.sourceFile}\nframe ${e.frameIndex} · channel ${e.channel} · ${e.method}${e.method === 'percentile' ? `(${e.percentile})` : ''}`}
                >
                  {e.sourceFile}
                </span>
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: t.accent,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                  }}
                >
                  {fmtRatio(e.ratio)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: t.textFaint,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                  }}
                >
                  ±{fmtRatio(e.ratioStd)}
                </span>
                {(e.pipelineVersion ?? 1) < 2 && (
                  <span
                    title="Committed under the legacy pipeline (dark + black_level only). Click Recompute to apply sharpen / FPN / gain / offset from the current view."
                    data-tbr-stale
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: '#f0a020',
                      border: '1px solid #f0a020',
                      borderRadius: 3,
                      padding: '0 4px',
                      lineHeight: '14px',
                    }}
                  >
                    v1
                  </span>
                )}
                {(() => {
                  // Recompute applies the *current view's* ISP knobs to
                  // the entry. If the entry was committed against a
                  // different recording (entry.sourceId !== active
                  // recording's source_id), the live view's knobs
                  // wouldn't make sense — silently applying them would
                  // produce a number the user can't reason about.
                  // Disable + tooltip-explain instead.
                  const sourceMismatch =
                    !!recording && !!e.sourceId && e.sourceId !== recording.source_id;
                  const busy = recomputingId === e.id;
                  const disabled = busy || !onUpdateEntry || sourceMismatch;
                  const title = busy
                    ? 'Recomputing…'
                    : sourceMismatch
                      ? 'Switch the active view to this entry’s recording to recompute. The current view’s ISP knobs only apply to its own source.'
                      : 'Recompute under the current view (gain / offset / sharpen / FPN). Polygon, frame, and channel stay locked.';
                  return (
                    <button
                      onClick={() => !disabled && recomputeEntry(e)}
                      disabled={disabled}
                      title={title}
                      data-tbr-recompute
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: busy ? 'wait' : disabled ? 'not-allowed' : 'pointer',
                        color: disabled ? t.textFaint : t.textMuted,
                        padding: 2,
                        display: 'flex',
                        alignItems: 'center',
                        opacity: disabled ? 0.5 : 1,
                      }}
                    >
                      <Icon name="rotate" size={11} />
                    </button>
                  );
                })()}
                <button
                  onClick={() => onRemoveEntry(e.id)}
                  title="Remove this entry"
                  data-tbr-remove
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
                  <Icon name="close" size={11} />
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 10.5,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  color: t.textMuted,
                }}
              >
                <span>
                  <span style={{ color: TUMOR_COLOR }}>● </span>T:{' '}
                  <span style={{ color: t.text }}>
                    {fmtInt(e.tumorValue)}±{fmtInt(e.tumorStd)}
                  </span>
                </span>
                <span>
                  <span style={{ color: BG_COLOR }}>● </span>B:{' '}
                  <span style={{ color: t.text }}>
                    {fmtInt(e.bgValue)}±{fmtInt(e.bgStd)}
                  </span>
                </span>
                <span>frame {e.frameIndex}</span>
                <span>{e.channel}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// TbrAnalysisModal — research-style report for the committed TBR
// entries. Tabbed interface with a per-entry bar chart, a TBR
// distribution histogram + box plot, a tumor-vs-background scatter,
// and a per-file / per-channel grouping view. All charts are inline
// SVG so we don't pay the 4.8 MB Plotly bundle.
const TbrAnalysisModal = ({ entries, onClose }) => {
  const t = useTheme();
  const data = entries || [];
  const TUMOR_COLOR = '#ff5b5b';
  const BG_COLOR = '#3ecbe5';
  const ratios = data.map((e) => e.ratio).filter((v) => Number.isFinite(v));
  const fmt2 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(2));
  const fmt1 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(1));
  const fmtInt = (v) => (v == null || !Number.isFinite(v) ? '—' : String(Math.round(Number(v))));
  const summary = React.useMemo(() => {
    if (ratios.length === 0) return null;
    const sorted = [...ratios].sort((a, b) => a - b);
    const sum = ratios.reduce((s, x) => s + x, 0);
    const mean = sum / ratios.length;
    const variance =
      ratios.length > 1 ? ratios.reduce((s, x) => s + (x - mean) ** 2, 0) / (ratios.length - 1) : 0;
    const std = Math.sqrt(variance);
    const pct = (p) =>
      sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p)))];
    return {
      n: ratios.length,
      mean,
      std,
      sem: std / Math.sqrt(ratios.length),
      median: pct(0.5),
      q1: pct(0.25),
      q3: pct(0.75),
      min: sorted[0],
      max: sorted[sorted.length - 1],
      // CI95 of the mean (normal approximation; honest enough for n ≥ 5).
      ci95Lo: mean - 1.96 * (std / Math.sqrt(Math.max(1, ratios.length))),
      ci95Hi: mean + 1.96 * (std / Math.sqrt(Math.max(1, ratios.length))),
      // Fraction of entries with ratio > 1 (clinically: tumor brighter).
      fracBright: ratios.filter((r) => r > 1).length / ratios.length,
    };
  }, [ratios]);

  const [tab, setTab] = React.useState('overview');

  const downloadCsv = () => {
    const header = [
      '#',
      'file',
      'frame',
      'channel',
      'method',
      'percentile',
      'apply_dark',
      'black_level',
      'tumor_value',
      'tumor_std',
      'tumor_n',
      'bg_value',
      'bg_std',
      'bg_n',
      'ratio',
      'ratio_std',
      'created_at',
    ];
    const rows = data.map((e, i) =>
      [
        i + 1,
        JSON.stringify(e.sourceFile || ''),
        e.frameIndex,
        e.channel,
        e.method,
        e.method === 'percentile' ? e.percentile : '',
        e.applyDark ? '1' : '0',
        e.blackLevel,
        e.tumorValue,
        e.tumorStd,
        e.tumorN,
        e.bgValue,
        e.bgStd,
        e.bgN,
        e.ratio,
        e.ratioStd,
        e.createdAt,
      ].join(',')
    );
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tbr_analysis_${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // ------------------- shared chart helpers -------------------
  const PLOT_W = 800;
  const PLOT_H = 320;
  const PAD = { l: 56, r: 24, t: 24, b: 44 };
  const innerW = PLOT_W - PAD.l - PAD.r;
  const innerH = PLOT_H - PAD.t - PAD.b;
  const tickFormat = (v) => (Math.abs(v) >= 100 ? Math.round(v).toString() : Number(v).toFixed(2));
  const axisTicks = (n) => Array.from({ length: n + 1 }, (_, i) => i / n);

  // ------------------- per-entry ratio bar chart -------------------
  const RatioBarChart = () => {
    const ratioMax = Math.max(0.001, ...ratios.map((r, i) => r + (data[i].ratioStd || 0))) * 1.1;
    const yScale = (v) => PAD.t + innerH - (v / ratioMax) * innerH;
    const barW = innerW / Math.max(1, data.length);
    return (
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        data-tbr-bar-chart
        style={{
          background: t.chipBg,
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          width: '100%',
          height: PLOT_H,
        }}
      >
        {axisTicks(5).map((f) => {
          const y = PAD.t + innerH * (1 - f);
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PLOT_W - PAD.r}
                y1={y}
                y2={y}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {tickFormat(ratioMax * f)}
              </text>
            </g>
          );
        })}
        {/* TBR=1 reference line (no contrast). */}
        {ratioMax > 1 && (
          <g>
            <line
              x1={PAD.l}
              x2={PLOT_W - PAD.r}
              y1={yScale(1)}
              y2={yScale(1)}
              stroke={t.warn || '#e5a13a'}
              strokeDasharray="6,3"
              strokeWidth={1}
            />
            <text
              x={PLOT_W - PAD.r - 4}
              y={yScale(1) - 4}
              fontSize="9.5"
              fill={t.warn || '#e5a13a'}
              textAnchor="end"
            >
              TBR=1
            </text>
          </g>
        )}
        {data.map((e, i) => {
          const x = PAD.l + i * barW;
          const y = yScale(e.ratio);
          const h = PAD.t + innerH - y;
          const errTop = yScale(e.ratio + (e.ratioStd || 0));
          const errBot = yScale(Math.max(0, e.ratio - (e.ratioStd || 0)));
          return (
            <g key={e.id}>
              <rect
                x={x + barW * 0.15}
                y={y}
                width={barW * 0.7}
                height={Math.max(0, h)}
                fill={t.accent}
                opacity={0.85}
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
                y={PLOT_H - PAD.b + 14}
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
          x={PAD.l - 38}
          y={PAD.t + innerH / 2}
          fontSize="10.5"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 38} ${PAD.t + innerH / 2})`}
        >
          TBR ratio
        </text>
        <text x={PLOT_W / 2} y={PLOT_H - 6} fontSize="10.5" fill={t.textMuted} textAnchor="middle">
          entry #
        </text>
      </svg>
    );
  };

  // ------------------- side-by-side tumor / background bars -------------------
  const TumorVsBgChart = () => {
    const yMax =
      Math.max(0.001, ...data.map((e) => Math.max(e.tumorValue || 0, e.bgValue || 0))) * 1.1;
    const yScale = (v) => PAD.t + innerH - (v / yMax) * innerH;
    const groupW = innerW / Math.max(1, data.length);
    const subW = groupW * 0.4;
    return (
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        data-tbr-tumor-bg-chart
        style={{
          background: t.chipBg,
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          width: '100%',
          height: PLOT_H,
        }}
      >
        {axisTicks(5).map((f) => {
          const y = PAD.t + innerH * (1 - f);
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PLOT_W - PAD.r}
                y1={y}
                y2={y}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {tickFormat(yMax * f)}
              </text>
            </g>
          );
        })}
        {data.map((e, i) => {
          const xT = PAD.l + i * groupW + groupW * 0.1;
          const xB = xT + subW + 4;
          const yT = yScale(e.tumorValue || 0);
          const yB = yScale(e.bgValue || 0);
          const errLine = (cx, val, std) => {
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
              />
              <rect
                x={xB}
                y={yB}
                width={subW}
                height={Math.max(0, PAD.t + innerH - yB)}
                fill={BG_COLOR}
                opacity={0.9}
              />
              {errLine(xT + subW / 2, e.tumorValue || 0, e.tumorStd || 0)}
              {errLine(xB + subW / 2, e.bgValue || 0, e.bgStd || 0)}
              <text
                x={PAD.l + i * groupW + groupW / 2}
                y={PLOT_H - PAD.b + 14}
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
          x={PAD.l - 42}
          y={PAD.t + innerH / 2}
          fontSize="10.5"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
        >
          intensity (DN)
        </text>
        {/* Legend */}
        <g>
          <rect x={PLOT_W - PAD.r - 140} y={PAD.t + 4} width={10} height={10} fill={TUMOR_COLOR} />
          <text x={PLOT_W - PAD.r - 124} y={PAD.t + 13} fontSize="10" fill={t.text}>
            Tumor
          </text>
          <rect x={PLOT_W - PAD.r - 70} y={PAD.t + 4} width={10} height={10} fill={BG_COLOR} />
          <text x={PLOT_W - PAD.r - 54} y={PAD.t + 13} fontSize="10" fill={t.text}>
            Background
          </text>
        </g>
      </svg>
    );
  };

  // ------------------- tumor vs background scatter -------------------
  const ScatterChart = () => {
    const lim = Math.max(0.001, ...data.flatMap((e) => [e.tumorValue || 0, e.bgValue || 0])) * 1.1;
    const xScale = (v) => PAD.l + (v / lim) * innerW;
    const yScale = (v) => PAD.t + innerH - (v / lim) * innerH;
    return (
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        data-tbr-scatter-chart
        style={{
          background: t.chipBg,
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          width: '100%',
          height: PLOT_H,
        }}
      >
        {axisTicks(5).map((f) => {
          const y = PAD.t + innerH * (1 - f);
          const x = PAD.l + innerW * f;
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PLOT_W - PAD.r}
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
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {tickFormat(lim * f)}
              </text>
              <text
                x={x}
                y={PLOT_H - PAD.b + 14}
                textAnchor="middle"
                fontSize="10"
                fill={t.textFaint}
              >
                {tickFormat(lim * f)}
              </text>
            </g>
          );
        })}
        {/* y = x reference (TBR=1) */}
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(lim)}
          y2={yScale(lim)}
          stroke={t.warn || '#e5a13a'}
          strokeDasharray="6,3"
          strokeWidth={1}
        />
        {data.map((e, i) => (
          <g key={e.id}>
            <circle
              cx={xScale(e.bgValue || 0)}
              cy={yScale(e.tumorValue || 0)}
              r={4}
              fill={t.accent}
              stroke="#fff"
              strokeWidth={1}
            />
            <text
              x={xScale(e.bgValue || 0) + 6}
              y={yScale(e.tumorValue || 0) - 6}
              fontSize="9"
              fill={t.textMuted}
            >
              {i + 1}
            </text>
          </g>
        ))}
        <text
          x={PAD.l - 42}
          y={PAD.t + innerH / 2}
          fontSize="10.5"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
        >
          tumor intensity
        </text>
        <text x={PLOT_W / 2} y={PLOT_H - 6} fontSize="10.5" fill={t.textMuted} textAnchor="middle">
          background intensity
        </text>
      </svg>
    );
  };

  // ------------------- ratio histogram -------------------
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
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        data-tbr-hist
        style={{
          background: t.chipBg,
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          width: '100%',
          height: PLOT_H,
        }}
      >
        {axisTicks(5).map((f) => {
          const y = PAD.t + innerH * (1 - f);
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PLOT_W - PAD.r}
                y1={y}
                y2={y}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {Math.round(maxC * f)}
              </text>
            </g>
          );
        })}
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
              opacity={0.85}
            />
          );
        })}
        {/* X axis labels: lo, mid, hi */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const x = PAD.l + innerW * f;
          return (
            <text
              key={f}
              x={x}
              y={PLOT_H - PAD.b + 14}
              textAnchor="middle"
              fontSize="10"
              fill={t.textFaint}
            >
              {fmt2(lo + span * f)}
            </text>
          );
        })}
        {/* Mean + median markers */}
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
            <g>
              <text x={PLOT_W - PAD.r - 90} y={PAD.t + 12} fontSize="10" fill={t.text}>
                — mean
              </text>
              <text x={PLOT_W - PAD.r - 90} y={PAD.t + 26} fontSize="10" fill={t.warn || '#e5a13a'}>
                -- median
              </text>
            </g>
          </>
        )}
        <text
          x={PAD.l - 42}
          y={PAD.t + innerH / 2}
          fontSize="10.5"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
        >
          count
        </text>
        <text x={PLOT_W / 2} y={PLOT_H - 6} fontSize="10.5" fill={t.textMuted} textAnchor="middle">
          TBR ratio
        </text>
      </svg>
    );
  };

  // ------------------- box plot (single ratio distribution) -------------------
  const BoxPlot = () => {
    if (!summary) return null;
    const yMin = Math.min(0, summary.min - (summary.std || 0));
    const yMax = Math.max(summary.max + (summary.std || 0), 1.1);
    const span = Math.max(1e-6, yMax - yMin);
    const yScale = (v) => PAD.t + innerH - ((v - yMin) / span) * innerH;
    const cx = PAD.l + innerW * 0.5;
    const halfW = 80;
    return (
      <svg
        viewBox={`0 0 ${PLOT_W} ${PLOT_H}`}
        data-tbr-box-plot
        style={{
          background: t.chipBg,
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          width: '100%',
          height: PLOT_H,
        }}
      >
        {axisTicks(5).map((f) => {
          const y = PAD.t + innerH * (1 - f);
          return (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={PLOT_W - PAD.r}
                y1={y}
                y2={y}
                stroke={t.border}
                strokeDasharray="3,3"
              />
              <text x={PAD.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={t.textFaint}>
                {fmt2(yMin + span * f)}
              </text>
            </g>
          );
        })}
        {/* TBR=1 reference */}
        <line
          x1={PAD.l}
          x2={PLOT_W - PAD.r}
          y1={yScale(1)}
          y2={yScale(1)}
          stroke={t.warn || '#e5a13a'}
          strokeDasharray="6,3"
          strokeWidth={1}
        />
        {/* Whiskers */}
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
        {/* Box (q1..q3) */}
        <rect
          x={cx - halfW}
          y={yScale(summary.q3)}
          width={2 * halfW}
          height={yScale(summary.q1) - yScale(summary.q3)}
          fill={t.accentSoft}
          stroke={t.accent}
          strokeWidth={1.5}
        />
        {/* Median */}
        <line
          x1={cx - halfW}
          x2={cx + halfW}
          y1={yScale(summary.median)}
          y2={yScale(summary.median)}
          stroke={t.accent}
          strokeWidth={2.5}
        />
        {/* Mean (diamond marker) */}
        <polygon
          points={`${cx},${yScale(summary.mean) - 6} ${cx + 6},${yScale(summary.mean)} ${cx},${yScale(summary.mean) + 6} ${cx - 6},${yScale(summary.mean)}`}
          fill={t.text}
        />
        {/* Individual points jittered */}
        {ratios.map((r, i) => {
          const jitter = ((i % 7) - 3) * 8;
          return (
            <circle
              key={i}
              cx={cx + jitter}
              cy={yScale(r)}
              r={3}
              fill={t.accent}
              opacity={0.6}
              stroke="#fff"
              strokeWidth={0.6}
            />
          );
        })}
        <text
          x={PAD.l - 42}
          y={PAD.t + innerH / 2}
          fontSize="10.5"
          fill={t.textMuted}
          transform={`rotate(-90 ${PAD.l - 42} ${PAD.t + innerH / 2})`}
        >
          TBR ratio
        </text>
        <text x={cx} y={PLOT_H - 6} fontSize="10.5" fill={t.textMuted} textAnchor="middle">
          all entries (n={summary.n})
        </text>
      </svg>
    );
  };

  // ------------------- grouping aggregations -------------------
  const groupBy = (keyFn) => {
    const m = new Map();
    for (const e of data) {
      const k = keyFn(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m.entries()]
      .map(([key, arr]) => {
        const rs = arr.map((x) => x.ratio).filter(Number.isFinite);
        if (rs.length === 0) return null;
        const mean = rs.reduce((s, x) => s + x, 0) / rs.length;
        const std =
          rs.length > 1
            ? Math.sqrt(rs.reduce((s, x) => s + (x - mean) ** 2, 0) / (rs.length - 1))
            : 0;
        return { key, n: rs.length, mean, std };
      })
      .filter(Boolean)
      .sort((a, b) => b.mean - a.mean);
  };
  const byFile = React.useMemo(() => groupBy((e) => e.sourceFile || '?'), [data]);
  const byChannel = React.useMemo(() => groupBy((e) => e.channel || '?'), [data]);

  const TabBtn = ({ id, children }) => (
    <button
      onClick={() => setTab(id)}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        background: tab === id ? t.accent : 'transparent',
        color: tab === id ? '#fff' : t.text,
        border: 'none',
        borderBottom: tab === id ? `2px solid ${t.accent}` : '2px solid transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );

  return (
    <Modal open onClose={onClose} width={1000} label="TBR Analysis">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="grid" size={16} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>
            TBR Analysis · {data.length} entr{data.length === 1 ? 'y' : 'ies'}
          </div>
          <div style={{ flex: 1 }} />
          <Button
            size="sm"
            variant="subtle"
            icon="export"
            onClick={downloadCsv}
            disabled={data.length === 0}
          >
            Export CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {data.length === 0 ? (
          <div style={{ fontSize: 12, color: t.textMuted, padding: 20 }}>
            No TBR entries yet. Use Inspector → TBR Analysis to draw a Tumor and a Background ROI on
            a frame, then click Add to table.
          </div>
        ) : (
          <>
            {summary && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: 10,
                  padding: 12,
                  background: t.chipBg,
                  border: `1px solid ${t.border}`,
                  borderRadius: 6,
                  fontFamily: 'ui-monospace,Menlo,monospace',
                }}
              >
                {[
                  ['n', summary.n, t.text],
                  ['mean', fmt2(summary.mean), t.accent],
                  ['median', fmt2(summary.median), t.text],
                  ['std', fmt2(summary.std), t.text],
                  ['sem', fmt2(summary.sem), t.text],
                  ['min', fmt2(summary.min), t.text],
                  ['q1', fmt2(summary.q1), t.text],
                  ['q3', fmt2(summary.q3), t.text],
                  ['max', fmt2(summary.max), t.text],
                  ['CI95', `${fmt2(summary.ci95Lo)}–${fmt2(summary.ci95Hi)}`, t.textMuted],
                  [
                    'TBR>1',
                    `${(summary.fracBright * 100).toFixed(0)}%`,
                    summary.fracBright > 0.5 ? '#3ecbe5' : t.textMuted,
                  ],
                ].map(([k, v, color]) => (
                  <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span
                      style={{
                        fontSize: 9.5,
                        letterSpacing: 0.4,
                        color: t.textFaint,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}
                    >
                      {k}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: color || t.text }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${t.border}` }}>
              <TabBtn id="overview">Overview</TabBtn>
              <TabBtn id="tvb">Tumor vs Background</TabBtn>
              <TabBtn id="scatter">Scatter</TabBtn>
              <TabBtn id="distribution">Distribution</TabBtn>
              <TabBtn id="grouping">By file / channel</TabBtn>
              <TabBtn id="table">Table</TabBtn>
            </div>
            {tab === 'overview' && (
              <div>
                <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>
                  TBR by entry — bars are ratio, error bars are propagated ratio std, dashed amber
                  line marks TBR=1 (no contrast).
                </div>
                <RatioBarChart />
              </div>
            )}
            {tab === 'tvb' && (
              <div>
                <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>
                  Side-by-side tumor + background intensities. Identical bars → no contrast.
                </div>
                <TumorVsBgChart />
              </div>
            )}
            {tab === 'scatter' && (
              <div>
                <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>
                  Tumor vs background scatter. Points above the dashed amber y=x line have TBR&gt;1.
                </div>
                <ScatterChart />
              </div>
            )}
            {tab === 'distribution' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>
                    Histogram (Sturges-style auto-binning) — solid line = mean, dashed amber =
                    median.
                  </div>
                  <Histogram />
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 4 }}>
                    Box plot (Q1 / median / Q3 + whiskers + jittered raw points + diamond mean).
                  </div>
                  <BoxPlot />
                </div>
              </div>
            )}
            {tab === 'grouping' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11.5, color: t.text, fontWeight: 600, marginBottom: 6 }}>
                    By file
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {byFile.map((g) => {
                      const w = ratios.length > 0 ? (g.mean / Math.max(...ratios)) * 100 : 0;
                      return (
                        <div
                          key={g.key}
                          style={{ padding: '4px 8px', background: t.chipBg, borderRadius: 4 }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 10.5,
                              fontFamily: 'ui-monospace,Menlo,monospace',
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                color: t.text,
                              }}
                              title={g.key}
                            >
                              {g.key}
                            </span>
                            <span style={{ color: t.textFaint }}>n={g.n}</span>
                            <span style={{ color: t.accent, fontWeight: 700 }}>{fmt2(g.mean)}</span>
                            <span style={{ color: t.textFaint }}>±{fmt2(g.std)}</span>
                          </div>
                          <div
                            style={{
                              marginTop: 3,
                              height: 6,
                              background: t.bg,
                              borderRadius: 2,
                              overflow: 'hidden',
                            }}
                          >
                            <div style={{ width: `${w}%`, height: '100%', background: t.accent }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11.5, color: t.text, fontWeight: 600, marginBottom: 6 }}>
                    By channel
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {byChannel.map((g) => {
                      const w = ratios.length > 0 ? (g.mean / Math.max(...ratios)) * 100 : 0;
                      return (
                        <div
                          key={g.key}
                          style={{ padding: '4px 8px', background: t.chipBg, borderRadius: 4 }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 10.5,
                              fontFamily: 'ui-monospace,Menlo,monospace',
                            }}
                          >
                            <span style={{ flex: 1, color: t.text }}>{g.key}</span>
                            <span style={{ color: t.textFaint }}>n={g.n}</span>
                            <span style={{ color: t.accent, fontWeight: 700 }}>{fmt2(g.mean)}</span>
                            <span style={{ color: t.textFaint }}>±{fmt2(g.std)}</span>
                          </div>
                          <div
                            style={{
                              marginTop: 3,
                              height: 6,
                              background: t.bg,
                              borderRadius: 2,
                              overflow: 'hidden',
                            }}
                          >
                            <div style={{ width: `${w}%`, height: '100%', background: t.accent }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
            {tab === 'table' && (
              <div
                style={{
                  maxHeight: 360,
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  fontSize: 10.5,
                  border: `1px solid ${t.border}`,
                  borderRadius: 4,
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 2fr 0.5fr 0.6fr 0.6fr 1fr 1fr 1fr',
                    gap: 4,
                    padding: '4px 6px',
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
                {data.map((e, i) => (
                  <div
                    key={e.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 2fr 0.5fr 0.6fr 0.6fr 1fr 1fr 1fr',
                      gap: 4,
                      padding: '4px 6px',
                      color: t.text,
                      borderBottom: i === data.length - 1 ? 'none' : `1px solid ${t.border}`,
                    }}
                  >
                    <span style={{ color: t.textFaint }}>{i + 1}</span>
                    <span
                      style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {e.sourceFile} · {e.channel}
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
                    <span style={{ textAlign: 'right', color: t.accent, fontWeight: 600 }}>
                      {fmt1(e.ratio)}±{fmt1(e.ratioStd)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

const FrameCacheBudgetControl = () => {
  const t = useTheme();
  const [persisted, setPersisted] = useLocalStorageState(
    'playback/frameCacheBudgetMB',
    _DEFAULT_CACHE_BUDGET_MB
  );
  const [hostInfo, setHostInfo] = React.useState({ totalRamMb: null, source: null });
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch('/api/system/info');
        if (!alive) return;
        if (r && Number.isFinite(r.total_ram_mb) && r.total_ram_mb > 0) {
          setHostInfo({ totalRamMb: Math.round(r.total_ram_mb), source: 'host' });
          return;
        }
      } catch {
        /* fall through to navigator.deviceMemory */
      }
      const dm =
        typeof navigator !== 'undefined' && Number.isFinite(navigator.deviceMemory)
          ? Number(navigator.deviceMemory)
          : null;
      if (alive) {
        setHostInfo({
          totalRamMb: dm != null ? dm * 1024 : 6 * 1024,
          source: dm != null ? 'navigator' : 'fallback',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  const totalRamMb = hostInfo.totalRamMb || 6 * 1024;
  const ceilingMb = Math.max(64, Math.floor(totalRamMb * 0.8));
  // Low-RAM safety: never use more than 25% of the available ceiling
  // by default. On a 4 GB SBC (ceiling ~3277 MB) the default becomes
  // 819 MB instead of 1024 MB; on a 192 GB workstation the default
  // is unchanged (1024 < 39322). Persisted user preference still
  // overrides — only the FRESH-INSTALL default is capped.
  const safeDefaultMb = Math.max(8, Math.min(_DEFAULT_CACHE_BUDGET_MB, Math.floor(ceilingMb / 4)));
  const budgetMb = Math.max(8, Math.min(ceilingMb, Number(persisted) || safeDefaultMb));
  // Push into the cache module on mount + every change so the setting
  // applies live (LRU trims immediately when the user shrinks).
  React.useEffect(() => {
    setFrameCacheBudgetMB(budgetMb);
  }, [budgetMb]);
  const apply = (mb) => {
    const clamped = Math.max(
      8,
      Math.min(ceilingMb, Math.round(Number(mb) || _DEFAULT_CACHE_BUDGET_MB))
    );
    setPersisted(clamped);
  };
  const ramSourceLabel =
    hostInfo.source === 'host'
      ? `host RAM ${(totalRamMb / 1024).toFixed(1)} GB`
      : hostInfo.source === 'navigator'
        ? `browser-reported ${(totalRamMb / 1024).toFixed(1)} GB (Chromium caps at 8 GB)`
        : `fallback ${(totalRamMb / 1024).toFixed(1)} GB`;
  return (
    <div data-frame-cache-budget style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11.5, color: t.text, fontWeight: 600 }}>Frame cache RAM budget</div>
      <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.45 }}>
        Frames are cached in browser memory so scrubbing and replay are instant. Higher = smoother
        on cold-cache files; lower = leaves more RAM for the rest of your machine. Capped at 80% of
        physical memory ({ramSourceLabel}).
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="range"
          min={8}
          max={ceilingMb}
          step={Math.max(1, Math.round(ceilingMb / 200))}
          value={budgetMb}
          onChange={(e) => apply(Number(e.target.value))}
          aria-label="Frame cache RAM budget"
          className="rgbnir-slider"
          style={{
            flex: 1,
            minWidth: 0,
            height: 18,
            appearance: 'none',
            WebkitAppearance: 'none',
            background: 'transparent',
            cursor: 'pointer',
            margin: 0,
          }}
        />
        <input
          type="number"
          min={8}
          max={ceilingMb}
          value={budgetMb}
          onChange={(e) => apply(Number(e.target.value))}
          aria-label="Frame cache RAM budget MB"
          style={{
            width: 72,
            fontSize: 11,
            padding: '2px 4px',
            background: t.inputBg,
            color: t.text,
            border: `1px solid ${t.border}`,
            borderRadius: 3,
            fontFamily: 'ui-monospace,Menlo,monospace',
            textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 10.5, color: t.textMuted, minWidth: 18 }}>MB</span>
      </div>
      <div
        style={{
          fontSize: 10,
          color: t.textFaint,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        Max {ceilingMb} MB · default {_DEFAULT_CACHE_BUDGET_MB} MB · ≈
        {Math.floor((budgetMb * 1024) / getAvgBlobKbEstimate())} frames at avg{' '}
        {Math.round(getAvgBlobKbEstimate())} KB/PNG
      </div>
    </div>
  );
};

// usePlayCacheStatus — subscribe to the module-level fetch telemetry and
// re-render the consuming component whenever inflight / completed counts
// change. Snapshot shape matches `_emitCacheBusy` event detail.
const usePlayCacheStatus = () => {
  const [snap, setSnap] = React.useState({ inflight: 0, peak: 0, completed: 0 });
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (ev) => {
      const d = ev?.detail || {};
      setSnap({
        inflight: d.inflight | 0,
        peak: d.peak | 0,
        completed: d.completed | 0,
      });
    };
    window.addEventListener('mantis:play:cache-busy', handler);
    return () => window.removeEventListener('mantis:play:cache-busy', handler);
  }, []);
  return snap;
};

// usePlayCacheStats — polls cache-size + budget on a slow interval so the
// idle status indicator stays current without storming React renders.
const usePlayCacheStats = (intervalMs = 750) => {
  const [stats, setStats] = React.useState({
    entries: 0,
    cap: _frameCacheMaxEntries(),
    budgetMb: getFrameCacheBudgetMB(),
    estUsedMb: 0,
  });
  React.useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      // Read the cache size by computing from the trim cap (LRU-bounded);
      // _frameBlobCache itself isn't exported because direct mutation
      // outside the module would break the EWMA bookkeeping.
      const cap = _frameCacheMaxEntries();
      const budgetMb = getFrameCacheBudgetMB();
      // Approximation — caller doesn't need exact entry count, just a
      // status display. The cap is the right ceiling.
      const entries = Math.min(cap, _frameCacheCurrentSize());
      const estUsedMb = Math.round((entries * getAvgBlobKbEstimate()) / 1024);
      setStats((prev) =>
        prev.entries === entries && prev.cap === cap && prev.budgetMb === budgetMb
          ? prev
          : { entries, cap, budgetMb, estUsedMb }
      );
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return stats;
};

// PlayCacheStatusBar — persistent bottom-of-Play strip. Always visible
// so it doesn't flash in/out: when the cache is quiet it shows the
// current cache size + budget; when fetches are in flight it switches
// to a live progress bar. Background fill changes between idle / busy
// to make the state immediately readable without taking focus.
const PlayCacheStatusBar = ({ recordingsLoading = 0 }) => {
  const t = useTheme();
  const { inflight, completed, peak } = usePlayCacheStatus();
  const stats = usePlayCacheStats();
  const totalThisBurst = completed + inflight;
  const pct = totalThisBurst > 0 ? Math.min(100, (completed / totalThisBurst) * 100) : 0;
  const isFileLoad = recordingsLoading > 0;
  const isBusy = inflight > 0 || isFileLoad;
  const usagePct = stats.cap > 0 ? Math.min(100, (stats.entries / stats.cap) * 100) : 0;
  const idleAccent = t.textMuted;
  const fillColor = isBusy ? t.accent : idleAccent;
  return (
    <div
      data-play-cache-status
      data-busy={isBusy ? 'true' : 'false'}
      style={{
        height: 22,
        overflow: 'hidden',
        borderTop: `1px solid ${t.border}`,
        background: t.panel,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          height: 22,
          fontSize: 10.5,
          fontFamily: 'ui-monospace,SF Mono,Menlo,monospace',
          color: t.textMuted,
        }}
      >
        <span
          style={{
            color: isBusy ? t.accent : t.textMuted,
            fontWeight: 600,
            letterSpacing: 0.4,
          }}
        >
          CACHE
        </span>
        {isFileLoad ? (
          <span style={{ color: t.text }}>
            Loading {recordingsLoading} recording{recordingsLoading !== 1 ? 's' : ''}…
          </span>
        ) : isBusy ? (
          <span style={{ color: t.text }}>
            Caching frames · {completed}/{totalThisBurst}
            {peak > 1 && (
              <span style={{ color: t.textFaint, marginLeft: 6 }}>(peak {peak} in flight)</span>
            )}
          </span>
        ) : (
          <span style={{ color: t.textMuted }}>
            Idle ·{' '}
            <span style={{ color: t.text }}>
              {stats.entries}/{stats.cap}
            </span>{' '}
            frames cached · ~{stats.estUsedMb} MB / {stats.budgetMb} MB budget
          </span>
        )}
        <div
          style={{
            flex: 1,
            position: 'relative',
            height: 4,
            background: t.chipBg,
            borderRadius: 2,
            overflow: 'hidden',
            minWidth: 80,
          }}
          aria-label="frame cache status"
          role="progressbar"
          aria-valuenow={Math.round(isBusy ? pct : usagePct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {isFileLoad ? (
            // Indeterminate stripe — file loads have no honest fraction
            // because the H5 open is mostly a server-side blocking call
            // before any byte stream comes back.
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '40%',
                background: t.accent,
                borderRadius: 2,
                animation: 'mantisCacheStripe 1.4s linear infinite',
              }}
            />
          ) : (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${isBusy ? pct : usagePct}%`,
                background: fillColor,
                borderRadius: 2,
                transition: 'width 120ms ease-out',
                opacity: isBusy ? 1 : 0.55,
              }}
            />
          )}
        </div>
        <span style={{ color: t.textFaint, minWidth: 36, textAlign: 'right' }}>
          {isFileLoad ? '…' : isBusy ? `${Math.round(pct)}%` : `${Math.round(usagePct)}% full`}
        </span>
      </div>
      <style>{`@keyframes mantisCacheStripe {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(250%); }
      }`}</style>
    </div>
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
  const [confirmDeleteId, setConfirmDeleteId] = React.useState(null);
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
  const [stepIdx, setStepIdx] = React.useState(0);
  const [draft, setDraft] = React.useState(() => ({
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
  React.useEffect(() => {
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

// Render-time error boundary — wraps PlaybackMode so a thrown render
// (e.g. a browser-OOM-driven null deref under 18+ legacy H5s) shows a
// recoverable message instead of a blank dark screen. Reset clears
// state so the user can try again with fewer files.
class PlaybackErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('PlaybackMode render crash:', error, info);
    this.setState({ error, info });
  }
  reset = () => this.setState({ error: null, info: null });
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        data-play-error-boundary
        style={{
          padding: 24,
          height: '100%',
          width: '100%',
          background: '#1a1d23',
          color: '#e4e7ec',
          fontFamily: 'ui-monospace,Menlo,monospace',
          fontSize: 12,
          overflow: 'auto',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: '#ff6b6b' }}>
          Play mode crashed during render
        </div>
        <div style={{ marginBottom: 12, color: '#bcc1cc', maxWidth: 720, lineHeight: 1.5 }}>
          The most common cause is loading more recordings than the browser can hold in memory at
          once. Close some files (or shrink the frame-cache budget in Inspector → Advanced) and
          retry. The error is logged to the console.
        </div>
        <pre
          style={{
            background: '#0f1115',
            color: '#ff9090',
            padding: 12,
            borderRadius: 4,
            maxWidth: 900,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
        </pre>
        <button
          onClick={this.reset}
          style={{
            marginTop: 12,
            padding: '6px 14px',
            background: '#3a82f7',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

const PlaybackModeBoundary = (props) => (
  <PlaybackErrorBoundary>
    <PlaybackMode {...props} />
  </PlaybackErrorBoundary>
);

export default PlaybackModeBoundary;
