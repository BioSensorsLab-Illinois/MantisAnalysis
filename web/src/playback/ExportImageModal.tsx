// @ts-nocheck
// recording-inspection-implementation-v1 M10 — Export Image modal (W12).

import React from 'react';
import { API_BASE, Button, Checkbox, Icon, Modal, Select, useTheme } from '../shared.tsx';
import { usePlayback } from './state.tsx';

const { useState } = React;

const FORMATS = [
  { value: 'png', label: 'PNG' },
  { value: 'tif', label: 'TIFF' },
  { value: 'jpg', label: 'JPEG' },
];

const COMPOSES = [
  { value: 'single', label: 'Single (first view)' },
  { value: 'contactSheet', label: 'Contact sheet (1×N)' },
  { value: 'grid', label: 'Grid' },
];

const SCOPES = [
  { value: 'allFlagged', label: 'All views flagged for export' },
  { value: 'allVisible', label: 'All visible views' },
  { value: 'selected', label: 'Selected view only' },
];

export const ExportImageModal = ({ onClose, say }) => {
  const t = useTheme();
  const { state } = usePlayback();
  const [scope, setScope] = useState('allFlagged');
  const [fmt, setFmt] = useState('png');
  const [bitDepth, setBitDepth] = useState(8);
  const [compose, setCompose] = useState('contactSheet');
  const [includeLabels, setIncludeLabels] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // {url, path}
  const [error, setError] = useState(null);

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
      setError('No views to export. Adjust scope.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = `${API_BASE}/api/playback/exports/image`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stream_id: state.activeStreamId,
          frame: state.frame,
          compose,
          tile_arrangement: tileArr,
          fmt,
          bit_depth: bitDepth,
          include_labels: includeLabels,
          views: filtered,
        }),
      });
      if (!r.ok) {
        const detail = await r.text();
        throw new Error(`${r.status}: ${detail.slice(0, 120)}`);
      }
      const blob = await r.blob();
      const objUrl = URL.createObjectURL(blob);
      const path = r.headers.get('X-Output-Path');
      setDone({ url: objUrl, path, mime: blob.type, name: `frame-${state.frame}.${fmt}` });
      say && say(`Image exported · ${path}`, 'success');
    } catch (err) {
      setError(err.message || String(err));
      say && say(`Export failed: ${err.message || err}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={620} label="Export Image" padding={0}>
      <div data-region="export-image-modal" style={{ display: 'contents' }}>
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${t.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Icon name="download" size={18} style={{ color: t.accent }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Export image</div>
            <div style={{ fontSize: 11, color: t.textMuted }}>
              frame {state.frame} · {filtered.length} view{filtered.length !== 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            aria-label="Close Export Image"
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
            color: t.text,
          }}
        >
          <Select value={scope} options={SCOPES} onChange={setScope} ariaLabel="Scope" />
          <Select value={fmt} options={FORMATS} onChange={setFmt} ariaLabel="Format" />
          {fmt === 'tif' && (
            <Select
              value={String(bitDepth)}
              options={[
                { value: '8', label: '8-bit' },
                { value: '16', label: '16-bit' },
              ]}
              onChange={(v) => setBitDepth(Number(v))}
              ariaLabel="Bit depth"
            />
          )}
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
                fontFamily: 'ui-monospace, Menlo, monospace',
                fontSize: 10.5,
              }}
            >
              {error}
            </div>
          )}
          {done && (
            <div
              role="status"
              data-region="export-image-done"
              style={{
                padding: 8,
                background: 'rgba(26, 127, 55, 0.10)',
                border: `1px solid ${t.success}`,
                color: t.text,
                borderRadius: 4,
                fontSize: 11,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div>Exported to {done.path}</div>
              <a
                href={done.url}
                download={done.name}
                style={{
                  color: t.accent,
                  textDecoration: 'underline',
                  fontSize: 11,
                }}
              >
                Download {done.name}
              </a>
            </div>
          )}
          <div style={{ fontSize: 10, color: t.textFaint, fontStyle: 'italic' }}>
            Exports the rendered view, not raw data. Processing settings (dark, thresholds,
            overlays, RGB grading) are baked in.
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
          <Button variant="primary" icon="download" onClick={submit} disabled={busy}>
            {busy ? 'Exporting…' : 'Export'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
