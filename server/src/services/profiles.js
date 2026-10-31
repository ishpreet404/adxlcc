'use strict';
/**
 * Deployment profiles ("missions"). The same hardware is deployed for very different jobs;
 * a profile changes what the system looks for, how it labels detections, and how it reacts.
 *
 *   nuclear   Nuclear exclusion zone: unmanned wildlife monitoring, people are critical.
 *   border    Border & tunnel watch: rhythmic subsurface digging with no surface target.
 *   retail    Jewelry store after hours: drilling/cutting on walls or the vault, intruders.
 *   perimeter General perimeter (default behaviour).
 *
 * interpret() layers profile-specific, explainable heuristics on top of the fusion engine.
 * They use the same 15 seismic features + radar the ML already uses; thresholds were set
 * from observed ranges (ambient: rms ~0.003-0.01 g, irregular, high-band ratio ~0.5;
 * footsteps: ~550 ms between impacts, cadence > 0.35, low high-band ratio).
 */
const store = require('./store');
const realtime = require('./realtime');
const events = require('./events');

const PROFILES = {
  nuclear: {
    id: 'nuclear', name: 'Nuclear Exclusion Zone', short: 'NUCLEAR',
    tagline: 'Unmanned wildlife and intrusion monitoring inside a radiation hazard area',
    description: 'Seismic probes and radar watch the boundary of an exclusion zone so no guard has to stand in a radiation area. Animals are told apart from people by their gait, so wildlife can be deterred automatically while any person is escalated as critical.',
    why: 'Replaces human guards in a radiation hazard area where long shifts are unsafe.',
    icon: 'radiation',
    targets: ['ANIMAL', 'HUMAN', 'VEHICLE'],
    detects: ['Wildlife approaching or entering the zone', 'Unauthorized personnel (critical)', 'Vehicles at the boundary', 'Sensor tampering'],
    deterrent: 'audible', deterrentSeconds: 8,
    arming: 'Armed 24/7',
    labels: { ANIMAL: 'Wildlife in exclusion zone', HUMAN: 'Unauthorized person in hazard zone', VEHICLE: 'Vehicle in exclusion zone', TAMPER: 'Sensor tampering' },
    gemini: 'This is an unmanned nuclear exclusion zone. Animals are the most common cause of detections; any human presence is a safety-critical breach.'
  },
  border: {
    id: 'border', name: 'Border & Tunnel Watch', short: 'BORDER',
    tagline: 'Subsurface digging and covert crossing detection',
    description: 'Ground-coupled probes hear rhythmic digging below the surface even when the radar sees nothing above ground, the signature of tunnelling. Surface crossings are confirmed by radar and gait. Alarms are silent so intruders are not tipped off.',
    why: 'Tunnels are invisible to cameras and patrols; ground vibration is the earliest evidence.',
    icon: 'shield',
    targets: ['SUBSURFACE', 'HUMAN', 'VEHICLE'],
    detects: ['Rhythmic subsurface digging (possible tunnel)', 'Crossings on foot at the line', 'Vehicles at the line', 'Sensor tampering'],
    deterrent: 'silent', deterrentSeconds: 0,
    arming: 'Armed 24/7 · silent alarm',
    labels: { SUBSURFACE: 'Possible tunnelling activity', HUMAN: 'Border crossing on foot', VEHICLE: 'Vehicle at the border line', TAMPER: 'Sensor tampering' },
    gemini: 'This is a border sector watched for tunnelling and covert crossings. Alarms are silent so intruders are not alerted.'
  },
  retail: {
    id: 'retail', name: 'Jewelry Store After-Hours', short: 'JEWELRY',
    tagline: 'Vault, wall and showroom protection when the shop is closed',
    description: 'Probes mounted on the vault and shared walls pick up drilling, cutting and hammering; the radar covers the showroom floor. After hours, any presence or structural attack sounds the siren on the node and alerts the owner.',
    why: 'Most jewelry burglaries break in through a shared wall or the vault, not the front door.',
    icon: 'gem',
    targets: ['DRILLING', 'IMPACT', 'HUMAN'],
    detects: ['Drilling or cutting on walls and the vault', 'Hammering / forced-entry impacts', 'Intruder in the showroom after hours', 'Sensor tampering'],
    deterrent: 'audible', deterrentSeconds: 15,
    arming: 'Armed after hours (use the arming schedule)',
    labels: { DRILLING: 'Drilling or cutting on wall/vault', IMPACT: 'Forced-entry impact', VIBRATION: 'Vibration on wall/vault', HUMAN: 'Intruder in showroom', VEHICLE: 'Vehicle at storefront', TAMPER: 'Sensor tampering' },
    gemini: 'This is a jewelry store after closing time. Any presence or structural vibration is suspicious; drilling suggests a wall or vault attack.'
  },
  perimeter: {
    id: 'perimeter', name: 'General Perimeter', short: 'PERIMETER',
    tagline: 'Fence-line intrusion detection with radar and dual seismic probes',
    description: 'The default deployment: people and vehicles crossing a perimeter are detected, localised and tracked across nodes.',
    why: 'A low-power, camera-free alternative to patrols on long fence lines.',
    icon: 'fence',
    targets: ['HUMAN', 'VEHICLE'],
    detects: ['People crossing the perimeter', 'Vehicles', 'Loitering near a node', 'Sensor tampering'],
    deterrent: 'audible', deterrentSeconds: 10,
    arming: 'Armed 24/7',
    labels: { HUMAN: 'Intruder at the perimeter', VEHICLE: 'Vehicle intrusion', TAMPER: 'Sensor tampering' },
    gemini: 'This is a general perimeter fence line.'
  }
};

