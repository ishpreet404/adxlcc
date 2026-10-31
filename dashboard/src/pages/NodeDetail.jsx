import React, { useEffect, useRef, useState } from 'react';
import { Disc, Square, Cpu, Activity, BarChart3, Radar, Brain, Table2, Map as MapIcon, Gauge, GraduationCap, ListTree } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Button, Select, StatusBadge, Tag, EmptyState } from '../components';
import RadarScope from '../components/radar/RadarScope';
import SeismicScope from '../components/seismic/SeismicScope';
import ProbeCards from '../components/seismic/ProbeCards';
import SpectrumBars from '../components/seismic/SpectrumBars';
import EnergyHistory from '../components/seismic/EnergyHistory';
import SnapshotTiles from '../components/SnapshotTiles';
import TelemetryColumn from '../components/telemetry/TelemetryColumn';
import NodeList from '../components/telemetry/NodeList';
import { NodeControls, NodePicker } from '../components/telemetry/NodeControls';
import FusionPanel from '../components/FusionPanel';
import SiteMap from '../components/map/SiteMap';
import { fmt, titleCase, relTime } from '../lib/format';
import { useElementWidth } from '../lib/hooks';

const FEATURES = [
  ['rms', 'RMS', 'g', 4], ['peak', 'Peak', 'g', 4], ['peakToPeak', 'Peak-to-peak', 'g', 4], ['variance', 'Variance', '', 6],
  ['dominantFrequency', 'Dominant frequency', 'Hz', 1], ['spectralEnergy', 'Spectral energy', '', 5], ['spectralCentroid', 'Centroid', 'Hz', 1],
  ['interPeakInterval', 'Inter-peak interval', 'ms', 0], ['zeroCrossingRate', 'Zero-crossing rate', 'Hz', 1], ['crestFactor', 'Crest factor', '', 2],
  ['kurtosis', 'Kurtosis (spikiness)', '', 1], ['spectralFlatness', 'Spectral flatness', '', 3], ['lowBandRatio', 'Low band 1–8 Hz', '', 2],
  ['highBandRatio', 'High band 20–50 Hz', '', 2], ['cadenceStrength', 'Cadence strength', '', 2]
];

const SERIES = [
  { key: 'p', color: '#ef4444', max: 1, label: 'Intrusion probability' },
  { key: 'rmsA', color: '#22c55e', max: 0.25, label: 'Probe A RMS' },
  { key: 'rmsB', color: '#f59e0b', max: 0.25, label: 'Probe B RMS' },
  { key: 'radar', color: '#38bdf8', max: 8, label: 'Radar range' }
];

