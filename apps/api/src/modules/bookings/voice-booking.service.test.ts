import { describe, expect, it, vi } from 'vitest';
import type { SubmitBookingRequest } from '@tutwithus/contracts';
import { ApiError } from '../../http/errors.js';
import type {
  VoiceSessionRecord,
  VoiceSessionRepository,
} from '../voice-sessions/voice-session.service.js';
import { createVerifiedVoiceCustomerResolver } from '../voice-sessions/voice-session.service.js';
import type { BookingRepository } from './booking.repository.js';
import { VoiceBookingService } from './voice-booking.service.js';

const sessionId = '44f887b3-14b8-4f82-a18f-69e5d8215c7c';
const now = new Date('2026-11-09T12:00:00.000Z');

const request: SubmitBookingRequest = {
  tutorId: 'tutor-1',
  tutorName: 'Taylor Tutor',
  subject: 'Mathematics',
  level: 'Grade 8',
  sessionStart: '2026-11-12T12:00:00.000Z',
  sessionEnd: '2026-11-12T13:00:00.000Z',
  timezone: 'Europe/Paris',
};

function createService(verified = true, active = true) {
  const bookings = {
    createBooking: vi.fn(async () => ({
      id: 'booking-id',
      sessionId,
      reference: 'BK-TEST',
      status: 'submitted' as const,
      subject: request.subject,
      level: request.level,
      preferredTimes: [],
      timezone: request.timezone,
      notes: [],
      createdAt: now,
      updatedAt: now,
    })),
  } satisfies Pick<BookingRepository, 'createBooking'>;
  const resolveVerifiedCustomer = vi.fn(
    async (_id: string, _at: Date): Promise<string> => {
      if (!verified) {
        throw new ApiError(
          403,
          'CUSTOMER_NOT_VERIFIED',
          'A verified TutWithUs account is required.',
        );
      }
      if (!active) {
        throw new ApiError(409, 'SESSION_ALREADY_USED', 'Session has ended.');
      }
      return 'registered-customer-1';
    },
  );
  return {
    service: new VoiceBookingService(bookings, resolveVerifiedCustomer),
    bookings,
    resolveVerifiedCustomer,
  };
}

describe('VoiceBookingService', () => {
  it('rejects booking when verified login has no customer-directory reference', async () => {
    const record: VoiceSessionRecord = {
      sessionId,
      locale: 'en',
      consentVersion: '2026-11-04.1',
      consentAccepted: true,
      transcript: [],
      sessionTokenHash: 'session-token-hash',
      acceptedAt: now,
      tokenExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      startedAt: now,
      verifiedCustomer: { verifiedAt: now, via: 'form' },
    };
    const repository: Pick<VoiceSessionRepository, 'findBySessionId'> = {
      findBySessionId: vi.fn(async () => record),
    };
    const resolveVerifiedCustomer =
      createVerifiedVoiceCustomerResolver(repository);

    await expect(resolveVerifiedCustomer(sessionId, now)).rejects.toMatchObject(
      { code: 'CUSTOMER_NOT_VERIFIED' },
    );
  });

  it('creates a submitted request from verified session identity', async () => {
    const { service, bookings } = createService();
    const result = await service.createFromVerifiedSession(
      sessionId,
      request,
      now,
    );

    expect(result).toMatchObject({ status: 'submitted' });
    expect(result.reference).toMatch(/^BK-/);
    expect(bookings.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        customerId: 'registered-customer-1',
        tutorId: request.tutorId,
        tutorName: request.tutorName,
        sessionStart: new Date(request.sessionStart),
        sessionEnd: new Date(request.sessionEnd),
        status: 'submitted',
      }),
    );
  });

  it('rejects unverified customers and sessions that ended', async () => {
    const unverified = createService(false);
    await expect(
      unverified.service.createFromVerifiedSession(sessionId, request, now),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CUSTOMER_NOT_VERIFIED' });

    const ended = createService(true, false);
    await expect(
      ended.service.createFromVerifiedSession(sessionId, request, now),
    ).rejects.toMatchObject({ statusCode: 409, code: 'SESSION_ALREADY_USED' });
  });

  it('enforces the two-day minimum and a valid time zone on the server', async () => {
    const { service, bookings } = createService();
    const tooSoon = {
      ...request,
      sessionStart: new Date(now.getTime() + 47 * 60 * 60 * 1000).toISOString(),
    };
    await expect(
      service.createFromVerifiedSession(sessionId, tooSoon, now),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'BOOKING_MINIMUM_NOTICE',
    });

    await expect(
      service.createFromVerifiedSession(
        sessionId,
        { ...request, timezone: 'Not/A_Timezone' },
        now,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'TIMEZONE_INVALID' });
    expect(bookings.createBooking).not.toHaveBeenCalled();
  });
});
