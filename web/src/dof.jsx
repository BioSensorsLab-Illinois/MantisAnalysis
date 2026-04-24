// DoF mode — server-backed, full feature set.
//
// Matches USAF / FPN UX (rulers, zoom-to-cursor, pan, shortcuts, display
// knobs, save/load, sortable tables) and adds DoF-specific research
// extras through the server:
//
//   * Gaussian fit on every line scan (μ, σ, FWHM, R² overlaid live).
//   * 4-metric parallel compute (laplacian / brenner / tenengrad / fft_hf).
//   * Bootstrap 95% CI on peak position + DoF width per line.
//   * Tilt / field-curvature plane fit over picked points.
//   * Stability curve (DoF width vs half-window).
//   * Per-channel analysis — one live pipeline per selected channel.
//   * H / V reference tool for px↔μm calibration.
//
// BioSensors Lab · UIUC · Zhongmin Zhu <j@polarxphotonics.com>

// bundler-migration-v1 Phase 3: ES-module native.
import React from 'react';
import {
  CHANNEL_COLORS, useTheme, defaultAnalysisChannels,
  Icon, Card, Row, Slider, Select, Button, ChannelChip, Segmented,
  Checkbox, StatBlock, CanvasToolbar, CanvasBtn,
  parseChannel, Tip, Kbd, Modal,
  useLocalStorageState, distSegment, exportJSON, exportCSV,
  apiFetch, channelPngUrl, useSource, useDebounced,
  ResizeHandle,
} from './shared.jsx';

const { useState: useStateD, useEffect: useEffectD, useRef: useRefD,
        useMemo: useMemoD, useCallback: useCallbackD } = React;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DOF_UNITS = ['μm', 'mm', 'cm'];
const DOF_TO_MICRONS = { 'μm': 1, 'mm': 1000, 'cm': 10000 };

const dofChipId = (c) => c.includes('-') ? c : (c === 'L' ? 'HG-Y' : `HG-${c}`);

const POINT_COLORS = ['#4a9eff', '#22c55e', '#f59e0b', '#a855f7',
                       '#ef4444', '#14b8a6', '#f472b6', '#84cc16'];
const LINE_COLORS = ['#30b453', '#ffd54f', '#f97316', '#ec4899',
                      '#8b5cf6', '#06b6d4', '#64748b', '#eab308'];
const pointColor = (i) => POINT_COLORS[i % POINT_COLORS.length];
const lineColor  = (i) => LINE_COLORS[i % LINE_COLORS.length];

const genId = (prefix) => prefix + Date.now().toString(36) + '_' +
                          Math.floor(Math.random() * 1e4).toString(36);

