import './AP_LoadingIndicator.css';

type AP_LoadingIndicatorProps = {
  label: string;
  variant?: 'default' | 'page' | 'section' | 'overlay';
};

export function AP_LoadingIndicator({
  label,
  variant = 'default',
}: AP_LoadingIndicatorProps) {
  return (
    <div
      aria-label={label}
      className={`ap-loading-indicator ap-loading-indicator--${variant}`}
      role="status"
    >
      <span aria-hidden="true" className="ap-loading-indicator__dots">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
