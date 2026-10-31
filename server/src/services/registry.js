'use strict';
/**
 * Node registry: placement config, live state, telemetry normalisation, history, health.
 *
 * Site frame: metres, x → east, y → north, origin bottom-left.
 * Node heading: degrees, 0 = +x, 90 = +y (counter-clockwise). The radar faces the heading.
 * Probe A sits on the node's LEFT, probe B on its RIGHT, `spacing` metres apart.
 */
const config = require('../config');
const store = require('./store');
const { FEATURE_ORDER } = require('../ml/features');

const CLASS_NAMES = ['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'];

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (Number.isFinite(Number(v)) ? Number(v) : d));
const r = (v, p = 3) => Number(num(v).toFixed(p));

class Registry {
  constructor() {
    this.site = store.readJson('site.json', null) || {
      width: config.SITE_WIDTH, height: config.SITE_HEIGHT, name: 'Perimeter Site', nodes: {}
    };
    if (!this.site.nodes) this.site.nodes = {};
    this.nodes = new Map();
    this.listeners = { status: [] };
    for (const [id, cfg] of Object.entries(this.site.nodes)) {
      this._create(id, cfg);
    }
    setInterval(() => this.sweepHealth(), 5000).unref();
  }

  onStatusChange(fn) { this.listeners.status.push(fn); }

  _emitStatus(node, from, to) {
    for (const fn of this.listeners.status) { try { fn(node, from, to); } catch (e) { console.error(e); } }
  }

  _autoPlace(index) {
    // spread unplaced nodes along the bottom edge so they are visible immediately
    const cols = 4;
    return {
      x: r(4 + (index % cols) * ((this.site.width - 8) / Math.max(1, cols - 1)), 1),
      y: r(4 + Math.floor(index / cols) * 6, 1),
      heading: 90
    };
  }

  _create(id, cfg = {}) {
    const auto = this._autoPlace(this.nodes.size);
    const node = {
      id,
      name: cfg.name || id,
      x: num(cfg.x, auto.x),
      y: num(cfg.y, auto.y),
      heading: num(cfg.heading, auto.heading),
      spacing: num(cfg.spacing, 1.5),
      simulated: Boolean(cfg.simulated),
      placed: cfg.x !== undefined && cfg.y !== undefined,
      status: 'OFFLINE',
      firstSeen: null,
      lastSeen: null,
      packets: 0,
      rate: 0,
      _rateWindow: [],
      latest: null,
      fusion: null,
      position: null,
      history: [],
      battLog: [],
      batteryForecast: null,
      packetLoss: 0,
      _lost: 0,
      waveA: [],
      waveB: [],
      spectrum: null,
      commands: []
    };
    this.nodes.set(id, node);
    return node;
  }

  persist() {
    const nodes = {};
    for (const n of this.nodes.values()) {
      nodes[n.id] = { name: n.name, x: n.x, y: n.y, heading: n.heading, spacing: n.spacing, simulated: n.simulated };
    }
    this.site.nodes = nodes;
    store.writeJson('site.json', this.site);
  }

  ensure(id, cfg) {
    let node = this.nodes.get(id);
    if (!node) {
      node = this._create(id, cfg || {});
      this.persist();
    }
    return node;
  }

  get(id) { return this.nodes.get(id) || null; }
  list() { return Array.from(this.nodes.values()); }

  updateConfig(id, patch) {
    const node = this.nodes.get(id);
    if (!node) return null;
    if (typeof patch.name === 'string' && patch.name.trim()) node.name = patch.name.trim().slice(0, 40);
    if (patch.x !== undefined) { node.x = r(Math.max(0, Math.min(this.site.width, num(patch.x))), 2); node.placed = true; }
    if (patch.y !== undefined) { node.y = r(Math.max(0, Math.min(this.site.height, num(patch.y))), 2); node.placed = true; }
    if (patch.heading !== undefined) node.heading = r(((num(patch.heading) % 360) + 360) % 360, 1);
    if (patch.spacing !== undefined) node.spacing = r(Math.max(0.3, Math.min(10, num(patch.spacing))), 2);
    this.persist();
    return node;
  }

