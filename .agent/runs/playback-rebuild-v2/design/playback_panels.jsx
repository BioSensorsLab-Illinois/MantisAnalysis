// Playback panels — Sources, Inspector, TimelineStrip, ViewerCard, badges
// MantisAnalysis · BioSensors Lab @ UIUC
const { useState: useStateP, useEffect: useEffectP, useRef: useRefP, useMemo: useMemoP, useCallback: useCallbackP } = React;

// ---------------------------------------------------------------------------
// ProcessingBadge — 3-letter mono chip
// ---------------------------------------------------------------------------
const BADGE_DEFS = [
  { id: 'RAW', tone: 'neutral', title: 'Raw channel · no processing' },
  { id: 'DRK', tone: 'accent',  title: 'Dark-corrected' },
  { id: 'NRM', tone: 'accent',  title: 'Normalized (min / max)' },
  { id: 'LUT', tone: 'accent',  title: 'Non-linear colormap applied' },
  { id: 'RGB', tone: 'accent',  title: 'RGB grading applied' },
  { id: 'OVL', tone: 'warn',    title: 'Overlay layer active' },
  { id: 'LCK', tone: 'warn',    title: 'Locked to specific frame' },
  { id: 'EXP', tone: 'success', title: 'Included in current export' },
];

const ProcessingBadge = ({ id, active = true }) => {
  const t = useTheme();
  const def = BADGE_DEFS.find(b => b.id === id);
  if (!def) return null;
  const tones = {
    neutral: { bg: t.chipBg, fg: t.textMuted, br: t.chipBorder },
    accent:  { bg: t.accentSoft, fg: t.accent, br: 'transparent' },
    warn:    { bg: 'rgba(197, 127, 0, 0.14)', fg: t.warn, br: 'transparent' },
    success: { bg: 'rgba(26, 127, 55, 0.14)', fg: t.success, br: 'transparent' },
  };
  const tone = tones[def.tone];
  return (
    <span title={def.title} style={{
      display: 'inline-flex', alignItems: 'center', padding: '1px 5px',
      background: active ? tone.bg : 'transparent', color: active ? tone.fg : t.textFaint,
      border: `1px solid ${active ? tone.br : t.chipBorder}`, borderRadius: 3,
      fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5, fontWeight: 600,
      letterSpacing: 0.3, opacity: active ? 1 : 0.35, userSelect: 'none',
    }}>{id}</span>
  );
};

// Compute which badges apply to a view
const badgesFor = (view) => {
  const out = [];
  if (!view.darkOn && !view.normalize && view.colormap === 'gray' && view.type !== 'rgb') out.push('RAW');
  if (view.darkOn) out.push('DRK');
  if (view.normalize) out.push('NRM');
  if (view.colormap && view.colormap !== 'gray' && view.type !== 'rgb') out.push('LUT');
  if (view.type === 'rgb') out.push('RGB');
  if (view.overlayEnabled) out.push('OVL');
  if (view.lockedFrame != null) out.push('LCK');
  if (view.exportInclude) out.push('EXP');
  return out;
};

// ---------------------------------------------------------------------------
// ViewerCanvas — procedural scientific image w/ channel-appropriate palette
// ---------------------------------------------------------------------------
const ViewerCanvas = ({ view, frame, width, height, placeholder, loading, failed }) => {
  const t = useTheme();
  const ref = useRefP(null);

  useEffectP(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    c.width = width; c.height = height;
    ctx.clearRect(0, 0, width, height);
    if (placeholder || failed) {
      ctx.fillStyle = '#0b0b0d'; ctx.fillRect(0, 0, width, height);
      return;
    }

    // Base field: deterministic by channel + frame + view id
    const seed = hashSeed((view?.id || 'v') + (view?.channel || '') + String(frame || 0));
    const bands = bandInfo(view);
    drawField(ctx, width, height, seed, bands);

    if (view.overlayEnabled) drawOverlay(ctx, width, height, seed, view);
    if (view.showClipped) drawClipping(ctx, width, height, seed);
  }, [view, frame, width, height, placeholder, failed]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#0a0a0a', overflow: 'hidden' }}>
      {!placeholder && !failed && (
        <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%', imageRendering: 'auto' }} />
      )}
      {placeholder && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5a6370', fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', flexDirection: 'column', gap: 8, textAlign: 'center', padding: 20 }}>
          <Icon name="image" size={28} style={{ opacity: 0.4 }} />
          <div>{placeholder}</div>
        </div>
      )}
      {loading && !failed && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite linear' }} />
      )}
      {failed && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#c97a7a', fontSize: 12, padding: 20, textAlign: 'center' }}>
          <Icon name="warning" size={22} />
          <div style={{ maxWidth: 220, lineHeight: 1.5 }}>Frame not decoded.</div>
          <button style={{ background: 'rgba(255,107,107,0.12)', border: '1px solid rgba(255,107,107,0.4)', color: '#ff9999', padding: '5px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>Retry</button>
        </div>
      )}
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
};

