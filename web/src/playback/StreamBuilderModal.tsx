// @ts-nocheck
// recording-inspection-implementation-v1 M6 — Stream Builder modal (W3).
//
// Per spec.md §7 + flows.md F4/F5/F14. Two-column layout:
//   left = ordered file list with continuity badges
//   right = summary card (frames, duration, warnings, threshold slider,
//           Apply button)
//
// Reorder uses simple ↑/↓ buttons (M6); drag-and-drop polish lands at
// M11 alongside other rough-edge cleanup.

import React from 'react';
import { Button, Icon, Modal, Slider, useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';
import { usePlayback } from './state.tsx';

const { useEffect, useMemo, useState } = React;

const fmtDuration = (sec) => {
  if (sec == null || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const SEVERITY_COLOR = (t, sev) =>
  sev === 'error' || sev === 'blocking' ? t.danger : sev === 'warning' ? t.warn : t.accent;

export const StreamBuilderModal = ({ initialRecordingIds, onClose, onApplied, say }) => {
  const t = useTheme();
  const { state, dispatch } = usePlayback();
  const [order, setOrder] = useState(
    initialRecordingIds ?? state.recordings.map((r) => r.recording_id)
  );
  const [threshold, setThreshold] = useState(1.0);
  const [previewStream, setPreviewStream] = useState(null);
  const [applying, setApplying] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const recordingsById = useMemo(() => {
    const m = {};
    state.recordings.forEach((r) => {
      m[r.recording_id] = r;
    });
    return m;
  }, [state.recordings]);

  // Live preview: build a stream when order or threshold changes.
  useEffect(() => {
    let alive = true;
    if (order.length === 0) {
      setPreviewStream(null);
      return;
    }
    (async () => {
      try {
        const s = await playbackApi.buildStream(order, {
          continuity_threshold_s: threshold,
          name: 'Stream preview',
        });
        if (!alive) return;
        setPreviewStream(s);
        setPreviewError(null);
      } catch (err) {
        if (alive) setPreviewError(err?.message || String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, [order, threshold]);

  const move = (idx, dir) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setOrder(next);
  };

  const remove = (rid) => setOrder((o) => o.filter((id) => id !== rid));

  const apply = async () => {
    if (order.length === 0) return;
    setApplying(true);
    try {
      const stream = await playbackApi.buildStream(order, {
        continuity_threshold_s: threshold,
        name: `Stream · ${new Date().toLocaleString()}`,
      });
      // Replace any preview-named transient streams in state.
      dispatch({ type: 'stream/built', payload: stream });
      dispatch({ type: 'stream/active', payload: stream.stream_id });
      say && say(`Stream built · ${stream.total_frames} frames`, 'success');
      onApplied?.(stream);
      onClose?.();
    } catch (err) {
      say && say(`Stream build failed: ${err.message || err}`, 'danger');
    } finally {
      setApplying(false);
    }
  };

  const issues = previewStream?.issues ?? {};
  const warnings = previewStream?.warnings ?? [];

  return (
    <Modal onClose={onClose} width={760} label="Stream Builder" padding={0}>
      <div
        data-region="stream-builder"
        style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Icon name="film" size={18} style={{ color: t.accent }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Stream Builder</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            {order.length} file{order.length !== 1 ? 's' : ''} ·{' '}
            {previewStream ? `${previewStream.total_frames} frames` : '—'} ·{' '}
            {previewStream ? fmtDuration(previewStream.total_duration_s) : '—'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="Close Stream Builder"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: t.textMuted,
            cursor: 'pointer',
            padding: 6,
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div
        style={{
          padding: 18,
          display: 'grid',
          gridTemplateColumns: '1fr 260px',
          gap: 20,
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              color: t.textMuted,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            Files in stream
          </div>
          <ol
            data-region="stream-builder-files"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {order.map((rid, i) => {
              const rec = recordingsById[rid];
              if (!rec) return null;
              const boundary = previewStream?.boundaries?.[i];
              const gap = boundary?.gap_to_prev_s;
              return (
                <li
                  key={rid}
                  style={{
                    border: `1px solid ${t.border}`,
                    borderRadius: 5,
                    background: t.panel,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      textAlign: 'center',
                      fontSize: 10,
                      color: t.textMuted,
                      fontFamily: 'ui-monospace, Menlo, monospace',
                    }}
                  >
                    {i + 1}
                  </span>
                  <Icon name="file" size={14} style={{ color: t.textMuted }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontFamily: 'ui-monospace, Menlo, monospace',
                        color: t.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {rec.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: t.textMuted,
                        fontFamily: 'ui-monospace, Menlo, monospace',
                        marginTop: 2,
                        display: 'flex',
                        gap: 8,
                      }}
                    >
                      <span>{rec.frame_count} fr</span>
                      <span>·</span>
                      <span>{(rec.raw_shape ?? []).join('×')}</span>
                      {rec.exposure_mean != null && (
                        <>
                          <span>·</span>
                          <span>{Number(rec.exposure_mean).toString().slice(0, 6)} exp</span>
                        </>
                      )}
                      {gap != null && i > 0 && (
                        <>
                          <span>·</span>
                          <span style={{ color: gap > threshold ? t.warn : t.success }}>
                            gap {gap.toFixed(3)}s
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Move ${rec.name} up`}
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    style={{
                      padding: '2px 6px',
                      background: 'transparent',
                      border: `1px solid ${t.chipBorder}`,
                      borderRadius: 3,
                      cursor: i === 0 ? 'not-allowed' : 'pointer',
                      color: t.textMuted,
                      fontSize: 11,
                      fontFamily: 'inherit',
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${rec.name} down`}
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1}
                    style={{
                      padding: '2px 6px',
                      background: 'transparent',
                      border: `1px solid ${t.chipBorder}`,
                      borderRadius: 3,
                      cursor: i === order.length - 1 ? 'not-allowed' : 'pointer',
                      color: t.textMuted,
                      fontSize: 11,
                      fontFamily: 'inherit',
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${rec.name} from stream`}
                    onClick={() => remove(rid)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: t.textFaint,
                      cursor: 'pointer',
                      padding: 4,
                    }}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </li>
              );
            })}
          </ol>
          {order.length === 0 && (
            <div
              role="note"
              style={{
                padding: 14,
                textAlign: 'center',
                border: `1px dashed ${t.border}`,
                borderRadius: 5,
                color: t.textFaint,
                fontSize: 11,
              }}
            >
              No files in this stream. Add a recording from the Sources panel.
            </div>
          )}

          {warnings.length > 0 && (
            <div
              data-region="stream-builder-warnings"
              style={{
                marginTop: 14,
                padding: 10,
                background: t.panelAlt,
                border: `1px solid ${t.border}`,
                borderRadius: 5,
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 10.5,
                lineHeight: 1.5,
                color: t.textMuted,
              }}
            >
              <div
                style={{ fontWeight: 600, color: t.text, marginBottom: 6, fontFamily: 'inherit' }}
              >
                Continuity warnings
              </div>
              {warnings.slice(0, 8).map((w, i) => (
                <div key={i} style={{ color: SEVERITY_COLOR(t, w.severity) }}>
                  • <strong>{w.code}</strong> {w.text}
                </div>
              ))}
              {warnings.length > 8 && (
                <div style={{ marginTop: 4, fontStyle: 'italic' }}>
                  + {warnings.length - 8} more
                </div>
              )}
            </div>
          )}
          {previewError && (
            <div
              role="alert"
              style={{
                marginTop: 14,
                padding: 10,
                background: 'rgba(207, 34, 46, 0.10)',
                border: `1px solid ${t.danger}`,
                color: t.danger,
                borderRadius: 4,
                fontSize: 11,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {previewError}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                color: t.textMuted,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Continuity threshold
            </div>
            <Slider
              label="Gap tolerance"
              min={0.1}
              max={5}
              step={0.1}
              value={threshold}
              onChange={setThreshold}
              format={(v) => v.toFixed(1)}
              unit="s"
              ariaLabel="Continuity gap tolerance in seconds"
            />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: t.textMuted,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Issues
            </div>
            <div
              style={{
                fontSize: 11,
                color: t.text,
                fontFamily: 'ui-monospace, Menlo, monospace',
                lineHeight: 1.6,
              }}
            >
              <div style={{ color: issues.gap_count > 0 ? t.warn : t.textFaint }}>
                gaps · {issues.gap_count ?? 0}
              </div>
              <div style={{ color: issues.overlap_count > 0 ? t.warn : t.textFaint }}>
                overlaps · {issues.overlap_count ?? 0}
              </div>
              <div style={{ color: issues.exposure_mismatch_count > 0 ? t.warn : t.textFaint }}>
                exp mismatch · {issues.exposure_mismatch_count ?? 0}
              </div>
              <div style={{ color: issues.shape_mismatch_count > 0 ? t.danger : t.textFaint }}>
                shape mismatch · {issues.shape_mismatch_count ?? 0}
              </div>
              <div style={{ color: issues.channel_mismatch_count > 0 ? t.warn : t.textFaint }}>
                channel mismatch · {issues.channel_mismatch_count ?? 0}
              </div>
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                color: t.textMuted,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
                fontWeight: 600,
                marginBottom: 6,
              }}
            >
              Base reference
            </div>
            <div
              style={{
                padding: '6px 8px',
                background: t.panelAlt,
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                fontSize: 11,
                color: t.text,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              {recordingsById[order[0]]?.name || '—'}
              <div style={{ color: t.textMuted, fontSize: 10, marginTop: 2 }}>
                {previewStream
                  ? `${previewStream.shape?.join('×')} · ${previewStream.fps?.toFixed(1)} fps`
                  : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '12px 18px',
          borderTop: `1px solid ${t.border}`,
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
        }}
      >
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          icon="check"
          onClick={apply}
          disabled={applying || order.length === 0}
        >
          {applying ? 'Building…' : 'Apply'}
        </Button>
      </div>
    </Modal>
  );
};
