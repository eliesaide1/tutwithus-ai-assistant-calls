import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import type { AdminRole } from '@tutwithus/contracts/admin';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import { authorize } from '../src/modules/admin-auth/admin-auth.authorize.js';
import { ADMIN_ROLE_POLICIES } from '../src/modules/admin-auth/admin-auth.policies.js';

function createApp(
  role: AdminRole | undefined,
  policy: readonly AdminRole[] = ADMIN_ROLE_POLICIES.administrators,
) {
  const app = express();
  const logger = createLogger({
    level: 'silent',
    service: 'admin-authorization-test',
  });
  app.use(requestContext(logger));
  app.get(
    '/',
    (_request, response, next) => {
      if (role) {
        response.locals.admin = {
          id: 'user-id',
          email: `${role}@example.com`,
          role,
          csrfToken: 'csrf-token',
        };
      }
      next();
    },
    authorize(...policy),
    (_request, response) => response.json({ status: 'ok' }),
  );
  app.use(createErrorHandler(logger));
  return app;
}

describe('admin route authorization middleware', () => {
  it('rejects requests without an authenticated principal', async () => {
    const response = await request(createApp(undefined)).get('/');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('ADMIN_UNAUTHORIZED');
  });

  it('rejects roles not listed in the endpoint policy', async () => {
    const response = await request(createApp('agent')).get('/');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('allows roles listed in the endpoint policy', async () => {
    const response = await request(createApp('admin')).get('/');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('allows editors to use knowledge endpoints', async () => {
    const response = await request(
      createApp('editor', ADMIN_ROLE_POLICIES.knowledgeEditors),
    ).get('/');

    expect(response.status).toBe(200);
  });

  it('allows viewers to read conversations', async () => {
    const response = await request(
      createApp('viewer', ADMIN_ROLE_POLICIES.conversationReaders),
    ).get('/');

    expect(response.status).toBe(200);
  });
});
