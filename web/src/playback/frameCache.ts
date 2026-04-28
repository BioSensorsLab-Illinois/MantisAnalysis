// @ts-nocheck
// playback/frameCache — extracted from web/src/playback.tsx in B-0037.
//
// The module-level frame blob cache (URL → ObjectURL), prefetch
// concurrency semaphore, in-flight dedup set, and rolling blob-size
// EWMA. Pure module state — no React. Consumers in playback.tsx
// import the public functions; nothing is exposed via window.
//
// Why this is a separate file:
//   * The cache is shared singleton state. Consolidating it here
//     keeps the read/write surface in one place so a future bug in
//     cache eviction has a single owner.
//   * playback.tsx is 13k lines and growing; B-0037 splits the
//     module-mutable parts first because they're easiest to extract
//     (no React, no JSX, well-defined boundary).
//   * The frameCache is the ONLY module-level mutable state that
//     mattered to the polish-sweep audit (split-brain risk on ISP
//     reconfigure if cache writes raced the purge).
//
// Public surface (re-exported from playback.tsx via direct import):
//   * setFrameCacheBudgetMB / getFrameCacheBudgetMB — the user-tunable
//     RAM budget (MB) for cached frames.
//   * AVG_BLOB_KB_ESTIMATE / DEFAULT_CACHE_BUDGET_MB — read-only
//     constants the cache-status panel displays.
//   * frameCacheMaxEntries / frameCachePrefetchWindow — derived caps
//     used by the warmer effect.
//   * frameCacheGet / frameCachePut / frameCachePurgeForSource — LRU
//     access primitives.
//   * frameCacheHas — used by the warmer to skip already-cached URLs.
//   * prefetchFrame — fire-and-forget warmer call.
//   * isPrefetchInflight — lets the warmer dedupe at queue-walk time.
//
// File-level @ts-nocheck preserved to match the rest of the
// playback subtree until B-0038 walks every Play file off the
// pragma. Internal helpers ARE typed where it costs nothing.

const AVG_BLOB_KB_INITIAL = 400;
let _AVG_BLOB_KB_ESTIMATE = AVG_BLOB_KB_INITIAL;
const BLOB_SIZE_EWMA_ALPHA = 0.1;

const recordBlobSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  const kb = bytes / 1024;
  // Floor at 32 KB so a stream of black frames doesn't drive the
  // estimate to zero (which would explode the entry-count cap).
  const safe = Math.max(32, kb);
  _AVG_BLOB_KB_ESTIMATE =
    (1 - BLOB_SIZE_EWMA_ALPHA) * _AVG_BLOB_KB_ESTIMATE + BLOB_SIZE_EWMA_ALPHA * safe;
};

export const DEFAULT_CACHE_BUDGET_MB = 1024;
let _frameCacheBudgetMB = DEFAULT_CACHE_BUDGET_MB;

export const setFrameCacheBudgetMB = (mb) => {
  const clamped = Math.max(8, Math.min(8192, Math.round(Number(mb) || DEFAULT_CACHE_BUDGET_MB)));
  _frameCacheBudgetMB = clamped;
  trim();
};
export const getFrameCacheBudgetMB = () => _frameCacheBudgetMB;
export const getAvgBlobKbEstimate = () => _AVG_BLOB_KB_ESTIMATE;

export const frameCacheMaxEntries = () =>
  Math.max(8, Math.floor((_frameCacheBudgetMB * 1024) / _AVG_BLOB_KB_ESTIMATE));

const PREFETCH_WINDOW_HARD_CAP = 32;
export const frameCachePrefetchWindow = (viewCount) => {
  const cap = frameCacheMaxEntries();
  const denom = Math.max(1, viewCount | 0);
  const budgetDerived = Math.floor(cap / 2 / denom);
  return Math.max(4, Math.min(PREFETCH_WINDOW_HARD_CAP, budgetDerived));
};

// Concurrency semaphore — see playback.tsx header comment for why a
// strict cap-and-drop policy beats queueing.
const MAX_CONCURRENT_PREFETCHES = 6;
const _prefetchInflight = new Set();
let _prefetchActive = 0;

export const isPrefetchInflight = (url) => _prefetchInflight.has(url);

const _frameBlobCache = new Map(); // url → objectURL (insertion order = recency)

export const frameCacheHas = (url) => _frameBlobCache.has(url);

