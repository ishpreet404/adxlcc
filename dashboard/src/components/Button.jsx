import React from 'react';

const SIZES = {
  xs: 'h-8 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-10 lg:h-8 px-3 text-[13px] lg:text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg'
};

const VARIANTS = {
  primary: 'bg-terminal-blue text-white border border-transparent hover:bg-blue-500 active:bg-blue-600',
  success: 'bg-terminal-green/10 text-green-400 border border-terminal-green/30 hover:bg-terminal-green/20',
  warning: 'bg-terminal-amber/10 text-amber-400 border border-terminal-amber/30 hover:bg-terminal-amber/20',
  danger: 'bg-terminal-red/10 text-red-400 border border-terminal-red/30 hover:bg-terminal-red/20',
  outline: 'bg-terminal-surface text-gray-200 border border-terminal-border hover:bg-[#1b273a] hover:border-[#33445a]',
  ghost: 'bg-transparent text-terminal-muted border border-transparent hover:text-gray-100 hover:bg-white/5',
  selected: 'bg-terminal-blue/15 text-sky-300 border border-terminal-blue/40'
};

export const Button = ({
  children,
  onClick,
  disabled = false,
  variant = 'outline', // primary, success, warning, danger, outline, ghost, selected
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${SIZES[size] || SIZES.md} ${VARIANTS[variant] || VARIANTS.outline} ${className}`}
    {...props}
  >
    {children}
  </button>
);

/** Square icon-only button; `label` is required for screen readers and the tooltip. */
export const IconButton = ({ label, children, className = '', size = 'md', active = false, ...props }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={`inline-flex items-center justify-center rounded-lg border transition-colors ${size === 'sm' ? 'w-8 h-8' : 'w-10 h-10'} ${active ? 'bg-terminal-blue/15 text-sky-300 border-terminal-blue/40' : 'bg-transparent text-terminal-muted border-transparent hover:text-gray-100 hover:bg-white/5'} ${className}`}
    {...props}
  >
    {children}
  </button>
);

export default Button;
