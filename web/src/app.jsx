// MantisAnalysis — main app shell (server-backed).
// BioSensors Lab @ UIUC · Zhongmin Zhu <j@polarxphotonics.com>
const { useState: useStateApp, useEffect: useEffectApp, useCallback: useCallbackApp,
        useMemo: useMemoApp, useRef: useRefApp } = React;

const ACCENTS = {
  blue:   { light: '#1560d9', dark: '#4a9eff', soft: { light: '#e4efff', dark: '#1a2c47' }, hover: { light: '#0c4db0', dark: '#3b8ae8' } },
  violet: { light: '#7c3aed', dark: '#a78bfa', soft: { light: '#f1eafc', dark: '#2a1f47' }, hover: { light: '#6027c2', dark: '#916ef7' } },
  teal:   { light: '#0891b2', dark: '#2dd4bf', soft: { light: '#e0f4f9', dark: '#15323a' }, hover: { light: '#066b84', dark: '#14b8a6' } },
  amber:  { light: '#c2410c', dark: '#fb923c', soft: { light: '#fdefe4', dark: '#3c1f0f' }, hover: { light: '#9a330a', dark: '#ea7b28' } },
};
const applyAccent = (base, accent, mode) => {
  const a = ACCENTS[accent]; if (!a) return base;
  return { ...base, accent: a[mode], accentHover: a.hover[mode], accentSoft: a.soft[mode] };
};

// File-picker "type" filters. The `accept` string is what ends up on the
// <input type="file"> element. Empty string = show all files (native OS dialog
// won't filter at all). The labels mirror what a user would expect from
// "Save As" dialogs in most desktop apps. Also assigned to window so other
// bundles (usaf.jsx, fpn.jsx, dof.jsx) can render parallel filter dropdowns
// for their own auxiliary file inputs (dark frame, etc.) without copy-paste.
const FILE_FILTERS = {
  all:    { label: 'All files (*.*)',              accept: '' },
  h5:     { label: 'H5 / HDF5 (*.h5, *.hdf5)',     accept: '.h5,.hdf5' },
  images: { label: 'All images (PNG/TIFF/JPEG)',   accept: 'image/png,image/tiff,image/jpeg,.png,.tif,.tiff,.jpg,.jpeg,.bmp' },
  png:    { label: 'PNG only (*.png)',              accept: '.png,image/png' },
  tiff:   { label: 'TIFF only (*.tif, *.tiff)',    accept: '.tif,.tiff,image/tiff' },
  jpeg:   { label: 'JPEG only (*.jpg, *.jpeg)',    accept: '.jpg,.jpeg,image/jpeg' },
};
window.FILE_FILTERS = FILE_FILTERS;

