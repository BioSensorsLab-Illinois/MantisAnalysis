// ISP-mode settings window — isp-modes-v1.
// Floating Modal (not a side-panel) so it doesn't steal canvas real-estate.
// Opened from the TopBar gear, ⌘K palette ("ISP settings…"), or the `I`
// keyboard shortcut. Persists user-edited config via useLocalStorageState
// keyed on the source + mode so re-opening the same recording restores
// the exact overrides — on Apply we PUT /api/sources/{id}/isp and let the
// server return the authoritative SourceSummary which updates root state.
//
// bundler-migration-v1 Phase 5b (2026-04-24): ES-module native + TypeScript.
// Typed against the server contract in
// `mantisanalysis/server.py::SourceSummary` + `/api/isp/modes`.
//
// shared.tsx is under `@ts-nocheck` pending per-file typing. tsc still
// INFERS parameter shapes from its destructured components (e.g.
// `Button = ({ variant, icon, iconRight, size, children, ... }) => ...`
// produces a signature where every prop looks required). Named imports
// from shared.tsx therefore leak over-strict types into this file.
// Bridge: import the whole module as `any`, destructure what we need.
// Future sessions tighten the shared.tsx exports and drop this shim.
import React, { type CSSProperties, type ReactNode } from 'react';

import * as _shared from './shared.tsx';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _s = _shared as any;
const { Icon, Button, Modal, useTheme, useSource, apiFetch } = _s;

const {
  useState: useStateI,
  useEffect: useEffectI,
  useMemo: useMemoI,
  useCallback: useCallbackI,
} = React;

// ---------------------------------------------------------------------------
// Server-contract types
// ---------------------------------------------------------------------------
// Mirrors the payload shape served by GET /api/isp/modes and the nested
// `isp_config` on every SourceSummary. Kept narrow on purpose — only the
// fields this file reads are declared; adding more is cheap but
// propagating them through shared.jsx is the real Phase 5b-2 job.

type Pair = [number, number];

interface IspChannelSpec {
  slot_id: string;
  default_name: string;
  loc: Pair;
  renameable: boolean;
  color_hint: string;
}

interface IspMode {
  id: string;
  display_name: string;
  description: string;
  default_origin: Pair;
  default_sub_step: Pair;
  default_outer_stride: Pair;
  channels: IspChannelSpec[];
  supports_rgb_composite: boolean;
}

interface IspConfig {
  origin?: Pair;
  sub_step?: Pair;
  outer_stride?: Pair;
  channel_name_overrides?: Record<string, string>;
  channel_loc_overrides?: Record<string, Pair>;
}

// Narrow subset of SourceSummary we actually read here. The full shape
// lives in the Python server; `useSource()` returns untyped (any) today
// until shared.tsx lands.
interface SourceLite {
  source_id: string;
  isp_mode_id?: string;
  isp_config?: IspConfig;
  channels?: string[];
  shape?: number[];
}

// Say-toast signature, shared with the app's <Toast> plumbing. `kind` is
// free-form in app.jsx; we type it loosely rather than enumerating the
// already-used tones ('success', 'danger', 'warning', 'info').
type SayFn = (msg: string, kind?: string) => void;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Coerce-compare two Pair-ish values. Kept loose (unknown) so callers can
// pass server-shaped `origin`/`sub_step` entries that might be undefined
// before the first fetch completes.
const _pairEq = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((x, i) => Number(x) === Number(b[i]));

