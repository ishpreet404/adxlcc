/** REST client for the central server. */
const configured = (import.meta.env.VITE_APP_API_BASE_URL || '').replace(/\/+$/, '');
export const BASE_URL = configured; // '' → same origin (Vite proxy / server-hosted build)

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok || (data && data.ok === false)) {
    throw new Error((data && data.error) || `HTTP ${res.status}`);
  }
  return data;
}

const post = (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) });
const put = (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) });
const del = (path) => request(path, { method: 'DELETE' });

export const api = {
  health: () => request('/api/system/health'),
  nodes: () => request('/api/nodes'),
  node: (id) => request(`/api/nodes/${id}`),
  history: (id, limit = 240) => request(`/api/nodes/${id}/history?limit=${limit}`),
  wave: (id) => request(`/api/nodes/${id}/wave`),
  updateNode: (id, patch) => put(`/api/nodes/${id}`, patch),
  removeNode: (id) => del(`/api/nodes/${id}`),
  command: (id, cmd) => post(`/api/nodes/${id}/command`, cmd),

  alerts: (params = '') => request(`/api/alerts${params}`),
  alert: (id) => request(`/api/alerts/${id}`),
  acknowledge: (id) => post(`/api/alerts/${id}/acknowledge`),
  resolve: (id) => post(`/api/alerts/${id}/resolve`),
  dismiss: (id) => post(`/api/alerts/${id}/dismiss`),
  acknowledgeAll: () => post('/api/system/alerts/acknowledge-all'),
  events: (limit = 200) => request(`/api/events?limit=${limit}`),

  site: () => request('/api/system/site'),
  updateSite: (patch) => put('/api/system/site', patch),
  zones: () => request('/api/system/zones'),
  createZone: (zone) => post('/api/system/zones', zone),
  updateZone: (id, patch) => put(`/api/system/zones/${id}`, patch),
  removeZone: (id) => del(`/api/system/zones/${id}`),

  arming: () => request('/api/system/arming'),
  setArming: (mode, by = 'operator') => post('/api/system/arming', { mode, by }),
  setSchedule: (patch) => put('/api/system/arming/schedule', patch),

  notifyStatus: () => request('/api/system/notify'),
  notifyTest: () => post('/api/system/notify/test'),
  siren: (on, seconds) => post('/api/system/siren', { on, seconds }),
  activity: () => request('/api/system/activity'),
  resetActivity: () => del('/api/system/activity'),

  sim: () => request('/api/system/sim'),
  simStart: (nodes, scenario) => post('/api/system/sim/start', { nodes, scenario }),
  simStop: () => post('/api/system/sim/stop'),
  simScenario: (scenario) => post('/api/system/sim/scenario', { scenario }),
  simIntruder: (nodeId, type = 'HUMAN') => post('/api/system/sim/intruder', { nodeId, type }),
  simTamper: (nodeId) => post('/api/system/sim/tamper', { nodeId }),

  record: (nodeId, label, seconds) => post('/api/system/record', { nodeId, label, seconds }),
  recordStop: (nodeId) => post('/api/system/record/stop', { nodeId }),
  recordStatus: (nodeId) => request(`/api/system/record/${nodeId}`)
};

export default api;
