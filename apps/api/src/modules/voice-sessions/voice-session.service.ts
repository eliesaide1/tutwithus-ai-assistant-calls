import { randomUUID, timingSafeEqual } from 'node:crypto';
import { verifyBrowserIdentity } from './browser-identity.js';
import type { AccountCheckNotifier } from '../../core/session/active-calls.js';
import type {
  CreateVoiceSessionRequest,
  VoiceTranscriptEntry,
} from '@tutwithus/contracts';
import type { ApiConfig } from '../../config/env.js';
import { createOpaqueToken, hashToken } from '../../lib/tokens.js';
import type {
  VoiceSessionRecord,
  VoiceSessionRepository,
} from './voice-session.repository.js';
export type {
  VoiceSessionRecord,
  VoiceSessionRepository,
} from './voice-session.repository.js';
import type {
  ActiveAgentSettings,
  AgentProfileSettingsReader,
} from '../settings/agent-settings.service.js';
import {
  canonicalPhone,
  maskPhone,
  type CustomerDirectory,
} from '../../platform/customer-directory.js';

// How long a consented session may wait before the browser connects.
export const SESSION_START_WINDOW_MS = 2 * 60 * 1000;
const SESSION_TOKEN_GRACE_SEC = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export type VoiceSessionErrorCode =
  | 'CAPTCHA_NOT_CONFIGURED'
  | 'CONSENT_VERSION_STALE'
  | 'PERSISTENCE_FAILED'
  | 'SESSION_UNAUTHORIZED'
  | 'SESSION_ALREADY_USED'
  | 'OPENAI_NOT_CONFIGURED'
  | 'ELEVENLABS_NOT_CONFIGURED'
  | 'CALL_CAPACITY_REACHED'
  | 'ACCOUNT_CHECK_LIMIT'
  | 'CUSTOMER_NOT_VERIFIED'
  | 'REALTIME_UNAVAILABLE';

export class VoiceSessionError extends Error {
  constructor(
    readonly code: VoiceSessionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'VoiceSessionError';
  }
}

type VoiceSessionConfig = Pick<
  ApiConfig,
  'consentVersion' | 'maxCallSec' | 'retentionDays' | 'elevenLabs'
>;

