import mongoose from 'mongoose';
import { AdminUserModel } from '../src/modules/admin-users/admin-user.model.js';

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error(
      'MONGODB_URI must be configured before migrating admin user roles.',
    );
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    const indexes = await AdminUserModel.collection.indexes();
    const legacyRoleIndex = indexes.find(
      (index) =>
        index.unique === true &&
        Object.keys(index.key).length === 1 &&
        index.key.role === 1,
    );
    if (legacyRoleIndex?.name) {
      await AdminUserModel.collection.dropIndex(legacyRoleIndex.name);
      console.info(`Removed the obsolete unique role index.`);
    } else {
      console.info('No obsolete unique role index was found.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Admin role migration failed: ${message}`);
  process.exitCode = 1;
});
