// Field — labeled control row used across Inspector tabs.

import React from 'react';

import { FONT, PALETTE, SPACE } from '../theme';

interface Props {
  label: string;
  children: React.ReactNode;
}

export const Field: React.FC<Props> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
    <span
      style={{
        font: FONT.label,
        color: PALETTE.textFaint,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
    {children}
  </div>
);