export async function createVoiceSession(
  request: CreateVoiceSessionRequest,
  config: VoiceSessionConfig,
  repository: VoiceSessionRepository,
  settingsReader: AgentProfileSettingsReader,
  customerDirectory: CustomerDirectory,
  // Optional so the session can still be created where no call registry
  // exists, such as in tests and the WhatsApp path.
  accountCheckNotifier?: AccountCheckNotifier,
) {
  if (request.captchaToken !== undefined) {
    throw new VoiceSessionError(
      'CAPTCHA_NOT_CONFIGURED',
      'Captcha verification is not configured for this service.',
    );
  }

  if (request.consentVersion !== config.consentVersion) {
    throw new VoiceSessionError(
      'CONSENT_VERSION_STALE',
      'The consent notice has changed. Please review it and try again.',
    );
  }
  if (
    request.locale === 'ar-SA' &&
    (!config.elevenLabs.apiKey ||
      !config.elevenLabs.saudiArabicVoiceId ||
      config.elevenLabs.saudiArabicVoiceId.startsWith('replace-with-'))
  ) {
    throw new VoiceSessionError(
      'ELEVENLABS_NOT_CONFIGURED',
      'Saudi Arabic speech is not configured.',
    );
  }

  let activeSettings: ActiveAgentSettings | null;
  try {
    activeSettings = await settingsReader.getActiveAgentSettings();
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Active agent settings could not be loaded.',
      { cause: error },
    );
  }
  const maxCallSec = activeSettings?.maxCallSec ?? config.maxCallSec;
  const trustedIdentity = await verifyBrowserIdentity(request.identityProof);
  const trustedPhone = trustedIdentity?.phone;
  const enteredPhone = request.phone
    ? canonicalPhone(request.phone)
    : undefined;
  const callbackPhone =
    trustedPhone ?? (enteredPhone ? `+${enteredPhone}` : undefined);
  let callerAccountStatus: VoiceSessionRecord['callerAccountStatus'] =
    'unavailable';
  let callerCustomerId: string | undefined;
  if (callbackPhone) {
    try {
      const lookup = await customerDirectory.lookup({ phone: callbackPhone });
      callerAccountStatus = lookup.status;
      if (lookup.status === 'registered') {
        callerCustomerId = lookup.customerId;
      }
    } catch {
      // An unavailable identity service must fail closed into knowledge-only
      // mode; it must not prevent the caller from asking general questions.
      callerAccountStatus = 'unavailable';
    }
  }
  const now = Date.now();
  const sessionToken = createOpaqueToken();
  const record: VoiceSessionRecord = {
    sessionId: randomUUID(),
    locale: request.locale,
    timeZone: request.timeZone ?? 'UTC',
    ...(callbackPhone ? { customerPhone: maskPhone(callbackPhone) } : {}),
    ...(callbackPhone ? { callbackPhone } : {}),
    // A separate registration lookup improves the message for known
    // unregistered numbers, but it is optional. The member-login endpoint is
    // the authority for the phone + member-ID pair and still grants no access
    // unless both values match.
    memberVerificationAvailable:
      callbackPhone !== undefined && callerAccountStatus !== 'not_registered',
    phoneOwnershipVerified: trustedPhone !== undefined,
    consentVersion: request.consentVersion,
    consentAccepted: request.consentAccepted,
    transcript: [],
    sessionTokenHash: sessionToken.hash,
    acceptedAt: new Date(now),
    maxDurationSec: maxCallSec,
    tokenExpiresAt: new Date(
      now +
        maxCallSec * 1000 +
        SESSION_START_WINDOW_MS +
        SESSION_TOKEN_GRACE_SEC * 1000,
    ),
    expiresAt: new Date(now + config.retentionDays * DAY_MS),
    callerAccountStatus,
    ...(callerCustomerId ? { callerCustomerId } : {}),
  };

  try {
    await repository.create(record);
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Voice session persistence failed.',
      { cause: error },
    );
  }

  // A caller handed over by the signed-in portal never types a member id, so
  // the member login that account tools depend on for an access token would
  // never run. Run it here with the pair the portal proved, and park the
  // result for the call to pick up when it connects.
  //
  // Failure is deliberately quiet: the caller still gets a call with public
  // knowledge, exactly as if the lookup had been unavailable.
  if (
    trustedIdentity?.memberId &&
    callbackPhone &&
    accountCheckNotifier &&
    customerDirectory.loginMember
  ) {
    try {
      const login = await customerDirectory.loginMember({
        phone: callbackPhone,
        memberId: trustedIdentity.memberId,
      });
      await accountCheckNotifier.notifyAccountCheck(
        record.sessionId,
        login.status === 'not_verified' ? 'not_registered' : login.status,
        login.status === 'verified' ? login.accessToken : undefined,
        login.status === 'verified' ? login.role : undefined,
      );
    } catch {
      // Leave the call in knowledge-only mode rather than failing to start.
    }
  }

  return {
    sessionId: record.sessionId,
    sessionToken: sessionToken.token,
    maxDurationSec: maxCallSec,
  };
}

function isSessionTokenValid(
  record: VoiceSessionRecord,
  sessionToken: string,
  now: Date,
): boolean {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(sessionToken) ||
    record.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    return false;
  }

  const expected = Buffer.from(record.sessionTokenHash, 'hex');
  const actual = Buffer.from(hashToken(sessionToken), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function getAuthorizedVoiceSession(
  sessionId: string,
  sessionToken: string,
  repository: VoiceSessionRepository,
  now: Date,
): Promise<VoiceSessionRecord> {
  let record: VoiceSessionRecord | null;
  try {
    record = await repository.findBySessionId(sessionId);
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Voice session lookup failed.',
      { cause: error },
    );
  }

  if (!record || !isSessionTokenValid(record, sessionToken, now)) {
    throw new VoiceSessionError(
      'SESSION_UNAUTHORIZED',
      'The voice session is invalid or expired.',
    );
  }
  return record;
}

type VerifiedVoiceCustomer = NonNullable<
  VoiceSessionRecord['verifiedCustomer']
>;

async function getVerifiedVoiceCustomer(
  repository: Pick<VoiceSessionRepository, 'findBySessionId'>,
  sessionId: string,
  now: Date,
): Promise<VerifiedVoiceCustomer> {
  let record: VoiceSessionRecord | null;
  try {
    record = await repository.findBySessionId(sessionId);
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Voice session lookup failed.',
      { cause: error },
    );
  }

  if (!record) {
    throw new VoiceSessionError(
      'SESSION_UNAUTHORIZED',
      'The voice session is invalid or expired.',
    );
  }
  if (!record.verifiedCustomer) {
    throw new VoiceSessionError(
      'CUSTOMER_NOT_VERIFIED',
      'A verified TutWithUs account is required.',
    );
  }
  if (
    !record.startedAt ||
    record.endedAt ||
    record.tokenExpiresAt.getTime() <= now.getTime()
  ) {
    throw new VoiceSessionError(
      'SESSION_ALREADY_USED',
      'The voice session is not active.',
    );
  }
  return record.verifiedCustomer;
}