const App = () => {
  const [themeName, setThemeName] = useLocalStorageState('theme', 'light');
  const [accent, setAccent] = useLocalStorageState('accent', 'blue');
  const [mode, setMode] = useLocalStorageState('mode', 'usaf');
  const [analysis, setAnalysis] = useStateApp(null);
  const [status, setStatus] = useStateApp({ msg: 'Ready', count: 0 });
  const [showHelp, setShowHelp] = useStateApp(false);
  const [showAbout, setShowAbout] = useStateApp(false);
  const [showPalette, setShowPalette] = useStateApp(false);
  const [showISP, setShowISP] = useStateApp(false);
  const [toast, setToast] = useStateApp(null);

  const [source, setSource] = useStateApp(null);
  const [serverOk, setServerOk] = useStateApp(null);
  const [fileFilter, setFileFilter] = useLocalStorageState('fileFilter', 'all');
  const fileInputRef = useRefApp(null);

  const t = useMemoApp(() => applyAccent(THEMES[themeName], accent, themeName), [themeName, accent]);
  const say = useCallbackApp((msg, kind = 'info') => setToast({ id: Date.now(), msg, kind }), []);

  useEffectApp(() => {
    let alive = true;
    (async () => {
      try {
        await apiFetch('/api/health', { method: 'GET' });
        if (!alive) return;
        setServerOk(true);
        const list = await apiFetch('/api/sources', { method: 'GET' });
        if (list && list.length) {
          if (alive) setSource(list[0]);
        } else {
          const s = await apiFetch('/api/sources/load-sample', { method: 'POST' });
          if (alive) { setSource(s); say('Loaded synthetic sample'); }
        }
      } catch (err) {
        if (alive) { setServerOk(false); say(`Server offline: ${err.message}`, 'danger'); }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffectApp(() => {
    document.body.style.background = t.bg; document.body.style.color = t.text;
    document.documentElement.style.setProperty('--thumb', t.accent);
  }, [t]);

  // R-0009: listen for 410 Gone from apiFetch; drop cached source id
  // and auto-restore via load-sample. The event is dispatched by
  // shared.jsx::apiFetch when the server returns 410 for an evicted id.
  useEffectApp(() => {
    const onEvicted = async (ev) => {
      const sid = ev.detail?.source_id;
      if (sid && source && sid !== source.source_id) return; // not ours
      say('Source evicted from server cache — reloading sample…', 'warning');
      try {
        const s = await apiFetch('/api/sources/load-sample', { method: 'POST' });
        setSource(s);
        setAnalysis(null);                      // the stale modal cache goes too
      } catch (err) {
        say(`Recovery failed: ${err.message}`, 'danger');
      }
    };
    window.addEventListener('mantis:source-evicted', onEvicted);
    return () => window.removeEventListener('mantis:source-evicted', onEvicted);
  }, [source, say]);

  // R-0010: invalidate the cached analysis run whenever the source's
  // ISP mode or config changes — the channel set + extraction geometry
  // has shifted under the modal's feet, so its numbers are no longer
  // trustworthy. The user re-opens Analyze to get a fresh run.
  const ispEpoch = source
    ? `${source.isp_mode_id}::${JSON.stringify(source.isp_config || {})}`
    : null;
  useEffectApp(() => {
    if (analysis && analysis.source && ispEpoch && source
        && analysis.source.source_id === source.source_id) {
      const cachedEpoch = `${analysis.source.isp_mode_id}::${JSON.stringify(analysis.source.isp_config || {})}`;
      if (cachedEpoch !== ispEpoch) {
        setAnalysis(null);
        say('ISP reconfigured — analysis cache cleared; re-run Analyze for fresh results.', 'warning');
      }
    }
  }, [ispEpoch]);   // intentional single-dep: react to ISP change only

  useEffectApp(() => {
    const h = (e) => {
      const tgt = e.target;
      const typing = tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowPalette(p => !p); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); fileInputRef.current?.click(); return; }
      if (typing) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); setShowHelp(h => !h); }
      else if (e.key === '1') setMode('usaf');
      else if (e.key === '2') setMode('fpn');
      else if (e.key === '3') setMode('dof');
      // ISP settings window — uppercase `I` (shift+i) avoids clashing with
      // common text-insert patterns elsewhere in the app.
      else if (e.key === 'I') { e.preventDefault(); setShowISP(v => !v); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [setMode]);

  const onFileChosen = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      say(`Uploading ${f.name}…`);
      const s = await apiUpload('/api/sources/upload', f);
      setSource(s);
      say(`Loaded ${s.name} · ${s.channels.length} channels · ${s.shape[1]}×${s.shape[0]}`, 'success');
    } catch (err) { say(`Upload failed: ${err.message}`, 'danger'); }
  };

  const loadSample = async () => {
    try { const s = await apiFetch('/api/sources/load-sample', { method: 'POST' }); setSource(s); say('Loaded synthetic sample'); }
    catch (err) { say(`Sample failed: ${err.message}`, 'danger'); }
  };

  const actions = useMemoApp(() => ([
    { id: 'mode.usaf', label: 'Switch to USAF mode', kbd: '1', icon: 'usaf', run: () => setMode('usaf') },
    { id: 'mode.fpn',  label: 'Switch to FPN mode',  kbd: '2', icon: 'fpn', run: () => setMode('fpn') },
    { id: 'mode.dof',  label: 'Switch to DoF mode',  kbd: '3', icon: 'dof', run: () => setMode('dof') },
    { id: 'isp.settings', label: 'ISP settings…', kbd: 'I', icon: 'isp', run: () => setShowISP(true) },
    { id: 'theme.light', label: 'Theme · Light', icon: 'sun', run: () => setThemeName('light') },
    { id: 'theme.dark',  label: 'Theme · Dark',  icon: 'moon', run: () => setThemeName('dark') },
    ...Object.keys(ACCENTS).map(a => ({ id: `accent.${a}`, label: `Accent · ${a[0].toUpperCase() + a.slice(1)}`, icon: 'palette', run: () => setAccent(a) })),
    { id: 'file.open',   label: 'Open image / H5 file…', kbd: '⌘O', icon: 'open', run: () => fileInputRef.current?.click() },
    { id: 'file.sample', label: 'Load synthetic sample', icon: 'image', run: loadSample },
    { id: 'help.shortcuts', label: 'Keyboard shortcuts', kbd: '?', icon: 'keyboard', run: () => setShowHelp(true) },
    { id: 'help.about',     label: 'About MantisAnalysis', icon: 'info', run: () => setShowAbout(true) },
  ]), [setMode, setThemeName, setAccent]);

  const onStatusChange = useCallbackApp((m, n) => setStatus({ msg: m, count: n }), []);

  return (
    <ThemeCtx.Provider value={t}>
      <SourceCtx.Provider value={source}>
       <FileFilterCtx.Provider value={{ filters: FILE_FILTERS, current: fileFilter, set: setFileFilter }}>
        <div data-screen-label={`${mode.toUpperCase()} mode`} style={{
          height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
          background: t.bg, color: t.text, overflow: 'hidden',
          fontFamily: '"Inter Tight", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          fontSize: 13,
        }}>
          <input ref={fileInputRef} type="file" accept={FILE_FILTERS[fileFilter]?.accept || ''}
                 style={{ display: 'none' }} onChange={onFileChosen} />
          <TopBar
            mode={mode} themeName={themeName} setThemeName={setThemeName}
            source={source} serverOk={serverOk}
            onHelp={() => setShowHelp(true)} onAbout={() => setShowAbout(true)}
            onPalette={() => setShowPalette(true)}
            onISP={() => setShowISP(true)}
            onOpen={() => fileInputRef.current?.click()} onSample={loadSample}
            fileFilter={fileFilter} setFileFilter={setFileFilter}
          />
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <ModeRail mode={mode} setMode={setMode} />
            <div style={{ flex: 1, minWidth: 0 }}>
              {serverOk === false && <ServerDown />}
              {serverOk !== false && !source && <SourceLoading />}
              {source && mode === 'usaf' && <USAFMode key={source.source_id} onRunAnalysis={setAnalysis} onStatusChange={onStatusChange} say={say} onSwitchSource={setSource} onOpenFile={() => fileInputRef.current?.click()} />}
              {source && mode === 'fpn'  && <FPNMode  key={source.source_id} onRunAnalysis={setAnalysis} onStatusChange={onStatusChange} say={say} onSwitchSource={setSource} onOpenFile={() => fileInputRef.current?.click()} />}
              {source && mode === 'dof'  && <DoFMode  key={source.source_id} onRunAnalysis={setAnalysis} onStatusChange={onStatusChange} say={say} onSwitchSource={setSource} onOpenFile={() => fileInputRef.current?.click()} />}
            </div>
          </div>
          <StatusBar mode={mode} status={status} source={source} onAbout={() => setShowAbout(true)} onPalette={() => setShowPalette(true)} />
          {analysis && <AnalysisModal run={analysis} onClose={() => setAnalysis(null)} onToast={say} />}
          {showHelp && <HelpOverlay mode={mode} onClose={() => setShowHelp(false)} />}
          {showAbout && <AboutOverlay onClose={() => setShowAbout(false)} />}
          {showPalette && <CommandPalette actions={actions} onClose={() => setShowPalette(false)} />}
          {showISP && (
            <ISPSettingsWindow
              onClose={() => setShowISP(false)}
              onApplied={(updated) => setSource(updated)}
              say={say}
            />
          )}
          {toast && <Toast key={toast.id} msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
        </div>
       </FileFilterCtx.Provider>
      </SourceCtx.Provider>
    </ThemeCtx.Provider>
  );
};

const ServerDown = () => {
  const t = useTheme();
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: t.danger, marginBottom: 8 }}>MantisAnalysis server unavailable</div>
        <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55, fontFamily: 'ui-monospace,Menlo,monospace' }}>
          Expected API at <b>{API_BASE}</b>. Start it with:
          <div style={{ background: t.chipBg, border: `1px solid ${t.border}`, borderRadius: 6, padding: '8px 10px', margin: '10px 0', fontSize: 12 }}>python -m mantisanalysis</div>
          Then reload. If you opened the HTML directly without a server, MantisAnalysis auto-launches one when you run the command above.
        </div>
      </div>
    </div>
  );
};
const SourceLoading = () => {
  const t = useTheme();
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: 12 }}>Loading source…</div>;
};

