import type { AccountCheckNotifier } from '../../core/session/active-calls.js';
import type { AccountCheckOutcome } from '../../core/session/session-ports.js';
import {
  canonicalPhone,
  type CustomerDirectory,
} from '../../platform/customer-directory.js';
import type { VoiceSessionRepository } from './voice-session.repository.js';
import { canVerifyVoiceSessionMember } from './voice-session.model.js';
import {
  getAuthorizedVoiceSession,
  VoiceSessionError,
} from './voice-session.service.js';

// Attempts allowed per call. Together with the per-IP limit on the route this
// keeps the check from being used to find out who is a customer.
export const MAX_ACCOUNT_CHECKS_PER_CALL = 3;

export type AccountCheckDeps = {
  repository: VoiceSessionRepository;
  directory: CustomerDirectory;
  notifier: AccountCheckNotifier;
};

// Verifies the member ID against the phone collected at call start. Neither
// the member ID nor the returned access token is persisted or sent to the browser.
export async function checkCallerAccount(
  deps: AccountCheckDeps,
  input: {
    sessionId: string;
    sessionToken: string;
    memberId: string;
  },
  now = new Date(),
): Promise<AccountCheckOutcome> {
  const record = await getAuthorizedVoiceSession(
    input.sessionId,
    input.sessionToken,
    deps.repository,
    now,
  );
  if (record.endedAt) {
    throw new VoiceSessionError(
      'SESSION_ALREADY_USED',
      'The voice session has ended.',
    );
  }

  if (!canVerifyVoiceSessionMember(record)) return 'unavailable';

  let reserved: boolean;
  try {
    reserved = await deps.repository.reserveAccountCheck({
      sessionId: input.sessionId,
      sessionTokenHash: record.sessionTokenHash,
      maxAttempts: MAX_ACCOUNT_CHECKS_PER_CALL,
    });
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'The account check could not be recorded.',
      { cause: error },
    );
  }
  if (!reserved) {
    throw new VoiceSessionError(
      'ACCOUNT_CHECK_LIMIT',
      'Too many account checks for this call.',
    );
  }

  const phone = record.callbackPhone
    ? canonicalPhone(record.callbackPhone)
    : undefined;
  let result: Awaited<
    ReturnType<NonNullable<CustomerDirectory['loginMember']>>
  > = { status: 'unavailable' };
  if (phone && deps.directory.loginMember) {
    try {
      result = await deps.directory.loginMember({
        phone,
        memberId: input.memberId,
      });
    } catch {
      result = { status: 'unavailable' };
    }
  }

  const outcome: AccountCheckOutcome =
    result.status === 'not_verified' ? 'not_registered' : result.status;
  if (result.status === 'verified') {
    try {
      await deps.repository.markCustomerVerified({
        sessionId: input.sessionId,
        sessionTokenHash: record.sessionTokenHash,
        ...(record.callerCustomerId
          ? { customerId: record.callerCustomerId }
          : {}),
        verifiedAt: now,
        via: 'form',
        ...(record.callbackPhone ? { contactPhone: record.callbackPhone } : {}),
      });
    } catch (error) {
      throw new VoiceSessionError(
        'PERSISTENCE_FAILED',
        'The account check could not be recorded.',
        { cause: error },
      );
    }
  }
  await deps.notifier.notifyAccountCheck(
    input.sessionId,
    outcome,
    result.status === 'verified' ? result.accessToken : undefined,
    result.status === 'verified' ? result.role : undefined,
  );
  return outcome;
}

// The live voice tool has no browser session token to present. It is still
// constrained to an active session created by this server and reserves the
// same per-call verification quota as the secure account-check route.
export async function verifyVoiceSessionMemberId(
  deps: Pick<AccountCheckDeps, 'repository' | 'directory'>,
  input: { sessionId: string; memberId: string },
  now = new Date(),
): Promise<
  | {
      status: 'verified';
      serverAccessToken: string;
      serverRole: string;
    }
  | { status: 'not_registered' | 'unavailable' }
> {
  let record: Awaited<ReturnType<VoiceSessionRepository['findBySessionId']>>;
  try {
    record = await deps.repository.findBySessionId(input.sessionId);
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'The account check could not be recorded.',
      { cause: error },
    );
  }
  if (
    !record ||
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

  if (!canVerifyVoiceSessionMember(record)) {
    return { status: 'unavailable' };
  }

  let reserved: boolean;
  try {
    reserved = await deps.repository.reserveAccountCheck({
      sessionId: input.sessionId,
      sessionTokenHash: record.sessionTokenHash,
      maxAttempts: MAX_ACCOUNT_CHECKS_PER_CALL,
    });
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'The account check could not be recorded.',
      { cause: error },
    );
  }
  if (!reserved) {
    throw new VoiceSessionError(
      'ACCOUNT_CHECK_LIMIT',
      'Too many account checks for this call.',
    );
  }

  const phone = record.callbackPhone
    ? canonicalPhone(record.callbackPhone)
    : undefined;
  if (!phone || !deps.directory.loginMember) {
    return { status: 'unavailable' };
  }

  let result: Awaited<
    ReturnType<NonNullable<CustomerDirectory['loginMember']>>
  >;
  try {
    result = await deps.directory.loginMember({
      phone,
      memberId: input.memberId,
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (result.status === 'not_verified') {
    return { status: 'not_registered' };
  }
  if (result.status === 'unavailable') {
    return { status: 'unavailable' };
  }

  try {
    await deps.repository.markCustomerVerified({
      sessionId: input.sessionId,
      sessionTokenHash: record.sessionTokenHash,
      ...(record.callerCustomerId
        ? { customerId: record.callerCustomerId }
        : {}),
      verifiedAt: now,
      via: 'voice_member_id',
      ...(record.callbackPhone ? { contactPhone: record.callbackPhone } : {}),
    });
  } catch (error) {
    throw new VoiceSessionError(
      'PERSISTENCE_FAILED',
      'The account check could not be recorded.',
      { cause: error },
    );
  }
  return {
    status: 'verified',
    serverAccessToken: result.accessToken,
    serverRole: result.role,
  };
}
