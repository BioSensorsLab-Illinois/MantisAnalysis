// @ts-nocheck
// recording-inspection-implementation-v1 M5+M6 — Sources panel.
// Renders FilePill rows for recordings + DarkFrameRow rows for darks,
// plus a dark-strategy picker (mean / median / sigma-clipped) per
// user 2026-04-24.

import React from 'react';
import { Icon, useTheme } from '../shared.tsx';
import { DarkFrameRow } from './DarkFrameRow.tsx';
import { FilePill } from './FilePill.tsx';
import { usePlayback } from './state.tsx';

const { useState } = React;

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

const STRATEGIES = [
  { id: 'mean', label: 'Mean' },
  { id: 'median', label: 'Median' },
  { id: 'sigma_clipped', label: '3σ clip' },
];

export const SourcesPanel = ({
  onOpenRecording,
  onOpenSample,
  onOpenDark,
  onRemoveRecording,
  onRemoveDark,
  onOpenBuilder,
  darkStrategy,
  onChangeDarkStrategy,
}) => {
  const t = useTheme();
  const { state } = usePlayback();
  const { recordings, darks } = state;
  const baseExposure = recordings[0]?.exposure_mean ?? null;
  const [showRecordings, setShowRecordings] = useState(true);
  const [showDarks, setShowDarks] = useState(true);

  const totalIssues = recordings.reduce(
    (acc, r) => acc + (r.warnings?.length ?? 0) + (r.errors?.length ?? 0),
    0
  );

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
        {totalIssues > 0 && (
          <span
            title={`${totalIssues} warning${totalIssues > 1 ? 's' : ''}`}
            style={{
              padding: '1px 5px',
              background: 'rgba(197, 127, 0, 0.10)',
              color: t.warn,
              border: `1px solid ${t.warn}`,
              borderRadius: 3,
              fontSize: 9.5,
              fontFamily: 'ui-monospace, Menlo, monospace',
            }}
          >
            {totalIssues}
          </span>
        )}
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
        <section data-section="recordings">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <button
              type="button"
              aria-expanded={showRecordings}
              aria-label={`${showRecordings ? 'Collapse' : 'Expand'} recordings list`}
              onClick={() => setShowRecordings((s) => !s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: 0,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: t.text,
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              <Icon
                name="chevron"
                size={9}
                style={{
                  transform: showRecordings ? 'rotate(90deg)' : 'none',
                  transition: 'transform 120ms',
                  color: t.textFaint,
                }}
              />
              Recordings
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-label="Load synthetic sample recording"
              onClick={onOpenSample}
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
          {showRecordings && (
            <>
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
                    <li key={r.recording_id} style={{ listStyle: 'none' }}>
                      <FilePill file={r} onRemove={onRemoveRecording} />
                    </li>
                  ))}
                </ul>
              )}
              {recordings.length >= 2 && (
                <button
                  type="button"
                  aria-label="Open Stream Builder"
                  onClick={onOpenBuilder}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: '6px 10px',
                    background: t.accentSoft,
                    color: t.accent,
                    border: `1px solid ${t.accent}`,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                  }}
                >
                  Open Stream Builder ({recordings.length} files)
                </button>
              )}
            </>
          )}
        </section>

        <section data-section="darks">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <button
              type="button"
              aria-expanded={showDarks}
              aria-label={`${showDarks ? 'Collapse' : 'Expand'} dark frames list`}
              onClick={() => setShowDarks((s) => !s)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: 0,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: t.text,
                fontSize: 10.5,
                fontWeight: 600,
                fontFamily: 'inherit',
              }}
            >
              <Icon
                name="chevron"
                size={9}
                style={{
                  transform: showDarks ? 'rotate(90deg)' : 'none',
                  transition: 'transform 120ms',
                  color: t.textFaint,
                }}
              />
              Dark frames
            </button>
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
          {showDarks && (
            <>
              <div
                role="group"
                aria-label="Dark frame averaging strategy"
                style={{
                  display: 'flex',
                  gap: 4,
                  marginBottom: 8,
                }}
              >
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={darkStrategy === s.id}
                    onClick={() => onChangeDarkStrategy?.(s.id)}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      background: darkStrategy === s.id ? t.accentSoft : 'transparent',
                      color: darkStrategy === s.id ? t.accent : t.textMuted,
                      border: `1px solid ${darkStrategy === s.id ? t.accent : t.chipBorder}`,
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 10,
                      fontFamily: 'inherit',
                    }}
                  >
                    {s.label}
                  </button>
                ))}
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
                    <DarkFrameRow
                      key={d.dark_id}
                      dark={d}
                      baseExposure={baseExposure}
                      onRemove={onRemoveDark}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};
