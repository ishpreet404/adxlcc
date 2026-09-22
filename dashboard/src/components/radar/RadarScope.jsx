import React from 'react';

const RANGE = 8;
const FOV = 120;

/** Plan-position style scope for one node's radar: range rings, beam, target blip, energy bars. */
export const RadarScope = ({ node }) => {
  const radar = node && node.latest ? node.latest.radar : null;
  const pos = node ? node.position : null;
  const online = node && node.status === 'ONLINE';
  const W = 220, H = 150;
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
  const theta = pos ? pos.thetaDeg : 0; // relative bearing, + = right
  const [tx, ty] = polar(Math.min(RANGE, dist || 0), theta);
  const energy = radar ? radar.energy : 0;

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <defs>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
            <stop offset="100%" stopColor="#00e5ff" stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <path d={`M ${cx} ${cy} L ${bx1} ${by1} A ${RANGE * scale} ${RANGE * scale} 0 0 1 ${bx2} ${by2} Z`} fill={presence ? 'rgba(255,51,68,0.08)' : 'rgba(0,229,255,0.06)'} stroke={presence ? '#ff3344' : '#00e5ff'} strokeOpacity="0.5" strokeWidth="1" />
        {[2, 4, 6, 8].map(r => {
          const [x1, y1] = polar(r, -FOV / 2);
          const [x2, y2] = polar(r, FOV / 2);
          return (
            <g key={r}>
              <path d={`M ${x1} ${y1} A ${r * scale} ${r * scale} 0 0 1 ${x2} ${y2}`} fill="none" stroke="#1f2937" strokeWidth="1" />
              <text x={cx + 3} y={cy - r * scale + 3} fontSize="7" fill="#4b5563">{r} m</text>
            </g>
          );
        })}
        {[-60, -30, 0, 30, 60].map(d => {
          const [x, y] = polar(RANGE, d);
          return <line key={d} x1={cx} y1={cy} x2={x} y2={y} stroke="#1f2937" strokeWidth="0.8" />;
        })}
        {online && (
          <g style={{ transformOrigin: `${cx}px ${cy}px` }} className="animate-radar-sweep">
            <path d={`M ${cx} ${cy} L ${cx} ${cy - RANGE * scale} A ${RANGE * scale} ${RANGE * scale} 0 0 1 ${polar(RANGE, 25)[0]} ${polar(RANGE, 25)[1]} Z`} fill="url(#sweepGrad)" opacity="0.5" />
          </g>
        )}
        {presence && dist > 0 && (
          <g>
            <circle cx={tx} cy={ty} r={9} fill="none" stroke="#ff3344" strokeWidth="1" className="animate-ping" style={{ transformOrigin: `${tx}px ${ty}px` }} />
            <circle cx={tx} cy={ty} r={4} fill="#ff3344" />
            <text x={tx + 8} y={ty - 4} fontSize="8" fill="#ff3344" fontWeight="bold">{dist.toFixed(1)} m</text>
            {pos && <text x={tx + 8} y={ty + 6} fontSize="6.5" fill="#fca5a5">θ {theta > 0 ? '+' : ''}{theta.toFixed(0)}° ({pos.bearingSource})</text>}
          </g>
        )}
        {radar && radar.stationaryEnergy > 0 && radar.stationaryDistance > 0 && !radar.moving && (
          <circle cx={polar(Math.min(RANGE, radar.stationaryDistance), 0)[0]} cy={polar(Math.min(RANGE, radar.stationaryDistance), 0)[1]} r={3} fill="#ffb000" opacity="0.8" />
        )}
        <circle cx={cx} cy={cy} r={3} fill="#e5e7eb" />
        <text x={6} y={12} fontSize="8" fill={presence ? '#ff3344' : online ? '#00e5ff' : '#6b7280'} fontWeight="bold">
          {!online ? 'RADAR OFFLINE' : !radar || !radar.ok ? 'RADAR NO DATA' : presence ? (radar.moving ? 'MOVING TARGET' : 'STATIONARY TARGET') : 'CLEAR'}
        </text>
        <text x={W - 6} y={12} fontSize="7" fill="#6b7280" textAnchor="end">{node && node.latest && node.latest.mode === 'ECO' && !presence ? 'radar duty-cycled' : `FOV ${FOV}° · ${RANGE} m`}</text>
      </svg>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <Meter label="MOTION ENERGY" value={energy} max={100} color={energy > 40 ? '#ff3344' : '#00e5ff'} unit="%" />
        <Meter label="STATIC ENERGY" value={radar ? radar.stationaryEnergy : 0} max={100} color="#ffb000" unit="%" />
        <Meter label="DISTANCE" value={dist} max={RANGE} color="#e5e7eb" unit=" m" digits={2} />
      </div>
    </div>
  );
};

export const Meter = ({ label, value = 0, max = 1, color = '#00ff66', unit = '', digits = 0 }) => (
  <div>
    <div className="flex justify-between text-terminal-muted"><span>{label}</span><span className="text-gray-200 tabular-nums">{Number(value || 0).toFixed(digits)}{unit}</span></div>
    <div className="h-1.5 bg-terminal-black border border-terminal-border mt-0.5">
      <div className="h-full transition-all duration-200" style={{ width: `${Math.min(100, (Number(value || 0) / max) * 100)}%`, background: color }} />
    </div>
  </div>
);

export default RadarScope;
