import React, { useEffect } from 'react';
import { Target, CircleAlert } from 'lucide-react';
import useStore from '../store/useStore';
import { EmptyState, Button } from '../components';
import { MissionCard } from '../components/mission/MissionCards';

const CardSkeleton = () => (
  <div className="rounded-xl border border-terminal-border bg-terminal-dark p-5 space-y-3" aria-hidden="true">
    <div className="flex gap-4"><div className="skeleton w-12 h-12 rounded-xl" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-1/2" /><div className="skeleton h-3 w-3/4" /></div></div>
    <div className="skeleton h-3 w-full" /><div className="skeleton h-3 w-5/6" /><div className="skeleton h-3 w-2/3" />
  </div>
);

/** Deployment use-case profiles: what the site protects decides alert wording and deterrent policy. */
export const Mission = () => {
  const profiles = useStore(s => s.profiles);
  const profile = useStore(s => s.profile);
  const status = useStore(s => s.profileStatus);
  const error = useStore(s => s.profileError);
  const busy = useStore(s => s.profileBusy);
  const load = useStore(s => s.loadProfile);
  const setProfile = useStore(s => s.setProfile);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-terminal-muted max-w-3xl">
        Choose what this deployment is protecting. The mission decides how detections are interpreted and titled, and whether a node sounds its siren or raises a silent alarm.
        The same sensor hardware serves every use case — only the profile changes.
      </p>

      {status === 'loading' && !profiles.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading mission profiles">{[0, 1, 2, 3].map(i => <CardSkeleton key={i} />)}</div>
      ) : status === 'error' && !profiles.length ? (
        <div className="rounded-xl border border-terminal-border bg-terminal-dark">
          <EmptyState icon={CircleAlert} tone="error" title="Mission profiles unavailable" action={<Button size="sm" variant="outline" onClick={load}>Retry</Button>}>
            {error || 'The server did not return any profiles.'}
          </EmptyState>
        </div>
      ) : !profiles.length ? (
        <div className="rounded-xl border border-terminal-border bg-terminal-dark">
          <EmptyState icon={Target} title="No mission profiles">The server has no deployment profiles configured.</EmptyState>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          {profiles.map(p => <MissionCard key={p.id} profile={p} active={!!profile && profile.id === p.id} busy={busy} onActivate={setProfile} />)}
        </div>
      )}
    </div>
  );
};

export default Mission;
