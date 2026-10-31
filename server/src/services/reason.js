'use strict';
/**
 * Gemini operator brain.
 *
 *   narrate(alert, ctx)    -> { text, source: 'gemini'|'template', model } one plain sentence for a
 *                             guard, written for the active mission profile. Every narration is also
 *                             pushed to the live briefing feed (GET /api/ai/feed, WS type 'ai').
 *   brief({ minutes })     -> situation report over the TigerData history for the last N minutes.
 *   answer(question)       -> natural-language question over TigerData via guarded text-to-SQL
 *                             (single read-only SELECT over allowlisted tables, read-only role).
 *
 * Degrades safely: without GEMINI_API_KEY, on quota exhaustion or a timeout, narrations fall back
 * to a deterministic template built from the structured data and are labelled source:'template'.
 *
 * Env: GEMINI_API_KEY, GEMINI_MODEL (default gemini-flash-lite-latest), GEMINI_TIMEOUT_MS (12000)
 */
const timeseries = require('./timeseries');
const realtime = require('./realtime');
const profiles = require('./profiles');

let GoogleGenAI = null;
try { ({ GoogleGenAI } = require('@google/genai')); } catch { /* sdk absent — template mode */ }

const KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest').trim();
const SUPPORTS_THINKING = !/lite/i.test(MODEL);  // lite models don't think and reject thinkingConfig
const enabled = Boolean(GoogleGenAI && KEY);
const ai = enabled ? new GoogleGenAI({ apiKey: KEY }) : null;

// Tables the text-to-SQL box may touch. Anything else is rejected before execution.
const ALLOWED_TABLES = ['telemetry', 'telemetry_1s', 'alerts'];
const SQL_SCHEMA_HINT = `
Tables (TimescaleDB / PostgreSQL):
  telemetry(time timestamptz, node_id text, node_name text, transport text, mode text, state text,
            rms_a float, rms_b float, radar_dist float, radar_energy float, ml_label text, ml_conf float,
            fusion_level text, probability float, loiter_s int, battery_v float, rssi int, pos_x float, pos_y float)
  alerts(time timestamptz, alert_id text, node_id text, node_name text, severity text, kind text,
         target_class text, probability float, zone text, message text, evidence_hash text, label text, profile text)
  telemetry_1s(bucket timestamptz, node_id text, rms_a float, rms_b float, max_p float, radar_dist float)
fusion_level is one of CLEAR, ACTIVITY, SUSPECT, INTRUSION. ml_label is one of NORMAL, HUMAN, VEHICLE, ENVIRONMENT.
alerts.kind is one of INTRUSION, TAMPER, LOITER, WILDLIFE, SUBSURFACE, DRILLING, IMPACT, VIBRATION.
alerts.label is the mission-specific class (ANIMAL, HUMAN, VEHICLE, SUBSURFACE, DRILLING, IMPACT, VIBRATION, TAMPER).
alerts.severity is one of LOW, MEDIUM, HIGH, CRITICAL. Node ids starting with SIM- are simulated.
Use time_bucket() and now() - interval '...' for time ranges.`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const CALL_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 12000;
const QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
let quotaBlockedUntil = 0;   // after a quota 429, stop calling Gemini for a while and serve fallbacks
let calls = 0, failures = 0, lastError = null;

function isQuota(msg) { return /\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|per day/i.test(msg || ''); }
function isTransient(msg) { return /\b503\b|UNAVAILABLE|high demand/i.test(msg || ''); }

/**
 * Call Gemini with a hard timeout and bounded retry. A quota 429 is NOT retried (it would
 * hang on the SDK's long backoff); instead we open a cooldown and let callers fall back.
 */
