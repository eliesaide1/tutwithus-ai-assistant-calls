import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../../lib/logger.js';

export function requestContext(logger: Logger): RequestHandler {
  return (request, response, next) => {
    response.locals.requestId = randomUUID();
    response.setHeader('X-Request-Id', response.locals.requestId);
    const path = request.path;
    logger.info(
      {
        requestId: response.locals.requestId,
        method: request.method,
        path,
      },
      'HTTP request started',
    );
    response.on('finish', () => {
      logger.info(
        {
          requestId: response.locals.requestId,
          method: request.method,
          path,
          statusCode: response.statusCode,
        },
        'HTTP request completed',
      );
    });
    next();
  };
}
