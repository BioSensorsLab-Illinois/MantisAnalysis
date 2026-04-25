// IconButton — small action button used inside dense rows
// (play, remove, lock, …). Pairs with title for hover; aria-label
// is always set so the button reads as text-equivalent.

import React from 'react';

import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

interface Props {
  glyph: React.ReactNode;
  label: string; // accessible label + tooltip
  onClick: () => void;
  tone?: 'accent' | 'danger' | 'neutral' | 'warn';
  /** Visual emphasis. ghost = transparent until hover; solid = always tinted. */
  variant?: 'ghost' | 'solid';
  hover?: boolean; // pass-through for parent row hover
  disabled?: boolean;
}

const TONES = {
  accent: { fg: PALETTE.accent, bg: PALETTE.accentSoft },
  danger: { fg: PALETTE.danger, bg: PALETTE.dangerSoft },
  warn: { fg: PALETTE.warn, bg: PALETTE.warnSoft },
  neutral: { fg: PALETTE.textMuted, bg: PALETTE.panelAlt },
} as const;

export const IconButton: React.FC<Props> = ({
  glyph,
  label,
  onClick,
  tone = 'neutral',
  variant = 'ghost',
  hover = false,
  disabled = false,
}) => {
  const t = TONES[tone];
  const isFilled = variant === 'solid' || hover;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isFilled ? t.bg : 'transparent',
        color: t.fg,
        border: 'none',
        borderRadius: RADIUS.sm,
        padding: `2px ${SPACE.sm - 2}px`,
        font: FONT.small,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : isFilled ? 1 : 0.7,
        transition: 'opacity 80ms linear, background 80ms linear',
      }}
    >
      {glyph}
    </button>
  );
};
