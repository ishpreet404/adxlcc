import React, { useState } from 'react';
import { AlertTriangle, Check, X, ShieldCheck, ShieldAlert, Timer, Footprints, Car, Sparkles, Siren, Play, Fingerprint, Copy, MapPin } from 'lucide-react';
import useStore from '../../store/useStore';
import { severityBadge, severityHex, compass, kindHex, zoneHex, titleCase, relTime, alertHeadline } from '../../lib/format';
import { copyText } from '../../lib/clipboard';
import { StatusBadge, Tag } from '../StatusBadge';
import { Button } from '../Button';
import { EmptyState, Spinner } from '../ui/States';

const HASH_TIP = 'SHA-256 of the sensor evidence (tamper-evident, stored in TigerData)';

const KindIcon = ({ alert, className }) => {
  if (alert.kind === 'TAMPER') return <ShieldAlert className={className} aria-hidden="true" />;
  if (alert.kind === 'LOITER') return <Timer className={className} aria-hidden="true" />;
  if (alert.targetClass === 'VEHICLE') return <Car className={className} aria-hidden="true" />;
  if (alert.kinematics && alert.kinematics.running) return <Footprints className={className} aria-hidden="true" />;
  return <AlertTriangle className={className} aria-hidden="true" />;
};

const statusTone = (s) => ({ ACTIVE: 'error', ACKNOWLEDGED: 'warning', RESOLVED: 'ok', DISMISSED: 'offline' }[s] || 'info');

/** The AI narrative attached to an alert (Gemini, or the server's template fallback). */
const Narrative = ({ alert }) => {
  if (alert.narrative) {
    const fallback = alert.narrativeSource === 'template';
    return (
      <div className={`rounded-lg border px-3 py-2.5 ${fallback ? 'border-terminal-border bg-white/[0.02]' : 'border-terminal-violet/25 bg-terminal-violet/[0.06]'}`}>
        <div className="flex items-center gap-1.5 text-[11px]">
          <Sparkles className={`w-3.5 h-3.5 ${fallback ? 'text-terminal-muted' : 'text-violet-300'}`} aria-hidden="true" />
          <span className={`font-semibold ${fallback ? 'text-gray-300' : 'text-violet-300'}`}>{fallback ? 'Fallback' : 'Gemini'}</span>
          <span className="text-terminal-muted">{fallback ? '· template summary (Gemini unavailable)' : '· AI incident summary'}</span>
        </div>
        <p className="text-[13px] text-gray-200 leading-relaxed mt-1">{alert.narrative}</p>
      </div>
    );
  }
  const pending = !alert.test && !alert.simulated && alert.status === 'ACTIVE' && Date.now() - (alert.createdAt || 0) < 25000;
  if (!pending) return null;
  return (
    <div className="rounded-lg border border-dashed border-terminal-violet/25 px-3 py-2 text-[12px] text-terminal-muted flex items-center gap-2">
      <Spinner className="w-3.5 h-3.5 text-violet-300" /> Gemini is writing an incident summary…
    </div>
  );
};

