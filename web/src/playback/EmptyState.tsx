// @ts-nocheck
// recording-inspection-implementation-v1 M5 — Playback empty hero.
// Per spec.md W1 + flows.md F1.

import React from 'react';
import { Button, Icon, Kbd, useTheme } from '../shared.tsx';

export const PlaybackEmptyState = ({ onLoadSample, onOpenFile, busy }) => {
  const t = useTheme();
  return (
    <div
      data-screen-label="Playback empty state"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: t.bg,
        padding: 40,
        minHeight: 0,
      }}
    >
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 14,
            background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})`,
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Icon name="film" size={32} />
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: t.text,
            marginBottom: 8,
          }}
        >
          Open a recording to begin
        </div>
        <div
          style={{
            fontSize: 13,
            color: t.textMuted,
            lineHeight: 1.55,
            marginBottom: 22,
          }}
        >
          Load one or more HDF5 recordings from the Mantis bench. Playback will infer channels,
          timestamps, and exposure automatically. Drag additional files into the Sources panel to
          extend the stream.
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <Button variant="primary" icon="film" size="md" onClick={onLoadSample} disabled={busy}>
            {busy ? 'Loading…' : 'Load synthetic sample'}
          </Button>
          <Button icon="open" size="md" onClick={onOpenFile} disabled={busy}>
            Open recording…
          </Button>
        </div>
        <div
          style={{
            padding: 14,
            background: t.panel,
            border: `1px dashed ${t.borderStrong}`,
            borderRadius: 6,
            color: t.textMuted,
            fontSize: 12,
          }}
        >
          Drop <kbd>.h5</kbd> files here to build a stream.
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 11,
            color: t.textFaint,
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
          }}
        >
          <span>
            <Kbd>4</Kbd> mode
          </span>
          <span>
            <Kbd>Space</Kbd> play / pause
          </span>
          <span>
            <Kbd>←</Kbd> <Kbd>→</Kbd> step frame
          </span>
        </div>
      </div>
    </div>
  );
};
