// shared-esm.js — bundler-migration-v1 Phase 2.
//
// Parallel ES-module subset of `web/src/shared.jsx`. Ports the
// constants, hooks, API helpers, and the SourceCtx context — the
// pieces with NO JSX and NO dependency on other shared primitives —
// so the Vite-built frontend can do real work (live API calls +
// source tracking) without touching the production CDN path.
//
// Phase 3 migrates the remaining JSX primitives (Card, Button,
// Icon, Chart, Modal, Toast, etc.) and the mode files, then
// deletes the CDN + Babel-standalone path. Until then, both
// frontends coexist:
//   - CDN (web/index.html) uses shared.jsx via Babel-standalone.
//   - Vite (web/index-vite.html) uses shared-esm.js + main.jsx.
//
// Any primitive ported here MUST stay byte-identical in behavior
// to the shared.jsx original so Phase 3 can cut over without
// surprises.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

// ---------------------------------------------------------------------------
// Brand constants (from shared.jsx:10-26)
// ---------------------------------------------------------------------------

export const BRAND = {
  name: 'MantisAnalysis',
  tagline: 'Multi-channel imaging bench',
  customer: 'BioSensors Lab · UIUC',
  lab: 'BioSensors Lab · UIUC',
  author: 'Zhongmin Zhu',
  authorAffiliation: 'PolarX Photonics',
  authorEmail: 'j@polarxphotonics.com',
  year: new Date().getFullYear(),
  version: '0.9.2',
  build: '2025.04.b',
};

export const IMAGE_DIMS = { W: 720, H: 540 };

// ---------------------------------------------------------------------------
// Viewport hook (from shared.jsx:29-39)
// ---------------------------------------------------------------------------

export const useViewport = () => {
  const [w, setW] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, []);
  const bucket = w < 960 ? 'xs' : w < 1180 ? 'sm' : w < 1400 ? 'md' : 'lg';
  return { w, bucket, isNarrow: w < 1180 };
};

// ---------------------------------------------------------------------------
// useLocalStorageState (from shared.jsx:1357-1370)
// ---------------------------------------------------------------------------

const LS_PREFIX = 'mantis/';

export const useLocalStorageState = (key, initial) => {
  const fullKey = LS_PREFIX + key;
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(fullKey);
      if (raw != null) return JSON.parse(raw);
    } catch {
      // localStorage unavailable (private browsing, quota) — fall through.
    }
    return typeof initial === 'function' ? initial() : initial;
  });
  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(v));
    } catch {
      // Write quota or blocked — silently drop; the in-memory state
      // still works.
    }
  }, [fullKey, v]);
  return [v, setV];
};

// ---------------------------------------------------------------------------
// useDebounced (from shared.jsx:1643-1650)
// ---------------------------------------------------------------------------

export const useDebounced = (value, delayMs = 200) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
};

// ---------------------------------------------------------------------------
// API base + helpers (from shared.jsx:1470-1576)
// ---------------------------------------------------------------------------

export const API_BASE = (() => {
  try {
    const u = new URL(window.location.href);
    const override = u.searchParams.get('api');
    if (override) return override.replace(/\/$/, '');
  } catch {
    // URL parsing failed (unusual). Fall through to origin logic.
  }
  // file:// origin is 'null'; fall back to the dev server.
  // Also: when running under Vite dev (:5173), the `/api` proxy in
  // vite.config.js forwards to :8765 — so `window.location.origin`
  // is what we want for relative API URLs.
  if (window.location.protocol === 'file:') return 'http://127.0.0.1:8765';
  return window.location.origin;
})();

/** Flatten Pydantic 422 detail arrays + other shapes to a one-liner.
 *  Mirrors shared.jsx::formatApiDetail byte-identically.
 */
