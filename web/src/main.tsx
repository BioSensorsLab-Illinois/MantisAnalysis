// Vite entry — mounts <App />.
//
// bundler-migration-v1 Phase 5 seed migration: first TypeScript file in
// the tree. `tsconfig.json` has `allowJs: true` so every other .jsx
// continues to compile unchanged; this file proves the TS pipeline
// (tsc --noEmit + eslint typescript-eslint + Vite esbuild) works
// end-to-end. `app.jsx` export is consumed here as `default` —
// TypeScript accepts the implicit `any` because `checkJs: false` means
// we don't type-check the .jsx tree.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('main.tsx: #root not found in index.html');
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
