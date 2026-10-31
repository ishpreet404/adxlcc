import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Dev server proxies /api and /ws to the central server so the dashboard can be
// served from a laptop while the server runs on the Raspberry Pi (set VITE_PROXY_TARGET).
const target = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8787';

// API base for the built dashboard. '/' = same origin as the page (the server hosts the dashboard),
// so it works from any laptop/phone that opens http://<pi>:8787. Override with VITE_APP_API_BASE_URL.
const apiBase = process.env.VITE_APP_API_BASE_URL || '/';

/** Stamp a unique cache version into dist/sw.js so each deploy drops the previous caches. */
const stampServiceWorker = () => ({
  name: 'stamp-service-worker',
  apply: 'build',
  closeBundle() {
    const file = resolve(root, 'dist', 'sw.js');
    if (!existsSync(file)) return;
    const version = `v${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
    writeFileSync(file, readFileSync(file, 'utf8').replace(/__SW_VERSION__/g, version));
  }
});

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  define: { 'import.meta.env.VITE_APP_API_BASE_URL': JSON.stringify(apiBase) },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': { target, changeOrigin: true },
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true }
    }
  },
  build: { outDir: 'dist', sourcemap: false }
});
