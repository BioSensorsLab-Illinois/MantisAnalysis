// Transport — bottom strip with timeline + play/pause + frame readout.

import React from 'react';

import { TabDTO, StreamDTO, patchTab } from '../api';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { Glyph } from './Glyph';
import { IconButton } from './IconButton';

const { useEffect, useRef, useState } = React;

interface Props {
  tab: TabDTO;
  stream: StreamDTO | null;
  onError: (msg: string) => void;
}

const PLAY_FPS = 12;

export const Transport: React.FC<Props> = ({ tab, stream, onError }) => {
  const total = stream?.total_frames ?? 0;
  const ceiling = Math.max(total - 1, 0);
  const [playing, setPlaying] = useState(false);
  // M5 will wire scrub-while-dragging; for now scrubber click jumps directly.
  const lastSyncedRef = useRef(tab.active_frame);

  useEffect(() => {
    lastSyncedRef.current = tab.active_frame;
  }, [tab.active_frame]);

  // Playback ticker — patches active_frame at PLAY_FPS.
  useEffect(() => {
    if (!playing || total === 0) return;
    const id = window.setInterval(() => {
      const next = (lastSyncedRef.current + 1) % total;
      lastSyncedRef.current = next;
      patchTab(tab.tab_id, { active_frame: next }).catch((e) =>
        onError(e instanceof Error ? e.message : String(e))
      );
    }, 1000 / PLAY_FPS);
    return () => window.clearInterval(id);
  }, [playing, total, tab.tab_id, onError]);

  const sendFrame = (n: number) => {
    const clamped = Math.max(0, Math.min(ceiling, n));
    patchTab(tab.tab_id, { active_frame: clamped }).catch((e) =>
      onError(e instanceof Error ? e.message : String(e))
    );
  };

  const displayFrame = tab.active_frame;
  const pct = total > 0 ? (displayFrame / Math.max(1, ceiling)) * 100 : 0;

  return (
    <div
      data-region="transport"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.xs,
        padding: SPACE.sm,
        borderTop: `1px solid ${PALETTE.border}`,
        background: PALETTE.panel,
        flexShrink: 0,
      }}
    >
      {/* Scrubber */}
      <div
        style={{
          height: 24,
          position: 'relative',
          background: PALETTE.panelAlt,
          borderRadius: RADIUS.md,
          cursor: total ? 'pointer' : 'default',
        }}
        onClick={(e) => {
          if (!total) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          const f = Math.round((x / rect.width) * ceiling);
          sendFrame(f);
        }}
      >
        {/* Played-portion fill */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${pct}%`,
            background: PALETTE.accentSoft,
            borderRadius: RADIUS.md,
            pointerEvents: 'none',
          }}
        />
        {/* Caret */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${pct}%`,
            transform: 'translateX(-1px)',
            height: '100%',
            width: 2,
            background: PALETTE.accent,
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SPACE.sm,
          font: FONT.small,
          color: PALETTE.textMuted,
        }}
      >
        <IconButton
          glyph={<Glyph name="skipBack" size={14} />}
          label="First frame"
          onClick={() => sendFrame(0)}
          tone="neutral"
          hover
          size="md"
        />
        <IconButton
          glyph={<Glyph name="stepBack" size={14} />}
          label="Previous frame"
          onClick={() => sendFrame(tab.active_frame - 1)}
          tone="neutral"
          hover
          size="md"
        />
        <IconButton
          glyph={<Glyph name={playing ? 'pause' : 'play'} size={16} />}
          label={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((p) => !p)}
          tone="accent"
          variant="solid"
          size="md"
        />
        <IconButton
          glyph={<Glyph name="stepForward" size={14} />}
          label="Next frame"
          onClick={() => sendFrame(tab.active_frame + 1)}
          tone="neutral"
          hover
          size="md"
        />
        <IconButton
          glyph={<Glyph name="skipForward" size={14} />}
          label="Last frame"
          onClick={() => sendFrame(ceiling)}
          tone="neutral"
          hover
          size="md"
        />
        <span
          style={{
            font: FONT.mono,
            color: PALETTE.text,
            marginLeft: SPACE.md,
            minWidth: 96,
          }}
        >
          f{String(displayFrame).padStart(5, '0')} / {total}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ font: FONT.monoSmall, color: PALETTE.textFaint }}>{PLAY_FPS} fps</span>
      </div>
    </div>
  );
};
