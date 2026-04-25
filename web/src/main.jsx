// Vite entry — mounts <App />.
//
// Real npm-package React + ES-module imports throughout (post
// bundler-migration-v1 Phase 3). The CDN + Babel-standalone path is
// gone; web/index.html loads this single module entry, which in turn
// pulls in app.jsx + every mode file + shared primitives via ES
// imports.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('main.jsx: #root not found in index.html');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
