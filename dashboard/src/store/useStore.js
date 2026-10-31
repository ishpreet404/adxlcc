import { create } from 'zustand';
import api from '../services/api';
import socket from '../services/socket';
import { alertHeadline, toMs } from '../lib/format';

const WAVE_KEEP = 600; // samples per probe kept for the scopes (6 s @ 100 Hz)
const AI_KEEP = 100;   // Gemini briefing items kept in memory
const EVENT_KEEP = 300;
let toastSeq = 0;

// ---- pages / routing ----------------------------------------------------------------------
export const PAGE_IDS = ['overview', 'alerts', 'intel', 'nodes', 'mission', 'settings', 'osint'];
const LEGACY_PAGES = { command: 'overview', node: 'nodes', incidents: 'alerts', threat: 'osint', setup: 'settings', intelligence: 'intel' };
export const normalizePage = (p) => {
  const id = LEGACY_PAGES[p] || p;
  return PAGE_IDS.includes(id) ? id : 'overview';
};
export const readHashPage = () => {
  try { return normalizePage(window.location.hash.replace(/^#\/?/, '') || 'overview'); } catch { return 'overview'; }
};

// ---- persisted preferences ----------------------------------------------------------------
const SIM_KEY = 'chaukidaar.showSimulated';
const readBool = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const writeBool = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

// ---- demo-data filtering ------------------------------------------------------------------
const EMPTY_SIM = { running: false, scenario: 'quiet', scenarios: [], actors: [], nodes: [] };
const sortAlerts = (list) => list.sort((p, q) => (q.updatedAt || 0) - (p.updatedAt || 0));
const isSimEvent = (e, rawNodes) => (e.type || '').startsWith('SIM') || e.simulated === true || !!(e.nodeId && rawNodes[e.nodeId] && rawNodes[e.nodeId].simulated);

/** Derive what the UI shows from the unfiltered server state. */
function visible(raw, show) {
  const nodes = {};
  for (const n of Object.values(raw.nodes)) if (show || !n.simulated) nodes[n.id] = n;
  return {
    nodes,
    tracks: raw.tracks.filter(t => (t.nodes || []).some(id => nodes[id])),
    alerts: raw.alerts.filter(a => show || !a.simulated),
    events: raw.events.filter(e => show || !isSimEvent(e, raw.nodes)),
    sim: show ? raw.sim : EMPTY_SIM
  };
}

const CMD_LABELS = (cmd) => {
  const parts = [];
  if (cmd.deter) parts.push(`sound alarm ${cmd.deter} s`);
  if (cmd.mode === 'LIVE') parts.push(`live mode${cmd.liveFor ? ` ${Math.round(cmd.liveFor / 60)} min` : ''}`);
  if (cmd.mode === 'ECO') parts.push('eco mode');
  if (cmd.calibrate) parts.push('calibrate');
  return parts.length ? parts.join(', ') : Object.keys(cmd).join(', ');
};

/** Newest-first union of two briefing lists, de-duplicated by id, capped at AI_KEEP. */
const mergeAi = (incoming, existing) => {
  const byId = new Map();
  for (const item of [...incoming, ...existing]) {
    if (!item) continue;
    const key = item.id !== undefined ? item.id : `${item.t}|${item.nodeId}|${item.text}`;
    if (!byId.has(key)) byId.set(key, item);
  }
  return [...byId.values()].sort((p, q) => (toMs(q.t) || 0) - (toMs(p.t) || 0)).slice(0, AI_KEEP);
};

export const useStore = create((set, get) => ({
  connected: false,
  site: { width: 40, height: 30, name: 'Perimeter Site', zones: [] },
  // unfiltered server state (simulated + real); the fields below are the filtered view
  raw: { nodes: {}, tracks: [], alerts: [], events: [], sim: EMPTY_SIM },
  nodes: {},
  waves: {},
  histories: {},      // id -> [{t, rmsA, rmsB, radar, p}] rolling 60 s for the sparklines
  tracks: [],
  alerts: [],
  events: [],
  sim: EMPTY_SIM,
  showSimulated: readBool(SIM_KEY, false),
  arming: { mode: 'ARMED', armed: true, schedule: { enabled: false, armAt: '22:00', disarmAt: '06:00' } },
  activity: null,
  notify: { webhook: false, telegram: false, siren: false },
  thresholds: { alert: 0.7, critical: 0.88, loiterS: 15 },
  selectedNodeId: null,
  page: readHashPage(),
  moreOpen: false,
  editMap: false,
  showGroundTruth: true,
  muted: false,
  wallMode: false,
  layers: { beams: true, zones: true, heat: false, trails: true, predict: true, labels: true },
  toasts: [],
  zoneDraft: null, // { points: [[x,y]...] } while drawing a zone
  loaded: false,   // first snapshot received

  // mission / deployment profile
  profile: null,
  profiles: [],
  profileStatus: 'idle', // idle | loading | ready | error
  profileError: null,
  profileBusy: null,

  // Gemini
  aiFeed: [],
  aiFeedStatus: 'idle',  // idle | loading | ready | error
  aiFeedError: null,
  brief: null,
  briefLoading: false,
  briefError: null,

  setPage: (p) => {
    const page = normalizePage(p);
    set({ page, wallMode: false, moreOpen: false });
    try { if (window.location.hash !== `#/${page}`) window.location.hash = `/${page}`; } catch { /* ignore */ }
  },
  syncPageFromHash: () => { const page = readHashPage(); if (page !== get().page) set({ page, wallMode: false, moreOpen: false }); },
  setMoreOpen: (v) => set({ moreOpen: v }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setEditMap: (v) => set({ editMap: v }),
  setShowGroundTruth: (v) => set({ showGroundTruth: v }),
  setMuted: (v) => set({ muted: v }),
  setWallMode: (v) => set({ wallMode: v, moreOpen: false }),
  toggleLayer: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setZoneDraft: (d) => set({ zoneDraft: d }),
  addZonePoint: (x, y) => { const d = get().zoneDraft; if (d) set({ zoneDraft: { ...d, points: [...d.points, [x, y]] } }); },

  setShowSimulated: (v) => {
    writeBool(SIM_KEY, v);
    const vis = visible(get().raw, v);
    const sel = get().selectedNodeId;
    set({ showSimulated: v, ...vis, selectedNodeId: sel && vis.nodes[sel] ? sel : (Object.keys(vis.nodes).sort()[0] || null) });
  },

  toast: (t) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, ...t }].slice(-5) });
    setTimeout(() => set({ toasts: get().toasts.filter(x => x.id !== id) }), t.ttl || 6000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter(x => x.id !== id) }),

  init: async () => {
    if (get()._inited) return;   // React StrictMode runs effects twice in dev
    set({ _inited: true });
    socket.onStatus((ok) => set({ connected: ok }));
    socket.onMessage((msg) => get().handle(msg));
    socket.connect();
    get().loadProfile();
    get().loadAiFeed();
    try {
      const [n, a, e, act] = await Promise.all([api.nodes(), api.alerts('?active=1'), api.events(100), api.activity().catch(() => null)]);
      get().applySnapshot({ site: n.site, nodes: n.nodes, tracks: n.tracks, alerts: a.alerts, events: e.events, activity: act && act.activity });
    } catch (err) {
      console.warn('initial load failed', err.message);
      set({ loaded: true });
    }
  },

  applySnapshot: (snap) => {
    const rawNodes = {};
    for (const n of snap.nodes || []) rawNodes[n.id] = n;
    const raw = {
      nodes: rawNodes,
      tracks: snap.tracks || [],
      alerts: sortAlerts([...(snap.alerts || [])]),
      events: [...(snap.events || [])].sort((p, q) => q.t - p.t).slice(0, EVENT_KEEP),
      sim: snap.sim || get().raw.sim
    };
    const vis = visible(raw, get().showSimulated);
    const sel = get().selectedNodeId;
    set({
      raw,
      ...vis,
      loaded: true,
      site: snap.site ? { zones: [], ...snap.site } : get().site,
      arming: snap.arming || get().arming,
      activity: snap.activity || get().activity,
      notify: snap.notify || get().notify,
      thresholds: snap.thresholds || get().thresholds,
      profile: snap.profile || get().profile,
      selectedNodeId: sel && vis.nodes[sel] ? sel : (Object.keys(vis.nodes).sort()[0] || null)
    });
  },

  handle: (msg) => {
    const { type, data } = msg;
    const show = get().showSimulated;
    switch (type) {
      case 'hello': return get().applySnapshot(data);
      case 'node': {
        const raw = { ...get().raw, nodes: { ...get().raw.nodes, [data.id]: data } };
        if (data.simulated && !show) return set({ raw });
        const nodes = { ...get().nodes, [data.id]: data };
        const patch = { raw, nodes };
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
        const rawNodes = { ...get().raw.nodes };
        delete rawNodes[data.id];
        const nodes = { ...get().nodes };
        delete nodes[data.id];
        return set({ raw: { ...get().raw, nodes: rawNodes }, nodes, selectedNodeId: get().selectedNodeId === data.id ? Object.keys(nodes)[0] || null : get().selectedNodeId });
      }
      case 'tracks': {
        const raw = { ...get().raw, tracks: data || [] };
        return set({ raw, tracks: raw.tracks.filter(t => (t.nodes || []).some(id => get().nodes[id])) });
      }
      case 'alert': {
        const { alert, action } = data;
        let list = get().raw.alerts.filter(a => a.id !== alert.id);
        if (alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED') list = [alert, ...list];
        const raw = { ...get().raw, alerts: sortAlerts(list) };
        const shown = show || !alert.simulated;
        if (shown && action === 'created') {
          get().toast({
            kind: alert.kind, severity: alert.severity, test: alert.test,
            title: `${alert.test ? 'Test · ' : ''}${alertHeadline(alert)}`,
            message: `${alert.nodeName}${alert.zone ? ` · ${alert.zone.name}` : ''}${alert.position ? ` · ${alert.position.rangeM} m` : ''}`,
            nodeId: alert.nodeId, alertId: alert.id
          });
        }
        return set({ raw, alerts: raw.alerts.filter(a => show || !a.simulated) });
      }
      case 'event': {
        const raw = { ...get().raw, events: [data, ...get().raw.events].slice(0, EVENT_KEEP) };
        if (!show && isSimEvent(data, raw.nodes)) return set({ raw });
        return set({ raw, events: [data, ...get().events].slice(0, EVENT_KEEP) });
      }
      case 'sim': {
        const raw = { ...get().raw, sim: data || EMPTY_SIM };
        return set(show ? { raw, sim: raw.sim } : { raw });
      }
      case 'site': return set({ site: { zones: [], ...data } });
      case 'notify': return set({ notify: data });
      case 'arming': {
        const prev = get().arming;
        if (prev.mode !== data.mode) get().toast({ kind: 'ARMING', severity: data.mode === 'DISARMED' ? 'LOW' : 'INFO', title: `Site ${data.mode.toLowerCase()}`, message: `by ${data.by}`, ttl: 4000 });
        return set({ arming: data });
      }
      case 'ai': {
        if (!data) return undefined;
        return set({ aiFeed: mergeAi([data], get().aiFeed), aiFeedStatus: get().aiFeedStatus === 'idle' ? 'ready' : get().aiFeedStatus });
      }
      case 'profile': {
        if (!data) return undefined;
        const prev = get().profile;
        if (prev && prev.id !== data.id) get().toast({ kind: 'MISSION', severity: 'INFO', title: 'Mission changed', message: data.name, ttl: 4000 });
        const profiles = get().profiles.some(p => p.id === data.id) ? get().profiles.map(p => (p.id === data.id ? data : p)) : get().profiles;
        return set({ profile: data, profiles });
      }
      default: return undefined;
    }
  },

  // ---- loaders ---------------------------------------------------------------------------
  loadProfile: async () => {
    set({ profileStatus: get().profiles.length ? 'ready' : 'loading' });
    try {
      const r = await api.profile();
      set({ profile: r.profile || get().profile, profiles: r.profiles || [], profileStatus: 'ready', profileError: null });
    } catch (e) {
      set({ profileStatus: 'error', profileError: e.message });
    }
  },
  setProfile: async (id) => {
    set({ profileBusy: id });
    try {
      const r = await api.setProfile(id);
      const p = r.profile;
      if (p) set({ profile: p, profiles: get().profiles.map(x => (x.id === p.id ? p : x)) });
      get().toast({ kind: 'MISSION', severity: 'INFO', title: 'Mission activated', message: p ? p.name : id, ttl: 3500 });
    } catch (e) {
      get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Could not change mission', message: e.message });
    } finally {
      set({ profileBusy: null });
    }
  },
  loadAiFeed: async () => {
    if (!get().aiFeed.length) set({ aiFeedStatus: 'loading' });
    const r = await api.aiFeed();
    if (r && r.ok) set({ aiFeed: mergeAi(r.items || [], get().aiFeed), aiFeedStatus: 'ready', aiFeedError: null });
    else set({ aiFeedStatus: get().aiFeed.length ? 'ready' : 'error', aiFeedError: (r && r.error) || 'Briefing feed unavailable' });
  },
  requestBrief: async (minutes = 60) => {
    if (get().briefLoading) return;
    set({ briefLoading: true, briefError: null });
    const r = await api.aiBrief(minutes);
    if (r && r.ok && r.text) set({ brief: { ...r, receivedAt: Date.now() }, briefError: null, briefLoading: false });
    else set({ briefError: (r && r.error) || 'The report could not be generated.', briefLoading: false });
  },

  // ---- actions ---------------------------------------------------------------------------
  acknowledge: (id) => api.acknowledge(id).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Acknowledge failed', message: e.message })),
  resolve: (id) => api.resolve(id).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Resolve failed', message: e.message })),
  dismiss: (id) => api.dismiss(id).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Dismiss failed', message: e.message })),
  acknowledgeAll: () => api.acknowledgeAll().catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Acknowledge all failed', message: e.message })),
  command: (id, cmd) => api.command(id, cmd)
    .then(() => get().toast({ kind: 'CMD', severity: 'INFO', title: 'Command queued', message: `${id}: ${CMD_LABELS(cmd)} — delivered on the node's next uplink`, ttl: 3500 }))
    .catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Command failed', message: e.message })),
  setArming: (mode) => api.setArming(mode).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Arming failed', message: e.message })),
  refreshActivity: () => api.activity().then(r => set({ activity: r.activity })).catch(() => {}),
  moveNode: (id, x, y) => {
    const n = get().nodes[id];
    if (n) set({ nodes: { ...get().nodes, [id]: { ...n, x, y, placed: true } } });
  },
  saveNode: (id, patch) => api.updateNode(id, patch).catch(e => get().toast({ kind: 'ERR', severity: 'HIGH', title: 'Save failed', message: e.message }))
}));

export default useStore;
