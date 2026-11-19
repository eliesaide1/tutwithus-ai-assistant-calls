import { VoiceSessionIdSchema } from '@tutwithus/contracts';
import type { Request } from 'express';
import { ApiError } from '../../http/errors.js';

export function parseVoiceSessionId(value: string | string[]): string {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The session ID is invalid.');
  }
  const parsed = VoiceSessionIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'The session ID is invalid.');
  }
  return parsed.data;
}

export function readVoiceSessionToken(request: Request): string {
  const authorization = request.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new ApiError(
      401,
      'SESSION_UNAUTHORIZED',
      'The voice session is invalid or expired.',
    );
  }
  return authorization.slice('Bearer '.length);
}
