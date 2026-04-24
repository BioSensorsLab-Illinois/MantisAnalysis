// vite.config.js — bundler-migration-v1 Phase 3 (atomic cutover).
//
// Vite-driven build for the MantisAnalysis React frontend. Dev mode
// serves web/index.html on :5173 with HMR and proxies /api/* to the
// FastAPI server on :8765. Production build emits web/dist/, which
// FastAPI serves as the primary SPA bundle.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'web'),
  publicDir: false,
  // FastAPI serves web/dist/ at /, so the built assets live under
  // /assets/... at the origin root. Keep base = '/' for the prod
  // mount and for vite dev alike.
  base: '/',
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
    outDir: resolve(import.meta.dirname, 'web/dist'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2020',
  },
});
