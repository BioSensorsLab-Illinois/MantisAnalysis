// LibraryRail — left column of the Playback workspace.
//
// Renders Recordings grouped by sample → view → exposure when the
// filename convention is followed; ungrouped under "Other" when not.
// Renders Darks grouped by exposure. Token-driven; no inline hex.

import React from 'react';

import { RecordingDTO, DarkDTO, deleteRecording, buildStream, openTab } from '../api';
import { CHANNEL_COLOR, FONT, LAYOUT, PALETTE, RADIUS, SPACE } from '../theme';

import { ExposurePill } from './ExposurePill';
import { IconButton } from './IconButton';

const { useMemo, useState } = React;

interface Props {
  recordings: RecordingDTO[];
  darks: DarkDTO[];
  onOpenFile: () => void;
  onError: (msg: string) => void;
}

const _sectionLabel: React.CSSProperties = {
  font: FONT.label,
  letterSpacing: 0.6,
  color: PALETTE.textFaint,
  textTransform: 'uppercase',
  marginTop: SPACE.md,
  marginBottom: SPACE.xs,
  paddingLeft: SPACE.sm,
};

interface SampleViewGroup {
  sample: number;
  view: number;
  recordings: RecordingDTO[];
}

function _group(recs: RecordingDTO[]): {
  groups: SampleViewGroup[];
  ungrouped: RecordingDTO[];
} {
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

// View → channel hue mapping. Each view (camera angle) gets a stable
// color so the rail reads at-a-glance: view 0 → R, view 1 → G,
// view 2 → B, view 3 → NIR.
const VIEW_TO_CHANNEL: Record<number, keyof typeof CHANNEL_COLOR> = {
  0: 'HG-R',
  1: 'HG-G',
  2: 'HG-B',
  3: 'HG-NIR',
};

function _viewSwatch(view: number): string {
  const ch = VIEW_TO_CHANNEL[view] ?? 'HG-Y';
  return CHANNEL_COLOR[ch];
}

const RecordingRow: React.FC<{
  rec: RecordingDTO;
  onPlay: () => void;
  onDelete: () => void;
}> = ({ rec, onPlay, onDelete }) => {
  const [hover, setHover] = useState(false);
  const shortName = rec.name.replace(/^sample_\d+_view_\d+_exp_[\d.]+_?/, '').replace(/\.h5$/, '');
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: SPACE.sm,
        padding: `${SPACE.xs}px ${SPACE.sm}px`,
        borderRadius: RADIUS.md,
        font: FONT.small,
        color: PALETTE.text,
        background: hover ? PALETTE.rowHover : 'transparent',
        cursor: 'default',
      }}
    >
      <ExposurePill exposure_s={rec.exposure_s} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          font: FONT.mono,
          color: PALETTE.text,
        }}
        title={rec.name}
      >
        {shortName || rec.name}
      </span>
      <span style={{ font: FONT.monoSmall, color: PALETTE.textFaint, flexShrink: 0 }}>
        {rec.n_frames}f
      </span>
      <IconButton
        glyph={'▶'}
        label={`Open ${rec.name} in workspace`}
        onClick={onPlay}
        tone="accent"
        hover={hover}
      />
      <IconButton
        glyph={'✕'}
        label={`Remove ${rec.name}`}
        onClick={onDelete}
        tone="danger"
        hover={hover}
      />
    </div>
  );
};

const SampleViewHeader: React.FC<{ group: SampleViewGroup }> = ({ group }) => {
  return (
    <div
      style={{
        font: FONT.small,
        color: PALETTE.textMuted,
        padding: `${SPACE.xs}px ${SPACE.sm}px`,
        display: 'flex',
        alignItems: 'center',
        gap: SPACE.sm,
        background: PALETTE.panelAlt,
        borderRadius: RADIUS.md,
        marginBottom: 2,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 3,
          background: _viewSwatch(group.view),
          display: 'inline-block',
          flexShrink: 0,
          boxShadow: `0 0 0 1px ${PALETTE.border}`,
        }}
      />
      <span style={{ flex: 1, fontWeight: 600 }}>
        Sample {group.sample} <span style={{ color: PALETTE.textFaint }}>·</span> View {group.view}
      </span>
      <span style={{ font: FONT.monoSmall, color: PALETTE.textFaint }}>
        {group.recordings.length} file{group.recordings.length !== 1 ? 's' : ''}
      </span>
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
        background: PALETTE.panel,
        borderRight: `1px solid ${PALETTE.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        font: FONT.ui,
        color: PALETTE.text,
      }}
    >
      <header
        style={{
          padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.sm}px`,
          borderBottom: `1px solid ${PALETTE.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ font: FONT.label, color: PALETTE.textMuted, letterSpacing: 0.6 }}>
          LIBRARY
        </span>
        <button
          onClick={onOpenFile}
          title="Open recording (.h5)"
          aria-label="Open recording"
          style={{
            background: PALETTE.accentSoft,
            color: PALETTE.accent,
            border: 'none',
            borderRadius: RADIUS.md,
            padding: `${SPACE.xs}px ${SPACE.sm}px`,
            font: FONT.small,
            cursor: 'pointer',
          }}
        >
          + Open
        </button>
      </header>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: `0 ${SPACE.xs}px ${SPACE.lg}px`,
        }}
      >
        {isEmpty && (
          <div
            style={{
              padding: SPACE.xl,
              textAlign: 'center',
              color: PALETTE.textFaint,
              font: FONT.small,
              lineHeight: 1.5,
            }}
          >
            No recordings yet.
            <div style={{ marginTop: SPACE.sm }}>
              <button
                onClick={onOpenFile}
                style={{
                  background: PALETTE.accent,
                  color: 'white',
                  border: 'none',
                  borderRadius: RADIUS.md,
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
            <SampleViewHeader group={g} />
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
            <div style={_sectionLabel}>OTHER · {ungrouped.length}</div>
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
              color: PALETTE.textFaint,
              padding: `${SPACE.xs}px ${SPACE.sm}px`,
            }}
          >
            No dark frames loaded.
          </div>
        ) : (
          darks.map((d) => (
            <div
              key={d.dark_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: SPACE.sm,
                padding: `${SPACE.xs}px ${SPACE.sm}px`,
                font: FONT.small,
              }}
            >
              <ExposurePill exposure_s={d.exposure_s} />
              <span
                style={{
                  flex: 1,
                  font: FONT.mono,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: PALETTE.text,
                }}
              >
                {d.name}
              </span>
              <span style={{ font: FONT.monoSmall, color: PALETTE.textFaint, flexShrink: 0 }}>
                ×{d.n_source_frames}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
};
