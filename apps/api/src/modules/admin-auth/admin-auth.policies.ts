import type { AdminRole } from '@tutwithus/contracts/admin';

const definePolicy = (...roles: AdminRole[]): readonly AdminRole[] =>
  Object.freeze(roles);

export const ADMIN_ROLE_POLICIES = {
  administrators: definePolicy('admin'),
  knowledgeEditors: definePolicy('admin', 'editor'),
  conversationReaders: definePolicy('admin', 'agent', 'viewer'),
  bookingOperators: definePolicy('admin', 'agent'),
  escalationOperators: definePolicy('admin', 'agent'),
} as const;
