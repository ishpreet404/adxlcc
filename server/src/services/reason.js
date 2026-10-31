'use strict';
/**
 * Gemini operator brain.
 *
 *   narrateAlert(alert, ctx)  -> one plain-language sentence describing a threat, for the
 *                                dashboard / Telegram / the nRF base-station OLED.
 *   answer(question)          -> natural-language question over the TigerData history via
 *                                guarded text-to-SQL (read-only, single SELECT, allowlisted).
 *
 * Degrades safely: with no GEMINI_API_KEY both functions return a deterministic template
 * built from the structured data, so the demo still works offline.
 *
 * Env:
 *   GEMINI_API_KEY   Google AI Studio key
 *   GEMINI_MODEL     default "gemini-2.0-flash"
 */
const timeseries = require('./timeseries');

let GoogleGenAI = null;
try { ({ GoogleGenAI } = require('@google/genai')); } catch { /* sdk absent — template mode */ }

const KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
const enabled = Boolean(GoogleGenAI && KEY);
const ai = enabled ? new GoogleGenAI({ apiKey: KEY }) : null;

// Columns the text-to-SQL box is allowed to touch. Anything else is rejected before execution.
const ALLOWED_TABLES = ['telemetry', 'telemetry_1s', 'alerts'];
const SQL_SCHEMA_HINT = `
Tables (TimescaleDB / PostgreSQL):
  telemetry(time timestamptz, node_id text, node_name text, transport text, mode text, state text,
            rms_a float, rms_b float, radar_dist float, radar_energy float, ml_label text, ml_conf float,
            fusion_level text, probability float, loiter_s int, battery_v float, rssi int, pos_x float, pos_y float)
  alerts(time timestamptz, alert_id text, node_id text, node_name text, severity text, kind text,
         target_class text, probability float, zone text, message text, evidence_hash text, chain_sig text)
  telemetry_1s(bucket timestamptz, node_id text, rms_a float, rms_b float, max_p float, radar_dist float)
fusion_level is one of CLEAR, SUSPECT, INTRUSION. ml_label is one of NORMAL, HUMAN, VEHICLE, ENVIRONMENT.
Use time_bucket() and now() - interval '...' for time ranges.`;

async function narrateAlert(alert, ctx = {}) {
  const facts = compactFacts(alert, ctx);
  if (!enabled) return templateNarrative(facts);
  try {
    const prompt = `You are a perimeter-security operator. In ONE short sentence (max 25 words), plainly describe this alert for a guard. No preamble, no markdown.\n\n${JSON.stringify(facts)}`;
    const res = await ai.models.generateContent({ model: MODEL, contents: prompt });
    const text = (res.text || '').trim();
    return text || templateNarrative(facts);
  } catch (err) {
    console.warn('[gemini] narrate failed:', err.message);
    return templateNarrative(facts);
  }
}

async function answer(question) {
  if (!timeseries.ready) return { ok: false, error: 'time-series database not connected' };
  if (!enabled) return { ok: false, error: 'Gemini not configured (set GEMINI_API_KEY)' };
  let sql;
  try {
    const prompt = `Translate the question into ONE read-only PostgreSQL SELECT for this schema. Return ONLY the SQL, no markdown fence, no explanation. Always add a LIMIT (<=200).\n${SQL_SCHEMA_HINT}\n\nQuestion: ${question}`;
    const res = await ai.models.generateContent({ model: MODEL, contents: prompt });
    sql = stripFence((res.text || '').trim());
  } catch (err) {
    return { ok: false, error: `Gemini error: ${err.message}` };
  }
  const check = validateSelect(sql);
  if (!check.ok) return { ok: false, error: check.error, sql };
  try {
    const rows = await timeseries.readQuery(sql);
    let summary = null;
    try {
      const sres = await ai.models.generateContent({
        model: MODEL,
        contents: `Question: ${question}\nSQL result rows (JSON): ${JSON.stringify(rows).slice(0, 4000)}\nAnswer the question in one or two plain sentences for a security operator.`
      });
      summary = (sres.text || '').trim();
    } catch { /* summary is best-effort */ }
    return { ok: true, sql, rows, summary };
  } catch (err) {
    return { ok: false, error: `query failed: ${err.message}`, sql };
  }
}

// ---- guards ---------------------------------------------------------------

function stripFence(s) {
  return s.replace(/^```(?:sql)?/i, '').replace(/```$/,'').trim();
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
  // every table-ish identifier after from/join must be in the allowlist
  const refs = [...trimmed.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase());
  const bad = refs.filter(r => !ALLOWED_TABLES.includes(r));
  if (bad.length) return { ok: false, error: `table not allowed: ${bad.join(', ')}` };
  return { ok: true };
}

// ---- offline fallback -----------------------------------------------------

function compactFacts(alert, ctx) {
  const pos = ctx.position;
  return {
    node: alert.nodeName || alert.nodeId,
    severity: alert.severity,
    kind: alert.kind || 'INTRUSION',
    target: alert.targetClass || (ctx.ml && ctx.ml.label),
    probability: alert.probability,
    zone: alert.zone && alert.zone.name,
    running: ctx.fusion && ctx.fusion.running || false,
    loiterS: ctx.fusion && ctx.fusion.loiterS || 0,
    range_m: pos && pos.rangeM,
    bearing_deg: pos && pos.bearingDeg
  };
}

function templateNarrative(f) {
  const bits = [];
  bits.push(f.target === 'VEHICLE' ? 'Vehicle' : f.target === 'HUMAN' ? 'Person' : 'Activity');
  if (f.running) bits.push('moving fast');
  if (f.range_m) bits.push(`~${f.range_m} m${f.bearing_deg != null ? ` at ${f.bearing_deg}°` : ''}`);
  bits.push(`near ${f.node}`);
  if (f.zone) bits.push(`in ${f.zone}`);
  if (f.loiterS >= 10) bits.push(`loitering ${f.loiterS}s`);
  const conf = f.probability ? ` (${Math.round(f.probability * 100)}%)` : '';
  return `${f.severity || 'ALERT'}: ${bits.join(', ')}${conf}.`;
}

function status() { return { enabled, model: enabled ? MODEL : null }; }

module.exports = { narrateAlert, answer, validateSelect, status };
