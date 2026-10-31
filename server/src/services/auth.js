'use strict';
/**
 * Optional operator login for the dashboard and its API.
 *
 *   ACCESS_PIN      operator PIN/password; empty = no login (LAN demo mode)
 *   SESSION_SECRET  HMAC key for session cookies (generated and kept in data/session.key if unset)
 *   SESSION_DAYS    session lifetime (default 30)
 *   PANEL_KEY       shared key the OLED base station sends as X-Panel-Key to perform actions
 *
 * Sessions are stateless signed cookies (HttpOnly, SameSite=Lax, Secure over HTTPS).
 * Always reachable without a session: sensor uplink (/api/ingest, /api/telemetry — guarded by
 * NODE_API_KEY), the base station's read-only summary, /healthz, and the PWA shell assets
 * (manifest, icons, service worker) so the app can still be installed.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const PIN = (process.env.ACCESS_PIN || '').trim();
const PANEL_KEY = (process.env.PANEL_KEY || '').trim();
const DAYS = Math.max(1, Number(process.env.SESSION_DAYS) || 30);
const COOKIE = 'cc_session';
const enabled = Boolean(PIN);

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const p = path.join(config.DATA_DIR, 'session.key');
  try { return fs.readFileSync(p, 'utf8').trim(); } catch { /* create below */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(p, s, { mode: 0o600 }); } catch { /* in-memory only */ }
  return s;
}
const SECRET = enabled ? loadSecret() : '';

const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
function makeToken() { const exp = String(Date.now() + DAYS * 86400e3); return `${exp}.${sign(exp)}`; }
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function validToken(tok) {
  if (!tok) return false;
  const [exp, mac] = String(tok).split('.');
  return Boolean(exp && mac && safeEqual(mac, sign(exp)) && Number(exp) > Date.now());
}
function cookieFrom(header) {
  const m = /(?:^|;\s*)cc_session=([^;]+)/.exec(header || '');
  return m ? decodeURIComponent(m[1]) : null;
}
const isPanel = (req) => Boolean(PANEL_KEY) && safeEqual(req.get('X-Panel-Key') || '', PANEL_KEY);

const PUBLIC = [/^\/login$/, /^\/logout$/, /^\/healthz$/, /^\/api\/ingest/, /^\/api\/telemetry/, /^\/api\/basestation$/,
  /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/icons\//, /^\/favicon/, /^\/apple-touch-icon/];

/** Express middleware: require a session (or a valid panel key) for everything else. */
function guard(req, res, next) {
  if (!enabled) return next();
  if (PUBLIC.some(r => r.test(req.path))) return next();
  if (validToken(cookieFrom(req.headers.cookie)) || isPanel(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'login required' });
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || '/')}`);
}

/** WebSocket upgrade check. */
function verifyUpgrade(req) { return !enabled || validToken(cookieFrom(req.headers.cookie)); }

function setCookie(req, res) {
  const secure = req.secure || req.get('X-Forwarded-Proto') === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`);
}

const page = (msg, next) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b1017">
<title>Sign in · Cyber Chaukidaar</title><link rel="manifest" href="/manifest.webmanifest">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1017;color:#e5e7eb;
font:15px/1.5 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:16px}
.card{width:100%;max-width:360px;background:#111821;border:1px solid #243142;border-radius:16px;padding:28px}
h1{font-size:18px;margin:0 0 4px}p{color:#8b97a8;margin:0 0 20px;font-size:13px}
label{font-size:12px;color:#8b97a8}input{width:100%;margin:6px 0 16px;padding:12px 14px;border-radius:10px;border:1px solid #243142;
background:#162030;color:#fff;font-size:16px;letter-spacing:.2em}input:focus{outline:2px solid #38bdf8;border-color:transparent}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#3b82f6;color:#fff;font-weight:600;font-size:15px;cursor:pointer}
.err{color:#ef4444;font-size:13px;margin:-8px 0 12px}.brand{display:flex;gap:10px;align-items:center;margin-bottom:18px}
.dot{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.15)}
</style></head><body><form class="card" method="post" action="/login">
<div class="brand"><span class="dot"></span><strong>Cyber Chaukidaar</strong></div>
<h1>Operator sign-in</h1><p>Enter the site access PIN to open the command center.</p>
${msg ? `<div class="err">${msg}</div>` : ''}
<label for="pin">Access PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${String(next || '/').replace(/[<>"']/g, '')}"><button type="submit">Sign in</button></form></body></html>`;

/** Mount /login and /logout. */
function routes(app, rateLimit) {
  if (!enabled) return;
  const express = require('express');
  app.get('/login', (req, res) => res.type('html').send(page('', req.query.next)));
  app.post('/login', rateLimit({ max: 8, windowMs: 60000, name: 'sign-in' }), express.urlencoded({ extended: false }), (req, res) => {
    const next = typeof req.body.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//') ? req.body.next : '/';
    if (!safeEqual(req.body.pin || '', PIN)) return res.status(401).type('html').send(page('Incorrect PIN.', next));
    setCookie(req, res);
    res.redirect(next);
  });
  app.get('/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`); res.redirect('/login'); });
}

function status() { return { enabled, panelKey: Boolean(PANEL_KEY), sessionDays: DAYS }; }

module.exports = { guard, verifyUpgrade, routes, status };
