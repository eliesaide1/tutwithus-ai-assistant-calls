import express from 'express';
import request from 'supertest';
import { createLogger } from '../lib/logger.js';
import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../config/env.js';
import { createErrorHandler } from '../http/errors.js';
import { requestContext } from '../http/middleware/request-context.js';
import type { AdminIdentityStore } from '../modules/admin-auth/admin-auth.service.js';
import { signAdminToken } from '../modules/admin-auth/admin-auth.service.js';
import type { MaintenanceJobs } from './maintenance-jobs.js';
import { createMaintenanceRouter } from './maintenance.routes.js';

const config: ApiConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsAllowedOrigins: [],
  logLevel: 'silent',
  mongoUri: 'mongodb://127.0.0.1:27017/tutwithus_test',
  workerConcurrency: 5,
  adminJwtSecret: 'test-admin-jwt-secret-at-least-32-characters',
  adminJwtSecretIsEphemeral: false,
  adminJwtTtlDays: 1,
  openai: {
    apiKey: undefined,
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

const principal = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  role: 'admin' as const,
};
const csrfToken = 'a'.repeat(43);
const logger = createLogger({
  level: 'silent',
  service: 'maintenance-routes-test',
});

async function createApp(jobs: MaintenanceJobs) {
  const adminUsers: AdminIdentityStore = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async () => ({ ...principal, disabled: false })),
  };
  const token = await signAdminToken(principal, csrfToken, config);
  const app = express();
  app.use(requestContext(logger));
  app.use(
    '/api/v1/admin/jobs',
    createMaintenanceRouter(config, adminUsers, jobs),
  );
  app.use(createErrorHandler(logger));
  return {
    app,
    cookie: `tutwithus_admin=${token}; tutwithus_admin_csrf=${csrfToken}`,
  };
}

describe('maintenance job route', () => {
  it('uses the HTTP path and returns inline processing status', async () => {
    const jobs: MaintenanceJobs = {
      requestPing: vi.fn(async () => ({ status: 'processed' as const })),
      close: vi.fn(async () => undefined),
    };
    const { app, cookie } = await createApp(jobs);

    const response = await request(app)
      .post('/api/v1/admin/jobs/ping')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfToken);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'processed' });
    expect(jobs.requestPing).toHaveBeenCalledWith(
      expect.objectContaining({ requestedBy: 'admin-http-request' }),
    );
  });

  it('rejects requests without CSRF verification', async () => {
    const jobs: MaintenanceJobs = {
      requestPing: vi.fn(async () => ({ status: 'processed' as const })),
      close: vi.fn(async () => undefined),
    };
    const { app, cookie } = await createApp(jobs);

    const response = await request(app)
      .post('/api/v1/admin/jobs/ping')
      .set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(jobs.requestPing).not.toHaveBeenCalled();
  });
});
