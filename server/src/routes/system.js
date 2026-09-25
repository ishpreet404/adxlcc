'use strict';
const os = require('os');
const express = require('express');
const config = require('../config');
const registry = require('../services/registry');
const realtime = require('../services/realtime');
const recorder = require('../services/recorder');
const events = require('../services/events');
const zones = require('../services/zones');
const arming = require('../services/arming');
const notify = require('../services/notify');
const activity = require('../services/activity');
const alerts = require('../services/alerts');
const { classifier } = require('../services/pipeline');
const discovery = require('../services/discovery');

module.exports = (simulator) => {
  const router = express.Router();
  const startedAt = Date.now();

  router.get('/health', (req, res) => {
    res.json({
      ok: true, uptimeS: Math.round((Date.now() - startedAt) / 1000), host: os.hostname(), platform: `${os.platform()} ${os.arch()}`,
      node: process.version, load: os.loadavg().map(v => Number(v.toFixed(2))), memMB: Math.round(process.memoryUsage().rss / 1048576),
      dashboards: realtime.clientCount, nodes: registry.list().length,
      ml: { vibrationModel: classifier.loaded ? 'random_forest' : 'rules', trainedAt: classifier.meta.trainedAt || null, trees: classifier.trees.length },
      thresholds: { alert: config.ALERT_THRESHOLD, critical: config.CRITICAL_THRESHOLD, loiterS: config.LOITER_SECONDS, prearm: config.PREARM_ENABLED },
      arming: arming.status(), notify: notify.status(), discovery: discovery.status(), simulator: simulator.status()
    });
  });

  router.get('/site', (req, res) => res.json({ ok: true, site: registry.snapshot().site }));
  router.put('/site', (req, res) => {
    const site = registry.updateSite(req.body || {});
    realtime.broadcast('site', registry.snapshot().site);
    res.json({ ok: true, site: registry.snapshot().site });
  });

  // ---- zones -------------------------------------------------------------
  router.get('/zones', (req, res) => res.json({ ok: true, zones: zones.all() }));
  router.post('/zones', (req, res) => {
    try {
      const z = zones.create(req.body || {});
      events.log('ZONE_CREATED', `Zone "${z.name}" (${z.type})`);
      realtime.broadcast('site', registry.snapshot().site);
      res.json({ ok: true, zone: z });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  router.put('/zones/:id', (req, res) => {
    const z = zones.update(req.params.id, req.body || {});
    if (!z) return res.status(404).json({ ok: false, error: 'unknown zone' });
    realtime.broadcast('site', registry.snapshot().site);
    res.json({ ok: true, zone: z });
  });
  router.delete('/zones/:id', (req, res) => {
    if (!zones.remove(req.params.id)) return res.status(404).json({ ok: false, error: 'unknown zone' });
    realtime.broadcast('site', registry.snapshot().site);
    res.json({ ok: true });
  });

  // ---- arming ------------------------------------------------------------
  router.get('/arming', (req, res) => res.json({ ok: true, arming: arming.status() }));
  router.post('/arming', (req, res) => {
    try {
      const { mode, by } = req.body || {};
      res.json({ ok: true, arming: arming.set(String(mode || '').toUpperCase(), by || 'operator') });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  router.put('/arming/schedule', (req, res) => res.json({ ok: true, arming: arming.setSchedule(req.body || {}) }));

  // ---- notifications ------------------------------------------------------
  router.get('/notify', (req, res) => res.json({ ok: true, notify: notify.status() }));
  router.post('/notify/test', async (req, res) => {
    const sent = await notify.send({ kind: 'TEST', title: 'Test notification', message: `Sent from the dashboard at ${new Date().toLocaleString()}`, force: true });
    res.json({ ok: true, sent, notify: notify.status() });
  });
  router.post('/notify/telegram/discover', async (req, res) => {
    if (!notify.bot) await notify.checkTelegram();
    const r = await notify.discoverTelegramChats();
    res.json({ ok: !r.error, error: r.error, chats: r.chats, added: r.added || 0, notify: notify.status() });
  });
  router.put('/notify/telegram', async (req, res) => {
    const { token, chats } = req.body || {};
    res.json({ ok: true, notify: await notify.configureTelegram({ token, chats }) });
  });
  router.delete('/notify/telegram/chats/:id', (req, res) => res.json({ ok: true, notify: notify.removeTelegramChat(req.params.id) }));
  router.post('/siren', (req, res) => {
    const { on = true, seconds } = req.body || {};
    if (on) notify.siren(seconds); else notify.sirenOff();
    res.json({ ok: true, notify: notify.status() });
  });
  router.post('/alerts/acknowledge-all', (req, res) => res.json({ ok: true, alerts: alerts.acknowledgeAll((req.body || {}).by || 'operator') }));

  // ---- activity -------------------------------------------------------------
  router.get('/activity', (req, res) => res.json({ ok: true, activity: activity.summary() }));
  router.delete('/activity', (req, res) => { activity.reset(); res.json({ ok: true }); });

  // ---- simulator -------------------------------------------------------
  router.get('/sim', (req, res) => res.json({ ok: true, sim: simulator.status() }));
  router.post('/sim/start', (req, res) => {
    const { nodes = config.SIM_NODES, scenario = simulator.scenario } = req.body || {};
    res.json({ ok: true, sim: simulator.start(Number(nodes), scenario) });
  });
  router.post('/sim/stop', (req, res) => { simulator.stop(); res.json({ ok: true, sim: simulator.status() }); });
  router.post('/sim/scenario', (req, res) => {
    const { scenario } = req.body || {};
    events.log('SIM_SCENARIO', `Scenario → ${scenario}`);
    res.json({ ok: true, sim: simulator.setScenario(scenario) });
  });
  router.post('/sim/intruder', (req, res) => {
    const { nodeId, type = 'HUMAN' } = req.body || {};
    const actor = simulator.triggerIntruder(nodeId, type === 'VEHICLE' ? 'VEHICLE' : 'HUMAN');
    if (!actor) return res.status(400).json({ ok: false, error: 'no nodes to approach' });
    res.json({ ok: true, sim: simulator.status() });
  });
  router.post('/sim/tamper', (req, res) => {
    const { nodeId } = req.body || {};
    if (!simulator.triggerTamper(nodeId)) return res.status(400).json({ ok: false, error: 'not a running simulated node' });
    res.json({ ok: true });
  });

  // ---- ML recorder ------------------------------------------------------
  router.post('/record', (req, res) => {
    try {
      const { nodeId, label, seconds } = req.body || {};
      if (!registry.get(nodeId)) return res.status(404).json({ ok: false, error: 'unknown node' });
      res.json({ ok: true, recording: recorder.start(nodeId, label, seconds) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });
  router.post('/record/stop', (req, res) => res.json({ ok: true, recording: recorder.stop((req.body || {}).nodeId) }));
  router.get('/record/:nodeId', (req, res) => res.json({ ok: true, recording: recorder.status(req.params.nodeId) }));

  return router;
};
