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

class Fusion {
  constructor() {
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

    // guard rails: a single modality can never exceed the alert threshold on its own
    const seismicSaysSomething = f.dualCorroboration || f.s1Rms > 0.05 || f.s2Rms > 0.05;
    const modalities = (f.radarPresence ? 1 : 0) + (seismicSaysSomething ? 1 : 0) + ((f.pHuman + f.pVehicle) > 0.6 ? 1 : 0);
    let note = null;
    if (modalities < 2 && prob >= config.ALERT_THRESHOLD) {
      prob = config.ALERT_THRESHOLD - 0.05;
      note = 'Held below alert threshold: only one modality active';
    }
    if (f.pEnvironment > 0.75 && !f.radarPresence) {
      prob = Math.min(prob, 0.4);
      note = 'Suppressed: ML classifies vibration as environmental and radar is clear';
    }
    prob = Number(prob.toFixed(3));

    let level = 'CLEAR', severity = 'INFO';
    if (prob >= config.CRITICAL_THRESHOLD) { level = 'INTRUSION'; severity = 'CRITICAL'; }
    else if (prob >= config.ALERT_THRESHOLD) { level = 'INTRUSION'; severity = 'HIGH'; }
    else if (prob >= 0.5) { level = 'SUSPECT'; severity = 'MEDIUM'; }
    else if (prob >= 0.3) { level = 'ACTIVITY'; severity = 'LOW'; }

    let targetClass = 'UNKNOWN';
    if (ml && ml.label === 'HUMAN') targetClass = 'HUMAN';
    else if (ml && ml.label === 'VEHICLE') targetClass = 'VEHICLE';
    else if (f.radarPresence) targetClass = 'HUMAN'; // the radar is tuned for people

    evidence.sort((p, q) => Math.abs(q.contribution) - Math.abs(p.contribution));
    return {
      probability: prob, level, severity, targetClass, note,
      radarActive: Boolean(f.radarPresence), dualSeismic: Boolean(f.dualCorroboration),
      evidence, mlLabel: ml ? ml.label : null, mlSource: ml ? ml.source : null,
      isAlertCandidate: prob >= config.ALERT_THRESHOLD
    };
  }
}

module.exports = new Fusion();
