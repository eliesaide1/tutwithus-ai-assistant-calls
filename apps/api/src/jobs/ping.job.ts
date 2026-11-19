import { PingJobPayloadSchema } from '@tutwithus/contracts/jobs';
import type { Logger } from '../lib/logger.js';
import { UnrecoverableError } from 'bullmq';

export async function processPing(
  input: { id?: string; data: unknown },
  logger: Logger,
) {
  const parsed = PingJobPayloadSchema.safeParse(input.data);
  if (!parsed.success) {
    throw new UnrecoverableError('Invalid ping job payload.');
  }

  logger.info(
    {
      ...(input.id ? { jobId: input.id } : {}),
      requestedAt: parsed.data.requestedAt,
      requestedBy: parsed.data.requestedBy,
    },
    'Ping job processed',
  );
  return { ok: true };
}
