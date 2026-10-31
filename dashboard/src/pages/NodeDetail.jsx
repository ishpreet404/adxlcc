import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Disc, Square } from 'lucide-react';
import useStore from '../store/useStore';
import api from '../services/api';
import { Card, Button, Separator } from '../components';
import RadarScope from '../components/radar/RadarScope';
import SeismicScope from '../components/seismic/SeismicScope';
import ProbeCards from '../components/seismic/ProbeCards';
import SpectrumBars from '../components/seismic/SpectrumBars';
import EnergyHistory from '../components/seismic/EnergyHistory';
import SnapshotTiles from '../components/SnapshotTiles';
import TelemetryColumn from '../components/telemetry/TelemetryColumn';
import FusionPanel from '../components/FusionPanel';
import SiteMap from '../components/map/SiteMap';
import { fmt } from '../lib/format';

const FEATURES = [
  ['rms', 'RMS', 'g', 4], ['peak', 'Peak', 'g', 4], ['peakToPeak', 'Peak-to-peak', 'g', 4], ['variance', 'Variance', '', 6],
  ['dominantFrequency', 'Dominant freq', 'Hz', 1], ['spectralEnergy', 'Spectral energy', '', 5], ['spectralCentroid', 'Centroid', 'Hz', 1],
  ['interPeakInterval', 'Inter-peak', 'ms', 0], ['zeroCrossingRate', 'Zero-cross rate', 'Hz', 1], ['crestFactor', 'Crest factor', '', 2],
  ['kurtosis', 'Kurtosis (spikiness)', '', 1], ['spectralFlatness', 'Spectral flatness', '', 3], ['lowBandRatio', 'Low band 1–8 Hz', '', 2],
  ['highBandRatio', 'High band 20–50 Hz', '', 2], ['cadenceStrength', 'Cadence strength', '', 2]
];

/** Multi-series history strip chart (canvas). */
const History = ({ history, height = 130 }) => {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 400;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c10'; ctx.fillRect(0, 0, w, height);
    if (!history.length) return;
    const n = history.length;
    const x = i => (i / Math.max(1, n - 1)) * w;
    const series = [
      { key: 'p', color: '#ff3344', max: 1, label: 'intrusion p' },
      { key: 'rmsA', color: '#00ff66', max: 0.25, label: 'rms A' },
      { key: 'rmsB', color: '#ffb000', max: 0.25, label: 'rms B' },
      { key: 'radar', color: '#00e5ff', max: 8, label: 'radar m', inv: true }
    ];
    ctx.strokeStyle = '#1f2937';
    [0.25, 0.5, 0.75].forEach(f => { ctx.beginPath(); ctx.moveTo(0, f * height); ctx.lineTo(w, f * height); ctx.stroke(); });
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.2; ctx.beginPath();
      let started = false;
      history.forEach((h, i) => {
        const v = h[s.key];
        if (v === null || v === undefined) { started = false; return; }
        const y = height - 4 - Math.min(1, v / s.max) * (height - 16);
        if (!started) { ctx.moveTo(x(i), y); started = true; } else ctx.lineTo(x(i), y);
      });
      ctx.stroke();
    }
    ctx.font = '9px "JetBrains Mono", monospace';
    series.forEach((s, i) => { ctx.fillStyle = s.color; ctx.fillText(s.label, 6 + i * 70, 10); });
  }, [history, height]);
  return <canvas ref={ref} style={{ width: '100%', height }} className="block border border-terminal-border" />;
};

