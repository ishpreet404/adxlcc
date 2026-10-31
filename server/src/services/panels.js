'use strict';
/** Physical control panels (nRF/OLED base stations) seen polling the server. */
const seen = new Map();   // ip -> { ip, fw, lastSeen, polls }

function touch(ip, fw) {
  const p = seen.get(ip) || { ip, fw: null, firstSeen: Date.now(), polls: 0 };
  p.fw = fw || p.fw; p.lastSeen = Date.now(); p.polls++;
  seen.set(ip, p);
}

function list() {
  const now = Date.now();
  return [...seen.values()].map(p => ({ ...p, online: now - p.lastSeen < 15000 })).sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { touch, list };
