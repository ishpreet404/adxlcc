import React from 'react';
import { Lock, Unlock, FlaskConical, Crosshair, Bell, BellOff, Send, Cpu, Route, Activity } from 'lucide-react';
import useStore from '../../store/useStore';
import { clock, titleCase } from '../../lib/format';

const Tile = ({ label, value, color, sub, icon: Icon, alarm = false }) => (
  <div className={`rounded-xl border bg-terminal-dark px-4 py-3 min-w-0 shadow-card ${alarm ? 'border-terminal-red/40' : 'border-terminal-border'}`}>
    <div className="flex items-center gap-1.5 text-[12px] text-terminal-muted">
      {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}<span className="truncate">{label}</span>
    </div>
    <div className={`mt-1 flex items-center gap-2 text-lg font-semibold leading-tight min-w-0 ${alarm ? 'text-red-300' : 'text-gray-50'}`}>
      {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} aria-hidden="true" />}
      <span className="truncate">{value}</span>
    </div>
    {sub && <div className="text-[11px] text-terminal-muted truncate mt-0.5">{sub}</div>}
  </div>
);

/** One-glance site KPIs: threat level, arming, nodes, tracks, alerts, notification channels, last event. */
export const StatusStrip = ({ showLastEvent = true }) => {
  const nodes = useStore(s => s.nodes);
  const tracks = useStore(s => s.tracks);
  const alerts = useStore(s => s.alerts);
  const arming = useStore(s => s.arming);
  const notify = useStore(s => s.notify);
  const events = useStore(s => s.events);
  const list = Object.values(nodes);
  const online = list.filter(n => n.status === 'ONLINE').length;
  const maxP = list.reduce((m, n) => Math.max(m, n.fusion ? n.fusion.probability : 0), 0);
  const threat = maxP >= 0.88 ? ['Critical', '#d03b3b'] : maxP >= 0.7 ? ['High', '#ec835a'] : maxP >= 0.5 ? ['Elevated', '#fab219'] : maxP >= 0.3 ? ['Guarded', '#38bdf8'] : ['Low', '#22c55e'];
  const tampers = list.filter(n => n.latest && n.latest.tamper && n.latest.tamper.flag).length;
  const lowBat = list.filter(n => n.latest && n.latest.battery.low).length;
  const active = alerts.filter(a => a.status === 'ACTIVE').length;
  const ArmIcon = arming.mode === 'ARMED' ? Lock : arming.mode === 'TEST' ? FlaskConical : Unlock;
  const armColor = arming.mode === 'ARMED' ? '#ef4444' : arming.mode === 'TEST' ? '#f59e0b' : '#22c55e';
  const last = events[0];
  const channels = [notify.telegram && 'Telegram', notify.webhook && 'Webhook', notify.siren && 'Siren'].filter(Boolean);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
      <Tile label="Threat level" value={threat[0]} color={threat[1]} sub={`Peak probability ${Math.round(maxP * 100)}%`} icon={Crosshair} alarm={maxP >= 0.7} />
      <Tile label="Site" value={titleCase(arming.mode)} color={armColor} sub={arming.schedule.enabled ? `Auto ${arming.schedule.armAt}–${arming.schedule.disarmAt}` : arming.by ? `Set by ${arming.by}` : 'Manual'} icon={ArmIcon} />
      <Tile label="Nodes online" value={<span className="num">{online} / {list.length}</span>} color={list.length && online === list.length ? '#22c55e' : list.length ? '#f59e0b' : '#5b6778'} sub={`${tampers ? `${tampers} tampered · ` : ''}${lowBat ? `${lowBat} low battery` : 'Batteries OK'}`} icon={Cpu} alarm={tampers > 0} />
      <Tile label="Tracks" value={<span className="num">{tracks.length}</span>} sub={tracks[0] ? `${tracks[0].id} · ${titleCase(tracks[0].targetClass)}${tracks[0].speed ? ` · ${tracks[0].speed} m/s` : ''}` : 'Nothing tracked'} icon={Route} />
      <Tile label="Active alerts" value={<span className="num">{active}</span>} sub={alerts.length ? `${alerts.length} open` : 'Perimeter secure'} icon={active ? Bell : BellOff} alarm={active > 0} />
      <Tile label="Notifications" value={channels.length ? channels.join(', ') : 'In-app'} sub={channels.length ? 'Alerts are delivered' : 'No external channels'} icon={Send} />
      {showLastEvent && (
        <div className="col-span-full rounded-xl border border-terminal-border bg-terminal-dark px-4 py-2.5 min-w-0 flex items-center gap-2 text-[12px]">
          <Activity className="w-3.5 h-3.5 text-terminal-muted flex-shrink-0" aria-hidden="true" />
          <span className="text-terminal-muted flex-shrink-0">Last event</span>
          {last ? (
            <span className="min-w-0 truncate">
              <span className="num text-terminal-muted">{clock(last.t)}</span>
              <span className="text-sky-300 ml-2 font-medium">{titleCase(last.type)}</span>
              <span className="text-gray-300 ml-2">{last.message}</span>
            </span>
          ) : <span className="text-terminal-muted">—</span>}
        </div>
      )}
    </div>
  );
};

export default StatusStrip;