// Read-only count for the cache-status status bar. Returns the live
// Map size; do NOT use this for trim decisions (those go via
// frameCacheMaxEntries which folds in the rolling EWMA).
export const frameCacheCurrentSize = () => _frameBlobCache.size;

export const frameCacheGet = (url) => {
  const v = _frameBlobCache.get(url);
  if (v != null) {
    // Bump recency
    _frameBlobCache.delete(url);
    _frameBlobCache.set(url, v);
  }
  return v;
};

const trim = () => {
  const cap = frameCacheMaxEntries();
  while (_frameBlobCache.size > cap) {
    const oldestKey = _frameBlobCache.keys().next().value;
    const oldestVal = _frameBlobCache.get(oldestKey);
    _frameBlobCache.delete(oldestKey);
    if (oldestVal) URL.revokeObjectURL(oldestVal);
  }
};

export const frameCachePut = (url, objUrl, byteSize) => {
  if (_frameBlobCache.has(url)) {
    _frameBlobCache.delete(url);
  }
  _frameBlobCache.set(url, objUrl);
  if (Number.isFinite(byteSize) && byteSize > 0) {
    recordBlobSize(byteSize);
  }
  trim();
};

export const frameCachePurgeForSource = (sourceId) => {
  if (!sourceId) return 0;
  const needle = `/api/sources/${sourceId}/`;
  const dropped = [];
  for (const [k, v] of _frameBlobCache) {
    if (k.includes(needle)) dropped.push([k, v]);
  }
  for (const [k, v] of dropped) {
    _frameBlobCache.delete(k);
    if (v) URL.revokeObjectURL(v);
  }
  return dropped.length;
};

// Cache-busy telemetry. Every fetch (visible per-view fetch + invisible
// prefetch) bumps the counter on start and decrements on resolve/reject;
// a running peak feeds a progress-bar percentage so the user sees
// forward motion even when the queue is large. Subscribers listen for
// the `mantis:play:cache-busy` window event.
let _inflightFrameFetches = 0;
let _completedSinceQuiet = 0;
let _peakSinceQuiet = 0;

const emitCacheBusy = () => {
  if (typeof window === 'undefined') return;
  if (_inflightFrameFetches === 0) {
    window.dispatchEvent(
      new CustomEvent('mantis:play:cache-busy', {
        detail: { inflight: 0, peak: _peakSinceQuiet, completed: _completedSinceQuiet },
      })
    );
    _completedSinceQuiet = 0;
    _peakSinceQuiet = 0;
    return;
  }
  if (_inflightFrameFetches > _peakSinceQuiet) _peakSinceQuiet = _inflightFrameFetches;
  window.dispatchEvent(
    new CustomEvent('mantis:play:cache-busy', {
      detail: {
        inflight: _inflightFrameFetches,
        peak: _peakSinceQuiet,
        completed: _completedSinceQuiet,
      },
    })
  );
};

export const trackFetchStart = () => {
  _inflightFrameFetches += 1;
  emitCacheBusy();
};
export const trackFetchEnd = () => {
  if (_inflightFrameFetches > 0) _inflightFrameFetches -= 1;
  _completedSinceQuiet += 1;
  emitCacheBusy();
};

// Fire-and-forget prefetch. Three guards protect against the per-tick
// re-fetch storm:
//   1. cached → no-op (already have the blob)
//   2. already in flight → no-op
//   3. semaphore at limit → DROP, do not queue (queueing builds an
//      ever-growing backlog at high lookahead × FPS that will saturate
//      the server long after the user has scrubbed past those frames).
export const prefetchFrame = async (url) => {
  if (!url) return;
  if (_frameBlobCache.has(url)) return;
  if (_prefetchInflight.has(url)) return;
  if (_prefetchActive >= MAX_CONCURRENT_PREFETCHES) return;
  _prefetchInflight.add(url);
  _prefetchActive += 1;
  trackFetchStart();
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const blob = await r.blob();
    if (_frameBlobCache.has(url)) return;
    const objUrl = URL.createObjectURL(blob);
    frameCachePut(url, objUrl, blob?.size);
  } catch {
    /* prefetch failures are silent */
  } finally {
    _prefetchActive = Math.max(0, _prefetchActive - 1);
    _prefetchInflight.delete(url);
    trackFetchEnd();
  }
};
