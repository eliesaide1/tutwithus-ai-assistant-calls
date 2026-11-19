import {
  LocaleSchema,
  type CreateVoiceSessionRequest,
  type VoiceTranscriptEntry,
} from '@tutwithus/contracts';
import mongoose, { Schema, type Model } from 'mongoose';

export type TranscriptCitation = { sourceId: string; title: string };

export type VoiceChannel = 'browser' | 'whatsapp';

// Stored in place of a consent version for WhatsApp calls, which have no consent
// step yet. Such records never hold a transcript.
export const NO_CONSENT_VERSION = 'none';

export type VoiceSessionRecord = Omit<
  CreateVoiceSessionRequest,
  'captchaToken' | 'consentAccepted' | 'phone' | 'identityProof'
> & {
  // Browser sessions must have accepted consent. WhatsApp ones have none.
  consentAccepted: boolean;
  // Missing on older records, which are all browser calls.
  channel?: VoiceChannel;
  // Retained for the admin conversation title.
  customerPhone?: string;
  // Collected at call start and used only for consented public escalation.
  callbackPhone?: string;
  // True when the call-start phone exists in the customer directory, so the
  // caller may prove access by providing the matching TutWithUs member ID.
  // This does not authenticate the caller by itself.
  memberVerificationAvailable?: boolean;
  phoneOwnershipVerified?: boolean;
  // Keyed hash of the WhatsApp caller number. Never the number itself.
  callerHash?: string;
  // Meta WACID, used to correlate WhatsApp SIP webhook events with this call.
  metaCallId?: string;
  sessionId: string;
  sessionTokenHash: string;
  acceptedAt: Date;
  tokenExpiresAt: Date;
  expiresAt: Date;
  maxDurationSec?: number;
  transcript: Array<
    VoiceTranscriptEntry & {
      citations?: TranscriptCitation[];
      receivedAt: Date;
    }
  >;
  startedAt?: Date;
  callExpiresAt?: Date;
  endedAt?: Date;
  endReason?: string;
  // OpenAI call ID, used by the server to hang up and to attach the sideband.
  providerCallId?: string;
  // Server-detected anomalies, for example 'session_tampered'.
  flags?: string[];
  usage?: { inputTokens: number; outputTokens: number };
  // Attempts to match the caller to a registered customer (capped per call).
  accountCheckAttempts?: number;
  // Result of the call-start phone lookup made before the call starts. This is
  // internal call state and is never returned to the browser.
  callerAccountStatus?: 'registered' | 'not_registered' | 'unavailable';
  callerCustomerId?: string;
  // Set only by the server after account verification. Holds no credentials.
  verifiedCustomer?: {
    customerId?: string;
    verifiedAt: Date;
    via: 'form' | 'caller_id' | 'voice_member_id';
    contactPhone?: string;
  };
};

type VoiceSessionDocument = VoiceSessionRecord & {
  createdAt: Date;
  updatedAt: Date;
};

const voiceSessionSchema = new Schema<VoiceSessionDocument>(
  {
    sessionId: { type: String, required: true, unique: true },
    locale: { type: String, enum: LocaleSchema.options, required: true },
    timeZone: { type: String, required: true, default: 'UTC', maxlength: 64 },
    consentVersion: { type: String, required: true },
    channel: {
      type: String,
      enum: ['browser', 'whatsapp'],
      default: 'browser',
    },
    customerPhone: { type: String, maxlength: 24 },
    callbackPhone: { type: String, maxlength: 24, select: false },
    memberVerificationAvailable: { type: Boolean, default: false },
    phoneOwnershipVerified: { type: Boolean, default: false },
    callerHash: { type: String, maxlength: 128 },
    metaCallId: { type: String, maxlength: 256 },
    consentAccepted: {
      type: Boolean,
      required: true,
      validate: {
        validator(this: { channel?: string }, value: boolean) {
          return this.channel === 'whatsapp' || value === true;
        },
        message: 'Consent must be accepted.',
      },
    },
    transcript: {
      type: [
        new Schema(
          {
            eventId: { type: String, required: true, maxlength: 256 },
            speaker: {
              type: String,
              enum: ['user', 'assistant'],
              required: true,
            },
            text: { type: String, required: true, maxlength: 2_000 },
            citations: {
              type: [
                new Schema(
                  {
                    sourceId: { type: String, required: true, maxlength: 64 },
                    title: { type: String, required: true, maxlength: 256 },
                  },
                  { _id: false, versionKey: false },
                ),
              ],
              default: undefined,
            },
            receivedAt: { type: Date, required: true },
          },
          { _id: false, versionKey: false },
        ),
      ],
      default: [],
    },
    sessionTokenHash: { type: String, required: true, select: false },
    acceptedAt: { type: Date, required: true },
    tokenExpiresAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    maxDurationSec: { type: Number, min: 30, max: 1800 },
    startedAt: { type: Date },
    callExpiresAt: { type: Date },
    endedAt: { type: Date },
    endReason: { type: String, maxlength: 64 },
    providerCallId: { type: String, maxlength: 128 },
    accountCheckAttempts: { type: Number, default: 0, min: 0 },
    callerAccountStatus: {
      type: String,
      enum: ['registered', 'not_registered', 'unavailable'],
    },
    callerCustomerId: { type: String, maxlength: 128 },
    verifiedCustomer: {
      type: new Schema(
        {
          customerId: { type: String, maxlength: 128 },
          verifiedAt: { type: Date, required: true },
          via: {
            type: String,
            enum: ['form', 'caller_id', 'voice_member_id'],
            required: true,
          },
          contactPhone: { type: String, maxlength: 40 },
        },
        { _id: false, versionKey: false },
      ),
      default: undefined,
    },
    flags: { type: [String], default: undefined },
    usage: {
      type: new Schema(
        {
          inputTokens: { type: Number, required: true, min: 0 },
          outputTokens: { type: Number, required: true, min: 0 },
        },
        { _id: false, versionKey: false },
      ),
      default: undefined,
    },
  },
  { timestamps: true, versionKey: false },
);

export function canVerifyVoiceSessionMember(
  record: Pick<
    VoiceSessionRecord,
    'memberVerificationAvailable' | 'phoneOwnershipVerified'
  >,
): boolean {
  // Preserve signed-identity sessions created before this field was added.
  return (
    record.memberVerificationAvailable === true ||
    (record.memberVerificationAvailable === undefined &&
      record.phoneOwnershipVerified === true)
  );
}

// MongoDB deletes the record once expiresAt passes (retention policy).
voiceSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
voiceSessionSchema.index({ createdAt: -1 });
voiceSessionSchema.index({ providerCallId: 1 }, { sparse: true });
voiceSessionSchema.index({ metaCallId: 1 }, { sparse: true });

export const VoiceSessionModel: Model<VoiceSessionDocument> =
  mongoose.models.VoiceSession ??
  mongoose.model<VoiceSessionDocument>(
    'VoiceSession',
    voiceSessionSchema,
    'voice_sessions',
  );
