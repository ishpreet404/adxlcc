import React from 'react';
import { Meter } from '../radar/RadarScope';
import { fmt, vibLevel } from '../../lib/format';

const ProbeCard = ({ name, probe, color }) => {
  if (!probe) return <div className="rounded-lg border border-terminal-border p-3 text-[12px] text-terminal-muted">{name}: no data</div>;
  const lvl = vibLevel(probe.rms);
  return (
    <div className={`rounded-lg border p-3 min-w-0 ${probe.ok ? 'border-terminal-border' : 'border-terminal-red/50'}`}>
      <div className="flex items-center justify-between gap-2 text-[12px]">
        <span className="font-medium flex items-center gap-1.5 min-w-0"><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" /><span className="truncate text-gray-200">{name}</span></span>
        <span className="font-medium" style={{ color: probe.ok ? lvl.color : '#ef4444' }}>{probe.ok ? lvl.word : 'Sensor fault'}</span>
      </div>
      <div className="mt-2 space-y-2 text-[12px]">
        <Meter label="Vibration" value={probe.rms} max={0.25} color={lvl.color} unit=" g" digits={3} />
        <Meter label="Peak" value={probe.peak} max={0.6} color="#8b97a8" unit=" g" digits={2} />
        <Meter label="Trigger ratio (STA/LTA)" value={probe.staLta} max={8} color={probe.staLta >= 3 ? '#ef4444' : '#38bdf8'} unit="×" digits={1} />
      </div>
      <div className="grid grid-cols-3 gap-1.5 mt-2 text-[11px]">
        {['x', 'y', 'z'].map(k => (
          <div key={k} className="rounded-md bg-terminal-black px-1.5 py-1 flex justify-between gap-1 min-w-0">
            <span className="text-terminal-muted uppercase">{k}</span><span className="num truncate">{fmt(probe[k], 2)}</span>
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
  const side = seis ? (seis.lagMs > 0.5 ? 'A felt it first → target on the left' : seis.lagMs < -0.5 ? 'B felt it first → target on the right' : 'Both together → straight ahead') : '';
  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <ProbeCard name="Probe A · left" probe={probes[0]} color="#22c55e" />
        <ProbeCard name="Probe B · right" probe={probes[1]} color="#f59e0b" />
      </div>
      {seis && (
        <div className="rounded-lg border border-terminal-border p-3 text-[12px]">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-terminal-muted">Which side?</span>
            <span className="text-gray-200">{side}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-2 mt-2 text-[11px] text-terminal-muted">
            <span>Arrival gap <b className="num font-medium text-gray-200">{fmt(seis.lagMs, 1)} ms</b></span>
            <span>Match <b className="num font-medium text-gray-200">{Math.round((seis.corr || 0) * 100)}%</b> {seis.corr >= 0.5 ? '(same wave)' : '(weak)'}</span>
            <span>Loudness A/B <b className="num font-medium text-gray-200">{fmt(seis.ratio, 2)}</b></span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProbeCards;
