import type { AdminBookingUpdateRequest } from '@tutwithus/contracts/admin';
import { ApiError } from '../../http/errors.js';
import type {
  AdminIdentityStore,
  AdminPrincipal,
} from '../admin-auth/admin-auth.service.js';
import type {
  BookingFilter,
  BookingRepository,
  BookingWithId,
} from './booking.repository.js';
import { hasMinimumBookingNotice } from './booking-rules.js';

type Actor = Pick<AdminPrincipal, 'id' | 'role'>;

export class BookingService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly users: Pick<AdminIdentityStore, 'findById'>,
  ) {}

  listBookings(filter: BookingFilter): Promise<BookingWithId[]> {
    return this.bookings.listBookings(filter);
  }

  // Applies assignment, status, and note changes under the role rules:
  // agents may self-assign, handle, or confirm requests; only admins may cancel.
  async updateBooking(
    actor: Actor,
    id: string,
    update: AdminBookingUpdateRequest,
  ): Promise<void> {
    const current = await this.bookings.findBooking(id);
    if (!current) {
      throw new ApiError(404, 'BOOKING_NOT_FOUND', 'Booking was not found.');
    }

    const assigneeId = await this.resolveAssignee(actor, current, update);
    if (update.status !== undefined) {
      const allowed =
        current.status === 'submitted' &&
        (update.status === 'handled' ||
          update.status === 'confirmed' ||
          (update.status === 'cancelled' && actor.role === 'admin'));
      if (!allowed) {
        throw new ApiError(
          409,
          'BOOKING_TRANSITION_INVALID',
          'The booking cannot transition from its current status.',
        );
      }
      if (update.status === 'confirmed') {
        if (
          !current.sessionStart ||
          !hasMinimumBookingNotice(current.sessionStart, new Date())
        ) {
          throw new ApiError(
            422,
            'BOOKING_MINIMUM_NOTICE',
            'Bookings must be confirmed at least two days in advance.',
          );
        }
      }
    }

    const confirmedAt = update.status === 'confirmed' ? new Date() : undefined;
    const updated = await this.bookings.updateBooking({
      id,
      expectedStatus: current.status,
      ...(update.status !== undefined ? { status: update.status } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
      ...(confirmedAt ? { confirmedAt, confirmedVia: 'click' as const } : {}),
      ...(update.note
        ? {
            note: {
              authorId: actor.id,
              text: update.note,
              createdAt: new Date(),
            },
          }
        : {}),
    });
    if (!updated) {
      throw new ApiError(
        409,
        'BOOKING_CHANGED',
        'The booking changed. Refresh and try again.',
      );
    }
  }

  // Returns the assignee to store, or undefined when the update leaves it unchanged.
  private async resolveAssignee(
    actor: Actor,
    current: BookingWithId,
    update: AdminBookingUpdateRequest,
  ): Promise<string | null | undefined> {
    const requested = update.assigneeId;
    if (requested === undefined) {
      return undefined;
    }

    if (actor.role === 'agent') {
      if (requested !== 'self') {
        throw new ApiError(
          403,
          'ADMIN_FORBIDDEN',
          'Agents may only assign a booking to themselves.',
        );
      }
      if (current.assigneeId && current.assigneeId !== actor.id) {
        throw new ApiError(
          409,
          'BOOKING_ALREADY_ASSIGNED',
          'This booking is already assigned to another team member.',
        );
      }
      return actor.id;
    }

    if (requested === null) {
      return null;
    }
    const assignee = await this.users.findById(requested);
    if (
      !assignee ||
      assignee.disabled ||
      (assignee.role !== 'agent' && assignee.role !== 'admin')
    ) {
      throw new ApiError(
        400,
        'ASSIGNEE_INVALID',
        'Choose an enabled agent or administrator as the assignee.',
      );
    }
    return requested;
  }
}
