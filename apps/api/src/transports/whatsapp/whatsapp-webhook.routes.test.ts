import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../lib/logger.js';
import type { WhatsAppCallEventRepository } from './whatsapp-call-event.repository.js';
import { createWhatsAppWebhookRouter } from './whatsapp-webhook.routes.js';

const appSecret = 'test-meta-app-secret';
const verifyToken = 'test-webhook-verify-token';

function createApp(
  events: WhatsAppCallEventRepository,
  config: { appSecret: string; verifyToken: string } | null = {
    appSecret,
    verifyToken,
  },
) {
  const app = express();
  app.use(
    '/api/v1/webhooks/whatsapp',
    createWhatsAppWebhookRouter(
      config ?? undefined,
      events,
      createLogger({ level: 'silent', service: 'test' }),
    ),
  );
  return app;
}

function sign(body: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
}

describe('WhatsApp SIP call webhooks', () => {
  it('verifies Meta callback requests and returns the challenge', async () => {
    const app = createApp({ record: vi.fn(async () => undefined) });
    const response = await request(app).get('/api/v1/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': verifyToken,
      'hub.challenge': 'challenge-123',
    });

    expect(response.status).toBe(200);
    expect(response.text).toBe('challenge-123');
  });

  it('rejects a mismatched verification token', async () => {
    const app = createApp({ record: vi.fn(async () => undefined) });
    const response = await request(app).get('/api/v1/webhooks/whatsapp').query({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong',
      'hub.challenge': 'challenge-123',
    });

    expect(response.status).toBe(403);
  });

  it('requires webhook configuration before verification or delivery', async () => {
    const app = createApp({ record: vi.fn(async () => undefined) }, null);
    const response = await request(app).get('/api/v1/webhooks/whatsapp');
    expect(response.status).toBe(503);
  });

  it('validates the raw-body signature and records SIP call lifecycle events', async () => {
    const record = vi.fn(async () => undefined);
    const app = createApp({ record });
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'calls',
              value: {
                metadata: { phone_number_id: 'phone-id-1' },
                calls: [
                  {
                    id: 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
                    event: 'call_created',
                    timestamp: '1794340000',
                  },
                  {
                    id: 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
                    event: 'terminate',
                    timestamp: '1794340060',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);

    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record).toHaveBeenNthCalledWith(1, {
      callId: 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
      event: 'call_created',
      occurredAt: new Date(1794340000 * 1000),
      phoneNumberId: 'phone-id-1',
    });
    expect(record).toHaveBeenNthCalledWith(2, {
      callId: 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
      event: 'terminate',
      occurredAt: new Date(1794340060 * 1000),
      phoneNumberId: 'phone-id-1',
    });
  });

  it('acknowledges valid call status notifications without recording them as SIP lifecycle events', async () => {
    const record = vi.fn(async () => undefined);
    const app = createApp({ record });
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'calls',
              value: {
                metadata: { phone_number_id: 'phone-id-1' },
                statuses: [
                  {
                    id: 'wacid.ABGGFjFVU2AfAgo6V-Hc5eCgK5Gh',
                    timestamp: '1794340000',
                    type: 'call',
                    status: 'RINGING',
                    recipient_id: '16315553602',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const response = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);

    expect(response.status).toBe(200);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures without parsing or storing the event', async () => {
    const record = vi.fn(async () => undefined);
    const app = createApp({ record });
    const response = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=invalid')
      .send('{"object":"whatsapp_business_account","entry":[]}');

    expect(response.status).toBe(401);
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects malformed signed payloads', async () => {
    const app = createApp({ record: vi.fn(async () => undefined) });
    const body = '{"object":"not-whatsapp","entry":[]}';
    const response = await request(app)
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sign(body))
      .send(body);

    expect(response.status).toBe(400);
  });
});
