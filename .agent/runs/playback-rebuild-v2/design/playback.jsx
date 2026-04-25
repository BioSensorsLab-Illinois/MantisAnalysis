// Playback mode — Recording Inspection
// MantisAnalysis · BioSensors Lab @ UIUC
//
// A 4th analysis mode: multi-view HDF5 recording playback with per-view
// corrections, overlays, RGB grading, and image/video export.
//
// This file is the mode entry. It orchestrates panels, modals, scenarios.
// Sub-files: playback_data.jsx, playback_panels.jsx, playback_modals.jsx

const { useState: useStatePb, useEffect: useEffectPb, useRef: useRefPb, useMemo: useMemoPb, useCallback: useCallbackPb } = React;

// ---------------------------------------------------------------------------
// Scenarios — each one pre-configures the mode into a specific screen / state.
// This gives the reviewer a tour of the 15 acceptance screens from the spec.
// ---------------------------------------------------------------------------

const SCENARIOS = [
  // --- core workspace states ---
  { id: 'main-single',     group: 'Core',      label: '01 · Main · single view' },
  { id: 'main-2x2',        group: 'Core',      label: '02 · Main · 2 × 2 comparison' },
  { id: 'main-side',       group: 'Core',      label: '03 · Main · side-by-side' },
  { id: 'main-stack',      group: 'Core',      label: '04 · Main · stacked' },
  { id: 'rgb-overlay',     group: 'Core',      label: '05 · RGB + NIR overlay' },
  // --- flows & modals ---
  { id: 'empty',           group: 'States',    label: '06 · Empty state' },
  { id: 'loading',         group: 'States',    label: '07 · Loading' },
  { id: 'decode-failed',   group: 'States',    label: '08 · Decode failed' },
  { id: 'stream-builder',  group: 'Modals',    label: '09 · Stream Builder' },
  { id: 'overlay-builder', group: 'Modals',    label: '10 · Overlay Builder' },
  { id: 'export-image',    group: 'Modals',    label: '11 · Export image' },
  { id: 'export-video',    group: 'Modals',    label: '12 · Export video (progress)' },
  { id: 'warnings',        group: 'Modals',    label: '13 · Warning center' },
  // --- responsive ---
  { id: 'narrow',          group: 'Responsive',label: '14 · Narrow layout (sidebars collapsed)' },
  { id: 'inspector-focus', group: 'Responsive',label: '15 · Inspector focus · single view' },
];

