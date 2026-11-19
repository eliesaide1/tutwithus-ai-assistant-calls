import { Router } from 'express';
import { errorName, type Logger } from '../lib/logger.js';
import { dependencyUnavailable, requestId } from './errors.js';

export type ReadinessCheck = {
  name: string;
  check: () => Promise<void>;
};

export function createHealthRouter(
  readinessChecks: ReadinessCheck[],
  logger: Logger,
) {
  const router = Router();

  // Liveness: the process is running. Never touches dependencies.
  router.get('/healthz', (_request, response) => {
    response.json({ status: 'ok' });
  });

  // Readiness: every dependency the API needs is reachable.
  router.get('/readyz', async (_request, response) => {
    for (const { name, check } of readinessChecks) {
      try {
        await check();
      } catch (error) {
        logger.error(
          {
            requestId: requestId(response),
            source: 'apps/api/src/http/health.routes.ts',
            check: name,
            errorName: errorName(error),
          },
          'Readiness dependency check failed',
        );
        throw dependencyUnavailable();
      }
    }

    response.json({ status: 'ready' });
  });

  return router;
}
