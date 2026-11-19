import { z } from 'zod';
import { ApiError } from './errors.js';

// Route parameter formats shared by admin modules.
export const ObjectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
export const UuidSchema = z.string().uuid();

export function validationError(message: string, error?: z.ZodError): ApiError {
  return new ApiError(
    400,
    'VALIDATION_ERROR',
    message,
    error
      ? {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }
      : undefined,
  );
}

// Parses untrusted request input (params, query, body) or throws a 400
// VALIDATION_ERROR that lists the failing fields.
export function parseInput<T extends z.ZodType>(
  schema: T,
  value: unknown,
  message = 'The request is invalid.',
): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw validationError(message, parsed.error);
  }
  return parsed.data;
}
