// Phase 7 follow-up — stories for the Button primitive in shared.tsx.
// Uses the shim pattern (`as any`) since shared.tsx is still @ts-nocheck
// (Phase 5c follow-up). Future sessions that drop @ts-nocheck can
// migrate this to typed Meta<typeof Button>.
import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';

import * as _shared from './shared.tsx';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const { Button, ThemeCtx, THEMES } = _s;

// Storybook needs ThemeCtx to be populated for the Button to read
// theme tokens. Wrap every story in a Provider.
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

interface ButtonHostProps {
  variant?: string;
  size?: string;
  icon?: string;
  children: React.ReactNode;
  disabled?: boolean;
  theme?: 'light' | 'dark';
}

const ButtonHost = ({
  variant,
  size,
  icon,
  children,
  disabled,
  theme = 'light',
}: ButtonHostProps) => (
  <ThemeFrame theme={theme}>
    <Button variant={variant} size={size} icon={icon} disabled={disabled}>
      {children}
    </Button>
  </ThemeFrame>
);

const meta: Meta<typeof ButtonHost> = {
  title: 'Primitives/Button',
  component: ButtonHost,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: { type: 'select' },
      options: ['primary', 'subtle', 'danger'],
    },
    size: {
      control: { type: 'select' },
      options: ['xs', 'sm', 'md', 'lg'],
    },
    theme: {
      control: { type: 'inline-radio' },
      options: ['light', 'dark'],
    },
    disabled: { control: 'boolean' },
    icon: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<typeof ButtonHost>;

export const Primary: Story = {
  args: {
    children: 'Run analysis',
    variant: 'primary',
    size: 'sm',
  },
};

export const Subtle: Story = {
  args: {
    children: 'Cancel',
    variant: 'subtle',
    size: 'sm',
  },
};

export const Danger: Story = {
  args: {
    children: 'Delete recording',
    variant: 'danger',
    size: 'sm',
  },
};

export const WithIcon: Story = {
  args: {
    children: 'Save cfg',
    variant: 'subtle',
    size: 'sm',
    icon: 'download',
  },
};

export const Disabled: Story = {
  args: {
    children: 'Apply (no changes)',
    variant: 'primary',
    size: 'sm',
    disabled: true,
  },
};

export const DarkTheme: Story = {
  args: {
    children: 'Run analysis',
    variant: 'primary',
    size: 'sm',
    theme: 'dark',
  },
};
