import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const HASH_PREFIX = 'admin-scrypt-v1';

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    HASH_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [prefix, cost, blockSize, parallelization, encodedSalt, encodedKey] =
    storedHash.split('$');
  if (
    prefix !== HASH_PREFIX ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  const salt = Buffer.from(encodedSalt, 'base64url');
  const expectedKey = Buffer.from(encodedKey, 'base64url');
  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) {
    return false;
  }
  const actualKey = await deriveKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}
