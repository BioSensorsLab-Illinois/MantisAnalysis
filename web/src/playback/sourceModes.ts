// @ts-nocheck
// playback/sourceModes — extracted from web/src/playback.tsx in
// B-0037 Phase 2.
//
// Source-mode catalog: maps GUI menu options to backend URL builders.
// The dropdown a user sees is filtered against the source's actual
// channel set, so polarization / grayscale-image / image-RGB sources
// work without special cases. play-tab-recording-inspection-rescue-v1
// M4.
//
// Why a separate file:
//   * Pure data + pure helpers — no React, no JSX, no module-mutable
//     state. The cleanest piece of playback.tsx to lift.
//   * Used in 30+ places by playback.tsx (every Inspector dropdown,
//     URL builder, gain selector). One module owner avoids drift if
//     a future channel kind is added without all 30 sites updated.
//
// Public surface:
//   * SOURCE_MODES — the canonical catalog.
//   * availableSourceModes(recording) — filter to what the recording
//     actually exposes.
//   * defaultSourceModeId(recording) — pick the most useful default
//     for a new view (honors recording.gainPref).
//   * sourceModeMeta(id) — hash lookup with fall-through to last entry.
//   * availableGains(recording) — subset of ('HG', 'LG', 'HDR') the
//     recording exposes; drives the gain selector visibility.
//   * splitSourceMode(id) → { gain, channelKind } — decompose for
//     gain-flip flows.
//   * composeSourceMode(gain, channelKind) → id — round-trip the
//     above.
//   * CHANNEL_KIND_OPTIONS — channel-kind dropdown for the gain
//     selector.
//   * channelKindOptionsForGain(gain, recording) — filter the above
//     by what the recording exposes.

export const SOURCE_MODES = [
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
  // The pre-baked "NIR over RGB · HG/LG" entries were removed: every overlay
  // is now configured through the 4-step Overlay Builder. The remaining
  // entry is the user-driven custom overlay; the builder writes its base /
  // overlay channel / blend / threshold into `view.overlay`.
  {
    id: 'overlay_custom',
    label: 'Custom overlay…',
    group: 'Overlay',
    kind: 'overlay',
    requires: [],
    baseGain: 'hg',
    overlayChannel: null,
    defaultColormap: 'inferno',
    badge: 'OVL',
  },
  // ---------- ESCAPE HATCH ----------
  // Manual channel picker for any unrecognized layout.
  { id: 'raw', label: 'Pick channel…', group: 'Other', kind: 'raw', badge: 'RAW' },
];

export const availableSourceModes = (recording) => {
  if (!recording || !recording.channels) return [];
  const chs = new Set(recording.channels);
  return SOURCE_MODES.filter((m) => {
    if (m.kind === 'raw') return true;
    if (m.kind === 'rgb' || m.kind === 'rgb_image') return m.requires.every((c) => chs.has(c));
    if (m.kind === 'channel') return chs.has(m.channel);
    if (m.kind === 'overlay') {
      // Custom-overlay is always available (the Overlay Builder lets the
      // user pick whatever base + overlay channels exist on the source).
      return (m.requires || []).every((c) => chs.has(c));
    }
    return false;
  });
};

export const defaultSourceModeId = (recording) => {
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

export const sourceModeMeta = (id) =>
  SOURCE_MODES.find((m) => m.id === id) || SOURCE_MODES[SOURCE_MODES.length - 1];

// Gain selector lives outside the channel dropdown for GSense-style
// recordings. Returns the subset of ('HG', 'LG', 'HDR') the recording
// actually exposes — driven entirely by the channel set, so non-GSense
// (image-only, polarization-only) sources naturally show no gain tabs.
export const availableGains = (recording) => {
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

export const splitSourceMode = (id) => ({
  gain: _GAIN_BY_ID[id] || null,
  channelKind: _CHANNEL_KIND_BY_ID[id] || null,
});

// Compose (gain, channelKind) → source-mode id. HDR doesn't expose pre-Bayer
// raw R/G/B, so falls back to `rgb_hdr` if a raw_* was selected and the
// user switches to HDR.
export const composeSourceMode = (gain, channelKind) => {
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
export const CHANNEL_KIND_OPTIONS = [
  { id: 'rgb', label: 'Visible (RGB)' },
  { id: 'nir', label: 'NIR' },
  { id: 'chroma', label: 'Chroma (Y)' },
  { id: 'raw_r', label: 'Raw — Red' },
  { id: 'raw_g', label: 'Raw — Green' },
  { id: 'raw_b', label: 'Raw — Blue' },
];

export const channelKindOptionsForGain = (gain, recording) => {
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
