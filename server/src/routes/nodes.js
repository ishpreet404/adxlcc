'use strict';
const express = require('express');
const registry = require('../services/registry');
const commands = require('../services/commands');
const events = require('../services/events');
const realtime = require('../services/realtime');
const tracks = require('../services/tracks');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ ok: true, site: registry.snapshot().site, nodes: registry.list().map(n => registry.toPublic(n)), tracks: tracks.list() });
});

router.get('/:id', (req, res) => {
  const n = registry.get(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  res.json({ ok: true, node: registry.toPublic(n) });
});

router.get('/:id/history', (req, res) => {
  const n = registry.get(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  const limit = Math.min(1000, Number(req.query.limit) || 240);
  res.json({ ok: true, history: n.history.slice(-limit) });
});

router.get('/:id/wave', (req, res) => {
  const n = registry.get(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  res.json({ ok: true, fs: n.waveFs || 100, a: n.waveA, b: n.waveB, spectrum: n.spectrum });
});

router.put('/:id', (req, res) => {
  const n = registry.updateConfig(req.params.id, req.body || {});
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  realtime.broadcast('node', registry.toPublic(n));
  res.json({ ok: true, node: registry.toPublic(n) });
});

router.delete('/:id', (req, res) => {
  const n = registry.get(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  if (n.simulated && n.status === 'ONLINE') return res.status(400).json({ ok: false, error: 'stop the simulator before removing a running simulated node' });
  registry.remove(req.params.id);
  realtime.broadcast('nodeRemoved', { id: req.params.id });
  res.json({ ok: true });
});

/** Queue a downlink command: { mode: "LIVE"|"ECO", liveFor?: seconds, reboot?: true } */
router.post('/:id/command', (req, res) => {
  const n = registry.get(req.params.id);
  if (!n) return res.status(404).json({ ok: false, error: 'unknown node' });
  const body = req.body || {};
  const cmd = {};
  if (body.mode === 'LIVE' || body.mode === 'ECO') cmd.mode = body.mode;
  if (body.liveFor) cmd.liveFor = Math.max(10, Math.min(3600, Number(body.liveFor)));
  if (body.reboot) cmd.reboot = true;
  if (body.sleepS) cmd.sleepS = Math.max(5, Math.min(3600, Number(body.sleepS)));
  if (body.calibrate) cmd.calibrate = true;
  if (body.deter) cmd.deter = Math.max(1, Math.min(120, Number(body.deter) || 10));
  if (!Object.keys(cmd).length) return res.status(400).json({ ok: false, error: 'no valid command' });
  const queued = commands.push(n.id, cmd);
  events.log('COMMAND_QUEUED', `${n.name}: ${JSON.stringify(cmd)}`, { nodeId: n.id });
  res.json({ ok: true, queued, note: 'delivered on the node\'s next uplink' });
});

module.exports = router;
