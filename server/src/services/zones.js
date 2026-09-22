'use strict';
/**
 * Site zones: polygons drawn on the map with a rule.
 *   restricted → any target inside escalates to CRITICAL
 *   watch      → normal alerting, zone name attached
 *   allowed    → vehicles inside are expected (driveway); alerts for vehicles are logged, not raised
 * Persisted inside data/site.json (registry.site.zones).
 */
const registry = require('./registry');

const TYPES = ['restricted', 'watch', 'allowed'];
const PRIORITY = { restricted: 3, watch: 2, allowed: 1 };
let counter = 0;

function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function all() {
  if (!Array.isArray(registry.site.zones)) registry.site.zones = [];
  return registry.site.zones;
}

function create({ name, type, points }) {
  if (!Array.isArray(points) || points.length < 3) throw new Error('a zone needs at least 3 points');
  const pts = points.slice(0, 40).map(p => [Number(p[0]), Number(p[1])]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (pts.length < 3) throw new Error('invalid points');
  const zone = { id: `Z${Date.now().toString(36)}${(++counter).toString(36)}`, name: String(name || 'Zone').slice(0, 40), type: TYPES.includes(type) ? type : 'watch', points: pts };
  all().push(zone);
  registry.persist();
  return zone;
}

function update(id, patch) {
  const z = all().find(v => v.id === id);
  if (!z) return null;
  if (patch.name) z.name = String(patch.name).slice(0, 40);
  if (TYPES.includes(patch.type)) z.type = patch.type;
  if (Array.isArray(patch.points) && patch.points.length >= 3) z.points = patch.points.slice(0, 40).map(p => [Number(p[0]), Number(p[1])]);
  registry.persist();
  return z;
}

function remove(id) {
  const arr = all();
  const i = arr.findIndex(v => v.id === id);
  if (i < 0) return false;
  arr.splice(i, 1);
  registry.persist();
  return true;
}

/** Highest-priority zone containing the point, or null. */
function locate(x, y) {
  let best = null;
  for (const z of all()) {
    if (pointInPolygon(x, y, z.points) && (!best || PRIORITY[z.type] > PRIORITY[best.type])) best = z;
  }
  return best;
}

module.exports = { all, create, update, remove, locate, pointInPolygon, TYPES };
