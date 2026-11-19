import {
  SearchKnowledgeArgumentsSchema,
  type Locale,
} from '@tutwithus/contracts';
import type { KnowledgeRetriever } from '../../retrieval/knowledge-retriever.js';

export type SearchKnowledgeToolContext = {
  sessionId: string;
  sessionStatus: 'pending' | 'live' | 'ended';
  locale: Locale;
  retrieval: {
    topK: number;
    minScore: number;
  };
  callsMade: number;
  callLimit: number;
};

export class ToolCallRejectedError extends Error {
  constructor(
    readonly code:
      | 'SESSION_NOT_LIVE'
      | 'TOOL_LIMIT'
      | 'INVALID_ARGUMENTS'
      | 'LOCALE_MISMATCH',
  ) {
    super(code);
    this.name = 'ToolCallRejectedError';
  }
}

export function createSearchKnowledgeHandler(
  retriever: Pick<KnowledgeRetriever, 'search'>,
) {
  return async (rawArguments: unknown, context: SearchKnowledgeToolContext) => {
    if (context.sessionStatus !== 'live') {
      throw new ToolCallRejectedError('SESSION_NOT_LIVE');
    }
    if (context.callsMade >= context.callLimit) {
      throw new ToolCallRejectedError('TOOL_LIMIT');
    }

    const parsed = SearchKnowledgeArgumentsSchema.safeParse(rawArguments);
    if (!parsed.success) {
      throw new ToolCallRejectedError('INVALID_ARGUMENTS');
    }
    if (parsed.data.language !== context.locale) {
      throw new ToolCallRejectedError('LOCALE_MISMATCH');
    }

    const passages = await retriever.search({
      query: parsed.data.query,
      language: context.locale,
      topK: Math.min(context.retrieval.topK, 5),
      minScore: context.retrieval.minScore,
    });

    return {
      found: passages.length > 0,
      responseLanguage: context.locale,
      guidance:
        'Answer in the caller language using these facts. If a source is in English, translate its explanation without changing amounts, currencies, names or policy conditions. Do not read question variations or metadata aloud.',
      passages: passages.map(({ sourceId, title, content, language }) => ({
        sourceId,
        title,
        content,
        language,
      })),
      citations: passages.map(({ sourceId, title }) => ({ sourceId, title })),
    };
  };
}
