import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ApiErrorEnvelopeSchema,
  AccountCheckRequestSchema,
  AccountCheckResponseSchema,
  CancelBookingRequestSchema,
  CancelBookingResponseSchema,
  ConfirmBookingRequestSchema,
  ConfirmBookingResponseSchema,
  CreateVoiceSessionRequestSchema,
  CreateVoiceSessionResponseSchema,
  EndVoiceSessionRequestSchema,
  EndVoiceSessionResponseSchema,
  PublicConfigResponseSchema,
  RealtimeConnectionRequestSchema,
  RealtimeConnectionResponseSchema,
  SaveVoiceTranscriptRequestSchema,
  SaveVoiceTranscriptResponseSchema,
  SubmitBookingRequestResponseSchema,
  SubmitBookingRequestSchema,
  VoiceSessionEventSchema,
} from './index.js';

export const registry = new OpenAPIRegistry();

const publicConfigResponse = PublicConfigResponseSchema.meta({
  id: 'PublicConfigResponse',
});
const createVoiceSessionRequest = CreateVoiceSessionRequestSchema.meta({
  id: 'CreateVoiceSessionRequest',
});
const createVoiceSessionResponse = CreateVoiceSessionResponseSchema.meta({
  id: 'CreateVoiceSessionResponse',
});
const endVoiceSessionRequest = EndVoiceSessionRequestSchema.meta({
  id: 'EndVoiceSessionRequest',
});
const endVoiceSessionResponse = EndVoiceSessionResponseSchema.meta({
  id: 'EndVoiceSessionResponse',
});
const confirmBookingRequest = ConfirmBookingRequestSchema.meta({
  id: 'ConfirmBookingRequest',
});
const confirmBookingResponse = ConfirmBookingResponseSchema.meta({
  id: 'ConfirmBookingResponse',
});
const cancelBookingRequest = CancelBookingRequestSchema.meta({
  id: 'CancelBookingRequest',
});
const cancelBookingResponse = CancelBookingResponseSchema.meta({
  id: 'CancelBookingResponse',
});
const realtimeConnectionRequest = RealtimeConnectionRequestSchema.meta({
  id: 'RealtimeConnectionRequest',
});
const realtimeConnectionResponse = RealtimeConnectionResponseSchema.meta({
  id: 'RealtimeConnectionResponse',
});
const saveVoiceTranscriptRequest = SaveVoiceTranscriptRequestSchema.meta({
  id: 'SaveVoiceTranscriptRequest',
});
const saveVoiceTranscriptResponse = SaveVoiceTranscriptResponseSchema.meta({
  id: 'SaveVoiceTranscriptResponse',
});
const accountCheckRequest = AccountCheckRequestSchema.meta({
  id: 'AccountCheckRequest',
});
const accountCheckResponse = AccountCheckResponseSchema.meta({
  id: 'AccountCheckResponse',
});
const submitBookingRequest = SubmitBookingRequestSchema.meta({
  id: 'SubmitBookingRequest',
});
const submitBookingRequestResponse = SubmitBookingRequestResponseSchema.meta({
  id: 'SubmitBookingRequestResponse',
});
const voiceSessionEvent = VoiceSessionEventSchema.meta({
  id: 'VoiceSessionEvent',
});
const apiErrorEnvelope = ApiErrorEnvelopeSchema.meta({
  id: 'ApiErrorEnvelope',
});

registry.registerComponent('securitySchemes', 'VoiceSessionToken', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'short-lived session token',
});

