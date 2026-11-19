import mongoose from 'mongoose';
import { AuditLogModel, type AuditRecord } from './audit.model.js';

export type AuditFilter = {
  entity?: string;
  entityId?: string;
  limit: number;
};
export type AuditEntry = AuditRecord & { id: string };

export interface AuditRepository {
  addAuditRecord(record: AuditRecord): Promise<void>;
  listAuditRecords(filter: AuditFilter): Promise<AuditEntry[]>;
}

export class MongoAuditRepository implements AuditRepository {
  async addAuditRecord(record: AuditRecord): Promise<void> {
    await AuditLogModel.create(record);
  }

  async listAuditRecords(input: AuditFilter) {
    const records = await AuditLogModel.find({
      ...(input.entity ? { entity: input.entity } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
    })
      .sort({ at: -1 })
      .limit(input.limit)
      .lean()
      .exec();
    return records.map((record) => ({
      ...record,
      id:
        record._id instanceof mongoose.Types.ObjectId
          ? record._id.toString()
          : String(record._id),
    }));
  }
}
