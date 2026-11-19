import express from 'express';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../src/config/env.js';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import { createAdminAuthRouter } from '../src/modules/admin-auth/admin-auth.routes.js';
import type { AdminUserRepository } from '../src/modules/admin-users/admin-user.repository.js';
import {
  hashAdminPassword,
  verifyAdminPassword,
} from '../src/modules/admin-auth/admin-auth.passwords.js';
import { createLogger } from '../src/lib/logger.js';

const config: ApiConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsAllowedOrigins: [],
  logLevel: 'silent',
  mongoUri: 'mongodb://127.0.0.1:27017/tutwithus_test',
  redisUrl: 'redis://127.0.0.1:6379',
  workerConcurrency: 5,
  adminJwtSecret: 'test-admin-jwt-secret-at-least-32-characters',
  adminJwtSecretIsEphemeral: false,
  adminJwtTtlDays: 1,
  openai: {
    apiKey: 'test-key',
    realtimeModel: 'test-model',
    embeddingModel: 'text-embedding-3-small',
  },
  elevenLabs: {
    apiKey: undefined,
    saudiArabicVoiceId: undefined,
    modelId: 'eleven_multilingual_v2',
  },
  consentVersion: '2026-11-03.1',
  consentText: { 'ar-SA': 'test', en: 'test', fr: 'test' },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
};

const password = 'correct-horse-battery-staple';
let repository: AdminUserRepository;
let app: express.Express;

async function setupApp(disabled = false, apiConfig: ApiConfig = config) {
  const passwordHash = await hashAdminPassword(password);
  const user = {
    id: 'admin-user-id',
    email: 'admin@example.com',
    passwordHash,
    role: 'admin' as const,
    disabled,
  };
  repository = {
    findByEmail: vi.fn(async (email) => (email === user.email ? user : null)),
    findById: vi.fn(async (id) => {
      if (id !== user.id || user.disabled) {
        return null;
      }
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        disabled: user.disabled,
      };
    }),
    create: vi.fn(async () => undefined),
    hasAdmin: vi.fn(async () => true),
    listUsers: vi.fn(async () => []),
    createManagedUser: vi.fn(async () => {
      throw new Error('Not used in this test.');
    }),
    updateManagedUser: vi.fn(async () => null),
    deleteManagedUser: vi.fn(async () => false),
    countEnabledAdmins: vi.fn(async () => 1),
  };
  app = express();
  const logger = createLogger({ level: 'silent', service: 'admin-auth-test' });
  app.use(requestContext(logger));
  app.use(
    '/api/v1/admin/auth',
    createAdminAuthRouter(apiConfig, repository, logger),
  );
  app.use(createErrorHandler(logger));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin password hashing', () => {
  it('stores a one-way hash and verifies the password', async () => {
    const hash = await hashAdminPassword(password);
    expect(hash).not.toContain(password);
    await expect(verifyAdminPassword(password, hash)).resolves.toBe(true);
    await expect(verifyAdminPassword('wrong-password', hash)).resolves.toBe(
      false,
    );
  });
});

describe('admin authentication routes', () => {
  it('sets an HttpOnly JWT cookie and requires CSRF verification for logout', async () => {
    await setupApp();
    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'ADMIN@example.com', password });

    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({
      email: 'admin@example.com',
      role: 'admin',
    });
    expect(login.body.csrfToken).toHaveLength(43);

    const cookieHeaderValue = login.headers['set-cookie'];
    const cookies =
      typeof cookieHeaderValue === 'string'
        ? [cookieHeaderValue]
        : cookieHeaderValue;
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Strict');
    expect(cookies[0]).toContain('Path=/api/v1/admin');
    const cookieHeader = (cookies ?? [])
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const current = await request(app)
      .get('/api/v1/admin/auth/me')
      .set('Cookie', cookieHeader);
    expect(current.status).toBe(200);
    expect(current.body.user.email).toBe('admin@example.com');
    expect(current.body).not.toHaveProperty('token');

    const rejectedLogout = await request(app)
      .post('/api/v1/admin/auth/logout')
      .set('Cookie', cookieHeader);
    expect(rejectedLogout.status).toBe(403);

    const logout = await request(app)
      .post('/api/v1/admin/auth/logout')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken);
    expect(logout.status).toBe(200);
    expect(logout.body.status).toBe('logged_out');
    expect(logout.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('tutwithus_admin=;')]),
    );
  });

  it('uses the configured lifetime for both the JWT and its cookies', async () => {
    const lifetimeDays = 7;
    await setupApp(false, { ...config, adminJwtTtlDays: lifetimeDays });
    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@example.com', password });

    expect(login.status).toBe(200);
    const cookieHeaderValue = login.headers['set-cookie'];
    const cookies =
      typeof cookieHeaderValue === 'string'
        ? [cookieHeaderValue]
        : cookieHeaderValue;
    expect(cookies).toBeDefined();
    expect(cookies?.[0]).toContain(`Max-Age=${lifetimeDays * 24 * 60 * 60}`);
    const token = cookies?.[0]?.split(';')[0]?.split('=')[1];
    expect(token).toBeDefined();
    const claims = decodeJwt(token ?? '');
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(
      lifetimeDays * 24 * 60 * 60,
    );
    expect(cookies?.[1]).toContain(`Max-Age=${lifetimeDays * 24 * 60 * 60}`);
  });

  it('does not authenticate a disabled admin', async () => {
    await setupApp(true);
    const response = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@example.com', password });
    expect(response.status, JSON.stringify(response.body)).toBe(401);
    expect(response.body.error.message).toBe(
      'The email or password is incorrect.',
    );
  });
});