// deterministic hash → seed
const hashSeed = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
};
const mulberry32 = (a) => () => {
  let t = a += 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Band info → channel palette
const bandInfo = (view) => {
  const band = (view?.channel || '').split('-').pop();
  const palette = {
    R:   ['#2a0808', '#6a1a1a', '#d24a4a', '#ffb0a8'],
    G:   ['#08200e', '#1a5a2a', '#3fba5e', '#a8f0b8'],
    B:   ['#060f28', '#14306a', '#4a8eff', '#b8d4ff'],
    NIR: ['#0c061a', '#2a1558', '#9b6bff', '#ddc8ff'],
    Y:   ['#0c0c0c', '#3a3a3a', '#b8b8b8', '#f0f0f0'],
  }[band] || ['#0c0c0c', '#3a3a3a', '#b8b8b8', '#f0f0f0'];
  if (view?.type === 'rgb') return { palette: null, rgb: true };
  return { palette, rgb: false };
};

// Draw a procedural microscopy-ish field: elliptical gradient + grid + blobs
const drawField = (ctx, w, h, seed, bands) => {
  const rnd = mulberry32(seed);
  if (bands.rgb) {
    // RGB: three channels + color noise
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const nx = (x - w * 0.5) / (w * 0.5);
        const ny = (y - h * 0.5) / (h * 0.5);
        const r2 = nx * nx + ny * ny;
        const fall = Math.max(0, 1 - r2 * 0.8);
        const n = rnd();
        d[i]     = Math.min(255, 80 + fall * 140 + n * 20);
        d[i + 1] = Math.min(255, 70 + fall * 150 + n * 25);
        d[i + 2] = Math.min(255, 60 + fall * 120 + n * 30);
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // cells / blobs
    for (let i = 0; i < 24; i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 12 + rnd() * 30;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(220,200,170,${0.12 + rnd() * 0.2})`);
      g.addColorStop(1, 'rgba(220,200,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    const [c0, c1, c2, c3] = bands.palette;
    // Radial gradient base
    const g = ctx.createRadialGradient(w * 0.45, h * 0.48, 10, w * 0.5, h * 0.5, Math.max(w, h) * 0.7);
    g.addColorStop(0, c3); g.addColorStop(0.25, c2); g.addColorStop(0.6, c1); g.addColorStop(1, c0);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // Noise grain
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * 30;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    }
    ctx.putImageData(img, 0, 0);
    // Blobs / features
    for (let i = 0; i < 18; i++) {
      const cx = rnd() * w, cy = rnd() * h, r = 10 + rnd() * 26;
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, c3); rg.addColorStop(0.5, c2); rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
};

const drawOverlay = (ctx, w, h, seed, view) => {
  const rnd = mulberry32(seed + 99);
  ctx.globalCompositeOperation = view.overlay.blendMode === 'screen' ? 'screen'
    : view.overlay.blendMode === 'additive' ? 'lighter' : 'source-over';
  const alpha = view.overlay.strength;
  for (let i = 0; i < 10; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = 30 + rnd() * 80;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(176, 107, 255, ${0.7 * alpha})`);
    g.addColorStop(0.5, `rgba(255, 150, 80, ${0.4 * alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
};

const drawClipping = (ctx, w, h, seed) => {
  const rnd = mulberry32(seed + 7);
  ctx.fillStyle = 'rgba(255, 64, 64, 0.9)';
  for (let i = 0; i < 300; i++) {
    const x = rnd() * w, y = rnd() * h;
    if (rnd() > 0.97) ctx.fillRect(x, y, 2, 2);
  }
};

// ---------------------------------------------------------------------------
// ViewerCard — title bar + canvas + footer
// ---------------------------------------------------------------------------
const ViewerCard = ({ view, frame, selected, onSelect, onAction, state = 'ok', syncToGlobal = true, streamFile, overlayLegend }) => {
  const t = useTheme();
  const containerRef = useRefP(null);
  const [sz, setSz] = useStateP({ w: 300, h: 200 });
  const [hover, setHover] = useStateP(false);
  useEffectP(() => {
    const el = containerRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setSz({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const badges = badgesFor(view);
  const effFrame = view.lockedFrame ?? frame;
  const isLocked = view.lockedFrame != null;
  const chromeVisible = hover || selected;

  // Selection / lock indication: thin outline, no shift in layout
  const outline = selected ? t.accent : (isLocked ? t.warn : 'transparent');
  const chipColor = view.type === 'rgb' ? t.accent : t.text;

  return (
    <div
      onClick={() => onSelect?.(view.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', background: '#0a0a0a',
        border: `1px solid ${t.border}`,
        outline: selected || isLocked ? `1.5px solid ${outline}` : 'none',
        outlineOffset: -1,
        borderRadius: 4,
        overflow: 'hidden', minHeight: 0, minWidth: 0,
        cursor: selected ? 'default' : 'pointer', height: '100%',
      }}
    >
      {/* Canvas fills the card */}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
        <ViewerCanvas
          view={view} frame={effFrame}
          width={sz.w} height={sz.h}
          placeholder={state === 'empty' ? 'Add a view to start inspecting' : null}
          loading={state === 'loading'}
          failed={state === 'failed'}
        />
      </div>

      {/* Top-left: persistent identity chip (name + channel/gain) */}
      <div style={{
        position: 'absolute', left: 8, top: 8,
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: 'rgba(14,16,20,0.72)', backdropFilter: 'blur(6px)',
        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
        padding: '3px 7px', fontSize: 10.5, fontFamily: 'ui-monospace, Menlo, monospace',
        color: '#e8eaed', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 16px)',
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: selected ? t.accent : (isLocked ? t.warn : '#7f8ea0'), flexShrink: 0 }} />
        {sz.w >= 300 && (
          <>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{view.name}</span>
            <span style={{ color: '#8f9aab' }}>·</span>
          </>
        )}
        <span style={{ color: chipColor, fontWeight: 600 }}>{view.type === 'rgb' ? 'RGB' : view.channel}</span>
      </div>

      {/* Top-right: badges (persistent, small) */}
      {badges.length > 0 && (
        <div style={{
          position: 'absolute', right: 8, top: 8, display: 'flex', gap: 2,
          background: 'rgba(14,16,20,0.6)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 3, padding: '2px 3px',
        }}>
          {badges.slice(0, 4).map(b => <ProcessingBadge key={b} id={b} />)}
        </div>
      )}

      {/* Bottom-left: timestamp pill (if enabled) */}
      {view.labels?.timestamp && state !== 'failed' && state !== 'loading' && (
        <div style={{
          position: 'absolute', left: 8, bottom: 8,
          background: 'rgba(14,16,20,0.72)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
          padding: '2px 6px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10,
          color: '#e8eaed', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <span>f{String(effFrame).padStart(4, '0')}</span>
          <span style={{ color: '#8f9aab' }}>·</span>
          <span>{fmtTime(effFrame / 30)}</span>
          {isLocked && (<><span style={{ color: '#8f9aab' }}>·</span><span style={{ color: t.warn, display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon name="lock" size={9} />LOCK</span></>)}
          {!isLocked && syncToGlobal && (<><span style={{ color: '#8f9aab' }}>·</span><span style={{ color: '#6fd48a' }}>SYNC</span></>)}
        </div>
      )}

      {/* Bottom-right: overlay legend */}
      {overlayLegend && view.overlayEnabled && view.labels?.legend && (
        <div style={{
          position: 'absolute', right: 8, bottom: 8,
          background: 'rgba(14,16,20,0.78)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
          padding: '4px 6px', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 9.5,
          color: '#e8eaed', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 120,
        }}>
          <div>{view.overlay.channel} · {view.overlay.low}–{view.overlay.high}</div>
          <div style={{ height: 4, borderRadius: 2, background: 'linear-gradient(90deg, #1a0b4a, #d4351c, #ffd54f)' }} />
        </div>
      )}

      {view.showClipped && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
          background: 'rgba(220, 50, 50, 0.2)', color: '#ffb3b3',
          border: '1px solid rgba(220, 50, 50, 0.4)', padding: '1px 6px',
          borderRadius: 3, fontSize: 9, fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: 0.5,
        }}>CLIP</div>
      )}

      {/* Hover toolbar — top-center */}
      {chromeVisible && (
        <div style={{
          position: 'absolute', right: 8, top: 34,
          display: 'flex', gap: 2,
          background: 'rgba(14,16,20,0.8)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 3, padding: 2,
          animation: 'fadeIn 120ms ease-out',
        }}>
          <HoverBtn title="Fit" icon="fit" onClick={(e) => { e.stopPropagation(); onAction?.(view.id, 'fit'); }} />
          <HoverBtn title="100%" icon="zoomReset" onClick={(e) => { e.stopPropagation(); onAction?.(view.id, 'reset'); }} />
          <HoverBtn title={isLocked ? 'Unlock frame' : 'Lock frame'} icon={isLocked ? 'unlock' : 'lock'}
            active={isLocked}
            onClick={(e) => { e.stopPropagation(); onAction?.(view.id, 'lock'); }} />
          <HoverBtn title="Fullscreen" icon="expand" onClick={(e) => { e.stopPropagation(); onAction?.(view.id, 'full'); }} />
          <HoverBtn title="More\u2026" icon="dots" onClick={(e) => { e.stopPropagation(); onAction?.(view.id, 'menu'); }} />
        </div>
      )}

      {/* File pill bottom-center, on hover (only when card is wide enough) */}
      {chromeVisible && streamFile?.name && sz.w >= 360 && (
        <div style={{
          position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)',
          background: 'rgba(14,16,20,0.72)', backdropFilter: 'blur(6px)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: 3,
          padding: '2px 7px', fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace',
          color: '#b0b8c4', whiteSpace: 'nowrap', maxWidth: '60%',
          overflow: 'hidden', textOverflow: 'ellipsis',
          animation: 'fadeIn 120ms ease-out',
          // Bump up if timestamp pill is also bottom-left on this card
          ...(view.labels?.timestamp ? { bottom: 34 } : {}),
        }}>
          {streamFile.name}
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }`}</style>
    </div>
  );
};

const HoverBtn = ({ title, icon, onClick, active }) => {
  const t = useTheme();
  return (
    <button onClick={onClick} title={title} style={{
      width: 22, height: 22, border: 'none', cursor: 'pointer', borderRadius: 2,
      background: active ? 'rgba(197, 127, 0, 0.25)' : 'transparent',
      color: active ? '#ffc36f' : '#d8dde6',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    }}>
      <Icon name={icon} size={12} />
    </button>
  );
};

// ---------------------------------------------------------------------------
// ViewerGrid — layout presets
// ---------------------------------------------------------------------------
const ViewerGrid = ({ views, layout, selectedId, onSelect, onAction, frame, stream, children }) => {
  const t = useTheme();
  const preset = LAYOUT_PRESETS.find(p => p.id === layout) || LAYOUT_PRESETS[0];
  const rows = preset.rows || 2;
  const cols = 2;
  const cells = preset.cells;
  const cellCount = cells.length;
  const visibleViews = views.slice(0, cellCount);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, padding: 10 }}>
      {children /* grid toolbar */}
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
              <ViewerCard
                view={v} frame={frame} selected={v.id === selectedId}
                onSelect={onSelect} onAction={onAction}
                syncToGlobal={v.syncToGlobal}
                streamFile={stream && frameToFile(stream, v.lockedFrame ?? frame)?.file}
                overlayLegend
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// StreamChip — header pill for the current stream
// ---------------------------------------------------------------------------
const StreamChip = ({ stream, onOpenBuilder, warnings }) => {
  const t = useTheme();
  const fileCount = stream?.files.length || 0;
  const hasWarn = (warnings || 0) > 0;
  return (
    <button onClick={onOpenBuilder} title="Open Stream Builder" style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      padding: '6px 12px 6px 10px', background: t.panel,
      border: `1px solid ${t.border}`, borderRadius: 6,
      cursor: 'pointer', color: t.text, fontFamily: 'inherit',
      maxWidth: 440, minWidth: 0,
    }}>
      <Icon name="stack" size={14} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, gap: 2 }}>
        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {stream?.name || 'No stream'}
        </div>
        <div style={{ fontSize: 10, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', display: 'flex', gap: 6 }}>
          <span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span>{stream?.totalFrames || 0} frames</span>
          <span>·</span>
          <span>{fmtDuration(stream?.totalDuration)}</span>
        </div>
      </div>
      {hasWarn && <span title={`${warnings} warning${warnings > 1 ? 's' : ''}`} style={{ width: 8, height: 8, borderRadius: '50%', background: t.warn, flexShrink: 0 }} />}
    </button>
  );
};

