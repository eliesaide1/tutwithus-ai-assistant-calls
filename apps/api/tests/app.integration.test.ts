import { createLogger } from '../src/lib/logger.js';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../src/config/env.js';
import { createApp } from '../src/http/app.js';
import type { ReadinessCheck } from '../src/http/health.routes.js';
import { MongoAdminUserRepository } from '../src/modules/admin-users/admin-user.repository.js';
import { MongoAuditRepository } from '../src/modules/audit/audit.repository.js';
import { MongoBookingRepository } from '../src/modules/bookings/booking.repository.js';
import { MongoEscalationRepository } from '../src/modules/escalations/escalation.repository.js';
import type { AgentSettingsRepository } from '../src/modules/settings/agent-settings.repository.js';
import type { AgentSettingsRecord } from '../src/modules/settings/agent-settings.model.js';
import { KnowledgeIngestionService } from '../src/modules/knowledge/knowledge-ingestion.service.js';
import { MongoKnowledgeRepository } from '../src/modules/knowledge/knowledge.repository.js';
import type {
  VoiceSessionRecord,
  VoiceSessionRepository,
} from '../src/modules/voice-sessions/voice-session.repository.js';
import { ActiveCallRegistry } from '../src/core/session/active-calls.js';
import { ToolGateway } from '../src/core/tools/tool-gateway.js';
import { NoopCustomerDirectory } from '../src/platform/noop-customer-directory.js';
import { NoopPlatformAdapter } from '../src/platform/noop-platform-adapter.js';
import {
  RealtimeProviderError,
  type RealtimeProvider,
} from '../src/lib/openai/realtime-client.js';

const config: ApiConfig = {
  port: 3000,
  trustProxyHops: 0,
  corsAllowedOrigins: [
    'https://len-strict-covering-techniques.trycloudflare.com',
  ],
  mongoUri: 'mongodb://127.0.0.1:27017/tutwithus_test',
  redisUrl: 'redis://127.0.0.1:6379',
  workerConcurrency: 5,
  openai: {
    apiKey: 'test-key',
    realtimeModel: 'gpt-realtime-2.1-mini',
    embeddingModel: 'text-embedding-3-small',
  },
  consentVersion: '2026-11-03.1',
  consentText: {
    'ar-SA': 'إشعار تجريبي',
    en: 'Development test notice',
    fr: 'Avis de test de développement',
  },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
  logLevel: 'silent',
  nodeEnv: 'test',
  adminJwtSecret: 'test-admin-jwt-secret-at-least-32-characters',
  adminJwtSecretIsEphemeral: false,
  adminJwtTtlDays: 1,
};

function createRepository() {
  const records: VoiceSessionRecord[] = [];
  const repository: VoiceSessionRepository = {
    create: vi.fn(async (record) => {
      records.push(record);
    }),
    findBySessionId: vi.fn(async (sessionId) => {
      return records.find((record) => record.sessionId === sessionId) ?? null;
    }),
    startCall: vi.fn(async (input) => {
      const record = records.find(
        (candidate) =>
          candidate.sessionId === input.sessionId &&
          candidate.sessionTokenHash === input.sessionTokenHash &&
          candidate.tokenExpiresAt > input.startedAt &&
          !candidate.startedAt &&
          !candidate.endedAt,
      );
      if (!record) {
        return false;
      }
      record.startedAt = input.startedAt;
      record.callExpiresAt = input.callExpiresAt;
      return true;
    }),
    endCall: vi.fn(async (input) => {
      const record = records.find(
        (candidate) =>
          candidate.sessionId === input.sessionId &&
          candidate.sessionTokenHash === input.sessionTokenHash,
      );
      if (record && !record.endedAt) {
        record.endedAt = input.endedAt;
        record.endReason = input.reason;
      }
    }),
    appendTranscript: vi.fn(async (input) => {
      const record = records.find(
        (candidate) =>
          candidate.sessionId === input.sessionId &&
          candidate.sessionTokenHash === input.sessionTokenHash,
      );
      if (!record?.startedAt || record.endedAt) {
        return false;
      }
      if (
        record.transcript.some((entry) => entry.eventId === input.entry.eventId)
      ) {
        return true;
      }
      record.transcript.push({ ...input.entry, receivedAt: input.receivedAt });
      return true;
    }),
    reserveAccountCheck: vi.fn(async () => true),
    markCustomerVerified: vi.fn(async () => undefined),
    attachProviderCall: vi.fn(async (input) => {
      const record = records.find(
        (candidate) => candidate.sessionId === input.sessionId,
      );
      if (record) {
        record.providerCallId = input.providerCallId;
      }
    }),
    recordCallOutcome: vi.fn(async (input) => {
      const record = records.find(
        (candidate) => candidate.sessionId === input.sessionId,
      );
      if (record) {
        record.flags = [
          ...(record.flags ?? []),
          ...(input.outcome.flags ?? []),
        ];
        if (input.outcome.usage) {
          record.usage = input.outcome.usage;
        }
      }
    }),
    listAdminConversations: vi.fn(async () => []),
    findAdminConversation: vi.fn(async () => null),
  };
  return { repository, records };
}

