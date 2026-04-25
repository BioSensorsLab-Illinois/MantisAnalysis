// Glyph — inline SVG icons used across Playback.
//
// Replaces Unicode glyphs (▶, ✕, ⏸, ⏮, ⏭) per react-ui-ux-reviewer P1:
// glyphs render inconsistently across fonts/weights and read as
// pixelated. Each icon is a tiny stroked path matching Lucide style.

import React from 'react';

export type GlyphName =
  | 'play'
  | 'pause'
  | 'skipBack'
  | 'skipForward'
  | 'stepBack'
  | 'stepForward'
  | 'close'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown';

interface Props {
  name: GlyphName;
  size?: number;
  color?: string;
  fill?: string;
  strokeWidth?: number;
}

export const Glyph: React.FC<Props> = ({
  name,
  size = 14,
  color = 'currentColor',
  fill = 'none',
  strokeWidth = 1.6,
}) => {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'play':
      return (
        <svg {...common}>
          <polygon points="6 4 20 12 6 20 6 4" fill={color} stroke="none" />
        </svg>
      );
    case 'pause':
      return (
        <svg {...common}>
          <rect x="6" y="4" width="4" height="16" fill={color} stroke="none" />
          <rect x="14" y="4" width="4" height="16" fill={color} stroke="none" />
        </svg>
      );
    case 'skipBack':
      return (
        <svg {...common}>
          <polygon points="19 4 9 12 19 20 19 4" fill={color} stroke="none" />
          <line x1="5" y1="4" x2="5" y2="20" />
        </svg>
      );
    case 'skipForward':
      return (
        <svg {...common}>
          <polygon points="5 4 15 12 5 20 5 4" fill={color} stroke="none" />
          <line x1="19" y1="4" x2="19" y2="20" />
        </svg>
      );
    case 'stepBack':
      return (
        <svg {...common}>
          <polygon points="14 4 6 12 14 20 14 4" fill={color} stroke="none" />
        </svg>
      );
    case 'stepForward':
      return (
        <svg {...common}>
          <polygon points="10 4 18 12 10 20 10 4" fill={color} stroke="none" />
        </svg>
      );
    case 'close':
      return (
        <svg {...common}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      );
    case 'chevronLeft':
      return (
        <svg {...common}>
          <polyline points="15 18 9 12 15 6" />
        </svg>
      );
    case 'chevronRight':
      return (
        <svg {...common}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      );
    case 'chevronDown':
      return (
        <svg {...common}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      );
  }
};
