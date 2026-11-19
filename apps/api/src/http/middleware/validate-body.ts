import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { parseInput } from '../validation.js';

// Rejects the request with 400 unless the body matches the schema,
// then replaces request.body with the parsed (typed, stripped) value.
export function validateBody(schema: z.ZodType): RequestHandler {
  return (request, _response, next) => {
    request.body = parseInput(schema, request.body);
    next();
  };
}
