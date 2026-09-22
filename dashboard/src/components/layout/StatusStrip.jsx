import React from 'react';
import { Lock, Unlock, FlaskConical, Crosshair, Bell, BellOff, Send, Zap } from 'lucide-react';
import useStore from '../../store/useStore';
import { clock } from '../../lib/format';

/** One-glance site status: threat level, arming, nodes, tracks, alerts, notification channels, last event. */
export const StatusStrip = () => {
  const nodes = useStore(s => s.nodes);
  const tracks = useStore(s => s.tracks);
  const alerts = useStore(s => s.alerts);
  const arming = useStore(s => s.arming);
  const notify = useStore(s => s.notify);
  const events = useStore(s => s.events);
  const sim = useStore(s => s.sim);
  const list = Object.values(nodes);
  const online = list.filter(n => n.status === 'ONLINE').length;
  const maxP = list.reduce((m, n) => Math.max(m, n.fusion ? n.fusion.probability : 0), 0);
  const threat = maxP >= 0.88 ? ['CRITICAL', '#ff3344'] : maxP >= 0.7 ? ['HIGH', '#ff3344'] : maxP >= 0.5 ? ['ELEVATED', '#ffb000'] : maxP >= 0.3 ? ['GUARDED', '#00e5ff'] : ['LOW', '#00ff66'];
  const tampers = list.filter(n => n.latest && n.latest.tamper && n.latest.tamper.flag).length;
  const lowBat = list.filter(n => n.latest && n.latest.battery.low).length;
  const active = alerts.filter(a => a.status === 'ACTIVE').length;
  const ArmIcon = arming.mode === 'ARMED' ? Lock : arming.mode === 'TEST' ? FlaskConical : Unlock;
  const armColor = arming.mode === 'ARMED' ? '#ff3344' : arming.mode === 'TEST' ? '#ffb000' : '#00ff66';
  const last = events[0];
  const channels = [notify.telegram && 'telegram', notify.webhook && 'webhook', notify.siren && `siren ${notify.siren}`].filter(Boolean);

  const Tile = ({ label, value, color = '#e5e7eb', sub, icon: Icon }) => (
    <div className="flex-1 min-w-[120px] border border-terminal-border bg-terminal-dark px-3 py-1.5">
      <div className="text-[9px] text-terminal-muted tracking-wider flex items-center gap-1">{Icon && <Icon className="w-3 h-3" />}{label}</div>
      <div className="text-sm font-extrabold leading-tight tabular-nums" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-terminal-muted truncate">{sub}</div>}
    </div>
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Tile label="THREAT LEVEL" value={threat[0]} color={threat[1]} sub={`peak p = ${Math.round(maxP * 100)}%`} icon={Crosshair} />
      <Tile label="SITE" value={arming.mode} color={armColor} sub={arming.schedule.enabled ? `auto ${arming.schedule.armAt}–${arming.schedule.disarmAt}` : `by ${arming.by}`} icon={ArmIcon} />
      <Tile label="NODES" value={`${online} / ${list.length}`} color={online === list.length && list.length ? '#00ff66' : '#ffb000'} sub={`${tampers ? `${tampers} TAMPER · ` : ''}${lowBat ? `${lowBat} low battery` : 'batteries ok'}`} icon={Zap} />
      <Tile label="TRACKS" value={tracks.length} color={tracks.length ? '#ff3344' : '#e5e7eb'} sub={tracks[0] ? `${tracks[0].id} ${tracks[0].targetClass} ${tracks[0].speed ? tracks[0].speed + ' m/s' : ''}${tracks[0].running ? ' RUNNING' : ''}` : 'nothing tracked'} />
      <Tile label="ALERTS" value={active} color={active ? '#ff3344' : '#00ff66'} sub={alerts.length ? `${alerts.length} open` : 'perimeter secure'} icon={active ? Bell : BellOff} />
      <Tile label="NOTIFY" value={channels.length ? channels.join(' · ') : 'dashboard only'} color={channels.length ? '#00e5ff' : '#8b949e'} sub={sim.running ? `sim: ${sim.scenarioLabel}` : 'simulator off'} icon={Send} />
      <div className="flex-[2] min-w-[200px] border border-terminal-border bg-terminal-dark px-3 py-1.5">
        <div className="text-[9px] text-terminal-muted tracking-wider">LAST EVENT</div>
        <div className="text-[11px] truncate">{last ? <><span className="text-terminal-muted tabular-nums">{clock(last.t)}</span> <span className="text-terminal-cyan">{last.type}</span> {last.message}</> : '—'}</div>
      </div>
    </div>
  );
};

export default StatusStrip;
