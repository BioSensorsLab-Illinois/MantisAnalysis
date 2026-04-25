// Playback modals — Stream Builder, Overlay Builder, Export Image, Export Video, Warning Center
// MantisAnalysis · BioSensors Lab @ UIUC
const { useState: useStateM, useEffect: useEffectM, useMemo: useMemoM } = React;

// ---------------------------------------------------------------------------
// Stream Builder Modal
// ---------------------------------------------------------------------------
const StreamBuilderModal = ({ stream, onClose, onChange }) => {
  const t = useTheme();
  const files = stream?.allFiles || [];
  const [ordering, setOrdering] = useStateM('filename'); // filename | timestamp
  const [threshold, setThreshold] = useStateM(stream?.continuityThresholdSec ?? 1.0);

  return (
    <Modal onClose={onClose} width={760} label="Stream Builder" padding={0}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="stack" size={18} style={{ color: t.accent }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Stream Builder</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            {files.length} file{files.length !== 1 ? 's' : ''} · {stream?.totalFrames || 0} frames · {fmtDuration(stream?.totalDuration)}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} title="Close" style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 6 }}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 260px', gap: 20, maxHeight: '70vh', overflow: 'auto' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600 }}>Files in stream</div>
            <div style={{ flex: 1 }} />
            <Button icon="plus" size="sm">Add file…</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f, i) => <StreamBuilderRow key={f.id} file={f} index={i} baseExposure={stream?.baseExposureMs} />)}
          </div>

          <div style={{ marginTop: 14, padding: 10, background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 5 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.text, marginBottom: 6 }}>Continuity</div>
            <div style={{ fontSize: 10.5, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {stream?.issues?.gapCount > 0 && <div style={{ color: t.warn }}>• {stream.issues.gapCount} gap{stream.issues.gapCount > 1 ? 's' : ''} above {threshold.toFixed(1)} s threshold</div>}
              {stream?.issues?.overlapCount > 0 && <div style={{ color: t.warn }}>• {stream.issues.overlapCount} overlap region{stream.issues.overlapCount > 1 ? 's' : ''}</div>}
              {stream?.issues?.expMismatchCount > 0 && <div style={{ color: t.warn }}>• {stream.issues.expMismatchCount} exposure mismatch{stream.issues.expMismatchCount > 1 ? 'es' : ''} vs {stream.baseExposureMs} ms base</div>}
              {!(stream?.issues?.gapCount + stream?.issues?.overlapCount + stream?.issues?.expMismatchCount) && <div style={{ color: t.success }}>• No continuity issues detected</div>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>Ordering</div>
            <Segmented value={ordering} options={[{ value: 'filename', label: 'Filename' }, { value: 'timestamp', label: 'Timestamp' }]} onChange={setOrdering} fullWidth />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>Continuity threshold</div>
            <Slider label="Gap tolerance" min={0.1} max={5} step={0.1} value={threshold} onChange={setThreshold} format={v => v.toFixed(1)} unit="s" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 6 }}>Base reference</div>
            <div style={{ padding: '6px 8px', background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 11, color: t.text, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              {files[0]?.name || '—'}
              <div style={{ color: t.textMuted, fontSize: 10, marginTop: 2 }}>
                {stream?.width}×{stream?.height} · {stream?.baseExposureMs} ms · {stream?.fps} fps
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onClose}>Apply</Button>
      </div>
    </Modal>
  );
};

