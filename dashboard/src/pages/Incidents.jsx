import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Play, Pause, X, RefreshCw } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Separator, Button } from '../components';
import { AlertCard } from '../components/alerts/AlertFeed';
import EventLog from '../components/alerts/EventLog';
import { csvEscape, clock } from '../lib/format';

/** Bar chart (canvas) */
const Bars = ({ data, height = 110, color = '#ff3344', labels }) => {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c10'; ctx.fillRect(0, 0, w, height);
    const max = Math.max(1, ...data);
    const bw = w / data.length;
    data.forEach((v, i) => {
      const h = (v / max) * (height - 22);
      ctx.fillStyle = color; ctx.globalAlpha = 0.35 + 0.65 * (v / max);
      ctx.fillRect(i * bw + 1, height - 14 - h, bw - 2, h);
    });
    ctx.globalAlpha = 1; ctx.fillStyle = '#6b7280'; ctx.font = '9px "JetBrains Mono", monospace'; ctx.textAlign = 'center';
    labels.forEach((l, i) => { if (l) ctx.fillText(l, i * bw + bw / 2, height - 3); });
    ctx.textAlign = 'right'; ctx.fillText(`max ${max}`, w - 4, 10);
  }, [data, height, color, labels]);
  return <canvas ref={ref} style={{ width: '100%', height }} className="block border border-terminal-border" />;
};

/** Incident replay: scrub through an alert's frames on a mini map. */
const Replay = ({ alert, onClose }) => {
  const site = useStore(s => s.site);
  const nodes = useStore(s => s.nodes);
  const [frames, setFrames] = useState(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => { api.alert(alert.id).then(r => setFrames(r.alert.frames && r.alert.frames.length ? r.alert.frames : alert.track.map(p => ({ t: p.t, x: p.x, y: p.y, p: alert.probability, r: null, a: null, b: null })))).catch(() => setFrames([])); setI(0); }, [alert]);
  useEffect(() => {
    if (!playing || !frames || !frames.length) return undefined;
    const t = setInterval(() => setI(v => (v + 1) % frames.length), 200);
    return () => clearInterval(t);
  }, [playing, frames]);
  const W = site.width, H = site.height;
  const node = nodes[alert.nodeId];
  const f = frames && frames[i];
  return (
    <div className="border border-terminal-cyan p-2 space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <div className="font-bold text-terminal-cyan">REPLAY {alert.id} · {alert.kind} @ {alert.nodeName}</div>
        <button onClick={onClose} className="text-terminal-muted hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      {!frames ? <div className="text-terminal-muted text-[11px]">loading…</div> : !frames.length ? <div className="text-terminal-muted text-[11px]">no frames recorded</div> : (
        <>
          <svg viewBox={`-1 -1 ${W + 2} ${H + 2}`} className="w-full h-64 bg-[#0a1017] border border-terminal-border">
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="#374151" strokeWidth="0.15" />
            {Object.values(nodes).map(n => <g key={n.id}><rect x={n.x - 0.5} y={H - n.y - 0.5} width={1} height={1} fill="#0c1219" stroke={n.id === alert.nodeId ? '#ff3344' : '#6b7280'} strokeWidth="0.12" transform={`rotate(45 ${n.x} ${H - n.y})`} /><text x={n.x} y={H - n.y - 1} fontSize="0.8" fill="#9ca3af" textAnchor="middle">{n.name}</text></g>)}
            <polyline points={frames.slice(0, i + 1).filter(p => p.x !== null).map(p => `${p.x},${H - p.y}`).join(' ')} fill="none" stroke="#ff3344" strokeWidth="0.12" strokeDasharray="0.3 0.2" />
            {f && f.x !== null && <g><circle cx={f.x} cy={H - f.y} r={0.6} fill="none" stroke="#ff3344" strokeWidth="0.15" /><circle cx={f.x} cy={H - f.y} r={0.2} fill="#ff3344" /></g>}
            {f && f.r && node && <circle cx={node.x} cy={H - node.y} r={f.r} fill="none" stroke="#00e5ff" strokeWidth="0.06" strokeDasharray="0.3 0.3" />}
          </svg>
          <div className="flex items-center gap-2 text-[10px]">
            <Button size="sm" variant="outline" onClick={() => setPlaying(!playing)}>{playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}</Button>
            <input type="range" min={0} max={frames.length - 1} value={i} onChange={e => { setPlaying(false); setI(Number(e.target.value)); }} className="flex-1" />
            <span className="tabular-nums text-terminal-muted w-36 text-right">{f ? `${clock(f.t)} · p ${Math.round((f.p || 0) * 100)}%${f.r ? ` · radar ${f.r} m` : ''}` : ''}</span>
          </div>
          {f && <div className="text-[10px] text-terminal-muted">frame {i + 1}/{frames.length} · probe A {f.a !== null ? f.a.toFixed(4) : '—'} g · probe B {f.b !== null ? f.b.toFixed(4) : '—'} g</div>}
        </>
      )}
    </div>
  );
};

