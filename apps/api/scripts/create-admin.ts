import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { AdminLoginRequestSchema } from '@tutwithus/contracts/admin';
import { AdminUserModel } from '../src/modules/admin-users/admin-user.model.js';
import { hashAdminPassword } from '../src/modules/admin-auth/admin-auth.passwords.js';

async function readHiddenPassword(): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error(
      'Run this command in an interactive terminal to enter the password securely.',
    );
  }

  stdout.write('Admin password (input hidden): ');
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let password = '';
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdout.write('\n');
      if (error) {
        reject(error);
      } else {
        resolve(password);
      }
    };
    const onData = (input: string) => {
      if (input === '\u0003') {
        finish(new Error('Admin creation cancelled.'));
      } else if (input === '\r' || input === '\n') {
        finish();
      } else if (input === '\u0008' || input === '\u007f') {
        password = password.slice(0, -1);
      } else if (input >= ' ' && input.length === 1) {
        password += input;
      }
    };
    stdin.on('data', onData);
  });
}

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI must be configured before creating an admin.');
  }

  const prompt = createInterface({ input: stdin, output: stdout });
  let email: string;
  try {
    email = (await prompt.question('Admin email: ')).trim().toLowerCase();
  } finally {
    prompt.close();
  }
  const password = await readHiddenPassword();
  const input = AdminLoginRequestSchema.safeParse({ email, password });
  if (!input.success) {
    throw new Error(
      'Use a valid email address and a password between 8 and 128 characters.',
    );
  }

  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await AdminUserModel.createIndexes();
    if (await AdminUserModel.exists({ role: 'admin' })) {
      throw new Error(
        'An administrator already exists. The bootstrap command only creates the first admin.',
      );
    }
    await AdminUserModel.create({
      email: input.data.email,
      passwordHash: await hashAdminPassword(input.data.password),
      role: 'admin',
      disabled: false,
    });
    stdout.write(
      'Administrator created. The password was stored as a one-way hash.\n',
    );
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Admin creation failed: ${message}`);
  process.exitCode = 1;
});