const EvidenceHash = ({ hash }) => {
  const [copied, setCopied] = useState(false);
  const toast = useStore(s => s.toast);
  const copy = async () => {
    const ok = await copyText(hash);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
    else toast({ kind: 'ERR', severity: 'LOW', title: 'Copy failed', message: hash, ttl: 8000 });
  };
  return (
    <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-terminal-muted" title={HASH_TIP}>
      <Fingerprint className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span className="flex-shrink-0">Evidence</span>
      <code className="num text-gray-300 truncate" aria-label={`Evidence hash ${hash}`}>{hash.slice(0, 12)}…{hash.slice(-6)}</code>
      <button type="button" onClick={copy} aria-label="Copy evidence hash (SHA-256 of the sensor evidence, stored in TigerData)" title={HASH_TIP}
        className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-md hover:bg-white/5 hover:text-gray-100">
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
};

export const AlertCard = ({ alert, detailed = false, onReplay }) => {
  const acknowledge = useStore(s => s.acknowledge);
  const resolve = useStore(s => s.resolve);
  const dismiss = useStore(s => s.dismiss);
  const command = useStore(s => s.command);
  const selectNode = useStore(s => s.selectNode);
  const setPage = useStore(s => s.setPage);
  const open = alert.status === 'ACTIVE' || alert.status === 'ACKNOWLEDGED';
  const kc = kindHex(alert.kind);
  const k = alert.kinematics;
  const pos = alert.position;
  const canReplay = onReplay && ((alert.frameCount || 0) > 1 || (alert.track && alert.track.length > 1));
  return (
    <article className={`relative rounded-xl border bg-terminal-dark overflow-hidden shadow-card ${alert.status === 'ACTIVE' ? 'border-terminal-red/35' : 'border-terminal-border'} ${alert.test ? 'opacity-80' : ''}`}
      aria-label={`${titleCase(alert.severity)} alert: ${alertHeadline(alert)} at ${alert.nodeName}`}>
      <span className="absolute left-0 inset-y-0 w-1" style={{ background: severityHex(alert.severity) }} aria-hidden="true" />
      <div className="pl-4 pr-3 sm:pr-4 py-3 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${kc}1f`, color: kc }}>
            <KindIcon alert={alert} className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <StatusBadge status={severityBadge(alert.severity)} pulse={alert.status === 'ACTIVE'}>{titleCase(alert.severity)}</StatusBadge>
              <StatusBadge status={statusTone(alert.status)} dot={false}>{titleCase(alert.status)}{alert.autoResolved ? ' (auto)' : ''}</StatusBadge>
              {alert.test && <Tag tone="amber" title="Raised in TEST mode: no siren, no notifications">TEST</Tag>}
              {alert.simulated && <Tag tone="violet" title="From a simulated demo node">SIM</Tag>}
              <time className="ml-auto text-[11px] text-terminal-muted whitespace-nowrap" dateTime={new Date(alert.createdAt).toISOString()} title={new Date(alert.createdAt).toLocaleString()}>{relTime(alert.createdAt)}</time>
            </div>
            <h3 className="mt-1.5 text-[14px] font-semibold text-gray-50 leading-snug">{alertHeadline(alert)}</h3>
            {alert.interpretation && alert.interpretation.detail && <p className="text-[12px] text-gray-300 mt-0.5">{alert.interpretation.detail}</p>}
            <div className="text-[12px] text-terminal-muted mt-0.5 leading-relaxed">
              <button type="button" className="text-sky-300 hover:text-sky-200 font-medium" onClick={() => { selectNode(alert.nodeId); setPage('nodes'); }}>{alert.nodeName}</button>
              {alert.zone && <> · <span style={{ color: zoneHex(alert.zone.type) }}>{alert.zone.name}</span> ({alert.zone.type})</>}
              {' · '}probability <span className="num text-gray-300">{Math.round(alert.probability * 100)}%</span>
              {' '}(peak <span className="num">{Math.round(alert.peakProbability * 100)}%</span>)
              {alert.samples ? <> · <span className="num">{alert.samples}</span> samples</> : null}
            </div>
          </div>
        </div>

        <Narrative alert={alert} />

        {(pos || (k && (k.speed > 0.15 || k.eta))) && (
          <div className="text-[12px] text-terminal-muted space-y-0.5">
            {pos && (
              <div className="flex gap-1.5"><MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>Position <span className="num text-gray-300">({pos.x}, {pos.y}) m</span> · range <span className="num text-gray-300">{pos.rangeM} m</span> · bearing <span className="num text-gray-300">{pos.bearingDeg}°</span> <span className="opacity-70">({pos.rangeSource}/{pos.bearingSource})</span></span>
              </div>
            )}
            {k && (k.speed > 0.15 || k.eta) && (
              <div className="pl-5">
                {k.speed > 0.15 && <>Moving <span className="num text-gray-300">{k.speed} m/s</span> {compass(k.headingDeg)} ({k.headingDeg}°){k.running ? ' — running' : ''}</>}
                {k.eta && <> · heading for {k.eta.nodeName} in ~<span className="num">{k.eta.etaS}</span> s</>}
                {k.method === 'triangulated' && <> · triangulated</>}
              </div>
            )}
          </div>
        )}

        {detailed && alert.evidence && alert.evidence.length > 0 && (
          <ul className="text-[12px] text-terminal-muted space-y-0.5">
            {alert.evidence.slice(0, 4).map(e => (
              <li key={e.key} className="flex gap-2"><span className="flex-1 min-w-0 truncate">{e.label}: <span className="text-gray-300">{e.value}</span></span><span className={`num ${e.contribution > 0 ? 'text-red-300' : 'text-green-300'}`}>{e.contribution > 0 ? '+' : ''}{e.contribution}</span></li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-terminal-muted">
          {alert.evidenceHash && <EvidenceHash hash={alert.evidenceHash} />}
          <span className="num">{alert.id}</span>
          {alert.ackBy && <span>Acknowledged by {alert.ackBy}</span>}
        </div>

        {(open || canReplay) && (
          <div className="flex gap-2 flex-wrap pt-0.5">
            {alert.status === 'ACTIVE' && <Button size="sm" variant="warning" onClick={() => acknowledge(alert.id)}><Check className="w-3.5 h-3.5" aria-hidden="true" />Ack</Button>}
            {open && <Button size="sm" variant="success" onClick={() => resolve(alert.id)}><ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />Resolve</Button>}
            {open && <Button size="sm" variant="ghost" onClick={() => dismiss(alert.id)}><X className="w-3.5 h-3.5" aria-hidden="true" />False alarm</Button>}
            {open && !alert.simulated && (
              <Button size="sm" variant="danger" onClick={() => command(alert.nodeId, { deter: 10 })} title="Sound the siren on the node for 10 seconds">
                <Siren className="w-3.5 h-3.5" aria-hidden="true" />Sound alarm
              </Button>
            )}
            {canReplay && <Button size="sm" variant="outline" onClick={() => onReplay(alert)}><Play className="w-3.5 h-3.5" aria-hidden="true" />Replay</Button>}
          </div>
        )}
      </div>
    </article>
  );
};

export const AlertFeed = ({ limit = 6 }) => {
  const alerts = useStore(s => s.alerts);
  const loaded = useStore(s => s.loaded);
  if (!alerts.length) {
    return (
      <EmptyState compact icon={ShieldCheck} tone="ok" title={loaded ? 'Perimeter secure' : 'Loading alerts…'}>
        {loaded ? 'No active alerts right now.' : null}
      </EmptyState>
    );
  }
  return <div className="space-y-3">{alerts.slice(0, limit).map(a => <AlertCard key={a.id} alert={a} />)}</div>;
};

export default AlertFeed;
