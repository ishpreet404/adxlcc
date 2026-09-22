import React from 'react';

export const Separator = ({ variant = 'line', className = '' }) => {
  if (variant === 'equals') {
    return (
      <div className={`w-full my-3 border-t-2 border-b border-terminal-border/60 opacity-60 ${className}`} />
    );
  }

  if (variant === 'dots') {
    return (
      <div className={`w-full my-3 border-t border-dotted border-terminal-border/60 opacity-60 ${className}`} />
    );
  }

  return <hr className={`border-terminal-border my-4 opacity-50 ${className}`} />;
};

export default Separator;