async function generate(prompt, { retries = 2 } = {}) {
  if (!enabled) throw new Error('gemini not configured');
  if (Date.now() < quotaBlockedUntil) throw new Error('gemini quota cooldown');
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      calls++;
      const res = await Promise.race([
        // Full 3.x models reason by default (30 s+); disable it for these short prompts.
        // "lite" models don't think and reject that config, so only send it to full models.
        ai.models.generateContent(SUPPORTS_THINKING
          ? { model: MODEL, contents: prompt, config: { thinkingConfig: { thinkingBudget: 0 } } }
          : { model: MODEL, contents: prompt }),
        sleep(CALL_TIMEOUT_MS).then(() => { throw new Error('gemini timeout'); })
      ]);
      return (res.text || '').trim();
    } catch (err) {
      lastErr = err; failures++; lastError = err.message;
      if (isQuota(err.message)) { quotaBlockedUntil = Date.now() + QUOTA_COOLDOWN_MS; throw err; }
      if (!isTransient(err.message) || i === retries) throw err;
      await sleep(400 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// ---- live briefing feed --------------------------------------------------------
const FEED_MAX = 100;
const feed = [];
let feedSeq = 0;

function pushFeed(item) {
  const entry = { id: `AI-${Date.now().toString(36)}-${(++feedSeq).toString(36)}`, t: Date.now(), ...item };
  feed.unshift(entry);
  if (feed.length > FEED_MAX) feed.pop();
  realtime.broadcast('ai', entry);
  return entry;
}
function listFeed(limit = 50) { return feed.slice(0, limit); }

// ---- narration ----------------------------------------------------------------
async function narrate(alert, ctx = {}, opts = {}) {
  const profile = profiles.get();
  const facts = compactFacts(alert, ctx);
  let text = null, source = 'template';
  if (enabled && opts.useGemini !== false) {
    try {
      const prompt = `You are the voice of a security operations center. Mission: ${profile.name}. ${profile.gemini}
Write ONE plain sentence (max 28 words) a guard can act on, describing this detection. The "title", "label" and "evidence" fields are the system's classification: describe exactly that (never call an animal a person, never call a vibration a person). Use digits for numbers, write naturally (never mention field names such as label or title), and end with the recommended action. No preamble, no markdown, no emojis.

${JSON.stringify(facts)}`;
      text = await generate(prompt);
      if (text) source = 'gemini';
    } catch (err) {
      console.warn('[gemini] narrate failed:', err.message);
    }
  }
  if (!text) text = templateNarrative(facts);
  pushFeed({
    alertId: alert.id, nodeId: alert.nodeId, nodeName: alert.nodeName, simulated: Boolean(alert.simulated),
    severity: alert.severity, kind: alert.kind, label: facts.label, title: facts.title, text, source,
    model: source === 'gemini' ? MODEL : null, profile: profile.id
  });
  return { text, source, model: source === 'gemini' ? MODEL : null };
}

/** Back-compat: just the sentence. */
async function narrateAlert(alert, ctx = {}) { return (await narrate(alert, ctx)).text; }

// ---- situation report ---------------------------------------------------------------
let lastBrief = null;

async function brief({ minutes = 60, fallbackAlerts = [] } = {}) {
  minutes = Math.max(5, Math.min(24 * 60, Number(minutes) || 60));
  if (lastBrief && lastBrief.minutes === minutes && Date.now() - lastBrief.generatedAt < 20000) return lastBrief;
  const profile = profiles.get();
  let stats = null;
  try { stats = timeseries.ready ? await timeseries.summary(minutes) : null; } catch (e) { stats = null; }
  if (!stats) {
    // file-store fallback when TigerData is not connected
    const since = Date.now() - minutes * 60000;
    const recent = fallbackAlerts.filter(a => a.createdAt >= since);
    stats = { source: 'memory', minutes, alerts: recent.length, byKind: tally(recent, 'kind'), bySeverity: tally(recent, 'severity'),
      byNode: tally(recent, 'nodeName'), telemetryRows: null, nodes: [] };
  }
  let text = null, source = 'template';
  if (enabled) {
    try {
      text = await generate(`You are writing a short shift report for a security supervisor. Mission: ${profile.name}. ${profile.gemini}
Using ONLY these statistics for the last ${minutes} minutes, write 3 to 5 concise sentences: overall threat picture, the most important events and where, sensor/system health if relevant, and one recommended action. Plain text, no markdown, no bullet points. Treat node ids starting with SIM- as simulated test nodes and say so if they dominate.

${JSON.stringify(stats).slice(0, 6000)}`, { retries: 1 });
      if (text) source = 'gemini';
    } catch (err) { /* fall back below */ }
  }
  if (!text) text = templateBrief(stats, profile, minutes);
  lastBrief = { ok: true, minutes, text, source, model: source === 'gemini' ? MODEL : null, generatedAt: Date.now(), stats, profile: profile.id };
  return lastBrief;
}

function tally(arr, key) {
  const out = {};
  for (const a of arr) { const k = a[key] || 'unknown'; out[k] = (out[k] || 0) + 1; }
  return out;
}

function templateBrief(s, profile, minutes) {
  const kinds = Object.entries(s.byKind || {}).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ');
  return `${profile.name}: ${s.alerts || 0} alert${s.alerts === 1 ? '' : 's'} in the last ${minutes} minutes${kinds ? ` (${kinds})` : ''}. ` +
    (s.telemetryRows != null ? `${s.telemetryRows} sensor readings were stored in TigerData. ` : '') +
    (s.alerts ? 'Review the open alerts on the Alerts page.' : 'No action required.');
}

// ---- text-to-SQL --------------------------------------------------------------------
async function answer(question) {
  if (!timeseries.ready) return { ok: false, error: 'time-series database not connected' };
  if (!enabled) return { ok: false, error: 'Gemini not configured (set GEMINI_API_KEY)' };
  let sql;
  try {
    const prompt = `Translate the question into ONE read-only PostgreSQL SELECT for this schema. Return ONLY the SQL, no markdown fence, no explanation. Always add a LIMIT (<=200).\n${SQL_SCHEMA_HINT}\n\nQuestion: ${question}`;
    sql = stripFence(await generate(prompt));
  } catch (err) {
    return { ok: false, error: `Gemini error: ${err.message}` };
  }
  const check = validateSelect(sql);
  if (!check.ok) return { ok: false, error: check.error, sql };
  try {
    const rows = await timeseries.readQuery(sql);
    let summary = null;
    try {
      summary = await generate(`Question: ${question}\nSQL result rows (JSON): ${JSON.stringify(rows).slice(0, 4000)}\nAnswer the question in one or two plain sentences for a security operator. No markdown.`, { retries: 1 });
    } catch { /* summary is best-effort */ }
    return { ok: true, sql, rows, summary, model: MODEL };
  } catch (err) {
    return { ok: false, error: `query failed: ${err.message}`, sql };
  }
}

// ---- guards ---------------------------------------------------------------------------
function stripFence(s) {
  return s.replace(/^```(?:sql)?/i, '').replace(/```$/, '').trim();
}

/** Allow exactly one read-only SELECT over the allowlisted tables. */
function validateSelect(sql) {
  if (!sql) return { ok: false, error: 'empty SQL' };
  const trimmed = sql.replace(/;\s*$/, '').trim();
  if (trimmed.includes(';')) return { ok: false, error: 'only a single statement is allowed' };
  if (!/^(select|with)\b/i.test(trimmed)) return { ok: false, error: 'only SELECT queries are allowed' };
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|call|do|merge)\b/i.test(trimmed)) {
    return { ok: false, error: 'write/DDL keywords are not allowed' };
  }
  const refs = [...trimmed.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase());
  const bad = refs.filter(r => !ALLOWED_TABLES.includes(r));
  if (bad.length) return { ok: false, error: `table not allowed: ${bad.join(', ')}` };
  return { ok: true };
}

