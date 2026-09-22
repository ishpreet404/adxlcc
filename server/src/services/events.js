'use strict';
/** Operational event log (ring in memory + NDJSON on disk + WS broadcast). */
const store = require('./store');
const realtime = require('./realtime');

const MAX = 500;
const ring = store.readLog('events.ndjson', 200);
let counter = 0;

function log(type, message, extra = {}) {
  const ev = { id: `EV-${Date.now().toString(36)}-${(++counter).toString(36)}`, t: Date.now(), type, message, ...extra };
  ring.push(ev);
  if (ring.length > MAX) ring.shift();
  store.appendLog('events.ndjson', ev);
  realtime.broadcast('event', ev);
  return ev;
}

function list(limit = 200) {
  return ring.slice(-limit).reverse();
}

module.exports = { log, list };
