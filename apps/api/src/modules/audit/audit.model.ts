import mongoose, { Schema, type Model } from 'mongoose';

export type AuditRecord = {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  diff: Record<string, unknown>;
  ipHash?: string;
  at: Date;
};

type AuditDocument = AuditRecord & mongoose.Document;

const auditSchema = new Schema<AuditDocument>(
  {
    actorId: { type: String, required: true },
    action: { type: String, required: true, maxlength: 80 },
    entity: { type: String, required: true, maxlength: 80 },
    entityId: { type: String, required: true, maxlength: 128 },
    diff: { type: Schema.Types.Mixed, required: true },
    ipHash: { type: String, maxlength: 128 },
    at: { type: Date, required: true },
  },
  { versionKey: false },
);
auditSchema.index({ entity: 1, entityId: 1, at: -1 });
auditSchema.index({ actorId: 1, at: -1 });

export const AuditLogModel: Model<AuditDocument> =
  mongoose.models.AuditLog ??
  mongoose.model<AuditDocument>('AuditLog', auditSchema, 'audit_logs');
