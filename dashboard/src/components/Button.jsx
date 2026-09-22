import React from 'react';

export const Button = ({
  children,
  onClick,
  disabled = false,
  variant = 'primary', // primary, warning, danger, outline, ghost
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) => {
  const baseClasses = 'font-mono uppercase font-bold tracking-wider transition-all duration-150 flex items-center justify-center select-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base'
  }[size] || 'px-4 py-2 text-sm';

  const variantClasses = {
    primary: 'bg-terminal-green/10 text-terminal-green border border-terminal-green hover:bg-terminal-green/20 active:bg-terminal-green/30',
    warning: 'bg-terminal-amber/10 text-terminal-amber border border-terminal-amber hover:bg-terminal-amber/20 active:bg-terminal-amber/30',
    danger: 'bg-terminal-red/10 text-terminal-red border border-terminal-red hover:bg-terminal-red/20 active:bg-terminal-red/30',
    outline: 'bg-transparent text-gray-300 border border-terminal-border hover:border-gray-400 hover:text-white',
    ghost: 'bg-transparent text-terminal-muted hover:text-white hover:bg-white/5'
  }[variant] || 'bg-terminal-green/10 text-terminal-green border border-terminal-green';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