export const Incidents = () => {
  const active = useStore(s => s.alerts);
  const activity = useStore(s => s.activity);
  const refreshActivity = useStore(s => s.refreshActivity);
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [replay, setReplay] = useState(null);

  const load = () => api.alerts('?limit=300').then(r => setHistory(r.alerts)).catch(() => {});
  useEffect(() => { load(); refreshActivity(); const t = setInterval(() => { load(); refreshActivity(); }, 5000); return () => clearInterval(t); }, [refreshActivity]);

  const merged = [...active, ...history.filter(h => !active.some(a => a.id === h.id))];
  const shown = merged.filter(a => (filter === 'ALL' || a.status === filter) && (kind === 'ALL' || a.kind === kind));
  const counts = merged.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {});

  const exportCsv = () => {
    const cols = ['id', 'kind', 'severity', 'status', 'nodeId', 'nodeName', 'createdAt', 'updatedAt', 'targetClass', 'probability', 'peakProbability', 'zone', 'x', 'y', 'rangeM', 'bearingDeg', 'speed', 'running', 'test', 'ackBy'];
    const rows = merged.map(a => [a.id, a.kind, a.severity, a.status, a.nodeId, a.nodeName, new Date(a.createdAt).toISOString(), new Date(a.updatedAt).toISOString(), a.targetClass, a.probability, a.peakProbability,
      a.zone ? a.zone.name : '', a.position ? a.position.x : '', a.position ? a.position.y : '', a.position ? a.position.rangeM : '', a.position ? a.position.bearingDeg : '',
      a.kinematics ? a.kinematics.speed : '', a.kinematics ? a.kinematics.running : '', a.test, a.ackBy || '']);
    const csv = [cols.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `incidents-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const last24 = useMemo(() => activity ? activity.last24h.map(b => b.n) : [], [activity]);
  const last24Labels = useMemo(() => activity ? activity.last24h.map((b, i) => (i % 4 === 0 ? new Date(b.t).getHours() + 'h' : '')) : [], [activity]);
  const byHourLabels = useMemo(() => Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? `${h}` : '')), []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-shadow-terminal">$ INCIDENTS --log</h1>
          <p className="text-terminal-muted text-sm">Every alert raised by the fusion engine, with the evidence behind it, replay and activity statistics.</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="w-3 h-3 mr-1" /> EXPORT CSV ({merged.length})</Button>
      </div>
      <Separator variant="equals" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 space-y-2">
          {replay && <Replay alert={replay} onClose={() => setReplay(null)} />}
          <div className="flex gap-1 flex-wrap items-center">
            {['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].map(s => (
              <Button key={s} size="sm" variant={filter === s ? 'primary' : 'outline'} onClick={() => setFilter(s)}>{s}{s !== 'ALL' && counts[s] ? ` (${counts[s]})` : ''}</Button>
            ))}
            <span className="text-terminal-muted text-[10px] ml-2">kind</span>
            {['ALL', 'INTRUSION', 'TAMPER', 'LOITER'].map(k => (
              <Button key={k} size="sm" variant={kind === k ? 'warning' : 'outline'} onClick={() => setKind(k)}>{k}</Button>
            ))}
          </div>
          {shown.length === 0 && <div className="text-terminal-muted text-sm border border-terminal-border p-4">No alerts{filter !== 'ALL' ? ` with status ${filter}` : ''}.</div>}
          {shown.map(a => <AlertCard key={a.id} alert={a} detailed onReplay={setReplay} />)}
        </div>
        <div className="space-y-3">
          <Card className="!h-auto" title="ACTIVITY · LAST 24 H" headerAction={<button onClick={refreshActivity} className="text-terminal-muted hover:text-white"><RefreshCw className="w-3 h-3" /></button>}>
            {activity ? <Bars data={last24} labels={last24Labels} /> : <div className="text-terminal-muted text-[11px]">no data</div>}
            <div className="text-[10px] text-terminal-muted mt-1">target position samples per hour · {activity ? activity.total : 0} total</div>
          </Card>
          <Card className="!h-auto" title="ACTIVITY · BY HOUR OF DAY">
            {activity ? <Bars data={activity.byHour} labels={byHourLabels} color="#ffb000" /> : <div className="text-terminal-muted text-[11px]">no data</div>}
            <div className="text-[10px] text-terminal-muted mt-1">when the site is busiest — use it to pick the arming schedule</div>
          </Card>
          <Card className="!h-auto" title="EVENT LOG"><EventLog limit={200} height={420} /></Card>
        </div>
      </div>
    </div>
  );
};

export default Incidents;
