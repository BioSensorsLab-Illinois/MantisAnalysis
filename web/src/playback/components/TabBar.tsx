// TabBar — workspace tabs across the top of the viewer area.
//
// Each tab pins one stream. Click to switch active tab; ✕ closes it
// (with cascade if it's the last tab on a stream — handled server-side).

import React from 'react';

import { TabDTO, StreamDTO, closeTab } from '../api';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { IconButton } from './IconButton';

const { useState } = React;

interface Props {
  tabs: TabDTO[];
  streams: StreamDTO[];
  activeTabId: string | null;
  onSelect: (tab_id: string) => void;
  onError: (msg: string) => void;
}

export const TabBar: React.FC<Props> = ({ tabs, streams, activeTabId, onSelect, onError }) => {
  if (tabs.length === 0) return null;
  const streamsById = new Map(streams.map((s) => [s.stream_id, s]));
  return (
    <div
      data-region="tab-bar"
      style={{
        display: 'flex',
        borderBottom: `1px solid ${PALETTE.border}`,
        background: PALETTE.panel,
        height: 36,
        flexShrink: 0,
        overflowX: 'auto',
      }}
    >
      {tabs.map((t) => {
        const stream = streamsById.get(t.stream_id);
        return (
          <TabPill
            key={t.tab_id}
            tab={t}
            label={stream?.name ?? '(unknown stream)'}
            totalFrames={stream?.total_frames ?? 0}
            active={t.tab_id === activeTabId}
            onSelect={() => onSelect(t.tab_id)}
            onClose={async () => {
              try {
                await closeTab(t.tab_id);
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        );
      })}
    </div>
  );
};

const TabPill: React.FC<{
  tab: TabDTO;
  label: string;
  totalFrames: number;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}> = ({ label, totalFrames, active, onSelect, onClose }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: SPACE.sm,
        padding: `0 ${SPACE.md}px`,
        borderRight: `1px solid ${PALETTE.border}`,
        cursor: 'pointer',
        background: active ? PALETTE.shell : hover ? PALETTE.rowHover : 'transparent',
        color: active ? PALETTE.text : PALETTE.textMuted,
        font: active ? FONT.uiBold : FONT.ui,
        borderTop: `2px solid ${active ? PALETTE.accent : 'transparent'}`,
        marginTop: -1, // align with bottom border
        position: 'relative',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          maxWidth: 220,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={label}
      >
        {label}
      </span>
      <span
        style={{
          font: FONT.monoSmall,
          color: PALETTE.textFaint,
          background: PALETTE.panelAlt,
          padding: `0 ${SPACE.xs + 1}px`,
          borderRadius: RADIUS.sm,
        }}
      >
        {totalFrames}f
      </span>
      <span onClick={(e) => e.stopPropagation()}>
        <IconButton glyph="✕" label="Close tab" onClick={onClose} tone="neutral" hover={hover} />
      </span>
    </div>
  );
};
