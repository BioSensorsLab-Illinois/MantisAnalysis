// @ts-nocheck
// recording-inspection-implementation-v1 M6 — recording row.
// Per spec.md §7.1.2 + W4. Drag handle deferred (M11 polish);
// this iteration ships expand/collapse + warning chips + remove.

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { ConfirmRemoveButton } from './ConfirmRemoveButton.tsx';

const { useState } = React;

const SEVERITY_COLOR = (t, sev) =>
  sev === 'error' || sev === 'blocking'
    ? { bg: 'rgba(207, 34, 46, 0.10)', fg: t.danger, border: t.danger }
    : sev === 'warning'
      ? { bg: 'rgba(197, 127, 0, 0.10)', fg: t.warn, border: t.warn }
      : { bg: t.accentSoft, fg: t.accent, border: t.accent };

export const FilePill = ({ file, onRemove }) => {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);

  const warnings = file.warnings ?? [];
  const errors = file.errors ?? [];
  const hasError = errors.length > 0;
  const hasWarn = warnings.length > 0;
  const borderColor = hasError ? t.danger : hasWarn ? t.warn : t.border;

  return (
    <div
      data-recording-id={file.recording_id}
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 5,
        background: t.panel,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-label={`${file.name}: ${expanded ? 'collapse' : 'expand'} details`}
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 8px',
          width: '100%',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: t.text,
          fontFamily: 'inherit',
        }}
      >
        <Icon
          name={hasError ? 'warning' : 'file'}
          size={12}
          style={{ color: hasError ? t.danger : t.textMuted }}
        />
        <span
          style={{
            fontSize: 11,
            fontFamily: 'ui-monospace, Menlo, monospace',
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {file.name}
        </span>
        {hasWarn && !hasError && (
          <span
            title={`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`}
            style={{ width: 7, height: 7, borderRadius: '50%', background: t.warn }}
          />
        )}
        <span
          style={{
            padding: '1px 5px',
            background: t.chipBg,
            color: t.textMuted,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            fontSize: 9.5,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}
        >
          {file.exposure_mean != null ? Number(file.exposure_mean).toString().slice(0, 6) : '— exp'}
        </span>
        <Icon
          name="chevron"
          size={10}
          style={{
            color: t.textFaint,
            transform: expanded ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
          }}
        />
      </button>
      {expanded && (
        <div
          style={{
            padding: '6px 10px 10px 28px',
            borderTop: `1px solid ${t.border}`,
            background: t.panelAlt,
            fontSize: 10.5,
            color: t.textMuted,
            fontFamily: 'ui-monospace, Menlo, monospace',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div>
            {file.frame_count} frames · {(file.raw_shape ?? []).join('×')}
          </div>
          {file.estimated_fps != null && <div>≈ {file.estimated_fps.toFixed(2)} fps</div>}
          {file.timestamp_start_s != null && (
            <div>
              ts {file.timestamp_start_s.toFixed(3)}s → {(file.timestamp_end_s ?? 0).toFixed(3)}s
            </div>
          )}
          {file.camera_attrs?.['model-name'] && <div>cam · {file.camera_attrs['model-name']}</div>}
          {warnings.map((w, i) => {
            const c = SEVERITY_COLOR(t, w.severity);
            return (
              <div
                key={`w-${i}`}
                style={{
                  marginTop: 4,
                  padding: '3px 6px',
                  background: c.bg,
                  color: c.fg,
                  border: `1px solid ${c.border}`,
                  borderRadius: 3,
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ marginRight: 4, fontWeight: 700 }}>{w.code}</strong>
                {w.text}
              </div>
            );
          })}
          {errors.map((e, i) => {
            const c = SEVERITY_COLOR(t, 'error');
            return (
              <div
                key={`e-${i}`}
                role="alert"
                style={{
                  marginTop: 4,
                  padding: '3px 6px',
                  background: c.bg,
                  color: c.fg,
                  border: `1px solid ${c.border}`,
                  borderRadius: 3,
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                <strong style={{ marginRight: 4, fontWeight: 700 }}>{e.code}</strong>
                {e.text}
              </div>
            );
          })}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <ConfirmRemoveButton
              ariaLabel={`Remove ${file.name}`}
              size="sm"
              onConfirm={() => onRemove?.(file.recording_id)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
