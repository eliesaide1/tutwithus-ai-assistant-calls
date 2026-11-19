import { createHash } from 'node:crypto';
import {
  KnowledgeChunkModel,
  KnowledgeDocumentModel,
  type KnowledgeChunkRecord,
  type KnowledgeDocumentRecord,
} from './knowledge-document.model.js';
import mongoose from 'mongoose';
import type { Locale } from '@tutwithus/contracts';
import type {
  KnowledgePassage,
  PublishedKnowledgeSearchStore,
} from '../../core/retrieval/knowledge-retriever.js';
import {
  entryAnswerText,
  normalizeKnowledgeQuestion,
} from './knowledge-entry.js';

const PUBLISHED_SEARCH_CACHE_TTL_MS = 10 * 1000;
const PUBLISHED_SEARCH_CACHE_MAX_ENTRIES = 128;

type PublishedSearchInput = Parameters<
  PublishedKnowledgeSearchStore['searchPublishedChunks']
>[0];

type PublishedSearchResult = {
  passages: KnowledgePassage[];
  expiresAt: number;
};

export type KnowledgeDocumentSummary = Omit<KnowledgeDocumentRecord, 'rawFile'>;

export interface KnowledgeRepository extends PublishedKnowledgeSearchStore {
  replaceDraft?(
    document: KnowledgeDocumentRecord,
    chunks: KnowledgeChunkRecord[],
    expectedRevision: number,
  ): Promise<boolean>;
  save(
    document: KnowledgeDocumentRecord,
    chunks: KnowledgeChunkRecord[],
  ): Promise<void>;
  list(after?: string): Promise<KnowledgeDocumentSummary[]>;
  findBySourceId(sourceId: string): Promise<KnowledgeDocumentSummary | null>;
  setStatus(input: {
    sourceId: string;
    currentStatus: KnowledgeDocumentSummary['status'];
    nextStatus: KnowledgeDocumentSummary['status'];
  }): Promise<boolean>;
  delete(sourceId: string): Promise<boolean>;
}

// Copies only summary fields so the raw file buffer never leaves the repository.
function toSummary(
  document: KnowledgeDocumentSummary,
): KnowledgeDocumentSummary {
  return {
    ...(document.entry
      ? { entry: document.entry, revision: document.revision ?? 0 }
      : {}),
    sourceId: document.sourceId,
    originalName: document.originalName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    language: document.language,
    status: document.status,
    chunkCount: document.chunkCount,
    createdBy: document.createdBy,
    createdAt: document.createdAt,
  };
}

// Implements the core retrieval port (PublishedKnowledgeSearchStore) as well as
// the admin persistence operations.
export class MongoKnowledgeRepository implements KnowledgeRepository {
  async findExactAnswer(
    query: string,
    language: Locale,
  ): Promise<KnowledgePassage[]> {
    const key = normalizeKnowledgeQuestion(query);
    if (!key) return [];
    const matches = await KnowledgeDocumentModel.find({
      language,
      status: 'published',
      questionKeys: key,
    })
      .select('sourceId entry language')
      .limit(2)
      .maxTimeMS(750)
      .lean()
      .exec();
    // Duplicate aliases must not arbitrarily choose one of two different facts.
    if (matches.length !== 1 || !matches[0]?.entry) return [];
    const doc = matches[0];
    return [
      {
        sourceId: doc.sourceId,
        title: doc.entry!.title,
        content: entryAnswerText(doc.entry!),
        language: doc.language,
        score: 1,
      },
    ];
  }

  async replaceDraft(
    document: KnowledgeDocumentRecord,
    chunks: KnowledgeChunkRecord[],
    expectedRevision: number,
  ): Promise<boolean> {
    const session = await mongoose.startSession();
    let replaced = false;
    try {
      await session.withTransaction(async () => {
        const result = await KnowledgeDocumentModel.updateOne(
          {
            sourceId: document.sourceId,
            status: 'draft',
            revision: expectedRevision,
            entry: { $exists: true },
          },
          { $set: { ...document, revision: expectedRevision + 1 } },
          { session },
        );
        if (!result.matchedCount) return;
        await KnowledgeChunkModel.deleteMany(
          { sourceId: document.sourceId },
          { session },
        );
        await KnowledgeChunkModel.insertMany(chunks, { session });
        replaced = true;
      });
      if (replaced) this.invalidatePublishedSearchCache();
      return replaced;
    } finally {
      await session.endSession();
    }
  }
  private readonly publishedSearchCache = new Map<
    string,
    PublishedSearchResult
  >();
  private readonly publishedSearchRequests = new Map<
    string,
    Promise<KnowledgePassage[]>
  >();
  private searchCacheGeneration = 0;