  updateSite(patch) {
    if (patch.width) this.site.width = Math.max(5, Math.min(500, num(patch.width)));
    if (patch.height) this.site.height = Math.max(5, Math.min(500, num(patch.height)));
    if (typeof patch.name === 'string') this.site.name = patch.name.slice(0, 60);
    this.persist();
    return this.site;
  }

  remove(id) {
    const ok = this.nodes.delete(id);
    if (ok) this.persist();
    return ok;
  }

  /**
   * Normalise a raw node packet (v2 compact, or legacy v1) into the canonical telemetry shape.
   */
  normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('packet must be a JSON object');
    const id = String(raw.id || raw.nodeId || '').trim();
    if (!id || id.length > 32 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('missing/invalid node id');

    const legacy = raw.accelerometer !== undefined;
    const now = Date.now();
    let t;
    if (legacy) {
      const s1 = raw.accelerometer.sensor1 || {};
      const s2 = raw.accelerometer.sensor2 || {};
      t = {
        nodeId: id, seq: num(raw.sequence), uptimeMs: num(raw.timestamp), firmware: String(raw.firmware || '1.x'),
        transport: String(raw.transport || 'wifi').toLowerCase(), rssi: num(raw.signal && raw.signal.rssi, -99),
        mode: 'LIVE', state: raw.eventState === 'ALERT' ? 'EVENT' : (raw.eventState === 'SUSPICIOUS' ? 'SUSPECT' : 'IDLE'),
        battery: { voltage: r(raw.battery && raw.battery.voltage, 2), percent: Math.round(num(raw.battery && raw.battery.percentage)) },
        radar: { ok: true, presence: Boolean(raw.radar && raw.radar.presence), moving: Boolean(raw.radar && raw.radar.presence),
          distance: r(raw.radar && raw.radar.distance, 2), energy: Math.round(num(raw.radar && raw.radar.confidence) * 100), stationaryDistance: 0, stationaryEnergy: 0 },
        probes: [
          { ok: true, x: r(s1.x), y: r(s1.y), z: r(s1.z), rms: r(s1.vibrationRms, 4), peak: r(s1.features && s1.features.peak, 4), staLta: 0 },
          { ok: true, x: r(s2.x), y: r(s2.y), z: r(s2.z), rms: r(s2.vibrationRms, 4), peak: 0, staLta: 0 }
        ],
        seismic: { lagMs: 0, corr: 0, ratio: 0, features: s1.features || null },
        ml: null, wave: null, tamper: null, noiseFloor: null, calibrated: false, sys: {}
      };
    } else {
      const a = raw.a || {}, b = raw.b || {}, rad = raw.radar || {}, seis = raw.seis || {}, ml = raw.ml || null;
      let features = null;
      if (Array.isArray(seis.f) && seis.f.length >= 10) {
        features = {};
        FEATURE_ORDER.forEach((k, i) => { features[k] = i < seis.f.length ? r(seis.f[i], 6) : 0; });
      } else if (seis.features && typeof seis.features === 'object') {
        features = seis.features;
      }
      let wave = null;
      if (raw.wave && Array.isArray(raw.wave.a)) {
        const scale = raw.wave.unit === 'g' ? 1 : 0.001; // default unit: milli-g integers
        wave = {
          fs: num(raw.wave.fs, 100),
          a: raw.wave.a.slice(0, 256).map(v => r(num(v) * scale, 4)),
          b: Array.isArray(raw.wave.b) ? raw.wave.b.slice(0, 256).map(v => r(num(v) * scale, 4)) : []
        };
      }
      let mlNorm = null;
      if (ml && Array.isArray(ml.p)) {
        const probs = {};
        CLASS_NAMES.forEach((c, i) => { probs[c] = r(ml.p[i], 3); });
        const idx = Number.isInteger(ml.c) ? ml.c : ml.p.indexOf(Math.max(...ml.p));
        mlNorm = { label: CLASS_NAMES[idx] || 'NORMAL', confidence: r(ml.p[idx], 3), probs, source: 'node-rf' };
      }
      t = {
        nodeId: id, seq: num(raw.seq), uptimeMs: num(raw.up), firmware: String(raw.fw || '2.x'),
        transport: String(raw.tr || 'wifi').toLowerCase(), rssi: num(raw.rssi, -99),
        mode: raw.mode === 'ECO' ? 'ECO' : 'LIVE',
        state: ['IDLE', 'SUSPECT', 'EVENT'].includes(raw.st) ? raw.st : 'IDLE',
        battery: { voltage: r(raw.bat && raw.bat.v, 2), percent: Math.max(0, Math.min(100, Math.round(num(raw.bat && raw.bat.p)))) },
        radar: {
          ok: rad.ok !== false, presence: Boolean(rad.pres), moving: num(rad.mov) > 0,
          distance: r(rad.dist, 2), energy: Math.max(0, Math.min(100, Math.round(num(rad.eng)))),
          stationaryDistance: r(rad.sdist, 2), stationaryEnergy: Math.max(0, Math.min(100, Math.round(num(rad.seng))))
        },
        probes: [
          { ok: a.ok !== false, x: r(a.x), y: r(a.y), z: r(a.z), rms: r(a.rms, 4), peak: r(a.peak, 4), staLta: r(a.sl, 2) },
          { ok: b.ok !== false, x: r(b.x), y: r(b.y), z: r(b.z), rms: r(b.rms, 4), peak: r(b.peak, 4), staLta: r(b.sl, 2) }
        ],
        seismic: { lagMs: r(seis.lag, 2), corr: r(seis.corr, 3), ratio: r(seis.ratio, 3), features },
        ml: mlNorm, wave,
        tamper: raw.tamper ? { tilt: r(raw.tamper.tilt, 1), flag: Boolean(raw.tamper.flag), impact: Boolean(raw.tamper.imp) } : null,
        noiseFloor: raw.nf !== undefined ? r(raw.nf, 5) : null,
        calibrated: Boolean(raw.cal),
        sys: { heap: num(raw.sys && raw.sys.heap), temp: r(raw.sys && raw.sys.tmp, 1) }
      };
    }
    t.receivedAt = now;
    t.battery.low = t.battery.percent <= 20;
    t.battery.critical = t.battery.percent <= 8;
    return t;
  }

