// LayoutSwitch — segmented control for ViewerGrid layout presets.

import React from 'react';

import { TabDTO, patchTab } from '../api';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { LAYOUT_PRESETS } from './ViewerGrid';

interface Props {
  tab: TabDTO;
  onError: (msg: string) => void;
}

export const LayoutSwitch: React.FC<Props> = ({ tab, onError }) => {
  return (
    <div
      role="radiogroup"
      aria-label="Viewer layout"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        background: PALETTE.panelAlt,
        borderRadius: RADIUS.md,
      }}
    >
      {LAYOUT_PRESETS.map((p) => {
        const active = tab.layout === p.id;
        return (
          <button
            key={p.id}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => {
              patchTab(tab.tab_id, { layout: p.id }).catch((e) =>
                onError(e instanceof Error ? e.message : String(e))
              );
            }}
            style={{
              padding: `${SPACE.xs}px ${SPACE.sm}px`,
              font: active ? FONT.uiBold : FONT.small,
              color: active ? PALETTE.accent : PALETTE.textMuted,
              background: active ? PALETTE.shell : 'transparent',
              border: 'none',
              borderRadius: RADIUS.sm,
              cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
};
