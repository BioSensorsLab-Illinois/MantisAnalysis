// @ts-nocheck
// recording-inspection-implementation-v1 M5 — Sources panel skeleton.
// Wires recording list + dark frames + warning chips. Matches W2/W4
// from the spec; Stream Builder modal lands at M6.

import React from 'react';
import { useTheme } from '../shared.tsx';
import { usePlayback } from './state.tsx';

const microBtn = (t) => ({
  padding: '3px 8px',
  background: 'transparent',
  color: t.textMuted,
  border: `1px solid ${t.chipBorder}`,
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 10,
  fontFamily: 'inherit',
});

export const SourcesPanel = ({ onOpenRecording, onLoadSample, onOpenDark }) => {
  const t = useTheme();
  const { state } = usePlayback();
  const { recordings, darks } = state;

  return (
    <div
      data-region="sources-panel"
      style={{
        width: 288,
        minWidth: 240,
        maxWidth: 360,
        background: t.panel,
        borderRight: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          height: 34,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: `1px solid ${t.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: t.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600,
          }}
        >
          Sources
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <section>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: t.text }}>Recordings</div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-label="Load synthetic sample recording"
              onClick={onLoadSample}
              style={microBtn(t)}
            >
              + Sample
            </button>
            <button
              type="button"
              aria-label="Open recording file"
              onClick={onOpenRecording}
              style={{ ...microBtn(t), marginLeft: 4 }}
            >
              + Open
            </button>
          </div>
          {recordings.length === 0 && (
            <div
              role="note"
              style={{
                padding: 10,
                textAlign: 'center',
                border: `1px dashed ${t.border}`,
                borderRadius: 5,
                color: t.textFaint,
                fontSize: 11,
              }}
            >
              No files yet.
            </div>
          )}
          {recordings.length > 0 && (
            <ul
              data-region="recordings-list"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {recordings.map((r) => (
                <li
                  key={r.recording_id}
                  data-recording-id={r.recording_id}
                  style={{
                    padding: '6px 8px',
                    border: `1px solid ${t.border}`,
                    borderRadius: 5,
                    background: t.panelAlt,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 11,
                    color: t.text,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div
                    style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r.name}
                  </div>
                  <div style={{ fontSize: 10, color: t.textMuted }}>
                    {r.frame_count} frames · {r.raw_shape?.join('×')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: t.text }}>Dark frames</div>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-label="Open dark frame file"
              onClick={onOpenDark}
              style={microBtn(t)}
            >
              + Open
            </button>
          </div>
          {darks.length === 0 && (
            <div
              role="note"
              style={{
                padding: 10,
                textAlign: 'center',
                border: `1px dashed ${t.border}`,
                borderRadius: 5,
                color: t.textFaint,
                fontSize: 11,
              }}
            >
              No dark frames loaded. Dark correction unavailable.
            </div>
          )}
          {darks.length > 0 && (
            <ul
              data-region="darks-list"
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {darks.map((d) => (
                <li
                  key={d.dark_id}
                  data-dark-id={d.dark_id}
                  style={{
                    padding: '6px 8px',
                    border: `1px solid ${t.border}`,
                    borderRadius: 5,
                    background: t.panelAlt,
                    fontFamily: 'ui-monospace, Menlo, monospace',
                    fontSize: 11,
                    color: t.text,
                  }}
                >
                  {d.name} · ×{d.frames_averaged} ({d.strategy})
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
