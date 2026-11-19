import { createHash } from 'node:crypto';
import { KNOWLEDGE_VECTOR_DIMENSIONS } from '@tutwithus/contracts/admin';
import type { Logger } from '../../lib/logger.js';
import type { Locale } from '@tutwithus/contracts';

const QUERY_EMBEDDING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const QUERY_EMBEDDING_CACHE_MAX_ENTRIES = 1000;
const SLOW_RETRIEVAL_WARNING_MS = 750;

export type KnowledgePassage = {
  sourceId: string;
  title: string;
  content: string;
  language: Locale;
  score: number;
  sourceRevision?: number;
};

export interface QueryEmbeddingProvider {
  createEmbeddings(input: string[]): Promise<number[][]>;
}

export interface PublishedKnowledgeSearchStore {
  findExactAnswer?(
    query: string,
    language: Locale,
  ): Promise<KnowledgePassage[]>;
  searchPublishedChunks(input: {
    queryVector: number[];
    language: Locale;
    limit: number;
    minScore: number;
  }): Promise<KnowledgePassage[]>;
}

export class KnowledgeRetrievalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KnowledgeRetrievalError';
  }
}

export class KnowledgeRetriever {
  private readonly queryEmbeddingCache = new Map<
    string,
    { vector: number[]; expiresAt: number }
  >();
  private readonly queryEmbeddingRequests = new Map<
    string,
    Promise<number[]>
  >();

  constructor(
    private readonly embeddings: QueryEmbeddingProvider,
    private readonly knowledge: PublishedKnowledgeSearchStore,
    private readonly logger?: Partial<Pick<Logger, 'info' | 'warn'>>,
  ) {}

  async search(input: {
    query: string;
    language: Locale;
    topK: number;
    minScore: number;
  }): Promise<KnowledgePassage[]> {
    const query = input.query.trim();
    if (!query || query.length > 300) {
      throw new KnowledgeRetrievalError('The knowledge query is invalid.');
    }
    if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > 50) {
      throw new KnowledgeRetrievalError(
        'The knowledge result limit is invalid.',
      );
    }
    if (
      !Number.isFinite(input.minScore) ||
      input.minScore < 0 ||
      input.minScore > 1
    ) {
      throw new KnowledgeRetrievalError(
        'The knowledge score threshold is invalid.',
      );
    }

    const retrievalStartedAt = performance.now();
    if (this.knowledge.findExactAnswer) {
      try {
        const exact = await this.knowledge.findExactAnswer(
          query,
          input.language,
        );
        if (exact.length === 1) {
          this.logger?.info?.(
            {
              source: 'knowledge-retriever',
              language: input.language,
              retrievalPath: 'approved-question',
              totalLatencyMs: Math.round(
                performance.now() - retrievalStartedAt,
              ),
            },
            'Knowledge retrieval completed',
          );
          return exact;
        }
      } catch {
        this.logger?.warn?.(
          { source: 'knowledge-retriever' },
          'Direct knowledge lookup unavailable; using semantic search',
        );
      }
    }
    const embeddingStartedAt = performance.now();
    const embedding = await this.queryVector(query, input.language);
    const embeddingLatencyMs = Math.round(
      performance.now() - embeddingStartedAt,
    );

    const searchStartedAt = performance.now();
    let passages: KnowledgePassage[];
    try {
      passages = await this.knowledge.searchPublishedChunks({
        queryVector: embedding.vector,
        language: input.language,
        limit: input.topK,
        minScore: input.minScore,
      });
      // English supplements incomplete localized results.
      // Source language remains attached; the caller's response language stays unchanged.
      if (passages.length < input.topK && input.language !== 'en') {
        const fallback = await this.knowledge
          .searchPublishedChunks({
            queryVector: embedding.vector,
            language: 'en',
            limit: input.topK,
            minScore: input.minScore,
          })
          .catch((error: unknown) => {
            if (passages.length === 0) throw error;
            this.logger?.warn?.(
              { source: 'knowledge-retriever' },
              'Supplementary knowledge search unavailable',
            );
            return [];
          });
        const seen = new Set(passages.map((passage) => passage.sourceId));
        passages = [
          ...passages,
          ...fallback.filter((passage) => !seen.has(passage.sourceId)),
        ].slice(0, input.topK);
      }
    } catch (error) {
      throw new KnowledgeRetrievalError(
        'Published knowledge search is unavailable.',
        { cause: error },
      );
    }
    const vectorSearchLatencyMs = Math.round(
      performance.now() - searchStartedAt,
    );
    const totalLatencyMs = Math.round(performance.now() - retrievalStartedAt);
    const details = {
      source: 'knowledge-retriever',
      language: input.language,
      embeddingSource: embedding.source,
      embeddingLatencyMs,
      vectorSearchLatencyMs,
      totalLatencyMs,
      passageCount: passages.length,
    };
    if (totalLatencyMs >= SLOW_RETRIEVAL_WARNING_MS) {
      this.logger?.warn?.(details, 'Knowledge retrieval was slow');
    }
    this.logger?.info?.(details, 'Knowledge retrieval completed');
    return passages;
  }

  private async queryVector(
    query: string,
    language: Locale,
  ): Promise<{ vector: number[]; source: 'cache' | 'in-flight' | 'provider' }> {
    const cacheKey = createHash('sha256')
      .update(language)
      .update('\0')
      .update(query)
      .digest('hex');
    const cached = this.queryEmbeddingCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.queryEmbeddingCache.delete(cacheKey);
      this.queryEmbeddingCache.set(cacheKey, cached);
      return { vector: [...cached.vector], source: 'cache' };
    }
    if (cached) {
      this.queryEmbeddingCache.delete(cacheKey);
    }

    const pending = this.queryEmbeddingRequests.get(cacheKey);
    if (pending) {
      return { vector: [...(await pending)], source: 'in-flight' };
    }

    const request = this.createQueryVector(query);
    this.queryEmbeddingRequests.set(cacheKey, request);
    try {
      const vector = await request;
      this.queryEmbeddingCache.set(cacheKey, {
        vector,
        expiresAt: Date.now() + QUERY_EMBEDDING_CACHE_TTL_MS,
      });
      if (this.queryEmbeddingCache.size > QUERY_EMBEDDING_CACHE_MAX_ENTRIES) {
        const oldestKey = this.queryEmbeddingCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.queryEmbeddingCache.delete(oldestKey);
        }
      }
      return { vector: [...vector], source: 'provider' };
    } finally {
      this.queryEmbeddingRequests.delete(cacheKey);
    }
  }

  private async createQueryVector(query: string): Promise<number[]> {
    let vectors: number[][];
    try {
      vectors = await this.embeddings.createEmbeddings([query]);
    } catch (error) {
      throw new KnowledgeRetrievalError(
        'Knowledge query embedding could not be created.',
        { cause: error },
      );
    }

    const queryVector = vectors[0];
    if (
      vectors.length !== 1 ||
      !queryVector ||
      queryVector.length !== KNOWLEDGE_VECTOR_DIMENSIONS ||
      queryVector.some((value) => !Number.isFinite(value))
    ) {
      throw new KnowledgeRetrievalError(
        'The embedding service returned an invalid query vector.',
      );
    }
    return [...queryVector];
  }
}
