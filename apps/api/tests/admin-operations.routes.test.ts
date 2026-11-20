import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import type { ApiConfig } from '../src/config/env.js';
import { createErrorHandler } from '../src/http/errors.js';
import { requestContext } from '../src/http/middleware/request-context.js';
import type { AdminUserRepository } from '../src/modules/admin-users/admin-user.repository.js';
import { createAuditRouter } from '../src/modules/audit/audit.routes.js';
import { createAuditWriter } from '../src/modules/audit/audit-writer.js';
import type { AuditRepository } from '../src/modules/audit/audit.repository.js';
import { createBookingRouter } from '../src/modules/bookings/booking.routes.js';
import { BookingService } from '../src/modules/bookings/booking.service.js';
import type { BookingRepository } from '../src/modules/bookings/booking.repository.js';
import type { BookingRecord } from '../src/modules/bookings/booking.model.js';
import { createEscalationRouter } from '../src/modules/escalations/escalation.routes.js';
import { EscalationService } from '../src/modules/escalations/escalation.service.js';
import type {
  EscalationRepository,
  EscalationWithId,
} from '../src/modules/escalations/escalation.repository.js';
import { createAgentSettingsRouter } from '../src/modules/settings/agent-settings.routes.js';
import type { AgentSettingsRecord } from '../src/modules/settings/agent-settings.model.js';
import type { AgentSettingsRepository } from '../src/modules/settings/agent-settings.repository.js';

const csrfToken = 'test-csrf-token';
const config: ApiConfig = {
  nodeEnv: 'test',
  port: 3000,
  trustProxyHops: 0,
  corsAllowedOrigins: [],
  logLevel: 'silent',
  mongoUri: 'mongodb://127.0.0.1:27017/tutwithus_test',
  redisUrl: 'redis://127.0.0.1:6379',
  workerConcurrency: 5,
  adminJwtSecret: 'test-admin-jwt-secret-at-least-32-characters',
  adminJwtSecretIsEphemeral: false,
  adminJwtTtlDays: 1,
  openai: {
    apiKey: 'test-key',
    realtimeModel: 'test-model',
    embeddingModel: 'text-embedding-3-small',
  },
  consentVersion: '2026-11-03.1',
  consentText: { 'ar-SA': 'test', en: 'test', fr: 'test' },
  maxCallSec: 300,
  maxConcurrentCalls: 20,
  idleTimeoutSec: 30,
  retentionDays: 30,
};

function createTestApp(role: 'admin' | 'agent' | 'viewer') {
  const booking: BookingRecord & { id: string } = {
    id: '0123456789abcdef01234567',
    sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
    customerId: 'private-customer-reference',
    reference: 'BK-123',
    status: 'submitted',
    subject: 'Mathematics',
    level: 'Grade 8',
    preferredTimes: ['Weekday afternoons'],
    timezone: 'Europe/Paris',
    contactName: 'Learner guardian',
    contactPhone: '+33123456789',
    contactEmail: 'guardian@example.com',
    notes: [],
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
    updatedAt: new Date('2026-01-01T10:00:00.000Z'),
  };
  const bookings: BookingRepository = {
    createBooking: vi.fn(async () => booking),
    listBookings: vi.fn(async () => [booking]),
    findBooking: vi.fn(async () => booking),
    updateBooking: vi.fn(async () => true),
  };
  const escalations: EscalationRepository = {
    createEscalation: vi.fn(async () => undefined),
    listEscalations: vi.fn(async () => []),
    findEscalation: vi.fn(async () => null),
    updateEscalation: vi.fn(async () => true),
  };
  const settings: AgentSettingsRepository = {
    getSettings: vi.fn(async () => ({ active: null, drafts: [] })),
    saveSettingsDraft: vi.fn(),
    updateSettingsDraft: vi.fn(async () => null),
    deleteSettingsDraft: vi.fn(async () => false),
    activateSettings: vi.fn(async () => true),
  };
  const audit: AuditRepository = {
    addAuditRecord: vi.fn(async () => undefined),
    listAuditRecords: vi.fn(async () => []),
  };
  const writeAudit = createAuditWriter(audit, config);
  const users: AdminUserRepository = {
    findByEmail: vi.fn(async () => null),
    findById: vi.fn(async (id: string) =>
      id === 'other-agent'
        ? {
            id,
            email: 'other@example.com',
            role: 'agent' as const,
            disabled: false,
          }
        : null,
    ),
    create: vi.fn(async () => undefined),
    hasAdmin: vi.fn(async () => true),
    listUsers: vi.fn(async () => []),
    createManagedUser: vi.fn(async () => {
      throw new Error('Not used in this test.');
    }),
    updateManagedUser: vi.fn(async () => null),
    deleteManagedUser: vi.fn(async () => false),
    countEnabledAdmins: vi.fn(async () => 1),
  };
  const authenticate: RequestHandler = (_request, response, next) => {
    response.locals.admin = {
      id: role === 'agent' ? 'agent-id' : 'admin-id',
      email: `${role}@example.com`,
      role,
      csrfToken,
    };
    next();
  };
  const logger = createLogger({
    level: 'silent',
    service: 'admin-features-test',
  });
  const app = express();
  app.use(requestContext(logger));
  app.use(
    '/api/v1/admin/booking-requests',
    createBookingRouter(
      authenticate,
      new BookingService(bookings, users),
      writeAudit,
    ),
  );
  app.use(
    '/api/v1/admin/escalations',
    createEscalationRouter(
      authenticate,
      new EscalationService(escalations),
      writeAudit,
    ),
  );
  app.use(
    '/api/v1/admin/settings',
    createAgentSettingsRouter(authenticate, settings, writeAudit),
  );
  app.use('/api/v1/admin/audit', createAuditRouter(authenticate, audit));
  app.use(createErrorHandler(logger));
  return { app, bookings, escalations, settings, users };
}

