// @ts-nocheck
// bundler-migration-v1 Phase 5b finish (2026-04-24): mass-migrated .jsx
// → .tsx. Body kept as-is under @ts-nocheck so a 23 K-line, 85-export
// tree can move to TypeScript in one commit without per-file rewrite.
// Remove @ts-nocheck per file in follow-up sessions to incrementally
// type primitives + components. tsc still parses and bundles the file;
// only the strict type-checking is muted.
// USAF Resolution mode — server-backed, full feature set.
// Pick lines through USAF target bars; every line is measured by the Python
// server (Michelson percentile + FFT + min/max, samples-per-cycle, profile).
// UI features: rulers, zoom-to-cursor, pan (space / H tool / middle-mouse),
// rotation-aware labels, snap-to-axis, multi-select sortable table, Save/Load
// JSON config, ISP live-apply, display brightness/contrast/gamma, CSV export.

// bundler-migration-v1 Phase 3: ES-module native.
import React from 'react';
import {
  CHANNEL_COLORS,
  ELEMENT_COLORS,
  useTheme,
  defaultAnalysisChannels,
  Icon,
  Card,
  Row,
  Slider,
  Select,
  Button,
  ChannelChip,
  Segmented,
  Checkbox,
  Spinbox,
  StatBlock,
  HUD,
  CanvasToolbar,
  CanvasBtn,
  parseChannel,
  sCycColor,
  Tip,
  Kbd,
  useLocalStorageState,
  exportJSON,
  exportCSV,
  apiFetch,
  channelPngUrl,
  _SourceCtx,
  useSource,
  useFileFilter,
  ResizeHandle,
  DraggablePanelList,
  FloatingWindow,
  CanvasColorbar,
} from './shared.tsx';

const {
  useState: useStateU,
  useEffect: useEffectU,
  useRef: useRefU,
  useMemo: useMemoU,
  useCallback: useCallbackU,
} = React;

// ---------------------------------------------------------------------------
// Channel helpers
// ---------------------------------------------------------------------------
const usafLpmm = (g, e) => Math.pow(2, g + (e - 1) / 6);
const usafColorForElt = (e) => ELEMENT_COLORS[(e - 1) % ELEMENT_COLORS.length];
const sCycTag = (s) =>
  s < 3 ? 'Below Nyquist — not trustworthy' : s < 5 ? 'Marginal sampling' : 'Well sampled';

// Normalize a channel name so ChannelChip's 2-letter-band parser works for
// RGB/grayscale sources as well as H5 HG-/LG- sources.
const chipId = (c) => (c.includes('-') ? c : c === 'L' ? 'HG-Y' : `HG-${c}`);