/** Multi-series history strip chart (canvas), redrawn on resize. */
const History = ({ history, height = 130 }) => {
  const ref = useRef(null);
  const wrap = useRef(null);
  const w = useElementWidth(wrap, 400);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1017'; ctx.fillRect(0, 0, w, height);
    ctx.strokeStyle = '#1c2736';
    [0.25, 0.5, 0.75].forEach(f => { ctx.beginPath(); ctx.moveTo(0, f * height); ctx.lineTo(w, f * height); ctx.stroke(); });
    if (!history.length) {
      ctx.fillStyle = '#8b97a8'; ctx.font = '12px Inter, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('No history yet', w / 2, height / 2 + 4);
      return;
    }
    const n = history.length;
    const x = i => (i / Math.max(1, n - 1)) * w;
    for (const s of SERIES) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.beginPath();
      let started = false;
      history.forEach((h, i) => {
        const v = h[s.key];
        if (v === null || v === undefined) { started = false; return; }
        const y = height - 4 - Math.min(1, v / s.max) * (height - 12);
        if (!started) { ctx.moveTo(x(i), y); started = true; } else ctx.lineTo(x(i), y);
      });
      ctx.stroke();
    }
  }, [history, height, w]);
  return (
    <div ref={wrap} className="w-full min-w-0">
      <canvas ref={ref} style={{ width: '100%', height }} className="block rounded-lg border border-terminal-border" role="img" aria-label="Two-minute history of intrusion probability, probe vibration and radar range" />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-terminal-muted" aria-label="Legend">
        {SERIES.map(s => <li key={s.key} className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded" style={{ background: s.color }} aria-hidden="true" />{s.label}</li>)}
      </ul>
    </div>
  );
};

const statusTone = (s) => ({ ONLINE: 'ok', WARNING: 'warning', OFFLINE: 'error' }[s] || 'offline');

export const NodeDetail = () => {
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const waves = useStore(s => s.waves);
  const loaded = useStore(s => s.loaded);
  const toast = useStore(s => s.toast);
  const node = selectedId ? nodes[selectedId] : null;
  const wave = selectedId ? waves[selectedId] : null;
  const [history, setHistory] = useState([]);
  const [rec, setRec] = useState({ recording: false });
  const [label, setLabel] = useState('HUMAN');

  useEffect(() => {
    if (!selectedId) return undefined;
    let alive = true;
    setHistory([]);
    const load = () => api.history(selectedId, 240).then(r => alive && setHistory(r.history || [])).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState !== 'hidden') load(); }, 2000);
    const r = setInterval(() => { if (document.visibilityState !== 'hidden') api.recordStatus(selectedId).then(x => alive && setRec(x.recording)).catch(() => {}); }, 1000);
    return () => { alive = false; clearInterval(t); clearInterval(r); };
  }, [selectedId]);

  if (!node) {
    return (
      <div className="rounded-xl border border-terminal-border bg-terminal-dark">
        <EmptyState icon={Cpu} title={loaded ? 'No node selected' : 'Loading nodes…'}>
          {loaded && (Object.keys(nodes).length ? 'Pick a node to inspect.' : 'No sensor nodes have reported yet.')}
        </EmptyState>
        {loaded && Object.keys(nodes).length > 0 && <div className="px-4 pb-4"><NodeList /></div>}
      </div>
    );
  }
  const t = node.latest;
  const f = t && t.seismic && t.seismic.features;
  const ml = node.fusion && node.fusion.serverMl;

  const startRec = () => api.record(node.id, label, 30).then(r => setRec(r.recording)).catch(e => toast({ kind: 'ERR', severity: 'HIGH', title: 'Recording failed', message: e.message }));
  const stopRec = () => api.recordStop(node.id).then(() => setRec({ recording: false })).catch(e => toast({ kind: 'ERR', severity: 'HIGH', title: 'Stop failed', message: e.message }));

  return (
    <div className="space-y-4">
      {/* node header + controls */}
      <div className="rounded-xl border border-terminal-border bg-terminal-dark shadow-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[17px] font-semibold text-gray-50 truncate">{node.name}</h2>
              <StatusBadge status={statusTone(node.status)}>{titleCase(node.status)}</StatusBadge>
              {node.simulated && <Tag tone="violet">SIM</Tag>}
              {t && t.mode === 'LIVE' && <Tag tone="cyan">LIVE</Tag>}
            </div>
            <div className="text-[12px] text-terminal-muted mt-0.5"><span className="num">{node.id}</span> · last packet {relTime(node.lastSeen)}{t ? <> · firmware <span className="num">{t.firmware}</span></> : null}</div>
          </div>
          <NodePicker />
        </div>
        <NodeControls node={node} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-6 xl:order-2 space-y-4 min-w-0">
          <Card title="Live sensors" icon={Activity}><SnapshotTiles node={node} /></Card>
          <Card title="Two-minute history" icon={BarChart3}><History history={history} /><div className="mt-3"><EnergyHistory nodeId={node.id} height={80} /></div></Card>
          <Card title="Ground probes" subtitle="Last 6 seconds" icon={Activity}>
            <SeismicScope wave={wave} height={180} seconds={6} />
            <div className="mt-3"><ProbeCards node={node} /></div>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <Card title="Spectrum · probe A" icon={BarChart3}><SpectrumBars spectrum={node.spectrum} features={f} /></Card>
            <Card title="Radar" icon={Radar}><RadarScope node={node} /></Card>
          </div>
        </div>

        <div className="xl:col-span-3 xl:order-1 space-y-4 min-w-0">
          <Card title="Telemetry" icon={Gauge}><TelemetryColumn node={node} /></Card>
          <Card title="ML training recorder" subtitle="Label probe-A windows for retraining" icon={GraduationCap}>
            <p className="text-[12px] text-terminal-muted mb-3">Streams labelled windows to <code>ml/data/</code>. The node switches to Live mode automatically.</p>
            <div className="flex gap-2">
              <Select value={label} onChange={e => setLabel(e.target.value)} className="flex-1 min-w-0" aria-label="Training label" disabled={rec.recording}>
                {['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'].map(l => <option key={l} value={l}>{titleCase(l)}</option>)}
              </Select>
              {!rec.recording
                ? <Button size="sm" variant="danger" onClick={startRec}><Disc className="w-3.5 h-3.5" aria-hidden="true" />Record 30 s</Button>
                : <Button size="sm" variant="warning" onClick={stopRec}><Square className="w-3.5 h-3.5" aria-hidden="true" />Stop</Button>}
            </div>
            {rec.recording && <div className="text-[12px] text-red-300 mt-2 flex items-center gap-1.5" role="status"><span className="w-2 h-2 rounded-full bg-terminal-red animate-pulse" aria-hidden="true" />Recording {titleCase(rec.label)} · <span className="num">{rec.windows}</span> windows · <span className="num">{rec.remainingS}</span> s left</div>}
          </Card>
        </div>

        <div className="xl:col-span-3 xl:order-3 space-y-4 min-w-0">
          <Card title="Fusion" icon={Brain}><FusionPanel node={node} /></Card>
          <Card title="Seismic features" subtitle="Inputs to the random-forest classifier" icon={Table2}>
            {!f ? <div className="text-[13px] text-terminal-muted">No feature window yet.</div> : (
              <table className="w-full text-[12px]">
                <tbody>
                  {FEATURES.map(([k, name, unit, d]) => (
                    <tr key={k} className="border-b border-terminal-border/60 last:border-0"><td className="text-terminal-muted py-1 pr-2">{name}</td><td className="text-right num text-gray-200">{fmt(f[k], d)} {unit}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {ml && (
              <div className="mt-3 pt-3 border-t border-terminal-border space-y-1.5">
                <div className="text-[12px] text-terminal-muted">Server model (smoothed): <b className="font-medium text-gray-200">{titleCase(ml.label)} {Math.round(ml.confidence * 100)}%</b>{ml.raw ? ` · this window: ${titleCase(ml.raw.label)} ${Math.round(ml.raw.confidence * 100)}%` : ''}</div>
                {t && t.ml && Object.entries(t.ml.probs).map(([c, p]) => (
                  <div key={c} className="flex items-center gap-2 text-[12px]">
                    <span className="w-24 text-terminal-muted">{titleCase(c)}</span>
                    <span className="flex-1 h-1.5 rounded-full bg-terminal-black overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${p * 100}%`, background: c === 'HUMAN' ? '#ef4444' : c === 'VEHICLE' ? '#f59e0b' : c === 'ENVIRONMENT' ? '#38bdf8' : '#22c55e' }} /></span>
                    <span className="w-9 text-right num">{Math.round(p * 100)}%</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card title="Local map" icon={MapIcon}><div className="h-56 rounded-lg overflow-hidden"><SiteMap compact /></div></Card>
          <Card title="All nodes" icon={ListTree}><NodeList /></Card>
        </div>
      </div>
    </div>
  );
};

export default NodeDetail;
