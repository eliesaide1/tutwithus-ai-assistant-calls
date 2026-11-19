import { describe, expect, it, vi } from 'vitest';
import type { AccountCheckOutcome } from '../../core/session/session-ports.js';
import { createOpaqueToken } from '../../lib/tokens.js';
import type { CustomerDirectory } from '../../platform/customer-directory.js';
import {
  checkCallerAccount,
  MAX_ACCOUNT_CHECKS_PER_CALL,
  verifyVoiceSessionMemberId,
} from './account-check.service.js';
import type { VoiceSessionRecord } from './voice-session.repository.js';
import type { VoiceSessionRepository } from './voice-session.repository.js';

const details = { memberId: '0001001' };

function createSetup(
  options: {
    allowAttempt?: boolean;
    started?: boolean;
    ended?: boolean;
    loginResult?:
      | { status: 'verified'; accessToken: string; role: string }
      | { status: 'not_verified' }
      | { status: 'unavailable' };
    callerCustomerId?: string;
    callbackPhone?: string;
  } = {},
) {
  const token = createOpaqueToken();
  const now = new Date();
  const record: VoiceSessionRecord = {
    memberVerificationAvailable: true,
    phoneOwnershipVerified: true,
    sessionId: 'session-1',
    locale: 'en',
    consentVersion: '2026-11-04.1',
    consentAccepted: true,
    transcript: [],
    sessionTokenHash: token.hash,
    acceptedAt: now,
    tokenExpiresAt: new Date(now.getTime() + 600_000),
    expiresAt: new Date(now.getTime() + 86_400_000),
    callbackPhone: options.callbackPhone ?? '+966 50 000 0001',
    ...(options.callerCustomerId
      ? { callerCustomerId: options.callerCustomerId }
      : {}),
    ...(options.started === false ? {} : { startedAt: now }),
    ...(options.ended ? { endedAt: now } : {}),
  };
  const repository = {
    findBySessionId: vi.fn(async () => record),
    reserveAccountCheck: vi.fn(async () => options.allowAttempt ?? true),
    markCustomerVerified: vi.fn(async () => undefined),
  };
  const notifications: Array<
    [string, AccountCheckOutcome, string | undefined, string | undefined]
  > = [];
  const notifier = {
    notifyAccountCheck: vi.fn(
      async (
        sessionId: string,
        outcome: AccountCheckOutcome,
        accessToken?: string,
        role?: string,
      ) => {
        notifications.push([sessionId, outcome, accessToken, role]);
      },
    ),
  };
  const directory: CustomerDirectory = {
    lookup: vi.fn(async () => ({ status: 'unavailable' as const })),
    loginMember: vi.fn(
      async () =>
        options.loginResult ?? {
          status: 'verified' as const,
          accessToken: 'secret-login-token',
          role: 'tutor',
        },
    ),
  };
  const deps = {
    repository: repository as unknown as VoiceSessionRepository,
    directory,
    notifier,
  };
  const run = (sessionToken = token.token) =>
    checkCallerAccount(deps, {
      sessionId: 'session-1',
      sessionToken,
      ...details,
    });
  const runVoice = (memberId = details.memberId) =>
    verifyVoiceSessionMemberId(
      { repository: deps.repository, directory: deps.directory },
      { sessionId: 'session-1', memberId },
    );
  return {
    run,
    runVoice,
    repository,
    notifier,
    notifications,
    directory,
    token,
  };
}