const ModeRail = ({ mode, setMode }) => {
  const t = useTheme();
  const modes = [
    { id: 'usaf', label: 'USAF', title: 'USAF Resolution (1)', icon: 'usaf' },
    { id: 'fpn',  label: 'FPN',  title: 'FPN Analysis (2)',    icon: 'fpn' },
    { id: 'dof',  label: 'DoF',  title: 'Depth of Field (3)',  icon: 'dof' },
  ];
  return (
    <div style={{ width: 56, background: t.panel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 4 }}>
      {modes.map(m => {
        const active = mode === m.id;
        return (
          <button key={m.id} onClick={() => setMode(m.id)} title={m.title}
            style={{
              width: 42, height: 42, border: 'none', cursor: 'pointer', borderRadius: 8,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
              background: active ? t.accentSoft : 'transparent', color: active ? t.accent : t.textMuted,
              fontFamily: 'inherit', position: 'relative',
            }}
            onMouseEnter={(e) => !active && (e.currentTarget.style.background = t.chipBg)}
            onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}>
            {active && <div style={{ position: 'absolute', left: -2, top: 8, bottom: 8, width: 3, background: t.accent, borderRadius: 2 }} />}
            <Icon name={m.icon} size={16} />
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.3 }}>{m.label}</span>
          </button>
        );
      })}
    </div>
  );
};

