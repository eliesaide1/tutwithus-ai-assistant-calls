import express from 'express';
import type { AppDependencies } from './app-dependencies.js';
import { createErrorHandler } from './errors.js';
import { createHealthRouter } from './health.routes.js';
import { cors } from './middleware/cors.js';
import { requestContext } from './middleware/request-context.js';
import { createApiRoutes } from './routes/api.routes.js';

export function createApp(deps: AppDependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.config.trustProxyHops);
  app.use(requestContext(deps.logger));
  app.use(cors(deps.config.corsAllowedOrigins));

  app.use(createHealthRouter(deps.readinessChecks, deps.logger));
  app.use('/api/v1', createApiRoutes(deps));
  app.use(createErrorHandler(deps.logger));
  return app;
}
