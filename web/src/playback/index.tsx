// @ts-nocheck
// recording-inspection-implementation-v1 M5 — Playback mode entry.
//
// This is the M5 surface: rail tile + empty state + sources panel
// skeleton + stream header. Subsequent milestones add the viewer
// grid (M7), inspector (M8), overlay (M9), export (M10), polish
// (M11). Behind the `mantis/playback/enabled` localStorage flag
// (default OFF until M11 close per risk-skeptic P1-K).

import React from 'react';
import { useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';
import { PlaybackEmptyState } from './EmptyState.tsx';
import { SourcesPanel } from './SourcesPanel.tsx';
import { StreamHeader } from './StreamHeader.tsx';
import { PlaybackProvider, playbackEnabled, usePlayback } from './state.tsx';

const { useEffect, useState } = React;

const PlaybackInner = ({ say, onOpenFile }) => {
  const t = useTheme();
  const { state, dispatch } = usePlayback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Hydrate the lists on mount (server may already have entries from
  // a previous session-within-a-process).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [recordings, darks, streams] = await Promise.all([
          playbackApi.listRecordings(),
          playbackApi.listDarks(),
          playbackApi.listStreams(),
        ]);
        if (!alive) return;
        dispatch({ type: 'recordings/set', payload: recordings || [] });
        dispatch({ type: 'darks/set', payload: darks || [] });
        dispatch({ type: 'streams/set', payload: streams || [] });
        if ((streams || []).length > 0) {
          dispatch({ type: 'stream/active', payload: streams[0].stream_id });
        }
      } catch (err) {
        if (alive) setError(err?.message || String(err));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const rec = await playbackApi.loadSampleRecording();
      dispatch({ type: 'recording/added', payload: rec });
      const stream = await playbackApi.buildStream([rec.recording_id], {
        name: 'Synthetic stream',
      });
      dispatch({ type: 'stream/built', payload: stream });
      dispatch({ type: 'stream/active', payload: stream.stream_id });
      say && say(`Loaded synthetic stream · ${stream.total_frames} frames`, 'success');
    } catch (err) {
      const detail = err?.detail ?? err?.message ?? String(err);
      const msg =
        err?.status === 404
          ? 'Synthetic load-sample endpoint disabled. Set MANTIS_PLAYBACK_TEST=1 on the server.'
          : detail;
      setError(msg);
      say && say(`Sample load failed: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const showWorkspace = stream != null;

  return (
    <div
      data-screen-label="Playback mode"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        background: t.bg,
      }}
    >
      <StreamHeader
        onOpenBuilder={() => say && say('Stream Builder lands at M6.', 'info')}
        onOpenWarnings={() => say && say('Warning Center lands at M11.', 'info')}
        onExport={() => say && say('Export modal lands at M10.', 'info')}
      />
      {!showWorkspace && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-region="playback-empty-shell">
          <SourcesPanel
            onOpenRecording={onOpenFile}
            onLoadSample={loadSample}
            onOpenDark={onOpenFile}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <PlaybackEmptyState onLoadSample={loadSample} onOpenFile={onOpenFile} busy={busy} />
            {error && (
              <div
                role="alert"
                style={{
                  margin: '0 16px 16px',
                  padding: 10,
                  background: 'rgba(207, 34, 46, 0.10)',
                  border: `1px solid ${t.danger}`,
                  color: t.danger,
                  borderRadius: 4,
                  fontSize: 11.5,
                  fontFamily: 'ui-monospace, Menlo, monospace',
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>
      )}
      {showWorkspace && (
        <div
          style={{ flex: 1, display: 'flex', minHeight: 0 }}
          data-region="playback-workspace-shell"
        >
          <SourcesPanel
            onOpenRecording={onOpenFile}
            onLoadSample={loadSample}
            onOpenDark={onOpenFile}
          />
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: t.textMuted,
              fontSize: 12,
              padding: 24,
              textAlign: 'center',
            }}
          >
            Stream loaded · {stream.total_frames} frames.
            <br />
            Viewer grid + timeline land at M7.
          </div>
        </div>
      )}
    </div>
  );
};

export const PlaybackMode = ({ say, onOpenFile }) => (
  <PlaybackProvider>
    <PlaybackInner say={say} onOpenFile={onOpenFile} />
  </PlaybackProvider>
);

export { playbackEnabled };
