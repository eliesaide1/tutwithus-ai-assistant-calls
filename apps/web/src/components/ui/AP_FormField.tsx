import type { ReactNode } from 'react';

type AP_FormFieldProps = {
  label: string;
  className?: string;
  hint?: string;
  children: ReactNode;
};

export function AP_FormField({
  label,
  className = '',
  hint,
  children,
}: AP_FormFieldProps) {
  if (hint) {
    return (
      <div className={`ap-form-field-group${className ? ` ${className}` : ''}`}>
        <label className="ap-form-field">
          <span>{label}</span>
          {children}
        </label>
        <small className="ap-form-field__hint">{hint}</small>
      </div>
    );
  }

  return (
    <label className={`ap-form-field${className ? ` ${className}` : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
