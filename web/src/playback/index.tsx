// @ts-nocheck
// recording-inspection-implementation-v1 M5+M6 — Playback mode entry.
//
// M5: rail tile + empty state + Sources skeleton + Stream header.
// M6: file uploads → /api/playback/recordings/upload, dark uploads
//     with strategy picker, Stream Builder modal auto-opens at 2+
//     recordings, warning chips on FilePill rows.
//
// Behind the `mantis/playback/enabled` localStorage flag (default
// OFF until M11 close per risk-skeptic P1-K).

import React from 'react';
import { useLocalStorageState, useTheme } from '../shared.tsx';
import { playbackApi } from './api.ts';
import { PlaybackEmptyState } from './EmptyState.tsx';
import { SourcesPanel } from './SourcesPanel.tsx';
import { StreamBuilderModal } from './StreamBuilderModal.tsx';
import { StreamHeader } from './StreamHeader.tsx';
import { PlaybackProvider, playbackEnabled, usePlayback } from './state.tsx';

const { useEffect, useRef, useState } = React;

const PlaybackInner = ({ say }) => {
  const t = useTheme();
  const { state, dispatch } = usePlayback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // useLocalStorageState auto-prefixes with `mantis/`, so the persisted
  // key becomes `mantis/playback/darkStrategy`.
  const [darkStrategy, setDarkStrategy] = useLocalStorageState('playback/darkStrategy', 'mean');

  const recordingInputRef = useRef(null);
  const darkInputRef = useRef(null);

  // Hydrate the lists on mount (server may carry entries from a
  // previous session-within-a-process).
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
        } else if ((recordings || []).length >= 2) {
          // Per spec.md flows.md F4: when hydration finds ≥2 recordings
          // and no active stream, auto-open the Stream Builder so the
          // user can pick the order / threshold before continuing.
          dispatch({ type: 'modal/open', payload: { kind: 'stream-builder' } });
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

  const onRecordingFiles = async (files) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    let lastRec = null;
    for (const f of files) {
      try {
        const rec = await playbackApi.uploadRecording(f);
        dispatch({ type: 'recording/added', payload: rec });
        lastRec = rec;
        say && say(`Loaded ${rec.name} · ${rec.frame_count} frames`, 'success');
      } catch (err) {
        const detail = err?.detail ?? err?.message ?? String(err);
        say && say(`Upload failed (${f.name}): ${detail}`, 'danger');
        setError(detail);
      }
    }
    setBusy(false);
    // If the user loaded just one file and there's no stream, build one.
    // If the upload brought the total count to ≥2 with no active stream,
    // auto-open the Stream Builder (flows.md F4).
    const newCount = state.recordings.length + files.length;
    if (files.length === 1 && lastRec && !state.activeStreamId && state.recordings.length === 0) {
      try {
        const s = await playbackApi.buildStream([lastRec.recording_id]);
        dispatch({ type: 'stream/built', payload: s });
        dispatch({ type: 'stream/active', payload: s.stream_id });
      } catch {
        /* surfaced via Sources panel error chip */
      }
    } else if (newCount >= 2 && !state.activeStreamId) {
      dispatch({ type: 'modal/open', payload: { kind: 'stream-builder' } });
    }
  };

  const onDarkFiles = async (files) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    for (const f of files) {
      try {
        const dark = await playbackApi.uploadDark(f, { strategy: darkStrategy });
        dispatch({ type: 'dark/added', payload: dark });
        say &&
          say(
            `Dark loaded · ${dark.name} · avg ${dark.frames_averaged} (${dark.strategy})`,
            'success'
          );
      } catch (err) {
        const detail = err?.detail ?? err?.message ?? String(err);
        say && say(`Dark upload failed (${f.name}): ${detail}`, 'danger');
        setError(detail);
      }
    }
    setBusy(false);
  };

  const removeRecording = async (rid) => {
    try {
      await playbackApi.deleteRecording(rid);
      dispatch({ type: 'recording/removed', payload: rid });
    } catch (err) {
      say && say(`Remove failed: ${err.message || err}`, 'danger');
    }
  };
  const removeDark = async (did) => {
    try {
      await playbackApi.deleteDark(did);
      dispatch({ type: 'dark/removed', payload: did });
    } catch (err) {
      say && say(`Remove failed: ${err.message || err}`, 'danger');
    }
  };

  const stream = state.streams.find((s) => s.stream_id === state.activeStreamId);
  const showWorkspace = stream != null;

  const openBuilder = () => dispatch({ type: 'modal/open', payload: { kind: 'stream-builder' } });
  const closeModal = () => dispatch({ type: 'modal/close' });

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
      <input
        ref={recordingInputRef}
        type="file"
        accept=".h5,.hdf5"
        multiple
        style={{ display: 'none' }}
        onChange={(ev) => {
          const files = Array.from(ev.target.files || []);
          ev.target.value = '';
          if (files.length) onRecordingFiles(files);
        }}
      />
      <input
        ref={darkInputRef}
        type="file"
        accept=".h5,.hdf5"
        multiple
        style={{ display: 'none' }}
        onChange={(ev) => {
          const files = Array.from(ev.target.files || []);
          ev.target.value = '';
          if (files.length) onDarkFiles(files);
        }}
      />

      <StreamHeader
        onOpenBuilder={openBuilder}
        onOpenWarnings={() => say && say('Warning Center lands at M11.', 'info')}
        onExport={() => say && say('Export modal lands at M10.', 'info')}
      />
      {!showWorkspace && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-region="playback-empty-shell">
          <SourcesPanel
            onOpenRecording={() => recordingInputRef.current?.click()}
            onOpenSample={loadSample}
            onOpenDark={() => darkInputRef.current?.click()}
            onRemoveRecording={removeRecording}
            onRemoveDark={removeDark}
            onOpenBuilder={openBuilder}
            darkStrategy={darkStrategy}
            onChangeDarkStrategy={setDarkStrategy}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <PlaybackEmptyState
              onLoadSample={loadSample}
              onOpenFile={() => recordingInputRef.current?.click()}
              busy={busy}
            />
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
            onOpenRecording={() => recordingInputRef.current?.click()}
            onOpenSample={loadSample}
            onOpenDark={() => darkInputRef.current?.click()}
            onRemoveRecording={removeRecording}
            onRemoveDark={removeDark}
            onOpenBuilder={openBuilder}
            darkStrategy={darkStrategy}
            onChangeDarkStrategy={setDarkStrategy}
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
            data-region="workspace-placeholder"
          >
            Stream loaded · {stream.total_frames} frames · {stream.recording_ids.length} file
            {stream.recording_ids.length !== 1 ? 's' : ''}.
            <br />
            Viewer grid + timeline land at M7.
          </div>
        </div>
      )}

      {state.modal?.kind === 'stream-builder' && (
        <StreamBuilderModal
          initialRecordingIds={state.recordings.map((r) => r.recording_id)}
          onClose={closeModal}
          onApplied={() => {}}
          say={say}
        />
      )}
    </div>
  );
};

export const PlaybackMode = ({ say, onOpenFile: _onOpenFile }) => (
  <PlaybackProvider>
    <PlaybackInner say={say} />
  </PlaybackProvider>
);

export { playbackEnabled };
