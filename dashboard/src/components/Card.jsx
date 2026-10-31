import React from 'react';

/**
 * Surface container. `title` may be a string or node; `icon` is a lucide component shown before it.
 * `flush` removes body padding (for tables / lists that run edge-to-edge).
 */
export const Card = ({ title, subtitle, icon: Icon, children, className = '', bodyClassName = '', headerAction = null, flush = false, id }) => (
  <section id={id} className={`bg-terminal-dark border border-terminal-border rounded-xl shadow-card flex flex-col min-w-0 overflow-hidden ${className}`}>
    {title && (
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-terminal-border bg-terminal-surface/40 flex-shrink-0 min-h-[48px]">
        <div className="min-w-0 flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-terminal-muted flex-shrink-0" aria-hidden="true" />}
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-gray-100 leading-tight truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-terminal-muted leading-tight mt-0.5 truncate">{subtitle}</p>}
          </div>
        </div>
        {headerAction && <div className="flex-shrink-0 flex items-center gap-1.5">{headerAction}</div>}
      </header>
    )}
    <div className={`${flush ? '' : 'p-4'} flex-1 flex flex-col min-w-0 ${bodyClassName}`}>{children}</div>
  </section>
);

export default Card;
