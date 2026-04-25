// @ts-nocheck
// recording-inspection-implementation-v1 M9 — Overlay Builder modal (W10).
//
// Per spec.md §7 + flows.md F8. Single modal window with a live
// preview pane (the same /api/playback/.../frame/N.png URL the
// ViewerCard uses, but with overlay_on=1 + the in-modal config) and
// a controls column. Apply commits the overlay config back to the
// view via dispatch({ type: 'view/update', ... }).

import React from 'react';
import { Button, Icon, Modal, Select, Slider, useTheme } from '../shared.tsx';
import { previewPngUrl } from './api.ts';
import { usePlayback } from './state.tsx';

const { useState } = React;

const COLORMAPS = [
  'viridis',
  'inferno',
  'magma',
  'plasma',
  'cividis',
  'turbo',
  'gray',
  'hot',
  'cool',
];

const BLEND_MODES = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'additive', label: 'Additive' },
  { value: 'screen', label: 'Screen' },
  { value: 'masked', label: 'Masked' },
];

const BELOW_OPTS = [
  { value: 'hide', label: 'Hide below threshold' },
  { value: 'clamp', label: 'Clamp at low' },
];
const ABOVE_OPTS = [
  { value: 'saturate', label: 'Saturate above threshold' },
  { value: 'clamp', label: 'Clamp at high' },
];

export const OverlayBuilderModal = ({ viewId, onClose, onApply, say }) => {
  const t = useTheme();
  const { state } = usePlayback();
  const view = state.views.find((v) => v.view_id === viewId);
  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const available = stream?.available_channels ?? [];

  const initial = view ?? {};
  const [config, setConfig] = useState({
    overlay_on: true,
    overlay_channel: initial.overlay_channel ?? 'HG-NIR',
    overlay_low: initial.overlay_low ?? 300,
    overlay_high: initial.overlay_high ?? 900,
    overlay_blend: initial.overlay_blend ?? 'alpha',
    overlay_strength: initial.overlay_strength ?? 0.65,
    overlay_cmap: initial.overlay_cmap ?? 'inferno',
    overlay_below: initial.overlay_below ?? 'hide',
    overlay_above: initial.overlay_above ?? 'saturate',
  });

  if (!view) return null;

  // Live-preview URL: same as ViewerCard's URL but with the in-modal
  // overlay config so the user sees the result before clicking Apply.
  const previewView = { ...view, ...config };
  const previewUrl = previewPngUrl(state.activeStreamId, state.frame, previewView);

  const apply = () => {
    onApply?.(config);
    say && say('Overlay applied', 'success');
    onClose?.();
  };

  return (
    <Modal onClose={onClose} width={760} label="Overlay Builder" padding={0}>
      <div
        data-region="overlay-builder"
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
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Overlay Builder</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            on <strong>{view.name}</strong> · base {view.type === 'rgb' ? 'RGB' : view.channel}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="Close Overlay Builder"
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0 }}>
        {/* Preview pane */}
        <div
          data-region="overlay-preview"
          style={{
            background: '#0a0a0a',
            minHeight: 360,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt={`Overlay preview · ${config.overlay_channel}`}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          )}
          <div
            style={{
              position: 'absolute',
              left: 10,
              top: 10,
              display: 'flex',
              gap: 6,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 10,
            }}
          >
            <span
              style={{
                padding: '3px 8px',
                background: 'rgba(14,16,20,0.8)',
                color: '#e8eaed',
                borderRadius: 3,
              }}
            >
              base · {view.type === 'rgb' ? 'RGB' : view.channel}
            </span>
            <span
              style={{
                padding: '3px 8px',
                background: 'rgba(74,158,255,0.25)',
                color: '#b8d4ff',
                borderRadius: 3,
              }}
            >
              overlay · {config.overlay_channel}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div
          style={{
            padding: 14,
            borderLeft: `1px solid ${t.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxHeight: '60vh',
            overflow: 'auto',
          }}
        >
          <Select
            value={config.overlay_channel}
            options={(available.length ? available : [config.overlay_channel]).map((c) => ({
              value: c,
              label: c,
            }))}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_channel: v }))}
            ariaLabel="Overlay source channel"
          />
          <Slider
            label="Low"
            min={0}
            max={4095}
            step={1}
            value={config.overlay_low}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_low: v }))}
            format={(v) => v.toFixed(0)}
            ariaLabel="Overlay low threshold"
          />
          <Slider
            label="High"
            min={0}
            max={4095}
            step={1}
            value={config.overlay_high}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_high: v }))}
            format={(v) => v.toFixed(0)}
            ariaLabel="Overlay high threshold"
          />
          <Select
            value={config.overlay_below}
            options={BELOW_OPTS}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_below: v }))}
            ariaLabel="Below-threshold policy"
          />
          <Select
            value={config.overlay_above}
            options={ABOVE_OPTS}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_above: v }))}
            ariaLabel="Above-threshold policy"
          />
          <Select
            value={config.overlay_blend}
            options={BLEND_MODES}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_blend: v }))}
            ariaLabel="Blend mode"
          />
          <Slider
            label="Strength"
            min={0}
            max={1}
            step={0.01}
            value={config.overlay_strength}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_strength: v }))}
            format={(v) => `${(v * 100).toFixed(0)}%`}
            ariaLabel="Overlay strength"
          />
          <Select
            value={config.overlay_cmap}
            options={COLORMAPS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => setConfig((c) => ({ ...c, overlay_cmap: v }))}
            ariaLabel="Overlay colormap"
          />
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
        <Button variant="primary" icon="check" onClick={apply}>
          Apply overlay
        </Button>
      </div>
    </Modal>
  );
};
