'use strict';
/**
 * Rough target localisation from one node's 3-point sensor set.
 *
 *   range   ← radar (preferred) or seismic energy fall-off
 *   bearing ← dual-probe time-difference-of-arrival (TDOA) + amplitude ratio
 *
 * Geometry (node frame): heading h, probe A on the left, probe B on the right,
 * baseline s.  θ is the target angle measured from the heading, positive to the RIGHT.
 *
 *   far-field TDOA:   dB − dA ≈ −s·sinθ   →  sinθ = −v·lag / s      (lag = tB − tA)
 *   amplitude ratio:  ln(rmsB/rmsA) ≈ α·s·sinθ / r  → sinθ ≈ 2·bias·r/(α·s), bias=(B−A)/(A+B)
 *
 * The result is deliberately labelled an ESTIMATE with an uncertainty ellipse:
 * at 100 Hz the TDOA resolution is 10 ms which is ~1 sample over a 1.5 m baseline,
 * so the seismic bearing is coarse (sign + rough magnitude).  The radar supplies range.
 */
const config = require('../config');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r = (v, p = 2) => Number(v.toFixed(p));
const ALPHA = 1.2;               // amplitude fall-off exponent (geometric + soil attenuation)
const HUMAN_G_AT_1M = 0.15;      // typical footstep RMS (g) 1 m from a coupled probe

function estimate(node, t) {
  const radar = t.radar;
  const [pa, pb] = t.probes;
  const floor = config.PROBE_NOISE_FLOOR_G;
  const aAct = pa.ok && pa.rms > floor;
  const bAct = pb.ok && pb.rms > floor;
  const seismic = aAct || bAct;
  const radarActive = radar.ok && radar.presence && radar.distance > 0.1 && radar.distance <= config.RADAR_MAX_M + 1;
  if (!seismic && !radarActive) return null;

  // ---- range -------------------------------------------------------------
  let range, sigmaRange, rangeSource;
  if (radarActive) {
    range = radar.distance;
    sigmaRange = 0.35;
    rangeSource = 'radar';
  } else {
    const avg = Math.max(floor, (pa.rms + pb.rms) / 2);
    range = clamp(Math.pow(HUMAN_G_AT_1M / avg, 1 / ALPHA), 0.5, config.SEISMIC_RANGE_M);
    sigmaRange = 0.35 * range + 0.5;
    rangeSource = 'seismic-energy';
  }

  // ---- bearing -----------------------------------------------------------
  let sinTheta = 0;
  let sigmaBearing = 60;
  let bearingSource = 'none';
  const s = Math.max(0.3, node.spacing);
  if (aAct && bAct) {
    const bias = (pb.rms - pa.rms) / (pa.rms + pb.rms);
    const sinAmp = clamp(2 * bias * range / (ALPHA * s), -1, 1);
    const corr = t.seismic.corr || 0;
    const lagS = (t.seismic.lagMs || 0) / 1000;
    const sinTdoa = clamp(-config.SEISMIC_WAVE_SPEED_MS * lagS / s, -1, 1);
    if (corr >= 0.5) {
      const w = clamp((corr - 0.5) / 0.4, 0.3, 0.7);
      sinTheta = w * sinTdoa + (1 - w) * sinAmp;
      sigmaBearing = 18;
      bearingSource = 'tdoa+ratio';
    } else {
      sinTheta = sinAmp;
      sigmaBearing = 28;
      bearingSource = 'ratio';
    }
  } else if (aAct || bAct) {
    sinTheta = aAct ? -0.5 : 0.5;   // only one probe hears it → it's on that side
    sigmaBearing = 40;
    bearingSource = 'single-probe';
  } else if (radarActive) {
    sinTheta = 0;                   // radar alone: somewhere inside the beam
    sigmaBearing = config.RADAR_FOV_DEG / 2;
    bearingSource = 'radar-beam';
  }
  // the radar beam physically bounds the bearing when the radar sees the target
  let thetaDeg = Math.asin(clamp(sinTheta, -1, 1)) * 180 / Math.PI;
  if (radarActive) thetaDeg = clamp(thetaDeg, -config.RADAR_FOV_DEG / 2, config.RADAR_FOV_DEG / 2);

  const absBearing = node.heading - thetaDeg;               // θ positive = right = clockwise
  const rad = absBearing * Math.PI / 180;
  const x = node.x + range * Math.cos(rad);
  const y = node.y + range * Math.sin(rad);

  let confidence;
  if (radarActive && aAct && bAct) confidence = 0.85;
  else if (radarActive && seismic) confidence = 0.7;
  else if (radarActive) confidence = 0.55;
  else if (aAct && bAct) confidence = 0.45;
  else confidence = 0.3;

  return {
    x: r(x), y: r(y),
    rangeM: r(range), bearingDeg: r(((absBearing % 360) + 360) % 360, 1), thetaDeg: r(thetaDeg, 1),
    sigmaRangeM: r(sigmaRange), sigmaBearingDeg: sigmaBearing,
    confidence, rangeSource, bearingSource,
    label: 'ESTIMATED POSITION'
  };
}

module.exports = { estimate };