const errorResponse = {
  description: 'A request error.',
  content: {
    'application/json': {
      schema: apiErrorEnvelope,
    },
  },
};

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{sessionId}/account-check',
  summary: 'Check a browser caller account ID for the active voice session',
  description:
    'Returns a coarse match result for the testing website. Does not expose customer identifiers or account details.',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ sessionId: z.string().uuid() }),
    body: {
      required: true,
      content: { 'application/json': { schema: accountCheckRequest } },
    },
  },
  responses: {
    202: {
      description: 'Account check completed.',
      content: { 'application/json': { schema: accountCheckResponse } },
    },
    400: errorResponse,
    401: errorResponse,
    409: errorResponse,
    429: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{sessionId}/booking-requests',
  summary: 'Submit a verified customer booking request for staff review',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ sessionId: z.string().uuid() }),
    body: {
      required: true,
      content: { 'application/json': { schema: submitBookingRequest } },
    },
  },
  responses: {
    201: {
      description: 'Booking request submitted to the admin dashboard.',
      content: {
        'application/json': { schema: submitBookingRequestResponse },
      },
    },
    400: errorResponse,
    401: errorResponse,
    403: errorResponse,
    409: errorResponse,
    422: errorResponse,
    429: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{sessionId}/transcript',
  summary: 'Save a completed voice transcript entry',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ sessionId: z.string().uuid() }),
    body: {
      required: true,
      content: { 'application/json': { schema: saveVoiceTranscriptRequest } },
    },
  },
  responses: {
    201: {
      description: 'Transcript entry was stored on the active voice session.',
      content: {
        'application/json': { schema: saveVoiceTranscriptResponse },
      },
    },
    400: errorResponse,
    401: errorResponse,
    409: errorResponse,
    429: errorResponse,
    503: errorResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/public/config',
  summary: 'Get public voice configuration',
  responses: {
    200: {
      description: 'Supported locales, consent text/version, and call limit.',
      content: { 'application/json': { schema: publicConfigResponse } },
    },
    500: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions',
  summary: 'Create a consented voice session',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: createVoiceSessionRequest } },
    },
  },
  responses: {
    201: {
      description: 'Session created with a short-lived session token.',
      content: { 'application/json': { schema: createVoiceSessionResponse } },
    },
    400: errorResponse,
    422: errorResponse,
    429: errorResponse,
    500: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{sessionId}/connect',
  summary: 'Exchange an SDP offer for an answer',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ sessionId: z.string().uuid() }),
    body: {
      required: true,
      content: {
        'application/json': { schema: realtimeConnectionRequest },
      },
    },
  },
  responses: {
    201: {
      description: 'OpenAI Live SDP answer.',
      content: {
        'application/json': { schema: realtimeConnectionResponse },
      },
    },
    401: errorResponse,
    409: errorResponse,
    429: errorResponse,
    503: errorResponse,
    502: errorResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/voice/sessions/{id}/events',
  summary: 'Stream voice session UI events',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ id: z.string().min(1) }),
  },
  responses: {
    200: {
      description: 'Server-sent events for the voice session.',
      content: {
        'text/event-stream': {
          itemSchema: voiceSessionEvent,
        },
      },
    },
    401: errorResponse,
    404: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{sessionId}/end',
  summary: 'End a voice session',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: z.object({ sessionId: z.string().uuid() }),
    body: {
      required: false,
      content: { 'application/json': { schema: endVoiceSessionRequest } },
    },
  },
  responses: {
    200: {
      description: 'Session ended.',
      content: { 'application/json': { schema: endVoiceSessionResponse } },
    },
    401: errorResponse,
    503: errorResponse,
  },
});

const bookingPathParams = z.object({
  id: z.string().min(1),
  draftId: z.string().min(1),
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{id}/booking-requests/{draftId}/confirm',
  summary: 'Confirm a booking request after its read-back',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: bookingPathParams,
    headers: z.object({ 'Idempotency-Key': z.string().min(1) }),
    body: {
      required: true,
      content: { 'application/json': { schema: confirmBookingRequest } },
    },
  },
  responses: {
    200: {
      description: 'Booking request submitted.',
      content: { 'application/json': { schema: confirmBookingResponse } },
    },
    401: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/voice/sessions/{id}/booking-requests/{draftId}/cancel',
  summary: 'Cancel a booking request',
  security: [{ VoiceSessionToken: [] }],
  request: {
    params: bookingPathParams,
    body: {
      required: true,
      content: { 'application/json': { schema: cancelBookingRequest } },
    },
  },
  responses: {
    200: {
      description: 'Booking request cancelled.',
      content: { 'application/json': { schema: cancelBookingResponse } },
    },
    401: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
