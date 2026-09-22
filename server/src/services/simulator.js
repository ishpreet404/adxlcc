'use strict';
/**
 * Physically-consistent node simulator.
 *
 * Simulated nodes are real registry entries (flagged `simulated`) that run through
 * the exact same ingest pipeline as hardware.  Actors (a walking human, a vehicle,
 * wind) move around the site; each simulated node "senses" them from its own
 * position/heading using the same physics the localiser assumes, so the estimated
 * positions on the map can be checked against the true actor position (also broadcast).
 */
const config = require('../config');
const registry = require('./registry');
const realtime = require('./realtime');
const events = require('./events');
const { extract } = require('../ml/features');

const TICK_MS = 250;
const FS = 100;
const SAMPLES_PER_TICK = FS * TICK_MS / 1000; // 25
const WAVE_SPEED = config.SEISMIC_WAVE_SPEED_MS;
const ALPHA = 1.2;

const SIM_PLACEMENTS = [
  { id: 'SIM-1', name: 'Sim North Gate', x: 10, y: 18, heading: 30, spacing: 1.5 },
  { id: 'SIM-2', name: 'Sim East Fence', x: 30, y: 20, heading: 120, spacing: 1.5 },
  { id: 'SIM-3', name: 'Sim South Track', x: 20, y: 6, heading: 90, spacing: 2.0 },
  { id: 'SIM-4', name: 'Sim West Drive', x: 5, y: 8, heading: 0, spacing: 1.5 }
];

const SCENARIOS = {
  quiet: { label: 'Quiet site', actors: [] },
  patrol: { label: 'Intruder walking a loop', actors: [{ type: 'HUMAN', speed: 1.25, loop: true, path: [[2, 4], [8, 14], [16, 22], [26, 26], [34, 18], [36, 6], [20, 2]] }] },
  vehicle: { label: 'Vehicle on the south road', actors: [{ type: 'VEHICLE', speed: 4.0, loop: true, path: [[-4, 3], [44, 3], [44, 1], [-4, 1]] }] },
  wind: { label: 'Wind gusts (environmental)', actors: [{ type: 'WIND' }] },
  loiter: { label: 'Someone stops and waits near a node', actors: [{ type: 'HUMAN', speed: 1.1, loop: false, path: [[2, 26], [8, 22], [12.5, 20.2]] }] },
  runner: { label: 'Intruder running across the site', actors: [{ type: 'HUMAN', speed: 3.4, cadence: 0.33, loop: true, path: [[38, 4], [30, 14], [16, 22], [4, 12], [8, 3]] }] },
  mixed: { label: 'Walker + wind', actors: [{ type: 'HUMAN', speed: 1.1, loop: true, path: [[2, 4], [8, 14], [16, 22], [26, 26], [34, 18], [36, 6], [20, 2]] }, { type: 'WIND', gain: 0.5 }] }
};

const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const percentToVoltage = p => 3.3 + 0.9 * Math.pow(p / 100, 0.8);

class Simulator {
  constructor(pipeline) {
    this.pipeline = pipeline;
    this.timer = null;
    this.nodes = new Map();
    this.actors = [];
    this.scenario = 'quiet';
    this.t = 0;
    this.seq = 0;
  }

  get running() { return Boolean(this.timer); }

