import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceSession } from './voice-session.service.js';

const secret = 'test-identity-key-'.repeat(3);
const PHONE = '+96170123456';

const config = {
  consentVersion: '2026-11-04.1',
  maxCallSec: 300,
  retentionDays: 30,
  elevenLabs: { apiKey: 'k', saudiArabicVoiceId: 'v', modelId: 'm' },
};

async function proofFor(claims: Record<string, string>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('member')
    .setIssuer('tutwithus')
    .setAudience('tutwithus-voice')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

function harness(loginMember?: ReturnType<typeof vi.fn>): Record<
  string,
  never
> & {
  repository: { create: ReturnType<typeof vi.fn> };
  settingsReader: { getActiveAgentSettings: ReturnType<typeof vi.fn> };
  directory: Record<string, unknown>;
  notifier: { notifyAccountCheck: ReturnType<typeof vi.fn> };
} {
  return {
    repository: { create: vi.fn(async () => undefined) },
    settingsReader: { getActiveAgentSettings: vi.fn(async () => null) },
    directory: {
      lookup: vi.fn(async () => ({
        status: 'registered' as const,
        customerId: 'customer-1',
      })),
      ...(loginMember ? { loginMember } : {}),
    },
    notifier: { notifyAccountCheck: vi.fn(async () => undefined) },
  } as never;
}

const request = {
  locale: 'en' as const,
  consentVersion: config.consentVersion,
  consentAccepted: true as const,
};

afterEach(() => vi.unstubAllEnvs());

describe('portal handoff', () => {
  it('completes the member login so account tools get an access token', async () => {
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const loginMember = vi.fn(async () => ({
      status: 'verified' as const,
      accessToken: 'platform-token',
      role: 'tutor',
    }));
    const h = harness(loginMember);

    await createVoiceSession(
      {
        ...request,
        identityProof: await proofFor({ phone: PHONE, memberId: '202610013' }),
      },
      config as never,
      h.repository as never,
      h.settingsReader as never,
      h.directory as never,
      h.notifier as never,
    );

    expect(loginMember).toHaveBeenCalledWith({
      phone: PHONE,
      memberId: '202610013',
    });
    // Parked for the call to consume when it connects.
    expect(h.notifier.notifyAccountCheck).toHaveBeenCalledWith(
      expect.any(String),
      'verified',
      'platform-token',
      'tutor',
    );
  });

  it('does not attempt a login when the proof carries no member id', async () => {
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const loginMember = vi.fn();
    const h = harness(loginMember);

    await createVoiceSession(
      { ...request, identityProof: await proofFor({ phone: PHONE }) },
      config as never,
      h.repository as never,
      h.settingsReader as never,
      h.directory as never,
      h.notifier as never,
    );

    expect(loginMember).not.toHaveBeenCalled();
    expect(h.notifier.notifyAccountCheck).not.toHaveBeenCalled();
  });

  it('still starts the call when the member login fails', async () => {
    // A platform outage must leave the caller in knowledge-only mode rather
    // than refusing to start the call.
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const loginMember = vi.fn(async () => {
      throw new Error('platform unavailable');
    });
    const h = harness(loginMember);

    const session = await createVoiceSession(
      {
        ...request,
        identityProof: await proofFor({ phone: PHONE, memberId: '202610013' }),
      },
      config as never,
      h.repository as never,
      h.settingsReader as never,
      h.directory as never,
      h.notifier as never,
    );

    expect(session.sessionId).toBeTruthy();
    expect(h.notifier.notifyAccountCheck).not.toHaveBeenCalled();
  });
});
