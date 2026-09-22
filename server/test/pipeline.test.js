'use strict';
/**
 * Server unit tests — run with `npm test` (node --test, no extra dependencies).
 * They exercise the DSP/ML contract, the localiser geometry, the fusion guard rails
 * and the ingest pipeline end-to-end (without network or timers mattering).
 */
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), `cybercc-test-${process.pid}`);
process.env.SIM_NODES = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extract, FEATURE_ORDER } = require('../src/ml/features');
const { VibrationClassifier } = require('../src/ml/classifier');
const localization = require('../src/services/localization');
const fusion = require('../src/services/fusion');
const registry = require('../src/services/registry');
const pipeline = require('../src/services/pipeline');
const { crossCorrelate } = require('../src/services/simulator');

function footsteps(n = 128, fs = 100, amp = 0.3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    let v = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.01; // deterministic pseudo-noise
    for (let k = 0; k < 4; k++) {
      const tau = t - (0.1 + k * 0.53);
      if (tau >= 0 && tau < 0.45) v += amp * Math.exp(-tau * 14) * Math.sin(2 * Math.PI * 11 * tau);
    }
    out.push(v);
  }
  return out;
}

function engine(n = 128, fs = 100, amp = 0.4) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    out.push(amp * Math.sin(2 * Math.PI * 27 * t) + 0.3 * amp * Math.sin(2 * Math.PI * 54 * t + 1));
  }
  return out;
}

test('feature extractor returns the 10-feature contract with sane values', () => {
  const f = extract(footsteps());
  assert.deepEqual(Object.keys(f), FEATURE_ORDER);
  assert.ok(f.rms > 0.03 && f.rms < 0.2, `rms ${f.rms}`);
  assert.ok(f.dominantFrequency > 5 && f.dominantFrequency < 20, `dominant ${f.dominantFrequency}`);
  assert.ok(f.interPeakInterval > 450 && f.interPeakInterval < 600, `ipi ${f.interPeakInterval}`);
  assert.ok(f.crestFactor > 2, `crest ${f.crestFactor}`);
});

test('random forest separates footsteps, engine rumble and silence', () => {
  const clf = new VibrationClassifier();
  assert.ok(clf.loaded, 'model file must load');
  assert.equal(clf.classify(extract(footsteps())).label, 'HUMAN');
  assert.equal(clf.classify(extract(engine())).label, 'VEHICLE');
  const quiet = Array.from({ length: 128 }, (_, i) => 0.004 * Math.sin(i * 7.3));
  assert.equal(clf.classify(extract(quiet)).label, 'NORMAL');
});

test('cross-correlation recovers a 2-sample lag with sub-sample precision', () => {
  const a = footsteps();
  const b = a.map((_, i) => (i >= 2 ? a[i - 2] : 0));
  const r = crossCorrelate(a, b, 100, 5);
  assert.ok(Math.abs(r.lagMs - 20) < 2, `lag ${r.lagMs}`);
  assert.ok(r.corr > 0.9);
});

test('localiser: radar range + TDOA puts the target on the correct side', () => {
  const node = { x: 10, y: 10, heading: 90, spacing: 1.5 }; // facing north
  const base = { radar: { ok: true, presence: true, distance: 4, energy: 60 }, seismic: { corr: 0.9, lagMs: 0 } };
  // probe A (left = west) louder and earlier → target is to the LEFT of heading → west of north → x < 10
  const left = localization.estimate(node, { ...base, probes: [{ ok: true, rms: 0.08 }, { ok: true, rms: 0.05 }], seismic: { corr: 0.9, lagMs: 3 } });
  assert.ok(left.x < 10 && left.y > 10, `left estimate ${JSON.stringify(left)}`);
  assert.ok(Math.abs(Math.hypot(left.x - 10, left.y - 10) - 4) < 0.01, 'range must equal radar distance');
  const right = localization.estimate(node, { ...base, probes: [{ ok: true, rms: 0.05 }, { ok: true, rms: 0.08 }], seismic: { corr: 0.9, lagMs: -3 } });
  assert.ok(right.x > 10 && right.y > 10, `right estimate ${JSON.stringify(right)}`);
  assert.equal(left.bearingSource, 'tdoa+ratio');
});

