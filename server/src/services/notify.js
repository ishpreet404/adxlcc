'use strict';
/**
 * Outbound notifications — all optional, all using only the Pi:
 *   - generic webhook (POST JSON)          WEBHOOK_URL
 *   - Telegram bot message                 TELEGRAM_BOT_TOKEN (+ TELEGRAM_CHAT_ID, optional)
 *   - Raspberry Pi GPIO siren/strobe relay SIREN_GPIO (BCM) for SIREN_SECONDS, via `pinctrl` (Bookworm) or `raspi-gpio`
 *
 * Telegram: the chat id is discovered automatically — open the bot, press Start (or send any
 * message), and the server finds the chat through getUpdates on the next send / on "FIND CHATS".
 * Discovered chats and a token entered from the dashboard persist in server/data/notify.json;
 * values in .env take precedence.
 *
 * Rate-limited per kind so a long event does not spam the phone.
 */
const { exec } = require('child_process');
const config = require('../config');
const store = require('./store');

const RATE_MS = { INTRUSION: 20000, TAMPER: 30000, LOITER: 60000, OFFLINE: 300000, BATTERY: 3600000, TEST: 5000 };
const SAVE_FILE = 'notify.json';

class Notify {
  constructor() {
    this.lastSent = {};
    this.log = [];
    this.sirenTimer = null;
    this.sirenOn = false;
    this.saved = store.readJson(SAVE_FILE, { telegramToken: '', telegramChats: [] });
    if (!Array.isArray(this.saved.telegramChats)) this.saved.telegramChats = [];
    this.bot = null;          // { id, username } once getMe succeeded
    this.botError = null;     // last getMe / API error text
    this.lastDiscover = 0;
    this.updateOffset = 0;
    this.onChange = null;     // set by index.js to broadcast status changes
    this.checkTelegram().catch(() => {});
  }

  // ---- configuration --------------------------------------------------------
  get telegramToken() { return config.TELEGRAM_BOT_TOKEN || this.saved.telegramToken || ''; }

  /** Chats to deliver to: .env chat id(s) (comma separated) or the discovered ones. */
  get telegramChats() {
    if (config.TELEGRAM_CHAT_ID) {
      // A common mistake is pasting the bot's own id (the number before ':' in the token) as the chat id.
      const botId = String(this.telegramToken.split(':')[0]);
      const ids = config.TELEGRAM_CHAT_ID.split(',').map(s => s.trim()).filter(id => id && id !== botId);
      if (ids.length) return ids.map(id => ({ id, name: 'from .env', type: 'env' }));
      if (!this._warnedBotId) { this._warnedBotId = true; console.warn('[notify] TELEGRAM_CHAT_ID is the bot\'s own id — ignoring it; press Start in the bot and use FIND CHATS'); }
    }
    return this.saved.telegramChats;
  }

  status() {
    const chats = this.telegramChats;
    return {
      webhook: Boolean(config.WEBHOOK_URL),
      telegram: Boolean(this.telegramToken && chats.length),
      telegramToken: this.telegramToken ? `…${this.telegramToken.slice(-6)}` : '',
      telegramTokenSource: config.TELEGRAM_BOT_TOKEN ? '.env' : this.saved.telegramToken ? 'dashboard' : '',
      telegramBot: this.bot ? this.bot.username : null,
      telegramError: this.botError,
      telegramChats: chats,
      siren: config.SIREN_GPIO >= 0 ? `GPIO${config.SIREN_GPIO}` : false,
      sirenOn: this.sirenOn,
      recent: this.log.slice(-10)
    };
  }

  _changed() { if (this.onChange) try { this.onChange(this.status()); } catch { /* ignore */ } }

  _save() { store.writeJson(SAVE_FILE, this.saved, 100); }

  _record(channel, ok, detail) {
    this.log.push({ t: Date.now(), channel, ok, detail: String(detail || '').slice(0, 160) });
    if (this.log.length > 50) this.log.shift();
    if (!ok) console.warn(`[notify] ${channel}: ${detail}`);
    this._changed();
  }

