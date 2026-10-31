'use strict';
/**
 * Wires the three hackathon sponsor integrations into the existing alert pipeline:
 *   TigerData  — store every telemetry row + every alert (with on-chain proof) in a hypertable
 *   Gemini     — narrate each new alert in plain language (dashboard / Telegram / OLED)
 *   Solana     — anchor each confirmed alert's evidence hash on devnet for chain-of-custody
 *
 * All three are optional and independent; whichever is configured runs, the rest no-op.
 */
const alerts = require('./alerts');
const timeseries = require('./timeseries');
const reason = require('./reason');
const anchorchain = require('./anchorchain');
const events = require('./events');
const notify = require('./notify');

async function init() {
  await timeseries.init();
  anchorchain.init();

  alerts.onCreated((alert, ctx) => { handleNewAlert(alert, ctx).catch(err => console.warn('[sponsors] alert handling failed:', err.message)); });

  console.log('[sponsors] tiger=%s gemini=%s solana=%s',
    timeseries.status().ready, reason.status().enabled, anchorchain.enabled);
}

async function handleNewAlert(alert, ctx) {
  if (alert.test) return;

  // 1) Gemini narrative (fast, user-visible) — attach to the live alert.
  reason.narrateAlert(alert, ctx).then(narrative => {
    if (narrative) alerts.enrich(alert.id, { narrative });
  }).catch(() => {});

  // 2) Solana anchor of the evidence hash (devnet). Record the alert in TigerData either way.
  let proof = { hash: anchorchain.evidenceHash(alert, ctx), anchored: false };
  try { proof = await anchorchain.anchorAlert(alert, ctx); } catch (e) { /* keep local hash */ }

  await timeseries.recordAlert(alert, { evidenceHash: proof.hash, chainSig: proof.signature, chainSlot: proof.slot });

  if (proof.anchored) {
    alerts.enrich(alert.id, { chain: { hash: proof.hash, signature: proof.signature, slot: proof.slot, explorer: proof.explorer } });
    events.log('CHAIN_ANCHORED', `Alert ${alert.id} anchored on Solana devnet (${proof.signature.slice(0, 8)}…)`, { nodeId: alert.nodeId, alertId: alert.id, severity: 'INFO' });
  } else {
    alerts.enrich(alert.id, { chain: { hash: proof.hash, anchored: false } });
  }
}

function status() {
  return { tiger: timeseries.status(), gemini: reason.status(), solana: anchorchain.status };
}

module.exports = { init, status };
