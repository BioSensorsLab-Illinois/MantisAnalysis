// @ts-nocheck
// playback-ux-polish-v1 M3 — Handoff confirmation modal (W11).
//
// Per UI_IMPLEMENTATION_NOTES §21a (recording-inspection-implementation-v1)
// and react-ui-ux M12 P1: the toolbar `→U / →F / →D` buttons now open
// this modal instead of firing the handoff immediately. The modal
// shows the user a summary (view name, channel set, frame index,
// exposure, dark-correction state, target mode) so the implicit
// mode switch is intentional.
//
// On Send, calls `playbackApi.handoff` (same logic that previously
// ran inline in `index.tsx::onHandoff`) and routes the result back
// up via `onConfirm(mode, result)`. On Cancel or Esc, closes
// without dispatching.

import React from 'react';
import { Modal, useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';

const { useEffect, useState } = React;

const MODE_LABELS = {
  usaf: 'USAF Resolution',
  fpn: 'FPN Analysis',
  dof: 'Depth of Field',
};

const fmtExposure = (e) => {
  if (e == null) return '—';
  if (e < 1) return `${(e * 1000).toFixed(2)} ms`;
  return `${e.toFixed(0)} (raw)`;
};

const fmtTimestamp = (ts) => {
  if (ts == null || !Number.isFinite(ts)) return '—';
  if (ts < 60) return `${ts.toFixed(3)} s`;
  const m = Math.floor(ts / 60);
  const s = ts - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export const HandoffModal = ({
  view,
  mode,
  frame,
  stream,
  boundary,
  streamId,
  onClose,
  onConfirmed,
  say,
}) => {
  const t = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  // Esc handled by the shared Modal primitive (M12 a11y P0).
  useEffect(() => () => setPending(false), []);

  const targetLabel = MODE_LABELS[mode] || mode.toUpperCase();
  const channelList =
    view?.type === 'rgb' ? (view.channels || []).join(' · ') : view?.channel || '—';
  const targetExposure = boundary?.exposure ?? null;
  const targetTimestamp =
    boundary && stream
      ? boundary.ts_start_s +
        (frame - (boundary.frame_start ?? 0)) / Math.max(stream.fps || 30, 1e-9)
      : null;
  const willApplyDark = !!view?.dark_on;

  const onSend = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await playbackApi.handoff(streamId, mode, frame, view);
      say && say(`Sent to ${targetLabel} · ${result.source_id}`, 'success');
      onConfirmed?.(mode, result);
      onClose?.();
    } catch (err) {
      const detail = err?.detail ?? err?.message ?? String(err);
      const msg = typeof detail === 'object' ? detail.message || JSON.stringify(detail) : detail;
      setError(msg);
      say && say(`Handoff to ${targetLabel}: ${msg}`, 'danger');
      setPending(false);
    }
  };

  const Row = ({ label, value, mono = false }) => (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '5px 0',
        fontSize: 12,
        borderBottom: `1px solid ${t.border}`,
      }}
    >
      <span style={{ width: 116, color: t.textMuted, fontWeight: 500 }}>{label}</span>
      <span
        style={{
          color: t.text,
          fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit',
          fontSize: mono ? 11 : 12,
        }}
      >
        {value}
      </span>
    </div>
  );

  return (
    <Modal onClose={onClose} width={460} label={`Send frame to ${targetLabel}`}>
      <div data-region="handoff-modal" data-target-mode={mode} style={{ display: 'contents' }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: t.text,
            marginBottom: 4,
          }}
        >
          Send frame to {targetLabel}
        </div>
        <div
          style={{
            fontSize: 12,
            color: t.textMuted,
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          The current frame&rsquo;s raw extracted channels (post-dark, pre-display) will be
          registered as a new source in {targetLabel}. The mode will switch automatically.
        </div>
        <div style={{ marginBottom: 16 }}>
          <Row label="View" value={view?.name || '—'} />
          <Row label="Channels" value={channelList} mono />
          <Row label="Frame" value={`#${frame}`} mono />
          <Row label="Timestamp" value={fmtTimestamp(targetTimestamp)} mono />
          <Row label="Exposure" value={fmtExposure(targetExposure)} mono />
          <Row
            label="Dark correction"
            value={
              willApplyDark
                ? 'Applied (will subtract before send; receiver refuses double-subtract)'
                : 'Not applied'
            }
          />
          <Row label="Source stream" value={stream?.name || '—'} />
          <Row label="ISP mode" value={stream?.isp_mode_id || '—'} mono />
        </div>
        {error && (
          <div
            role="alert"
            style={{
              padding: 8,
              marginBottom: 12,
              background: 'rgba(207, 34, 46, 0.10)',
              border: `1px solid ${t.danger}`,
              color: t.danger,
              borderRadius: 4,
              fontSize: 11.5,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}
          >
            {error}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 6,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            data-action="handoff-cancel"
            aria-label="Cancel handoff"
            style={{
              padding: '5px 10px',
              fontSize: 11.5,
              fontFamily: 'inherit',
              border: `1px solid ${t.border}`,
              background: 'transparent',
              color: t.text,
              borderRadius: 4,
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={pending}
            data-action="handoff-confirm"
            aria-label={`Send frame to ${targetLabel}`}
            style={{
              padding: '5px 10px',
              fontSize: 11.5,
              fontFamily: 'inherit',
              fontWeight: 500,
              border: 'none',
              background: t.accent,
              color: '#fff',
              borderRadius: 4,
              cursor: pending ? 'not-allowed' : 'pointer',
              opacity: pending ? 0.6 : 1,
            }}
          >
            {pending ? 'Sending…' : `Send to ${targetLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
};
