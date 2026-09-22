'use strict';
/**
 * Outbound notifications — all optional, all using only the Pi:
 *   - generic webhook (POST JSON)          WEBHOOK_URL
 *   - Telegram bot message                 TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 *   - Raspberry Pi GPIO siren/strobe relay SIREN_GPIO (BCM) for SIREN_SECONDS, via `pinctrl` (Bookworm) or `raspi-gpio`
 * Rate-limited per kind so a long event does not spam the phone.
 */
const { exec } = require('child_process');
const config = require('../config');

const RATE_MS = { INTRUSION: 20000, TAMPER: 30000, LOITER: 60000, OFFLINE: 300000, BATTERY: 3600000, TEST: 5000 };

class Notify {
  constructor() {
    this.lastSent = {};
    this.log = [];
    this.sirenTimer = null;
    this.sirenOn = false;
  }

  status() {
    return {
      webhook: Boolean(config.WEBHOOK_URL),
      telegram: Boolean(config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID),
      siren: config.SIREN_GPIO >= 0 ? `GPIO${config.SIREN_GPIO}` : false,
      sirenOn: this.sirenOn,
      recent: this.log.slice(-10)
    };
  }

  _record(channel, ok, detail) {
    this.log.push({ t: Date.now(), channel, ok, detail: String(detail || '').slice(0, 120) });
    if (this.log.length > 50) this.log.shift();
  }

  /** @param {{kind:string,title:string,message:string,data?:object,force?:boolean}} ev */
  async send(ev) {
    const now = Date.now();
    const gap = RATE_MS[ev.kind] || 20000;
    if (!ev.force && now - (this.lastSent[ev.kind] || 0) < gap) return false;
    this.lastSent[ev.kind] = now;
    const text = `🛡️ ${ev.title}\n${ev.message}`;
    const jobs = [];
    if (config.WEBHOOK_URL) jobs.push(this._webhook({ ...ev, text, t: now }));
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) jobs.push(this._telegram(text));
    if (config.SIREN_GPIO >= 0 && (ev.kind === 'INTRUSION' || ev.kind === 'TAMPER')) this.siren(config.SIREN_SECONDS);
    await Promise.allSettled(jobs);
    return true;
  }

  async _webhook(payload) {
    try {
      const res = await fetch(config.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
      this._record('webhook', res.ok, `HTTP ${res.status}`);
    } catch (err) { this._record('webhook', false, err.message); }
  }

  async _telegram(text) {
    try {
      const url = `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: config.TELEGRAM_CHAT_ID, text }), signal: AbortSignal.timeout(8000) });
      this._record('telegram', res.ok, `HTTP ${res.status}`);
    } catch (err) { this._record('telegram', false, err.message); }
  }

  /** Drive the siren GPIO for `seconds` (no-op on non-Pi hosts). */
  siren(seconds = config.SIREN_SECONDS) {
    if (config.SIREN_GPIO < 0) return false;
    const pin = config.SIREN_GPIO;
    const run = (cmd) => new Promise(resolve => exec(cmd, { timeout: 3000 }, (err) => resolve(!err)));
    const set = async (high) => {
      const ok = await run(`pinctrl set ${pin} op ${high ? 'dh' : 'dl'}`) || await run(`raspi-gpio set ${pin} op ${high ? 'dh' : 'dl'}`);
      this._record('siren', ok, high ? 'ON' : 'OFF');
      return ok;
    };
    if (this.sirenTimer) clearTimeout(this.sirenTimer);
    this.sirenOn = true;
    set(true);
    this.sirenTimer = setTimeout(() => { this.sirenOn = false; set(false); }, Math.max(1, seconds) * 1000);
    return true;
  }

  sirenOff() {
    if (this.sirenTimer) clearTimeout(this.sirenTimer);
    this.sirenTimer = null;
    if (this.sirenOn) { this.sirenOn = false; exec(`pinctrl set ${config.SIREN_GPIO} op dl || raspi-gpio set ${config.SIREN_GPIO} op dl`, () => {}); }
  }
}

module.exports = new Notify();
