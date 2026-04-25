// @ts-nocheck
// recording-inspection-implementation-v1 M10 — Export Video modal (W13).

import React from 'react';
import { Button, Checkbox, Icon, Modal, Select, useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';
import { usePlayback } from './state.tsx';

const { useEffect, useState } = React;

const FORMATS_BASE = [
  { value: 'mp4', label: 'MP4 (H.264)', requiresFfmpeg: true },
  { value: 'apng', label: 'APNG' },
  { value: 'gif', label: 'GIF (≤300 frames)' },
  { value: 'png-seq', label: 'PNG sequence (zip)' },
];

const QUALITY = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const SCOPES = [
  { value: 'allFlagged', label: 'All views flagged for export' },
  { value: 'allVisible', label: 'All visible views' },
  { value: 'selected', label: 'Selected view only' },
];

const COMPOSES = [
  { value: 'single', label: 'Single (first view)' },
  { value: 'contactSheet', label: 'Contact sheet' },
  { value: 'grid', label: 'Grid' },
];

export const ExportVideoModal = ({ onClose, say }) => {
  const t = useTheme();
  const { state } = usePlayback();
  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const [scope, setScope] = useState('allFlagged');
  const [fmt, setFmt] = useState('mp4');
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState('high');
  const [compose, setCompose] = useState('contactSheet');
  const [includeLabels, setIncludeLabels] = useState(true);
  const [hasFfmpeg, setHasFfmpeg] = useState(true);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);

  const range =
    state.range && state.range[0] != null
      ? state.range
      : [0, Math.max(0, (stream?.total_frames ?? 1) - 1)];

  useEffect(() => {
    let alive = true;
    playbackApi.health().then((h) => {
      if (!alive) return;
      setHasFfmpeg(!!h.ffmpeg_available);
      if (!h.ffmpeg_available && fmt === 'mp4') setFmt('gif');
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = (() => {
    if (scope === 'selected') {
      const sel = state.views.find((v) => v.view_id === state.selectedViewId);
      return sel ? [sel] : [];
    }
    if (scope === 'allVisible') return state.views;
    return state.views.filter((v) => v.export_include);
  })();

  const tileArr = (() => {
    if (compose !== 'grid') return null;
    const cols = Math.ceil(Math.sqrt(filtered.length || 1));
    const rows = Math.ceil((filtered.length || 1) / cols);
    return [cols, rows];
  })();

  const submit = async () => {
    if (filtered.length === 0) {
      setError('No views to export.');
      return;
    }
    setError(null);
    try {
      const r = await fetch('/api/playback/exports/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_id: state.activeStreamId,
          frame_range: range,
          fmt,
          fps,
          quality,
          compose,
          tile_arrangement: tileArr,
          include_labels: includeLabels,
          views: filtered,
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        throw new Error(`${r.status}: ${detail.slice(0, 160)}`);
      }
      const j = await r.json();
      setJob(j);
      pollJob(j.job_id);
    } catch (err) {
      setError(err.message || String(err));
      say && say(`Video export failed: ${err.message || err}`, 'danger');
    }
  };

  const pollJob = (jobId) => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      try {
        const r = await fetch(`/api/playback/exports/${jobId}`);
        const j = await r.json();
        setJob(j);
        if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') {
          if (j.status === 'done') say && say('Video export complete', 'success');
          return;
        }
        setTimeout(tick, 250);
      } catch {
        /* ignore transient */
      }
    };
    tick();
    return () => {
      alive = false;
    };
  };

  const cancel = async () => {
    if (!job) return;
    await fetch(`/api/playback/exports/${job.job_id}`, { method: 'DELETE' });
  };

  const formats = FORMATS_BASE.filter((f) => !f.requiresFfmpeg || hasFfmpeg);

  return (
    <Modal onClose={onClose} width={620} label="Export Video" padding={0}>
      <div data-region="export-video-modal" style={{ display: 'contents' }}>
        <div
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
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Export video</div>
            <div style={{ fontSize: 11, color: t.textMuted }}>
              frames {range[0]}…{range[1]} · {range[1] - range[0] + 1} fr · {filtered.length} view
              {filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            aria-label="Close Export Video"
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
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 11.5,
          }}
        >
          {!hasFfmpeg && (
            <div
              role="status"
              style={{
                padding: 8,
                background: 'rgba(197, 127, 0, 0.10)',
                border: `1px solid ${t.warn}`,
                color: t.warn,
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              ffmpeg not detected. MP4 disabled. Install <code>imageio-ffmpeg</code> to enable.
            </div>
          )}
          <Select value={scope} options={SCOPES} onChange={setScope} ariaLabel="Scope" />
          <Select value={fmt} options={formats} onChange={setFmt} ariaLabel="Format" />
          <Select
            value={String(fps)}
            options={['24', '30', '60'].map((v) => ({ value: v, label: v }))}
            onChange={(v) => setFps(Number(v))}
            ariaLabel="FPS"
          />
          <Select value={quality} options={QUALITY} onChange={setQuality} ariaLabel="Quality" />
          <Select
            value={compose}
            options={COMPOSES}
            onChange={setCompose}
            ariaLabel="Compose mode"
          />
          <Checkbox
            checked={includeLabels}
            onChange={setIncludeLabels}
            label="Burn in labels (timestamp, frame, channel)"
          />
          {error && (
            <div
              role="alert"
              style={{
                padding: 8,
                background: 'rgba(207, 34, 46, 0.10)',
                border: `1px solid ${t.danger}`,
                color: t.danger,
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              {error}
            </div>
          )}
          {job && (
            <div
              data-region="export-video-job"
              data-job-status={job.status}
              style={{
                padding: 10,
                background: t.panelAlt,
                border: `1px solid ${t.border}`,
                borderRadius: 4,
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 11,
                color: t.text,
              }}
            >
              <div>
                job · {job.job_id} · {job.status}
              </div>
              <div
                style={{
                  marginTop: 6,
                  height: 6,
                  background: t.chipBg,
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(job.progress || 0) * 100}%`,
                    height: '100%',
                    background: t.accent,
                    transition: 'width 120ms',
                  }}
                />
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: t.textMuted }}>
                {job.current_frame} / {job.total_frames} · elapsed {(job.elapsed_s || 0).toFixed(1)}
                s · eta {(job.eta_s || 0).toFixed(1)}s
              </div>
              {job.error && <div style={{ marginTop: 6, color: t.danger }}>{job.error}</div>}
              {job.status === 'done' && job.output_url && (
                <a
                  href={job.output_url}
                  download
                  style={{
                    marginTop: 8,
                    display: 'inline-block',
                    color: t.accent,
                    textDecoration: 'underline',
                  }}
                >
                  Download
                </a>
              )}
            </div>
          )}
          <div style={{ fontSize: 10, color: t.textFaint, fontStyle: 'italic' }}>
            Exports the rendered view, not raw data.
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
          <Button onClick={onClose}>Close</Button>
          {job && (job.status === 'queued' || job.status === 'rendering') && (
            <Button onClick={cancel}>Cancel job</Button>
          )}
          {(!job ||
            job.status === 'done' ||
            job.status === 'failed' ||
            job.status === 'cancelled') && (
            <Button variant="primary" icon="download" onClick={submit}>
              Start export
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