  async searchPublishedChunks(
    input: PublishedSearchInput,
  ): Promise<KnowledgePassage[]> {
    const generation = this.searchCacheGeneration;
    const cacheKey = this.createPublishedSearchCacheKey(input, generation);
    const cached = this.publishedSearchCache.get(cacheKey);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      (await this.cacheSourcesCurrent(cached.passages))
    ) {
      this.publishedSearchCache.delete(cacheKey);
      this.publishedSearchCache.set(cacheKey, cached);
      return this.clonePassages(cached.passages);
    }
    if (cached) {
      this.publishedSearchCache.delete(cacheKey);
    }

    const pending = this.publishedSearchRequests.get(cacheKey);
    if (pending) {
      return this.clonePassages(await pending);
    }

    const request = this.searchPublishedChunksInMongo(input);
    this.publishedSearchRequests.set(cacheKey, request);
    try {
      const passages = await request;
      if (passages.length && generation === this.searchCacheGeneration) {
        this.publishedSearchCache.set(cacheKey, {
          passages: this.clonePassages(passages),
          expiresAt: Date.now() + PUBLISHED_SEARCH_CACHE_TTL_MS,
        });
        if (
          this.publishedSearchCache.size > PUBLISHED_SEARCH_CACHE_MAX_ENTRIES
        ) {
          const oldestKey = this.publishedSearchCache.keys().next().value;
          if (oldestKey !== undefined) {
            this.publishedSearchCache.delete(oldestKey);
          }
        }
      }
      return this.clonePassages(passages);
    } finally {
      if (this.publishedSearchRequests.get(cacheKey) === request) {
        this.publishedSearchRequests.delete(cacheKey);
      }
    }
  }

  private async searchPublishedChunksInMongo(
    input: PublishedSearchInput,
  ): Promise<KnowledgePassage[]> {
    const candidates = await KnowledgeChunkModel.aggregate<{
      sourceId: string;
      language: Locale;
      content: string;
      score: number;
      source: {
        originalName: string;
        revision?: number;
        entry?: import('@tutwithus/contracts/admin').KnowledgeEntry;
        status: KnowledgeDocumentSummary['status'];
      };
    }>([
      {
        $vectorSearch: {
          index: 'chunks_vector',
          path: 'embedding',
          queryVector: input.queryVector,
          numCandidates: Math.max(100, input.limit * 20),
          limit: Math.min(250, input.limit * 10),
          filter: {
            status: 'active',
            language: input.language,
          },
        },
      },
      { $set: { score: { $meta: 'vectorSearchScore' } } },
      { $match: { score: { $gte: input.minScore } } },
      {
        $lookup: {
          from: KnowledgeDocumentModel.collection.name,
          localField: 'sourceId',
          foreignField: 'sourceId',
          as: 'source',
        },
      },
      { $unwind: '$source' },
      { $match: { 'source.status': 'published' } },
      {
        $project: {
          _id: 0,
          sourceId: 1,
          language: 1,
          content: 1,
          score: 1,
          'source.originalName': 1,
          'source.revision': 1,
          'source.entry': 1,
        },
      },
    ])
      .option({ maxTimeMS: 3_000 })
      .exec();

    const passages = candidates.map((candidate) => ({
      sourceId: candidate.sourceId,
      title: candidate.source.entry?.title ?? candidate.source.originalName,
      content: candidate.source.entry
        ? entryAnswerText(candidate.source.entry)
        : candidate.content,
      language: candidate.language,
      score: candidate.score,
      sourceRevision: candidate.source.revision ?? 0,
    }));
    // Return a structured entry once, with its complete answer and exact fields,
    // even when the matching vector chunk contains only a question variation.
    const seen = new Set<string>();
    return passages
      .filter((passage, index) => {
        if (!candidates[index]?.source.entry) return true;
        if (seen.has(passage.sourceId)) return false;
        seen.add(passage.sourceId);
        return true;
      })
      .slice(0, input.limit);
  }

  private async cacheSourcesCurrent(
    passages: KnowledgePassage[],
  ): Promise<boolean> {
    if (!passages.length) return false;
    // Recheck publication and revisions even when another worker made the edit.
    const sources = await KnowledgeDocumentModel.find({
      sourceId: { $in: passages.map((p) => p.sourceId) },
      status: 'published',
    })
      .select('sourceId revision')
      .maxTimeMS(750)
      .lean()
      .exec();
    return passages.every((p) =>
      sources.some(
        (source) =>
          source.sourceId === p.sourceId &&
          (source.revision ?? 0) === (p.sourceRevision ?? 0),
      ),
    );
  }

  private createPublishedSearchCacheKey(
    input: PublishedSearchInput,
    generation: number,
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          generation,
          input.language,
          input.limit,
          input.minScore,
          input.queryVector,
        ]),
      )
      .digest('hex');
  }

  private clonePassages(passages: KnowledgePassage[]): KnowledgePassage[] {
    return passages.map((passage) => ({ ...passage }));
  }

  private invalidatePublishedSearchCache(): void {
    this.searchCacheGeneration += 1;
    this.publishedSearchCache.clear();
  }

  async save(
    document: KnowledgeDocumentRecord,
    chunks: KnowledgeChunkRecord[],
  ): Promise<void> {
    await KnowledgeDocumentModel.create(document);
    try {
      await KnowledgeChunkModel.insertMany(chunks, { ordered: true });
    } catch (error) {
      await KnowledgeDocumentModel.deleteOne({
        sourceId: document.sourceId,
      }).exec();
      await KnowledgeChunkModel.deleteMany({
        sourceId: document.sourceId,
      }).exec();
      this.invalidatePublishedSearchCache();
      throw error;
    }
    this.invalidatePublishedSearchCache();
  }

  async list(after?: string): Promise<KnowledgeDocumentSummary[]> {
    const documents = await KnowledgeDocumentModel.find(
      after ? { sourceId: { $gt: after } } : {},
    )
      .select('-rawFile')
      .sort({ sourceId: 1 })
      .limit(100)
      .lean()
      .exec();
    return documents.map(toSummary);
  }

  async findBySourceId(
    sourceId: string,
  ): Promise<KnowledgeDocumentSummary | null> {
    const document = await KnowledgeDocumentModel.findOne({ sourceId })
      .select('-rawFile')
      .lean()
      .exec();
    return document ? toSummary(document) : null;
  }

  async setStatus(input: {
    sourceId: string;
    currentStatus: KnowledgeDocumentSummary['status'];
    nextStatus: KnowledgeDocumentSummary['status'];
  }): Promise<boolean> {
    const session = await mongoose.startSession();
    let transitioned = false;
    try {
      await session.withTransaction(async () => {
        const updated = await KnowledgeDocumentModel.findOneAndUpdate(
          { sourceId: input.sourceId, status: input.currentStatus },
          { $set: { status: input.nextStatus } },
          { new: true, session },
        )
          .select('sourceId')
          .lean()
          .exec();
        if (!updated) {
          return;
        }

        await KnowledgeChunkModel.updateMany(
          { sourceId: input.sourceId },
          {
            $set: {
              status: input.nextStatus === 'published' ? 'active' : 'inactive',
            },
          },
          { session },
        ).exec();
        transitioned = true;
      });
      if (transitioned) {
        this.invalidatePublishedSearchCache();
      }
      return transitioned;
    } finally {
      await session.endSession();
    }
  }

  async delete(sourceId: string): Promise<boolean> {
    await KnowledgeChunkModel.updateMany(
      { sourceId },
      { $set: { status: 'inactive' } },
    ).exec();
    const result = await KnowledgeDocumentModel.deleteOne({ sourceId }).exec();
    await KnowledgeChunkModel.deleteMany({ sourceId }).exec();
    this.invalidatePublishedSearchCache();
    return result.deletedCount > 0;
  }
}
