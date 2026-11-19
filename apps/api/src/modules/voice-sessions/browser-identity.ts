import { jwtVerify } from 'jose';

// Issued by the authenticated TutWithUs backend, never by the browser.
export async function verifyBrowserIdentity(
  proof: string | undefined,
): Promise<string | undefined> {
  const secret = process.env.BROWSER_IDENTITY_SECRET;
  if (!proof || !secret || secret.length < 32) return undefined;
  try {
    const { payload } = await jwtVerify(
      proof,
      new TextEncoder().encode(secret),
      {
        algorithms: ['HS256'],
        issuer: 'tutwithus',
        audience: 'tutwithus-voice',
        maxTokenAge: '5m',
        requiredClaims: ['exp', 'iat', 'sub', 'phone'],
      },
    );
    return typeof payload.phone === 'string' &&
      /^\+[1-9]\d{7,14}$/.test(payload.phone)
      ? payload.phone
      : undefined;
  } catch {
    return undefined;
  }
}