const LogoMark = ({ size = 26 }) => {
  const s = size;
  return (
    <span style={{
      width: s, height: s, borderRadius: s * 0.23,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      background: 'linear-gradient(135deg, #0b7a58 0%, #10b981 45%, #05372a 100%)',
      boxShadow: '0 1px 2px rgba(8,14,22,0.2), inset 0 -1px 2px rgba(0,0,0,0.18)',
      position: 'relative', overflow: 'hidden',
    }}>
      <svg viewBox="0 0 32 32" width={s * 0.84} height={s * 0.84} style={{ position: 'absolute', inset: '50% auto auto 50%', transform: 'translate(-50%, -50%)' }}>
        <defs>
          <linearGradient id={`mantis-spec-${s}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff6b6b" stopOpacity="0.9" />
            <stop offset="35%" stopColor="#ffd54f" stopOpacity="0.9" />
            <stop offset="65%" stopColor="#4dd0e1" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#7e57ff" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <path d="M16 16 L28 10 A13.4 13.4 0 0 1 28 22 Z" fill={`url(#mantis-spec-${s})`} opacity="0.9" />
        <circle cx="16" cy="16" r="10" fill="none" stroke="#ffffff" strokeWidth="1.6" />
        <circle cx="16" cy="16" r="5.2" fill="none" stroke="#ffffff" strokeWidth="1.2" opacity="0.85" />
        <path d="M16 3 L16 9 M16 23 L16 29 M3 16 L9 16 M23 16 L29 16" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="16" cy="16" r="1.3" fill="#ffffff" />
      </svg>
    </span>
  );
};

const TopBar = ({ mode, themeName, setThemeName, source, serverOk, onHelp, onAbout, onPalette, onISP, onOpen, onSample, fileFilter, setFileFilter }) => {
  const t = useTheme();
  const modeTitle = { usaf: 'USAF Resolution', fpn: 'FPN Analysis', dof: 'Depth of Field' }[mode];
  return (
    <div style={{ height: 50, display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14, borderBottom: `1px solid ${t.border}`, background: t.panel, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 0 }}>
      <button onClick={onAbout} title="About MantisAnalysis" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: t.text }}>
        <LogoMark size={28} />
        <div style={{ minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 13.5, fontWeight: 650, color: t.text, lineHeight: 1.05, whiteSpace: 'nowrap', letterSpacing: -0.15 }}>
            {/* Wordmark — slight letter-spacing across "Analysis" + a clearly
                visible gap before "Suite" to read as three distinct tokens. */}
            Mantis<span style={{ color: t.accent, letterSpacing: 0.2 }}>Analysis</span>
            <span style={{ color: t.textFaint, fontWeight: 500, fontSize: 12, marginLeft: 8, letterSpacing: 0.4 }}>SUITE</span>
          </div>
          <div style={{ fontSize: 10.25, color: t.textFaint, lineHeight: 1.2, whiteSpace: 'nowrap', fontFamily: 'ui-monospace,Menlo,monospace' }}>{BRAND.lab}</div>
        </div>
      </button>
      <div style={{ width: 1, height: 22, background: t.border, flexShrink: 0 }} />
      <div style={{ fontSize: 13, color: t.text, fontWeight: 500, flexShrink: 0 }}>{modeTitle}</div>
      {source && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', background: t.accentSoft, color: t.accent, borderRadius: 4, fontSize: 10.5, fontFamily: 'ui-monospace,Menlo,monospace', minWidth: 0, overflow: 'hidden' }}
             title={source.path || source.name}>
          <Icon name={source.kind === 'h5' ? 'layers' : 'image'} size={11} />
          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', maxWidth: 240 }}>{source.name}</span>
          <span style={{ color: t.textFaint }}>· {source.channels.length}ch · {source.shape[1]}×{source.shape[0]}</span>
          {source.has_dark && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 5px', background: t.success, color: '#fff', borderRadius: 3, fontSize: 9.5 }}
                  title={`dark frame subtracted: ${source.dark_name || ''}${source.dark_path ? ' · ' + source.dark_path : ''}`}>
              − DARK
            </span>
          )}
        </div>
      )}
      <div style={{ flex: 1, minWidth: 8 }} />
      {serverOk === null && <span style={{ fontSize: 10.5, color: t.textFaint }}>connecting…</span>}
      {serverOk === false && <span style={{ fontSize: 10.5, color: t.danger, fontFamily: 'ui-monospace,Menlo,monospace' }}>server offline</span>}
      <Button icon="image" size="sm" onClick={onSample} title="Load a synthetic sample">Sample</Button>
      {/* File-type filter for Open. Uses a native <select> for OS-consistency;
          the native file dialog only respects one "accept" at a time, so we
          let users pre-select it here. */}
      <select value={fileFilter} onChange={(e) => setFileFilter(e.target.value)}
              title="Filter the Open dialog by file type"
              style={{
                appearance: 'none', WebkitAppearance: 'none',
                background: t.chipBg, color: t.text,
                border: `1px solid ${t.chipBorder}`, borderRadius: 5,
                fontSize: 11, padding: '5px 22px 5px 8px', cursor: 'pointer',
                fontFamily: 'inherit', flexShrink: 0, maxWidth: 180,
              }}>
        {Object.entries(FILE_FILTERS).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>
      <Button icon="open" size="sm" onClick={onOpen} title={`Open — filter: ${FILE_FILTERS[fileFilter]?.label} (⌘O)`}>Open</Button>
      <Button icon="search" size="sm" onClick={onPalette} title="Command palette (⌘K)">
        <span style={{ color: t.textFaint, fontSize: 10, fontFamily: 'ui-monospace,Menlo,monospace', marginLeft: 2 }}>⌘K</span>
      </Button>
      <Button icon="isp" size="sm" onClick={onISP} title="ISP settings (Shift+I)" />
      <Button icon="keyboard" size="sm" onClick={onHelp} title="Keyboard shortcuts (?)" />
      <div style={{ display: 'flex', alignItems: 'center', background: t.chipBg, borderRadius: 6, padding: 2, border: `1px solid ${t.chipBorder}`, flexShrink: 0 }}>
        {[['light', 'sun'], ['dark', 'moon']].map(([v, ic]) => (
          <button key={v} onClick={() => setThemeName(v)} title={`${v[0].toUpperCase() + v.slice(1)} theme`} style={{
            width: 26, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: themeName === v ? t.panel : 'transparent', color: themeName === v ? t.text : t.textMuted,
            border: 'none', borderRadius: 4, cursor: 'pointer', boxShadow: themeName === v ? t.shadow : 'none',
          }}><Icon name={ic} size={13} /></button>
        ))}
      </div>
    </div>
  );
};

