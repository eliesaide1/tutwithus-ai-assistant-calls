import type { AdminRole } from '@tutwithus/contracts/admin';
import { ApiError } from '../../http/errors.js';
import { hashAdminPassword } from '../admin-auth/admin-auth.passwords.js';
import type {
  AdminUserRepository,
  AdminUserSummary,
  AdminUserUpdate,
} from './admin-user.repository.js';

const MONGO_DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === MONGO_DUPLICATE_KEY
  );
}

// Removes admin rights from an account (disables it or demotes it).
function revokesAdmin(update: AdminUserUpdate): boolean {
  return (
    update.disabled === true ||
    (update.role !== undefined && update.role !== 'admin')
  );
}

export class AdminUserService {
  constructor(private readonly repository: AdminUserRepository) {}

  listUsers(): Promise<AdminUserSummary[]> {
    return this.repository.listUsers();
  }

  async createUser(input: {
    email: string;
    password: string;
    role: AdminRole;
  }): Promise<AdminUserSummary> {
    try {
      return await this.repository.createManagedUser({
        email: input.email,
        passwordHash: await hashAdminPassword(input.password),
        role: input.role,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ApiError(
          409,
          'ADMIN_USER_EXISTS',
          'A user with this email already exists.',
        );
      }
      throw error;
    }
  }

  async updateUser(
    actorId: string,
    id: string,
    update: AdminUserUpdate,
  ): Promise<AdminUserSummary> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new ApiError(404, 'ADMIN_USER_NOT_FOUND', 'User was not found.');
    }
    if (current.id === actorId && revokesAdmin(update)) {
      throw new ApiError(
        409,
        'ADMIN_SELF_LOCKOUT',
        'You cannot disable or demote your own account.',
      );
    }
    if (
      current.role === 'admin' &&
      !current.disabled &&
      revokesAdmin(update) &&
      (await this.repository.countEnabledAdmins()) <= 1
    ) {
      throw new ApiError(
        409,
        'ADMIN_LAST_ADMIN',
        'At least one enabled administrator must remain.',
      );
    }

    const updated = await this.repository.updateManagedUser(id, update);
    if (!updated) {
      throw new ApiError(404, 'ADMIN_USER_NOT_FOUND', 'User was not found.');
    }
    return updated;
  }

  async deleteUser(actorId: string, id: string): Promise<void> {
    const current = await this.repository.findById(id);
    if (!current) {
      throw new ApiError(404, 'ADMIN_USER_NOT_FOUND', 'User was not found.');
    }
    if (current.id === actorId) {
      throw new ApiError(
        409,
        'ADMIN_SELF_DELETE',
        'You cannot delete your own account.',
      );
    }
    if (
      current.role === 'admin' &&
      !current.disabled &&
      (await this.repository.countEnabledAdmins()) <= 1
    ) {
      throw new ApiError(
        409,
        'ADMIN_LAST_ADMIN',
        'At least one enabled administrator must remain.',
      );
    }
    if (!(await this.repository.deleteManagedUser(id))) {
      throw new ApiError(404, 'ADMIN_USER_NOT_FOUND', 'User was not found.');
    }
  }
}
