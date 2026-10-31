import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import useStore from '../../store/useStore';
import SiteMap from '../map/SiteMap';
import StatusStrip from './StatusStrip';
import { alertHeadline, relTime } from '../../lib/format';
import { useNow } from '../../lib/hooks';

/** Full-screen display for a control-room wall: KPIs + live site map. Esc / W to leave. */
export const WallMode = () => {
  const setWallMode = useStore(s => s.setWallMode);
  const alerts = useStore(s => s.alerts);
  const profile = useStore(s => s.profile);
  useNow(5000);
  const active = alerts.filter(a => a.status === 'ACTIVE');
  return (
    <div className="fixed inset-0 z-[60] bg-terminal-black flex flex-col pt-safe pb-safe">
      <div className={`h-1 flex-shrink-0 ${active.length ? 'bg-terminal-red' : 'bg-transparent'}`} aria-hidden="true" />
      <div className="flex items-start gap-3 px-gutter lg:px-6 py-3 border-b border-terminal-border">
        <div className="flex-1 min-w-0"><StatusStrip showLastEvent={false} /></div>
        <button type="button" onClick={() => setWallMode(false)} aria-label="Exit wall display (Esc)" title="Exit wall display (Esc)"
          className="w-10 h-10 flex-shrink-0 inline-flex items-center justify-center rounded-lg border border-terminal-border text-terminal-muted hover:text-gray-100 hover:bg-white/5">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 relative min-h-0">
        <SiteMap wall />
        {profile && <div className="absolute left-4 top-4 rounded-lg border border-terminal-border bg-terminal-dark/90 px-3 py-1.5 text-xs text-gray-300">Mission: <span className="font-medium text-gray-100">{profile.name}</span></div>}
        {active.length > 0 && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 w-[min(90%,720px)] rounded-xl border border-terminal-red/40 bg-[#2a1215]/95 px-5 py-3 shadow-pop" role="alert">
            <div className="flex items-center gap-2 text-red-100 font-semibold text-lg">
              <AlertTriangle className="w-5 h-5 text-red-300 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{alertHeadline(active[0])} — {active[0].nodeName}</span>
            </div>
            <div className="text-red-200/80 text-sm mt-0.5 truncate">
              {active[0].severity.toLowerCase()} · {relTime(active[0].createdAt)}
              {active[0].zone ? ` · ${active[0].zone.name}` : ''}{active[0].position ? ` · range ${active[0].position.rangeM} m, bearing ${active[0].position.bearingDeg}°` : ''}
              {active.length > 1 ? ` · +${active.length - 1} more` : ''}
            </div>
            {active[0].narrative && <div className="text-gray-200 text-sm mt-2 leading-snug">{active[0].narrative}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default WallMode;
