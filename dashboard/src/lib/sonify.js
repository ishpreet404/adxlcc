/**
 * Probe sonification: ground vibration is infrasound (1–40 Hz), so we make it audible by
 * amplitude-modulating a low tone with the vibration envelope. Footsteps become thumps,
 * engines become a growl. Feed each new waveform chunk to `push()`.
 */
export class Sonifier {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.osc = null;
    this.noise = null;
    this.nextT = 0;
    this.enabled = false;
  }

  start() {
    if (this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = this.ctx || new AC();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'triangle';
    this.osc.frequency.value = 90;
    // a little band-passed noise makes gravel-like texture
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.4;
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 0.8;
    this.osc.connect(this.gain);
    this.noise.connect(bp); bp.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.osc.start(); this.noise.start();
    this.nextT = this.ctx.currentTime;
    this.enabled = true;
  }

  stop() {
    if (!this.enabled) return;
    try { this.osc.stop(); this.noise.stop(); } catch { /* ignore */ }
    this.gain.disconnect();
    this.enabled = false;
  }

  /** @param {number[]} samples  band-passed g values @ fs Hz */
  push(samples, fs = 100) {
    if (!this.enabled || !samples || !samples.length) return;
    const dur = samples.length / fs;
    const t0 = Math.max(this.ctx.currentTime + 0.02, this.nextT);
    const curve = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) curve[i] = Math.min(0.6, Math.pow(Math.abs(samples[i]) * 6, 0.7));
    try { this.gain.gain.setValueCurveAtTime(curve, t0, dur); } catch { /* overlapping curve; skip chunk */ }
    this.nextT = t0 + dur;
  }
}

export const sonifier = new Sonifier();
