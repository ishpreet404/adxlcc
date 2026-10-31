import React from 'react';

/** Probe-A spectrum (0–50 Hz) with the footstep / engine bands marked, plus the band-energy split. */
export const SpectrumBars = ({ spectrum, features, height = 90 }) => {
  if (!spectrum || !spectrum.length) return <div className="text-[11px] text-terminal-muted border border-terminal-border p-2">Spectrum appears once the node streams (LIVE).</div>;
  const max = Math.max(1e-6, ...spectrum.map(b => b.mag));
  const low = features ? Math.round((features.lowBandRatio || 0) * 100) : null;
  const high = features ? Math.round((features.highBandRatio || 0) * 100) : null;
  return (
    <div className="border border-terminal-border p-2">
      <div className="flex items-end gap-px" style={{ height }}>
        {spectrum.map((b, i) => {
          const human = b.hz >= 2 && b.hz <= 20;
          const vehicle = b.hz > 20 && b.hz <= 45;
          const color = human ? '#00ff66' : vehicle ? '#ff3344' : '#4b5563';
          return (
            <div key={i} className="flex-1 flex flex-col justify-end" title={`${b.hz} Hz`}>
              <div style={{ height: `${(b.mag / max) * 100}%`, background: color, opacity: 0.85, minHeight: 1 }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
        <span>0 Hz</span><span className="text-terminal-green">footsteps 2–20 Hz{low !== null ? ` · ${low}% low band` : ''}</span><span className="text-terminal-red">engine 20–45 Hz{high !== null ? ` · ${high}% high band` : ''}</span><span>50 Hz</span>
      </div>
      {features && (
        <div className="grid grid-cols-3 gap-2 mt-1 text-[10px] text-terminal-muted">
          <span>dominant <b className="text-gray-200">{Number(features.dominantFrequency || 0).toFixed(1)} Hz</b></span>
          <span>cadence <b className="text-gray-200">{features.interPeakInterval ? `${Math.round(features.interPeakInterval)} ms` : '—'}</b></span>
          <span>rhythm <b className="text-gray-200">{Math.round((features.cadenceStrength || 0) * 100)}%</b></span>
        </div>
      )}
    </div>
  );
};

export default SpectrumBars;
