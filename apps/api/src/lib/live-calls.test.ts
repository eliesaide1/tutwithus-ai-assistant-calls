import { createLogger } from './logger.js';
import type { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryLiveCallLimiter, RedisLiveCallLimiter } from './live-calls.js';

const logger = createLogger({ level: 'silent', service: 'live-calls-test' });

// Just enough of Redis for the limiter: a sorted set of "session -> expiry".
function createFakeRedis(options: { failing?: boolean } = {}) {
  const set = new Map<string, number>();
  const fail = () => {
    if (options.failing) {
      throw new Error('redis is down');
    }
  };
  const redis = {
    multi: () => {
      const steps: Array<() => unknown> = [];
      const chain = {
        zremrangebyscore: (_key: string, _min: string, max: number) => {
          steps.push(() => {
            for (const [id, expiry] of set) {
              if (expiry <= max) set.delete(id);
            }
            return 0;
          });
          return chain;
        },
        zadd: (_key: string, _mode: string, score: number, id: string) => {
          steps.push(() => {
            if (!set.has(id)) set.set(id, score);
            return 1;
          });
          return chain;
        },
        zcard: () => {
          steps.push(() => set.size);
          return chain;
        },
        exec: async () => {
          fail();
          return steps.map((step) => [null, step()] as [null, unknown]);
        },
      };
      return chain;
    },
    zrem: async (_key: string, id: string) => {
      fail();
      return set.delete(id) ? 1 : 0;
    },
  };
  return { redis: redis as unknown as Redis, set };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RedisLiveCallLimiter', () => {
  it('admits calls up to the cap and refuses the next one', async () => {
    const { redis } = createFakeRedis();
    const limiter = new RedisLiveCallLimiter(redis, 2, logger);

    await expect(limiter.acquire('a', 60)).resolves.toBe(true);
    await expect(limiter.acquire('b', 60)).resolves.toBe(true);
    await expect(limiter.acquire('c', 60)).resolves.toBe(false);
  });

  describe('InMemoryLiveCallLimiter', () => {
    it('applies the same cap and releases slots without Redis', async () => {
      const limiter = new InMemoryLiveCallLimiter(1);

      await expect(limiter.acquire('a', 60)).resolves.toBe(true);
      await expect(limiter.acquire('b', 60)).resolves.toBe(false);
      await limiter.release('a');
      await expect(limiter.acquire('b', 60)).resolves.toBe(true);
    });
  });

  it('does not leave a refused call occupying a slot', async () => {
    const { redis, set } = createFakeRedis();
    const limiter = new RedisLiveCallLimiter(redis, 1, logger);

    await limiter.acquire('a', 60);
    await expect(limiter.acquire('b', 60)).resolves.toBe(false);
    expect([...set.keys()]).toEqual(['a']);
  });

  it('frees the slot when a call ends', async () => {
    const { redis } = createFakeRedis();
    const limiter = new RedisLiveCallLimiter(redis, 1, logger);

    await limiter.acquire('a', 60);
    await limiter.release('a');
    await expect(limiter.acquire('b', 60)).resolves.toBe(true);
  });

  it('drops slots of calls that never reported ending once their time is up', async () => {
    const { redis } = createFakeRedis();
    const limiter = new RedisLiveCallLimiter(redis, 1, logger);

    await limiter.acquire('crashed', 30);
    await expect(limiter.acquire('next', 30)).resolves.toBe(false);
    vi.advanceTimersByTime(31_000);
    await expect(limiter.acquire('next', 30)).resolves.toBe(true);
  });

  it('counts calls in this process when Redis is unavailable', async () => {
    const { redis } = createFakeRedis({ failing: true });
    const limiter = new RedisLiveCallLimiter(redis, 2, logger);

    await expect(limiter.acquire('a', 60)).resolves.toBe(true);
    await expect(limiter.acquire('b', 60)).resolves.toBe(true);
    await expect(limiter.acquire('c', 60)).resolves.toBe(false);

    await limiter.release('a');
    await expect(limiter.acquire('c', 60)).resolves.toBe(true);
  });

  it('expires local slots too, so a missed release cannot block calls forever', async () => {
    const { redis } = createFakeRedis({ failing: true });
    const limiter = new RedisLiveCallLimiter(redis, 1, logger);

    await limiter.acquire('crashed', 10);
    await expect(limiter.acquire('next', 10)).resolves.toBe(false);
    vi.advanceTimersByTime(11_000);
    await expect(limiter.acquire('next', 10)).resolves.toBe(true);
  });
});
