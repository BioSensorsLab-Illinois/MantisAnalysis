// @ts-nocheck
// recording-inspection-implementation-v1 M5 — Playback state.
//
// Single useReducer + PlaybackCtx. Per DATA_MODEL §5; expanded per
// risk-skeptic / planner-architect notes (kind-routed eviction,
// frame-LRU adjustment surfaced from server, presets).
//
// Persisted to localStorage under `mantis/playback/*`:
//   - layout, sourcesCollapsed, inspectorCollapsed, inspectorMode,
//     defaults (per-band colormap+thresholds), labels.
// Session-only (NEVER persisted):
//   - recordings, darks, streams, views, frame, range.

import React from 'react';

const { createContext, useContext, useReducer, useEffect, useMemo } = React;

// ---------------------------------------------------------------------------
// Default ViewState (mirrors playback_pipeline.ViewState defaults).
// ---------------------------------------------------------------------------

let _viewSerial = 0;
const _newViewId = () => `v${++_viewSerial}`;

export const DEFAULT_VIEW = (overrides = {}) => ({
  view_id: overrides.view_id ?? _newViewId(),
  name: overrides.name ?? 'View',
  type: overrides.type ?? 'single',
  channel: overrides.channel ?? 'HG-G',
  channels: overrides.channels ?? ['HG-R', 'HG-G', 'HG-B'],

  sync_to_global: overrides.sync_to_global ?? true,
  locked_frame: overrides.locked_frame ?? null,
  export_include: overrides.export_include ?? true,

  dark_on: overrides.dark_on ?? false,
  dark_id: overrides.dark_id ?? null,
  gain: overrides.gain ?? 1.0,
  offset: overrides.offset ?? 0.0,
  normalize: overrides.normalize ?? false,

  low: overrides.low ?? 30,
  high: overrides.high ?? 900,
  colormap: overrides.colormap ?? 'viridis',
  invert: overrides.invert ?? false,
  show_clipped: overrides.show_clipped ?? false,

  rgb_gain: overrides.rgb_gain ?? [1, 1, 1],
  rgb_offset: overrides.rgb_offset ?? [0, 0, 0],
  gamma: overrides.gamma ?? 1.0,
  brightness: overrides.brightness ?? 0,
  contrast: overrides.contrast ?? 1.0,
  saturation: overrides.saturation ?? 1.0,
  wb_k: overrides.wb_k ?? 5500,
  wb_mode: overrides.wb_mode ?? 'k',
  wb_patch_uv: overrides.wb_patch_uv ?? null,
  wb_target_id: overrides.wb_target_id ?? null,
  ccm_on: overrides.ccm_on ?? false,
  ccm: overrides.ccm ?? [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  ccm_target_id: overrides.ccm_target_id ?? null,

  overlay_on: overrides.overlay_on ?? false,
  overlay_channel: overrides.overlay_channel ?? 'HG-NIR',
  overlay_low: overrides.overlay_low ?? 300,
  overlay_high: overrides.overlay_high ?? 900,
  overlay_blend: overrides.overlay_blend ?? 'alpha',
  overlay_strength: overrides.overlay_strength ?? 0.65,
  overlay_cmap: overrides.overlay_cmap ?? 'inferno',
  overlay_below: overrides.overlay_below ?? 'hide',
  overlay_above: overrides.overlay_above ?? 'saturate',

  labels_timestamp: overrides.labels_timestamp ?? true,
  labels_frame: overrides.labels_frame ?? true,
  labels_channel: overrides.labels_channel ?? false,
  labels_source: overrides.labels_source ?? false,
  labels_scale_bar: overrides.labels_scale_bar ?? false,
  labels_badges: overrides.labels_badges ?? true,
  labels_legend: overrides.labels_legend ?? true,
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initialState = {
  recordings: [],
  darks: [],
  streams: [],
  activeStreamId: null,

  frame: 0,
  playing: false,
  playbackSpeed: 1,
  playbackFps: 30,
  range: null,
  layout: 'single',
  views: [],
  selectedViewId: null,

  modal: null,
  exportJobs: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'recordings/set':
      return { ...state, recordings: action.payload };
    case 'recording/added':
      return {
        ...state,
        recordings: [
          action.payload,
          ...state.recordings.filter((r) => r.recording_id !== action.payload.recording_id),
        ],
      };
    case 'recording/removed':
      return {
        ...state,
        recordings: state.recordings.filter((r) => r.recording_id !== action.payload),
      };
    case 'darks/set':
      return { ...state, darks: action.payload };
    case 'dark/added':
      return {
        ...state,
        darks: [action.payload, ...state.darks.filter((d) => d.dark_id !== action.payload.dark_id)],
      };
    case 'dark/removed':
      return {
        ...state,
        darks: state.darks.filter((d) => d.dark_id !== action.payload),
      };
    case 'streams/set':
      return { ...state, streams: action.payload };
    case 'stream/built':
      return {
        ...state,
        streams: [
          action.payload,
          ...state.streams.filter((s) => s.stream_id !== action.payload.stream_id),
        ],
      };
    case 'stream/evict': {
      // recording-inspection-implementation-v1 M12 frontend-react F1.
      // Reducer-internal eviction so the listener doesn't have to
      // close over a fresh `state.streams` snapshot every render.
      const id = action.payload;
      const streams = state.streams.filter((s) => s.stream_id !== id);
      const activeStreamId = state.activeStreamId === id ? null : state.activeStreamId;
      return { ...state, streams, activeStreamId };
    }
    case 'stream/active': {
      const s = state.streams.find((x) => x.stream_id === action.payload);
      const layout = state.layout || 'single';
      // Seed at least one default view when activating a stream the first time.
      const channel =
        (s?.available_channels || []).find((c) => c === 'HG-G') ||
        (s?.available_channels || [])[0] ||
        'HG-G';
      const views =
        state.views.length > 0
          ? state.views
          : [DEFAULT_VIEW({ name: channel, channel, colormap: 'viridis' })];
      return {
        ...state,
        activeStreamId: action.payload,
        views,
        layout,
        selectedViewId: views[0].view_id,
      };
    }
    case 'frame/set':
      return { ...state, frame: Math.max(0, Number(action.payload) | 0) };
    case 'play/toggle':
      return { ...state, playing: !state.playing };
    case 'play/set':
      return { ...state, playing: !!action.payload };
    case 'range/set':
      return { ...state, range: action.payload };
    case 'speed/set':
      return { ...state, playbackSpeed: action.payload };
    case 'fps/set':
      return { ...state, playbackFps: action.payload };
    case 'view/add': {
      const v = DEFAULT_VIEW(action.payload || {});
      return {
        ...state,
        views: [...state.views, v],
        selectedViewId: v.view_id,
      };
    }
    case 'view/remove': {
      const next = state.views.filter((v) => v.view_id !== action.payload);
      return {
        ...state,
        views: next,
        selectedViewId:
          state.selectedViewId === action.payload
            ? (next[0]?.view_id ?? null)
            : state.selectedViewId,
      };
    }
    case 'view/duplicate': {
      const src = state.views.find((v) => v.view_id === action.payload);
      if (!src) return state;
      const dup = DEFAULT_VIEW({ ...src, name: `${src.name} (copy)` });
      return { ...state, views: [...state.views, dup], selectedViewId: dup.view_id };
    }
    case 'view/select':
      return { ...state, selectedViewId: action.payload };
    case 'view/update': {
      const { id, patch } = action.payload;
      return {
        ...state,
        views: state.views.map((v) => (v.view_id === id ? { ...v, ...patch } : v)),
      };
    }
    case 'view/lock': {
      const { id, frame } = action.payload;
      return {
        ...state,
        views: state.views.map((v) => (v.view_id === id ? { ...v, locked_frame: frame } : v)),
      };
    }
    case 'layout/set':
      return { ...state, layout: action.payload };
    case 'modal/open':
      return { ...state, modal: action.payload };
    case 'modal/close':
      return { ...state, modal: null };
    case 'reset':
      return { ...initialState };
    default:
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[playback] unknown action', action?.type);
      }
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const PlaybackCtx = createContext(null);

export const usePlayback = () => {
  const v = useContext(PlaybackCtx);
  if (!v) throw new Error('usePlayback must be used inside <PlaybackProvider>');
  return v;
};

export const PlaybackProvider = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  // ----- Eviction kind-routing (risk-skeptic P0-B) -----
  // Subscribe to mantis:source-evicted events and clear local cache
  // for stream/recording/dark/job kinds.
  // M12 frontend-react F1: subscribe once with `[]` deps and route
  // through the reducer (`stream/evict`) so the handler doesn't
  // capture a stale `state.streams` snapshot. The reducer reads
  // current state via its own argument.
  useEffect(() => {
    const onEvicted = (ev) => {
      const kind = ev.detail?.kind ?? 'source';
      const id = ev.detail?.source_id;
      if (!id) return;
      if (kind === 'recording') dispatch({ type: 'recording/removed', payload: id });
      else if (kind === 'dark') dispatch({ type: 'dark/removed', payload: id });
      else if (kind === 'stream') dispatch({ type: 'stream/evict', payload: id });
    };
    window.addEventListener('mantis:source-evicted', onEvicted);
    return () => window.removeEventListener('mantis:source-evicted', onEvicted);
  }, []);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <PlaybackCtx.Provider value={value}>{children}</PlaybackCtx.Provider>;
};

// ---------------------------------------------------------------------------
// Feature flag (risk-skeptic P1-K). Default OFF until M11 close.
// ---------------------------------------------------------------------------

export const PLAYBACK_FLAG_KEY = 'mantis/playback/enabled';

export const playbackEnabled = () => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(PLAYBACK_FLAG_KEY) === '1';
  } catch {
    return false;
  }
};
