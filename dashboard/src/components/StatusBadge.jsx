import React from 'react';

const STYLES = {
  ok: 'bg-terminal-green/10 text-green-400 ring-terminal-green/25',
  error: 'bg-terminal-red/10 text-red-400 ring-terminal-red/25',
  warning: 'bg-terminal-amber/10 text-amber-400 ring-terminal-amber/25',
  info: 'bg-terminal-cyan/10 text-sky-300 ring-terminal-cyan/25',
  violet: 'bg-terminal-violet/10 text-violet-300 ring-terminal-violet/25',
  offline: 'bg-white/5 text-gray-400 ring-white/10'
};

/** Small status pill. `dot` adds a leading state dot (pulsing when `pulse`). */
export const StatusBadge = ({ status = 'info', children, className = '', dot = true, pulse = false, title }) => (
  <span title={title} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 ring-inset text-[11px] font-medium leading-5 whitespace-nowrap ${STYLES[status] || STYLES.info} ${className}`}>
    {dot && <span className={`w-1.5 h-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />}
    {children}
  </span>
);

/** Neutral tag (e.g. SIM, TEST, LIVE). */
export const Tag = ({ children, tone = 'neutral', className = '', title }) => {
  const tones = {
    neutral: 'bg-white/5 text-gray-300 ring-white/10',
    violet: 'bg-terminal-violet/10 text-violet-300 ring-terminal-violet/30',
    amber: 'bg-terminal-amber/10 text-amber-300 ring-terminal-amber/30',
    cyan: 'bg-terminal-cyan/10 text-sky-300 ring-terminal-cyan/30',
    red: 'bg-terminal-red/10 text-red-300 ring-terminal-red/30',
    green: 'bg-terminal-green/10 text-green-300 ring-terminal-green/30'
  };
  return <span title={title} className={`inline-flex items-center gap-1 px-1.5 rounded ring-1 ring-inset text-[10px] font-semibold tracking-wide leading-[18px] whitespace-nowrap ${tones[tone] || tones.neutral} ${className}`}>{children}</span>;
};

export default StatusBadge;
