'use strict';
/**
 * Multi-modal fusion: radar + probe A + probe B + edge/server ML → intrusion probability.
 *
 * The decision comes from a logistic-regression model (ml/models/fusion_lr.json) so the
 * evidence terms are additive in logit space and can be shown to the operator.
 * A rule layer guards the model: no alert can be raised on a single modality alone.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

const LABELS = {
  radarPresence: 'Radar presence',
  radarDistanceNorm: 'Radar range (near=strong)',
  radarEnergy: 'Radar motion energy',
  s1Rms: 'Probe A vibration',
  s2Rms: 'Probe B vibration',
  dualCorroboration: 'Both probes agree',
  seismicCorr: 'Probe cross-correlation',
  pHuman: 'ML: human footsteps',
  pVehicle: 'ML: vehicle',
  pEnvironment: 'ML: environmental (suppresses)'
};

// Demo sensitivity levels (real hardware only). Instead of a fixed 0.02 g floor (footsteps on a
// floor or table are only ~0.003-0.01 g), each probe is compared with that node's own quiet
// level, and one clear modality (a footstep OR a radar target) is enough to raise an alert.
//   ultra  catches a normal footstep within a few metres
//   max    catches a light step, a tap or a finger knock; expect false alarms from doors and bags
const LEVELS = {
  ultra: {
    STEP_RATIO: 1.4,       // RMS this many times the node's quiet level = a footstep
    BOTH_RATIO: 1.25,      // both probes above this = corroborated
    PEAK_RATIO: 1.5,       // or a peak this many times the node's quiet peak
    MIN_PEAK_G: 0.005,     // ...and at least this big in absolute terms
    MIN_FLOOR_G: 0.0015,   // quiet level never assumed below this
    STALTA: 1.6,           // or the node's own short/long-term ratio on either probe (a single step's spike)
    RADAR_MIN_ENERGY: 8,
    CAL_PACKETS: 80,       // quiet packets averaged before footstep alarms start (~20 s in LIVE)
    BASE_ALPHA: 0.01,      // slow drift tracking after calibration (only while nothing is detected)
    ALERT: 0.5, CRITICAL: 0.85
  },
  max: {
    STEP_RATIO: 1.15,
    BOTH_RATIO: 1.1,
    PEAK_RATIO: 1.2,
    MIN_PEAK_G: 0.0035,
    MIN_FLOOR_G: 0.001,
    STALTA: 1.3,
    RADAR_MIN_ENERGY: 2,
    CAL_PACKETS: 120,      // ~30 s in LIVE
    BASE_ALPHA: 0.005,
    ALERT: 0.45, CRITICAL: 0.8
  }
};

class Fusion {
  constructor() {
    this.base = new Map();   // nodeId -> { rms, peak, n } quiet level (g); n = calibration packets seen
    this.model = null;
    try {
      this.model = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ml', 'models', 'fusion_lr.json'), 'utf8'));
      console.log(`[ml] fusion LR loaded (${this.model.features.length} inputs, trained ${this.model.meta && this.model.meta.trainedAt})`);
    } catch (err) {
      console.warn('[ml] fusion model missing, using heuristic weights:', err.message);
    }
  }

  _features(t, ml) {
    const radar = t.radar;
    const [a, b] = t.probes;
    const floor = config.PROBE_NOISE_FLOOR_G;
    const radarActive = radar.ok && radar.presence && radar.distance > 0.1;
    return {
      radarPresence: radarActive ? 1 : 0,
      radarDistanceNorm: radarActive ? Math.min(1, radar.distance / config.RADAR_MAX_M) : 1,
      radarEnergy: radarActive ? radar.energy / 100 : 0,
      s1Rms: a.ok ? a.rms : 0,
      s2Rms: b.ok ? b.rms : 0,
      dualCorroboration: (a.ok && b.ok && a.rms > floor && b.rms > floor) ? 1 : 0,
      seismicCorr: Math.max(0, Math.min(1, t.seismic.corr || 0)),
      pHuman: ml ? (ml.probs.HUMAN || 0) : 0,
      pVehicle: ml ? (ml.probs.VEHICLE || 0) : 0,
      pEnvironment: ml ? (ml.probs.ENVIRONMENT || 0) : 0
    };
  }

  /** Demo sensitivity: footstep vs this node's own quiet level, or any radar target. */
  _ultra(t, f, P) {
    const id = t.nodeId || t.id || 'node';
    const [a, b] = t.probes;
    const rmsA = a.ok ? a.rms : 0, rmsB = b.ok ? b.rms : 0;
    const peak = Math.max(a.ok ? (a.peak || 0) : 0, b.ok ? (b.peak || 0) : 0);
    const rms = Math.max(rmsA, rmsB);
    const staLta = Math.max(a.ok ? (a.staLta || 0) : 0, b.ok ? (b.staLta || 0) : 0);
    const radar = Boolean(f.radarPresence) && f.radarEnergy * 100 >= P.RADAR_MIN_ENERGY;

    // Calibration: the quiet level is the MEDIAN of the first CAL_PACKETS packets, so brief
    // footsteps and a person standing nearby don't inflate it. Until then footsteps cannot alarm
    // (radar targets still do).
    let base = this.base.get(id);
    if (!base) { base = { rms: 0, peak: 0, n: 0, rmsS: [], peakS: [] }; this.base.set(id, base); }
    if (base.n < P.CAL_PACKETS) {
      base.n++; base.rmsS.push(rms); base.peakS.push(peak);
      if (base.n === P.CAL_PACKETS) {
        const med = (xs) => { const v = xs.slice().sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
        base.rms = med(base.rmsS); base.peak = med(base.peakS); base.rmsS = null; base.peakS = null;
      }
      const pct = Math.round(100 * base.n / P.CAL_PACKETS);
      if (base.n < P.CAL_PACKETS) {
        return radar
          ? { hit: true, score: 0.87, ratio: 0, reason: `radar target ${t.radar.distance.toFixed(1)} m (probes calibrating ${pct}%)` }
          : { hit: false, score: 0, ratio: 0, reason: `calibrating quiet level ${pct}%`, calibrating: pct };
      }
    }

    const floor = Math.max(P.MIN_FLOOR_G, base.rms);
    const peakFloor = Math.max(P.MIN_FLOOR_G * 2, base.peak);
    const ratio = rms / floor;
    const spike = staLta >= P.STALTA && rms >= floor * 1.05;   // impulsive step the window RMS dilutes
    const step = ratio >= P.STEP_RATIO || spike || (peak >= P.MIN_PEAK_G && peak >= peakFloor * P.PEAK_RATIO);
    const both = rmsA / floor >= P.BOTH_RATIO && rmsB / floor >= P.BOTH_RATIO;
    // after calibration, follow slow drift only while nothing is happening
    if (!step && !radar) { base.rms += P.BASE_ALPHA * (rms - base.rms); base.peak += P.BASE_ALPHA * (peak - base.peak); }

    // a detection in demo mode scores ~0.85-0.90: 0.85-0.87 for one sensor, 0.90 when both agree
    let score = 0, reason = '';
    if (step) {
      score = 0.85 + (both ? 0.01 : 0) + 0.01 * Math.min(1, (ratio - P.STEP_RATIO) / 3);
      reason = `footstep ${ratio.toFixed(1)}x quiet level${spike ? `, STA/LTA ${staLta.toFixed(1)}` : ''}${both ? ' on both probes' : ''}`;
    }
    if (radar) {
      const r = 0.86 + 0.01 * Math.min(1, f.radarEnergy);
      if (r > score) { score = r; reason = `radar target ${t.radar.distance.toFixed(1)} m`; }
    }
    if (step && radar) { score = 0.9; reason = `footstep ${ratio.toFixed(1)}x quiet + radar ${t.radar.distance.toFixed(1)} m`; }
    return { hit: step || radar, score: Math.min(0.9, score), ratio, reason };
  }

  /** Forget learned quiet levels so every node recalibrates (all nodes, or one). */
  recalibrate(nodeId) { if (nodeId) this.base.delete(nodeId); else this.base.clear(); }

  /** Calibration progress per node for the current level, 0-100. */
  calibration() {
    const P = LEVELS[config.SENSITIVITY];
    if (!P) return {};
    const out = {};
    for (const [id, b] of this.base) out[id] = { percent: Math.min(100, Math.round(100 * b.n / P.CAL_PACKETS)), quietRmsG: Number(b.rms.toFixed(4)), quietPeakG: Number(b.peak.toFixed(4)) };
    return out;
  }

  evaluate(t, ml) {
    const f = this._features(t, ml);
    let prob, evidence = [];
    if (this.model) {
      let z = this.model.bias;
      this.model.features.forEach((name, i) => {
        const xn = (f[name] - this.model.mean[i]) / this.model.std[i];
        const c = this.model.weights[i] * xn;
        z += c;
        evidence.push({ key: name, label: LABELS[name] || name, value: Number(f[name].toFixed(3)), contribution: Number(c.toFixed(2)) });
      });
      prob = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
    } else {
      // heuristic fallback
      let score = 0;
      if (f.radarPresence) score += 0.35 + 0.15 * f.radarEnergy;
      score += Math.min(0.15, f.s1Rms * 1.5) + Math.min(0.15, f.s2Rms * 1.5);
      if (f.dualCorroboration) score += 0.1;
      score += 0.2 * Math.max(f.pHuman, f.pVehicle) - 0.25 * f.pEnvironment;
      prob = Math.max(0, Math.min(0.98, score));
      evidence = Object.keys(f).map(k => ({ key: k, label: LABELS[k], value: Number(f[k].toFixed(3)), contribution: 0 }));
    }

    const P = t.simulated ? null : LEVELS[config.SENSITIVITY];   // real hardware only
    const ultraOn = Boolean(P);
    const ultra = ultraOn ? this._ultra(t, f, P) : null;
    if (ultra && ultra.score > prob) {
      prob = ultra.score;
      evidence.unshift({ key: 'ultra', label: `${config.SENSITIVITY === 'max' ? 'Max' : 'Ultra'} sensitivity: ${ultra.reason}`, value: Number(ultra.ratio.toFixed(2)), contribution: 0 });
    }
    const alertAt = ultraOn ? P.ALERT : config.ALERT_THRESHOLD;
    const criticalAt = ultraOn ? P.CRITICAL : config.CRITICAL_THRESHOLD;

    // guard rails: a single modality can never exceed the alert threshold on its own
    // (relaxed in ultra demo mode, where a single footstep or radar target is enough)
    const seismicSaysSomething = f.dualCorroboration || f.s1Rms > 0.05 || f.s2Rms > 0.05;
    const modalities = (f.radarPresence ? 1 : 0) + (seismicSaysSomething ? 1 : 0) + ((f.pHuman + f.pVehicle) > 0.6 ? 1 : 0);
    let note = null;
    if (!ultra && modalities < 2 && prob >= config.ALERT_THRESHOLD) {
      prob = config.ALERT_THRESHOLD - 0.05;
      note = 'Held below alert threshold: only one modality active';
    }
    if (!(ultra && ultra.hit) && f.pEnvironment > 0.75 && !f.radarPresence) {
      prob = Math.min(prob, 0.4);
      note = 'Suppressed: ML classifies vibration as environmental and radar is clear';
    }
    prob = Number(prob.toFixed(3));

    let level = 'CLEAR', severity = 'INFO';
    if (prob >= criticalAt) { level = 'INTRUSION'; severity = 'CRITICAL'; }
    else if (prob >= alertAt) { level = 'INTRUSION'; severity = 'HIGH'; }
    else if (prob >= 0.5) { level = 'SUSPECT'; severity = 'MEDIUM'; }
    else if (prob >= 0.3) { level = 'ACTIVITY'; severity = 'LOW'; }

    let targetClass = 'UNKNOWN';
    if (ml && ml.label === 'HUMAN') targetClass = 'HUMAN';
    else if (ml && ml.label === 'VEHICLE') targetClass = 'VEHICLE';
    else if (f.radarPresence) targetClass = 'HUMAN'; // the radar is tuned for people
    else if (ultra && ultra.hit) targetClass = 'HUMAN'; // demo mode: a footstep

    evidence.sort((p, q) => Math.abs(q.contribution) - Math.abs(p.contribution));
    return {
      probability: prob, level, severity, targetClass,
      radarActive: Boolean(f.radarPresence), dualSeismic: Boolean(f.dualCorroboration),
      evidence, mlLabel: ml ? ml.label : null, mlSource: ml ? ml.source : null,
      note: (ultra && ultra.calibrating != null) ? `Calibrating quiet level ${ultra.calibrating}% (keep still)` : (ultra && ultra.hit) ? `${config.SENSITIVITY === 'max' ? 'Max' : 'Ultra'}-sensitive demo mode: ${ultra.reason}` : note,
      isAlertCandidate: prob >= alertAt
    };
  }
}

module.exports = new Fusion();
module.exports.LEVELS = LEVELS;
