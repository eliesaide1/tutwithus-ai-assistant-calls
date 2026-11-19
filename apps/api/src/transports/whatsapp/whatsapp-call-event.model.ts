import mongoose, { Schema, type Model } from 'mongoose';

export type WhatsAppCallEventRecord = {
  callId: string;
  phoneNumberId?: string;
  callCreatedAt?: Date;
  callTerminatedAt?: Date;
  expiresAt: Date;
};

const whatsappCallEventSchema = new Schema<WhatsAppCallEventRecord>(
  {
    callId: { type: String, required: true, maxlength: 256 },
    phoneNumberId: { type: String, maxlength: 64 },
    callCreatedAt: { type: Date },
    callTerminatedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);

whatsappCallEventSchema.index({ callId: 1 }, { unique: true });
whatsappCallEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WhatsAppCallEventModel: Model<WhatsAppCallEventRecord> =
  mongoose.models.WhatsAppCallEvent ??
  mongoose.model<WhatsAppCallEventRecord>(
    'WhatsAppCallEvent',
    whatsappCallEventSchema,
    'whatsapp_call_events',
  );
