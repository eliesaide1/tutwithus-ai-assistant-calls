import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

const requiredEnvironment = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/tutwithus_test',
  CONSENT_TEXT_AR: 'test',
  CONSENT_TEXT_EN: 'test',
  CONSENT_TEXT_FR: 'test',
};

describe('loadConfig Redis settings', () => {
  it('allows booking calls enough time to respond when no idle timeout is configured', () => {
    expect(loadConfig(requiredEnvironment).idleTimeoutSec).toBe(90);
  });

  it('allows Redis to be unset or empty', () => {
    expect(loadConfig(requiredEnvironment).redisUrl).toBeUndefined();
    expect(
      loadConfig({ ...requiredEnvironment, REDIS_URL: '' }).redisUrl,
    ).toBeUndefined();
  });

  it('rejects non-Redis URLs', () => {
    expect(() =>
      loadConfig({ ...requiredEnvironment, REDIS_URL: 'https://localhost' }),
    ).toThrow('Must be a Redis URL.');
  });
});
