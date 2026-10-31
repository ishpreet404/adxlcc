import React from 'react';
import { Cpu } from 'lucide-react';
import useStore from '../../store/useStore';
import { levelHex, batteryColor, rssiBars, kindHex, titleCase } from '../../lib/format';
import { Tag } from '../StatusBadge';
import { EmptyState } from '../ui/States';

/** Every node with live vibration/radar cues and tamper/loiter badges. */
export const NodeList = ({ onSelect }) => {
  const nodes = useStore(s => s.nodes);
  const alerts = useStore(s => s.alerts);
  const selectedId = useStore(s => s.selectedNodeId);
  const selectNode = useStore(s => s.selectNode);
  const loaded = useStore(s => s.loaded);
  const showSim = useStore(s => s.showSimulated);
  const list = Object.values(nodes).sort((a, b) => a.id.localeCompare(b.id));
  if (!list.length) {
    return (
      <EmptyState compact icon={Cpu} title={loaded ? 'No nodes yet' : 'Loading nodes…'}>
        {loaded ? (showSim ? 'Power a sensor node or start the simulator.' : 'Power a sensor node, or enable "Include simulated demo nodes".') : null}
      </EmptyState>
    );
  }
  return (
    <ul className="space-y-1.5">
      {list.map(n => {
        const t = n.latest;
        const lvl = n.fusion ? n.fusion.level : 'CLEAR';
        const tamper = t && t.tamper && t.tamper.flag;
        const loiter = alerts.some(a => a.kind === 'LOITER' && a.nodeId === n.id);
        const online = n.status === 'ONLINE';
        const color = !online ? '#5b6778' : tamper ? kindHex('TAMPER') : levelHex(lvl);
        const rmsA = t ? t.probes[0].rms : 0, rmsB = t ? t.probes[1].rms : 0;
        const sel = n.id === selectedId;
        return (
          <li key={n.id}>
            <button type="button" onClick={() => { selectNode(n.id); if (onSelect) onSelect(n.id); }} aria-pressed={sel}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${sel ? 'border-terminal-blue/50 bg-terminal-blue/[0.07]' : 'border-terminal-border hover:border-[#33445a] hover:bg-white/[0.02]'}`}>
              <div className="flex items-center justify-between gap-2 text-[13px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" />
                  <span className="font-medium text-gray-100 truncate">{n.name}</span>
                  {n.simulated && <Tag tone="violet">SIM</Tag>}
                  {t && t.mode === 'LIVE' && <Tag tone="cyan">LIVE</Tag>}
                  {tamper && <Tag tone="violet">TAMPER</Tag>}
                  {loiter && <Tag tone="amber">LOITER</Tag>}
                </div>
                <span className="text-[12px] font-medium flex-shrink-0" style={{ color }}>{online ? titleCase(lvl) : titleCase(n.status)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[11px] text-terminal-muted">
                <span className="num" style={{ color: t ? (t.battery.external ? '#38bdf8' : batteryColor(t.battery.percent)) : undefined }} title={t && t.battery.external ? 'External power' : 'Battery'}>{t ? (t.battery.external ? 'USB' : `${t.battery.percent}%`) : '—'}</span>
                <span className="flex items-end gap-px h-2.5" title={t ? `Signal ${t.rssi} dBm` : 'Signal'} aria-hidden="true">
                  {[1, 2, 3, 4].map(i => <span key={i} className="w-1 rounded-[1px]" style={{ height: `${i * 25}%`, background: t && i <= rssiBars(t.rssi) ? '#9ca3af' : '#243142' }} />)}
                </span>
                <span className={`num ${t && t.radar.presence ? 'text-red-300' : ''}`}>{t && t.radar.presence ? `Radar ${t.radar.distance.toFixed(1)} m` : 'Radar clear'}</span>
                <span className="flex-1 flex items-center gap-1.5 min-w-0" aria-label={`Probe A ${rmsA.toFixed(3)} g, probe B ${rmsB.toFixed(3)} g`}>
                  <span>A</span><span className="flex-1 h-1 rounded-full bg-terminal-black overflow-hidden"><span className="block h-full rounded-full bg-terminal-green" style={{ width: `${Math.min(100, rmsA * 400)}%` }} /></span>
                  <span>B</span><span className="flex-1 h-1 rounded-full bg-terminal-black overflow-hidden"><span className="block h-full rounded-full bg-terminal-amber" style={{ width: `${Math.min(100, rmsB * 400)}%` }} /></span>
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default NodeList;
