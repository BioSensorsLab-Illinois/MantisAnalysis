// Playback (Recording Inspection) — rebuild v2 entry.
// M2 wires the real workspace via useWorkspace + SSE + LibraryRail.
// M3+ adds visual polish and the workspace center / inspector.

import React from 'react';

import { LibraryRail } from './components/LibraryRail';
import { FONT, LAYOUT, SPACE } from './tokens';
import { useWorkspace } from './workspace';
import { registerRecordingsFromFolder, uploadRecording } from './api';

const { useRef, useState, useCallback } = React;

export const playbackEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('mantis/playback/enabled') !== '0';
};

export interface PlaybackModeProps {
  say?: (msg: string, kind?: string) => void;
  onOpenFile?: () => void;
}

const SHELL_BG = '#0a0a0a';
const TEXT = '#e5e7eb';
const TEXT_MUTED = '#9ca3af';
const TEXT_FAINT = '#6b7280';

export const PlaybackMode: React.FC<PlaybackModeProps> = ({ say }) => {
  const { workspace, loading, error, refresh } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleError = useCallback(
    (msg: string) => {
      if (say) say(msg, 'danger');
      else console.error('[playback]', msg);
    },
    [say]
  );

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setUploading(true);
      try {
        for (const f of Array.from(files)) {
          if (!/\.(h5|hdf5)$/i.test(f.name)) {
            handleError(`Skipping ${f.name}: not an .h5 file`);
            continue;
          }
          await uploadRecording(f);
        }
        await refresh();
      } catch (e) {
        handleError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploading(false);
      }
    },
    [refresh, handleError]
  );

  const triggerFilePicker = () => fileInputRef.current?.click();

  const loadDataset = async () => {
    const datasetPath = '/Users/zz4/Desktop/day5_breast_subject_1';
    try {
      const result = await registerRecordingsFromFolder(datasetPath);
      if (result.errors.length) {
        handleError(
          `${result.errors.length} of ${result.added.length + result.errors.length} files failed`
        );
      }
      await refresh();
    } catch (e) {
      handleError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      data-region="playback-mode"
      style={{
        height: '100%',
        display: 'flex',
        background: SHELL_BG,
        color: TEXT,
        font: FONT.ui,
        overflow: 'hidden',
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".h5,.hdf5"
        multiple
        onChange={(e) => handleUpload(e.target.files)}
        style={{ display: 'none' }}
      />

      <LibraryRail
        recordings={workspace?.library.recordings ?? []}
        darks={workspace?.library.darks ?? []}
        onOpenFile={triggerFilePicker}
        onError={handleError}
      />

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {loading && <div style={{ padding: SPACE.xl, color: TEXT_MUTED }}>Loading workspace…</div>}
        {error && (
          <div
            role="alert"
            style={{
              padding: SPACE.md,
              margin: SPACE.lg,
              background: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid #dc2626',
              borderRadius: 4,
              color: '#fca5a5',
              font: FONT.small,
            }}
          >
            {error}
          </div>
        )}
        {!loading && !error && (workspace?.tabs.length ?? 0) === 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: SPACE.md,
            }}
          >
            <div style={{ font: FONT.uiBold, fontSize: 20, color: TEXT_MUTED }}>
              Playback — Recording Inspection
            </div>
            <div
              style={{
                font: FONT.small,
                color: TEXT_FAINT,
                maxWidth: 480,
                textAlign: 'center',
                lineHeight: 1.6,
              }}
            >
              Load one or more <code style={{ font: FONT.mono }}>.h5</code> recordings from the
              library on the left, or drop a folder of files. The workspace builds streams + tabs in
              M4; the rendered viewer arrives in M5.
            </div>
            <div style={{ display: 'flex', gap: SPACE.sm }}>
              <button
                onClick={triggerFilePicker}
                disabled={uploading}
                style={{
                  background: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: `${SPACE.sm}px ${SPACE.lg}px`,
                  font: FONT.uiBold,
                  cursor: uploading ? 'wait' : 'pointer',
                }}
              >
                {uploading ? 'Uploading…' : 'Open recording…'}
              </button>
              <button
                onClick={loadDataset}
                style={{
                  background: 'transparent',
                  color: TEXT_MUTED,
                  border: '1px solid #1f2937',
                  borderRadius: 4,
                  padding: `${SPACE.sm}px ${SPACE.lg}px`,
                  font: FONT.ui,
                  cursor: 'pointer',
                }}
                title="Load every .h5 from /Users/zz4/Desktop/day5_breast_subject_1"
              >
                Load lab dataset
              </button>
            </div>
            <div
              style={{ font: FONT.monoSmall, color: TEXT_FAINT, marginTop: LAYOUT.modeRailW / 2 }}
            >
              playback-rebuild-v2 / M2
            </div>
          </div>
        )}
        {!loading && !error && (workspace?.tabs.length ?? 0) > 0 && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: TEXT_MUTED,
              font: FONT.ui,
            }}
          >
            {workspace!.tabs.length} tab(s) open. Workspace viewer wires in M4.
          </div>
        )}
      </main>
    </div>
  );
};
