import React from 'react';
import { Lock, Unlock, FlaskConical } from 'lucide-react';
import useStore from '../../store/useStore';

const MODES = [
  { id: 'ARMED', label: 'Armed', icon: Lock, on: 'bg-terminal-red/15 text-red-300 ring-1 ring-inset ring-terminal-red/40', hint: 'Alerts raise the siren and notifications' },
  { id: 'TEST', label: 'Test', icon: FlaskConical, on: 'bg-terminal-amber/15 text-amber-300 ring-1 ring-inset ring-terminal-amber/40', hint: 'Walk-test: alerts are flagged as test, no siren' },
  { id: 'DISARMED', label: 'Disarmed', icon: Unlock, on: 'bg-terminal-green/15 text-green-300 ring-1 ring-inset ring-terminal-green/40', hint: 'Detections are logged only (tamper still alerts)' }
];

/** ARMED / TEST / DISARMED segmented control. `compact` = icons only (mobile header). */
export const ArmingControl = ({ compact = false, full = false }) => {
  const mode = useStore(s => s.arming.mode);
  const setArming = useStore(s => s.setArming);
  return (
    <div role="radiogroup" aria-label="Site arming mode" className={`inline-flex p-0.5 gap-0.5 rounded-lg bg-terminal-black border border-terminal-border ${full ? 'w-full' : ''}`}>
      {MODES.map(m => {
        const Icon = m.icon;
        const on = mode === m.id;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${m.label}: ${m.hint}`}
            title={`${m.label} — ${m.hint}`}
            onClick={() => !on && setArming(m.id)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ${full ? 'flex-1' : ''} ${compact ? 'w-10 h-9' : 'h-8 px-3 text-xs'} ${on ? m.on : 'text-terminal-muted hover:text-gray-100 hover:bg-white/5'}`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            {!compact && <span>{m.label}</span>}
          </button>
        );
      })}
    </div>
  );
};

export default ArmingControl;
