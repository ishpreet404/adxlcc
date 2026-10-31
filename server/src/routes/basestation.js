'use strict';
/**
 * Compact state for the nRF/OLED base station (an ESP32 with ~300 KB RAM).
 *   GET /api/basestation   -> < 2 KB JSON with short keys; the full /api/alerts list can be
 *                             hundreds of KB and must never be fetched by the panel.
 * Real hardware only, unless BASESTATION_SHOW_SIM=1 (simulated items are flagged sim:1).
 */
const express = require('express');
const registry = require('../services/registry');
const alerts = require('../services/alerts');
const arming = require('../services/arming');
const profiles = require('../services/profiles');
const panels = require('../services/panels');

const router = express.Router();
const SHOW_SIM = (process.env.BASESTATION_SHOW_SIM || '') === '1';
const startedAt = Date.now();
const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

router.get('/', (req, res) => {
  panels.touch(req.ip, req.get('X-Panel-Fw'));
  const keep = (x) => SHOW_SIM || !x.simulated;
  const nodes = registry.list().filter(keep).sort((a, b) => (a.simulated ? 1 : 0) - (b.simulated ? 1 : 0));
  const active = alerts.active().filter(keep).sort((a, b) => (a.simulated ? 1 : 0) - (b.simulated ? 1 : 0) || b.updatedAt - a.updatedAt);
  const p = profiles.get();
  res.json({
    arm: arming.mode,
    mid: p.id, mis: p.short, aud: p.deterrent === 'audible' ? 1 : 0,
    up: Math.round((Date.now() - startedAt) / 1000),
    on: nodes.filter(n => n.status === 'ONLINE').length, tot: nodes.length,
    ac: active.length,
    nodes: nodes.slice(0, 6).map(n => ({
      id: n.id, nm: clip(n.name, 12), st: n.status,
      lv: n.fusion ? n.fusion.level : '-',
      bat: n.latest && n.latest.battery ? (n.latest.battery.external ? -2 : n.latest.battery.percent) : -1,   // -2 = USB/mains
      rssi: n.latest ? n.latest.rssi : 0, sim: n.simulated ? 1 : 0
    })),
    al: active.slice(0, 6).map(a => ({
      id: a.id, sv: a.severity, k: a.kind,
      t: clip((a.interpretation && a.interpretation.title) || `${a.targetClass} ${a.kind}`, 34),
      n: clip(a.nodeName, 12), tx: clip(a.narrative || a.message, 120), sim: a.simulated ? 1 : 0
    }))
  });
});

module.exports = router;
