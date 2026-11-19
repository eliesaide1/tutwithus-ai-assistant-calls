import { z } from 'zod';

// Background job contracts shared by the API (producer) and the worker
// (consumer). Every payload is validated on both sides.
// Import through the API's contracts alias; the web app never needs these.

export const QueueName = {
  maintenance: 'maintenance',
} as const;

export const MaintenanceJobName = {
  ping: 'ping',
} as const;

// A no-op job used to prove the API → Redis → worker path works.
export const PingJobPayloadSchema = z
  .object({
    requestedAt: z.iso.datetime(),
    requestedBy: z.string().trim().min(1).max(64),
  })
  .strict();

export type PingJobPayload = z.infer<typeof PingJobPayloadSchema>;
