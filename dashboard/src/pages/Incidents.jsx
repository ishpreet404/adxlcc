import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Play, Pause, X, RefreshCw, ShieldCheck, BarChart3, Clock3, ScrollText, History } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Button, EmptyState, SkeletonLines } from '../components';
import { AlertCard } from '../components/alerts/AlertFeed';
import EventLog from '../components/alerts/EventLog';
import { csvEscape, clock, titleCase, fmtInt } from '../lib/format';
import { useElementWidth } from '../lib/hooks';

const SANS = 'Inter, system-ui, sans-serif';

/** Simple bar chart (canvas), redrawn on resize. */
const Bars = ({ data, height = 110, color = '#ef4444', labels, label }) => {
  const ref = useRef(null);
  const wrap = useRef(null);
  const w = useElementWidth(wrap, 300);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const max = Math.max(1, ...data);
    const bw = w / data.length;
    data.forEach((v, i) => {
      const h = (v / max) * (height - 24);
      if (h <= 0) return;
      ctx.fillStyle = color; ctx.globalAlpha = 0.45 + 0.55 * (v / max);
      const x = i * bw + 1, y = height - 16 - h, ww = Math.max(1, bw - 2), r = Math.min(2, ww / 2, h);
      ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.lineTo(x + ww - r, y); ctx.quadraticCurveTo(x + ww, y, x + ww, y + r); ctx.lineTo(x + ww, y + h); ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1; ctx.fillStyle = '#8b97a8'; ctx.font = `10px ${SANS}`; ctx.textAlign = 'center';
    labels.forEach((l, i) => { if (l) ctx.fillText(l, i * bw + bw / 2, height - 3); });
    ctx.textAlign = 'right'; ctx.fillText(`max ${max.toLocaleString()}`, w - 4, 10);
  }, [data, height, color, labels, w]);
  return <div ref={wrap} className="w-full min-w-0"><canvas ref={ref} style={{ width: '100%', height }} className="block" role="img" aria-label={label} /></div>;
};

/** Incident replay: scrub through an alert's frames on a mini map. */
const Replay = ({ alert, onClose }) => {
  const site = useStore(s => s.site);
  const nodes = useStore(s => s.nodes);
  const [frames, setFrames] = useState(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    let alive = true;
    const fallback = () => (alert.track || []).map(p => ({ t: p.t, x: p.x, y: p.y, p: alert.probability, r: null, a: null, b: null }));
    api.alert(alert.id)
      .then(r => alive && setFrames(r.alert.frames && r.alert.frames.length ? r.alert.frames : fallback()))
      .catch(() => alive && setFrames(fallback()));
    setI(0);
    return () => { alive = false; };
  }, [alert]);
  useEffect(() => {
    if (!playing || !frames || !frames.length) return undefined;
    const t = setInterval(() => setI(v => (v + 1) % frames.length), 200);
    return () => clearInterval(t);
  }, [playing, frames]);
  const W = site.width, H = site.height;
  const node = nodes[alert.nodeId];
  const f = frames && frames[i];
  return (
    <Card title={`Replay · ${alert.nodeName}`} subtitle={`${titleCase(alert.kind)} · ${alert.id}`} icon={History}
      headerAction={<button type="button" onClick={onClose} aria-label="Close replay" className="w-8 h-8 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-gray-100 hover:bg-white/5"><X className="w-4 h-4" aria-hidden="true" /></button>}>
      {!frames ? <SkeletonLines lines={4} /> : !frames.length ? <div className="text-terminal-muted text-[13px]">No frames were recorded for this alert.</div> : (
        <div className="space-y-3">
          <svg viewBox={`-1 -1 ${W + 2} ${H + 2}`} className="w-full h-56 sm:h-64 rounded-lg bg-[#0d141c] border border-terminal-border" role="img" aria-label="Replay of the target track on the site map">
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="#243142" strokeWidth="0.15" />
            {Object.values(nodes).map(n => <g key={n.id}><rect x={n.x - 0.5} y={H - n.y - 0.5} width={1} height={1} fill="#111821" stroke={n.id === alert.nodeId ? '#ef4444' : '#8b97a8'} strokeWidth="0.12" transform={`rotate(45 ${n.x} ${H - n.y})`} /><text x={n.x} y={H - n.y - 1} fontSize="0.8" fill="#9ca3af" textAnchor="middle">{n.name}</text></g>)}
            <polyline points={frames.slice(0, i + 1).filter(p => p.x !== null).map(p => `${p.x},${H - p.y}`).join(' ')} fill="none" stroke="#ef4444" strokeWidth="0.12" strokeDasharray="0.3 0.2" />
            {f && f.x !== null && <g><circle cx={f.x} cy={H - f.y} r={0.6} fill="none" stroke="#ef4444" strokeWidth="0.15" /><circle cx={f.x} cy={H - f.y} r={0.2} fill="#ef4444" /></g>}
            {f && f.r && node && <circle cx={node.x} cy={H - node.y} r={f.r} fill="none" stroke="#38bdf8" strokeWidth="0.06" strokeDasharray="0.3 0.3" />}
          </svg>
          <div className="flex items-center gap-3 text-[12px]">
            <Button size="sm" variant="outline" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause className="w-3.5 h-3.5" aria-hidden="true" /> : <Play className="w-3.5 h-3.5" aria-hidden="true" />}</Button>
            <input type="range" min={0} max={frames.length - 1} value={i} onChange={e => { setPlaying(false); setI(Number(e.target.value)); }} className="flex-1 accent-sky-400" aria-label="Replay position" />
            <span className="num text-terminal-muted text-right hidden sm:inline">{f ? `${clock(f.t)} · p ${Math.round((f.p || 0) * 100)}%${f.r ? ` · radar ${f.r} m` : ''}` : ''}</span>
          </div>
          {f && <div className="text-[12px] text-terminal-muted num">Frame {i + 1}/{frames.length} · probe A {f.a !== null && f.a !== undefined ? f.a.toFixed(4) : '—'} g · probe B {f.b !== null && f.b !== undefined ? f.b.toFixed(4) : '—'} g</div>}
        </div>
      )}
    </Card>
  );
};

