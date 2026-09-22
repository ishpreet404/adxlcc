import React, { useEffect, useRef } from 'react';

/** Dual-trace oscilloscope for probe A / probe B (canvas, redrawn on new data). */
export const SeismicScope = ({ wave, height = 150, seconds = 4, label = true }) => {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300;
    const h = height;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c10';
    ctx.fillRect(0, 0, w, h);

    const fs = (wave && wave.fs) || 100;
    const n = Math.floor(seconds * fs);
    const a = wave ? wave.a.slice(-n) : [];
    const b = wave ? wave.b.slice(-n) : [];
    const half = h / 2;

    // grid
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let s = 0; s <= seconds; s++) {
      const x = (s / seconds) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    [0.25, 0.5, 0.75].forEach(f => { ctx.beginPath(); ctx.moveTo(0, f * h); ctx.lineTo(w, f * h); ctx.stroke(); });
    ctx.strokeStyle = '#374151';
    ctx.beginPath(); ctx.moveTo(0, half); ctx.lineTo(w, half); ctx.stroke();

    // auto-scale with a floor so noise stays visible
    let peak = 0.02;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    for (const v of b) peak = Math.max(peak, Math.abs(v));
    const scale = (half * 0.85) / peak;

    const trace = (arr, color, offset) => {
      if (!arr.length) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const start = n - arr.length;
      for (let i = 0; i < arr.length; i++) {
        const x = ((start + i) / n) * w;
        const y = offset - arr[i] * scale;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    trace(a, '#00ff66', half * 0.5);
    trace(b, '#ffb000', half * 1.5);

    if (label) {
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#00ff66'; ctx.fillText('PROBE A', 6, 12);
      ctx.fillStyle = '#ffb000'; ctx.fillText('PROBE B', 6, half + 12);
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'right';
      ctx.fillText(`±${peak.toFixed(3)} g  ·  ${seconds}s @ ${fs} Hz`, w - 6, 12);
      ctx.textAlign = 'left';
      if (!a.length) { ctx.fillStyle = '#4b5563'; ctx.fillText('no waveform — node in ECO mode (switch to LIVE to stream)', 6, half - 6); }
    }
  }, [wave, height, seconds, label]);

  return <canvas ref={ref} style={{ width: '100%', height }} className="block border border-terminal-border" />;
};

export default SeismicScope;