const fmtLen = (px, unit, pxPerMicron, digits = 2) => {
  if (!Number.isFinite(px)) return '—';
  if (pxPerMicron && pxPerMicron > 0) {
    const v = (px / pxPerMicron) / DOF_TO_MICRONS[unit];
    const d = unit === 'μm' ? 1 : unit === 'mm' ? 3 : 4;
    return `${v.toFixed(d)} ${unit}`;
  }
  return `${px.toFixed(digits)} px`;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
const DoFMode = ({ onRunAnalysis, onStatusChange, say, onSwitchSource, onOpenFile }) => {
  const t = useTheme();
  const source = useSource();
  const available = source?.channels || [];
  const defaultCh = available.includes('HG-G') ? 'HG-G'
                 : available.includes('G')     ? 'G'
                 : available.includes('L')     ? 'L'
                 : available[0] || null;

  // ---- Source / channel --------------------------------------------------
  const [activeChannel, setActiveChannel] = useStateD(defaultCh);
  // ISP-modes-v1: channel defaults derive from the active mode via
  // defaultAnalysisChannels() so switching ISP mode re-picks sensibly.
  const [analysisChannels, setAnalysisChannels] = useLocalStorageState('dof/analysisChannels',
    defaultAnalysisChannels(available));
  const [rgbCompositeDisplay] = useLocalStorageState('ispSettings/rgbComposite', false);

  // ---- Focus-metric knobs ------------------------------------------------
  const [metric,    setMetric]    = useLocalStorageState('dof/metric', 'laplacian');
  const [halfWin,   setHalfWin]   = useLocalStorageState('dof/halfWin', 32);
  const [threshold, setThreshold] = useLocalStorageState('dof/threshold', 0.5);
  const [bootstrap, setBootstrap] = useLocalStorageState('dof/bootstrap', false);
  const [allMetrics,setAllMetrics]= useLocalStorageState('dof/allMetrics', false);
  const [tiltPlane, setTiltPlane] = useLocalStorageState('dof/tiltPlane', false);
  // B-0021 — physical-target tilt angle (degrees off the image plane).
  // Applied as a 1/cos(θ) scale to reported peak / σ / FWHM / DoF width
  // so sample-plane numbers come out right. Only meaningful when the
  // picker has a calibration; clamped to [0, 89]° to avoid the cos→0
  // singularity. 0 = no correction.
  const [tiltAngleDeg, setTiltAngleDeg] = useLocalStorageState('dof/tiltAngleDeg', 0);

  // ---- View transforms ----------------------------------------------------
  const [rotation, setRotation] = useStateD(0);
  const [flipH,    setFlipH]    = useStateD(false);
  const [flipV,    setFlipV]    = useStateD(false);
  const [zoom,     setZoom]     = useStateD(1);
  const [pan,      setPan]      = useStateD([0, 0]);
  const [tool,     setTool]     = useStateD('focus');    // focus | ref-h | ref-v | pan
  const [spacePan, setSpacePan] = useStateD(false);

  // ---- Resizable panels --------------------------------------------------
  const [leftW,  setLeftW]  = useLocalStorageState('dof/leftW', 320);
  const [rightW, setRightW] = useLocalStorageState('dof/rightW', 400);

  // ---- Display -----------------------------------------------------------
  const [brightness, setBrightness] = useLocalStorageState('dof/brightness', 0);
  const [contrast,   setContrast]   = useLocalStorageState('dof/contrast', 1);
  const [gamma,      setGamma]      = useLocalStorageState('dof/gamma', 1);
  const [colormap,   setColormap]   = useLocalStorageState('dof/colormap', 'gray');

  // ---- ISP (server-side) -------------------------------------------------
  const [ispEnabled,  setIspEnabled]  = useLocalStorageState('dof/isp/enabled', false);
  const [ispLive,     setIspLive]     = useLocalStorageState('dof/isp/live', true);
  const [ispMethod,   setIspMethod]   = useLocalStorageState('dof/isp/method', 'Unsharp mask');
  const [ispSharp,    setIspSharp]    = useLocalStorageState('dof/isp/sharp', 0.3);
  const [ispRadius,   setIspRadius]   = useLocalStorageState('dof/isp/radius', 1.2);
  const [ispDenoise,  setIspDenoise]  = useLocalStorageState('dof/isp/denoise', 0.2);
  const [ispBlackLvl, setIspBlackLvl] = useLocalStorageState('dof/isp/black', 0);
  const buildIspPayload = () => {
    if (!ispEnabled || !ispLive) return null;
    if (ispSharp <= 0 && ispDenoise <= 0 && ispBlackLvl <= 0) return null;
    return {
      sharpen_method: ispSharp > 0 ? ispMethod : null,
      sharpen_amount: ispSharp,
      sharpen_radius: ispRadius,
      denoise_sigma: ispDenoise * 2.5,
      black_level: ispBlackLvl,
    };
  };

  // ---- Probe state -------------------------------------------------------
  const [points,       setPoints]       = useStateD([]);
  const [lines,        setLines]        = useStateD([]);
  const [refs,         setRefs]         = useLocalStorageState('dof/refs', []);
  // Independent H and V active references. Pre-v2 configs with a single
  // `activeRef` localStorage key still apply as a fallback for whichever
  // axis is missing. Use `null` to mean "no active ref of this axis".
  const [activeRefIdH, setActiveRefIdH] = useLocalStorageState('dof/activeRefH', null);
  const [activeRefIdV, setActiveRefIdV] = useLocalStorageState('dof/activeRefV', null);
  const [displayUnit,  setDisplayUnit]  = useLocalStorageState('dof/displayUnit', 'μm');
  const [selPoints,    setSelPoints]    = useStateD(new Set());
  const [selLines,     setSelLines]     = useStateD(new Set());
  const [drawing,      setDrawing]      = useStateD(null);
  const [cursor,       setCursor]       = useStateD(null);
  const [showRefDialog,setShowRefDialog]= useStateD(null);
  const canvasRef = useRefD(null);

  // ---- Image sizing ------------------------------------------------------
  const [imgDims, setImgDims] = useStateD({ w: source?.shape?.[1] || 720, h: source?.shape?.[0] || 540 });
  const imgSrc = useMemoD(() => {
    if (!source || !activeChannel) return null;
    const isp = buildIspPayload();
    const rgbComposite = !!(rgbCompositeDisplay && source.rgb_composite_available);
    return channelPngUrl(source.source_id, activeChannel, 1600, isp, colormap,
                         null, null, rgbComposite);
    // eslint-disable-next-line
  }, [source, activeChannel, colormap, ispEnabled, ispLive, ispMethod,
       ispSharp, ispRadius, ispDenoise, ispBlackLvl, rgbCompositeDisplay]);

  // ---- Calibration -------------------------------------------------------
  // H / V refs are selected independently. Each ref carries an `axis`
  // ('h' or 'v'). The px-per-micron ratio is the stroke length (in px)
  // divided by the user-stated length (converted to µm). When only one
  // axis has an active ref we fall back to it for the other axis so
  // old (isotropic) workflows keep working — the calibration warn chip
  // in the card tells the user what's being substituted.
  const refsH = useMemoD(() => refs.filter(r => r.axis === 'h'), [refs]);
  const refsV = useMemoD(() => refs.filter(r => r.axis === 'v'), [refs]);

  const activeHRef = useMemoD(() => {
    if (!refsH.length) return null;
    return (activeRefIdH && refsH.find(r => r.id === activeRefIdH))
        || refsH[refsH.length - 1];
  }, [refsH, activeRefIdH]);
  const activeVRef = useMemoD(() => {
    if (!refsV.length) return null;
    return (activeRefIdV && refsV.find(r => r.id === activeRefIdV))
        || refsV[refsV.length - 1];
  }, [refsV, activeRefIdV]);

  const _pxPerMicronForRef = (r) => {
    if (!r) return null;
    const dx = r.p1[0] - r.p0[0];
    const dy = r.p1[1] - r.p0[1];
    const px = Math.hypot(dx, dy);
    const microns = r.lengthValue * DOF_TO_MICRONS[r.unit];
    return microns > 0 ? px / microns : null;
  };
  const pxPerMicronH = useMemoD(() => _pxPerMicronForRef(activeHRef), [activeHRef]);
  const pxPerMicronV = useMemoD(() => _pxPerMicronForRef(activeVRef), [activeVRef]);

  // For display (mean axial ratio) — used for scalar px→µm formatting of
  // quantities that are line-distance (neither horizontal nor vertical).
  // When only one axis is set we substitute it for the missing one.
  const pxPerMicronMean = useMemoD(() => {
    const h = pxPerMicronH, v = pxPerMicronV;
    if (h && v) return (h + v) / 2;
    if (h) return h;
    if (v) return v;
    return null;
  }, [pxPerMicronH, pxPerMicronV]);
  const anisotropic = useMemoD(() => {
    if (!pxPerMicronH || !pxPerMicronV) return false;
    const ratio = pxPerMicronH / pxPerMicronV;
    return ratio < 0.98 || ratio > 1.02;
  }, [pxPerMicronH, pxPerMicronV]);
  const calibrated = pxPerMicronMean != null && pxPerMicronMean > 0;
  const fmt = (px, d = 2) => fmtLen(px, displayUnit, pxPerMicronMean, d);
  // Send per-axis values to the server. The server treats these as
  // x-axis and y-axis scales respectively, so a line between two points
  // gets its own effective scale via sqrt((dx/ph)² + (dy/pv)²).
  const calibrationPayload = () => {
    if (!calibrated) return null;
    const toDisplay = (pxPerMicron) => pxPerMicron * DOF_TO_MICRONS[displayUnit];
    const ph = pxPerMicronH ?? pxPerMicronMean;
    const pv = pxPerMicronV ?? pxPerMicronMean;
    return {
      unit: displayUnit,
      px_per_unit_h: toDisplay(ph),
      px_per_unit_v: toDisplay(pv),
    };
  };

  // ---- Debounced live compute --------------------------------------------
  const dPoints = useDebounced(points, 220);
  const dLines = useDebounced(lines, 220);
  const dParams = useDebounced({ metric, halfWin, threshold, allMetrics, bootstrap, tiltPlane }, 200);
  const dIspKey = useDebounced(JSON.stringify(buildIspPayload() || null), 200);
  const [focus, setFocus] = useStateD(null);        // per-(channel × probe) result
  const [computing, setComputing] = useStateD(false);

  useEffectD(() => {
    if (!source || !activeChannel) { setFocus(null); return; }
    if (!dPoints.length && !dLines.length) { setFocus(null); return; }
    let alive = true; setComputing(true);
    apiFetch('/api/dof/compute', { method: 'POST', body: {
      source_id: source.source_id,
      channel: activeChannel,
      points: dPoints.map(p => ({ x: p.x, y: p.y, label: p.label || '' })),
      lines: dLines.map(l => ({ p0: l.p0, p1: l.p1 })),
      metric: dParams.metric,
      half_window: dParams.halfWin,
      threshold: dParams.threshold,
      calibration: calibrationPayload(),
      isp: buildIspPayload(),
      compute_all_metrics: dParams.allMetrics,
      bootstrap: dParams.bootstrap, n_boot: 150,
      fit_tilt_plane: dParams.tiltPlane,
    }}).then(r => { if (alive) { setFocus(r); setComputing(false); } })
      .catch(err => { if (alive) {
        say?.(`focus compute failed: ${err.detail || err.message}`, 'danger');
        setComputing(false); setFocus(null);
      }});
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [source?.source_id, activeChannel, dPoints, dLines, dParams, calibrated,
      pxPerMicronH, pxPerMicronV, displayUnit, dIspKey]);

  // ---- Stability curve for the first selected line -----------------------
  // `stabState` goes through: idle → loading → ready|error|no-line. The
  // UI shows a clear message for each state so "turn it on, see nothing
  // happen" never occurs — there's always a visible status line.
  const [stabEnabled, setStabEnabled] = useStateD(false);
  const [stabCurve,   setStabCurve]   = useStateD(null);
  const [stabState,   setStabState]   = useStateD('idle');
  const [stabError,   setStabError]   = useStateD(null);
  const firstSelectedLine = useMemoD(() => {
    if (!selLines.size) return lines[0] || null;
    return lines.find(l => selLines.has(l.id)) || null;
  }, [lines, selLines]);
  useEffectD(() => {
    if (!stabEnabled || !source) {
      setStabCurve(null); setStabState('idle'); setStabError(null); return;
    }
    if (!firstSelectedLine) {
      setStabCurve(null); setStabState('no-line'); setStabError(null); return;
    }
    let alive = true;
    setStabState('loading'); setStabError(null);
    apiFetch('/api/dof/stability', { method: 'POST', body: {
      source_id: source.source_id, channel: activeChannel,
      p0: firstSelectedLine.p0, p1: firstSelectedLine.p1,
      metric, threshold,
      windows: [8, 12, 16, 24, 32, 48, 64],
      isp: buildIspPayload(),
    }}).then(r => {
      if (!alive) return;
      setStabCurve(r.curve || null);
      setStabState((r.curve || []).length ? 'ready' : 'error');
      if (!((r.curve || []).length)) setStabError('server returned an empty curve');
    }).catch(err => {
      if (!alive) return;
      setStabCurve(null); setStabState('error');
      setStabError(err.detail || err.message || 'unknown failure');
    });
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [stabEnabled, source?.source_id, activeChannel,
      firstSelectedLine?.id, firstSelectedLine?.p0,
      firstSelectedLine?.p1, metric, threshold, dIspKey]);

  // ---- Coord transforms --------------------------------------------------
  const toImg = useCallbackD((ev) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return [0, 0];
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
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

  // ---- Mouse handlers ----------------------------------------------------
  const isPanning = (ev) => ev.button === 1 || tool === 'pan' || spacePan;

  const onCanvasDown = (ev) => {
    if (ev.button === 2) { ev.preventDefault(); deleteNearest(toImg(ev)); return; }
    if (isPanning(ev)) {
      ev.preventDefault();
      const sx = ev.clientX, sy = ev.clientY;
      const [px0, py0] = pan;
      const move = (e) => setPan([px0 + (e.clientX - sx), py0 + (e.clientY - sy)]);
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      return;
    }
    if (ev.button !== 0) return;
    const p0 = toImg(ev);
    const startX = ev.clientX, startY = ev.clientY;
    let dragged = false;
    const onMove = (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) dragged = true;
      if (dragged) {
        let p1 = toImg(e);
        if (tool === 'ref-h') p1 = [p1[0], p0[1]];
        if (tool === 'ref-v') p1 = [p0[0], p1[1]];
        setDrawing({ p0, p1, tool });
      }
    };
    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setDrawing(null);
      if (!dragged) {
        if (tool === 'focus') {
          const id = genId('p');
          setPoints(prev => {
            const label = `p${prev.length + 1}`;
            return [...prev, { id, x: p0[0], y: p0[1], label }];
          });
          setSelPoints(new Set([id]));
        }
        return;
      }
      let p1 = toImg(e);
      if (tool === 'ref-h') p1 = [p1[0], p0[1]];
      if (tool === 'ref-v') p1 = [p0[0], p1[1]];
      if (tool === 'focus') {
        const id = genId('l');
        setLines(prev => {
          const label = `L${prev.length + 1}`;
          return [...prev, { id, p0, p1, label }];
        });
        setSelLines(new Set([id]));
      } else {
        setShowRefDialog({ axis: tool === 'ref-h' ? 'h' : 'v', p0, p1 });
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

  const deleteNearest = (pt) => {
    const allPts = points.map((p, i) => ({ kind: 'pt', i, id: p.id, d: Math.hypot(p.x - pt[0], p.y - pt[1]) }));
    const allLn = lines.map((l, i) => ({ kind: 'ln', i, id: l.id, d: distSegment(pt, l.p0, l.p1) }));
    const allRf = refs.map((r, i) => ({ kind: 'rf', i, id: r.id, d: distSegment(pt, r.p0, r.p1) }));
    const all = [...allPts, ...allLn, ...allRf].sort((a, b) => a.d - b.d);
    if (!all.length || all[0].d > 20) return;
    const h = all[0];
    if (h.kind === 'pt') setPoints(p => p.filter(x => x.id !== h.id));
    if (h.kind === 'ln') setLines(l => l.filter(x => x.id !== h.id));
    if (h.kind === 'rf') setRefs(r => r.filter(x => x.id !== h.id));
  };

  // ---- Keyboard shortcuts ------------------------------------------------
  useEffectD(() => {
    const down = (e) => {
      if (document.activeElement?.tagName === 'INPUT' ||
          document.activeElement?.isContentEditable) return;
      if (e.code === 'Space' && !e.repeat) { setSpacePan(true); e.preventDefault(); return; }
      if (e.key === 'Escape') {
        // Escape clears selection AND drops out of any ref-mode so the user
        // can always return to the default Focus tool with one keystroke.
        setSelPoints(new Set()); setSelLines(new Set());
        setShowRefDialog(null);
        if (tool === 'ref-h' || tool === 'ref-v' || tool === 'pan') setTool('focus');
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        if (lines.length) setLines(l => l.slice(0, -1));
        else if (points.length) setPoints(p => p.slice(0, -1));
        e.preventDefault(); return;
      }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        setSelPoints(new Set(points.map(p => p.id)));
        setSelLines(new Set(lines.map(l => l.id)));
        e.preventDefault(); return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selPoints.size) setPoints(p => p.filter(x => !selPoints.has(x.id)));
        if (selLines.size)  setLines(l => l.filter(x => !selLines.has(x.id)));
      }
      if (e.key === 'r' || e.key === 'R') setRotation(r => (r + 90) % 360);
      if (e.key === 'f' || e.key === 'F' || e.key === '0') {
        setZoom(1); setPan([0, 0]);
      }
      if (e.key === 'p' || e.key === 'P') setTool('focus');
      if (e.key === 'h' || e.key === 'H') setTool('ref-h');
      if (e.key === 'v' || e.key === 'V') setTool('ref-v');
    };
    const up = (e) => { if (e.code === 'Space') setSpacePan(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
    // `tool` is in the dep list so Escape always sees the live tool state —
    // otherwise the handler closure would keep a stale value and the
    // "drop out of ref-mode on Escape" contract would silently break.
  }, [points, lines, selPoints, selLines, tool]);

  // ---- Status bar --------------------------------------------------------
  useEffectD(() => {
    let cal = ' · uncalibrated';
    if (pxPerMicronH && pxPerMicronV) {
      cal = ` · cal H=${pxPerMicronH.toFixed(3)} V=${pxPerMicronV.toFixed(3)} px/μm`;
    } else if (pxPerMicronMean) {
      cal = ` · cal ${pxPerMicronMean.toFixed(3)} px/μm (single-axis)`;
    }
    const l0 = focus?.lines?.[0];
    const peakTag = l0
      ? ` · L1 peak ${fmt(l0.gaussian?.converged ? l0.gaussian.mu : l0.peak_position_px)}`
      : '';
    onStatusChange?.(
      `${points.length} pts · ${lines.length} lines${cal}${peakTag}`,
      points.length + lines.length,
    );
  }, [points.length, lines.length, pxPerMicronH, pxPerMicronV, pxPerMicronMean, focus, displayUnit]);

  // ---- Save / Load JSON --------------------------------------------------
  const fileInputRef = useRefD(null);
  // Open the source via absolute disk path — preserves source.path so
  // Save/Load cfg actually round-trips a re-load on the next session.
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

  const exportConfig = () => {
    const cfg = {
      kind: 'mantis-dof-config', version: 2, exportedAt: new Date().toISOString(),
      source: { name: source?.name, kind: source?.kind, path: source?.path || null },
      picker: { activeChannel, analysisChannels, metric, halfWin, threshold,
                allMetrics, bootstrap, tiltPlane, tiltAngleDeg, displayUnit },
      view: { rotation, flipH, flipV, zoom, brightness, contrast, gamma, colormap },
      isp: { enabled: ispEnabled, live: ispLive, method: ispMethod,
             sharp: ispSharp, radius: ispRadius, denoise: ispDenoise, blackLvl: ispBlackLvl },
      points: points.map(p => ({ id: p.id, x: p.x, y: p.y, label: p.label || '' })),
      lines: lines.map(l => ({ id: l.id, p0: l.p0, p1: l.p1, label: l.label || '' })),
      refs: refs.map(r => ({ id: r.id, axis: r.axis, p0: r.p0, p1: r.p1,
                              lengthValue: r.lengthValue, unit: r.unit })),
      activeRefIdH, activeRefIdV,
      selPoints: [...selPoints], selLines: [...selLines],
    };
    exportJSON(`mantis-dof-${Date.now()}.json`, cfg);
    say?.(`Config saved${source?.path ? ' (with source path)' : ''}`, 'success');
  };
  const importConfig = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const cfg = JSON.parse(text);
      if (cfg.kind !== 'mantis-dof-config') throw new Error('Not a MantisAnalysis DoF config');
      const cfgPath = cfg.source?.path || null;
      if (cfgPath && cfgPath !== source?.path) {
        try {
          const s = await apiFetch('/api/sources/load-path', { method: 'POST', body: { path: cfgPath } });
          onSwitchSource?.(s);
          say?.(`Loaded source from ${cfgPath}`, 'success');
        } catch (err) {
          say?.(`Could not auto-load ${cfgPath} (${err.detail || err.message}); using current source`, 'warn');
        }
      } else if (cfg.source?.name && !cfgPath && (!source || source.name !== cfg.source.name)) {
        say?.(`Config references "${cfg.source.name}" but no path is stored (browser upload). Use "Open H5 / image…" to load it.`, 'warn');
      }
      const p = cfg.picker || {};
      if (p.activeChannel && available.includes(p.activeChannel)) setActiveChannel(p.activeChannel);
      if (Array.isArray(p.analysisChannels)) setAnalysisChannels(p.analysisChannels.filter(c => available.includes(c)));
      if (p.metric)    setMetric(p.metric);
      if (p.halfWin != null)   setHalfWin(p.halfWin);
      if (p.threshold != null) setThreshold(p.threshold);
      if (typeof p.allMetrics === 'boolean') setAllMetrics(p.allMetrics);
      if (typeof p.bootstrap === 'boolean')  setBootstrap(p.bootstrap);
      if (typeof p.tiltPlane === 'boolean')  setTiltPlane(p.tiltPlane);
      if (typeof p.tiltAngleDeg === 'number') setTiltAngleDeg(p.tiltAngleDeg);
      if (p.displayUnit) setDisplayUnit(p.displayUnit);
      const v = cfg.view || {};
      if (typeof v.rotation === 'number') setRotation(v.rotation);
      if (typeof v.flipH === 'boolean')   setFlipH(v.flipH);
      if (typeof v.flipV === 'boolean')   setFlipV(v.flipV);
      if (typeof v.zoom === 'number')     setZoom(v.zoom);
      if (typeof v.brightness === 'number') setBrightness(v.brightness);
      if (typeof v.contrast === 'number')   setContrast(v.contrast);
      if (typeof v.gamma === 'number')      setGamma(v.gamma);
      if (v.colormap)                       setColormap(v.colormap);
      const ip = cfg.isp || {};
      if (typeof ip.enabled === 'boolean') setIspEnabled(ip.enabled);
      if (typeof ip.live === 'boolean')    setIspLive(ip.live);
      if (ip.method)                       setIspMethod(ip.method);
      if (typeof ip.sharp === 'number')    setIspSharp(ip.sharp);
      if (typeof ip.radius === 'number')   setIspRadius(ip.radius);
      if (typeof ip.denoise === 'number')  setIspDenoise(ip.denoise);
      if (typeof ip.blackLvl === 'number') setIspBlackLvl(ip.blackLvl);
      if (Array.isArray(cfg.points)) setPoints(cfg.points);
      if (Array.isArray(cfg.lines))  setLines(cfg.lines);
      if (Array.isArray(cfg.refs))    setRefs(cfg.refs);
      if (cfg.activeRefIdH !== undefined) setActiveRefIdH(cfg.activeRefIdH);
      if (cfg.activeRefIdV !== undefined) setActiveRefIdV(cfg.activeRefIdV);
      // Legacy (pre-v2) field: a single activeRefId applied to both axes.
      if (cfg.activeRefId && cfg.activeRefIdH === undefined && cfg.activeRefIdV === undefined) {
        const r = (cfg.refs || []).find(x => x.id === cfg.activeRefId);
        if (r?.axis === 'h') setActiveRefIdH(r.id);
        if (r?.axis === 'v') setActiveRefIdV(r.id);
      }
      if (Array.isArray(cfg.selPoints)) setSelPoints(new Set(cfg.selPoints));
      if (Array.isArray(cfg.selLines))  setSelLines(new Set(cfg.selLines));
      say?.(`Loaded ${(cfg.points?.length ?? 0)} pts, ${(cfg.lines?.length ?? 0)} lines`, 'success');
    } catch (err) { say?.(`Load failed: ${err.message}`, 'danger'); }
  };

  const exportCSVTable = () => {
    const rows = [];
    lines.forEach((l, i) => {
      const lr = focus?.lines?.[i];
      rows.push({
        kind: 'line', label: l.label || `L${i + 1}`,
        p0_x: l.p0[0], p0_y: l.p0[1], p1_x: l.p1[0], p1_y: l.p1[1],
        peak_px: lr ? +lr.peak_position_px.toFixed(3) : '',
        peak_gauss_px: lr?.gaussian?.converged ? +lr.gaussian.mu.toFixed(3) : '',
        gauss_sigma_px: lr?.gaussian?.converged ? +lr.gaussian.sigma.toFixed(3) : '',
        gauss_fwhm_px: lr?.gaussian?.converged ? +lr.gaussian.fwhm.toFixed(3) : '',
        gauss_r_squared: lr?.gaussian?.converged ? +lr.gaussian.r_squared.toFixed(4) : '',
        dof_width_px: lr?.dof_width_px != null ? +lr.dof_width_px.toFixed(3) : '',
        peak_ci95_lo_px: lr?.peak_ci95_px?.[0]?.toFixed(3) ?? '',
        peak_ci95_hi_px: lr?.peak_ci95_px?.[1]?.toFixed(3) ?? '',
        dof_ci95_lo_px:  lr?.dof_width_ci95_px?.[0]?.toFixed(3) ?? '',
        dof_ci95_hi_px:  lr?.dof_width_ci95_px?.[1]?.toFixed(3) ?? '',
      });
    });
    points.forEach((p, i) => {
      const pr = focus?.points?.[i];
      rows.push({
        kind: 'point', label: p.label || `p${i + 1}`,
        p0_x: p.x, p0_y: p.y, p1_x: '', p1_y: '',
        peak_px: '', peak_gauss_px: '', gauss_sigma_px: '', gauss_fwhm_px: '',
        gauss_r_squared: '', dof_width_px: '',
        peak_ci95_lo_px: '', peak_ci95_hi_px: '',
        dof_ci95_lo_px: '', dof_ci95_hi_px: '',
        focus: pr ? +pr.focus.toFixed(6) : '',
        focus_norm: pr ? +pr.focus_norm.toFixed(4) : '',
      });
    });
    if (!rows.length) { say?.('Nothing to export', 'warn'); return; }
    exportCSV(`mantis-dof-${Date.now()}.csv`, rows);
    say?.(`Exported ${rows.length} rows`, 'success');
  };

  // ---- Run analysis ------------------------------------------------------
  const runAnalysis = async () => {
    if (!source) return;
    if (!points.length && !lines.length) return;
    const chs = analysisChannels.filter(c => available.includes(c));
    const chsOrActive = chs.length ? chs
                       : (activeChannel && available.includes(activeChannel) ? [activeChannel] : []);
    if (!chsOrActive.length) { say?.('No valid analysis channels', 'warn'); return; }
    try {
      say?.(`Running DoF analysis on ${chsOrActive.length} channel${chsOrActive.length > 1 ? 's' : ''}…`);
      const body = {
        source_id: source.source_id,
        channels: chsOrActive,
        points: points.map(p => ({ x: p.x, y: p.y, label: p.label || '' })),
        lines: lines.map(l => ({ p0: l.p0, p1: l.p1 })),
        metric, half_window: halfWin, threshold,
        calibration: calibrationPayload(),
        isp: buildIspPayload(),
        compute_all_metrics: true,
        bootstrap: true, n_boot: 200,
        fit_tilt_plane: points.length >= 3,
        include_pngs: false,   // plot-style-completion-v1: all native, no server PNGs.
      };
      const res = await apiFetch('/api/dof/analyze', { method: 'POST', body });
      onRunAnalysis({
        mode: 'dof', source, channels: chsOrActive,
        points: points.map(p => ({ id: p.id, x: p.x, y: p.y, label: p.label || '' })),
        lines: lines.map(l => ({ id: l.id, p0: l.p0, p1: l.p1, label: l.label || '' })),
        metric, half_window: halfWin, threshold,
        calibration: calibrationPayload(),
        isp: buildIspPayload(),
        displayUnit,
        tilt_angle_deg: calibrated ? tiltAngleDeg : 0,
        response: res,
      });
    } catch (err) { say?.(`analyze failed: ${err.detail || err.message}`, 'danger'); }
  };

  return (
    <div style={{ display: 'grid',
                  gridTemplateColumns: `${leftW}px minmax(360px, 1fr) ${rightW}px`,
                  height: '100%', overflow: 'hidden' }}>
      {/* =============================================================== LEFT */}
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
          {/* "by path" preserves source.path so Save/Load cfg round-trips. */}
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
                    title="Save probes / refs / settings to JSON" fullWidth>Save cfg</Button>
            <Button variant="ghost" icon="upload" size="xs" onClick={() => fileInputRef.current?.click()}
                    title="Load a previously-saved DoF JSON" fullWidth>Load cfg</Button>
          </div>
          <input ref={fileInputRef} type="file" accept="application/json,.json"
                 style={{ display: 'none' }}
                 onChange={(e) => { importConfig(e.target.files?.[0]); e.target.value = ''; }} />
        </Card>

        <Card title="Display channel" icon="layers">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {available.map(c => (
              <Tip key={c} title={`Measure on ${c}`}>
                <ChannelChip id={dofChipId(c)} selected={activeChannel === c}
                             onToggle={() => setActiveChannel(c)} size="sm" />
              </Tip>
            ))}
          </div>
        </Card>

        <Card title={`Analysis channels · ${analysisChannels.length}`} icon="grid">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {available.map(c => (
              <Tip key={c} title={`Include ${c} in Run analysis`}>
                <ChannelChip id={dofChipId(c)} multi
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

        <Card title="Focus metric" icon="sliders" pinned>
          <Row label="Metric">
            <Tip title="Local sharpness estimator. Laplacian-variance is the OpenCV default; Brenner emphasizes steep gradients; Tenengrad is isotropic; FFT-HF measures spectral content directly.">
              <Segmented value={metric}
                         options={[
                           { value: 'laplacian', label: 'Laplacian' },
                           { value: 'brenner',   label: 'Brenner' },
                           { value: 'tenengrad', label: 'Tenengrad' },
                           { value: 'fft_hf',    label: 'FFT-HF' },
                         ]} onChange={setMetric} fullWidth />
            </Tip>
          </Row>
          <Slider label="Half-window (px)" min={8} max={96} step={1}
                  value={halfWin} onChange={v => setHalfWin(Math.round(v))}
                  format={v => v.toFixed(0)} />
          <Slider label="DoF threshold" min={0.1} max={0.9} step={0.01}
                  value={threshold} onChange={setThreshold}
                  format={v => `${(v * 100).toFixed(0)}%`} />
          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
            Larger window = smoother but slower; smaller = faster but noisier.
            Threshold is the focus_norm cut for the DoF band edges.
          </div>
        </Card>

        <Card title="Research extras" icon="sparkles" pinned>
          <Checkbox checked={allMetrics} onChange={setAllMetrics}
            label="All 4 metrics" hint="Run laplacian / brenner / tenengrad / fft_hf in parallel — cross-check that DoF is metric-independent." />
          <Checkbox checked={bootstrap} onChange={setBootstrap}
            label="Bootstrap 95% CI" hint="Percentile bootstrap on peak + DoF width. ~+50 ms per line." />
          <Checkbox checked={tiltPlane} onChange={setTiltPlane}
            label="Tilt-plane fit (needs ≥3 points)" hint="Bilinear plane over (x, y, focus) — detects sensor tilt / field curvature." />
          <Slider label="Target tilt (°)" min={0} max={89} step={0.5}
                  value={tiltAngleDeg}
                  onChange={v => setTiltAngleDeg(Math.min(89, Math.max(0, v)))}
                  format={v => v.toFixed(1)}
                  disabled={!calibrated} />
          <div style={{ fontSize: 10, color: t.textFaint, marginTop: 2, lineHeight: 1.4 }}>
            {calibrated
              ? 'Scales peak / σ / FWHM / DoF by 1/cos(θ) to convert image-plane to sample-plane. Tweak live in the analysis modal.'
              : 'Set a horizontal or vertical calibration reference first.'}
          </div>
        </Card>

        <ISPCardDoF
          enabled={ispEnabled} setEnabled={setIspEnabled}
          live={ispLive} setLive={setIspLive}
          method={ispMethod} setMethod={setIspMethod}
          sharp={ispSharp} setSharp={setIspSharp}
          radius={ispRadius} setRadius={setIspRadius}
          denoise={ispDenoise} setDenoise={setIspDenoise}
          blackLvl={ispBlackLvl} setBlackLvl={setIspBlackLvl}
        />

        <Card title="Run analysis" icon="run" pinned>
          <Button variant="primary" icon="run" size="lg" fullWidth
                  disabled={(!points.length && !lines.length) || !analysisChannels.length}
                  onClick={runAnalysis}>Run DoF analysis</Button>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 6, textAlign: 'center' }}>
            {(!points.length && !lines.length) ? 'Pick a point or draw a line.' :
             !analysisChannels.length ? 'Select ≥1 analysis channel.' :
             `${points.length} pts · ${lines.length} lines · ${analysisChannels.length} ch · ${metric}`}
          </div>
        </Card>
      </div>

      {/* =============================================================== CENTER */}
      <DoFCanvas
        canvasRef={canvasRef} imgSrc={imgSrc} imgDims={imgDims} setImgDims={setImgDims}
        channel={activeChannel}
        points={points} lines={lines} refs={refs}
        selPoints={selPoints} selLines={selLines}
        activeRefIdH={activeHRef?.id} activeRefIdV={activeVRef?.id}
        drawing={drawing} cursor={cursor}
        rotation={rotation} flipH={flipH} flipV={flipV} zoom={zoom} pan={pan}
        tool={tool} setTool={setTool} spacePan={spacePan}
        onDown={onCanvasDown}
        onMove={e => setCursor(toImg(e))}
        onContextMenu={e => e.preventDefault()}
        onWheel={onCanvasWheel}
        onRotate={() => setRotation((rotation + 90) % 360)}
        onFlipH={() => setFlipH(f => !f)} onFlipV={() => setFlipV(f => !f)}
        onZoomIn={() => setZoom(z => Math.min(8, +(z * 1.25).toFixed(2)))}
        onZoomOut={() => setZoom(z => Math.max(0.25, +(z / 1.25).toFixed(2)))}
        onZoomReset={() => { setZoom(1); setPan([0, 0]); }}
        onUndo={() => { if (lines.length) setLines(l => l.slice(0, -1));
                        else if (points.length) setPoints(p => p.slice(0, -1)); }}
        brightness={brightness} contrast={contrast} gamma={gamma}
        focus={focus} calibrated={calibrated} fmt={fmt}
        computing={computing}
      />

      {/* =============================================================== RIGHT */}
      <div style={{ position: 'relative', borderLeft: `1px solid ${t.border}`,
                    background: t.bg, padding: 10, overflowY: 'auto' }}>
        <ResizeHandle value={rightW} onChange={setRightW} min={320} max={680} side="left" grow={-1} />

        <Card title="Display" icon="sliders">
          <Row label="Colormap">
            <Select value={colormap} onChange={setColormap} options={[
              { value: 'gray', label: 'Grayscale' },
              { value: 'jet', label: 'JET' },
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
          <Slider label="Contrast"   min={0.5} max={2.5} step={0.01} value={contrast}   onChange={setContrast} />
          <Slider label="Gamma"      min={0.4} max={2.5} step={0.01} value={gamma}      onChange={setGamma} />
        </Card>

        <CalibrationCard
          calibrated={calibrated}
          pxPerMicronH={pxPerMicronH} pxPerMicronV={pxPerMicronV}
          pxPerMicronMean={pxPerMicronMean} anisotropic={anisotropic}
          refs={refs} setRefs={setRefs}
          activeHRef={activeHRef} activeVRef={activeVRef}
          setActiveRefIdH={setActiveRefIdH} setActiveRefIdV={setActiveRefIdV}
          displayUnit={displayUnit} setDisplayUnit={setDisplayUnit}
        />

        <PointsTable
          points={points}
          focus={focus}
          selectedIds={selPoints}
          onToggleSel={(id, ev) => {
            setSelPoints(prev => {
              const next = new Set(prev);
              if (ev?.metaKey || ev?.ctrlKey) next.has(id) ? next.delete(id) : next.add(id);
              else { next.clear(); next.add(id); }
              return next;
            });
          }}
          onRename={(id, label) => setPoints(p => p.map(x => x.id === id ? { ...x, label } : x))}
          onDelete={() => setPoints(p => p.filter(x => !selPoints.has(x.id)))}
          onClearAll={() => { setPoints([]); setSelPoints(new Set()); }}
        />

        <LinesTable
          lines={lines}
          focus={focus} fmt={fmt} calibrated={calibrated}
          selectedIds={selLines}
          onToggleSel={(id, ev) => {
            setSelLines(prev => {
              const next = new Set(prev);
              if (ev?.metaKey || ev?.ctrlKey) next.has(id) ? next.delete(id) : next.add(id);
              else { next.clear(); next.add(id); }
              return next;
            });
          }}
          onRename={(id, label) => setLines(l => l.map(x => x.id === id ? { ...x, label } : x))}
          onDelete={() => setLines(l => l.filter(x => !selLines.has(x.id)))}
          onClearAll={() => { setLines([]); setSelLines(new Set()); }}
          onCSV={exportCSVTable}
        />

        <DoFLinePreview
          line={firstSelectedLine} focus={focus} fmt={fmt} calibrated={calibrated}
        />

        <DoFStabilityCard
          enabled={stabEnabled} setEnabled={setStabEnabled}
          curve={stabCurve} line={firstSelectedLine} fmt={fmt}
          state={stabState} error={stabError}
        />

        <DoFTiltPlaneCard
          tilt={focus?.tilt_plane} n_points={points.length}
          enabled={tiltPlane} computing={computing}
          error={focus?.tilt_plane_error || null}
          activeChannel={activeChannel}
        />
      </div>

      {showRefDialog && (
        <RefLengthDialog
          init={showRefDialog}
          onClose={() => {
            // Cancel returns to Focus tool so the user isn't stuck in ref-mode
            setShowRefDialog(null);
            setTool('focus');
          }}
          onCommit={(axis, p0, p1, lengthValue, unit) => {
            const r = { id: genId('r'), axis, p0, p1, lengthValue, unit };
            setRefs(prev => [...prev, r]);
            if (axis === 'h') setActiveRefIdH(r.id);
            else              setActiveRefIdV(r.id);
            setShowRefDialog(null);
            // Auto-return to Focus tool after committing; one-shot ref gesture.
            setTool('focus');
            say?.(`${axis === 'h' ? 'H' : 'V'} reference set — ${lengthValue}${unit}`, 'success');
          }}
        />
      )}
    </div>
  );
};

// ===========================================================================
// DoFCanvas — rulers, zoom/pan, all overlays
// ===========================================================================
const DoFCanvas = ({
  canvasRef, imgSrc, imgDims, setImgDims, channel,
  points, lines, refs, selPoints, selLines, activeRefIdH, activeRefIdV,
  drawing, cursor,
  rotation, flipH, flipV, zoom, pan,
  tool, setTool, spacePan,
  onDown, onMove, onContextMenu, onWheel,
  onRotate, onFlipH, onFlipV,
  onZoomIn, onZoomOut, onZoomReset, onUndo,
  brightness, contrast, gamma,
  focus, calibrated, fmt, computing,
}) => {
  const t = useTheme();
  const filter = `brightness(${1 + brightness * 1.2}) contrast(${contrast})`;
  const innerTx = `translate(${pan[0]}px, ${pan[1]}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;
  const canvasCursor = (tool === 'pan' || spacePan) ? 'grab' : 'crosshair';

  const [cRect, setCRect] = useStateD({ w: 0, h: 0 });
  useEffectD(() => {
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
            DoF · {channel || '—'}
          </div>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 2,
                        fontFamily: 'ui-monospace,Menlo,monospace' }}>
            rot {rotation}°{flipH ? ' · H' : ''}{flipV ? ' · V' : ''} · zoom {(zoom * 100).toFixed(0)}%
            {calibrated ? ' · calibrated' : ' · uncalibrated'}
            {computing ? ' · computing…' : ''}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center',
                      fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 11.5, color: t.textMuted }}>
          {cursor && <span>x={String(cursor[0]).padStart(4, '0')} · y={String(cursor[1]).padStart(4, '0')}</span>}
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', background: t.canvasBg, overflow: 'hidden' }}>
        <DoFRulerH t={t} imgSize={imgDims.w} step={rulerX.step} ticks={rulerX.ticks}
                   cursorImg={cursor?.[0]} leftInset={26} />
        <DoFRulerV t={t} imgSize={imgDims.h} step={rulerY.step} ticks={rulerY.ticks}
                   cursorImg={cursor?.[1]} topInset={20} />
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
          onContextMenu={onContextMenu}
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
              // References
              refs.forEach((r, i) => {
                const active = (r.axis === 'h' && r.id === activeRefIdH)
                           || (r.axis === 'v' && r.id === activeRefIdV);
                // H active refs use amber, V active refs use teal so the
                // user can tell them apart even when both are on-canvas.
                const col = active
                  ? (r.axis === 'h' ? '#ffd54f' : '#2dd4bf')
                  : '#7e57ff';
                const [sx0, sy0] = imgToScreen(r.p0[0], r.p0[1]);
                const [sx1, sy1] = imgToScreen(r.p1[0], r.p1[1]);
                nodes.push(
                  <g key={r.id}>
                    <line x1={sx0} y1={sy0} x2={sx1} y2={sy1}
                          stroke={col} strokeWidth={1.4} strokeDasharray="4 3" />
                    <circle cx={sx0} cy={sy0} r={3} fill={col} />
                    <circle cx={sx1} cy={sy1} r={3} fill={col} />
                    <g transform={`translate(${(sx0 + sx1) / 2 + 6}, ${(sy0 + sy1) / 2 - 6})`}>
                      <rect x={0} y={-13} width={72} height={14} rx={3}
                            fill="rgba(10,10,10,0.88)" stroke={col} strokeWidth={0.6} />
                      <text x={5} y={-3} fill={col} fontSize={10}
                            fontFamily="ui-monospace,Menlo,monospace">
                        {r.lengthValue}{r.unit}
                      </text>
                    </g>
                  </g>
                );
              });
              // Points
              points.forEach((p, i) => {
                const sel = selPoints.has(p.id);
                const col = pointColor(i);
                const [sx, sy] = imgToScreen(p.x, p.y);
                const pr = focus?.points?.[i];
                nodes.push(
                  <g key={p.id}>
                    {sel && <circle cx={sx} cy={sy} r={12} fill="none" stroke="#ffd54f" strokeWidth={2} opacity={0.55} />}
                    <circle cx={sx} cy={sy} r={7} fill="none" stroke={col} strokeWidth={1.6} />
                    <circle cx={sx} cy={sy} r={2.5} fill={col} />
                    <g transform={`translate(${sx + 10}, ${sy - 8})`}>
                      <rect x={0} y={-13} width={Math.max(70, 10 + (p.label || '').length * 6)} height={14} rx={3}
                            fill="rgba(10,10,10,0.9)" stroke={col} strokeWidth={sel ? 1.2 : 0.6} />
                      <text x={5} y={-3} fill="#fff" fontSize={10}
                            fontFamily="ui-monospace,Menlo,monospace">
                        {p.label || `p${i + 1}`}
                        {pr && ` · ${(pr.focus_norm * 100).toFixed(0)}%`}
                      </text>
                    </g>
                  </g>
                );
              });
              // Lines
              lines.forEach((l, i) => {
                const sel = selLines.has(l.id);
                const col = lineColor(i);
                const [sx0, sy0] = imgToScreen(l.p0[0], l.p0[1]);
                const [sx1, sy1] = imgToScreen(l.p1[0], l.p1[1]);
                const mx = (sx0 + sx1) / 2, my = (sy0 + sy1) / 2;
                const lr = focus?.lines?.[i];
                const peakPx = lr?.gaussian?.converged ? lr.gaussian.mu
                             : lr?.peak_position_px;
                // Convert peak_position along line to image coords.
                const L_img = Math.hypot(l.p1[0] - l.p0[0], l.p1[1] - l.p0[1]);
                let peakScreen = null;
                if (lr && peakPx != null && L_img > 0) {
                  const t = Math.max(0, Math.min(1, peakPx / L_img));
                  const ix = l.p0[0] + t * (l.p1[0] - l.p0[0]);
                  const iy = l.p0[1] + t * (l.p1[1] - l.p0[1]);
                  peakScreen = imgToScreen(ix, iy);
                }
                // DoF band endpoints on canvas.
                let dofLo = null, dofHi = null;
                if (lr && lr.dof_low_px != null && lr.dof_high_px != null && L_img > 0) {
                  const tLo = Math.max(0, Math.min(1, lr.dof_low_px / L_img));
                  const tHi = Math.max(0, Math.min(1, lr.dof_high_px / L_img));
                  dofLo = imgToScreen(l.p0[0] + tLo * (l.p1[0] - l.p0[0]),
                                       l.p0[1] + tLo * (l.p1[1] - l.p0[1]));
                  dofHi = imgToScreen(l.p0[0] + tHi * (l.p1[0] - l.p0[0]),
                                       l.p0[1] + tHi * (l.p1[1] - l.p0[1]));
                }
                nodes.push(
                  <g key={l.id}>
                    {sel && <line x1={sx0} y1={sy0} x2={sx1} y2={sy1}
                                   stroke="#ffd54f" strokeWidth={6}
                                   strokeLinecap="round" opacity={0.4} />}
                    <line x1={sx0} y1={sy0} x2={sx1} y2={sy1}
                          stroke={col} strokeWidth={sel ? 2.2 : 1.6}
                          strokeLinecap="round" />
                    {dofLo && dofHi &&
                      <line x1={dofLo[0]} y1={dofLo[1]} x2={dofHi[0]} y2={dofHi[1]}
                            stroke="#1a7f37" strokeWidth={5} strokeLinecap="round"
                            opacity={0.45} />}
                    <circle cx={sx0} cy={sy0} r={3.5} fill={col} stroke="#000" strokeWidth={0.6} />
                    <circle cx={sx1} cy={sy1} r={3.5} fill={col} stroke="#000" strokeWidth={0.6} />
                    {peakScreen &&
                      <g>
                        <line x1={peakScreen[0] - 6} y1={peakScreen[1]}
                              x2={peakScreen[0] + 6} y2={peakScreen[1]}
                              stroke="#ffd54f" strokeWidth={1.8} />
                        <line x1={peakScreen[0]} y1={peakScreen[1] - 6}
                              x2={peakScreen[0]} y2={peakScreen[1] + 6}
                              stroke="#ffd54f" strokeWidth={1.8} />
                      </g>}
                    <g transform={`translate(${mx + 6}, ${my - 8})`}>
                      <rect x={0} y={-13} width={Math.max(140, 10 + (l.label || '').length * 6)} height={14} rx={3}
                            fill="rgba(10,10,10,0.9)" stroke={col} strokeWidth={sel ? 1.2 : 0.6} />
                      <text x={5} y={-3} fill="#fff" fontSize={10}
                            fontFamily="ui-monospace,Menlo,monospace">
                        {l.label || `L${i + 1}`}
                        {lr && lr.dof_width_px != null && ` · DoF ${fmt(lr.dof_width_px, 2)}`}
                        {lr?.gaussian?.converged && ` · σ=${fmt(lr.gaussian.sigma, 1)}`}
                      </text>
                    </g>
                  </g>
                );
              });
              // Drawing preview
              if (drawing) {
                const [sx0, sy0] = imgToScreen(drawing.p0[0], drawing.p0[1]);
                const [sx1, sy1] = imgToScreen(drawing.p1[0], drawing.p1[1]);
                nodes.push(
                  <g key="drawing">
                    <line x1={sx0} y1={sy0} x2={sx1} y2={sy1}
                          stroke={drawing.tool === 'focus' ? '#30b453' : '#7e57ff'}
                          strokeWidth={1.4} strokeDasharray="4 3" />
                    <circle cx={sx0} cy={sy0} r={3} fill="#ffd54f" />
                    <circle cx={sx1} cy={sy1} r={3} fill="#ffd54f" />
                  </g>
                );
              }
              return nodes;
            })()}
          </svg>
        </div>

        <CanvasToolbar position="top-left">
          <CanvasBtn icon="crosshair" active={tool === 'focus'} onClick={() => setTool('focus')}
                     title="Focus tool (P) — click = point · drag = line" label="Focus" />
          <CanvasBtn icon="minus" active={tool === 'ref-h'} onClick={() => setTool('ref-h')}
                     title="Horizontal reference (H) — drag across a feature of known width to calibrate px→μm"
                     label="↔ H-ref" />
          <CanvasBtn icon="minus" active={tool === 'ref-v'} onClick={() => setTool('ref-v')}
                     title="Vertical reference (V) — drag across a feature of known height to calibrate px→μm"
                     label="↕ V-ref" />
          <CanvasBtn icon="hand" active={tool === 'pan' || spacePan} onClick={() => setTool('pan')}
                     title="Pan tool (or hold Space)" label="Pan" />
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', alignSelf: 'center' }} />
          <CanvasBtn icon="plus"      onClick={onZoomIn}    title="Zoom in" />
          <CanvasBtn icon="minus"     onClick={onZoomOut}   title="Zoom out" />
          <CanvasBtn icon="zoomReset" label={`${Math.round(zoom * 100)}%`} onClick={onZoomReset} title="Reset zoom (0)" />
          <CanvasBtn icon="fit"       onClick={onZoomReset} title="Fit to view (F)" />
          <CanvasBtn icon="undo"      onClick={onUndo}      title="Undo last pick (⌘Z)" />
        </CanvasToolbar>

        {/* When a ref tool is selected, show a persistent banner explaining
            the mode + an explicit "Back to Focus" escape hatch. Without
            this the user can drop into ref-mode and not realize the next
            drag will open the length dialog again — or worse, think the
            app is stuck. */}
        {(tool === 'ref-h' || tool === 'ref-v') && (
          <div style={{ position: 'absolute', top: 28, left: '50%',
                        transform: 'translateX(-50%)',
                        padding: '6px 12px',
                        background: 'rgba(10,10,10,0.82)',
                        border: `1px solid ${tool === 'ref-h' ? '#ffd54f' : '#2dd4bf'}`,
                        borderRadius: 18, color: '#fff', fontSize: 11.5,
                        display: 'flex', alignItems: 'center', gap: 10,
                        fontFamily: 'ui-monospace,Menlo,monospace', zIndex: 4 }}>
            <span style={{ color: tool === 'ref-h' ? '#ffd54f' : '#2dd4bf',
                           fontWeight: 600 }}>
              {tool === 'ref-h' ? '↔ H-REF MODE' : '↕ V-REF MODE'}
            </span>
            <span style={{ color: '#cbd3df' }}>
              drag across a known-size feature · <Kbd tone="dim">Esc</Kbd> to cancel
            </span>
            <button onClick={() => setTool('focus')}
                    style={{ background: 'rgba(255,255,255,0.1)',
                             color: '#fff', border: 'none',
                             padding: '3px 9px', borderRadius: 4, cursor: 'pointer',
                             fontSize: 11, fontFamily: 'inherit' }}>
              Back to Focus
            </button>
          </div>
        )}

        <CanvasToolbar position="top-right">
          <CanvasBtn icon="rotate" label={`${rotation}°`} onClick={onRotate} title="Rotate canvas 90° (R)" />
          <CanvasBtn icon="flip" active={flipH} onClick={onFlipH} title="Flip horizontal" />
          <CanvasBtn icon="flip" active={flipV} onClick={onFlipV} title="Flip vertical" />
        </CanvasToolbar>

        <div style={{ position: 'absolute', bottom: 10, left: 26, right: 0,
                      display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ padding: '5px 12px', background: 'rgba(10,10,10,0.68)',
                        backdropFilter: 'blur(6px)', borderRadius: 20, fontSize: 10.5,
                        color: '#aab3bf', border: '1px solid rgba(255,255,255,0.05)' }}>
            <Kbd tone="dim">click</Kbd> point ·
            <Kbd tone="dim">drag</Kbd> line ·
            <Kbd tone="dim">H/V</Kbd> ref tool ·
            <Kbd tone="dim">Esc</Kbd> back to Focus ·
            <Kbd tone="dim">rmb</Kbd> delete ·
            <Kbd tone="dim">space</Kbd> pan ·
            <Kbd tone="dim">⌘Z</Kbd> undo
          </div>
        </div>
      </div>
    </div>
  );
};

// Minimal rulers (own namespace so we don't clash with FPN's RulerH/V)
const DoFRulerH = ({ t, imgSize, step, ticks, cursorImg, leftInset }) => (
  <div style={{ position: 'absolute', top: 0, left: leftInset, right: 0, height: 20,
                background: t.panelAlt, borderBottom: `1px solid ${t.border}`,
                pointerEvents: 'none', overflow: 'hidden',
                fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 9, color: t.textFaint }}>
    <svg width="100%" height={20} style={{ display: 'block' }}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={`${(v / imgSize) * 100}%`} y1={12}
                x2={`${(v / imgSize) * 100}%`} y2={20}
                stroke={t.textFaint} strokeWidth={0.6} />
          <text x={`${(v / imgSize) * 100}%`} y={10} textAnchor="middle">{v}</text>
        </g>
      ))}
      {cursorImg != null && (
        <line x1={`${(cursorImg / imgSize) * 100}%`} y1={0}
              x2={`${(cursorImg / imgSize) * 100}%`} y2={20}
              stroke={t.accent} strokeWidth={1} />
      )}
    </svg>
  </div>
);
const DoFRulerV = ({ t, imgSize, ticks, cursorImg, topInset }) => (
  <div style={{ position: 'absolute', top: topInset, left: 0, width: 26, bottom: 0,
                background: t.panelAlt, borderRight: `1px solid ${t.border}`,
                pointerEvents: 'none', overflow: 'hidden',
                fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 9, color: t.textFaint }}>
    <svg width={26} height="100%" style={{ display: 'block' }}>
      {ticks.map(v => (
        <g key={v}>
          <line x1={18} y1={`${(v / imgSize) * 100}%`}
                x2={26} y2={`${(v / imgSize) * 100}%`}
                stroke={t.textFaint} strokeWidth={0.6} />
          <text x={14} y={`${(v / imgSize) * 100}%`} textAnchor="end" dy={3}>{v}</text>
        </g>
      ))}
      {cursorImg != null && (
        <line x1={0} y1={`${(cursorImg / imgSize) * 100}%`}
              x2={26} y2={`${(cursorImg / imgSize) * 100}%`}
              stroke={t.accent} strokeWidth={1} />
      )}
    </svg>
  </div>
);

// ===========================================================================
// ISP card (same shape as USAF's, DoF-flavoured)
// ===========================================================================
const ISPCardDoF = ({ enabled, setEnabled, live, setLive, method, setMethod,
                      sharp, setSharp, radius, setRadius,
                      denoise, setDenoise, blackLvl, setBlackLvl }) => {
  const t = useTheme();
  const actions = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                      cursor: 'pointer', fontSize: 10,
                      color: enabled ? t.accent : t.textMuted }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               style={{ margin: 0, cursor: 'pointer' }} />
        {enabled ? 'ON' : 'OFF'}
      </label>
    </div>
  );
  return (
    <Card title="ISP" icon="isp" pinned actions={actions}>
      <div style={{ padding: '6px 8px',
                    background: enabled ? t.accentSoft : t.panelAlt,
                    border: `1px solid ${enabled ? t.accent + '33' : t.border}`,
                    borderRadius: 5, display: 'flex', alignItems: 'center',
                    gap: 8, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                        cursor: enabled ? 'pointer' : 'not-allowed',
                        fontSize: 11, color: enabled ? t.text : t.textFaint }}>
          <input type="checkbox" checked={live} disabled={!enabled}
                 onChange={(e) => setLive(e.target.checked)}
                 style={{ margin: 0, cursor: 'inherit' }} />
          <span style={{ fontWeight: 500 }}>Apply live</span>
        </label>
        <span style={{ fontSize: 9.5, color: t.textFaint,
                       fontFamily: 'ui-monospace,Menlo,monospace' }}>
          → server compute + analyze
        </span>
      </div>
      <div style={{ opacity: !enabled ? 0.45 : 1, pointerEvents: !enabled ? 'none' : 'auto' }}>
        <Row label="Method">
          <Select value={method} onChange={setMethod}
                  options={['Unsharp mask', 'Laplacian', 'High-pass', 'None']} />
        </Row>
        <Slider label="Sharpen amount" min={0} max={1.5} step={0.05} value={sharp} onChange={setSharp} />
        <Slider label="Radius (px)"    min={0.4} max={4}   step={0.1}  value={radius} onChange={setRadius} format={v => v.toFixed(1)} />
        <Slider label="Denoise (σ)"    min={0} max={1}     step={0.05} value={denoise} onChange={setDenoise} />
        <Slider label="Black level"    min={0} max={2000}  step={25}   value={blackLvl} onChange={setBlackLvl} format={v => v.toFixed(0)} />
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Button size="xs" onClick={() => { setMethod('Unsharp mask'); setSharp(0.3); setRadius(1.2); setDenoise(0.2); setBlackLvl(0); }}>Reset</Button>
          <Button size="xs" onClick={() => { setSharp(0); setDenoise(0); setBlackLvl(0); }}>Bypass</Button>
        </div>
      </div>
    </Card>
  );
};

// ===========================================================================
// Calibration card
// ===========================================================================
const CalibrationCard = ({ calibrated, pxPerMicronH, pxPerMicronV,
                            pxPerMicronMean, anisotropic,
                            refs, setRefs,
                            activeHRef, activeVRef,
                            setActiveRefIdH, setActiveRefIdV,
                            displayUnit, setDisplayUnit }) => {
  const t = useTheme();
  const refsH = refs.filter(r => r.axis === 'h');
  const refsV = refs.filter(r => r.axis === 'v');
  const fmtRatio = (v) => v == null ? '—' : v.toFixed(3);
  return (
    <Card title={`Calibration · H${refsH.length}/V${refsV.length}`} icon="pin" pinned>
      {/* Summary row */}
      {!calibrated ? (
        <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5, marginBottom: 6 }}>
          <Tip title="Switch to the H (horizontal) or V (vertical) reference tool and drag across a feature of known physical length. The resulting px/μm is used by the analysis modal to report DoF, peak position, and Gaussian σ in microns / mm / cm instead of pixels.">
            No reference length. Drag an <b>H</b> or <b>V</b> stroke over a known-size feature.
          </Tip>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: t.text,
                      fontFamily: 'ui-monospace,Menlo,monospace', marginBottom: 8,
                      display: 'grid', gridTemplateColumns: 'auto 1fr', rowGap: 2, columnGap: 8 }}>
          <span style={{ color: '#ffd54f' }}>H</span>
          <span style={{ color: pxPerMicronH ? t.success : t.warn }}>
            {fmtRatio(pxPerMicronH)} px/μm
            {!pxPerMicronH && <span style={{ color: t.textFaint, marginLeft: 6 }}>
              (fallback = V)
            </span>}
          </span>
          <span style={{ color: '#2dd4bf' }}>V</span>
          <span style={{ color: pxPerMicronV ? t.success : t.warn }}>
            {fmtRatio(pxPerMicronV)} px/μm
            {!pxPerMicronV && <span style={{ color: t.textFaint, marginLeft: 6 }}>
              (fallback = H)
            </span>}
          </span>
          {anisotropic && (
            <>
              <span style={{ color: t.warn }}>!</span>
              <span style={{ color: t.warn, fontSize: 10.5 }}>
                anisotropic calibration — H and V ratios differ &gt;2%
              </span>
            </>
          )}
        </div>
      )}
      {calibrated && (
        <Row label="Show in">
          <Tip title="Unit for all DoF numbers shown in the Lines table, focus-profile preview, and analysis modal. Changing the unit only re-formats the display; calibration px/μm is unit-independent.">
            <Segmented value={displayUnit} options={DOF_UNITS} onChange={setDisplayUnit} />
          </Tip>
        </Row>
      )}

      {/* H references list */}
      <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 8,
                    textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        Horizontal refs
      </div>
      {refsH.length === 0 ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 2px' }}>
          none — use the <Kbd tone="dim">H</Kbd> tool
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace',
                       border: `1px solid ${t.border}`, borderRadius: 4,
                       overflow: 'hidden' }}>
          {refsH.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                       padding: '3px 6px',
                                       borderBottom: `1px solid ${t.border}` }}>
              <button onClick={() => setActiveRefIdH(r.id)}
                      style={{ width: 10, height: 10, borderRadius: '50%',
                               background: r.id === activeHRef?.id ? '#ffd54f' : t.chipBorder,
                               border: 'none', cursor: 'pointer' }}
                      title="Use as the horizontal reference" />
              <span style={{ color: t.text, flex: 1 }}>↔ {r.lengthValue}{r.unit}</span>
              <button onClick={() => setRefs(rr => rr.filter(x => x.id !== r.id))}
                      style={{ background: 'transparent', border: 'none',
                               color: t.textFaint, cursor: 'pointer' }}
                      title="Delete this reference">
                <Icon name="close" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* V references list */}
      <div style={{ fontSize: 10.5, color: t.textMuted, marginTop: 8,
                    textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>
        Vertical refs
      </div>
      {refsV.length === 0 ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, padding: '4px 2px' }}>
          none — use the <Kbd tone="dim">V</Kbd> tool
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace',
                       border: `1px solid ${t.border}`, borderRadius: 4,
                       overflow: 'hidden' }}>
          {refsV.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6,
                                       padding: '3px 6px',
                                       borderBottom: `1px solid ${t.border}` }}>
              <button onClick={() => setActiveRefIdV(r.id)}
                      style={{ width: 10, height: 10, borderRadius: '50%',
                               background: r.id === activeVRef?.id ? '#2dd4bf' : t.chipBorder,
                               border: 'none', cursor: 'pointer' }}
                      title="Use as the vertical reference" />
              <span style={{ color: t.text, flex: 1 }}>↕ {r.lengthValue}{r.unit}</span>
              <button onClick={() => setRefs(rr => rr.filter(x => x.id !== r.id))}
                      style={{ background: 'transparent', border: 'none',
                               color: t.textFaint, cursor: 'pointer' }}
                      title="Delete this reference">
                <Icon name="close" size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ===========================================================================
// Points table
// ===========================================================================
const PointsTable = ({ points, focus, selectedIds, onToggleSel, onRename,
                        onDelete, onClearAll }) => {
  const t = useTheme();
  const [editing, setEditing] = useStateD(null);
  return (
    <Card title={`Points · ${points.length}${selectedIds.size ? ` (${selectedIds.size} sel)` : ''}`} icon="pin">
      {points.length === 0 ? (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '8px 2px', textAlign: 'center' }}>
          (no points — click on the canvas)
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace',
                       border: `1px solid ${t.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 44px 44px 40px 18px',
                        gap: 0, padding: '5px 8px', fontSize: 9.5, color: t.textMuted,
                        textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
                        background: t.panelAlt, borderBottom: `1px solid ${t.border}` }}>
            <div /><div>label</div><div>x</div><div>y</div><div>focus</div><div />
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {points.map((p, i) => {
              const sel = selectedIds.has(p.id);
              const pr = focus?.points?.[i];
              return (
                <div key={p.id} onClick={(e) => onToggleSel(p.id, e.nativeEvent)}
                     style={{ display: 'grid',
                              gridTemplateColumns: '18px 1fr 44px 44px 40px 18px',
                              gap: 0, padding: '4px 8px',
                              background: sel ? t.accentSoft : 'transparent',
                              color: sel ? t.accent : t.text, cursor: 'pointer',
                              alignItems: 'center',
                              borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%',
                                 background: pointColor(i) }} />
                  {editing === p.id
                    ? <input autoFocus defaultValue={p.label || ''}
                             onClick={(e) => e.stopPropagation()}
                             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null); }}
                             onBlur={(e) => { onRename(p.id, e.target.value.trim() || `p${i + 1}`); setEditing(null); }}
                             style={{ width: '100%', background: t.inputBg, color: t.text,
                                      border: `1px solid ${t.accent}`, borderRadius: 3,
                                      fontSize: 10.5, fontFamily: 'inherit', padding: '0 3px' }} />
                    : <span onDoubleClick={(e) => { e.stopPropagation(); setEditing(p.id); }}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap' }}
                            title="double-click to rename">
                        {p.label || `p${i + 1}`}
                      </span>}
                  <span style={{ color: t.textMuted }}>{p.x.toFixed(0)}</span>
                  <span style={{ color: t.textMuted }}>{p.y.toFixed(0)}</span>
                  <span style={{ color: pr ? (pr.focus_norm >= 0.75 ? t.success
                                              : pr.focus_norm >= 0.5 ? t.warn : t.danger)
                                              : t.textFaint, fontWeight: 500 }}>
                    {pr ? `${(pr.focus_norm * 100).toFixed(0)}%` : '…'}
                  </span>
                  <span />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <Button size="xs" variant="danger" icon="trash" disabled={!selectedIds.size}
                onClick={onDelete}>
          Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
        </Button>
        <Button size="xs" disabled={points.length === 0} onClick={onClearAll}>Clear all</Button>
      </div>
    </Card>
  );
};

// ===========================================================================
// Lines table
// ===========================================================================
const LinesTable = ({ lines, focus, fmt, calibrated, selectedIds, onToggleSel,
                      onRename, onDelete, onClearAll, onCSV }) => {
  const t = useTheme();
  const [editing, setEditing] = useStateD(null);
  return (
    <Card title={`Lines · ${lines.length}${selectedIds.size ? ` (${selectedIds.size} sel)` : ''}`} icon="grid">
      {lines.length === 0 ? (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '8px 2px', textAlign: 'center' }}>
          (no lines — drag on the canvas)
        </div>
      ) : (
        <div style={{ fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace',
                       border: `1px solid ${t.border}`, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '18px 1fr 56px 56px 50px 18px',
                        gap: 0, padding: '5px 8px', fontSize: 9.5, color: t.textMuted,
                        textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 600,
                        background: t.panelAlt, borderBottom: `1px solid ${t.border}` }}>
            <div /><div>label</div><div>peak</div><div>DoF</div><div>R²</div><div />
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {lines.map((l, i) => {
              const sel = selectedIds.has(l.id);
              const lr = focus?.lines?.[i];
              const peakPx = lr?.gaussian?.converged ? lr.gaussian.mu
                           : lr?.peak_position_px;
              const dofWidth = lr?.dof_width_px;
              const r2 = lr?.gaussian?.r_squared;
              return (
                <div key={l.id} onClick={(e) => onToggleSel(l.id, e.nativeEvent)}
                     style={{ display: 'grid',
                              gridTemplateColumns: '18px 1fr 56px 56px 50px 18px',
                              gap: 0, padding: '4px 8px',
                              background: sel ? t.accentSoft : 'transparent',
                              color: sel ? t.accent : t.text, cursor: 'pointer',
                              alignItems: 'center',
                              borderBottom: `1px solid ${t.border}` }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2,
                                 background: lineColor(i) }} />
                  {editing === l.id
                    ? <input autoFocus defaultValue={l.label || ''}
                             onClick={(e) => e.stopPropagation()}
                             onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(null); }}
                             onBlur={(e) => { onRename(l.id, e.target.value.trim() || `L${i + 1}`); setEditing(null); }}
                             style={{ width: '100%', background: t.inputBg, color: t.text,
                                      border: `1px solid ${t.accent}`, borderRadius: 3,
                                      fontSize: 10.5, fontFamily: 'inherit', padding: '0 3px' }} />
                    : <span onDoubleClick={(e) => { e.stopPropagation(); setEditing(l.id); }}
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap' }}
                            title="double-click to rename">
                        {l.label || `L${i + 1}`}
                      </span>}
                  <span style={{ color: t.textMuted }}>{peakPx != null ? fmt(peakPx, 1) : '—'}</span>
                  <span style={{ color: t.textMuted }}>{dofWidth != null ? fmt(dofWidth, 1) : '—'}</span>
                  <span style={{ color: r2 != null
                                        ? (r2 >= 0.9 ? t.success
                                           : r2 >= 0.7 ? t.warn : t.danger)
                                        : t.textFaint }}>
                    {r2 != null ? r2.toFixed(2) : '—'}
                  </span>
                  <span />
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Button size="xs" variant="danger" icon="trash" disabled={!selectedIds.size}
                onClick={onDelete}>
          Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
        </Button>
        <Button size="xs" disabled={lines.length === 0} onClick={onClearAll}>Clear all</Button>
        <div style={{ flex: 1 }} />
        <Button size="xs" icon="export" disabled={!lines.length && !focus?.points?.length}
                onClick={onCSV}>CSV</Button>
      </div>
    </Card>
  );
};

// ===========================================================================
// DoFLinePreview — normalized focus curve + Gaussian fit overlay
// ===========================================================================
const DoFLinePreview = ({ line, focus, fmt, calibrated }) => {
  const t = useTheme();
  if (!line) return null;
  const idx = focus?.lines?.findIndex((_, i) => {
    // focus.lines is ordered same as input `lines`; we need to find the idx
    // of `line` in the current `lines` list which is by reference equivalent.
    return true; // placeholder; we'll use a different strategy below
  });
  // Actually pick the lineResult by index against the line id — the
  // caller passed only the first selected line, so find its position by
  // matching p0/p1.
  const lineResult = (focus?.lines || []).find(lr =>
    lr.p0[0] === line.p0[0] && lr.p0[1] === line.p0[1] &&
    lr.p1[0] === line.p1[0] && lr.p1[1] === line.p1[1]
  );
  return (
    <Card title={`${line.label || 'Line'} · focus profile`} icon="eye" pinned>
      {!lineResult ? (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '14px 4px', textAlign: 'center' }}>
          computing…
        </div>
      ) : (
        <>
          <LineProfileChart lr={lineResult} fmt={fmt} />
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6,
                        fontFamily: 'ui-monospace,Menlo,monospace', lineHeight: 1.5 }}>
            peak: {fmt(lineResult.gaussian?.converged ? lineResult.gaussian.mu
                                                      : lineResult.peak_position_px, 2)}
            <br />
            DoF: {lineResult.dof_width_px != null ? fmt(lineResult.dof_width_px, 2) : '—'}
            {lineResult.dof_width_ci95_px && <span style={{ color: t.textFaint }}>
              {'  CI95: ['}{fmt(lineResult.dof_width_ci95_px[0], 2)}, {fmt(lineResult.dof_width_ci95_px[1], 2)}{']'}
            </span>}
            <br />
            {lineResult.gaussian?.converged && <>
              Gaussian σ={fmt(lineResult.gaussian.sigma, 2)} · FWHM={fmt(lineResult.gaussian.fwhm, 2)} · R²={lineResult.gaussian.r_squared.toFixed(3)}
            </>}
          </div>
        </>
      )}
    </Card>
  );
};

const LineProfileChart = ({ lr, fmt }) => {
  const t = useTheme();
  const W = 280, H = 110, PAD_L = 28, PAD_R = 8, PAD_T = 8, PAD_B = 22;
  const xs = lr.positions_px || [];
  const ys = lr.focus_norm || [];
  if (!xs.length) return null;
  const xMin = xs[0], xMax = xs[xs.length - 1];
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - Math.max(0, Math.min(1, y))) * (H - PAD_T - PAD_B);
  const pts = xs.map((x, i) => `${xOf(x).toFixed(2)},${yOf(ys[i]).toFixed(2)}`).join(' ');
  // Gaussian model evaluated on same grid
  const g = lr.gaussian;
  let gpts = null;
  if (g?.converged) {
    // normalize the model by focus peak (which is focus.max())
    const ampScale = 1;
    gpts = xs.map((x, i) => {
      const m = g.amp * Math.exp(-((x - g.mu) ** 2) / (2 * g.sigma ** 2)) + g.baseline;
      // scale back: focus was normalized by focus.max; focus_norm[i] = focus[i]/peak.
      // Model is on raw focus; normalize by the peak raw focus (= focus_norm's 1.0).
      const peak_raw = (lr.focus || []).length ? Math.max(...lr.focus) : 1;
      return `${xOf(x).toFixed(2)},${yOf(m / (peak_raw || 1)).toFixed(2)}`;
    }).join(' ');
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}
           style={{ background: t.panelAlt, borderRadius: 4, border: `1px solid ${t.border}` }}>
        {[0, 0.25, 0.5, 0.75, 1].map(yv => (
          <g key={yv}>
            <line x1={PAD_L} y1={yOf(yv)} x2={W - PAD_R} y2={yOf(yv)}
                  stroke={t.border} strokeWidth={0.5}
                  strokeDasharray={yv === 0 || yv === 1 ? '' : '2 2'} />
            <text x={PAD_L - 3} y={yOf(yv) + 3} fontSize={8.5}
                  fill={t.textMuted} textAnchor="end"
                  fontFamily="ui-monospace,Menlo,monospace">{yv.toFixed(2)}</text>
          </g>
        ))}
        {/* DoF band */}
        {lr.dof_low_px != null && lr.dof_high_px != null && (
          <rect x={xOf(lr.dof_low_px)} y={PAD_T}
                width={xOf(lr.dof_high_px) - xOf(lr.dof_low_px)}
                height={H - PAD_T - PAD_B}
                fill="#1a7f37" opacity={0.12} />
        )}
        {/* Gaussian fit */}
        {gpts && <polyline points={gpts} fill="none" stroke="#ffd54f"
                           strokeWidth={1.2} strokeDasharray="4 3" />}
        {/* Measured */}
        <polyline points={pts} fill="none" stroke={t.accent} strokeWidth={1.4} />
        {/* Peak marker */}
        {(() => {
          const peakX = g?.converged ? g.mu : lr.peak_position_px;
          if (peakX == null) return null;
          return <line x1={xOf(peakX)} y1={PAD_T} x2={xOf(peakX)} y2={H - PAD_B}
                       stroke="#ffd54f" strokeWidth={1.0} />;
        })()}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5,
                    color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}>
        <span>{fmt(xMin, 0)}</span>
        <span>pos along line</span>
        <span>{fmt(xMax, 0)}</span>
      </div>
    </div>
  );
};

