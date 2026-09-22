'use strict';
/**
 * Tiny file persistence: JSON documents + append-only NDJSON logs.
 * Zero native dependencies so it runs on a Raspberry Pi straight from git.
 */
const fs = require('fs');
const path = require('path');
const config = require('../config');

fs.mkdirSync(config.DATA_DIR, { recursive: true });

const pending = new Map(); // file -> { timer, obj }

function readJson(name, fallback) {
  const p = path.join(config.DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeNow(p, obj) {
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, p);
  } catch (err) {
    console.warn('[store] write failed', p, err.message);
  }
}

/** Debounced write so rapid updates (dragging nodes on the map) don't hammer the SD card. */
function writeJson(name, obj, delay = 500) {
  const p = path.join(config.DATA_DIR, name);
  const prev = pending.get(p);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(p);
    writeNow(p, obj);
  }, delay);
  pending.set(p, { timer, obj });
}

function appendLog(name, obj) {
  const p = path.join(config.DATA_DIR, name);
  fs.appendFile(p, JSON.stringify(obj) + '\n', () => {});
}

function readLog(name, limit = 200) {
  const p = path.join(config.DATA_DIR, name);
  try {
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

/** Write everything still pending (called on shutdown). */
function flushSync() {
  for (const [p, { timer, obj }] of pending) {
    clearTimeout(timer);
    writeNow(p, obj);
  }
  pending.clear();
}

module.exports = { readJson, writeJson, appendLog, readLog, flushSync };
