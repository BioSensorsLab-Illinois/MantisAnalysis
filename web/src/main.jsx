// bundler-migration-v1 Phase 2 — Vite entry with live API calls.
//
// Proves the ES-module toolchain works end-to-end: imports React
// + the parallel `shared-esm.js` primitives, calls the FastAPI
// server via the Vite dev-proxy (`/api/*` → :8765) or the live
// FastAPI origin when served from the built `web/dist/`, and
// renders a real "connected" status panel with the health check
// result and the current source summary.
//
// This is still a parallel shell — the CDN path at
// `web/index.html` remains the production surface until Phase 3
// cuts over. The Vite path's purpose this phase is to validate
// the ES-module + HMR + proxy + API round-trip path with real
// data, not to replace the app.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BRAND,
  apiFetch,
  useViewport,
  useLocalStorageState,
} from './shared-esm.js';

function PhaseTwoShell() {
  const { w, bucket } = useViewport();
  const [visits, setVisits] = useLocalStorageState('bundler-migration-v1/visits', 0);
  const [health, setHealth] = useState(null);
  const [source, setSource] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setVisits((n) => n + 1);
    let cancelled = false;
    (async () => {
      try {
        const h = await apiFetch('/api/health');
        if (cancelled) return;
        setHealth(h);
      } catch (e) {
        if (!cancelled) setErr(`/api/health failed: ${e.detail || e.message}`);
      }
      try {
        const list = await apiFetch('/api/sources');
        if (cancelled) return;
        if (list && list.length) {
          setSource(list[0]);
        } else {
          const s = await apiFetch('/api/sources/load-sample', { method: 'POST' });
          if (!cancelled) setSource(s);
        }
      } catch (e) {
        if (!cancelled) setErr((prev) => prev || `/api/sources failed: ${e.detail || e.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        padding: '3rem 2rem',
        maxWidth: '52rem',
        margin: '0 auto',
        lineHeight: 1.55,
        color: '#e6e8eb',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.65rem', margin: 0 }}>
          {BRAND.name}{' '}
          <span style={{ color: '#6bcb3a', fontWeight: 500 }}>· Vite</span>
        </h1>
        <span style={{ color: '#8a93a0', fontSize: '0.875rem' }}>
          {BRAND.customer} · v{BRAND.version}
        </span>
      </header>
      <p style={{ color: '#c6cbd1', marginTop: '0.5rem', fontSize: '0.95rem' }}>
        <code>bundler-migration-v1</code> Phase 2. The Vite-served
        shell now makes real API calls against the Python FastAPI
        server, proving the ES-module pipeline + dev proxy + live
        round-trip all work. The production UI still ships from{' '}
        <code>web/index.html</code> (CDN + Babel-standalone) until
        Phase 3 cuts over.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem', color: '#c6cbd1' }}>
          Server health
        </h2>
        {health ? (
          <pre
            style={{
              margin: 0,
              padding: '0.75rem 1rem',
              background: 'rgba(107, 203, 58, 0.08)',
              border: '1px solid rgba(107, 203, 58, 0.25)',
              borderRadius: 6,
              fontSize: '0.8rem',
              fontFamily: 'ui-monospace, Menlo, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
{JSON.stringify(health, null, 2)}
          </pre>
        ) : err ? (
          <p style={{ color: '#ff6b6b', fontSize: '0.9rem' }}>{err}</p>
        ) : (
          <p style={{ color: '#8a93a0', fontSize: '0.9rem' }}>Connecting…</p>
        )}
      </section>

      {source && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem', color: '#c6cbd1' }}>
            Active source
          </h2>
          <pre
            style={{
              margin: 0,
              padding: '0.75rem 1rem',
              background: 'rgba(110, 170, 255, 0.08)',
              border: '1px solid rgba(110, 170, 255, 0.25)',
              borderRadius: 6,
              fontSize: '0.8rem',
              fontFamily: 'ui-monospace, Menlo, monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
{JSON.stringify(
  {
    source_id: source.source_id,
    name: source.name,
    kind: source.kind,
    channels: source.channels?.length,
    shape: source.shape,
    isp_mode_id: source.isp_mode_id,
  },
  null,
  2,
)}
          </pre>
        </section>
      )}

      <footer
        style={{
          marginTop: '3rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid #2a2f37',
          color: '#8a93a0',
          fontSize: '0.75rem',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <span>
          viewport <code>{w}px · {bucket}</code> · visit #{visits}
        </span>
        <span>
          Vite v5.4 · React 18.3 · {BRAND.authorAffiliation}
        </span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PhaseTwoShell />
  </StrictMode>,
);
