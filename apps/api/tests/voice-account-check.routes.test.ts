import { createLogger } from '../src/lib/logger.js';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../src/config/env.js';
import type { AccountCheckOutcome } from '../src/core/session/session-ports.js';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import { createOpaqueToken } from '../src/lib/tokens.js';
import { createVoiceSessionRouter } from '../src/modules/voice-sessions/voice-session.routes.js';
import type {
  VoiceSessionRecord,
  VoiceSessionRepository,
} from '../src/modules/voice-sessions/voice-session.repository.js';
import type { CustomerLookupResult } from '../src/platform/customer-directory.js';

const logger = createLogger({ level: 'silent', service: 'account-check-test' });

const config: ApiConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsAllowedOrigins: [],
  logLevel: 'silent',
  mongoUri: 'mongodb://127.0.0.1:27017/tutwithus_test',
  redisUrl: 'redis://127.0.0.1:6379',
  workerConcurrency: 5,
  adminJwtSecret: 'test-admin-jwt-secret-at-least-32-characters',
  adminJwtSecretIsEphemeral: false,
  adminJwtTtlDays: 1,
  openai: {
    apiKey: 'test-key',
    realtimeModel: 'test-model',
    embeddingModel: 'text-embedding-3-small',
  },
  elevenLabs: {
    apiKey: undefined,
    saudiArabicVoiceId: undefined,
    modelId: 'm',
  },
  consentVersion: '2026-11-04.1',
  consentText: { 'ar-SA': 'test', en: 'test', fr: 'test' },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
};

const sessionId = '44f887b3-14b8-4f82-a18f-69e5d8215c7c';
const validBody = { memberId: 'tw-user-1001' };

function createApp(
  lookup: CustomerLookupResult,
  options: {
    allowAttempt?: boolean;
    started?: boolean;
    verified?: boolean;
    loginResult?:
      | { status: 'verified'; accessToken: string; role: string }
      | { status: 'not_verified' }
      | { status: 'unavailable' };
  } = {},
) {
  const token = createOpaqueToken();
  const now = new Date();
  const record: VoiceSessionRecord = {
    phoneOwnershipVerified: true,
    sessionId,
    locale: 'en',
    consentVersion: config.consentVersion,
    consentAccepted: true,
    transcript: [],
    sessionTokenHash: token.hash,
    acceptedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 600_000),
    expiresAt: new Date(now.getTime() + 86_400_000),
    callbackPhone: '+966 50 000 0001',
    callerAccountStatus: lookup.status,
    ...(lookup.status === 'registered'
      ? { callerCustomerId: lookup.customerId }
      : {}),
    ...(options.started === false ? {} : { startedAt: now }),
    ...(options.verified
      ? {
          verifiedCustomer: {
            customerId: 'customer-1',
            verifiedAt: now,
            via: 'form' as const,
          },
        }
      : {}),
  };
  const repository = {
    findBySessionId: vi.fn(async () => record),
    reserveAccountCheck: vi.fn(async () => options.allowAttempt ?? true),
    markCustomerVerified: vi.fn(async () => undefined),
    endCall: vi.fn(async () => undefined),
  };
  const notifications: Array<
    [string, AccountCheckOutcome, string | undefined, string | undefined]
  > = [];
  const activeCalls = {
    stop: vi.fn(async () => undefined),
    notifyAccountCheck: vi.fn(
      async (
        id: string,
        outcome: AccountCheckOutcome,
        accessToken?: string,
        role?: string,
      ) => {
        notifications.push([id, outcome, accessToken, role]);
      },
    ),
  };
  const directory = {
    lookup: vi.fn(async () => lookup),
    loginMember: vi.fn(
      async () =>
        options.loginResult ??
        (lookup.status === 'registered'
          ? {
              status: 'verified' as const,
              accessToken: 'secret-token',
              role: 'student',
            }
          : {
              status:
                lookup.status === 'not_registered'
                  ? ('not_verified' as const)
                  : ('unavailable' as const),
            }),
    ),
  };
  const voiceBookings = {
    createFromVerifiedSession: vi.fn(async () => ({
      status: 'submitted' as const,
      reference: 'BK-TEST',
    })),
  };
  const app = express();
  app.use(requestContext(logger));
  app.use(
    '/api/v1/voice/sessions',
    createVoiceSessionRouter(
      config,
      repository as unknown as VoiceSessionRepository,
      { getActiveAgentSettings: vi.fn(async () => null) },
      activeCalls,
      directory,
      voiceBookings,
      logger,
    ),
  );
  app.use(createErrorHandler(logger));
  return {
    app,
    token,
    repository,
    activeCalls,
    notifications,
    directory,
    voiceBookings,
  };
}

const accountCheckUrl = `/api/v1/voice/sessions/${sessionId}/account-check`;

