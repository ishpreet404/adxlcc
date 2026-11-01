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
const profiles = require('../services/profiles');
const panels = require('../services/panels');
const commands = require('../services/commands');
const fusion = require('../services/fusion');

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
      arming: arming.status(), notify: notify.status(), discovery: discovery.status(), simulator: simulator.status(),
      mission: profiles.get().id, panels: panels.list()
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

  // ---- mission profile (use case) -----------------------------------------
  router.get('/profile', (req, res) => res.json({ ok: true, profile: profiles.get(), profiles: profiles.list() }));
  router.post('/profile', (req, res) => {
    try {
      const body = req.body || {};
      let id = String(body.id || '');
      if (body.next) {   // cycle (used by the base station's SELECT button)
        const ids = profiles.list().map(p => p.id);
        id = ids[(ids.indexOf(profiles.get().id) + 1) % ids.length];
      }
      res.json({ ok: true, profile: profiles.set(id, body.by || 'operator') });
    } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
  });
  router.get('/panels', (req, res) => res.json({ ok: true, panels: panels.list() }));

  // ---- sirens: silence all / panic --------------------------------------------
  const realNodeIds = () => registry.list().filter(n => !n.simulated).map(n => n.id);
  // demo sensitivity: 'ultra' alerts on any footstep above the node's quiet level or any radar
  // target; 'max' also catches taps and light steps; 'normal' = strict two-sensor rules
  router.get('/sensitivity', (req, res) => res.json({ ok: true, level: config.SENSITIVITY, calibration: fusion.calibration() }));
  router.post('/sensitivity', (req, res) => {
    if (req.body && req.body.recalibrate) {
      fusion.recalibrate(req.body.nodeId);
      events.log('SENSITIVITY', `Recalibrating quiet level${req.body.nodeId ? ' on ' + req.body.nodeId : ''} (keep the node still)`, { severity: 'INFO' });
      return res.json({ ok: true, level: config.SENSITIVITY, recalibrating: true });
    }
    const level = String((req.body && req.body.level) || '').toLowerCase();
    if (!['normal', 'ultra', 'max'].includes(level)) return res.status(400).json({ ok: false, error: 'level must be "normal", "ultra" or "max"' });
    if (level !== config.SENSITIVITY) fusion.recalibrate();   // each level learns its own quiet level
    config.SENSITIVITY = level;
    events.log('SENSITIVITY', `Detection sensitivity set to ${level.toUpperCase()}`, { severity: 'INFO' });
    if (level === 'normal') registry.list().filter(n => !n.simulated).forEach(n => commands.push(n.id, { mode: 'ECO' }));
    res.json({ ok: true, level });
  });

  router.post('/silence', (req, res) => {
    const by = String((req.body && req.body.by) || 'operator').slice(0, 32);
    const ids = realNodeIds();
    for (const id of ids) { const q = commands.peek(id); if (q) delete q.deter; commands.push(id, { silence: true }); }
    notify.sirenOff();
    events.log('SILENCED', `Sirens silenced by ${by} on ${ids.length} node${ids.length === 1 ? '' : 's'}`, { severity: 'INFO' });
    res.json({ ok: true, nodes: ids, note: "delivered on each node's next check-in" });
  });
  router.post('/panic', (req, res) => {
    const by = String((req.body && req.body.by) || 'operator').slice(0, 32);
    const alert = alerts.raisePanic(by);
    const p = profiles.get();
    const sirens = p.deterrent === 'audible' ? realNodeIds() : [];
    for (const id of sirens) { const q = commands.peek(id); if (q) delete q.silence; commands.push(id, { deter: 30 }); }
    events.log('PANIC', `Panic alarm by ${by}${sirens.length ? ` - sirens on ${sirens.join(', ')}` : ' - silent alarm (mission policy)'}`, { severity: 'CRITICAL', alertId: alert && alert.id });
    res.json({ ok: true, alert: alert && alert.id, sirens });
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