export const NodeDetail = () => {
  const nodes = useStore(s => s.nodes);
  const selectedId = useStore(s => s.selectedNodeId);
  const setPage = useStore(s => s.setPage);
  const waves = useStore(s => s.waves);
  const node = selectedId ? nodes[selectedId] : null;
  const wave = selectedId ? waves[selectedId] : null;
  const [history, setHistory] = useState([]);
  const [rec, setRec] = useState({ recording: false });
  const [label, setLabel] = useState('HUMAN');

  useEffect(() => {
    if (!selectedId) return undefined;
    let alive = true;
    const load = () => api.history(selectedId, 240).then(r => alive && setHistory(r.history)).catch(() => {});
    load();
    const t = setInterval(load, 2000);
    const r = setInterval(() => api.recordStatus(selectedId).then(x => alive && setRec(x.recording)).catch(() => {}), 1000);
    return () => { alive = false; clearInterval(t); clearInterval(r); };
  }, [selectedId]);

  if (!node) return <div className="text-terminal-muted">No node selected. <button className="text-terminal-cyan" onClick={() => setPage('command')}>Back</button></div>;
  const t = node.latest;
  const f = t && t.seismic && t.seismic.features;
  const ml = node.fusion && node.fusion.serverMl;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" onClick={() => setPage('command')}><ArrowLeft className="w-3.5 h-3.5 mr-1" /> COMMAND CENTER</Button>
        <h1 className="text-lg font-bold text-shadow-terminal">$ NODE --inspect {node.id}</h1>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className="xl:col-span-3 space-y-3">
          <Card className="!h-auto" title="TELEMETRY"><TelemetryColumn node={node} /></Card>
          <Card className="!h-auto" title="ML TRAINING RECORDER">
            <div className="text-[10px] text-terminal-muted mb-2">Stream labelled probe-A windows to <code>ml/data/</code> for retraining. The node is switched to LIVE automatically.</div>
            <div className="flex gap-1">
              <select value={label} onChange={e => setLabel(e.target.value)} className="bg-terminal-black border border-terminal-border text-[11px] px-1 flex-1">
                {['NORMAL', 'HUMAN', 'VEHICLE', 'ENVIRONMENT'].map(l => <option key={l}>{l}</option>)}
              </select>
              {!rec.recording
                ? <Button size="sm" variant="danger" onClick={() => api.record(node.id, label, 30).then(r => setRec(r.recording)).catch(e => alert(e.message))}><Disc className="w-3 h-3 mr-1" /> REC 30s</Button>
                : <Button size="sm" variant="warning" onClick={() => api.recordStop(node.id).then(() => setRec({ recording: false }))}><Square className="w-3 h-3 mr-1" /> STOP</Button>}
            </div>
            {rec.recording && <div className="text-[10px] text-terminal-red mt-1 animate-pulse">● REC {rec.label} · {rec.windows} windows · {rec.remainingS}s left</div>}
          </Card>
        </div>
        <div className="xl:col-span-6 space-y-3">
          <Card className="!h-auto" title="LIVE SENSORS"><SnapshotTiles node={node} /></Card>
          <Card className="!h-auto" title="2-MINUTE HISTORY"><History history={history} /><div className="mt-2"><EnergyHistory nodeId={node.id} height={80} /></div></Card>
          <Card className="!h-auto" title="GROUND PROBES (10 s)">
            <SeismicScope wave={wave} height={180} seconds={6} />
            <div className="mt-2"><ProbeCards node={node} /></div>
          </Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card className="!h-auto" title="SPECTRUM · PROBE A"><SpectrumBars spectrum={node.spectrum} features={f} /></Card>
            <Card className="!h-auto" title="RADAR"><RadarScope node={node} /></Card>
          </div>
        </div>
        <div className="xl:col-span-3 space-y-3">
          <Card className="!h-auto" title="FUSION"><FusionPanel node={node} /></Card>
          <Card className="!h-auto" title="SEISMIC FEATURES → RANDOM FOREST">
            {!f ? <div className="text-[10px] text-terminal-muted">no feature window yet</div> : (
              <table className="w-full text-[10px]">
                <tbody>
                  {FEATURES.map(([k, name, unit, d]) => (
                    <tr key={k} className="border-b border-terminal-border/40"><td className="text-terminal-muted py-0.5">{name}</td><td className="text-right tabular-nums">{fmt(f[k], d)} {unit}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {ml && (
              <div className="mt-2 space-y-1">
                <Separator variant="dots" />
                <div className="text-[10px] text-terminal-muted">server RF (smoothed over windows): <b className="text-gray-200">{ml.label} {Math.round(ml.confidence * 100)}%</b>{ml.raw ? ` · this window: ${ml.raw.label} ${Math.round(ml.raw.confidence * 100)}%` : ''}</div>
                {t && t.ml && Object.entries(t.ml.probs).map(([c, p]) => (
                  <div key={c} className="flex items-center gap-2 text-[10px]"><span className="w-24 text-terminal-muted">{c}</span><span className="flex-1 h-1.5 bg-terminal-black border border-terminal-border"><span className="block h-full" style={{ width: `${p * 100}%`, background: c === 'HUMAN' ? '#ff3344' : c === 'VEHICLE' ? '#ffb000' : c === 'ENVIRONMENT' ? '#00e5ff' : '#00ff66' }} /></span><span className="w-8 text-right tabular-nums">{Math.round(p * 100)}%</span></div>
                ))}
              </div>
            )}
          </Card>
          <Card className="!h-auto" title="LOCAL MAP"><div className="h-56"><SiteMap compact /></div></Card>
        </div>
      </div>
    </div>
  );
};

export default NodeDetail;
