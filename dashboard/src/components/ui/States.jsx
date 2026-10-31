import React from 'react';
import { LoaderCircle } from 'lucide-react';

/** Centered empty / unavailable state with optional action. */
export const EmptyState = ({ icon: Icon, title, children, action, tone = 'muted', compact = false, className = '' }) => (
  <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-5 px-3' : 'py-10 px-4'} ${className}`}>
    {Icon && (
      <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-3 ${tone === 'error' ? 'bg-terminal-red/10 text-red-400' : tone === 'ok' ? 'bg-terminal-green/10 text-green-400' : 'bg-white/5 text-terminal-muted'}`}>
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>
    )}
    {title && <div className="text-sm font-medium text-gray-200">{title}</div>}
    {children && <div className="text-[13px] text-terminal-muted mt-1 max-w-md leading-relaxed">{children}</div>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Spinner = ({ className = 'w-4 h-4' }) => <LoaderCircle className={`animate-spin ${className}`} aria-hidden="true" />;

/** Grey shimmer lines while content loads. */
export const SkeletonLines = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2 ${className}`} aria-busy="true" aria-label="Loading">
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-3" style={{ width: `${92 - ((i * 17) % 40)}%` }} />)}
  </div>
);
