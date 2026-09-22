'use strict';
/**
 * Cyber Chaukidaar — central server (runs on the Raspberry Pi, or any machine).
 *
 *   node uplink  →  ML + fusion + localisation  →  alerts  →  dashboards (WebSocket)
 *   plus the unchanged OSINT breach checker at POST /api/breach-check.
 */
try { if (process.loadEnvFile) process.loadEnvFile(); } catch { /* no .env */ }

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

const app = express();
const server = http.createServer(app);
const simulator = new Simulator(pipeline);

app.disable('x-powered-by');
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Node-Key', 'X-Transport'] }));
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  if (!req.url.startsWith('/api/ingest') && !req.url.startsWith('/api/telemetry') && !req.url.includes('/health')) {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

app.use('/api', require('./routes/ingest'));
app.use('/api/nodes', require('./routes/nodes'));
app.use('/api/alerts', require('./routes/alerts'));
app.get('/api/events', (req, res) => res.json({ ok: true, events: events.list(Number(req.query.limit) || 200) }));
app.use('/api/system', require('./routes/system')(simulator));
app.use('/api', require('./routes/breach'));   // unchanged: POST /api/breach-check

app.get('/api', (req, res) => res.json({
  name: 'Cyber Chaukidaar Central Server', version: '2.0.0',
  endpoints: ['/api/ingest', '/api/nodes', '/api/nodes/:id/command', '/api/alerts', '/api/alerts/events', '/api/system/health', '/api/system/sim/*', '/api/system/record', '/api/breach-check', 'ws://host/ws']
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
  serverTime: Date.now()
});
realtime.init(server);

server.listen(config.PORT, config.HOST, () => {
  console.log('==========================================================');
  console.log(`  CYBER CHAUKIDAAR SERVER v2  http://${config.HOST}:${config.PORT}`);
  console.log(`  uplink: POST /api/ingest     dashboards: ws://.../ws`);
  console.log(`  site: ${registry.site.width}×${registry.site.height} m, ${registry.list().length} node(s) configured`);
  console.log('==========================================================');
  if (config.SIM_NODES > 0) simulator.start(config.SIM_NODES, config.SIM_SCENARIO);
  events.log('SERVER_STARTED', `Server v2 up on port ${config.PORT}`);
});

function shutdown() {
  console.log('\n[server] shutting down');
  simulator.stop();
  store.flushSync();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
