// Concrete palette + typography + spacing for the Playback rebuild.
// Anchored on the design template at design/spec.md §11. Components
// import these instead of hard-coding hex values inline.

import {
  BADGE_TITLE,
  BADGE_TONE,
  CHANNEL_COLOR,
  COLORMAPS,
  FONT,
  ICONS,
  LAYOUT,
  SEVERITY,
  SPACE,
} from './tokens';

export const PALETTE = {
  // Surfaces
  shell: '#0a0a0a', // app shell behind everything
  panel: '#0f1115', // rail / inspector panel
  panelAlt: '#161a24', // nested cards inside panels (group headers)
  rowHover: '#1a1f2c',
  border: '#1f2330',
  borderStrong: '#2a3142',
  divider: '#181c26',

  // Text
  text: '#e5e7eb',
  textMuted: '#9ca3af',
  textFaint: '#6b7280',

  // Accents
  accent: '#3b82f6',
  accentSoft: 'rgba(59, 130, 246, 0.15)',
  accentStrong: '#2563eb',

  // Action colors (paired with icon, never color-only).
  danger: '#ef4444',
  dangerSoft: 'rgba(239, 68, 68, 0.14)',
  warn: '#d97706',
  warnSoft: 'rgba(217, 119, 6, 0.14)',
  success: '#16a34a',
  successSoft: 'rgba(22, 163, 74, 0.14)',
} as const;

export { BADGE_TITLE, BADGE_TONE, CHANNEL_COLOR, COLORMAPS, FONT, ICONS, LAYOUT, SEVERITY, SPACE };

// Composable style fragments used across components.

export const cardOutline = `1px solid ${PALETTE.border}`;
export const focusRing = `0 0 0 2px ${PALETTE.accent}`;

export const RADIUS = { sm: 3, md: 4, lg: 6 } as const;
