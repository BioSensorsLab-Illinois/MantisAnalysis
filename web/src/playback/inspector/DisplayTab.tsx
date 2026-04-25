// DisplayTab — colormap + low/high windowing + invert + normalize.
//
// Slider drags are debounced + optimistic: local state updates
// instantly so the UI feels responsive; the PATCH commits ~100 ms
// after the last change. Toggles + selects fire immediately.

import React from 'react';

import { TabDTO, ViewDTO, patchView } from '../api';
import { COLORMAPS, FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { Field } from './Field';

const { useCallback, useEffect, useRef, useState } = React;

interface Props {
  tab: TabDTO;
  view: ViewDTO;
  onError: (msg: string) => void;
}

const DEBOUNCE_MS = 100;

export const DisplayTab: React.FC<Props> = ({ tab, view, onError }) => {
  // Optimistic mirror for slider state — server confirms within ~2s.
  const [draft, setDraft] = useState({
    low: view.low,
    high: view.high,
    gain: view.gain,
    offset: view.offset,
  });

  // Whenever the server sends fresh state and there's no in-flight
  // PATCH, sync the draft back. The lastLocalEditRef gates this so a
  // poll arriving 2 s after a slider drag doesn't bounce the value.
  const lastLocalEditRef = useRef(0);
  useEffect(() => {
    if (Date.now() - lastLocalEditRef.current > 1500) {
      setDraft({
        low: view.low,
        high: view.high,
        gain: view.gain,
        offset: view.offset,
      });
    }
  }, [view.low, view.high, view.gain, view.offset]);

  const pendingTimerRef = useRef<number | null>(null);
  const pendingPatchRef = useRef<Partial<ViewDTO>>({});

  const flushPending = useCallback(() => {
    pendingTimerRef.current = null;
    const patch = pendingPatchRef.current;
    pendingPatchRef.current = {};
    if (Object.keys(patch).length === 0) return;
    patchView(tab.tab_id, view.view_id, patch).catch((e) =>
      onError(e instanceof Error ? e.message : String(e))
    );
  }, [tab.tab_id, view.view_id, onError]);

  const queue = useCallback(
    (patch: Partial<ViewDTO>) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      lastLocalEditRef.current = Date.now();
      if (pendingTimerRef.current != null) {
        window.clearTimeout(pendingTimerRef.current);
      }
      pendingTimerRef.current = window.setTimeout(flushPending, DEBOUNCE_MS);
    },
    [flushPending]
  );

  const apply = (patch: Partial<ViewDTO>) => {
    patchView(tab.tab_id, view.view_id, patch).catch((e) =>
      onError(e instanceof Error ? e.message : String(e))
    );
  };

  // Flush any pending PATCH on unmount.
  useEffect(
    () => () => {
      if (pendingTimerRef.current != null) {
        window.clearTimeout(pendingTimerRef.current);
        flushPending();
      }
    },
    [flushPending]
  );

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

      <Field label={`Low · ${draft.low}`}>
        <input
          type="range"
          min={0}
          max={4095}
          step={1}
          value={draft.low}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft((d) => ({ ...d, low: v }));
            queue({ low: v });
          }}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`High · ${draft.high}`}>
        <input
          type="range"
          min={1}
          max={4095}
          step={1}
          value={draft.high}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft((d) => ({ ...d, high: v }));
            queue({ high: v });
          }}
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

      <Field label={`Gain · ${draft.gain.toFixed(2)}`}>
        <input
          type="range"
          min={0.1}
          max={5.0}
          step={0.05}
          value={draft.gain}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft((d) => ({ ...d, gain: v }));
            queue({ gain: v });
          }}
          style={{ width: '100%' }}
        />
      </Field>

      <Field label={`Offset · ${draft.offset.toFixed(0)}`}>
        <input
          type="range"
          min={-512}
          max={512}
          step={1}
          value={draft.offset}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDraft((d) => ({ ...d, offset: v }));
            queue({ offset: v });
          }}
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
