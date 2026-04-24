// bundler-migration-v1 Phase 3 — Vite entry mounting the real App.
//
// Phase 2 was a validation shell (parallel shared-esm.js + live API
// round-trip). Phase 3 (this file) cuts over to the full app: imports
// <App /> from ./app.jsx (which pulls in every mode + shared primitive
// via ES modules), mounts it at #root, done. The CDN + Babel-standalone
// path in web/index.html is deleted in this cutover.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
