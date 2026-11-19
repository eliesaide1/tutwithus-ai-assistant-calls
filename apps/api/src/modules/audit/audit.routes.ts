import { AuditLogsResponseSchema } from '@tutwithus/contracts/admin';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { parseInput } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { AuditRepository } from './audit.repository.js';

const AuditFilterSchema = z.object({
  entity: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function createAuditRouter(
  authenticate: RequestHandler,
  audit: AuditRepository,
) {
  const router = Router();
  router.use(authenticate, authorize(...ADMIN_ROLE_POLICIES.administrators));

  router.get('/', async (request, response) => {
    const filter = parseInput(
      AuditFilterSchema,
      request.query,
      'The audit filter is invalid.',
    );
    const entries = await audit.listAuditRecords(filter);
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      AuditLogsResponseSchema.parse({
        entries: entries.map((entry) => ({
          ...entry,
          at: entry.at.toISOString(),
        })),
      }),
    );
  });

  return router;
}
