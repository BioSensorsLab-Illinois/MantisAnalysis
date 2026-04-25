// Playback (Recording Inspection) — rebuild v2 entry.
// M4 wires LibraryRail + TabBar + ViewerGrid + Transport into the
// workspace shell. Render pipeline is the M5 single-channel viewer.

import React from 'react';

import { Inspector } from './components/Inspector';
import { LibraryRail } from './components/LibraryRail';
import { TabBar } from './components/TabBar';
import { ViewerGrid } from './components/ViewerGrid';
import { LayoutSwitch } from './components/LayoutSwitch';
import { Transport } from './components/Transport';
import { FONT, LAYOUT, PALETTE, RADIUS, SPACE } from './theme';
import { useWorkspace } from './workspace';
import { patchTab, registerRecordingsFromFolder, uploadRecording } from './api';

const { useRef, useState, useCallback } = React;

export const playbackEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('mantis/playback/enabled') !== '0';
};

export interface PlaybackModeProps {
  say?: (msg: string, kind?: string) => void;
  onOpenFile?: () => void;
}

export const PlaybackMode: React.FC<PlaybackModeProps> = ({ say }) => {
  const { workspace, loading, error, refresh } = useWorkspace();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

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

  const tabs = workspace?.tabs ?? [];
  const activeTabId = workspace?.active_tab_id ?? null;
  const activeTab = tabs.find((t) => t.tab_id === activeTabId) ?? tabs[0] ?? null;
  const activeStream = workspace?.streams.find((s) => s.stream_id === activeTab?.stream_id) ?? null;

  const switchTab = (tab_id: string) => {
    patchTab(tab_id, { selected_view_id: undefined } as never).catch(() => {});
    // Active tab state is server-side via workspace.active_tab_id. M4
    // server doesn't yet allow setting it via PATCH; the tab opened
    // last is the active one. Click-to-switch is local-only for now.
    setLocalActiveTabId(tab_id);
  };
  const [localActiveTabId, setLocalActiveTabId] = useState<string | null>(null);
  const visibleActiveTab = tabs.find((t) => t.tab_id === localActiveTabId) ?? activeTab;
  const visibleStream =
    workspace?.streams.find((s) => s.stream_id === visibleActiveTab?.stream_id) ?? activeStream;

  const handleSelectView = useCallback(
    (view_id: string) => {
      if (!visibleActiveTab) return;
      patchTab(visibleActiveTab.tab_id, { selected_view_id: view_id }).catch((e) =>
        handleError(e instanceof Error ? e.message : String(e))
      );
    },
    [visibleActiveTab, handleError]
  );

  return (
    <div
      data-region="playback-mode"
      style={{
        height: '100%',
        display: 'flex',
        background: PALETTE.shell,
        color: PALETTE.text,
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
        {loading && (
          <div style={{ padding: SPACE.xl, color: PALETTE.textMuted }}>Loading workspace…</div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              padding: SPACE.md,
              margin: SPACE.lg,
              background: PALETTE.dangerSoft,
              border: `1px solid ${PALETTE.danger}`,
              borderRadius: RADIUS.md,
              color: '#fca5a5',
              font: FONT.small,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && tabs.length === 0 && (
          <EmptyState
            uploading={uploading}
            onOpen={triggerFilePicker}
            onLoadDataset={loadDataset}
          />
        )}

        {tabs.length > 0 && (
          <>
            <TabBar
              tabs={tabs}
              streams={workspace?.streams ?? []}
              activeTabId={visibleActiveTab?.tab_id ?? null}
              onSelect={switchTab}
              onError={handleError}
            />
            {visibleActiveTab && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: SPACE.sm,
                    padding: `${SPACE.xs}px ${SPACE.sm}px`,
                    background: PALETTE.panel,
                    borderBottom: `1px solid ${PALETTE.border}`,
                    flexShrink: 0,
                  }}
                >
                  <LayoutSwitch tab={visibleActiveTab} onError={handleError} />
                  <span style={{ flex: 1 }} />
                  <span style={{ font: FONT.monoSmall, color: PALETTE.textFaint }}>
                    {visibleActiveTab.views.length} view
                    {visibleActiveTab.views.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    minHeight: 0,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      minWidth: 0,
                      minHeight: 0,
                    }}
                  >
                    <ViewerGrid tab={visibleActiveTab} onSelectView={handleSelectView} />
                    <Transport
                      tab={visibleActiveTab}
                      stream={visibleStream}
                      onError={handleError}
                    />
                  </div>
                  <Inspector
                    tab={visibleActiveTab}
                    view={
                      visibleActiveTab.views.find(
                        (v) => v.view_id === visibleActiveTab.selected_view_id
                      ) ??
                      visibleActiveTab.views[0] ??
                      null
                    }
                    onError={handleError}
                    collapsed={inspectorCollapsed}
                    onCollapse={() => setInspectorCollapsed((c) => !c)}
                  />
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
};

const EmptyState: React.FC<{
  uploading: boolean;
  onOpen: () => void;
  onLoadDataset: () => void;
}> = ({ uploading, onOpen, onLoadDataset }) => (
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
    <div style={{ font: FONT.uiBold, fontSize: 20, color: PALETTE.textMuted }}>
      Playback — Recording Inspection
    </div>
    <div
      style={{
        font: FONT.small,
        color: PALETTE.textFaint,
        maxWidth: 480,
        textAlign: 'center',
        lineHeight: 1.6,
      }}
    >
      Drop one or more <code style={{ font: FONT.mono }}>.h5</code> recordings into the library on
      the left, or click ▶ next to a file to open it as a tab.
    </div>
    <div style={{ display: 'flex', gap: SPACE.sm }}>
      <button
        onClick={onOpen}
        disabled={uploading}
        style={{
          background: PALETTE.accent,
          color: 'white',
          border: 'none',
          borderRadius: RADIUS.md,
          padding: `${SPACE.sm}px ${SPACE.lg}px`,
          font: FONT.uiBold,
          cursor: uploading ? 'wait' : 'pointer',
        }}
      >
        {uploading ? 'Uploading…' : 'Open recording…'}
      </button>
      <button
        onClick={onLoadDataset}
        style={{
          background: 'transparent',
          color: PALETTE.textMuted,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: RADIUS.md,
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
      style={{ font: FONT.monoSmall, color: PALETTE.textFaint, marginTop: LAYOUT.modeRailW / 2 }}
    >
      playback-rebuild-v2 / M4
    </div>
  </div>
);
