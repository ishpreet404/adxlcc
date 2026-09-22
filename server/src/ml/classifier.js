'use strict';
/**
 * Random-forest vibration classifier (inference only).
 * Loads ml/models/vibration_rf.json produced by ml/train.py.
 * Evaluation cost: ~8 trees × ≤6 comparisons — microseconds.
 */
const fs = require('fs');
const path = require('path');
const { FEATURE_ORDER, toVector } = require('./features');

const DEFAULT_CLASSES = ['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'];

class VibrationClassifier {
  constructor(modelPath) {
    this.classes = DEFAULT_CLASSES;
    this.trees = [];
    this.meta = {};
    this.loaded = false;
    this.load(modelPath || path.join(__dirname, 'models', 'vibration_rf.json'));
  }

  load(p) {
    try {
      const m = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (m.type !== 'random_forest' || !Array.isArray(m.trees)) throw new Error('bad model file');
      const order = m.features || FEATURE_ORDER;
      if (order.join(',') !== FEATURE_ORDER.join(',')) {
        console.warn('[ml] model feature order differs from server extractor; remapping');
      }
      this.featureOrder = order;
      this.classes = m.classes || DEFAULT_CLASSES;
      this.trees = m.trees;
      this.meta = m.meta || {};
      this.loaded = true;
      console.log(`[ml] vibration RF loaded: ${this.trees.length} trees, classes=${this.classes.join('/')}, trained ${this.meta.trainedAt || '?'}`);
    } catch (err) {
      console.warn(`[ml] could not load vibration model (${err.message}); using rule fallback`);
      this.loaded = false;
    }
  }

  _walk(node, x) {
    while (node.p === undefined) node = x[node.f] <= node.t ? node.l : node.r;
    return node.p;
  }

  /** @returns {{label:string, probs:Object, confidence:number, source:string}} */
  classify(features) {
    const x = this.featureOrder ? this.featureOrder.map(k => Number(features[k]) || 0) : toVector(features);
    if (!this.loaded) return this._fallback(features);
    const acc = new Array(this.classes.length).fill(0);
    for (const t of this.trees) {
      const p = this._walk(t, x);
      for (let c = 0; c < acc.length; c++) acc[c] += p[c];
    }
    let best = 0;
    for (let c = 0; c < acc.length; c++) {
      acc[c] /= this.trees.length;
      if (acc[c] > acc[best]) best = c;
    }
    const probs = {};
    this.classes.forEach((name, i) => { probs[name] = Number(acc[i].toFixed(3)); });
    return { label: this.classes[best], confidence: Number(acc[best].toFixed(3)), probs, source: 'server-rf' };
  }

  _fallback(f) {
    let label = 'NORMAL';
    if (f.rms < 0.03) label = 'NORMAL';
    else if (f.dominantFrequency >= 15 && f.spectralCentroid > 14) label = 'VEHICLE';
    else if (f.interPeakInterval >= 350 && f.interPeakInterval <= 800 && f.crestFactor > 2.5) label = 'HUMAN';
    else label = 'ENVIRONMENT';
    const probs = {};
    for (const c of this.classes) probs[c] = c === label ? 0.7 : 0.1;
    return { label, confidence: 0.7, probs, source: 'server-rules' };
  }

  explain(label, f) {
    const r = (v, d = 3) => Number(v || 0).toFixed(d);
    switch (label) {
      case 'HUMAN':
        return `Impulsive rhythmic strikes: cadence ${r(f.interPeakInterval, 0)} ms, crest ${r(f.crestFactor, 1)}, dominant ${r(f.dominantFrequency, 1)} Hz, RMS ${r(f.rms)} g`;
      case 'VEHICLE':
        return `Continuous rumble: dominant ${r(f.dominantFrequency, 1)} Hz, centroid ${r(f.spectralCentroid, 1)} Hz, energy ${r(f.spectralEnergy, 4)}`;
      case 'ENVIRONMENT':
        return `Broadband aperiodic noise: centroid ${r(f.spectralCentroid, 1)} Hz, ZCR ${r(f.zeroCrossingRate, 0)} Hz, no stable cadence`;
      default:
        return `Ambient floor: RMS ${r(f.rms, 4)} g, peak ${r(f.peak, 4)} g`;
    }
  }
}

module.exports = { VibrationClassifier };
