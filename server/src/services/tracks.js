'use strict';
/**
 * Site-level target tracks.
 *  - merges per-node estimates that agree in space/time (one target, one trail)
 *  - two-node radar triangulation: when two nodes report ranges to the same target within 3 s
 *    the range circles are intersected → much tighter fix than a single node can give
 *  - kinematics: velocity, speed, heading, running flag, 5 s prediction, ETA to the next node
 */
const MERGE_RADIUS_M = 4.0;
const TTL_MS = 6000;
const OBS_WINDOW_MS = 3000;
let counter = 0;

const r2 = v => Number(v.toFixed(2));

function intersectCircles(c1, c2) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6 || d > c1.r + c2.r + 0.6 || d < Math.abs(c1.r - c2.r) - 0.6) return null;
  // clamp for slightly inconsistent ranges (measurement noise)
  const a = Math.max(-c1.r, Math.min(c1.r, (c1.r * c1.r - c2.r * c2.r + d * d) / (2 * d)));
  const h = Math.sqrt(Math.max(0, c1.r * c1.r - a * a));
  const mx = c1.x + a * dx / d, my = c1.y + a * dy / d;
  return [
    { x: mx + h * dy / d, y: my - h * dx / d },
    { x: mx - h * dy / d, y: my + h * dx / d }
  ];
}

class Tracks {
  constructor() { this.tracks = new Map(); }

  /**
   * @param {string} nodeId
   * @param {object} pos       localisation estimate (x, y, confidence, sigmaRangeM, rangeSource…)
   * @param {object} fusion
   * @param {number} now
   * @param {object} extras    { node:{x,y}, radarRange:number|null, running:boolean, allNodes:[] }
   */
  update(nodeId, pos, fusion, now = Date.now(), extras = {}) {
    if (!pos) return null;
    let best = null, bestD = Infinity;
    for (const tr of this.tracks.values()) {
      if (tr.nodes.includes(nodeId) && now - tr.updatedAt < 3000 && Math.hypot(tr.x - pos.x, tr.y - pos.y) < MERGE_RADIUS_M * 2) { best = tr; bestD = 0; break; }
    }
    if (!best) {
      for (const tr of this.tracks.values()) {
        const d = Math.hypot(tr.x - pos.x, tr.y - pos.y);
        if (d < MERGE_RADIUS_M && d < bestD && now - tr.updatedAt < TTL_MS) { best = tr; bestD = d; }
      }
    }
    if (!best) {
      best = {
        id: `T${(++counter).toString().padStart(2, '0')}`, x: pos.x, y: pos.y,
        confidence: pos.confidence, probability: fusion.probability, sigmaM: pos.sigmaRangeM,
        targetClass: fusion.targetClass, level: fusion.level, method: pos.rangeSource,
        nodes: [nodeId], createdAt: now, updatedAt: now, trail: [], obs: {},
        vx: 0, vy: 0, speed: 0, headingDeg: null, running: false, predicted: null, eta: null, zone: null
      };
      this.tracks.set(best.id, best);
    } else {
      const k = Math.min(0.8, Math.max(0.1, pos.confidence));
      best.x = r2(best.x + (pos.x - best.x) * k);
      best.y = r2(best.y + (pos.y - best.y) * k);
      best.confidence = r2(Math.max(best.confidence * 0.9, pos.confidence));
      best.probability = Math.max(best.probability * 0.9, fusion.probability);
      best.sigmaM = r2(Math.min(best.sigmaM, pos.sigmaRangeM));
      best.updatedAt = now;
      best.method = pos.rangeSource;
      if (!best.nodes.includes(nodeId)) best.nodes.push(nodeId);
      if (fusion.targetClass !== 'UNKNOWN') best.targetClass = fusion.targetClass;
      best.level = fusion.level;
    }

    // ---- triangulation from two radar ranges ---------------------------------
    if (extras.radarRange && extras.node) {
      best.obs[nodeId] = { x: extras.node.x, y: extras.node.y, r: extras.radarRange, t: now };
      const fresh = Object.entries(best.obs).filter(([id, o]) => id !== nodeId && now - o.t < OBS_WINDOW_MS);
      if (fresh.length) {
        const [, o2] = fresh.sort((p, q) => q[1].t - p[1].t)[0];
        const cands = intersectCircles(best.obs[nodeId], o2);
        if (cands) {
          const pick = cands.reduce((a, b) => (Math.hypot(a.x - pos.x, a.y - pos.y) <= Math.hypot(b.x - pos.x, b.y - pos.y) ? a : b));
          best.x = r2(pick.x); best.y = r2(pick.y);
          best.sigmaM = 0.5; best.confidence = 0.95; best.method = 'triangulated';
        }
      }
    }
    best.running = Boolean(extras.running) || (best.running && now - best.updatedAt < 2000);

    // ---- trail + kinematics ---------------------------------------------------
    const last = best.trail[best.trail.length - 1];
    if (!last || Math.hypot(last.x - best.x, last.y - best.y) > 0.25 || now - last.t > 1000) best.trail.push({ x: best.x, y: best.y, t: now });
    if (best.trail.length > 60) best.trail.shift();
    const recent = best.trail.filter(p => now - p.t <= 3000);
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.4) {
        const vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        best.vx = r2(best.vx * 0.5 + vx * 0.5);
        best.vy = r2(best.vy * 0.5 + vy * 0.5);
        best.speed = r2(Math.hypot(best.vx, best.vy));
        best.headingDeg = best.speed > 0.15 ? r2(((Math.atan2(best.vy, best.vx) * 180 / Math.PI) + 360) % 360) : best.headingDeg;
      }
    }
    if (best.speed > 0.15) {
      best.predicted = { x: r2(best.x + best.vx * 5), y: r2(best.y + best.vy * 5), horizonS: 5 };
      best.eta = null;
      const ux = best.vx / best.speed, uy = best.vy / best.speed;
      for (const n of extras.allNodes || []) {
        if (best.nodes.includes(n.id)) continue;
        const dx = n.x - best.x, dy = n.y - best.y;
        const along = dx * ux + dy * uy;
        const lateral = Math.abs(dx * uy - dy * ux);
        if (along > 1 && lateral < 6) {
          const etaS = Math.round(along / best.speed);
          if (etaS <= 60 && (!best.eta || etaS < best.eta.etaS)) best.eta = { nodeId: n.id, nodeName: n.name, etaS, distanceM: r2(Math.hypot(dx, dy)) };
        }
      }
    } else {
      best.predicted = null;
      best.eta = null;
    }
    if (extras.zone !== undefined) best.zone = extras.zone ? { id: extras.zone.id, name: extras.zone.name, type: extras.zone.type } : null;
    return best;
  }

  sweep(now = Date.now()) {
    let changed = false;
    for (const [id, tr] of this.tracks) {
      if (now - tr.updatedAt > TTL_MS) { this.tracks.delete(id); changed = true; }
    }
    return changed;
  }

  list() {
    return Array.from(this.tracks.values()).map(t => {
      const { obs, ...pub } = t; // eslint-disable-line no-unused-vars
      return pub;
    });
  }
}

module.exports = new Tracks();
module.exports.intersectCircles = intersectCircles;
module.exports.Tracks = Tracks;
