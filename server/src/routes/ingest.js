'use strict';
/**
 * Node uplink.
 *   POST /api/ingest           v2 compact packet (firmware 2.x) — also accepts an array of packets
 *   POST /api/telemetry        legacy v1 packet (firmware 1.x) — kept for compatibility
 * Response: { ok, t, level, alert, cmd? }  — `cmd` carries downlink commands for the node.
 */
const express = require('express');
const config = require('../config');
const pipeline = require('../services/pipeline');

const router = express.Router();

function auth(req, res, next) {
  if (!config.NODE_API_KEY) return next();
  if ((req.get('X-Node-Key') || req.query.key) === config.NODE_API_KEY) return next();
  return res.status(401).json({ ok: false, error: 'invalid node key' });
}

function handle(req, res) {
  const transport = req.get('X-Transport') || undefined; // gateways (BLE/LoRa/serial) tag the real link
  const packets = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const p of packets.slice(0, 50)) {
    try {
      if (transport && p && typeof p === 'object' && !p.tr) p.tr = transport;
      results.push(pipeline.ingest(p, { source: transport || 'http' }));
    } catch (err) {
      results.push({ ok: false, error: err.message });
    }
  }
  const last = results[results.length - 1] || { ok: false, error: 'empty' };
  if (results.length === 1) return res.status(last.ok ? 200 : 400).json(last);
  return res.json({ ok: results.every(r => r.ok), results });
}

router.post('/ingest', auth, handle);
router.post('/telemetry', auth, handle);

module.exports = router;
