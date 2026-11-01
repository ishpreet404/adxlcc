'use strict';
/**
 * Browser demo backend: the real server modules (pipeline, fusion, missions, alerts, simulator)
 * running inside the page. Wired like server/src/index.js, minus HTTP, auth and persistence.
 * Bundled by build.mjs into src/demo/server.gen.js; api.js and socket.js use it when VITE_DEMO=1.
 */
const config = require('../../server/src/config');
const realtime = require('../../server/src/services/realtime');
const registry = require('../../server/src/services/registry');
const alerts = require('../../server/src/services/alerts');
const tracks = require('../../server/src/services/tracks');
const events = require('../../server/src/services/events');
const pipeline = require('../../server/src/services/pipeline');
const { Simulator } = require('../../server/src/services/simulator');
const arming = require('../../server/src/services/arming');
const activity = require('../../server/src/services/activity');
const notify = require('../../server/src/services/notify');
const sponsors = require('../../server/src/services/sponsors');
const profiles = require('../../server/src/services/profiles');
const express = require('express');

const simulator = new Simulator(pipeline);
const app = express();
app.use('/api', require('../../server/src/routes/ingest'));
app.use('/api/nodes', require('../../server/src/routes/nodes'));
app.use('/api/alerts', require('../../server/src/routes/alerts'));
app.get('/api/events', (req, res) => res.json({ ok: true, events: events.list(Number(req.query.limit) || 200) }));
app.use('/api/system', require('../../server/src/routes/system')(simulator));
app.use('/api/ai', require('../../server/src/routes/ai'));
app.use('/api/tiger', require('../../server/src/routes/tiger'));

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

/** Run one API call through the routers. Resolves to { status, data }. */
function handle(method, url, body) {
  const u = new URL(url, 'http://demo');
  const hit = app.find(method, u.pathname);
  if (!hit) return Promise.resolve({ status: 404, data: { ok: false, error: 'not available in the online demo' } });
  return new Promise((resolve) => {
    let status = 200, done = false;
    const finish = (data) => { if (!done) { done = true; resolve({ status, data }); } };
    const headers = { 'content-type': 'application/json' };
    const req = {
      method, url: u.pathname + u.search, originalUrl: u.pathname + u.search, path: u.pathname,
      params: hit.params, query: Object.fromEntries(u.searchParams), body: body || {},
      headers, ip: '127.0.0.1', secure: true, socket: { remoteAddress: '127.0.0.1' }, get: (h) => headers[h.toLowerCase()]
    };
    const res = {
      status(c) { status = c; return res; },
      json: finish, send: finish, end: () => finish(null),
      set() { return res; }, setHeader() { return res; }, type() { return res; },
      redirect() { finish({ ok: false, error: 'redirect' }); }
    };
    let i = 0;
    const next = (err) => {
      if (err) { status = 500; return finish({ ok: false, error: String(err.message || err) }); }
      const fn = hit.fns[i++];
      if (!fn) return finish({ ok: false, error: 'no response' });
      try {
        const p = fn(req, res, next);
        if (p && p.catch) p.catch(next);
      } catch (e) { next(e); }
    };
    next();
  });
}

/** Attach a dashboard: receives the hello snapshot and every broadcast. Returns a detach fn. */
function connect(onMessage) {
  const client = { readyState: 1, isAlive: true, send: (msg) => setTimeout(() => onMessage(msg), 0), ping() {}, terminate() {} };
  realtime.clients.add(client);
  setTimeout(() => onMessage(JSON.stringify({ type: 'hello', data: realtime.onHello(), ts: Date.now() })), 0);
  return () => realtime.clients.delete(client);
}

let started = false;
function start() {
  if (started) return;
  started = true;
  simulator.start(Number(process.env.SIM_NODES) || 3, process.env.SIM_SCENARIO || 'patrol');
  events.log('SERVER_STARTED', 'Online demo: server pipeline running in your browser with simulated nodes');
  sponsors.init().catch(() => {});
}

module.exports = { handle, connect, start };
