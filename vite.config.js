// vite.config.js — bundler-migration-v1 Phase 1.
//
// Vite-driven build for the MantisAnalysis React frontend. During
// dev, serves on :5173 with HMR and proxies /api/* to the Python
// FastAPI server on :8765. Production output goes to web/dist/,
// which FastAPI will mount post-Phase 3.
//
// The existing CDN + Babel-standalone path at web/index.html stays
// intact through Phase 2 so both rendering paths work. This Vite
// entry loads `web/src/main.jsx`, which is minimal until Phase 2
// migrates `shared.jsx` to ES modules.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'web'),
  publicDir: false,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: false,
      },
    },
  },
  build: {
    // Emit into `web/dist/` at the repo root so FastAPI can mount
    // it with WEB_DIR overrides (Phase 3).
    outDir: resolve(import.meta.dirname, 'web/dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
    rollupOptions: {
      // Vite auto-detects web/index.html as the entry. Keep default
      // unless we need multiple entries (Storybook comes with its
      // own build in Phase 7).
      input: resolve(import.meta.dirname, 'web/index-vite.html'),
    },
  },
});
