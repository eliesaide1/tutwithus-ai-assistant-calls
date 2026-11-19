import { errorName, type Logger } from './logger.js';
import { Redis } from 'ioredis';

// Redis client for cross-process call limits. Redis is optional; the container
// creates this client only when a REDIS_URL is configured.
export function createRedisClient(
  url: string | undefined,
  logger: Logger,
): Redis | undefined {
  if (!url) {
    return undefined;
  }

  const client = new Redis(url, {
    connectionName: 'api',
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });

  // Log once per outage, not on every reconnect attempt.
  let outageLogged = false;
  client.on('ready', () => {
    outageLogged = false;
    logger.info('Redis connected');
  });
  client.on('error', (error) => {
    if (!outageLogged) {
      outageLogged = true;
      logger.error(
        {
          source: 'apps/api/src/lib/redis.ts',
          errorName: errorName(error),
        },
        'Redis unavailable; retrying',
      );
    }
  });

  return client;
}

export async function closeRedis(client: Redis): Promise<void> {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
