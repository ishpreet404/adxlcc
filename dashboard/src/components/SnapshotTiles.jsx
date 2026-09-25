import React from 'react';
import { Radar, Activity, Brain, Crosshair } from 'lucide-react';
import useStore from '../store/useStore';
import { fmt, vibLevel, verdictSentence, levelHex } from '../lib/format';

const Tile = ({ icon: Icon, label, big, unit, sub, color = '#e5e7eb', bar }) => (
  <div className="border border-terminal-border bg-terminal-dark px-3 py-2 min-w-0">
    <div className="text-[10px] text-terminal-muted tracking-wider flex items-center gap-1"><Icon className="w-3 h-3" />{label}</div>
    <div className="text-2xl font-extrabold leading-tight tabular-nums truncate" style={{ color }}>{big}{unit && <span className="text-xs font-normal text-terminal-muted"> {unit}</span>}</div>
    {bar !== undefined && <div className="h-1.5 bg-terminal-black border border-terminal-border mt-1"><div className="h-full" style={{ width: `${Math.min(100, bar)}%`, background: color }} /></div>}
    <div className="text-[11px] text-gray-300 truncate mt-0.5">{sub}</div>
  </div>
);

/** Big at-a-glance numbers for the selected node plus a one-sentence verdict. */
export const SnapshotTiles = ({ node }) => {
  const tracks = useStore(s => s.tracks);
  const t = node && node.latest;
  const f = node && node.fusion;
  const track = node && tracks.find(tr => tr.nodes.includes(node.id));
  const a = t ? t.probes[0] : null, b = t ? t.probes[1] : null;
  const la = a ? vibLevel(a.rms) : null, lb = b ? vibLevel(b.rms) : null;
  const ml = f && (f.serverMl || f.nodeMl);
  const radarOn = t && t.radar.presence;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile icon={Radar} label="RADAR" big={radarOn ? fmt(t.radar.distance, 1) : t ? 'CLEAR' : '—'} unit={radarOn ? 'm' : ''} color={radarOn ? '#ff3344' : '#00ff66'}
          sub={radarOn ? `${t.radar.moving ? 'moving' : 'still'} target · energy ${t.radar.energy}%` : t && !t.radar.ok ? 'no data from radar' : 'nothing in the beam'} bar={radarOn ? t.radar.energy : 0} />
        <Tile icon={Activity} label="PROBE A (left)" big={a ? fmt(a.rms, 3) : '—'} unit="g" color={la ? la.color : '#6b7280'} sub={la ? `${la.word} · peak ${fmt(a.peak, 2)} g` : 'no data'} bar={a ? a.rms * 500 : 0} />
        <Tile icon={Activity} label="PROBE B (right)" big={b ? fmt(b.rms, 3) : '—'} unit="g" color={lb ? lb.color : '#6b7280'} sub={lb ? `${lb.word} · peak ${fmt(b.peak, 2)} g` : 'no data'} bar={b ? b.rms * 500 : 0} />
        <Tile icon={Brain} label="VERDICT" big={f ? `${Math.round(f.probability * 100)}%` : '—'} color={f ? levelHex(f.level) : '#6b7280'}
          sub={ml ? `${ml.label} (${Math.round(ml.confidence * 100)}%) · ${f.level}` : 'waiting for a window'} bar={f ? f.probability * 100 : 0} />
      </div>
      <div className="border border-terminal-border bg-terminal-dark px-3 py-2 text-[13px] flex items-center gap-2">
        <Crosshair className="w-4 h-4 flex-shrink-0" style={{ color: f ? levelHex(f.level) : '#6b7280' }} />
        <span style={{ color: f && f.level !== 'CLEAR' ? '#fff' : '#d1d5db' }}>{verdictSentence(node, track)}</span>
      </div>
    </div>
  );
};

export default SnapshotTiles;
