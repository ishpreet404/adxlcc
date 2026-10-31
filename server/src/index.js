'use strict';
/**
 * Cyber Chaukidaar — central server (runs on the Raspberry Pi, or any machine).
 *
 *   node uplink  →  ML + fusion + localisation  →  alerts  →  dashboards (WebSocket)
 *   plus the unchanged OSINT breach checker at POST /api/breach-check.
 */
// server/.env (Node >= 20.12 has loadEnvFile; older Node gets a tiny parser)
try {
  const envPath = require('path').join(__dirname, '..', '.env');
  if (process.loadEnvFile) process.loadEnvFile(envPath);
  else {
    for (const line of require('fs').readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch { /* no .env */ }

const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

const config = require('./config');
const realtime = require('./services/realtime');
const registry = require('./services/registry');
const alerts = require('./services/alerts');
const tracks = require('./services/tracks');
const events = require('./services/events');
const store = require('./services/store');
const pipeline = require('./services/pipeline');
const { Simulator } = require('./services/simulator');
const arming = require('./services/arming');
const activity = require('./services/activity');
const notify = require('./services/notify');
const sponsors = require('./services/sponsors');
const profiles = require('./services/profiles');
const discovery = require('./services/discovery');
const auth = require('./services/auth');
const { rateLimit } = require('./services/ratelimit');

const app = express();
const server = http.createServer(app);
const simulator = new Simulator(pipeline);

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Node-Key', 'X-Transport', 'X-Panel-Key', 'X-Panel-Fw'] }));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (!req.url.startsWith('/api/ingest') && !req.url.startsWith('/api/telemetry') && !req.url.includes('/health')) {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

// baseline security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

// liveness for monitors / orchestrators (no session needed, no internals)
app.get('/healthz', (req, res) => res.json({ ok: true, uptimeS: Math.round(process.uptime()) }));
// Public CA certificate (never the key) so a phone can trust the local HTTPS cert: open http://<ip>:8787/ca.crt
app.get('/ca.crt', (req, res) => {
  const ca = process.env.HTTPS_CERT && path.join(path.dirname(process.env.HTTPS_CERT), 'ca.crt');
  if (!ca || !fs.existsSync(ca)) return res.status(404).send('HTTPS not configured');
  res.type('application/x-x509-ca-cert').attachment('chaukidaar-ca.crt').sendFile(ca);
});

// optional operator login (ACCESS_PIN); sensor uplink and the panel summary stay reachable
auth.routes(app, rateLimit);
app.use(auth.guard);

app.use('/api', require('./routes/ingest'));
app.use('/api/nodes', require('./routes/nodes'));
app.use('/api/alerts', require('./routes/alerts'));
app.get('/api/events', (req, res) => res.json({ ok: true, events: events.list(Number(req.query.limit) || 200) }));
app.use('/api/system', require('./routes/system')(simulator));
app.use('/api/ai', require('./routes/ai'));     // Gemini: briefing feed, reports, text-to-SQL over TigerData
app.use('/api/tiger', require('./routes/tiger'));   // TigerData analytics (hypertables, continuous aggregates)
app.use('/api/basestation', require('./routes/basestation'));   // compact state for the OLED control panel
app.use('/api', require('./routes/breach'));   // unchanged: POST /api/breach-check

app.get('/api', (req, res) => res.json({
  name: 'Cyber Chaukidaar Central Server', version: '2.0.0',
  endpoints: ['/api/ingest', '/api/nodes', '/api/nodes/:id/command', '/api/alerts', '/api/alerts/events', '/api/system/health', '/api/system/sim/*', '/api/system/record', '/api/ai/ask', '/api/ai/status', '/api/ai/feed', '/api/ai/brief', '/api/tiger/stats', '/api/tiger/activity', '/api/tiger/alerts-timeline', '/api/system/profile', '/api/basestation', '/api/breach-check', 'ws://host/ws']
}));

// serve the built dashboard when present (single-process deployment on the Pi)
if (fs.existsSync(path.join(config.DASHBOARD_DIST, 'index.html'))) {
  app.use(express.static(config.DASHBOARD_DIST));
  app.get(/^\/(?!api|ws).*/, (req, res) => res.sendFile(path.join(config.DASHBOARD_DIST, 'index.html')));
  console.log('[web] serving dashboard from', config.DASHBOARD_DIST);
} else {
  app.get('/', (req, res) => res.redirect('/api'));
}

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'malformed JSON' });
  console.error('[http] error', err);
  res.status(500).json({ ok: false, error: 'internal error' });
});

realtime.onHello = () => ({
  ...registry.snapshot(),
  alerts: alerts.active(),
  tracks: tracks.list(),
  events: events.list(50),
  sim: simulator.status(),
  arming: arming.status(),
  activity: activity.summary(),
  notify: notify.status(),
  thresholds: { alert: config.ALERT_THRESHOLD, critical: config.CRITICAL_THRESHOLD, loiterS: config.LOITER_SECONDS },
  profile: profiles.get(), profiles: profiles.list(),
  serverTime: Date.now()
});
notify.onChange = (status) => realtime.broadcast('notify', status);
realtime.init(server, { verify: auth.verifyUpgrade });

// Optional HTTPS listener (needed for the installable app / service worker on phones).
// HTTPS_CERT / HTTPS_KEY = PEM files, e.g. from scripts/make-cert.sh. Nodes keep using plain HTTP.
let httpsServer = null;
if (process.env.HTTPS_CERT && process.env.HTTPS_KEY) {
  try {
    httpsServer = require('https').createServer({ cert: fs.readFileSync(process.env.HTTPS_CERT), key: fs.readFileSync(process.env.HTTPS_KEY) }, app);
    realtime.init(httpsServer);
    const hp = Number(process.env.HTTPS_PORT) || 8443;
    httpsServer.listen(hp, config.HOST, () => console.log(`[https] dashboard also on https://${config.HOST}:${hp}`));
  } catch (err) { console.warn('[https] disabled:', err.message); }
}

server.listen(config.PORT, config.HOST, () => {
  console.log('==========================================================');
  console.log(`  CYBER CHAUKIDAAR SERVER v2  http://${config.HOST}:${config.PORT}`);
  console.log(`  uplink: POST /api/ingest     dashboards: ws://.../ws`);
  console.log(`  operator login: ${auth.status().enabled ? 'ON (ACCESS_PIN)' : 'off (set ACCESS_PIN to require a PIN)'}`);
  console.log(`  site: ${registry.site.width}×${registry.site.height} m, ${registry.list().length} node(s) configured`);
  console.log('==========================================================');
  discovery.start();
  if (config.SIM_NODES > 0) simulator.start(config.SIM_NODES, config.SIM_SCENARIO);
  events.log('SERVER_STARTED', `Server v2 up on port ${config.PORT}`);
  sponsors.init().catch(err => console.warn('[sponsors] init failed:', err.message));
});

function shutdown() {
  console.log('\n[server] shutting down');
  simulator.stop();
  discovery.stop();
  store.flushSync();
  require('./services/timeseries').close().catch(() => {});
  if (httpsServer) httpsServer.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