// ---------------------------------------------------------------------------
// FilePill — recording file row
// ---------------------------------------------------------------------------
const FilePill = ({ file, expanded, onToggleExpand, onRemove, streamBaseExposure }) => {
  const t = useTheme();
  const bad = file.status === 'quarantined' || file.status === 'error';
  const warn = (file.warnings || []).length > 0;
  const mismatch = streamBaseExposure != null && file.exposureMs !== streamBaseExposure;
  return (
    <div style={{
      border: `1px solid ${bad ? t.danger : (warn ? t.warn : t.border)}`,
      borderRadius: 5, background: t.panel, overflow: 'hidden',
    }}>
      <div onClick={onToggleExpand} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', cursor: 'pointer', minWidth: 0,
      }}>
        <Icon name="drag" size={12} style={{ color: t.textFaint, cursor: 'grab' }} />
        <Icon name={bad ? 'warning' : 'file'} size={12} style={{ color: bad ? t.danger : t.textMuted }} />
        <span style={{
          fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace',
          flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{file.name}</span>
        {warn && <span title="Warning" style={{ width: 7, height: 7, borderRadius: '50%', background: t.warn }} />}
        <span style={{
          padding: '1px 5px', background: mismatch ? 'rgba(197, 127, 0, 0.15)' : t.chipBg,
          color: mismatch ? t.warn : t.textMuted, border: `1px solid ${mismatch ? t.warn : t.chipBorder}`,
          borderRadius: 3, fontSize: 9.5, fontFamily: 'ui-monospace, Menlo, monospace',
        }}>{file.exposureMs} ms</span>
        <Icon name="chevron" size={10} style={{ color: t.textFaint, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />
      </div>
      {expanded && (
        <div style={{ padding: '6px 10px 10px 28px', borderTop: `1px solid ${t.border}`, background: t.panelAlt, fontSize: 10.5, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div>{file.frames} frames · {file.width}×{file.height}</div>
          <div>{file.fps} fps · {file.sizeMB} MB</div>
          <div>{fmtTime(file.tsStart)} → {fmtTime(file.tsEnd)}</div>
          {(file.warnings || []).map(w => (
            <div key={w} style={{ marginTop: 4, padding: '3px 6px', background: 'rgba(197, 127, 0, 0.12)', color: t.warn, borderRadius: 3, fontSize: 10, fontFamily: 'inherit' }}>
              {WARNINGS[w]?.text(file) || w}
            </div>
          ))}
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <button onClick={(e) => { e.stopPropagation(); onRemove?.(); }} style={microBtn(t)}>Remove</button>
            <button onClick={(e) => e.stopPropagation()} style={microBtn(t)}>Inspect</button>
          </div>
        </div>
      )}
    </div>
  );
};

const microBtn = (t) => ({
  padding: '3px 8px', background: 'transparent', color: t.textMuted,
  border: `1px solid ${t.chipBorder}`, borderRadius: 3, cursor: 'pointer',
  fontSize: 10, fontFamily: 'inherit',
});

// ---------------------------------------------------------------------------
// DarkFrameRow
// ---------------------------------------------------------------------------
const DarkFrameRow = ({ dark, onRemove }) => {
  const t = useTheme();
  const stateMap = {
    matched:    { color: t.success, label: `Matched → ${dark.matchedToViews.join(', ')}` },
    available:  { color: t.textFaint, label: 'Available · unmatched' },
    orphan:     { color: t.warn, label: 'Orphan · no recording matches' },
    mismatched: { color: t.warn, label: 'Exposure mismatch' },
    ambiguous:  { color: t.textMuted, label: 'Multiple matches' },
  }[dark.status] || { color: t.textFaint, label: dark.status };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', border: `1px solid ${t.border}`, borderRadius: 5, background: t.panel }}>
      <Icon name="moon" size={12} style={{ color: t.textMuted }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dark.name}
        </div>
        <div style={{ fontSize: 10, color: stateMap.color, marginTop: 1 }}>{stateMap.label}</div>
      </div>
      <span style={{ padding: '1px 5px', background: t.chipBg, color: t.textMuted, border: `1px solid ${t.chipBorder}`, borderRadius: 3, fontSize: 9.5, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {dark.exposureMs} ms · ×{dark.framesAveraged}
      </span>
      <button onClick={onRemove} title="Remove" style={{ width: 18, height: 18, border: 'none', background: 'transparent', color: t.textFaint, cursor: 'pointer', borderRadius: 3 }}>
        <Icon name="close" size={10} />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sources panel
// ---------------------------------------------------------------------------
const SourcesPanel = ({ stream, darks, onOpenFile, onOpenDark, onRemoveFile, onRemoveDark, darkOn, setDarkOn, autoMatch, setAutoMatch, loading, collapsed, onToggleCollapsed }) => {
  const t = useTheme();
  const [expandedFile, setExpandedFile] = useStateP(null);
  const [showDarks, setShowDarks] = useStateP(true);

  if (collapsed) {
    return (
      <div style={{ width: 44, background: t.panel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 6 }}>
        <button onClick={onToggleCollapsed} title="Expand sources" style={railBtn(t)}>
          <Icon name="stack" size={14} />
        </button>
        <button title="Open recording" onClick={onOpenFile} style={railBtn(t)}>
          <Icon name="open" size={14} />
        </button>
        <button title="Open dark frame" onClick={onOpenDark} style={railBtn(t)}>
          <Icon name="moon" size={14} />
        </button>
      </div>
    );
  }

  const files = stream?.allFiles || [];
  const gapCount = stream?.issues?.gapCount || 0;
  const overlapCount = stream?.issues?.overlapCount || 0;
  const mismatchCount = stream?.issues?.expMismatchCount || 0;

  return (
    <div style={{ width: 288, minWidth: 240, maxWidth: 360, background: t.panel, borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ height: 34, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>Sources</div>
        <div style={{ flex: 1 }} />
        <button onClick={onToggleCollapsed} title="Collapse" style={microBtn(t)}>
          <Icon name="chevron" size={9} style={{ transform: 'rotate(180deg)' }} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Recordings section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 10.5, fontWeight: 600, color: t.text }}>Recordings</div>
            <div style={{ flex: 1 }} />
            <button onClick={onOpenFile} style={microBtn(t)}>+ Open</button>
          </div>
          {loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{ height: 34, background: t.chipBg, borderRadius: 5, border: `1px solid ${t.border}`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite linear' }} />
                </div>
              ))}
            </div>
          )}
          {!loading && files.length === 0 && (
            <div style={{ padding: 10, textAlign: 'center', border: `1px dashed ${t.border}`, borderRadius: 5, color: t.textFaint, fontSize: 11 }}>
              No files yet.
              <button onClick={onOpenFile} style={{ ...microBtn(t), marginTop: 6, display: 'inline-block' }}>Open recording</button>
            </div>
          )}
          {!loading && files.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map(f => (
                <FilePill key={f.id} file={f}
                  expanded={expandedFile === f.id}
                  onToggleExpand={() => setExpandedFile(e => e === f.id ? null : f.id)}
                  onRemove={() => onRemoveFile?.(f.id)}
                  streamBaseExposure={stream?.baseExposureMs}
                />
              ))}
            </div>
          )}
          {!loading && files.length > 0 && (gapCount + overlapCount + mismatchCount) > 0 && (
            <div style={{ marginTop: 8, padding: '6px 8px', background: 'rgba(197, 127, 0, 0.1)', border: `1px solid ${t.warn}`, color: t.warn, borderRadius: 4, fontSize: 10.5, lineHeight: 1.5 }}>
              {gapCount > 0 && <div>{gapCount} gap{gapCount > 1 ? 's' : ''} detected</div>}
              {overlapCount > 0 && <div>{overlapCount} overlap{overlapCount > 1 ? 's' : ''}</div>}
              {mismatchCount > 0 && <div>{mismatchCount} exposure mismatch{mismatchCount > 1 ? 'es' : ''}</div>}
            </div>
          )}
        </div>

        {/* Dark frames section */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <button onClick={() => setShowDarks(s => !s)} style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: 0, background: 'transparent', border: 'none', cursor: 'pointer', color: t.text, fontSize: 10.5, fontWeight: 600,
            }}>
              <Icon name="chevron" size={9} style={{ transform: showDarks ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: t.textFaint }} />
              Dark frames
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={onOpenDark} style={microBtn(t)}>+ Open</button>
          </div>
          {showDarks && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <Checkbox checked={darkOn} onChange={setDarkOn} label="Dark correction" />
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <Checkbox checked={autoMatch} onChange={setAutoMatch} label="Auto-match by exposure" />
              </div>
              {darks.length === 0 && (
                <div style={{ padding: 10, textAlign: 'center', border: `1px dashed ${t.border}`, borderRadius: 5, color: t.textFaint, fontSize: 11 }}>
                  No dark frames loaded.
                  <div style={{ marginTop: 6 }}>Dark correction unavailable.</div>
                </div>
              )}
              {darks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {darks.map(d => <DarkFrameRow key={d.id} dark={d} onRemove={() => onRemoveDark?.(d.id)} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const railBtn = (t) => ({
  width: 32, height: 32, border: 'none', cursor: 'pointer', borderRadius: 6,
  background: 'transparent', color: t.textMuted,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});

// ---------------------------------------------------------------------------
// Inspector — right panel, bound to selected view
// ---------------------------------------------------------------------------
const Inspector = ({ view, onUpdate, darks, views, onCopyTo, onOpenOverlay, collapsed, onToggleCollapsed }) => {
  const t = useTheme();
  const [tab, setTab] = useStateP('source');

  // Tabs rail (always visible, even when narrow)
  const TABS = [
    { id: 'source',   label: 'Source',   icon: 'layers' },
    { id: 'correct',  label: 'Correct',  icon: 'sliders' },
    { id: 'display',  label: 'Display',  icon: 'palette' },
    { id: 'overlay',  label: 'Overlay',  icon: 'stack' },
    { id: 'labels',   label: 'Labels',   icon: 'eye' },
    { id: 'presets',  label: 'Presets',  icon: 'save' },
  ];

  if (collapsed) {
    return (
      <div style={{
        width: 34, background: t.panel, borderLeft: `1px solid ${t.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 0', gap: 2,
      }}>
        <button onClick={onToggleCollapsed} title="Expand inspector" style={railBtn(t)}>
          <Icon name="settings" size={13} />
        </button>
        <div style={{ height: 6 }} />
        {TABS.map(tt => (
          <button key={tt.id} onClick={() => { setTab(tt.id); onToggleCollapsed(); }}
            title={tt.label} style={{ ...railBtn(t), width: 26, height: 26 }}>
            <Icon name={tt.icon} size={12} />
          </button>
        ))}
      </div>
    );
  }

  if (!view) {
    return (
      <div style={{ width: 300, background: t.panel, borderLeft: `1px solid ${t.border}`, padding: 18, color: t.textFaint, fontSize: 11.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
        <Icon name="settings" size={22} style={{ opacity: 0.5 }} />
        <div>Select a view to inspect.</div>
      </div>
    );
  }

  const set = (k, v) => onUpdate?.(view.id, { [k]: v });
  const setOverlay = (k, v) => onUpdate?.(view.id, { overlay: { ...view.overlay, [k]: v } });
  const setLabels = (k, v) => onUpdate?.(view.id, { labels: { ...view.labels, [k]: v } });

  // When gain class changes, also remap channel + channels[] to same class
  const setGainClass = (gc) => {
    const mapped = makeChannel(gc, bandOf(view.channel));
    const mapped3 = (view.channels || []).map(c => makeChannel(gc, bandOf(c)));
    onUpdate?.(view.id, { gainClass: gc, channel: mapped, channels: mapped3 });
  };

  return (
    <div style={{ width: 316, minWidth: 280, maxWidth: 380, background: t.panel, borderLeft: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ height: 32, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: `1px solid ${t.border}`, flexShrink: 0 }}>
        <div style={{ fontSize: 9.5, color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>Inspector</div>
        <div style={{ width: 1, height: 14, background: t.border }} />
        <div style={{ fontSize: 11, color: t.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {view.name}
        </div>
        <button onClick={onToggleCollapsed} title="Collapse" style={microBtn(t)}>
          <Icon name="chevron" size={9} style={{ transform: 'rotate(-90deg)' }} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: t.panelAlt, flexShrink: 0, overflowX: 'auto' }}>
        {TABS.map(tt => (
          <button key={tt.id} onClick={() => setTab(tt.id)} style={{
            flex: 1, minWidth: 44, padding: '7px 4px',
            background: tab === tt.id ? t.panel : 'transparent',
            color: tab === tt.id ? t.accent : t.textMuted,
            border: 'none', borderBottom: tab === tt.id ? `2px solid ${t.accent}` : '2px solid transparent',
            marginBottom: -1, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            fontSize: 9.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
          }}>
            <Icon name={tt.icon} size={12} />
            <span>{tt.label}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10, minHeight: 0 }}>
        {tab === 'source' && <InspectorSource view={view} set={set} setGainClass={setGainClass} />}
        {tab === 'correct' && <InspectorCorrect view={view} set={set} darks={darks} />}
        {tab === 'display' && <InspectorDisplay view={view} set={set} />}
        {tab === 'overlay' && <InspectorOverlay view={view} set={set} setOverlay={setOverlay} onOpenOverlay={onOpenOverlay} />}
        {tab === 'labels' && <InspectorLabels view={view} setLabels={setLabels} />}
        {tab === 'presets' && <InspectorPresets view={view} views={views} onCopyTo={onCopyTo} />}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Source tab · Name · Type · Gain class · Channel (gated) · Frame
// ---------------------------------------------------------------------------
const InspectorSource = ({ view, set, setGainClass }) => {
  const t = useTheme();
  const gc = view.gainClass || gainClassOf(view.channel);
  const bandsAvailable = BANDS;
  return (
    <div>
      <SectionLabel>View</SectionLabel>
      <input value={view.name} onChange={(e) => set('name', e.target.value)}
        style={{
          width: '100%', padding: '6px 8px', background: t.inputBg,
          border: `1px solid ${t.chipBorder}`, borderRadius: 4, color: t.text,
          fontSize: 11.5, fontFamily: 'inherit', boxSizing: 'border-box',
        }} />
      <Row label="Type">
        <Segmented value={view.type}
          options={[{ value: 'single', label: 'Single' }, { value: 'rgb', label: 'RGB' }]}
          onChange={(v) => set('type', v)} />
      </Row>
      <Row label="Sync">
        <Segmented value={view.syncToGlobal ? 'sync' : 'free'}
          options={[{ value: 'sync', label: 'Synced' }, { value: 'free', label: 'Free' }]}
          onChange={(v) => set('syncToGlobal', v === 'sync')} />
      </Row>

      <div style={{ height: 12 }} />
      <SectionLabel>Gain class</SectionLabel>
      <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 6, lineHeight: 1.5 }}>
        All bands in this view share one gain class.
      </div>
      <Segmented
        value={gc}
        options={[{ value: 'HG', label: 'HG · High gain' }, { value: 'LG', label: 'LG · Low gain' }]}
        onChange={setGainClass}
        fullWidth
      />

      <div style={{ height: 12 }} />
      {view.type === 'rgb' ? (
        <>
          <SectionLabel>Channels · RGB</SectionLabel>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 6, lineHeight: 1.5 }}>
            Assign a band to each color slot. Channels are locked to {gc}.
          </div>
          {['R', 'G', 'B'].map((slot, i) => (
            <Row key={slot} label={<span style={{ color: slotColor(slot, t) }}>{slot}</span>}>
              <BandPicker gc={gc} value={bandOf(view.channels[i] || makeChannel(gc, slot))}
                onChange={(b) => {
                  const next = [...view.channels];
                  next[i] = makeChannel(gc, b);
                  set('channels', next);
                }} />
            </Row>
          ))}
        </>
      ) : (
        <>
          <SectionLabel>Band</SectionLabel>
          <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 6, lineHeight: 1.5 }}>
            Pick a band within {gc}.
          </div>
          <BandPicker gc={gc} value={bandOf(view.channel)}
            onChange={(b) => set('channel', makeChannel(gc, b))} fullWidth />
        </>
      )}

      <div style={{ height: 12 }} />
      <SectionLabel>Frame</SectionLabel>
      <Segmented
        value={view.lockedFrame != null ? 'lock' : 'live'}
        options={[{ value: 'live', label: 'Live' }, { value: 'lock', label: 'Locked' }]}
        onChange={(v) => set('lockedFrame', v === 'lock' ? 0 : null)}
        fullWidth
      />
      {view.lockedFrame != null && (
        <Row label="At frame">
          <input type="number" value={view.lockedFrame} onChange={(e) => set('lockedFrame', Math.max(0, Number(e.target.value) || 0))}
            style={{ flex: 1, padding: '4px 8px', background: t.inputBg, color: t.text, border: `1px solid ${t.chipBorder}`, borderRadius: 3, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }} />
        </Row>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Correct tab · dark / gain / offset / normalize
// ---------------------------------------------------------------------------
const InspectorCorrect = ({ view, set, darks }) => {
  const t = useTheme();
  return (
    <div>
      <SectionLabel>Dark frame</SectionLabel>
      <Checkbox checked={view.darkOn} onChange={(v) => set('darkOn', v)} label="Subtract dark frame" />
      {view.darkOn && (
        <Row label="Pick">
          <Select
            value={view.darkId || ''}
            options={[
              { value: '', label: 'Auto-match by exposure' },
              ...darks.map(d => ({ value: d.id, label: `${d.name} · ${d.exposureMs} ms` })),
            ]}
            onChange={(v) => set('darkId', v || null)}
          />
        </Row>
      )}

      <div style={{ height: 14 }} />
      <SectionLabel>Linear correction</SectionLabel>
      <Slider label="Gain" min={0.1} max={4} step={0.01} value={view.gain} onChange={(v) => set('gain', v)} format={v => v.toFixed(2) + '×'} />
      <Slider label="Offset" min={-200} max={200} step={1} value={view.offset} onChange={(v) => set('offset', v)} format={v => v.toFixed(0)} />
      <Row label="Normalize">
        <Checkbox checked={view.normalize} onChange={(v) => set('normalize', v)} label="Auto min / max per frame" />
      </Row>

      {view.type === 'rgb' && (
        <>
          <div style={{ height: 14 }} />
          <SectionLabel>RGB grading <span style={{ color: t.textFaint, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· display only</span></SectionLabel>
          <div style={{ fontSize: 9.5, color: t.textFaint, marginBottom: 6, lineHeight: 1.4, fontStyle: 'italic' }}>
            Display grading — not color-calibrated. Never burned into export raws.
          </div>
          {['r', 'g', 'b'].map(k => (
            <Slider key={k} label={`Gain ${k.toUpperCase()}`} min={0.1} max={3} step={0.01}
              value={view.rgbGains[k]} onChange={(v) => set('rgbGains', { ...view.rgbGains, [k]: v })}
              format={v => v.toFixed(2)} />
          ))}
          <Slider label="Gamma" min={0.3} max={3} step={0.01} value={view.gamma} onChange={(v) => set('gamma', v)} format={v => v.toFixed(2)} />
          <Slider label="Saturation" min={0} max={2} step={0.01} value={view.saturation} onChange={(v) => set('saturation', v)} format={v => v.toFixed(2)} />
          <Slider label="White balance" min={2500} max={9500} step={100} value={view.whiteBalanceK} onChange={(v) => set('whiteBalanceK', v)} format={v => v.toFixed(0) + 'K'} />
          <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
            <button style={microBtn(t)}>Save preset</button>
            <button style={microBtn(t)}>Reset</button>
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Display tab · LUT, low/high, colormap, clipping
// ---------------------------------------------------------------------------
const InspectorDisplay = ({ view, set }) => {
  const t = useTheme();
  return (
    <div>
      <SectionLabel>Range</SectionLabel>
      <Slider label="Low"  min={0} max={1023} step={1} value={view.low}  onChange={(v) => set('low', v)}  format={v => v.toFixed(0)} />
      <Slider label="High" min={0} max={4095} step={1} value={view.high} onChange={(v) => set('high', v)} format={v => v.toFixed(0)} />

      <div style={{ marginTop: 8, padding: 8, background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 4 }}>
        <MiniHistogram view={view} />
      </div>

      <div style={{ height: 14 }} />
      <SectionLabel>Colormap</SectionLabel>
      <Row label="Preset"><Select value={view.colormap} options={COLORMAPS.map(c => ({ value: c, label: c }))} onChange={(v) => set('colormap', v)} /></Row>
      <Row label="Invert"><Checkbox checked={view.invert} onChange={(v) => set('invert', v)} label="Invert luminance" /></Row>
      <Row label="Clipping"><Checkbox checked={view.showClipped} onChange={(v) => set('showClipped', v)} label="Highlight clipped pixels" /></Row>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Overlay tab
// ---------------------------------------------------------------------------
const InspectorOverlay = ({ view, set, setOverlay, onOpenOverlay }) => {
  const t = useTheme();
  return (
    <div>
      <SectionLabel>Overlay layer</SectionLabel>
      <Checkbox checked={view.overlayEnabled} onChange={(v) => set('overlayEnabled', v)} label="Show overlay on this view" />

      {view.overlayEnabled && (
        <>
          <div style={{ height: 10 }} />
          <Row label="Source">
            <Select value={view.overlay.channel}
              options={ALL_CHANNELS.map(c => ({ value: c, label: c }))}
              onChange={(v) => setOverlay('channel', v)} />
          </Row>
          <Slider label="Threshold low"  min={0} max={1023} step={1} value={view.overlay.low}  onChange={(v) => setOverlay('low', v)}  format={v => v.toFixed(0)} />
          <Slider label="Threshold high" min={0} max={4095} step={1} value={view.overlay.high} onChange={(v) => setOverlay('high', v)} format={v => v.toFixed(0)} />
          <Row label="Blend">
            <Select value={view.overlay.blendMode} options={BLEND_MODES} onChange={(v) => setOverlay('blendMode', v)} />
          </Row>
          <Slider label="Strength" min={0} max={1} step={0.01} value={view.overlay.strength}
            onChange={(v) => setOverlay('strength', v)} format={v => (v * 100).toFixed(0) + '%'} />
          <Row label="Colormap">
            <Select value={view.overlay.overlayColormap}
              options={COLORMAPS.map(c => ({ value: c, label: c }))}
              onChange={(v) => setOverlay('overlayColormap', v)} />
          </Row>
          <button onClick={onOpenOverlay}
            style={{ ...microBtn(t), width: '100%', marginTop: 10, padding: '6px 8px',
              color: t.accent, borderColor: t.accent, fontSize: 11, fontWeight: 600 }}>
            Open overlay builder…
          </button>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Labels tab
// ---------------------------------------------------------------------------
const InspectorLabels = ({ view, setLabels }) => {
  const items = [
    ['timestamp', 'Timestamp'],
    ['frame', 'Frame number'],
    ['channel', 'Channel name'],
    ['source', 'Source file'],
    ['scaleBar', 'Scale bar'],
    ['badges', 'Processing badges'],
    ['legend', 'Overlay legend'],
  ];
  return (
    <div>
      <SectionLabel>Burned-in labels</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        {items.map(([k, label]) => (
          <Checkbox key={k} checked={!!view.labels?.[k]} onChange={(v) => setLabels(k, v)} label={label} />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inspector — Presets tab
// ---------------------------------------------------------------------------
const InspectorPresets = ({ view, views, onCopyTo }) => {
  const t = useTheme();
  const others = views.filter(v => v.id !== view.id);
  return (
    <div>
      <SectionLabel>Presets</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={microBtn(t)}>Save current as preset…</button>
        <Select value="" options={[
          { value: '', label: 'Load preset…' },
          { value: 'p1', label: 'Default · HG-G' },
          { value: 'p2', label: 'NIR inspection' },
        ]} onChange={() => {}} />
      </div>

      <div style={{ height: 14 }} />
      <SectionLabel>Copy settings to</SectionLabel>
      {others.length === 0 ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, padding: 8 }}>Only one view open.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {others.map(v => (
            <button key={v.id} onClick={() => onCopyTo?.(v.id)} style={{
              ...microBtn(t), padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6,
              justifyContent: 'flex-start', fontSize: 10.5,
            }}>
              <Icon name="copy" size={11} /> {v.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ height: 14 }} />
      <SectionLabel>Diagnostics</SectionLabel>
      <div style={{ fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint, lineHeight: 1.6, padding: '4px 0' }}>
        <div>view.id · {view.id}</div>
        <div>decode · 0.8 ms</div>
        <div>render · 2.1 ms</div>
        <div>fps · 58 / 60</div>
      </div>
    </div>
  );
};

const SectionLabel = ({ children }) => {
  const t = useTheme();
  return (
    <div style={{
      fontSize: 9.5, color: t.textMuted, textTransform: 'uppercase',
      letterSpacing: 0.6, fontWeight: 700, marginBottom: 6,
    }}>{children}</div>
  );
};

const slotColor = (slot, t) => ({ R: '#e06c6c', G: '#6cc17a', B: '#6c9eff' }[slot] || t.text);

// ---------------------------------------------------------------------------
// BandPicker — 5-band chip row, gated by gain class
// ---------------------------------------------------------------------------
const BandPicker = ({ gc, value, onChange, fullWidth }) => {
  const t = useTheme();
  return (
    <div style={{ display: 'flex', gap: 3, flex: fullWidth ? 1 : undefined, flexWrap: 'wrap' }}>
      {BANDS.map(b => {
        const active = b === value;
        return (
          <button key={b} onClick={() => onChange(b)} style={{
            padding: '4px 0', minWidth: fullWidth ? 0 : 32, flex: fullWidth ? 1 : undefined,
            background: active ? t.accentSoft : 'transparent',
            color: active ? t.accent : t.textMuted,
            border: `1px solid ${active ? t.accent : t.chipBorder}`,
            borderRadius: 3, cursor: 'pointer',
            fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3,
            fontFamily: 'ui-monospace, Menlo, monospace',
          }}>
            <span style={{ color: active ? t.accent : t.textFaint, opacity: 0.65, marginRight: 2, fontSize: 9 }}>{gc}-</span>{b}
          </button>
        );
      })}
    </div>
  );
};

const InspectorSection = ({ title, children, defaultOpen = false }) => {
  const t = useTheme();
  const [open, setOpen] = useStateP(defaultOpen);
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 5, background: t.panel, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6,
        background: 'transparent', border: 'none', cursor: 'pointer', color: t.text,
        fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', fontFamily: 'inherit',
      }}>
        <Icon name="chevron" size={9} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: t.textFaint }} />
        {title}
      </button>
      {open && <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: `1px solid ${t.border}` }}>{children}</div>}
    </div>
  );
};

const MiniHistogram = ({ view }) => {
  const t = useTheme();
  const band = (view?.channel || '').split('-').pop();
  const color = CHANNEL_COLORS[band] || t.accent;
  const bars = useMemoP(() => {
    const seed = hashSeed(view.id + view.channel);
    const rnd = mulberry32(seed);
    const arr = [];
    for (let i = 0; i < 48; i++) {
      const x = i / 47;
      const peak = Math.exp(-Math.pow((x - 0.35) * 3, 2)) + 0.5 * Math.exp(-Math.pow((x - 0.72) * 6, 2));
      arr.push(peak * (0.85 + rnd() * 0.3));
    }
    return arr;
  }, [view.id, view.channel]);
  const max = Math.max(...bars);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 48 }}>
        {bars.map((v, i) => (
          <div key={i} style={{ flex: 1, height: `${(v / max) * 100}%`, background: color, opacity: 0.6, borderRadius: '1px 1px 0 0' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9.5, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        <span>0</span><span>pixel value</span><span>4095</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TimelineStrip
// ---------------------------------------------------------------------------
const TimelineStrip = ({ stream, frame, setFrame, playing, setPlaying, range, setRange, lockedFrames }) => {
  const t = useTheme();
  const totalFrames = stream?.totalFrames || 1;
  const fps = stream?.fps || 30;
  const trackRef = useRefP(null);
  const [scrubbing, setScrubbing] = useStateP(false);
  const [hoverPct, setHoverPct] = useStateP(null);

  const step = (n) => setFrame?.(Math.max(0, Math.min(totalFrames - 1, (frame || 0) + n)));

  const frameFromClient = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect(); if (!rect) return 0;
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return Math.round((x / rect.width) * (totalFrames - 1));
  };

  const onTrackDown = (e) => {
    setScrubbing(true);
    setFrame?.(frameFromClient(e.clientX));
    const up = () => { setScrubbing(false); window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    const mv = (ev) => setFrame?.(frameFromClient(ev.clientX));
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const onTrackMove = (e) => {
    const rect = trackRef.current?.getBoundingClientRect(); if (!rect) return;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverPct(x / rect.width);
  };

  const framePct = (frame / Math.max(1, totalFrames - 1)) * 100;
  const curFile = stream && frameToFile(stream, frame)?.file;

  return (
    <div style={{ background: t.panel, borderTop: `1px solid ${t.border}`, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Single unified track */}
      <div style={{ padding: '8px 12px 6px', position: 'relative' }}>
        <div
          ref={trackRef}
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onPointerLeave={() => setHoverPct(null)}
          style={{
            height: 30, position: 'relative', cursor: scrubbing ? 'grabbing' : 'pointer',
            background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 3,
            userSelect: 'none', overflow: 'hidden',
          }}
        >
          {/* File boundaries shading */}
          {stream?.boundaries.map((b, i) => {
            const leftPct = (b.startFrame / totalFrames) * 100;
            const widthPct = ((b.endFrame - b.startFrame) / totalFrames) * 100;
            return (
              <div key={i} style={{
                position: 'absolute', top: 0, bottom: 0,
                left: `${leftPct}%`, width: `${widthPct}%`,
                background: i % 2 === 0 ? 'rgba(74, 158, 255, 0.055)' : 'transparent',
                borderRight: i < stream.boundaries.length - 1 ? `1px dashed ${t.chipBorder}` : 'none',
              }} />
            );
          })}
          {/* Tick marks at evenly spaced frame counts */}
          {Array.from({ length: 11 }).map((_, i) => (
            <div key={i} style={{
              position: 'absolute', left: `${i * 10}%`, top: 0, bottom: 0, width: 1,
              background: i === 0 || i === 10 ? 'transparent' : t.chipBorder, opacity: 0.5,
            }} />
          ))}
          {/* Range select */}
          {range && (
            <div style={{
              position: 'absolute', top: 2, bottom: 2,
              left: `${(range[0] / totalFrames) * 100}%`,
              width: `${((range[1] - range[0]) / totalFrames) * 100}%`,
              background: 'rgba(74, 158, 255, 0.12)',
              border: `1px solid ${t.accent}`, borderRadius: 2,
            }} />
          )}
          {/* Locked-view pins */}
          {(lockedFrames || []).map((lf, i) => (
            <div key={i} title={`Locked @ f${lf}`} style={{
              position: 'absolute', top: 0, bottom: 0,
              left: `${(lf / Math.max(1, totalFrames - 1)) * 100}%`,
              width: 2, background: t.warn, transform: 'translateX(-1px)', pointerEvents: 'none',
            }}>
              <div style={{ position: 'absolute', top: 0, left: -3, width: 8, height: 4, background: t.warn, borderRadius: 1 }} />
            </div>
          ))}
          {/* Playhead */}
          <div style={{
            position: 'absolute', top: -2, bottom: -2,
            left: `${framePct}%`, width: 2, background: t.accent, transform: 'translateX(-1px)',
            pointerEvents: 'none', boxShadow: scrubbing ? `0 0 0 3px ${t.accentSoft}` : 'none',
          }}>
            <div style={{ position: 'absolute', top: -5, left: -4, width: 10, height: 10, borderRadius: '50%', background: t.accent, border: '2px solid #fff' }} />
          </div>
          {/* Hover preview line */}
          {hoverPct != null && !scrubbing && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: `${hoverPct * 100}%`,
              width: 1, background: t.text, opacity: 0.25, pointerEvents: 'none',
            }} />
          )}
          {/* Hover tooltip */}
          {hoverPct != null && !scrubbing && (
            <div style={{
              position: 'absolute', bottom: '100%', left: `${hoverPct * 100}%`, transform: 'translateX(-50%)',
              marginBottom: 4, padding: '2px 6px',
              background: t.panel, color: t.text, border: `1px solid ${t.border}`, borderRadius: 3,
              fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', pointerEvents: 'none', whiteSpace: 'nowrap',
            }}>
              f{Math.round(hoverPct * (totalFrames - 1))} · {fmtTime(hoverPct * (totalFrames - 1) / fps)}
            </div>
          )}
        </div>

        {/* File labels under track */}
        {stream?.boundaries && stream.boundaries.length > 1 && (
          <div style={{ position: 'relative', height: 12, marginTop: 3 }}>
            {stream.boundaries.map((b, i) => (
              <div key={i} style={{
                position: 'absolute', left: `${(b.startFrame / totalFrames) * 100}%`,
                fontSize: 9, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace',
                paddingLeft: 2, whiteSpace: 'nowrap',
              }}>f{b.startFrame}</div>
            ))}
          </div>
        )}
      </div>

      {/* Transport row */}
      <div style={{
        height: 32, padding: '0 12px', display: 'flex', alignItems: 'center', gap: 4,
        color: t.text, fontSize: 11, borderTop: `1px solid ${t.border}`, background: t.panelAlt,
      }}>
        <button onClick={() => setFrame?.(0)} title="First frame" style={tlBtn(t)}><Icon name="first" size={11} /></button>
        <button onClick={() => step(-1)} title="Previous frame (←)" style={tlBtn(t)}><Icon name="prev" size={11} /></button>
        <button onClick={() => setPlaying?.(!playing)} title={playing ? 'Pause (Space)' : 'Play (Space)'}
          style={{ ...tlBtn(t), background: t.accent, color: '#fff', width: 30, borderColor: t.accent }}>
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <button onClick={() => step(1)} title="Next frame (→)" style={tlBtn(t)}><Icon name="next" size={11} /></button>
        <button onClick={() => setFrame?.(totalFrames - 1)} title="Last frame" style={tlBtn(t)}><Icon name="last" size={11} /></button>

        <div style={{ width: 1, height: 18, background: t.border, margin: '0 6px' }} />

        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: t.textMuted, fontSize: 10.5 }}>f</span>
        <input
          value={frame}
          onChange={(e) => setFrame?.(Math.max(0, Math.min(totalFrames - 1, Number(e.target.value) || 0)))}
          style={{
            width: 58, padding: '3px 6px', background: t.inputBg, color: t.text,
            border: `1px solid ${t.chipBorder}`, borderRadius: 3,
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 10.5,
          }}
        />
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint, fontSize: 10.5 }}>/ {totalFrames - 1}</span>
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: t.textMuted, fontSize: 10.5, marginLeft: 10 }}>
          {fmtTime(frame / fps)}
        </span>

        {curFile && (
          <>
            <div style={{ width: 1, height: 18, background: t.border, margin: '0 8px' }} />
            <span style={{ fontSize: 10, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
              {curFile.name}
            </span>
          </>
        )}

        <div style={{ flex: 1, minWidth: 8 }} />

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9.5, color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.4 }}>Speed</span>
          <Select value="1" options={[{ value: '0.25', label: '¼×' }, { value: '0.5', label: '½×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '4', label: '4×' }]} onChange={() => {}} />
        </div>
      </div>
    </div>
  );
};

const tlBtn = (t) => ({
  width: 24, height: 22, border: `1px solid ${t.chipBorder}`, background: t.panel, color: t.text,
  borderRadius: 3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
});

// ---------------------------------------------------------------------------
// StreamHeader — B region · slim, focused row
// ---------------------------------------------------------------------------
const StreamHeader = ({ stream, warnings, onOpenBuilder, onOpenWarnings, onExportImage, onExportVideo }) => {
  const t = useTheme();
  const [exportOpen, setExportOpen] = useStateP(false);
  useEffectP(() => {
    if (!exportOpen) return;
    const close = () => setExportOpen(false);
    const h = setTimeout(() => document.addEventListener('click', close, { once: true }), 30);
    return () => { clearTimeout(h); document.removeEventListener('click', close); };
  }, [exportOpen]);

  return (
    <div style={{
      height: 36, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8,
      borderBottom: `1px solid ${t.border}`, background: t.panel, flexShrink: 0, whiteSpace: 'nowrap', minWidth: 0,
    }}>
      <StreamChip stream={stream} onOpenBuilder={onOpenBuilder} warnings={warnings} />
      {warnings > 0 && (
        <button onClick={onOpenWarnings} title={`${warnings} warning${warnings > 1 ? 's' : ''}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px',
          background: 'rgba(197, 127, 0, 0.10)', color: t.warn, border: `1px solid ${t.warn}`,
          borderRadius: 3, cursor: 'pointer', fontSize: 10.5, fontFamily: 'inherit', fontWeight: 600,
        }}>
          <Icon name="warning" size={10} /> {warnings}
        </button>
      )}
      <div style={{ flex: 1, minWidth: 4 }} />
      <div style={{ position: 'relative' }}>
        <button onClick={(e) => { e.stopPropagation(); setExportOpen(o => !o); }} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
          background: t.accent, color: '#fff', border: `1px solid ${t.accent}`, borderRadius: 4,
          cursor: 'pointer', fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
        }}>
          <Icon name="download" size={11} /> Export <Icon name="chevron" size={9} style={{ transform: 'rotate(90deg)', opacity: 0.8 }} />
        </button>
        {exportOpen && (
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 180,
            background: t.panel, border: `1px solid ${t.border}`, borderRadius: 5,
            boxShadow: t.shadowLg, padding: 4, zIndex: 40,
          }}>
            <button onClick={() => { setExportOpen(false); onExportImage?.(); }} style={exportRowStyle(t)}>
              <Icon name="image" size={12} /> <span style={{ flex: 1 }}>Image…</span>
              <span style={{ color: t.textFaint, fontSize: 10 }}>PNG · TIFF</span>
            </button>
            <button onClick={() => { setExportOpen(false); onExportVideo?.(); }} style={exportRowStyle(t)}>
              <Icon name="film" size={12} /> <span style={{ flex: 1 }}>Video…</span>
              <span style={{ color: t.textFaint, fontSize: 10 }}>MP4 · GIF</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const exportRowStyle = (t) => ({
  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  padding: '6px 10px', background: 'transparent', color: t.text,
  border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11.5, fontFamily: 'inherit', textAlign: 'left',
});

Object.assign(window, {
  ProcessingBadge, BADGE_DEFS, badgesFor,
  ViewerCanvas, ViewerCard, ViewerGrid,
  StreamChip, StreamHeader,
  FilePill, DarkFrameRow, SourcesPanel,
  Inspector, InspectorSection, MiniHistogram,
  TimelineStrip,
  hashSeed, bandInfo, drawField, drawOverlay,
});
