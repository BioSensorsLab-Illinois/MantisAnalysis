// LabelsTab — placeholder for label burn-in toggles.
//
// The View DTO does not carry per-label flags yet — adding those is
// a follow-up (BACKLOG). This tab establishes the section so the
// Inspector tabs row matches the design spec at the right viewport.

import React from 'react';

import { TabDTO, ViewDTO } from '../api';
import { FONT, PALETTE, SPACE } from '../theme';

interface Props {
  tab: TabDTO;
  view: ViewDTO;
  onError: (msg: string) => void;
}

export const LabelsTab: React.FC<Props> = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.sm,
        font: FONT.small,
        color: PALETTE.textMuted,
      }}
    >
      <div style={{ font: FONT.uiBold, color: PALETTE.text }}>Burn-in labels</div>
      <div style={{ color: PALETTE.textFaint }}>
        Timestamp / frame index / channel name / source filename / scale bar. Per-label toggles
        arrive in the next update — for now exports always stamp{' '}
        <code style={{ font: FONT.mono }}>frame · channel</code>.
      </div>
    </div>
  );
};
