import React, { useEffect, useRef } from 'react';

/**
 * Dual-trace ground-vibration oscilloscope.
 *  - probe A (green) and probe B (amber) traces with the vibration envelope drawn underneath
 *  - detected step/impact peaks marked with ticks
 *  - time axis in seconds, ±g scale, and a plain-language level per trace
 */
export const SeismicScope = ({ wave, height = 170, seconds = 4, label = true }) => {
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
    const laneH = (h - 16) / 2;
    const lanes = [{ arr: a, color: '#00ff66', fill: 'rgba(0,255,102,0.12)', name: 'PROBE A', y0: 0 }, { arr: b, color: '#ffb000', fill: 'rgba(255,176,0,0.12)', name: 'PROBE B', y0: laneH }];

    // grid + time axis
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    for (let s = 0; s <= seconds; s++) {
      const x = (s / seconds) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h - 14); ctx.stroke();
      if (s < seconds) ctx.fillText(`-${seconds - s}s`, x + 14, h - 3);
    }
    ctx.textAlign = 'left';

    let peak = 0.02;
    for (const v of a) peak = Math.max(peak, Math.abs(v));
    for (const v of b) peak = Math.max(peak, Math.abs(v));

    const level = (rms) => (rms > 0.12 ? ['STRONG', '#ff3344'] : rms > 0.04 ? ['ACTIVE', '#ffb000'] : rms > 0.02 ? ['LOW', '#00e5ff'] : ['QUIET', '#00ff66']);

    for (const lane of lanes) {
      const mid = lane.y0 + laneH / 2;
      const scale = (laneH * 0.45) / peak;
      ctx.strokeStyle = '#374151';
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      ctx.strokeStyle = '#1f2937';
      ctx.beginPath(); ctx.moveTo(0, lane.y0 + laneH); ctx.lineTo(w, lane.y0 + laneH); ctx.stroke();
      const arr = lane.arr;
      if (!arr.length) continue;
      const start = n - arr.length;
      const xOf = i => ((start + i) / n) * w;

      // envelope (7-sample moving average of |x|) as a filled band
      const env = new Array(arr.length);
      let rmsAcc = 0;
      for (let i = 0; i < arr.length; i++) {
        const lo = Math.max(0, i - 3), hi = Math.min(arr.length, i + 4);
        let s = 0;
        for (let j = lo; j < hi; j++) s += Math.abs(arr[j]);
        env[i] = s / (hi - lo);
        rmsAcc += arr[i] * arr[i];
      }
      const rms = Math.sqrt(rmsAcc / arr.length);
      ctx.fillStyle = lane.fill;
      ctx.beginPath();
      ctx.moveTo(xOf(0), mid);
      for (let i = 0; i < arr.length; i++) ctx.lineTo(xOf(i), mid - env[i] * scale);
      for (let i = arr.length - 1; i >= 0; i--) ctx.lineTo(xOf(i), mid + env[i] * scale);
      ctx.closePath();
      ctx.fill();

      // trace
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const y = mid - arr[i] * scale;
        if (i === 0) ctx.moveTo(xOf(i), y); else ctx.lineTo(xOf(i), y);
      }
      ctx.stroke();

      // step / impact markers
      const thr = Math.max(0.02, peak * 0.45);
      const refractory = Math.floor(0.25 * fs);
      let last = -10000, steps = 0;
      for (let i = 1; i < arr.length - 1; i++) {
        if (arr[i] > thr && arr[i] > arr[i - 1] && arr[i] >= arr[i + 1] && i - last >= refractory) {
          last = i; steps++;
          const x = xOf(i);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, lane.y0 + 4); ctx.lineTo(x, lane.y0 + 12); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 3, lane.y0 + 4); ctx.lineTo(x + 3, lane.y0 + 4); ctx.stroke();
        }
      }

      if (label) {
        const [word, color] = level(rms);
        ctx.font = 'bold 11px "JetBrains Mono", monospace';
        ctx.fillStyle = lane.color; ctx.fillText(lane.name, 6, lane.y0 + 13);
        ctx.fillStyle = color; ctx.fillText(word, 70, lane.y0 + 13);
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`rms ${rms.toFixed(3)} g${steps ? ` · ${steps} step${steps > 1 ? 's' : ''}` : ''}`, 130, lane.y0 + 13);
      }
    }
    if (label) {
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#6b7280';
      ctx.textAlign = 'right';
      ctx.fillText(`scale ±${peak.toFixed(3)} g · ${fs} Hz`, w - 6, 12);
      ctx.textAlign = 'left';
      if (!a.length) { ctx.fillStyle = '#4b5563'; ctx.font = '12px "JetBrains Mono", monospace'; ctx.fillText('no waveform — press LIVE to stream the probes', 6, h / 2); }
    }
  }, [wave, height, seconds, label]);

  return <canvas ref={ref} style={{ width: '100%', height }} className="block border border-terminal-border" />;
};

export default SeismicScope;