const saved = store.readJson('profile.json', null);
let activeId = saved && PROFILES[saved.id] ? saved.id : 'perimeter';
const track = new Map();   // nodeId -> { matchKind, count, ratios[] } for "sustained" detections
const gaitVotes = new Map(); // nodeId -> last 5 per-window human/not-human decisions (majority vote)

function get() { return PROFILES[activeId]; }
function list() { return Object.values(PROFILES); }

function set(id, by = 'operator') {
  if (!PROFILES[id]) throw new Error(`unknown profile: ${id}`);
  if (id !== activeId) {
    activeId = id;
    track.clear();
    gaitVotes.clear();
    store.writeJson('profile.json', { id, changedAt: Date.now(), by });
    events.log('PROFILE', `Mission set to ${PROFILES[id].name} by ${by}`, { severity: 'INFO' });
    realtime.broadcast('profile', get());
  }
  return get();
}

function sustained(nodeId, kind, matched, ratio) {
  const s = track.get(nodeId) || { kind: null, count: 0, ratios: [] };
  if (matched && s.kind === kind) { s.count++; s.ratios.push(ratio); if (s.ratios.length > 12) s.ratios.shift(); }
  else if (matched) { s.kind = kind; s.count = 1; s.ratios = [ratio]; }
  else if (s.kind === kind) { s.count = Math.max(0, s.count - 1); if (!s.count) s.kind = null; }
  track.set(nodeId, s);
  return s;
}

function std(a) {
  if (a.length < 2) return 0;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
}

/**
 * Interpret one packet under the active profile.
 * Returns { label, title, detail, severity?, raise?, kind? } or null (nothing of note).
 *   raise: the profile wants its own alert even though fusion did not cross the threshold
 *          (e.g. tunnelling is seismic-only, which fusion deliberately never alerts on).
 */