// Build the view set per scenario
const scenarioViews = (id) => {
  switch (id) {
    case 'empty':
    case 'loading':
      return [];
    case 'main-single':
    case 'inspector-focus':
      return [DEFAULT_VIEW(1, { name: 'HG-G · live', channel: 'HG-G', colormap: 'viridis', low: 120, high: 1200, darkOn: true, normalize: true })];
    case 'main-side':
      return [
        DEFAULT_VIEW(1, { name: 'HG-G · raw',    channel: 'HG-G', colormap: 'gray' }),
        DEFAULT_VIEW(2, { name: 'HG-G · tuned',  channel: 'HG-G', colormap: 'viridis', low: 120, high: 1400, darkOn: true, normalize: true }),
      ];
    case 'main-stack':
      return [
        DEFAULT_VIEW(1, { name: 'HG-NIR',         channel: 'HG-NIR', colormap: 'inferno', low: 200, high: 1800, darkOn: true }),
        DEFAULT_VIEW(2, { name: 'HG-NIR · locked', channel: 'HG-NIR', colormap: 'inferno', lockedFrame: 420, low: 200, high: 1800, darkOn: true }),
      ];
    case 'main-2x2':
      return [
        DEFAULT_VIEW(1, { name: 'HG-R',   channel: 'HG-R',   colormap: 'hot',     low: 80,  high: 1400, darkOn: true }),
        DEFAULT_VIEW(2, { name: 'HG-G',   channel: 'HG-G',   colormap: 'viridis', low: 100, high: 1600, darkOn: true }),
        DEFAULT_VIEW(3, { name: 'HG-B',   channel: 'HG-B',   colormap: 'cool',    low: 80,  high: 1200, darkOn: true }),
        DEFAULT_VIEW(4, { name: 'HG-NIR', channel: 'HG-NIR', colormap: 'inferno', low: 150, high: 1800, darkOn: true }),
      ];
    case 'rgb-overlay':
      return [
        DEFAULT_VIEW(1, { name: 'Composite RGB', type: 'rgb',
          channels: ['HG-R', 'HG-G', 'HG-B'], darkOn: true, normalize: true,
          rgbGains: { r: 1.05, g: 1.0, b: 0.92 }, gamma: 1.1, saturation: 1.15, whiteBalanceK: 5200,
          overlayEnabled: true,
          overlay: { channel: 'HG-NIR', low: 400, high: 1600, blendMode: 'screen', strength: 0.55, belowThr: 'hide', aboveThr: 'saturate', overlayColormap: 'inferno' },
        }),
        DEFAULT_VIEW(2, { name: 'HG-NIR · reference', channel: 'HG-NIR', colormap: 'inferno', low: 300, high: 1800, darkOn: true }),
      ];
    case 'decode-failed':
      return [DEFAULT_VIEW(1, { name: 'HG-G · frame failed', channel: 'HG-G', colormap: 'viridis' })];
    case 'narrow':
      return [
        DEFAULT_VIEW(1, { name: 'HG-G',   channel: 'HG-G',   colormap: 'viridis', darkOn: true }),
        DEFAULT_VIEW(2, { name: 'HG-NIR', channel: 'HG-NIR', colormap: 'inferno', darkOn: true }),
      ];
    default:
      return [
        DEFAULT_VIEW(1, { name: 'HG-G',   channel: 'HG-G',   colormap: 'viridis', darkOn: true, normalize: true }),
        DEFAULT_VIEW(2, { name: 'HG-NIR', channel: 'HG-NIR', colormap: 'inferno', darkOn: true }),
      ];
  }
};

const scenarioLayout = (id, viewCount) => {
  if (id === 'main-side') return 'side';
  if (id === 'main-stack') return 'stack';
  if (id === 'main-2x2') return '2x2';
  if (id === 'rgb-overlay') return 'side';
  if (id === 'narrow') return 'side';
  if (viewCount <= 1) return 'single';
  return 'single';
};

// ---------------------------------------------------------------------------
// Synthetic warnings pool for the Warning Center
// ---------------------------------------------------------------------------
const buildWarningLog = (stream, views, darks) => {
  const out = [];
  (stream?.allFiles || []).forEach(f => {
    (f.warnings || []).forEach(code => {
      const def = WARNINGS[code];
      if (def) {
        out.push({ code, severity: def.severity, text: def.text(f), fileId: f.id });
      }
    });
  });
  // Dark mismatch
  const baseExp = stream?.baseExposureMs;
  if (baseExp != null) {
    darks.forEach(d => {
      if (d.status === 'orphan') {
        out.push({ code: 'W-DARK-NONE', severity: 'warning', text: `Dark frame ${d.name} has no matching recording exposure (${d.exposureMs} ms).`, fileId: d.id });
      }
    });
  }
  // Stream exposure mismatch
  (stream?.allFiles || []).forEach(f => {
    if (baseExp != null && f.exposureMs !== baseExp) {
      out.push({ code: 'W-EXP-MISMATCH', severity: 'warning', text: `${f.name} exposure ${f.exposureMs} ms differs from stream base ${baseExp} ms.`, fileId: f.id });
    }
  });
  return out;
};

