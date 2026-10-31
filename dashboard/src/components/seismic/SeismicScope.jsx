import React, { useEffect, useRef } from 'react';
import { useElementWidth } from '../../lib/hooks';

const SANS = 'Inter, system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

/**
 * Dual-trace ground-vibration oscilloscope.
 *  - probe A (green) and probe B (amber) traces with the vibration envelope drawn underneath
 *  - detected step/impact peaks marked with ticks
 *  - time axis in seconds, ±g scale, and a plain-language level per trace
 */
export const SeismicScope = ({ wave, height = 170, seconds = 4, label = true }) => {
  const ref = useRef(null);
  const wrap = useRef(null);
  const width = useElementWidth(wrap, 300);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = width;
    const h = height;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1017';
    ctx.fillRect(0, 0, w, h);

    const fs = (wave && wave.fs) || 100;
    const n = Math.floor(seconds * fs);
    const a = wave ? wave.a.slice(-n) : [];
    const b = wave ? wave.b.slice(-n) : [];
    const laneH = (h - 16) / 2;
    const lanes = [{ arr: a, color: '#22c55e', fill: 'rgba(34,197,94,0.12)', name: 'Probe A', y0: 0 }, { arr: b, color: '#f59e0b', fill: 'rgba(245,158,11,0.12)', name: 'Probe B', y0: laneH }];

    // grid + time axis
    ctx.strokeStyle = '#1c2736';
    ctx.lineWidth = 1;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = '#8b97a8';
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

    const level = (rms) => (rms > 0.12 ? ['Strong', '#ef4444'] : rms > 0.04 ? ['Active', '#f59e0b'] : rms > 0.02 ? ['Low', '#38bdf8'] : ['Quiet', '#22c55e']);

    for (const lane of lanes) {
      const mid = lane.y0 + laneH / 2;
      const scale = (laneH * 0.45) / peak;
      ctx.strokeStyle = '#243142';
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke();
      ctx.strokeStyle = '#1c2736';
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
      ctx.lineJoin = 'round';
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
          ctx.strokeStyle = 'rgba(229,231,235,0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, lane.y0 + 4); ctx.lineTo(x, lane.y0 + 12); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x - 3, lane.y0 + 4); ctx.lineTo(x + 3, lane.y0 + 4); ctx.stroke();
        }
      }

      if (label) {
        const [word, color] = level(rms);
        ctx.font = `600 11px ${SANS}`;
        ctx.fillStyle = lane.color; ctx.fillText(lane.name, 6, lane.y0 + 14);
        ctx.fillStyle = color; ctx.fillText(word, 64, lane.y0 + 14);
        ctx.font = `10px ${MONO}`;
        ctx.fillStyle = '#9ca3af';
        ctx.fillText(`rms ${rms.toFixed(3)} g${steps ? ` · ${steps} step${steps > 1 ? 's' : ''}` : ''}`, 116, lane.y0 + 14);
      }
    }
    if (label) {
      if (w >= 520) {
        ctx.font = `10px ${MONO}`;
        ctx.fillStyle = '#8b97a8';
        ctx.textAlign = 'right';
        ctx.fillText(`scale ±${peak.toFixed(3)} g · ${fs} Hz`, w - 6, 13);
        ctx.textAlign = 'left';
      }
      if (!a.length) {
        ctx.fillStyle = '#8b97a8';
        ctx.font = `12px ${SANS}`;
        ctx.textAlign = 'center';
        ctx.fillText(w < 360 ? 'No waveform — use Live mode' : 'No waveform yet — switch the node to Live mode to stream the probes', w / 2, h / 2 + 4);
        ctx.textAlign = 'left';
      }
    }
  }, [wave, height, seconds, label, width]);

  return (
    <div ref={wrap} className="w-full min-w-0">
      <canvas ref={ref} style={{ width: '100%', height }} className="block rounded-lg border border-terminal-border"
        role="img" aria-label={`Ground vibration from probes A and B over the last ${seconds} seconds`} />
    </div>
  );
};

export default SeismicScope;
