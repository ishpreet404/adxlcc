'use strict';
/**
 * WebSocket fan-out to dashboards.  Path: /ws
 * Messages: { type, data, ts }
 */
const { WebSocketServer } = require('ws');

class Realtime {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.onHello = null; // () => snapshot object
  }

  init(server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      this.clients.add(ws);
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
      ws.on('message', (raw) => {
        try {
          const m = JSON.parse(raw);
          if (m.type === 'ping') this.send(ws, 'pong', { t: Date.now() });
        } catch { /* ignore */ }
      });
      console.log(`[ws] dashboard connected from ${req.socket.remoteAddress} (${this.clients.size} total)`);
      if (this.onHello) this.send(ws, 'hello', this.onHello());
    });
    // liveness sweep
    setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) { ws.terminate(); this.clients.delete(ws); continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      }
    }, 30000).unref();
  }

  send(ws, type, data) {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify({ type, data, ts: Date.now() })); } catch { /* ignore */ }
    }
  }

  broadcast(type, data) {
    if (!this.clients.size) return;
    const msg = JSON.stringify({ type, data, ts: Date.now() });
    for (const ws of this.clients) {
      if (ws.readyState === 1) {
        try { ws.send(msg); } catch { this.clients.delete(ws); }
      }
    }
  }

  get clientCount() { return this.clients.size; }
}

module.exports = new Realtime();
