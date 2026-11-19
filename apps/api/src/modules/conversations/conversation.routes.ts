import { LocaleSchema } from '@tutwithus/contracts';
import {
  AdminConversationSchema,
  AdminConversationsResponseSchema,
} from '@tutwithus/contracts/admin';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError } from '../../http/errors.js';
import { parseInput, UuidSchema } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { VoiceSessionAdminService } from '../voice-sessions/voice-session-admin.service.js';

const ConversationFilterSchema = z.object({
  locale: LocaleSchema.optional(),
  status: z.enum(['active', 'ended']).optional(),
  channel: z.enum(['browser', 'whatsapp']).optional(),
});

export function createConversationRouter(
  authenticate: RequestHandler,
  conversations: VoiceSessionAdminService,
) {
  const router = Router();
  router.use(
    authenticate,
    authorize(...ADMIN_ROLE_POLICIES.conversationReaders),
  );

  router.get('/', async (request, response) => {
    const filter = parseInput(
      ConversationFilterSchema,
      request.query,
      'The conversation filters are invalid.',
    );
    const items = await conversations.listConversations(filter);
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      AdminConversationsResponseSchema.parse({ conversations: items }),
    );
  });

  router.get('/:sessionId', async (request, response) => {
    const sessionId = parseInput(
      UuidSchema,
      request.params.sessionId,
      'The conversation ID is invalid.',
    );
    const conversation = await conversations.getConversation(sessionId);
    if (!conversation) {
      throw new ApiError(
        404,
        'CONVERSATION_NOT_FOUND',
        'The conversation was not found.',
      );
    }
    response.setHeader('Cache-Control', 'no-store');
    response.json(AdminConversationSchema.parse(conversation));
  });

  return router;
}