describe('checkCallerAccount', () => {
  it('verifies a registered typed phone only after the caller supplies the matching member ID', async () => {
    const t = createSetup();
    const record = await t.repository.findBySessionId();
    record.phoneOwnershipVerified = false;
    await expect(t.run()).resolves.toBe('verified');
    await expect(t.runVoice()).resolves.toMatchObject({ status: 'verified' });
    expect(t.directory.loginMember).toHaveBeenCalledTimes(2);
  });

  it('refuses member-ID verification when the call-start phone is not registered', async () => {
    const t = createSetup();
    const record = await t.repository.findBySessionId();
    record.memberVerificationAvailable = false;
    record.phoneOwnershipVerified = false;
    await expect(t.run()).resolves.toBe('unavailable');
    await expect(t.runVoice()).resolves.toEqual({ status: 'unavailable' });
    expect(t.directory.loginMember).not.toHaveBeenCalled();
  });

  it('canonicalizes the call-start phone before login', async () => {
    const t = createSetup({
      callerCustomerId: 'c1',
      callbackPhone: '+961 (70) 123-456',
    });
    await expect(t.run()).resolves.toBe('verified');

    expect(t.directory.loginMember).toHaveBeenCalledWith({
      phone: '96170123456',
      memberId: details.memberId,
    });

    describe('verifyVoiceSessionMemberId', () => {
      it('verifies against the trusted call-start phone and keeps credentials out of storage', async () => {
        const t = createSetup({
          callerCustomerId: 'c1',
          callbackPhone: '+961 70 123 456',
        });
        await expect(t.runVoice()).resolves.toEqual({
          status: 'verified',
          serverAccessToken: 'secret-login-token',
          serverRole: 'tutor',
        });

        expect(t.directory.loginMember).toHaveBeenCalledWith({
          phone: '96170123456',
          memberId: details.memberId,
        });
        expect(t.repository.markCustomerVerified).toHaveBeenCalledWith(
          expect.objectContaining({
            sessionId: 'session-1',
            customerId: 'c1',
            via: 'voice_member_id',
          }),
        );
        const stored = JSON.stringify(
          t.repository.markCustomerVerified.mock.calls,
        );
        expect(stored).not.toContain(details.memberId);
        expect(stored).not.toContain('secret-login-token');
        expect(t.notifier.notifyAccountCheck).not.toHaveBeenCalled();
      });

      it('fails closed for inactive sessions and capped attempts', async () => {
        const ended = createSetup({ ended: true });
        await expect(ended.runVoice()).rejects.toMatchObject({
          code: 'SESSION_ALREADY_USED',
        });
        expect(ended.repository.reserveAccountCheck).not.toHaveBeenCalled();

        const capped = createSetup({ allowAttempt: false });
        await expect(capped.runVoice()).rejects.toMatchObject({
          code: 'ACCOUNT_CHECK_LIMIT',
        });
        expect(capped.directory.loginMember).not.toHaveBeenCalled();
      });

      it('maps bad IDs and unavailable login providers without granting access', async () => {
        const badId = createSetup({ loginResult: { status: 'not_verified' } });
        await expect(badId.runVoice()).resolves.toEqual({
          status: 'not_registered',
        });
        expect(badId.repository.markCustomerVerified).not.toHaveBeenCalled();

        const unavailable = createSetup({
          loginResult: { status: 'unavailable' },
        });
        await expect(unavailable.runVoice()).resolves.toEqual({
          status: 'unavailable',
        });
        expect(
          unavailable.repository.markCustomerVerified,
        ).not.toHaveBeenCalled();
      });
    });
    expect(t.directory.lookup).not.toHaveBeenCalled();
    expect(t.repository.markCustomerVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        customerId: 'c1',
        via: 'form',
      }),
    );
    expect(t.notifications).toEqual([
      ['session-1', 'verified', 'secret-login-token', 'tutor'],
    ]);
  });

  it('does not persist the member ID or token', async () => {
    const t = createSetup();
    await t.run();

    const persisted = JSON.stringify(
      t.repository.markCustomerVerified.mock.calls,
    );
    expect(persisted).not.toContain(details.memberId);
    expect(persisted).not.toContain('secret-login-token');
    expect(persisted).toContain('+966 50 000 0001');
  });

  it('supports successful login without a customer-directory identifier', async () => {
    const t = createSetup();
    await expect(t.run()).resolves.toBe('verified');

    expect(t.repository.markCustomerVerified).toHaveBeenCalledWith(
      expect.not.objectContaining({ customerId: expect.anything() }),
    );
    expect(t.notifications[0]).toEqual([
      'session-1',
      'verified',
      'secret-login-token',
      'tutor',
    ]);
  });

  it('maps rejected member credentials to not_registered', async () => {
    const t = createSetup({ loginResult: { status: 'not_verified' } });
    await expect(t.run()).resolves.toBe('not_registered');

    expect(t.repository.markCustomerVerified).not.toHaveBeenCalled();
    expect(t.notifications).toEqual([
      ['session-1', 'not_registered', undefined, undefined],
    ]);
  });

  it('keeps account actions unavailable when login is unavailable', async () => {
    const t = createSetup({ loginResult: { status: 'unavailable' } });
    await expect(t.run()).resolves.toBe('unavailable');

    expect(t.repository.markCustomerVerified).not.toHaveBeenCalled();
    expect(t.notifications).toEqual([
      ['session-1', 'unavailable', undefined, undefined],
    ]);
  });

  it('fails closed without a usable phone or login provider', async () => {
    const noPhone = createSetup({ callbackPhone: '' });
    await expect(noPhone.run()).resolves.toBe('unavailable');
    expect(noPhone.directory.loginMember).not.toHaveBeenCalled();

    const noLoginProvider = createSetup();
    delete (noLoginProvider.directory as { loginMember?: unknown }).loginMember;
    await expect(noLoginProvider.run()).resolves.toBe('unavailable');
  });

  it('stops after the attempt cap without contacting the login provider', async () => {
    const t = createSetup({ allowAttempt: false });

    await expect(t.run()).rejects.toMatchObject({
      code: 'ACCOUNT_CHECK_LIMIT',
    });
    expect(MAX_ACCOUNT_CHECKS_PER_CALL).toBe(3);
    expect(t.directory.loginMember).not.toHaveBeenCalled();
    expect(t.notifier.notifyAccountCheck).not.toHaveBeenCalled();
  });

  it('rejects a wrong session token before doing anything else', async () => {
    const t = createSetup();

    await expect(t.run(createOpaqueToken().token)).rejects.toMatchObject({
      code: 'SESSION_UNAUTHORIZED',
    });
    expect(t.repository.reserveAccountCheck).not.toHaveBeenCalled();
    expect(t.directory.loginMember).not.toHaveBeenCalled();
  });

  it('allows a pre-call check but rejects a check after the call ended', async () => {
    const notStarted = createSetup({ started: false });
    await expect(notStarted.run()).resolves.toBe('verified');

    const ended = createSetup({ ended: true });
    await expect(ended.run()).rejects.toMatchObject({
      code: 'SESSION_ALREADY_USED',
    });
    expect(ended.directory.loginMember).not.toHaveBeenCalled();
  });

  it('maps an unexpected auth service error to unavailable without exposing it', async () => {
    const t = createSetup();
    vi.mocked(t.directory.loginMember!).mockRejectedValueOnce(
      new Error('upstream failure'),
    );

    await expect(t.run()).resolves.toBe('unavailable');
    expect(t.notifications).toEqual([
      ['session-1', 'unavailable', undefined, undefined],
    ]);
  });
});
