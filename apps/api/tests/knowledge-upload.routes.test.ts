import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../src/config/env.js';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import { createAdminAuthRouter } from '../src/modules/admin-auth/admin-auth.routes.js';
import type { AdminUserRepository } from '../src/modules/admin-users/admin-user.repository.js';
import { hashAdminPassword } from '../src/modules/admin-auth/admin-auth.passwords.js';
import { requireAdmin } from '../src/modules/admin-auth/admin-auth.middleware.js';
import { KnowledgeIngestionService } from '../src/modules/knowledge/knowledge-ingestion.service.js';
import { createKnowledgeRouter } from '../src/modules/knowledge/knowledge.routes.js';
import type { KnowledgeRepository } from '../src/modules/knowledge/knowledge.repository.js';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service.js';
import type { EmbeddingsClient } from '../src/lib/openai/embeddings-client.js';
import { createLogger } from '../src/lib/logger.js';
import type { Locale } from '@tutwithus/contracts';

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
  consentVersion: '2026-11-03.1',
  consentText: { 'ar-SA': 'test', en: 'test', fr: 'test' },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
};

const password = 'correct-horse-battery-staple';
type TestKnowledgeStatus =
  'draft' | 'in_review' | 'approved' | 'published' | 'archived';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('admin knowledge upload route', () => {
  it('requires an authenticated CSRF-verified admin and indexes uploaded text', async () => {
    const passwordHash = await hashAdminPassword(password);
    const knowledgeLanguage: Locale = 'en';
    let knowledgeStatus: TestKnowledgeStatus = 'draft';
    const userRepository: AdminUserRepository = {
      findByEmail: vi.fn(async () => ({
        id: 'admin-user-id',
        email: 'admin@example.com',
        passwordHash,
        role: 'admin' as const,
        disabled: false,
      })),
      findById: vi.fn(async () => ({
        id: 'admin-user-id',
        email: 'admin@example.com',
        role: 'admin' as const,
        disabled: false,
      })),
      create: vi.fn(async () => undefined),
      hasAdmin: vi.fn(async () => true),
      listUsers: vi.fn(async () => []),
      createManagedUser: vi.fn(async () => {
        throw new Error('Not used in this test.');
      }),
      updateManagedUser: vi.fn(async () => null),
      deleteManagedUser: vi.fn(async () => false),
      countEnabledAdmins: vi.fn(async () => 1),
    };
    const save = vi.fn<KnowledgeRepository['save']>(async () => undefined);
    const knowledgeRepository: KnowledgeRepository = {
      save,
      list: vi.fn(async () => []),
      findBySourceId: vi.fn(async () => ({
        sourceId: '4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a',
        originalName: 'source.txt',
        mimeType: 'text/plain',
        sizeBytes: 24,
        language: knowledgeLanguage,
        status: knowledgeStatus,
        chunkCount: 1,
        createdBy: 'admin-user-id',
        createdAt: new Date(),
      })),
      setStatus: vi.fn(async ({ currentStatus, nextStatus }) => {
        if (knowledgeStatus !== currentStatus) {
          return false;
        }
        if (
          nextStatus !== 'draft' &&
          nextStatus !== 'in_review' &&
          nextStatus !== 'approved' &&
          nextStatus !== 'published' &&
          nextStatus !== 'archived'
        ) {
          throw new Error('Unexpected knowledge status in test.');
        }
        knowledgeStatus = nextStatus;
        return true;
      }),
      delete: vi.fn(async () => true),
      searchPublishedChunks: vi.fn(async () => []),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async (texts) =>
        texts.map(() => Array<number>(1536).fill(0.1)),
      ),
    };
    const logger = createLogger({
      level: 'silent',
      service: 'knowledge-route-test',
    });
    const app = express();
    app.use(requestContext(logger));
    app.use(
      '/api/v1/admin/auth',
      createAdminAuthRouter(config, userRepository, logger),
    );
    app.use(
      '/api/v1/admin/knowledge',
      createKnowledgeRouter(
        requireAdmin(config, userRepository),
        new KnowledgeService(knowledgeRepository),
        new KnowledgeIngestionService(config, knowledgeRepository, embeddings),
        logger,
      ),
    );
    app.use(createErrorHandler(logger));

    const unauthenticated = await request(app)
      .post('/api/v1/admin/knowledge/documents')
      .field('language', 'en')
      .attach('file', Buffer.from('Trusted tutoring details.'), 'source.txt');
    expect(unauthenticated.status).toBe(401);
    expect(save).not.toHaveBeenCalled();

    const login = await request(app)
      .post('/api/v1/admin/auth/login')
      .send({ email: 'admin@example.com', password });
    expect(login.status).toBe(200);
    const setCookie = login.headers['set-cookie'];
    const cookies =
      typeof setCookie === 'string' ? [setCookie] : (setCookie ?? []);
    const cookieHeader = cookies
      .map((cookie) => cookie.split(';')[0])
      .join('; ');

    const upload = await request(app)
      .post('/api/v1/admin/knowledge/documents')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .field('language', 'en')
      .attach('file', Buffer.from('Trusted tutoring details.'), 'source.txt');

    expect(upload.status).toBe(201);
    expect(upload.body.originalName).toBe('source.txt');
    expect(upload.body.status).toBe('draft');
    expect(upload.body.chunkCount).toBe(1);
    expect(upload.body).not.toHaveProperty('rawFile');
    expect(save).toHaveBeenCalledOnce();
    expect(embeddings.createEmbeddings).toHaveBeenCalledWith([
      'Trusted tutoring details.',
    ]);

    const submitForReview = await request(app)
      .patch(
        '/api/v1/admin/knowledge/documents/4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a/status',
      )
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ status: 'in_review' });
    expect(submitForReview.status).toBe(200);
    expect(knowledgeStatus).toBe('in_review');

    const approve = await request(app)
      .patch(
        '/api/v1/admin/knowledge/documents/4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a/status',
      )
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ status: 'approved' });
    expect(approve.status).toBe(200);
    expect(knowledgeStatus).toBe('approved');

    const publish = await request(app)
      .patch(
        '/api/v1/admin/knowledge/documents/4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a/status',
      )
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ status: 'published' });
    expect(publish.status).toBe(200);
    expect(knowledgeStatus).toBe('published');

    const entry = {
      title: 'Cancellation',
      topic: 'Policies',
      translationKey: 'cancellation',
      language: 'en',
      kind: 'faq',
      answer: 'Cancel more than 24 hours in advance.',
      questions: ['Can I cancel?'],
      reviewedOn: '2026-11-08',
    };
    const forbidden = await request(app)
      .post('/api/v1/admin/knowledge/entries')
      .set('Cookie', cookieHeader)
      .send(entry);
    expect(forbidden.status).toBe(403);
    const created = await request(app)
      .post('/api/v1/admin/knowledge/entries')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send(entry);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ entry, status: 'draft', revision: 0 });
    expect(created.body).not.toHaveProperty('questionKeys');
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        questionKeys: ['cancellation', 'can i cancel'],
        entry,
      }),
      expect.arrayContaining([expect.objectContaining({ status: 'inactive' })]),
    );
    const invalid = await request(app)
      .post('/api/v1/admin/knowledge/entries')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ ...entry, answer: '' });
    expect(invalid.status).toBe(400);
    const article = await request(app)
      .post('/api/v1/admin/knowledge/entries')
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({
        title: 'Lesson prices',
        language: 'en',
        answer: '175 AED per individual lesson, materials included.',
      });
    expect(article.status).toBe(201);
    expect(article.body).toMatchObject({
      status: 'draft',
      chunkCount: 1,
      entry: {
        title: 'Lesson prices',
        kind: 'information',
        questions: [],
        answer: '175 AED per individual lesson, materials included.',
      },
    });
    const editPublished = await request(app)
      .put(
        '/api/v1/admin/knowledge/entries/4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a',
      )
      .set('Cookie', cookieHeader)
      .set('X-CSRF-Token', login.body.csrfToken)
      .send({ entry, revision: 0 });
    expect(editPublished.status).toBe(409);
  });
});