test('localiser: seismic-only estimate falls back to energy range and lower confidence', () => {
  const node = { x: 0, y: 0, heading: 0, spacing: 1.5 };
  const est = localization.estimate(node, { radar: { ok: true, presence: false, distance: 0, energy: 0 }, probes: [{ ok: true, rms: 0.05 }, { ok: true, rms: 0.05 }], seismic: { corr: 0.2, lagMs: 0 } });
  assert.equal(est.rangeSource, 'seismic-energy');
  assert.ok(est.confidence < 0.6);
  assert.ok(est.rangeM > 1 && est.rangeM <= 8);
});

test('fusion: a single modality can never reach the alert threshold', () => {
  const t = {
    radar: { ok: true, presence: true, distance: 3, energy: 90 },
    probes: [{ ok: true, rms: 0.005 }, { ok: true, rms: 0.005 }],
    seismic: { corr: 0.1 }
  };
  const r = fusion.evaluate(t, null);
  assert.ok(!r.isAlertCandidate, `radar-only p=${r.probability}`);
  const full = fusion.evaluate({ ...t, probes: [{ ok: true, rms: 0.06 }, { ok: true, rms: 0.05 }], seismic: { corr: 0.85 } },
    { label: 'HUMAN', probs: { NORMAL: 0.02, HUMAN: 0.9, VEHICLE: 0.04, ENVIRONMENT: 0.04 } });
  assert.ok(full.isAlertCandidate && full.probability > 0.85, `full evidence p=${full.probability}`);
  assert.equal(full.targetClass, 'HUMAN');
});

test('fusion: environmental classification with a clear radar is suppressed', () => {
  const r = fusion.evaluate({ radar: { ok: true, presence: false, distance: 0, energy: 0 }, probes: [{ ok: true, rms: 0.2 }, { ok: true, rms: 0.18 }], seismic: { corr: 0.7 } },
    { label: 'ENVIRONMENT', probs: { NORMAL: 0.05, HUMAN: 0.05, VEHICLE: 0.05, ENVIRONMENT: 0.85 } });
  assert.ok(r.probability <= 0.4, `wind p=${r.probability}`);
});

test('ingest pipeline: v2 packet creates the node, classifies and localises; alert after debounce', () => {
  const packet = (seq) => ({
    v: 2, id: 'T1', seq, up: seq * 1000, fw: '2.0.0', tr: 'wifi', rssi: -60, mode: 'LIVE', st: 'EVENT',
    bat: { v: 3.9, p: 75 }, radar: { ok: true, pres: true, mov: 1, dist: 3.5, eng: 70 },
    a: { ok: true, x: 0, y: 0, z: 1, rms: 0.07, peak: 0.2, sl: 4 }, b: { ok: true, x: 0, y: 0, z: 1, rms: 0.05, peak: 0.15, sl: 3 },
    seis: { lag: 2.5, corr: 0.8, ratio: 1.4 },
    wave: { fs: 100, a: footsteps(64).map(v => Math.round(v * 1000)), b: footsteps(64).map(v => Math.round(v * 1000)) }
  });
  const r1 = pipeline.ingest(packet(1));
  assert.equal(r1.ok, true);
  const node = registry.get('T1');
  assert.ok(node && node.status === 'ONLINE');
  const r2 = pipeline.ingest(packet(2));
  assert.equal(r2.level, 'INTRUSION');
  assert.ok(r2.alert, 'second consecutive intrusion packet must raise an alert');
  assert.ok(node.position && node.position.rangeSource === 'radar');
  assert.equal(node.latest.battery.percent, 75);
  assert.ok(node.waveA.length >= 64);
});

test('ingest pipeline: legacy v1 packet is accepted', () => {
  const r = pipeline.ingest({ nodeId: 'LEGACY', sequence: 1, battery: { voltage: 3.7, percentage: 40 }, signal: { rssi: -80 }, radar: { presence: false, distance: 0, confidence: 0 },
    accelerometer: { sensor1: { x: 0, y: 0, z: 1, vibrationRms: 0.01 }, sensor2: { x: 0, y: 0, z: 1, vibrationRms: 0.01 } }, eventState: 'NORMAL' });
  assert.equal(r.ok, true);
  assert.equal(r.level, 'CLEAR');
});

test('ingest pipeline: invalid packets are rejected', () => {
  assert.throws(() => pipeline.ingest({ seq: 1 }), /node id/);
  assert.throws(() => pipeline.ingest({ id: 'bad id!' }), /node id/);
});

// ---- v2.1 features ------------------------------------------------------------
const zones = require('../src/services/zones');
const { intersectCircles, Tracks } = require('../src/services/tracks');
const arming = require('../src/services/arming');
const alertsSvc = require('../src/services/alerts');

