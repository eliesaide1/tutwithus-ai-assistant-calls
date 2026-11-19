import {
  VoiceSessionModel,
  type VoiceSessionRecord,
} from './voice-session.model.js';
import type { Locale, VoiceTranscriptEntry } from '@tutwithus/contracts';
import type {
  TranscriptCitation,
  VoiceChannel,
} from './voice-session.model.js';
import type {
  AdminConversation,
  AdminConversationSummary,
} from '@tutwithus/contracts/admin';

export type { VoiceSessionRecord } from './voice-session.model.js';

// A transcript turn as stored. Citations are added by the server only.
export type StoredTranscriptEntry = VoiceTranscriptEntry & {
  citations?: TranscriptCitation[];
};

export type CallOutcome = {
  flags?: string[];
  usage?: { inputTokens: number; outputTokens: number };
};

export type ConversationFilter = {
  locale?: Locale;
  status?: 'active' | 'ended';
  channel?: VoiceChannel;
};

export function buildAdminConversationMatch(
  filter: ConversationFilter = {},
): Record<string, unknown> {
  return {
    startedAt: { $exists: true },
    ...(filter.locale ? { locale: filter.locale } : {}),
    // Records saved before channels existed have no channel and are browser calls.
    ...(filter.channel === 'whatsapp'
      ? { channel: 'whatsapp' }
      : filter.channel === 'browser'
        ? { channel: { $ne: 'whatsapp' } }
        : {}),
    ...(filter.status === 'active'
      ? { endedAt: { $exists: false } }
      : filter.status === 'ended'
        ? { endedAt: { $exists: true } }
        : {}),
  };
}

export interface VoiceSessionRepository {
  create(record: VoiceSessionRecord): Promise<void>;
  findBySessionId(sessionId: string): Promise<VoiceSessionRecord | null>;
  startCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    startedAt: Date;
    callExpiresAt: Date;
  }): Promise<boolean>;
  endCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    endedAt: Date;
    reason: string;
  }): Promise<void>;
  appendTranscript(input: {
    sessionId: string;
    sessionTokenHash: string;
    entry: StoredTranscriptEntry;
    receivedAt: Date;
  }): Promise<boolean>;
  attachProviderCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    providerCallId: string;
  }): Promise<void>;
  // Counts one account-check attempt. This may run immediately before the
  // browser connects; false means the session ended or reached its cap.
  reserveAccountCheck(input: {
    sessionId: string;
    sessionTokenHash: string;
    maxAttempts: number;
  }): Promise<boolean>;
  markCustomerVerified(input: {
    sessionId: string;
    sessionTokenHash: string;
    customerId?: string;
    verifiedAt: Date;
    via: 'form' | 'caller_id' | 'voice_member_id';
    contactPhone?: string;
  }): Promise<void>;
  // Saves flags and usage. Works after the call has ended.
  recordCallOutcome(input: {
    sessionId: string;
    sessionTokenHash: string;
    outcome: CallOutcome;
  }): Promise<void>;
  listAdminConversations(
    filter: ConversationFilter,
  ): Promise<AdminConversationSummary[]>;
  findAdminConversation(sessionId: string): Promise<AdminConversation | null>;
}

export class MongoVoiceSessionRepository implements VoiceSessionRepository {
  async create(record: VoiceSessionRecord): Promise<void> {
    await VoiceSessionModel.create(record);
  }

  async findBySessionId(sessionId: string): Promise<VoiceSessionRecord | null> {
    return VoiceSessionModel.findOne({ sessionId })
      .select('+sessionTokenHash +callbackPhone')
      .lean()
      .exec();
  }

