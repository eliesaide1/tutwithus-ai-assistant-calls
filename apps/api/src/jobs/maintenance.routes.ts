import { Router } from 'express';
import type { ApiConfig } from '../config/env.js';
import type { AdminIdentityStore } from '../modules/admin-auth/admin-auth.service.js';
import {
  requireAdmin,
  requireAdminCsrf,
} from '../modules/admin-auth/admin-auth.middleware.js';
import type { MaintenanceJobs } from './maintenance-jobs.js';

export function createMaintenanceRouter(
  config: ApiConfig,
  adminUsers: AdminIdentityStore,
  jobs: MaintenanceJobs,
) {
  const router = Router();

  router.post(
    '/ping',
    requireAdmin(config, adminUsers),
    requireAdminCsrf,
    async (_request, response) => {
      const result = await jobs.requestPing({
        requestedAt: new Date().toISOString(),
        requestedBy: 'admin-http-request',
      });
      response.status(result.status === 'queued' ? 202 : 200).json(result);
    },
  );

  return router;
}
