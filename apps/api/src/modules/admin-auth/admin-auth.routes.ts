import {
  AdminLoginRequestSchema,
  type AdminAuthResponse,
  type AdminLoginRequest,
} from '@tutwithus/contracts/admin';
import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import type { Logger } from '../../lib/logger.js';
import type { ApiConfig } from '../../config/env.js';
import { rateLimitPerIp } from '../../http/middleware/rate-limit.js';
import { validateBody } from '../../http/middleware/validate-body.js';
import { authenticateAdmin, signAdminToken } from './admin-auth.service.js';
import {
  clearAdminCookies,
  getAdminPrincipal,
  requireAdmin,
  requireAdminCsrf,
  setAdminCookies,
} from './admin-auth.middleware.js';
import type { AdminIdentityStore } from './admin-auth.service.js';

export function createAdminAuthRouter(
  config: ApiConfig,
  repository: AdminIdentityStore,
  logger: Logger,
) {
  const router = Router();
  const authenticate = requireAdmin(config, repository);
  if (config.adminJwtSecretIsEphemeral) {
    logger.warn(
      'ADMIN_JWT_SECRET is unset; admin sessions will expire when the API restarts.',
    );
  }

  router.post(
    '/login',
    rateLimitPerIp({
      windowMs: 15 * 60 * 1000,
      limit: 5,
      message: 'Too many login attempts. Please try again later.',
    }),
    express.json({ limit: '4kb', strict: true }),
    validateBody(AdminLoginRequestSchema),
    async (request, response) => {
      const { email, password } = request.body as AdminLoginRequest;
      const principal = await authenticateAdmin(email, password, repository);
      const csrfToken = randomBytes(32).toString('base64url');
      const token = await signAdminToken(principal, csrfToken, config);
      setAdminCookies(response, token, csrfToken, config);
      response.setHeader('Cache-Control', 'no-store');
      const body: AdminAuthResponse = {
        user: { email: principal.email, role: principal.role },
        csrfToken,
      };
      response.json(body);
    },
  );

  router.get('/me', authenticate, (_request, response) => {
    const principal = getAdminPrincipal(response);
    response.setHeader('Cache-Control', 'no-store');
    response.json({
      user: { email: principal.email, role: principal.role },
      csrfToken: principal.csrfToken,
    } satisfies AdminAuthResponse);
  });

  router.post(
    '/logout',
    authenticate,
    requireAdminCsrf,
    (_request, response) => {
      clearAdminCookies(response, config);
      response.setHeader('Cache-Control', 'no-store');
      response.json({ status: 'logged_out' });
    },
  );

  return router;
}