// Build an illustrative extraction-formula string for the preview label.
const _formulaPreview = (
  mode: IspMode | null,
  origin: Pair,
  subStep: Pair,
  outerStride: Pair
): string => {
  if (!mode || !mode.channels || mode.channels.length === 0) return '';
  const c = mode.channels[0];
  const r = c.loc[0] * subStep[0] + origin[0];
  const col = c.loc[1] * subStep[1] + origin[1];
  return `${c.default_name}: half[${r}::${outerStride[0]}, ${col}::${outerStride[1]}]`;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface ISPSettingsWindowProps {
  onClose: () => void;
  onApplied?: (updated: SourceLite) => void;
  say?: SayFn;
}

const ISPSettingsWindow = ({ onClose, onApplied, say }: ISPSettingsWindowProps) => {
  const t = useTheme();
  const source = useSource() as SourceLite | null;

  // Mode catalog — fetched once on open. Kept in local state so a stale
  // response doesn't keep an orphan list open forever.
  const [modes, setModes] = useStateI<IspMode[] | null>(null);
  const [loadErr, setLoadErr] = useStateI<string | null>(null);

  // Staged (unapplied) values. When the user switches mode, we seed
  // staging with that mode's defaults; on Revert we re-seed from the
  // current source's server state. Initial seeds use Pair-shaped
  // sentinels (`null`) so we don't bake in modern-mode hardcoded
  // values for legacy sources — the post-mount effect below replaces
  // them with the mode catalog's defaults for the active mode.
  const [stagedModeId, setStagedModeId] = useStateI<string>(source?.isp_mode_id || 'rgb_nir');
  const [stagedOrigin, setStagedOrigin] = useStateI<Pair>(source?.isp_config?.origin || [0, 0]);
  const [stagedSubStep, setStagedSubStep] = useStateI<Pair>(
    source?.isp_config?.sub_step || [1, 1]
  );
  const [stagedOuter, setStagedOuter] = useStateI<Pair>(
    source?.isp_config?.outer_stride || [1, 1]
  );
  const [stagedNames, setStagedNames] = useStateI<Record<string, string>>(
    source?.isp_config?.channel_name_overrides || {}
  );
  // Per-channel loc overrides — dict slot_id → [row, col]. Empty means
  // "inherit the mode's declared loc". The UI seeds each slot's inputs
  // from the override if present, else the mode catalog's default loc.
  const [stagedLocs, setStagedLocs] = useStateI<Record<string, Pair>>(
    source?.isp_config?.channel_loc_overrides || {}
  );
  // Note: the legacy global "Show RGB color composite on canvas" toggle was
  // removed — RGB is now an explicit "RGB" entry in each mode's Display
  // channel picker (USAF / FPN / DoF). Single channels always render mono
  // so the colormap applies; pick RGB for a color composite.

  const [applying, setApplying] = useStateI(false);
  const [lastError, setLastError] = useStateI<string | null>(null);

  useEffectI(() => {
    let alive = true;
    (async () => {
      try {
        const data = (await apiFetch('/api/isp/modes', { method: 'GET' })) as IspMode[];
        if (alive) setModes(data);
      } catch (err) {
        if (alive) setLoadErr((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const activeMode = useMemoI<IspMode | null>(() => {
    if (!modes) return null;
    return modes.find((m) => m.id === stagedModeId) || modes[0] || null;
  }, [modes, stagedModeId]);

  // Revert staging to whatever the server currently says, falling back
  // to the active mode's declared defaults (NOT a hardcoded modern
  // RGB-NIR pair) — that way a legacy gsbsi source whose isp_config
  // momentarily lacks fields still seeds its (1,1) sub_step + (2,2)
  // outer_stride correctly.
  const revert = useCallbackI(() => {
    if (!source) return;
    const targetModeId = source.isp_mode_id || 'rgb_nir';
    const m = (modes || []).find((x) => x.id === targetModeId);
    setStagedModeId(targetModeId);
    setStagedOrigin(
      (source.isp_config?.origin as Pair) || (m ? ([...m.default_origin] as Pair) : [0, 0])
    );
    setStagedSubStep(
      (source.isp_config?.sub_step as Pair) ||
        (m ? ([...m.default_sub_step] as Pair) : [1, 1])
    );
    setStagedOuter(
      (source.isp_config?.outer_stride as Pair) ||
        (m ? ([...m.default_outer_stride] as Pair) : [1, 1])
    );
    setStagedNames(source.isp_config?.channel_name_overrides || {});
    setStagedLocs(source.isp_config?.channel_loc_overrides || {});
    setLastError(null);
  }, [source, modes]);

  // Re-seed staging whenever the source identity OR the loaded mode
  // catalog changes. Without this, opening the dialog on a legacy
  // gsbsi recording right after the catalog loads leaves the dialog
  // showing stale hardcoded modern defaults until the user manually
  // hits "Revert". The condition guards against clobbering active
  // user edits on the SAME source.
  useEffectI(() => {
    if (!source || !modes) return;
    revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.source_id, source?.isp_mode_id, modes]);

  // Picking a new mode seeds staging with that mode's declared defaults.
  const pickMode = useCallbackI(
    (id: string) => {
      const m = (modes || []).find((x) => x.id === id);
      if (!m) return;
      setStagedModeId(id);
      setStagedOrigin([...m.default_origin] as Pair);
      setStagedSubStep([...m.default_sub_step] as Pair);
      setStagedOuter([...m.default_outer_stride] as Pair);
      // Drop renames that no longer apply under the new mode.
      const renameable = new Set(m.channels.filter((c) => c.renameable).map((c) => c.slot_id));
      setStagedNames((prev) => {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (renameable.has(k)) next[k] = v;
        }
        return next;
      });
      // Drop loc overrides that reference slots not present in the new mode.
      const known = new Set(m.channels.map((c) => c.slot_id));
      setStagedLocs((prev) => {
        const next: Record<string, Pair> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (known.has(k)) next[k] = v;
        }
        return next;
      });
      setLastError(null);
    },
    [modes]
  );

  const dirty = useMemoI<boolean>(() => {
    if (!source) return false;
    if (source.isp_mode_id !== stagedModeId) return true;
    if (!_pairEq(source.isp_config?.origin, stagedOrigin)) return true;
    if (!_pairEq(source.isp_config?.sub_step, stagedSubStep)) return true;
    if (!_pairEq(source.isp_config?.outer_stride, stagedOuter)) return true;
    const serverNames = source.isp_config?.channel_name_overrides || {};
    const nameKeys = new Set([...Object.keys(serverNames), ...Object.keys(stagedNames)]);
    for (const k of nameKeys) {
      if ((serverNames[k] || '') !== (stagedNames[k] || '')) return true;
    }
    const serverLocs = source.isp_config?.channel_loc_overrides || {};
    const locKeys = new Set([...Object.keys(serverLocs), ...Object.keys(stagedLocs)]);
    for (const k of locKeys) {
      if (!_pairEq(serverLocs[k], stagedLocs[k])) return true;
    }
    return false;
  }, [source, stagedModeId, stagedOrigin, stagedSubStep, stagedOuter, stagedNames, stagedLocs]);

  const apply = useCallbackI(async () => {
    if (!source) return;
    setApplying(true);
    setLastError(null);
    try {
      const updated = (await apiFetch(`/api/sources/${source.source_id}/isp`, {
        method: 'PUT',
        body: {
          mode_id: stagedModeId,
          origin: stagedOrigin,
          sub_step: stagedSubStep,
          outer_stride: stagedOuter,
          channel_name_overrides: stagedNames,
          channel_loc_overrides: stagedLocs,
        },
      })) as SourceLite;
      onApplied?.(updated);
      // Notify any mode that owns its own per-source state (Play, today)
      // so it can refresh the recording's metadata + purge the per-URL
      // blob cache. Without this, Play's `recordings[i].isp_config` stays
      // stale and the blob cache returns the pre-reconfigure image even
      // though the server is now serving fresh bytes.
      window.dispatchEvent(
        new CustomEvent('mantis:source-reconfigured', {
          detail: {
            source_id: source.source_id,
            isp_mode_id: updated?.isp_mode_id,
            isp_config: updated?.isp_config,
            channels: updated?.channels,
            shape: updated?.shape,
          },
        })
      );
      say?.(`Filter & Channel → ${activeMode?.display_name || stagedModeId}`, 'success');
      onClose?.();
    } catch (err) {
      const msg = (err as Error).message;
      setLastError(msg);
      say?.(`Filter & Channel reconfigure failed: ${msg}`, 'danger');
    } finally {
      setApplying(false);
    }
  }, [
    source,
    stagedModeId,
    stagedOrigin,
    stagedSubStep,
    stagedOuter,
    stagedNames,
    stagedLocs,
    activeMode,
    onApplied,
    onClose,
    say,
  ]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (loadErr) {
    return (
      <Modal onClose={onClose} width={560} label="Filter & Channel Specification">
        <HeaderRow onClose={onClose} />
        <div style={{ padding: '16px 4px', color: t.danger, fontSize: 12 }}>
          Failed to load Filter & Channel modes: {loadErr}
        </div>
      </Modal>
    );
  }
  if (!modes || !activeMode) {
    return (
      <Modal onClose={onClose} width={560} label="Filter & Channel Specification">
        <HeaderRow onClose={onClose} />
        <div style={{ padding: '16px 4px', color: t.textMuted, fontSize: 12 }}>
          Loading Filter & Channel modes…
        </div>
      </Modal>
    );
  }

  const inputStyle: CSSProperties = {
    background: t.inputBg,
    color: t.text,
    border: `1px solid ${t.chipBorder}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 12,
    width: 56,
    fontFamily: 'ui-monospace,Menlo,monospace',
    textAlign: 'right',
  };

  return (
    <Modal onClose={onClose} width={600} label="Filter & Channel Specification">
      <HeaderRow onClose={onClose} />

      {/* Mode dropdown + description */}
      <Section label="Mode">
        <select
          value={stagedModeId}
          onChange={(e) => pickMode(e.target.value)}
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            background: t.inputBg,
            color: t.text,
            border: `1px solid ${t.chipBorder}`,
            borderRadius: 5,
            fontSize: 12.5,
            padding: '5px 24px 5px 9px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            width: '100%',
          }}
        >
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5, marginTop: 8 }}>
          {activeMode.description}
        </div>
      </Section>

      {/* Super-pixel geometry */}
      <Section label="Super-pixel geometry">
        <GeomRow
          label="Origin"
          pair={stagedOrigin}
          setPair={setStagedOrigin}
          inputStyle={inputStyle}
          min={0}
        />
        <GeomRow
          label="Sub-step"
          pair={stagedSubStep}
          setPair={setStagedSubStep}
          inputStyle={inputStyle}
          min={1}
        />
        <GeomRow
          label="Outer stride"
          pair={stagedOuter}
          setPair={setStagedOuter}
          inputStyle={inputStyle}
          min={1}
        />
        <div
          style={{
            fontSize: 10.5,
            color: t.textFaint,
            marginTop: 8,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          preview: {_formulaPreview(activeMode, stagedOrigin, stagedSubStep, stagedOuter)}
        </div>
      </Section>

      {/* Channel list — per-slot editable loc (row / col) + rename input
          for renameable slots. Color swatch on the left; slot label +
          loc inputs + optional rename input + status chip on the right. */}
      <Section label="Channels">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 10,
            alignItems: 'center',
            fontSize: 10,
            color: t.textFaint,
            marginBottom: 4,
          }}
        >
          <span />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '40px auto auto auto auto 1fr auto',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <span style={{ paddingLeft: 2 }}>slot</span>
            <span>row</span>
            <span />
            <span>col</span>
            <span />
            <span>name</span>
            <span />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {activeMode.channels.map((c) => {
            const displayName = stagedNames[c.slot_id] ?? c.default_name;
            const effectiveLoc = stagedLocs[c.slot_id] ?? c.loc;
            const setLocCell = (i: 0 | 1, v: string) => {
              const n = Math.max(0, Math.floor(Number(v) || 0));
              setStagedLocs((prev) => {
                const next = { ...prev };
                const cur = [...(next[c.slot_id] ?? c.loc)] as Pair;
                cur[i] = n;
                // If the user reverted to the default, drop the override
                // so the payload stays clean.
                if (cur[0] === c.loc[0] && cur[1] === c.loc[1]) {
                  delete next[c.slot_id];
                } else {
                  next[c.slot_id] = cur;
                }
                return next;
              });
            };
            const overridden = stagedLocs[c.slot_id] != null;
            return (
              <div
                key={c.slot_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    border: `1px solid ${t.chipBorder}`,
                    background: c.color_hint,
                    display: 'inline-block',
                  }}
                />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '40px auto auto auto auto 1fr auto',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      color: t.text,
                      fontFamily: 'ui-monospace,Menlo,monospace',
                    }}
                  >
                    {c.default_name}
                  </span>
                  <span style={{ fontSize: 10, color: t.textFaint }}>r</span>
                  <input
                    type="number"
                    min={0}
                    value={effectiveLoc[0]}
                    onChange={(e) => setLocCell(0, e.target.value)}
                    style={{ ...inputStyle, width: 48 }}
                  />
                  <span style={{ fontSize: 10, color: t.textFaint }}>c</span>
                  <input
                    type="number"
                    min={0}
                    value={effectiveLoc[1]}
                    onChange={(e) => setLocCell(1, e.target.value)}
                    style={{ ...inputStyle, width: 48 }}
                  />
                  {c.renameable ? (
                    <input
                      value={displayName}
                      placeholder={c.default_name}
                      onChange={(e) =>
                        setStagedNames((prev) => ({
                          ...prev,
                          [c.slot_id]: e.target.value,
                        }))
                      }
                      style={{ ...inputStyle, textAlign: 'left' }}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        color: t.textFaint,
                        textAlign: 'right',
                        paddingRight: 6,
                      }}
                    >
                      —
                    </span>
                  )}
                  {overridden ? (
                    <span
                      title="loc override staged"
                      style={{
                        fontSize: 9.5,
                        color: t.accent,
                        letterSpacing: 0.4,
                        fontWeight: 600,
                      }}
                    >
                      LOC*
                    </span>
                  ) : c.renameable ? (
                    <span
                      style={{
                        fontSize: 9.5,
                        color: t.accent,
                        letterSpacing: 0.4,
                        fontWeight: 600,
                      }}
                    >
                      RENAME
                    </span>
                  ) : (
                    <span style={{ fontSize: 9.5, color: t.textFaint, letterSpacing: 0.4 }}>
                      default
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {lastError && (
        <div
          style={{
            marginTop: 10,
            color: t.danger,
            fontSize: 11.5,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          {lastError}
        </div>
      )}

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 18,
          paddingTop: 14,
          borderTop: `1px solid ${t.border}`,
        }}
      >
        <Button variant="subtle" onClick={revert} disabled={!dirty || applying}>
          Revert
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="subtle" onClick={onClose} disabled={applying}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={!dirty || applying}>
          {applying ? 'Applying…' : 'Apply'}
        </Button>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeaderRowProps {
  onClose: () => void;
}

const HeaderRow = ({ onClose }: HeaderRowProps) => {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <Icon name="isp" size={18} />
      <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
        Filter &amp; Channel Specification
      </div>
      <div style={{ flex: 1 }} />
      <Button variant="subtle" icon="close" onClick={onClose} />
    </div>
  );
};

interface SectionProps {
  label: ReactNode;
  children: ReactNode;
}

const Section = ({ label, children }: SectionProps) => {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 9.5,
          color: t.textFaint,
          textTransform: 'uppercase',
          letterSpacing: 0.7,
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
};

interface GeomRowProps {
  label: string;
  pair: Pair;
  setPair: React.Dispatch<React.SetStateAction<Pair>>;
  inputStyle: CSSProperties;
  min?: number;
}

const GeomRow = ({ label, pair, setPair, inputStyle, min = 0 }: GeomRowProps) => {
  // `min` defaults to 0 (valid for origin); pass min={1} for sub_step and
  // outer_stride rows so the UI rejects 0 client-side instead of letting
  // the user submit and then eat a server 422. See bugfix bug_003.
  const t = useTheme();
  const set = (i: 0 | 1, v: string) =>
    setPair((prev) => {
      const n = [...prev] as Pair;
      n[i] = Math.max(min, Math.floor(Number(v) || min));
      return n;
    });
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '100px auto auto auto auto',
        alignItems: 'center',
        gap: 10,
        marginBottom: 4,
      }}
    >
      <span style={{ fontSize: 12, color: t.text }}>{label}</span>
      <span style={{ fontSize: 10.5, color: t.textFaint }}>row</span>
      <input
        type="number"
        min={min}
        value={pair[0]}
        onChange={(e) => set(0, e.target.value)}
        style={inputStyle}
      />
      <span style={{ fontSize: 10.5, color: t.textFaint }}>col</span>
      <input
        type="number"
        min={min}
        value={pair[1]}
        onChange={(e) => set(1, e.target.value)}
        style={inputStyle}
      />
    </div>
  );
};

// Phase 3: ES-module exports.
export { ISPSettingsWindow };
export default ISPSettingsWindow;
