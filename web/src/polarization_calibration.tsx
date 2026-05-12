import React from 'react';

import * as _shared from './shared.tsx';

// shared.tsx is still ts-nocheck, so keep this bridge narrow while the
// component itself documents the SourceSummary fields it reads.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { Icon, Button, useTheme, apiFetch } = _shared as any;

interface SourceLike {
  source_id?: string;
  isp_mode_id?: string;
  has_dark?: boolean;
  dark_name?: string | null;
  has_polarization_calibration?: boolean;
  polarization_calibration_name?: string | null;
  polarization_calibration_path?: string | null;
  polarization_calibration_profile_id?: string | null;
  polarization_calibration_enabled?: boolean;
  polarization_calibration_ready?: boolean;
}

type SayFn = (message: string, kind?: string) => void;

interface PolarizationCalibrationPanelProps {
  source: SourceLike | null | undefined;
  onSourceUpdated?: (source: SourceLike) => void;
  say?: SayFn;
}

const errorMessage = (err: unknown): string => {
  const maybe = err as { detail?: string; message?: string } | null;
  return maybe?.detail || maybe?.message || String(err);
};

export const PolarizationCalibrationPanel = ({
  source,
  onSourceUpdated,
  say,
}: PolarizationCalibrationPanelProps) => {
  const t = useTheme();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [lastError, setLastError] = React.useState<string | null>(null);

  const inPolarizationMode = !!source?.isp_mode_id?.startsWith('polarization');
  const hasPolcal = !!source?.has_polarization_calibration;
  const ready = !!source?.polarization_calibration_ready;
  const enabled = !!source?.polarization_calibration_enabled;

  const statusText = !source
    ? 'no source loaded'
    : hasPolcal
      ? `${source.polarization_calibration_name || 'loaded'}${
          source.polarization_calibration_profile_id
            ? ` - ${source.polarization_calibration_profile_id}`
            : ''
        }`
      : 'not attached';
  const gateText = !source
    ? 'load a source first'
    : !inPolarizationMode
      ? 'select a polarization mode'
      : !source.has_dark
        ? 'dark frame required'
        : !hasPolcal
          ? 'polcal required'
          : ready
            ? 'ready'
            : 'not ready';

  const publish = React.useCallback(
    (updated: SourceLike) => {
      onSourceUpdated?.(updated);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('mantis:source-reconfigured', {
            detail: { source_id: updated?.source_id || source?.source_id },
          })
        );
      }
    },
    [onSourceUpdated, source?.source_id]
  );

  const uploadPolcal = React.useCallback(
    async (file: File | null | undefined) => {
      if (!source?.source_id || !file) return;
      const fd = new FormData();
      fd.append('file', file);
      setBusy(true);
      setLastError(null);
      try {
        const updated = (await apiFetch(
          `/api/sources/${source.source_id}/polarization-cal/upload`,
          { method: 'POST', body: fd }
        )) as SourceLike;
        publish(updated);
        say?.(
          `Polarization calibration loaded: ${updated.polarization_calibration_name}`,
          'success'
        );
      } catch (err) {
        const msg = errorMessage(err);
        setLastError(msg);
        say?.(`Polarization calibration load failed: ${msg}`, 'danger');
      } finally {
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [source?.source_id, publish, say]
  );

  const loadPolcalPath = React.useCallback(async () => {
    if (!source?.source_id) return;
    const stored =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem('mantis/lastPolcalPath') || ''
        : '';
    const last =
      source.polarization_calibration_path || stored || source.polarization_calibration_name || '';
    const path = window.prompt('Absolute path to the polarization calibration file:', last);
    if (!path?.trim()) return;
    const trimmed = path.trim();
    setBusy(true);
    setLastError(null);
    try {
      const updated = (await apiFetch(
        `/api/sources/${source.source_id}/polarization-cal/load-path`,
        {
          method: 'POST',
          body: { path: trimmed, name: trimmed.split('/').pop() || 'polarization.polcal.h5' },
        }
      )) as SourceLike;
      try {
        localStorage.setItem('mantis/lastPolcalPath', trimmed);
      } catch {}
      publish(updated);
      say?.(`Polarization calibration loaded: ${updated.polarization_calibration_name}`, 'success');
    } catch (err) {
      const msg = errorMessage(err);
      setLastError(msg);
      say?.(`Polarization calibration load failed: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  }, [
    source?.source_id,
    source?.polarization_calibration_path,
    source?.polarization_calibration_name,
    publish,
    say,
  ]);

  const clearPolcal = React.useCallback(async () => {
    if (!source?.source_id || !source?.has_polarization_calibration) return;
    setBusy(true);
    setLastError(null);
    try {
      const updated = (await apiFetch(`/api/sources/${source.source_id}/polarization-cal`, {
        method: 'DELETE',
      })) as SourceLike;
      publish(updated);
      say?.('Polarization calibration cleared', 'success');
    } catch (err) {
      const msg = errorMessage(err);
      setLastError(msg);
      say?.(`Clear polarization calibration failed: ${msg}`, 'danger');
    } finally {
      setBusy(false);
    }
  }, [source?.source_id, source?.has_polarization_calibration, publish, say]);

  const setPolcalEnabled = React.useCallback(
    async (nextEnabled: boolean) => {
      if (!source?.source_id) return;
      setBusy(true);
      setLastError(null);
      try {
        const updated = (await apiFetch(
          `/api/sources/${source.source_id}/polarization-cal/settings`,
          { method: 'PUT', body: { enabled: nextEnabled } }
        )) as SourceLike;
        publish(updated);
        say?.(
          nextEnabled ? 'Polarization calibration enabled' : 'Polarization calibration disabled',
          'success'
        );
      } catch (err) {
        const msg = errorMessage(err);
        setLastError(msg);
        say?.(`Polarization calibration update failed: ${msg}`, 'danger');
      } finally {
        setBusy(false);
      }
    },
    [source?.source_id, publish, say]
  );

  return (
    <div
      style={{
        marginTop: 8,
        padding: '6px 8px',
        background: hasPolcal ? t.accentSoft : t.panelAlt,
        border: `1px solid ${hasPolcal ? t.accent + '33' : t.border}`,
        borderRadius: 4,
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".h5,.hdf5,.polcal"
        style={{ display: 'none' }}
        onChange={(e) => {
          uploadPolcal(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div
        style={{
          fontSize: 10,
          color: hasPolcal ? t.accent : t.textMuted,
          fontWeight: 600,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Icon name="sliders" size={11} />
        <span>Polcal</span>
        {enabled && (
          <span
            style={{
              marginLeft: 'auto',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: t.success,
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          color: hasPolcal ? t.text : t.textFaint,
          marginTop: 4,
          fontFamily: 'ui-monospace,Menlo,monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={statusText}
      >
        {statusText}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 6,
          marginTop: 6,
        }}
      >
        <Button
          variant="ghost"
          icon="upload"
          size="xs"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || !source?.source_id}
          title="Load a .polcal.h5 calibration map"
          fullWidth
        >
          {hasPolcal ? 'Replace' : 'Load'}
        </Button>
        <Button
          variant="ghost"
          icon="open"
          size="xs"
          onClick={loadPolcalPath}
          disabled={busy || !source?.source_id}
          title="Type / paste an absolute disk path"
          fullWidth
        >
          by path...
        </Button>
        <Button
          variant="danger"
          icon="trash"
          size="xs"
          disabled={busy || !hasPolcal}
          onClick={clearPolcal}
          title="Detach the polarization calibration map"
          fullWidth
        >
          Clear
        </Button>
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 7,
          fontSize: 11,
          color: ready ? t.text : t.textMuted,
          cursor: ready && !busy ? 'pointer' : 'not-allowed',
          minWidth: 0,
        }}
      >
        <input
          type="checkbox"
          checked={enabled}
          disabled={!ready || busy}
          onChange={(e) => setPolcalEnabled(e.target.checked)}
        />
        <span style={{ whiteSpace: 'nowrap' }}>Apply map</span>
        <span
          style={{
            color: ready ? t.success : t.textFaint,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={gateText}
        >
          {gateText}
        </span>
      </label>
      {lastError && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: t.danger, lineHeight: 1.35 }}>
          {lastError}
        </div>
      )}
    </div>
  );
};

export default PolarizationCalibrationPanel;