  /** Apply a normalised telemetry packet to the node state. */
  apply(t, meta = {}) {
    const node = this.ensure(t.nodeId, { simulated: Boolean(meta.simulated) });
    const now = t.receivedAt;
    const prevStatus = node.status;
    if (!node.firstSeen) node.firstSeen = now;
    node.lastSeen = now;
    node.packets++;
    // packet loss from sequence gaps (a seq going backwards means the node rebooted)
    if (node._lastSeq !== undefined && t.seq > node._lastSeq + 1 && t.seq - node._lastSeq < 1000) node._lost += t.seq - node._lastSeq - 1;
    if (node._lastSeq !== undefined && t.seq < node._lastSeq) { node._lost = 0; node.reboots = (node.reboots || 0) + 1; }
    node._lastSeq = t.seq;
    node.packetLoss = r(100 * node._lost / Math.max(1, node._lost + node.packets + 1), 1);
    node.latest = t;
    node.transport = t.transport;
    if (meta.simulated) node.simulated = true;
    if (t.calibrated) node.calibratedAt = now;
    // battery log: one sample per minute, 24 h, for the forecast
    const lastB = node.battLog[node.battLog.length - 1];
    if (!lastB || now - lastB.t >= 60000) {
      node.battLog.push({ t: now, v: t.battery.voltage, p: t.battery.percent });
      if (node.battLog.length > 1440) node.battLog.shift();
      node.batteryForecast = this.forecastBattery(node);
    }

    // packet rate (per second over last 10 s)
    node._rateWindow.push(now);
    while (node._rateWindow.length && now - node._rateWindow[0] > 10000) node._rateWindow.shift();
    node.rate = r(node._rateWindow.length / 10, 2);

    // waveform ring buffers for the scopes / recorder
    if (t.wave) {
      node.waveA.push(...t.wave.a);
      node.waveB.push(...t.wave.b);
      const max = config.WAVE_BUFFER_LEN;
      if (node.waveA.length > max) node.waveA.splice(0, node.waveA.length - max);
      if (node.waveB.length > max) node.waveB.splice(0, node.waveB.length - max);
      node.waveFs = t.wave.fs;
    }

    if (node.status !== 'ONLINE') {
      node.status = 'ONLINE';
      this._emitStatus(node, prevStatus, 'ONLINE');
    }
    return node;
  }

