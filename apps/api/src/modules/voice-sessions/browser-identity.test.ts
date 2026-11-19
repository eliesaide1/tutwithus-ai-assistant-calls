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
    expect(await verifyBrowserIdentity(token)).toBe('+96170123456');
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
