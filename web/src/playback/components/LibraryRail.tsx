// LibraryRail — left column of the Playback workspace.
//
// Renders Recordings grouped by sample → view → exposure when the
// filename convention is followed; ungrouped under "Other recordings"
// when not. Renders Darks grouped by exposure.

import React from 'react';

import { CHANNEL_COLOR, FONT, LAYOUT, SPACE } from '../tokens';
import { RecordingDTO, DarkDTO, deleteRecording, buildStream, openTab } from '../api';

const { useMemo, useState } = React;

interface Props {
  recordings: RecordingDTO[];
  darks: DarkDTO[];
  onOpenFile: () => void;
  onError: (msg: string) => void;
}

const PANEL_BG = '#0f1115';
const PANEL_BORDER = '#1f2330';
const TEXT = '#e5e7eb';
const TEXT_MUTED = '#9ca3af';
const TEXT_FAINT = '#6b7280';
const ACCENT = '#3b82f6';
const ACCENT_SOFT = 'rgba(59, 130, 246, 0.15)';

const _sectionLabel: React.CSSProperties = {
  font: FONT.label,
  letterSpacing: 0.6,
  color: TEXT_FAINT,
  textTransform: 'uppercase',
  marginTop: SPACE.md,
  marginBottom: SPACE.xs,
  paddingLeft: SPACE.sm,
};

const _row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: SPACE.sm,
  padding: `${SPACE.xs}px ${SPACE.sm}px`,
  borderRadius: 4,
  font: FONT.small,
  color: TEXT,
};

interface SampleViewGroup {
  sample: number;
  view: number;
  recordings: RecordingDTO[];
}

function _group(recs: RecordingDTO[]): { groups: SampleViewGroup[]; ungrouped: RecordingDTO[] } {
  const groups: Map<string, SampleViewGroup> = new Map();
  const ungrouped: RecordingDTO[] = [];
  for (const r of recs) {
    if (r.sample == null || r.view == null) {
      ungrouped.push(r);
      continue;
    }
    const key = `${r.sample}::${r.view}`;
    const g = groups.get(key) ?? { sample: r.sample, view: r.view, recordings: [] };
    g.recordings.push(r);
    groups.set(key, g);
  }
  const out = Array.from(groups.values()).sort((a, b) => a.sample - b.sample || a.view - b.view);
  for (const g of out) {
    g.recordings.sort((a, b) => (a.exposure_s ?? 0) - (b.exposure_s ?? 0));
  }
  return { groups: out, ungrouped };
}

function _exposureLabel(exposure_s: number | null): string {
  if (exposure_s == null) return '—';
  if (exposure_s >= 1) return `${exposure_s.toFixed(2)} s`;
  if (exposure_s >= 0.001) return `${(exposure_s * 1000).toFixed(0)} ms`;
  return `${(exposure_s * 1_000_000).toFixed(0)} µs`;
}

const RecordingRow: React.FC<{
  rec: RecordingDTO;
  onPlay: () => void;
  onDelete: () => void;
}> = ({ rec, onPlay, onDelete }) => {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ..._row,
        background: hover ? '#1a1f2c' : 'transparent',
        cursor: 'default',
      }}
    >
      <span
        title={`Exposure ${_exposureLabel(rec.exposure_s)}`}
        style={{
          font: FONT.monoSmall,
          color: TEXT_MUTED,
          background: '#1f2937',
          padding: '1px 6px',
          borderRadius: 3,
          minWidth: 48,
          textAlign: 'center',
        }}
      >
        {_exposureLabel(rec.exposure_s)}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          font: FONT.mono,
          color: TEXT,
        }}
        title={rec.name}
      >
        {rec.name.replace(/^sample_\d+_view_\d+_exp_[\d.]+_?/, '').replace(/\.h5$/, '') || rec.name}
      </span>
      <span style={{ font: FONT.monoSmall, color: TEXT_FAINT }}>{rec.n_frames}f</span>
      <button
        title="Open in workspace"
        onClick={onPlay}
        style={{
          opacity: hover ? 1 : 0.5,
          background: ACCENT_SOFT,
          color: ACCENT,
          border: 'none',
          borderRadius: 3,
          padding: '2px 8px',
          font: FONT.small,
          cursor: 'pointer',
        }}
      >
        ▶
      </button>
      <button
        title="Remove recording"
        onClick={onDelete}
        style={{
          opacity: hover ? 1 : 0.4,
          background: 'transparent',
          color: '#ef4444',
          border: 'none',
          borderRadius: 3,
          padding: '2px 6px',
          font: FONT.small,
          cursor: 'pointer',
        }}
      >
        ✕
      </button>
    </div>
  );
};

