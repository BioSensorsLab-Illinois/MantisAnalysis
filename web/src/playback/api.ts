// Typed wrappers around /api/playback/*. Thin pass-through —
// no caching here; that lives in usePlaybackState.
//
// Per UI_IMPLEMENTATION_NOTES §15, network calls live in this
// single file so Playwright can mock them via route interception
// when needed. Production callers reach the real synthetic
// endpoints (gated by MANTIS_PLAYBACK_TEST=1) for tests; for users
// they reach the regular load-path / upload routes.

// @ts-nocheck
import { API_BASE, apiFetch, apiUpload } from '../shared.tsx';

export const playbackApi = {
  health: () => apiFetch('/api/playback/health'),

  // Recordings
  inspectRecording: (path) =>
    apiFetch('/api/playback/recordings/inspect', {
      method: 'POST',
      body: JSON.stringify({ path }),
      headers: { 'Content-Type': 'application/json' },
    }),
  loadRecordingByPath: (path, name) =>
    apiFetch('/api/playback/recordings/load-path', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
      headers: { 'Content-Type': 'application/json' },
    }),
  loadSampleRecording: () => apiFetch('/api/playback/recordings/load-sample', { method: 'POST' }),
  uploadRecording: (file) => apiUpload('/api/playback/recordings/upload', file),
  listRecordings: () => apiFetch('/api/playback/recordings'),
  deleteRecording: (rid) => apiFetch(`/api/playback/recordings/${rid}`, { method: 'DELETE' }),

  // Darks
  loadDarkByPath: (path, opts = {}) =>
    apiFetch('/api/playback/darks/load-path', {
      method: 'POST',
      body: JSON.stringify({ path, ...opts }),
      headers: { 'Content-Type': 'application/json' },
    }),
  loadSampleDark: () => apiFetch('/api/playback/darks/load-sample', { method: 'POST' }),
  uploadDark: (file, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.strategy) q.set('strategy', opts.strategy);
    if (opts.sigma_threshold != null) q.set('sigma_threshold', String(opts.sigma_threshold));
    if (opts.max_frames != null) q.set('max_frames', String(opts.max_frames));
    return apiUpload(`/api/playback/darks/upload?${q.toString()}`, file);
  },
  listDarks: () => apiFetch('/api/playback/darks'),
  deleteDark: (did) => apiFetch(`/api/playback/darks/${did}`, { method: 'DELETE' }),

  // Streams
  buildStream: (recordingIds, opts = {}) =>
    apiFetch('/api/playback/streams', {
      method: 'POST',
      body: JSON.stringify({ recording_ids: recordingIds, ...opts }),
      headers: { 'Content-Type': 'application/json' },
    }),
  listStreams: () => apiFetch('/api/playback/streams'),
  getStream: (sid) => apiFetch(`/api/playback/streams/${sid}`),
  deleteStream: (sid) => apiFetch(`/api/playback/streams/${sid}`, { method: 'DELETE' }),
  lookupFrame: (sid, frame) => apiFetch(`/api/playback/streams/${sid}/lookup?frame=${frame}`),
};

// URL builder for the preview <img>. Returns the same URL that
// playback_pipeline.render_frame_to_png produces server-side.
export const previewPngUrl = (streamId, frame, view) => {
  if (!streamId) return '';
  const q = new URLSearchParams();
  if (view) {
    q.set('view_type', view.type ?? 'single');
    q.set('channel', view.channel ?? 'HG-G');
    if (view.channels && view.channels.length === 3) q.set('channels', view.channels.join(','));
    q.set('low', String(view.low ?? 30));
    q.set('high', String(view.high ?? 900));
    q.set('colormap', view.colormap ?? 'viridis');
    q.set('invert', view.invert ? '1' : '0');
    q.set('show_clipped', view.show_clipped ? '1' : '0');
    q.set('dark_on', view.dark_on ? '1' : '0');
    q.set('gain', String(view.gain ?? 1));
    q.set('offset', String(view.offset ?? 0));
    q.set('normalize', view.normalize ? '1' : '0');
    if (view.type === 'rgb') {
      const [gr, gg, gb] = view.rgb_gain ?? [1, 1, 1];
      const [or, og, ob] = view.rgb_offset ?? [0, 0, 0];
      q.set('rgb_gain_r', String(gr));
      q.set('rgb_gain_g', String(gg));
      q.set('rgb_gain_b', String(gb));
      q.set('rgb_offset_r', String(or));
      q.set('rgb_offset_g', String(og));
      q.set('rgb_offset_b', String(ob));
      q.set('gamma', String(view.gamma ?? 1));
      q.set('contrast', String(view.contrast ?? 1));
      q.set('saturation', String(view.saturation ?? 1));
      q.set('wb_k', String(view.wb_k ?? 5500));
      if (view.ccm_on) q.set('ccm_on', '1');
    }
    if (view.overlay_on) {
      q.set('overlay_on', '1');
      q.set('overlay_channel', view.overlay_channel ?? 'HG-NIR');
      q.set('overlay_low', String(view.overlay_low ?? 300));
      q.set('overlay_high', String(view.overlay_high ?? 900));
      q.set('overlay_blend', view.overlay_blend ?? 'alpha');
      q.set('overlay_strength', String(view.overlay_strength ?? 0.65));
      q.set('overlay_cmap', view.overlay_cmap ?? 'inferno');
    }
    q.set('labels_timestamp', view.labels_timestamp !== false ? '1' : '0');
    q.set('labels_frame', view.labels_frame !== false ? '1' : '0');
    q.set('labels_badges', view.labels_badges !== false ? '1' : '0');
  }
  return `${API_BASE}/api/playback/streams/${streamId}/frame/${frame}.png?${q.toString()}`;
};
