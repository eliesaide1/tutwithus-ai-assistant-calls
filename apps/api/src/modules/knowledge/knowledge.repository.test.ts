import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  KnowledgeChunkModel,
  KnowledgeDocumentModel,
} from './knowledge-document.model.js';
import { MongoKnowledgeRepository } from './knowledge.repository.js';
import { normalizeKnowledgeQuestion } from './knowledge-entry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MongoKnowledgeRepository', () => {
  it('normalizes questions without collapsing numbers or negation', () => {
    expect(normalizeKnowledgeQuestion('  WHAT is the price? ')).toBe(
      'what is the price',
    );
    expect(normalizeKnowledgeQuestion('1.5')).not.toBe(
      normalizeKnowledgeQuestion('1 5'),
    );
    expect(normalizeKnowledgeQuestion('Can I cancel?')).not.toBe(
      normalizeKnowledgeQuestion('Can I not cancel?'),
    );
  });

  it('does not choose between duplicate FAQ aliases', async () => {
    const query = KnowledgeDocumentModel.find();
    vi.spyOn(query, 'exec').mockResolvedValue([
      new KnowledgeDocumentModel({ sourceId: 'a' }),
      new KnowledgeDocumentModel({ sourceId: 'b' }),
    ]);
    const find = vi
      .spyOn(KnowledgeDocumentModel, 'find')
      .mockReturnValue(query);
    expect(
      await new MongoKnowledgeRepository().findExactAnswer('Pricing?', 'fr'),
    ).toEqual([]);
    expect(find).toHaveBeenCalledWith({
      language: 'fr',
      status: 'published',
      questionKeys: 'pricing',
    });
  });
  it('caches repeated published searches without sharing mutable passages', async () => {
    const aggregate = KnowledgeChunkModel.aggregate([]);
    vi.spyOn(aggregate, 'exec').mockResolvedValue([
      {
        sourceId: 'published-source',
        language: 'en',
        content: 'Verified tutoring details.',
        score: 0.91,
        source: { originalName: 'Tutoring programs', status: 'published' },
      },
    ]);
    vi.spyOn(KnowledgeChunkModel, 'aggregate').mockReturnValue(aggregate);
    const query = KnowledgeDocumentModel.find();
    vi.spyOn(query, 'exec').mockResolvedValue([
      new KnowledgeDocumentModel({ sourceId: 'published-source', revision: 0 }),
    ]);
    vi.spyOn(KnowledgeDocumentModel, 'find').mockReturnValue(query);

    const repository = new MongoKnowledgeRepository();
    const input = {
      queryVector: Array<number>(1536).fill(0.25),
      language: 'en' as const,
      limit: 5,
      minScore: 0.7,
    };

    const firstResult = await repository.searchPublishedChunks(input);
    firstResult[0]!.content = 'Modified by caller.';
    const secondResult = await repository.searchPublishedChunks(input);

    expect(KnowledgeChunkModel.aggregate).toHaveBeenCalledOnce();
    expect(secondResult).toEqual([
      {
        sourceId: 'published-source',
        title: 'Tutoring programs',
        content: 'Verified tutoring details.',
        language: 'en',
        score: 0.91,
        sourceRevision: 0,
      },
    ]);
    // A different API worker archived the source: the cached facts cannot survive.
    vi.mocked(query.exec).mockResolvedValue([]);
    vi.mocked(aggregate.exec).mockResolvedValue([]);
    expect(await repository.searchPublishedChunks(input)).toEqual([]);
    expect(KnowledgeChunkModel.aggregate).toHaveBeenCalledTimes(2);
  });
});
