import React from 'react';

/** Brand mark: shield with radar arcs (same geometry as the app icons). */
export const LogoMark = ({ className = 'w-8 h-8' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect x="0" y="0" width="24" height="24" rx="6" fill="#0f1a14" />
    <g transform="translate(2.4 2.2) scale(0.8)">
      <path d="M12 2.4c1.9 1.6 4.6 2.6 7.6 2.6v7.4c0 5.2-3.5 8.2-7.6 9.7-4.1-1.5-7.6-4.5-7.6-9.7V5c3 0 5.7-1 7.6-2.6z" fill="#10261b" stroke="#22c55e" strokeWidth="1.6" strokeLinejoin="round" />
      <g fill="none" stroke="#22c55e" strokeWidth="1.35" strokeLinecap="round">
        <path d="M9.95 13.55A2.9 2.9 0 0 1 14.05 13.55" />
        <path d="M8.25 11.85A5.3 5.3 0 0 1 15.75 11.85" />
        <path d="M6.63 10.23A7.6 7.6 0 0 1 17.37 10.23" />
      </g>
      <circle cx="12" cy="15.6" r="1.35" fill="#f0fdf4" />
    </g>
  </svg>
);

export default LogoMark;
