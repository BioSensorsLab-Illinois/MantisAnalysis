// bundler-migration-v1 Phase 1 — minimal Vite entry.
//
// This file is the Vite toolchain's proof-of-life. It renders a
// placeholder saying "Phase 1 OK" so `npm run dev` and `npm run
// build` have something real to transform and bundle. The existing
// CDN-driven app at web/index.html + web/src/*.jsx (app, shared,
// usaf, fpn, dof, analysis, isp_settings) continues to power the
// production surface; Phases 2–3 of bundler-migration-v1 will
// migrate those files to ES modules and retarget this entry at
// them.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function PhaseOnePlaceholder() {
  const now = new Date().toISOString();
  return (
    <main style={{ padding: '4rem 2rem', maxWidth: '48rem', margin: '0 auto', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: '1.5rem', margin: 0 }}>
        MantisAnalysis · Vite toolchain <span style={{ color: '#6bcb3a' }}>OK</span>
      </h1>
      <p style={{ color: '#9aa0a6' }}>
        <code>bundler-migration-v1</code> Phase 1 infrastructure.
        This page proves the Vite dev server + production bundle
        work end-to-end. Phases 2–3 will migrate the real app
        (<code>web/src/app.jsx</code>, <code>shared.jsx</code>, and
        the four mode files) to ES modules and wire them here.
      </p>
      <p style={{ color: '#9aa0a6', fontSize: '0.875rem' }}>
        The existing CDN-driven app at <code>/</code> (served by
        FastAPI from <code>web/index.html</code>) is untouched and
        remains the production surface until Phase 3 lands.
      </p>
      <p style={{ color: '#9aa0a6', fontSize: '0.75rem', marginTop: '2rem' }}>
        built at <code>{now}</code>
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PhaseOnePlaceholder />
  </StrictMode>,
);
