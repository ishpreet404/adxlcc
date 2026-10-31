import React from 'react';
import useStore from '../../store/useStore';

const RANGE = 8;
const FOV = 120;

/** Plan-position scope for one node's radar + a range-vs-time strip and a big readout. */
export const RadarScope = ({ node }) => {
  const history = useStore(s => (node ? s.histories[node.id] : null)) || [];
  const radar = node && node.latest ? node.latest.radar : null;
  const pos = node ? node.position : null;
  const online = node && node.status === 'ONLINE';
  const W = 240, H = 160;
  const cx = W / 2, cy = H - 14;
  const scale = (H - 26) / RANGE;
  const polar = (r, degFromUp) => {
    const a = (degFromUp - 90) * Math.PI / 180;
    return [cx + r * scale * Math.cos(a), cy + r * scale * Math.sin(a)];
  };
  const [bx1, by1] = polar(RANGE, -FOV / 2);
  const [bx2, by2] = polar(RANGE, FOV / 2);
  const presence = online && radar && radar.presence;
  const dist = radar ? radar.distance : 0;
  const theta = pos ? pos.thetaDeg : 0;
  const [tx, ty] = polar(Math.min(RANGE, dist || 0), theta);
  const energy = radar ? radar.energy : 0;

  // approach / retreat from the last ~4 s of radar ranges
  const recent = history.filter(p => p.radar !== null && p.radar !== undefined && Date.now() - p.t < 4000);
  let trend = null;
  if (recent.length >= 3) {
    const d = recent[recent.length - 1].radar - recent[0].radar;
    trend = d < -0.4 ? 'Approaching' : d > 0.4 ? 'Moving away' : 'Holding';
  }
  const trendColor = trend === 'Approaching' ? '#ef4444' : trend === 'Moving away' ? '#38bdf8' : '#f59e0b';

  // range-time strip: last 30 s
  const stripPts = history.filter(p => Date.now() - p.t < 30000);

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="flex-1 min-w-0" role="img" aria-label={!online ? 'Radar offline' : presence ? `Radar target at ${dist.toFixed(1)} metres` : 'Radar clear'}>
          <defs>
            <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#38bdf8" stopOpacity="0" /><stop offset="100%" stopColor="#38bdf8" stopOpacity="0.5" /></linearGradient>
          </defs>
          <path d={`M ${cx} ${cy} L ${bx1} ${by1} A ${RANGE * scale} ${RANGE * scale} 0 0 1 ${bx2} ${by2} Z`} fill={presence ? 'rgba(239,68,68,0.08)' : 'rgba(56,189,248,0.06)'} stroke={presence ? '#ef4444' : '#38bdf8'} strokeOpacity="0.5" strokeWidth="1" />
          {[2, 4, 6, 8].map(r => {
            const [x1, y1] = polar(r, -FOV / 2);
            const [x2, y2] = polar(r, FOV / 2);
            return (<g key={r}><path d={`M ${x1} ${y1} A ${r * scale} ${r * scale} 0 0 1 ${x2} ${y2}`} fill="none" stroke="#243142" strokeWidth="1" /><text x={cx + 3} y={cy - r * scale + 3} fontSize="8" fill="#5b6778">{r} m</text></g>);
          })}
          {[-60, -30, 0, 30, 60].map(d => { const [x, y] = polar(RANGE, d); return <line key={d} x1={cx} y1={cy} x2={x} y2={y} stroke="#243142" strokeWidth="0.8" />; })}
          {online && (
            <g style={{ transformOrigin: `${cx}px ${cy}px` }} className="animate-radar-sweep">
              <path d={`M ${cx} ${cy} L ${cx} ${cy - RANGE * scale} A ${RANGE * scale} ${RANGE * scale} 0 0 1 ${polar(RANGE, 25)[0]} ${polar(RANGE, 25)[1]} Z`} fill="url(#sweepGrad)" opacity="0.5" />
            </g>
          )}
          {/* energy arc at the target range */}
          {presence && dist > 0 && (
            <path d={`M ${polar(Math.min(RANGE, dist), -FOV / 2).join(' ')} A ${Math.min(RANGE, dist) * scale} ${Math.min(RANGE, dist) * scale} 0 0 1 ${polar(Math.min(RANGE, dist), FOV / 2).join(' ')}`} fill="none" stroke="#ef4444" strokeOpacity={0.25 + energy / 150} strokeWidth="2" strokeDasharray="3 2" />
          )}
          {presence && dist > 0 && (
            <g>
              <circle cx={tx} cy={ty} r={10} fill="none" stroke="#ef4444" strokeWidth="1" className="animate-ping" style={{ transformOrigin: `${tx}px ${ty}px` }} />
              <circle cx={tx} cy={ty} r={5} fill="#ef4444" />
            </g>
          )}
          {radar && radar.stationaryEnergy > 0 && radar.stationaryDistance > 0 && !radar.moving && (
            <circle cx={polar(Math.min(RANGE, radar.stationaryDistance), 0)[0]} cy={polar(Math.min(RANGE, radar.stationaryDistance), 0)[1]} r={3.5} fill="#f59e0b" opacity="0.9" />
          )}
          <circle cx={cx} cy={cy} r={3} fill="#e5e7eb" />
          <text x={6} y={13} fontSize="10" fill={presence ? '#ef4444' : online ? '#38bdf8' : '#8b97a8'} fontWeight="600">
            {!online ? 'Radar offline' : !radar || !radar.ok ? 'Radar: no data' : presence ? (radar.moving ? 'Moving target' : 'Still target') : 'Clear'}
          </text>
        </svg>
        {/* big readout */}
        <div className="w-[100px] flex-shrink-0 flex flex-col justify-center gap-0.5 rounded-lg border border-terminal-border p-2.5">
          <div className="text-[11px] text-terminal-muted">Distance</div>
          <div className={`num text-2xl font-semibold leading-none ${presence ? 'text-red-400' : 'text-gray-500'}`}>{presence && dist > 0 ? dist.toFixed(1) : '—'}<span className="text-sm font-normal text-terminal-muted"> m</span></div>
          <div className="text-[11px] text-terminal-muted mt-1.5">Bearing</div>
          <div className="num text-base font-semibold text-gray-100">{presence && pos ? `${theta > 0 ? '+' : ''}${theta.toFixed(0)}°` : '—'}</div>
          {trend && presence && <div className="text-[11px] font-medium mt-1" style={{ color: trendColor }}>{trend}</div>}
        </div>
      </div>
      {/* range-time strip */}
      <div className="rounded-lg border border-terminal-border overflow-hidden">
        <svg viewBox="0 0 300 44" className="w-full block" preserveAspectRatio="none" aria-hidden="true">
          <rect x={0} y={0} width={300} height={44} fill="#0b1017" />
          {[2, 4, 6].map(r => <line key={r} x1={0} y1={44 - (r / 8) * 40 - 2} x2={300} y2={44 - (r / 8) * 40 - 2} stroke="#243142" strokeWidth="0.5" />)}
          {stripPts.map((p, i) => {
            const x = ((p.t - (Date.now() - 30000)) / 30000) * 300;
            if (p.radar === null || p.radar === undefined) return <line key={i} x1={x} y1={41} x2={x} y2={43} stroke="#243142" strokeWidth="1" />;
            const y = 44 - (Math.min(8, p.radar) / 8) * 40 - 2;
            return <circle key={i} cx={x} cy={y} r={1.6} fill="#ef4444" />;
          })}
          <text x={3} y={8} fontSize="6" fill="#8b97a8">Range over the last 30 s (top 8 m, bottom 0 m)</text>
        </svg>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <Meter label="Motion energy" value={energy} max={100} color={energy > 40 ? '#ef4444' : '#38bdf8'} unit="%" />
        <Meter label="Static energy" value={radar ? radar.stationaryEnergy : 0} max={100} color="#f59e0b" unit="%" />
      </div>
    </div>
  );
};

export const Meter = ({ label, value = 0, max = 1, color = '#22c55e', unit = '', digits = 0 }) => (
  <div>
    <div className="flex justify-between gap-2 text-terminal-muted"><span className="truncate">{label}</span><span className="num text-gray-200">{Number(value || 0).toFixed(digits)}{unit}</span></div>
    <div className="h-1.5 rounded-full bg-terminal-black mt-1 overflow-hidden" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(value || 0)}>
      <div className="h-full rounded-full transition-all duration-200" style={{ width: `${Math.min(100, (Number(value || 0) / max) * 100)}%`, background: color }} />
    </div>
  </div>
);

export default RadarScope;
