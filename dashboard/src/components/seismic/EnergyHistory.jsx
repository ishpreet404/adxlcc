import React, { useEffect, useRef } from 'react';
import useStore from '../../store/useStore';

/**
 * 60-second history strip for one node: probe A / probe B vibration (bars), radar distance (line)
 * and intrusion probability (filled). Works in ECO mode too (one point per packet).
 */
export const EnergyHistory = ({ nodeId, height = 90, seconds = 60 }) => {
  const history = useStore(s => s.histories[nodeId]) || [];
  const ref = useRef(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#080c10'; ctx.fillRect(0, 0, w, height);
    const now = Date.now();
    const t0 = now - seconds * 1000;
    const pts = history.filter(p => p.t >= t0);
    const x = t => ((t - t0) / (seconds * 1000)) * w;
    const plotH = height - 14;

    ctx.strokeStyle = '#1f2937';
    for (let s = 0; s <= seconds; s += 15) { const xx = (s / seconds) * w; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, plotH); ctx.stroke(); }
    ctx.font = '9px "JetBrains Mono", monospace'; ctx.fillStyle = '#6b7280';
    ctx.fillText(`-${seconds}s`, 2, height - 3); ctx.textAlign = 'right'; ctx.fillText('now', w - 2, height - 3); ctx.textAlign = 'left';

    if (!pts.length) { ctx.fillStyle = '#4b5563'; ctx.fillText('no packets in the last minute', 6, plotH / 2); return; }

    // probability fill
    ctx.fillStyle = 'rgba(255,51,68,0.18)';
    ctx.beginPath(); ctx.moveTo(x(pts[0].t), plotH);
    pts.forEach(p => ctx.lineTo(x(p.t), plotH - (p.p || 0) * plotH));
    ctx.lineTo(x(pts[pts.length - 1].t), plotH); ctx.closePath(); ctx.fill();

    // vibration bars
    const vmax = Math.max(0.05, ...pts.map(p => Math.max(p.rmsA, p.rmsB)));
    const bw = Math.max(1.5, w / Math.max(60, pts.length) - 1);
    for (const p of pts) {
      const xx = x(p.t);
      ctx.fillStyle = '#00ff66'; ctx.fillRect(xx - bw, plotH - (p.rmsA / vmax) * plotH * 0.9, bw, (p.rmsA / vmax) * plotH * 0.9);
      ctx.fillStyle = '#ffb000'; ctx.fillRect(xx, plotH - (p.rmsB / vmax) * plotH * 0.9, bw, (p.rmsB / vmax) * plotH * 0.9);
    }
    // radar distance line (inverted: closer = higher)
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5; ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      if (p.radar === null || p.radar === undefined) { pen = false; continue; }
      const y = (Math.min(8, p.radar) / 8) * plotH;
      if (!pen) { ctx.moveTo(x(p.t), y); pen = true; } else ctx.lineTo(x(p.t), y);
    }
    ctx.stroke();

    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00ff66'; ctx.fillText('▮ probe A', 6, 10);
    ctx.fillStyle = '#ffb000'; ctx.fillText('▮ probe B', 66, 10);
    ctx.fillStyle = '#00e5ff'; ctx.fillText('— radar range (top = close)', 126, 10);
    ctx.fillStyle = '#ff6b7a'; ctx.fillText('▒ intrusion p', 290, 10);
    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'right'; ctx.fillText(`vib scale ${vmax.toFixed(2)} g`, w - 4, 10); ctx.textAlign = 'left';
  }, [history, height, seconds]);

  return <canvas ref={ref} style={{ width: '100%', height }} className="block border border-terminal-border" />;
};

export default EnergyHistory;
