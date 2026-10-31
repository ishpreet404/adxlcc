import React from 'react';
import { AlertTriangle, ShieldAlert, X, Info, Timer, Target, CircleAlert } from 'lucide-react';
import useStore from '../../store/useStore';

const TONES = {
  INTRUSION: { bar: 'bg-terminal-red', icon: 'text-red-400' },
  TAMPER: { bar: 'bg-terminal-violet', icon: 'text-violet-300' },
  LOITER: { bar: 'bg-terminal-amber', icon: 'text-amber-400' },
  ERR: { bar: 'bg-terminal-red', icon: 'text-red-400' },
  MISSION: { bar: 'bg-terminal-blue', icon: 'text-sky-300' },
  default: { bar: 'bg-terminal-cyan', icon: 'text-sky-300' }
};
const ICONS = { INTRUSION: AlertTriangle, TAMPER: ShieldAlert, LOITER: Timer, ERR: CircleAlert, MISSION: Target, default: Info };

/** Transient notifications: bottom of the screen on mobile (above the tab bar), top-right on desktop. */
export const Toasts = () => {
  const toasts = useStore(s => s.toasts);
  const dismiss = useStore(s => s.dismissToast);
  const selectNode = useStore(s => s.selectNode);
  const setPage = useStore(s => s.setPage);
  if (!toasts.length) return null;
  return (
    <div className="fixed z-[55] left-4 right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-auto lg:left-auto lg:right-6 lg:top-20 lg:w-96 space-y-2 pointer-events-none" aria-live="polite" aria-relevant="additions">
      {toasts.map(t => {
        const Icon = ICONS[t.kind] || ICONS.default;
        const tone = TONES[t.kind] || TONES.default;
        return (
          <div key={t.id} role={t.kind === 'INTRUSION' || t.kind === 'TAMPER' ? 'alert' : 'status'}
            className={`pointer-events-auto relative overflow-hidden rounded-xl border border-terminal-border bg-terminal-dark/95 backdrop-blur shadow-pop animate-sheet-up ${t.test ? 'opacity-80' : ''}`}>
            <span className={`absolute left-0 inset-y-0 w-1 ${tone.bar}`} aria-hidden="true" />
            <div className="flex items-start gap-3 pl-4 pr-2 py-3">
              <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${tone.icon}`} aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-gray-100">{t.title}</div>
                {t.message && <div className="text-[12px] text-terminal-muted break-words mt-0.5">{t.message}</div>}
                {t.nodeId && (
                  <button type="button" className="mt-1.5 text-[12px] font-medium text-sky-300 hover:text-sky-200"
                    onClick={() => { selectNode(t.nodeId); setPage(t.alertId ? 'alerts' : 'nodes'); dismiss(t.id); }}>
                    {t.alertId ? 'View alert' : 'Inspect node'}
                  </button>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="w-8 h-8 flex-shrink-0 inline-flex items-center justify-center rounded-md text-terminal-muted hover:text-gray-100 hover:bg-white/5">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default Toasts;
