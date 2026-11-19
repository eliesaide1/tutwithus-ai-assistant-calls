import { describe, expect, it, vi } from 'vitest';
import {
  KnowledgeRetriever,
  type PublishedKnowledgeSearchStore,
  type QueryEmbeddingProvider,
} from './knowledge-retriever.js';

const vector = Array.from({ length: 1536 }, (_, index) => index / 1536);

function createRetriever() {
  const embeddings: QueryEmbeddingProvider = {
    createEmbeddings: vi.fn(async () => [vector]),
  };
  const knowledge: PublishedKnowledgeSearchStore = {
    searchPublishedChunks: vi.fn(async () => [
      {
        sourceId: 'published-source',
        title: 'Tutoring programs',
        content: 'Verified tutoring details.',
        language: 'en' as const,
        score: 0.91,
      },
    ]),
  };
  return {
    retriever: new KnowledgeRetriever(embeddings, knowledge),
    embeddings,
    knowledge,
  };
}

describe('KnowledgeRetriever', () => {
  it('fills a partial localized result with distinct English articles', async () => {
    const { embeddings, knowledge } = createRetriever();
    vi.mocked(knowledge.searchPublishedChunks).mockResolvedValueOnce([
      {
        sourceId: 'french',
        title: 'Courses',
        content: 'Cours',
        language: 'fr',
        score: 0.9,
      },
    ]);
    const result = await new KnowledgeRetriever(embeddings, knowledge).search({
      query: 'Cours et prix',
      language: 'fr',
      topK: 2,
      minScore: 0.7,
    });
    expect(result.map((entry) => entry.sourceId)).toEqual([
      'french',
      'published-source',
    ]);
  });
  it('answers an approved exact FAQ without an embedding or vector request', async () => {
    const { embeddings, knowledge } = createRetriever();
    knowledge.findExactAnswer = vi.fn(async () => [
      {
        sourceId: 'faq',
        title: 'Fees',
        content: '175 AED per session.',
        language: 'en' as const,
        score: 1,
      },
    ]);
    const retriever = new KnowledgeRetriever(embeddings, knowledge);
    expect(
      await retriever.search({
        query: 'What are the fees?',
        language: 'en',
        topK: 5,
        minScore: 0.7,
      }),
    ).toMatchObject([{ sourceId: 'faq' }]);
    expect(embeddings.createEmbeddings).not.toHaveBeenCalled();
    expect(knowledge.searchPublishedChunks).not.toHaveBeenCalled();
  });

  it('falls back to English sources only when localized semantic search is empty', async () => {
    const { embeddings, knowledge } = createRetriever();
    vi.mocked(knowledge.searchPublishedChunks).mockResolvedValueOnce([]);
    const retriever = new KnowledgeRetriever(embeddings, knowledge);
    const result = await retriever.search({
      query: 'Quels cours?',
      language: 'fr',
      topK: 5,
      minScore: 0.7,
    });
    expect(result[0]?.language).toBe('en');
    expect(knowledge.searchPublishedChunks).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ language: 'fr' }),
    );
    expect(knowledge.searchPublishedChunks).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ language: 'en' }),
    );
    expect(embeddings.createEmbeddings).toHaveBeenCalledOnce();
  });

  it('uses semantic retrieval if the exact lookup is ambiguous or unavailable', async () => {
    const { embeddings, knowledge } = createRetriever();
    knowledge.findExactAnswer = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([]);
    const retriever = new KnowledgeRetriever(embeddings, knowledge);
    for (const query of ['fees', 'booking']) {
      expect(
        await retriever.search({
          query,
          language: 'en',
          topK: 5,
          minScore: 0.7,
        }),
      ).toHaveLength(1);
    }
    expect(knowledge.searchPublishedChunks).toHaveBeenCalledTimes(2);
  });
  it('embeds the query and searches only the requested language with configured limits', async () => {
    const { retriever, embeddings, knowledge } = createRetriever();

    await expect(
      retriever.search({
        query: '  available tutoring programs  ',
        language: 'en',
        topK: 5,
        minScore: 0.7,
      }),
    ).resolves.toMatchObject([{ sourceId: 'published-source' }]);

    expect(embeddings.createEmbeddings).toHaveBeenCalledWith([
      'available tutoring programs',
    ]);
    expect(knowledge.searchPublishedChunks).toHaveBeenCalledWith({
      queryVector: vector,
      language: 'en',
      limit: 5,
      minScore: 0.7,
    });
  });

  it('reuses recent query embeddings but reruns retrieval for fresh published knowledge', async () => {
    const { retriever, embeddings, knowledge } = createRetriever();
    const input = {
      query: 'available tutoring programs',
      language: 'en' as const,
      topK: 5,
      minScore: 0.7,
    };

    await retriever.search({ ...input, query: ` ${input.query} ` });
    await retriever.search(input);

    expect(embeddings.createEmbeddings).toHaveBeenCalledTimes(1);
    expect(knowledge.searchPublishedChunks).toHaveBeenCalledTimes(2);
  });

  it('expires cached query embeddings after 24 hours', async () => {
    const { retriever, embeddings } = createRetriever();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const input = {
      query: 'available tutoring programs',
      language: 'en' as const,
      topK: 5,
      minScore: 0.7,
    };

    await retriever.search(input);
    now.mockReturnValue(1_000 + 24 * 60 * 60 * 1000 + 1);
    await retriever.search(input);

    expect(embeddings.createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('bounds the query embedding cache to 1,000 entries using least-recently-used eviction', async () => {
    const { retriever, embeddings } = createRetriever();
    const input = {
      language: 'en' as const,
      topK: 5,
      minScore: 0.7,
    };

    for (let index = 0; index < 1_000; index += 1) {
      await retriever.search({ ...input, query: `question ${index}` });
    }

    await retriever.search({ ...input, query: 'question 0' });
    await retriever.search({ ...input, query: 'question 1000' });
    await retriever.search({ ...input, query: 'question 1' });

    expect(embeddings.createEmbeddings).toHaveBeenCalledTimes(1_002);
  });

  it('does not share cached query embeddings across languages', async () => {
    const { retriever, embeddings } = createRetriever();

    await retriever.search({
      query: 'TutWithUs courses',
      language: 'en',
      topK: 5,
      minScore: 0.7,
    });
    await retriever.search({
      query: 'TutWithUs courses',
      language: 'fr',
      topK: 5,
      minScore: 0.7,
    });

    expect(embeddings.createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('logs retrieval stage timings without logging the caller query', async () => {
    const { embeddings, knowledge } = createRetriever();
    const logger = { info: vi.fn() };
    const retriever = new KnowledgeRetriever(embeddings, knowledge, logger);
    const query = 'private caller question';

    await retriever.search({
      query,
      language: 'en',
      topK: 5,
      minScore: 0.7,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'knowledge-retriever',
        embeddingSource: 'provider',
        embeddingLatencyMs: expect.any(Number),
        vectorSearchLatencyMs: expect.any(Number),
        totalLatencyMs: expect.any(Number),
        passageCount: 1,
      }),
      'Knowledge retrieval completed',
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(query);
  });

  it('warns when retrieval exceeds the interactive latency budget', async () => {
    const { embeddings, knowledge } = createRetriever();
    // Retrieval start, embedding start/end, search start/end, then the
    // separate reading that totals the call: 800ms exceeds the 750ms budget.
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(30)
      .mockReturnValueOnce(800)
      .mockReturnValueOnce(800);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const retriever = new KnowledgeRetriever(embeddings, knowledge, logger);

    await retriever.search({
      query: 'slow question',
      language: 'en',
      topK: 5,
      minScore: 0.7,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'knowledge-retriever',
        totalLatencyMs: expect.any(Number),
      }),
      'Knowledge retrieval was slow',
    );
    expect(
      logger.warn.mock.calls[0]?.[0].totalLatencyMs,
    ).toBeGreaterThanOrEqual(750);
  });

  it('rejects invalid vectors rather than searching with malformed embeddings', async () => {
    const { knowledge } = createRetriever();
    const badEmbeddingProvider: QueryEmbeddingProvider = {
      createEmbeddings: vi.fn(async () => [[0, 1]]),
    };
    const guardedRetriever = new KnowledgeRetriever(
      badEmbeddingProvider,
      knowledge,
    );

    await expect(
      guardedRetriever.search({
        query: 'question',
        language: 'en',
        topK: 5,
        minScore: 0.7,
      }),
    ).rejects.toThrow('invalid query vector');
    expect(knowledge.searchPublishedChunks).not.toHaveBeenCalled();
  });
});
