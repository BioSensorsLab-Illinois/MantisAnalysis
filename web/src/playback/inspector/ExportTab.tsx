// ExportTab — single-frame PNG / TIFF export of the active view.

import React from 'react';

import { TabDTO, ViewDTO, exportFrame } from '../api';
import { FONT, PALETTE, RADIUS, SPACE } from '../theme';

import { Field } from './Field';

const { useState } = React;

interface Props {
  tab: TabDTO;
  view: ViewDTO;
  onError: (msg: string) => void;
}

type Format = 'png' | 'tiff';

export const ExportTab: React.FC<Props> = ({ tab, view, onError }) => {
  const [format, setFormat] = useState<Format>('png');
  const [busy, setBusy] = useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const blob = await exportFrame(tab.tab_id, view.view_id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safe = view.name.replace(/[^a-z0-9._-]+/gi, '_');
      a.download = `${safe}_f${String(view.locked_frame ?? tab.active_frame).padStart(5, '0')}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md }}>
      <Field label="Scope">
        <div style={{ font: FONT.small, color: PALETTE.textMuted }}>
          Selected view · current frame · WYSIWYG (display settings baked in).
        </div>
      </Field>

      <Field label="Format">
        <div style={{ display: 'flex', gap: SPACE.sm }}>
          <FormatPill active={format === 'png'} onClick={() => setFormat('png')}>
            PNG
          </FormatPill>
          <FormatPill active={format === 'tiff'} onClick={() => setFormat('tiff')}>
            TIFF
          </FormatPill>
        </div>
      </Field>

      <button
        type="button"
        onClick={onExport}
        disabled={busy}
        style={{
          background: PALETTE.accent,
          color: 'white',
          border: 'none',
          borderRadius: RADIUS.md,
          padding: `${SPACE.sm}px ${SPACE.lg}px`,
          font: FONT.uiBold,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Exporting…' : `Export ${format.toUpperCase()}`}
      </button>

      <div style={{ font: FONT.monoSmall, color: PALETTE.textFaint, lineHeight: 1.5 }}>
        Exports the rendered view, not raw data. Processing settings (window, colormap, gain,
        offset, normalize, invert) are baked in.
      </div>
    </div>
  );
};

const FormatPill: React.FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    style={{
      flex: 1,
      padding: `${SPACE.xs}px ${SPACE.sm}px`,
      background: active ? PALETTE.accentSoft : PALETTE.panelAlt,
      color: active ? PALETTE.accent : PALETTE.textMuted,
      border: `1px solid ${active ? PALETTE.accent : PALETTE.border}`,
      borderRadius: RADIUS.sm,
      font: FONT.ui,
      cursor: 'pointer',
    }}
  >
    {children}
  </button>
);