export const LibraryRail: React.FC<Props> = ({ recordings, darks, onOpenFile, onError }) => {
  const { groups, ungrouped } = useMemo(() => _group(recordings), [recordings]);
  const isEmpty = recordings.length === 0 && darks.length === 0;

  const handlePlay = async (rec: RecordingDTO) => {
    try {
      const s = await buildStream([rec.rec_id]);
      await openTab(s.stream_id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDelete = async (rec: RecordingDTO) => {
    try {
      await deleteRecording(rec.rec_id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside
      data-region="library-rail"
      style={{
        width: LAYOUT.sourcesPanelW.default,
        minWidth: LAYOUT.sourcesPanelW.min,
        maxWidth: LAYOUT.sourcesPanelW.max,
        background: PANEL_BG,
        borderRight: `1px solid ${PANEL_BORDER}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        font: FONT.ui,
        color: TEXT,
      }}
    >
      <header
        style={{
          padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.sm}px`,
          borderBottom: `1px solid ${PANEL_BORDER}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ font: FONT.label, color: TEXT_MUTED, letterSpacing: 0.6 }}>LIBRARY</span>
        <button
          onClick={onOpenFile}
          title="Open recording (.h5)"
          style={{
            background: ACCENT_SOFT,
            color: ACCENT,
            border: 'none',
            borderRadius: 4,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            font: FONT.small,
            cursor: 'pointer',
          }}
        >
          + Open
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto', padding: `0 ${SPACE.xs}px ${SPACE.lg}px` }}>
        {isEmpty && (
          <div
            style={{
              padding: SPACE.xl,
              textAlign: 'center',
              color: TEXT_FAINT,
              font: FONT.small,
              lineHeight: 1.5,
            }}
          >
            No recordings yet.
            <div style={{ marginTop: SPACE.sm }}>
              <button
                onClick={onOpenFile}
                style={{
                  background: ACCENT,
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: `${SPACE.sm}px ${SPACE.lg}px`,
                  font: FONT.uiBold,
                  cursor: 'pointer',
                }}
              >
                Open recording…
              </button>
            </div>
          </div>
        )}

        <div style={_sectionLabel}>RECORDINGS · {recordings.length}</div>
        {groups.map((g) => (
          <div key={`${g.sample}-${g.view}`} style={{ marginBottom: SPACE.sm }}>
            <div
              style={{
                font: FONT.small,
                color: TEXT_MUTED,
                padding: `${SPACE.xs}px ${SPACE.sm}px`,
                display: 'flex',
                alignItems: 'center',
                gap: SPACE.sm,
                background: '#161a24',
                borderRadius: 4,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: CHANNEL_COLOR['HG-G'],
                  display: 'inline-block',
                }}
                aria-hidden
              />
              <span style={{ flex: 1 }}>
                Sample {g.sample} · View {g.view}
              </span>
              <span style={{ font: FONT.monoSmall, color: TEXT_FAINT }}>
                {g.recordings.length} file{g.recordings.length !== 1 ? 's' : ''}
              </span>
            </div>
            {g.recordings.map((r) => (
              <RecordingRow
                key={r.rec_id}
                rec={r}
                onPlay={() => handlePlay(r)}
                onDelete={() => handleDelete(r)}
              />
            ))}
          </div>
        ))}
        {ungrouped.length > 0 && (
          <>
            <div style={_sectionLabel}>OTHER RECORDINGS · {ungrouped.length}</div>
            {ungrouped.map((r) => (
              <RecordingRow
                key={r.rec_id}
                rec={r}
                onPlay={() => handlePlay(r)}
                onDelete={() => handleDelete(r)}
              />
            ))}
          </>
        )}

        <div style={_sectionLabel}>DARK FRAMES · {darks.length}</div>
        {darks.length === 0 ? (
          <div
            style={{
              font: FONT.small,
              color: TEXT_FAINT,
              padding: `${SPACE.xs}px ${SPACE.sm}px`,
            }}
          >
            No dark frames loaded.
          </div>
        ) : (
          darks.map((d) => (
            <div key={d.dark_id} style={_row}>
              <span style={{ font: FONT.monoSmall, color: TEXT_MUTED, minWidth: 48 }}>
                {_exposureLabel(d.exposure_s)}
              </span>
              <span
                style={{
                  flex: 1,
                  font: FONT.mono,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.name}
              </span>
              <span style={{ font: FONT.monoSmall, color: TEXT_FAINT }}>×{d.n_source_frames}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
