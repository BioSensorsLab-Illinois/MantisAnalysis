// @ts-nocheck
// playback/modals/SmallModals — extracted from web/src/playback.tsx
// in B-0037 Phase 4. Bundles the two short modals whose prop
// interfaces are simple: DeleteFromDiskConfirmModal and
// SavePresetModal. Larger modals (StreamBuilder, ExportImage,
// ExportVideo, OverlayBuilder, TbrAnalysis) remain backlog.

import React from 'react';
import * as _shared from '../../shared.tsx';

const _s = _shared;
const useTheme = _s.useTheme;
const Modal = _s.Modal;
const Icon = _s.Icon;
const Button = _s.Button;
const Row = _s.Row;

// Confirmation modal for the multi-select "Delete from disk" flow.
// The user has already ticked recordings in the Sources panel; this
// modal shows the file list one more time and forces an explicit
// confirm before the destructive action runs. Per AGENT_RULES,
// irreversible disk-level deletes always need explicit confirmation.
export const DeleteFromDiskConfirmModal = ({ open, recordings, onClose, onConfirm }) => {
  const t = useTheme();
  if (!open) return null;
  const haveDiskPaths = (recordings || []).filter((r) => !!r.path);
  const noDiskPaths = (recordings || []).filter((r) => !r.path);
  const totalToRemove = haveDiskPaths.length + noDiskPaths.length;
  const canConfirm = totalToRemove > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Delete ${totalToRemove} file${totalToRemove === 1 ? '' : 's'} from your computer?`}
      width={600}
      data-delete-from-disk-modal
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            fontSize: 12,
            color: t.danger,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Icon name="warning" size={14} />
          The actual file on your computer (e.g. ~/Desktop/...) will be permanently unlinked. Cannot
          be undone. Recordings whose original disk path can&rsquo;t be resolved will be reported as
          FAILED — your file will still be there.
        </div>
        {haveDiskPaths.length > 0 && (
          <div
            data-delete-paths-list
            style={{
              maxHeight: 220,
              overflowY: 'auto',
              padding: '6px 10px',
              border: `1px solid ${t.border}`,
              borderRadius: 4,
              background: t.chipBg,
              fontFamily: 'ui-monospace,Menlo,monospace',
              fontSize: 11,
              color: t.text,
              lineHeight: 1.55,
            }}
          >
            {haveDiskPaths.map((r) => (
              <div
                key={r.source_id}
                style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={r.path}
              >
                {r.path}
              </div>
            ))}
          </div>
        )}
        {noDiskPaths.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: t.textMuted,
              padding: '6px 10px',
              borderRadius: 4,
              background: t.chipBg,
              border: `1px solid ${t.border}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div>
              {noDiskPaths.length} uploaded recording
              {noDiskPaths.length === 1 ? '' : 's'} — the upload tempfile the server is holding for
              each will be deleted from disk:
            </div>
            <div
              data-delete-uploaded-list
              style={{
                fontFamily: 'ui-monospace,Menlo,monospace',
                fontSize: 11,
                color: t.text,
                lineHeight: 1.55,
                maxHeight: 120,
                overflowY: 'auto',
              }}
            >
              {noDiskPaths.map((r) => (
                <div
                  key={r.source_id}
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={`${r.name} (uploaded · src ${r.source_id})`}
                >
                  {r.name}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!canConfirm}
            onClick={onConfirm}
            data-delete-confirm-button
          >
            {`Delete ${totalToRemove} from my computer`}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

// M28 — Save Preset modal. Single text input for the name. Submits
// via PlaybackMode's `savePreset` callback.
export const SavePresetModal = ({ open, onClose, onSave, view }) => {
  const t = useTheme();
  const [name, setName] = React.useState('');
  React.useEffect(() => {
    if (open) setName('');
  }, [open]);
  if (!open) return null;
  const trimmed = name.trim();
  return (
    <Modal open={open} onClose={onClose} title="Save preset" data-save-preset-modal>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: t.textMuted }}>
          Capture the current view&apos;s display + ISP + grading + label settings as a named
          preset. The preset is bound to the source-mode{' '}
          <code style={{ fontFamily: 'ui-monospace,Menlo,monospace' }}>{view?.sourceMode}</code> and
          only appears under matching views.
        </div>
        <Row label="Name">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. high-contrast NIR"
            maxLength={80}
            data-save-preset-name
            onKeyDown={(e) => {
              if (e.key === 'Enter' && trimmed) {
                onSave(trimmed);
                onClose();
              }
            }}
            style={{
              flex: 1,
              padding: '5px 8px',
              fontSize: 12.5,
              fontFamily: 'inherit',
              background: t.inputBg,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: 4,
            }}
          />
        </Row>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!trimmed}
            onClick={() => {
              onSave(trimmed);
              onClose();
            }}
            data-save-preset-confirm
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
