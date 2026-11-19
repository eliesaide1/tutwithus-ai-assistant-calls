import { randomUUID } from 'node:crypto';
import type { Locale } from '@tutwithus/contracts';
import { KNOWLEDGE_VECTOR_DIMENSIONS } from '@tutwithus/contracts/admin';
import {
  KnowledgeEntrySchema,
  type KnowledgeEntry,
} from '@tutwithus/contracts/admin';
import { entryText, normalizeKnowledgeQuestion } from './knowledge-entry.js';
import type { ApiConfig } from '../../config/env.js';
import { ApiError } from '../../http/errors.js';
import type { EmbeddingsClient } from '../../lib/openai/embeddings-client.js';
import type {
  KnowledgeChunkRecord,
  KnowledgeDocumentRecord,
} from './knowledge-document.model.js';
import type { KnowledgeRepository } from './knowledge.repository.js';
import {
  extractKnowledgeText,
  splitKnowledgeText,
  type UploadedKnowledgeFile,
} from './knowledge-text.js';

const EMBEDDING_BATCH_SIZE = 32;

export type KnowledgeDocumentResult = {
  entry?: KnowledgeEntry;
  revision?: number;
  sourceId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  language: Locale;
  status: 'draft';
  chunkCount: number;
  createdAt: string;
};

export class KnowledgeIngestionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KnowledgeIngestionError';
  }
}

export class KnowledgeIngestionService {
  constructor(
    private readonly config: ApiConfig,
    private readonly repository: KnowledgeRepository,
    private readonly embeddings: EmbeddingsClient | undefined,
  ) {}

  async saveEntry(
    raw: KnowledgeEntry,
    createdBy: string,
    edit?: { sourceId: string; revision: number },
  ): Promise<KnowledgeDocumentResult> {
    const entry = KnowledgeEntrySchema.parse(raw);
    try {
      return await this.ingest(
        {
          originalName: `${entry.title}.txt`,
          mimeType: 'text/plain',
          buffer: Buffer.from(entryText(entry), 'utf8'),
        },
        entry.language,
        createdBy,
        { entry, edit },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ApiError(
          409,
          'KNOWLEDGE_TRANSLATION_EXISTS',
          'An entry with this translation key and language already exists. Edit its draft instead.',
        );
      }
      if (error instanceof KnowledgeIngestionError) {
        throw new ApiError(
          502,
          'EMBEDDING_FAILED',
          'The entry could not be indexed. Please try again later.',
        );
      }
      throw error;
    }
  }

  async ingest(
    file: UploadedKnowledgeFile,
    language: Locale,
    createdBy: string,
    structured?: {
      entry: KnowledgeEntry;
      edit?: { sourceId: string; revision: number };
    },
  ): Promise<KnowledgeDocumentResult> {
    const existing = structured?.edit
      ? await this.repository.findBySourceId(structured.edit.sourceId)
      : undefined;
    if (
      structured?.edit &&
      (!existing?.entry ||
        existing.status !== 'draft' ||
        (existing.revision ?? 0) !== structured.edit.revision)
    ) {
      throw new ApiError(
        409,
        'KNOWLEDGE_EDIT_CONFLICT',
        'Only the current draft can be edited. Refresh the list first.',
      );
    }
    const parsed = await extractKnowledgeText(file);
    // Keep short articles together so prices retain their units and conditions.
    // Uploaded documents still split automatically; no manual FAQ preparation.
    const chunks =
      structured && parsed.text.length <= 6500
        ? [parsed.text]
        : splitKnowledgeText(parsed.text);
    if (chunks.length === 0) {
      throw new ApiError(
        422,
        'DOCUMENT_EMPTY',
        'No readable text was found in the document.',
      );
    }

    if (!this.config.openai.apiKey || !this.embeddings) {
      throw new ApiError(
        503,
        'EMBEDDINGS_NOT_CONFIGURED',
        'Document indexing is unavailable because the embedding service is not configured.',
      );
    }

    const vectors: number[][] = [];
    for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
      let batch: number[][];
      try {
        batch = await this.embeddings.createEmbeddings(
          chunks.slice(index, index + EMBEDDING_BATCH_SIZE),
        );
      } catch (error) {
        throw new KnowledgeIngestionError('Embedding generation failed.', {
          cause: error,
        });
      }
      if (
        batch.length !==
          Math.min(EMBEDDING_BATCH_SIZE, chunks.length - index) ||
        batch.some(
          (vector) =>
            vector.length !== KNOWLEDGE_VECTOR_DIMENSIONS ||
            vector.some((value) => !Number.isFinite(value)),
        )
      ) {
        throw new KnowledgeIngestionError(
          'The embedding service returned an invalid vector set.',
        );
      }
      vectors.push(...batch);
    }

    const sourceId = structured?.edit?.sourceId ?? randomUUID();
    const createdAt = existing?.createdAt ?? new Date();
    const document: KnowledgeDocumentRecord = {
      ...(structured
        ? {
            entry: structured.entry,
            questionKeys: [
              ...new Set(
                [structured.entry.title, ...structured.entry.questions].map(
                  normalizeKnowledgeQuestion,
                ),
              ),
            ].filter(Boolean),
            revision: structured.edit ? structured.edit.revision + 1 : 0,
          }
        : {}),
      sourceId,
      originalName: parsed.originalName,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      language,
      status: 'draft',
      chunkCount: chunks.length,
      createdBy: existing?.createdBy ?? createdBy,
      rawFile: file.buffer,
      createdAt,
    };
    const knowledgeChunks: KnowledgeChunkRecord[] = chunks.map(
      (content, chunkIndex) => ({
        sourceId,
        chunkIndex,
        content,
        embedding: vectors[chunkIndex],
        language,
        status: 'inactive',
      }),
    );

    if (structured?.edit) {
      if (
        !this.repository.replaceDraft ||
        !(await this.repository.replaceDraft(
          document,
          knowledgeChunks,
          structured.edit.revision,
        ))
      ) {
        throw new ApiError(
          409,
          'KNOWLEDGE_EDIT_CONFLICT',
          'The draft changed while saving. Refresh and try again.',
        );
      }
    } else {
      await this.repository.save(document, knowledgeChunks);
    }
    return {
      ...(structured
        ? { entry: structured.entry, revision: document.revision }
        : {}),
      sourceId,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      language,
      status: 'draft',
      chunkCount: document.chunkCount,
      createdAt: createdAt.toISOString(),
    };
  }
}