  // ---- telegram ---------------------------------------------------------------
  async _tg(method, body) {
    const token = this.telegramToken;
    if (!token) throw new Error('no bot token');
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) throw new Error(json.description ? `${res.status} ${json.description}` : `HTTP ${res.status}`);
    return json.result;
  }

  /** Validate the token (getMe) and remember the bot username. */
  async checkTelegram() {
    if (!this.telegramToken) { this.bot = null; this.botError = null; return null; }
    try {
      const me = await this._tg('getMe');
      this.bot = { id: me.id, username: me.username };
      this.botError = null;
      console.log(`[notify] telegram bot @${me.username} ready — ${this.telegramChats.length} chat(s)${this.telegramChats.length ? '' : ' (open the bot and press Start, then FIND CHATS)'}`);
    } catch (err) {
      this.bot = null;
      this.botError = err.message;
      console.warn(`[notify] telegram token rejected: ${err.message}`);
    }
    this._changed();
    return this.bot;
  }

  /** Pull getUpdates and remember every chat that has talked to the bot. */
  async discoverTelegramChats() {
    if (!this.telegramToken) return { chats: this.telegramChats, error: 'no bot token' };
    this.lastDiscover = Date.now();
    try {
      const updates = await this._tg('getUpdates', { offset: this.updateOffset, timeout: 0, allowed_updates: ['message', 'channel_post', 'my_chat_member'] });
      let added = 0;
      for (const u of updates) {
        this.updateOffset = u.update_id + 1;
        const msg = u.message || u.channel_post || (u.my_chat_member && { chat: u.my_chat_member.chat });
        if (!msg || !msg.chat) continue;
        const c = msg.chat;
        const id = String(c.id);
        const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || id;
        const existing = this.saved.telegramChats.find(x => x.id === id);
        if (existing) { existing.name = name; existing.type = c.type; existing.lastSeen = Date.now(); continue; }
        this.saved.telegramChats.push({ id, name, type: c.type, username: c.username || null, addedAt: Date.now(), lastSeen: Date.now() });
        added++;
      }
      if (added) { this._save(); this._record('telegram', true, `discovered ${added} chat(s)`); }
      this.botError = null;
      this._changed();
      return { chats: this.telegramChats, added };
    } catch (err) {
      this.botError = err.message;
      this._record('telegram', false, `getUpdates: ${err.message}`);
      return { chats: this.telegramChats, error: err.message };
    }
  }

  /** Dashboard configuration: token and/or explicit chat ids (both optional). */
  async configureTelegram({ token, chats } = {}) {
    if (token !== undefined) {
      this.saved.telegramToken = String(token || '').trim();
      this.updateOffset = 0;
    }
    if (Array.isArray(chats)) {
      this.saved.telegramChats = chats.map(c => (typeof c === 'string' ? { id: c.trim(), name: c.trim(), type: 'manual' } : c)).filter(c => c.id);
    }
    this._save();
    await this.checkTelegram();
    if (this.bot && !this.telegramChats.length) await this.discoverTelegramChats();
    return this.status();
  }

  removeTelegramChat(id) {
    this.saved.telegramChats = this.saved.telegramChats.filter(c => c.id !== String(id));
    this._save();
    this._changed();
    return this.status();
  }

  async _telegram(text) {
    // No chat yet? Look for one (the operator may just have pressed Start) — at most every 5 s.
    if (!this.telegramChats.length && Date.now() - this.lastDiscover > 5000) await this.discoverTelegramChats();
    const chats = this.telegramChats;
    if (!chats.length) { this._record('telegram', false, 'no chat yet — open the bot, press Start, then FIND CHATS'); return; }
    for (const chat of chats) {
      try {
        await this._tg('sendMessage', { chat_id: chat.id, text });
        this._record('telegram', true, `sent to ${chat.name || chat.id}`);
      } catch (err) {
        this._record('telegram', false, `${chat.name || chat.id}: ${err.message}`);
        if (/chat not found|bot was blocked|kicked/i.test(err.message) && chat.type !== 'env') this.removeTelegramChat(chat.id);
      }
    }
  }

  // ---- generic ------------------------------------------------------------------
  /** @param {{kind:string,title:string,message:string,data?:object,force?:boolean}} ev */
  async send(ev) {
    const now = Date.now();
    const gap = RATE_MS[ev.kind] || 20000;
    if (!ev.force && now - (this.lastSent[ev.kind] || 0) < gap) return false;
    this.lastSent[ev.kind] = now;
    const text = `🛡️ ${ev.title}\n${ev.message}`;
    const jobs = [];
    if (config.WEBHOOK_URL) jobs.push(this._webhook({ ...ev, text, t: now }));
    if (this.telegramToken) jobs.push(this._telegram(text));
    if (config.SIREN_GPIO >= 0 && (ev.kind === 'INTRUSION' || ev.kind === 'TAMPER')) this.siren(config.SIREN_SECONDS);
    if (!jobs.length && config.SIREN_GPIO < 0) return false;
    await Promise.allSettled(jobs);
    return true;
  }

  async _webhook(payload) {
    try {
      const res = await fetch(config.WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
      this._record('webhook', res.ok, `HTTP ${res.status}`);
    } catch (err) { this._record('webhook', false, err.message); }
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
