// Playback (Recording Inspection) — rebuild v2 entry.
// M0 ships an empty placeholder so the app compiles. M2 wires the
// real workspace via useWorkspace() + SSE.

import React from 'react';
import { LAYOUT, FONT } from './tokens';

export const playbackEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('mantis/playback/enabled') !== '0';
};

export interface PlaybackModeProps {
  say?: (msg: string, kind?: string) => void;
  onOpenFile?: () => void;
}

export const PlaybackMode: React.FC<PlaybackModeProps> = () => {
  return (
    <div
      data-region="playback-mode"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        background: '#0a0a0a',
        color: '#e5e7eb',
        font: FONT.ui,
      }}
    >
      <div style={{ font: FONT.uiBold, fontSize: 18, color: '#9ca3af' }}>
        Playback — Recording Inspection
      </div>
      <div style={{ font: FONT.small, color: '#6b7280' }}>
        Rebuild v2 — M0 scaffold. Wire-up arrives in M2.
      </div>
      <div style={{ font: FONT.monoSmall, color: '#4b5563', marginTop: LAYOUT.modeRailW / 2 }}>
        playback-rebuild-v2 / M0
      </div>
    </div>
  );
};
