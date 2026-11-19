import { useEffect, useState } from 'react';
import type { AdminAuthResponse } from '@tutwithus/contracts/admin';
import { useLocation, useNavigate } from 'react-router-dom';
import { getDirection, messages, type Locale } from '../../shared/i18n.js';
import { AP_LoadingIndicator } from '../../components/ui/AP_LoadingIndicator.js';
import {
  AdminApiError,
  loadAdminSession,
  type AdminUiError,
} from './admin-api.js';
import { AP_AdminDashboard } from './dashboard/AP_AdminDashboard.js';
import { AP_AdminLogin } from './auth/AP_AdminLogin.js';
import './AP_AdminApp.css';

export function AP_AdminApp() {
  const [session, setSession] = useState<AdminAuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AdminUiError | null>(null);
  const [locale, setLocale] = useState<Locale>('en');
  const text = messages[locale];
  const direction = getDirection(locale);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    void loadAdminSession()
      .then((current) => {
        if (active) {
          setSession(current);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof AdminApiError
              ? { type: 'message', message: cause.message }
              : { type: 'session' },
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session && location.pathname === '/admin/login') {
      navigate(
        session.user.role === 'admin' || session.user.role === 'editor'
          ? '/admin/knowledge'
          : '/admin/conversations',
        { replace: true },
      );
    }
  }, [location.pathname, navigate, session]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    document.title = text.adminPageTitle;
  }, [direction, locale, text.adminPageTitle]);

  if (loading) {
    return (
      <div className="ap-admin-page" dir={direction} lang={locale}>
        <main className="ap-admin-loading">
          <AP_LoadingIndicator
            label={text.adminCheckingSession}
            variant="page"
          />
        </main>
      </div>
    );
  }

  if (session) {
    return (
      <AP_AdminDashboard
        session={session}
        error={error}
        locale={locale}
        onLocaleChange={setLocale}
        onSessionChange={setSession}
        onError={setError}
      />
    );
  }

  return (
    <AP_AdminLogin
      error={error}
      locale={locale}
      onLocaleChange={setLocale}
      onAuthenticated={(authenticated) => {
        setError(null);
        setSession(authenticated);
        navigate(
          authenticated.user.role === 'admin' ||
            authenticated.user.role === 'editor'
            ? '/admin/knowledge'
            : '/admin/conversations',
          { replace: true },
        );
      }}
    />
  );
}
