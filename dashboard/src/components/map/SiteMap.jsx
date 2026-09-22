import React, { useMemo, useRef, useState, useCallback } from 'react';
import useStore from '../../store/useStore';
import { levelHex, zoneHex, kindHex } from '../../lib/format';

const RADAR_RANGE = 8;
const RADAR_FOV = 120;

const polar = (cx, cy, r, deg) => {
  const a = deg * Math.PI / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
};
const arcPath = (cx, cy, r, startDeg, endDeg) => {
  const [x1, y1] = polar(cx, cy, r, startDeg);
  const [x2, y2] = polar(cx, cy, r, endDeg);
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 0 ${x2} ${y2} Z`;
};

/**
 * Top-down site map (1 SVG unit = 1 m, north up). Layers: zones, heat map, radar beams,
 * probes + seismic rings, per-node estimates, merged tracks with trail, velocity and
 * 5 s prediction, ETA hand-off lines, tamper/loiter badges, simulator ground truth.
 * Modes: select (default), place nodes (drag), draw zone (click to add vertices).
 */
export const SiteMap = ({ compact = false, wall = false }) => {
  const site = useStore(s => s.site);
  const nodes = useStore(s => s.nodes);
  const tracks = useStore(s => s.tracks);
  const sim = useStore(s => s.sim);
  const activity = useStore(s => s.activity);
  const layers = useStore(s => s.layers);
  const showTruth = useStore(s => s.showGroundTruth);
  const selectedId = useStore(s => s.selectedNodeId);
  const selectNode = useStore(s => s.selectNode);
  const editMap = useStore(s => s.editMap);
  const moveNode = useStore(s => s.moveNode);
  const saveNode = useStore(s => s.saveNode);
  const zoneDraft = useStore(s => s.zoneDraft);
  const addZonePoint = useStore(s => s.addZonePoint);
  const alerts = useStore(s => s.alerts);
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);

  const W = site.width, H = site.height;
  const pad = 2;
  const list = useMemo(() => Object.values(nodes), [nodes]);
  const zones = site.zones || [];
  const fs = compact ? 1.1 : 1; // font scale

  const toSite = useCallback((evt) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, H - p.y)) };
  }, [W, H]);

  const onNodeDown = (e, id) => {
    if (zoneDraft) return;
    if (!editMap) { selectNode(id); return; }
    e.stopPropagation();
    setDrag(id);
    selectNode(id);
  };
  const onMove = (e) => {
    const p = toSite(e);
    if (p) setHover(p);
    if (drag && p) moveNode(drag, Number(p.x.toFixed(1)), Number(p.y.toFixed(1)));
  };
  const onUp = () => {
    if (!drag) return;
    const n = nodes[drag];
    if (n) saveNode(drag, { x: n.x, y: n.y });
    setDrag(null);
  };
  const onClick = (e) => {
    if (!zoneDraft) return;
    const p = toSite(e);
    if (p) addZonePoint(Number(p.x.toFixed(1)), Number(p.y.toFixed(1)));
  };

  const gridStep = W > 60 ? 10 : 5;
  const gridLines = [];
  for (let x = 0; x <= W; x += gridStep) gridLines.push(<line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke="#1f2937" strokeWidth="0.05" />);
  for (let y = 0; y <= H; y += gridStep) gridLines.push(<line key={`gy${y}`} x1={0} y1={H - y} x2={W} y2={H - y} stroke="#1f2937" strokeWidth="0.05" />);

  const tamperNodes = new Set(alerts.filter(a => a.kind === 'TAMPER').map(a => a.nodeId));
  const loiterNodes = new Set(alerts.filter(a => a.kind === 'LOITER').map(a => a.nodeId));
  const heatMax = activity && activity.max ? activity.max : 1;

  return (
    <div className="relative w-full h-full min-h-[260px]">
      <svg ref={svgRef} viewBox={`${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}`} className={`w-full h-full select-none ${zoneDraft ? 'cursor-crosshair' : ''}`}
        onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => { onUp(); setHover(null); }} onClick={onClick}>
        <defs>
          <radialGradient id="beam" cx="0" cy="0" r="1"><stop offset="0%" stopColor="#00e5ff" stopOpacity="0.35" /><stop offset="100%" stopColor="#00e5ff" stopOpacity="0.02" /></radialGradient>
          <radialGradient id="beamHot" cx="0" cy="0" r="1"><stop offset="0%" stopColor="#ff3344" stopOpacity="0.45" /><stop offset="100%" stopColor="#ff3344" stopOpacity="0.03" /></radialGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#ff3344" /></marker>
        </defs>

        <rect x={0} y={0} width={W} height={H} fill="#0a1017" stroke="#374151" strokeWidth="0.15" />
        {gridLines}

        {/* heat map */}
        {layers.heat && activity && activity.cells.map(c => (
          <rect key={`h${c.x},${c.y}`} x={c.x} y={H - c.y - 1} width={1} height={1} fill="#ff3344" fillOpacity={0.08 + 0.55 * Math.sqrt(c.n / heatMax)} />
        ))}

        {/* zones */}
        {layers.zones && zones.map(z => {
          const col = zoneHex(z.type);
          const cx = z.points.reduce((s, p) => s + p[0], 0) / z.points.length;
          const cy = z.points.reduce((s, p) => s + p[1], 0) / z.points.length;
          return (
            <g key={z.id}>
              <polygon points={z.points.map(p => `${p[0]},${H - p[1]}`).join(' ')} fill={col} fillOpacity="0.08" stroke={col} strokeOpacity="0.7" strokeWidth="0.12" strokeDasharray={z.type === 'allowed' ? '0.5 0.3' : undefined} />
              <text x={cx} y={H - cy} fontSize={0.9 * fs} fill={col} fillOpacity="0.9" textAnchor="middle" fontWeight="bold">{z.name.toUpperCase()}</text>
              <text x={cx} y={H - cy + 1} fontSize={0.6 * fs} fill={col} fillOpacity="0.7" textAnchor="middle">{z.type}</text>
            </g>
          );
        })}
        {zoneDraft && zoneDraft.points.length > 0 && (
          <g>
            <polyline points={[...zoneDraft.points, hover ? [hover.x, hover.y] : zoneDraft.points[0]].map(p => `${p[0]},${H - p[1]}`).join(' ')} fill="#ffb000" fillOpacity="0.12" stroke="#ffb000" strokeWidth="0.12" strokeDasharray="0.4 0.25" />
            {zoneDraft.points.map((p, i) => <circle key={i} cx={p[0]} cy={H - p[1]} r={0.3} fill="#ffb000" />)}
          </g>
        )}

        <text x={0.4} y={H - 0.5} fontSize={0.9 * fs} fill="#4b5563">0,0</text>
        <text x={W - 3.5} y={0.9} fontSize={0.9 * fs} fill="#4b5563">{W}×{H} m</text>
        <line x1={W - 11} y1={H - 1} x2={W - 1} y2={H - 1} stroke="#6b7280" strokeWidth="0.15" />
        <text x={W - 7.2} y={H - 1.4} fontSize={0.8 * fs} fill="#6b7280">10 m</text>
        <text x={-1.4} y={1.2} fontSize={1.1 * fs} fill="#6b7280" fontWeight="bold">N↑</text>

        {/* nodes */}
        {list.map(n => {
          const cx = n.x, cy = H - n.y;
          const lvl = n.fusion ? n.fusion.level : 'CLEAR';
          const offline = n.status !== 'ONLINE';
          const radar = n.latest && n.latest.radar;
          const radarHot = radar && radar.presence;
          const probes = n.latest ? n.latest.probes : null;
          const rmsA = probes ? probes[0].rms : 0, rmsB = probes ? probes[1].rms : 0;
          const ringA = Math.min(6, rmsA * 40), ringB = Math.min(6, rmsB * 40);
          const tamper = tamperNodes.has(n.id) || (n.latest && n.latest.tamper && n.latest.tamper.flag);
          const loiter = loiterNodes.has(n.id);
          const color = offline ? '#6b7280' : tamper ? kindHex('TAMPER') : levelHex(lvl);
          const selected = n.id === selectedId;
          const pa = n.probes ? n.probes.a : null, pb = n.probes ? n.probes.b : null;
          const pos = n.position;
          const live = n.latest && n.latest.mode === 'LIVE';
          return (
            <g key={n.id} className="map-node" onPointerDown={(e) => onNodeDown(e, n.id)}>
              {layers.beams && !offline && (
                <path d={arcPath(cx, cy, RADAR_RANGE, n.heading - RADAR_FOV / 2, n.heading + RADAR_FOV / 2)}
                  fill={radarHot ? 'url(#beamHot)' : 'url(#beam)'} stroke={radarHot ? '#ff3344' : '#00e5ff'} strokeOpacity={live ? 0.5 : 0.25} strokeWidth="0.08" strokeDasharray={live ? undefined : '0.4 0.3'} />
              )}
              {radarHot && radar.distance > 0 && (
                <path d={`M ${polar(cx, cy, radar.distance, n.heading - RADAR_FOV / 2).join(' ')} A ${radar.distance} ${radar.distance} 0 0 0 ${polar(cx, cy, radar.distance, n.heading + RADAR_FOV / 2).join(' ')}`}
                  fill="none" stroke="#ff3344" strokeWidth="0.12" strokeDasharray="0.4 0.25" />
              )}
              {!offline && pa && ringA > 0.3 && <circle cx={pa.x} cy={H - pa.y} r={ringA} fill="none" stroke="#ffb000" strokeOpacity={Math.min(0.9, 0.2 + rmsA * 4)} strokeWidth="0.1" />}
              {!offline && pb && ringB > 0.3 && <circle cx={pb.x} cy={H - pb.y} r={ringB} fill="none" stroke="#ffb000" strokeOpacity={Math.min(0.9, 0.2 + rmsB * 4)} strokeWidth="0.1" />}
              {pa && pb && <line x1={pa.x} y1={H - pa.y} x2={pb.x} y2={H - pb.y} stroke="#9ca3af" strokeWidth="0.08" />}
              {pa && <g><circle cx={pa.x} cy={H - pa.y} r={0.32} fill={rmsA > 0.02 ? '#ffb000' : '#374151'} stroke="#e5e7eb" strokeWidth="0.06" /><text x={pa.x} y={H - pa.y + 0.22} fontSize="0.55" fill="#000" textAnchor="middle" fontWeight="bold">A</text></g>}
              {pb && <g><circle cx={pb.x} cy={H - pb.y} r={0.32} fill={rmsB > 0.02 ? '#ffb000' : '#374151'} stroke="#e5e7eb" strokeWidth="0.06" /><text x={pb.x} y={H - pb.y + 0.22} fontSize="0.55" fill="#000" textAnchor="middle" fontWeight="bold">B</text></g>}
              <line x1={cx} y1={cy} x2={polar(cx, cy, 1.6, n.heading)[0]} y2={polar(cx, cy, 1.6, n.heading)[1]} stroke={color} strokeWidth="0.14" />
              {(lvl === 'INTRUSION' || tamper) && !offline && <circle cx={cx} cy={cy} r={1.2} fill="none" stroke={color} strokeWidth="0.12" className="animate-ping" style={{ transformOrigin: `${cx}px ${cy}px` }} />}
              <rect x={cx - 0.6} y={cy - 0.6} width={1.2} height={1.2} fill="#0c1219" stroke={color} strokeWidth={selected ? 0.22 : 0.12} transform={`rotate(45 ${cx} ${cy})`} />
              <circle cx={cx} cy={cy} r={0.22} fill={color} />
              {tamper && <text x={cx + 0.9} y={cy - 0.7} fontSize="1.1" fill={kindHex('TAMPER')}>⚠</text>}
              {loiter && !tamper && <text x={cx + 0.9} y={cy - 0.7} fontSize="1" fill={kindHex('LOITER')}>⏱</text>}
              {layers.labels && <text x={cx} y={cy - 1.2} fontSize={0.85 * fs} fill={selected ? '#fff' : '#d1d5db'} textAnchor="middle" fontWeight="bold">{n.name}</text>}
              {layers.labels && <text x={cx} y={cy + 1.9} fontSize={0.65 * fs} fill={color} textAnchor="middle">
                {offline ? n.status : tamper ? 'TAMPER' : `${n.simulated ? 'SIM · ' : ''}${lvl}${n.latest && n.latest.battery.low ? ' · LOW BAT' : ''}`}
              </text>}
              {pos && !offline && (
                <g>
                  <line x1={cx} y1={cy} x2={pos.x} y2={H - pos.y} stroke={color} strokeWidth="0.06" strokeDasharray="0.3 0.2" />
                  <ellipse cx={pos.x} cy={H - pos.y} rx={Math.max(0.5, pos.sigmaRangeM)} ry={Math.max(0.5, pos.rangeM * Math.sin(pos.sigmaBearingDeg * Math.PI / 180))}
                    transform={`rotate(${-pos.bearingDeg} ${pos.x} ${H - pos.y})`} fill={color} fillOpacity="0.12" stroke={color} strokeWidth="0.05" strokeOpacity="0.6" />
                </g>
              )}
            </g>
          );
        })}

        {/* merged tracks */}
        {tracks.map(t => {
          const color = levelHex(t.level);
          const tx = t.x, ty = H - t.y;
          return (
            <g key={t.id}>
              {layers.trails && t.trail.length > 1 && (
                <polyline points={t.trail.map(p => `${p.x},${H - p.y}`).join(' ')} fill="none" stroke={color} strokeWidth="0.1" strokeOpacity="0.6" strokeDasharray="0.25 0.2" />
              )}
              {layers.predict && t.predicted && (
                <g>
                  <line x1={tx} y1={ty} x2={t.predicted.x} y2={H - t.predicted.y} stroke="#ff3344" strokeWidth="0.12" strokeOpacity="0.8" markerEnd="url(#arrow)" />
                  <text x={t.predicted.x} y={H - t.predicted.y - 0.5} fontSize={0.6 * fs} fill="#fca5a5" textAnchor="middle">+5 s</text>
                </g>
              )}
              {layers.predict && t.eta && nodes[t.eta.nodeId] && (
                <g>
                  <line x1={tx} y1={ty} x2={nodes[t.eta.nodeId].x} y2={H - nodes[t.eta.nodeId].y} stroke="#00e5ff" strokeWidth="0.06" strokeDasharray="0.2 0.3" />
                  <text x={(tx + nodes[t.eta.nodeId].x) / 2} y={(ty + H - nodes[t.eta.nodeId].y) / 2 - 0.3} fontSize={0.6 * fs} fill="#00e5ff" textAnchor="middle">ETA {t.eta.etaS}s → {t.eta.nodeName}</text>
                </g>
              )}
              <circle cx={tx} cy={ty} r={1.1} fill="none" stroke={color} strokeWidth="0.08" className="animate-ping" style={{ transformOrigin: `${tx}px ${ty}px` }} />
              <line x1={tx - 0.9} y1={ty} x2={tx + 0.9} y2={ty} stroke={color} strokeWidth="0.1" />
              <line x1={tx} y1={ty - 0.9} x2={tx} y2={ty + 0.9} stroke={color} strokeWidth="0.1" />
              <circle cx={tx} cy={ty} r={0.45} fill="none" stroke={color} strokeWidth="0.12" />
              {t.method === 'triangulated' && <circle cx={tx} cy={ty} r={0.7} fill="none" stroke="#00ff66" strokeWidth="0.08" />}
              <text x={tx} y={ty - 1.3} fontSize={0.7 * fs} fill={color} textAnchor="middle" fontWeight="bold">
                {t.targetClass === 'VEHICLE' ? '🚗' : t.running ? '🏃' : '🚶'} {t.id} · {Math.round(t.probability * 100)}%{t.speed > 0.15 ? ` · ${t.speed} m/s` : ''}
              </text>
              <text x={tx} y={ty + 1.9} fontSize={0.55 * fs} fill="#9ca3af" textAnchor="middle">
                {t.method === 'triangulated' ? 'TRIANGULATED ' : 'ESTIMATED '}±{t.sigmaM} m{t.zone ? ` · ${t.zone.name}` : ''}
              </text>
            </g>
          );
        })}

        {showTruth && sim.actors.map((a, i) => (
          <g key={`gt${i}`} opacity="0.85">
            <circle cx={a.x} cy={H - a.y} r={0.35} fill="none" stroke="#a78bfa" strokeWidth="0.1" />
            <circle cx={a.x} cy={H - a.y} r={0.1} fill="#a78bfa" />
            <text x={a.x + 0.6} y={H - a.y + 0.25} fontSize={0.6 * fs} fill="#a78bfa">true {a.type.toLowerCase()}{a.moving ? '' : ' (still)'}</text>
          </g>
        ))}
      </svg>

      {!compact && !wall && (
        <div className="absolute left-2 bottom-2 text-[10px] text-terminal-muted bg-black/60 border border-terminal-border px-2 py-1 space-y-0.5">
          <div><span className="text-terminal-cyan">◢</span> radar beam · <span className="text-terminal-amber">○</span> probe energy · <span className="text-terminal-red">✚</span> target · <span className="text-terminal-green">◎</span> triangulated · <span className="text-terminal-violet">◌</span> ground truth</div>
          {editMap && !zoneDraft && <div className="text-terminal-amber">PLACE MODE: drag nodes</div>}
          {zoneDraft && <div className="text-terminal-amber">ZONE MODE: click vertices ({zoneDraft.points.length}) · finish in the panel</div>}
        </div>
      )}
      {hover && (editMap || zoneDraft) && <div className="absolute right-2 bottom-2 text-[10px] text-terminal-muted bg-black/60 border border-terminal-border px-2 py-0.5 tabular-nums">{hover.x.toFixed(1)}, {hover.y.toFixed(1)} m</div>}
    </div>
  );
};

export default SiteMap;
