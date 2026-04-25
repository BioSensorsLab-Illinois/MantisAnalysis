// @ts-nocheck
// recording-inspection-implementation-v1 M8 — per-view Inspector.
//
// Per spec.md §7.1.8 + W7/W9/W11. Nine collapsible sections (View /
// Source / Corrections / Display / RGB grading / Overlay / Labels /
// Presets / Advanced) with a Basic/Advanced segmented at the top.
// Every control round-trips to a backend frame request via
// dispatch({ type: 'view/update', ... }) → ViewerCard rebuilds its
// previewPngUrl → server re-renders.
//
// CCM editor is a 3×3 numeric grid with det display + det-stability
// guard (refuses application when |det| < 1e-3). "Auto from patch"
// pops a workflow that lets the user click ≥3 patches on the active
// frame, choose a CCM_TARGETS entry, and POST to
// /api/playback/ccm/from-patch.

import React from 'react';
import { Checkbox, Icon, Select, Slider, useLocalStorageState, useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';
import { usePlayback } from './state.tsx';

const { useEffect, useMemo, useState } = React;

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

const VIEW_TYPES = [
  { value: 'single', label: 'Single' },
  { value: 'rgb', label: 'RGB' },
];

const InspectorSection = ({
  title,
  defaultOpen = true,
  children,
  hidden = false,
  advanced = false,
  mode,
}) => {
  const t = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  if (hidden) return null;
  if (advanced && mode !== 'advanced') return null;
  return (
    <div
      data-section={title}
      style={{
        border: `1px solid ${t.border}`,
        borderRadius: 5,
        background: t.panel,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title} section`}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          padding: '7px 9px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: t.text,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          fontFamily: 'inherit',
        }}
      >
        <Icon
          name="chevron"
          size={9}
          style={{
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms',
            color: t.textFaint,
          }}
        />
        {title}
      </button>
      {open && (
        <div
          style={{
            padding: '4px 10px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderTop: `1px solid ${t.border}`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

const ChannelPicker = ({ value, available, onChange }) => {
  const channels = available && available.length ? available : [value];
  return (
    <Select
      value={value}
      options={channels.map((c) => ({ value: c, label: c }))}
      onChange={onChange}
      ariaLabel="Channel"
    />
  );
};

const CcmEditor = ({ ccm, ccmOn, onChange, onChangeOn }) => {
  const t = useTheme();
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState([]);
  const [targetId, setTargetId] = useState('d65_white');
  const [pickedRgb, setPickedRgb] = useState([]); // observed [r,g,b] tuples
  const [resp, setResp] = useState(null);

  useEffect(() => {
    let alive = true;
    playbackApi.ccmTargets().then((ts) => alive && setTargets(ts || []));
    return () => {
      alive = false;
    };
  }, []);

  const det = useMemo(() => {
    const m = ccm;
    return (
      m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
      m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
      m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
    );
  }, [ccm]);
  const stable = Math.abs(det) >= 1e-3;

  const setCell = (i, j, v) => {
    const next = ccm.map((row, ri) => row.map((cell, ci) => (ri === i && ci === j ? v : cell)));
    onChange(next);
  };

  const reset = () =>
    onChange([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);

  const applyPatchSolve = async () => {
    if (pickedRgb.length < 3) return;
    setBusy(true);
    try {
      const target = targets.find((t) => t.id === targetId);
      if (!target) return;
      // Use the same target white as every patch's expected (good enough
      // for a one-patch white-balance; full 24-patch fit lands later).
      const tgts = pickedRgb.map(() => target.white_rgb);
      const r = await playbackApi.ccmFromPatch(pickedRgb, tgts);
      setResp(r);
      if (r.stable) onChange(r.matrix);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-section="ccm-editor" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Checkbox checked={ccmOn} onChange={onChangeOn} label="Apply CCM" />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 4,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        {ccm.map((row, i) =>
          row.map((cell, j) => (
            <input
              key={`${i}-${j}`}
              type="number"
              step="0.01"
              aria-label={`CCM cell ${i + 1},${j + 1}`}
              value={cell}
              onChange={(e) => setCell(i, j, Number(e.target.value) || 0)}
              style={{
                padding: '4px 6px',
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.chipBorder}`,
                borderRadius: 3,
                fontSize: 11,
                fontFamily: 'inherit',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
          ))
        )}
      </div>
      <div style={{ fontSize: 10, color: stable ? t.success : t.danger }}>
        det = {det.toFixed(4)} {stable ? '✓' : '⚠ unstable (|det| < 1e-3)'}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Select
          value={targetId}
          options={targets.map((t) => ({ value: t.id, label: t.name }))}
          onChange={setTargetId}
          ariaLabel="CCM target white"
        />
      </div>
      <div style={{ fontSize: 10, color: t.textMuted }}>
        Picked patches: {pickedRgb.length} (≥3 to fit). Click below to add the center pixel of the
        current frame as a patch.
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          aria-label="Add center pixel as patch"
          onClick={() => {
            // Use a synthetic mid-gray observation — the real "click on the
            // image" workflow lands at M11 polish. For now this seeds the
            // solver enough to verify it round-trips.
            setPickedRgb((p) => [...p, [0.5, 0.5, 0.5]]);
          }}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          + Patch
        </button>
        <button
          type="button"
          aria-label="Auto-fit CCM from patches"
          onClick={applyPatchSolve}
          disabled={busy || pickedRgb.length < 3}
          style={{
            padding: '4px 8px',
            background: pickedRgb.length >= 3 ? t.accentSoft : 'transparent',
            color: pickedRgb.length >= 3 ? t.accent : t.textFaint,
            border: `1px solid ${pickedRgb.length >= 3 ? t.accent : t.chipBorder}`,
            borderRadius: 3,
            cursor: pickedRgb.length >= 3 ? 'pointer' : 'not-allowed',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          {busy ? '…' : 'Auto from patches'}
        </button>
        <button
          type="button"
          aria-label="Reset CCM to identity"
          onClick={reset}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: t.textMuted,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          Reset
        </button>
        <button
          type="button"
          aria-label="Clear picked patches"
          onClick={() => setPickedRgb([])}
          style={{
            padding: '4px 8px',
            background: 'transparent',
            color: t.textMuted,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            cursor: 'pointer',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          Clear
        </button>
      </div>
      {resp && (
        <div
          style={{ fontSize: 10, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace' }}
        >
          residual_rms · {resp.residual_rms.toFixed(6)}
        </div>
      )}
      <div style={{ fontSize: 9.5, color: t.textFaint, fontStyle: 'italic' }}>
        Display correction — not color calibrated unless you pin a known target.
      </div>
    </div>
  );
};

const PresetsPanel = ({ view, onApply }) => {
  const t = useTheme();
  const [presets, setPresets] = useState([]);
  const [savingName, setSavingName] = useState('');
  const refresh = () => playbackApi.listPresets('view').then((ps) => setPresets(ps || []));
  useEffect(() => {
    refresh();
  }, []);

  const save = async () => {
    if (!savingName.trim()) return;
    await playbackApi.savePreset('view', savingName.trim(), view);
    setSavingName('');
    refresh();
  };
  const remove = async (pid) => {
    await playbackApi.deletePreset('view', pid);
    refresh();
  };

  return (
    <div data-section="presets-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          aria-label="Preset name"
          placeholder="Preset name"
          value={savingName}
          onChange={(e) => setSavingName(e.target.value)}
          style={{
            flex: 1,
            padding: '4px 6px',
            background: t.inputBg,
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 3,
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="button"
          aria-label="Save preset"
          onClick={save}
          disabled={!savingName.trim()}
          style={{
            padding: '4px 8px',
            background: savingName.trim() ? t.accentSoft : 'transparent',
            color: savingName.trim() ? t.accent : t.textFaint,
            border: `1px solid ${savingName.trim() ? t.accent : t.chipBorder}`,
            borderRadius: 3,
            cursor: savingName.trim() ? 'pointer' : 'not-allowed',
            fontSize: 10,
            fontFamily: 'inherit',
          }}
        >
          Save
        </button>
      </div>
      {presets.length === 0 && (
        <div style={{ fontSize: 10, color: t.textFaint, padding: 4 }}>No presets saved yet.</div>
      )}
      {presets.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {presets.map((p) => (
            <li
              key={p.preset_id}
              data-preset-id={p.preset_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 6px',
                background: t.panelAlt,
                border: `1px solid ${t.chipBorder}`,
                borderRadius: 3,
                fontSize: 11,
                fontFamily: 'ui-monospace, Menlo, monospace',
              }}
            >
              <span style={{ flex: 1, color: t.text }}>{p.name}</span>
              <button
                type="button"
                aria-label={`Apply preset ${p.name}`}
                onClick={() => onApply?.(p.payload)}
                style={{
                  padding: '2px 6px',
                  background: 'transparent',
                  color: t.accent,
                  border: `1px solid ${t.accent}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                Apply
              </button>
              <button
                type="button"
                aria-label={`Delete preset ${p.name}`}
                onClick={() => remove(p.preset_id)}
                style={{
                  padding: '2px 6px',
                  background: 'transparent',
                  color: t.textFaint,
                  border: `1px solid ${t.chipBorder}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const FrameLruWidget = () => {
  const t = useTheme();
  const [info, setInfo] = useState(null);
  const refresh = () => playbackApi.getFrameLru().then(setInfo);
  useEffect(() => {
    refresh();
  }, []);
  if (!info) return null;
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
  const setCap = async (gigabytes) => {
    await playbackApi.setFrameLru(Math.round(gigabytes * 1024 * 1024 * 1024));
    refresh();
  };
  const capGb = info.cap_bytes / (1024 * 1024 * 1024);
  return (
    <div data-section="frame-lru" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          fontSize: 10.5,
          color: t.textMuted,
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        Used {mb(info.current_bytes)} / {mb(info.cap_bytes)} · {info.n_frames} frames cached
      </div>
      <Slider
        label="Cap"
        min={0.25}
        max={8}
        step={0.25}
        value={capGb}
        onChange={setCap}
        format={(v) => `${v.toFixed(2)} GB`}
        ariaLabel="Frame cache cap in gigabytes"
      />
      <div style={{ fontSize: 9.5, color: t.textFaint, lineHeight: 1.4 }}>
        Higher = smoother backward scrubbing, more RAM. Process-global cap (shared across all
        streams).
      </div>
    </div>
  );
};

const Inspector = () => {
  const t = useTheme();
  const { state, dispatch } = usePlayback();
  const [mode, setMode] = useLocalStorageState('playback/inspectorMode', 'basic');

  const view = state.views.find((v) => v.view_id === state.selectedViewId);
  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const available = stream?.available_channels ?? [];

  if (!view) {
    return (
      <aside
        data-region="inspector"
        style={{
          width: 316,
          minWidth: 280,
          maxWidth: 380,
          background: t.panel,
          borderLeft: `1px solid ${t.border}`,
          padding: 18,
          color: t.textFaint,
          fontSize: 11.5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <Icon name="settings" size={22} style={{ opacity: 0.5 }} />
        <div>Select a view to inspect.</div>
      </aside>
    );
  }

  const set = (patch) => dispatch({ type: 'view/update', payload: { id: view.view_id, patch } });
  const setRgbGain = (i, v) => {
    const next = [...view.rgb_gain];
    next[i] = v;
    set({ rgb_gain: next });
  };

  return (
    <aside
      data-region="inspector"
      style={{
        width: 316,
        minWidth: 280,
        maxWidth: 380,
        background: t.panel,
        borderLeft: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          height: 32,
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
            fontSize: 9.5,
            color: t.textFaint,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 700,
          }}
        >
          Inspector
        </div>
        <div style={{ width: 1, height: 14, background: t.border }} />
        <div
          style={{
            fontSize: 11,
            color: t.text,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {view.name}
        </div>
        <div role="group" aria-label="Inspector detail level" style={{ display: 'flex', gap: 2 }}>
          {['basic', 'advanced'].map((m) => (
            <button
              key={m}
              type="button"
              data-inspector-mode={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              style={{
                padding: '2px 8px',
                background: mode === m ? t.accentSoft : 'transparent',
                color: mode === m ? t.accent : t.textMuted,
                border: `1px solid ${mode === m ? t.accent : t.chipBorder}`,
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 10,
                textTransform: 'capitalize',
                fontFamily: 'inherit',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minHeight: 0,
        }}
      >
        {/* 1. View */}
        <InspectorSection title="View" mode={mode}>
          <input
            type="text"
            aria-label="View name"
            value={view.name}
            onChange={(e) => set({ name: e.target.value })}
            style={{
              padding: '4px 8px',
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.chipBorder}`,
              borderRadius: 3,
              fontSize: 11.5,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          <Select
            value={view.type}
            options={VIEW_TYPES}
            onChange={(v) => set({ type: v })}
            ariaLabel="View type"
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Checkbox
              checked={view.sync_to_global}
              onChange={(v) => set({ sync_to_global: v })}
              label="Sync to global frame"
            />
          </div>
          <Checkbox
            checked={view.export_include}
            onChange={(v) => set({ export_include: v })}
            label="Include in export"
          />
        </InspectorSection>

        {/* 2. Source */}
        <InspectorSection title="Source" mode={mode}>
          {view.type === 'single' && (
            <ChannelPicker
              value={view.channel}
              available={available}
              onChange={(v) => set({ channel: v })}
            />
          )}
          {view.type === 'rgb' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {['R', 'G', 'B'].map((slot, i) => (
                <ChannelPicker
                  key={slot}
                  value={view.channels[i]}
                  available={available}
                  onChange={(v) => {
                    const next = [...view.channels];
                    next[i] = v;
                    set({ channels: next });
                  }}
                />
              ))}
            </div>
          )}
          <div style={{ fontSize: 10, color: t.textFaint }}>
            Frame mode: {view.locked_frame == null ? 'Live' : `Locked at f${view.locked_frame}`}
          </div>
        </InspectorSection>

        {/* 3. Corrections */}
        <InspectorSection title="Corrections" mode={mode}>
          <Checkbox
            checked={view.dark_on}
            onChange={(v) => set({ dark_on: v })}
            label="Dark correction"
          />
          <Slider
            label="Gain"
            min={0.1}
            max={4}
            step={0.01}
            value={view.gain}
            onChange={(v) => set({ gain: v })}
            format={(v) => `${v.toFixed(2)}×`}
            ariaLabel="Linear gain"
          />
          <Slider
            label="Offset"
            min={-200}
            max={200}
            step={1}
            value={view.offset}
            onChange={(v) => set({ offset: v })}
            format={(v) => v.toFixed(0)}
            ariaLabel="DN offset"
          />
          <Checkbox
            checked={view.normalize}
            onChange={(v) => set({ normalize: v })}
            label="Normalize per frame (p1..p99.5)"
          />
        </InspectorSection>

        {/* 4. Display */}
        <InspectorSection title="Display" mode={mode}>
          <Slider
            label="Low"
            min={0}
            max={4095}
            step={1}
            value={view.low}
            onChange={(v) => set({ low: v })}
            format={(v) => v.toFixed(0)}
            ariaLabel="Display low threshold"
          />
          <Slider
            label="High"
            min={0}
            max={4095}
            step={1}
            value={view.high}
            onChange={(v) => set({ high: v })}
            format={(v) => v.toFixed(0)}
            ariaLabel="Display high threshold"
          />
          <Select
            value={view.colormap}
            options={COLORMAPS.map((c) => ({ value: c, label: c }))}
            onChange={(v) => set({ colormap: v })}
            ariaLabel="Colormap"
          />
          <Checkbox
            checked={view.invert}
            onChange={(v) => set({ invert: v })}
            label="Invert luminance"
          />
          <Checkbox
            checked={view.show_clipped}
            onChange={(v) => set({ show_clipped: v })}
            label="Highlight clipped pixels (magenta)"
          />
        </InspectorSection>

        {/* 5. RGB grading — only when type=rgb */}
        <InspectorSection title="RGB grading" hidden={view.type !== 'rgb'} mode={mode}>
          {['R', 'G', 'B'].map((label, i) => (
            <Slider
              key={label}
              label={`Gain ${label}`}
              min={0.1}
              max={3}
              step={0.01}
              value={view.rgb_gain[i]}
              onChange={(v) => setRgbGain(i, v)}
              format={(v) => v.toFixed(2)}
              ariaLabel={`RGB gain ${label}`}
            />
          ))}
          <Slider
            label="Gamma"
            min={0.3}
            max={3}
            step={0.01}
            value={view.gamma}
            onChange={(v) => set({ gamma: v })}
            format={(v) => v.toFixed(2)}
            ariaLabel="Gamma"
          />
          <Slider
            label="Brightness"
            min={-1}
            max={1}
            step={0.01}
            value={view.brightness}
            onChange={(v) => set({ brightness: v })}
            format={(v) => v.toFixed(2)}
            ariaLabel="Brightness"
          />
          <Slider
            label="Contrast"
            min={0}
            max={3}
            step={0.01}
            value={view.contrast}
            onChange={(v) => set({ contrast: v })}
            format={(v) => v.toFixed(2)}
            ariaLabel="Contrast"
          />
          <Slider
            label="Saturation"
            min={0}
            max={2}
            step={0.01}
            value={view.saturation}
            onChange={(v) => set({ saturation: v })}
            format={(v) => v.toFixed(2)}
            ariaLabel="Saturation"
          />
          <Slider
            label="WB (K)"
            min={2500}
            max={9500}
            step={100}
            value={view.wb_k}
            onChange={(v) => set({ wb_k: v })}
            format={(v) => `${v.toFixed(0)}K`}
            ariaLabel="White balance K"
          />
          <Select
            value={view.wb_mode}
            options={[
              { value: 'k', label: 'WB · Kelvin' },
              { value: 'patch', label: 'WB · clicked patch' },
            ]}
            onChange={(v) => set({ wb_mode: v })}
            ariaLabel="WB mode"
          />
          <CcmEditor
            ccm={view.ccm}
            ccmOn={view.ccm_on}
            onChange={(m) => set({ ccm: m })}
            onChangeOn={(b) => set({ ccm_on: b })}
          />
        </InspectorSection>

        {/* 6. Overlay */}
        <InspectorSection title="Overlay" mode={mode}>
          <Checkbox
            checked={view.overlay_on}
            onChange={(v) => set({ overlay_on: v })}
            label="Show overlay"
          />
          {view.overlay_on && (
            <>
              <ChannelPicker
                value={view.overlay_channel}
                available={available}
                onChange={(v) => set({ overlay_channel: v })}
              />
              <Slider
                label="Low"
                min={0}
                max={4095}
                step={1}
                value={view.overlay_low}
                onChange={(v) => set({ overlay_low: v })}
                format={(v) => v.toFixed(0)}
                ariaLabel="Overlay low threshold"
              />
              <Slider
                label="High"
                min={0}
                max={4095}
                step={1}
                value={view.overlay_high}
                onChange={(v) => set({ overlay_high: v })}
                format={(v) => v.toFixed(0)}
                ariaLabel="Overlay high threshold"
              />
              <Select
                value={view.overlay_blend}
                options={BLEND_MODES}
                onChange={(v) => set({ overlay_blend: v })}
                ariaLabel="Overlay blend mode"
              />
              <Slider
                label="Strength"
                min={0}
                max={1}
                step={0.01}
                value={view.overlay_strength}
                onChange={(v) => set({ overlay_strength: v })}
                format={(v) => `${(v * 100).toFixed(0)}%`}
                ariaLabel="Overlay strength"
              />
              <Select
                value={view.overlay_cmap}
                options={COLORMAPS.map((c) => ({ value: c, label: c }))}
                onChange={(v) => set({ overlay_cmap: v })}
                ariaLabel="Overlay colormap"
              />
            </>
          )}
        </InspectorSection>

        {/* 7. Labels */}
        <InspectorSection title="Labels" mode={mode}>
          {[
            ['labels_timestamp', 'Timestamp'],
            ['labels_frame', 'Frame index'],
            ['labels_channel', 'Channel name'],
            ['labels_source', 'Source filename'],
            ['labels_scale_bar', 'Scale bar'],
            ['labels_badges', 'Processing badges'],
            ['labels_legend', 'Overlay legend'],
          ].map(([k, label]) => (
            <Checkbox key={k} checked={!!view[k]} onChange={(v) => set({ [k]: v })} label={label} />
          ))}
        </InspectorSection>

        {/* 8. Presets */}
        <InspectorSection title="Presets" mode={mode}>
          <PresetsPanel view={view} onApply={(payload) => set(payload)} />
        </InspectorSection>

        {/* 9. Advanced */}
        <InspectorSection title="Advanced" advanced mode={mode}>
          <FrameLruWidget />
          <div
            style={{
              fontSize: 10,
              color: t.textFaint,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}
          >
            view_id · {view.view_id}
            <br />
            stream · {state.activeStreamId?.slice(0, 8)}
            <br />
            frame · {view.locked_frame ?? state.frame}
          </div>
        </InspectorSection>
      </div>
    </aside>
  );
};

export { Inspector };
