// @ts-nocheck
// recording-inspection-implementation-v1 M5+M6 — Sources panel.
// Renders FilePill rows for recordings + DarkFrameRow rows for darks,
// plus a dark-strategy picker (mean / median / sigma-clipped) per
// user 2026-04-24.

import React from 'react';
import { Icon, useTheme, useViewport } from '../shared.tsx';
import { DarkFrameRow } from './DarkFrameRow.tsx';
import { FilePill } from './FilePill.tsx';
import { usePlayback } from './state.tsx';

const { useState } = React;

// playback-ux-polish-v1 M4 — collapsed icon-rail variant.
// At viewport < 1180 px, the Sources panel collapses to a 44 px icon
// rail with three tools: expand, recordings count + open, darks
// count + open. Per UI_IMPLEMENTATION_NOTES §12 + react-ui-ux M12 P1.
const CollapsedSourcesRail = ({
  recordings,
  darks,
  totalIssues,
  onExpand,
  onOpenRecording,
  onOpenDark,
}) => {
  const t = useTheme();
  const tile = (props) => (
    <button
      type="button"
      {...props}
      style={{
        width: 36,
        height: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: `1px solid ${t.border}`,
        borderRadius: 4,
        cursor: 'pointer',
        color: t.textMuted,
        position: 'relative',
        ...props.style,
      }}
    />
  );
  const Badge = ({ n, tone = 'neutral' }) => {
    if (!n) return null;
    const palette = tone === 'warn' ? { bg: t.warn, fg: '#fff' } : { bg: t.accent, fg: '#fff' };
    return (
      <span
        style={{
          position: 'absolute',
          top: -4,
          right: -4,
          minWidth: 14,
          height: 14,
          padding: '0 3px',
          borderRadius: 7,
          background: palette.bg,
          color: palette.fg,
          fontSize: 9,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'ui-monospace, Menlo, monospace',
        }}
      >
        {n}
      </span>
    );
  };
  return (
    <div
      data-region="sources-panel"
      data-collapsed="1"
      style={{
        width: 44,
        minWidth: 44,
        background: t.panel,
        borderRight: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '8px 4px',
        gap: 6,
        flexShrink: 0,
      }}
    >
      {tile({
        'aria-label': 'Expand Sources panel',
        title: 'Expand Sources panel',
        'data-action': 'expand-sources',
        onClick: onExpand,
        children: <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>›</span>,
      })}
      {tile({
        'aria-label': `Open recording (${recordings.length} loaded${totalIssues ? `, ${totalIssues} warning${totalIssues === 1 ? '' : 's'}` : ''})`,
        title: `Recordings: ${recordings.length}${totalIssues ? ` · ${totalIssues} warning${totalIssues === 1 ? '' : 's'}` : ''}`,
        'data-action': 'collapsed-open-recording',
        onClick: onOpenRecording,
        children: (
          <>
            <Icon name="film" size={14} />
            <Badge n={recordings.length} tone={totalIssues ? 'warn' : 'neutral'} />
          </>
        ),
      })}
      {tile({
        'aria-label': `Open dark frame (${darks.length} loaded)`,
        title: `Dark frames: ${darks.length}`,
        'data-action': 'collapsed-open-dark',
        onClick: onOpenDark,
        children: (
          <>
            <Icon name="moon" size={14} />
            <Badge n={darks.length} />
          </>
        ),
      })}
    </div>
  );
};

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

  // playback-ux-polish-v1 M4: responsive collapse. At < 1180 px the
  // panel renders as a 44 px icon rail with badge counts; the user
  // can expand back via the chevron tile (forceExpanded), and the
  // expanded state floats over the workspace as an overlay rather
  // than narrowing the workspace further.
  const { isNarrow } = useViewport();
  const [forceExpanded, setForceExpanded] = useState(false);
  const collapsed = isNarrow && !forceExpanded;

  const totalIssues = recordings.reduce(
    (acc, r) => acc + (r.warnings?.length ?? 0) + (r.errors?.length ?? 0),
    0
  );

  if (collapsed) {
    return (
      <CollapsedSourcesRail
        recordings={recordings}
        darks={darks}
        totalIssues={totalIssues}
        onExpand={() => setForceExpanded(true)}
        onOpenRecording={onOpenRecording}
        onOpenDark={onOpenDark}
      />
    );
  }

  return (
    <div
      data-region="sources-panel"
      data-collapsed="0"
      data-force-expanded={forceExpanded ? '1' : '0'}
      style={{
        width: 288,
        minWidth: 240,
        maxWidth: 360,
        background: t.panel,
        borderRight: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        // When forceExpanded over a narrow viewport, float the panel
        // as an overlay so the workspace doesn't get squeezed below
        // the per-cell minimum.
        ...(isNarrow && forceExpanded
          ? {
              position: 'absolute',
              top: 34, // below stream header
              left: 44, // mode rail width
              bottom: 0,
              zIndex: 50,
              boxShadow: t.shadowLg,
            }
          : {}),
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
        {isNarrow && forceExpanded && (
          <button
            type="button"
            aria-label="Collapse Sources panel"
            title="Collapse Sources panel"
            data-action="collapse-sources"
            onClick={() => setForceExpanded(false)}
            style={{
              marginLeft: 'auto',
              width: 22,
              height: 22,
              padding: 0,
              background: 'transparent',
              border: `1px solid ${t.border}`,
              borderRadius: 3,
              cursor: 'pointer',
              color: t.textMuted,
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ‹
          </button>
        )}
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
