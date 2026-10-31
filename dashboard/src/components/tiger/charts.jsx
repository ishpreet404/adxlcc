import React, { useMemo, useRef, useState } from 'react';
import { useElementWidth } from '../../lib/hooks';
import { toMs, clockShort, fmtInt, severityHex, SEVERITIES, titleCase } from '../../lib/format';

/**
 * Inline-SVG charts for the TigerData panel (no chart dependency).
 * Categorical slots are the validated dark-mode palette (checked against the #111821 card surface);
 * colours are assigned to nodes in a fixed (sorted-id) order, never cycled.
 */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const GRID = '#1c2736';
const AXIS = '#8b97a8';
const SURFACE = '#111821';
const BAR = '#5b6778';

const roundedTop = (x, y, w, h, r) => {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
};

const Tooltip = ({ x, width, children }) => {
  const w = 216;
  const left = x + 14 + w > width ? Math.max(0, x - 14 - w) : x + 14;
  return (
    <div className="absolute top-1 z-10 pointer-events-none rounded-lg border border-terminal-border bg-[#0d131b]/95 shadow-pop px-3 py-2 text-[12px] text-gray-200" style={{ left, width: w }} role="status">
      {children}
    </div>
  );
};

export const Legend = ({ items }) => (
  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-300" aria-label="Legend">
    {items.map(it => (
      <li key={it.key} className="inline-flex items-center gap-1.5 min-w-0">
        {it.dashed
          ? <span className="w-4 flex-shrink-0 border-t border-dashed" style={{ borderColor: it.color }} aria-hidden="true" />
          : <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: it.color }} aria-hidden="true" />}
        <span className="truncate">{it.label}</span>
      </li>
    ))}
  </ul>
);

