import { jwtVerify } from 'jose';

export type BrowserIdentity = {
  /** E.164, proven by the portal rather than typed on the call. */
  phone: string;
  /**
   * Present when the portal knew the caller's member id. It lets the server
   * complete the same phone + member id login the caller would otherwise type,
   * which is what account-scoped tools need an access token for.
   */
  memberId?: string;
};

// Issued by the authenticated TutWithUs backend, never by the browser.
export async function verifyBrowserIdentity(
  proof: string | undefined,
): Promise<BrowserIdentity | undefined> {
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
    if (
      typeof payload.phone !== 'string' ||
      !/^\+[1-9]\d{7,14}$/.test(payload.phone)
    ) {
      return undefined;
    }
    // The member id stays optional: an account without one still proves phone
    // ownership, it simply cannot reach account services.
    const memberId =
      typeof payload.memberId === 'string' &&
      /^[A-Za-z0-9-]{1,64}$/.test(payload.memberId)
        ? payload.memberId
        : undefined;
    return { phone: payload.phone, ...(memberId ? { memberId } : {}) };
  } catch {
    return undefined;
  }
}
