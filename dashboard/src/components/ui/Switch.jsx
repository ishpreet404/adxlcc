import React from 'react';

/** Accessible on/off switch with a visible label. */
export const Switch = ({ checked, onChange, label, description, id, className = '' }) => {
  const sid = id || `sw-${String(label).replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <label htmlFor={sid} className="min-w-0 cursor-pointer">
        <div className="text-[13px] text-gray-200 font-medium leading-snug">{label}</div>
        {description && <div className="text-[11px] text-terminal-muted leading-snug mt-0.5">{description}</div>}
      </label>
      <button
        id={sid}
        type="button"
        role="switch"
        aria-checked={!!checked}
        onClick={() => onChange(!checked)}
        className={`relative flex-shrink-0 w-11 h-6 rounded-full border transition-colors mt-0.5 ${checked ? 'bg-terminal-blue border-terminal-blue' : 'bg-terminal-surface border-terminal-border'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
};

export default Switch;
