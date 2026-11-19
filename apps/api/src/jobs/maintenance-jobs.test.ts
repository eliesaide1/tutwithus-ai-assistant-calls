import { createLogger } from '../lib/logger.js';
import { describe, expect, it, vi } from 'vitest';
import {
  createMaintenanceJobs,
  type MaintenanceQueue,
  type MaintenanceQueueFactory,
} from './maintenance-jobs.js';

const logger = createLogger({
  level: 'silent',
  service: 'maintenance-jobs-test',
});
const payload = {
  requestedAt: '2026-11-13T12:00:00.000Z',
  requestedBy: 'admin@example.com',
};

function createQueue(
  options: {
    ready?: boolean;
    enqueue?: () => Promise<string>;
  } = {},
) {
  const queue: MaintenanceQueue = {
    isReady: () => options.ready ?? true,
    enqueuePing: options.enqueue ?? vi.fn(async () => 'job-1'),
    close: vi.fn(async () => undefined),
  };
  const factory = vi.fn<MaintenanceQueueFactory>(() => queue);
  return { queue, factory };
}

describe('createMaintenanceJobs', () => {
  it('processes the request inline when Redis is not configured', async () => {
    const { factory } = createQueue();
    const jobs = createMaintenanceJobs(undefined, 5, logger, factory);

    await expect(jobs.requestPing(payload)).resolves.toEqual({
      status: 'processed',
    });
    expect(factory).not.toHaveBeenCalled();
  });

  it('enqueues the request when Redis is ready', async () => {
    const { factory } = createQueue();
    const jobs = createMaintenanceJobs(
      'redis://localhost:6379',
      5,
      logger,
      factory,
    );

    await expect(jobs.requestPing(payload)).resolves.toEqual({
      status: 'queued',
      jobId: 'job-1',
    });
  });

  it('processes inline when Redis is configured but unavailable', async () => {
    const { factory } = createQueue({ ready: false });
    const jobs = createMaintenanceJobs(
      'redis://localhost:6379',
      5,
      logger,
      factory,
    );

    await expect(jobs.requestPing(payload)).resolves.toEqual({
      status: 'processed',
    });
  });

  it('processes inline when queue submission fails', async () => {
    const { factory } = createQueue({
      enqueue: vi.fn(async () => {
        throw new Error('Redis unavailable');
      }),
    });
    const jobs = createMaintenanceJobs(
      'redis://localhost:6379',
      5,
      logger,
      factory,
    );

    await expect(jobs.requestPing(payload)).resolves.toEqual({
      status: 'processed',
    });
  });
});
