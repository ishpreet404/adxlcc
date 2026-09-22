/** Auto-reconnecting WebSocket client (ws://<host>/ws). */
import { BASE_URL } from './api';

function wsUrl() {
  if (BASE_URL) return BASE_URL.replace(/^http/, 'ws') + '/ws';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export class Socket {
  constructor() {
    this.ws = null;
    this.handlers = new Set();
    this.statusHandlers = new Set();
    this.timer = null;
    this.connected = false;
    this.backoff = 1000;
  }

  connect() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    try {
      this.ws = new WebSocket(wsUrl());
    } catch {
      return this.scheduleReconnect();
    }
    this.ws.onopen = () => { this.connected = true; this.backoff = 1000; this.statusHandlers.forEach(h => h(true)); };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handlers.forEach(h => { try { h(msg); } catch (e) { console.error(e); } });
    };
    this.ws.onclose = () => { this.connected = false; this.statusHandlers.forEach(h => h(false)); this.scheduleReconnect(); };
    this.ws.onerror = () => { try { this.ws.close(); } catch { /* ignore */ } };
  }

  scheduleReconnect() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.connect(); }, this.backoff);
    this.backoff = Math.min(10000, this.backoff * 1.6);
  }

  onMessage(h) { this.handlers.add(h); return () => this.handlers.delete(h); }
  onStatus(h) { this.statusHandlers.add(h); h(this.connected); return () => this.statusHandlers.delete(h); }
}

export const socket = new Socket();
export default socket;
