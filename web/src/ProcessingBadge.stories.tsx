// recording-inspection-implementation-v1 M11 — Storybook story for the
// Playback ProcessingBadge primitive. Per planner-architect P2-8, all
// Playback Storybook stories live alongside the existing
// Brand/Buttons/ChannelChip stories.
//
// Note: ProcessingBadge is local to ViewerCard.tsx (not exported from
// shared.tsx). To keep the story self-contained and avoid pulling the
// whole ViewerCard tree, we re-render the badge inline with the same
// markup the component produces. When/if ProcessingBadge gets promoted
// to shared.tsx (M12 polish), this story should `import { ProcessingBadge }
// from './shared.tsx'` and drop the inline version.
import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import * as _shared from './shared.tsx';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const { ThemeCtx, THEMES } = _s;

const TONES: Record<string, { bg: string; fg: string; br: string }> = {
  neutral: { bg: '#eef0f4', fg: '#5d6773', br: '#d8dde6' },
  accent: { bg: '#e4efff', fg: '#1560d9', br: 'transparent' },
  warn: { bg: 'rgba(197, 127, 0, 0.14)', fg: '#c57f00', br: 'transparent' },
};

const BADGES = {
  RAW: { tone: 'neutral', title: 'Raw channel · no processing' },
  DRK: { tone: 'accent', title: 'Dark-corrected' },
  NRM: { tone: 'accent', title: 'Normalized (min / max)' },
  LUT: { tone: 'accent', title: 'Non-linear colormap applied' },
  RGB: { tone: 'accent', title: 'RGB grading applied' },
  OVL: { tone: 'warn', title: 'Overlay layer active' },
  LCK: { tone: 'warn', title: 'Locked to specific frame' },
} as const;

interface BadgeProps {
  id: keyof typeof BADGES;
}

const Badge = ({ id }: BadgeProps) => {
  const def = BADGES[id];
  const tone = TONES[def.tone];
  return (
    <span
      title={def.title}
      data-badge={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '1px 5px',
        background: tone.bg,
        color: tone.fg,
        border: `1px solid ${tone.br}`,
        borderRadius: 3,
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {id}
    </span>
  );
};

const ThemeFrame = ({
  theme = 'light',
  children,
}: {
  theme?: 'light' | 'dark';
  children: React.ReactNode;
}) => (
  <ThemeCtx.Provider value={THEMES[theme]}>
    <div
      style={{
        padding: 24,
        background: THEMES[theme].bg,
        color: THEMES[theme].text,
        fontFamily: '"Inter Tight", system-ui, sans-serif',
      }}
    >
      {children}
    </div>
  </ThemeCtx.Provider>
);

const Host = ({ id, theme = 'light' }: BadgeProps & { theme?: 'light' | 'dark' }) => (
  <ThemeFrame theme={theme}>
    <Badge id={id} />
  </ThemeFrame>
);

const meta: Meta<typeof Host> = {
  title: 'Playback / ProcessingBadge',
  component: Host,
  argTypes: {
    id: {
      control: 'select',
      options: Object.keys(BADGES),
    },
    theme: { control: 'inline-radio', options: ['light', 'dark'] },
  },
};
export default meta;

type Story = StoryObj<typeof Host>;

export const Raw: Story = { args: { id: 'RAW' } };
export const Dark: Story = { args: { id: 'DRK' } };
export const Normalized: Story = { args: { id: 'NRM' } };
export const Lut: Story = { args: { id: 'LUT' } };
export const Rgb: Story = { args: { id: 'RGB' } };
export const Overlay: Story = { args: { id: 'OVL' } };
export const Locked: Story = { args: { id: 'LCK' } };
export const AllBadges: Story = {
  render: (args) => (
    <ThemeFrame theme={args.theme}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {Object.keys(BADGES).map((id) => (
          <Badge key={id} id={id as keyof typeof BADGES} />
        ))}
      </div>
    </ThemeFrame>
  ),
  args: { id: 'RAW', theme: 'light' },
};
