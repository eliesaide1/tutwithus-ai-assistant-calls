import type { RequestHandler } from 'express';

const ALLOWED_METHODS = 'GET, HEAD, POST, PATCH, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, X-CSRF-Token, X-Timezone, Authorization';

export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const origins = new Set(allowedOrigins);

  return (request, response, next) => {
    response.vary('Origin');
    const origin = request.get('Origin');

    if (origin && origins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');

      if (request.method === 'OPTIONS') {
        response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
        response.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
        response.setHeader('Access-Control-Max-Age', '600');
        response.status(204).end();
        return;
      }
    } else if (request.method === 'OPTIONS') {
      response.status(204).end();
      return;
    }

    next();
  };
}
