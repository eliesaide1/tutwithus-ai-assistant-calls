import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyBrowserIdentity } from './browser-identity.js';
const secret = 'test-identity-key-'.repeat(3);
afterEach(() => vi.unstubAllEnvs());
describe('browser identity proof', () => {
  it('requires a signed, recent, audience-bound proof', async () => {
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const token = await new SignJWT({ phone: '+96170123456' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member')
      .setIssuer('tutwithus')
      .setAudience('tutwithus-voice')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyBrowserIdentity(token)).toEqual({
      phone: '+96170123456',
    });
    expect(await verifyBrowserIdentity(`${token}x`)).toBeUndefined();
    expect(await verifyBrowserIdentity(undefined)).toBeUndefined();
    vi.stubEnv('BROWSER_IDENTITY_SECRET', 'different-secret-'.repeat(3));
    expect(await verifyBrowserIdentity(token)).toBeUndefined();
  });
  it('rejects a valid signature with the wrong audience', async () => {
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const token = await new SignJWT({ phone: '+96170123456' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member')
      .setIssuer('tutwithus')
      .setAudience('other')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyBrowserIdentity(token)).toBeUndefined();
  });
});

describe('member id carried by the proof', () => {
  it('returns the member id so the server can complete the member login', async () => {
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const token = await new SignJWT({
      phone: '+96170123456',
      memberId: '202610013',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member')
      .setIssuer('tutwithus')
      .setAudience('tutwithus-voice')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyBrowserIdentity(token)).toEqual({
      phone: '+96170123456',
      memberId: '202610013',
    });
  });

  it('keeps the proven phone when the member id is malformed', async () => {
    // An account with no usable member id still proves phone ownership; it
    // simply cannot reach account services.
    vi.stubEnv('BROWSER_IDENTITY_SECRET', secret);
    const token = await new SignJWT({
      phone: '+96170123456',
      memberId: 'not a member id!',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member')
      .setIssuer('tutwithus')
      .setAudience('tutwithus-voice')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
    expect(await verifyBrowserIdentity(token)).toEqual({
      phone: '+96170123456',
    });
  });
});
