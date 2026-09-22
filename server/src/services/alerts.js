'use strict';
/**
 * Alert lifecycle: debounce, per-node cooldown merging, zone escalation, arming modes,
 * kinds INTRUSION / TAMPER / LOITER, replay frames, NDJSON persistence, outbound notifications.
 */
const config = require('../config');
const store = require('./store');
const realtime = require('./realtime');
const events = require('./events');
const arming = require('./arming');
const notify = require('./notify');

let seq = 0;
const nextId = () => `AL-${Date.now().toString(36).toUpperCase()}-${(++seq).toString(36).toUpperCase()}`;
const MAX_FRAMES = 240;

class Alerts {
  constructor() {
    this.alerts = new Map();
    this.hits = new Map();
    this.lastDisarmedLog = new Map();
    for (const a of store.readLog('alerts.ndjson', 500)) if (a && a.id) this.alerts.set(a.id, a);
    for (const a of this.alerts.values()) if (a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED') a.status = 'RESOLVED';
  }

  list(filter = {}) {
    let arr = Array.from(this.alerts.values());
    if (filter.status) arr = arr.filter(a => a.status === filter.status);
    if (filter.active) arr = arr.filter(a => a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED');
    arr.sort((p, q) => q.updatedAt - p.updatedAt);
    return arr.slice(0, filter.limit || 200).map(a => ({ ...a, frames: undefined, frameCount: a.frames ? a.frames.length : 0 }));
  }

  active() { return this.list({ active: true }); }
  get(id) { return this.alerts.get(id) || null; }

  _persist(a) { store.appendLog('alerts.ndjson', { ...a, frames: undefined }); }

  _open(nodeId, kind, now) {
    for (const a of this.alerts.values()) {
      if (a.nodeId === nodeId && a.kind === kind && (a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED') && now - a.updatedAt < config.ALERT_COOLDOWN_MS) return a;
    }
    return null;
  }

  _frame(alert, ctx, now) {
    const t = ctx.telemetry;
    alert.frames.push({
      t: now, x: ctx.position ? ctx.position.x : null, y: ctx.position ? ctx.position.y : null, p: ctx.fusion ? ctx.fusion.probability : null,
      r: t && t.radar.presence ? t.radar.distance : null, a: t ? t.probes[0].rms : null, b: t ? t.probes[1].rms : null
    });
    if (alert.frames.length > MAX_FRAMES) alert.frames.splice(0, alert.frames.length - MAX_FRAMES);
  }

  _create(node, kind, fields, ctx, now) {
    const alert = {
      id: nextId(), kind, nodeId: node.id, nodeName: node.name, simulated: node.simulated,
      createdAt: now, updatedAt: now, status: 'ACTIVE', test: arming.mode === 'TEST',
      severity: 'HIGH', probability: 0, peakProbability: 0, targetClass: 'UNKNOWN', mlLabel: null,
      position: ctx.position || null, zone: ctx.zone ? { id: ctx.zone.id, name: ctx.zone.name, type: ctx.zone.type } : null,
      track: ctx.position ? [{ t: now, x: ctx.position.x, y: ctx.position.y }] : [], frames: [],
      kinematics: null, evidence: [], samples: 1, ackBy: null, ackAt: null, resolvedAt: null, ...fields
    };
    this._frame(alert, ctx, now);
    this.alerts.set(alert.id, alert);
    this._persist(alert);
    const where = ctx.position ? ` at (${ctx.position.x}, ${ctx.position.y}) m` : '';
    const zone = ctx.zone ? ` in ${ctx.zone.name} [${ctx.zone.type}]` : '';
    events.log('ALERT_CREATED', `${alert.test ? '[TEST] ' : ''}${alert.severity} ${kind} ${alert.targetClass !== 'UNKNOWN' ? alert.targetClass + ' ' : ''}@ ${node.name}${where}${zone}`, { nodeId: node.id, alertId: alert.id, severity: alert.severity });
    realtime.broadcast('alert', { action: 'created', alert: { ...alert, frames: undefined } });
    console.log(`[alert] ${alert.id} ${alert.severity} ${kind} @ ${node.name} p=${alert.probability}${alert.test ? ' (test)' : ''}`);
    if (!alert.test) {
      notify.send({ kind, title: `${alert.severity} ${kind}${alert.targetClass !== 'UNKNOWN' ? ' · ' + alert.targetClass : ''} — ${node.name}`,
        message: `${fields.message || ''}${where}${zone}\n${new Date(now).toLocaleString()}`, data: { alertId: alert.id, nodeId: node.id, position: ctx.position, zone: alert.zone } });
    }
    return alert;
  }

  _touch(alert, fields, ctx, now) {
    alert.updatedAt = now;
    alert.samples++;
    Object.assign(alert, fields);
    if (ctx.position) {
      alert.position = ctx.position;
      alert.track.push({ t: now, x: ctx.position.x, y: ctx.position.y });
      if (alert.track.length > 120) alert.track.shift();
    }
    if (ctx.zone) alert.zone = { id: ctx.zone.id, name: ctx.zone.name, type: ctx.zone.type };
    this._frame(alert, ctx, now);
    realtime.broadcast('alert', { action: 'updated', alert: { ...alert, frames: undefined } });
    return alert;
  }

  /** Intrusion candidate from the fusion engine. ctx = { telemetry, position, zone, track, ml } */
  process(node, fusion, ctx) {
    const now = Date.now();
    const id = node.id;
    let severity = fusion.severity;
    let candidate = fusion.isAlertCandidate;

    // zone rules
    if (ctx.zone) {
      if (ctx.zone.type === 'restricted' && fusion.probability >= 0.5) { candidate = true; severity = 'CRITICAL'; }
      if (ctx.zone.type === 'allowed' && fusion.targetClass === 'VEHICLE') candidate = false;
    }
    if (!candidate) { this.hits.set(id, 0); return null; }
    if (arming.mode === 'DISARMED') {
      if (now - (this.lastDisarmedLog.get(id) || 0) > 30000) {
        this.lastDisarmedLog.set(id, now);
        events.log('DETECTION_DISARMED', `${node.name}: ${fusion.targetClass} p=${fusion.probability} (site disarmed, no alert)`, { nodeId: id, severity: 'LOW' });
      }
      return null;
    }
    const hits = (this.hits.get(id) || 0) + 1;
    this.hits.set(id, hits);
    if (hits < config.ALERT_DEBOUNCE_PACKETS) return null;

    const tr = ctx.track;
    const kin = tr ? { speed: tr.speed, headingDeg: tr.headingDeg, running: tr.running, eta: tr.eta, method: tr.method, trackId: tr.id } : null;
    const fields = {
      probability: fusion.probability, targetClass: fusion.targetClass, mlLabel: ctx.ml ? ctx.ml.label : null,
      evidence: fusion.evidence.slice(0, 6), kinematics: kin
    };
    if (kin && kin.running) severity = severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';

    const open = this._open(id, 'INTRUSION', now);
    if (open) {
      fields.peakProbability = Math.max(open.peakProbability, fusion.probability);
      fields.severity = open.severity === 'CRITICAL' || severity === 'CRITICAL' ? 'CRITICAL' : severity;
      return this._touch(open, fields, ctx, now);
    }
    fields.peakProbability = fusion.probability;
    fields.severity = severity;
    fields.message = `${fusion.targetClass} intrusion, p=${Math.round(fusion.probability * 100)}%${kin && kin.running ? ', RUNNING' : ''}${kin && kin.speed ? `, ${kin.speed} m/s` : ''}`;
    return this._create(node, 'INTRUSION', fields, ctx, now);
  }

  /** Node body tilted / lifted / struck. Raised regardless of arming mode. */
  raiseTamper(node, info, ctx = {}) {
    const now = Date.now();
    const open = this._open(node.id, 'TAMPER', now);
    const fields = { severity: 'HIGH', probability: 1, peakProbability: 1, targetClass: 'TAMPER', tamper: info,
      message: `Node ${info.impact ? 'struck' : 'tilted'} (${info.tilt}° from rest)` };
    if (open) return this._touch(open, fields, ctx, now);
    return this._create(node, 'TAMPER', fields, ctx, now);
  }

  /** Radar target standing still near a node. */
  raiseLoiter(node, seconds, ctx = {}) {
    const now = Date.now();
    if (arming.mode === 'DISARMED') return null;
    const open = this._open(node.id, 'LOITER', now);
    const fields = { severity: 'MEDIUM', probability: 0.6, peakProbability: 0.6, targetClass: 'HUMAN', loiterS: seconds,
      message: `Stationary presence for ${seconds}s at ${ctx.position ? ctx.position.rangeM + ' m' : 'close range'}` };
    if (open) return this._touch(open, fields, ctx, now);
    return this._create(node, 'LOITER', fields, ctx, now);
  }

  _transition(id, status, extra = {}) {
    const a = this.alerts.get(id);
    if (!a) return null;
    Object.assign(a, extra, { status, updatedAt: Date.now() });
    this._persist(a);
    events.log(`ALERT_${status}`, `${a.id} ${status.toLowerCase()} (${a.nodeName})`, { nodeId: a.nodeId, alertId: a.id });
    realtime.broadcast('alert', { action: status.toLowerCase(), alert: { ...a, frames: undefined } });
    if (status !== 'ACKNOWLEDGED' && !this.active().length) notify.sirenOff();
    return a;
  }

  acknowledge(id, by = 'operator') { return this._transition(id, 'ACKNOWLEDGED', { ackBy: by, ackAt: Date.now() }); }
  resolve(id) { return this._transition(id, 'RESOLVED', { resolvedAt: Date.now() }); }
  dismiss(id) { return this._transition(id, 'DISMISSED', { resolvedAt: Date.now() }); }
  acknowledgeAll(by = 'operator') { return this.active().filter(a => a.status === 'ACTIVE').map(a => this.acknowledge(a.id, by)); }

  sweep() {
    const now = Date.now();
    for (const a of this.alerts.values()) {
      if ((a.status === 'ACTIVE' || a.status === 'ACKNOWLEDGED') && now - a.updatedAt > config.ALERT_COOLDOWN_MS * 2) {
        this._transition(a.id, 'RESOLVED', { resolvedAt: now, autoResolved: true });
      }
    }
  }
}

module.exports = new Alerts();
