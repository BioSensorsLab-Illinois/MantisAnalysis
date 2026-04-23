// FPN Analysis mode — server-backed, full feature set.
//
// Design goals (matches USAF parity, then goes further):
//   * Rulers + zoom-to-cursor pan + rotation-aware rendering.
//   * Multi-ROI picking with a sortable table, CSV export, live stats card.
//   * ISP + drift-plane + hot/cold-sigma live-apply cards.
//   * Display-only colormap / brightness / contrast / gamma (CSS).
//   * JSON save/load round-trips the full picker / display / ISP / ROI state.
//   * Keyboard shortcuts: Space pan, wheel zoom, R rotate, F fit,
//       ⌘Z undo, Del/Backspace delete selection, ⌘A select all.
//   * Per-ROI live stats via /api/fpn/compute on debounce; per-ROI full
//       arrays via /api/fpn/measure when selected; stability curve via
//       /api/fpn/stability; Run analysis hits /api/fpn/analyze for the
//       multi-tab native-chart modal.
//
// BioSensors Lab · UIUC · Zhongmin Zhu <j@polarxphotonics.com>

const { useState: useStateF, useEffect: useEffectF, useRef: useRefF,
        useMemo: useMemoF, useCallback: useCallbackF } = React;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Normalize a channel name so the ChannelChip swatch parser works across
// RGB / grayscale / H5 sources. L = luminance (grayscale) → show as Y swatch.
const fpnChipId = (c) => c.includes('-') ? c : (c === 'L' ? 'HG-Y' : `HG-${c}`);

// Default canonical ROI colour palette (stable per-ROI visual identity).
const ROI_COLORS = ['#ffd54f', '#4a9eff', '#22c55e', '#ef4444',
                    '#a855f7', '#f97316', '#14b8a6', '#f43f5e'];
const roiColor = (i) => ROI_COLORS[i % ROI_COLORS.length];

const genROIId = () => 'r' + Date.now().toString(36) + '_' +
                      Math.floor(Math.random() * 1e4).toString(36);

// Format a DN value compactly: small numbers get 2 decimals, large get 0.
const fmtDN = (v) => !Number.isFinite(v) ? '—'
                   : Math.abs(v) < 10 ? v.toFixed(3)
                   : Math.abs(v) < 1000 ? v.toFixed(2)
                   : v.toFixed(0);

