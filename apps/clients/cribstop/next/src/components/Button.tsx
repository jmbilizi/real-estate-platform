'use client';

import React, { ReactNode } from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'gradient';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  isLoading?: boolean;
}

/**
 * Button with tactile press feedback and optional gradient variant.
 *
 * All buttons carry a subtle scale-down on active state (btn-press class)
 * creating a "pressed" sensation. The gradient variant uses the brand
 * coral→purple pairing for high-impact CTAs.
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  children,
  isLoading,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center rounded-full font-medium transition-all duration-150 btn-press focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

  const sizeStyles = {
    sm: 'px-4 py-2 text-xs',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-6 py-3 text-base',
  }[size];

  const variantStyles = {
    primary:
      'bg-brand text-white hover:bg-brand-700 active:bg-brand-700 focus-visible:ring-brand shadow-sm',
    secondary:
      'border border-surface-border bg-white text-ink hover:border-ink hover:bg-surface-alt focus-visible:ring-ink',
    ghost: 'bg-transparent text-ink hover:bg-surface-alt focus-visible:ring-ink',
    gradient:
      'bg-gradient-to-r from-brand to-accent-deep text-white hover:opacity-95 active:opacity-90 focus-visible:ring-accent-deep shadow-md hover:shadow-lg',
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {children}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/**
 * Icon button variant — circular, icon-only.
 */
export function IconButton({
  children,
  variant = 'ghost',
  className = '',
  ...props
}: Omit<ButtonProps, 'size'> & { 'aria-label': string }) {
  const variantStyles = {
    primary: 'bg-brand text-white hover:bg-brand-700',
    secondary: 'border border-surface-border bg-white text-ink hover:border-ink',
    ghost: 'bg-transparent text-ink-muted hover:bg-surface-alt hover:text-ink',
    gradient: 'bg-gradient-to-br from-brand to-accent-deep text-white',
  }[variant];

  return (
    <button
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition-all duration-150 btn-press ${variantStyles} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
