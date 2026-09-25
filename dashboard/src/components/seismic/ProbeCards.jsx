import React from 'react';
import { Meter } from '../radar/RadarScope';
import { fmt, vibLevel } from '../../lib/format';

const ProbeCard = ({ name, probe, color }) => {
  if (!probe) return <div className="border border-terminal-border p-2 text-[11px] text-terminal-muted">{name}: no data</div>;
  const lvl = vibLevel(probe.rms);
  return (
    <div className={`border p-2 ${probe.ok ? 'border-terminal-border' : 'border-terminal-red'}`}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold" style={{ color }}>{name}</span>
        <span className="font-bold" style={{ color: probe.ok ? lvl.color : '#ff3344' }}>{probe.ok ? lvl.word : 'SENSOR FAULT'}</span>
      </div>
      <div className="mt-1.5 space-y-1.5 text-[11px]">
        <Meter label="VIBRATION" value={probe.rms} max={0.25} color={lvl.color} unit=" g" digits={3} />
        <Meter label="PEAK" value={probe.peak} max={0.6} color="#9ca3af" unit=" g" digits={2} />
        <Meter label="TRIGGER RATIO (STA/LTA)" value={probe.staLta} max={8} color={probe.staLta >= 3 ? '#ff3344' : '#00e5ff'} unit="×" digits={1} />
      </div>
      <div className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] tabular-nums">
        {['x', 'y', 'z'].map(k => (
          <div key={k} className="bg-terminal-black border border-terminal-border px-1 py-0.5 flex justify-between">
            <span className="text-terminal-muted uppercase">{k}</span><span>{fmt(probe[k], 2)} g</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const ProbeCards = ({ node }) => {
  const t = node && node.latest;
  const probes = t ? t.probes : [null, null];
  const seis = t ? t.seismic : null;
  const side = seis ? (seis.lagMs > 0.5 ? 'A heard it first → target on the LEFT' : seis.lagMs < -0.5 ? 'B heard it first → target on the RIGHT' : 'both heard it together → straight ahead') : '';
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <ProbeCard name="PROBE A · left" probe={probes[0]} color="#00ff66" />
        <ProbeCard name="PROBE B · right" probe={probes[1]} color="#ffb000" />
      </div>
      {seis && (
        <div className="border border-terminal-border p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span className="text-terminal-muted">WHICH SIDE?</span>
            <span className="text-gray-200">{side}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-1.5 text-[10px] text-terminal-muted">
            <span>arrival gap <b className="text-gray-200 tabular-nums">{fmt(seis.lagMs, 1)} ms</b></span>
            <span>match <b className="text-gray-200 tabular-nums">{Math.round((seis.corr || 0) * 100)}%</b> {seis.corr >= 0.5 ? '(same wave)' : '(weak)'}</span>
            <span>loudness A/B <b className="text-gray-200 tabular-nums">{fmt(seis.ratio, 2)}</b></span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProbeCards;
