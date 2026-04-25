// DisplayTab — colormap + low/high windowing + invert + normalize.

import React from 'react';

import { TabDTO, ViewDTO, patchView } from '../api';
import { COLORMAPS, FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { Field } from './Field';

interface Props {
  tab: TabDTO;
  view: ViewDTO;
  onError: (msg: string) => void;
}

export const DisplayTab: React.FC<Props> = ({ tab, view, onError }) => {
  const apply = (patch: Partial<ViewDTO>) => {
    patchView(tab.tab_id, view.view_id, patch).catch((e) =>
      onError(e instanceof Error ? e.message : String(e))
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <Field label="Colormap">
        <select
          value={view.colormap}
          onChange={(e) => apply({ colormap: e.target.value })}
          style={selectStyle}
        >
          {COLORMAPS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <Field label={`Low · ${view.low}`}>
        <input
          type="range"
          min={0}
          max={4095}
          step={1}
          value={view.low}
          onChange={(e) => apply({ low: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`High · ${view.high}`}>
        <input
          type="range"
          min={1}
          max={4095}
          step={1}
          value={view.high}
          onChange={(e) => apply({ high: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label="Modifiers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.xs }}>
          <Toggle
            label="Auto-normalize (min..max)"
            checked={view.normalize}
            onChange={(v) => apply({ normalize: v })}
          />
          <Toggle label="Invert" checked={view.invert} onChange={(v) => apply({ invert: v })} />
        </div>
      </Field>

      <Field label={`Gain · ${view.gain.toFixed(2)}`}>
        <input
          type="range"
          min={0.1}
          max={5.0}
          step={0.05}
          value={view.gain}
          onChange={(e) => apply({ gain: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`Offset · ${view.offset.toFixed(0)}`}>
        <input
          type="range"
          min={-512}
          max={512}
          step={1}
          value={view.offset}
          onChange={(e) => apply({ offset: Number(e.target.value) })}
          style={{ width: '100%' }}
        />
      </Field>
    </div>
  );
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: PALETTE.panelAlt,
  color: PALETTE.text,
  border: `1px solid ${PALETTE.border}`,
  borderRadius: RADIUS.sm,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  font: FONT.ui,
};

const Toggle: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({
  label,
  checked,
  onChange,
}) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: SPACE.sm,
      font: FONT.small,
      color: PALETTE.textMuted,
      cursor: 'pointer',
    }}
  >
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);