const StatusBar = ({ mode, status, source, onAbout, onPalette }) => {
  const t = useTheme();
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 7px',
    background: 'transparent', color: t.textMuted, border: `1px solid ${t.border}`,
    borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 10,
  };
  return (
    <div style={{
      height: 26, display: 'flex', alignItems: 'center', padding: '0 12px',
      borderTop: `1px solid ${t.border}`, background: t.panel,
      fontSize: 10.5, fontFamily: 'ui-monospace,SF Mono,Menlo,monospace', color: t.textMuted, flexShrink: 0, gap: 12,
    }}>
      <span style={{ color: t.accent, fontWeight: 600 }}>[{mode.toUpperCase()}]</span>
      <span style={{ color: t.text }}>{status.msg}</span>
      <span style={{ color: t.textFaint }}>·</span>
      <span>{status.count} item{status.count !== 1 ? 's' : ''}</span>
      {source && <><span style={{ color: t.textFaint }}>·</span><span title={source.source_id}>src {source.source_id.slice(0, 6)}</span></>}
      <div style={{ flex: 1 }} />
      <button onClick={onPalette} style={chip} title="Command palette (⌘K)"><Icon name="search" size={10} /> ⌘K</button>
      <span style={{ color: t.textFaint }}>v{BRAND.version} · build {BRAND.build}</span>
      <button onClick={onAbout} style={chip} title="About · credits"><Icon name="info" size={10} /> © {BRAND.year} {BRAND.author}</button>
    </div>
  );
};

