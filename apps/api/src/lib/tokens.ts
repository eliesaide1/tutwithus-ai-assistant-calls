import { createHash, randomBytes } from 'node:crypto';

// Returns a random token for the client and its SHA-256 hash for storage.
// Only the hash is saved, so a database leak does not expose usable tokens.
export function createOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
