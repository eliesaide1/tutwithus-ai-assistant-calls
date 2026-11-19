import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('API Winston logger', () => {
  it('writes readable timestamped lines, separates errors, and redacts secrets', async () => {
    const logDirectory = mkdtempSync(join(tmpdir(), 'tut-api-logs-'));
    temporaryDirectories.push(logDirectory);
    const logger = createLogger({
      level: 'info',
      service: 'api',
      logDirectory,
    });

    logger.info({ requestId: 'request-1' }, 'request completed');
    logger.error(
      {
        source: 'apps/api/src/http/errors.ts',
        email: 'private@example.com',
        req: { headers: { authorization: 'Bearer private-token' } },
      },
      'request failed',
    );
    await logger.close?.();

    const combined = readFileSync(join(logDirectory, 'api.log'), 'utf8');
    const errors = readFileSync(join(logDirectory, 'api-error.log'), 'utf8');

    expect(combined).toMatch(
      /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} \| INFO \| request completed \| /m,
    );
    expect(combined).toContain(
      ' | ERROR | request failed | {"source":"apps/api/src/http/errors.ts"',
    );
    expect(errors).toContain(' | ERROR | request failed | ');
    expect(errors).not.toContain('private@example.com');
    expect(errors).not.toContain('Bearer private-token');
    expect(errors).toContain('[REDACTED]');
  });
});
