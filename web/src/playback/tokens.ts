// Visual tokens for Playback (rebuild v2). Source of truth for color,
// typography, spacing, and icon names used by every Playback component.
//
// Anchored on the design template at
// `.agent/runs/playback-rebuild-v2/design/spec.md` §11.

export type ChannelKey =
  | 'HG-R'
  | 'HG-G'
  | 'HG-B'
  | 'HG-NIR'
  | 'HG-Y'
  | 'LG-R'
  | 'LG-G'
  | 'LG-B'
  | 'LG-NIR'
  | 'LG-Y';

// Per-channel colors. HG bands at full saturation; matching LG bands
// share hue but render lighter so they read as "the LG counterpart".
export const CHANNEL_COLOR: Record<ChannelKey, string> = {
  'HG-R': '#ef4444',
  'LG-R': '#fca5a5',
  'HG-G': '#22c55e',
  'LG-G': '#86efac',
  'HG-B': '#3b82f6',
  'LG-B': '#93c5fd',
  'HG-NIR': '#a855f7',
  'LG-NIR': '#d8b4fe',
  'HG-Y': '#eab308',
  'LG-Y': '#fde047',
};

// Severity colors for badges + warning banners.
export const SEVERITY = {
  info: { fg: '#2563eb', bg: 'rgba(37, 99, 235, 0.12)', border: '#2563eb' },
  warn: { fg: '#d97706', bg: 'rgba(217, 119, 6, 0.14)', border: '#d97706' },
  danger: { fg: '#dc2626', bg: 'rgba(220, 38, 38, 0.12)', border: '#dc2626' },
  success: { fg: '#16a34a', bg: 'rgba(22, 163, 74, 0.14)', border: '#16a34a' },
} as const;

// Typography. Bumped from v1's 10/11 px to 13/15 px body.
export const FONT = {
  ui: '13px/1.4 InterVariable, system-ui, sans-serif',
  uiBold: '600 13px/1.4 InterVariable, system-ui, sans-serif',
  small: '11.5px/1.4 InterVariable, system-ui, sans-serif',
  mono: '12px/1.4 ui-monospace, "JetBrains Mono", Menlo, monospace',
  monoSmall: '10.5px/1.4 ui-monospace, Menlo, monospace',
  label: '600 10.5px/1.2 InterVariable, system-ui, sans-serif', // section headers, uppercase
} as const;

// 4px grid.
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 32,
} as const;

// Layout proportions per design spec §5.4.
export const LAYOUT = {
  modeRailW: 56,
  topBarH: 50,
  streamHeaderH: 44,
  sourcesPanelW: { default: 288, min: 240, max: 360 },
  inspectorW: { default: 368, min: 320, max: 440 },
  timelineH: { compact: 96, normal: 120, zoomed: 200 },
  statusBarH: 26,
  // Below this width the sources panel collapses to a 44 px icon rail.
  narrowBreakpoint: 1180,
} as const;

// Lucide-style icon names used across components. Each component
// imports by name from a central icon registry built in M2.
export const ICONS = {
  // mode rail
  film: 'film',
  // library
  filePlus: 'file-plus',
  folderOpen: 'folder-open',
  trash: 'trash-2',
  drag: 'grip-vertical',
  // dark frames
  moon: 'moon',
  link: 'link',
  // viewer
  play: 'play',
  pause: 'pause',
  stepBack: 'step-back',
  stepForward: 'step-forward',
  skipBack: 'skip-back',
  skipForward: 'skip-forward',
  lock: 'lock',
  // inspector
  eye: 'eye',
  sliders: 'sliders-horizontal',
  palette: 'palette',
  layers: 'layers',
  tag: 'tag',
  download: 'download',
  // status
  warning: 'alert-triangle',
  error: 'alert-octagon',
  info: 'info',
  success: 'check-circle',
  chevron: 'chevron-down',
} as const;

// Processing badge mapping from design spec §7.1.5. 3-letter mono.
export type BadgeId = 'RAW' | 'DRK' | 'NRM' | 'LUT' | 'RGB' | 'OVL' | 'LCK' | 'EXP';

export const BADGE_TONE: Record<BadgeId, 'neutral' | 'accent' | 'warn' | 'success'> = {
  RAW: 'neutral',
  DRK: 'accent',
  NRM: 'accent',
  LUT: 'accent',
  RGB: 'accent',
  OVL: 'warn',
  LCK: 'warn',
  EXP: 'success',
};

export const BADGE_TITLE: Record<BadgeId, string> = {
  RAW: 'Raw channel · no processing',
  DRK: 'Dark-corrected',
  NRM: 'Normalized (min / max)',
  LUT: 'Non-linear colormap applied',
  RGB: 'RGB grading applied',
  OVL: 'Overlay layer active',
  LCK: 'Locked to specific frame',
  EXP: 'Included in current export',
};

// Colormaps offered in the inspector. Same names matplotlib accepts.
export const COLORMAPS = [
  'viridis',
  'inferno',
  'magma',
  'plasma',
  'cividis',
  'turbo',
  'gray',
  'hot',
  'cool',
] as const;
