// Phase 7 follow-up — stories for the ChannelChip primitive (channel
// swatch + gain prefix + select toggle). The boot-page a11y violations
// caught in B-0026 (color-contrast against the gain-prefix span) can be
// regression-checked here once the addon-a11y panel is open.
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';

import * as _shared from './shared.tsx';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const { ChannelChip, ThemeCtx, THEMES } = _s;

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
        minWidth: 220,
      }}
    >
      {children}
    </div>
  </ThemeCtx.Provider>
);

interface ChipHostProps {
  id: string;
  selected?: boolean;
  multi?: boolean;
  size?: 'sm' | 'md';
  theme?: 'light' | 'dark';
}

const ChipHost = ({
  id,
  selected: initial = false,
  multi,
  size,
  theme = 'light',
}: ChipHostProps) => {
  const [selected, setSelected] = useState(initial);
  return (
    <ThemeFrame theme={theme}>
      <ChannelChip
        id={id}
        selected={selected}
        onToggle={() => setSelected((s) => !s)}
        multi={multi}
        size={size}
      />
    </ThemeFrame>
  );
};

const meta: Meta<typeof ChipHost> = {
  title: 'Primitives/ChannelChip',
  component: ChipHost,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {
    id: {
      control: { type: 'select' },
      options: [
        'HG-R',
        'HG-G',
        'HG-B',
        'HG-NIR',
        'HG-Y',
        'LG-R',
        'LG-G',
        'LG-B',
        'LG-NIR',
        'LG-Y',
        'R',
        'G',
        'B',
        'NIR',
        'Y',
        'L',
      ],
    },
    size: {
      control: { type: 'inline-radio' },
      options: ['sm', 'md'],
    },
    theme: {
      control: { type: 'inline-radio' },
      options: ['light', 'dark'],
    },
    selected: { control: 'boolean' },
    multi: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof ChipHost>;

export const HighGainGreen: Story = {
  args: { id: 'HG-G', selected: true, size: 'md' },
};

export const LowGainNIR: Story = {
  args: { id: 'LG-NIR', selected: false, size: 'md' },
};

export const MultiSelect: Story = {
  args: { id: 'HG-R', selected: true, multi: true, size: 'md' },
};

export const Compact: Story = {
  args: { id: 'HG-Y', selected: true, size: 'sm' },
};

export const DarkTheme: Story = {
  args: { id: 'HG-B', selected: true, size: 'md', theme: 'dark' },
};
