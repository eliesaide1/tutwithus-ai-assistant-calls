import mongoose from 'mongoose';
import { errorName, type Logger } from '../lib/logger.js';

const RETRY_DELAY_MS = 5000;

// Connects in the background and retries until it succeeds or stop() is called.
// The API serves /healthz meanwhile; /readyz reports 503 until connected.
export function connectWithRetry(
  uri: string,
  logger: Logger,
): { stop: () => void; connected: Promise<void> } {
  let stopped = false;
  let retryTimer: NodeJS.Timeout | undefined;
  let markConnected!: () => void;
  const connected = new Promise<void>((resolve) => {
    markConnected = resolve;
  });

  async function attempt(): Promise<void> {
    if (stopped) {
      return;
    }

    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      logger.info('MongoDB connected');
      markConnected();
    } catch (error) {
      logger.error(
        {
          source: 'apps/api/src/db/connect.ts',
          errorName: errorName(error),
        },
        'MongoDB connection failed; API remains live but not ready',
      );
      retryTimer = setTimeout(() => void attempt(), RETRY_DELAY_MS);
      retryTimer.unref();
    }
  }

  void attempt();

  return {
    connected,
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
    },
  };
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export async function pingDb(): Promise<void> {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB is not connected.');
  }

  await database.admin().ping();
}
