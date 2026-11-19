import { Router } from 'express';
import { requireAdmin } from '../../modules/admin-auth/admin-auth.middleware.js';
import { createAdminAuthRouter } from '../../modules/admin-auth/admin-auth.routes.js';
import { createAdminUsersRouter } from '../../modules/admin-users/admin-user.routes.js';
import { AdminUserService } from '../../modules/admin-users/admin-user.service.js';
import { createAuditWriter } from '../../modules/audit/audit-writer.js';
import { createAuditRouter } from '../../modules/audit/audit.routes.js';
import { createBookingRouter } from '../../modules/bookings/booking.routes.js';
import { BookingService } from '../../modules/bookings/booking.service.js';
import { VoiceBookingService } from '../../modules/bookings/voice-booking.service.js';
import { createConversationRouter } from '../../modules/conversations/conversation.routes.js';
import { createMaintenanceRouter } from '../../jobs/maintenance.routes.js';

import { createEscalationRouter } from '../../modules/escalations/escalation.routes.js';
import { EscalationService } from '../../modules/escalations/escalation.service.js';
import { createKnowledgeRouter } from '../../modules/knowledge/knowledge.routes.js';
import { KnowledgeService } from '../../modules/knowledge/knowledge.service.js';
import { createPublicConfigRouter } from '../../modules/public-config/public-config.routes.js';
import { createAgentSettingsRouter } from '../../modules/settings/agent-settings.routes.js';
import { AgentSettingsService } from '../../modules/settings/agent-settings.service.js';
import { VoiceSessionAdminService } from '../../modules/voice-sessions/voice-session-admin.service.js';
import { createVoiceSessionRouter } from '../../modules/voice-sessions/voice-session.routes.js';
import { createBrowserVoiceRouter } from '../../transports/browser/browser-voice.routes.js';
import { createWhatsAppWebhookRouter } from '../../transports/whatsapp/whatsapp-webhook.routes.js';
import { MongoWhatsAppCallEventRepository } from '../../transports/whatsapp/whatsapp-call-event.repository.js';
import {
  createVoiceEscalationContactResolver,
  createVerifiedVoiceCustomerResolver,
} from '../../modules/voice-sessions/voice-session.service.js';
import type { AppDependencies } from '../app-dependencies.js';

// Builds the feature services from the shared dependencies and mounts every
// /api/v1 router. Each router parses its own request bodies with a size limit.
export function createApiRoutes(deps: AppDependencies) {
  const { config, logger } = deps;
  const router = Router();
  const settingsReader = new AgentSettingsService(deps.settingsRepository);

  router.use(
    '/webhooks/whatsapp',
    createWhatsAppWebhookRouter(
      deps.config.whatsappWebhook,
      new MongoWhatsAppCallEventRepository(deps.config.retentionDays),
      deps.logger,
    ),
  );

  // Public visitor endpoints.
  router.use(
    '/public/config',
    createPublicConfigRouter(config, settingsReader),
  );
  router.use(
    '/voice/sessions',
    createVoiceSessionRouter(
      config,
      deps.voiceSessionRepository,
      settingsReader,
      deps.activeCalls,
      deps.customerDirectory,
      new VoiceBookingService(
        deps.bookingRepository,
        createVerifiedVoiceCustomerResolver(deps.voiceSessionRepository),
      ),
      logger,
    ),
  );
  router.use(
    '/voice/sessions',
    createBrowserVoiceRouter(
      config,
      deps.voiceSessionRepository,
      settingsReader,
      deps.realtimeProvider,
      {
        tools: deps.toolGateway,
        liveCalls: deps.liveCalls,
        activeCalls: deps.activeCalls,
      },
      logger,
    ),
  );

  // Admin endpoints. Every router below authenticates, then applies a role policy.
  const authenticate = requireAdmin(config, deps.adminUserRepository);
  const writeAudit = createAuditWriter(deps.auditRepository, config);

  router.use(
    '/admin/auth',
    createAdminAuthRouter(config, deps.adminUserRepository, logger),
  );
  router.use(
    '/admin/jobs',
    createMaintenanceRouter(
      config,
      deps.adminUserRepository,
      deps.maintenanceJobs,
    ),
  );
  router.use(
    '/admin/users',
    createAdminUsersRouter(
      authenticate,
      new AdminUserService(deps.adminUserRepository),
      writeAudit,
    ),
  );
  router.use(
    '/admin/booking-requests',
    createBookingRouter(
      authenticate,
      new BookingService(deps.bookingRepository, deps.adminUserRepository),
      writeAudit,
    ),
  );
  router.use(
    '/admin/escalations',
    createEscalationRouter(
      authenticate,
      new EscalationService(
        deps.escalationRepository,
        createVoiceEscalationContactResolver(deps.voiceSessionRepository),
      ),
      writeAudit,
    ),
  );
  router.use(
    '/admin/settings',
    createAgentSettingsRouter(
      authenticate,
      deps.settingsRepository,
      writeAudit,
    ),
  );
  router.use(
    '/admin/audit',
    createAuditRouter(authenticate, deps.auditRepository),
  );
  router.use(
    '/admin/knowledge',
    createKnowledgeRouter(
      authenticate,
      new KnowledgeService(deps.knowledgeRepository),
      deps.knowledgeIngestion,
      logger,
    ),
  );
  router.use(
    '/admin/conversations',
    createConversationRouter(
      authenticate,
      new VoiceSessionAdminService(deps.voiceSessionRepository),
    ),
  );
  return router;
}