// ===========================================================================
// Stability card — DoF width vs half-window
// ===========================================================================
//
// WHAT IT SHOWS
//   A plot of DoF width vs focus-metric half-window. Each point is one
//   re-scan of the currently-selected line with a different window size.
// WHY IT MATTERS
//   The DoF value you read off a single line scan depends on the window
//   size — too small and a noisy pixel dominates, too large and the
//   measurement blurs across the focus transition. A flat (plateaued)
//   curve = the reported DoF is robust; a curve that keeps rising =
//   you're undersized and need a bigger half-window to trust the number.
// HOW TO READ IT
//   * Y-axis: DoF width (in calibrated µm/mm if available, else pixels)
//   * X-axis: half-window size tested, in image pixels
//   * Target: a middle plateau where the curve stops rising
// ===========================================================================
const DoFStabilityCard = ({ enabled, setEnabled, curve, line, state, error, fmt }) => {
  const t = useTheme();
  const helpText = (
    'Re-scan the currently-selected line at 7 half-window sizes (8, 12, 16, 24, 32, 48, 64 px). '
    + 'DoF width that keeps growing with window = the window is still too small to trust the number. '
    + 'A plateau = stable, trustworthy DoF. Needs a selected line.'
  );
  const actions = (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Tip title={helpText}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: t.textFaint, fontSize: 12 }}>
          <Icon name="help" size={12} />
        </span>
      </Tip>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
                      cursor: 'pointer', fontSize: 10,
                      color: enabled ? t.accent : t.textMuted }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               style={{ margin: 0, cursor: 'pointer' }} />
        {enabled ? 'ON' : 'OFF'}
      </label>
    </div>
  );
  return (
    <Card title="DoF stability curve" icon="settings" actions={actions}>
      {!enabled ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 500, color: t.textMuted, marginBottom: 4 }}>What this checks</div>
          {helpText}
          <div style={{ marginTop: 6, color: t.textFaint }}>
            Flip <b>ON</b> to start; the currently-selected line is re-scanned at each window size.
          </div>
        </div>
      ) : state === 'no-line' ? (
        <div style={{ fontSize: 11.5, color: t.warn, padding: '10px 4px',
                       display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="info" size={14} />
          Select a focus line first, then the curve will compute.
        </div>
      ) : state === 'loading' ? (
        <div style={{ fontSize: 11.5, color: t.accent, padding: '10px 4px',
                       display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                         background: t.accent, boxShadow: `0 0 0 3px ${t.accent}33`,
                         animation: 'mantisToastIn .8s ease-in-out infinite alternate' }} />
          Re-scanning line {line?.label || ''} at 7 window sizes…
        </div>
      ) : state === 'error' ? (
        <div style={{ fontSize: 11, color: t.danger, padding: '10px 4px', lineHeight: 1.4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <Icon name="close" size={12} />
            <span style={{ fontWeight: 500 }}>stability failed</span>
          </div>
          <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', color: t.textMuted }}>
            {error || 'unknown failure'}
          </div>
        </div>
      ) : curve ? (
        <StabilityChart curve={curve} fmt={fmt} />
      ) : (
        <div style={{ fontSize: 11, color: t.textFaint, padding: '10px 4px', textAlign: 'center' }}>
          no curve returned
        </div>
      )}
    </Card>
  );
};

const StabilityChart = ({ curve, fmt }) => {
  const t = useTheme();
  if (!curve?.length) return null;
  const W = 280, H = 130, PAD_L = 38, PAD_R = 10, PAD_T = 8, PAD_B = 22;
  const xs = curve.map(p => p.half_window);
  const ys = curve.map(p => p.dof_width_px).map(v => Number.isFinite(v) ? v : 0);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = 0, yMax = (Math.max(...ys) * 1.15) || 1;
  const xOf = (x) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * (W - PAD_L - PAD_R);
  const yOf = (y) => PAD_T + (1 - (y - yMin) / (yMax - yMin || 1)) * (H - PAD_T - PAD_B);
  const pts = curve.map(p => `${xOf(p.half_window)},${yOf(p.dof_width_px || 0)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {xs.map(x => (
          <g key={x}>
            <line x1={xOf(x)} y1={PAD_T} x2={xOf(x)} y2={H - PAD_B}
                  stroke={t.border} strokeWidth={0.5} strokeDasharray="2 2" />
            <text x={xOf(x)} y={H - PAD_B + 12} fontSize={8.5}
                  fill={t.textMuted} textAnchor="middle"
                  fontFamily="ui-monospace,Menlo,monospace">{x}</text>
          </g>
        ))}
        {[0, yMax / 2, yMax].map(v => (
          <g key={v}>
            <line x1={PAD_L} y1={yOf(v)} x2={W - PAD_R} y2={yOf(v)}
                  stroke={t.border} strokeWidth={0.5} />
            <text x={PAD_L - 3} y={yOf(v) + 3} fontSize={8.5}
                  fill={t.textMuted} textAnchor="end"
                  fontFamily="ui-monospace,Menlo,monospace">{v.toFixed(0)}</text>
          </g>
        ))}
        <polyline points={pts} fill="none" stroke={t.accent} strokeWidth={1.5} />
        {curve.map((p, i) => (
          <circle key={i} cx={xOf(p.half_window)} cy={yOf(p.dof_width_px || 0)}
                  r={3} fill={t.accent} stroke="#fff" strokeWidth={0.8}>
            <title>{`half-win ${p.half_window}: DoF ${fmt(p.dof_width_px || 0, 1)}, peak ${fmt(p.peak_position_px, 1)}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ fontSize: 10, color: t.textFaint, marginTop: 4,
                    fontFamily: 'ui-monospace,Menlo,monospace', lineHeight: 1.5 }}>
        half-win → DoF: {curve.map(p => `${p.half_window}=${fmt(p.dof_width_px || 0, 1)}`).join(' · ')}
      </div>
    </div>
  );
};

