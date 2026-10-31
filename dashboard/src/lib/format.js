/** Palette (hex) for canvas/SVG drawing — mirrors the `terminal.*` Tailwind tokens. */
export const C = {
  bg: '#0b1017', card: '#111821', surface: '#162030', border: '#243142', grid: '#1c2736',
  muted: '#8b97a8', faint: '#5b6778', text: '#e5e7eb',
  green: '#22c55e', amber: '#f59e0b', red: '#ef4444', cyan: '#38bdf8', blue: '#3b82f6', violet: '#a78bfa', orange: '#f97316'
};

export const fmt = (v, d = 2, unit = '') => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(d)}${unit}`);

const intFmt = new Intl.NumberFormat();
/** Integer with thousands separators ("12,345"). */
export const fmtInt = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : intFmt.format(Math.round(Number(v))));

/** Number with up to `d` decimals and thousands separators. */
export const fmtNum = (v, d = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: d }).format(Number(v)));

/** Bytes → "512 B", "1.4 KB", "23.0 MB", "1.20 GB". */
export const fmtBytes = (b) => {
  const n = Number(b);
  if (b === null || b === undefined || Number.isNaN(n)) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

/** Accept epoch ms, epoch s, ISO strings or Date and return epoch ms (or null). */
export const toMs = (t) => {
  if (t === null || t === undefined || t === '') return null;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'number') return t < 1e11 ? t * 1000 : t;
  if (/^\d+$/.test(String(t))) return toMs(Number(t));
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
};

/** Short relative time: "just now", "12 s ago", "5 min ago", "3 h ago", "2 d ago". */
export const relTime = (t, now = Date.now()) => {
  const ms = toMs(t);
  if (!ms) return '—';
  const s = Math.round((now - ms) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

/** Duration between two instants: "3 h 12 min", "2 d 4 h". */
export const span = (ms) => {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
};

export const ago = (t) => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
};

export const uptime = (ms) => {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

export const hours = (h) => (h === null || h === undefined ? '—' : h >= 48 ? `${(h / 24).toFixed(1)} d` : `${h.toFixed(1)} h`);

export const clock = (t) => new Date(toMs(t) || t).toLocaleTimeString([], { hour12: false });
export const clockShort = (t) => new Date(toMs(t) || t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** "ACKNOWLEDGED" → "Acknowledged", "HIGH_RISK zone" → "High risk zone". */
export const titleCase = (s) => {
  if (s === null || s === undefined) return '';
  const str = String(s).replace(/_/g, ' ').toLowerCase();
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const statusColor = (status) => ({ ONLINE: 'text-terminal-green', WARNING: 'text-terminal-amber', OFFLINE: 'text-terminal-red' }[status] || 'text-terminal-muted');

export const levelColor = (level) => ({ INTRUSION: 'text-terminal-red', SUSPECT: 'text-terminal-amber', ACTIVITY: 'text-terminal-cyan', CLEAR: 'text-terminal-green' }[level] || 'text-terminal-muted');

export const levelHex = (level) => ({ INTRUSION: C.red, SUSPECT: C.amber, ACTIVITY: C.cyan, CLEAR: C.green }[level] || C.muted);

export const severityBadge = (sev) => ({ CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'info', INFO: 'ok' }[sev] || 'info');

/** Severity → hex (status palette: critical / serious / warning, then info hues). */
export const severityHex = (sev) => ({ CRITICAL: '#d03b3b', HIGH: '#ec835a', MEDIUM: '#fab219', LOW: '#3987e5', INFO: '#6b7686' }[sev] || '#6b7686');
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export const kindHex = (kind) => ({ INTRUSION: C.red, TAMPER: C.violet, LOITER: C.amber }[kind] || C.muted);

export const zoneHex = (type) => ({ restricted: C.red, watch: C.amber, allowed: C.green }[type] || C.muted);

export const rssiBars = (rssi) => (rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -88 ? 1 : 0);

export const batteryColor = (p) => (p > 50 ? C.green : p > 20 ? C.amber : C.red);

export const compass = (deg) => {
  if (deg === null || deg === undefined) return '—';
  const names = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
  return names[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
};

export const csvEscape = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Plain-language vibration level for a probe RMS (g). */
export const vibLevel = (rms) => (rms > 0.12 ? { word: 'Strong', color: C.red } : rms > 0.04 ? { word: 'Active', color: C.amber } : rms > 0.02 ? { word: 'Low', color: C.cyan } : { word: 'Quiet', color: C.green });

/** One-sentence verdict for the selected node. */
export const verdictSentence = (node, track) => {
  if (!node || !node.latest) return 'Waiting for the first packet from this node.';
  const f = node.fusion, t = node.latest, pos = node.position;
  if (t.tamper && t.tamper.flag) return `Node tampered: body ${t.tamper.impact ? 'struck' : 'tilted'} ${fmt(t.tamper.tilt, 0)}° from its rest position.`;
  if (!f || f.level === 'CLEAR') {
    if (t.radar.presence) return `Radar sees something ${fmt(t.radar.distance, 1)} m away but the ground is quiet.`;
    return 'All quiet. Ground probes at noise floor, radar clear.';
  }
  const who = f.targetClass === 'VEHICLE' ? 'a vehicle' : f.targetClass === 'HUMAN' ? (track && track.running ? 'someone running' : 'a person walking') : 'movement';
  const where = pos ? ` about ${fmt(pos.rangeM, 1)} m ${pos.thetaDeg > 15 ? 'to the right' : pos.thetaDeg < -15 ? 'to the left' : 'straight ahead'}` : '';
  const dir = track && track.speed > 0.15 ? `, heading ${compass(track.headingDeg)} at ${fmt(track.speed, 1)} m/s` : '';
  const sure = f.probability >= 0.88 ? 'Confirmed' : f.probability >= 0.7 ? 'Likely' : f.probability >= 0.5 ? 'Possibly' : 'Faint signs of';
  return `${sure} ${who}${where}${dir}.`;
};

/** Human headline for an alert; mission profiles can override it via alert.interpretation.title. */
export const alertHeadline = (a) => {
  if (!a) return '';
  if (a.interpretation && a.interpretation.title) return a.interpretation.title;
  if (a.kind === 'TAMPER') return `Node tamper${a.tamper && a.tamper.impact ? ' (impact)' : ''}`;
  if (a.kind === 'LOITER') return `Loitering${a.loiterS ? ` for ${a.loiterS} s` : ''}`;
  const cls = a.targetClass;
  const base = cls === 'VEHICLE' ? 'Vehicle detected' : cls === 'HUMAN' ? 'Human intruder' : cls && cls !== 'UNKNOWN' ? `${titleCase(cls)} detected` : 'Unidentified intrusion';
  return `${base}${a.kinematics && a.kinematics.running ? ' · running' : ''}`;
};
