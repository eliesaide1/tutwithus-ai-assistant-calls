import { LocaleSchema } from '@tutwithus/contracts';
import {
  KnowledgeDocumentSchema,
  KnowledgeDocumentsResponseSchema,
  KnowledgeEntrySchema,
} from '@tutwithus/contracts/admin';
import { errorName, type Logger } from '../../lib/logger.js';
import express, { Router, type RequestHandler } from 'express';
import multer, { MulterError } from 'multer';
import { z } from 'zod';
import { ApiError } from '../../http/errors.js';
import { rateLimitPerIp } from '../../http/middleware/rate-limit.js';
import { parseInput, UuidSchema } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import {
  getAdminPrincipal,
  requireAdminCsrf,
} from '../admin-auth/admin-auth.middleware.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import {
  KnowledgeIngestionError,
  type KnowledgeIngestionService,
} from './knowledge-ingestion.service.js';
import type { KnowledgeService } from './knowledge.service.js';
import { MAX_KNOWLEDGE_FILE_BYTES } from './knowledge-text.js';

const StatusChangeSchema = z.object({
  status: z.enum(['draft', 'in_review', 'approved', 'published', 'archived']),
});
const UploadFieldsSchema = z.object({ language: LocaleSchema });
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_KNOWLEDGE_FILE_BYTES,
    files: 1,
    fields: 2,
    fieldSize: 256,
  },
  fileFilter: (_request, file, callback) => {
    const extension = file.originalname.split('.').pop()?.toLowerCase();
    if (!extension || !ALLOWED_EXTENSIONS.has(`.${extension}`)) {
      callback(
        new ApiError(
          415,
          'DOCUMENT_TYPE_UNSUPPORTED',
          'Upload a PDF, DOCX, or TXT file.',
        ),
      );
      return;
    }
    callback(null, true);
  },
});

// Wraps multer so its errors become API errors with stable codes.
const parseUpload: RequestHandler = (request, response, next) => {
  upload.single('file')(request, response, (error: unknown) => {
    if (error instanceof MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      next(
        new ApiError(
          tooLarge ? 413 : 400,
          tooLarge ? 'DOCUMENT_SIZE_INVALID' : 'UPLOAD_INVALID',
          tooLarge
            ? 'The file must be smaller than 8 MB.'
            : 'The document upload could not be read.',
        ),
      );
      return;
    }
    next(error);
  });
};

export function createKnowledgeRouter(
  authenticate: RequestHandler,
  knowledge: KnowledgeService,
  ingestion: KnowledgeIngestionService,
  logger: Logger,
) {
  const router = Router();
  const editors = authorize(...ADMIN_ROLE_POLICIES.knowledgeEditors);
  const administrators = authorize(...ADMIN_ROLE_POLICIES.administrators);
  router.use(authenticate);

  router.get('/documents', editors, async (request, response) => {
    const after = parseInput(
      UuidSchema.optional(),
      request.query.after,
      'Invalid knowledge cursor.',
    );
    const documents = await knowledge.listDocuments(after);
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      KnowledgeDocumentsResponseSchema.parse({
        nextCursor:
          documents.length === 100 ? documents.at(-1)?.sourceId : undefined,
        documents: documents.map((document) => ({
          sourceId: document.sourceId,
          originalName: document.originalName,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          language: document.language,
          status: document.status,
          chunkCount: document.chunkCount,
          createdAt: document.createdAt.toISOString(),
          entry: document.entry,
          revision: document.revision,
        })),
      }),
    );
  });

  const entryWriteLimit = rateLimitPerIp({
    windowMs: 60 * 1000,
    limit: 20,
    message: 'Too many knowledge changes. Please try again later.',
  });
  router.post(
    '/entries',
    editors,
    requireAdminCsrf,
    entryWriteLimit,
    express.json({ limit: '64kb', strict: true }),
    async (request, response) => {
      const entry = parseInput(
        KnowledgeEntrySchema,
        request.body,
        'The knowledge entry is invalid.',
      );
      const result = await ingestion.saveEntry(
        entry,
        getAdminPrincipal(response).id,
      );
      response.status(201).json(KnowledgeDocumentSchema.parse(result));
    },
  );
  router.put(
    '/entries/:sourceId',
    editors,
    requireAdminCsrf,
    entryWriteLimit,
    express.json({ limit: '64kb', strict: true }),
    async (request, response) => {
      const sourceId = parseInput(
        UuidSchema,
        request.params.sourceId,
        'Invalid entry ID.',
      );
      const input = parseInput(
        z.object({
          entry: KnowledgeEntrySchema,
          revision: z.number().int().nonnegative(),
        }),
        request.body,
        'The knowledge entry is invalid.',
      );
      const result = await ingestion.saveEntry(
        input.entry,
        getAdminPrincipal(response).id,
        { sourceId, revision: input.revision },
      );
      response.json(KnowledgeDocumentSchema.parse(result));
    },
  );

  router.post(
    '/documents',
    editors,
    requireAdminCsrf,
    rateLimitPerIp({
      windowMs: 10 * 60 * 1000,
      limit: 10,
      message: 'Too many document uploads. Please try again later.',
    }),
    parseUpload,
    async (request, response) => {
      if (!request.file) {
        throw new ApiError(
          400,
          'UPLOAD_REQUIRED',
          'Choose a document to upload.',
        );
      }
      const { language } = parseInput(
        UploadFieldsSchema,
        request.body ?? {},
        'Choose a supported document language.',
      );
      const principal = getAdminPrincipal(response);
      try {
        const document = await ingestion.ingest(
          {
            originalName: request.file.originalname,
            mimeType: request.file.mimetype,
            buffer: request.file.buffer,
          },
          language,
          principal.id,
        );
        response.status(201).json(KnowledgeDocumentSchema.parse(document));
      } catch (error) {
        if (!(error instanceof KnowledgeIngestionError)) {
          throw error;
        }
        logger.error(
          { errorName: errorName(error.cause), source: 'knowledge-ingestion' },
          'Knowledge document ingestion failed',
        );
        throw new ApiError(
          502,
          'EMBEDDING_FAILED',
          'The document could not be indexed. Please try again later.',
        );
      }
    },
  );

  router.delete(
    '/documents/:sourceId',
    administrators,
    requireAdminCsrf,
    async (request, response) => {
      const sourceId = parseInput(
        UuidSchema,
        request.params.sourceId,
        'The document ID is invalid.',
      );
      await knowledge.deleteDocument(sourceId);
      response.json({ status: 'deleted' });
    },
  );

  router.patch(
    '/documents/:sourceId/status',
    editors,
    requireAdminCsrf,
    express.json({ limit: '1kb', strict: true }),
    async (request, response) => {
      const sourceId = parseInput(
        UuidSchema,
        request.params.sourceId,
        'The document ID is invalid.',
      );
      const { status } = parseInput(
        StatusChangeSchema,
        request.body,
        'The requested status is invalid.',
      );
      const principal = getAdminPrincipal(response);
      await knowledge.changeStatus(principal.role, sourceId, status);
      response.json({ status });
    },
  );

  return router;
}
