import React from 'react';

export const Card = ({ title, children, className = '', headerAction = null }) => {
  return (
    <div className={`bg-terminal-dark border border-terminal-border rounded-none shadow-lg overflow-hidden flex flex-col h-full ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-terminal-surface border-b border-terminal-border font-mono text-xs uppercase tracking-wider text-terminal-muted flex-shrink-0">
          <span className="font-bold text-gray-200 tracking-wider truncate mr-2">{title}</span>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">{children}</div>
    </div>
  );
};

export default Card;
