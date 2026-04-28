// @ts-nocheck
// playback/modals/WarningCenterModal — extracted from
// web/src/playback.tsx in B-0037 Phase 4.
//
// Aggregates per-file + per-stream + per-export warnings into a
// single modal grouped by severity (error / warning / info). Each
// row carries an inline action button (Inspect file / Open Stream
// Builder / Open Inspector / Open export / Dismiss) routed back to
// the parent's `onAction(kind, warning)` handler.
//
// The WARNING_TEMPLATES catalog (canonical headline + action per
// code) lives in this file because no other module reads it.

import React from 'react';
import * as _shared from '../../shared.tsx';

const _s = _shared;
const useTheme = _s.useTheme;
const Modal = _s.Modal;
const Icon = _s.Icon;
const Button = _s.Button;

// Canonical W-* warning catalog. Every emit site (continuity
// detection, FilePill load, dark attach, overlay validation, export
// pipeline, processing config validator) tags its row with one of
// the codes below. The Warning Center renders each row through this
// map so the user sees a consistent headline + action regardless of
// where the warning came from. `headline` is shown in bold above the
// per-emit detail text; `action` is rendered as an inline button.
// Actions:
//   - 'inspect-file'    → close modal + scroll/select the bound FilePill
//   - 'open-stream-builder' → close modal + open the Stream Builder
//   - 'clear-range'     → wipe the timeline rangeSelection
//   - 'open-export'     → close modal + open ExportVideoModal
//   - 'open-inspector'  → close modal + select the offending view
//   - 'dismiss'         → no-op (modal stays put; row dismissal is
//                         handled by the FilePill chip path, not here)
export const WARNING_TEMPLATES = {
  // Per-file metadata warnings (M16)
  'W-META-TS': {
    severity: 'warning',
    headline: 'Missing per-frame timestamps',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  'W-META-EXP': {
    severity: 'warning',
    headline: 'Missing per-frame exposure',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  'W-FRAME-FAIL': {
    severity: 'warning',
    headline: 'Per-frame metadata read failed',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  // Stream continuity (M11)
  'W-GAP': {
    severity: 'warning',
    headline: 'Gap between recordings',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-OVERLAP': {
    severity: 'warning',
    headline: 'Recordings overlap in time',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-EXP-MISMATCH': {
    severity: 'warning',
    headline: 'Exposure differs across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-SHAPE': {
    severity: 'error',
    headline: 'Frame dimensions differ across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  'W-CHAN': {
    severity: 'warning',
    headline: 'Channel layout differs across stream',
    action: { kind: 'open-stream-builder', label: 'Open Stream Builder' },
  },
  // Dark frame (M11 + new)
  'W-DARK-NONE': {
    severity: 'info',
    headline: 'No dark frames loaded',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
  'W-DARK': {
    severity: 'error',
    headline: 'Dark attach failed',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
  'W-DARK-AMBIG': {
    severity: 'warning',
    headline: 'Dark requested but none attached',
    action: { kind: 'inspect-file', label: 'Inspect file' },
  },
  // Overlay (M18)
  'W-OVL-SRC': {
    severity: 'warning',
    headline: 'Overlay source channel is missing',
    action: { kind: 'open-inspector', label: 'Open Inspector' },
  },
  // Export pipeline (M18)
  'W-EXPORT-LONG': {
    severity: 'info',
    headline: 'Export will be long',
    action: { kind: 'open-export', label: 'Adjust export' },
  },
  'W-RANGE-HUGE': {
    severity: 'warning',
    headline: 'Range covers many frames',
    action: { kind: 'clear-range', label: 'Clear range' },
  },
  // Processing config (M18)
  'W-PROC-INVALID': {
    severity: 'warning',
    headline: 'Processing config is invalid',
    action: { kind: 'open-inspector', label: 'Open Inspector' },
  },
  // File load (M11)
  'W-LOAD': {
    severity: 'error',
    headline: 'File load failed',
    action: { kind: 'dismiss', label: 'Dismiss' },
  },
};

export const WarningCenterModal = ({ warnings, onClose, onAction }) => {
  const t = useTheme();
  // M18: any per-row severity from the emit site overrides the template
  // default, but if a row arrives without `severity` (back-compat), the
  // canonical template value applies.
  const resolved = warnings.map((w) => {
    const tpl = WARNING_TEMPLATES[w.code] || null;
    return {
      ...w,
      severity: w.severity || tpl?.severity || 'warning',
      headline: tpl?.headline || null,
      action: tpl?.action || null,
    };
  });
  const grouped = {
    error: resolved.filter((w) => w.severity === 'error'),
    warning: resolved.filter((w) => w.severity === 'warning'),
    info: resolved.filter((w) => w.severity === 'info'),
  };
  const total = resolved.length;
  const sevColor = (s) => (s === 'error' ? t.danger : s === 'warning' ? t.warn : t.accent);
  const sevIcon = (s) => (s === 'error' ? 'close' : s === 'warning' ? 'warning' : 'info');
  return (
    <Modal onClose={onClose} width={560}>
      <div data-warning-center-modal>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 14,
            paddingBottom: 10,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Icon
            name="warning"
            size={16}
            style={{
              color: total > 0 ? (grouped.error.length > 0 ? t.danger : t.warn) : t.textFaint,
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Warnings</div>
          <span style={{ fontSize: 11, color: t.textMuted }}>
            {total} active · {grouped.error.length} error{grouped.error.length === 1 ? '' : 's'} ·{' '}
            {grouped.warning.length} warning{grouped.warning.length === 1 ? '' : 's'} ·{' '}
            {grouped.info.length} info
          </span>
          <div style={{ flex: 1 }} />
          <Button icon="close" variant="subtle" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {total === 0 && (
          <div style={{ fontSize: 12, color: t.textFaint, padding: '24px 0', textAlign: 'center' }}>
            No active warnings.
          </div>
        )}
        {['error', 'warning', 'info'].map(
          (sev) =>
            grouped[sev].length > 0 && (
              <div key={sev} style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: sevColor(sev),
                    marginBottom: 8,
                  }}
                >
                  {sev}s ({grouped[sev].length})
                </div>
                {grouped[sev].map((w, i) => (
                  <div
                    key={`${sev}-${i}`}
                    data-warning-row={sev}
                    data-warning-code={w.code}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '10px 12px',
                      background: `${sevColor(sev)}10`,
                      border: `1px solid ${sevColor(sev)}`,
                      borderRadius: 5,
                      marginBottom: 6,
                    }}
                  >
                    <Icon
                      name={sevIcon(sev)}
                      size={13}
                      style={{ color: sevColor(sev), flexShrink: 0, marginTop: 1 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* M18: canonical headline (template-supplied) +
                          detail (emit-site supplied). The headline is
                          what stays consistent between emit sites for
                          the same code; the detail carries per-event
                          specifics. */}
                      <div style={{ fontSize: 11, color: t.text, lineHeight: 1.5 }}>
                        <span
                          style={{
                            fontFamily: 'ui-monospace,Menlo,monospace',
                            fontSize: 10.5,
                            color: t.textMuted,
                            marginRight: 6,
                          }}
                        >
                          {w.code}
                        </span>
                        {w.headline && (
                          <span style={{ fontWeight: 600, color: t.text }}>{w.headline}</span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: t.textMuted,
                          lineHeight: 1.5,
                          marginTop: 2,
                        }}
                      >
                        {w.detail}
                      </div>
                      {(w.source || w.file) && (
                        <div
                          style={{
                            fontSize: 10,
                            color: t.textFaint,
                            marginTop: 2,
                            fontFamily: 'ui-monospace,Menlo,monospace',
                          }}
                        >
                          {w.source && <>source: {w.source}</>}
                          {w.source && w.file && <> · </>}
                          {w.file && <>file: {w.file}</>}
                        </div>
                      )}
                      {w.action && (
                        <div style={{ marginTop: 6 }}>
                          <button
                            data-warning-action={w.action.kind}
                            onClick={() => onAction?.(w.action.kind, w)}
                            style={{
                              background: 'transparent',
                              border: `1px solid ${sevColor(sev)}55`,
                              borderRadius: 3,
                              color: sevColor(sev),
                              cursor: 'pointer',
                              padding: '2px 10px',
                              fontSize: 10.5,
                              fontFamily: 'inherit',
                            }}
                          >
                            {w.action.label}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
        )}
      </div>
    </Modal>
  );
};
