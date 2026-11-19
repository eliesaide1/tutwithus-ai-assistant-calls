import {
  MaintenanceJobName,
  PingJobPayloadSchema,
  QueueName,
  type PingJobPayload,
} from '@tutwithus/contracts/jobs';
import { errorName, type Logger } from '../lib/logger.js';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { processPing } from './ping.job.js';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

export type PingResult =
  { status: 'queued'; jobId: string } | { status: 'processed' };

export interface MaintenanceJobs {
  requestPing(payload: PingJobPayload): Promise<PingResult>;
  close(): Promise<void>;
}

export interface MaintenanceQueue {
  isReady(): boolean;
  enqueuePing(payload: PingJobPayload): Promise<string>;
  close(): Promise<void>;
}

export type MaintenanceQueueFactory = (
  redisUrl: string,
  concurrency: number,
  logger: Logger,
) => MaintenanceQueue;

export function createMaintenanceJobs(
  redisUrl: string | undefined,
  concurrency: number,
  logger: Logger,
  createQueue: MaintenanceQueueFactory = createBullMqMaintenanceQueue,
): MaintenanceJobs {
  const queue = redisUrl
    ? createQueue(redisUrl, concurrency, logger)
    : undefined;

  if (!queue) {
    logger.info(
      'Redis is not configured; maintenance requests will run inline over HTTP',
    );
  }

  return {
    async requestPing(input) {
      const payload = PingJobPayloadSchema.parse(input);
      if (!queue || !queue.isReady()) {
        await processPing({ data: payload }, logger);
        return { status: 'processed' };
      }

      try {
        return {
          status: 'queued',
          jobId: await queue.enqueuePing(payload),
        };
      } catch (error) {
        logger.warn(
          { source: 'maintenance-jobs', errorName: errorName(error) },
          'Redis queue unavailable; processing maintenance request inline',
        );
        await processPing({ data: payload }, logger);
        return { status: 'processed' };
      }
    },
    close: () => queue?.close() ?? Promise.resolve(),
  };
}

function createBullMqMaintenanceQueue(
  redisUrl: string,
  concurrency: number,
  logger: Logger,
): MaintenanceQueue {
  const producerConnection = new Redis(redisUrl, {
    connectionName: 'api-maintenance-queue',
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  const workerConnection = new Redis(redisUrl, {
    connectionName: 'api-maintenance-worker',
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
  });
  let outageLogged = false;
  const logRedisError = (error: Error) => {
    if (outageLogged) {
      return;
    }
    outageLogged = true;
    logger.warn(
      { source: 'maintenance-jobs', errorName: errorName(error) },
      'Redis unavailable; queued jobs will use the inline request path',
    );
  };
  producerConnection.on('ready', () => {
    outageLogged = false;
    logger.info('Maintenance queue connected to Redis');
  });
  producerConnection.on('error', logRedisError);
  workerConnection.on('error', logRedisError);

  const queue = new Queue(QueueName.maintenance, {
    connection: producerConnection,
    defaultJobOptions,
  });
  queue.on('error', logRedisError);
  const worker = new Worker(
    QueueName.maintenance,
    async (job: Job) => {
      if (job.name !== MaintenanceJobName.ping) {
        throw new Error(`Unknown maintenance job: ${job.name}`);
      }
      return processPing(job, logger);
    },
    { connection: workerConnection, concurrency },
  );
  worker.on('failed', (job, error) => {
    logger.error(
      {
        queue: QueueName.maintenance,
        jobId: job?.id,
        jobName: job?.name,
        attemptsMade: job?.attemptsMade,
        errorName: errorName(error),
      },
      'Maintenance job failed',
    );
  });
  worker.on('error', (error) => {
    if (workerConnection.status !== 'ready') {
      return;
    }
    logger.error(
      { source: 'maintenance-jobs', errorName: errorName(error) },
      'Maintenance worker failed',
    );
  });

  return {
    isReady: () => producerConnection.status === 'ready',
    async enqueuePing(payload) {
      const job = await queue.add(
        MaintenanceJobName.ping,
        PingJobPayloadSchema.parse(payload),
      );
      return String(job.id);
    },
    async close() {
      await worker.close();
      await queue.close();
      await producerConnection.quit();
    },
  };
}
