import React from 'react';
import { AlertTriangle, Check, X, ShieldCheck, ShieldAlert, Timer, Footprints, Car } from 'lucide-react';
import useStore from '../../store/useStore';
import { clock, severityBadge, compass, kindHex } from '../../lib/format';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../Button';

const KindIcon = ({ alert, className }) => {
  if (alert.kind === 'TAMPER') return <ShieldAlert className={className} />;
  if (alert.kind === 'LOITER') return <Timer className={className} />;
  if (alert.targetClass === 'VEHICLE') return <Car className={className} />;
  if (alert.kinematics && alert.kinematics.running) return <Footprints className={className} />;
  return <AlertTriangle className={className} />;
};

const headline = (a) => {
  if (a.kind === 'TAMPER') return `NODE TAMPER${a.tamper && a.tamper.impact ? ' (IMPACT)' : ''}`;
  if (a.kind === 'LOITER') return `LOITERING ${a.loiterS ? a.loiterS + 's' : ''}`;
  return `${a.targetClass} ${a.targetClass === 'VEHICLE' ? 'VEHICLE' : 'INTRUDER'}${a.kinematics && a.kinematics.running ? ' · RUNNING' : ''}`;
};

export const AlertCard = ({ alert, detailed = false, onReplay }) => {
  const acknowledge = useStore(s => s.acknowledge);
  const resolve = useStore(s => s.resolve);
  const dismiss = useStore(s => s.dismiss);
  const selectNode = useStore(s => s.selectNode);
  const open = alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED';
  const color = kindHex(alert.kind);
  const border = alert.status === 'ACTIVE' ? '' : alert.status === 'ACKNOWLEDGED' ? 'border-terminal-amber' : 'border-terminal-border';
  const k = alert.kinematics;
  return (
    <div className={`border p-2 text-[11px] ${border} ${alert.status === 'ACTIVE' ? 'bg-terminal-red/5' : ''} ${alert.test ? 'opacity-75' : ''}`} style={alert.status === 'ACTIVE' ? { borderColor: color } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={severityBadge(alert.severity)}>{alert.severity}</StatusBadge>
            {alert.test && <span className="text-[9px] px-1 border border-terminal-amber text-terminal-amber">TEST</span>}
            <span className="font-bold" style={{ color }}>{headline(alert)}</span>
            <span className="text-terminal-muted">{alert.id}</span>
          </div>
          <div className="mt-1">
            <button className="text-terminal-cyan hover:underline" onClick={() => selectNode(alert.nodeId)}>{alert.nodeName}</button>
            {alert.simulated && <span className="ml-1 text-terminal-violet">(sim)</span>}
            {alert.zone && <span className="ml-1" style={{ color: alert.zone.type === 'restricted' ? '#ff3344' : '#ffb000' }}>· {alert.zone.name} [{alert.zone.type}]</span>}
            <span className="text-terminal-muted"> · {clock(alert.createdAt)} · p={Math.round(alert.probability * 100)}% (peak {Math.round(alert.peakProbability * 100)}%) · {alert.samples} samples</span>
          </div>
          {alert.position && (
            <div className="text-terminal-muted">ESTIMATED POSITION ({alert.position.x}, {alert.position.y}) m · range {alert.position.rangeM} m · bearing {alert.position.bearingDeg}° · {alert.position.rangeSource}/{alert.position.bearingSource}</div>
          )}
          {k && (k.speed > 0.15 || k.eta) && (
            <div className="text-terminal-muted">
              {k.speed > 0.15 && <>moving {k.speed} m/s {compass(k.headingDeg)} ({k.headingDeg}°){k.running ? ' — RUNNING' : ''}</>}
              {k.eta && <> · heading for {k.eta.nodeName} in ~{k.eta.etaS}s</>}
              {k.method === 'triangulated' && <> · triangulated</>}
            </div>
          )}
          {detailed && alert.evidence && alert.evidence.length > 0 && (
            <ul className="mt-1 text-terminal-muted list-disc list-inside">
              {alert.evidence.slice(0, 4).map(e => <li key={e.key}>{e.label}: {e.value} ({e.contribution > 0 ? '+' : ''}{e.contribution})</li>)}
            </ul>
          )}
          <div className="text-terminal-muted mt-0.5">
            status <span className={alert.status === 'ACTIVE' ? 'text-terminal-red font-bold' : alert.status === 'ACKNOWLEDGED' ? 'text-terminal-amber' : 'text-terminal-green'}>{alert.status}</span>
            {alert.ackBy ? ` by ${alert.ackBy}` : ''}{alert.autoResolved ? ' (auto)' : ''}
          </div>
        </div>
        <KindIcon alert={alert} className={`w-5 h-5 flex-shrink-0 ${alert.status === 'ACTIVE' ? 'animate-pulse' : 'text-terminal-muted'}`} />
      </div>
      <div className="flex gap-1 mt-2 flex-wrap">
        {open && alert.status === 'ACTIVE' && <Button size="sm" variant="warning" onClick={() => acknowledge(alert.id)}><Check className="w-3 h-3 mr-1" />ACK</Button>}
        {open && <Button size="sm" variant="primary" onClick={() => resolve(alert.id)}><ShieldCheck className="w-3 h-3 mr-1" />RESOLVE</Button>}
        {open && <Button size="sm" variant="ghost" onClick={() => dismiss(alert.id)}><X className="w-3 h-3 mr-1" />FALSE ALARM</Button>}
        {onReplay && (alert.frameCount > 1 || alert.track.length > 1) && <Button size="sm" variant="outline" onClick={() => onReplay(alert)}>▶ REPLAY</Button>}
      </div>
    </div>
  );
};

export const AlertFeed = ({ limit = 6 }) => {
  const alerts = useStore(s => s.alerts);
  if (!alerts.length) {
    return (
      <div className="border border-terminal-green/40 p-3 text-[11px] flex items-center gap-2 text-terminal-green">
        <ShieldCheck className="w-4 h-4" /> Perimeter secure — no active alerts
      </div>
    );
  }
  return <div className="space-y-2">{alerts.slice(0, limit).map(a => <AlertCard key={a.id} alert={a} />)}</div>;
};

export default AlertFeed;
