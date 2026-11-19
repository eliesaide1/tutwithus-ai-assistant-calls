import mongoose, { Schema, type Model } from 'mongoose';
import { KNOWLEDGE_VECTOR_DIMENSIONS } from '@tutwithus/contracts/admin';
import type { Locale } from '@tutwithus/contracts';
import type { KnowledgeEntry } from '@tutwithus/contracts/admin';

export type KnowledgeDocumentRecord = {
  entry?: KnowledgeEntry;
  questionKeys?: string[];
  revision?: number;
  sourceId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  language: Locale;
  status:
    | 'ready'
    | 'failed'
    | 'draft'
    | 'in_review'
    | 'approved'
    | 'published'
    | 'archived';
  chunkCount: number;
  createdBy: string;
  rawFile: Buffer;
  createdAt: Date;
};

export type KnowledgeChunkRecord = {
  sourceId: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  language: Locale;
  status: 'active' | 'inactive';
};

type KnowledgeDocumentDocument = KnowledgeDocumentRecord & {
  updatedAt: Date;
};

const knowledgeDocumentSchema = new Schema<KnowledgeDocumentDocument>(
  {
    entry: { type: Schema.Types.Mixed },
    questionKeys: { type: [String], default: undefined },
    revision: { type: Number, default: 0 },
    sourceId: { type: String, required: true, unique: true },
    originalName: { type: String, required: true, maxlength: 180 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    language: { type: String, enum: ['ar-SA', 'en', 'fr'], required: true },
    status: {
      type: String,
      enum: [
        'ready',
        'failed',
        'draft',
        'in_review',
        'approved',
        'published',
        'archived',
      ],
      required: true,
    },
    chunkCount: { type: Number, required: true, min: 1 },
    createdBy: { type: String, required: true },
    rawFile: { type: Buffer, required: true, select: false },
    createdAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false },
);

knowledgeDocumentSchema.index({ createdAt: -1 });
knowledgeDocumentSchema.index({ language: 1, status: 1, questionKeys: 1 });
knowledgeDocumentSchema.index(
  { 'entry.translationKey': 1, language: 1 },
  {
    unique: true,
    partialFilterExpression: { 'entry.translationKey': { $type: 'string' } },
  },
);

type KnowledgeChunkDocument = KnowledgeChunkRecord & {
  createdAt: Date;
};

const knowledgeChunkSchema = new Schema<KnowledgeChunkDocument>(
  {
    sourceId: { type: String, required: true },
    chunkIndex: { type: Number, required: true, min: 0 },
    content: { type: String, required: true },
    embedding: {
      type: [Number],
      required: true,
      select: false,
      validate: {
        validator: (value: number[]) =>
          value.length === KNOWLEDGE_VECTOR_DIMENSIONS,
        message: 'Knowledge embeddings must use 1536 dimensions.',
      },
    },
    language: { type: String, enum: ['ar-SA', 'en', 'fr'], required: true },
    status: { type: String, enum: ['active', 'inactive'], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

knowledgeChunkSchema.index({ sourceId: 1, chunkIndex: 1 }, { unique: true });

export const KnowledgeDocumentModel: Model<KnowledgeDocumentDocument> =
  mongoose.models.KnowledgeDocument ??
  mongoose.model<KnowledgeDocumentDocument>(
    'KnowledgeDocument',
    knowledgeDocumentSchema,
    'knowledge_documents',
  );

export const KnowledgeChunkModel: Model<KnowledgeChunkDocument> =
  mongoose.models.KnowledgeChunk ??
  mongoose.model<KnowledgeChunkDocument>(
    'KnowledgeChunk',
    knowledgeChunkSchema,
    'knowledge_chunks',
  );
