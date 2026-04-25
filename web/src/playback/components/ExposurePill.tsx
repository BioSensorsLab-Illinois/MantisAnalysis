// ExposurePill — formatted exposure-time chip with auto unit
// selection (µs / ms / s). Used in LibraryRail rows + DarkBank.
//
// Per design template (playback.jsx prototype): exposure is the
// primary at-a-glance grouping key for recordings. Worth a typed
// component so units stay consistent.

import React from 'react';

import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

export interface Props {
  exposure_s: number | null;
  /** When true, render as a warning (e.g. mismatch). */
  warn?: boolean;
}

export function formatExposure(exposure_s: number | null): string {
  if (exposure_s == null) return '—';
  if (exposure_s >= 1) return `${exposure_s.toFixed(2)} s`;
  if (exposure_s >= 0.001) return `${(exposure_s * 1000).toFixed(0)} ms`;
  return `${(exposure_s * 1_000_000).toFixed(0)} µs`;
}

export const ExposurePill: React.FC<Props> = ({ exposure_s, warn = false }) => {
  const bg = warn ? PALETTE.warnSoft : PALETTE.panelAlt;
  const fg = warn ? PALETTE.warn : PALETTE.textMuted;
  const border = warn ? PALETTE.warn : PALETTE.border;
  return (
    <span
      title={`Exposure ${formatExposure(exposure_s)}`}
      style={{
        font: FONT.monoSmall,
        color: fg,
        background: bg,
        border: `1px solid ${border}`,
        padding: `1px ${SPACE.sm - 2}px`,
        borderRadius: RADIUS.sm,
        minWidth: 52,
        textAlign: 'center',
        display: 'inline-block',
        userSelect: 'none',
      }}
    >
      {formatExposure(exposure_s)}
    </span>
  );
};
