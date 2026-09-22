import React from 'react';
import useStore from '../../store/useStore';
import { levelHex, batteryColor, rssiBars, kindHex } from '../../lib/format';

/** Compact grid of every node with live vibration/radar cues and tamper/loiter badges. */
export const NodeList = () => {
  const nodes = useStore(s => s.nodes);
  const alerts = useStore(s => s.alerts);
  const selectedId = useStore(s => s.selectedNodeId);
  const selectNode = useStore(s => s.selectNode);
  const list = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) return <div className="text-[11px] text-terminal-muted p-2">No nodes yet. Power a node or start the simulator in SETUP.</div>;
  return (
    <div className="space-y-1">
      {list.map(n => {
        const t = n.latest;
        const lvl = n.fusion ? n.fusion.level : 'CLEAR';
        const tamper = t && t.tamper && t.tamper.flag;
        const loiter = alerts.some(a => a.kind === 'LOITER' && a.nodeId === n.id);
        const color = n.status !== 'ONLINE' ? '#6b7280' : tamper ? kindHex('TAMPER') : levelHex(lvl);
        const rmsA = t ? t.probes[0].rms : 0, rmsB = t ? t.probes[1].rms : 0;
        const sel = n.id === selectedId;
        return (
          <button key={n.id} onClick={() => selectNode(n.id)}
            className={`w-full text-left border px-2 py-1.5 transition-colors ${sel ? 'border-terminal-green bg-terminal-green/5' : 'border-terminal-border hover:border-gray-500'}`}>
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 flex-shrink-0" style={{ background: color, boxShadow: lvl === 'INTRUSION' || tamper ? `0 0 6px ${color}` : 'none' }} />
                <span className="font-bold truncate">{n.name}</span>
                {n.simulated && <span className="text-[9px] px-1 border border-terminal-violet text-terminal-violet">SIM</span>}
                {t && t.mode === 'LIVE' && <span className="text-[9px] px-1 border border-terminal-cyan text-terminal-cyan">LIVE</span>}
                {tamper && <span className="text-[9px] px-1 bg-terminal-violet text-black font-bold">TAMPER</span>}
                {loiter && <span className="text-[9px] px-1 bg-terminal-amber text-black font-bold">LOITER</span>}
              </div>
              <span className="text-[10px] font-bold" style={{ color }}>{n.status === 'ONLINE' ? lvl : n.status}</span>
            </div>
            <div className="flex items-center gap-2 mt-1 text-[9px] text-terminal-muted">
              <span className="tabular-nums" style={{ color: t ? batteryColor(t.battery.percent) : undefined }}>{t ? `${t.battery.percent}%` : '—'}</span>
              <span className="flex items-end gap-px h-2.5">{[1, 2, 3, 4].map(i => <span key={i} className="w-1" style={{ height: `${i * 25}%`, background: t && i <= rssiBars(t.rssi) ? '#9ca3af' : '#1f2937' }} />)}</span>
              <span className={t && t.radar.presence ? 'text-terminal-red' : ''}>{t && t.radar.presence ? `R ${t.radar.distance.toFixed(1)}m` : 'R —'}</span>
              <span className="flex-1 flex items-center gap-1">
                <span className="text-terminal-green">A</span><span className="flex-1 h-1 bg-terminal-black border border-terminal-border"><span className="block h-full bg-terminal-green" style={{ width: `${Math.min(100, rmsA * 400)}%` }} /></span>
                <span className="text-terminal-amber">B</span><span className="flex-1 h-1 bg-terminal-black border border-terminal-border"><span className="block h-full bg-terminal-amber" style={{ width: `${Math.min(100, rmsB * 400)}%` }} /></span>
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default NodeList;
