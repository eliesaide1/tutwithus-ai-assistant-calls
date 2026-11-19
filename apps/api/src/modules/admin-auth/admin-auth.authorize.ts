import type { RequestHandler } from 'express';
import type { AdminRole } from '@tutwithus/contracts/admin';
import { ApiError } from '../../http/errors.js';
import { getAdminPrincipalIfPresent } from './admin-auth.middleware.js';

export function authorize(...roles: readonly AdminRole[]): RequestHandler {
  return (_request, response, next) => {
    const principal = getAdminPrincipalIfPresent(response);
    if (!principal) {
      throw new ApiError(
        401,
        'ADMIN_UNAUTHORIZED',
        'Administrator login is required.',
      );
    }
    if (!roles.includes(principal.role)) {
      throw new ApiError(
        403,
        'ADMIN_FORBIDDEN',
        'You do not have permission to perform this action.',
      );
    }
    next();
  };
}