describe('admin feature routes', () => {
  it('updates and deletes named drafts for administrators', async () => {
    const { app, settings } = createTestApp('admin');
    const timestamp = new Date('2026-01-01T10:00:00.000Z');
    const draft: AgentSettingsRecord = {
      name: 'Updated welcome',
      version: 2,
      status: 'draft',
      greeting: {
        'ar-SA': 'مرحبًا',
        en: 'Hello',
        fr: 'Bonjour',
      },
      instructionTemplate: 'Use approved knowledge only.',
      voice: 'marin',
      maxCallSec: 300,
      businessHours: 'Weekdays',
      escalation: { hoursText: 'We will follow up.' },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    vi.mocked(settings.updateSettingsDraft).mockResolvedValue(draft);
    vi.mocked(settings.deleteSettingsDraft).mockResolvedValue(true);

    const updated = await request(app)
      .put('/api/v1/admin/settings/draft/2')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: draft.name,
        greeting: draft.greeting,
        instructionTemplate: draft.instructionTemplate,
        voice: draft.voice,
        maxCallSec: draft.maxCallSec,
        businessHours: draft.businessHours,
        escalation: draft.escalation,
      });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: 'Updated welcome',
      version: 2,
      status: 'draft',
    });
    expect(settings.updateSettingsDraft).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ name: 'Updated welcome' }),
    );

    const deleted = await request(app)
      .delete('/api/v1/admin/settings/draft/2')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ status: 'deleted', version: 2 });
    expect(settings.deleteSettingsDraft).toHaveBeenCalledWith(2);
  });

  it('rejects editing missing settings and allows delete handling for any status', async () => {
    const { app, settings } = createTestApp('admin');

    const updated = await request(app)
      .put('/api/v1/admin/settings/draft/2')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Should not update',
        greeting: { 'ar-SA': 'مرحبًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate: 'Use approved knowledge only.',
        voice: 'marin',
        maxCallSec: 300,
        businessHours: 'Weekdays',
        escalation: { hoursText: 'We will follow up.' },
      });
    const deleted = await request(app)
      .delete('/api/v1/admin/settings/draft/2')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken);

    expect(updated.status).toBe(409);
    expect(updated.body.error.message).toBe(
      'Only a saved draft can be edited.',
    );
    expect(deleted.status).toBe(404);
    expect(settings.updateSettingsDraft).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ name: 'Should not update' }),
    );
    expect(settings.deleteSettingsDraft).toHaveBeenCalledWith(2);
  });

  it('hides contact details from agents and marks their own assignment', async () => {
    const { app } = createTestApp('agent');
    const response = await request(app).get('/api/v1/admin/booking-requests');

    expect(response.status).toBe(200);
    expect(response.body.bookings[0]).toMatchObject({
      reference: 'BK-123',
      assignedToCurrentUser: false,
    });
    expect(response.body.bookings[0]).not.toHaveProperty('contactName');
    expect(response.body.bookings[0]).not.toHaveProperty('contactPhone');
    expect(response.body.bookings[0]).not.toHaveProperty('contactEmail');
    expect(response.body.bookings[0]).not.toHaveProperty('customerId');
  });

  it('resolves an agent self-assignment marker to the authenticated user ID', async () => {
    const { app, bookings, users } = createTestApp('agent');
    const response = await request(app)
      .patch('/api/v1/admin/booking-requests/0123456789abcdef01234567')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ assigneeId: 'self' });

    expect(response.status).toBe(200);
    expect(bookings.updateBooking).toHaveBeenCalledWith(
      expect.objectContaining({ assigneeId: 'agent-id' }),
    );
    expect(users.findById).not.toHaveBeenCalled();
  });

  it('lets booking operators confirm eligible requests', async () => {
    const { app, bookings } = createTestApp('agent');
    const sessionStart = new Date(Date.now() + 72 * 60 * 60 * 1000);
    vi.mocked(bookings.findBooking).mockResolvedValue({
      ...(await bookings.findBooking('0123456789abcdef01234567'))!,
      sessionStart,
      sessionEnd: new Date(sessionStart.getTime() + 60 * 60 * 1000),
    });

    const response = await request(app)
      .patch('/api/v1/admin/booking-requests/0123456789abcdef01234567')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(200);
    expect(bookings.updateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'confirmed',
        confirmedAt: expect.any(Date),
        confirmedVia: 'click',
      }),
    );
  });

  it('rejects confirmation inside the two-day minimum', async () => {
    const { app, bookings } = createTestApp('admin');
    vi.mocked(bookings.findBooking).mockResolvedValue({
      ...(await bookings.findBooking('0123456789abcdef01234567'))!,
      sessionStart: new Date(Date.now() + 47 * 60 * 60 * 1000),
    });

    const response = await request(app)
      .patch('/api/v1/admin/booking-requests/0123456789abcdef01234567')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ status: 'confirmed' });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BOOKING_MINIMUM_NOTICE');
    expect(bookings.updateBooking).not.toHaveBeenCalled();
  });

  it('does not expose administrator settings to agents', async () => {
    const { app, settings } = createTestApp('agent');
    const response = await request(app).get('/api/v1/admin/settings');

    expect(response.status).toBe(403);
    expect(settings.getSettings).not.toHaveBeenCalled();
  });

  it('allows agents to read escalations and administrators to read settings and audit', async () => {
    const agentSetup = createTestApp('agent');
    const agentApp = agentSetup.app;
    const adminApp = createTestApp('admin').app;
    const escalation: EscalationWithId = {
      id: '0123456789abcdef01234567',
      sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
      ticketRef: 'ESC-0123456789',
      reason: 'safety',
      summary: 'Caller requested a sensitive issue review.',
      priority: 'urgent',
      status: 'open',
      contactConsent: true,
      contact: { phone: '+966500000001' },
      notes: [],
      slaDueAt: new Date('2026-11-09T15:00:00.000Z'),
      createdAt: new Date('2026-11-09T14:00:00.000Z'),
      updatedAt: new Date('2026-11-09T14:00:00.000Z'),
    };
    vi.mocked(agentSetup.escalations.listEscalations).mockResolvedValue([
      escalation,
    ]);

    const agentEscalations = await request(agentApp).get(
      '/api/v1/admin/escalations',
    );
    expect(agentEscalations.status).toBe(200);
    expect(agentEscalations.body.escalations[0].contact.phone).toBe(
      '+966500000001',
    );
    expect((await request(adminApp).get('/api/v1/admin/settings')).status).toBe(
      200,
    );
    expect((await request(adminApp).get('/api/v1/admin/audit')).status).toBe(
      200,
    );
  });

  it('never exposes an escalation phone without contact consent', async () => {
    const { app, escalations } = createTestApp('agent');
    const escalation: EscalationWithId = {
      id: '0123456789abcdef01234567',
      sessionId: '44f887b3-14b8-4f82-a18f-69e5d8215c7c',
      ticketRef: 'ESC-0123456789',
      reason: 'complaint',
      summary: 'Caller requested a review.',
      priority: 'high',
      status: 'open',
      contactConsent: false,
      contact: { phone: '+966500000001' },
      notes: [],
      slaDueAt: new Date('2026-11-09T15:00:00.000Z'),
      createdAt: new Date('2026-11-09T14:00:00.000Z'),
      updatedAt: new Date('2026-11-09T14:00:00.000Z'),
    };
    vi.mocked(escalations.listEscalations).mockResolvedValue([escalation]);

    const response = await request(app).get('/api/v1/admin/escalations');

    expect(response.status).toBe(200);
    expect(response.body.escalations[0]).not.toHaveProperty('contact');
  });

  it('rejects settings fields that have no live behavior', async () => {
    const { app, settings } = createTestApp('admin');
    const response = await request(app)
      .put('/api/v1/admin/settings/draft/2')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({
        name: 'Unsupported setting',
        greeting: { 'ar-SA': 'مرحبًا', en: 'Hello', fr: 'Bonjour' },
        instructionTemplate: 'Use approved knowledge only.',
        voice: 'marin',
        maxCallSec: 300,
        businessHours: 'Weekdays',
        escalation: { hoursText: 'We will follow up.' },
        retrieval: { topK: 5, minScore: 0.7 },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(settings.updateSettingsDraft).not.toHaveBeenCalled();
  });

  it('rejects agent assignment to another team member', async () => {
    const { app, bookings } = createTestApp('agent');
    const response = await request(app)
      .patch('/api/v1/admin/booking-requests/0123456789abcdef01234567')
      .set('Cookie', `tutwithus_admin_csrf=${csrfToken}`)
      .set('X-CSRF-Token', csrfToken)
      .send({ assigneeId: 'other-agent' });

    expect(response.status).toBe(403);
    expect(bookings.updateBooking).not.toHaveBeenCalled();
  });

  it('restricts escalations and audit records to their documented roles', async () => {
    const { app } = createTestApp('viewer');

    expect((await request(app).get('/api/v1/admin/escalations')).status).toBe(
      403,
    );
    expect((await request(app).get('/api/v1/admin/audit')).status).toBe(403);
  });
});
