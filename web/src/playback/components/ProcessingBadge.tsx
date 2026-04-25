// ProcessingBadge — 3-letter mono chip showing per-view processing
// state (RAW / DRK / NRM / LUT / RGB / OVL / LCK / EXP).
//
// Per design spec §7.1.5. Color carries severity, code carries
// meaning — pair, never substitute.

import React from 'react';

import { BADGE_TITLE, BADGE_TONE, BadgeId } from '../tokens';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

interface Props {
  id: BadgeId;
  active?: boolean;
}

const TONES = {
  neutral: { bg: PALETTE.panelAlt, fg: PALETTE.textMuted, border: PALETTE.border },
  accent: { bg: PALETTE.accentSoft, fg: PALETTE.accent, border: PALETTE.accent },
  warn: { bg: PALETTE.warnSoft, fg: PALETTE.warn, border: PALETTE.warn },
  success: { bg: PALETTE.successSoft, fg: PALETTE.success, border: PALETTE.success },
} as const;

export const ProcessingBadge: React.FC<Props> = ({ id, active = true }) => {
  const tone = TONES[BADGE_TONE[id]];
  return (
    <span
      title={BADGE_TITLE[id]}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: `1px ${SPACE.xs + 1}px`,
        background: active ? tone.bg : 'transparent',
        color: active ? tone.fg : PALETTE.textFaint,
        border: `1px solid ${active ? tone.border : PALETTE.border}`,
        borderRadius: RADIUS.sm,
        font: FONT.monoSmall,
        fontWeight: 600,
        letterSpacing: 0.3,
        opacity: active ? 1 : 0.4,
        userSelect: 'none',
      }}
    >
      {id}
    </span>
  );
};
