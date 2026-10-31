import React, { useState } from 'react';
import { Download, Share, ChevronRight, Info } from 'lucide-react';
import useStore from '../../store/useStore';
import { useInstall } from '../../lib/pwa';
import { Switch } from '../ui/Switch';
import { profileIcon, profileAccent } from '../mission/profileMeta';

/** Server link + node availability. */
export const ConnectionStatus = ({ className = '' }) => {
  const connected = useStore(s => s.connected);
  const nodes = useStore(s => s.nodes);
  const list = Object.values(nodes);
  const online = list.filter(n => n.status === 'ONLINE').length;
  return (
    <div className={`flex items-center gap-2.5 text-xs ${className}`} role="status" aria-live="polite">
      <span className="relative flex w-2.5 h-2.5 flex-shrink-0">
        {connected && <span className="absolute inset-0 rounded-full bg-terminal-green/60 animate-ping" style={{ animationDuration: '2.4s' }} />}
        <span className={`relative w-2.5 h-2.5 rounded-full ${connected ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
      </span>
      <div className="min-w-0">
        <div className={`font-medium ${connected ? 'text-gray-200' : 'text-red-300'}`}>{connected ? 'Connected' : 'Reconnecting…'}</div>
        <div className="text-terminal-muted text-[11px]"><span className="num">{online}/{list.length}</span> nodes online</div>
      </div>
    </div>
  );
};

/** Active mission profile pill; click opens the Mission page. */
export const MissionBadge = ({ onClick, className = '' }) => {
  const profile = useStore(s => s.profile);
  const status = useStore(s => s.profileStatus);
  const Icon = profileIcon(profile);
  const accent = profileAccent(profile);
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-2.5 rounded-lg border border-terminal-border bg-terminal-dark px-2.5 py-2 text-left hover:border-[#33445a] transition-colors ${className}`}
      aria-label={profile ? `Active mission: ${profile.name}. Open mission settings` : 'Choose a mission profile'}>
      <span className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ring-1 ring-inset ${accent.bg} ${accent.ring} ${accent.text}`}>
        <Icon className="w-4 h-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-terminal-muted leading-tight">Active mission</span>
        <span className="block text-[13px] font-medium text-gray-100 truncate leading-tight mt-0.5">
          {profile ? profile.name : status === 'loading' || status === 'idle' ? 'Loading…' : 'Not set'}
        </span>
      </span>
      <ChevronRight className="w-4 h-4 text-terminal-muted flex-shrink-0" aria-hidden="true" />
    </button>
  );
};

/** "Include simulated demo nodes" switch (persists in localStorage). */
export const SimToggle = ({ className = '', description = true }) => {
  const show = useStore(s => s.showSimulated);
  const setShow = useStore(s => s.setShowSimulated);
  return (
    <Switch className={className} checked={show} onChange={setShow} id="toggle-sim"
      label="Include simulated demo nodes"
      description={description ? 'Show simulator nodes and alerts, marked SIM.' : undefined} />
  );
};

/** Install-as-app button: native prompt when available, otherwise platform instructions. */
export const InstallButton = ({ className = '' }) => {
  const { standalone, canPrompt, ios, promptInstall } = useInstall();
  const [hint, setHint] = useState(false);
  if (standalone) return null;
  const onClick = async () => {
    if (canPrompt) { await promptInstall(); return; }
    setHint(h => !h);
  };
  return (
    <div className={className}>
      <button type="button" onClick={onClick} aria-expanded={!canPrompt ? hint : undefined}
        className="w-full h-10 lg:h-9 inline-flex items-center justify-center gap-2 rounded-lg border border-terminal-border bg-terminal-surface text-[13px] font-medium text-gray-200 hover:bg-[#1b273a] transition-colors">
        <Download className="w-4 h-4" aria-hidden="true" /> Install app
      </button>
      {hint && !canPrompt && (
        <div className="mt-2 rounded-lg border border-terminal-border bg-terminal-black px-3 py-2 text-[12px] text-gray-300 flex gap-2 animate-fade-in" role="note">
          {ios ? <Share className="w-4 h-4 text-sky-300 flex-shrink-0 mt-0.5" aria-hidden="true" /> : <Info className="w-4 h-4 text-sky-300 flex-shrink-0 mt-0.5" aria-hidden="true" />}
          <span>
            {ios
              ? <>In Safari tap <b>Share</b> → <b>Add to Home Screen</b>.</>
              : <>Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>. (Chrome offers one-tap install when the dashboard is served over HTTPS.)</>}
          </span>
        </div>
      )}
    </div>
  );
};