function createRealtimeProvider(): RealtimeProvider {
  return {
    createCall: vi.fn(async () => ({
      sdp: 'v=0\r\nanswer',
      callId: 'rtc_test_call',
    })),
    openSideband: vi.fn(async () => ({ send: vi.fn(), close: vi.fn() })),
    hangup: vi.fn(async () => undefined),
  };
}

function createDatabaseCheck() {
  return {
    name: 'mongodb',
    check: vi.fn(async () => undefined),
  } satisfies ReadinessCheck;
}

function createSettingsStore(
  active: AgentSettingsRecord | null = null,
): AgentSettingsRepository {
  return {
    getSettings: vi.fn(async () => ({ active, drafts: [] })),
    saveSettingsDraft: vi.fn(async (settings) => ({
      ...settings,
      version: 1,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    updateSettingsDraft: vi.fn(async () => null),
    deleteSettingsDraft: vi.fn(async () => false),
    activateSettings: vi.fn(async () => false),
  };
}

function appFor(
  repository: VoiceSessionRepository,
  readinessChecks: ReadinessCheck[] = [createDatabaseCheck()],
  realtimeProvider: RealtimeProvider = createRealtimeProvider(),
  apiConfig: ApiConfig = config,
  settingsRepository: AgentSettingsRepository = createSettingsStore(),
) {
  const knowledgeRepository = new MongoKnowledgeRepository();
  return createApp({
    config: apiConfig,
    logger: createLogger({ level: 'silent', service: 'test' }),
    maintenanceJobs: {
      requestPing: vi.fn(async () => ({ status: 'processed' as const })),
      close: vi.fn(async () => undefined),
    },
    readinessChecks,
    voiceSessionRepository: repository,
    realtimeProvider,
    // The admin routes aren't exercised here; these are never called.
    adminUserRepository: new MongoAdminUserRepository(),
    bookingRepository: new MongoBookingRepository(),
    escalationRepository: new MongoEscalationRepository(),
    settingsRepository,
    auditRepository: new MongoAuditRepository(),
    knowledgeRepository,
    toolGateway: new ToolGateway(
      [],
      { record: vi.fn(async () => undefined) },
      createLogger({ level: 'silent', service: 'test' }),
    ),
    liveCalls: {
      acquire: vi.fn(async () => true),
      release: vi.fn(async () => undefined),
    },
    activeCalls: new ActiveCallRegistry(),
    platformAdapter: new NoopPlatformAdapter(),
    customerDirectory: new NoopCustomerDirectory(),
    knowledgeIngestion: new KnowledgeIngestionService(
      apiConfig,
      knowledgeRepository,
      undefined,
    ),
  });
}

function validRequest() {
  return {
    locale: 'en',
    consentVersion: config.consentVersion,
    consentAccepted: true,
  };
}

describe('API health and readiness', () => {
  it('allows the configured browser origin and credentialed preflight requests', async () => {
    const { repository } = createRepository();
    const response = await request(appFor(repository))
      .options('/api/v1/admin/auth/login')
      .set('Origin', 'https://len-strict-covering-techniques.trycloudflare.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://len-strict-covering-techniques.trycloudflare.com',
    );
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']).toContain(
      'X-CSRF-Token',
    );
  });

  it('does not grant CORS access to an unconfigured origin', async () => {
    const { repository } = createRepository();
    const response = await request(appFor(repository))
      .options('/api/v1/admin/auth/login')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('serves liveness without requiring database access', async () => {
    const { repository } = createRepository();
    const databaseCheck = createDatabaseCheck();
    const response = await request(appFor(repository, [databaseCheck])).get(
      '/healthz',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(databaseCheck.check).not.toHaveBeenCalled();
  });

  it('returns ready when its database is reachable', async () => {
    const { repository } = createRepository();
    const databaseCheck = createDatabaseCheck();
    const response = await request(appFor(repository, [databaseCheck])).get(
      '/readyz',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ready' });
    expect(databaseCheck.check).toHaveBeenCalledOnce();
  });

  it('returns the standard error envelope when the database is unavailable', async () => {
    const { repository } = createRepository();
    const databaseCheck = createDatabaseCheck();
    databaseCheck.check.mockRejectedValue(new Error('database offline'));

    const response = await request(appFor(repository, [databaseCheck])).get(
      '/readyz',
    );

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      requestId: expect.any(String),
    });
  });
});

describe('public consent and session endpoints', () => {
  it('returns cacheable public configuration matching the contract', async () => {
    const { repository } = createRepository();
    const response = await request(appFor(repository)).get(
      '/api/v1/public/config',
    );

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({
      languages: ['ar-SA', 'en', 'fr'],
      consentVersion: config.consentVersion,
      consentText: config.consentText,
      maxCallSec: config.maxCallSec,
    });
  });

  it('inserts the configured transcript retention into the consent notice', async () => {
    const { repository } = createRepository();
    const configuredApp = appFor(repository, undefined, undefined, {
      ...config,
      consentText: {
        'ar-SA': 'حفظ النص {retentionDays} يومًا',
        en: 'Transcript retained for {retentionDays} days.',
        fr: 'Transcription conservée {retentionDays} jours.',
      },
    });
    const response = await request(configuredApp).get('/api/v1/public/config');

    expect(response.body.consentText).toEqual({
      'ar-SA': 'حفظ النص 30 يومًا',
      en: 'Transcript retained for 30 days.',
      fr: 'Transcription conservée 30 jours.',
    });
  });

  it('records accepted consent and returns a short-lived opaque token', async () => {
    const { repository, records } = createRepository();
    const response = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      sessionId: expect.any(String),
      sessionToken: expect.any(String),
      maxDurationSec: config.maxCallSec,
    });
    expect(response.body.sessionToken).toHaveLength(43);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      locale: 'en',
      consentVersion: config.consentVersion,
      consentAccepted: true,
      transcript: [],
    });
    expect(records[0].acceptedAt).toBeInstanceOf(Date);
    expect(records[0].sessionTokenHash).not.toBe(response.body.sessionToken);
    expect(records[0].tokenExpiresAt.getTime()).toBe(
      records[0].acceptedAt.getTime() + (config.maxCallSec + 180) * 1000,
    );
    expect(records[0].expiresAt.getTime()).toBe(
      records[0].acceptedAt.getTime() +
        config.retentionDays * 24 * 60 * 60 * 1000,
    );
  });

  it('returns a dependency error instead of success when persistence fails', async () => {
    const { repository } = createRepository();
    vi.mocked(repository.create).mockRejectedValue(
      new Error('database offline'),
    );

    const response = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('rejects missing/false consent and unknown fields without persistence', async () => {
    const { repository, records } = createRepository();

    const missingConsent = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send({ ...validRequest(), consentAccepted: false });
    const extraField = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send({ ...validRequest(), unexpected: true });

    expect(missingConsent.status).toBe(400);
    expect(missingConsent.body.error.code).toBe('VALIDATION_ERROR');
    expect(extraField.status).toBe(400);
    expect(extraField.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.create).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it('rejects a stale consent version without persistence', async () => {
    const { repository, records } = createRepository();
    const response = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send({ ...validRequest(), consentVersion: '2026-10-01.1' });

    expect(response.status).toBe(422);
    expect(response.body.error).toMatchObject({
      code: 'CONSENT_VERSION_STALE',
      requestId: expect.any(String),
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it('does not silently accept a captcha token without a verifier', async () => {
    const { repository, records } = createRepository();
    const response = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .send({ ...validRequest(), captchaToken: 'unverified-token' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('CAPTCHA_NOT_CONFIGURED');
    expect(repository.create).not.toHaveBeenCalled();
    expect(records).toHaveLength(0);
  });

  it('relays a valid SDP offer to OpenAI using the server-side provider', async () => {
    const { repository, records } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      sdp: 'v=0\r\nanswer',
      greeting: 'Thank you for calling TutWithUs. How may I help you today?',
    });
    expect(realtimeProvider.createCall).toHaveBeenCalledWith(
      {
        sdp: 'v=0\r\noffer',
        model: 'gpt-realtime-2.1-mini',
        session: expect.objectContaining({
          instructions: expect.stringContaining('Speak clear, natural English'),
          outputModalities: ['audio'],
          transcriptionModel: 'gpt-transcribe',
          voice: 'marin',
        }),
      },
      expect.any(AbortSignal),
    );
    expect(records[0]).toMatchObject({
      startedAt: expect.any(Date),
    });
  });

  it('uses the active agent voice and Saudi Arabic instructions', async () => {
    const activeSettings: AgentSettingsRecord = {
      name: 'Active settings',
      version: 1,
      status: 'active',
      greeting: {
        'ar-SA': 'يا هلا، كيف أقدر أخدمك؟',
        en: 'Hello, how can I help?',
        fr: 'Bonjour, comment puis-je vous aider ?',
      },
      instructionTemplate: 'Explain tutoring options clearly.',
      voice: 'coral',
      maxCallSec: 420,
      businessHours: 'Monday to Friday',
      escalation: { hoursText: 'During business hours' },
      activatedBy: 'admin-id',
      activatedAt: new Date('2026-11-04T10:00:00.000Z'),
      createdAt: new Date('2026-11-04T09:00:00.000Z'),
      updatedAt: new Date('2026-11-04T10:00:00.000Z'),
    };
    const settingsRepository = createSettingsStore(activeSettings);
    const realtimeProvider = createRealtimeProvider();
    const { repository, records } = createRepository();
    const app = appFor(
      repository,
      [createDatabaseCheck()],
      realtimeProvider,
      {
        ...config,
        consentText: {
          'ar-SA': 'حفظ النص {retentionDays} يومًا',
          en: 'Transcript retained for {retentionDays} days.',
          fr: 'Transcription conservée {retentionDays} jours.',
        },
      },
      settingsRepository,
    );
    const publicConfig = await request(app).get('/api/v1/public/config');
    expect(publicConfig.body.maxCallSec).toBe(420);
    expect(publicConfig.body.consentText.en).toBe(
      'Transcript retained for 30 days.',
    );
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send({ ...validRequest(), locale: 'ar-SA' });

    expect(session.body.maxDurationSec).toBe(420);
    expect(records[0]?.maxDurationSec).toBe(420);
    expect(records[0]?.expiresAt.getTime()).toBe(
      records[0]!.acceptedAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(201);
    expect(response.body.greeting).toBe('يا هلا، كيف أقدر أخدمك؟');
    expect(settingsRepository.getSettings).toHaveBeenCalledTimes(3);
    expect(realtimeProvider.createCall).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          instructions: expect.stringContaining(
            'تحدث بالعربية السعودية الطبيعية',
          ),
          voice: 'coral',
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(realtimeProvider.createCall).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          instructions: expect.stringContaining(
            'Explain tutoring options clearly.',
          ),
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(records[0]?.callExpiresAt?.getTime()).toBe(
      records[0]!.startedAt!.getTime() + 420 * 1000,
    );
    expect(realtimeProvider.createCall).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          instructions: expect.stringContaining('Monday to Friday'),
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(realtimeProvider.createCall).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          instructions: expect.stringContaining('During business hours'),
        }),
      }),
      expect.any(AbortSignal),
    );
  });

  it('stores authorized completed transcript entries on the voice session', async () => {
    const { repository, records } = createRepository();
    const app = appFor(repository);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());
    const token = session.body.sessionToken as string;
    await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sdp: 'v=0\r\noffer' });

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/transcript`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        eventId: 'user:item-1',
        speaker: 'user',
        text: 'Hello, I need help.',
      });
    const retry = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/transcript`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        eventId: 'user:item-1',
        speaker: 'user',
        text: 'Hello, I need help.',
      });

    expect(response.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(response.body).toEqual({ status: 'stored' });
    expect(records[0]?.transcript).toEqual([
      {
        eventId: 'user:item-1',
        speaker: 'user',
        text: 'Hello, I need help.',
        receivedAt: expect.any(Date),
      },
    ]);
    await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/end`)
      .set('Authorization', 'Bearer ' + token)
      .send({ reason: 'user_ended' });
    const lateEntry = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/transcript`)
      .set('Authorization', 'Bearer ' + token)
      .send({
        eventId: 'assistant:item-2',
        speaker: 'assistant',
        text: 'Goodbye.',
      });
    expect(lateEntry.status).toBe(409);
  });

  it('rejects invalid session tokens before contacting OpenAI', async () => {
    const { repository } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', 'Bearer invalid-token')
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_UNAUTHORIZED');
    expect(realtimeProvider.createCall).not.toHaveBeenCalled();
  });

  it('rejects expired session tokens before contacting OpenAI', async () => {
    const { repository, records } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());
    records[0]!.tokenExpiresAt = new Date(Date.now() - 1);

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('SESSION_UNAUTHORIZED');
    expect(realtimeProvider.createCall).not.toHaveBeenCalled();
  });

  it('rejects malformed SDP without contacting OpenAI', async () => {
    const { repository } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: '  ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(realtimeProvider.createCall).not.toHaveBeenCalled();
  });

  it('rejects session starts after the initial start window expires', async () => {
    const { repository, records } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());
    records[0]!.acceptedAt = new Date(Date.now() - 2 * 60 * 1000);

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(401);
    expect(realtimeProvider.createCall).not.toHaveBeenCalled();
  });

  it('limits SDP connection attempts by API-observed IP', async () => {
    const { repository } = createRepository();
    const app = appFor(repository);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());
    const connectionRequest = () =>
      request(app)
        .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
        .set('Authorization', 'Bearer invalid-token')
        .send({ sdp: 'v=0\r\noffer' });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await connectionRequest()).status).toBe(401);
    }
    const limited = await connectionRequest();
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not contact OpenAI when the API key is not configured', async () => {
    const { repository } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider, {
      ...config,
      openai: { ...config.openai, apiKey: undefined },
    });
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('OPENAI_NOT_CONFIGURED');
    expect(realtimeProvider.createCall).not.toHaveBeenCalled();
  });

  it('rejects a second connection attempt for the same consent session', async () => {
    const { repository } = createRepository();
    const app = appFor(repository);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());
    const connect = () =>
      request(app)
        .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
        .set('Authorization', `Bearer ${session.body.sessionToken}`)
        .send({ sdp: 'v=0\r\noffer' });

    expect((await connect()).status).toBe(201);
    const retry = await connect();
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('SESSION_ALREADY_USED');
  });

  it('ends a session using its short-lived bearer token', async () => {
    const { repository, records } = createRepository();
    const app = appFor(repository);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/end`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ reason: 'user_ended' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ended' });
    expect(records[0]).toMatchObject({
      endedAt: expect.any(Date),
      endReason: 'user_ended',
    });
  });

  it('returns a provider error and marks the session ended on failure', async () => {
    const { repository, records } = createRepository();
    const realtimeProvider = createRealtimeProvider();
    vi.mocked(realtimeProvider.createCall).mockRejectedValue(
      new RealtimeProviderError('provider is unavailable'),
    );
    const app = appFor(repository, [createDatabaseCheck()], realtimeProvider);
    const session = await request(app)
      .post('/api/v1/voice/sessions')
      .send(validRequest());

    const response = await request(app)
      .post(`/api/v1/voice/sessions/${session.body.sessionId}/connect`)
      .set('Authorization', `Bearer ${session.body.sessionToken}`)
      .send({ sdp: 'v=0\r\noffer' });

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('REALTIME_UNAVAILABLE');
    expect(records[0]).toMatchObject({
      endedAt: expect.any(Date),
      endReason: 'connection_failed',
    });
  });

  it('limits session creation to five requests per ten minutes', async () => {
    const { repository } = createRepository();
    const app = appFor(repository);
    const responses = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await request(app).post('/api/v1/voice/sessions').send(validRequest()),
      );
    }

    expect(
      responses.slice(0, 5).every((response) => response.status === 201),
    ).toBe(true);
    expect(responses[5]?.status).toBe(429);
    expect(responses[5]?.body.error.code).toBe('RATE_LIMITED');
    expect(repository.create).toHaveBeenCalledTimes(5);
  });

  it('returns a request ID for errors and rejects malformed JSON', async () => {
    const { repository } = createRepository();
    const response = await request(appFor(repository))
      .post('/api/v1/voice/sessions')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(response.status).toBe(400);
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
    expect(response.body.error).toMatchObject({
      code: 'INVALID_JSON',
      requestId: response.headers['x-request-id'],
    });
  });
});
