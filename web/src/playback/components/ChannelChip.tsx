// ChannelChip — colored pill identifying a channel (HG-R, LG-NIR, …).
//
// Per design spec §11.4: color is paired with text, never alone. The
// chip shows a 6 px swatch + the channel code in mono, on a neutral
// background. The swatch matches CHANNEL_COLOR[channel].

import React from 'react';

import { CHANNEL_COLOR, ChannelKey } from '../tokens';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

interface Props {
  channel: ChannelKey | string;
  size?: 'sm' | 'md';
  title?: string;
}

export const ChannelChip: React.FC<Props> = ({ channel, size = 'md', title }) => {
  const color = (CHANNEL_COLOR as Record<string, string>)[channel] ?? PALETTE.textMuted;
  const padX = size === 'sm' ? SPACE.xs : SPACE.sm;
  const padY = size === 'sm' ? 1 : 2;
  return (
    <span
      title={title ?? channel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: SPACE.xs,
        padding: `${padY}px ${padX}px`,
        background: PALETTE.panelAlt,
        border: `1px solid ${PALETTE.border}`,
        borderRadius: RADIUS.sm,
        font: size === 'sm' ? FONT.monoSmall : FONT.mono,
        color: PALETTE.text,
        userSelect: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: size === 'sm' ? 6 : 8,
          height: size === 'sm' ? 6 : 8,
          borderRadius: 2,
          background: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span>{channel}</span>
    </span>
  );
};
