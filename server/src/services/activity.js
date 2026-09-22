'use strict';
/**
 * Activity statistics: a 1 m heat-map grid of where targets have been, a by-hour-of-day
 * histogram and a rolling last-24-hours timeline. Persisted to data/activity.json.
 */
const store = require('./store');

class Activity {
  constructor() {
    const saved = store.readJson('activity.json', null) || {};
    this.cells = saved.cells || {};          // "x,y" -> count
    this.byHour = saved.byHour || new Array(24).fill(0);
    this.hourly = saved.hourly || {};        // epochHour -> count (rolling 48 h)
    this.total = saved.total || 0;
    this.dirty = false;
    setInterval(() => { if (this.dirty) { this.dirty = false; this._persist(); } }, 30000).unref();
  }

  record(x, y, t = Date.now()) {
    const key = `${Math.floor(x)},${Math.floor(y)}`;
    this.cells[key] = (this.cells[key] || 0) + 1;
    this.byHour[new Date(t).getHours()]++;
    const h = Math.floor(t / 3600000);
    this.hourly[h] = (this.hourly[h] || 0) + 1;
    for (const k of Object.keys(this.hourly)) if (h - Number(k) > 48) delete this.hourly[k];
    this.total++;
    this.dirty = true;
  }

  summary() {
    const nowH = Math.floor(Date.now() / 3600000);
    const last24h = [];
    for (let i = 23; i >= 0; i--) {
      const h = nowH - i;
      last24h.push({ t: h * 3600000, n: this.hourly[h] || 0 });
    }
    const cells = Object.entries(this.cells).map(([k, n]) => { const [x, y] = k.split(',').map(Number); return { x, y, n }; });
    const max = cells.reduce((m, c) => Math.max(m, c.n), 0);
    return { cells, max, byHour: this.byHour, last24h, total: this.total };
  }

  reset() {
    this.cells = {}; this.byHour = new Array(24).fill(0); this.hourly = {}; this.total = 0;
    this._persist();
  }

  _persist() { store.writeJson('activity.json', { cells: this.cells, byHour: this.byHour, hourly: this.hourly, total: this.total }, 100); }
}

module.exports = new Activity();
