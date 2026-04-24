// ISP-mode settings window — isp-modes-v1.
// Floating Modal (not a side-panel) so it doesn't steal canvas real-estate.
// Opened from the TopBar gear, ⌘K palette ("ISP settings…"), or the `I`
// keyboard shortcut. Persists user-edited config via useLocalStorageState
// keyed on the source + mode so re-opening the same recording restores
// the exact overrides — on Apply we PUT /api/sources/{id}/isp and let the
// server return the authoritative SourceSummary which updates root state.
const { useState: useStateI, useEffect: useEffectI, useMemo: useMemoI,
        useCallback: useCallbackI } = React;

const _pairEq = (a, b) => Array.isArray(a) && Array.isArray(b)
  && a.length === b.length
  && a.every((x, i) => Number(x) === Number(b[i]));

// Build an illustrative extraction-formula string for the preview label.
const _formulaPreview = (mode, origin, subStep, outerStride) => {
  if (!mode || !mode.channels || mode.channels.length === 0) return '';
  const c = mode.channels[0];
  const r = c.loc[0] * subStep[0] + origin[0];
  const col = c.loc[1] * subStep[1] + origin[1];
  return `${c.default_name}: half[${r}::${outerStride[0]}, ${col}::${outerStride[1]}]`;
};

const ISPSettingsWindow = ({ onClose, onApplied, say }) => {
  const t = useTheme();
  const source = useSource();

  // Mode catalog — fetched once on open. Kept in local state so a stale
  // response doesn't keep an orphan list open forever.
  const [modes, setModes] = useStateI(null);
  const [loadErr, setLoadErr] = useStateI(null);

  // Staged (unapplied) values. When the user switches mode, we seed
  // staging with that mode's defaults; on Revert we re-seed from the
  // current source's server state.
  const [stagedModeId, setStagedModeId] = useStateI(source?.isp_mode_id || 'rgb_nir');
  const [stagedOrigin, setStagedOrigin] = useStateI(source?.isp_config?.origin || [0, 0]);
  const [stagedSubStep, setStagedSubStep] = useStateI(source?.isp_config?.sub_step || [2, 2]);
  const [stagedOuter, setStagedOuter] = useStateI(source?.isp_config?.outer_stride || [4, 4]);
  const [stagedNames, setStagedNames] = useStateI(
    source?.isp_config?.channel_name_overrides || {}
  );
  // Per-channel loc overrides — dict slot_id → [row, col]. Empty means
  // "inherit the mode's declared loc". The UI seeds each slot's inputs
  // from the override if present, else the mode catalog's default loc.
  const [stagedLocs, setStagedLocs] = useStateI(
    source?.isp_config?.channel_loc_overrides || {}
  );
  const [rgbCompositeDisplay, setRgbCompositeDisplay] = useLocalStorageState(
    'ispSettings/rgbComposite', false);

  const [applying, setApplying] = useStateI(false);
  const [lastError, setLastError] = useStateI(null);

  useEffectI(() => {
    let alive = true;
    (async () => {
      try {
        const data = await apiFetch('/api/isp/modes', { method: 'GET' });
        if (alive) setModes(data);
      } catch (err) {
        if (alive) setLoadErr(err.message);
      }
    })();
    return () => { alive = false; };
  }, []);

  const activeMode = useMemoI(() => {
    if (!modes) return null;
    return modes.find((m) => m.id === stagedModeId) || modes[0] || null;
  }, [modes, stagedModeId]);

  // Revert staging to whatever the server currently says.
  const revert = useCallbackI(() => {
    if (!source) return;
    setStagedModeId(source.isp_mode_id || 'rgb_nir');
    setStagedOrigin(source.isp_config?.origin || [0, 0]);
    setStagedSubStep(source.isp_config?.sub_step || [2, 2]);
    setStagedOuter(source.isp_config?.outer_stride || [4, 4]);
    setStagedNames(source.isp_config?.channel_name_overrides || {});
    setStagedLocs(source.isp_config?.channel_loc_overrides || {});
    setLastError(null);
  }, [source]);

  // Picking a new mode seeds staging with that mode's declared defaults.
  const pickMode = useCallbackI((id) => {
    const m = (modes || []).find((x) => x.id === id);
    if (!m) return;
    setStagedModeId(id);
    setStagedOrigin([...m.default_origin]);
    setStagedSubStep([...m.default_sub_step]);
    setStagedOuter([...m.default_outer_stride]);
    // Drop renames that no longer apply under the new mode.
    const renameable = new Set(m.channels.filter((c) => c.renameable).map((c) => c.slot_id));
    setStagedNames((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (renameable.has(k)) next[k] = v;
      }
      return next;
    });
    // Drop loc overrides that reference slots not present in the new mode.
    const known = new Set(m.channels.map((c) => c.slot_id));
    setStagedLocs((prev) => {
      const next = {};
      for (const [k, v] of Object.entries(prev)) {
        if (known.has(k)) next[k] = v;
      }
      return next;
    });
    setLastError(null);
  }, [modes]);

  const dirty = useMemoI(() => {
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
      const updated = await apiFetch(
        `/api/sources/${source.source_id}/isp`,
        {
          method: 'PUT',
          body: {
            mode_id: stagedModeId,
            origin: stagedOrigin,
            sub_step: stagedSubStep,
            outer_stride: stagedOuter,
            channel_name_overrides: stagedNames,
            channel_loc_overrides: stagedLocs,
          },
        }
      );
      onApplied?.(updated);
      say?.(`ISP mode → ${activeMode?.display_name || stagedModeId}`, 'success');
      onClose?.();
    } catch (err) {
      setLastError(err.message);
      say?.(`ISP reconfigure failed: ${err.message}`, 'danger');
    } finally {
      setApplying(false);
    }
  }, [source, stagedModeId, stagedOrigin, stagedSubStep, stagedOuter, stagedNames,
      stagedLocs, activeMode, onApplied, onClose, say]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  if (loadErr) {
    return (
      <Modal onClose={onClose} width={560} label="ISP settings">
        <HeaderRow onClose={onClose} />
        <div style={{ padding: '16px 4px', color: t.danger, fontSize: 12 }}>
          Failed to load ISP modes: {loadErr}
        </div>
      </Modal>
    );
  }
  if (!modes || !activeMode) {
    return (
      <Modal onClose={onClose} width={560} label="ISP settings">
        <HeaderRow onClose={onClose} />
        <div style={{ padding: '16px 4px', color: t.textMuted, fontSize: 12 }}>Loading ISP modes…</div>
      </Modal>
    );
  }

  const inputStyle = {
    background: t.inputBg, color: t.text, border: `1px solid ${t.chipBorder}`,
    borderRadius: 4, padding: '3px 6px', fontSize: 12, width: 56,
    fontFamily: 'ui-monospace,Menlo,monospace', textAlign: 'right',
  };

  const renameableSlots = activeMode.channels.filter((c) => c.renameable);

  return (
    <Modal onClose={onClose} width={600} label="ISP settings">
      <HeaderRow onClose={onClose} />

      {/* Mode dropdown + description */}
      <Section label="Mode">
        <select value={stagedModeId} onChange={(e) => pickMode(e.target.value)}
          style={{
            appearance: 'none', WebkitAppearance: 'none',
            background: t.inputBg, color: t.text,
            border: `1px solid ${t.chipBorder}`, borderRadius: 5,
            fontSize: 12.5, padding: '5px 24px 5px 9px', cursor: 'pointer',
            fontFamily: 'inherit', width: '100%',
          }}>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5,
                      marginTop: 8 }}>{activeMode.description}</div>
      </Section>

      {/* Super-pixel geometry */}
      <Section label="Super-pixel geometry">
        <GeomRow label="Origin"       pair={stagedOrigin} setPair={setStagedOrigin} inputStyle={inputStyle} />
        <GeomRow label="Sub-step"     pair={stagedSubStep} setPair={setStagedSubStep} inputStyle={inputStyle} />
        <GeomRow label="Outer stride" pair={stagedOuter}  setPair={setStagedOuter}  inputStyle={inputStyle} />
        <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 8,
                      fontFamily: 'ui-monospace,Menlo,monospace' }}>
          preview: {_formulaPreview(activeMode, stagedOrigin, stagedSubStep, stagedOuter)}
        </div>
      </Section>

      {/* Channel list — per-slot editable loc (row / col) + rename input
          for renameable slots. Color swatch on the left; slot label +
          loc inputs + optional rename input + status chip on the right. */}
      <Section label="Channels">
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10,
                      alignItems: 'center', fontSize: 10, color: t.textFaint,
                      marginBottom: 4 }}>
          <span />
          <div style={{ display: 'grid',
                        gridTemplateColumns: '40px auto auto auto auto 1fr auto',
                        gap: 6, alignItems: 'center' }}>
            <span style={{ paddingLeft: 2 }}>slot</span>
            <span>row</span><span /><span>col</span><span /><span>name</span><span />
          </div>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {activeMode.channels.map((c) => {
            const displayName = stagedNames[c.slot_id] ?? c.default_name;
            const effectiveLoc = stagedLocs[c.slot_id] ?? c.loc;
            const setLocCell = (i, v) => {
              const n = Math.max(0, Math.floor(Number(v) || 0));
              setStagedLocs((prev) => {
                const next = { ...prev };
                const cur = [...(next[c.slot_id] ?? c.loc)];
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
              <div key={c.slot_id} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr',
                alignItems: 'center', gap: 10,
              }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, border: `1px solid ${t.chipBorder}`,
                  background: c.color_hint, display: 'inline-block',
                }} />
                <div style={{ display: 'grid',
                              gridTemplateColumns: '40px auto auto auto auto 1fr auto',
                              gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: t.text,
                                 fontFamily: 'ui-monospace,Menlo,monospace' }}>
                    {c.default_name}
                  </span>
                  <span style={{ fontSize: 10, color: t.textFaint }}>r</span>
                  <input type="number" min={0} value={effectiveLoc[0]}
                         onChange={(e) => setLocCell(0, e.target.value)}
                         style={{ ...inputStyle, width: 48 }} />
                  <span style={{ fontSize: 10, color: t.textFaint }}>c</span>
                  <input type="number" min={0} value={effectiveLoc[1]}
                         onChange={(e) => setLocCell(1, e.target.value)}
                         style={{ ...inputStyle, width: 48 }} />
                  {c.renameable ? (
                    <input value={displayName}
                      placeholder={c.default_name}
                      onChange={(e) => setStagedNames((prev) => ({
                        ...prev, [c.slot_id]: e.target.value,
                      }))}
                      style={{ ...inputStyle, textAlign: 'left' }} />
                  ) : (
                    <span style={{ fontSize: 11, color: t.textFaint, textAlign: 'right', paddingRight: 6 }}>—</span>
                  )}
                  {overridden
                    ? <span title="loc override staged"
                            style={{ fontSize: 9.5, color: t.accent, letterSpacing: 0.4, fontWeight: 600 }}>LOC*</span>
                    : (c.renameable
                        ? <span style={{ fontSize: 9.5, color: t.accent, letterSpacing: 0.4, fontWeight: 600 }}>RENAME</span>
                        : <span style={{ fontSize: 9.5, color: t.textFaint, letterSpacing: 0.4 }}>default</span>)}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* RGB composite toggle — only for modes that expose R/G/B slots */}
      {activeMode.supports_rgb_composite && (
        <Section label="Display">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input type="checkbox" checked={!!rgbCompositeDisplay}
              onChange={(e) => setRgbCompositeDisplay(e.target.checked)} />
            <span style={{ color: t.text }}>Show RGB color composite on canvas</span>
            <span style={{ color: t.textFaint, fontSize: 10.5 }}>
              (picks / ROIs / probes still compute on per-channel data)
            </span>
          </label>
        </Section>
      )}

      {lastError && (
        <div style={{ marginTop: 10, color: t.danger, fontSize: 11.5,
                      fontFamily: 'ui-monospace,Menlo,monospace' }}>
          {lastError}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 18, paddingTop: 14,
                    borderTop: `1px solid ${t.border}` }}>
        <Button variant="subtle" onClick={revert} disabled={!dirty || applying}>Revert</Button>
        <div style={{ flex: 1 }} />
        <Button variant="subtle" onClick={onClose} disabled={applying}>Cancel</Button>
        <Button onClick={apply} disabled={!dirty || applying}>
          {applying ? 'Applying…' : 'Apply'}
        </Button>
      </div>
    </Modal>
  );
};