// ---------------------------------------------------------------------------
// Scenario picker — floating chip that opens a dropdown
// ---------------------------------------------------------------------------
const ScenarioPicker = ({ scenario, onChange }) => {
  const t = useTheme();
  const [open, setOpen] = useStatePb(false);
  const current = SCENARIOS.find(s => s.id === scenario) || SCENARIOS[0];
  const groups = useMemoPb(() => {
    const g = {};
    SCENARIOS.forEach(s => { (g[s.group] = g[s.group] || []).push(s); });
    return g;
  }, []);
  useEffectPb(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const h = setTimeout(() => document.addEventListener('click', close, { once: true }), 50);
    return () => { clearTimeout(h); document.removeEventListener('click', close); };
  }, [open]);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }} style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', background: t.panel, color: t.text,
        border: `1px solid ${t.border}`, borderRadius: 6,
        cursor: 'pointer', fontFamily: 'inherit', fontSize: 11.5,
      }}>
        <span style={{ color: t.textMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Screen</span>
        <span style={{ fontWeight: 600 }}>{current.label}</span>
        <Icon name="chevron" size={10} style={{ color: t.textFaint }} />
      </button>
      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6, minWidth: 320,
          background: t.panel, border: `1px solid ${t.border}`, borderRadius: 6,
          boxShadow: t.shadowLg, padding: 6, zIndex: 50, maxHeight: '70vh', overflow: 'auto',
        }}>
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div style={{ padding: '6px 10px 4px', fontSize: 9.5, color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{group}</div>
              {items.map(it => (
                <button key={it.id} onClick={() => { onChange(it.id); setOpen(false); }} style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 10px', background: it.id === scenario ? t.accentSoft : 'transparent',
                  color: it.id === scenario ? t.accent : t.text,
                  border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit',
                }}>{it.label}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main mode component
// ---------------------------------------------------------------------------
const PlaybackMode = ({ onRunAnalysis, onStatusChange, tweaksOn }) => {
  const t = useTheme();
  const { isNarrow } = useViewport();

  const [scenario, setScenario] = useStatePb('main-2x2');
  const [files, setFiles] = useStatePb(() => FAKE_FILES_DEFAULT());
  const [darks, setDarks] = useStatePb(() => FAKE_DARKS_DEFAULT());
  const [darkOn, setDarkOn] = useStatePb(true);
  const [autoMatch, setAutoMatch] = useStatePb(true);

  const [views, setViews] = useStatePb(() => scenarioViews('main-2x2'));
  const [layout, setLayout] = useStatePb(() => scenarioLayout('main-2x2', 4));
  const [selectedId, setSelectedId] = useStatePb(() => (views[0]?.id || null));

  const [frame, setFrame] = useStatePb(320);
  const [playing, setPlaying] = useStatePb(false);
  const [range, setRange] = useStatePb([120, 2400]);

  const [sourcesCollapsed, setSourcesCollapsed] = useStatePb(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useStatePb(false);

  const [modal, setModal] = useStatePb(null); // stream | overlay | export-image | export-video | warnings

  // Apply scenario: resets views + layout + narrow sidebar state
  useEffectPb(() => {
    const vs = scenarioViews(scenario);
    setViews(vs);
    setLayout(scenarioLayout(scenario, vs.length));
    setSelectedId(vs[0]?.id || null);
    // scenario-specific UI state
    if (scenario === 'stream-builder') setModal('stream');
    else if (scenario === 'overlay-builder') setModal('overlay');
    else if (scenario === 'export-image') setModal('export-image');
    else if (scenario === 'export-video') setModal('export-video');
    else if (scenario === 'warnings') setModal('warnings');
    else setModal(null);
    if (scenario === 'narrow') { setSourcesCollapsed(true); setInspectorCollapsed(true); }
    else { setSourcesCollapsed(false); setInspectorCollapsed(false); }
    onStatusChange?.(scenario);
  }, [scenario]);

  // Auto-collapse inspector at very narrow widths
  useEffectPb(() => {
    if (isNarrow && scenario !== 'narrow') setInspectorCollapsed(true);
  }, [isNarrow]);

  // Play-head ticker
  useEffectPb(() => {
    if (!playing) return;
    const id = setInterval(() => setFrame(f => {
      const next = f + 1;
      return next >= (stream?.totalFrames || 1) ? 0 : next;
    }), 1000 / 30);
    return () => clearInterval(id);
  }, [playing]);

  const stream = useMemoPb(() => {
    if (scenario === 'empty' || scenario === 'loading') return null;
    return buildStream(files);
  }, [files, scenario]);

  const warningsLog = useMemoPb(() => buildWarningLog(stream, views, darks), [stream, views, darks]);

  const updateView = useCallbackPb((id, patch) => {
    setViews(vs => vs.map(v => v.id === id ? { ...v, ...patch } : v));
  }, []);

  const addView = () => {
    const id = `v${views.length + 1}`;
    setViews(vs => [...vs, DEFAULT_VIEW(vs.length + 1, { name: `View ${vs.length + 1}` })]);
    setSelectedId(id);
  };

  const copyViewSettingsTo = (targetId) => {
    const src = views.find(v => v.id === selectedId);
    if (!src) return;
    updateView(targetId, {
      low: src.low, high: src.high, colormap: src.colormap, gain: src.gain,
      offset: src.offset, normalize: src.normalize, darkOn: src.darkOn,
    });
  };

  const selectedView = views.find(v => v.id === selectedId);
  const lockedFrames = views.filter(v => v.lockedFrame != null).map(v => v.lockedFrame);

  // Empty state
  if (scenario === 'empty') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <ModeHeader scenario={scenario} onChangeScenario={setScenario} showScenarioPicker={tweaksOn} />
        <PlaybackEmptyState onOpenFile={() => setScenario('main-single')} onOpenFolder={() => setScenario('main-2x2')} />
      </div>
    );
  }

  // Loading state
  if (scenario === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <ModeHeader scenario={scenario} onChangeScenario={setScenario} showScenarioPicker={tweaksOn} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <SourcesPanel stream={null} darks={[]} loading darkOn={false} setDarkOn={() => {}} autoMatch={false} setAutoMatch={() => {}}
            collapsed={false} onToggleCollapsed={() => {}} />
          <div style={{ flex: 1, background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14 }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${t.border}`, borderTopColor: t.accent, borderRadius: '50%', animation: 'spin 900ms linear infinite' }} />
            <div style={{ fontSize: 12, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace' }}>Indexing recording · inferring channels · building boundaries</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      </div>
    );
  }

  const hasViews = views.length > 0;
  const viewsState = scenario === 'decode-failed' ? 'failed' : 'ok';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, background: t.bg, overflow: 'hidden' }}>
      <ModeHeader scenario={scenario} onChangeScenario={setScenario} showScenarioPicker={tweaksOn} />

      {/* B region: stream header */}
      <StreamHeader
        stream={stream}
        warnings={warningsLog.length}
        onOpenBuilder={() => setModal('stream')}
        onOpenWarnings={() => setModal('warnings')}
        onExportImage={() => setModal('export-image')}
        onExportVideo={() => setModal('export-video')}
      />

      {/* Workspace: A · C · D */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <SourcesPanel
          stream={stream} darks={darks}
          onOpenFile={() => {}} onOpenDark={() => {}}
          onRemoveFile={(id) => setFiles(fs => fs.filter(f => f.id !== id))}
          onRemoveDark={(id) => setDarks(ds => ds.filter(d => d.id !== id))}
          darkOn={darkOn} setDarkOn={setDarkOn}
          autoMatch={autoMatch} setAutoMatch={setAutoMatch}
          collapsed={sourcesCollapsed}
          onToggleCollapsed={() => setSourcesCollapsed(c => !c)}
        />

        {/* C — viewer grid */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
          {hasViews ? (
            <ViewerGridWithState
              views={views} layout={layout}
              selectedId={selectedId} onSelect={setSelectedId}
              onAction={() => {}}
              frame={frame} stream={stream}
              state={viewsState}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <div style={{ textAlign: 'center', color: t.textFaint, fontSize: 12 }}>
                No views open.
                <div style={{ marginTop: 10 }}><Button variant="primary" icon="plus" onClick={addView}>Add view</Button></div>
              </div>
            </div>
          )}

          {/* E region */}
          <TimelineStrip
            stream={stream}
            frame={frame} setFrame={setFrame}
            playing={playing} setPlaying={setPlaying}
            range={range} setRange={setRange}
            lockedFrames={lockedFrames}
          />
        </div>

        <Inspector
          view={selectedView}
          onUpdate={updateView}
          darks={darks}
          views={views}
          onCopyTo={copyViewSettingsTo}
          onOpenOverlay={() => setModal('overlay')}
          collapsed={inspectorCollapsed}
          onToggleCollapsed={() => setInspectorCollapsed(c => !c)}
        />
      </div>

      {/* Modals */}
      {modal === 'stream' && <StreamBuilderModal stream={stream} onClose={() => setModal(null)} onChange={() => {}} />}
      {modal === 'overlay' && <OverlayBuilderModal view={selectedView} onClose={() => setModal(null)} onApply={(ov) => updateView(selectedId, { overlay: ov, overlayEnabled: true })} />}
      {modal === 'export-image' && <ExportImageModal views={views} stream={stream} frame={frame} onClose={() => setModal(null)} />}
      {modal === 'export-video' && <ExportVideoModal views={views} stream={stream} range={range} onClose={() => setModal(null)} />}
      {modal === 'warnings' && <WarningCenter warnings={warningsLog} onClose={() => setModal(null)} onFocusFile={() => {}} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ModeHeader — scenario picker + mode title (small local header)
// ---------------------------------------------------------------------------
const ModeHeader = ({ scenario, onChangeScenario, showScenarioPicker }) => {
  const t = useTheme();
  if (!showScenarioPicker) return null;
  return (
    <div style={{
      height: 30, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: `1px solid ${t.border}`, background: t.panelAlt, flexShrink: 0,
    }}>
      <div style={{ fontSize: 9, color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}>
        Demo scenarios
      </div>
      <div style={{ flex: 1 }} />
      <ScenarioPicker scenario={scenario} onChange={onChangeScenario} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// ViewerGridWithState — wraps ViewerGrid so we can hoist per-state behavior
// ---------------------------------------------------------------------------
const ViewerGridWithState = ({ views, layout, selectedId, onSelect, onAction, frame, stream, state }) => {
  const t = useTheme();
  const preset = LAYOUT_PRESETS.find(p => p.id === layout) || LAYOUT_PRESETS[0];
  const rows = preset.rows || 2;
  const cols = 2;
  const cells = preset.cells;
  const visibleViews = views.slice(0, cells.length);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 10 }}>
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: 8,
      }}>
        {visibleViews.map((v, i) => {
          const [c, r, cs, rs] = cells[i];
          return (
            <div key={v.id} style={{ gridColumn: `${c + 1} / span ${cs}`, gridRow: `${r + 1} / span ${rs}`, minHeight: 0, minWidth: 0 }}>
              <ViewerCardWithState
                view={v} frame={frame} selected={v.id === selectedId}
                onSelect={onSelect} onAction={onAction}
                state={state}
                stream={stream}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ViewerCardWithState = ({ view, frame, selected, onSelect, onAction, state, stream }) => {
  // Map fake states into ViewerCard
  const cardState = state === 'failed' ? 'failed' : 'ok';
  const streamFile = stream && frameToFile(stream, view.lockedFrame ?? frame)?.file;
  return (
    <ViewerCard
      view={view} frame={frame} selected={selected}
      onSelect={onSelect} onAction={onAction}
      syncToGlobal={view.syncToGlobal}
      streamFile={streamFile}
      overlayLegend
      state={cardState}
    />
  );
};

Object.assign(window, { PlaybackMode, SCENARIOS });
