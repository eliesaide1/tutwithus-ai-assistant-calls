import type { ApiConfig } from '../../config/env.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';
import type { KnowledgeRepository } from './knowledge.repository.js';
import type { EmbeddingsClient } from '../../lib/openai/embeddings-client.js';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeEntrySchema } from '@tutwithus/contracts/admin';

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

describe('knowledge ingestion', () => {
  it('indexes a simple article once with its full price conditions and automatic title lookup', async () => {
    const repository: KnowledgeRepository = {
      save: vi.fn(),
      list: vi.fn(),
      findBySourceId: vi.fn(),
      setStatus: vi.fn(),
      delete: vi.fn(),
      searchPublishedChunks: vi.fn(),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async (texts) =>
        texts.map(() => Array<number>(1536).fill(0.1)),
      ),
    };
    const entry = KnowledgeEntrySchema.parse({
      title: 'Math lesson prices',
      language: 'en',
      answer:
        'Individual lesson details. '.repeat(160).trimEnd() +
        '\n175 AED per session, including materials. No subscription required.',
    });
    const result = await new KnowledgeIngestionService(
      config,
      repository,
      embeddings,
    ).saveEntry(entry, 'editor');
    expect(result).toMatchObject({ status: 'draft', chunkCount: 1 });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({ questionKeys: ['math lesson prices'] }),
      [
        expect.objectContaining({
          content: expect.stringContaining(
            '175 AED per session, including materials. No subscription required.',
          ),
          status: 'inactive',
        }),
      ],
    );
    expect(embeddings.createEmbeddings).toHaveBeenCalledWith([
      expect.stringContaining(entry.answer),
    ]);
  });
  it('edits a draft with optimistic concurrency and preserves structured price facts', async () => {
    const entry = {
      title: 'Elementary pricing',
      topic: 'Pricing',
      translationKey: 'elementary-pricing',
      language: 'en' as const,
      kind: 'pricing' as const,
      answer: 'Individual lessons.',
      questions: ['How much is elementary?'],
      reviewedOn: '2026-11-08',
      price: { amount: 175, currency: 'AED', unit: 'session' as const },
    };
    const draft = {
      sourceId: '4bf5122f-3445-5c53-9a9c-9c7a6a4e5e3a',
      originalName: 'price.txt',
      mimeType: 'text/plain',
      sizeBytes: 12,
      language: 'en' as const,
      status: 'draft' as const,
      chunkCount: 1,
      createdBy: 'owner',
      createdAt: new Date(),
      entry,
      revision: 2,
    };
    const repository: KnowledgeRepository = {
      save: vi.fn(),
      list: vi.fn(),
      findBySourceId: vi.fn(async () => draft),
      setStatus: vi.fn(),
      delete: vi.fn(),
      searchPublishedChunks: vi.fn(),
      replaceDraft: vi.fn(async () => true),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async (texts) =>
        texts.map(() => Array<number>(1536).fill(0.1)),
      ),
    };
    const service = new KnowledgeIngestionService(
      config,
      repository,
      embeddings,
    );
    const result = await service.saveEntry(entry, 'editor', {
      sourceId: draft.sourceId,
      revision: 2,
    });
    expect(result).toMatchObject({ revision: 3, status: 'draft', entry });
    expect(repository.replaceDraft).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'owner', revision: 3 }),
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('175 AED per session'),
          status: 'inactive',
        }),
      ]),
      2,
    );
    await expect(
      service.saveEntry(entry, 'editor', {
        sourceId: draft.sourceId,
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_EDIT_CONFLICT' });
    expect(embeddings.createEmbeddings).toHaveBeenCalledOnce();
    vi.mocked(repository.replaceDraft!).mockResolvedValueOnce(false);
    await expect(
      service.saveEntry(entry, 'editor', {
        sourceId: draft.sourceId,
        revision: 2,
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_EDIT_CONFLICT' });
  });
  it('extracts, embeds, and stores a UTF-8 text source and its vector passage', async () => {
    const save = vi.fn<KnowledgeRepository['save']>(async () => undefined);
    const repository: KnowledgeRepository = {
      save,
      list: vi.fn(async () => []),
      findBySourceId: vi.fn(async () => null),
      setStatus: vi.fn(async () => true),
      delete: vi.fn(async () => true),
      searchPublishedChunks: vi.fn(async () => []),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async (input) =>
        input.map(() => Array<number>(1536).fill(0.25)),
      ),
    };
    const service = new KnowledgeIngestionService(
      config,
      repository,
      embeddings,
    );

    const result = await service.ingest(
      {
        originalName: 'approved.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Approved tutoring information.', 'utf8'),
      },
      'en',
      'admin-user-id',
    );

    expect(result.originalName).toBe('approved.txt');
    expect(result.status).toBe('draft');
    expect(result.chunkCount).toBe(1);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        rawFile: Buffer.from('Approved tutoring information.', 'utf8'),
      }),
      [
        expect.objectContaining({
          content: 'Approved tutoring information.',
          embedding: expect.arrayContaining([0.25]),
        }),
      ],
    );
  });

  it('rejects a file whose name, MIME type, and content do not match', async () => {
    const repository: KnowledgeRepository = {
      save: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      findBySourceId: vi.fn(async () => null),
      setStatus: vi.fn(async () => true),
      delete: vi.fn(async () => true),
      searchPublishedChunks: vi.fn(async () => []),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async () => []),
    };
    const service = new KnowledgeIngestionService(
      config,
      repository,
      embeddings,
    );

    await expect(
      service.ingest(
        {
          originalName: 'misleading.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('not a pdf'),
        },
        'en',
        'admin-user-id',
      ),
    ).rejects.toMatchObject({ code: 'DOCUMENT_TYPE_UNSUPPORTED' });
    expect(embeddings.createEmbeddings).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not save the document if embeddings fail', async () => {
    const repository: KnowledgeRepository = {
      save: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
      findBySourceId: vi.fn(async () => null),
      setStatus: vi.fn(async () => true),
      delete: vi.fn(async () => true),
      searchPublishedChunks: vi.fn(async () => []),
    };
    const embeddings: EmbeddingsClient = {
      createEmbeddings: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
    };
    const service = new KnowledgeIngestionService(
      config,
      repository,
      embeddings,
    );

    await expect(
      service.ingest(
        {
          originalName: 'approved.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Approved tutoring information.', 'utf8'),
        },
        'en',
        'admin-user-id',
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(repository.save).not.toHaveBeenCalled();
  });
});
