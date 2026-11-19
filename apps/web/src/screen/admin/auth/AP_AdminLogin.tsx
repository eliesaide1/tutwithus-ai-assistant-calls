import { useState, type FormEvent } from 'react';
import { BRAND_LOGO_SRC } from '../../../shared/brand.js';
import type { AdminAuthResponse } from '@tutwithus/contracts/admin';
import { AP_LanguageSwitch } from '../../../components/ui/AP_LanguageSwitch.js';
import { AP_LoadingIndicator } from '../../../components/ui/AP_LoadingIndicator.js';
import { getDirection, messages, type Locale } from '../../../shared/i18n.js';
import { AdminApiError, adminLogin, type AdminUiError } from '../admin-api.js';
import './AP_AdminLogin.css';

type AP_AdminLoginProps = {
  error: AdminUiError | null;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onAuthenticated: (session: AdminAuthResponse) => void;
};

export function AP_AdminLogin({
  error,
  locale,
  onLocaleChange,
  onAuthenticated,
}: AP_AdminLoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const text = messages[locale];
  const direction = getDirection(locale);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      onAuthenticated(await adminLogin(email, password));
    } catch (cause) {
      setFormError(
        cause instanceof AdminApiError ? cause.message : text.adminLoginFailed,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="ap-admin-login" dir={direction} lang={locale}>
      {submitting && (
        <AP_LoadingIndicator label={text.adminSigningIn} variant="overlay" />
      )}
      <header className="ap-admin-login__header">
        <a
          className="ap-admin-login__brand"
          href="/"
          aria-label={text.brandName}
        >
          <img
            src={BRAND_LOGO_SRC}
            alt={text.brandName}
            className="ap-admin-login__logo"
          />
          <span className="ap-admin-login__badge">{text.adminBadge}</span>
        </a>
        <AP_LanguageSwitch
          compact
          languageNames={{
            'ar-SA': text.languageArabic,
            en: text.languageEnglish,
            fr: text.languageFrench,
          }}
          label={text.languagePickerLabel}
          locale={locale}
          onLocaleChange={onLocaleChange}
        />
      </header>
      <section
        className="ap-admin-login__card"
        aria-labelledby="admin-login-title"
      >
        <h1 id="admin-login-title">{text.adminLoginTitle}</h1>
        <p className="ap-admin-login__description">
          {text.adminLoginDescription}
        </p>
        <form
          className="ap-admin-login__form"
          onSubmit={(event) => void submit(event)}
        >
          <label htmlFor="admin-email">{text.adminEmailLabel}</label>
          <input
            id="admin-email"
            aria-label={text.adminEmailLabel}
            autoComplete="username"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            required
          />
          <label htmlFor="admin-password">{text.adminPasswordLabel}</label>
          <div className="ap-admin-login__password">
            <input
              id="admin-password"
              autoComplete="current-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
            <button
              className="ap-admin-login__visibility"
              type="button"
              aria-label={
                showPassword ? text.adminHidePassword : text.adminShowPassword
              }
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                  <path
                    d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.7 4.5 9.5 6.1a1.8 1.8 0 0 1 0 1.8 13.4 13.4 0 0 1-3.1 3.7M6.2 6.3a14.2 14.2 0 0 0-3.7 4.8 1.8 1.8 0 0 0 0 1.8C3.3 14.5 6.8 19 12 19c.9 0 1.8-.1 2.6-.4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M2.5 12s3.4-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.4 6.5-9.5 6.5S2.5 12 2.5 12Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="2.7"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  />
                </svg>
              )}
            </button>
          </div>
          {(formError || error) && (
            <p className="ap-admin-login__error" role="alert">
              {formError ||
                (error?.type === 'message'
                  ? error.message
                  : error?.type === 'session'
                    ? text.adminSessionError
                    : text.adminRequestError)}
            </p>
          )}
          <button type="submit" disabled={submitting}>
            {text.adminSignIn}
          </button>
        </form>
        <p className="ap-admin-login__security">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect
              x="5"
              y="10"
              width="14"
              height="10"
              rx="2"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          {text.adminSecurityNotice}
        </p>
      </section>
      <footer className="ap-admin-login__footer">{text.adminFooter}</footer>
    </main>
  );
}
