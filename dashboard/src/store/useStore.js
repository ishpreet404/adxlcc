import { create } from 'zustand';
import api from '../services/api';
import socket from '../services/socket';

const WAVE_KEEP = 600; // samples per probe kept for the scopes (6 s @ 100 Hz)
let toastSeq = 0;

export const useStore = create((set, get) => ({
  connected: false,
  site: { width: 40, height: 30, name: 'Perimeter Site', zones: [] },
  nodes: {},
  waves: {},
  histories: {},      // id -> [{t, rmsA, rmsB, radar, p}] rolling 60 s for the sparklines
  tracks: [],
  alerts: [],
  events: [],
  sim: { running: false, scenario: 'quiet', scenarios: [], actors: [], nodes: [] },
  arming: { mode: 'ARMED', armed: true, schedule: { enabled: false, armAt: '22:00', disarmAt: '06:00' } },
  activity: null,
  notify: { webhook: false, telegram: false, siren: false },
  thresholds: { alert: 0.7, critical: 0.88, loiterS: 15 },
  selectedNodeId: null,
  page: 'command',
  editMap: false,
  showGroundTruth: true,
  muted: false,
  wallMode: false,
  layers: { beams: true, zones: true, heat: false, trails: true, predict: true, labels: true },
  toasts: [],
  zoneDraft: null, // { points: [[x,y]...] } while drawing a zone

  setPage: (page) => set({ page, wallMode: false }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setEditMap: (v) => set({ editMap: v }),
  setShowGroundTruth: (v) => set({ showGroundTruth: v }),
  setMuted: (v) => set({ muted: v }),
  setWallMode: (v) => set({ wallMode: v }),
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setZoneDraft: (d) => set({ zoneDraft: d }),
  addZonePoint: (x, y) => { const d = get().zoneDraft; if (d) set({ zoneDraft: { ...d, points: [...d.points, [x, y]] } }); },

  toast: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, ...t }] });
    setTimeout(() => set({ toasts: get().toasts.filter(x => x.id !== id) }), t.ttl || 6000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter(x => x.id !== id) }),

  init: async () => {
    socket.onStatus((ok) => set({ connected: ok }));
    socket.onMessage((msg) => get().handle(msg));
    socket.connect();
    try {
      const [n, a, e, act] = await Promise.all([api.nodes(), api.alerts('?active=1'), api.events(100), api.activity().catch(() => null)]);
      get().applySnapshot({ site: n.site, nodes: n.nodes, tracks: n.tracks, alerts: a.alerts, events: e.events, activity: act && act.activity });
    } catch (err) {
      console.warn('initial load failed', err.message);
    }
  },

  applySnapshot: (snap) => {
    const nodes = {};
    for (const n of snap.nodes || []) if (!n.simulated) nodes[n.id] = n;   // real hardware only
    const sel = get().selectedNodeId;
    set({
      site: snap.site ? { zones: [], ...snap.site } : get().site,
      nodes,
      tracks: (snap.tracks || []).filter(t => t.nodes.some(id => nodes[id])),
      alerts: (snap.alerts || []).filter(a => !a.simulated),
      events: (snap.events || []).filter(e => !(e.type || '').startsWith('SIM')).sort((p, q) => q.t - p.t),
      sim: snap.sim || get().sim,
      arming: snap.arming || get().arming,
      activity: snap.activity || get().activity,
      notify: snap.notify || get().notify,
      thresholds: snap.thresholds || get().thresholds,
      selectedNodeId: sel && nodes[sel] ? sel : (Object.keys(nodes)[0] || null)
    });
  },

  handle: (msg) => {
    const { type, data } = msg;
    switch (type) {
      case 'hello': return get().applySnapshot(data);
      case 'node': {
        if (data.simulated) return undefined;
        const nodes = { ...get().nodes, [data.id]: data };
        const patch = { nodes };
        if (data.latest) {
          const prev = get().histories[data.id] || [];
          const l = data.latest;
          const pt = { t: l.receivedAt || Date.now(), rmsA: l.probes[0].rms, rmsB: l.probes[1].rms, radar: l.radar.presence ? l.radar.distance : null, p: data.fusion ? data.fusion.probability : 0 };
          const h = prev.length && pt.t - prev[prev.length - 1].t < 150 ? prev : prev.concat(pt);
          patch.histories = { ...get().histories, [data.id]: h.length > 300 ? h.slice(-300) : h };
        }
        if (!get().selectedNodeId) patch.selectedNodeId = data.id;
        if (data.wave && data.wave.a && data.wave.a.length) {
          const prev = get().waves[data.id] || { fs: data.wave.fs, a: [], b: [] };
          const a = prev.a.concat(data.wave.a);
          const b = prev.b.concat(data.wave.b);
          patch.waves = { ...get().waves, [data.id]: { fs: data.wave.fs, a: a.length > WAVE_KEEP ? a.slice(-WAVE_KEEP) : a, b: b.length > WAVE_KEEP ? b.slice(-WAVE_KEEP) : b } };
        }
        return set(patch);
      }
      case 'nodeRemoved': {
        const nodes = { ...get().nodes };
        delete nodes[data.id];
        return set({ nodes, selectedNodeId: get().selectedNodeId === data.id ? Object.keys(nodes)[0] || null : get().selectedNodeId });
      }
      case 'tracks': return set({ tracks: data.filter(t => t.nodes.some(id => get().nodes[id])) });
      case 'alert': {
        const { alert, action } = data;
        if (alert.simulated) return undefined;
        let alerts = get().alerts.filter(a => a.id !== alert.id);
        if (alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED') alerts = [alert, ...alerts];
        alerts.sort((p, q) => q.updatedAt - p.updatedAt);
        if (action === 'created') {
          get().toast({
            kind: alert.kind, severity: alert.severity, test: alert.test,
            title: `${alert.test ? '[TEST] ' : ''}${alert.severity} ${alert.kind}${alert.targetClass && alert.targetClass !== 'UNKNOWN' && alert.kind === 'INTRUSION' ? ' · ' + alert.targetClass : ''}`,
            message: `${alert.nodeName}${alert.zone ? ` · ${alert.zone.name}` : ''}${alert.position ? ` · ${alert.position.rangeM} m` : ''}${alert.kinematics && alert.kinematics.running ? ' · RUNNING' : ''}`,
            nodeId: alert.nodeId, alertId: alert.id
          });
        }
        return set({ alerts });
      }
      case 'event': return data.type && data.type.startsWith('SIM') ? undefined : set({ events: [data, ...get().events].slice(0, 300) });
      case 'sim': return undefined;   // simulator hidden from the UI
      case 'site': return set({ site: { zones: [], ...data } });
      case 'notify': return set({ notify: data });
      case 'arming': {
        const prev = get().arming;
        if (prev.mode !== data.mode) get().toast({ kind: 'ARMING', severity: data.mode === 'DISARMED' ? 'LOW' : 'INFO', title: `Site ${data.mode}`, message: `by ${data.by}`, ttl: 4000 });
        return set({ arming: data });
      }
      default: return undefined;
    }
  },

  // ---- actions ------------------------------------------------------------
  acknowledge: (id) => api.acknowledge(id).catch(console.error),
  resolve: (id) => api.resolve(id).catch(console.error),
  dismiss: (id) => api.dismiss(id).catch(console.error),
  acknowledgeAll: () => api.acknowledgeAll().catch(console.error),
  command: (id, cmd) => api.command(id, cmd).then(() => get().toast({ kind: 'CMD', severity: 'INFO', title: 'Command queued', message: `${id}: ${Object.keys(cmd).join(', ')} — delivered on the node's next uplink`, ttl: 3500 })).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Command failed', message: e.message })),
  setArming: (mode) => api.setArming(mode).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Arming failed', message: e.message })),
  refreshActivity: () => api.activity().then(r => set({ activity: r.activity })).catch(() => {}),
  moveNode: (id, x, y) => {
    const n = get().nodes[id];
    if (n) set({ nodes: { ...get().nodes, [id]: { ...n, x, y, placed: true } } });
  },
  saveNode: (id, patch) => api.updateNode(id, patch).catch(console.error)
}));

export default useStore;
