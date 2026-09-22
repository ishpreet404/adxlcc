import React from 'react';
import { Meter } from '../radar/RadarScope';
import { fmt } from '../../lib/format';

const level = (rms) => (rms > 0.12 ? ['HIGH', '#ff3344'] : rms > 0.04 ? ['ELEVATED', '#ffb000'] : rms > 0.02 ? ['LOW', '#00e5ff'] : ['QUIET', '#00ff66']);

const ProbeCard = ({ name, probe, color }) => {
  if (!probe) return <div className="border border-terminal-border p-2 text-[10px] text-terminal-muted">{name}: no data</div>;
  const [lvl, lvlColor] = level(probe.rms);
  return (
    <div className={`border p-2 ${probe.ok ? 'border-terminal-border' : 'border-terminal-red'}`}>
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold" style={{ color }}>{name}</span>
        <span style={{ color: probe.ok ? lvlColor : '#ff3344' }}>{probe.ok ? lvl : 'SENSOR FAULT'}</span>
      </div>
      <div className="grid grid-cols-3 gap-1 mt-1 text-[10px] tabular-nums">
        {['x', 'y', 'z'].map(k => (
          <div key={k} className="bg-terminal-black border border-terminal-border px-1 py-0.5 flex justify-between">
            <span className="text-terminal-muted uppercase">{k}</span><span>{fmt(probe[k], 3)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 space-y-1 text-[10px]">
        <Meter label="VIBRATION RMS" value={probe.rms} max={0.25} color={lvlColor} unit=" g" digits={4} />
        <Meter label="PEAK" value={probe.peak} max={0.6} color="#9ca3af" unit=" g" digits={3} />
        <Meter label="STA/LTA" value={probe.staLta} max={8} color={probe.staLta >= 3 ? '#ff3344' : '#00e5ff'} unit="×" digits={2} />
      </div>
    </div>
  );
};

export const ProbeCards = ({ node }) => {
  const t = node && node.latest;
  const probes = t ? t.probes : [null, null];
  const seis = t ? t.seismic : null;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <ProbeCard name="PROBE A (left)" probe={probes[0]} color="#00ff66" />
        <ProbeCard name="PROBE B (right)" probe={probes[1]} color="#ffb000" />
      </div>
      {seis && (
        <div className="grid grid-cols-3 gap-2 text-[10px]">
          <div className="border border-terminal-border p-1.5">
            <div className="text-terminal-muted">TDOA LAG (B−A)</div>
            <div className={`text-sm font-bold tabular-nums ${seis.lagMs > 0.5 ? 'text-terminal-green' : seis.lagMs < -0.5 ? 'text-terminal-amber' : 'text-gray-200'}`}>{fmt(seis.lagMs, 1, ' ms')}</div>
            <div className="text-terminal-muted">{seis.lagMs > 0.5 ? '← A heard first' : seis.lagMs < -0.5 ? 'B heard first →' : 'broadside'}</div>
          </div>
          <div className="border border-terminal-border p-1.5">
            <div className="text-terminal-muted">CROSS-CORR</div>
            <div className="text-sm font-bold tabular-nums">{fmt(seis.corr, 2)}</div>
            <div className="text-terminal-muted">{seis.corr >= 0.5 ? 'same wavefront' : 'uncorrelated'}</div>
          </div>
          <div className="border border-terminal-border p-1.5">
            <div className="text-terminal-muted">RMS RATIO A/B</div>
            <div className="text-sm font-bold tabular-nums">{fmt(seis.ratio, 2)}</div>
            <div className="text-terminal-muted">{seis.ratio > 1.15 ? 'closer to A' : seis.ratio < 0.87 && seis.ratio > 0 ? 'closer to B' : 'centred'}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProbeCards;
