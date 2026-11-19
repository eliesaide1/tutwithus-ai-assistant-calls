import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import type { Logger } from '../../lib/logger.js';
import type { ApiConfig } from '../../config/env.js';
import type { WhatsAppCallEventRepository } from './whatsapp-call-event.repository.js';

const WebhookEnvelopeSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.unknown(),
        }),
      ),
    }),
  ),
});

const CallsValueSchema = z
  .object({
    metadata: z
      .object({
        phone_number_id: z.string().min(1).max(64).optional(),
      })
      .optional(),
    calls: z
      .array(
        z.object({
          id: z.string().min(1).max(256).optional(),
          call_id: z.string().min(1).max(256).optional(),
          event: z.string().min(1).max(64),
          timestamp: z
            .union([
              z.string().regex(/^\d{1,12}$/),
              z.number().int().nonnegative(),
            ])
            .optional(),
        }),
      )
      .optional(),
    statuses: z
      .array(
        z.object({
          id: z.string().min(1).max(256),
          timestamp: z
            .union([
              z.string().regex(/^\d{1,12}$/),
              z.number().int().nonnegative(),
            ])
            .optional(),
          type: z.literal('call').optional(),
          status: z.enum(['RINGING', 'ACCEPTED', 'REJECTED']),
        }),
      )
      .optional(),
  })
  .refine(
    (value) => value.calls !== undefined || value.statuses !== undefined,
    'Expected calls or call statuses.',
  );

type WhatsAppWebhookConfig = ApiConfig['whatsappWebhook'];

function constantTimeEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const receivedBytes = Buffer.from(received, 'utf8');
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function eventDate(timestamp: string | number | undefined): Date {
  if (timestamp === undefined) {
    return new Date();
  }
  const seconds = Number(timestamp);
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function verifySignature(
  body: Buffer,
  appSecret: string,
  signature: string | undefined,
): boolean {
  if (!signature) {
    return false;
  }
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) {
    return false;
  }
  const expected = createHmac('sha256', appSecret).update(body).digest();
  const received = Buffer.from(match[1]!, 'hex');
  return (
    received.length === expected.length && timingSafeEqual(expected, received)
  );
}

export function createWhatsAppWebhookRouter(
  config: WhatsAppWebhookConfig,
  events: WhatsAppCallEventRepository,
  logger: Logger,
) {
  const router = Router();

  router.get('/', (request, response) => {
    if (!config?.verifyToken) {
      response
        .status(503)
        .send('WhatsApp webhook verification is not configured.');
      return;
    }

    const query = new URL(request.originalUrl, 'http://localhost').searchParams;
    const mode = query.get('hub.mode');
    const challenge = query.get('hub.challenge');
    const verifyToken = query.get('hub.verify_token');
    if (
      mode !== 'subscribe' ||
      challenge === null ||
      verifyToken === null ||
      !constantTimeEqual(config.verifyToken, verifyToken)
    ) {
      response.sendStatus(403);
      return;
    }

    response.status(200).type('text/plain').send(challenge);
  });

  router.post(
    '/',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (request, response) => {
      if (!config?.appSecret) {
        response
          .status(503)
          .send('WhatsApp webhook signature validation is not configured.');
        return;
      }

      if (!Buffer.isBuffer(request.body)) {
        response.status(400).send('Expected a JSON webhook body.');
        return;
      }
      if (
        !verifySignature(
          request.body,
          config.appSecret,
          request.header('x-hub-signature-256'),
        )
      ) {
        logger.warn(
          { source: 'whatsapp_webhook', requestId: response.locals.requestId },
          'Rejected WhatsApp webhook with an invalid signature',
        );
        response.sendStatus(401);
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(request.body.toString('utf8'));
      } catch {
        response.status(400).send('Invalid JSON webhook body.');
        return;
      }

      const envelope = WebhookEnvelopeSchema.safeParse(payload);
      if (!envelope.success) {
        response.status(400).send('Invalid WhatsApp webhook envelope.');
        return;
      }

      let recorded = 0;
      let ignored = 0;
      for (const entry of envelope.data.entry) {
        for (const change of entry.changes) {
          if (change.field !== 'calls') {
            ignored += 1;
            continue;
          }

          const value = CallsValueSchema.safeParse(change.value);
          if (!value.success) {
            response.status(400).send('Invalid WhatsApp call event.');
            return;
          }

          for (const call of value.data.calls ?? []) {
            const callId = call.id ?? call.call_id;
            if (!callId) {
              response
                .status(400)
                .send('WhatsApp call event is missing its call ID.');
              return;
            }
            if (call.event !== 'call_created' && call.event !== 'terminate') {
              ignored += 1;
              continue;
            }

            await events.record({
              callId,
              event: call.event,
              occurredAt: eventDate(call.timestamp),
              ...(value.data.metadata?.phone_number_id
                ? { phoneNumberId: value.data.metadata.phone_number_id }
                : {}),
            });
            recorded += 1;
          }
        }
      }

      logger.info(
        {
          source: 'whatsapp_webhook',
          requestId: response.locals.requestId,
          recorded,
          ignored,
        },
        'Processed WhatsApp call webhook',
      );
      response.sendStatus(200);
    },
  );

  return router;
}
