import mongoose, { Schema, type Model } from 'mongoose';
import { AgentSettingsDraftRequestSchema } from '@tutwithus/contracts/admin';
import type { z } from 'zod';

export type AgentSettingsDraft = z.infer<
  typeof AgentSettingsDraftRequestSchema
>;
export type AgentSettingsRecord = AgentSettingsDraft & {
  version: number;
  status: 'draft' | 'active' | 'archived';
  activatedBy?: string;
  activatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

type AgentSettingsDocument = AgentSettingsRecord & mongoose.Document;

const agentSettingsSchema = new Schema<AgentSettingsDocument>(
  {
    name: { type: String, required: true, maxlength: 80 },
    version: { type: Number, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'active', 'archived'],
      required: true,
    },
    greeting: {
      'ar-SA': { type: String, required: true, maxlength: 500 },
      en: { type: String, required: true, maxlength: 500 },
      fr: { type: String, required: true, maxlength: 500 },
    },
    instructionTemplate: { type: String, required: true, maxlength: 8000 },
    voice: {
      type: String,
      enum: [
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'sage',
        'shimmer',
        'verse',
        'marin',
        'cedar',
      ],
      required: true,
    },
    maxCallSec: { type: Number, required: true, min: 30, max: 1800 },
    businessHours: { type: String, required: true, maxlength: 1000 },
    escalation: {
      hoursText: { type: String, required: true, maxlength: 1000 },
    },
    activatedBy: String,
    activatedAt: Date,
  },
  { timestamps: true, versionKey: false },
);
agentSettingsSchema.index(
  { status: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } },
);

export const AgentSettingsModel: Model<AgentSettingsDocument> =
  mongoose.models.AgentSettings ??
  mongoose.model<AgentSettingsDocument>(
    'AgentSettings',
    agentSettingsSchema,
    'agent_settings',
  );
