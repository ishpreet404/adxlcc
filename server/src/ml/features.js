'use strict';
/**
 * Seismic feature extractor v2 — Node.js port of ml/features.py.
 * MUST stay numerically aligned with ml/features.py and firmware/src/dsp/features.cpp.
 */

const FEATURE_ORDER = [
  'rms', 'peak', 'peakToPeak', 'variance', 'dominantFrequency',
  'spectralEnergy', 'spectralCentroid', 'interPeakInterval', 'zeroCrossingRate', 'crestFactor',
  'kurtosis', 'spectralFlatness', 'lowBandRatio', 'highBandRatio', 'cadenceStrength'
];

function fftMagnitudes(signal) {
  const n = signal.length;
  let size = 1;
  while (size < n) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i++) re[i] = signal[i];
  let j = 0;
  for (let i = 1; i < size; i++) {
    let bit = size >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j |= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let start = 0; start < size; start += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = start + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const half = size >> 1;
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / size;
  return { mags, size };
}

function zeroFeatures() {
  const f = {};
  for (const k of FEATURE_ORDER) f[k] = 0;
  return f;
}

/**
 * @param {number[]} signal  band-passed vibration magnitude (g), any length >= 8
 * @param {number} fs        sample rate Hz
 */
function extract(signal, fs = 100) {
  const n = signal.length;
  if (!n || n < 8) return zeroFeatures();
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;

  const sig = new Float64Array(n);
  let sumSq = 0, sum4 = 0, mn = Infinity, mx = -Infinity, maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const v = signal[i] - mean;
    sig[i] = v;
    const v2 = v * v;
    sumSq += v2; sum4 += v2 * v2;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    const a = Math.abs(v);
    if (a > maxAbs) maxAbs = a;
  }
  const rms = Math.sqrt(sumSq / n);
  const variance = sumSq / n;
  const crest = rms > 1e-6 ? maxAbs / rms : 0;
  let kurtosis = variance > 1e-12 ? (sum4 / n) / (variance * variance) : 0;
  if (kurtosis > 50) kurtosis = 50;

  let zc = 0;
  for (let i = 1; i < n; i++) {
    if ((sig[i - 1] < 0 && sig[i] >= 0) || (sig[i - 1] >= 0 && sig[i] < 0)) zc++;
  }
  const zcr = zc / (n / fs);

  const { mags, size } = fftMagnitudes(sig);
  let domFreq = 0, maxMag = -1, energy = 0, wsum = 0, msum = 0, low = 0, high = 0, logSum = 0, bins = 0;
  for (let k = 1; k < mags.length; k++) {
    const m = mags[k];
    const f = k * fs / size;
    const e = m * m;
    energy += e; wsum += f * m; msum += m;
    if (f >= 1 && f <= 8) low += e;
    if (f >= 20 && f <= 50) high += e;
    logSum += Math.log(e + 1e-12);
    bins++;
    if (m > maxMag) { maxMag = m; domFreq = f; }
  }
  const centroid = msum > 0 ? wsum / msum : 0;
  const lowRatio = energy > 1e-12 ? low / energy : 0;
  const highRatio = energy > 1e-12 ? high / energy : 0;
  const arith = bins ? energy / bins : 0;
  const flatness = bins && arith > 1e-12 ? Math.exp(logSum / bins) / arith : 0;

  const thr = maxAbs * 0.45;
  const refractory = Math.floor(0.06 * fs);
  let last = -10000, sumInt = 0, cnt = 0;
  for (let i = 1; i < n - 1; i++) {
    if (sig[i] > thr && sig[i] > sig[i - 1] && sig[i] >= sig[i + 1]) {
      if (i - last >= refractory) {
        if (last >= 0) { sumInt += (i - last) / fs * 1000; cnt++; }
        last = i;
      }
    }
  }
  const ipi = cnt ? sumInt / cnt : 0;

  // cadence strength: normalised autocorrelation of the smoothed |signal| envelope
  const env = new Float64Array(n);
  let emean = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 2), hi = Math.min(n, i + 3);
    let s = 0;
    for (let j = lo; j < hi; j++) s += Math.abs(sig[j]);
    env[i] = s / (hi - lo);
    emean += env[i];
  }
  emean /= n;
  let e0 = 0;
  for (let i = 0; i < n; i++) { env[i] -= emean; e0 += env[i] * env[i]; }
  let cadence = 0;
  if (e0 > 1e-12) {
    const lagMin = Math.floor(0.3 * fs), lagMax = Math.min(Math.floor(0.9 * fs), n - 8);
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0;
      for (let i = 0; i < n - lag; i++) s += env[i] * env[i + lag];
      const r = s / e0;
      if (r > cadence) cadence = r;
    }
  }
  if (cadence > 1) cadence = 1;

  return {
    rms, peak: maxAbs, peakToPeak: mx - mn, variance,
    dominantFrequency: domFreq, spectralEnergy: energy, spectralCentroid: centroid,
    interPeakInterval: ipi, zeroCrossingRate: zcr, crestFactor: crest,
    kurtosis, spectralFlatness: flatness, lowBandRatio: lowRatio, highBandRatio: highRatio, cadenceStrength: cadence
  };
}

/** Spectrum for the dashboard: energy in bins (Hz) up to Nyquist. */
function spectrum(signal, fs = 100, bins = 24) {
  const n = signal.length;
  if (n < 8) return [];
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  const sig = signal.map(v => v - mean);
  const { mags, size } = fftMagnitudes(sig);
  const out = new Array(bins).fill(0);
  const nyq = fs / 2;
  for (let k = 1; k < mags.length; k++) {
    const f = k * fs / size;
    const b = Math.min(bins - 1, Math.floor(f / nyq * bins));
    out[b] += mags[k];
  }
  return out.map((v, i) => ({ hz: Math.round((i + 0.5) * nyq / bins), mag: Number(v.toFixed(5)) }));
}

/** Envelope + detected step peaks for the scope overlay. */
function envelopeAndPeaks(signal, fs = 100) {
  const n = signal.length;
  if (n < 8) return { env: [], peaks: [] };
  let mean = 0;
  for (let i = 0; i < n; i++) mean += signal[i];
  mean /= n;
  const env = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - 3), hi = Math.min(n, i + 4);
    let s = 0;
    for (let j = lo; j < hi; j++) s += Math.abs(signal[j] - mean);
    env[i] = s / (hi - lo);
  }
  let maxAbs = 0;
  for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(signal[i] - mean));
  const thr = Math.max(0.02, maxAbs * 0.45);
  const refractory = Math.floor(0.25 * fs);
  const peaks = [];
  let last = -10000;
  for (let i = 1; i < n - 1; i++) {
    const v = signal[i] - mean;
    if (v > thr && v > signal[i - 1] - mean && v >= signal[i + 1] - mean && i - last >= refractory) { peaks.push(i); last = i; }
  }
  return { env, peaks };
}

function toVector(features) {
  return FEATURE_ORDER.map(k => Number(features[k]) || 0);
}

module.exports = { FEATURE_ORDER, extract, spectrum, envelopeAndPeaks, toVector, fftMagnitudes };
