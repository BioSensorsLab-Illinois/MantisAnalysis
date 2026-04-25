// @ts-nocheck
// Storybook stories for the Playback rebuild visual primitives.
// Each story renders against the dark shell so the design language
// is reviewable end-to-end without spinning up the whole workspace.

import React from 'react';

import { ChannelChip } from '../ChannelChip';
import { ExposurePill, formatExposure } from '../ExposurePill';
import { IconButton } from '../IconButton';
import { ProcessingBadge } from '../ProcessingBadge';
import { CHANNEL_COLOR, BADGE_TONE, FONT, PALETTE, SPACE } from '../../theme';

const PANEL_BG = PALETTE.panel;

const Frame: React.FC<{ children: React.ReactNode; title: string }> = ({ children, title }) => (
  <div
    style={{
      background: PANEL_BG,
      color: PALETTE.text,
      padding: SPACE.lg,
      font: FONT.ui,
      borderRadius: 6,
      border: `1px solid ${PALETTE.border}`,
      maxWidth: 640,
      display: 'flex',
      flexDirection: 'column',
      gap: SPACE.md,
    }}
  >
    <div style={{ font: FONT.label, color: PALETTE.textMuted, letterSpacing: 0.6 }}>{title}</div>
    {children}
  </div>
);

export default {
  title: 'Playback / Primitives',
  parameters: {
    backgrounds: { default: 'app-dark' },
    layout: 'padded',
  },
};

export const ChannelChips = () => (
  <Frame title="ChannelChip · 10 channels (HG full saturation, LG light)">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
      {Object.keys(CHANNEL_COLOR).map((c) => (
        <ChannelChip key={c} channel={c} />
      ))}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
      {Object.keys(CHANNEL_COLOR).map((c) => (
        <ChannelChip key={c} channel={c} size="sm" />
      ))}
    </div>
  </Frame>
);

export const ProcessingBadges = () => (
  <Frame title="ProcessingBadge · 8 codes × on / off">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
      {(Object.keys(BADGE_TONE) as Array<keyof typeof BADGE_TONE>).map((id) => (
        <ProcessingBadge key={id} id={id} active />
      ))}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
      {(Object.keys(BADGE_TONE) as Array<keyof typeof BADGE_TONE>).map((id) => (
        <ProcessingBadge key={id} id={id} active={false} />
      ))}
    </div>
  </Frame>
);

export const ExposurePills = () => {
  const samples = [null, 0.000005, 0.005, 0.025, 0.1, 0.3, 0.4, 1.0, 2.5];
  return (
    <Frame title="ExposurePill · auto-unit (µs / ms / s)">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
        {samples.map((s, i) => (
          <ExposurePill key={i} exposure_s={s} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm }}>
        {samples.map((s, i) => (
          <ExposurePill key={i} exposure_s={s} warn />
        ))}
      </div>
      <div style={{ font: FONT.small, color: PALETTE.textFaint }}>
        Formats: {samples.map((s) => formatExposure(s)).join(' · ')}
      </div>
    </Frame>
  );
};

export const IconButtons = () => {
  const noop = () => {};
  return (
    <Frame title="IconButton · ghost / solid × accent / danger / warn / neutral">
      <div style={{ display: 'flex', gap: SPACE.sm, flexWrap: 'wrap' }}>
        <IconButton glyph="▶" label="Play" onClick={noop} tone="accent" hover />
        <IconButton glyph="✕" label="Remove" onClick={noop} tone="danger" hover />
        <IconButton glyph="⏸" label="Pause" onClick={noop} tone="neutral" hover />
        <IconButton glyph="🔒" label="Lock to frame" onClick={noop} tone="warn" hover />
        <IconButton glyph="▶" label="Play (ghost)" onClick={noop} tone="accent" />
        <IconButton glyph="✕" label="Remove (ghost)" onClick={noop} tone="danger" />
      </div>
    </Frame>
  );
};
