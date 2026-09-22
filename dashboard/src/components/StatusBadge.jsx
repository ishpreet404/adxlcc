import React from 'react';

export const StatusBadge = ({ status = 'info', children, className = '' }) => {
  const styles = {
    ok: 'bg-terminal-green/10 text-terminal-green border-terminal-green',
    error: 'bg-terminal-red/10 text-terminal-red border-terminal-red',
    warning: 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber',
    info: 'bg-terminal-cyan/10 text-terminal-cyan border-terminal-cyan',
    offline: 'bg-gray-800 text-gray-400 border-gray-600'
  }[status] || 'bg-terminal-green/10 text-terminal-green border-terminal-green';

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 border text-xs font-mono font-bold tracking-wider uppercase rounded-none ${styles} ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      {children}
    </span>
  );
};

export default StatusBadge;
