import React from 'react';
import { Check, CheckCircle2, Volume2, BellOff, Clock3, ChevronRight, Lightbulb } from 'lucide-react';
import useStore from '../../store/useStore';
import { Button } from '../Button';
import { StatusBadge } from '../StatusBadge';
import { Spinner } from '../ui/States';
import { profileIcon, profileAccent, deterrentLabel } from './profileMeta';
import { titleCase } from '../../lib/format';

const targetLabel = (t) => (typeof t === 'string' ? titleCase(t) : (t && (t.label || t.name || t.id)) || '');

/** Deterrent policy pill: audible siren vs silent alarm. */
export const DeterrentBadge = ({ profile, className = '' }) => {
  const silent = profile.deterrent === 'silent';
  const Icon = silent ? BellOff : Volume2;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium ring-1 ring-inset ${silent ? 'bg-terminal-cyan/10 text-sky-300 ring-terminal-cyan/25' : 'bg-terminal-amber/10 text-amber-300 ring-terminal-amber/25'} ${className}`}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {deterrentLabel(profile)}{!silent && profile.deterrentSeconds ? ` · ${profile.deterrentSeconds} s` : ''}
    </span>
  );
};

export const MissionCard = ({ profile, active, busy, onActivate }) => {
  const Icon = profileIcon(profile);
  const accent = profileAccent(profile);
  const detects = Array.isArray(profile.detects) ? profile.detects : [];
  const targets = Array.isArray(profile.targets) ? profile.targets.map(targetLabel).filter(Boolean) : [];
  const labels = profile.labels && typeof profile.labels === 'object' ? Object.entries(profile.labels) : [];
  return (
    <article className={`relative rounded-xl border bg-terminal-dark shadow-card flex flex-col min-w-0 transition-colors ${active ? '' : 'border-terminal-border'}`}
      style={active ? { borderColor: accent.hex, boxShadow: `0 0 0 1px ${accent.hex}` } : undefined}
      aria-label={`${profile.name}${active ? ' (active mission)' : ''}`}>
      <div className="p-5 flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl ring-1 ring-inset flex items-center justify-center flex-shrink-0 ${accent.bg} ${accent.ring} ${accent.text}`}>
          <Icon className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[16px] font-semibold text-gray-50 leading-tight">{profile.name}</h3>
            {active && <StatusBadge status="ok">Active</StatusBadge>}
          </div>
          {profile.tagline && <p className="text-[13px] text-gray-300 mt-1 leading-snug">{profile.tagline}</p>}
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4 flex-1">
        {(profile.why || profile.description) && (
          <div className="flex gap-2.5 text-[13px] text-terminal-muted leading-relaxed">
            <Lightbulb className="w-4 h-4 flex-shrink-0 mt-0.5 text-terminal-muted" aria-hidden="true" />
            <p>{profile.why || profile.description}</p>
          </div>
        )}
        {profile.why && profile.description && <p className="text-[13px] text-gray-400 leading-relaxed">{profile.description}</p>}

        {detects.length > 0 && (
          <div>
            <h4 className="text-[12px] font-medium text-gray-400 mb-1.5">What it detects</h4>
            <ul className="space-y-1">
              {detects.map((d, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-gray-200 leading-snug"><Check className="w-4 h-4 flex-shrink-0 mt-px" style={{ color: accent.hex }} aria-hidden="true" />{d}</li>
              ))}
            </ul>
          </div>
        )}

        {targets.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Target classes">
            {targets.map(t => <span key={t} className="rounded-full border border-terminal-border px-2 py-0.5 text-[11px] text-gray-300">{t}</span>)}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <DeterrentBadge profile={profile} />
          {profile.arming && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-terminal-muted"><Clock3 className="w-3.5 h-3.5" aria-hidden="true" />{profile.arming}</span>
          )}
        </div>

        {labels.length > 0 && (
          <details className="group rounded-lg border border-terminal-border">
            <summary className="cursor-pointer select-none list-none px-3 py-2 text-[12px] text-terminal-muted flex items-center gap-1.5 hover:text-gray-200">
              <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" aria-hidden="true" /> How alerts are titled
            </summary>
            <dl className="px-3 pb-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
              {labels.map(([cls, title]) => (
                <React.Fragment key={cls}>
                  <dt className="text-terminal-muted">{titleCase(cls)}</dt>
                  <dd className="text-gray-200">{title}</dd>
                </React.Fragment>
              ))}
            </dl>
          </details>
        )}
      </div>

      <footer className="px-5 py-3.5 border-t border-terminal-border flex items-center justify-between gap-3">
        {active
          ? <span className="text-[13px] text-green-300 inline-flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Active mission</span>
          : <span className="text-[12px] text-terminal-muted">Changes alert wording and deterrent policy</span>}
        <Button size="sm" variant={active ? 'outline' : 'primary'} disabled={active || !!busy} onClick={() => onActivate(profile.id)} aria-label={active ? `${profile.name} is active` : `Activate ${profile.name}`}>
          {busy === profile.id && <Spinner className="w-3.5 h-3.5" />}{active ? 'Active' : 'Activate'}
        </Button>
      </footer>
    </article>
  );
};

/** Slim "active mission" banner for the Overview page. */
export const MissionBanner = () => {
  const profile = useStore(s => s.profile);
  const status = useStore(s => s.profileStatus);
  const profiles = useStore(s => s.profiles);
  const setPage = useStore(s => s.setPage);
  if (!profile) {
    if (status !== 'ready' || !profiles.length) return null;
    return (
      <button type="button" onClick={() => setPage('mission')} className="w-full rounded-xl border border-dashed border-terminal-border px-4 py-3 text-left text-[13px] text-terminal-muted hover:text-gray-200 hover:border-[#33445a]">
        No mission selected — choose a deployment profile <ChevronRight className="inline w-4 h-4" aria-hidden="true" />
      </button>
    );
  }
  const Icon = profileIcon(profile);
  const accent = profileAccent(profile);
  return (
    <div className="rounded-xl border bg-terminal-dark px-3 sm:px-4 py-2.5 flex items-center gap-3 shadow-card min-w-0" style={{ borderColor: `${accent.hex}55` }}>
      <span className={`w-9 h-9 rounded-lg ring-1 ring-inset flex items-center justify-center flex-shrink-0 ${accent.bg} ${accent.ring} ${accent.text}`}>
        <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-terminal-muted leading-tight">Active mission</div>
        <div className="text-[14px] font-semibold text-gray-50 truncate leading-tight mt-0.5">
          {profile.name}{profile.tagline && <span className="font-normal text-terminal-muted hidden md:inline"> · {profile.tagline}</span>}
        </div>
      </div>
      <DeterrentBadge profile={profile} className="hidden sm:inline-flex" />
      <Button size="sm" variant="ghost" onClick={() => setPage('mission')} aria-label="Change mission profile">Change</Button>
    </div>
  );
};
