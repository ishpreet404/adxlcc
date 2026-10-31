'use strict';
/**
 * Zero-config server discovery over UDP so nodes never need the Pi's IP.
 *
 *   node  → broadcast "CYBERCC_DISCOVER"          to <subnet-broadcast>:8788
 *   server → unicast   "CYBERCC_SERVER http://<ip>:8787" back to the node
 *
 * The server also emits an unsolicited beacon every 3 s so a node that missed the
 * reply (or a gateway script) can pick it up passively.
 */
const dgram = require('dgram');
const os = require('os');
const config = require('../config');

const DISCOVERY_PORT = 8788;
const MAGIC_REQ = 'CYBERCC_DISCOVER';
const MAGIC_RES = 'CYBERCC_SERVER';

function ipv4Interfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

const toInt = ip => ip.split('.').reduce((acc, o) => ((acc << 8) + Number(o)) >>> 0, 0);

/** Pick the server address on the same subnet as the asking node. */
function addressFor(clientIp) {
  const ifs = ipv4Interfaces();
  if (!ifs.length) return null;
  if (clientIp) {
    const c = toInt(clientIp);
    for (const i of ifs) {
      const m = toInt(i.netmask);
      if ((toInt(i.address) & m) === (c & m)) return i.address;
    }
  }
  // prefer wlan/eth-looking names, else the first
  const pref = ifs.find(i => /^(wl|eth|en)/i.test(i.name)) || ifs[0];
  return pref.address;
}

class Discovery {
  constructor() { this.sock = null; this.beacon = null; this.replies = 0; }

  start(port = DISCOVERY_PORT) {
    this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.sock.on('error', (err) => console.warn('[discovery] socket error', err.message));
    this.sock.on('message', (msg, rinfo) => {
      if (msg.toString('utf8').trim() !== MAGIC_REQ) return;
      const ip = addressFor(rinfo.address);
      if (!ip) return;
      const reply = Buffer.from(`${MAGIC_RES} http://${ip}:${config.PORT}`);
      this.sock.send(reply, rinfo.port, rinfo.address);
      this.replies++;
      if (this.replies <= 5 || this.replies % 50 === 0) console.log(`[discovery] told ${rinfo.address} the server is http://${ip}:${config.PORT}`);
    });
    this.sock.bind(port, () => {
      this.sock.setBroadcast(true);
      console.log(`[discovery] listening on udp/${port}; nodes may use server url "auto"`);
    });
    this.beacon = setInterval(() => {
      for (const i of ipv4Interfaces()) {
        const bcast = (toInt(i.address) | (~toInt(i.netmask) >>> 0)) >>> 0;
        const addr = [24, 16, 8, 0].map(s => (bcast >>> s) & 255).join('.');
        const msg = Buffer.from(`${MAGIC_RES} http://${i.address}:${config.PORT}`);
        this.sock.send(msg, port, addr, () => {});
      }
    }, 3000);
    this.beacon.unref();
  }

  status() { return { port: DISCOVERY_PORT, replies: this.replies, addresses: ipv4Interfaces().map(i => `${i.address} (${i.name})`) }; }

  stop() { if (this.beacon) clearInterval(this.beacon); if (this.sock) this.sock.close(); }
}

module.exports = new Discovery();
