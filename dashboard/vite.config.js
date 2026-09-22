import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies /api and /ws to the central server so the dashboard can be
// served from a laptop while the server runs on the Raspberry Pi (set VITE_PROXY_TARGET).
const target = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
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
