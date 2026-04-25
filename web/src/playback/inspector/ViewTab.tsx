// ViewTab — name + channel + frame mode (synced / locked).

import React from 'react';

import { TabDTO, ViewDTO, patchView } from '../api';
import { CHANNEL_COLOR } from '../tokens';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { Field } from './Field';

const CHANNELS = Object.keys(CHANNEL_COLOR);

interface Props {
  tab: TabDTO;
  view: ViewDTO;
  onError: (msg: string) => void;
}

export const ViewTab: React.FC<Props> = ({ tab, view, onError }) => {
  const apply = (patch: Partial<ViewDTO>) => {
    patchView(tab.tab_id, view.view_id, patch).catch((e) =>
      onError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <Field label="View name">
        <input
          type="text"
          value={view.name}
          onChange={(e) => apply({ name: e.target.value })}
          style={{
            width: '100%',
            background: PALETTE.panelAlt,
            color: PALETTE.text,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: RADIUS.sm,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            font: FONT.ui,
          }}
        />
      </Field>

      <Field label="Channel">
        <select
          value={view.channel}
          onChange={(e) => apply({ channel: e.target.value })}
          style={{
            width: '100%',
            background: PALETTE.panelAlt,
            color: PALETTE.text,
            border: `1px solid ${PALETTE.border}`,
            borderRadius: RADIUS.sm,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            font: FONT.ui,
          }}
        >
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Frame mode">
        <div style={{ display: 'flex', gap: SPACE.sm }}>
          <button
            type="button"
            onClick={() => apply({ locked_frame: null, sync_to_global: true })}
            aria-pressed={view.locked_frame == null}
            style={pillStyle(view.locked_frame == null)}
          >
            Synced
          </button>
          <button
            type="button"
            onClick={() => apply({ locked_frame: tab.active_frame })}
            aria-pressed={view.locked_frame != null}
            style={pillStyle(view.locked_frame != null)}
          >
            Locked
          </button>
        </div>
        {view.locked_frame != null && (
          <div style={{ font: FONT.monoSmall, color: PALETTE.warn, marginTop: SPACE.xs }}>
            Locked at f{String(view.locked_frame).padStart(5, '0')}
          </div>
        )}
      </Field>
    </div>
  );
};

function pillStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: `${SPACE.xs}px ${SPACE.sm}px`,
    background: active ? PALETTE.accentSoft : PALETTE.panelAlt,
    color: active ? PALETTE.accent : PALETTE.textMuted,
    border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
    borderRadius: RADIUS.sm,
    font: FONT.ui,
    cursor: 'pointer',
  };
}
