// bundler-migration-v1 Phase 7 — Storybook seed story.
//
// A minimal "is Storybook wired up?" story that doesn't depend on the
// complex primitives in shared.tsx (all under @ts-nocheck; their inferred
// prop types are currently over-strict — see isp_settings.tsx shim
// comment). This renders the BRAND swatch + a few color-palette cells so
// future stories have a running Storybook to hang off.
//
// Phase 5c type-tightening + Phase 7 follow-ups add stories for each
// real shared primitive (Card, Button, Chart, Page, PlotStylePanel).
import type { Meta, StoryObj } from '@storybook/react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as _shared from './shared.tsx';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { BRAND, CHANNEL_COLORS } = _shared as any;

// Simple presentational component used only by the story. Intentionally
// local so the story has something to render without pulling in the
// still-@ts-nocheck shared primitives.
const Swatch = ({ name, hex }: { name: string; hex: string }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '8px 12px',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 6,
      background: 'rgba(255,255,255,0.03)',
      fontFamily: '"Inter Tight", system-ui, sans-serif',
      fontSize: 13,
      color: '#e6e8eb',
    }}
  >
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 4,
        background: hex,
        border: '1px solid rgba(255,255,255,0.15)',
      }}
    />
    <span style={{ minWidth: 72, color: '#c6cbd1' }}>{name}</span>
    <code
      style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        color: '#8a93a0',
      }}
    >
      {hex}
    </code>
  </div>
);

interface BrandPaletteProps {
  title?: string;
}

const BrandPalette = ({ title = 'MantisAnalysis' }: BrandPaletteProps) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      padding: '24px',
      maxWidth: 520,
      fontFamily: '"Inter Tight", system-ui, sans-serif',
    }}
  >
    <header>
      <h1 style={{ color: '#fff', fontSize: 20, margin: 0 }}>{title}</h1>
      <p style={{ color: '#8a93a0', fontSize: 13, margin: '4px 0 0' }}>
        BRAND.name = <code>{BRAND?.name}</code> · BRAND.version =<code> {BRAND?.version}</code>
      </p>
    </header>

    <section>
      <h2
        style={{
          color: '#c6cbd1',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.7,
          margin: '0 0 8px',
        }}
      >
        Channel colors
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.entries(CHANNEL_COLORS ?? {}).map(([name, hex]) => (
          <Swatch key={name} name={name} hex={String(hex)} />
        ))}
      </div>
    </section>
  </div>
);

const meta: Meta<typeof BrandPalette> = {
  title: 'Foundations/Brand',
  component: BrandPalette,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};
export default meta;

type Story = StoryObj<typeof BrandPalette>;

export const Default: Story = {
  args: {
    title: 'MantisAnalysis',
  },
};

export const CustomTitle: Story = {
  args: {
    title: 'MantisAnalysis · BioSensors Lab',
  },
};