const HeaderRow = ({ onClose }) => {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <Icon name="isp" size={18} />
      <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>ISP settings</div>
      <div style={{ flex: 1 }} />
      <Button variant="subtle" icon="close" onClick={onClose} />
    </div>
  );
};

const Section = ({ label, children }) => {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9.5, color: t.textFaint, textTransform: 'uppercase',
                    letterSpacing: 0.7, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
};

const GeomRow = ({ label, pair, setPair, inputStyle }) => {
  const t = useTheme();
  const set = (i, v) => setPair((prev) => {
    const n = [...prev];
    n[i] = Math.max(0, Math.floor(Number(v) || 0));
    return n;
  });
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '100px auto auto auto auto', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <span style={{ fontSize: 12, color: t.text }}>{label}</span>
      <span style={{ fontSize: 10.5, color: t.textFaint }}>row</span>
      <input type="number" min={0} value={pair[0]} onChange={(e) => set(0, e.target.value)} style={inputStyle} />
      <span style={{ fontSize: 10.5, color: t.textFaint }}>col</span>
      <input type="number" min={0} value={pair[1]} onChange={(e) => set(1, e.target.value)} style={inputStyle} />
    </div>
  );
};

// Expose to window for clean cross-file reference (no ES modules in the
// browser-Babel setup).
window.ISPSettingsWindow = ISPSettingsWindow;
