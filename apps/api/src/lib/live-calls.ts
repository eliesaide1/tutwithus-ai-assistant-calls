import { errorName, type Logger } from './logger.js';
import type { Redis } from 'ioredis';

// Caps how many calls run at once so a burst of sessions cannot run up the
// OpenAI bill (PDF section 6, "Abuse and cost blow-up").
export interface LiveCallLimiter {
  // Reserves a slot for the call. Returns false when the cap is reached.
  acquire(sessionId: string, ttlSec: number): Promise<boolean>;
  release(sessionId: string): Promise<void>;
}

const REGISTRY_KEY = 'live_calls';

export class InMemoryLiveCallLimiter implements LiveCallLimiter {
  private readonly local = new Map<string, number>();

  constructor(private readonly maxConcurrentCalls: number) {}

  async acquire(sessionId: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    for (const [id, expiry] of this.local) {
      if (expiry <= now) {
        this.local.delete(id);
      }
    }
    if (
      !this.local.has(sessionId) &&
      this.local.size >= this.maxConcurrentCalls
    ) {
      return false;
    }
    this.local.set(sessionId, now + ttlSec * 1000);
    return true;
  }

  async release(sessionId: string): Promise<void> {
    this.local.delete(sessionId);
  }
}

// Counts live calls in Redis so the cap holds across API processes. If Redis
// is unreachable it falls back to this process's own count: calls keep
// working in development without Redis, and the cap still applies per process.
export class RedisLiveCallLimiter implements LiveCallLimiter {
  private readonly local: InMemoryLiveCallLimiter;
  private outageLogged = false;

  constructor(
    private readonly redis: Redis,
    private readonly maxConcurrentCalls: number,
    private readonly logger: Logger,
  ) {
    this.local = new InMemoryLiveCallLimiter(maxConcurrentCalls);
  }

  async acquire(sessionId: string, ttlSec: number): Promise<boolean> {
    const expiresAt = Date.now() + ttlSec * 1000;
    try {
      const now = Date.now();
      const results = await this.redis
        .multi()
        .zremrangebyscore(REGISTRY_KEY, '-inf', now)
        .zadd(REGISTRY_KEY, 'NX', expiresAt, sessionId)
        .zcard(REGISTRY_KEY)
        .exec();
      const count = Number(results?.[2]?.[1]);
      if (!Number.isFinite(count)) {
        throw new Error('Unexpected Redis reply.');
      }
      if (count > this.maxConcurrentCalls) {
        await this.redis.zrem(REGISTRY_KEY, sessionId);
        return false;
      }
      this.outageLogged = false;
      return true;
    } catch (error) {
      this.logFallback(error);
      return this.local.acquire(sessionId, ttlSec);
    }
  }

  async release(sessionId: string): Promise<void> {
    await this.local.release(sessionId);
    try {
      await this.redis.zrem(REGISTRY_KEY, sessionId);
    } catch {
      // The Redis entry expires with its TTL.
    }
  }

  private logFallback(error: unknown): void {
    if (this.outageLogged) {
      return;
    }
    this.outageLogged = true;
    this.logger.warn(
      { source: 'live-calls', errorName: errorName(error) },
      'Redis unavailable; counting live calls in this process only',
    );
  }
}