  pushHistory(node, point) {
    node.history.push(point);
    if (node.history.length > config.HISTORY_LEN) node.history.shift();
  }

  sweepHealth() {
    const now = Date.now();
    for (const node of this.nodes.values()) {
      if (!node.lastSeen) continue;
      const age = now - node.lastSeen;
      const prev = node.status;
      let next = prev;
      if (age > config.NODE_OFFLINE_MS) next = 'OFFLINE';
      else if (age > config.NODE_WARN_MS) next = 'WARNING';
      if (next !== prev && !(prev === 'OFFLINE' && next === 'WARNING')) {
        node.status = next;
        node.rate = 0;
        this._emitStatus(node, prev, next);
      }
    }
  }

  /** Linear fit of voltage over the last hours → hours until 3.4 V (cut-off). */
  forecastBattery(node) {
    const log = node.battLog;
    if (log.length < 5) return null;
    const t0 = log[0].t;
    const xs = log.map(s => (s.t - t0) / 3600000), ys = log.map(s => s.v);
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    if (sxx < 1e-6 || xs[n - 1] < 0.08) return null;           // need ≥ 5 min of samples
    const slope = sxy / sxx;                                     // V per hour
    const v = ys[n - 1];
    const hoursLeft = slope < -1e-4 ? (v - 3.4) / -slope : null;
    return { slopeMvPerHour: r(slope * 1000, 1), hoursLeft: hoursLeft !== null ? r(Math.max(0, hoursLeft), 1) : null, samples: n, spanH: r(xs[n - 1], 2) };
  }

  /** Compact public view (no big buffers). */
  toPublic(node) {
    return {
      id: node.id, name: node.name, x: node.x, y: node.y, heading: node.heading, spacing: node.spacing,
      simulated: node.simulated, placed: node.placed, status: node.status,
      firstSeen: node.firstSeen, lastSeen: node.lastSeen, packets: node.packets, rate: node.rate,
      transport: node.transport || null, packetLoss: node.packetLoss, reboots: node.reboots || 0,
      batteryForecast: node.batteryForecast, calibratedAt: node.calibratedAt || null,
      latest: node.latest ? { ...node.latest, wave: undefined } : null,
      fusion: node.fusion, position: node.position, spectrum: node.spectrum,
      probes: this.probePositions(node)
    };
  }

  probePositions(node) {
    const h = node.heading * Math.PI / 180;
    const left = { x: -Math.sin(h), y: Math.cos(h) };
    const half = node.spacing / 2;
    return {
      a: { x: r(node.x + left.x * half, 2), y: r(node.y + left.y * half, 2) },
      b: { x: r(node.x - left.x * half, 2), y: r(node.y - left.y * half, 2) }
    };
  }

  snapshot() {
    return {
      site: { width: this.site.width, height: this.site.height, name: this.site.name, zones: this.site.zones || [] },
      nodes: this.list().map(n => this.toPublic(n))
    };
  }
}

module.exports = new Registry();
module.exports.CLASS_NAMES = CLASS_NAMES;