// ---- offline fallback ---------------------------------------------------------------
function compactFacts(alert, ctx) {
  const pos = ctx.position || alert.position;
  const interp = alert.interpretation || ctx.interpretation || null;
  return {
    node: alert.nodeName || alert.nodeId,
    severity: alert.severity,
    kind: alert.kind || 'INTRUSION',
    label: interp ? interp.label : (alert.targetClass || (ctx.ml && ctx.ml.label)),
    title: interp ? interp.title : null,
    evidence: interp ? interp.detail : null,
    probability: alert.probability,
    zone: alert.zone && alert.zone.name,
    running: Boolean(ctx.fusion && ctx.fusion.running),
    loiterS: (ctx.fusion && ctx.fusion.loiterS) || alert.loiterS || 0,
    range_m: pos && pos.rangeM,
    bearing_deg: pos && pos.bearingDeg
  };
}

function templateNarrative(f) {
  const lead = f.title || (f.label === 'VEHICLE' ? 'Vehicle' : f.label === 'HUMAN' ? 'Person' : f.kind === 'TAMPER' ? 'Sensor tampering' : 'Activity');
  const bits = [];
  if (f.running) bits.push('moving fast');
  if (f.range_m) bits.push(`~${f.range_m} m${f.bearing_deg != null ? ` at ${f.bearing_deg}°` : ''}`);
  bits.push(`at ${f.node}`);
  if (f.zone) bits.push(`in ${f.zone}`);
  if (f.loiterS >= 10) bits.push(`stationary for ${f.loiterS}s`);
  const conf = f.probability ? ` (${Math.round(f.probability * 100)}% confidence)` : '';
  return `${lead} ${bits.join(', ')}${conf}.`;
}

function status() {
  return { enabled, model: enabled ? MODEL : null, calls, failures, lastError, quotaCooldown: Date.now() < quotaBlockedUntil, timeoutMs: CALL_TIMEOUT_MS };
}

module.exports = { narrate, narrateAlert, brief, answer, validateSelect, status, listFeed };
