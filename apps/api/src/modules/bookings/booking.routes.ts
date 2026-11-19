import {
  AdminBookingUpdateRequestSchema,
  BookingRequestsResponseSchema,
  BookingStatusSchema,
} from '@tutwithus/contracts/admin';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ObjectIdSchema, parseInput } from '../../http/validation.js';
import { authorize } from '../admin-auth/admin-auth.authorize.js';
import {
  getAdminPrincipal,
  requireAdminCsrf,
} from '../admin-auth/admin-auth.middleware.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type { AuditWriter } from '../audit/audit-writer.js';
import type { BookingWithId } from './booking.repository.js';
import type { BookingService } from './booking.service.js';

const BookingFilterSchema = z.object({
  status: BookingStatusSchema.optional(),
});

// Contact details are visible to administrators only.
function toBookingResponse(
  booking: BookingWithId,
  showContact: boolean,
  currentUserId: string,
) {
  return {
    ...booking,
    ...(showContact
      ? {}
      : {
          customerId: undefined,
          contactName: undefined,
          contactPhone: undefined,
          contactEmail: undefined,
        }),
    ...(booking.sessionStart
      ? { sessionStart: booking.sessionStart.toISOString() }
      : {}),
    ...(booking.sessionEnd
      ? { sessionEnd: booking.sessionEnd.toISOString() }
      : {}),
    assignedToCurrentUser: booking.assigneeId === currentUserId,
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    readBackAt: booking.readBackAt?.toISOString(),
    confirmedAt: booking.confirmedAt?.toISOString(),
    notes: booking.notes.map((note) => ({
      ...note,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}

export function createBookingRouter(
  authenticate: RequestHandler,
  bookings: BookingService,
  writeAudit: AuditWriter,
) {
  const router = Router();
  router.use(authenticate, authorize(...ADMIN_ROLE_POLICIES.bookingOperators));

  router.get('/', async (request, response) => {
    const filter = parseInput(
      BookingFilterSchema,
      request.query,
      'The booking filters are invalid.',
    );
    const principal = getAdminPrincipal(response);
    const items = await bookings.listBookings(filter);
    response.setHeader('Cache-Control', 'no-store');
    response.json(
      BookingRequestsResponseSchema.parse({
        bookings: items.map((item) =>
          toBookingResponse(item, principal.role === 'admin', principal.id),
        ),
      }),
    );
  });

  router.patch(
    '/:id',
    requireAdminCsrf,
    express.json({ limit: '4kb', strict: true }),
    async (request, response) => {
      const id = parseInput(
        ObjectIdSchema,
        request.params.id,
        'The booking ID is invalid.',
      );
      const update = parseInput(
        AdminBookingUpdateRequestSchema,
        request.body,
        'The booking update is invalid.',
      );
      const principal = getAdminPrincipal(response);
      await bookings.updateBooking(principal, id, update);
      await writeAudit(request, principal.id, {
        action: 'booking.updated',
        entity: 'booking_request',
        entityId: id,
        // Never record note text or contact details in the audit trail.
        diff: {
          ...(update.status !== undefined ? { status: update.status } : {}),
          ...(update.assigneeId !== undefined ? { assigneeChanged: true } : {}),
          ...(update.note ? { noteAdded: true } : {}),
        },
      });
      response.json({ status: 'updated' });
    },
  );

  return router;
}