describe('POST /voice/sessions/:id/account-check', () => {
  it('returns the account verification result without customer details', async () => {
    const found = createApp({ status: 'registered', customerId: 'c1' });
    const missing = createApp({ status: 'not_registered' });
    const unavailable = createApp({ status: 'unavailable' });

    const responses = await Promise.all(
      [found, missing, unavailable].map((setup) =>
        request(setup.app)
          .post(accountCheckUrl)
          .set('Authorization', `Bearer ${setup.token.token}`)
          .send(validBody),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([
      202, 202, 202,
    ]);
    expect(responses.map((response) => response.body)).toEqual([
      { status: 'submitted', accountStatus: 'verified' },
      { status: 'submitted', accountStatus: 'not_registered' },
      { status: 'submitted', accountStatus: 'unavailable' },
    ]);
    expect(
      JSON.stringify(responses.map((response) => response.body)),
    ).not.toContain('secret-token');
  });

  describe('POST /voice/sessions/:id/booking-requests', () => {
    const bookingBody = {
      tutorId: 'tutor-1',
      tutorName: 'Taylor Tutor',
      subject: 'Mathematics',
      level: 'Grade 8',
      sessionStart: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
      sessionEnd: new Date(Date.now() + 73 * 60 * 60 * 1000).toISOString(),
      timezone: 'Europe/Paris',
    };

    it('creates a request only for a verified, authenticated voice session', async () => {
      const setup = createApp(
        { status: 'registered', customerId: 'customer-1' },
        { verified: true },
      );
      const response = await request(setup.app)
        .post(`/api/v1/voice/sessions/${sessionId}/booking-requests`)
        .set('Authorization', `Bearer ${setup.token.token}`)
        .send(bookingBody);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        status: 'submitted',
        reference: 'BK-TEST',
      });
      expect(
        setup.voiceBookings.createFromVerifiedSession,
      ).toHaveBeenCalledWith(sessionId, bookingBody);
    });

    it('rejects booking requests when the customer is not verified', async () => {
      const setup = createApp({
        status: 'registered',
        customerId: 'customer-1',
      });
      const response = await request(setup.app)
        .post(`/api/v1/voice/sessions/${sessionId}/booking-requests`)
        .set('Authorization', `Bearer ${setup.token.token}`)
        .send(bookingBody);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CUSTOMER_NOT_VERIFIED');
      expect(
        setup.voiceBookings.createFromVerifiedSession,
      ).not.toHaveBeenCalled();
    });
  });

  it('tells the live call the real result', async () => {
    const found = createApp({ status: 'registered', customerId: 'c1' });
    await request(found.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${found.token.token}`)
      .send(validBody);
    const missing = createApp({ status: 'not_registered' });
    await request(missing.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${missing.token.token}`)
      .send(validBody);

    expect(found.notifications).toEqual([
      [sessionId, 'verified', 'secret-token', 'student'],
    ]);
    expect(missing.notifications).toEqual([
      [sessionId, 'not_registered', undefined, undefined],
    ]);
    expect(found.repository.markCustomerVerified).toHaveBeenCalledOnce();
    expect(missing.repository.markCustomerVerified).not.toHaveBeenCalled();
    expect(found.directory.loginMember).toHaveBeenCalledWith({
      phone: '966500000001',
      memberId: validBody.memberId,
    });
    expect(found.directory.lookup).not.toHaveBeenCalled();
  });

  it('returns 429 once the per-call attempts are used up', async () => {
    const setup = createApp(
      { status: 'registered', customerId: 'c1' },
      { allowAttempt: false },
    );
    const response = await request(setup.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${setup.token.token}`)
      .send(validBody);

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('ACCOUNT_CHECK_LIMIT');
    expect(setup.directory.loginMember).not.toHaveBeenCalled();
  });

  it('requires the session token', async () => {
    const setup = createApp({ status: 'registered', customerId: 'c1' });

    const missing = await request(setup.app)
      .post(accountCheckUrl)
      .send(validBody);
    const wrong = await request(setup.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${createOpaqueToken().token}`)
      .send(validBody);

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(setup.directory.loginMember).not.toHaveBeenCalled();
  });

  it('accepts an account check before the call starts', async () => {
    const setup = createApp(
      { status: 'registered', customerId: 'c1' },
      { started: false },
    );
    const response = await request(setup.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${setup.token.token}`)
      .send(validBody);

    expect(response.status).toBe(202);
    expect(response.body.accountStatus).toBe('verified');
    expect(setup.directory.loginMember).toHaveBeenCalledOnce();
  });

  it.each([
    ['an empty member ID', { ...validBody, memberId: ' ' }],
    ['a member ID that is too long', { memberId: 'x'.repeat(129) }],
    ['a missing member ID', {}],
    [
      'a browser-supplied phone number',
      { ...validBody, phone: '+966500000001' },
    ],
    ['an unexpected field', { ...validBody, isAdmin: true }],
  ])('rejects %s', async (_label, body) => {
    const setup = createApp({ status: 'registered', customerId: 'c1' });
    const response = await request(setup.app)
      .post(accountCheckUrl)
      .set('Authorization', `Bearer ${setup.token.token}`)
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(setup.repository.reserveAccountCheck).not.toHaveBeenCalled();
    expect(setup.directory.lookup).not.toHaveBeenCalled();
  });
});

describe('POST /voice/sessions/:id/end', () => {
  it('hangs up the live call when the visitor ends the session', async () => {
    const setup = createApp({ status: 'not_registered' });
    const response = await request(setup.app)
      .post(`/api/v1/voice/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${setup.token.token}`)
      .send({ reason: 'page_closed' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ended' });
    expect(setup.activeCalls.stop).toHaveBeenCalledWith(
      sessionId,
      'page_closed',
    );
  });

  it('defaults the reason and does not hang up for an invalid token', async () => {
    const setup = createApp({ status: 'not_registered' });
    await request(setup.app)
      .post(`/api/v1/voice/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${setup.token.token}`)
      .send({});
    expect(setup.activeCalls.stop).toHaveBeenCalledWith(
      sessionId,
      'user_ended',
    );

    const other = createApp({ status: 'not_registered' });
    const rejected = await request(other.app)
      .post(`/api/v1/voice/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${createOpaqueToken().token}`)
      .send({});
    expect(rejected.status).toBe(401);
    expect(other.activeCalls.stop).not.toHaveBeenCalled();
  });
});
