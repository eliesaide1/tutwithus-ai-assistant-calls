import { ApiErrorEnvelopeSchema } from '@tutwithus/contracts';
import type { ErrorRequestHandler, Response } from 'express';
import { errorName, type Logger } from '../lib/logger.js';

// An error that is safe to send to the client in the standard envelope.
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function dependencyUnavailable(): ApiError {
  return new ApiError(
    503,
    'DEPENDENCY_UNAVAILABLE',
    'A required service is unavailable.',
  );
}

export function requestId(response: Response): string {
  return response.locals.requestId as string;
}

export function sendError(response: Response, error: ApiError): void {
  const envelope = ApiErrorEnvelopeSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      requestId: requestId(response),
      ...(error.details ? { details: error.details } : {}),
    },
  });
  response.status(error.statusCode).json(envelope);
}

// Maps errors raised by express.json() to client errors.
function fromBodyParserError(error: unknown): ApiError | undefined {
  const type =
    typeof error === 'object' && error !== null && 'type' in error
      ? error.type
      : undefined;

  if (type === 'entity.parse.failed') {
    return new ApiError(
      400,
      'INVALID_JSON',
      'The request body is not valid JSON.',
    );
  }
  if (type === 'entity.too.large') {
    return new ApiError(
      413,
      'REQUEST_TOO_LARGE',
      'The request body exceeds the allowed size.',
    );
  }
  return undefined;
}

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, _request, response, _next) => {
    if (response.headersSent) {
      return;
    }

    const knownError =
      error instanceof ApiError ? error : fromBodyParserError(error);
    if (knownError) {
      sendError(response, knownError);
      return;
    }

    logger.error(
      {
        source: 'http',
        requestId: requestId(response),
        errorName: errorName(error),
      },
      'Unhandled API request error',
    );
    sendError(
      response,
      new ApiError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.'),
    );
  };
}