function interpret(nodeId, t, fusion, ml, features) {
  const p = get();
  const f = features || {};
  const radar = t.radar || {};
  const surface = Boolean(radar.presence && (radar.moving || radar.energy >= 20));
  const rms = Math.max(t.probes[0].rms || 0, t.probes[1].rms || 0);
  const peak = Math.max(t.probes[0].peak || 0, t.probes[1].peak || 0);
  const nf = t.noiseFloor || 0.004;
  const active = rms >= Math.max(0.012, 2.5 * nf);
  const ipi = f.interPeakInterval || 0, cad = f.cadenceStrength || 0, crest = f.crestFactor || 0;
  const hb = f.highBandRatio || 0, dom = f.dominantFrequency || 0, cent = f.spectralCentroid || 0;
  // Bipedal gait score (walking AND running). Calibrated on synthetic gaits: people step every
  // >= ~300 ms with a heavier, lower-pitched impact (more low-band energy, dominant <= ~12 Hz) and a
  // regular cadence; small animals step faster (~170-290 ms), lighter and higher-pitched (12-16 Hz).
  // Re-tune with labelled field recordings (Settings > Record) before an operational deployment.
  const lb = f.lowBandRatio || 0;
  const gaitScore = (ipi >= 295 ? 1 : 0) + (lb >= 0.21 ? 1 : 0) + (dom > 0 && dom <= 11.8 ? 1 : 0) + (cad >= 0.4 ? 1 : 0);
  const windowHuman = gaitScore >= 3 && hb < 0.45 && ipi <= 900;
  // single windows can catch a half-step; decide by majority over the node's last 5 step windows
  let humanGait = windowHuman;
  if (ipi > 0 && rms >= 0.012) {
    const v = gaitVotes.get(nodeId) || [];
    v.push(windowHuman); if (v.length > 5) v.shift();
    gaitVotes.set(nodeId, v);
    humanGait = v.filter(Boolean).length * 2 >= v.length;
  }
  const mlLabel = ml ? ml.label : null;
  const lbl = (k) => p.labels[k] || k;

  if (p.id === 'nuclear') {
    const seismicOnly = !surface && (fusion.level === 'SUSPECT' || fusion.level === 'INTRUSION');
    if (!surface && !seismicOnly) return null;
    if (mlLabel === 'VEHICLE') return { label: 'VEHICLE', title: lbl('VEHICLE'), detail: 'Engine-rumble signature in the zone' };
    if (humanGait && (mlLabel === 'HUMAN' || fusion.targetClass === 'HUMAN')) {
      return { label: 'HUMAN', title: lbl('HUMAN'), severity: 'CRITICAL',
        detail: `Bipedal gait (score ${gaitScore}/4): ${Math.round(ipi)} ms between steps, ${Math.round(dom)} Hz impacts, cadence ${cad.toFixed(2)}` };
    }
    const s = sustained(nodeId, 'ANIMAL', true, 0);
    const close = radar.distance > 0 && radar.distance < 2;
    const where = surface ? `Moving target ${radar.distance ? radar.distance.toFixed(1) + ' m away' : 'nearby'}` : 'Footfalls on the seismic probes (out of radar view)';
    return { label: 'ANIMAL', title: lbl('ANIMAL'), severity: close ? 'HIGH' : 'MEDIUM', raise: s.count >= 2 && !fusion.isAlertCandidate, kind: 'WILDLIFE',
      detail: `${where}, non-human gait (score ${gaitScore}/4: ${ipi ? Math.round(ipi) + ' ms steps' : 'no clear steps'}, ${Math.round(dom)} Hz) - likely an animal` };
  }

  if (p.id === 'border') {
    const digging = active && !surface && crest >= 3.5 && ipi >= 400 && ipi <= 3000 && cad >= 0.3 && hb < 0.5;
    const s = sustained(nodeId, 'SUBSURFACE', digging, t.seismic ? t.seismic.ratio || 1 : 1);
    if (digging || (s.kind === 'SUBSURFACE' && s.count)) {
      const stationary = std(s.ratios) < 0.25;   // a digger stays put; a walker's A/B loudness changes
      const raise = s.count >= 4 && stationary;
      return { label: 'SUBSURFACE', title: lbl('SUBSURFACE'), severity: s.count >= 10 ? 'CRITICAL' : 'HIGH', raise, kind: 'SUBSURFACE',
        detail: `Rhythmic impacts every ~${Math.round(ipi)} ms for ${s.count} windows, source stationary, nothing on the surface radar` };
    }
    if (surface && fusion.level !== 'CLEAR') {
      if (mlLabel === 'VEHICLE') return { label: 'VEHICLE', title: lbl('VEHICLE'), detail: 'Vehicle signature at the line' };
      return { label: 'HUMAN', title: lbl('HUMAN'), detail: humanGait ? `Footsteps every ${Math.round(ipi)} ms` : 'Surface target at the line' };
    }
    return null;
  }

  if (p.id === 'retail') {
    const drilling = rms >= Math.max(0.025, 4 * nf) && crest < 3.2 && (dom >= 15 || cent >= 18) && hb >= 0.4;
    const s = sustained(nodeId, 'DRILLING', drilling, 0);
    if (drilling || (s.kind === 'DRILLING' && s.count)) {
      return { label: 'DRILLING', title: lbl('DRILLING'), severity: 'CRITICAL', raise: s.count >= 3, kind: 'DRILLING',
        detail: `Continuous ${Math.round(dom || cent)} Hz vibration at ${rms.toFixed(3)} g for ${s.count} windows (drill / grinder signature)` };
    }
    if (peak >= 0.25 && crest >= 5) {
      return { label: 'IMPACT', title: lbl('IMPACT'), severity: 'HIGH', raise: true, kind: 'IMPACT', detail: `Sharp impact ${peak.toFixed(2)} g (crest ${crest.toFixed(1)}) - hammering or forced entry` };
    }
    if (surface) {
      return { label: 'HUMAN', title: lbl('HUMAN'), severity: 'CRITICAL', detail: `Radar presence ${radar.distance ? radar.distance.toFixed(1) + ' m' : ''} in the showroom while the store is closed` };
    }
    if (fusion.isAlertCandidate) {   // strong vibration but nobody on the floor: something is working on the structure
      return { label: 'VIBRATION', title: lbl('VIBRATION'), severity: 'HIGH', kind: 'VIBRATION',
        detail: `Strong structural vibration (${rms.toFixed(3)} g) with no one on the showroom radar` };
    }
    return null;
  }

  // perimeter
  if (fusion.level === 'CLEAR') return null;
  const k = fusion.targetClass === 'VEHICLE' ? 'VEHICLE' : 'HUMAN';
  return { label: k, title: lbl(k), detail: null };
}

module.exports = { get, list, set, interpret, PROFILES };