export const formatApiDetail = (d) => {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => {
        if (!e) return '';
        if (typeof e === 'string') return e;
        const loc = Array.isArray(e.loc)
          ? e.loc.filter((x) => x !== 'body').join('.')
          : '';
        const msg = e.msg || e.message || e.type || JSON.stringify(e);
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join(' · ');
  }
  if (typeof d === 'object') {
    if (d.msg) return d.msg;
    try {
      return JSON.stringify(d);
    } catch {
      return String(d);
    }
  }
  return String(d);
};

/** Fetch wrapper with JSON serialization + structured error.
 *  Dispatches `mantis:source-evicted` on 410 Gone (R-0009 contract).
 */
export const apiFetch = async (path, init = {}) => {
  const url = `${API_BASE}${path}`;
  const opts = { ...init };
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    opts.body = JSON.stringify(opts.body);
  }
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response (image / health plain text) — leave data null.
  }
  if (!r.ok) {
    const rawDetail = data?.detail ?? data?.message ?? text ?? `${r.status}`;
    const detail = formatApiDetail(rawDetail);
    const err = new Error(`${path} → ${r.status}: ${detail}`);
    err.status = r.status;
    err.detail = detail;
    err.rawDetail = rawDetail;
    if (r.status === 410 && typeof window !== 'undefined') {
      try {
        const sidMatch = path.match(/\/api\/sources\/([a-z0-9]+)/i);
        window.dispatchEvent(
          new CustomEvent('mantis:source-evicted', {
            detail: { path, source_id: sidMatch ? sidMatch[1] : null, detail },
          }),
        );
      } catch {
        // non-DOM env
      }
    }
    throw err;
  }
  return data;
};

export const apiUpload = async (path, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return apiFetch(path, { method: 'POST', body: fd });
};

/** Build the channel-thumbnail PNG URL. Supports the same ISP + display
 *  query-string parameters as the shared.jsx original; fields absent from
 *  `isp` are omitted (server applies defaults).
 */
export const channelPngUrl = (
  sourceId,
  channel,
  maxDim = 1600,
  isp = null,
  colormap = 'gray',
  vmin = null,
  vmax = null,
  rgbComposite = false,
) => {
  const q = new URLSearchParams({ max_dim: String(maxDim) });
  if (colormap && colormap !== 'gray') q.set('colormap', colormap);
  if (isp) {
    if (isp.sharpen_method) q.set('sharpen_method', isp.sharpen_method);
    if (isp.sharpen_amount != null) q.set('sharpen_amount', String(isp.sharpen_amount));
    if (isp.sharpen_radius != null) q.set('sharpen_radius', String(isp.sharpen_radius));
    if (isp.denoise_sigma) q.set('denoise_sigma', String(isp.denoise_sigma));
    if (isp.black_level) q.set('black_level', String(isp.black_level));
    if (isp.median_size) q.set('median_size', String(isp.median_size));
    if (isp.gaussian_sigma != null)
      q.set('gaussian_sigma', String(isp.gaussian_sigma));
    if (isp.bilateral_sigma_space != null)
      q.set('bilateral_sigma_space', String(isp.bilateral_sigma_space));
    if (isp.bilateral_sigma_color != null)
      q.set('bilateral_sigma_color', String(isp.bilateral_sigma_color));
    if (isp.hot_pixel_sigma != null)
      q.set('hot_pixel_sigma', String(isp.hot_pixel_sigma));
    if (isp.brightness != null) q.set('brightness', String(isp.brightness));
    if (isp.contrast != null) q.set('contrast', String(isp.contrast));
    if (isp.gamma != null) q.set('gamma', String(isp.gamma));
  }
  if (vmin != null) q.set('vmin', String(vmin));
  if (vmax != null) q.set('vmax', String(vmax));
  if (rgbComposite) q.set('rgb_composite', 'true');
  return `${API_BASE}/api/sources/${sourceId}/channel/${encodeURIComponent(channel)}/thumbnail.png?${q.toString()}`;
};

// ---------------------------------------------------------------------------
// Source context (from shared.jsx:1631-1633)
// ---------------------------------------------------------------------------

export const SourceCtx = createContext(null);
export const useSource = () => useContext(SourceCtx);