// Collapse a floating-point fraction into 3-sig-digit human form.
const fmtPct = (v) => !Number.isFinite(v) ? '—' : `${v.toFixed(3)} %`;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const FPNMode = ({ onRunAnalysis, onStatusChange, say, onSwitchSource, onOpenFile }) => {
  const t = useTheme();
  const source = useSource();
  const available = source?.channels || [];
  const defaultCh = available.includes('HG-G') ? 'HG-G'
                 : available.includes('G')     ? 'G'
                 : available.includes('L')     ? 'L'
                 : available[0] || null;

  // ---- Source / channel ---------------------------------------------------
  const [activeChannel, setActiveChannel] = useStateF(defaultCh);
  const [analysisChannels, setAnalysisChannels] = useLocalStorageState('fpn/analysisChannels',
    available.some(c => c.startsWith('HG-'))
      ? ['HG-R', 'HG-G', 'HG-B', 'HG-NIR'].filter(c => available.includes(c))
      : available.slice(0, 4));

  // ---- Picking knobs ------------------------------------------------------
  const [driftOrder,   setDriftOrder]   = useLocalStorageState('fpn/driftOrder', 'none');
  const [hotSigma,     setHotSigma]     = useLocalStorageState('fpn/hotSigma', 4.0);
  const [loPct,        setLoPct]        = useLocalStorageState('fpn/loPct', 0.0);
  const [hiPct,        setHiPct]        = useLocalStorageState('fpn/hiPct', 0.0);
  const [medianSize,   setMedianSize]   = useLocalStorageState('fpn/medianSize', 0);
  const [gaussSigma,   setGaussSigma]   = useLocalStorageState('fpn/gaussSigma', 0.0);
  const [hotPixThr,    setHotPixThr]    = useLocalStorageState('fpn/hotPixThr', 0.0);
  const [bilateral,    setBilateral]    = useLocalStorageState('fpn/bilateral', false);

  // ---- View transforms ----------------------------------------------------
  const [rotation, setRotation] = useStateF(0);
  const [flipH,    setFlipH]    = useStateF(false);
  const [flipV,    setFlipV]    = useStateF(false);
  const [zoom,     setZoom]     = useStateF(1);
  const [pan,      setPan]      = useStateF([0, 0]);
  const [tool,     setTool]     = useStateF('pick');    // 'pick' | 'pan'
  const [spacePan, setSpacePan] = useStateF(false);

  // ---- Resizable panels ---------------------------------------------------
  const [leftW,  setLeftW]  = useLocalStorageState('fpn/leftW', 320);
  const [rightW, setRightW] = useLocalStorageState('fpn/rightW', 380);

  // ---- Display (CSS filter; doesn't affect analysis) ----------------------
  const [brightness, setBrightness] = useLocalStorageState('fpn/brightness', 0);
  const [contrast,   setContrast]   = useLocalStorageState('fpn/contrast', 1);
  const [gamma,      setGamma]      = useLocalStorageState('fpn/gamma', 1);
  const [colormap,   setColormap]   = useLocalStorageState('fpn/colormap', 'gray');

  // ---- ROI state ----------------------------------------------------------
  // Each ROI carries geometry (x0..y1) + UI state (label, pending) + its
  // most recent live measurement `m` (from /api/fpn/compute — small summary).
  // The selected ROI additionally gets `full` (from /api/fpn/measure) — the
  // rich payload with row/col profiles and PSDs used by the Profile preview.
  const [rois,         setRois]         = useStateF([]);
  const [selectedIds,  setSelectedIds]  = useStateF(new Set());
  const [sortCol,      setSortCol]      = useStateF('id');
  const [sortDir,      setSortDir]      = useStateF('asc');
  const [drawing,      setDrawing]      = useStateF(null);
  const [cursorReadout,setCursorReadout]= useStateF(null);
  const canvasRef = useRefF(null);

  // ---- Sizing -------------------------------------------------------------
  const [imgDims, setImgDims] = useStateF({ w: source?.shape?.[1] || 720, h: source?.shape?.[0] || 540 });

  // Display vmin/vmax — same pattern as USAF. AUTO uses server defaults
  // (1%/99.5% percentile clip); MANUAL pins the colormap.
  const [vmin, setVmin] = useStateF(null);
  const [vmax, setVmax] = useStateF(null);
  const [autoRange, setAutoRange] = useLocalStorageState('fpn/autoRange', true);
  const [range, setRange] = useStateF(null);

  useEffectF(() => {
    if (!source || !activeChannel) { setRange(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(`/api/sources/${source.source_id}/channel/${encodeURIComponent(activeChannel)}/range`);
        if (cancelled) return;
        setRange(r);
        if (autoRange) { setVmin(r.p1); setVmax(r.p99); }
      } catch { if (!cancelled) setRange(null); }
    })();
    return () => { cancelled = true; };
  }, [source?.source_id, source?.has_dark, activeChannel, autoRange]);

  // Compose the ISP payload from the live FPN smoothing controls so the
  // canvas thumbnail previews the same preprocessing the analysis runs.
  // Only emit fields that are actually active to keep the URL short and
  // the no-ISP fast path on the server intact.
  const imgSrc = useMemoF(() => {
    if (!source || !activeChannel) return null;
    const anyIsp = medianSize >= 3 || gaussSigma > 0.05 || hotPixThr > 0.5 || bilateral;
    const isp = anyIsp ? {
      median_size:    medianSize,
      gaussian_sigma: gaussSigma,
      hot_pixel_thr:  hotPixThr,
      bilateral:      bilateral,
    } : null;
    return channelPngUrl(source.source_id, activeChannel, 1600, isp, colormap,
                         autoRange ? null : vmin, autoRange ? null : vmax);
  }, [source, activeChannel, colormap, autoRange, vmin, vmax,
      medianSize, gaussSigma, hotPixThr, bilateral]);

  // ---- Settings payload (shared across every server call) ----------------
  const settingsPayload = () => ({
    median_size: medianSize,
    gaussian_sigma: gaussSigma,
    hot_pixel_thr: hotPixThr,
    bilateral: bilateral,
    lo_pct: loPct,
    hi_pct: hiPct,
    drift_order: driftOrder,
    hot_sigma: hotSigma,
  });

  // ---- Debounced re-measure on settings change ---------------------------
  const dSettings = useDebounced({ medianSize, gaussSigma, hotPixThr, bilateral,
                                    loPct, hiPct, driftOrder, hotSigma }, 220);

  // ---- Live per-ROI measurement (small-summary /api/fpn/compute) ---------
  const measureOne = useCallbackF(async (roi) => {
    if (!source) return null;
    const body = {
      source_id: source.source_id,
      channel: activeChannel,
      roi: [roi.y0, roi.x0, roi.y1, roi.x1],
      settings: settingsPayload(),
    };
    try { return await apiFetch('/api/fpn/compute', { method: 'POST', body }); }
    catch (err) { return { __error: err.detail || err.message }; }
    // eslint-disable-next-line
  }, [source?.source_id, activeChannel, medianSize, gaussSigma, hotPixThr,
      bilateral, loPct, hiPct, driftOrder, hotSigma]);

  // Re-measure every ROI whenever settings change (debounced).
  // CRITICAL: the snapshot of `rois` captured here can be stale by the time
  // Promise.all resolves — the user may have deleted (or added) ROIs in
  // the meantime. We merge measurements onto the LIVE state via a
  // functional setRois so deleted ROIs stay deleted and concurrent adds
  // aren't overwritten. Without this, deleting an ROI mid-flight would
  // resurrect it when the in-flight measure response landed.
  useEffectF(() => {
    if (!rois.length || !source) return;
    let alive = true;
    (async () => {
      const updated = await Promise.all(rois.map(async (r) => {
        const m = await measureOne(r);
        return { id: r.id,
                 m: m && !m.__error ? m : null,
                 error: m?.__error || null, pending: false };
      }));
      if (!alive) return;
      const updateById = Object.fromEntries(updated.map(u => [u.id, u]));
      setRois(prev => prev.map(r =>
        updateById[r.id] ? { ...r, ...updateById[r.id] } : r));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [activeChannel, dSettings]);

  // ---- Rich fetch for the selected ROI (row/col profiles + PSDs) ---------
  const [selFull, setSelFull] = useStateF(null);
  const [selFullId, setSelFullId] = useStateF(null);
  const selectedLine = rois.find(r => selectedIds.has(r.id)) || null;
  useEffectF(() => {
    if (!source || !selectedLine) { setSelFull(null); setSelFullId(null); return; }
    let alive = true;
    (async () => {
      try {
        const body = {
          source_id: source.source_id, channel: activeChannel,
          roi: [selectedLine.y0, selectedLine.x0, selectedLine.y1, selectedLine.x1],
          settings: settingsPayload(),
        };
        const full = await apiFetch('/api/fpn/measure', { method: 'POST', body });
        if (alive) { setSelFull(full); setSelFullId(selectedLine.id); }
      } catch (err) { if (alive) { setSelFull(null); setSelFullId(null); } }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [source?.source_id, activeChannel, selectedLine?.id, dSettings]);

  // ---- Stability curve for selected ROI ---------------------------------
  const [stabCurve, setStabCurve] = useStateF(null);
  const [stabEnabled, setStabEnabled] = useStateF(false);
  useEffectF(() => {
    if (!stabEnabled || !source || !selectedLine) { setStabCurve(null); return; }
    let alive = true;
    (async () => {
      try {
        const body = {
          source_id: source.source_id, channel: activeChannel,
          roi: [selectedLine.y0, selectedLine.x0, selectedLine.y1, selectedLine.x1],
          n_shrinks: 6, settings: settingsPayload(),
        };
        const resp = await apiFetch('/api/fpn/stability', { method: 'POST', body });
        if (alive) setStabCurve(resp.curve || null);
      } catch { if (alive) setStabCurve(null); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [stabEnabled, source?.source_id, activeChannel, selectedLine?.id, dSettings]);

  // ---- ROI mutation helpers ----------------------------------------------
  // Rapid back-to-back drags can fire before React commits prior setRois
  // state; that'd give both new ROIs the same `ROI-${rois.length+1}` label.
  // We pass through the functional updater so the label uses the current
  // list length *at commit time*.
  const addRoi = async (x0, y0, x1, y1) => {
    if (Math.abs(x1 - x0) < 6 || Math.abs(y1 - y0) < 6) return;
    const xa = Math.min(x0, x1), ya = Math.min(y0, y1);
    const xb = Math.max(x0, x1), yb = Math.max(y0, y1);
    const id = genROIId();
    let roi;
    setRois(prev => {
      roi = { id, x0: xa, y0: ya, x1: xb, y1: yb,
              label: `ROI-${prev.length + 1}`, pending: true };
      return [...prev, roi];
    });
    setSelectedIds(new Set([id]));
    const m = await measureOne({ x0: xa, y0: ya, x1: xb, y1: yb });
    setRois(prev => prev.map(r => r.id === id
      ? { ...r, m: m && !m.__error ? m : null,
                error: m?.__error || null, pending: false }
      : r));
  };
  const updateRoi = async (id, patch) => {
    setRois(prev => prev.map(r => r.id === id
      ? { ...r, ...patch, pending: patch.x0 != null || patch.y0 != null
                            || patch.x1 != null || patch.y1 != null }
      : r));
    if (patch.x0 != null || patch.y0 != null || patch.x1 != null || patch.y1 != null) {
      const cur = rois.find(r => r.id === id);
      if (!cur) return;
      const next = { ...cur, ...patch };
      const m = await measureOne(next);
      setRois(prev => prev.map(r => r.id === id
        ? { ...r, m: m && !m.__error ? m : null,
                  error: m?.__error || null, pending: false }
        : r));
    }
  };
  const deleteRoi = (id) => {
    setRois(prev => prev.filter(r => r.id !== id));
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
  };
  const undoLastRoi = () => {
    setRois(prev => prev.slice(0, -1));
    setSelectedIds(new Set());
  };
  const deleteSelected = () => {
    if (!selectedIds.size) return;
    setRois(prev => prev.filter(r => !selectedIds.has(r.id)));
    setSelectedIds(new Set());
  };
  const selectAll = () => setSelectedIds(new Set(rois.map(r => r.id)));
  const clearAll = () => { setRois([]); setSelectedIds(new Set()); };
  const toggleSel = (id, ev) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (ev?.shiftKey && prev.size > 0) {
        const ids = sortedROIs.map(r => r.id);
        const last = [...prev][prev.size - 1];
        const a = ids.indexOf(last), b = ids.indexOf(id);
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
      } else if (ev?.metaKey || ev?.ctrlKey) {
        next.has(id) ? next.delete(id) : next.add(id);
      } else { next.clear(); next.add(id); }
      return next;
    });
  };

  // ---- Sort --------------------------------------------------------------
  const sortedROIs = useMemoF(() => {
    const copy = [...rois];
    const dir = sortDir === 'asc' ? 1 : -1;
    const k = {
      id: r => r.label || r.id,
      w: r => r.x1 - r.x0,
      h: r => r.y1 - r.y0,
      px: r => (r.x1 - r.x0) * (r.y1 - r.y0),
      mean: r => r.m?.mean_signal ?? 0,
      dsnu: r => r.m?.dsnu_dn ?? 0,
      prnu: r => r.m?.prnu_pct ?? 0,
      row: r => r.m?.row_noise_dn ?? 0,
      col: r => r.m?.col_noise_dn ?? 0,
      res: r => r.m?.residual_pixel_noise_dn ?? 0,
      hot: r => r.m?.hot_pixel_count ?? 0,
    }[sortCol] || (r => r.id);
    copy.sort((a, b) => (k(a) > k(b) ? 1 : k(a) < k(b) ? -1 : 0) * dir);
    return copy;
  }, [rois, sortCol, sortDir]);
  const setSort = (c) => {
    if (sortCol === c) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(c); setSortDir('asc'); }
  };

  // ---- Coord transforms --------------------------------------------------
  // Screen → image-space. Mirrors USAF's toImg exactly (invert flip →
  // rotate → scale → translate, then object-fit: contain letterbox).
  const toImg = useCallbackF((ev) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    const sx = ev.clientX - r.left;
    const sy = ev.clientY - r.top;
    const cx = r.width / 2, cy = r.height / 2;
    let px = sx - cx - pan[0];
    let py = sy - cy - pan[1];
    px /= zoom; py /= zoom;
    if (rotation) {
      const rad = -rotation * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const nx = px * c - py * s;
      const ny = px * s + py * c;
      px = nx; py = ny;
    }
    if (flipH) px = -px;
    if (flipV) py = -py;
    const imgAR = imgDims.w / imgDims.h;
    const innerAR = r.width / r.height;
    let rw, rh;
    if (imgAR > innerAR) { rw = r.width; rh = r.width / imgAR; }
    else                 { rh = r.height; rw = r.height * imgAR; }
    const fx = px / rw + 0.5, fy = py / rh + 0.5;
    return [Math.max(0, Math.min(imgDims.w, Math.round(fx * imgDims.w))),
            Math.max(0, Math.min(imgDims.h, Math.round(fy * imgDims.h)))];
  }, [pan, zoom, rotation, flipH, flipV, imgDims]);

  // Distance from point to ROI rectangle (for right-click delete).
  const distToRoi = ([x, y], r) => {
    const dx = Math.max(r.x0 - x, 0, x - r.x1);
    const dy = Math.max(r.y0 - y, 0, y - r.y1);
    return Math.hypot(dx, dy);
  };

  // ---- Mouse handlers ----------------------------------------------------
  const isPanning = (ev) => ev.button === 1 || tool === 'pan' || spacePan;

  const onCanvasDown = (ev) => {
    if (ev.button === 2) return;
    if (isPanning(ev)) {
      ev.preventDefault();
      const sx = ev.clientX, sy = ev.clientY;
      const [px0, py0] = pan;
      const move = (e) => setPan([px0 + (e.clientX - sx), py0 + (e.clientY - sy)]);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
      return;
    }
    if (ev.button !== 0) return;
    const [x, y] = toImg(ev);
    const startX = ev.clientX, startY = ev.clientY;
    let dragged = false;
    const onMove = (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) dragged = true;
      if (dragged) {
        const [x2, y2] = toImg(e);
        setDrawing({ x0: Math.min(x, x2), y0: Math.min(y, y2),
                     x1: Math.max(x, x2), y1: Math.max(y, y2) });
      }
    };
    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrawing(null);
      if (dragged) {
        const [x2, y2] = toImg(e);
        addRoi(x, y, x2, y2);
      } else {
        // Plain click: select any ROI the cursor is inside; else clear.
        const hit = [...rois].reverse().find(r =>
          x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);
        if (hit) setSelectedIds(new Set([hit.id]));
        else setSelectedIds(new Set());
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onCanvasWheel = (ev) => {
    ev.preventDefault();
    const r = canvasRef.current.getBoundingClientRect();
    const cx = ev.clientX - r.left - r.width / 2;
    const cy = ev.clientY - r.top - r.height / 2;
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.25, Math.min(16, +(zoom * factor).toFixed(3)));
    if (newZoom === zoom) return;
    const k = newZoom / zoom;
    setPan(([ppx, ppy]) => [cx - (cx - ppx) * k, cy - (cy - ppy) * k]);
    setZoom(newZoom);
  };

  const onCanvasMove = (ev) => {
    const [x, y] = toImg(ev);
    setCursorReadout([x, y]);
  };

  const onCanvasRight = (ev) => {
    ev.preventDefault();
    const [x, y] = toImg(ev);
    let best = null, bestD = 20;
    for (const r of rois) {
      const d = distToRoi([x, y], r);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best) deleteRoi(best.id);
  };

  // ---- Keyboard shortcuts ------------------------------------------------
  useEffectF(() => {
    const down = (e) => {
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.isContentEditable) return;
      if (e.code === 'Space' && !e.repeat) { setSpacePan(true); e.preventDefault(); return; }
      if (e.key === 'Escape') setSelectedIds(new Set());
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { undoLastRoi(); e.preventDefault(); return; }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { selectAll(); e.preventDefault(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedIds.size) deleteSelected(); }
      if (e.key === 'r' || e.key === 'R') setRotation(r => (r + 90) % 360);
      if (e.key === 'f' || e.key === 'F' || e.key === '0') { setZoom(1); setPan([0, 0]); }
    };
    const up = (e) => { if (e.code === 'Space') setSpacePan(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down);
                   window.removeEventListener('keyup', up); };
  }, [rois, selectedIds]);

  // ---- Status bar --------------------------------------------------------
  useEffectF(() => {
    const worst = rois.length ? rois.reduce((acc, r) =>
      (r.m && r.m.prnu_pct != null && r.m.prnu_pct > (acc?.prnu_pct ?? -1))
        ? r.m : acc, null) : null;
    const base = `${rois.length} ROI${rois.length === 1 ? '' : 's'} · ${activeChannel || '—'}`;
    const extra = worst ? ` · peak PRNU ${worst.prnu_pct.toFixed(3)}%` : '';
    onStatusChange?.(base + extra, rois.length);
  }, [rois.length, activeChannel, rois]);

  // ---- Save / Load JSON config ------------------------------------------
  const fileInputRef = useRefF(null);
  const darkInputRef = useRefF(null);
  const fileFilter = useFileFilter();
  const darkAccept = fileFilter.filters[fileFilter.current]?.accept || '';

  // ---- Dark-frame upload / clear --------------------------------------
  // Mirrors the USAF flow: the same /api/sources/{id}/dark/* endpoints are
  // shared. After attach/clear we re-fetch live stats for every existing
  // ROI (the source image just changed) by simulating the same effect that
  // a channel-change triggers.
  const onLoadDark = async (file) => {
    if (!file || !source) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      say?.(`Uploading dark frame ${file.name}…`);
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark/upload`,
                                     { method: 'POST', body: fd });
      onSwitchSource?.(updated);
      say?.(`Dark frame attached: ${updated.dark_name}`, 'success');
    } catch (err) {
      say?.(`Dark load failed: ${err.detail || err.message}`, 'danger');
    }
  };
  const onClearDark = async () => {
    if (!source?.has_dark) return;
    try {
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark`,
                                     { method: 'DELETE' });
      onSwitchSource?.(updated);
      say?.('Dark frame cleared', 'success');
    } catch (err) {
      say?.(`Clear dark failed: ${err.detail || err.message}`, 'danger');
    }
  };

  // Open by absolute path — preserves source.path / dark_path so Save/Load
  // cfg actually round-trips a re-load on the next session.
  const onOpenFromPath = async () => {
    const last = (typeof localStorage !== 'undefined' && localStorage.getItem('mantis/lastOpenPath')) || '';
    const p = window.prompt('Absolute path to the H5 / image file:', last);
    if (!p || !p.trim()) return;
    try {
      const newSrc = await apiFetch('/api/sources/load-path',
                                    { method: 'POST', body: { path: p.trim() } });
      onSwitchSource?.(newSrc);
      try { localStorage.setItem('mantis/lastOpenPath', p.trim()); } catch {}
      say?.(`Loaded source from ${p.trim()}`, 'success');
    } catch (err) { say?.(`Load by path failed: ${err.detail || err.message}`, 'danger'); }
  };
  const onLoadDarkByPath = async () => {
    if (!source) return;
    const last = (typeof localStorage !== 'undefined' && localStorage.getItem('mantis/lastDarkPath')) || '';
    const p = window.prompt('Absolute path to the dark frame file:', last);
    if (!p || !p.trim()) return;
    try {
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark/load-path`,
                                     { method: 'POST', body: { path: p.trim() } });
      onSwitchSource?.(updated);
      try { localStorage.setItem('mantis/lastDarkPath', p.trim()); } catch {}
      say?.(`Dark frame attached from ${p.trim()}`, 'success');
    } catch (err) { say?.(`Dark load by path failed: ${err.detail || err.message}`, 'danger'); }
  };

  const exportConfig = () => {
    const cfg = {
      kind: 'mantis-fpn-config', version: 3, exportedAt: new Date().toISOString(),
      // Bright/source identifier — `path` is the absolute disk path when
      // known (only set when the file was loaded via /api/sources/load-path
      // or the CLI; browser uploads can't preserve the original path for
      // security). On import we re-load from `path` when present.
      source: { name: source?.name, kind: source?.kind, path: source?.path || null },
      // Dark-frame attachment, if any. `path` is set when loaded via
      // /api/sources/{id}/dark/load-path; browser uploads have `path = null`
      // and need re-attachment manually.
      dark: source?.has_dark
        ? { name: source.dark_name, path: source.dark_path || null }
        : null,
      picker: { activeChannel, analysisChannels },
      settings: settingsPayload(),
      view: { rotation, flipH, flipV, zoom, brightness, contrast, gamma, colormap },
      rois: rois.map(r => ({
        id: r.id, label: r.label,
        x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
      })),
      selectedIds: [...selectedIds], sortCol, sortDir,
      stabEnabled,
    };
    exportJSON(`mantis-fpn-${Date.now()}.json`, cfg);
    const tags = [];
    if (source?.path) tags.push('with H5 path');
    else              tags.push('no H5 path — browser upload');
    if (source?.has_dark && source?.dark_path) tags.push('with dark path');
    else if (source?.has_dark)                  tags.push('no dark path — browser upload');
    say?.(`Config saved (${tags.join(' · ')})`, 'success');
  };
  const importConfig = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const cfg = JSON.parse(text);
      if (cfg.kind !== 'mantis-fpn-config') throw new Error('Not a MantisAnalysis FPN config');

      // 1. Re-load bright source from absolute path when present. Browser
      //    uploads have no path, in which case we surface an actionable
      //    toast pointing the user at the Open button.
      const cfgPath = cfg.source?.path || null;
      let activeSrc = source;
      if (cfgPath && cfgPath !== source?.path) {
        try {
          const s = await apiFetch('/api/sources/load-path', { method: 'POST', body: { path: cfgPath } });
          onSwitchSource?.(s);
          activeSrc = s;
          say?.(`Loaded source from ${cfgPath}`, 'success');
        } catch (err) {
          say?.(`Could not auto-load source from ${cfgPath} (${err.detail || err.message}); using current source`, 'warn');
        }
      } else if (cfg.source?.name && !cfgPath && (!source || source.name !== cfg.source.name)) {
        say?.(`Config references "${cfg.source.name}" but no path is stored (browser upload). Use "Open H5 / image…" to load it.`, 'warn');
      }

      // 2. Re-attach the dark frame if the config has a `dark.path` and
      //    we have an active source. Browser-uploaded darks have no path
      //    and need manual re-attachment via the Dark frame card.
      if (cfg.dark?.path && activeSrc) {
        try {
          const updatedSrc = await apiFetch(`/api/sources/${activeSrc.source_id}/dark/load-path`,
                                             { method: 'POST', body: { path: cfg.dark.path, name: cfg.dark.name } });
          onSwitchSource?.(updatedSrc);
          say?.(`Re-attached dark frame from ${cfg.dark.path}`, 'success');
        } catch (err) {
          say?.(`Could not auto-attach dark from ${cfg.dark.path} (${err.detail || err.message})`, 'warn');
        }
      } else if (cfg.dark?.name && !cfg.dark?.path) {
        say?.(`Config references dark "${cfg.dark.name}" but no path is stored (browser upload). Re-attach via the Dark frame card.`, 'warn');
      }
      const p = cfg.picker || {};
      if (p.activeChannel && available.includes(p.activeChannel)) setActiveChannel(p.activeChannel);
      if (Array.isArray(p.analysisChannels)) setAnalysisChannels(p.analysisChannels.filter(c => available.includes(c)));
      const s = cfg.settings || {};
      if (s.median_size != null)    setMedianSize(s.median_size);
      if (s.gaussian_sigma != null) setGaussSigma(s.gaussian_sigma);
      if (s.hot_pixel_thr != null)  setHotPixThr(s.hot_pixel_thr);
      if (typeof s.bilateral === 'boolean') setBilateral(s.bilateral);
      if (s.lo_pct != null)         setLoPct(s.lo_pct);
      if (s.hi_pct != null)         setHiPct(s.hi_pct);
      if (s.drift_order)            setDriftOrder(s.drift_order);
      if (s.hot_sigma != null)      setHotSigma(s.hot_sigma);
      const v = cfg.view || {};
      if (typeof v.rotation === 'number') setRotation(v.rotation);
      if (typeof v.flipH === 'boolean')   setFlipH(v.flipH);
      if (typeof v.flipV === 'boolean')   setFlipV(v.flipV);
      if (typeof v.zoom === 'number')     setZoom(v.zoom);
      if (typeof v.brightness === 'number') setBrightness(v.brightness);
      if (typeof v.contrast === 'number')   setContrast(v.contrast);
      if (typeof v.gamma === 'number')      setGamma(v.gamma);
      if (v.colormap)                       setColormap(v.colormap);
      if (Array.isArray(cfg.rois)) {
        const placeholder = cfg.rois.map(r => ({ ...r, pending: true }));
        setRois(placeholder);
        const measured = await Promise.all(placeholder.map(async (r) => {
          const m = await measureOne(r);
          return { ...r, m: m && !m.__error ? m : null,
                        error: m?.__error || null, pending: false };
        }));
        setRois(measured);
      }
      if (Array.isArray(cfg.selectedIds)) setSelectedIds(new Set(cfg.selectedIds));
      if (cfg.sortCol) setSortCol(cfg.sortCol);
      if (cfg.sortDir) setSortDir(cfg.sortDir);
      if (typeof cfg.stabEnabled === 'boolean') setStabEnabled(cfg.stabEnabled);
      say?.(`Loaded ${cfg.rois?.length ?? 0} ROI${cfg.rois?.length === 1 ? '' : 's'} from ${file.name}`, 'success');
    } catch (err) { say?.(`Load failed: ${err.message}`, 'danger'); }
  };

  const exportCSVTable = () => {
    const rows = sortedROIs.filter(r => r.m).map((r, i) => ({
      label: r.label || `ROI-${i + 1}`,
      x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
      width: r.x1 - r.x0, height: r.y1 - r.y0,
      n_kept: r.m.n_kept, n_total: r.m.n_total,
      mean_dn: +r.m.mean_signal.toFixed(3),
      residual_mean_dn: +r.m.mean.toFixed(3),
      dsnu_dn: +r.m.dsnu_dn.toFixed(4),
      prnu_pct: +r.m.prnu_pct.toFixed(6),
      row_noise_dn: +r.m.row_noise_dn.toFixed(4),
      col_noise_dn: +r.m.col_noise_dn.toFixed(4),
      residual_sigma_dn: +r.m.residual_pixel_noise_dn.toFixed(4),
      sigma_row_only_dn: +r.m.dsnu_row_only_dn.toFixed(4),
      sigma_col_only_dn: +r.m.dsnu_col_only_dn.toFixed(4),
      row_peak_freq_cy: +r.m.row_peak_freq.toFixed(6),
      col_peak_freq_cy: +r.m.col_peak_freq.toFixed(6),
      hot_pixel_count: r.m.hot_pixel_count,
      cold_pixel_count: r.m.cold_pixel_count,
      drift_order: r.m.drift_order,
    }));
    if (!rows.length) { say?.('Nothing to export — no measured ROIs.', 'warn'); return; }
    exportCSV(`mantis-fpn-${Date.now()}.csv`, rows);
    say?.(`Exported ${rows.length} ROI${rows.length === 1 ? '' : 's'}`, 'success');
  };

  // ---- Run analysis ------------------------------------------------------
  const runAnalysis = async () => {
    if (!source || !rois.length) return;
    // localStorage keeps the previous session's channel set; filter to the
    // ones the current source actually exposes so we never send an
    // unknown channel to the server (which 400s with "no valid channels").
    const chs = analysisChannels.filter(c => available.includes(c));
    const chsOrActive = chs.length ? chs
                       : activeChannel && available.includes(activeChannel)
                         ? [activeChannel] : [];
    if (!chsOrActive.length) {
      say?.('No valid analysis channels selected.', 'warn');
      return;
    }
    try {
      say?.(`Running FPN analysis on ${chsOrActive.length} channel${chsOrActive.length > 1 ? 's' : ''} × ${rois.length} ROI${rois.length > 1 ? 's' : ''}…`);
      const body = {
        source_id: source.source_id,
        channels: chsOrActive,
        rois: rois.map(r => [r.y0, r.x0, r.y1, r.x1]),
        settings: settingsPayload(),
        include_pngs: true,
      };
      const res = await apiFetch('/api/fpn/analyze', { method: 'POST', body });
      onRunAnalysis({
        mode: 'fpn', source, channels: chsOrActive,
        rois: rois.map((r, i) => ({
          idx: i, id: r.id, label: r.label,
          x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
        })),
        settings: settingsPayload(),
        response: res,
      });
    } catch (err) { say?.(`analyze failed: ${err.detail || err.message}`, 'danger'); }
  };

  // ---- Render -----------------------------------------------------------
  return (
    <div style={{ display: 'grid',
                  gridTemplateColumns: `${leftW}px minmax(360px, 1fr) ${rightW}px`,
                  height: '100%', overflow: 'hidden' }}>
      {/* ================================================================ LEFT */}
      <div style={{ position: 'relative', borderRight: `1px solid ${t.border}`,
                    background: t.bg, padding: 10, overflowY: 'auto' }}>
        <ResizeHandle value={leftW} onChange={setLeftW} min={260} max={600} side="right" grow={1} />

        <Card title="Source" icon="open" pinned>
          <Tip title="Currently loaded recording">
            <div style={{ fontSize: 11.5, color: t.text, wordBreak: 'break-all',
                          fontFamily: 'ui-monospace,Menlo,monospace' }}>
              {source?.name || '(none)'}
            </div>
          </Tip>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 3,
                        fontFamily: 'ui-monospace,Menlo,monospace' }}>
            {source ? `${source.kind} · ${source.shape[1]}×${source.shape[0]} · ${source.channels.length} ch` : '—'}
          </div>
          {/* Open new bright/source recording (H5 / image). Same hidden
              top-bar input — keeps file-type filter shared with Open. */}
          {/* "by path" preserves source.path so Save/Load cfg actually
              auto-reloads on the next session — browser uploads can't. */}
          <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 6 }}>
            <Tip title="Open an H5 / image file via the browser file picker (no path is preserved — Save cfg won't auto-reload)">
              <Button variant="primary" icon="open" size="xs" onClick={onOpenFile} fullWidth>
                Open H5 / image…
              </Button>
            </Tip>
            <Tip title="Type / paste an absolute disk path. Path is saved with the cfg so Load cfg will auto-reload this file later.">
              <Button variant="ghost" icon="open" size="xs" onClick={onOpenFromPath} fullWidth>
                by path…
              </Button>
            </Tip>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
            <Button variant="ghost" icon="save" size="xs" onClick={exportConfig}
              title="Save picker / settings / ROIs to JSON" fullWidth>Save cfg</Button>
            <Button variant="ghost" icon="upload" size="xs" onClick={() => fileInputRef.current?.click()}
              title="Load a previously-saved JSON; ROIs will be re-measured" fullWidth>Load cfg</Button>
          </div>

          {/* Dark frame attachment — identical contract to USAF mode.
              Per-pixel subtraction in float64 with ≥ 0 clamp; analysis
              endpoints route through the same _channel_image() chokepoint
              so the dark cancels uniformly across compute / measure /
              measure_batch / stability / analyze. */}
          <div style={{ marginTop: 10, padding: '6px 8px',
                        background: source?.has_dark ? t.accentSoft : t.panelAlt,
                        border: `1px solid ${source?.has_dark ? t.accent + '33' : t.border}`,
                        borderRadius: 4 }}>
            <div style={{ fontSize: 10, color: source?.has_dark ? t.accent : t.textMuted,
                          fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
                          display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="layers" size={11} />
              <span>Dark frame</span>
              {source?.has_dark && <span style={{ marginLeft: 'auto', width: 6, height: 6,
                                                  borderRadius: '50%', background: t.success }} />}
            </div>
            <div style={{ fontSize: 11, color: source?.has_dark ? t.text : t.textFaint,
                          marginTop: 4, fontFamily: 'ui-monospace,Menlo,monospace',
                          wordBreak: 'break-all' }}>
              {source?.has_dark ? `subtracted: ${source.dark_name}`
                                : 'not attached — analysis uses raw DN'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}>
              <Button variant="ghost" icon="open" size="xs"
                      onClick={() => darkInputRef.current?.click()}
                      title={`Pick a dark file to subtract per-pixel before FPN stats · current filter: ${fileFilter.filters[fileFilter.current]?.label}`}
                      fullWidth>{source?.has_dark ? 'Replace' : 'Load'}</Button>
              <Button variant="ghost" icon="open" size="xs" onClick={onLoadDarkByPath}
                      title="Type / paste an absolute disk path. Path is saved with cfg so Load cfg auto-attaches this dark later."
                      fullWidth>by path…</Button>
              <Button variant="danger" icon="trash" size="xs" disabled={!source?.has_dark}
                      onClick={onClearDark}
                      title="Detach the dark frame; FPN stats return to raw DN" fullWidth>Clear</Button>
            </div>
            {/* Inline filetype filter (shared with the top-bar Open). */}
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }} data-no-drag>
              <span style={{ fontSize: 10, color: t.textFaint }}>Filetype</span>
              <select value={fileFilter.current}
                      onChange={(e) => fileFilter.set(e.target.value)}
                      title="File-type filter (applies to both bright and dark uploads)"
                      style={{
                        flex: 1, fontSize: 10.5, padding: '2px 6px',
                        background: t.inputBg, color: t.text,
                        border: `1px solid ${t.border}`, borderRadius: 3,
                        fontFamily: 'inherit', cursor: 'pointer',
                      }}>
                {Object.entries(fileFilter.filters).map(([k, v]) =>
                  <option key={k} value={k}>{v.label}</option>
                )}
              </select>
            </div>
            <input ref={darkInputRef} type="file" accept={darkAccept} style={{ display: 'none' }}
                   onChange={(e) => { onLoadDark(e.target.files?.[0]); e.target.value = ''; }} />
          </div>

          <input ref={fileInputRef} type="file" accept="application/json,.json"
                 style={{ display: 'none' }}
                 onChange={(e) => { importConfig(e.target.files?.[0]); e.target.value = ''; }} />
        </Card>

        <Card title="Display channel" icon="layers">
          <div style={{ fontSize: 10.5, color: t.textFaint, marginBottom: 6 }}>
            The ROI stats update when you change this.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {available.map(c => (
              <Tip key={c} title={`Measure on ${c}`}>
                <ChannelChip id={fpnChipId(c)} selected={activeChannel === c}
                             onToggle={() => setActiveChannel(c)} size="sm" />
              </Tip>
            ))}
          </div>
        </Card>

        <Card title={`Analysis channels · ${analysisChannels.length}`} icon="grid">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {available.map(c => (
              <Tip key={c} title={`Include ${c} in Run analysis`}>
                <ChannelChip id={fpnChipId(c)} multi
                             selected={analysisChannels.includes(c)}
                             onToggle={() => setAnalysisChannels(prev =>
                               prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                             size="sm" />
              </Tip>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Button size="xs" onClick={() => setAnalysisChannels(available)}>All</Button>
            <Button size="xs" onClick={() => setAnalysisChannels([])}>None</Button>
            {available.some(c => c.startsWith('HG-')) && <>
              <Button size="xs" onClick={() => setAnalysisChannels(available.filter(c => c.startsWith('HG-')))}>HG</Button>
              <Button size="xs" onClick={() => setAnalysisChannels(available.filter(c => c.startsWith('LG-')))}>LG</Button>
            </>}
          </div>
        </Card>

        <Card title="Drift removal" icon="sliders" pinned>
          <Row label="Order">
            <Tip title="Fit a polynomial surface to the ROI and subtract it before computing DSNU/PRNU. Separates illumination roll-off from genuine fixed-pattern noise.">
              <Segmented value={driftOrder} onChange={setDriftOrder} options={[
                { value: 'none',        label: 'Off' },
                { value: 'bilinear',    label: 'Linear' },
                { value: 'biquadratic', label: 'Quadratic' },
              ]} fullWidth />
            </Tip>
          </Row>
          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
            <b>Linear</b> catches simple tilt · <b>Quadratic</b> catches vignette.
            With drift off, residual tilt counts as DSNU.
          </div>
        </Card>

        <Card title="Outlier / hot-pixel sensitivity" icon="sparkles">
          <Slider label="Low %"  min={0} max={10}  step={0.1}  value={loPct}  onChange={setLoPct} format={v => v.toFixed(1)} />
          <Slider label="High %" min={0} max={10}  step={0.1}  value={hiPct}  onChange={setHiPct} format={v => v.toFixed(1)} />
          <Slider label="|z| hot-pixel" min={1.0} max={8.0} step={0.1} value={hotSigma} onChange={setHotSigma} format={v => v.toFixed(1)} />
          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
            Percentile cuts exclude bright/dark outliers from the σ. <b>|z| hot-pixel</b> is the threshold for flagging individual hot/cold pixels on the analysis map.
          </div>
        </Card>

        <Card title="ISP / smoothing" icon="isp">
          <Row label="Median">
            <Segmented value={String(medianSize)} options={['0', '3', '5', '7']}
                       onChange={v => setMedianSize(parseInt(v))} />
          </Row>
          <Slider label="Gauss σ (px)" min={0} max={6}  step={0.05} value={gaussSigma} onChange={setGaussSigma} />
          <Slider label="Hot-pix repl. (>σ)" min={0} max={20} step={0.5} value={hotPixThr} onChange={setHotPixThr} format={v => v.toFixed(1)} />
          <Checkbox checked={bilateral} onChange={setBilateral} label="Bilateral (edge-preserving)" />
          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <Button size="xs" onClick={() => {
              setMedianSize(0); setGaussSigma(0); setHotPixThr(0);
              setBilateral(false); setLoPct(0); setHiPct(0);
            }}>Bypass</Button>
            <Button size="xs" onClick={() => {
              setMedianSize(3); setGaussSigma(0.5); setHotPixThr(6); setBilateral(true);
              setLoPct(0.1); setHiPct(0.1);
            }}>Clean</Button>
          </div>
        </Card>

        <Card title="Run analysis" icon="run" pinned>
          <Button variant="primary" icon="run" size="lg" fullWidth
                  disabled={!rois.length || !analysisChannels.length}
                  onClick={runAnalysis}>Run FPN analysis</Button>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 6, textAlign: 'center' }}>
            {!rois.length ? 'Draw at least one ROI.' :
             !analysisChannels.length ? 'Choose ≥1 analysis channel.' :
             `${rois.length} ROI${rois.length > 1 ? 's' : ''} · ${analysisChannels.length} ch · ${driftOrder === 'none' ? 'raw' : driftOrder + '-detrended'}`}
          </div>
        </Card>
      </div>

      {/* ================================================================ CENTER */}
      <FPNCanvas
        canvasRef={canvasRef} imgSrc={imgSrc} imgDims={imgDims} setImgDims={setImgDims}
        channel={activeChannel}
        rois={rois} selectedIds={selectedIds} drawing={drawing} cursor={cursorReadout}
        rotation={rotation} flipH={flipH} flipV={flipV} zoom={zoom} pan={pan}
        tool={tool} setTool={setTool} spacePan={spacePan}
        onDown={onCanvasDown} onMove={onCanvasMove} onRight={onCanvasRight} onWheel={onCanvasWheel}
        onRotate={() => setRotation((rotation + 90) % 360)}
        onFlipH={() => setFlipH(f => !f)} onFlipV={() => setFlipV(f => !f)}
        onZoomIn={() => setZoom(z => Math.min(8, +(z * 1.25).toFixed(2)))}
        onZoomOut={() => setZoom(z => Math.max(0.25, +(z / 1.25).toFixed(2)))}
        onZoomReset={() => { setZoom(1); setPan([0, 0]); }}
        onUndo={undoLastRoi}
        brightness={brightness} contrast={contrast} gamma={gamma}
        colormap={colormap} vmin={vmin} vmax={vmax}
      />

      {/* ================================================================ RIGHT */}
      <div style={{ position: 'relative', borderLeft: `1px solid ${t.border}`,
                    background: t.bg, padding: 10, overflowY: 'auto' }}>
        <ResizeHandle value={rightW} onChange={setRightW} min={300} max={680} side="left" grow={-1} />

        <Card title="Display" icon="sliders">
          <Row label="Colormap">
            <Select value={colormap} onChange={setColormap} options={[
              { value: 'gray', label: 'Grayscale' },
              { value: 'jet', label: 'JET (classic)' },
              { value: 'turbo', label: 'Turbo' },
              { value: 'viridis', label: 'Viridis' },
              { value: 'magma', label: 'Magma' },
              { value: 'inferno', label: 'Inferno' },
              { value: 'plasma', label: 'Plasma' },
              { value: 'cividis', label: 'Cividis' },
              { value: 'hot', label: 'Hot' },
              { value: 'cool', label: 'Cool' },
            ]} />
          </Row>
          <Slider label="Brightness" min={-0.5} max={0.5} step={0.01} value={brightness} onChange={setBrightness} />
          <Slider label="Contrast"   min={0.5}  max={2.5} step={0.01} value={contrast}  onChange={setContrast} />
          <Slider label="Gamma"      min={0.4}  max={2.5} step={0.01} value={gamma}     onChange={setGamma} />

          {/* Colormap range — same vmin/vmax UX as USAF mode. */}
          <div style={{ marginTop: 10, padding: '6px 8px', background: t.panelAlt,
                        border: `1px solid ${t.border}`, borderRadius: 4 }} data-no-drag>
            <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 600,
                          letterSpacing: 0.4, textTransform: 'uppercase',
                          display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="palette" size={11} />
              <span>Colormap range</span>
              <Tip title={autoRange ? 'Click to pin vmin/vmax to current values'
                                    : 'Click to revert to percentile-clip defaults (1% / 99.5%)'}>
                <button onClick={() => {
                  if (autoRange) { setAutoRange(false); }
                  else { setAutoRange(true); if (range) { setVmin(range.p1); setVmax(range.p99); } }
                }} style={{
                  marginLeft: 'auto', fontSize: 9.5, padding: '1px 6px',
                  background: autoRange ? t.accent : t.chipBg,
                  color: autoRange ? '#fff' : t.text,
                  border: `1px solid ${autoRange ? t.accent : t.border}`,
                  borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                }}>{autoRange ? 'AUTO' : 'MANUAL'}</button>
              </Tip>
            </div>
            {range && (
              <div style={{ fontSize: 9.5, color: t.textFaint, marginTop: 3,
                            fontFamily: 'ui-monospace,Menlo,monospace' }}>
                channel range: {range.min.toFixed(0)} – {range.max.toFixed(0)} DN
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: t.textMuted }}>vmin</span>
                <input type="number" value={vmin ?? ''}
                       step={range ? Math.max(1, (range.max - range.min) / 1000) : 1}
                       disabled={autoRange}
                       onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setVmin(v); }}
                       style={{ width: '100%', fontSize: 11, padding: '2px 6px',
                                background: t.inputBg, color: t.text,
                                border: `1px solid ${t.border}`, borderRadius: 3,
                                fontFamily: 'ui-monospace,Menlo,monospace',
                                opacity: autoRange ? 0.5 : 1 }} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: t.textMuted }}>vmax</span>
                <input type="number" value={vmax ?? ''}
                       step={range ? Math.max(1, (range.max - range.min) / 1000) : 1}
                       disabled={autoRange}
                       onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) setVmax(v); }}
                       style={{ width: '100%', fontSize: 11, padding: '2px 6px',
                                background: t.inputBg, color: t.text,
                                border: `1px solid ${t.border}`, borderRadius: 3,
                                fontFamily: 'ui-monospace,Menlo,monospace',
                                opacity: autoRange ? 0.5 : 1 }} />
              </label>
            </div>
            {range && (
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <button disabled={autoRange} onClick={() => { setVmin(range.min); setVmax(range.max); }}
                        title="Snap to native min/max"
                        style={{ flex: 1, fontSize: 9.5, padding: '2px 4px',
                                 background: t.chipBg, color: t.text,
                                 border: `1px solid ${t.border}`, borderRadius: 3,
                                 cursor: autoRange ? 'not-allowed' : 'pointer',
                                 opacity: autoRange ? 0.5 : 1, fontFamily: 'inherit' }}>min/max</button>
                <button disabled={autoRange} onClick={() => { setVmin(range.mean - 3*range.std); setVmax(range.mean + 3*range.std); }}
                        title="Snap to mean ± 3σ"
                        style={{ flex: 1, fontSize: 9.5, padding: '2px 4px',
                                 background: t.chipBg, color: t.text,
                                 border: `1px solid ${t.border}`, borderRadius: 3,
                                 cursor: autoRange ? 'not-allowed' : 'pointer',
                                 opacity: autoRange ? 0.5 : 1, fontFamily: 'inherit' }}>μ ± 3σ</button>
                <button disabled={autoRange} onClick={() => { setVmin(range.p1); setVmax(range.p99); }}
                        title="Snap to 1%/99.5% percentile"
                        style={{ flex: 1, fontSize: 9.5, padding: '2px 4px',
                                 background: t.chipBg, color: t.text,
                                 border: `1px solid ${t.border}`, borderRadius: 3,
                                 cursor: autoRange ? 'not-allowed' : 'pointer',
                                 opacity: autoRange ? 0.5 : 1, fontFamily: 'inherit' }}>p1/p99</button>
              </div>
            )}
          </div>

          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
            Display only — does not affect analysis numbers.
          </div>
        </Card>

        <ROIsTable
          rois={sortedROIs} selectedIds={selectedIds} toggleSel={toggleSel}
          sortCol={sortCol} sortDir={sortDir} setSort={setSort}
          onDelete={deleteSelected} onSelectAll={selectAll} onClearAll={clearAll}
          onCSV={exportCSVTable} onRename={(id, label) => updateRoi(id, { label })}
          totalROIs={rois.length}
        />

        <FPNLiveStats
          roi={selectedLine}
          full={selFullId === selectedLine?.id ? selFull : null}
          multiCount={selectedIds.size}
        />

        <FPNProfilePreview
          roi={selectedLine}
          full={selFullId === selectedLine?.id ? selFull : null}
        />

        <FPNStabilityCard
          roi={selectedLine} enabled={stabEnabled} setEnabled={setStabEnabled}
          curve={stabCurve}
        />

        <Card title="Aggregate" icon="pin" pinned>
          {(() => {
            const measured = rois.filter(r => r.m);
            if (!measured.length) {
              return <div style={{ fontSize: 11, color: t.textFaint, padding: '12px 4px', textAlign: 'center' }}>
                No measured ROIs yet.
              </div>;
            }
            const means    = measured.map(r => r.m.mean_signal).filter(Number.isFinite);
            const dsnus    = measured.map(r => r.m.dsnu_dn).filter(Number.isFinite);
            const prnus    = measured.map(r => r.m.prnu_pct).filter(Number.isFinite);
            const res      = measured.map(r => r.m.residual_pixel_noise_dn).filter(Number.isFinite);
            const hotSum   = measured.reduce((s, r) => s + (r.m.hot_pixel_count || 0), 0);
            const meanAvg  = means.reduce((s, v) => s + v, 0) / (means.length || 1);
            const dsnuAvg  = dsnus.reduce((s, v) => s + v, 0) / (dsnus.length || 1);
            const prnuAvg  = prnus.reduce((s, v) => s + v, 0) / (prnus.length || 1);
            const prnuMax  = prnus.length ? Math.max(...prnus) : 0;
            const resAvg   = res.reduce((s, v) => s + v, 0) / (res.length || 1);
            return (
              <StatBlock
                emphasis="prnu"
                items={[
                  { label: 'ROIs (measured)', value: `${measured.length} / ${rois.length}` },
                  { label: 'μ̄ signal',        value: `${fmtDN(meanAvg)} DN` },
                  { label: 'DSNU (avg)',       value: `${fmtDN(dsnuAvg)} DN` },
                  { label: 'PRNU (avg)',       value: fmtPct(prnuAvg), key: 'prnu' },
                  { label: 'PRNU (peak)',      value: fmtPct(prnuMax),
                    color: prnuMax < 0.5 ? t.success : prnuMax < 1.0 ? t.warn : t.danger },
                  { label: 'σ residual (avg)', value: `${fmtDN(resAvg)} DN`, muted: true },
                  { label: 'hot-pix total',    value: `${hotSum}`,
                    color: hotSum === 0 ? t.success : t.warn, muted: hotSum === 0 },
                ]}
              />
            );
          })()}
          <div style={{ marginTop: 8, fontSize: 10, color: t.textFaint, lineHeight: 1.4 }}>
            Peak PRNU is the worst-case uniformity across all ROIs;
            hot-pix total sums across ROIs at |z| &gt; {hotSigma.toFixed(1)}.
          </div>
        </Card>
      </div>
    </div>
  );
};

// ===========================================================================
// FPNCanvas — rulers, zoom/pan/rotate, ROI overlays, HUD
// Ported from USAFCanvas with FPN-specific overlay (rectangles, not lines).
// ===========================================================================
const FPNCanvas = ({
  canvasRef, imgSrc, imgDims, setImgDims, channel,
  rois, selectedIds, drawing, cursor,
  rotation, flipH, flipV, zoom, pan,
  tool, setTool, spacePan,
  onDown, onMove, onRight, onWheel,
  onRotate, onFlipH, onFlipV,
  onZoomIn, onZoomOut, onZoomReset, onUndo,
  brightness, contrast, gamma,
  colormap, vmin, vmax,
}) => {
  const t = useTheme();
  const filter = `brightness(${1 + brightness * 1.2}) contrast(${contrast})`;
  const innerTx = `translate(${pan[0]}px, ${pan[1]}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;
  const canvasCursor = (tool === 'pan' || spacePan) ? 'grab' : 'crosshair';

  const [cRect, setCRect] = useStateF({ w: 0, h: 0 });
  useEffectF(() => {
    if (!canvasRef.current) return;
    const update = () => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (r) setCRect({ w: r.width, h: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [canvasRef]);

  // Image → screen mapper. Same math as USAFCanvas.imgToScreen.
  const imgToScreen = (ix, iy) => {
    const { w, h } = cRect;
    if (!w || !h) return [0, 0];
    const imgAR = imgDims.w / imgDims.h;
    const innerAR = w / h;
    let rw, rh;
    if (imgAR > innerAR) { rw = w; rh = w / imgAR; }
    else                 { rh = h; rw = h * imgAR; }
    let px = (ix / imgDims.w - 0.5) * rw;
    let py = (iy / imgDims.h - 0.5) * rh;
    if (flipH) px = -px;
    if (flipV) py = -py;
    if (rotation) {
      const rad = rotation * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const nx = px * c - py * s;
      const ny = px * s + py * c;
      px = nx; py = ny;
    }
    px = px * zoom + pan[0] + w / 2;
    py = py * zoom + pan[1] + h / 2;
    return [px, py];
  };

  const ticksFor = (imgSize) => {
    const desiredImg = 80 / zoom;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const step = steps.find(s => s >= desiredImg) || steps[steps.length - 1];
    const out = [];
    for (let v = 0; v <= imgSize; v += step) out.push(v);
    return { step, ticks: out };
  };
  const rulerX = ticksFor(imgDims.w);
  const rulerY = ticksFor(imgDims.h);

  return (
    <div style={{ background: t.bg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center',
                    borderBottom: `1px solid ${t.border}`, background: t.bg }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: t.text,
                        display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%',
                           background: CHANNEL_COLORS[parseChannel(channel?.includes('-') ? channel : `HG-${channel}`).band] || t.accent }} />
            FPN · {channel || '—'}
          </div>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 2,
                        fontFamily: 'ui-monospace,Menlo,monospace' }}>
            rot {rotation}°{flipH ? ' · H' : ''}{flipV ? ' · V' : ''} · zoom {(zoom * 100).toFixed(0)}% · {rois.length} ROI
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center',
                      fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11.5, color: t.textMuted }}>
          {cursor && <span>x={String(cursor[0]).padStart(4, '0')} · y={String(cursor[1]).padStart(4, '0')}</span>}
          <span style={{ color: t.textFaint }}>drag = ROI · space = pan</span>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', background: t.canvasBg, overflow: 'hidden' }}>
        {/* Floating colorbar — see USAFCanvas comment. */}
        {(colormap !== 'gray' || (vmin != null && vmax != null)) && (
          <CanvasColorbar colormap={colormap} vmin={vmin} vmax={vmax} side="right" />
        )}
        <RulerH t={t} imgSize={imgDims.w} step={rulerX.step} ticks={rulerX.ticks}
                zoom={zoom} panPx={pan[0]} cursorImg={cursor?.[0]} leftInset={26} />
        <RulerV t={t} imgSize={imgDims.h} step={rulerY.step} ticks={rulerY.ticks}
                zoom={zoom} panPx={pan[1]} cursorImg={cursor?.[1]} topInset={20} />
        <div style={{ position: 'absolute', top: 0, left: 0, width: 26, height: 20,
                      background: t.panelAlt, borderRight: `1px solid ${t.border}`,
                      borderBottom: `1px solid ${t.border}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: t.textFaint, fontSize: 9,
                      fontFamily: 'ui-monospace,Menlo,monospace' }}>px</div>

        <div
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onContextMenu={onRight}
          onWheel={onWheel}
          style={{ position: 'absolute', top: 20, left: 26, right: 0, bottom: 0,
                   cursor: canvasCursor, userSelect: 'none' }}
        >
          <div style={{ position: 'absolute', inset: 0, transform: innerTx,
                        transformOrigin: 'center', transition: 'none', pointerEvents: 'none' }}>
            {imgSrc && <img src={imgSrc} alt="" draggable={false}
              onLoad={(e) => setImgDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              style={{ width: '100%', height: '100%', objectFit: 'contain',
                       imageRendering: zoom >= 1 ? 'pixelated' : 'auto',
                       filter, pointerEvents: 'none' }} />}
          </div>

          <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0,
                                                    pointerEvents: 'none', overflow: 'visible' }}>
            {(() => {
              const nodes = [];
              // Existing ROIs
              rois.forEach((r, i) => {
                const sel = selectedIds.has(r.id);
                const c = roiColor(i);
                const [sx0, sy0] = imgToScreen(r.x0, r.y0);
                const [sx1, sy1] = imgToScreen(r.x1, r.y1);
                const x = Math.min(sx0, sx1), y = Math.min(sy0, sy1);
                const w = Math.abs(sx1 - sx0), h = Math.abs(sy1 - sy0);
                const pass = r.m ? (r.m.prnu_pct < 0.5) : null;
                nodes.push(
                  <g key={r.id}>
                    {sel && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
                                   fill="none" stroke={c} strokeWidth={3} opacity={0.28}
                                   strokeLinejoin="round" />}
                    <rect x={x} y={y} width={w} height={h} fill={c}
                          fillOpacity={sel ? 0.13 : 0.06}
                          stroke={c} strokeWidth={sel ? 2.2 : 1.4}
                          strokeDasharray={r.pending ? '6 3' : ''} />
                    <g transform={`translate(${x + 5}, ${y - 6})`}>
                      <rect x={0} y={-15} width={Math.max(70, (r.label || '').length * 7)}
                            height={15} rx={3}
                            fill="rgba(10,12,16,0.92)" stroke={c} strokeWidth={sel ? 1.2 : 0.6} />
                      <text x={5} y={-4} fill="#fff" fontSize={10}
                            fontFamily="ui-monospace,Menlo,monospace" fontWeight={500}>
                        {r.label || r.id.slice(0, 6)}
                      </text>
                    </g>
                    {r.m && <g transform={`translate(${x + w - 4}, ${y + 4})`}>
                      <rect x={-70} y={0} width={70} height={15} rx={3}
                            fill="rgba(10,12,16,0.88)"
                            stroke={pass === false ? '#f87171' : c} strokeWidth={0.6} />
                      <text x={-4} y={11} fill="#fff" fontSize={9.5}
                            textAnchor="end"
                            fontFamily="ui-monospace,Menlo,monospace">
                        {r.m.prnu_pct.toFixed(3)}%
                      </text>
                    </g>}
                  </g>
                );
              });
              // In-progress drag preview
              if (drawing) {
                const [sx0, sy0] = imgToScreen(drawing.x0, drawing.y0);
                const [sx1, sy1] = imgToScreen(drawing.x1, drawing.y1);
                const x = Math.min(sx0, sx1), y = Math.min(sy0, sy1);
                const w = Math.abs(sx1 - sx0), h = Math.abs(sy1 - sy0);
                nodes.push(
                  <g key="drawing">
                    <rect x={x} y={y} width={w} height={h}
                          fill="none" stroke="#ffd54f" strokeWidth={1.6}
                          strokeDasharray="5 3" />
                    <g transform={`translate(${x + 5}, ${y - 6})`}>
                      <rect x={0} y={-15} width={120} height={15} rx={3}
                            fill="rgba(10,12,16,0.92)" stroke="#ffd54f" strokeWidth={0.7} />
                      <text x={5} y={-4} fill="#ffd54f" fontSize={10}
                            fontFamily="ui-monospace,Menlo,monospace">
                        {drawing.x1 - drawing.x0} × {drawing.y1 - drawing.y0} px
                      </text>
                    </g>
                  </g>
                );
              }
              return nodes;
            })()}
          </svg>
        </div>

        <CanvasToolbar position="top-right">
          <CanvasBtn icon="rotate" label={`${rotation}°`} onClick={onRotate} title="Rotate canvas 90° (R)" />
          <CanvasBtn icon="flip" active={flipH} onClick={onFlipH} title="Flip horizontal" />
          <CanvasBtn icon="flip" active={flipV} onClick={onFlipV} title="Flip vertical" />
        </CanvasToolbar>
        <CanvasToolbar position="top-left">
          <CanvasBtn icon="crosshair" active={tool === 'pick' && !spacePan} onClick={() => setTool('pick')} title="Pick tool — draw ROIs" />
          <CanvasBtn icon="hand" active={tool === 'pan' || spacePan} onClick={() => setTool('pan')} title="Pan tool (or hold Space)" />
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', alignSelf: 'center' }} />
          <CanvasBtn icon="plus"   onClick={onZoomIn}    title="Zoom in" />
          <CanvasBtn icon="minus"  onClick={onZoomOut}   title="Zoom out" />
          <CanvasBtn icon="zoomReset" label={`${Math.round(zoom * 100)}%`} onClick={onZoomReset} title="Reset zoom (0)" />
          <CanvasBtn icon="fit"    onClick={onZoomReset} title="Fit to view (F)" />
          <CanvasBtn icon="undo"   onClick={onUndo}      title="Undo last ROI (⌘Z)" />
        </CanvasToolbar>

        <div style={{ position: 'absolute', bottom: 10, left: 26, right: 0,
                      display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ padding: '5px 12px', background: 'rgba(10,10,10,0.68)',
                        backdropFilter: 'blur(6px)', borderRadius: 20, fontSize: 10.5,
                        color: '#aab3bf', border: '1px solid rgba(255,255,255,0.05)' }}>
            <Kbd tone="dim">drag</Kbd> ROI ·
            <Kbd tone="dim">space</Kbd> pan ·
            <Kbd tone="dim">wheel</Kbd> zoom ·
            <Kbd tone="dim">rmb</Kbd> delete ·
            <Kbd tone="dim">click</Kbd> select ·
            <Kbd tone="dim">⌘Z</Kbd> undo
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Rulers — minimal inline versions for FPN (USAF has its own; we don't
// cross-import since each mode file is a self-contained Babel module in
// the current no-bundler setup).
// ---------------------------------------------------------------------------
const RulerH = ({ t, imgSize, step, ticks, zoom, panPx, cursorImg, leftInset }) => {
  // Width in screen px of the ruler strip is the container width minus
  // the top-left corner padding; we use 100% width and rely on the parent
  // letterbox math (mirror of object-fit: contain) to place ticks.
  return (
    <div style={{
      position: 'absolute', top: 0, left: leftInset, right: 0, height: 20,
      background: t.panelAlt, borderBottom: `1px solid ${t.border}`,
      pointerEvents: 'none', overflow: 'hidden',
      fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 9, color: t.textFaint,
    }}>
      <svg width="100%" height={20} style={{ display: 'block' }}>
        {/* Tick marks spaced by `step` image-px — display position comes from
            panPx + image-center offset. We approximate by assuming the
            center of the image maps to 50% of the canvas width; this ruler
            is decorative, not a measurement tool. */}
        {ticks.map(v => {
          const frac = v / imgSize;
          return (
            <g key={v}>
              <line x1={`${frac * 100}%`} y1={12} x2={`${frac * 100}%`} y2={20}
                    stroke={t.textFaint} strokeWidth={0.6} />
              <text x={`${frac * 100}%`} y={10} textAnchor="middle">{v}</text>
            </g>
          );
        })}
        {cursorImg != null && (
          <line x1={`${(cursorImg / imgSize) * 100}%`} y1={0}
                x2={`${(cursorImg / imgSize) * 100}%`} y2={20}
                stroke={t.accent} strokeWidth={1} />
        )}
      </svg>
    </div>
  );
};

const RulerV = ({ t, imgSize, step, ticks, zoom, panPx, cursorImg, topInset }) => {
  return (
    <div style={{
      position: 'absolute', top: topInset, left: 0, width: 26, bottom: 0,
      background: t.panelAlt, borderRight: `1px solid ${t.border}`,
      pointerEvents: 'none', overflow: 'hidden',
      fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 9, color: t.textFaint,
    }}>
      <svg width={26} height="100%" style={{ display: 'block' }}>
        {ticks.map(v => {
          const frac = v / imgSize;
          return (
            <g key={v}>
              <line x1={18} y1={`${frac * 100}%`} x2={26} y2={`${frac * 100}%`}
                    stroke={t.textFaint} strokeWidth={0.6} />
              <text x={14} y={`${frac * 100}%`} textAnchor="end" dy={3}>{v}</text>
            </g>
          );
        })}
        {cursorImg != null && (
          <line x1={0} y1={`${(cursorImg / imgSize) * 100}%`}
                x2={26} y2={`${(cursorImg / imgSize) * 100}%`}
                stroke={t.accent} strokeWidth={1} />
        )}
      </svg>
    </div>
  );
};

// ===========================================================================
// ROIsTable — sortable multi-select list of all ROIs
// ===========================================================================
const ROIsTable = ({ rois, selectedIds, toggleSel, sortCol, sortDir, setSort,
                     onDelete, onSelectAll, onClearAll, onCSV, onRename, totalROIs }) => {
  const t = useTheme();
  const [editingId, setEditingId] = useStateF(null);
  const cols = [
    { id: 'id',    label: 'Label',    w: 78,  title: 'Drag ROI label · click to rename' },
    { id: 'px',    label: 'Pixels',   w: 74,  title: 'ROI pixel count' },
    { id: 'mean',  label: 'μ DN',     w: 58,  title: 'Mean signal (pre-drift)' },
    { id: 'dsnu',  label: 'DSNU',     w: 54,  title: 'DSNU σ — post-drift pixel std' },
    { id: 'prnu',  label: 'PRNU %',   w: 62,  title: 'PRNU = σ/μ × 100' },
    { id: 'row',   label: 'σ row',    w: 52,  title: 'Row-mean σ' },
    { id: 'col',   label: 'σ col',    w: 52,  title: 'Col-mean σ' },
    { id: 'res',   label: 'σ res',    w: 54,  title: 'Residual σ after row+col strip' },
    { id: 'hot',   label: 'hot',      w: 38,  title: 'Hot-pixel count' },
  ];
  const cg = `20px ${cols.map(c => `${c.w}px`).join(' ')}`;
  const allSelected = selectedIds.size === totalROIs && totalROIs > 0;

  return (
    <Card title={`ROIs · ${totalROIs}${selectedIds.size ? ` (${selectedIds.size} sel)` : ''}`} icon="grid" pinned>
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: cg, gap: 0,
                      padding: '6px 10px', fontSize: 9.5, color: t.textMuted,
                      textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
                      background: t.panelAlt, borderBottom: `1px solid ${t.border}` }}>
          <Tip title="Select / deselect all">
            <input type="checkbox" checked={allSelected}
                   onChange={(e) => e.target.checked ? onSelectAll() : onClearAll()}
                   style={{ margin: 0, cursor: 'pointer' }} />
          </Tip>
          {cols.map(c => (
            <Tip key={c.id} title={c.title || `Sort by ${c.label}`}>
              <div onClick={() => setSort(c.id)} style={{ cursor: 'pointer',
                   display: 'flex', alignItems: 'center', gap: 2, userSelect: 'none' }}>
                {c.label}
                {sortCol === c.id && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
              </div>
            </Tip>
          ))}
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', background: t.panel }}>
          {rois.map((r, idx) => {
            const sel = selectedIds.has(r.id);
            const prnu = r.m?.prnu_pct;
            const color = !r.m ? t.textFaint
                       : prnu < 0.5 ? t.success
                       : prnu < 1.0 ? t.warn
                       : t.danger;
            const roiIdx = rois.findIndex(x => x.id === r.id);
            return (
              <div key={r.id} onClick={(e) => toggleSel(r.id, e.nativeEvent)}
                style={{ display: 'grid', gridTemplateColumns: cg, gap: 0,
                         padding: '6px 10px', fontSize: 10.5,
                         background: sel ? t.accentSoft : 'transparent',
                         color: sel ? t.accent : t.text, cursor: 'pointer',
                         fontFamily: 'ui-monospace,Menlo,monospace',
                         borderBottom: `1px solid ${t.border}`, alignItems: 'center' }}
                onMouseEnter={(e) => !sel && (e.currentTarget.style.background = t.panelAlt)}
                onMouseLeave={(e) => !sel && (e.currentTarget.style.background = 'transparent')}>
                <input type="checkbox" checked={sel} onChange={() => {}}
                       onClick={(e) => { e.stopPropagation(); toggleSel(r.id, e.nativeEvent); }}
                       style={{ margin: 0, cursor: 'pointer' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2,
                                 background: roiColor(roiIdx), flexShrink: 0 }} />
                  {editingId === r.id
                    ? <input
                        autoFocus
                        defaultValue={r.label || ''}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingId(null); }}
                        onBlur={(e) => { onRename?.(r.id, e.target.value.trim() || `ROI-${roiIdx + 1}`); setEditingId(null); }}
                        style={{ width: '100%', background: t.inputBg, color: t.text,
                                 border: `1px solid ${t.accent}`, borderRadius: 3,
                                 fontSize: 10.5, fontFamily: 'inherit', padding: '1px 3px' }} />
                    : <span onDoubleClick={(e) => { e.stopPropagation(); setEditingId(r.id); }}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                            title="double-click to rename">
                        {r.label || `ROI-${roiIdx + 1}`}
                      </span>}
                </div>
                <div style={{ color: t.textMuted }}>{(r.x1 - r.x0) * (r.y1 - r.y0)}</div>
                <div>{r.m ? fmtDN(r.m.mean_signal) : '…'}</div>
                <div>{r.m ? fmtDN(r.m.dsnu_dn) : '…'}</div>
                <div style={{ color, fontWeight: 500 }} title={r.pending ? 'measuring…' : ''}>
                  {r.m ? r.m.prnu_pct.toFixed(3) : r.pending ? '…' : 'err'}
                </div>
                <div style={{ color: t.textMuted }}>{r.m ? fmtDN(r.m.row_noise_dn) : '—'}</div>
                <div style={{ color: t.textMuted }}>{r.m ? fmtDN(r.m.col_noise_dn) : '—'}</div>
                <div style={{ color: t.textMuted }}>{r.m ? fmtDN(r.m.residual_pixel_noise_dn) : '—'}</div>
                <div style={{ color: (r.m?.hot_pixel_count || 0) > 0 ? t.warn : t.textFaint }}>
                  {r.m?.hot_pixel_count ?? '—'}
                </div>
              </div>
            );
          })}
          {rois.length === 0 && (
            <div style={{ padding: '18px 10px', fontSize: 11, color: t.textFaint, textAlign: 'center' }}>
              No ROIs yet — drag on the canvas to define one.
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Tip title={`Delete ${selectedIds.size} selected`}>
          <Button icon="trash" size="xs" variant="danger"
            disabled={selectedIds.size === 0} onClick={onDelete}>
            Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
          </Button>
        </Tip>
        <Tip title="Select all">
          <Button size="xs" onClick={onSelectAll} disabled={totalROIs === 0}>Select all</Button>
        </Tip>
        <Tip title="Delete all ROIs">
          <Button size="xs" onClick={onClearAll} disabled={totalROIs === 0}>Clear all</Button>
        </Tip>
        <div style={{ flex: 1 }} />
        <Tip title="Download measured ROIs as CSV">
          <Button size="xs" icon="export" disabled={totalROIs === 0} onClick={onCSV}>CSV</Button>
        </Tip>
      </div>
      <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6,
                    fontFamily: 'ui-monospace,Menlo,monospace' }}>
        ⇧-click range · ⌘-click toggle · 2×-click label to rename
      </div>
    </Card>
  );
};

// ===========================================================================
// FPNLiveStats — rich stats for the selected ROI
// ===========================================================================
const FPNLiveStats = ({ roi, full, multiCount }) => {
  const t = useTheme();
  if (!roi) {
    return <Card title="Selected ROI stats" icon="pin" pinned>
      <div style={{ fontSize: 11, color: t.textFaint, padding: '14px 4px', textAlign: 'center' }}>
        Select an ROI in the table or click one on the canvas.
      </div>
    </Card>;
  }
  const m = roi.m;
  if (!m) {
    return <Card title="Selected ROI stats" icon="pin" pinned>
      <div style={{ fontSize: 11, color: t.textFaint, padding: '14px 4px', textAlign: 'center' }}>
        {roi.pending ? 'measuring…' : (roi.error || 'no data')}
      </div>
    </Card>;
  }
  return (
    <Card title={`${roi.label || 'ROI'} · stats`} icon="pin" pinned>
      {multiCount > 1 && (
        <div style={{ fontSize: 10.5, color: t.textMuted, marginBottom: 6 }}>
          {multiCount} ROIs selected · showing {roi.label || roi.id.slice(0, 6)}
        </div>
      )}
      <StatBlock
        emphasis="prnu"
        items={[
          { label: 'μ signal',     value: `${fmtDN(m.mean_signal)} DN` },
          { label: 'σ (DSNU)',     value: `${fmtDN(m.dsnu_dn)} DN` },
          { label: 'PRNU',         key: 'prnu',
            value: `${m.prnu_pct.toFixed(3)} %`,
            color: m.prnu_pct < 0.5 ? t.success : m.prnu_pct < 1.0 ? t.warn : t.danger },
          { label: 'σ rows',       value: `${fmtDN(m.row_noise_dn)} DN`, muted: true },
          { label: 'σ cols',       value: `${fmtDN(m.col_noise_dn)} DN`, muted: true },
          { label: 'σ row-strip',  value: `${fmtDN(m.dsnu_row_only_dn)} DN`, muted: true },
          { label: 'σ col-strip',  value: `${fmtDN(m.dsnu_col_only_dn)} DN`, muted: true },
          { label: 'σ residual',   value: `${fmtDN(m.residual_pixel_noise_dn)} DN`, muted: true },
          { label: 'row peak f',   value: m.row_peak_freq ? `${m.row_peak_freq.toFixed(4)} cy` : '—', muted: true },
          { label: 'col peak f',   value: m.col_peak_freq ? `${m.col_peak_freq.toFixed(4)} cy` : '—', muted: true },
          { label: 'hot / cold',   value: `${m.hot_pixel_count} / ${m.cold_pixel_count}`,
            color: m.hot_pixel_count === 0 && m.cold_pixel_count === 0 ? t.success : t.warn },
          { label: 'kept px',      value: `${m.n_kept.toLocaleString()} / ${m.n_total.toLocaleString()}`, muted: true },
          { label: 'drift',        value: m.drift_order, muted: true },
        ]}
      />
      <div style={{ fontSize: 10, color: t.textFaint, marginTop: 8, lineHeight: 1.4 }}>
        Live summary from /api/fpn/compute — updates within ~200 ms of any ROI / setting change.
      </div>
    </Card>
  );
};

// ===========================================================================
// FPNProfilePreview — row-mean / col-mean profile plots for selected ROI
// ===========================================================================
const FPNProfilePreview = ({ roi, full }) => {
  const t = useTheme();
  if (!roi) return null;
  if (!full) {
    return <Card title="Profile preview" icon="eye" pinned>
      <div style={{ fontSize: 11, color: t.textFaint, padding: '14px 4px', textAlign: 'center' }}>
        Loading profiles…
      </div>
    </Card>;
  }
  return (
    <Card title={`Profile preview · ${roi.label || 'ROI'}`} icon="eye" pinned>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
        <MiniProfile title="Row means (y →)" values={full.row_means} color={t.accent} />
        <MiniProfile title="Col means (x →)" values={full.col_means} color="#22c55e" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 4 }}>
        <MiniPSD title="Row PSD" freq={full.row_freq} psd={full.row_psd}
                 peakFreq={full.row_peak_freq} color={t.accent} />
        <MiniPSD title="Col PSD" freq={full.col_freq} psd={full.col_psd}
                 peakFreq={full.col_peak_freq} color="#22c55e" />
      </div>
      <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
        Row/col means catch banding. PSD peaks away from DC indicate clocked / periodic FPN.
      </div>
    </Card>
  );
};

const MiniProfile = ({ title, values, color }) => {
  const t = useTheme();
  const vs = (values || []).map(v => (v == null ? NaN : v));
  const valid = vs.filter(Number.isFinite);
  if (!valid.length) {
    return <div style={{ fontSize: 10.5, color: t.textFaint }}>{title}: no data</div>;
  }
  const W = 280, H = 58;
  const lo = Math.min(...valid), hi = Math.max(...valid);
  const mid = (lo + hi) / 2, range = Math.max(1e-9, hi - lo) * 1.08;
  const N = vs.length;
  const pts = vs.map((v, i) => {
    const x = (i / Math.max(1, N - 1)) * W;
    const y = Number.isFinite(v) ? H * (1 - ((v - (mid - range / 2)) / range)) : null;
    return y == null ? null : `${x.toFixed(2)},${y.toFixed(2)}`;
  }).filter(Boolean).join(' ');
  return (
    <div>
      <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2,
                    fontFamily: 'ui-monospace,Menlo,monospace' }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
           style={{ background: t.panelAlt, borderRadius: 4, border: `1px solid ${t.border}` }}>
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={t.border} strokeWidth={0.6} strokeDasharray="3 3" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5,
                    color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}>
        <span>{fmtDN(lo)}</span><span>{fmtDN(hi)}</span>
      </div>
    </div>
  );
};

const MiniPSD = ({ title, freq, psd, peakFreq, color }) => {
  const t = useTheme();
  if (!freq?.length || !psd?.length) {
    return <div style={{ fontSize: 10, color: t.textFaint }}>{title}: no data</div>;
  }
  // Plot log PSD, excluding DC bin.
  const W = 140, H = 70;
  const f = freq.slice(1), p = psd.slice(1);
  if (!p.length) return null;
  const logP = p.map(v => Math.log10((v || 1e-12) + 1e-12));
  const lo = Math.min(...logP), hi = Math.max(...logP);
  const range = Math.max(1e-9, hi - lo);
  const pts = f.map((fx, i) => {
    const x = (fx / 0.5) * W;
    const y = H * (1 - (logP[i] - lo) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const peakX = peakFreq ? (peakFreq / 0.5) * W : null;
  return (
    <div>
      <div style={{ fontSize: 10, color: t.textFaint, marginBottom: 2,
                    fontFamily: 'ui-monospace,Menlo,monospace' }}>{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
           style={{ background: t.panelAlt, borderRadius: 4, border: `1px solid ${t.border}` }}>
        {peakX != null && peakX > 0 && peakX < W && (
          <line x1={peakX} y1={0} x2={peakX} y2={H} stroke="#ffd54f" strokeWidth={0.8} strokeDasharray="2 2" />
        )}
        <polyline points={pts} fill="none" stroke={color} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ fontSize: 9.5, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}>
        peak {peakFreq ? peakFreq.toFixed(4) : '—'} cy · 0 → ½ cy axis
      </div>
    </div>
  );
};

// ===========================================================================
// FPNStabilityCard — shrinking-ROI stability curve for the selected ROI
// ===========================================================================
const FPNStabilityCard = ({ roi, enabled, setEnabled, curve }) => {
  const t = useTheme();
  const actions = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10,
                      color: enabled ? t.accent : t.textMuted, cursor: 'pointer' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               style={{ margin: 0, cursor: 'pointer' }} />
        {enabled ? 'ON' : 'OFF'}
      </label>
    </div>
  );
  return (
    <Card title="PRNU stability curve" icon="settings" actions={actions}>
      {!roi ? (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '10px 4px', textAlign: 'center' }}>
          Select an ROI to run stability.
        </div>
      ) : !enabled ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.4 }}>
          Shrinks the ROI concentrically and plots PRNU vs ROI size. A flat curve = statistics have stabilised. Enable when you want to check whether the ROI is large enough for a trustworthy PRNU number.
        </div>
      ) : !curve ? (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '10px 4px', textAlign: 'center' }}>
          computing…
        </div>
      ) : (
        <StabilityChart curve={curve} />
      )}
    </Card>
  );
};

const StabilityChart = ({ curve }) => {
  const t = useTheme();
  if (!curve?.length) return null;
  const W = 260, H = 130, PAD_L = 40, PAD_R = 10, PAD_T = 8, PAD_B = 24;
  const xs = curve.map(p => p.frac);
  const ys = curve.map(p => p.prnu_pct).map(v => Number.isFinite(v) ? v : 0);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = Math.max(...ys) * 1.2 || 1;
  const xToPx = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yToPx = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const pts = curve.map(p => `${xToPx(p.frac)},${yToPx(p.prnu_pct || 0)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75, 1.0].map(f => (
          <g key={f}>
            <line x1={xToPx(f)} y1={PAD_T} x2={xToPx(f)} y2={H - PAD_B}
                  stroke={t.border} strokeWidth={0.5} strokeDasharray="2 2" />
            <text x={xToPx(f)} y={H - PAD_B + 12} fontSize={8.5} fill={t.textMuted} textAnchor="middle"
                  fontFamily="ui-monospace,Menlo,monospace">{(f * 100).toFixed(0)}%</text>
          </g>
        ))}
        {[0, yMax / 2, yMax].map(v => (
          <g key={v}>
            <line x1={PAD_L} y1={yToPx(v)} x2={W - PAD_R} y2={yToPx(v)}
                  stroke={t.border} strokeWidth={0.5} />
            <text x={PAD_L - 5} y={yToPx(v) + 3} fontSize={8.5} fill={t.textMuted} textAnchor="end"
                  fontFamily="ui-monospace,Menlo,monospace">{v.toFixed(2)}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={t.accent} strokeWidth={1.6} />
        {curve.map((p, i) => (
          <circle key={i} cx={xToPx(p.frac)} cy={yToPx(p.prnu_pct || 0)} r={3.2}
                  fill={t.accent} stroke="#fff" strokeWidth={0.8}>
            <title>{`${(p.frac * 100).toFixed(0)}%  ·  ${p.size_h}×${p.size_w}  ·  PRNU ${p.prnu_pct?.toFixed(3) ?? '—'}%`}</title>
          </circle>
        ))}
        <text x={PAD_L + (W - PAD_L - PAD_R) / 2} y={H - 4} fontSize={9.5} fill={t.textMuted} textAnchor="middle">
          ROI size fraction
        </text>
        <text x={10} y={PAD_T + (H - PAD_T - PAD_B) / 2} fontSize={9.5} fill={t.textMuted}
              textAnchor="middle"
              transform={`rotate(-90 10 ${PAD_T + (H - PAD_T - PAD_B) / 2})`}>
          PRNU (%)
        </text>
      </svg>
      <div style={{ fontSize: 10, color: t.textFaint, marginTop: 4, fontFamily: 'ui-monospace,Menlo,monospace', lineHeight: 1.5 }}>
        {curve.map((p, i) => <span key={i} style={{ marginRight: 8 }}>
          {(p.frac * 100).toFixed(0)}%:{p.prnu_pct != null ? p.prnu_pct.toFixed(3) : '—'}
        </span>)}
      </div>
    </div>
  );
};

Object.assign(window, { FPNMode });
