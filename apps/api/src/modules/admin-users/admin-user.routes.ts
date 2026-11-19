import {
  AdminUserCreateRequestSchema,
  AdminUserUpdateRequestSchema,
  AdminUsersResponseSchema,
} from '@tutwithus/contracts/admin';
import express, { Router, type RequestHandler } from 'express';
import { ObjectIdSchema, parseInput } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import {
  getAdminPrincipal,
  requireAdminCsrf,
} from '../admin-auth/admin-auth.middleware.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { AdminUserSummary } from './admin-user.repository.js';
import type { AdminUserService } from './admin-user.service.js';

const AdminUserResponseSchema = AdminUsersResponseSchema.shape.users.element;

function toUserResponse(user: AdminUserSummary) {
  return AdminUserResponseSchema.parse({
    ...user,
    createdAt: user.createdAt.toISOString(),
  });
}

export function createAdminUsersRouter(
  authenticate: RequestHandler,
  users: AdminUserService,
  writeAudit: AuditWriter,
) {
  const router = Router();
  router.use(authenticate, authorize(...ADMIN_ROLE_POLICIES.administrators));

  router.get('/', async (_request, response) => {
    const items = await users.listUsers();
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      AdminUsersResponseSchema.parse({ users: items.map(toUserResponse) }),
    );
  });

  router.post(
    '/',
    requireAdminCsrf,
    express.json({ limit: '4kb', strict: true }),
    async (request, response) => {
      const body = parseInput(
        AdminUserCreateRequestSchema,
        request.body,
        'Provide a valid email, password, and role.',
      );
      const principal = getAdminPrincipal(response);
      const created = await users.createUser(body);
      await writeAudit(request, principal.id, {
        action: 'user.created',
        entity: 'admin_user',
        entityId: created.id,
        diff: { role: created.role },
      });
      response.status(201).json(toUserResponse(created));
    },
  );

  router.patch(
    '/:id',
    requireAdminCsrf,
    express.json({ limit: '2kb', strict: true }),
    async (request, response) => {
      const id = parseInput(
        ObjectIdSchema,
        request.params.id,
        'The user ID is invalid.',
      );
      const update = parseInput(
        AdminUserUpdateRequestSchema,
        request.body,
        'The user update is invalid.',
      );
      const principal = getAdminPrincipal(response);
      const updated = await users.updateUser(principal.id, id, update);
      await writeAudit(request, principal.id, {
        action: 'user.updated',
        entity: 'admin_user',
        entityId: updated.id,
        diff: {
          ...(update.role !== undefined ? { role: update.role } : {}),
          ...(update.disabled !== undefined
            ? { disabled: update.disabled }
            : {}),
        },
      });
      response.json(toUserResponse(updated));
    },
  );

  router.delete('/:id', requireAdminCsrf, async (request, response) => {
    const id = parseInput(
      ObjectIdSchema,
      request.params.id,
      'The user ID is invalid.',
    );
    const principal = getAdminPrincipal(response);
    await users.deleteUser(principal.id, id);
    await writeAudit(request, principal.id, {
      action: 'user.deleted',
      entity: 'admin_user',
      entityId: id,
      diff: {},
    });
    response.json({ status: 'deleted' });
  });

  return router;
}