const HelpOverlay = ({ mode, onClose }) => {
  const shortcuts = {
    global: [['⌘K', 'Command palette'], ['⌘O', 'Open image / H5'], ['?', 'Toggle this overlay'], ['1 / 2 / 3', 'Switch mode']],
    usaf:   [['Drag', 'Draw a line through a USAF group/element'], ['Right-click', 'Delete nearest line']],
    fpn:    [['Drag', 'Define ROI'], ['Click outside ROI', 'Clear ROI']],
    dof:    [['Click', 'Drop probe point'], ['Drag', 'Draw focus line'], ['Right-click', 'Delete nearest']],
  };
  return (
    <Modal onClose={onClose} width={560}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icon name="keyboard" size={18} />
        <div style={{ fontSize: 15, fontWeight: 600 }}>Keyboard shortcuts</div>
        <div style={{ flex: 1 }} />
        <Button variant="subtle" icon="close" onClick={onClose} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <ShortcutList title="Global" items={shortcuts.global} />
        <ShortcutList title={`${mode.toUpperCase()} mode`} items={shortcuts[mode]} />
      </div>
    </Modal>
  );
};
const ShortcutList = ({ title, items }) => {
  const t = useTheme();
  return (
    <div>
      <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Kbd>{k}</Kbd><span style={{ fontSize: 11.5, color: t.textMuted }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const AboutOverlay = ({ onClose }) => {
  const t = useTheme();
  return (
    <Modal onClose={onClose} width={520} padding={0}>
      <div style={{ background: `linear-gradient(135deg, #0e9f6e 0%, #10b981 45%, #064e3b 100%)`, padding: '28px 24px 22px', color: '#fff', position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <LogoMark size={44} />
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1 }}>{BRAND.name}</div>
            <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4, fontFamily: 'ui-monospace,Menlo,monospace' }}>{BRAND.tagline}</div>
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', width: 28, height: 28, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Close (Esc)">
            <Icon name="close" size={12} />
          </button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.9, lineHeight: 1.55, maxWidth: 380 }}>
          A bench for multi-channel sensor characterization — USAF resolution, fixed-pattern noise, and depth-of-field analysis in one place. Python backend (NumPy · SciPy · matplotlib) · React frontend.
        </div>
      </div>
      <div style={{ padding: 22 }}>
        <AboutSection label="Developer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 600, flexShrink: 0 }}>ZZ</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{BRAND.author}</div>
              <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>Designer &amp; developer</div>
            </div>
            <a href={`mailto:${BRAND.authorEmail}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', background: t.chipBg, color: t.text, border: `1px solid ${t.chipBorder}`, borderRadius: 5, textDecoration: 'none', fontSize: 11.5 }}>{BRAND.authorEmail}</a>
          </div>
        </AboutSection>
        <AboutSection label="Author affiliation">
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{BRAND.authorAffiliation}</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>Optical instrumentation</div>
        </AboutSection>
        <AboutSection label="Built for">
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{BRAND.customer}</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>University of Illinois Urbana-Champaign</div>
        </AboutSection>
        <AboutSection label="Build">
          <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11, color: t.textMuted, lineHeight: 1.7 }}>
            <div>version <span style={{ color: t.text }}>{BRAND.version}</span></div>
            <div>build <span style={{ color: t.text }}>{BRAND.build}</span></div>
            <div>stack <span style={{ color: t.text }}>React 18 · FastAPI · NumPy / SciPy · matplotlib</span></div>
          </div>
        </AboutSection>
        <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 22, lineHeight: 1.55, borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
          © {BRAND.year} {BRAND.author} · {BRAND.authorAffiliation}. Developed for {BRAND.customer}. MIT licensed.
        </div>
      </div>
    </Modal>
  );
};
const AboutSection = ({ label, children }) => {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 9.5, color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 600, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
};

const CommandPalette = ({ actions, onClose }) => {
  const t = useTheme();
  const [q, setQ] = useStateApp('');
  const [sel, setSel] = useStateApp(0);
  const filtered = useMemoApp(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return actions;
    return actions.filter(a => a.label.toLowerCase().includes(ql) || a.id.toLowerCase().includes(ql));
  }, [q, actions]);
  useEffectApp(() => { setSel(0); }, [q]);
  const run = (a) => { a.run(); onClose(); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(filtered.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { if (filtered[sel]) run(filtered[sel]); }
  };
  return (
    <Modal onClose={onClose} width={560} padding={0}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: `1px solid ${t.border}` }}>
        <Icon name="search" size={14} />
        <input autoFocus placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, color: t.text, outline: 'none', fontFamily: 'inherit' }} />
        <Kbd>Esc</Kbd>
      </div>
      <div style={{ maxHeight: 400, overflowY: 'auto', padding: 6 }}>
        {filtered.length === 0 && <div style={{ padding: 28, textAlign: 'center', color: t.textFaint, fontSize: 12 }}>No commands match “{q}”</div>}
        {filtered.map((a, i) => (
          <button key={a.id} onClick={() => run(a)} onMouseEnter={() => setSel(i)}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', background: sel === i ? t.accentSoft : 'transparent', color: sel === i ? t.accent : t.text, border: 'none', borderRadius: 5, cursor: 'pointer', textAlign: 'left', fontSize: 12.5, fontFamily: 'inherit' }}>
            <Icon name={a.icon || 'chevron'} size={14} />
            <span style={{ flex: 1 }}>{a.label}</span>
            {a.kbd && <Kbd>{a.kbd}</Kbd>}
          </button>
        ))}
      </div>
    </Modal>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
