import React from 'react';

export const Input = ({
  type = 'text',
  value,
  onChange,
  onKeyPress,
  placeholder,
  icon: Icon,
  className = '',
  inputClassName = '',
  disabled = false,
  ...props
}) => (
  <div className={`relative flex items-center bg-terminal-black border border-terminal-border rounded-lg focus-within:border-terminal-cyan/70 focus-within:ring-2 focus-within:ring-terminal-cyan/20 transition-colors ${className}`}>
    {Icon && <Icon className="w-4 h-4 text-terminal-muted ml-3 flex-shrink-0" aria-hidden="true" />}
    <input
      type={type}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyPress}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full min-w-0 flex-1 h-10 bg-transparent px-3 text-sm text-gray-100 placeholder-terminal-muted/70 focus:outline-none disabled:opacity-50 ${inputClassName}`}
      {...props}
    />
  </div>
);

/** Styled native <select>. */
export const Select = ({ className = '', children, ...props }) => (
  <select className={`h-10 lg:h-8 bg-terminal-black border border-terminal-border rounded-lg px-2.5 text-[13px] lg:text-xs text-gray-100 focus:border-terminal-cyan/70 focus:outline-none ${className}`} {...props}>
    {children}
  </select>
);

export default Input;
