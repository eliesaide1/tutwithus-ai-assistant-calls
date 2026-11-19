import { errors, jwtVerify } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { AdminRoleSchema } from '@tutwithus/contracts/admin';
import type { ApiConfig } from '../../config/env.js';
import { ApiError } from '../../http/errors.js';
import {
  adminJwtVerification,
  type AdminIdentityStore,
  type AdminPrincipal,
} from './admin-auth.service.js';

type AdminLocals = { admin?: AdminPrincipal };

export const ADMIN_AUTH_COOKIE = 'tutwithus_admin';
export const ADMIN_CSRF_COOKIE = 'tutwithus_admin_csrf';
const ADMIN_COOKIE_PATH = '/api/v1/admin';

export function setAdminCookies(
  response: Response,
  token: string,
  csrfToken: string,
  config: ApiConfig,
): void {
  const baseOptions = {
    secure: config.nodeEnv === 'production',
    sameSite: 'strict' as const,
    path: ADMIN_COOKIE_PATH,
    maxAge: config.adminJwtTtlDays * 24 * 60 * 60 * 1000,
  };
  response.cookie(ADMIN_AUTH_COOKIE, token, {
    ...baseOptions,
    httpOnly: true,
  });
  response.cookie(ADMIN_CSRF_COOKIE, csrfToken, {
    ...baseOptions,
    httpOnly: false,
  });
}

export function clearAdminCookies(response: Response, config: ApiConfig): void {
  const options = {
    secure: config.nodeEnv === 'production',
    sameSite: 'strict' as const,
    path: ADMIN_COOKIE_PATH,
  };
  response.clearCookie(ADMIN_AUTH_COOKIE, { ...options, httpOnly: true });
  response.clearCookie(ADMIN_CSRF_COOKIE, { ...options, httpOnly: false });
}

function readCookie(request: Parameters<RequestHandler>[0], name: string) {
  const cookies = request.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== name) {
      continue;
    }
    return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

function tokensMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function attachPrincipal(response: Response, principal: AdminPrincipal) {
  (response.locals as AdminLocals).admin = principal;
}

function readPrincipal(response: Response): AdminPrincipal | undefined {
  return (response.locals as AdminLocals).admin;
}

export function requireAdmin(
  config: ApiConfig,
  repository: AdminIdentityStore,
): RequestHandler {
  return async (request, response, next) => {
    const token = readCookie(request, ADMIN_AUTH_COOKIE);
    if (!token) {
      throw new ApiError(
        401,
        'ADMIN_UNAUTHORIZED',
        'Administrator login is required.',
      );
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(
        token,
        new TextEncoder().encode(config.adminJwtSecret),
        adminJwtVerification,
      ));
    } catch (error) {
      if (error instanceof errors.JOSEError) {
        throw new ApiError(
          401,
          'ADMIN_UNAUTHORIZED',
          'Administrator login has expired.',
        );
      }
      throw error;
    }

    if (
      typeof payload.sub !== 'string' ||
      !AdminRoleSchema.safeParse(payload.role).success ||
      typeof payload.csrf !== 'string'
    ) {
      throw new ApiError(
        401,
        'ADMIN_UNAUTHORIZED',
        'Administrator login is invalid.',
      );
    }

    const user = await repository.findById(payload.sub);
    if (!user || user.disabled || user.role !== payload.role) {
      throw new ApiError(
        401,
        'ADMIN_UNAUTHORIZED',
        'Administrator login is invalid.',
      );
    }

    attachPrincipal(response, {
      id: user.id,
      email: user.email,
      role: user.role,
      csrfToken: payload.csrf,
    });
    next();
  };
}

export const requireAdminCsrf: RequestHandler = (request, response, next) => {
  const principal = readPrincipal(response);
  const cookieToken = readCookie(request, ADMIN_CSRF_COOKIE);
  const headerToken = request.get('x-csrf-token');
  if (
    !principal ||
    !cookieToken ||
    !headerToken ||
    !tokensMatch(cookieToken, principal.csrfToken) ||
    !tokensMatch(headerToken, principal.csrfToken)
  ) {
    throw new ApiError(
      403,
      'CSRF_INVALID',
      'The admin request could not be verified.',
    );
  }
  next();
};

export function getAdminPrincipal(response: Response): AdminPrincipal {
  const principal = getAdminPrincipalIfPresent(response);
  if (!principal) {
    throw new Error('Admin principal middleware was not applied.');
  }
  return principal;
}

export function getAdminPrincipalIfPresent(
  response: Response,
): AdminPrincipal | undefined {
  return readPrincipal(response);
}