const USAFMode = ({ onRunAnalysis, onStatusChange, say, onSwitchSource, onOpenFile }) => {
  const t = useTheme();
  const source = useSource();
  // Global file-type filter (shared with the top-bar Open button) — drives
  // the `accept` string for the Dark-frame Load/Replace input as well, so
  // the user has a single place to switch between H5, image-only, all-files,
  // etc., and it carries across both bright + dark uploads consistently.
  const fileFilter = useFileFilter();
  const darkAccept = fileFilter.filters[fileFilter.current]?.accept || '';
  const available = source?.channels || [];
  const defaultCh = available.includes('LG-G')
    ? 'LG-G'
    : available.includes('HG-G')
      ? 'HG-G'
      : available.includes('G')
        ? 'G'
        : available[0] || null;

  // ---- Source / channel ---------------------------------------------------
  const [activeChannel, setActiveChannel] = useStateU(defaultCh);
  // ISP-modes-v1: channel defaults now derive from the source's active
  // ISP mode via defaultAnalysisChannels(), so switching modes or
  // renaming the 4th slot (e.g. NIR → UV-650) flows through without
  // edits here. Guard with filter() so any stale localStorage entry
  // pointing at a now-removed channel is dropped on source switch.
  const [analysisChannels, setAnalysisChannels] = useLocalStorageState(
    'usaf/analysisChannels',
    defaultAnalysisChannels(available)
  );
  // Read the global "RGB color composite on canvas" toggle that the ISP
  // settings window writes to. Shared across all modes so the UX stays
  // consistent when the user flips it once.
  const [rgbCompositeDisplay] = useLocalStorageState('ispSettings/rgbComposite', false);

  // ---- Picking knobs ------------------------------------------------------
  const [group, setGroup] = useLocalStorageState('usaf/group', 0);
  const [element, setElement] = useLocalStorageState('usaf/element', 1);
  const [direction, setDirection] = useLocalStorageState('usaf/direction', 'H');
  const [autoInc, setAutoInc] = useLocalStorageState('usaf/autoInc', true);
  const [seqMode, setSeqMode] = useLocalStorageState('usaf/seqMode', false);
  const [snap, setSnap] = useLocalStorageState('usaf/snap', true);
  // The picker no longer surfaces a "Method" dropdown — 5-point is the
  // canonical primary metric, and FFT / min-max / percentile are still
  // computed by the server and shown side-by-side in the analysis modal
  // Summary table for cross-reference. The string is kept here only to
  // keep the /api/usaf/measure body shape stable.
  const method = 'five_point';
  const [thresholdPct, setThresholdPct] = useLocalStorageState('usaf/thresholdPct', 30);

  // ---- View transforms ----------------------------------------------------
  const [rotation, setRotation] = useStateU(0);
  const [flipH, setFlipH] = useStateU(false);
  const [flipV, setFlipV] = useStateU(false);
  const [zoom, setZoom] = useStateU(1);
  const [pan, setPan] = useStateU([0, 0]);
  const [tool, setTool] = useStateU('pick'); // 'pick' | 'pan'
  const [spacePan, setSpacePan] = useStateU(false);

  // ---- Resizable panels (persisted per mode) ------------------------------
  const [leftW, setLeftW] = useLocalStorageState('usaf/leftW', 320);
  const [rightW, setRightW] = useLocalStorageState('usaf/rightW', 368);

  // ---- Sidebar panel order (drag-to-reorder, persisted) -------------------
  // The card ids match the keys in `leftPanels` / `rightPanels` below.
  // DraggablePanelList tolerates stale ids (filtered) and new ids (appended),
  // so adding/removing a panel doesn't require a localStorage migration.
  const DEFAULT_LEFT_ORDER = [
    'source',
    'displayChannel',
    'analysisChannels',
    'picking',
    'outputMode',
  ];
  const DEFAULT_RIGHT_ORDER = ['display', 'isp', 'linesTable', 'profilePreview', 'summary'];
  const [leftOrder, setLeftOrder] = useLocalStorageState('usaf/leftOrder', DEFAULT_LEFT_ORDER);
  const [rightOrder, setRightOrder] = useLocalStorageState('usaf/rightOrder', DEFAULT_RIGHT_ORDER);

  // ---- Profile preview pop-out --------------------------------------------
  // When floating, the sidebar slot shows a placeholder + dock-back button,
  // and the actual ProfilePreview renders inside a FloatingWindow that the
  // user can drag/resize anywhere on screen. Position survives reloads.
  const [profileFloating, setProfileFloating] = useLocalStorageState('usaf/profileFloating', false);
  const [profileWin, setProfileWin] = useLocalStorageState('usaf/profileWin', {
    x: 360,
    y: 120,
    w: 520,
    h: 380,
  });

  // ---- Display (CSS filter; doesn't affect analysis) ----------------------
  const [brightness, setBrightness] = useLocalStorageState('usaf/brightness', 0);
  const [contrast, setContrast] = useLocalStorageState('usaf/contrast', 1);
  const [gamma, setGamma] = useLocalStorageState('usaf/gamma', 1);
  const [colormap, setColormap] = useLocalStorageState('usaf/colormap', 'gray');

  // ---- ISP (server-side applied to analysis image) ------------------------
  const [ispEnabled, setIspEnabled] = useLocalStorageState('usaf/isp/enabled', false);
  const [ispLive, setIspLive] = useLocalStorageState('usaf/isp/live', true);
  const [ispSharp, setIspSharp] = useLocalStorageState('usaf/isp/sharp', 0.4);
  const [ispRadius, setIspRadius] = useLocalStorageState('usaf/isp/radius', 1.2);
  const [ispDenoise, setIspDenoise] = useLocalStorageState('usaf/isp/denoise', 0.2);
  const [ispBlackLvl, setIspBlackLvl] = useLocalStorageState('usaf/isp/black', 0);
  const [ispMethod, setIspMethod] = useLocalStorageState('usaf/isp/method', 'Unsharp mask');

  // ---- Picked-line state (lines carry server measurement) -----------------
  const [lines, setLines] = useStateU([]);
  const [selectedIds, setSelectedIds] = useStateU(new Set());
  const [sortCol, setSortCol] = useStateU('id');
  const [sortDir, setSortDir] = useStateU('asc');
  const [firstClick, setFirstClick] = useStateU(null);
  const [hoverPos, setHoverPos] = useStateU(null);
  const [cursorReadout, setCursorReadout] = useStateU(null);
  const canvasRef = useRefU(null);

  // ---- ISP payload shared by every server call ---------------------------
  // Builder only; not memoized — called at the site of each request so the
  // closure always sees the latest state, no useCallback dep bookkeeping.
  const buildIspPayload = () => {
    if (!ispEnabled || !ispLive) return null;
    const anyActive = ispSharp > 0 || ispDenoise > 0 || ispBlackLvl > 0;
    if (!anyActive) return null;
    return {
      sharpen_method: ispSharp > 0 ? ispMethod : null,
      sharpen_amount: ispSharp,
      sharpen_radius: ispRadius,
      denoise_sigma: ispDenoise * 2.5, // map 0..1 → 0..2.5 px σ
      black_level: ispBlackLvl,
    };
  };

  // ---- Real image from server — ISP flows into the live thumbnail too ----
  // imgSrc depends on every ISP state var explicitly, not on a memoized
  // callback. When the user nudges any ISP slider, this memo re-runs and the
  // URL changes, so the browser re-fetches the server-rendered thumbnail.
  const [imgDims, setImgDims] = useStateU({
    w: source?.shape?.[1] || 720,
    h: source?.shape?.[0] || 540,
  });

  // Display vmin / vmax — when both are non-null AND vmax > vmin the server
  // pins the colormap to that DN window; otherwise it falls back to its
  // default percentile clip. `range` is the per-channel native min/max +
  // percentiles fetched from /channel/.../range, used to seed the slider
  // bounds and reset to "auto" (percentile-derived defaults).
  const [vmin, setVmin] = useStateU(null);
  const [vmax, setVmax] = useStateU(null);
  const [autoRange, setAutoRange] = useLocalStorageState('usaf/autoRange', true);
  const [range, setRange] = useStateU(null); // {min, max, p1, p99, mean, std}

  // Re-fetch range whenever the channel or source (e.g. dark attached) changes.
  useEffectU(() => {
    if (!source || !activeChannel) {
      setRange(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await apiFetch(
          `/api/sources/${source.source_id}/channel/${encodeURIComponent(activeChannel)}/range`
        );
        if (cancelled) return;
        setRange(r);
        // If we're in auto, snap vmin/vmax to the percentile defaults so the
        // colorbar always shows what the canvas sees.
        if (autoRange) {
          setVmin(r.p1);
          setVmax(r.p99);
        }
      } catch {
        if (!cancelled) setRange(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.source_id, source?.has_dark, activeChannel, autoRange]);

  const imgSrc = useMemoU(() => {
    if (!source || !activeChannel) return null;
    const isp =
      ispEnabled && ispLive
        ? {
            sharpen_method: ispSharp > 0 ? ispMethod : null,
            sharpen_amount: ispSharp,
            sharpen_radius: ispRadius,
            denoise_sigma: ispDenoise * 2.5,
            black_level: ispBlackLvl,
          }
        : null;
    // ISP-modes-v1: when the active ISP mode exposes R/G/B and the user
    // has enabled "RGB color composite" display in the ISP settings
    // window, ask the server for the composite thumbnail. Falls back to
    // grayscale server-side if the mode doesn't support it.
    const rgbComposite = !!(rgbCompositeDisplay && source.rgb_composite_available);
    return channelPngUrl(
      source.source_id,
      activeChannel,
      1600,
      isp,
      colormap,
      autoRange ? null : vmin,
      autoRange ? null : vmax,
      rgbComposite
    );
  }, [
    source,
    activeChannel,
    colormap,
    ispEnabled,
    ispLive,
    ispMethod,
    ispSharp,
    ispRadius,
    ispDenoise,
    ispBlackLvl,
    autoRange,
    vmin,
    vmax,
    rgbCompositeDisplay,
  ]);

  const threshold = thresholdPct / 100;
  const nextLpmm = usafLpmm(group, element);

  // ---- Measurement plumbing ----------------------------------------------
  // manualBars/manualGaps (arrays of sample indices) override the server's
  // 5-point auto-detect when present. `spec` is the line geometry only.
  const measureOne = useCallbackU(
    async (spec, manualBars, manualGaps) => {
      if (!source) return null;
      try {
        const body = {
          source_id: source.source_id,
          channel: activeChannel,
          line: spec,
          swath_width: 8.0,
          method,
          isp: buildIspPayload(),
        };
        if (Array.isArray(manualBars) && manualBars.length === 3) body.bar_indices = manualBars;
        if (Array.isArray(manualGaps) && manualGaps.length === 2) body.gap_indices = manualGaps;
        return await apiFetch('/api/usaf/measure', { method: 'POST', body });
      } catch (err) {
        say?.(`measure failed: ${err.detail || err.message}`, 'danger');
        return null;
      }
    },
    [
      source,
      activeChannel,
      method,
      ispEnabled,
      ispLive,
      ispSharp,
      ispRadius,
      ispDenoise,
      ispBlackLvl,
      ispMethod,
    ]
  );

  const advance = () => {
    if (!autoInc && !seqMode) return;
    let ne = element + 1,
      ng = group;
    if (ne > 6) {
      ne = 1;
      if (seqMode) ng = Math.min(5, group + 1);
    }
    setElement(ne);
    setGroup(ng);
  };

  // Snap helper: lock to axis if within 8 px of horizontal/vertical.
  const maybeSnap = (p0, p1) => {
    if (!snap || !p0) return p1;
    const dx = Math.abs(p1[0] - p0[0]),
      dy = Math.abs(p1[1] - p0[1]);
    if (dx > 12 && dy < 8) return [p1[0], p0[1]];
    if (dy > 12 && dx < 8) return [p0[0], p1[1]];
    return p1;
  };

  const addLine = async (p0, p1) => {
    const snapped = maybeSnap(p0, p1);
    const dx = Math.abs(snapped[0] - p0[0]),
      dy = Math.abs(snapped[1] - p0[1]);
    const autoDir = dx >= dy ? 'H' : 'V';
    const L = Math.hypot(dx, dy);
    if (L < 5) return;
    const id = 'l' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    // Remember the picker state in effect BEFORE advance() so that ⌘Z /
    // "delete latest" can restore G/E/direction exactly as it was.
    const prior = { group, element, direction };
    const spec = { group, element, direction: autoDir, p0, p1: snapped };
    setLines((prev) => [...prev, { id, ...spec, prior, pending: true }]);
    setSelectedIds(new Set([id]));
    advance();
    const m = await measureOne(spec);
    setLines((prev) => prev.map((l) => (l.id === id ? { id, ...spec, prior, m } : l)));
  };

  // Update a single line's manual 5-point override and re-measure.
  const updateLinePoints = useCallbackU(
    (lineId, nextBars, nextGaps) => {
      setLines((prev) =>
        prev.map((l) =>
          l.id === lineId ? { ...l, manualBars: nextBars, manualGaps: nextGaps, pending: true } : l
        )
      );
      const line = lines.find((l) => l.id === lineId);
      if (!line) return;
      const spec = {
        group: line.group,
        element: line.element,
        direction: line.direction,
        p0: line.p0,
        p1: line.p1,
      };
      measureOne(spec, nextBars, nextGaps).then((m) => {
        setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, m, pending: false } : l)));
      });
    },
    [lines, measureOne]
  );

  // Undo last line + restore prior G/E/direction.
  const undoLastLine = () => {
    setLines((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      if (last?.prior) {
        setGroup(last.prior.group);
        setElement(last.prior.element);
        setDirection(last.prior.direction);
      }
      return prev.slice(0, -1);
    });
  };
  // Delete selected. If the set contains the most recent line, also revert G/E.
  const deleteSelected = () => {
    if (!selectedIds.size) return;
    setLines((prev) => {
      const latest = prev[prev.length - 1];
      if (latest && selectedIds.has(latest.id) && latest.prior) {
        setGroup(latest.prior.group);
        setElement(latest.prior.element);
        setDirection(latest.prior.direction);
      }
      return prev.filter((l) => !selectedIds.has(l.id));
    });
    setSelectedIds(new Set());
  };

  // Re-measure every line when ISP-live / method toggles change.
  useEffectU(() => {
    if (!lines.length || !source) return;
    let alive = true;
    (async () => {
      const updated = await Promise.all(
        lines.map(async (l) => {
          const m = await measureOne({
            group: l.group,
            element: l.element,
            direction: l.direction,
            p0: l.p0,
            p1: l.p1,
          });
          return m ? { ...l, m, pending: false } : l;
        })
      );
      if (alive) setLines(updated);
    })();
    return () => {
      alive = false;
    };
  }, [
    ispEnabled,
    ispLive,
    ispSharp,
    ispRadius,
    ispDenoise,
    ispBlackLvl,
    ispMethod,
    method,
    activeChannel,
  ]);

  // ---- Coord transforms ---------------------------------------------------
  // Screen (clientX/Y) → image-space pixel. Inverts the full CSS transform
  // stack in the correct order, then accounts for `object-fit: contain`
  // letterboxing inside the canvas container.
  const toImg = useCallbackU(
    (ev) => {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return [0, 0];
      // Point relative to container top-left.
      const sx = ev.clientX - r.left;
      const sy = ev.clientY - r.top;
      // Center-origin.
      const cx = r.width / 2,
        cy = r.height / 2;
      let px = sx - cx - pan[0];
      let py = sy - cy - pan[1];
      // Undo zoom (center-based scale).
      px /= zoom;
      py /= zoom;
      // Undo rotation.
      if (rotation) {
        const rad = (-rotation * Math.PI) / 180;
        const c = Math.cos(rad),
          s = Math.sin(rad);
        const nx = px * c - py * s;
        const ny = px * s + py * c;
        px = nx;
        py = ny;
      }
      // Undo flips.
      if (flipH) px = -px;
      if (flipV) py = -py;
      // Container is the unrotated "image render rect"; apply object-fit: contain
      // letterbox to map from container-coord to image pixel coord.
      const imgAR = imgDims.w / imgDims.h;
      const innerAR = r.width / r.height;
      let renderedW, renderedH;
      if (imgAR > innerAR) {
        renderedW = r.width;
        renderedH = r.width / imgAR;
      } else {
        renderedH = r.height;
        renderedW = r.height * imgAR;
      }
      const fx = px / renderedW + 0.5;
      const fy = py / renderedH + 0.5;
      const ix = Math.max(0, Math.min(imgDims.w, Math.round(fx * imgDims.w)));
      const iy = Math.max(0, Math.min(imgDims.h, Math.round(fy * imgDims.h)));
      return [ix, iy];
    },
    [pan, zoom, rotation, flipH, flipV, imgDims]
  );

  const distSeg = (p, a, b) => {
    const [x, y] = p,
      [ax, ay] = a,
      [bx, by] = b;
    const dx = bx - ax,
      dy = by - ay;
    const tt = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - (ax + tt * dx), y - (ay + tt * dy));
  };

  // ---- Mouse handlers -----------------------------------------------------
  const isPanning = (ev) => ev.button === 1 || tool === 'pan' || spacePan;

  const onCanvasDown = (ev) => {
    if (ev.button === 2) return; // right click handled via onContextMenu
    if (isPanning(ev)) {
      ev.preventDefault();
      const sx = ev.clientX,
        sy = ev.clientY;
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
    const p = toImg(ev);
    const startX = ev.clientX,
      startY = ev.clientY;
    let dragged = false;
    const onMove = (e) => {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) dragged = true;
      setHoverPos(toImg(e));
    };
    const onUp = (e) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (dragged) {
        addLine(p, toImg(e));
        setFirstClick(null);
        setHoverPos(null);
      } else if (firstClick) {
        addLine(firstClick, p);
        setFirstClick(null);
        setHoverPos(null);
      } else {
        setFirstClick(p);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onCanvasWheel = (ev) => {
    // Plain scroll zooms; hold ⌘/⇧ is no longer required.
    ev.preventDefault();
    const r = canvasRef.current.getBoundingClientRect();
    // Cursor position relative to canvas center (screen coords).
    const cx = ev.clientX - r.left - r.width / 2;
    const cy = ev.clientY - r.top - r.height / 2;
    const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.25, Math.min(16, +(zoom * factor).toFixed(3)));
    if (newZoom === zoom) return;
    // Adjust pan so the point under the cursor stays fixed in screen space.
    const k = newZoom / zoom;
    setPan(([ppx, ppy]) => [cx - (cx - ppx) * k, cy - (cy - ppy) * k]);
    setZoom(newZoom);
  };

  const onCanvasMove = (ev) => {
    const [x, y] = toImg(ev);
    setCursorReadout([x, y]);
    if (firstClick) setHoverPos([x, y]);
  };

  const onCanvasRight = (ev) => {
    ev.preventDefault();
    const [x, y] = toImg(ev);
    let best = null,
      bestD = 22;
    for (const ln of lines) {
      const d = distSeg([x, y], ln.p0, ln.p1);
      if (d < bestD) {
        bestD = d;
        best = ln;
      }
    }
    if (best) {
      setLines((prev) => prev.filter((l) => l.id !== best.id));
      setSelectedIds((prev) => {
        const n = new Set(prev);
        n.delete(best.id);
        return n;
      });
    }
  };

  // ---- Keyboard shortcuts -------------------------------------------------
  useEffectU(() => {
    const down = (e) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.isContentEditable)
        return;
      if (e.code === 'Space' && !e.repeat) {
        setSpacePan(true);
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape') setFirstClick(null);
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        undoLastLine();
        e.preventDefault();
        return;
      }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
        setSelectedIds(new Set(lines.map((l) => l.id)));
        e.preventDefault();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return;
        deleteSelected();
      }
      if (e.key === 'ArrowLeft') setGroup((g) => Math.max(0, g - 1));
      if (e.key === 'ArrowRight') setGroup((g) => Math.min(5, g + 1));
      if (e.key === 'ArrowUp') setElement((el) => Math.min(6, el + 1));
      if (e.key === 'ArrowDown') setElement((el) => Math.max(1, el - 1));
      if (e.key === 'r' || e.key === 'R') setRotation((r) => (r + 90) % 360);
      if (e.key === 'f' || e.key === 'F') {
        setZoom(1);
        setPan([0, 0]);
      }
      if (e.key === '0') {
        setZoom(1);
        setPan([0, 0]);
      }
    };
    const up = (e) => {
      if (e.code === 'Space') setSpacePan(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [lines, selectedIds]);

  // ---- Selection toggle ---------------------------------------------------
  const toggleSel = (id, ev) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (ev?.shiftKey && prev.size > 0) {
        const ids = sortedLines.map((l) => l.id);
        const lastId = [...prev][prev.size - 1];
        const a = ids.indexOf(lastId),
          b = ids.indexOf(id);
        const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
        for (let i = lo; i <= hi; i++) next.add(ids[i]);
      } else if (ev?.metaKey || ev?.ctrlKey) {
        next.has(id) ? next.delete(id) : next.add(id);
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  };

  // ---- Sort ---------------------------------------------------------------
  const sortedLines = useMemoU(() => {
    const copy = [...lines];
    const dir = sortDir === 'asc' ? 1 : -1;
    const getV =
      {
        id: (l) => l.id,
        g: (l) => l.group,
        e: (l) => l.element,
        d: (l) => l.direction,
        lpmm: (l) => (l.m ? l.m.lp_mm : usafLpmm(l.group, l.element)),
        mich: (l) => (l.m ? l.m.modulation_5pt : 0),
        fft: (l) => (l.m ? l.m.modulation_fft : 0),
        sCyc: (l) => (l.m ? l.m.samples_per_cycle : 0),
      }[sortCol] || ((l) => l.id);
    copy.sort((a, b) => {
      const va = getV(a),
        vb = getV(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
    return copy;
  }, [lines, sortCol, sortDir]);
  const setSort = (c) => {
    if (sortCol === c) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortCol(c);
      setSortDir('asc');
    }
  };

  // ---- Status bar --------------------------------------------------------
  useEffectU(() => {
    onStatusChange?.(
      `${lines.length} lines · G${group}E${element}${direction} (${nextLpmm.toFixed(2)} lp/mm)`,
      lines.length
    );
  }, [lines.length, group, element, direction, nextLpmm]);

  // ---- Save / Load config -------------------------------------------------
  const fileInputRef = useRefU(null);
  const darkInputRef = useRefU(null);

  // ---- Open by path (preserves source.path so Save/Load cfg round-trips
  //      auto-reload). Browser uploads can't preserve absolute paths for
  //      security reasons; this gives the user an explicit pathway when
  //      they want config files to actually re-load files later.
  const onOpenFromPath = async () => {
    const last =
      (typeof localStorage !== 'undefined' && localStorage.getItem('mantis/lastOpenPath')) || '';
    const p = window.prompt('Absolute path to the H5 / image file:', last);
    if (!p || !p.trim()) return;
    try {
      const newSrc = await apiFetch('/api/sources/load-path', {
        method: 'POST',
        body: { path: p.trim() },
      });
      onSwitchSource?.(newSrc);
      try {
        localStorage.setItem('mantis/lastOpenPath', p.trim());
      } catch {}
      say?.(`Loaded source from ${p.trim()}`, 'success');
    } catch (err) {
      say?.(`Load by path failed: ${err.detail || err.message}`, 'danger');
    }
  };
  const onLoadDarkByPath = async () => {
    if (!source) return;
    const last =
      (typeof localStorage !== 'undefined' && localStorage.getItem('mantis/lastDarkPath')) || '';
    const p = window.prompt('Absolute path to the dark frame file:', last);
    if (!p || !p.trim()) return;
    try {
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark/load-path`, {
        method: 'POST',
        body: { path: p.trim() },
      });
      onSwitchSource?.(updated);
      try {
        localStorage.setItem('mantis/lastDarkPath', p.trim());
      } catch {}
      say?.(`Dark frame attached from ${p.trim()}`, 'success');
    } catch (err) {
      say?.(`Dark load by path failed: ${err.detail || err.message}`, 'danger');
    }
  };

  // ---- Dark-frame upload / clear --------------------------------------
  // Both flow through `onSwitchSource` so the SourceCtx in App updates with
  // the new `has_dark` / `dark_name` fields, which triggers the canvas
  // thumbnail to refetch (now with dark applied) and re-measures all picked
  // lines automatically (the existing `useEffect` already keys on activeChannel
  // / ISP / method, but we'll also nudge by toggling a force-remeasure tick
  // through the source object change).
  const onLoadDark = async (file) => {
    if (!file || !source) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      say?.(`Uploading dark frame ${file.name}…`);
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark/upload`, {
        method: 'POST',
        body: fd,
      });
      onSwitchSource?.(updated);
      // Force every picked line to be re-measured against the dark-subtracted image.
      reMeasureAll();
      say?.(`Dark frame attached: ${updated.dark_name}`, 'success');
    } catch (err) {
      say?.(`Dark load failed: ${err.detail || err.message}`, 'danger');
    }
  };
  const onClearDark = async () => {
    if (!source?.has_dark) return;
    try {
      const updated = await apiFetch(`/api/sources/${source.source_id}/dark`, { method: 'DELETE' });
      onSwitchSource?.(updated);
      reMeasureAll();
      say?.('Dark frame cleared', 'success');
    } catch (err) {
      say?.(`Clear dark failed: ${err.detail || err.message}`, 'danger');
    }
  };
  // Re-measure every picked line — used after dark attach/clear since the
  // server-side image just changed.
  const reMeasureAll = useCallbackU(async () => {
    if (!lines.length) return;
    const updated = await Promise.all(
      lines.map(async (l) => {
        const m = await measureOne(
          { group: l.group, element: l.element, direction: l.direction, p0: l.p0, p1: l.p1 },
          l.manualBars,
          l.manualGaps
        );
        return { ...l, m, pending: false };
      })
    );
    setLines(updated);
  }, [lines, measureOne]);
  const exportConfig = () => {
    const cfg = {
      kind: 'mantis-usaf-config',
      version: 3,
      exportedAt: new Date().toISOString(),
      // Source identifier — `path` is the absolute disk path when known
      // (only set when the file was loaded via /api/sources/load-path or the
      // CLI; browser uploads can't preserve the original path for security).
      // On import we try to re-load from `path` first, then fall back to a
      // file-picker prompt for the matching `name`.
      source: { name: source?.name, kind: source?.kind, path: source?.path || null },
      // Dark-frame attachment, if any. `dark_path` is set when the dark was
      // loaded via /api/sources/{id}/dark/load-path; uploads via the browser
      // file picker have `dark_path = null` and need re-attachment manually.
      dark: source?.has_dark ? { name: source.dark_name, path: source.dark_path || null } : null,
      picker: {
        activeChannel,
        group,
        element,
        direction,
        autoInc,
        seqMode,
        method,
        thresholdPct,
        snap,
      },
      view: { rotation, flipH, flipV, zoom, brightness, contrast, gamma, colormap },
      isp: {
        enabled: ispEnabled,
        live: ispLive,
        method: ispMethod,
        sharp: ispSharp,
        radius: ispRadius,
        denoise: ispDenoise,
        blackLvl: ispBlackLvl,
      },
      lines: lines.map((l) => ({
        id: l.id,
        group: l.group,
        element: l.element,
        direction: l.direction,
        p0: l.p0,
        p1: l.p1,
      })),
      selectedIds: [...selectedIds],
      sortCol,
      sortDir,
    };
    exportJSON(`mantis-usaf-${Date.now()}.json`, cfg);
    say?.(
      `Config saved${source?.path ? ' (with H5 path)' : ' (without H5 path — browser upload)'}`,
      'success'
    );
  };
  const importConfig = async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const cfg = JSON.parse(text);
      if (cfg.kind !== 'mantis-usaf-config') throw new Error('Not a MantisAnalysis USAF config');

      // If the config carries a source.path AND the current source isn't
      // that file, try to ask the server to load it. The server only
      // accepts paths it can read from disk; if it 404s (file moved /
      // permission denied / running on a different machine), we fall
      // through to using the current source. The user gets a toast either
      // way explaining what happened. If the cfg source has no path
      // (browser upload), we surface an actionable warning so the user
      // knows to re-Open the bright file manually.
      const cfgPath = cfg.source?.path || null;
      let activeSrc = source;
      if (cfgPath && cfgPath !== source?.path) {
        try {
          const newSrc = await apiFetch('/api/sources/load-path', {
            method: 'POST',
            body: { path: cfgPath },
          });
          onSwitchSource?.(newSrc);
          activeSrc = newSrc;
          say?.(`Loaded H5 from ${cfgPath}`, 'success');
        } catch (err) {
          say?.(
            `Could not auto-load ${cfgPath} (${err.detail || err.message}); using current source`,
            'warn'
          );
        }
      } else if (cfg.source?.name && !cfgPath && (!source || source.name !== cfg.source.name)) {
        say?.(
          `Config references "${cfg.source.name}" but no path is stored (browser upload). Use "Open H5 / image…" to load it.`,
          'warn'
        );
      }

      // Re-attach the dark frame if the config has a `dark.path` and it's
      // not already attached. Uploads (no path) leave a guidance toast so
      // the user knows to manually re-attach via the Dark frame card.
      if (cfg.dark?.path && activeSrc) {
        try {
          const updatedSrc = await apiFetch(`/api/sources/${activeSrc.source_id}/dark/load-path`, {
            method: 'POST',
            body: { path: cfg.dark.path, name: cfg.dark.name },
          });
          onSwitchSource?.(updatedSrc);
          say?.(`Re-attached dark frame from ${cfg.dark.path}`, 'success');
        } catch (err) {
          say?.(
            `Could not auto-attach dark from ${cfg.dark.path} (${err.detail || err.message})`,
            'warn'
          );
        }
      } else if (cfg.dark?.name && !cfg.dark.path) {
        say?.(
          `Config references dark "${cfg.dark.name}" — re-attach via the Dark frame card`,
          'warn'
        );
      }

      const p = cfg.picker || {};
      if (p.activeChannel && available.includes(p.activeChannel)) setActiveChannel(p.activeChannel);
      if (typeof p.group === 'number') setGroup(p.group);
      if (typeof p.element === 'number') setElement(p.element);
      if (p.direction) setDirection(p.direction);
      if (typeof p.autoInc === 'boolean') setAutoInc(p.autoInc);
      if (typeof p.seqMode === 'boolean') setSeqMode(p.seqMode);
      // p.method is intentionally ignored on import — the picker no longer
      // exposes a Method dropdown (5-point Michelson is the only primary
      // metric); FFT / min-max / percentile are still computed server-side
      // for cross-reference. The field is still written to the JSON for
      // backward shape stability, but importing an old config that picked
      // e.g. "fft" must not crash because setMethod no longer exists.
      // if (p.method) setMethod(p.method);  // — removed; method is a const
      if (typeof p.thresholdPct === 'number') setThresholdPct(p.thresholdPct);
      if (typeof p.snap === 'boolean') setSnap(p.snap);
      const v = cfg.view || {};
      if (typeof v.rotation === 'number') setRotation(v.rotation);
      if (typeof v.flipH === 'boolean') setFlipH(v.flipH);
      if (typeof v.flipV === 'boolean') setFlipV(v.flipV);
      if (typeof v.zoom === 'number') setZoom(v.zoom);
      if (typeof v.brightness === 'number') setBrightness(v.brightness);
      if (typeof v.contrast === 'number') setContrast(v.contrast);
      if (typeof v.gamma === 'number') setGamma(v.gamma);
      if (v.colormap) setColormap(v.colormap);
      const ip = cfg.isp || {};
      if (typeof ip.enabled === 'boolean') setIspEnabled(ip.enabled);
      if (typeof ip.live === 'boolean') setIspLive(ip.live);
      if (ip.method) setIspMethod(ip.method);
      if (typeof ip.sharp === 'number') setIspSharp(ip.sharp);
      if (typeof ip.radius === 'number') setIspRadius(ip.radius);
      if (typeof ip.denoise === 'number') setIspDenoise(ip.denoise);
      if (typeof ip.blackLvl === 'number') setIspBlackLvl(ip.blackLvl);
      if (Array.isArray(cfg.lines)) {
        const placeholder = cfg.lines.map((l) => ({ ...l, pending: true }));
        setLines(placeholder);
        // Re-measure each line against the current source.
        const measured = await Promise.all(
          placeholder.map(async (l) => {
            const m = await measureOne({
              group: l.group,
              element: l.element,
              direction: l.direction,
              p0: l.p0,
              p1: l.p1,
            });
            return { ...l, m, pending: false };
          })
        );
        setLines(measured);
      }
      if (Array.isArray(cfg.selectedIds)) setSelectedIds(new Set(cfg.selectedIds));
      if (cfg.sortCol) setSortCol(cfg.sortCol);
      if (cfg.sortDir) setSortDir(cfg.sortDir);
      say?.(
        `Loaded ${cfg.lines?.length ?? 0} line${cfg.lines?.length === 1 ? '' : 's'} from ${file.name}`,
        'success'
      );
    } catch (err) {
      say?.(`Load failed: ${err.message}`, 'danger');
    }
  };

  const exportCSVTable = () => {
    const rows = sortedLines
      .filter((l) => l.m)
      .map((l) => ({
        id: l.id,
        group: l.group,
        element: l.element,
        direction: l.direction,
        p0_x: l.p0[0],
        p0_y: l.p0[1],
        p1_x: l.p1[0],
        p1_y: l.p1[1],
        lp_mm: l.m.lp_mm.toFixed(4),
        michelson_pct: l.m.modulation_pct.toFixed(6),
        michelson_fft: l.m.modulation_fft.toFixed(6),
        michelson_minmax: l.m.modulation_minmax.toFixed(6),
        samples_per_cycle: l.m.samples_per_cycle.toFixed(3),
        n_samples: l.m.n_samples,
        reliability: l.m.reliability,
        line_length_px: l.m.line_length_px.toFixed(3),
      }));
    if (!rows.length) {
      say?.('Nothing to export — no measured lines.', 'warn');
      return;
    }
    exportCSV(`mantis-usaf-${Date.now()}.csv`, rows);
    say?.(`Exported ${rows.length} row${rows.length !== 1 ? 's' : ''}`, 'success');
  };

  // ---- Run analysis -------------------------------------------------------
  const runAnalysis = async () => {
    if (!source || !lines.length) return;
    try {
      say?.(
        `Running USAF analysis on ${analysisChannels.length} channel${analysisChannels.length !== 1 ? 's' : ''}…`
      );
      const body = {
        source_id: source.source_id,
        channels: analysisChannels,
        lines: lines.map((l) => ({
          group: l.group,
          element: l.element,
          direction: l.direction,
          p0: l.p0,
          p1: l.p1,
        })),
        threshold,
        transform: { rotation, flip_h: flipH, flip_v: flipV },
        isp: buildIspPayload(),
      };
      const res = await apiFetch('/api/usaf/analyze', { method: 'POST', body });
      onRunAnalysis({
        mode: 'usaf',
        source,
        channels: analysisChannels,
        lines,
        threshold,
        response: res,
      });
    } catch (err) {
      say?.(`analyze failed: ${err.detail || err.message}`, 'danger');
    }
  };

  const selectedLine = lines.find((l) => selectedIds.has(l.id)) || null;
  const passCount = lines.filter((l) => l.m && l.m.modulation_5pt >= threshold).length;

  // ---- Profile preview content (shared between sidebar slot & FloatingWindow) ----
  const profilePreviewBody = (
    <ProfilePreview
      line={selectedLine}
      method={method}
      multiCount={selectedIds.size}
      threshold={threshold}
      ispApplied={ispEnabled && ispLive}
      onPointsChange={(bars, gaps) => {
        if (!selectedLine) return;
        updateLinePoints(selectedLine.id, bars, gaps);
      }}
      onReset={() => {
        if (!selectedLine) return;
        updateLinePoints(selectedLine.id, null, null);
      }}
    />
  );

  // ---- Left sidebar panels (keyed by id; order is user-controlled) -------
  const leftPanels = {
    source: (
      <Card title="Source" icon="open" pinned>
        <Tip title="Currently loaded recording">
          <div
            style={{
              fontSize: 11.5,
              color: t.text,
              wordBreak: 'break-all',
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            {source?.name || '(none)'}
          </div>
        </Tip>
        <div
          style={{
            fontSize: 10.5,
            color: t.textFaint,
            marginTop: 3,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          {source
            ? `${source.kind} · ${source.shape[1]}×${source.shape[0]} · ${source.channels.length} ch`
            : '—'}
        </div>
        {/* Open a new bright/source recording (H5 / image). Uses the same
              hidden top-bar file input so the file-type filter is honored
              identically; lets the user load source data without leaving the
              left panel. The "by path" sibling preserves the absolute disk
              path on the server, which is what enables Save/Load cfg to
              auto-reload the file on the next session. */}
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
        {/* Grid (not flex) so each button gets a fixed half of the row and
              never overflows the other off-screen. fullWidth + flexShrink:0
              in a flex container caused the previous overflow. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          <Button
            variant="ghost"
            icon="save"
            size="xs"
            onClick={exportConfig}
            title="Save picker / view / ISP / all picked lines to JSON"
            fullWidth
          >
            Save cfg
          </Button>
          <Button
            variant="ghost"
            icon="upload"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            title="Load a previously-saved JSON; lines will be re-measured against the current source"
            fullWidth
          >
            Load cfg
          </Button>
        </div>

        {/* ---- Dark frame attachment ----
              The dark frame is subtracted per-pixel before any analysis.
              Server validates shape + channel-key compatibility; on mismatch
              we surface the error in a toast. Pipeline runs in float64 with
              a ≥ 0 clamp so uint16 wrap-around can't poison the math. */}
        <div
          style={{
            marginTop: 10,
            padding: '6px 8px',
            background: source?.has_dark ? t.accentSoft : t.panelAlt,
            border: `1px solid ${source?.has_dark ? t.accent + '33' : t.border}`,
            borderRadius: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: source?.has_dark ? t.accent : t.textMuted,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="layers" size={11} />
            <span>Dark frame</span>
            {source?.has_dark && (
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
              color: source?.has_dark ? t.text : t.textFaint,
              marginTop: 4,
              fontFamily: 'ui-monospace,Menlo,monospace',
              wordBreak: 'break-all',
            }}
          >
            {source?.has_dark
              ? `subtracted: ${source.dark_name}`
              : 'not attached — analysis uses raw DN'}
          </div>
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 6 }}
          >
            <Button
              variant="ghost"
              icon="open"
              size="xs"
              onClick={() => darkInputRef.current?.click()}
              title={`Pick a dark file to subtract per-pixel before analysis · current filter: ${fileFilter.filters[fileFilter.current]?.label}`}
              fullWidth
            >
              {source?.has_dark ? 'Replace' : 'Load'}
            </Button>
            <Button
              variant="ghost"
              icon="open"
              size="xs"
              onClick={onLoadDarkByPath}
              title="Type / paste an absolute disk path. Path is saved with cfg so Load cfg auto-attaches this dark later."
              fullWidth
            >
              by path…
            </Button>
            <Button
              variant="danger"
              icon="trash"
              size="xs"
              disabled={!source?.has_dark}
              onClick={onClearDark}
              title="Detach the dark frame; analysis returns to raw DN"
              fullWidth
            >
              Clear
            </Button>
          </div>
          {/* Filetype filter — shared with top-bar Open so a single
                selection follows the user across bright + dark uploads.
                Native <select> for OS-consistency; "All files" is always
                available so a user can override and pick e.g. a TIFF dark
                even while the Open dialog is filtered to H5. */}
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }} data-no-drag>
            <span style={{ fontSize: 10, color: t.textFaint }}>Filetype</span>
            <select
              value={fileFilter.current}
              onChange={(e) => fileFilter.set(e.target.value)}
              title="File-type filter for the Open dialog (applies to both bright and dark uploads)"
              style={{
                flex: 1,
                fontSize: 10.5,
                padding: '2px 6px',
                background: t.inputBg,
                color: t.text,
                border: `1px solid ${t.border}`,
                borderRadius: 3,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {Object.entries(fileFilter.filters).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <input
            ref={darkInputRef}
            type="file"
            accept={darkAccept}
            style={{ display: 'none' }}
            onChange={(e) => {
              onLoadDark(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            importConfig(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </Card>
    ),

    displayChannel: (
      <Card title="Display channel" icon="layers">
        <div style={{ fontSize: 10.5, color: t.textFaint, marginBottom: 6 }}>
          Sensor readout shown in canvas
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {available.map((c) => (
            <Tip key={c} title={`View ${c}`}>
              <ChannelChip
                id={chipId(c)}
                selected={activeChannel === c}
                onToggle={() => setActiveChannel(c)}
                size="sm"
              />
            </Tip>
          ))}
        </div>
      </Card>
    ),

    analysisChannels: (
      <Card title={`Analysis channels · ${analysisChannels.length}`} icon="grid">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          {available.map((c) => (
            <Tip key={c} title={`Include ${c} in Run analysis`}>
              <ChannelChip
                id={chipId(c)}
                multi
                selected={analysisChannels.includes(c)}
                onToggle={() =>
                  setAnalysisChannels((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                  )
                }
                size="sm"
              />
            </Tip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Button
            size="xs"
            title="Select every channel for analysis"
            onClick={() => setAnalysisChannels(available)}
          >
            All
          </Button>
          <Button
            size="xs"
            title="Clear all selected channels"
            onClick={() => setAnalysisChannels([])}
          >
            None
          </Button>
          {available.some((c) => c.startsWith('HG-')) && (
            <>
              <Button
                size="xs"
                title="Select only the high-gain (HG-*) channels"
                onClick={() => setAnalysisChannels(available.filter((c) => c.startsWith('HG-')))}
              >
                HG
              </Button>
              <Button
                size="xs"
                title="Select only the low-gain (LG-*) channels"
                onClick={() => setAnalysisChannels(available.filter((c) => c.startsWith('LG-')))}
              >
                LG
              </Button>
            </>
          )}
        </div>
      </Card>
    ),

    picking: (
      <Card title="Picking" icon="pin" pinned>
        <Row label="Group">
          <Tip title="USAF group number (0–5). ← / → also changes this.">
            <Spinbox value={group} min={0} max={5} onChange={setGroup} />
          </Tip>
          <div style={{ flex: 1 }} />
        </Row>
        <Row label="Element">
          <Tip title="USAF element (1–6). ↑ / ↓ also changes this.">
            <Spinbox value={element} min={1} max={6} onChange={setElement} />
          </Tip>
          <div style={{ flex: 1 }} />
        </Row>
        <Row label="Direction">
          <Tip title="Bar orientation. Auto-set from stroke direction when you draw.">
            <Segmented value={direction} options={['H', 'V']} onChange={setDirection} />
          </Tip>
        </Row>
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: t.accentSoft,
            borderRadius: 5,
            border: `1px solid ${t.accent}22`,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: t.accent,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
            }}
          >
            Next stroke
          </div>
          <div style={{ marginTop: 3, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 600,
                color: t.text,
                fontFamily: 'ui-monospace,Menlo,monospace',
              }}
            >
              G{group}E{element}
              {direction}
            </span>
            <span
              style={{
                fontSize: 11,
                color: t.textMuted,
                fontFamily: 'ui-monospace,Menlo,monospace',
              }}
            >
              {nextLpmm.toFixed(2)} lp/mm
            </span>
            <span
              style={{
                marginLeft: 'auto',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: usafColorForElt(element),
              }}
            />
          </div>
        </div>
        {/* Inline hints that used to live on these checkboxes have been
              moved into the hover Tip text — keeps the panel tight without
              losing the explanation. */}
        <Tip title="After each picked line, auto-increment Element by 1 so consecutive picks march through E1 → E6 without manual clicks. Off = element stays put after each pick.">
          <Checkbox checked={autoInc} onChange={setAutoInc} label="Auto-increment after pick" />
        </Tip>
        <Tip title="When Element rolls past 6, advance Group by 1 and reset Element to 1, so picks sweep G0E1, G0E2, …, G0E6, G1E1, G1E2, … (also forces auto-increment on).">
          <Checkbox
            checked={seqMode}
            onChange={(v) => {
              setSeqMode(v);
              if (v) setAutoInc(true);
            }}
            label="Sequential G+E sweep"
          />
        </Tip>
        <Tip title="When drawing, snap the stroke to a perfect horizontal or vertical axis if it's within 8 pixels of one. Helpful for USAF where bars are axis-aligned. Off = freehand.">
          <Checkbox checked={snap} onChange={setSnap} label="Snap to axis" />
        </Tip>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <Tip title="Reset Group + Element back to G0 / E1 (the lowest-frequency element on a standard USAF target)">
            <Button
              onClick={() => {
                setGroup(0);
                setElement(1);
              }}
              size="xs"
            >
              Reset G0 E1
            </Button>
          </Tip>
          <Tip title="Reset canvas zoom to 100% and pan to center">
            <Button
              icon="zoomReset"
              size="xs"
              onClick={() => {
                setZoom(1);
                setPan([0, 0]);
              }}
            >
              Reset zoom
            </Button>
          </Tip>
        </div>
      </Card>
    ),

    outputMode: (
      <Card title="Output mode" icon="run" pinned>
        <Row label="Threshold">
          <Tip title="MTF pass/fail threshold. Typical: 30% (CTF) or 10% (Rayleigh).">
            <Segmented
              value={`${thresholdPct}%`}
              options={['50%', '30%', '20%', '10%']}
              onChange={(v) => setThresholdPct(parseInt(v))}
              fullWidth
            />
          </Tip>
        </Row>
        <div style={{ marginTop: 12 }}>
          <Tip title="POST to /api/usaf/analyze. Matplotlib PNGs come back from the server.">
            <Button
              variant="primary"
              icon="run"
              size="lg"
              fullWidth
              disabled={lines.length === 0 || analysisChannels.length === 0}
              onClick={runAnalysis}
            >
              Run analysis
            </Button>
          </Tip>
          <div style={{ fontSize: 10.5, color: t.textFaint, marginTop: 6, textAlign: 'center' }}>
            {lines.length === 0
              ? 'Pick at least one line.'
              : analysisChannels.length === 0
                ? 'Choose ≥1 analysis channel.'
                : `${lines.length} line${lines.length > 1 ? 's' : ''} · ${analysisChannels.length} ch · t=${thresholdPct}%`}
          </div>
        </div>
      </Card>
    ),
  };

  // ---- Right sidebar panels (keyed by id; order is user-controlled) ------
  // Pop-out is a <span role="button"> rather than a <button> because the Card
  // header itself is a <button> and HTML forbids button-in-button nesting.
  // role + tabIndex + onKeyDown preserve a11y; onMouseDown stops the parent
  // header from also collapsing the card on the same gesture.
  const togglePopOut = (e) => {
    e.stopPropagation();
    setProfileFloating((f) => !f);
  };
  const popOutBtn = (
    <Tip
      title={
        profileFloating
          ? 'Dock back into the sidebar'
          : 'Pop out as a floating window you can place anywhere on screen'
      }
    >
      <span
        role="button"
        aria-label={
          profileFloating ? 'dock profile back into sidebar' : 'pop out profile to floating window'
        }
        tabIndex={0}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={togglePopOut}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') togglePopOut(e);
        }}
        style={{
          color: t.textMuted,
          cursor: 'pointer',
          padding: 2,
          display: 'inline-flex',
          marginRight: 4,
          borderRadius: 3,
        }}
      >
        <Icon name={profileFloating ? 'download' : 'export'} size={11} />
      </span>
    </Tip>
  );

  const rightPanels = {
    display: (
      <Card title="Display" icon="sliders">
        <Row label="Colormap">
          <Tip title="Server-side colormap applied to the channel PNG. JET is the classic radiometric choice; viridis / magma / turbo are perceptually uniform alternatives.">
            <Select
              value={colormap}
              onChange={setColormap}
              options={[
                { value: 'gray', label: 'Grayscale' },
                { value: 'jet', label: 'JET (classic)' },
                { value: 'turbo', label: 'Turbo (modern JET)' },
                { value: 'viridis', label: 'Viridis' },
                { value: 'magma', label: 'Magma' },
                { value: 'inferno', label: 'Inferno' },
                { value: 'plasma', label: 'Plasma' },
                { value: 'cividis', label: 'Cividis' },
                { value: 'hot', label: 'Hot' },
                { value: 'cool', label: 'Cool' },
                { value: 'gist_heat', label: 'Gist heat' },
              ]}
            />
          </Tip>
        </Row>
        <Tip title="Display-only brightness offset (CSS filter). Does NOT affect what the analysis math sees — change ISP black level for that.">
          <Slider
            label="Brightness"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={brightness}
            onChange={setBrightness}
          />
        </Tip>
        <Tip title="Display-only contrast multiplier (CSS filter). Stretches mid-range visually; analysis is unaffected.">
          <Slider
            label="Contrast"
            min={0.5}
            max={2.5}
            step={0.01}
            value={contrast}
            onChange={setContrast}
          />
        </Tip>
        <Tip title="Display-only gamma curve (visualization only — analysis uses raw DN).">
          <Slider label="Gamma" min={0.4} max={2.5} step={0.01} value={gamma} onChange={setGamma} />
        </Tip>

        {/* Colormap range (vmin / vmax). When AUTO, server uses 1%/99.5%
            percentile clip per channel. When MANUAL, vmin/vmax are pinned
            and the colorbar labels match exactly. Both numeric inputs
            accept the channel's native DN range; clicking AUTO snaps back
            to percentile defaults. */}
        <div
          style={{
            marginTop: 10,
            padding: '6px 8px',
            background: t.panelAlt,
            border: `1px solid ${t.border}`,
            borderRadius: 4,
          }}
          data-no-drag
        >
          <div
            style={{
              fontSize: 10,
              color: t.textMuted,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon name="palette" size={11} />
            <span>Colormap range</span>
            <Tip
              title={
                autoRange
                  ? 'Click to pin vmin/vmax to current values'
                  : 'Click to revert to percentile-clip defaults (1% / 99.5%)'
              }
            >
              <button
                onClick={() => {
                  if (autoRange) {
                    setAutoRange(false); /* values already correct */
                  } else {
                    setAutoRange(true);
                    if (range) {
                      setVmin(range.p1);
                      setVmax(range.p99);
                    }
                  }
                }}
                style={{
                  marginLeft: 'auto',
                  fontSize: 9.5,
                  padding: '1px 6px',
                  background: autoRange ? t.accent : t.chipBg,
                  color: autoRange ? '#fff' : t.text,
                  border: `1px solid ${autoRange ? t.accent : t.border}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {autoRange ? 'AUTO' : 'MANUAL'}
              </button>
            </Tip>
          </div>
          {range && (
            <div
              style={{
                fontSize: 9.5,
                color: t.textFaint,
                marginTop: 3,
                fontFamily: 'ui-monospace,Menlo,monospace',
              }}
            >
              channel range: {range.min.toFixed(0)} – {range.max.toFixed(0)} DN
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
            <Tip title="Lower bound of the colormap. Pixels ≤ vmin map to the colormap's first color.">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: t.textMuted }}>vmin</span>
                <input
                  type="number"
                  value={vmin ?? ''}
                  step={range ? Math.max(1, (range.max - range.min) / 1000) : 1}
                  disabled={autoRange}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setVmin(v);
                  }}
                  style={{
                    width: '100%',
                    fontSize: 11,
                    padding: '2px 6px',
                    background: t.inputBg,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                    opacity: autoRange ? 0.7 : 1,
                  }}
                />
              </label>
            </Tip>
            <Tip title="Upper bound of the colormap. Pixels ≥ vmax map to the colormap's last color.">
              <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 10, color: t.textMuted }}>vmax</span>
                <input
                  type="number"
                  value={vmax ?? ''}
                  step={range ? Math.max(1, (range.max - range.min) / 1000) : 1}
                  disabled={autoRange}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) setVmax(v);
                  }}
                  style={{
                    width: '100%',
                    fontSize: 11,
                    padding: '2px 6px',
                    background: t.inputBg,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    fontFamily: 'ui-monospace,Menlo,monospace',
                    opacity: autoRange ? 0.7 : 1,
                  }}
                />
              </label>
            </Tip>
          </div>
          {range && (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <Tip title="Snap to native min/max">
                <button
                  disabled={autoRange}
                  onClick={() => {
                    setVmin(range.min);
                    setVmax(range.max);
                  }}
                  style={{
                    flex: 1,
                    fontSize: 9.5,
                    padding: '2px 4px',
                    background: t.chipBg,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    cursor: autoRange ? 'not-allowed' : 'pointer',
                    opacity: autoRange ? 0.7 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  min/max
                </button>
              </Tip>
              <Tip title="Snap to mean ± 3σ">
                <button
                  disabled={autoRange}
                  onClick={() => {
                    setVmin(range.mean - 3 * range.std);
                    setVmax(range.mean + 3 * range.std);
                  }}
                  style={{
                    flex: 1,
                    fontSize: 9.5,
                    padding: '2px 4px',
                    background: t.chipBg,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    cursor: autoRange ? 'not-allowed' : 'pointer',
                    opacity: autoRange ? 0.7 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  μ ± 3σ
                </button>
              </Tip>
              <Tip title="Snap to 1%/99.5% percentile defaults">
                <button
                  disabled={autoRange}
                  onClick={() => {
                    setVmin(range.p1);
                    setVmax(range.p99);
                  }}
                  style={{
                    flex: 1,
                    fontSize: 9.5,
                    padding: '2px 4px',
                    background: t.chipBg,
                    color: t.text,
                    border: `1px solid ${t.border}`,
                    borderRadius: 3,
                    cursor: autoRange ? 'not-allowed' : 'pointer',
                    opacity: autoRange ? 0.7 : 1,
                    fontFamily: 'inherit',
                  }}
                >
                  p1/p99
                </button>
              </Tip>
            </div>
          )}
        </div>

        <div style={{ fontSize: 10, color: t.textFaint, marginTop: 6, lineHeight: 1.4 }}>
          Display only — does not affect analysis. Use the ISP card below to change what the server
          measures.
        </div>
      </Card>
    ),

    isp: (
      <ISPCard
        enabled={ispEnabled}
        setEnabled={setIspEnabled}
        live={ispLive}
        setLive={setIspLive}
        method={ispMethod}
        setMethod={setIspMethod}
        sharp={ispSharp}
        setSharp={setIspSharp}
        radius={ispRadius}
        setRadius={setIspRadius}
        denoise={ispDenoise}
        setDenoise={setIspDenoise}
        blackLvl={ispBlackLvl}
        setBlackLvl={setIspBlackLvl}
      />
    ),

    linesTable: (
      <LinesTable
        lines={sortedLines}
        selectedIds={selectedIds}
        toggleSel={toggleSel}
        sortCol={sortCol}
        sortDir={sortDir}
        setSort={setSort}
        threshold={threshold}
        ispApplied={ispEnabled && ispLive}
        onDelete={deleteSelected}
        onSelectAll={() => setSelectedIds(new Set(lines.map((l) => l.id)))}
        onClearAll={() => {
          // Clearing all includes the latest line → revert G/E/direction to the
          // state before the first still-present line was drawn.
          const first = lines[0];
          if (first?.prior) {
            setGroup(first.prior.group);
            setElement(first.prior.element);
            setDirection(first.prior.direction);
          }
          setLines([]);
          setSelectedIds(new Set());
        }}
        onCSV={exportCSVTable}
        totalLines={lines.length}
      />
    ),

    profilePreview: (
      <Card title="Profile preview" icon="eye" pinned actions={popOutBtn}>
        {profileFloating ? (
          <div
            style={{
              fontSize: 11,
              color: t.textFaint,
              padding: '12px 4px',
              lineHeight: 1.5,
              textAlign: 'center',
              border: `1px dashed ${t.border}`,
              borderRadius: 4,
            }}
          >
            Profile preview is floating in its own window.
            <br />
            Click <Icon name="download" size={10} /> in the header to dock it back here.
          </div>
        ) : (
          profilePreviewBody
        )}
      </Card>
    ),

    summary: (
      <Card title="Summary" icon="pin">
        {(() => {
          const measured = lines.filter((l) => l.m);
          const failing = measured
            .filter((l) => l.m.modulation_5pt < threshold)
            .sort((a, b) => a.m.lp_mm - b.m.lp_mm);
          const firstFail = failing[0];
          return (
            <StatBlock
              emphasis="lim"
              items={[
                { label: 'measured', value: `${measured.length} / ${lines.length}` },
                {
                  label: 'pass',
                  value: `${passCount}`,
                  color: passCount > 0 ? t.success : t.textMuted,
                },
                {
                  label: 'fail',
                  value: `${failing.length}`,
                  color: failing.length === 0 ? t.success : t.danger,
                  muted: failing.length === 0,
                },
                {
                  label: 'detection limit',
                  key: 'lim',
                  value: firstFail ? `${firstFail.m.lp_mm.toFixed(2)} lp/mm` : 'above all picks',
                  color: firstFail ? t.accent : t.success,
                },
                {
                  label: 'first failure',
                  value: firstFail
                    ? `G${firstFail.group}E${firstFail.element}${firstFail.direction}`
                    : '—',
                  muted: !firstFail,
                },
              ]}
            />
          );
        })()}
        <div style={{ marginTop: 8, fontSize: 10, color: t.textFaint, lineHeight: 1.4 }}>
          Detection limit = smallest lp/mm whose Michelson drops below the threshold.
        </div>
      </Card>
    ),
  };

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `${leftW}px minmax(360px, 1fr) ${rightW}px`,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* ================================================================= LEFT */}
      <div
        style={{
          position: 'relative',
          borderRight: `1px solid ${t.border}`,
          background: t.bg,
          padding: 10,
          overflowY: 'auto',
        }}
      >
        <ResizeHandle value={leftW} onChange={setLeftW} min={240} max={600} side="right" grow={1} />
        <DraggablePanelList order={leftOrder} setOrder={setLeftOrder} panels={leftPanels} />
      </div>

      {/* ================================================================= CENTER */}
      <USAFCanvas
        canvasRef={canvasRef}
        imgSrc={imgSrc}
        imgDims={imgDims}
        setImgDims={setImgDims}
        channel={activeChannel}
        lines={lines}
        selectedIds={selectedIds}
        firstClick={firstClick}
        hoverPos={hoverPos}
        cursor={cursorReadout}
        group={group}
        element={element}
        direction={direction}
        rotation={rotation}
        flipH={flipH}
        flipV={flipV}
        zoom={zoom}
        pan={pan}
        snap={snap}
        tool={tool}
        setTool={setTool}
        spacePan={spacePan}
        onDown={onCanvasDown}
        onMove={onCanvasMove}
        onRight={onCanvasRight}
        onWheel={onCanvasWheel}
        onRotate={() => setRotation((rotation + 90) % 360)}
        onFlipH={() => setFlipH((f) => !f)}
        onFlipV={() => setFlipV((f) => !f)}
        onZoomIn={() => setZoom((z) => Math.min(8, +(z * 1.25).toFixed(2)))}
        onZoomOut={() => setZoom((z) => Math.max(0.25, +(z / 1.25).toFixed(2)))}
        onZoomReset={() => {
          setZoom(1);
          setPan([0, 0]);
        }}
        onUndo={undoLastLine}
        brightness={brightness}
        contrast={contrast}
        gamma={gamma}
        threshold={threshold}
        passCount={passCount}
        colormap={colormap}
        vmin={vmin}
        vmax={vmax}
      />

      {/* ================================================================= RIGHT */}
      <div
        style={{
          position: 'relative',
          borderLeft: `1px solid ${t.border}`,
          background: t.bg,
          padding: 10,
          overflowY: 'auto',
        }}
      >
        <ResizeHandle
          value={rightW}
          onChange={setRightW}
          min={260}
          max={680}
          side="left"
          grow={-1}
        />
        <DraggablePanelList order={rightOrder} setOrder={setRightOrder} panels={rightPanels} />
      </div>

      {/* Floating profile preview — position: fixed, lives outside the grid */}
      {profileFloating && (
        <FloatingWindow
          title="Profile preview"
          icon="eye"
          x={profileWin.x}
          y={profileWin.y}
          w={profileWin.w}
          h={profileWin.h}
          onChange={setProfileWin}
          onClose={() => setProfileFloating(false)}
        >
          {profilePreviewBody}
        </FloatingWindow>
      )}
    </div>
  );
};

// ===========================================================================
// USAFCanvas — rulers, zoom/pan, rotation-aware labels, HUD, toolbars
// ===========================================================================
const USAFCanvas = ({
  canvasRef,
  imgSrc,
  imgDims,
  setImgDims,
  channel,
  lines,
  selectedIds,
  firstClick,
  hoverPos,
  cursor,
  group,
  element,
  direction,
  rotation,
  flipH,
  flipV,
  zoom,
  pan,
  snap,
  tool,
  setTool,
  spacePan,
  onDown,
  onMove,
  onRight,
  onWheel,
  onRotate,
  onFlipH,
  onFlipV,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onUndo,
  brightness,
  contrast,
  _gamma,
  threshold,
  passCount,
  colormap,
  vmin,
  vmax,
}) => {
  const t = useTheme();
  const filter = `brightness(${1 + brightness * 1.2}) contrast(${contrast})`;
  const innerTx = `translate(${pan[0]}px, ${pan[1]}px) scale(${zoom}) rotate(${rotation}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`;
  const canvasCursor = tool === 'pan' || spacePan ? 'grab' : 'crosshair';

  // Track the container's screen size so the overlay SVG (which renders in
  // screen pixels, outside the CSS transform) can forward-map image coords.
  const [cRect, setCRect] = useStateU({ w: 0, h: 0 });
  useEffectU(() => {
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

  // Image → screen-coord mapper that mirrors the CSS transform stack exactly
  // (flip → rotate → scale → translate) applied around the container's center,
  // with object-fit: contain letterboxing.
  const imgToScreen = (ix, iy) => {
    const { w, h } = cRect;
    if (!w || !h) return [0, 0];
    const imgAR = imgDims.w / imgDims.h;
    const innerAR = w / h;
    let rw, rh;
    if (imgAR > innerAR) {
      rw = w;
      rh = w / imgAR;
    } else {
      rh = h;
      rw = h * imgAR;
    }
    let px = (ix / imgDims.w - 0.5) * rw;
    let py = (iy / imgDims.h - 0.5) * rh;
    if (flipH) px = -px;
    if (flipV) py = -py;
    if (rotation) {
      const rad = (rotation * Math.PI) / 180;
      const c = Math.cos(rad),
        s = Math.sin(rad);
      const nx = px * c - py * s;
      const ny = px * s + py * c;
      px = nx;
      py = ny;
    }
    px = px * zoom + pan[0] + w / 2;
    py = py * zoom + pan[1] + h / 2;
    return [px, py];
  };

  // Snap-aware preview endpoint (still in image coords).
  let previewTo = hoverPos;
  if (snap && firstClick && hoverPos) {
    const dx = Math.abs(hoverPos[0] - firstClick[0]);
    const dy = Math.abs(hoverPos[1] - firstClick[1]);
    if (dx > 12 && dy < 8) previewTo = [hoverPos[0], firstClick[1]];
    else if (dy > 12 && dx < 8) previewTo = [firstClick[0], hoverPos[1]];
  }

  // Adaptive ruler ticks: ~80 screen-px between majors.
  const ticksFor = (imgSize) => {
    const desiredImg = 80 / zoom;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    const step = steps.find((s) => s >= desiredImg) || steps[steps.length - 1];
    const out = [];
    for (let v = 0; v <= imgSize; v += step) out.push(v);
    return { step, ticks: out };
  };
  const rulerX = ticksFor(imgDims.w);
  const rulerY = ticksFor(imgDims.h);

  return (
    <div style={{ background: t.bg, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Canvas header */}
      <div
        style={{
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${t.border}`,
          background: t.bg,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: t.text,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background:
                  CHANNEL_COLORS[
                    parseChannel(channel?.includes('-') ? channel : `HG-${channel}`).band
                  ] || t.accent,
              }}
            />
            {channel}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: t.textFaint,
              marginTop: 2,
              fontFamily: 'ui-monospace,Menlo,monospace',
            }}
          >
            USAF 1951 · rot {rotation}°{flipH ? ' · H' : ''}
            {flipV ? ' · V' : ''} · zoom {(zoom * 100).toFixed(0)}%
          </div>
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            fontFamily: 'ui-monospace,Menlo,monospace',
            fontSize: 11.5,
            color: t.textMuted,
          }}
        >
          {cursor && (
            <span title="Cursor image-space coordinates">
              x={String(cursor[0]).padStart(4, '0')} · y={String(cursor[1]).padStart(4, '0')}
            </span>
          )}
          <span style={{ color: t.textFaint }}>
            {lines.length} picked · {passCount} pass
          </span>
        </div>
      </div>

      {/* Canvas area with rulers */}
      <div style={{ flex: 1, position: 'relative', background: t.canvasBg, overflow: 'hidden' }}>
        {/* Floating colorbar — always shows the current colormap labelled by
            vmin / vmax. Hidden for grayscale (no useful color information)
            but kept active when the user explicitly pinned a range. */}
        {(colormap !== 'gray' || (vmin != null && vmax != null)) && (
          <CanvasColorbar colormap={colormap} vmin={vmin} vmax={vmax} side="right" />
        )}
        <RulerH
          t={t}
          imgSize={imgDims.w}
          step={rulerX.step}
          ticks={rulerX.ticks}
          zoom={zoom}
          panPx={pan[0]}
          cursorImg={cursor?.[0]}
          leftInset={26}
        />
        <RulerV
          t={t}
          imgSize={imgDims.h}
          step={rulerY.step}
          ticks={rulerY.ticks}
          zoom={zoom}
          panPx={pan[1]}
          cursorImg={cursor?.[1]}
          topInset={20}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 26,
            height: 20,
            background: t.panelAlt,
            borderRight: `1px solid ${t.border}`,
            borderBottom: `1px solid ${t.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: t.textFaint,
            fontSize: 9,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          px
        </div>

        {/* Clickable surface */}
        <div
          ref={canvasRef}
          onMouseDown={onDown}
          onMouseMove={onMove}
          onContextMenu={onRight}
          onWheel={onWheel}
          style={{
            position: 'absolute',
            top: 20,
            left: 26,
            right: 0,
            bottom: 0,
            cursor: canvasCursor,
            userSelect: 'none',
          }}
        >
          {/* Only the img gets the CSS transform — the overlay below lives in
              untransformed screen space so strokes + labels stay pin-sharp at
              every zoom level. `image-rendering: pixelated` keeps the bitmap
              crisp when the user zooms in past 100% (otherwise the browser
              bilinear-smooths individual pixels into mush). */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: innerTx,
              transformOrigin: 'center',
              transition: 'none',
              pointerEvents: 'none',
            }}
          >
            {imgSrc && (
              <img
                src={imgSrc}
                alt=""
                draggable={false}
                onLoad={(e) => setImgDims({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: zoom >= 1 ? 'pixelated' : 'auto',
                  filter,
                  pointerEvents: 'none',
                }}
              />
            )}
          </div>

          {/* Overlay SVG — rendered in screen-pixel space. Strokes and text
              therefore stay at constant visual thickness regardless of zoom
              (no CSS-transform rasterization blur), and text has no aspect
              distortion. */}
          <svg
            width="100%"
            height="100%"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
          >
            {(() => {
              const STROKE = 1.6,
                STROKE_SEL = 2.4,
                STROKE_GUIDE = 0.8;
              const DOT_R = 3.2,
                DOT_STROKE = 0.6;
              const HALO = 8,
                CROSS_ARM = 7,
                CROSS_STROKE = 1.5;
              const children = [];
              // Snap guides — drawn as full-canvas lines at the first-click axis.
              if (firstClick && hoverPos && snap) {
                const [fx, fy] = imgToScreen(firstClick[0], firstClick[1]);
                children.push(
                  <g key="snap" opacity={0.4}>
                    <line
                      x1={0}
                      y1={fy}
                      x2={cRect.w}
                      y2={fy}
                      stroke="#4a9eff"
                      strokeWidth={STROKE_GUIDE}
                      strokeDasharray="3 4"
                    />
                    <line
                      x1={fx}
                      y1={0}
                      x2={fx}
                      y2={cRect.h}
                      stroke="#4a9eff"
                      strokeWidth={STROKE_GUIDE}
                      strokeDasharray="3 4"
                    />
                  </g>
                );
              }
              // Lines + labels.
              lines.forEach((l) => {
                const sel = selectedIds.has(l.id);
                const c = usafColorForElt(l.element);
                const [x0, y0] = imgToScreen(l.p0[0], l.p0[1]);
                const [x1, y1] = imgToScreen(l.p1[0], l.p1[1]);
                const mx = (x0 + x1) / 2,
                  my = (y0 + y1) / 2;
                const pass = l.m ? l.m.modulation_5pt >= threshold : null;
                children.push(
                  <g key={l.id}>
                    {sel && (
                      <line
                        x1={x0}
                        y1={y0}
                        x2={x1}
                        y2={y1}
                        stroke="#ffd54f"
                        strokeWidth={HALO}
                        strokeLinecap="round"
                        opacity={0.55}
                      />
                    )}
                    <line
                      x1={x0}
                      y1={y0}
                      x2={x1}
                      y2={y1}
                      stroke={c}
                      strokeWidth={sel ? STROKE_SEL : STROKE}
                      strokeLinecap="round"
                      opacity={l.pending ? 0.5 : 1}
                      strokeDasharray={pass === false ? '6 3' : ''}
                    />
                    <circle
                      cx={x0}
                      cy={y0}
                      r={DOT_R}
                      fill={c}
                      stroke="#000"
                      strokeWidth={DOT_STROKE}
                    />
                    <circle
                      cx={x1}
                      cy={y1}
                      r={DOT_R}
                      fill={c}
                      stroke="#000"
                      strokeWidth={DOT_STROKE}
                    />
                    {/* Label: screen-space, always upright */}
                    <g transform={`translate(${mx}, ${my - 16})`}>
                      <rect
                        x={-22}
                        y={-8}
                        width={44}
                        height={15}
                        rx={3}
                        fill="rgba(10,12,16,0.92)"
                        stroke={sel ? '#ffd54f' : c}
                        strokeWidth={sel ? 1.3 : 0.7}
                      />
                      <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        fill="#fff"
                        fontSize={10}
                        fontFamily="ui-monospace,Menlo,monospace"
                        fontWeight={500}
                      >
                        G{l.group}E{l.element}
                        {l.direction}
                      </text>
                    </g>
                  </g>
                );
              });
              // First-click crosshair + preview line.
              if (firstClick) {
                const [fx, fy] = imgToScreen(firstClick[0], firstClick[1]);
                const p = previewTo ? imgToScreen(previewTo[0], previewTo[1]) : null;
                children.push(
                  <g key="first">
                    <line
                      x1={fx - CROSS_ARM}
                      y1={fy}
                      x2={fx + CROSS_ARM}
                      y2={fy}
                      stroke="#e5484d"
                      strokeWidth={CROSS_STROKE}
                    />
                    <line
                      x1={fx}
                      y1={fy - CROSS_ARM}
                      x2={fx}
                      y2={fy + CROSS_ARM}
                      stroke="#e5484d"
                      strokeWidth={CROSS_STROKE}
                    />
                    {p && (
                      <line
                        x1={fx}
                        y1={fy}
                        x2={p[0]}
                        y2={p[1]}
                        stroke="#e5484d"
                        strokeWidth={CROSS_STROKE * 0.85}
                        strokeDasharray="4 3"
                        opacity={0.85}
                      />
                    )}
                  </g>
                );
              }
              return children;
            })()}
          </svg>

          {/* HUD — upright, screen-space */}
          {(firstClick || hoverPos) &&
            (() => {
              const [sx, sy] = imgToScreen(
                (hoverPos || firstClick)[0],
                (hoverPos || firstClick)[1]
              );
              return (
                <HUD
                  style={{ left: `${sx}px`, top: `${sy}px`, transform: 'translate(14px, -34px)' }}
                >
                  <span style={{ color: usafColorForElt(element) }}>● </span>G{group}E{element}
                  {direction}
                  <span style={{ opacity: 0.7, marginLeft: 6 }}>
                    {usafLpmm(group, element).toFixed(2)} lp/mm
                  </span>
                  {firstClick && hoverPos && (
                    <span style={{ opacity: 0.7, marginLeft: 6 }}>
                      · L=
                      {Math.round(
                        Math.hypot(hoverPos[0] - firstClick[0], hoverPos[1] - firstClick[1])
                      )}
                      px
                    </span>
                  )}
                </HUD>
              );
            })()}
        </div>

        {/* Toolbars */}
        <CanvasToolbar position="top-right">
          <CanvasBtn
            icon="rotate"
            label={`${rotation}°`}
            onClick={onRotate}
            title="Rotate canvas 90° (R)"
          />
          <CanvasBtn icon="flip" active={flipH} onClick={onFlipH} title="Flip horizontal" />
          <CanvasBtn icon="flip" active={flipV} onClick={onFlipV} title="Flip vertical" />
        </CanvasToolbar>
        <CanvasToolbar position="top-left">
          <CanvasBtn
            icon="crosshair"
            active={tool === 'pick' && !spacePan}
            onClick={() => setTool('pick')}
            title="Pick tool — draw & select lines"
          />
          <CanvasBtn
            icon="hand"
            active={tool === 'pan' || spacePan}
            onClick={() => setTool('pan')}
            title="Pan tool (or hold Space) — drag the canvas"
          />
          <div
            style={{
              width: 1,
              height: 18,
              background: 'rgba(255,255,255,0.1)',
              alignSelf: 'center',
            }}
          />
          <CanvasBtn icon="plus" onClick={onZoomIn} title="Zoom in  ·  wheel zooms to cursor" />
          <CanvasBtn icon="minus" onClick={onZoomOut} title="Zoom out" />
          <CanvasBtn
            icon="zoomReset"
            label={`${Math.round(zoom * 100)}%`}
            onClick={onZoomReset}
            title="Reset zoom + pan (0)"
          />
          <CanvasBtn icon="fit" onClick={onZoomReset} title="Fit to view (F)" />
          <CanvasBtn icon="undo" onClick={onUndo} title="Undo last line (⌘Z)" />
        </CanvasToolbar>

        {/* Hint strip */}
        <div
          style={{
            position: 'absolute',
            bottom: 10,
            left: 26,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              padding: '5px 12px',
              background: 'rgba(10,10,10,0.68)',
              backdropFilter: 'blur(6px)',
              borderRadius: 20,
              fontSize: 10.5,
              color: '#aab3bf',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            <Kbd tone="dim">drag</Kbd> line ·<Kbd tone="dim">space</Kbd> pan ·
            <Kbd tone="dim">wheel</Kbd> zoom ·<Kbd tone="dim">rmb</Kbd> delete ·
            <Kbd tone="dim">←→↑↓</Kbd> G/E ·<Kbd tone="dim">⌘Z</Kbd> undo
          </div>
        </div>
      </div>
    </div>
  );
};

// ===========================================================================
// ISP card — server-side parameters applied on every measure / analyze call
// ===========================================================================
const ISPCard = ({
  enabled,
  setEnabled,
  live,
  setLive,
  method,
  setMethod,
  sharp,
  setSharp,
  radius,
  setRadius,
  denoise,
  setDenoise,
  blackLvl,
  setBlackLvl,
}) => {
  const t = useTheme();
  const actions = (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <Tip title="Enable / disable ISP pipeline server-side">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            fontSize: 10,
            color: enabled ? t.accent : t.textMuted,
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ margin: 0, cursor: 'pointer' }}
          />
          {enabled ? 'ON' : 'OFF'}
        </label>
      </Tip>
    </div>
  );
  return (
    <Card title="ISP" icon="sparkles" pinned actions={actions}>
      <div
        style={{
          padding: '6px 8px',
          background: enabled ? t.accentSoft : t.panelAlt,
          border: `1px solid ${enabled ? t.accent + '33' : t.border}`,
          borderRadius: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Tip title="When checked, ISP params flow into every /api/usaf/measure + /api/usaf/analyze call.">
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: enabled ? 'pointer' : 'not-allowed',
              fontSize: 11,
              color: enabled ? t.text : t.textFaint,
            }}
          >
            <input
              type="checkbox"
              checked={live}
              disabled={!enabled}
              onChange={(e) => setLive(e.target.checked)}
              style={{ margin: 0, cursor: 'inherit' }}
            />
            <span style={{ fontWeight: 500 }}>Apply live</span>
          </label>
        </Tip>
        <span
          style={{ fontSize: 9.5, color: t.textFaint, fontFamily: 'ui-monospace,Menlo,monospace' }}
        >
          → server measure + analyze
        </span>
        {enabled && live && (
          <span
            style={{
              marginLeft: 'auto',
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: t.accent,
              boxShadow: `0 0 0 3px ${t.accent}33`,
            }}
          />
        )}
      </div>
      <div style={{ opacity: !enabled ? 0.95 : 1, pointerEvents: !enabled ? 'none' : 'auto' }}>
        <Row label="Method">
          <Tip title="Sharpening algorithm applied by the Python ISP pipeline.">
            <Select
              value={method}
              onChange={setMethod}
              options={['Unsharp mask', 'Laplacian', 'High-pass', 'None']}
            />
          </Tip>
        </Row>
        <Tip title="How aggressively the sharpening filter pushes high-frequency detail. 0 = no sharpening; >1.0 may over-shoot edges.">
          <Slider
            label="Sharpen amount"
            min={0}
            max={1.5}
            step={0.05}
            value={sharp}
            onChange={setSharp}
          />
        </Tip>
        <Tip title="Sharpening kernel radius in pixels. Smaller = enhance fine detail; larger = enhance broader features.">
          <Slider
            label="Radius (px)"
            min={0.4}
            max={4}
            step={0.1}
            value={radius}
            onChange={setRadius}
            format={(v) => v.toFixed(1)}
          />
        </Tip>
        <Tip title="Gaussian blur σ applied AFTER sharpening to suppress noise. 0 = no denoise.">
          <Slider
            label="Denoise (σ)"
            min={0}
            max={1}
            step={0.05}
            value={denoise}
            onChange={setDenoise}
          />
        </Tip>
        <Tip title="Constant DN offset subtracted from every pixel before measurement (e.g. to remove bias-frame pedestal).">
          <Slider
            label="Black level"
            min={0}
            max={2000}
            step={25}
            value={blackLvl}
            onChange={setBlackLvl}
            format={(v) => v.toFixed(0)}
          />
        </Tip>
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <Tip title="Reset ISP to mild defaults">
            <Button
              size="xs"
              onClick={() => {
                setMethod('Unsharp mask');
                setSharp(0.4);
                setRadius(1.2);
                setDenoise(0.2);
                setBlackLvl(0);
              }}
            >
              Reset
            </Button>
          </Tip>
          <Tip title="Zero everything — pure raw">
            <Button
              size="xs"
              onClick={() => {
                setSharp(0);
                setDenoise(0);
                setBlackLvl(0);
              }}
            >
              Bypass
            </Button>
          </Tip>
          <div style={{ flex: 1 }} />
          <Tip title="Aggressive sharpen preset for MTF enhancement">
            <Button
              size="xs"
              icon="sparkles"
              onClick={() => {
                setMethod('Unsharp mask');
                setSharp(0.8);
                setRadius(1.6);
                setDenoise(0.35);
              }}
            >
              MTF+
            </Button>
          </Tip>
        </div>
      </div>
    </Card>
  );
};

// ===========================================================================
// Lines table — sortable columns, multi-select via ⇧/⌘, CSV export
// ===========================================================================
const LinesTable = ({
  lines,
  selectedIds,
  toggleSel,
  sortCol,
  sortDir,
  setSort,
  threshold,
  ispApplied,
  onDelete,
  onSelectAll,
  onClearAll,
  onCSV,
  totalLines,
}) => {
  const t = useTheme();
  // 5-point Michelson is always shown as the primary value here, regardless
  // of the picker's Method dropdown. The dropdown only affects which value
  // measure_line() returns as `modulation` (used elsewhere). Percentile
  // P10/P90 was removed from the visible columns — it's misleading on USAF
  // profiles because the (P90 − P10) / (P90 + P10) ratio reads ~1 for any
  // line that crosses both bright surround and dark bars, regardless of
  // whether the bar pattern is actually visible.
  const cols = [
    { id: 'g', label: 'G', w: 22, title: 'Group' },
    { id: 'e', label: 'E', w: 22, title: 'Element' },
    { id: 'd', label: 'D', w: 22, title: 'Direction (H/V)' },
    { id: 'lpmm', label: 'lp/mm', w: 56, title: 'Line pairs per millimeter' },
    {
      id: 'mich',
      label: 'Mich (5-pt)',
      w: 70,
      title: '5-point Michelson contrast — robust against percentile artifacts',
    },
    { id: 'fft', label: 'FFT', w: 56, title: 'FFT-fundamental Michelson' },
    { id: 'sCyc', label: 's/cyc', w: 48, title: 'Samples per cycle — <3 below Nyquist' },
  ];
  const cg = `20px ${cols.map((c) => `${c.w}px`).join(' ')}`;
  const allSelected = selectedIds.size === totalLines && totalLines > 0;
  return (
    <Card
      title={`Picked lines · ${totalLines}${selectedIds.size ? ` (${selectedIds.size} sel)` : ''}`}
      icon="grid"
      pinned
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          padding: '4px 2px 8px',
          fontSize: 10,
          color: t.textMuted,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: t.success }} /> pass ≥
          {(threshold * 100).toFixed(0)}%
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: t.danger }} /> fail
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#d97706' }} /> &lt;
          Nyquist
        </span>
        {ispApplied && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: t.accent,
              marginLeft: 'auto',
            }}
          >
            <Icon name="sparkles" size={10} /> ISP live
          </span>
        )}
      </div>
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 5, overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: cg,
            gap: 0,
            padding: '6px 10px',
            fontSize: 9.5,
            color: t.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            fontWeight: 600,
            background: t.panelAlt,
            borderBottom: `1px solid ${t.border}`,
          }}
        >
          <Tip title="Select / deselect all rows">
            <input
              type="checkbox"
              aria-label="Select / deselect all rows"
              checked={allSelected}
              onChange={(e) => (e.target.checked ? onSelectAll() : toggleSel(-1, {}))}
              style={{ margin: 0, cursor: 'pointer' }}
            />
          </Tip>
          {cols.map((c) => (
            <Tip key={c.id} title={`Sort by ${c.title}`}>
              <div
                onClick={() => setSort(c.id)}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  userSelect: 'none',
                }}
              >
                {c.label}
                {sortCol === c.id && (
                  <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                )}
              </div>
            </Tip>
          ))}
        </div>
        <div style={{ maxHeight: 260, overflowY: 'auto', background: t.panel }}>
          {lines.map((l) => {
            const sel = selectedIds.has(l.id);
            const mich = l.m ? l.m.modulation_5pt : null;
            const belowNyq = l.m && l.m.samples_per_cycle < 3;
            const pass = mich != null ? mich >= threshold : null;
            const cellColor = l.pending
              ? t.textFaint
              : belowNyq
                ? '#d97706'
                : pass
                  ? t.success
                  : t.danger;
            return (
              <div
                key={l.id}
                onClick={(e) => toggleSel(l.id, e.nativeEvent)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: cg,
                  gap: 0,
                  padding: '6px 10px',
                  fontSize: 11,
                  background: sel ? t.accentSoft : 'transparent',
                  color: sel ? t.accent : t.text,
                  cursor: 'pointer',
                  fontFamily: 'ui-monospace,Menlo,monospace',
                  borderBottom: `1px solid ${t.border}`,
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => !sel && (e.currentTarget.style.background = t.panelAlt)}
                onMouseLeave={(e) => !sel && (e.currentTarget.style.background = 'transparent')}
              >
                <input
                  type="checkbox"
                  checked={sel}
                  onChange={() => {}}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSel(l.id, e.nativeEvent);
                  }}
                  style={{ margin: 0, cursor: 'pointer' }}
                />
                <div>{l.group}</div>
                <div>{l.element}</div>
                <div style={{ color: usafColorForElt(l.element) }}>{l.direction}</div>
                <div>{(l.m ? l.m.lp_mm : usafLpmm(l.group, l.element)).toFixed(2)}</div>
                <div
                  style={{ color: cellColor, fontWeight: 500 }}
                  title={
                    l.pending
                      ? 'measuring…'
                      : pass
                        ? `Pass (≥${(threshold * 100).toFixed(0)}%)`
                        : 'Fail'
                  }
                >
                  {l.pending ? '…' : mich != null ? mich.toFixed(3) : 'err'}
                  {ispApplied && l.m && <span style={{ color: t.accent, marginLeft: 2 }}>*</span>}
                </div>
                <div style={{ color: t.textMuted }}>
                  {l.m ? l.m.modulation_fft.toFixed(3) : '—'}
                </div>
                <div
                  style={{
                    color: l.m ? sCycColor(l.m.samples_per_cycle, t) : t.textFaint,
                    fontWeight: 500,
                  }}
                  title={l.m ? sCycTag(l.m.samples_per_cycle) : ''}
                >
                  {l.m ? l.m.samples_per_cycle.toFixed(1) : '—'}
                </div>
              </div>
            );
          })}
          {lines.length === 0 && (
            <div
              style={{
                padding: '18px 10px',
                fontSize: 11,
                color: t.textFaint,
                textAlign: 'center',
              }}
            >
              No lines yet — click-click or drag on the canvas.
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <Tip title={`Delete ${selectedIds.size} selected`}>
          <Button
            icon="trash"
            size="xs"
            variant="danger"
            disabled={selectedIds.size === 0}
            onClick={onDelete}
          >
            Delete{selectedIds.size > 1 ? ` (${selectedIds.size})` : ''}
          </Button>
        </Tip>
        <Tip title="Select all lines (⌘A)">
          <Button size="xs" onClick={onSelectAll} disabled={totalLines === 0}>
            Select all
          </Button>
        </Tip>
        <Tip title="Delete all lines">
          <Button size="xs" onClick={onClearAll} disabled={totalLines === 0}>
            Clear all
          </Button>
        </Tip>
        <div style={{ flex: 1 }} />
        <Tip title="Download measured lines as CSV">
          <Button size="xs" icon="export" disabled={totalLines === 0} onClick={onCSV}>
            CSV
          </Button>
        </Tip>
      </div>
      <div
        style={{
          fontSize: 10,
          color: t.textFaint,
          marginTop: 6,
          fontFamily: 'ui-monospace,Menlo,monospace',
        }}
      >
        ⇧-click range · ⌘-click toggle · click header to sort
        {ispApplied ? ' · * = ISP-applied' : ''}
      </div>
    </Card>
  );
};

// ===========================================================================
// Profile preview — real server-returned profile array for the selected line
// ===========================================================================
// Five-point Michelson computed locally from a profile + index arrays.
// Mirrors the server's measure_modulation_5pt exactly so dragging the
// points gives instant, numerically-identical feedback.
const michelson5pt = (profile, bars, gaps) => {
  if (!profile?.length || !bars?.length || !gaps?.length) return 0;
  const val = (i) => profile[Math.max(0, Math.min(profile.length - 1, Math.round(i)))];
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const bVals = bars.map(val),
    gVals = gaps.map(val);
  const mB = mean(bVals),
    mG = mean(gVals);
  const hi = Math.max(mB, mG),
    lo = Math.min(mB, mG);
  const d = hi + lo;
  return d > 0 ? (hi - lo) / d : 0;
};

const ProfilePreview = ({
  line,
  _method,
  multiCount,
  threshold,
  ispApplied,
  onPointsChange,
  onReset,
}) => {
  const t = useTheme();
  // Hooks are always called in the same order — NO early returns before this block.
  const svgRef = React.useRef(null);
  // Local drag-in-progress override; committed to the parent on mouseup.
  // Reset whenever the selected line changes.
  const [dragOverride, setDragOverride] = React.useState(null);
  React.useEffect(() => {
    setDragOverride(null);
  }, [line?.id]);

  if (!line) {
    return (
      <div style={{ fontSize: 11, color: t.textFaint, padding: '16px 4px', textAlign: 'center' }}>
        Select a line to see its profile.
      </div>
    );
  }
  const m = line.m;
  if (!m) {
    return (
      <div style={{ fontSize: 11, color: t.textFaint, padding: '16px 4px', textAlign: 'center' }}>
        Measuring…
      </div>
    );
  }

  const W = 280,
    H = 110;
  const profile = m.profile || [];
  const N = profile.length;
  // Pad the y-range by 12% top + 18% bottom so the dragged-point circles,
  // their dashed guide lines, and the "B1/G1" labels above/below the curve
  // never clip against the SVG box. The bottom gets a bit more room for
  // the gap labels rendered at H - 2.
  const vRaw = m.profile_max - m.profile_min;
  const padTop = (vRaw || 1) * 0.12;
  const padBot = (vRaw || 1) * 0.18;
  const yMax = m.profile_max + padTop;
  const yMin = m.profile_min - padBot;
  const range = yMax > yMin ? yMax - yMin : 1;
  const yOf = (v) => (1 - (v - yMin) / range) * H;
  const polyPts = profile.map((v, i) => [(i / (N - 1 || 1)) * W, yOf(v)]);
  const p10y = yOf(m.profile_p10);
  const p90y = yOf(m.profile_p90);

  // Effective bars/gaps = (drag-in-progress override) ?? (committed manual) ?? (auto-detected).
  const bars = (dragOverride?.bars ?? line.manualBars ?? m.bar_indices ?? []).slice();
  const gaps = (dragOverride?.gaps ?? line.manualGaps ?? m.gap_indices ?? []).slice();
  const manual = Boolean(line.manualBars || line.manualGaps || dragOverride);

  // Live client-side 5-point recompute (updates on drag, no server round-trip).
  const primary5pt = michelson5pt(profile, bars, gaps);
  // 5-point is the canonical reading. The Method dropdown only changes
  // which secondary value the SERVER labels as `modulation` for the rest
  // of the pipeline — the big number on the profile preview is always
  // 5-point so the user can see the manual-drag effect immediately.
  const primary = primary5pt;
  const pass = primary >= threshold;
  const methodLabel = '5-point';

  const idxToX = (i) => (i / (N - 1 || 1)) * W;
  const yAt = (i) => {
    const v = profile[Math.max(0, Math.min(N - 1, Math.round(i)))];
    return yOf(v);
  };
  const xToIdx = (xPx) => {
    const frac = Math.max(0, Math.min(1, xPx / W));
    return Math.round(frac * (N - 1));
  };

  // Drag handler — pure local state; only commits on mouseup.
  const onDragStart = (e, kind, which) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    let currentBars = bars.slice(),
      currentGaps = gaps.slice();
    const run = (ev) => {
      const x = (ev.clientX - r.left) * (W / r.width);
      const newIdx = xToIdx(x);
      currentBars = currentBars.slice();
      currentGaps = currentGaps.slice();
      if (kind === 'bar') currentBars[which] = newIdx;
      else currentGaps[which] = newIdx;
      setDragOverride({ bars: currentBars, gaps: currentGaps });
    };
    const stop = () => {
      window.removeEventListener('mousemove', run);
      window.removeEventListener('mouseup', stop);
      onPointsChange?.(currentBars, currentGaps);
      setDragOverride(null); // parent now owns these values in line state
    };
    window.addEventListener('mousemove', run);
    window.addEventListener('mouseup', stop);
  };

  return (
    <div>
      {multiCount > 1 && (
        <div style={{ fontSize: 10.5, color: t.textMuted, marginBottom: 6 }}>
          {multiCount} lines selected · showing G{line.group}E{line.element}
          {line.direction}
        </div>
      )}
      <div
        style={{
          background: t.panelAlt,
          border: `1px solid ${t.border}`,
          borderRadius: 5,
          padding: 8,
          marginTop: 4,
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          style={{ touchAction: 'none', display: 'block' }}
        >
          <line
            x1={0}
            y1={p10y}
            x2={W}
            y2={p10y}
            stroke={t.textFaint}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />
          <line
            x1={0}
            y1={p90y}
            x2={W}
            y2={p90y}
            stroke={t.textFaint}
            strokeWidth={0.5}
            strokeDasharray="3 3"
          />
          <polyline
            points={polyPts.map((p) => p.join(',')).join(' ')}
            fill="none"
            stroke={usafColorForElt(line.element)}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          {/* Bar centers — bright fill, dashed vertical guide. */}
          {bars.map((idx, i) => {
            const x = idxToX(idx),
              y = yAt(idx);
            return (
              <g key={`b${i}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={H}
                  stroke="#ffd54f"
                  strokeWidth={0.6}
                  strokeDasharray="2 3"
                  opacity={0.6}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={5.5}
                  fill="rgba(15,20,30,0.92)"
                  stroke="#ffd54f"
                  strokeWidth={1.6}
                  onMouseDown={(e) => onDragStart(e, 'bar', i)}
                  style={{ cursor: 'ew-resize' }}
                >
                  <title>{`Bar ${i + 1} · sample ${idx} · ${profile[idx]?.toFixed?.(0) ?? '—'} DN — drag horizontally`}</title>
                </circle>
                <text
                  x={x}
                  y={y - 8}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#ffd54f"
                  fontFamily="ui-monospace,Menlo,monospace"
                  pointerEvents="none"
                >
                  B{i + 1}
                </text>
              </g>
            );
          })}
          {/* Gap centers — dark fill. */}
          {gaps.map((idx, i) => {
            const x = idxToX(idx),
              y = yAt(idx);
            return (
              <g key={`g${i}`}>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={H}
                  stroke="#4a9eff"
                  strokeWidth={0.6}
                  strokeDasharray="2 3"
                  opacity={0.55}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={4.6}
                  fill="#4a9eff"
                  stroke="rgba(15,20,30,0.92)"
                  strokeWidth={1.4}
                  onMouseDown={(e) => onDragStart(e, 'gap', i)}
                  style={{ cursor: 'ew-resize' }}
                >
                  <title>{`Gap ${i + 1} · sample ${idx} · ${profile[idx]?.toFixed?.(0) ?? '—'} DN — drag horizontally`}</title>
                </circle>
                <text
                  x={x}
                  y={H - 2}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#8ebfff"
                  fontFamily="ui-monospace,Menlo,monospace"
                  pointerEvents="none"
                >
                  G{i + 1}
                </text>
              </g>
            );
          })}
        </svg>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 4,
            fontSize: 9.5,
            color: t.textFaint,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          <span>0 px · {m.profile_min.toFixed(0)} DN</span>
          <span style={{ flex: 1, textAlign: 'center' }}>
            {manual ? (
              <span style={{ color: t.warn }}>manual — drag points to adjust · </span>
            ) : (
              <span style={{ color: t.textMuted }}>auto-detected · </span>
            )}
            3 bars / 2 gaps
          </span>
          <span>
            L = {m.line_length_px.toFixed(0)} px · {m.profile_max.toFixed(0)} DN
          </span>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            fontSize: 10,
            color: t.textMuted,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            fontWeight: 600,
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>Michelson · {methodLabel}</span>
          {ispApplied && (
            <span
              title="ISP pipeline live-applied"
              style={{
                color: t.accent,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 9.5,
              }}
            >
              <Icon name="sparkles" size={9} /> ISP
            </span>
          )}
          <div style={{ flex: 1 }} />
          {manual && (
            <Button size="xs" onClick={onReset} title="Reset to server auto-detected points">
              Auto-detect
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span
            style={{
              fontSize: 24,
              fontWeight: 600,
              fontFamily: 'ui-monospace,Menlo,monospace',
              color: pass ? t.success : t.danger,
              lineHeight: 1,
            }}
          >
            {primary.toFixed(3)}
          </span>
          <span style={{ fontSize: 10.5, color: pass ? t.success : t.danger, fontWeight: 500 }}>
            {pass ? 'PASS' : 'FAIL'}
          </span>
          <span style={{ fontSize: 10, color: t.textFaint }}>
            t={(threshold * 100).toFixed(0)}%
          </span>
        </div>
        {/* Percentile (P10/P90) deliberately omitted — it reads ~1 for any
            line that crosses bright surround + dark bars regardless of
            actual bar pattern, so it's misleading on USAF profiles.
            Still in the API response for anyone scripting against it. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            marginTop: 10,
            fontSize: 10.5,
            color: t.textMuted,
            fontFamily: 'ui-monospace,Menlo,monospace',
          }}
        >
          <div>
            <span style={{ color: t.textFaint }}>5-point</span>
            <div style={{ color: t.accent, fontWeight: 600 }}>{primary5pt.toFixed(3)}</div>
          </div>
          <div>
            <span style={{ color: t.textFaint }}>FFT fund.</span>
            <div style={{ color: t.text }}>{m.modulation_fft.toFixed(3)}</div>
          </div>
          <div>
            <span style={{ color: t.textFaint }}>min/max</span>
            <div style={{ color: t.text }}>{m.modulation_minmax.toFixed(3)}</div>
          </div>
          <div>
            <span style={{ color: t.textFaint }}>lp/mm</span>
            <div style={{ color: t.text }}>{m.lp_mm.toFixed(2)}</div>
          </div>
          <div>
            <span style={{ color: t.textFaint }}>s/cyc</span>
            <div style={{ color: sCycColor(m.samples_per_cycle, t) }}>
              {m.samples_per_cycle.toFixed(1)}
            </div>
          </div>
        </div>
        {m.samples_per_cycle < 3 && (
          <div
            style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'rgba(207,34,46,0.08)',
              border: `1px solid ${t.danger}33`,
              borderRadius: 4,
              fontSize: 10.5,
              color: t.danger,
              lineHeight: 1.4,
            }}
          >
            ⚠ {m.samples_per_cycle.toFixed(1)} samples/cycle — below Nyquist. Values not
            trustworthy.
          </div>
        )}
      </div>
    </div>
  );
};

// ===========================================================================
// Adaptive rulers — reflect pan + zoom; red cursor marker
// ===========================================================================
const RulerH = ({ t, imgSize, step, ticks, zoom, panPx, cursorImg, leftInset }) => (
  <div
    style={{
      position: 'absolute',
      top: 0,
      left: leftInset,
      right: 0,
      height: 20,
      background: t.panelAlt,
      borderBottom: `1px solid ${t.border}`,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        transform: `translateX(${panPx}px)`,
      }}
    >
      <svg
        width="100%"
        height="20"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}
      >
        {ticks.map((v) => {
          const pct = (v / imgSize - 0.5) * zoom + 0.5;
          if (pct < -0.05 || pct > 1.05) return null;
          const major = v % (step * 5) === 0 || step >= 100;
          return (
            <g key={v}>
              <line
                x1={`${pct * 100}%`}
                x2={`${pct * 100}%`}
                y1={major ? 8 : 14}
                y2={20}
                stroke={t.textFaint}
                strokeWidth={major ? 0.8 : 0.5}
              />
              {/* SVG `x` can't accept calc(); use a translate(3,0) wrapper
                  for the 3-px right offset instead, else Chromium rejects
                  the attribute and surfaces it as a console error. */}
              {major && (
                <g transform="translate(3,0)">
                  <text
                    x={`${pct * 100}%`}
                    y={10}
                    fontSize={9}
                    fill={t.textMuted}
                    fontFamily="ui-monospace,Menlo,monospace"
                  >
                    {v}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      {cursorImg != null &&
        (() => {
          const pct = (cursorImg / imgSize - 0.5) * zoom + 0.5;
          if (pct < 0 || pct > 1) return null;
          return (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: `${pct * 100}%`,
                width: 1,
                height: '100%',
                background: '#e5484d',
              }}
            />
          );
        })()}
    </div>
  </div>
);
const RulerV = ({ t, imgSize, step, ticks, zoom, panPx, cursorImg, topInset }) => (
  <div
    style={{
      position: 'absolute',
      top: topInset,
      left: 0,
      bottom: 0,
      width: 26,
      background: t.panelAlt,
      borderRight: `1px solid ${t.border}`,
      pointerEvents: 'none',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        transform: `translateY(${panPx}px)`,
      }}
    >
      <svg
        width="26"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: 'absolute', inset: 0 }}
      >
        {ticks.map((v) => {
          const pct = (v / imgSize - 0.5) * zoom + 0.5;
          if (pct < -0.05 || pct > 1.05) return null;
          const major = v % (step * 5) === 0 || step >= 100;
          return (
            <g key={v}>
              <line
                x1={major ? 14 : 20}
                x2={26}
                y1={`${pct * 100}%`}
                y2={`${pct * 100}%`}
                stroke={t.textFaint}
                strokeWidth={major ? 0.8 : 0.5}
              />
              {major && (
                <text
                  x={2}
                  y={`${(pct * 100).toFixed(2)}%`}
                  dy={-2}
                  fontSize={9}
                  fill={t.textMuted}
                  fontFamily="ui-monospace,Menlo,monospace"
                >
                  {v}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {cursorImg != null &&
        (() => {
          const pct = (cursorImg / imgSize - 0.5) * zoom + 0.5;
          if (pct < 0 || pct > 1) return null;
          return (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: `${pct * 100}%`,
                height: 1,
                width: '100%',
                background: '#e5484d',
              }}
            />
          );
        })()}
    </div>
  </div>
);

export { USAFMode };
export default USAFMode;