export const DataTable = ({ columns, rows, max = 200 }) => (
  <div className="overflow-auto max-h-72 rounded-lg border border-terminal-border">
    <table className="w-full text-[12px]">
      <thead className="sticky top-0 bg-terminal-surface">
        <tr className="text-terminal-muted">{columns.map(c => <th key={c.key} scope="col" className={`font-medium px-3 py-2 whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.slice(0, max).map((r, i) => (
          <tr key={i} className="border-t border-terminal-border/70">
            {columns.map(c => <td key={c.key} className={`px-3 py-1.5 whitespace-nowrap ${c.align === 'right' ? 'text-right num' : ''} text-gray-200`}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Titled chart container with a Chart / Table switch (the table is the accessible view). */
export const ChartPanel = ({ title, subtitle, legend, children, table, empty, note }) => {
  const [showTable, setShowTable] = useState(false);
  return (
    <div className="rounded-xl border border-terminal-border p-3 sm:p-4 min-w-0">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-gray-100">{title}</h3>
          {subtitle && <p className="text-[11px] text-terminal-muted mt-0.5">{subtitle}</p>}
        </div>
        {table && !empty && (
          <div className="inline-flex p-0.5 rounded-md border border-terminal-border bg-terminal-black flex-shrink-0" role="group" aria-label="View">
            {[['Chart', false], ['Table', true]].map(([label, v]) => (
              <button key={label} type="button" aria-pressed={showTable === v} onClick={() => setShowTable(v)}
                className={`h-7 px-2.5 rounded text-[11px] font-medium ${showTable === v ? 'bg-white/10 text-gray-100' : 'text-terminal-muted hover:text-gray-200'}`}>{label}</button>
            ))}
          </div>
        )}
      </div>
      {legend && !showTable && !empty && <div className="mb-2">{legend}</div>}
      {empty || (showTable ? table : children)}
      {note && <p className="mt-2 text-[11px] text-terminal-muted">{note}</p>}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
/**
 * Per-minute activity: lines of peak intrusion probability per node (top panel) and total
 * samples per minute as faint bars (bottom panel). Two panels share the time axis instead of
 * one dual-axis chart.
 */
export const ActivityChart = ({ rows, minutes = 60, nameOf = (id) => id, threshold }) => {
  const ref = useRef(null);
  const W = useElementWidth(ref, 600);
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    const end = Math.ceil(Date.now() / 60000) * 60000;
    const start = end - minutes * 60000;
    const nodes = [...new Set(rows.map(r => r.node_id))].sort();
    const byNode = new Map(nodes.map(n => [n, []]));
    const buckets = new Map();
    for (const r of rows) {
      const t = toMs(r.bucket);
      if (!t || t < start - 60000 || t > end) continue;
      const pt = { t, p: Number(r.max_p) || 0, rms: Number(r.avg_rms) || 0, n: Number(r.samples) || 0, node: r.node_id };
      byNode.get(r.node_id).push(pt);
      const b = buckets.get(t) || { t, total: 0, per: {} };
      b.total += pt.n;
      b.per[r.node_id] = pt;
      buckets.set(t, b);
    }
    byNode.forEach(list => list.sort((a, b) => a.t - b.t));
    const list = [...buckets.values()].sort((a, b) => a.t - b.t);
    return { start, end, nodes, byNode, buckets: list, bucketAt: buckets, maxN: Math.max(1, ...list.map(b => b.total)) };
  }, [rows, minutes]);

  const { start, end, nodes, byNode, buckets, bucketAt, maxN } = model;
  const color = (id) => SERIES[nodes.indexOf(id) % SERIES.length];
  const direct = nodes.length >= 2 && nodes.length <= 4 && W >= 560;
  const m = { l: 38, r: direct ? 104 : 10, t: 8 };
  const topH = 168, gap = 18, botH = 44, axisH = 20;
  const H = m.t + topH + gap + botH + axisH;
  const pw = Math.max(10, W - m.l - m.r);
  const x = (t) => m.l + ((t - start) / (end - start)) * pw;
  const yP = (p) => m.t + topH - Math.max(0, Math.min(1, p)) * topH;
  const botTop = m.t + topH + gap;
  const yN = (n) => botTop + botH - (n / maxN) * botH;
  const tickEvery = (W < 420 ? 20 : 10) * 60000;
  const ticks = [];
  for (let t = Math.ceil(start / tickEvery) * tickEvery; t <= end; t += tickEvery) ticks.push(t);

  const pathFor = (pts) => {
    let d = '';
    pts.forEach((p, i) => {
      const brk = i === 0 || p.t - pts[i - 1].t > 150000;
      d += `${brk ? 'M' : 'L'}${x(p.t + 30000).toFixed(1)},${yP(p.p).toFixed(1)}`;
    });
    return d;
  };
  const isolated = (pts, i) => (i === 0 || pts[i].t - pts[i - 1].t > 150000) && (i === pts.length - 1 || pts[i + 1].t - pts[i].t > 150000);

  // de-overlapped end labels
  const labels = direct ? nodes.map(id => {
    const pts = byNode.get(id);
    const last = pts[pts.length - 1];
    return { id, y: yP(last ? last.p : 0) };
  }).sort((a, b) => a.y - b.y) : [];
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    if (px < m.l || px > m.l + pw) { setHover(null); return; }
    const t = Math.floor((start + ((px - m.l) / pw) * (end - start)) / 60000) * 60000;
    setHover({ t, px: x(t + 30000) });
  };
  const hb = hover ? bucketAt.get(hover.t) : null;
  const lastP = nodes.map(id => { const pts = byNode.get(id); return pts.length ? `${nameOf(id)} ${Math.round(pts[pts.length - 1].p * 100)}%` : null; }).filter(Boolean).join(', ');

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block touch-pan-y" role="img"
        aria-label={`Peak intrusion probability per node over the last ${minutes} minutes. Latest: ${lastP || 'no data'}. Peak samples per minute ${fmtInt(maxN)}.`}
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        {/* top panel grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(v => <line key={v} x1={m.l} x2={m.l + pw} y1={yP(v)} y2={yP(v)} stroke={GRID} strokeWidth="1" />)}
        {[0, 0.5, 1].map(v => <text key={v} x={m.l - 6} y={yP(v) + 3.5} textAnchor="end" fontSize="10" fill={AXIS} className="num">{Math.round(v * 100)}%</text>)}
        {threshold > 0 && threshold < 1 && (
          <line x1={m.l} x2={m.l + pw} y1={yP(threshold)} y2={yP(threshold)} stroke={AXIS} strokeOpacity="0.6" strokeDasharray="4 4" strokeWidth="1" />
        )}
        {/* lines */}
        {nodes.map(id => {
          const pts = byNode.get(id);
          return (
            <g key={id}>
              <path d={pathFor(pts)} fill="none" stroke={color(id)} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => (isolated(pts, i) ? <circle key={p.t} cx={x(p.t + 30000)} cy={yP(p.p)} r="3" fill={color(id)} /> : null))}
            </g>
          );
        })}
        {direct && labels.map(l => (
          <text key={l.id} x={m.l + pw + 8} y={l.y + 3.5} fontSize="11" fill="#d1d5db">{nameOf(l.id).length > 14 ? `${nameOf(l.id).slice(0, 13)}…` : nameOf(l.id)}</text>
        ))}
        {/* bottom panel: samples per minute */}
        <line x1={m.l} x2={m.l + pw} y1={botTop + botH} y2={botTop + botH} stroke={GRID} strokeWidth="1" />
        <text x={m.l - 6} y={botTop + 8} textAnchor="end" fontSize="10" fill={AXIS} className="num">{maxN >= 1000 ? `${Math.round(maxN / 100) / 10}k` : maxN}</text>
        <text x={m.l + 4} y={botTop - 5} fontSize="10" fill={AXIS}>Samples / min</text>
        {buckets.map(b => {
          const x0 = x(b.t) + 1, w = Math.max(1.5, x(b.t + 60000) - x(b.t) - 2);
          const y = yN(b.total), h = botTop + botH - y;
          return h > 0 ? <path key={b.t} d={roundedTop(x0, y, w, h, 2)} fill={BAR} fillOpacity={hover && hover.t === b.t ? 0.9 : 0.5} /> : null;
        })}
        {/* time axis */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={m.t} y2={m.t + topH} stroke={GRID} strokeWidth="1" strokeOpacity="0.6" />
            <text x={x(t)} y={H - 5} textAnchor="middle" fontSize="10" fill={AXIS} className="num">{clockShort(t)}</text>
          </g>
        ))}
        {/* hover crosshair */}
        {hover && (
          <g pointerEvents="none">
            <line x1={hover.px} x2={hover.px} y1={m.t} y2={botTop + botH} stroke={AXIS} strokeOpacity="0.6" strokeWidth="1" />
            {hb && nodes.map(id => (hb.per[id] ? <circle key={id} cx={hover.px} cy={yP(hb.per[id].p)} r="4.5" fill={color(id)} stroke={SURFACE} strokeWidth="2" /> : null))}
          </g>
        )}
      </svg>
      {hover && (
        <Tooltip x={hover.px} width={W}>
          <div className="text-terminal-muted mb-1 num">{clockShort(hover.t)}–{clockShort(hover.t + 60000)}</div>
          {hb ? (
            <>
              {nodes.filter(id => hb.per[id]).map(id => (
                <div key={id} className="flex items-center gap-2 py-0.5">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: color(id) }} aria-hidden="true" />
                  <span className="truncate flex-1">{nameOf(id)}</span>
                  <span className="num text-gray-50">{Math.round(hb.per[id].p * 100)}%</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-terminal-border mt-1 pt-1 text-terminal-muted"><span>Samples</span><span className="num text-gray-200">{fmtInt(hb.total)}</span></div>
            </>
          ) : <div className="text-terminal-muted">No telemetry this minute</div>}
        </Tooltip>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------------------------
const niceMax = (v) => {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
};

/** Alerts per time bucket, stacked by severity (critical at the baseline). */
export const AlertTimeline = ({ buckets, hours = 6 }) => {
  const ref = useRef(null);
  const W = useElementWidth(ref, 600);
  const [hover, setHover] = useState(null);

  const model = useMemo(() => {
    const grouped = new Map();
    for (const b of buckets) {
      const t = toMs(b.bucket);
      if (!t) continue;
      const g = grouped.get(t) || { t, counts: {}, total: 0 };
      const sev = String(b.severity || 'INFO').toUpperCase();
      const c = Number(b.count) || 0;
      g.counts[sev] = (g.counts[sev] || 0) + c;
      g.total += c;
      grouped.set(t, g);
    }
    const list = [...grouped.values()].sort((a, b) => a.t - b.t);
    let step = Infinity;
    for (let i = 1; i < list.length; i++) step = Math.min(step, list[i].t - list[i - 1].t);
    const bucketMs = Number.isFinite(step) && step >= 60000 ? step : (hours * 3600000) / 24;
    const end = Math.ceil(Date.now() / bucketMs) * bucketMs;
    const start = end - hours * 3600000;
    const present = SEVERITIES.filter(s => list.some(g => g.counts[s]));
    const extra = [...new Set(list.flatMap(g => Object.keys(g.counts)))].filter(s => !SEVERITIES.includes(s));
    return { list, bucketMs, start, end, sevs: [...present, ...extra], yMax: niceMax(Math.max(1, ...list.map(g => g.total))) };
  }, [buckets, hours]);

  const { list, bucketMs, start, end, sevs, yMax } = model;
  const m = { l: 32, r: 10, t: 8 };
  const plotH = 176, axisH = 20;
  const H = m.t + plotH + axisH;
  const pw = Math.max(10, W - m.l - m.r);
  const x = (t) => m.l + ((t - start) / (end - start)) * pw;
  const y = (v) => m.t + plotH - (v / yMax) * plotH;
  const hourMs = 3600000;
  const tickEvery = W < 420 ? 2 * hourMs : hourMs;
  const ticks = [];
  for (let t = Math.ceil(start / tickEvery) * tickEvery; t <= end; t += tickEvery) ticks.push(t);
  const yTicks = yMax % 2 === 0 ? [0, yMax / 2, yMax] : [0, yMax];
  const total = list.reduce((s, g) => s + g.total, 0);
  const hg = hover !== null ? list.find(g => g.t === hover) : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block touch-pan-y" role="img"
        aria-label={`${fmtInt(total)} alerts in the last ${hours} hours, stacked by severity.`}
        onPointerLeave={() => setHover(null)}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={m.l} x2={m.l + pw} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth="1" />
            <text x={m.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill={AXIS} className="num">{v}</text>
          </g>
        ))}
        {list.map(g => {
          if (g.t + bucketMs < start) return null;
          const x0 = x(Math.max(start, g.t)) + 1;
          const w = Math.max(2, x(Math.min(end, g.t + bucketMs)) - x(Math.max(start, g.t)) - 2);
          const order = sevs.filter(s => g.counts[s]);
          let cursor = y(0);
          return (
            <g key={g.t} opacity={hover !== null && hover !== g.t ? 0.55 : 1}>
              {order.map((s, i) => {
                const h = (g.counts[s] / yMax) * plotH;
                const top = cursor - h;
                const bottomGap = i > 0 ? 2 : 0;
                cursor = top;
                const hh = Math.max(1, h - bottomGap);
                return i === order.length - 1
                  ? <path key={s} d={roundedTop(x0, top, w, hh, 3)} fill={severityHex(s)} />
                  : <rect key={s} x={x0} y={top} width={w} height={hh} fill={severityHex(s)} />;
              })}
            </g>
          );
        })}
        {/* hit targets larger than the bars */}
        {list.map(g => (
          <rect key={`hit-${g.t}`} x={x(Math.max(start, g.t))} y={m.t} width={Math.max(8, x(g.t + bucketMs) - x(g.t))} height={plotH} fill="transparent"
            onPointerEnter={() => setHover(g.t)} onPointerDown={() => setHover(g.t)} />
        ))}
        {ticks.map(t => <text key={t} x={x(t)} y={H - 5} textAnchor="middle" fontSize="10" fill={AXIS} className="num">{clockShort(t)}</text>)}
      </svg>
      {hg && (
        <Tooltip x={x(hg.t + bucketMs / 2)} width={W}>
          <div className="text-terminal-muted mb-1 num">{clockShort(hg.t)}–{clockShort(hg.t + bucketMs)}</div>
          {sevs.filter(s => hg.counts[s]).map(s => (
            <div key={s} className="flex items-center gap-2 py-0.5">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: severityHex(s) }} aria-hidden="true" />
              <span className="flex-1">{titleCase(s)}</span>
              <span className="num text-gray-50">{fmtInt(hg.counts[s])}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-terminal-border mt-1 pt-1 text-terminal-muted"><span>Total</span><span className="num text-gray-200">{fmtInt(hg.total)}</span></div>
        </Tooltip>
      )}
    </div>
  );
};

/** Severities present in a timeline payload, in canonical order (for the legend / table). */
export const timelineSeverities = (buckets) => {
  const present = new Set(buckets.map(b => String(b.severity || 'INFO').toUpperCase()));
  return [...SEVERITIES.filter(s => present.has(s)), ...[...present].filter(s => !SEVERITIES.includes(s))];
};