  async startCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    startedAt: Date;
    callExpiresAt: Date;
  }): Promise<boolean> {
    const updated = await VoiceSessionModel.findOneAndUpdate(
      {
        sessionId: input.sessionId,
        sessionTokenHash: input.sessionTokenHash,
        tokenExpiresAt: { $gt: input.startedAt },
        consentAccepted: true,
        startedAt: { $exists: false },
        endedAt: { $exists: false },
      },
      {
        $set: {
          startedAt: input.startedAt,
          callExpiresAt: input.callExpiresAt,
        },
      },
      { new: true },
    )
      .select('_id')
      .lean()
      .exec();
    return updated !== null;
  }

  async endCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    endedAt: Date;
    reason: string;
  }): Promise<void> {
    await VoiceSessionModel.updateOne(
      {
        sessionId: input.sessionId,
        sessionTokenHash: input.sessionTokenHash,
        endedAt: { $exists: false },
      },
      { $set: { endedAt: input.endedAt, endReason: input.reason } },
    ).exec();
  }

  async reserveAccountCheck(input: {
    sessionId: string;
    sessionTokenHash: string;
    maxAttempts: number;
  }): Promise<boolean> {
    const result = await VoiceSessionModel.updateOne(
      {
        sessionId: input.sessionId,
        sessionTokenHash: input.sessionTokenHash,
        endedAt: { $exists: false },
        $or: [
          { accountCheckAttempts: { $lt: input.maxAttempts } },
          { accountCheckAttempts: { $exists: false } },
        ],
      },
      { $inc: { accountCheckAttempts: 1 } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async markCustomerVerified(input: {
    sessionId: string;
    sessionTokenHash: string;
    customerId?: string;
    verifiedAt: Date;
    via: 'form' | 'caller_id' | 'voice_member_id';
    contactPhone?: string;
  }): Promise<void> {
    await VoiceSessionModel.updateOne(
      { sessionId: input.sessionId, sessionTokenHash: input.sessionTokenHash },
      {
        $set: {
          verifiedCustomer: {
            ...(input.customerId ? { customerId: input.customerId } : {}),
            verifiedAt: input.verifiedAt,
            via: input.via,
            ...(input.contactPhone ? { contactPhone: input.contactPhone } : {}),
          },
        },
      },
    ).exec();
  }

  async attachProviderCall(input: {
    sessionId: string;
    sessionTokenHash: string;
    providerCallId: string;
  }): Promise<void> {
    await VoiceSessionModel.updateOne(
      { sessionId: input.sessionId, sessionTokenHash: input.sessionTokenHash },
      { $set: { providerCallId: input.providerCallId } },
    ).exec();
  }

  async recordCallOutcome(input: {
    sessionId: string;
    sessionTokenHash: string;
    outcome: CallOutcome;
  }): Promise<void> {
    const { flags, usage } = input.outcome;
    await VoiceSessionModel.updateOne(
      { sessionId: input.sessionId, sessionTokenHash: input.sessionTokenHash },
      {
        ...(flags?.length ? { $addToSet: { flags: { $each: flags } } } : {}),
        ...(usage ? { $set: { usage } } : {}),
      },
    ).exec();
  }

  async appendTranscript(input: {
    sessionId: string;
    sessionTokenHash: string;
    entry: StoredTranscriptEntry;
    receivedAt: Date;
  }): Promise<boolean> {
    const updated = await VoiceSessionModel.updateOne(
      {
        sessionId: input.sessionId,
        sessionTokenHash: input.sessionTokenHash,
        startedAt: { $exists: true },
        endedAt: { $exists: false },
        transcript: { $not: { $elemMatch: { eventId: input.entry.eventId } } },
      },
      {
        $push: {
          transcript: { ...input.entry, receivedAt: input.receivedAt },
        },
      },
    ).exec();

    if (updated.modifiedCount > 0) {
      return true;
    }

    const existing = await VoiceSessionModel.exists({
      sessionId: input.sessionId,
      sessionTokenHash: input.sessionTokenHash,
      'transcript.eventId': input.entry.eventId,
    }).exec();
    if (existing && input.entry.citations?.length) {
      // The browser and the server both record each turn. Whoever arrives
      // second must not lose the server's citations.
      await VoiceSessionModel.updateOne(
        {
          sessionId: input.sessionId,
          sessionTokenHash: input.sessionTokenHash,
          'transcript.eventId': input.entry.eventId,
        },
        { $set: { 'transcript.$.citations': input.entry.citations } },
      ).exec();
    }
    return existing !== null;
  }

  async listAdminConversations(
    filter: ConversationFilter,
  ): Promise<AdminConversationSummary[]> {
    const records = await VoiceSessionModel.aggregate<{
      sessionId: string;
      locale: Locale;
      startedAt?: Date;
      endedAt?: Date;
      flags?: string[];
      channel?: VoiceChannel;
      customerPhone?: string;
      transcriptCount: number;
    }>([
      {
        $match: buildAdminConversationMatch(filter),
      },
      { $sort: { createdAt: -1 } },
      { $limit: 100 },
      {
        $project: {
          _id: 0,
          sessionId: 1,
          locale: 1,
          startedAt: 1,
          endedAt: 1,
          flags: 1,
          channel: 1,
          customerPhone: 1,
          transcriptCount: {
            $size: { $ifNull: ['$transcript', []] },
          },
        },
      },
    ]).exec();
    return records.map((record) => ({
      sessionId: record.sessionId,
      locale: record.locale,
      status: record.endedAt ? 'ended' : 'active',
      ...(record.startedAt
        ? { startedAt: record.startedAt.toISOString() }
        : {}),
      ...(record.endedAt ? { endedAt: record.endedAt.toISOString() } : {}),
      ...(record.flags?.length ? { flags: record.flags } : {}),
      channel: record.channel ?? 'browser',
      ...(record.customerPhone ? { customerPhone: record.customerPhone } : {}),
      transcriptCount: record.transcriptCount,
    }));
  }

  async findAdminConversation(
    sessionId: string,
  ): Promise<AdminConversation | null> {
    const record = await VoiceSessionModel.findOne({
      sessionId,
      ...buildAdminConversationMatch(),
    })
      .select(
        'sessionId locale startedAt endedAt flags channel customerPhone transcript',
      )
      .lean()
      .exec();
    if (!record) {
      return null;
    }
    return {
      sessionId: record.sessionId,
      locale: record.locale,
      status: record.endedAt ? 'ended' : 'active',
      ...(record.startedAt
        ? { startedAt: record.startedAt.toISOString() }
        : {}),
      ...(record.endedAt ? { endedAt: record.endedAt.toISOString() } : {}),
      ...(record.flags?.length ? { flags: record.flags } : {}),
      channel: record.channel ?? 'browser',
      ...(record.customerPhone ? { customerPhone: record.customerPhone } : {}),
      transcriptCount: record.transcript.length,
      transcript: record.transcript.map((entry) => ({
        speaker: entry.speaker,
        text: entry.text,
        receivedAt: entry.receivedAt.toISOString(),
        ...(entry.citations?.length ? { citations: entry.citations } : {}),
      })),
    };
  }
}
