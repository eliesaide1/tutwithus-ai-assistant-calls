import mongoose, { Schema, type Model } from 'mongoose';

export type EscalationNote = {
  authorId: string;
  text: string;
  createdAt: Date;
};

export type EscalationRecord = {
  sessionId: string;
  ticketRef: string;
  reason:
    'out_of_scope' | 'user_requested' | 'complaint' | 'safety' | 'technical';
  summary: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'claimed' | 'resolved';
  contactConsent: boolean;
  contact?: { phone?: string; email?: string };
  assigneeId?: string;
  notes: EscalationNote[];
  slaDueAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type EscalationDocument = EscalationRecord & mongoose.Document;

const escalationNoteSchema = new Schema<EscalationNote>(
  {
    authorId: { type: String, required: true },
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, required: true },
  },
  { _id: false, versionKey: false },
);

const escalationSchema = new Schema<EscalationDocument>(
  {
    sessionId: { type: String, required: true },
    ticketRef: { type: String, required: true, unique: true },
    reason: {
      type: String,
      enum: [
        'out_of_scope',
        'user_requested',
        'complaint',
        'safety',
        'technical',
      ],
      required: true,
    },
    summary: { type: String, required: true, maxlength: 2000 },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      required: true,
    },
    status: {
      type: String,
      enum: ['open', 'claimed', 'resolved'],
      required: true,
    },
    contactConsent: { type: Boolean, required: true },
    contact: {
      phone: { type: String, maxlength: 40 },
      email: { type: String, maxlength: 254 },
    },
    assigneeId: { type: String },
    notes: { type: [escalationNoteSchema], default: [] },
    slaDueAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false },
);
escalationSchema.index({ status: 1, priority: -1, createdAt: 1 });
escalationSchema.index({ assigneeId: 1, status: 1 });

export const EscalationModel: Model<EscalationDocument> =
  mongoose.models.Escalation ??
  mongoose.model<EscalationDocument>(
    'Escalation',
    escalationSchema,
    'escalations',
  );
