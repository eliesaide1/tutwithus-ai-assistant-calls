import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeRetriever } from '../../retrieval/knowledge-retriever.js';
import {
  createSearchKnowledgeHandler,
  type SearchKnowledgeToolContext,
} from './search-knowledge.js';

const context: SearchKnowledgeToolContext = {
  sessionId: 'session-1',
  sessionStatus: 'live',
  locale: 'ar-SA',
  retrieval: { topK: 5, minScore: 0.7 },
  callsMade: 0,
  callLimit: 4,
};

function createHandler() {
  const retriever = {
    search: vi.fn(async () => [
      {
        sourceId: 'source-1',
        title: 'TutWithUs programs',
        content: 'Verified information.',
        language: 'ar-SA' as const,
        score: 0.9,
      },
    ]),
  } satisfies Pick<KnowledgeRetriever, 'search'>;
  return { handler: createSearchKnowledgeHandler(retriever), retriever };
}

describe('search_knowledge tool handler', () => {
  it('validates arguments, uses the session locale/settings, and returns citations', async () => {
    const { handler, retriever } = createHandler();

    await expect(
      handler({ query: 'courses', language: 'ar-SA' }, context),
    ).resolves.toEqual({
      responseLanguage: 'ar-SA',
      guidance: expect.stringContaining('without changing amounts'),
      found: true,
      passages: [
        {
          sourceId: 'source-1',
          title: 'TutWithUs programs',
          content: 'Verified information.',
          language: 'ar-SA',
        },
      ],
      citations: [{ sourceId: 'source-1', title: 'TutWithUs programs' }],
    });
    expect(retriever.search).toHaveBeenCalledWith({
      query: 'courses',
      language: 'ar-SA',
      topK: 5,
      minScore: 0.7,
    });
  });

  it('rejects inactive sessions, over-limit calls, invalid arguments, and locale overrides', async () => {
    const { handler, retriever } = createHandler();

    await expect(
      handler(
        { query: 'courses', language: 'ar-SA' },
        {
          ...context,
          sessionStatus: 'pending',
        },
      ),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_LIVE' });
    await expect(
      handler(
        { query: 'courses', language: 'ar-SA' },
        {
          ...context,
          callsMade: 4,
        },
      ),
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
    await expect(
      handler({ query: '', language: 'ar-SA' }, context),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENTS' });
    await expect(
      handler({ query: 'courses', language: 'en' }, context),
    ).rejects.toMatchObject({ code: 'LOCALE_MISMATCH' });
    expect(retriever.search).not.toHaveBeenCalled();
  });

  it('returns an explicit not-found result when retrieval has no approved matches', async () => {
    const retriever = {
      search: vi.fn(async () => []),
    } satisfies Pick<KnowledgeRetriever, 'search'>;
    const noResultHandler = createSearchKnowledgeHandler(retriever);

    await expect(
      noResultHandler({ query: 'unknown', language: 'ar-SA' }, context),
    ).resolves.toEqual({
      found: false,
      passages: [],
      citations: [],
      responseLanguage: 'ar-SA',
      guidance: expect.any(String),
    });
  });
});
