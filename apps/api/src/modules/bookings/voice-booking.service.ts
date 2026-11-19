import { randomUUID } from 'node:crypto';
import type { SubmitBookingRequest } from '@tutwithus/contracts';
import { ApiError } from '../../http/errors.js';
import { hasMinimumBookingNotice } from './booking-rules.js';
import type { BookingRepository } from './booking.repository.js';

export type VerifiedVoiceCustomerResolver = (
  sessionId: string,
  now: Date,
) => Promise<string>;

export class VoiceBookingService {
  constructor(
    private readonly bookings: Pick<BookingRepository, 'createBooking'>,
    private readonly resolveVerifiedCustomer: VerifiedVoiceCustomerResolver,
  ) {}

  async createFromVerifiedSession(
    sessionId: string,
    request: SubmitBookingRequest,
    now = new Date(),
  ): Promise<{ status: 'submitted'; reference: string }> {
    const customerId = await this.resolveVerifiedCustomer(sessionId, now);

    try {
      new Intl.DateTimeFormat('en', { timeZone: request.timezone });
    } catch {
      throw new ApiError(
        400,
        'TIMEZONE_INVALID',
        'The time zone must be a valid IANA time zone.',
      );
    }

    const sessionStart = new Date(request.sessionStart);
    const sessionEnd = new Date(request.sessionEnd);
    if (!hasMinimumBookingNotice(sessionStart, now)) {
      throw new ApiError(
        422,
        'BOOKING_MINIMUM_NOTICE',
        'Bookings must be made at least two days in advance.',
      );
    }

    const reference = `BK-${randomUUID().toUpperCase()}`;
    await this.bookings.createBooking({
      sessionId,
      customerId,
      reference,
      status: 'submitted',
      subject: request.subject,
      level: request.level,
      tutorId: request.tutorId,
      tutorName: request.tutorName,
      sessionStart,
      sessionEnd,
      preferredTimes: [
        `${sessionStart.toISOString()} - ${sessionEnd.toISOString()}`,
      ],
      timezone: request.timezone,
      notes: request.notes
        ? [{ authorId: 'customer', text: request.notes, createdAt: now }]
        : [],
    });

    return { status: 'submitted', reference };
  }
}
