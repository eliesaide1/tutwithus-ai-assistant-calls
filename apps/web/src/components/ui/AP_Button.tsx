import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type AP_ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type AP_ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: AP_ButtonVariant;
};

export function AP_Button({
  children,
  className = '',
  variant = 'secondary',
  ...props
}: AP_ButtonProps) {
  return (
    <button
      {...props}
      className={`ap-button ap-button--${variant}${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  );
}
