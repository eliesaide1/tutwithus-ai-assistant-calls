import { RealtimeConnectionRequestSchema } from '@tutwithus/contracts';
import express, { Router } from 'express';
import type { Logger } from '../../lib/logger.js';
import type { ApiConfig } from '../../config/env.js';
import { rateLimitPerIp } from '../../http/middleware/rate-limit.js';
import { validateBody } from '../../http/middleware/validate-body.js';
import type { ActiveCallRegistry } from '../../core/session/active-calls.js';
import type { ToolGateway } from '../../core/tools/tool-gateway.js';
import type { LiveCallLimiter } from '../../lib/live-calls.js';
import type { AgentProfileSettingsReader } from '../../modules/settings/agent-settings.service.js';
import { toVoiceSessionApiError } from '../../modules/voice-sessions/voice-session.http-errors.js';
import {
  parseVoiceSessionId,
  readVoiceSessionToken,
} from '../../modules/voice-sessions/voice-session.request.js';
import type { VoiceSessionRepository } from '../../modules/voice-sessions/voice-session.repository.js';
import { connectBrowserVoiceSession } from './browser-voice-transport.js';
import type { RealtimeProvider } from '../../lib/openai/realtime-client.js';

const LOG_SOURCE = 'browser-voice';

export function createBrowserVoiceRouter(
  config: ApiConfig,
  repository: VoiceSessionRepository,
  settingsReader: AgentProfileSettingsReader,
  realtimeProvider: RealtimeProvider,
  calls: {
    tools: ToolGateway;
    liveCalls: LiveCallLimiter;
    activeCalls: ActiveCallRegistry;
  },
  logger: Logger,
) {
  const router = Router();
  router.post(
    '/:sessionId/connect',
    rateLimitPerIp({
      windowMs: 10 * 60 * 1000,
      limit: 10,
      message: 'Too many connection attempts. Please try again later.',
    }),
    express.json({ limit: '66kb', strict: true }),
    validateBody(RealtimeConnectionRequestSchema),
    async (request, response) => {
      const sessionId = parseVoiceSessionId(request.params.sessionId);
      const sessionToken = readVoiceSessionToken(request);
      const abortController = new AbortController();
      response.once('close', () => {
        if (!response.writableEnded) {
          abortController.abort();
        }
      });

      try {
        const answer = await connectBrowserVoiceSession(
          {
            config,
            repository,
            settingsReader,
            provider: realtimeProvider,
            tools: calls.tools,
            liveCalls: calls.liveCalls,
            activeCalls: calls.activeCalls,
            logger,
          },
          {
            sessionId,
            sessionToken,
            sdp: request.body.sdp,
            signal: abortController.signal,
          },
        );
        response.status(201).json(answer);
      } catch (error) {
        throw toVoiceSessionApiError(error, response, logger, LOG_SOURCE);
      }
    },
  );

  return router;
}
