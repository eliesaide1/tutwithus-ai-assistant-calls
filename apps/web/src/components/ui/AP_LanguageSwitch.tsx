import type { Locale } from '../../shared/i18n';
import { localeOptions } from '../../shared/i18n';
import './AP_LanguageSwitch.css';

type AP_LanguageSwitchProps = {
  locale: Locale;
  label: string;
  languageNames: Record<Locale, string>;
  onLocaleChange: (locale: Locale) => void;
  compact?: boolean;
  disabled?: boolean;
};

export function AP_LanguageSwitch({
  locale,
  label,
  languageNames,
  onLocaleChange,
  compact = false,
  disabled = false,
}: AP_LanguageSwitchProps) {
  return (
    <nav
      aria-label={label}
      className={`ap-language-switch${compact ? ' ap-language-switch--compact' : ''}`}
    >
      {localeOptions.map((option) => (
        <button
          aria-label={languageNames[option.code]}
          aria-pressed={locale === option.code}
          className="ap-language-switch__option"
          data-locale={option.code}
          disabled={disabled}
          key={option.code}
          onClick={() => onLocaleChange(option.code)}
          type="button"
        >
          <span className="ap-language-switch__full">
            {languageNames[option.code]}
          </span>
          {compact && (
            <span className="ap-language-switch__compact" aria-hidden="true">
              {option.code === 'ar-SA' ? 'AR' : option.code.toUpperCase()}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