test('zones: point-in-polygon and priority', () => {
  const z1 = zones.create({ name: 'yard', type: 'watch', points: [[0, 0], [20, 0], [20, 20], [0, 20]] });
  const z2 = zones.create({ name: 'vault', type: 'restricted', points: [[5, 5], [10, 5], [10, 10], [5, 10]] });
  assert.equal(zones.locate(7, 7).id, z2.id, 'restricted wins inside the overlap');
  assert.equal(zones.locate(15, 15).id, z1.id);
  assert.equal(zones.locate(30, 30), null);
  zones.remove(z1.id); zones.remove(z2.id);
});

test('tracks: two radar ranges triangulate to the true point', () => {
  const nodeA = { x: 0, y: 0 }, nodeB = { x: 10, y: 0 };
  const truth = { x: 4, y: 3 };
  const rA = Math.hypot(truth.x - nodeA.x, truth.y - nodeA.y), rB = Math.hypot(truth.x - nodeB.x, truth.y - nodeB.y);
  const cands = intersectCircles({ ...nodeA, r: rA }, { ...nodeB, r: rB });
  assert.ok(cands.some(c => Math.abs(c.x - truth.x) < 0.01 && Math.abs(c.y - truth.y) < 0.01));
  const fusion = { probability: 0.9, level: 'INTRUSION', targetClass: 'HUMAN' };
  const now = Date.now();
  const tracks = new Tracks();
  tracks.update('A', { x: 3.5, y: 3.6, confidence: 0.8, sigmaRangeM: 0.4, rangeSource: 'radar' }, fusion, now, { node: nodeA, radarRange: rA, allNodes: [] });
  const tr = tracks.update('B', { x: 4.4, y: 2.6, confidence: 0.8, sigmaRangeM: 0.4, rangeSource: 'radar' }, fusion, now + 200, { node: nodeB, radarRange: rB, allNodes: [] });
  assert.equal(tr.method, 'triangulated');
  assert.ok(Math.hypot(tr.x - truth.x, tr.y - truth.y) < 0.2, `triangulated ${tr.x},${tr.y}`);
});

test('tracks: kinematics give speed, heading, prediction and ETA to the next node', () => {
  const fusion = { probability: 0.9, level: 'INTRUSION', targetClass: 'HUMAN' };
  const t0 = Date.now() + 100000;
  const nodes = [{ id: 'N9', name: 'Gate', x: 30, y: 10 }];
  const tracks = new Tracks();
  let tr;
  for (let i = 0; i <= 4; i++) {
    tr = tracks.update('K', { x: 10 + i * 0.6, y: 10, confidence: 0.8, sigmaRangeM: 0.4, rangeSource: 'radar' }, fusion, t0 + i * 500, { node: { x: 10, y: 8 }, allNodes: nodes });
  }
  assert.ok(tr.speed > 0.8 && tr.speed < 1.6, `speed ${tr.speed}`);
  assert.ok(Math.abs(tr.headingDeg) < 10 || Math.abs(tr.headingDeg - 360) < 10, `heading ${tr.headingDeg}`);
  assert.ok(tr.predicted && tr.predicted.x > tr.x);
  assert.ok(tr.eta && tr.eta.nodeId === 'N9' && tr.eta.etaS > 0, `eta ${JSON.stringify(tr.eta)}`);
});

test('arming: DISARMED suppresses intrusion alerts, TEST flags them', () => {
  const node = { id: 'ARM1', name: 'arm test', simulated: true };
  const fusion = { isAlertCandidate: true, probability: 0.95, severity: 'CRITICAL', targetClass: 'HUMAN', evidence: [] };
  const ctx = { telemetry: null, position: null, zone: null, track: null, ml: null, fusion };
  arming.set('DISARMED', 'test');
  assert.equal(alertsSvc.process(node, fusion, ctx), null);
  assert.equal(alertsSvc.process(node, fusion, ctx), null);
  arming.set('TEST', 'test');
  alertsSvc.process(node, fusion, ctx);
  const a = alertsSvc.process(node, fusion, ctx);
  assert.ok(a && a.test === true && a.kind === 'INTRUSION');
  arming.set('ARMED', 'test');
});

test('alerts: tamper raises its own kind even when disarmed', () => {
  arming.set('DISARMED', 'test');
  const a = alertsSvc.raiseTamper({ id: 'TMP1', name: 'tamper test', simulated: true }, { tilt: 33, flag: true, impact: false }, {});
  assert.ok(a && a.kind === 'TAMPER' && a.severity === 'HIGH');
  arming.set('ARMED', 'test');
});