// ===========================================================================
// Tilt-plane summary card
// ===========================================================================
//
// WHAT IT SHOWS
//   Bilinear least-squares fit `focus_norm = a + b·x + c·y` over all
//   picked points. The (b, c) gradient points toward the brightest /
//   best-focused region; `slope_mag_per_px` tells you how fast focus
//   degrades as you move away from that direction.
// WHY IT MATTERS
//   In microscopy a non-zero slope means the image plane is tilted
//   relative to the sensor (common with removable objectives) or the
//   lens exhibits field curvature. Photographers see the same effect
//   as "left-edge soft, right-edge sharp" on flat targets.
// HOW TO READ IT
//   * slope_mag_per_px ~ 0  → sensor flat, sample flat
//   * a meaningful slope + a low tilt_direction_deg → horizontal tilt
//   * a meaningful slope + ~90° direction → vertical tilt
//   * R² ~ 1 → a plane explains the picked-point scatter well; if
//     R² is low, picks span a non-planar region (curvature beyond tilt).
// ===========================================================================
const DoFTiltPlaneCard = ({ tilt, n_points, enabled, computing, error, activeChannel }) => {
  const t = useTheme();
  const helpText = (
    'Least-squares bilinear plane through the picked points\' focus values. '
    + 'A near-zero slope = image plane is square to the sensor and the sample '
    + 'is flat. A non-zero slope + low R² = the sample has curvature beyond '
    + 'a simple tilt. Needs ≥3 points.'
  );
  return (
    <Card title="Tilt plane / field curvature" icon="pin"
          actions={
            <Tip title={helpText}>
              <span onClick={(e) => e.stopPropagation()}
                    style={{ color: t.textFaint, display: 'inline-flex', padding: 2 }}>
                <Icon name="help" size={12} />
              </span>
            </Tip>
          }>
      {!enabled ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 500, color: t.textMuted, marginBottom: 4 }}>What this checks</div>
          {helpText}
          <div style={{ marginTop: 6, color: t.textFaint }}>
            Enable <b>Tilt-plane fit</b> in the <b>Research extras</b> card on the left, then drop at least 3 focus points in regions with different sharpness.
          </div>
        </div>
      ) : error ? (
        <div style={{ fontSize: 11, color: t.danger, padding: '10px 4px', lineHeight: 1.4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
            <Icon name="close" size={12} />
            <span style={{ fontWeight: 500 }}>tilt fit failed</span>
          </div>
          <div style={{ fontFamily: 'ui-monospace,Menlo,monospace', color: t.textMuted }}>
            {error}
          </div>
        </div>
      ) : n_points < 3 ? (
        <div style={{ fontSize: 11, color: t.warn, padding: '10px 4px', lineHeight: 1.5,
                       display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <Icon name="info" size={14} style={{ marginTop: 1 }} />
          <span>
            Need <b>≥3 points</b> to fit a plane — currently {n_points}.
            Switch to the Focus tool and click more places on the canvas.
          </span>
        </div>
      ) : computing && !tilt ? (
        <div style={{ fontSize: 11.5, color: t.accent, padding: '10px 4px',
                       display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                         background: t.accent, boxShadow: `0 0 0 3px ${t.accent}33`,
                         animation: 'mantisToastIn .8s ease-in-out infinite alternate' }} />
          Fitting plane on {activeChannel || 'channel'}…
        </div>
      ) : !tilt ? (
        <div style={{ fontSize: 10.5, color: t.textFaint, lineHeight: 1.5 }}>
          Drop ≥3 focus points on different features to fit a plane. A near-zero slope = flat sensor / well-focused; a meaningful slope = sensor tilt or field curvature.
        </div>
      ) : (
        <StatBlock
          emphasis="slope"
          items={[
            { label: 'coef a (b)',         value: tilt.a.toExponential(2) },
            { label: 'coef b (∂focus/∂x)', value: tilt.b.toExponential(2) },
            { label: 'coef c (∂focus/∂y)', value: tilt.c.toExponential(2) },
            { label: '|slope| per px',     key: 'slope',
              value: tilt.slope_mag_per_px.toExponential(2),
              color: tilt.slope_mag_per_px < 1e-4 ? t.success
                    : tilt.slope_mag_per_px < 1e-3 ? t.warn : t.danger },
            { label: 'direction',          value: `${tilt.tilt_direction_deg.toFixed(1)}°` },
            { label: 'R²',                 value: tilt.r_squared.toFixed(3), muted: true },
          ]}
        />
      )}
    </Card>
  );
};

// ===========================================================================
// Reference length dialog (unchanged from v1)
// ===========================================================================
const RefLengthDialog = ({ init, onClose, onCommit }) => {
  const t = useTheme();
  const [val, setVal] = React.useState('500');
  const [unit, setUnit] = React.useState('μm');
  const px = Math.hypot(init.p1[0] - init.p0[0], init.p1[1] - init.p0[1]);
  const commit = () => {
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) onCommit(init.axis, init.p0, init.p1, n, unit);
  };
  return (
    <Modal onClose={onClose} width={380}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Reference length</div>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 12,
                    fontFamily: 'ui-monospace,Menlo,monospace' }}>
        {init.axis === 'h' ? 'horizontal' : 'vertical'} · {px.toFixed(1)} px on canvas
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input autoFocus value={val}
               onChange={(e) => setVal(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
               style={{ flex: 1, padding: '6px 10px', fontSize: 14,
                        border: `1px solid ${t.border}`, borderRadius: 5,
                        background: t.inputBg, color: t.text,
                        fontFamily: 'ui-monospace,Menlo,monospace' }} />
        <Segmented value={unit} options={DOF_UNITS} onChange={setUnit} />
      </div>
      <div style={{ fontSize: 11, color: t.textFaint, marginBottom: 12 }}>
        Calibration: {(px / (parseFloat(val) * DOF_TO_MICRONS[unit] || 1)).toFixed(4)} px/μm
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={commit}>Set reference</Button>
      </div>
    </Modal>
  );
};

export { DoFMode };
export default DoFMode;
