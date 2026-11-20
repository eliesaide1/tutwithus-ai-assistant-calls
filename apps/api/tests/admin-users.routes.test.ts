import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import type { ApiConfig } from '../src/config/env.js';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import { createAdminUsersRouter } from '../src/modules/admin-users/admin-user.routes.js';
import type { AdminUserRepository } from '../src/modules/admin-users/admin-user.repository.js';
import { AdminUserService } from '../src/modules/admin-users/admin-user.service.js';
import { createAuditWriter } from '../src/modules/audit/audit-writer.js';

const csrfToken = 'test-csrf-token';
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
  consentVersion: '2026-11-03.1',
  consentText: { 'ar-SA': 'test', en: 'test', fr: 'test' },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
};

function createTestApp(role: 'admin' | 'agent') {
  const createdAt = new Date('2026-01-01T10:00:00.000Z');
  const records = [
    {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      email: 'admin@example.com',
      role: 'admin' as const,
      disabled: false,
      createdAt,
    },
    {
      id: 'abcdefabcdefabcdefabcdef',
      email: 'other@example.com',
      role: 'admin' as const,
      disabled: false,
      createdAt,
    },
    {
      id: 'fedcbafedcbafedcbafedcba',
      email: 'agent@example.com',
      role: 'agent' as const,
      disabled: false,
      createdAt,
    },
  ];
  const repository: AdminUserRepository = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async (id) => {
      const user = records.find((record) => record.id === id);
      return user
        ? {
            id: user.id,
            email: user.email,
            role: user.role,
            disabled: user.disabled,
          }
        : null;
    }),
    create: vi.fn(async () => undefined),
    hasAdmin: vi.fn(async () => true),
    listUsers: vi.fn(async () => records),
    createManagedUser: vi.fn(async (input) => {
      const created = {
        id: 'created-user',
        email: input.email,
        role: input.role,
        disabled: false,
        createdAt,
      };
      records.push(created);
      return created;
    }),
    updateManagedUser: vi.fn(async (id, update) => {
      const user = records.find((record) => record.id === id);
      return user ? { ...user, ...update } : null;
    }),
    deleteManagedUser: vi.fn(async (id) => {
      const index = records.findIndex((record) => record.id === id);
      if (index < 0) {
        return false;
      }
      records.splice(index, 1);
      return true;
    }),
    countEnabledAdmins: vi.fn(async () => 1),
  };
  const authenticate: RequestHandler = (_request, response, next) => {
    response.locals.admin = {
      id: role === 'admin' ? 'aaaaaaaaaaaaaaaaaaaaaaaa' : 'agent-id',
      email: `${role}@example.com`,
      role,
      csrfToken,
    };
    next();
  };
  const audit = {
    addAuditRecord: vi.fn(async () => undefined),
    listAuditRecords: vi.fn(async () => []),
  };
  const writeAudit = createAuditWriter(audit, config);
  const logger = createLogger({ level: 'silent', service: 'admin-users-test' });
  const app = express();
  app.use(requestContext(logger));
  app.use(
    '/api/v1/admin/users',
    createAdminUsersRouter(
      authenticate,
      new AdminUserService(repository),
      writeAudit,
    ),
  );
  app.use(createErrorHandler(logger));
  return { app, repository, audit };
}

describe('admin user management routes', () => {
  it('limits user listing to administrators', async () => {
    const { app, repository } = createTestApp('agent');
    const response = await request(app).get('/api/v1/admin/users');

    expect(response.status).toBe(403);
    expect(repository.listUsers).not.toHaveBeenCalled();
  });

  it('prevents disabling the last enabled administrator', async () => {
    const { app, repository } = createTestApp('admin');
    const response = await request(app)
      .patch('/api/v1/admin/users/abcdefabcdefabcdefabcdef')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ disabled: true });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ADMIN_LAST_ADMIN');
    expect(repository.updateManagedUser).not.toHaveBeenCalled();
  });

  it.each(['admin', 'editor', 'agent', 'viewer'] as const)(
    'updates a managed user role to %s and records the change',
    async (role) => {
      const { app, repository, audit } = createTestApp('admin');
      const response = await request(app)
        .patch('/api/v1/admin/users/fedcbafedcbafedcbafedcba')
        .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
        .set('X-CSRF-Token', csrfToken)
        .send({ role });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'fedcbafedcbafedcbafedcba',
        email: 'agent@example.com',
        role,
        disabled: false,
      });
      expect(repository.updateManagedUser).toHaveBeenCalledWith(
        'fedcbafedcbafedcbafedcba',
        { role },
      );
      expect(audit.addAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.updated',
          entity: 'admin_user',
          entityId: 'fedcbafedcbafedcbafedcba',
          diff: { role },
        }),
      );
    },
  );

  it('limits user deletion to administrators', async () => {
    const { app, repository } = createTestApp('agent');
    const response = await request(app)
      .delete('/api/v1/admin/users/fedcbafedcbafedcbafedcba')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(response.status).toBe(403);
    expect(repository.deleteManagedUser).not.toHaveBeenCalled();
  });

  it('lets an administrator delete another user and records the action', async () => {
    const { app, repository, audit } = createTestApp('admin');
    const response = await request(app)
      .delete('/api/v1/admin/users/fedcbafedcbafedcbafedcba')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'deleted' });
    expect(repository.deleteManagedUser).toHaveBeenCalledWith(
      'fedcbafedcbafedcbafedcba',
    );
    expect(audit.addAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.deleted',
        entity: 'admin_user',
        entityId: 'fedcbafedcbafedcbafedcba',
      }),
    );
  });

  it('prevents administrators from deleting their own account', async () => {
    const { app, repository } = createTestApp('admin');
    const response = await request(app)
      .delete('/api/v1/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ADMIN_SELF_DELETE');
    expect(repository.deleteManagedUser).not.toHaveBeenCalled();
  });

  it('prevents deleting the last enabled administrator', async () => {
    const { app, repository } = createTestApp('admin');
    const response = await request(app)
      .delete('/api/v1/admin/users/abcdefabcdefabcdefabcdef')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ADMIN_LAST_ADMIN');
    expect(repository.deleteManagedUser).not.toHaveBeenCalled();
  });

  it('creates users with a hashed password and a minimal audit diff', async () => {
    const { app, repository, audit } = createTestApp('admin');
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'New.Editor@example.com',
        password: 'a-secure-long-password',
        role: 'editor',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 'created-user',
      email: 'new.editor@example.com',
      role: 'editor',
      disabled: false,
    });
    expect(repository.createManagedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.editor@example.com',
        role: 'editor',
        passwordHash: expect.not.stringContaining('a-secure-long-password'),
      }),
    );
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(audit.addAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.created',
        diff: { role: 'editor' },
      }),
    );
  });

  it('accepts an eight-character password when creating a user', async () => {
    const { app, repository } = createTestApp('admin');
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'new.editor@example.com',
        password: 'pass1234',
        role: 'editor',
      });

    expect(response.status).toBe(201);
    expect(repository.createManagedUser).toHaveBeenCalled();
  });

  it('rejects passwords shorter than eight characters when creating a user', async () => {
    const { app, repository } = createTestApp('admin');
    const response = await request(app)
      .post('/api/v1/admin/users')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        email: 'new.editor@example.com',
        password: 'pass123',
        role: 'editor',
      });

    expect(response.status).toBe(400);
    expect(repository.createManagedUser).not.toHaveBeenCalled();
  });
});
