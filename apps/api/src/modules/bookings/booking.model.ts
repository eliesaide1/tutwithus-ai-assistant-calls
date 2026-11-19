import mongoose, { Schema, type Model } from 'mongoose';

export type BookingNote = {
  authorId: string;
  text: string;
  createdAt: Date;
};

export type BookingRecord = {
  sessionId: string;
  customerId?: string;
  reference: string;
  status: 'draft' | 'submitted' | 'confirmed' | 'cancelled' | 'handled';
  subject: string;
  level: string;
  curriculum?: string;
  tutorId?: string;
  tutorName?: string;
  sessionStart?: Date;
  sessionEnd?: Date;
  preferredTimes: string[];
  timezone: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes: BookingNote[];
  readBackAt?: Date;
  confirmedAt?: Date;
  confirmedVia?: 'click' | 'voice';
  assigneeId?: string;
  createdAt: Date;
  updatedAt: Date;
};

type BookingDocument = BookingRecord & mongoose.Document;

const bookingNoteSchema = new Schema<BookingNote>(
  {
    authorId: { type: String, required: true },
    text: { type: String, required: true, maxlength: 1000 },
    createdAt: { type: Date, required: true },
  },
  { _id: false, versionKey: false },
);

const bookingSchema = new Schema<BookingDocument>(
  {
    sessionId: { type: String, required: true },
    reference: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'submitted', 'confirmed', 'cancelled', 'handled'],
      required: true,
    },
    subject: { type: String, required: true, maxlength: 120 },
    level: { type: String, required: true, maxlength: 80 },
    curriculum: { type: String, maxlength: 120 },
    customerId: { type: String, maxlength: 128 },
    tutorId: { type: String, maxlength: 128 },
    tutorName: { type: String, maxlength: 120 },
    sessionStart: Date,
    sessionEnd: Date,
    preferredTimes: [{ type: String, required: true, maxlength: 120 }],
    timezone: { type: String, required: true, maxlength: 64 },
    contactName: { type: String, required: true, maxlength: 120 },
    contactPhone: { type: String, maxlength: 40 },
    contactEmail: { type: String, maxlength: 254 },
    notes: { type: [bookingNoteSchema], default: [] },
    readBackAt: Date,
    confirmedAt: Date,
    confirmedVia: { type: String, enum: ['click', 'voice'] },
    assigneeId: { type: String },
  },
  { timestamps: true, versionKey: false },
);
bookingSchema.index({ status: 1, createdAt: -1 });
bookingSchema.index({ sessionId: 1, status: 1 });

export const BookingRequestModel: Model<BookingDocument> =
  mongoose.models.BookingRequest ??
  mongoose.model<BookingDocument>(
    'BookingRequest',
    bookingSchema,
    'booking_requests',
  );
