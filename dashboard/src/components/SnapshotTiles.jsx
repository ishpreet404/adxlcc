import React from 'react';
import { Radar, Activity, Brain, Crosshair } from 'lucide-react';
import useStore from '../store/useStore';
import { fmt, vibLevel, verdictSentence, levelHex, titleCase } from '../lib/format';

const Tile = ({ icon: Icon, label, big, unit, sub, color = '#e5e7eb', bar }) => (
  <div className="rounded-lg border border-terminal-border bg-terminal-black/40 px-3 py-2.5 min-w-0">
    <div className="text-[12px] text-terminal-muted flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" aria-hidden="true" /><span className="truncate">{label}</span></div>
    <div className="num text-2xl font-semibold leading-tight truncate mt-1" style={{ color }}>{big}{unit && <span className="text-xs font-normal text-terminal-muted"> {unit}</span>}</div>
    {bar !== undefined && <div className="h-1 rounded-full bg-terminal-black mt-1.5 overflow-hidden" aria-hidden="true"><div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, bar)}%`, background: color }} /></div>}
    <div className="text-[11px] text-gray-400 truncate mt-1">{sub}</div>
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
  const alarm = f && f.level !== 'CLEAR';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        <Tile icon={Radar} label="Radar" big={radarOn ? fmt(t.radar.distance, 1) : t ? 'Clear' : '—'} unit={radarOn ? 'm' : ''} color={radarOn ? '#ef4444' : t ? '#22c55e' : '#5b6778'}
          sub={radarOn ? `${t.radar.moving ? 'Moving' : 'Still'} target · energy ${t.radar.energy}%` : t && !t.radar.ok ? 'No data from radar' : 'Nothing in the beam'} bar={radarOn ? t.radar.energy : 0} />
        <Tile icon={Activity} label="Probe A · left" big={a ? fmt(a.rms, 3) : '—'} unit="g" color={la ? la.color : '#5b6778'} sub={la ? `${la.word} · peak ${fmt(a.peak, 2)} g` : 'No data'} bar={a ? a.rms * 500 : 0} />
        <Tile icon={Activity} label="Probe B · right" big={b ? fmt(b.rms, 3) : '—'} unit="g" color={lb ? lb.color : '#5b6778'} sub={lb ? `${lb.word} · peak ${fmt(b.peak, 2)} g` : 'No data'} bar={b ? b.rms * 500 : 0} />
        <Tile icon={Brain} label="Verdict" big={f ? `${Math.round(f.probability * 100)}%` : '—'} color={f ? levelHex(f.level) : '#5b6778'}
          sub={ml ? `${titleCase(ml.label)} (${Math.round(ml.confidence * 100)}%) · ${titleCase(f.level)}` : 'Waiting for a window'} bar={f ? f.probability * 100 : 0} />
      </div>
      <div className={`rounded-lg border px-3 py-2.5 text-[13px] flex items-center gap-2.5 ${alarm ? 'border-terminal-red/30 bg-terminal-red/[0.05]' : 'border-terminal-border'}`} aria-live="polite">
        <Crosshair className="w-4 h-4 flex-shrink-0" style={{ color: f ? levelHex(f.level) : '#5b6778' }} aria-hidden="true" />
        <span className={alarm ? 'text-gray-50' : 'text-gray-300'}>{verdictSentence(node, track)}</span>
      </div>
    </div>
  );
};

export default SnapshotTiles;
