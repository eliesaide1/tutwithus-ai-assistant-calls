import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Locale } from '@tutwithus/contracts';
import {
  canonicalPhone,
  maskPhone,
} from '../../platform/customer-directory.js';
import { NO_CONSENT_VERSION } from './voice-session.model.js';
import type { VoiceSessionRepository } from './voice-session.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Identifies one WhatsApp call to the repository. WhatsApp has no browser to
// hold a session token, so a random one is made and only its hash is kept; the
// repository checks it on every later write exactly as it does for browser calls.
export type WhatsAppCallHandle = {
  sessionId: string;
  sessionTokenHash: string;
  contactPhone?: string;
  // When the stored record (and its tool_invocations) expire.
  expiresAt: Date;
};

type SessionStore = Pick<
  VoiceSessionRepository,
  'create' | 'endCall' | 'recordCallOutcome' | 'markCustomerVerified'
>;

// Keeps one stored record per WhatsApp call so admins can see it and tool
// calls have a session to attach to. No transcript is saved: WhatsApp has no
// consent step yet, and the browser's transcript opt-in does not apply.
export class WhatsAppSessionService {
  constructor(
    private readonly sessions: SessionStore,
    private readonly options: {
      // Secret for hashing caller numbers. Without it a hash could be reversed
      // by trying every phone number.
      callerHashSecret: string;
      retentionDays: number;
      defaultCountryCode?: string | undefined;
    },
  ) {}

  async begin(input: {
    locale: Locale;
    // The number the SIP trunk reported. Missing when it is untrusted.
    callerNumber?: string | undefined;
    // Meta's WhatsApp call ID from the trusted SIP INVITE, when available.
    metaCallId?: string | undefined;
    maxCallSec: number;
    now?: Date;
  }): Promise<WhatsAppCallHandle> {
    const now = input.now ?? new Date();
    const sessionId = randomUUID();
    const sessionTokenHash = createHash('sha256')
      .update(randomBytes(32))
      .digest('hex');
    const callExpiresAt = new Date(now.getTime() + input.maxCallSec * 1000);
    const expiresAt = new Date(
      now.getTime() + this.options.retentionDays * DAY_MS,
    );
    const callerHash = input.callerNumber
      ? this.hashCaller(input.callerNumber)
      : undefined;

    await this.sessions.create({
      sessionId,
      sessionTokenHash,
      channel: 'whatsapp',
      ...(input.callerNumber
        ? { customerPhone: maskPhone(input.callerNumber) }
        : {}),
      ...(callerHash ? { callerHash } : {}),
      ...(input.metaCallId ? { metaCallId: input.metaCallId } : {}),
      locale: input.locale,
      consentVersion: NO_CONSENT_VERSION,
      consentAccepted: false,
      acceptedAt: now,
      tokenExpiresAt: callExpiresAt,
      expiresAt,
      maxDurationSec: input.maxCallSec,
      startedAt: now,
      callExpiresAt,
      transcript: [],
    });
    return {
      sessionId,
      sessionTokenHash,
      expiresAt,
      ...(input.callerNumber
        ? { contactPhone: input.callerNumber.trim() }
        : {}),
    };
  }

  async markCustomerVerified(
    handle: WhatsAppCallHandle,
    customerId: string,
  ): Promise<void> {
    await this.sessions.markCustomerVerified({
      sessionId: handle.sessionId,
      sessionTokenHash: handle.sessionTokenHash,
      customerId,
      verifiedAt: new Date(),
      via: 'caller_id',
      ...(handle.contactPhone ? { contactPhone: handle.contactPhone } : {}),
    });
  }

  async end(
    handle: WhatsAppCallHandle,
    result: { reason: string; flags?: string[] },
  ): Promise<void> {
    await this.sessions.endCall({
      sessionId: handle.sessionId,
      sessionTokenHash: handle.sessionTokenHash,
      endedAt: new Date(),
      reason: result.reason,
    });
    if (result.flags?.length) {
      await this.sessions.recordCallOutcome({
        sessionId: handle.sessionId,
        sessionTokenHash: handle.sessionTokenHash,
        outcome: { flags: result.flags },
      });
    }
  }

  // Same number, same hash, so repeat callers can be counted without storing
  // the number. Not reversible without the secret.
  private hashCaller(callerNumber: string): string {
    const canonical =
      canonicalPhone(callerNumber, this.options.defaultCountryCode) ??
      callerNumber.trim();
    return createHmac('sha256', this.options.callerHashSecret)
      .update(canonical)
      .digest('hex');
  }
}