  start(count = config.SIM_NODES, scenario = config.SIM_SCENARIO) {
    count = clamp(Math.round(count), 0, SIM_PLACEMENTS.length);
    this.stop();
    this.nodes.clear();
    for (let i = 0; i < count; i++) {
      const p = SIM_PLACEMENTS[i];
      const reg = registry.get(p.id);
      if (!reg) registry.ensure(p.id, { ...p, simulated: true });
      this.nodes.set(p.id, {
        id: p.id, seq: 0, battery: 55 + Math.random() * 43, rssi: -50 - Math.random() * 25,
        bufA: [], bufB: [], noise: 0.006 + Math.random() * 0.006, mode: 'LIVE', lastFeatT: 0, features: null, ml: null,
        stepPhase: Math.random(), radarOk: true, tempC: 28 + Math.random() * 6
      });
    }
    this.setScenario(scenario);
    if (count > 0) {
      this.timer = setInterval(() => this.tick(), TICK_MS);
      events.log('SIM_STARTED', `Simulator running ${count} node(s), scenario "${scenario}"`, { severity: 'INFO' });
    }
    return this.status();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      events.log('SIM_STOPPED', 'Simulator stopped');
      realtime.broadcast('sim', this.status());
    }
  }

  setScenario(name) {
    const sc = SCENARIOS[name] || SCENARIOS.quiet;
    this.scenario = SCENARIOS[name] ? name : 'quiet';
    this.actors = sc.actors.map(a => this._makeActor(a));
    realtime.broadcast('sim', this.status());
    return this.status();
  }

  /** Spawn a one-off intruder that approaches a node head-on, lingers, and leaves. */
  triggerIntruder(nodeId, type = 'HUMAN') {
    const n = registry.get(nodeId) || registry.list()[0];
    if (!n) return null;
    const h = n.heading * Math.PI / 180;
    const far = 9, near = 1.8, side = 2.5;
    const p = (d, s) => [n.x + Math.cos(h) * d - Math.sin(h) * s, n.y + Math.sin(h) * d + Math.cos(h) * s];
    const actor = this._makeActor({ type, speed: type === 'VEHICLE' ? 3 : 1.2, loop: false, path: [p(far, -side), p(near, -1), p(near, 1.2), p(far, side)] });
    actor.transient = true;
    this.actors.push(actor);
    events.log('SIM_INTRUDER', `Simulated ${type.toLowerCase()} approaching ${n.name}`, { nodeId: n.id });
    if (!this.timer && this.nodes.size === 0) {
      // no simulated nodes; still animate the actor so the map shows ground truth
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
    return actor;
  }

  /** Simulate the node body being lifted/kicked for 30 s. */
  triggerTamper(nodeId) {
    const sim = this.nodes.get(nodeId);
    if (!sim) return false;
    sim.tamperUntil = this.t + 30;
    events.log('SIM_TAMPER', `Simulated tamper on ${nodeId}`, { nodeId });
    return true;
  }

  _makeActor(def) {
    const a = { type: def.type, speed: def.speed || 1, cadence: def.cadence || 0.53, loop: def.loop !== false, path: def.path || [], idx: 0, x: 0, y: 0, moving: false, gain: def.gain || 1, done: false, stepTimes: [] };
    if (a.path.length) { a.x = a.path[0][0]; a.y = a.path[0][1]; a.idx = 1; }
    return a;
  }

  _moveActor(a, dt) {
    if (a.type === 'WIND' || !a.path.length || a.done) { a.moving = false; return; }
    const [tx, ty] = a.path[a.idx];
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    const step = a.speed * dt;
    if (d <= step) {
      a.x = tx; a.y = ty; a.idx++;
      if (a.idx >= a.path.length) {
        if (a.loop) a.idx = 0; else { a.done = true; a.moving = false; return; }
      }
    } else {
      a.x += dx / d * step; a.y += dy / d * step;
    }
    a.moving = true;
  }

  status() {
    return {
      running: this.running, scenario: this.scenario, scenarioLabel: (SCENARIOS[this.scenario] || {}).label,
      scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label })),
      nodes: Array.from(this.nodes.keys()),
      actors: this.actors.filter(a => a.type !== 'WIND').map(a => ({ type: a.type, x: Number(a.x.toFixed(2)), y: Number(a.y.toFixed(2)), moving: a.moving }))
    };
  }

  // ---- signal synthesis --------------------------------------------------
  /** Sense one actor from a probe at (px,py): returns per-sample amplitude contribution generator. */
  _probeGeom(px, py, a) {
    const d = Math.max(0.3, Math.hypot(a.x - px, a.y - py));
    return d;
  }

  _synthProbe(node, sim, probe, tStart, distFn) {
    const out = new Array(SAMPLES_PER_TICK);
    const dt = 1 / FS;
    for (let i = 0; i < SAMPLES_PER_TICK; i++) {
      const t = tStart + i * dt;
      let v = gauss() * sim.noise;
      for (const a of this.actors) {
        if (a.type === 'WIND') {
          sim.windState = (sim.windState || 0) * 0.92 + gauss() * 0.02 * a.gain;
          v += sim.windState * (1.5 + 0.8 * Math.sin(t * 0.4 + probe));
          continue;
        }
        if (!a.moving) continue;
        const d = distFn(a);
        if (d > 12) continue;
        const delay = d / WAVE_SPEED;                        // seismic propagation delay
        const amp0 = a.type === 'VEHICLE' ? 1.2 : 0.8;   // pulse amplitude (g) 1 m from a spiked probe
        const amp = amp0 * Math.pow(1 / d, ALPHA) * a.gain;
        if (a.type === 'HUMAN') {
          for (const ts of a.stepTimes) {
            const tau = t - ts - delay;
            if (tau >= 0 && tau < 0.45) v += amp * Math.exp(-tau * 14) * Math.sin(2 * Math.PI * 11 * tau);
          }
        } else if (a.type === 'VEHICLE') {
          const tt = t - delay;
          v += amp * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.8 * tt)) * (Math.sin(2 * Math.PI * 27 * tt) + 0.4 * Math.sin(2 * Math.PI * 54 * tt + 1));
        }
      }
      out[i] = v;
    }
    return out;
  }

  tick() {
    const dt = TICK_MS / 1000;
    this.t += dt;
    for (const a of this.actors) {
      this._moveActor(a, dt);
      if (a.type === 'HUMAN' && a.moving) {
        // schedule footsteps at ~1.9 Hz cadence
        const last = a.stepTimes.length ? a.stepTimes[a.stepTimes.length - 1] : this.t - 0.5;
        let next = last + a.cadence + gauss() * 0.03;
        while (next < this.t + dt) { a.stepTimes.push(next); next += a.cadence + gauss() * 0.03; }
        a.stepTimes = a.stepTimes.filter(ts => this.t - ts < 1.5);
      }
    }
    this.actors = this.actors.filter(a => !(a.transient && a.done));
    // a finished non-loop actor keeps standing where it stopped (loiter scenario) — the radar sees a stationary target

    for (const sim of this.nodes.values()) {
      const node = registry.get(sim.id);
      if (!node) continue;
      const probes = registry.probePositions(node);
      const tStart = this.t - dt;
      const wa = this._synthProbe(node, sim, 0, tStart, a => this._probeGeom(probes.a.x, probes.a.y, a));
      const wb = this._synthProbe(node, sim, 1, tStart, a => this._probeGeom(probes.b.x, probes.b.y, a));
      sim.bufA.push(...wa); sim.bufB.push(...wb);
      if (sim.bufA.length > 256) { sim.bufA.splice(0, sim.bufA.length - 256); sim.bufB.splice(0, sim.bufB.length - 256); }

      // radar: nearest moving actor inside the beam
      let radar = { ok: sim.radarOk, pres: false, mov: 0, dist: 0, eng: Math.round(Math.random() * 6), sdist: 0, seng: 0 };
      const h = node.heading;
      let nearest = null;
      for (const a of this.actors) {
        if (a.type === 'WIND') continue;
        const d = Math.hypot(a.x - node.x, a.y - node.y);
        let bearing = Math.atan2(a.y - node.y, a.x - node.x) * 180 / Math.PI - h;
        bearing = ((bearing + 540) % 360) - 180;
        if (d <= config.RADAR_MAX_M && Math.abs(bearing) <= config.RADAR_FOV_DEG / 2 && (!nearest || d < nearest.d)) nearest = { a, d };
      }
      if (nearest && Math.random() > 0.04) {
        radar.pres = true; radar.mov = nearest.a.moving ? 1 : 0;
        radar.dist = Number(clamp(nearest.d + gauss() * 0.15, 0.2, 8.5).toFixed(2));
        radar.eng = Math.round(clamp(100 * (1 - nearest.d / 9) * (0.75 + Math.random() * 0.25), 15, 100));
        if (!nearest.a.moving) { radar.sdist = radar.dist; radar.seng = radar.eng; radar.eng = Math.round(radar.eng * 0.3); }
      }

      // per-probe stats over the last 100 samples
      const stat = buf => {
        const w = buf.slice(-100);
        let ss = 0, pk = 0;
        for (const v of w) { ss += v * v; const av = Math.abs(v); if (av > pk) pk = av; }
        return { rms: Math.sqrt(ss / Math.max(1, w.length)), peak: pk };
      };
      const sa = stat(sim.bufA), sb = stat(sim.bufB);

      // cross-correlation lag between probes (±5 samples, parabolic refinement)
      const { lagMs, corr } = crossCorrelate(sim.bufA.slice(-128), sim.bufB.slice(-128), FS);

      // features + edge ML every 4 ticks (1 s), like the firmware
      if (this.t - sim.lastFeatT >= 1.0 && sim.bufA.length >= 128) {
        sim.lastFeatT = this.t;
        sim.features = extract(sim.bufA.slice(-128), FS);
        const res = this.pipeline.classifier.classify(sim.features);
        sim.ml = { c: ['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'].indexOf(res.label), p: Object.values(res.probs) };
      }

      // battery & radio drift
      sim.battery = Math.max(3, sim.battery - 0.0006);
      sim.rssi = clamp(sim.rssi + gauss() * 0.8, -92, -40);
      const staLtaA = sa.rms / Math.max(0.004, sim.noise * 1.1);
      const state = radar.pres && sa.rms > 0.03 ? 'EVENT' : (radar.pres || sa.rms > 0.03 ? 'SUSPECT' : 'IDLE');

      const f = sim.features;
      const tamperOn = sim.tamperUntil && this.t < sim.tamperUntil;
      const packet = {
        v: 2, id: sim.id, seq: ++sim.seq, up: Math.round(this.t * 1000), fw: '2.0.0-sim', tr: ['wifi', 'lora', 'ble'][SIM_PLACEMENTS.findIndex(p => p.id === sim.id) % 3],
        rssi: Math.round(sim.rssi), mode: sim.mode, st: state,
        bat: { v: Number(percentToVoltage(sim.battery).toFixed(2)), p: Math.round(sim.battery) },
        radar,
        a: { ok: true, x: Number((0.01 * gauss()).toFixed(3)), y: Number((0.01 * gauss()).toFixed(3)), z: Number((0.99 + 0.01 * gauss()).toFixed(3)), rms: Number(sa.rms.toFixed(4)), peak: Number(sa.peak.toFixed(4)), sl: Number(staLtaA.toFixed(2)) },
        b: { ok: true, x: Number((0.01 * gauss()).toFixed(3)), y: Number((0.01 * gauss()).toFixed(3)), z: Number((0.98 + 0.01 * gauss()).toFixed(3)), rms: Number(sb.rms.toFixed(4)), peak: Number(sb.peak.toFixed(4)), sl: Number((sb.rms / Math.max(0.004, sim.noise * 1.1)).toFixed(2)) },
        seis: { lag: Number(lagMs.toFixed(2)), corr: Number(corr.toFixed(3)), ratio: Number((sa.rms / Math.max(1e-4, sb.rms)).toFixed(3)),
          f: f ? [f.rms, f.peak, f.peakToPeak, f.variance, f.dominantFrequency, f.spectralEnergy, f.spectralCentroid, f.interPeakInterval, f.zeroCrossingRate, f.crestFactor] : undefined },
        ml: sim.ml || undefined,
        wave: { fs: FS, a: wa.map(v => Math.round(v * 1000)), b: wb.map(v => Math.round(v * 1000)) },
        tamper: { tilt: tamperOn ? Number((34 + gauss() * 2).toFixed(1)) : Number(Math.abs(gauss() * 0.4).toFixed(1)), flag: Boolean(tamperOn), imp: Boolean(tamperOn && this.t < sim.tamperUntil - 20) },
        nf: Number((sim.noise * 1.05).toFixed(5)),
        sys: { heap: 180000 + Math.round(Math.random() * 4000), tmp: Number((sim.tempC + gauss() * 0.1).toFixed(1)) }
      };
      try {
        const resp = this.pipeline.ingest(packet, { simulated: true, source: 'sim' });
        if (resp.cmd && resp.cmd.mode) sim.mode = resp.cmd.mode;
      } catch (err) {
        console.error('[sim] ingest failed', err.message);
      }
    }
    // ground truth for the map ("where the actor really is")
    realtime.broadcast('sim', this.status());
  }
}