const StreamBuilderRow = ({ file, index, baseExposure }) => {
  const t = useTheme();
  const mismatch = baseExposure != null && file.exposureMs !== baseExposure;
  const warn = (file.warnings || []).length > 0;
  return (
    <div style={{
      border: `1px solid ${warn || mismatch ? t.warn : t.border}`, borderRadius: 5,
      background: t.panel, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
    }}>
      <Icon name="drag" size={12} style={{ color: t.textFaint, cursor: 'grab' }} />
      <span style={{ width: 18, textAlign: 'center', fontSize: 10, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace' }}>{index + 1}</span>
      <Icon name="file" size={14} style={{ color: t.textMuted }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</div>
        <div style={{ fontSize: 10, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 2, display: 'flex', gap: 8 }}>
          <span>{file.frames} fr</span>
          <span>·</span>
          <span>{file.width}×{file.height}</span>
          <span>·</span>
          <span>{file.fps} fps</span>
          <span>·</span>
          <span style={{ color: mismatch ? t.warn : 'inherit' }}>{file.exposureMs} ms</span>
        </div>
      </div>
      <div style={{ fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textMuted, textAlign: 'right' }}>
        <div>{fmtTime(file.tsStart)}</div>
        <div>→ {fmtTime(file.tsEnd)}</div>
      </div>
      {(file.warnings || []).map(w => (
        <span key={w} title={WARNINGS[w]?.text(file) || w} style={{ color: t.warn, display: 'inline-flex' }}>
          <Icon name="warning" size={13} />
        </span>
      ))}
      <button title="Remove" style={{ background: 'none', border: 'none', color: t.textFaint, cursor: 'pointer', padding: 4 }}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Overlay Builder Modal
// ---------------------------------------------------------------------------
const OverlayBuilderModal = ({ view, onClose, onApply }) => {
  const t = useTheme();
  const ov = view?.overlay || { channel: 'HG-NIR', low: 300, high: 900, blendMode: 'alpha', strength: 0.65, belowThr: 'hide', aboveThr: 'saturate', overlayColormap: 'inferno' };
  const [state, setState] = useStateM(ov);
  const set = (k, v) => setState(s => ({ ...s, [k]: v }));

  return (
    <Modal onClose={onClose} width={720} label="Overlay Builder" padding={0}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="layers" size={18} style={{ color: t.accent }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Overlay Builder</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>on <strong>{view?.name || 'view'}</strong> · base {view?.channel}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 6 }}><Icon name="close" size={14} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 0 }}>
        {/* Preview canvas */}
        <div style={{ background: '#0a0a0a', minHeight: 340, position: 'relative', overflow: 'hidden' }}>
          <OverlayPreview view={view} overlayState={state} />
          <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', gap: 6 }}>
            <span style={{ padding: '3px 8px', background: 'rgba(14,16,20,0.8)', color: '#e8eaed', fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', borderRadius: 3 }}>base: {view?.channel}</span>
            <span style={{ padding: '3px 8px', background: 'rgba(74,158,255,0.25)', color: '#b8d4ff', fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', borderRadius: 3 }}>overlay: {state.channel}</span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ padding: 14, borderLeft: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflow: 'auto' }}>
          <Row label="Source">
            <Select value={state.channel} options={ALL_CHANNELS.map(c => ({ value: c, label: c }))} onChange={v => set('channel', v)} />
          </Row>
          <Slider label="Threshold low" min={0} max={1023} step={1} value={state.low} onChange={v => set('low', v)} format={v => v.toFixed(0)} />
          <Slider label="Threshold high" min={0} max={4095} step={1} value={state.high} onChange={v => set('high', v)} format={v => v.toFixed(0)} />
          <Row label="Below thr"><Segmented value={state.belowThr} options={[{ value: 'hide', label: 'Hide' }, { value: 'clamp', label: 'Clamp' }]} onChange={v => set('belowThr', v)} /></Row>
          <Row label="Above thr"><Segmented value={state.aboveThr} options={[{ value: 'saturate', label: 'Saturate' }, { value: 'clamp', label: 'Clamp' }]} onChange={v => set('aboveThr', v)} /></Row>
          <Row label="Blend">
            <Select value={state.blendMode} options={BLEND_MODES} onChange={v => set('blendMode', v)} />
          </Row>
          <Slider label="Strength" min={0} max={1} step={0.01} value={state.strength} onChange={v => set('strength', v)} format={v => (v * 100).toFixed(0) + '%'} />
          <Row label="Colormap">
            <Select value={state.overlayColormap} options={COLORMAPS.map(c => ({ value: c, label: c }))} onChange={v => set('overlayColormap', v)} />
          </Row>
        </div>
      </div>

      <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { onApply?.(state); onClose(); }}>Apply</Button>
      </div>
    </Modal>
  );
};

const OverlayPreview = ({ view, overlayState }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const c = ref.current; if (!c) return;
    const rect = c.parentElement.getBoundingClientRect();
    const w = Math.max(300, rect.width), h = Math.max(340, rect.height);
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const seed = hashSeed((view?.id || 'v') + (view?.channel || ''));
    drawField(ctx, w, h, seed, bandInfo(view || {}));
    const tmpView = { ...(view || {}), overlay: overlayState, overlayEnabled: true };
    drawOverlay(ctx, w, h, seed, tmpView);
  }, [view, overlayState]);
  return <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />;
};

// ---------------------------------------------------------------------------
// Export Image Modal
// ---------------------------------------------------------------------------
const ExportImageModal = ({ views, stream, frame, onClose }) => {
  const t = useTheme();
  const [format, setFormat] = useStateM('png');
  const [scope, setScope] = useStateM('allVisible'); // selected | allVisible | allIncluded
  const [includeLabels, setIncludeLabels] = useStateM(true);
  const [includeBadges, setIncludeBadges] = useStateM(true);
  const [compose, setCompose] = useStateM('contactSheet'); // single | contactSheet | grid
  const [bitDepth, setBitDepth] = useStateM('8');

  const includedViews = scope === 'selected' ? views.slice(0, 1) : scope === 'allVisible' ? views : views.filter(v => v.exportInclude);

  return (
    <Modal onClose={onClose} width={720} label="Export Image" padding={0}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="image" size={18} style={{ color: t.accent }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Export image</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>frame {frame} · {fmtTime((frame||0)/30)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 6 }}><Icon name="close" size={14} /></button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0 }}>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, borderRight: `1px solid ${t.border}` }}>
          <Row label="Scope">
            <Select value={scope} options={[
              { value: 'selected', label: 'Selected view only' },
              { value: 'allVisible', label: 'All visible views' },
              { value: 'allIncluded', label: 'All views flagged for export' },
            ]} onChange={setScope} />
          </Row>
          <Row label="Format">
            <Segmented value={format} options={['png', 'tif', 'exr']} onChange={setFormat} />
          </Row>
          {format === 'tif' && (
            <Row label="Bit depth">
              <Segmented value={bitDepth} options={[{ value: '8', label: '8-bit' }, { value: '16', label: '16-bit' }]} onChange={setBitDepth} />
            </Row>
          )}
          <Row label="Compose">
            <Select value={compose} options={[
              { value: 'single', label: 'Single image (overlay flat)' },
              { value: 'contactSheet', label: 'Contact sheet (all views, labeled)' },
              { value: 'grid', label: 'Grid (match screen layout)' },
            ]} onChange={setCompose} />
          </Row>
          <Row label="Labels"><Checkbox checked={includeLabels} onChange={setIncludeLabels} label="Burn in labels (timestamp, frame, channel)" /></Row>
          <Row label="Badges"><Checkbox checked={includeBadges} onChange={setIncludeBadges} label="Include processing badges in metadata" /></Row>
          <div style={{ padding: 8, background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 4, fontSize: 10.5, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.5 }}>
            <div style={{ color: t.text, fontWeight: 600, marginBottom: 4, fontFamily: 'inherit', fontSize: 11 }}>Sidecar JSON</div>
            <div>stream · {stream?.name}</div>
            <div>frame · {frame} (ts {fmtTime((frame||0)/30)})</div>
            <div>views · {includedViews.length}</div>
            <div>build · {BRAND.version}</div>
          </div>
        </div>

        <div style={{ padding: 14, background: t.panelAlt }}>
          <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600, marginBottom: 8 }}>Preview</div>
          <div style={{
            background: '#0a0a0a', borderRadius: 5, padding: 10, display: 'grid',
            gridTemplateColumns: includedViews.length > 1 ? '1fr 1fr' : '1fr',
            gap: 6, minHeight: 280,
          }}>
            {includedViews.slice(0, 4).map(v => (
              <div key={v.id} style={{ aspectRatio: '16/10', background: '#101317', border: `1px solid ${t.border}`, borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0 }}>
                  <ViewerCanvas view={v} frame={frame} width={300} height={188} />
                </div>
                {includeLabels && (
                  <div style={{ position: 'absolute', left: 4, bottom: 4, padding: '2px 5px', background: 'rgba(0,0,0,0.7)', color: '#e8eaed', fontSize: 9, fontFamily: 'ui-monospace, Menlo, monospace', borderRadius: 2 }}>
                    {v.name} · {v.channel}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 11, color: t.textMuted }}>
          {includedViews.length} view{includedViews.length !== 1 ? 's' : ''} · estimated size ~{(1.8 * includedViews.length).toFixed(1)} MB
        </div>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="download" onClick={onClose}>Export</Button>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Export Video Modal
// ---------------------------------------------------------------------------
const ExportVideoModal = ({ views, stream, range, onClose }) => {
  const t = useTheme();
  const [format, setFormat] = useStateM('mp4'); // mp4 | png-seq | apng
  const [fps, setFps] = useStateM('30');
  const [quality, setQuality] = useStateM('high');
  const [scope, setScope] = useStateM('allIncluded');
  const [includeLabels, setIncludeLabels] = useStateM(true);
  const [stage, setStage] = useStateM('setup'); // setup | progress | done
  const [progress, setProgress] = useStateM(0);
  const r = range || [0, (stream?.totalFrames || 1) - 1];
  const frames = r[1] - r[0] + 1;
  const dur = frames / Number(fps);
  const includedViews = scope === 'selected' ? views.slice(0, 1) : scope === 'allVisible' ? views : views.filter(v => v.exportInclude);
  const estMB = ((frames / 60) * includedViews.length * (quality === 'high' ? 12 : quality === 'med' ? 5 : 1.5)).toFixed(0);

  useEffectM(() => {
    if (stage !== 'progress') return;
    const id = setInterval(() => setProgress(p => {
      if (p >= 1) { setStage('done'); return 1; }
      return Math.min(1, p + 0.03);
    }), 120);
    return () => clearInterval(id);
  }, [stage]);

  const longExport = frames > 5000;

  return (
    <Modal onClose={onClose} width={700} label="Export Video" padding={0}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="film" size={18} style={{ color: t.accent }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Export video</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            frames {r[0]} → {r[1]} · {frames} fr · {dur.toFixed(1)} s at {fps} fps
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 6 }}><Icon name="close" size={14} /></button>
      </div>

      {stage === 'setup' && (
        <>
          <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Row label="Format">
              <Segmented value={format} options={[{ value: 'mp4', label: 'MP4' }, { value: 'png-seq', label: 'PNG seq' }, { value: 'apng', label: 'APNG' }]} onChange={setFormat} />
            </Row>
            <Row label="FPS">
              <Segmented value={fps} options={['24', '30', '60']} onChange={setFps} />
            </Row>
            <Row label="Quality">
              <Segmented value={quality} options={[{ value: 'low', label: 'Low' }, { value: 'med', label: 'Med' }, { value: 'high', label: 'High' }]} onChange={setQuality} />
            </Row>
            <Row label="Scope">
              <Select value={scope} options={[
                { value: 'selected', label: 'Selected view' },
                { value: 'allVisible', label: 'All visible' },
                { value: 'allIncluded', label: 'Flagged for export' },
              ]} onChange={setScope} />
            </Row>
            <Row label="Labels"><Checkbox checked={includeLabels} onChange={setIncludeLabels} label="Burn in timestamp / frame / channel" /></Row>
            <Row label="Range">
              <div style={{ fontSize: 11, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                [{r[0]}, {r[1]}] · timeline selection
              </div>
            </Row>
          </div>

          {longExport && (
            <div style={{ margin: '0 16px', padding: 10, background: 'rgba(197, 127, 0, 0.1)', border: `1px solid ${t.warn}`, borderRadius: 4, color: t.warn, fontSize: 11, display: 'flex', gap: 8 }}>
              <Icon name="warning" size={14} style={{ flexShrink: 0 }} />
              <div>Export covers {frames} frames (~{(dur / 60).toFixed(1)} min). This may take a while.</div>
            </div>
          )}

          <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', fontSize: 11, color: t.textMuted }}>
            <div>Estimated size ~{estMB} MB · {includedViews.length} view{includedViews.length !== 1 ? 's' : ''} · ETA ~{Math.ceil(frames / 60)} s</div>
          </div>

          <div style={{ padding: '12px 18px', borderTop: `1px solid ${t.border}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon="download" onClick={() => { setProgress(0); setStage('progress'); }}>Start export</Button>
          </div>
        </>
      )}

      {stage === 'progress' && (
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 12, color: t.text, marginBottom: 10 }}>Rendering frame {Math.floor(r[0] + (r[1] - r[0]) * progress)} / {r[1]}</div>
          <div style={{ height: 10, background: t.panelAlt, border: `1px solid ${t.border}`, borderRadius: 5, overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ width: `${progress * 100}%`, height: '100%', background: t.accent, transition: 'width 120ms linear' }} />
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', display: 'flex', gap: 14 }}>
            <span>{(progress * 100).toFixed(0)}%</span>
            <span>ETA {Math.ceil((1 - progress) * frames / 60)} s</span>
            <span>decode 0.8 ms</span>
            <span>encode 12 ms</span>
          </div>
          <div style={{ padding: '24px 0 0', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setStage('setup')}>Cancel</Button>
          </div>
        </div>
      )}

      {stage === 'done' && (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: t.success, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            <Icon name="check" size={22} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 4 }}>Export complete</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 16 }}>{frames} frames · {format.toUpperCase()} · {estMB} MB</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" icon="open">Reveal in folder</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Warning Center Modal
// ---------------------------------------------------------------------------
const WarningCenter = ({ warnings, onClose, onFocusFile }) => {
  const t = useTheme();
  const [filter, setFilter] = useStateM('all');
  const items = (warnings || []).filter(w => filter === 'all' || w.severity === filter);
  const sevColor = { info: t.accent, warning: t.warn, error: t.danger };
  const sevBg = { info: t.accentSoft, warning: 'rgba(197, 127, 0, 0.12)', error: 'rgba(207, 34, 46, 0.12)' };

  return (
    <Modal onClose={onClose} width={620} label="Warnings" padding={0}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="warning" size={18} style={{ color: t.warn }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>Warning Center</div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>{warnings?.length || 0} total</div>
        </div>
        <div style={{ flex: 1 }} />
        <Segmented value={filter} options={['all', 'info', 'warning', 'error']} onChange={setFilter} />
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 6, marginLeft: 4 }}><Icon name="close" size={14} /></button>
      </div>

      <div style={{ padding: 14, maxHeight: '60vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && (
          <div style={{ padding: 28, textAlign: 'center', color: t.textFaint, fontSize: 12 }}>No items at this severity.</div>
        )}
        {items.map((w, i) => (
          <div key={i} style={{
            padding: '10px 12px', background: sevBg[w.severity] || t.panelAlt,
            borderLeft: `3px solid ${sevColor[w.severity] || t.border}`, borderRadius: 4,
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span style={{ padding: '1px 5px', background: sevColor[w.severity], color: '#fff', borderRadius: 3, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 1 }}>
              {w.severity}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}>{w.text}</div>
              <div style={{ fontSize: 10, color: t.textMuted, fontFamily: 'ui-monospace, Menlo, monospace', marginTop: 3 }}>
                <span>{w.code}</span>
                {w.fileId && <span> · {w.fileId}</span>}
                {w.viewId && <span> · {w.viewId}</span>}
              </div>
            </div>
            {w.fileId && <button onClick={() => onFocusFile?.(w.fileId)} style={{ padding: '3px 8px', background: 'transparent', color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 3, cursor: 'pointer', fontSize: 10.5, fontFamily: 'inherit' }}>Focus</button>}
          </div>
        ))}
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Empty state hero
// ---------------------------------------------------------------------------
const PlaybackEmptyState = ({ onOpenFile, onOpenFolder }) => {
  const t = useTheme();
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg, padding: 40 }}>
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, borderRadius: 14, background: `linear-gradient(135deg, ${t.accent}, ${t.accentHover})`, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
          <Icon name="film" size={32} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: t.text, marginBottom: 8 }}>Open a recording to begin</div>
        <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55, marginBottom: 22 }}>
          Load one or more HDF5 recordings from the Mantis bench. Playback will infer channels, timestamps,
          and exposure automatically. Drag additional files into the Sources panel to extend the stream.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
          <Button variant="primary" icon="open" size="md" onClick={onOpenFile}>Open recording</Button>
          <Button icon="upload" size="md" onClick={onOpenFolder}>Open folder…</Button>
        </div>
        <div style={{ padding: 14, background: t.panel, border: `1px dashed ${t.borderStrong}`, borderRadius: 6, color: t.textMuted, fontSize: 12 }}>
          Drop <kbd>.h5</kbd> files here to build a stream.
        </div>
        <div style={{ marginTop: 20, fontSize: 11, color: t.textFaint, display: 'flex', gap: 16, justifyContent: 'center' }}>
          <span><Kbd>⌘</Kbd> <Kbd>O</Kbd> open</span>
          <span><Kbd>Space</Kbd> play / pause</span>
          <span><Kbd>←</Kbd> <Kbd>→</Kbd> step frame</span>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, {
  StreamBuilderModal, OverlayBuilderModal,
  ExportImageModal, ExportVideoModal,
  WarningCenter, PlaybackEmptyState,
});