export function createVerifiedVoiceCustomerResolver(
  repository: Pick<VoiceSessionRepository, 'findBySessionId'>,
): (sessionId: string, now: Date) => Promise<string> {
  return async (sessionId, now) => {
    const customer = await getVerifiedVoiceCustomer(repository, sessionId, now);
    if (!customer.customerId) {
      throw new VoiceSessionError(
        'CUSTOMER_NOT_VERIFIED',
        'A customer reference is not available for this account action.',
      );
    }
    return customer.customerId;
  };
}

export function createVerifiedVoiceContactResolver(
  repository: Pick<VoiceSessionRepository, 'findBySessionId'>,
): (sessionId: string, now: Date) => Promise<{ contactPhone?: string }> {
  return async (sessionId, now) => {
    const customer = await getVerifiedVoiceCustomer(repository, sessionId, now);
    return customer.contactPhone ? { contactPhone: customer.contactPhone } : {};
  };
}

export function createVoiceEscalationContactResolver(
  repository: Pick<VoiceSessionRepository, 'findBySessionId'>,
): (
  sessionId: string,
  now: Date,
) => Promise<{ verified: boolean; contactPhone?: string }> {
  return async (sessionId, now) => {
    let record: VoiceSessionRecord | null;
    try {
      record = await repository.findBySessionId(sessionId);
    } catch (error) {
      throw new VoiceSessionError(
        'PERSISTENCE_FAILED',
        'Voice session lookup failed.',
        { cause: error },
      );
    }

    if (!record) {
      throw new VoiceSessionError(
        'SESSION_UNAUTHORIZED',
        'The voice session is invalid or expired.',
      );
    }
    if (
      !record.startedAt ||
      record.endedAt ||
      record.tokenExpiresAt.getTime() <= now.getTime() ||
      (record.callExpiresAt && record.callExpiresAt.getTime() <= now.getTime())
    ) {
      throw new VoiceSessionError(
        'SESSION_ALREADY_USED',
        'The voice session is not active.',
      );
    }

    return record.verifiedCustomer
      ? {
          verified: true,
          ...(record.verifiedCustomer.contactPhone
            ? { contactPhone: record.verifiedCustomer.contactPhone }
            : {}),
        }
      : {
          verified: false,
          ...(record.callbackPhone
            ? { contactPhone: record.callbackPhone }
            : {}),
        };
  };
}

export async function endVoiceSession(
  sessionId: string,
  sessionToken: string,
  reason: string,
  repository: VoiceSessionRepository,
  now = new Date(),
): Promise<{ status: 'ended' }> {
  const record = await getAuthorizedVoiceSession(
    sessionId,
    sessionToken,
    repository,
    now,
  );
  if (!record.endedAt) {
    try {
      await repository.endCall({
        sessionId,
        sessionTokenHash: record.sessionTokenHash,
        endedAt: now,
        reason,
      });
    } catch (error) {
      throw new VoiceSessionError(
        'PERSISTENCE_FAILED',
        'Voice session could not be ended.',
        { cause: error },
      );
    }
  }
  return { status: 'ended' };
}

export async function saveVoiceTranscriptEntry(
  sessionId: string,
  sessionToken: string,
  entry: VoiceTranscriptEntry,
  repository: VoiceSessionRepository,
  now = new Date(),
): Promise<{ status: 'stored' }> {
  const record = await getAuthorizedVoiceSession(
    sessionId,
    sessionToken,
    repository,
    now,
  );
  if (!record.startedAt || record.endedAt) {
    throw new VoiceSessionError(
      'SESSION_ALREADY_USED',
      'The voice session is not active.',
    );
  }

  try {
    const stored = await repository.appendTranscript({
      sessionId,
      sessionTokenHash: record.sessionTokenHash,
      entry,
      receivedAt: now,
    });
    if (!stored) {
      throw new VoiceSessionError(
        'SESSION_ALREADY_USED',
        'The voice session is not active.',
      );
    }
  } catch (error) {
    if (error instanceof VoiceSessionError) {
      throw error;
    }
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'Voice transcript could not be stored.',
      { cause: error },
    );
  }

  return { status: 'stored' };
}
