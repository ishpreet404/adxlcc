export const fmt = (v, d = 2, unit = '') => (v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toFixed(d)}${unit}`);

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

export const clock = (t) => new Date(t).toLocaleTimeString([], { hour12: false });

export const statusColor = (status) => ({ ONLINE: 'text-terminal-green', WARNING: 'text-terminal-amber', OFFLINE: 'text-terminal-red' }[status] || 'text-terminal-muted');

export const levelColor = (level) => ({ INTRUSION: 'text-terminal-red', SUSPECT: 'text-terminal-amber', ACTIVITY: 'text-terminal-cyan', CLEAR: 'text-terminal-green' }[level] || 'text-terminal-muted');

export const levelHex = (level) => ({ INTRUSION: '#ff3344', SUSPECT: '#ffb000', ACTIVITY: '#00e5ff', CLEAR: '#00ff66' }[level] || '#8b949e');

export const severityBadge = (sev) => ({ CRITICAL: 'error', HIGH: 'error', MEDIUM: 'warning', LOW: 'info', INFO: 'ok' }[sev] || 'info');

export const kindHex = (kind) => ({ INTRUSION: '#ff3344', TAMPER: '#a78bfa', LOITER: '#ffb000' }[kind] || '#8b949e');

export const zoneHex = (type) => ({ restricted: '#ff3344', watch: '#ffb000', allowed: '#00ff66' }[type] || '#8b949e');

export const rssiBars = (rssi) => (rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : rssi >= -88 ? 1 : 0);

export const batteryColor = (p) => (p > 50 ? '#00ff66' : p > 20 ? '#ffb000' : '#ff3344');

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
export const vibLevel = (rms) => (rms > 0.12 ? { word: 'STRONG', color: '#ff3344' } : rms > 0.04 ? { word: 'ACTIVE', color: '#ffb000' } : rms > 0.02 ? { word: 'LOW', color: '#00e5ff' } : { word: 'QUIET', color: '#00ff66' });

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
