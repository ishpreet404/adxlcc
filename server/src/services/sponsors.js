'use strict';
/**
 * Wires the hackathon sponsor integrations into the existing alert pipeline:
 *   TigerData  — store every telemetry row + every alert in a hypertable
 *   Gemini     — narrate each new alert in plain language (dashboard / Telegram / OLED)
 *
 * Each alert is also stamped with a SHA-256 "evidence hash" of its sensor evidence, stored
 * in TigerData, so the audit trail is tamper-evident (no blockchain required).
 *
 * Both integrations are optional and independent; whichever is configured runs, the rest no-op.
 */
const crypto = require('crypto');
const alerts = require('./alerts');
const timeseries = require('./timeseries');
const reason = require('./reason');

async function init() {
  await timeseries.init();

  alerts.onCreated((alert, ctx) => { handleNewAlert(alert, ctx).catch(err => console.warn('[sponsors] alert handling failed:', err.message)); });

  console.log('[sponsors] tiger=%s gemini=%s',
    timeseries.status().ready, reason.status().enabled);
}

// On a LITE Gemini model (~1000 req/day) narrating every simulated alert is fine; set
// GEMINI_NARRATE_SIM=1. On a full flash model (~20/day) leave it 0 so the chatty simulator
// can't exhaust the daily cap (real hardware alerts are always narrated).
const NARRATE_SIM = (process.env.GEMINI_NARRATE_SIM || '') === '1';

/** Deterministic hash of the evidence behind an alert — a tamper-evident fingerprint. */
function evidenceHash(alert, ctx = {}) {
  const payload = {
    id: alert.id, t: alert.t, node: alert.nodeId, severity: alert.severity, kind: alert.kind,
    targetClass: alert.targetClass, probability: alert.probability,
    ml: ctx.ml ? { label: ctx.ml.label, confidence: ctx.ml.confidence } : null,
    position: ctx.position ? { x: ctx.position.x, y: ctx.position.y } : null,
    wave: ctx.telemetry && ctx.telemetry.wave ? ctx.telemetry.wave.a && ctx.telemetry.wave.a.slice(0, 32) : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function handleNewAlert(alert, ctx) {
  if (alert.test) return;

  // 1) Gemini narrative (fast, user-visible) — attach to the live alert.
  if (!alert.simulated || NARRATE_SIM) {
    reason.narrateAlert(alert, ctx).then(narrative => {
      if (narrative) alerts.enrich(alert.id, { narrative });
    }).catch(() => {});
  }

  // 2) Record the alert in TigerData with a tamper-evident evidence hash.
  const hash = evidenceHash(alert, ctx);
  alerts.enrich(alert.id, { evidenceHash: hash });
  await timeseries.recordAlert(alert, { evidenceHash: hash });
}

function status() {
  return { tiger: timeseries.status(), gemini: reason.status() };
}

module.exports = { init, status };
