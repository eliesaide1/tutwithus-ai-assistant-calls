import mongoose, { Schema, type Model } from 'mongoose';
import type { AdminRole } from '@tutwithus/contracts/admin';

type AdminUserDocument = {
  email: string;
  passwordHash: string;
  role: AdminRole;
  disabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const adminUserSchema = new Schema<AdminUserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['admin', 'editor', 'agent', 'viewer'],
      required: true,
      default: 'admin',
    },
    disabled: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, versionKey: false },
);

export const AdminUserModel: Model<AdminUserDocument> =
  mongoose.models.AdminUser ??
  mongoose.model<AdminUserDocument>(
    'AdminUser',
    adminUserSchema,
    'admin_users',
  );
