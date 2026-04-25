// @ts-nocheck
// recording-inspection-implementation-v1 M5 — Stream header strip.
// W1/W5 region B in spec.md. Shows the active stream chip + warnings
// + Export menu (export modals land at M10).

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { usePlayback } from './state.tsx';

export const StreamHeader = ({ onOpenBuilder, onOpenWarnings, onExportImage, onExportVideo }) => {
  const t = useTheme();
  const { state } = usePlayback();
  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const warnings = stream?.warnings?.length ?? 0;

  return (
    <div
      data-region="stream-header"
      style={{
        height: 36,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderBottom: `1px solid ${t.border}`,
        background: t.panel,
        flexShrink: 0,
      }}
    >
      <button
        type="button"
        aria-label="Open Stream Builder"
        onClick={onOpenBuilder}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px 6px 10px',
          background: t.panelAlt,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          cursor: 'pointer',
          color: t.text,
          fontFamily: 'inherit',
          maxWidth: 440,
          minWidth: 0,
        }}
      >
        <Icon name="film" size={14} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            minWidth: 0,
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {stream?.name || 'No stream'}
          </div>
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              fontFamily: 'ui-monospace, Menlo, monospace',
              display: 'flex',
              gap: 6,
            }}
          >
            <span>
              {stream
                ? `${stream.recording_ids.length} file${stream.recording_ids.length !== 1 ? 's' : ''}`
                : '—'}
            </span>
            <span>·</span>
            <span>{stream ? `${stream.total_frames} frames` : '—'}</span>
          </div>
        </div>
      </button>

      {warnings > 0 && (
        <button
          type="button"
          aria-label={`${warnings} warning${warnings > 1 ? 's' : ''}`}
          onClick={onOpenWarnings}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 7px',
            background: 'rgba(197, 127, 0, 0.10)',
            color: t.warn,
            border: `1px solid ${t.warn}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10.5,
            fontFamily: 'inherit',
            fontWeight: 600,
          }}
        >
          <Icon name="warning" size={10} /> {warnings}
        </button>
      )}

      <div style={{ flex: 1, minWidth: 4 }} />

      <button
        type="button"
        aria-label="Export image"
        data-action="export-image"
        disabled={!stream}
        onClick={onExportImage}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          background: stream ? t.accent : t.panelAlt,
          color: stream ? '#fff' : t.textFaint,
          border: `1px solid ${stream ? t.accent : t.border}`,
          borderRadius: 4,
          cursor: stream ? 'pointer' : 'not-allowed',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        <Icon name="download" size={11} /> Image
      </button>
      <button
        type="button"
        aria-label="Export video"
        data-action="export-video"
        disabled={!stream}
        onClick={onExportVideo}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 10px',
          background: stream ? t.panel : t.panelAlt,
          color: stream ? t.text : t.textFaint,
          border: `1px solid ${stream ? t.accent : t.border}`,
          borderRadius: 4,
          cursor: stream ? 'pointer' : 'not-allowed',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: 'inherit',
        }}
      >
        <Icon name="film" size={11} /> Video
      </button>
    </div>
  );
};
