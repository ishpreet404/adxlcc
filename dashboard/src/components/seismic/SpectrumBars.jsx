import React from 'react';

/** Probe-A spectrum (0–50 Hz) with the human / vehicle bands marked. */
export const SpectrumBars = ({ spectrum, height = 90 }) => {
  if (!spectrum || !spectrum.length) return <div className="text-[10px] text-terminal-muted border border-terminal-border p-2">spectrum: waiting for waveform</div>;
  const max = Math.max(1e-6, ...spectrum.map(b => b.mag));
  return (
    <div className="border border-terminal-border p-2">
      <div className="flex items-end gap-px" style={{ height }}>
        {spectrum.map((b, i) => {
          const human = b.hz >= 2 && b.hz <= 20;
          const vehicle = b.hz > 20 && b.hz <= 45;
          const color = human ? '#00ff66' : vehicle ? '#ff3344' : '#4b5563';
          return (
            <div key={i} className="flex-1 flex flex-col justify-end" title={`${b.hz} Hz`}>
              <div style={{ height: `${(b.mag / max) * 100}%`, background: color, opacity: 0.85 }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-terminal-muted mt-1">
        <span>0 Hz</span><span className="text-terminal-green">footsteps 2–20 Hz</span><span className="text-terminal-red">engine 20–45 Hz</span><span>50 Hz</span>
      </div>
    </div>
  );
};

export default SpectrumBars;
