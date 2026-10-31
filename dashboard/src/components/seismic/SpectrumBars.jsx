import React from 'react';

/** Probe-A spectrum (0–50 Hz) with the footstep / engine bands marked, plus the band-energy split. */
export const SpectrumBars = ({ spectrum, features, height = 90 }) => {
  if (!spectrum || !spectrum.length) return <div className="rounded-lg border border-terminal-border p-3 text-[12px] text-terminal-muted">The spectrum appears once the node streams waveforms (Live mode).</div>;
  const max = Math.max(1e-6, ...spectrum.map(b => b.mag));
  const low = features ? Math.round((features.lowBandRatio || 0) * 100) : null;
  const high = features ? Math.round((features.highBandRatio || 0) * 100) : null;
  return (
    <div className="rounded-lg border border-terminal-border p-3 min-w-0">
      <div className="flex items-end gap-px" style={{ height }} role="img" aria-label={`Probe A spectrum, 0 to 50 Hz${low !== null ? `, ${low}% energy in the footstep band, ${high}% in the engine band` : ''}`}>
        {spectrum.map((b, i) => {
          const human = b.hz >= 2 && b.hz <= 20;
          const vehicle = b.hz > 20 && b.hz <= 45;
          const color = human ? '#22c55e' : vehicle ? '#ef4444' : '#3a4a5e';
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full" title={`${b.hz} Hz`}>
              <div className="rounded-t-[1px]" style={{ height: `${(b.mag / max) * 100}%`, background: color, opacity: 0.85, minHeight: 1 }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[11px] text-terminal-muted mt-1.5 num"><span>0 Hz</span><span>25</span><span>50 Hz</span></div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-terminal-muted mt-1">
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-terminal-green" aria-hidden="true" />Footsteps 2–20 Hz{low !== null ? ` · ${low}%` : ''}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-terminal-red" aria-hidden="true" />Engine 20–45 Hz{high !== null ? ` · ${high}%` : ''}</span>
      </div>
      {features && (
        <div className="grid grid-cols-3 gap-2 mt-2 text-[11px] text-terminal-muted">
          <span>Dominant <b className="num font-medium text-gray-200">{Number(features.dominantFrequency || 0).toFixed(1)} Hz</b></span>
          <span>Cadence <b className="num font-medium text-gray-200">{features.interPeakInterval ? `${Math.round(features.interPeakInterval)} ms` : '—'}</b></span>
          <span>Rhythm <b className="num font-medium text-gray-200">{Math.round((features.cadenceStrength || 0) * 100)}%</b></span>
        </div>
      )}
    </div>
  );
};

export default SpectrumBars;
