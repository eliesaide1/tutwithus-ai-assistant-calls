import { createLogger } from '../src/lib/logger.js';
import { loadConfig } from '../src/config/env.js';

const config = loadConfig();
const logger = createLogger({
  level: config.logLevel,
  service: 'api-script',
});
const baseUrl = (
  process.env.API_BASE_URL ?? `http://127.0.0.1:${config.port}`
).replace(/\/+$/, '');
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error(
    'Set ADMIN_EMAIL and ADMIN_PASSWORD to use the ping endpoint.',
  );
}

const login = await fetch(`${baseUrl}/api/v1/admin/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) {
  throw new Error(`Admin login failed with HTTP ${login.status}.`);
}

const auth = (await login.json()) as { csrfToken: string };
const cookies = login.headers
  .getSetCookie()
  .map((cookie) => cookie.split(';', 1)[0])
  .join('; ');
const response = await fetch(`${baseUrl}/api/v1/admin/jobs/ping`, {
  method: 'POST',
  headers: {
    cookie: cookies,
    'content-type': 'application/json',
    'x-csrf-token': auth.csrfToken,
  },
});
if (!response.ok) {
  throw new Error(`Ping request failed with HTTP ${response.status}.`);
}

logger.info(
  { result: await response.json() },
  'Ping request accepted by the API',
);
await logger.close?.();
