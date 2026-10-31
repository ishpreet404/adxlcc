'use strict';
/**
 * Wires the hackathon sponsor integrations and the response policy into the alert pipeline:
 *   TigerData  — every telemetry row and alert (with a SHA-256 evidence hash) in hypertables
 *   Gemini     — narrates each new alert for the active mission; feeds the live briefing
 *   Deterrent  — per-mission response: audible siren on the node, or a silent alarm
 *
 * Both integrations are optional and independent; whichever is configured runs.
 */
const crypto = require('crypto');
const alerts = require('./alerts');
const timeseries = require('./timeseries');
const reason = require('./reason');
const profiles = require('./profiles');
const commands = require('./commands');
const arming = require('./arming');
const events = require('./events');

// Gemini budget for SIMULATED alerts (real hardware alerts are always narrated by Gemini).
// The simulator raises an alert every few seconds; this keeps the free tier from draining.
const SIM_PER_HOUR = Math.max(0, Number(process.env.GEMINI_SIM_PER_HOUR || 20));
const NARRATE_SIM = (process.env.GEMINI_NARRATE_SIM || '') === '1';
let simWindowStart = Date.now(), simUsed = 0;

function simBudgetOk() {
  if (!NARRATE_SIM) return false;
  if (Date.now() - simWindowStart > 3600e3) { simWindowStart = Date.now(); simUsed = 0; }
  if (simUsed >= SIM_PER_HOUR) return false;
  simUsed++;
  return true;
}

async function init() {
  await timeseries.init();
  alerts.onCreated((alert, ctx) => { handleNewAlert(alert, ctx).catch(err => console.warn('[sponsors] alert handling failed:', err.message)); });
  console.log('[sponsors] tiger=%s gemini=%s mission=%s', timeseries.status().ready, reason.status().enabled, profiles.get().id);
}

/** Deterministic hash of the evidence behind an alert — a tamper-evident fingerprint. */
function evidenceHash(alert, ctx = {}) {
  const payload = {
    id: alert.id, t: alert.createdAt, node: alert.nodeId, severity: alert.severity, kind: alert.kind,
    targetClass: alert.targetClass, probability: alert.probability,
    interpretation: alert.interpretation ? alert.interpretation.label : null,
    ml: ctx.ml ? { label: ctx.ml.label, confidence: ctx.ml.confidence } : null,
    position: ctx.position ? { x: ctx.position.x, y: ctx.position.y } : null,
    wave: ctx.telemetry && ctx.telemetry.wave ? ctx.telemetry.wave.a && ctx.telemetry.wave.a.slice(0, 32) : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Mission response policy: sound the node's siren, or stay silent. */
function respond(alert) {
  if (alert.test || alert.simulated || alert.kind === 'PANIC') return;   // panic sirens: see POST /api/system/panic
  const p = profiles.get();
  if (p.deterrent !== 'audible') {
    events.log('SILENT_ALARM', `${alert.nodeName}: silent alarm (${p.name}) - siren suppressed`, { nodeId: alert.nodeId, alertId: alert.id, severity: 'INFO' });
    return;
  }
  if (arming.mode !== 'ARMED') return;
  const min = p.id === 'nuclear' ? 'MEDIUM' : 'HIGH';   // in the exclusion zone, scare wildlife off early
  if ((RANK[alert.severity] || 0) < RANK[min]) return;
  const seconds = p.deterrentSeconds || 10;
  commands.push(alert.nodeId, { deter: seconds });
  alerts.enrich(alert.id, { deterrent: { seconds, at: Date.now(), mode: 'audible' } });
  events.log('DETERRENT', `Siren on ${alert.nodeName} for ${seconds}s (${p.name})`, { nodeId: alert.nodeId, alertId: alert.id, severity: 'INFO' });
}

async function handleNewAlert(alert, ctx) {
  if (alert.test) return;

  respond(alert);

  // Gemini narrative (user-visible) — attach to the live alert and the briefing feed.
  const useGemini = !alert.simulated || simBudgetOk();
  reason.narrate(alert, ctx, { useGemini }).then(n => {
    if (n && n.text) alerts.enrich(alert.id, { narrative: n.text, narrativeSource: n.source, narrativeModel: n.model });
  }).catch(() => {});

  // Tamper-evident record in TigerData.
  const hash = evidenceHash(alert, ctx);
  alerts.enrich(alert.id, { evidenceHash: hash });
  await timeseries.recordAlert(alert, { evidenceHash: hash, profile: profiles.get().id });
}

function status() {
  return { tiger: timeseries.status(), gemini: reason.status(), mission: profiles.get().id, simNarration: { enabled: NARRATE_SIM, perHour: SIM_PER_HOUR, used: simUsed } };
}

module.exports = { init, status };
