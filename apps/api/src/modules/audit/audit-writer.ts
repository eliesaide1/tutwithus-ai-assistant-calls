import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import type { ApiConfig } from '../../config/env.js';
import type { AuditRecord } from './audit.model.js';
import type { AuditRepository } from './audit.repository.js';

type AuditEntryInput = Omit<AuditRecord, 'actorId' | 'ipHash' | 'at'>;

export type AuditWriter = (
  request: Request,
  actorId: string,
  entry: AuditEntryInput,
) => Promise<void>;

export function createAuditWriter(
  store: AuditRepository,
  config: ApiConfig,
): AuditWriter {
  return async (request, actorId, entry) => {
    const ipHash = request.ip
      ? createHmac('sha256', config.adminJwtSecret)
          .update(request.ip)
          .digest('hex')
      : undefined;
    await store.addAuditRecord({
      ...entry,
      actorId,
      ...(ipHash ? { ipHash } : {}),
      at: new Date(),
    });
  };
}
