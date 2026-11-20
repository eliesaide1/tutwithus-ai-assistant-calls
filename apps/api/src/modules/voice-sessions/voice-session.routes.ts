import {
  AccountCheckRequestSchema,
  CreateVoiceSessionRequestSchema,
  EndVoiceSessionRequestSchema,
  SaveVoiceTranscriptRequestSchema,
  SubmitBookingRequestSchema,
  TimeZoneSchema,
  type CreateVoiceSessionRequest,
} from '@tutwithus/contracts';
import express, { Router } from 'express';
import type { Logger } from '../../lib/logger.js';
import type { ApiConfig } from '../../config/env.js';
import { ApiError } from '../../http/errors.js';
import { rateLimitPerIp } from '../../http/middleware/rate-limit.js';
import { validateBody } from '../../http/middleware/validate-body.js';
import type { CallControl } from '../../core/session/active-calls.js';
import type { CustomerDirectory } from '../../platform/customer-directory.js';
import { checkCallerAccount } from './account-check.service.js';
import { toVoiceSessionApiError } from './voice-session.http-errors.js';
import {
  parseVoiceSessionId,
  readVoiceSessionToken,
} from './voice-session.request.js';
import type { VoiceSessionRepository } from './voice-session.repository.js';
import type { VoiceBookingService } from '../bookings/voice-booking.service.js';
import type { AgentProfileSettingsReader } from '../settings/agent-settings.service.js';
import {
  getAuthorizedVoiceSession,
  VoiceSessionError,
} from './voice-session.service.js';
import {
  createVoiceSession,
  endVoiceSession,
  saveVoiceTranscriptEntry,
} from './voice-session.service.js';

const LOG_SOURCE = 'voice-sessions';
export function createVoiceSessionRouter(
  config: ApiConfig,
  repository: VoiceSessionRepository,
  settingsReader: AgentProfileSettingsReader,
  activeCalls: CallControl,
  customers: CustomerDirectory,
  voiceBookings: Pick<VoiceBookingService, 'createFromVerifiedSession'>,
  logger: Logger,
) {
  const router = Router();

  router.post(
    '/:sessionId/booking-requests',
    rateLimitPerIp({
      windowMs: 10 * 60 * 1000,
      limit: 5,
      message: 'Too many booking requests. Please try again later.',
    }),
    express.json({ limit: '8kb', strict: true }),
    validateBody(SubmitBookingRequestSchema),
    async (request, response) => {
      const sessionId = parseVoiceSessionId(request.params.sessionId);
      const sessionToken = readVoiceSessionToken(request);
      try {
        const session = await getAuthorizedVoiceSession(
          sessionId,
          sessionToken,
          repository,
          new Date(),
        );
        if (!session.startedAt || session.endedAt) {
          throw new ApiError(
            409,
            'SESSION_ALREADY_USED',
            'The voice session is not active.',
          );
        }
        if (!session.verifiedCustomer) {
          throw new ApiError(
            403,
            'CUSTOMER_NOT_VERIFIED',
            'A verified TutWithUs account is required.',
          );
        }
        const result = await voiceBookings.createFromVerifiedSession(
          sessionId,
          request.body,
        );
        response.setHeader('Cache-Control', 'no-store');
        response.status(201).json(result);
      } catch (error) {
        if (error instanceof VoiceSessionError) {
          throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
        }
        throw error;
      }
    },
  );

  // The test website displays the coarse match result. Never return customer
  // identifiers or account details from this endpoint.
  router.post(
    '/:sessionId/account-check',
    express.json({ limit: '2kb', strict: true }),
    validateBody(AccountCheckRequestSchema),
    async (request, response) => {
      const sessionId = parseVoiceSessionId(request.params.sessionId);
      const sessionToken = readVoiceSessionToken(request);
      try {
        const accountStatus = await checkCallerAccount(
          { repository, directory: customers, notifier: activeCalls },
          {
            sessionId,
            sessionToken,
            memberId: request.body.memberId,
          },
        );
        response.setHeader('Cache-Control', 'no-store');
        response.status(202).json({ status: 'submitted', accountStatus });
      } catch (error) {
        throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
      }
    },
  );

  router.post(
    '/',
    rateLimitPerIp({
      windowMs: 10 * 60 * 1000,
      limit: 5,
      message: 'Too many session requests. Please try again later.',
    }),
    express.json({ limit: '16kb', strict: true }),
    validateBody(CreateVoiceSessionRequestSchema),
    async (request, response) => {
      try {
        const body = request.body as CreateVoiceSessionRequest;
        const headerTimeZone = TimeZoneSchema.safeParse(
          request.get('X-Timezone'),
        );
        const session = await createVoiceSession(
          body.timeZone || !headerTimeZone.success
            ? body
            : { ...body, timeZone: headerTimeZone.data },
          config,
          repository,
          settingsReader,
          customers,
          activeCalls,
        );
        response.status(201).json(session);
      } catch (error) {
        throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
      }
    },
  );

  router.post(
    '/:sessionId/transcript',
    rateLimitPerIp({
      windowMs: 60 * 1000,
      limit: 120,
      message: 'Too many transcript entries. Please try again later.',
    }),
    express.json({ limit: '12kb', strict: true }),
    validateBody(SaveVoiceTranscriptRequestSchema),
    async (request, response) => {
      const sessionId = parseVoiceSessionId(request.params.sessionId);
      const sessionToken = readVoiceSessionToken(request);

      try {
        const result = await saveVoiceTranscriptEntry(
          sessionId,
          sessionToken,
          request.body,
          repository,
        );
        response.status(201).json(result);
      } catch (error) {
        throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
      }
    },
  );

  router.post(
    '/:sessionId/end',
    express.json({ limit: '4kb', strict: true }),
    validateBody(EndVoiceSessionRequestSchema),
    async (request, response) => {
      const sessionId = parseVoiceSessionId(request.params.sessionId);
      const sessionToken = readVoiceSessionToken(request);
      const reason = request.body.reason ?? 'user_ended';

      try {
        const result = await endVoiceSession(
          sessionId,
          sessionToken,
          reason,
          repository,
        );
        // Hang up the OpenAI call and save usage; no-op if it already ended.
        logger.info(
          {
            source: LOG_SOURCE,
            sessionId,
            reason,
          },
          'Voice session end requested by client',
        );
        await activeCalls.stop(sessionId, reason);
        response.json(result);
      } catch (error) {
        throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
      }
    },
  );

  return router;
}
