'use strict';
/**
 * Site arming state with an optional daily schedule.
 *   ARMED     alerts raised, sirens/notifications fire
 *   TEST      alerts raised but flagged test — dashboard stays silent, no notifications (walk tests)
 *   DISARMED  detections are logged only
 */
const store = require('./store');
const realtime = require('./realtime');
const events = require('./events');

const MODES = ['ARMED', 'TEST', 'DISARMED'];

class Arming {
  constructor() {
    const saved = store.readJson('arming.json', null) || {};
    this.mode = MODES.includes(saved.mode) ? saved.mode : 'ARMED';
    this.changedAt = saved.changedAt || Date.now();
    this.by = saved.by || 'system';
    this.schedule = Object.assign({ enabled: false, armAt: '22:00', disarmAt: '06:00' }, saved.schedule || {});
    this._lastTick = null;
    setInterval(() => this.tick(), 30000).unref();
  }

  status() { return { mode: this.mode, changedAt: this.changedAt, by: this.by, schedule: this.schedule, armed: this.mode !== 'DISARMED' }; }

  set(mode, by = 'operator') {
    if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}`);
    if (mode === this.mode) return this.status();
    this.mode = mode; this.changedAt = Date.now(); this.by = by;
    this._persist();
    events.log('ARMING', `Site ${mode} by ${by}`, { severity: mode === 'DISARMED' ? 'LOW' : 'INFO' });
    realtime.broadcast('arming', this.status());
    return this.status();
  }

  setSchedule(patch) {
    const hhmm = v => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
    if (patch.enabled !== undefined) this.schedule.enabled = Boolean(patch.enabled);
    if (hhmm(patch.armAt)) this.schedule.armAt = patch.armAt;
    if (hhmm(patch.disarmAt)) this.schedule.disarmAt = patch.disarmAt;
    this._persist();
    realtime.broadcast('arming', this.status());
    return this.status();
  }

  tick() {
    if (!this.schedule.enabled) return;
    const now = new Date();
    const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (cur === this._lastTick) return;
    this._lastTick = cur;
    if (cur === this.schedule.armAt && this.mode !== 'ARMED') this.set('ARMED', 'schedule');
    if (cur === this.schedule.disarmAt && this.mode !== 'DISARMED') this.set('DISARMED', 'schedule');
  }

  _persist() { store.writeJson('arming.json', { mode: this.mode, changedAt: this.changedAt, by: this.by, schedule: this.schedule }); }
}

module.exports = new Arming();
module.exports.MODES = MODES;
