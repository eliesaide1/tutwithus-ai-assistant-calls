import { SignJWT, type JWTVerifyOptions } from 'jose';
import type { AdminRole } from '@tutwithus/contracts/admin';
import type { ApiConfig } from '../../config/env.js';
import { ApiError } from '../../http/errors.js';
import { verifyAdminPassword } from './admin-auth.passwords.js';

const ADMIN_ISSUER = 'tutwithus-admin';
const ADMIN_AUDIENCE = 'tutwithus-admin-api';

export type AdminPrincipal = {
  id: string;
  email: string;
  role: AdminRole;
  csrfToken: string;
};

// The account fields every admin feature may read.
export type AdminIdentity = {
  id: string;
  email: string;
  role: AdminRole;
  disabled: boolean;
};

// Only the login flow reads the password hash.
export type AdminCredentials = AdminIdentity & { passwordHash: string };

// The narrow lookup port admin-auth needs; implemented by the admin-users repository.
export interface AdminIdentityStore {
  findByEmail(email: string): Promise<AdminCredentials | null>;
  findById(id: string): Promise<AdminIdentity | null>;
}

export async function authenticateAdmin(
  email: string,
  password: string,
  repository: AdminIdentityStore,
): Promise<Omit<AdminPrincipal, 'csrfToken'>> {
  const user = await repository.findByEmail(email);
  if (
    !user ||
    user.disabled ||
    !(await verifyAdminPassword(password, user.passwordHash))
  ) {
    throw new ApiError(
      401,
      'ADMIN_UNAUTHORIZED',
      'The email or password is incorrect.',
    );
  }
  return { id: user.id, email: user.email, role: user.role };
}

export async function signAdminToken(
  principal: Omit<AdminPrincipal, 'csrfToken'>,
  csrfToken: string,
  config: ApiConfig,
): Promise<string> {
  return new SignJWT({ role: principal.role, csrf: csrfToken })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ADMIN_ISSUER)
    .setAudience(ADMIN_AUDIENCE)
    .setSubject(principal.id)
    .setIssuedAt()
    .setExpirationTime(`${config.adminJwtTtlDays}d`)
    .sign(new TextEncoder().encode(config.adminJwtSecret));
}

export const adminJwtVerification: JWTVerifyOptions = {
  issuer: ADMIN_ISSUER,
  audience: ADMIN_AUDIENCE,
  algorithms: ['HS256'],
};
