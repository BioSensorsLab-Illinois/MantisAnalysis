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
import { Inspector } from './Inspector.tsx';
import { OverlayBuilderModal } from './OverlayBuilderModal.tsx';
import { PlaybackEmptyState } from './EmptyState.tsx';
import { SourcesPanel } from './SourcesPanel.tsx';
import { StreamBuilderModal } from './StreamBuilderModal.tsx';
import { StreamHeader } from './StreamHeader.tsx';
import { TimelineStrip } from './TimelineStrip.tsx';
import { ViewerGrid } from './ViewerGrid.tsx';
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

  // Play-head ticker. Steps `frame` by 1 every `1000 / (fps × speed)` ms.
  // Wraps at the end of the stream. Stops when `playing` is false or no
  // stream is active.
  useEffect(() => {
    if (!state.playing || !stream) return;
    const intervalMs = Math.max(
      8,
      1000 / Math.max(1, (state.playbackFps || 30) * (state.playbackSpeed || 1))
    );
    const id = setInterval(() => {
      dispatch({
        type: 'frame/set',
        payload: ((state.frame ?? 0) + 1) % Math.max(1, stream.total_frames),
      });
    }, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.playing, state.playbackFps, state.playbackSpeed, state.frame, stream?.total_frames]);

  // Keyboard shortcuts inside Playback mode (Space, ←, →, [, ], L, +).
  useEffect(() => {
    if (!showWorkspace) return undefined;
    const onKey = (e) => {
      const tgt = e.target;
      const typing =
        tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      if (typing) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        dispatch({ type: 'play/toggle' });
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        dispatch({
          type: 'frame/set',
          payload: Math.min((stream?.total_frames ?? 1) - 1, (state.frame ?? 0) + step),
        });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        dispatch({
          type: 'frame/set',
          payload: Math.max(0, (state.frame ?? 0) - step),
        });
      } else if (e.key === 'Home') {
        e.preventDefault();
        dispatch({ type: 'frame/set', payload: 0 });
      } else if (e.key === 'End') {
        e.preventDefault();
        dispatch({ type: 'frame/set', payload: (stream?.total_frames ?? 1) - 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWorkspace, stream?.total_frames, state.frame]);

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
            data-region="workspace"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            <ViewerGrid
              views={state.views}
              layout={state.layout}
              selectedViewId={state.selectedViewId}
              onSelect={(id) => dispatch({ type: 'view/select', payload: id })}
              onAddView={() => {
                const ch =
                  (stream?.available_channels ?? []).find((c) => c === 'HG-G') ||
                  (stream?.available_channels ?? [])[0] ||
                  'HG-G';
                dispatch({
                  type: 'view/add',
                  payload: { name: ch, channel: ch },
                });
              }}
              onRemoveView={(id) => dispatch({ type: 'view/remove', payload: id })}
              onDuplicateView={(id) => dispatch({ type: 'view/duplicate', payload: id })}
              onToggleLock={(id) => {
                const v = state.views.find((vv) => vv.view_id === id);
                if (!v) return;
                dispatch({
                  type: 'view/lock',
                  payload: { id, frame: v.locked_frame == null ? state.frame : null },
                });
              }}
              onChangeLayout={(l) => dispatch({ type: 'layout/set', payload: l })}
              frame={state.frame}
              streamId={state.activeStreamId}
            />
            <TimelineStrip
              stream={stream}
              frame={state.frame}
              onChangeFrame={(f) => dispatch({ type: 'frame/set', payload: f })}
              playing={state.playing}
              onTogglePlay={() => dispatch({ type: 'play/toggle' })}
              range={state.range}
              onChangeRange={(r) => dispatch({ type: 'range/set', payload: r })}
              lockedFrames={state.views.map((v) => v.locked_frame).filter((f) => f != null)}
              speed={state.playbackSpeed}
              onChangeSpeed={(s) => dispatch({ type: 'speed/set', payload: s })}
              fps={state.playbackFps}
              onChangeFps={(f) => dispatch({ type: 'fps/set', payload: f })}
            />
          </div>
          <Inspector />
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
      {state.modal?.kind === 'overlay-builder' && (
        <OverlayBuilderModal
          viewId={state.modal.viewId}
          onClose={closeModal}
          onApply={(cfg) =>
            dispatch({
              type: 'view/update',
              payload: { id: state.modal.viewId, patch: { ...cfg, overlay_on: true } },
            })
          }
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
