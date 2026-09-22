'use strict';
/**
 * Labelled waveform recorder for ML training.
 * Collects the raw probe-A windows a node streams while in LIVE mode and writes
 * ml/data/<timestamp>_<LABEL>.jsonl (one 128-sample window per line).
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');
const commands = require('./commands');
const events = require('./events');

const LABELS = ['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'];
const WINDOW = 128;

class Recorder {
  constructor() { this.sessions = new Map(); }

  start(nodeId, label, seconds = 30) {
    label = String(label || '').toUpperCase();
    if (!LABELS.includes(label)) throw new Error(`label must be one of ${LABELS.join(', ')}`);
    seconds = Math.max(5, Math.min(600, Number(seconds) || 30));
    fs.mkdirSync(config.ML_DATA_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(config.ML_DATA_DIR, `${stamp}_${label}.jsonl`);
    const s = { nodeId, label, file, startedAt: Date.now(), endsAt: Date.now() + seconds * 1000, buffer: [], windows: 0 };
    this.sessions.set(nodeId, s);
    commands.push(nodeId, { mode: 'LIVE', liveFor: seconds + 10 });
    events.log('RECORDING_STARTED', `Recording ${label} windows from ${nodeId} for ${seconds}s`, { nodeId });
    setTimeout(() => this.stop(nodeId), seconds * 1000 + 2000);
    return this.status(nodeId);
  }

  onWave(nodeId, fs_, samplesA) {
    const s = this.sessions.get(nodeId);
    if (!s || !samplesA || !samplesA.length) return;
    s.buffer.push(...samplesA);
    while (s.buffer.length >= WINDOW) {
      const win = s.buffer.splice(0, WINDOW);
      fs.appendFileSync(s.file, JSON.stringify({ label: s.label, fs: fs_, nodeId, t: Date.now(), samples: win }) + '\n');
      s.windows++;
    }
  }

  stop(nodeId) {
    const s = this.sessions.get(nodeId);
    if (!s) return null;
    this.sessions.delete(nodeId);
    events.log('RECORDING_STOPPED', `Saved ${s.windows} ${s.label} windows to ${path.basename(s.file)}`, { nodeId });
    return { ...this.status(nodeId), windows: s.windows, file: s.file, done: true };
  }

  status(nodeId) {
    const s = this.sessions.get(nodeId);
    if (!s) return { recording: false };
    return { recording: true, nodeId, label: s.label, windows: s.windows, remainingS: Math.max(0, Math.round((s.endsAt - Date.now()) / 1000)), file: path.basename(s.file) };
  }
}

module.exports = new Recorder();