const PAGE_SIZE = 25;
const STATUSES = ['ALL', 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'];
const KINDS = ['ALL', 'INTRUSION', 'TAMPER', 'LOITER'];

const Segmented = ({ options, value, onChange, counts = {}, label }) => (
  <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1" role="radiogroup" aria-label={label}>
    {options.map(o => (
      <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
        className={`h-9 lg:h-8 px-3 rounded-lg text-[13px] lg:text-xs font-medium whitespace-nowrap border transition-colors ${value === o ? 'bg-terminal-blue/15 text-sky-300 border-terminal-blue/40' : 'border-terminal-border text-gray-400 hover:text-gray-100'}`}>
        {o === 'ALL' ? 'All' : titleCase(o)}{counts[o] ? <span className="num ml-1.5 text-terminal-muted">{counts[o]}</span> : null}
      </button>
    ))}
  </div>
);

export const Incidents = () => {
  const active = useStore(s => s.alerts);
  const activity = useStore(s => s.activity);
  const refreshActivity = useStore(s => s.refreshActivity);
  const showSim = useStore(s => s.showSimulated);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [kind, setKind] = useState('ALL');
  const [replay, setReplay] = useState(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => { setLimit(PAGE_SIZE); }, [filter, kind]);

  useEffect(() => {
    let alive = true;
    const load = () => api.alerts('?limit=300').then(r => { if (alive) { setHistory(r.alerts || []); setLoaded(true); } }).catch(() => alive && setLoaded(true));
    load(); refreshActivity();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') { load(); refreshActivity(); } }, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [refreshActivity]);

  const merged = useMemo(() => [...active, ...history.filter(h => (showSim || !h.simulated) && !active.some(a => a.id === h.id))], [active, history, showSim]);
  const shown = merged.filter(a => (filter === 'ALL' || a.status === filter) && (kind === 'ALL' || a.kind === kind));
  const counts = merged.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; acc[a.kind] = (acc[a.kind] || 0) + 1; return acc; }, {});

  const exportCsv = () => {
    const cols = ['id', 'kind', 'severity', 'status', 'nodeId', 'nodeName', 'createdAt', 'updatedAt', 'targetClass', 'probability', 'peakProbability', 'zone', 'x', 'y', 'rangeM', 'bearingDeg', 'speed', 'running', 'test', 'simulated', 'ackBy', 'headline', 'narrative', 'evidenceHash'];
    const rows = merged.map(a => [a.id, a.kind, a.severity, a.status, a.nodeId, a.nodeName, new Date(a.createdAt).toISOString(), new Date(a.updatedAt).toISOString(), a.targetClass, a.probability, a.peakProbability,
      a.zone ? a.zone.name : '', a.position ? a.position.x : '', a.position ? a.position.y : '', a.position ? a.position.rangeM : '', a.position ? a.position.bearingDeg : '',
      a.kinematics ? a.kinematics.speed : '', a.kinematics ? a.kinematics.running : '', a.test, !!a.simulated, a.ackBy || '',
      a.interpretation && a.interpretation.title ? a.interpretation.title : '', a.narrative || '', a.evidenceHash || '']);
    const csv = [cols.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = `alerts-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const last24 = useMemo(() => (activity ? activity.last24h.map(b => b.n) : []), [activity]);
  const last24Labels = useMemo(() => (activity ? activity.last24h.map((b, i) => (i % 4 === 0 ? `${new Date(b.t).getHours()}h` : '')) : []), [activity]);
  const byHourLabels = useMemo(() => Array.from({ length: 24 }, (_, h) => (h % 3 === 0 ? `${h}` : '')), []);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-[13px] text-terminal-muted max-w-2xl">Every alert raised by the fusion engine, with its AI summary, tamper-evident evidence hash and track replay.</p>
        <Button size="sm" variant="outline" onClick={exportCsv} disabled={!merged.length}><Download className="w-3.5 h-3.5" aria-hidden="true" />Export CSV <span className="num text-terminal-muted">{fmtInt(merged.length)}</span></Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-3 min-w-0">
          {replay && <Replay alert={replay} onClose={() => setReplay(null)} />}
          <div className="space-y-2">
            <Segmented label="Filter by status" options={STATUSES} value={filter} onChange={setFilter} counts={counts} />
            <Segmented label="Filter by kind" options={KINDS} value={kind} onChange={setKind} counts={counts} />
          </div>
          {!loaded && !merged.length ? (
            <div className="rounded-xl border border-terminal-border bg-terminal-dark p-4"><SkeletonLines lines={5} /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl border border-terminal-border bg-terminal-dark">
              <EmptyState icon={ShieldCheck} tone="ok" title="No alerts here">
                {filter !== 'ALL' || kind !== 'ALL' ? 'Nothing matches these filters.' : 'The fusion engine has not raised any alerts yet.'}
              </EmptyState>
            </div>
          ) : (
            <>
              {shown.slice(0, limit).map(a => <AlertCard key={a.id} alert={a} detailed onReplay={setReplay} />)}
              {shown.length > limit && (
                <Button size="md" variant="outline" className="w-full" onClick={() => setLimit(l => l + PAGE_SIZE)}>
                  Show more <span className="num text-terminal-muted">({fmtInt(shown.length - limit)} remaining)</span>
                </Button>
              )}
            </>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <Card title="Activity · last 24 h" subtitle={`Target position samples per hour · ${activity ? fmtInt(activity.total) : 0} total`} icon={BarChart3}
            headerAction={<button type="button" onClick={refreshActivity} aria-label="Refresh activity" className="w-8 h-8 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-gray-100 hover:bg-white/5"><RefreshCw className="w-4 h-4" aria-hidden="true" /></button>}>
            {activity ? <Bars data={last24} labels={last24Labels} label="Target position samples per hour over the last 24 hours" /> : <SkeletonLines lines={3} />}
          </Card>
          <Card title="Activity by hour of day" subtitle="When the site is busiest — use it to plan the arming schedule" icon={Clock3}>
            {activity ? <Bars data={activity.byHour} labels={byHourLabels} color="#f59e0b" label="Activity by hour of day" /> : <SkeletonLines lines={3} />}
          </Card>
          <Card title="Event log" icon={ScrollText}><EventLog limit={200} height={420} /></Card>
        </div>
      </div>
    </div>
  );
};

export default Incidents;
