'use strict';
/**
 * Downlink command queue.  Nodes are battery powered and mostly asleep, so the server
 * never pushes; commands ride back in the HTTP response to the node's next uplink.
 *   { "mode": "LIVE"|"ECO", "reboot": true, "liveFor": 120, "sleepS": 30 }
 */
const queues = new Map();

function push(nodeId, cmd) {
  if (!queues.has(nodeId)) queues.set(nodeId, {});
  Object.assign(queues.get(nodeId), cmd);
  return queues.get(nodeId);
}

function drain(nodeId) {
  const q = queues.get(nodeId);
  if (!q) return null;
  queues.delete(nodeId);
  return q;
}

function peek(nodeId) { return queues.get(nodeId) || null; }

module.exports = { push, drain, peek };
