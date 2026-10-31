import React, { useEffect, useRef } from 'react';
import useStore from '../../store/useStore';
import { useElementWidth } from '../../lib/hooks';

const SANS = 'Inter, system-ui, sans-serif';

/**
 * 60-second history strip for one node: probe A / probe B vibration (bars), radar distance (line)
 * and intrusion probability (filled). Works in ECO mode too (one point per packet).
 */
export const EnergyHistory = ({ nodeId, height = 90, seconds = 60 }) => {
  const history = useStore(s => s.histories[nodeId]) || [];
  const ref = useRef(null);
  const wrap = useRef(null);
  const width = useElementWidth(wrap, 300);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = width;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1017'; ctx.fillRect(0, 0, w, height);
    const now = Date.now();
    const t0 = now - seconds * 1000;
    const pts = history.filter(p => p.t >= t0);
    const x = t => ((t - t0) / (seconds * 1000)) * w;
    const plotH = height - 14;

    ctx.strokeStyle = '#1c2736';
    for (let s = 0; s <= seconds; s += 15) { const xx = (s / seconds) * w; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.stroke(); }
    ctx.font = `10px ${SANS}`; ctx.fillStyle = '#8b97a8';
    ctx.fillText(`-${seconds}s`, 3, height - 3); ctx.textAlign = 'right'; ctx.fillText('now', w - 3, height - 3); ctx.textAlign = 'left';

    if (!pts.length) { ctx.fillStyle = '#8b97a8'; ctx.textAlign = 'center'; ctx.font = `12px ${SANS}`; ctx.fillText('No packets in the last minute', w / 2, plotH / 2 + 4); ctx.textAlign = 'left'; return; }

    // probability fill
    ctx.fillStyle = 'rgba(239,68,68,0.16)';
    ctx.beginPath(); ctx.moveTo(x(pts[0].t), plotH);
    pts.forEach(p => ctx.lineTo(x(p.t), plotH - (p.p || 0) * plotH));
    ctx.lineTo(x(pts[pts.length - 1].t), plotH); ctx.closePath(); ctx.fill();

    // vibration bars
    const vmax = Math.max(0.05, ...pts.map(p => Math.max(p.rmsA, p.rmsB)));
    const bw = Math.max(1.5, w / Math.max(60, pts.length) - 1);
    for (const p of pts) {
      const xx = x(p.t);
      ctx.fillStyle = '#22c55e'; ctx.fillRect(xx - bw, plotH - (p.rmsA / vmax) * plotH * 0.9, bw, (p.rmsA / vmax) * plotH * 0.9);
      ctx.fillStyle = '#f59e0b'; ctx.fillRect(xx, plotH - (p.rmsB / vmax) * plotH * 0.9, bw, (p.rmsB / vmax) * plotH * 0.9);
    }
    // radar distance line (inverted: closer = higher)
    ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (p.radar === null || p.radar === undefined) { pen = false; continue; }
      const y = (Math.min(8, p.radar) / 8) * plotH;
      if (!pen) { ctx.moveTo(x(p.t), y); pen = true; } else ctx.lineTo(x(p.t), y);
    }
    ctx.stroke();
    ctx.fillStyle = '#8b97a8'; ctx.font = `10px ${SANS}`; ctx.textAlign = 'right'; ctx.fillText(`scale ${vmax.toFixed(2)} g`, w - 4, 11); ctx.textAlign = 'left';
  }, [history, height, seconds, width]);

  return (
    <div ref={wrap} className="w-full min-w-0">
      <canvas ref={ref} style={{ width: '100%', height }} className="block rounded-lg border border-terminal-border" role="img" aria-label={`Vibration, radar range and intrusion probability over the last ${seconds} seconds`} />
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-terminal-muted" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-terminal-green" aria-hidden="true" />Probe A</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-terminal-amber" aria-hidden="true" />Probe B</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-0.5 rounded bg-terminal-cyan" aria-hidden="true" />Radar range (top = close)</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-terminal-red/40" aria-hidden="true" />Intrusion probability</li>
      </ul>
    </div>
  );
};

export default EnergyHistory;
