'use strict';
/**
 * Per-packet processing pipeline:
 *   normalise → registry → (server ML) → fusion → localisation → zone → tracks (kinematics,
 *   triangulation, pre-arm) → loiter / tamper → alerts → activity → recorder → history → broadcast → downlink
 */
const config = require('../config');
const registry = require('./registry');
const realtime = require('./realtime');
const fusionEngine = require('./fusion');
const localization = require('./localization');
const tracks = require('./tracks');
const alerts = require('./alerts');
const events = require('./events');
const recorder = require('./recorder');
const commands = require('./commands');
const zones = require('./zones');
const activity = require('./activity');
const notify = require('./notify');
const { extract, spectrum } = require('../ml/features');
const { VibrationClassifier } = require('../ml/classifier');

const classifier = new VibrationClassifier();
const lastDetectionLog = new Map();
const loiterState = new Map();   // nodeId -> { since, dist, raised }
const prearmAt = new Map();      // nodeId -> last pre-arm time

registry.onStatusChange((node, from, to) => {
  if (to === 'ONLINE' && from !== 'ONLINE') events.log('NODE_ONLINE', `${node.name} online via ${node.transport || '?'}`, { nodeId: node.id });
  if (to === 'OFFLINE') {
    events.log('NODE_OFFLINE', `${node.name} offline (no packets for ${Math.round(config.NODE_OFFLINE_MS / 1000)}s)`, { nodeId: node.id, severity: 'HIGH' });
    if (!node.simulated) notify.send({ kind: 'OFFLINE', title: `Node offline — ${node.name}`, message: `No packets for ${Math.round(config.NODE_OFFLINE_MS / 1000)} s. Check battery / link.` });
  }
  if (to === 'WARNING') events.log('NODE_WARNING', `${node.name} missed heartbeats`, { nodeId: node.id, severity: 'LOW' });
  realtime.broadcast('node', registry.toPublic(node));
});

setInterval(() => {
  if (tracks.sweep()) realtime.broadcast('tracks', tracks.list());
  alerts.sweep();
}, 2000).unref();

function detectLoiter(node, t) {
  const st = loiterState.get(node.id) || { since: 0, dist: 0, raised: false };
  const stationary = t.radar.ok && t.radar.presence && (!t.radar.moving || t.radar.stationaryEnergy > 0);
  const dist = t.radar.moving ? t.radar.distance : (t.radar.stationaryDistance || t.radar.distance);
  if (!stationary || dist <= 0) { loiterState.set(node.id, { since: 0, dist: 0, raised: false }); return 0; }
  if (!st.since || Math.abs(dist - st.dist) > 0.8) { st.since = t.receivedAt; st.dist = dist; st.raised = false; }
  loiterState.set(node.id, st);
  return Math.round((t.receivedAt - st.since) / 1000);
}

