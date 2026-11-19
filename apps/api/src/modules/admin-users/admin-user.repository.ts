import type { AdminRole } from '@tutwithus/contracts/admin';
import type {
  AdminIdentity,
  AdminIdentityStore,
} from '../admin-auth/admin-auth.service.js';
import { AdminUserModel } from './admin-user.model.js';

export type AdminUserSummary = AdminIdentity & { createdAt: Date };
export type AdminUserUpdate = { role?: AdminRole; disabled?: boolean };

export interface AdminUserRepository extends AdminIdentityStore {
  create(input: { email: string; passwordHash: string }): Promise<void>;
  hasAdmin(): Promise<boolean>;
  listUsers(): Promise<AdminUserSummary[]>;
  createManagedUser(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }): Promise<AdminUserSummary>;
  updateManagedUser(
    id: string,
    update: AdminUserUpdate,
  ): Promise<AdminUserSummary | null>;
  deleteManagedUser(id: string): Promise<boolean>;
  countEnabledAdmins(): Promise<number>;
}

const SUMMARY_FIELDS = 'email role disabled createdAt';

function toSummary(user: {
  _id: { toString(): string };
  email: string;
  role: AdminRole;
  disabled: boolean;
  createdAt: Date;
}): AdminUserSummary {
  return {
    id: user._id.toString(),
    email: user.email,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

export class MongoAdminUserRepository implements AdminUserRepository {
  async findByEmail(email: string) {
    const user = await AdminUserModel.findOne({ email })
      .select('+passwordHash')
      .lean()
      .exec();
    return user
      ? {
          id: user._id.toString(),
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          disabled: user.disabled,
        }
      : null;
  }

  async findById(id: string) {
    const user = await AdminUserModel.findById(id)
      .select('email role disabled')
      .lean()
      .exec();
    return user
      ? {
          id: user._id.toString(),
          email: user.email,
          role: user.role,
          disabled: user.disabled,
        }
      : null;
  }

  async create(input: { email: string; passwordHash: string }): Promise<void> {
    await AdminUserModel.create(input);
  }

  async hasAdmin(): Promise<boolean> {
    return (await AdminUserModel.exists({ role: 'admin' })) !== null;
  }

  async listUsers() {
    const users = await AdminUserModel.find()
      .select(SUMMARY_FIELDS)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    return users.map(toSummary);
  }

  async createManagedUser(input: {
    email: string;
    passwordHash: string;
    role: AdminRole;
  }) {
    const user = await AdminUserModel.create(input);
    return toSummary(user.toObject());
  }

  async updateManagedUser(id: string, update: AdminUserUpdate) {
    const user = await AdminUserModel.findByIdAndUpdate(
      id,
      { $set: update },
      { new: true, runValidators: true },
    )
      .select(SUMMARY_FIELDS)
      .lean()
      .exec();
    return user ? toSummary(user) : null;
  }

  async deleteManagedUser(id: string): Promise<boolean> {
    const result = await AdminUserModel.deleteOne({ _id: id }).exec();
    return result.deletedCount > 0;
  }

  async countEnabledAdmins(): Promise<number> {
    return AdminUserModel.countDocuments({
      role: 'admin',
      disabled: false,
    }).exec();
  }
}
