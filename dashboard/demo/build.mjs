// Bundles the server pipeline for the browser demo → src/demo/server.gen.js
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(here, 'shims', f);
const empty = shim('empty.js');

await build({
  entryPoints: [path.join(here, 'entry.js')],
  outfile: path.join(here, '..', 'src', 'demo', 'server.gen.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true, legalComments: 'none',
  alias: {
    express: shim('express.js'), fs: shim('fs.js'), path: shim('path.js'), crypto: shim('crypto.js'), ws: shim('ws.js'),
    os: empty, http: empty, https: empty, dgram: empty, child_process: empty, cors: empty, pg: empty, '@google/genai': empty
  },
  define: { __dirname: '"/srv/server/src/services"' },
  // Node globals the server touches; timers gain unref() like Node's.
  banner: { js: `
var process = { env: { SENSITIVITY: 'ultra', SIM_NODES: '3', SIM_SCENARIO: 'patrol', GEMINI_API_KEY: '', DATABASE_URL: '' },
  version: 'browser', platform: 'browser', uptime: () => performance.now() / 1000, memoryUsage: () => ({ rss: 0, heapUsed: 0 }),
  on() {}, exit() {}, nextTick: (f, ...a) => queueMicrotask(() => f(...a)), hrtime: Object.assign(() => [0, 0], { bigint: () => 0n }) };
var __wrapT = (id) => ({ id, unref() { return this; }, ref() { return this; }, hasRef: () => false, [Symbol.toPrimitive]: () => id });
var setTimeout = (...a) => __wrapT(globalThis.setTimeout(...a));
var setInterval = (...a) => __wrapT(globalThis.setInterval(...a));
var clearTimeout = (t) => globalThis.clearTimeout(t && t.id !== undefined ? t.id : t);
var clearInterval = (t) => globalThis.clearInterval(t && t.id !== undefined ? t.id : t);
var setImmediate = (f, ...a) => setTimeout(f, 0, ...a);
` },
  logLevel: 'warning'
});
console.log('[demo] server bundle written to src/demo/server.gen.js');
