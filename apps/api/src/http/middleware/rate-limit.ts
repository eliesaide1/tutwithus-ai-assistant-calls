import rateLimit from 'express-rate-limit';
import { ApiError, sendError } from '../errors.js';

type RateLimitOptions = {
  windowMs: number;
  limit: number;
  message: string;
};

// Per-IP limit kept in process memory. Task 1.4 moves the store to Redis
// so the limit holds across several API instances.
export function rateLimitPerIp({ windowMs, limit, message }: RateLimitOptions) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) => {
      sendError(response, new ApiError(429, 'RATE_LIMITED', message));
    },
  });
}
