import {
  AdminEscalationUpdateRequestSchema,
  EscalationsResponseSchema,
} from '@tutwithus/contracts/admin';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ObjectIdSchema, parseInput } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import {
  getAdminPrincipal,
  requireAdminCsrf,
} from '../admin-auth/admin-auth.middleware.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { EscalationWithId } from './escalation.repository.js';
import type { EscalationService } from './escalation.service.js';

const EscalationFilterSchema = z.object({
  status: z.enum(['open', 'claimed', 'resolved']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

// Only staff responsible for the follow-up queue can see consented contacts.
function toEscalationResponse(
  escalation: EscalationWithId,
  showContact: boolean,
  currentUserId: string,
) {
  return {
    ...escalation,
    ...(showContact && escalation.contactConsent ? {} : { contact: undefined }),
    assignedToCurrentUser: escalation.assigneeId === currentUserId,
    slaDueAt: escalation.slaDueAt.toISOString(),
    createdAt: escalation.createdAt.toISOString(),
    updatedAt: escalation.updatedAt.toISOString(),
    notes: escalation.notes.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}

export function createEscalationRouter(
  authenticate: RequestHandler,
  escalations: EscalationService,
  writeAudit: AuditWriter,
) {
  const router = Router();
  router.use(
    authenticate,
    authorize(...ADMIN_ROLE_POLICIES.escalationOperators),
  );

  router.get('/', async (request, response) => {
    const filter = parseInput(
      EscalationFilterSchema,
      request.query,
      'The escalation filters are invalid.',
    );
    const principal = getAdminPrincipal(response);
    const items = await escalations.listEscalations(filter);
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      EscalationsResponseSchema.parse({
        escalations: items.map((item) =>
          toEscalationResponse(
            item,
            principal.role === 'admin' || principal.role === 'agent',
            principal.id,
          ),
        ),
      }),
    );
  });

  router.patch(
    '/:id',
    requireAdminCsrf,
    express.json({ limit: '4kb', strict: true }),
    async (request, response) => {
      const id = parseInput(
        ObjectIdSchema,
        request.params.id,
        'The escalation ID is invalid.',
      );
      const update = parseInput(
        AdminEscalationUpdateRequestSchema,
        request.body,
        'The escalation update is invalid.',
      );
      const principal = getAdminPrincipal(response);
      const result = await escalations.updateEscalation(principal, id, update);
      await writeAudit(request, principal.id, {
        action: 'escalation.updated',
        entity: 'escalation',
        entityId: id,
        // Never record note text or contact details in the audit trail.
        diff: {
          ...(result.statusChanged ? { status: result.status } : {}),
          ...(result.assignedToSelf ? { assignedToSelf: true } : {}),
          ...(update.note ? { noteAdded: true } : {}),
        },
      });
      response.json({ status: result.status });
    },
  );

  return router;
}
