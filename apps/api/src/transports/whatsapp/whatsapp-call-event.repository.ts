import { WhatsAppCallEventModel } from './whatsapp-call-event.model.js';

export type WhatsAppCallEvent = {
  callId: string;
  event: 'call_created' | 'terminate';
  occurredAt: Date;
  phoneNumberId?: string;
};

export interface WhatsAppCallEventRepository {
  record(event: WhatsAppCallEvent): Promise<void>;
}

export class MongoWhatsAppCallEventRepository implements WhatsAppCallEventRepository {
  constructor(private readonly retentionDays: number) {}

  async record(event: WhatsAppCallEvent): Promise<void> {
    const expiresAt = new Date(
      Date.now() + this.retentionDays * 24 * 60 * 60 * 1000,
    );
    const timestampField =
      event.event === 'call_created' ? 'callCreatedAt' : 'callTerminatedAt';

    await WhatsAppCallEventModel.updateOne(
      { callId: event.callId },
      {
        $setOnInsert: { callId: event.callId, expiresAt },
        $set: {
          [timestampField]: event.occurredAt,
          ...(event.phoneNumberId
            ? { phoneNumberId: event.phoneNumberId }
            : {}),
        },
      },
      { upsert: true },
    ).exec();
  }
}
