import { errorName, type Logger } from '../../lib/logger.js';
import type { Response } from 'express';
import {
  ApiError,
  dependencyUnavailable,
  requestId,
} from '../../http/errors.js';
import { RealtimeProviderError } from '../../lib/openai/realtime-client.js';
import { VoiceSessionError } from './voice-session.service.js';

export function toVoiceSessionApiError(
  error: unknown,
  response: Response,
  logger: Logger,
  source: string,
): unknown {
  if (!(error instanceof VoiceSessionError)) {
    return error;
  }

  if (error.code === 'PERSISTENCE_FAILED') {
    logger.error(
      {
        source,
        requestId: requestId(response),
        errorName: errorName(error.cause),
      },
      'Voice session persistence failed',
    );
    return dependencyUnavailable();
  }

  if (error.code === 'SESSION_UNAUTHORIZED') {
    return new ApiError(401, error.code, error.message);
  }
  if (error.code === 'CUSTOMER_NOT_VERIFIED') {
    return new ApiError(403, error.code, error.message);
  }
  if (error.code === 'ACCOUNT_CHECK_LIMIT') {
    return new ApiError(429, error.code, error.message);
  }
  if (error.code === 'SESSION_ALREADY_USED') {
    return new ApiError(409, error.code, error.message);
  }
  if (
    error.code === 'OPENAI_NOT_CONFIGURED' ||
    error.code === 'CALL_CAPACITY_REACHED'
  ) {
    return new ApiError(503, error.code, error.message);
  }
  if (error.code === 'REALTIME_UNAVAILABLE') {
    const providerError =
      error.cause instanceof RealtimeProviderError ? error.cause : undefined;
    logger.warn(
      {
        source,
        requestId: requestId(response),
        errorName: errorName(error.cause),
        ...(providerError
          ? {
              providerStatus: providerError.providerDetails.status,
              providerCode: providerError.providerDetails.code,
              providerParam: providerError.providerDetails.param,
              providerType: providerError.providerDetails.type,
              providerRequestId: providerError.providerDetails.requestId,
              providerMessage: providerError.providerDetails.message,
              ...(providerError.offerDiagnostics
                ? { offer: providerError.offerDiagnostics }
                : {}),
            }
          : {}),
      },
      'OpenAI voice session creation failed',
    );
    return new ApiError(502, error.code, error.message);
  }

  return new ApiError(422, error.code, error.message);
}
