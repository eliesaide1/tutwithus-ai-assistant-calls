import mongoose, { Schema, type Model } from 'mongoose';

export type ToolInvocationRecord = {
  sessionId: string;
  tool: string;
  // Arguments with contact details and free text removed.
  argsRedacted: unknown;
  decision: 'allowed' | 'denied';
  denyReason?: string;
  resultSummary?: string;
  latencyMs: number;
  // Matches the voice session retention; MongoDB deletes the record after it.
  expiresAt: Date;
};

type ToolInvocationDocument = ToolInvocationRecord & {
  createdAt: Date;
  updatedAt: Date;
};

const toolInvocationSchema = new Schema<ToolInvocationDocument>(
  {
    sessionId: { type: String, required: true },
    tool: { type: String, required: true, maxlength: 64 },
    argsRedacted: { type: Schema.Types.Mixed },
    decision: { type: String, enum: ['allowed', 'denied'], required: true },
    denyReason: { type: String, maxlength: 64 },
    resultSummary: { type: String, maxlength: 256 },
    latencyMs: { type: Number, required: true, min: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);

toolInvocationSchema.index({ sessionId: 1, createdAt: 1 });
toolInvocationSchema.index({ tool: 1, decision: 1, createdAt: -1 });
toolInvocationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ToolInvocationModel: Model<ToolInvocationDocument> =
  mongoose.models.ToolInvocation ??
  mongoose.model<ToolInvocationDocument>(
    'ToolInvocation',
    toolInvocationSchema,
    'tool_invocations',
  );