function ingest(raw, meta = {}) {
  const t = registry.normalize(raw);
  const node = registry.apply(t, meta);

  // ---- machine learning ------------------------------------------------
  const nodeMl = t.ml;
  let serverMl = null;
  let features = t.seismic.features;
  if (!features && node.waveA.length >= 64) {
    features = extract(node.waveA.slice(-128), node.waveFs || 100);
    t.seismic.features = features;
  }
  if (features) {
    serverMl = classifier.classify(features);
    serverMl.explanation = classifier.explain(serverMl.label, features);
  }
  const ml = serverMl || nodeMl;
  if (t.wave && node.waveA.length >= 32) node.spectrum = spectrum(node.waveA.slice(-128), node.waveFs || 100);
  const running = Boolean(ml && ml.label === 'HUMAN' && features && features.rms > 0.03 && features.crestFactor > 2 && features.interPeakInterval >= 200 && features.interPeakInterval < 420);

  // ---- fusion + localisation --------------------------------------------
  const fusion = fusionEngine.evaluate(t, ml);
  fusion.nodeMl = nodeMl ? { label: nodeMl.label, confidence: nodeMl.confidence } : null;
  fusion.serverMl = serverMl ? { label: serverMl.label, confidence: serverMl.confidence, explanation: serverMl.explanation, source: serverMl.source } : null;
  fusion.running = running;
  fusion.t = t.receivedAt;

  const position = (fusion.level !== 'CLEAR' || t.radar.presence) ? localization.estimate(node, t) : null;
  const zone = position ? zones.locate(position.x, position.y) : null;
  if (zone) fusion.zone = { id: zone.id, name: zone.name, type: zone.type };
  const loiterS = detectLoiter(node, t);
  fusion.loiterS = loiterS;
  if (loiterS >= config.LOITER_SECONDS) fusion.note = `Stationary presence for ${loiterS}s`;
  node.fusion = fusion;
  node.position = position;

  // ---- tracks + pre-arm --------------------------------------------------------
  let track = null;
  let tracksChanged = false;
  if (position && fusion.level !== 'CLEAR') {
    track = tracks.update(node.id, position, fusion, t.receivedAt, {
      node: { x: node.x, y: node.y }, radarRange: t.radar.presence && t.radar.distance > 0.1 ? t.radar.distance : null,
      running, zone, allNodes: registry.list().filter(n => n.status === 'ONLINE').map(n => ({ id: n.id, name: n.name, x: n.x, y: n.y }))
    });
    tracksChanged = true;
    activity.record(position.x, position.y, t.receivedAt);
    if (config.PREARM_ENABLED && track.eta && fusion.level === 'INTRUSION') {
      const target = registry.get(track.eta.nodeId);
      const last = prearmAt.get(track.eta.nodeId) || 0;
      if (target && t.receivedAt - last > 60000 && !(target.latest && target.latest.mode === 'LIVE')) {
        prearmAt.set(track.eta.nodeId, t.receivedAt);
        commands.push(target.id, { mode: 'LIVE', liveFor: 90 });
        events.log('PREARM', `${track.id} heading for ${target.name} (ETA ${track.eta.etaS}s) — waking its radar`, { nodeId: target.id, severity: 'INFO' });
      }
    }
  }

  if (fusion.level === 'INTRUSION') {
    const last = lastDetectionLog.get(node.id) || 0;
    if (t.receivedAt - last > 10000) {
      lastDetectionLog.set(node.id, t.receivedAt);
      events.log('DETECTION', `${node.name}: ${fusion.targetClass}${running ? ' (running)' : ''} p=${fusion.probability}${position ? ` at ${position.rangeM} m, bearing ${position.bearingDeg}°` : ''}${zone ? ` in ${zone.name}` : ''}`, { nodeId: node.id, severity: fusion.severity });
    }
  }

  // ---- alerts ---------------------------------------------------------------
  const ctx = { telemetry: t, position, zone, track, ml, fusion };
  const alert = alerts.process(node, fusion, ctx);
  if (t.tamper && t.tamper.flag) alerts.raiseTamper(node, t.tamper, ctx);
  if (loiterS >= config.LOITER_SECONDS) {
    const st = loiterState.get(node.id);
    if (st && !st.raised) { st.raised = true; alerts.raiseLoiter(node, loiterS, ctx); }
  }

  if (t.wave) recorder.onWave(node.id, t.wave.fs, t.wave.a);

  registry.pushHistory(node, {
    t: t.receivedAt, rmsA: t.probes[0].rms, rmsB: t.probes[1].rms,
    radar: t.radar.presence ? t.radar.distance : null, energy: t.radar.energy,
    p: fusion.probability, v: t.battery.voltage, rssi: t.rssi
  });

  // ---- broadcast --------------------------------------------------------
  const pub = registry.toPublic(node);
  pub.wave = t.wave;
  realtime.broadcast('node', pub);
  if (tracksChanged) realtime.broadcast('tracks', tracks.list());

  const cmd = commands.drain(node.id);
  return { ok: true, t: Date.now(), alert: alert ? alert.id : null, level: fusion.level, cmd: cmd || undefined };
}

module.exports = { ingest, classifier };