/** Normalised cross-correlation of b against a over ±maxLag samples, parabolic sub-sample refinement. */
function crossCorrelate(a, b, fs, maxLag = 5) {
  const n = Math.min(a.length, b.length);
  if (n < 32) return { lagMs: 0, corr: 0 };
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ea = 0, eb = 0;
  for (let i = 0; i < n; i++) { ea += (a[i] - ma) ** 2; eb += (b[i] - mb) ** 2; }
  const norm = Math.sqrt(ea * eb) || 1e-9;
  const corrs = [];
  let best = 0, bestLag = 0;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j < 0 || j >= n) continue;
      s += (a[i] - ma) * (b[j] - mb);
    }
    const c = s / norm;
    corrs.push(c);
    if (c > best) { best = c; bestLag = lag; }
  }
  // parabolic interpolation around the peak
  const k = bestLag + maxLag;
  let frac = 0;
  if (k > 0 && k < corrs.length - 1) {
    const y0 = corrs[k - 1], y1 = corrs[k], y2 = corrs[k + 1];
    const den = y0 - 2 * y1 + y2;
    if (Math.abs(den) > 1e-9) frac = 0.5 * (y0 - y2) / den;
  }
  // lag>0 means b lags a (b[j] = a[i] with j>i) → A heard it first
  return { lagMs: (bestLag + frac) * 1000 / fs, corr: Math.max(0, best) };
}

module.exports = { Simulator, SCENARIOS, crossCorrelate };
