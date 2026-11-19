import { SignJWT } from 'jose';
import { afterEach, expect, it, vi } from 'vitest';
import { createVoiceSession } from './voice-session.service.js';

afterEach(() => vi.unstubAllEnvs());
it('binds lookup and stored phone to the signed identity rather than form input', async () => {
  const secret = 's'.repeat(48);
  vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
  const identityProof = await new SignJWT({ phone: '+96170123456' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('tutwithus')
    .setAudience('tutwithus-voice')
    .setSubject('member')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
  const create = vi.fn();
  const lookup = vi.fn(async () => ({
    status: 'registered' as const,
    customerId: 'member',
  }));
  await createVoiceSession(
    {
      locale: 'en',
      timeZone: 'Asia/Beirut',
      consentAccepted: true,
      consentVersion: 'v1',
      phone: '+33123456789',
      identityProof,
    },
    { consentVersion: 'v1', maxCallSec: 300, retentionDays: 7 } as Parameters<
      typeof createVoiceSession
    >[1],
    { create } as unknown as Parameters<typeof createVoiceSession>[2],
    { getActiveAgentSettings: async () => null },
    { lookup },
  );
  expect(lookup).toHaveBeenCalledWith({ phone: '+96170123456' });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      callbackPhone: '+96170123456',
      timeZone: 'Asia/Beirut',
      memberVerificationAvailable: true,
      phoneOwnershipVerified: true,
    }),
  );
});
it('uses the entered phone to offer member-ID verification without treating the phone as proof', async () => {
  const create = vi.fn();
  const lookup = vi.fn(async () => ({
    status: 'registered' as const,
    customerId: 'member',
  }));
  await createVoiceSession(
    {
      locale: 'en',
      consentAccepted: true,
      consentVersion: 'v1',
      phone: '+33 (1) 23 45 67 89',
    },
    { consentVersion: 'v1', maxCallSec: 300, retentionDays: 7 } as Parameters<
      typeof createVoiceSession
    >[1],
    { create } as unknown as Parameters<typeof createVoiceSession>[2],
    { getActiveAgentSettings: async () => null },
    { lookup },
  );
  expect(lookup).toHaveBeenCalledWith({ phone: '+33123456789' });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      callbackPhone: '+33123456789',
      memberVerificationAvailable: true,
      phoneOwnershipVerified: false,
      callerAccountStatus: 'registered',
    }),
  );
});

it('does not expose member verification when the entered phone is not registered', async () => {
  const create = vi.fn();
  const lookup = vi.fn(async () => ({ status: 'not_registered' as const }));
  await createVoiceSession(
    {
      locale: 'en',
      consentAccepted: true,
      consentVersion: 'v1',
      phone: '+33123456789',
    },
    { consentVersion: 'v1', maxCallSec: 300, retentionDays: 7 } as Parameters<
      typeof createVoiceSession
    >[1],
    { create } as unknown as Parameters<typeof createVoiceSession>[2],
    { getActiveAgentSettings: async () => null },
    { lookup },
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      memberVerificationAvailable: false,
      phoneOwnershipVerified: false,
      callerAccountStatus: 'not_registered',
    }),
  );
});

it('keeps member-ID verification available when the optional registration lookup is unavailable', async () => {
  const create = vi.fn();
  const lookup = vi.fn(async () => ({ status: 'unavailable' as const }));
  await createVoiceSession(
    {
      locale: 'en',
      consentAccepted: true,
      consentVersion: 'v1',
      phone: '+966500000001',
    },
    { consentVersion: 'v1', maxCallSec: 300, retentionDays: 7 } as Parameters<
      typeof createVoiceSession
    >[1],
    { create } as unknown as Parameters<typeof createVoiceSession>[2],
    { getActiveAgentSettings: async () => null },
    { lookup },
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      memberVerificationAvailable: true,
      callerAccountStatus: 'unavailable',
    }),
  );
});
