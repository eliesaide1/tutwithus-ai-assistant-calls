import mongoose from 'mongoose';
import {
  BookingRequestModel,
  type BookingNote,
  type BookingRecord,
} from './booking.model.js';

export type BookingStatus = BookingRecord['status'];
export type BookingFilter = { status?: BookingStatus };
export type BookingWithId = BookingRecord & { id: string };
export type BookingChange = {
  id: string;
  // Optimistic concurrency guard: the update applies only if unchanged.
  expectedStatus: BookingStatus;
  status?: BookingStatus;
  assigneeId?: string | null;
  confirmedAt?: Date;
  confirmedVia?: 'click' | 'voice';
  note?: BookingNote;
};

export interface BookingRepository {
  createBooking(
    booking: Omit<BookingRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<BookingWithId>;
  listBookings(filter?: BookingFilter): Promise<BookingWithId[]>;
  findBooking(id: string): Promise<BookingWithId | null>;
  updateBooking(change: BookingChange): Promise<boolean>;
}

function withId(
  value: BookingRecord & { _id: mongoose.Types.ObjectId },
): BookingWithId {
  return { ...value, id: value._id.toString() };
}

export class MongoBookingRepository implements BookingRepository {
  async createBooking(
    booking: Omit<BookingRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<BookingWithId> {
    const record = await BookingRequestModel.create(booking);
    return withId(record.toObject());
  }

  async listBookings(filter: BookingFilter = {}) {
    const records = await BookingRequestModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    return records.map(withId);
  }

  async findBooking(id: string) {
    const record = await BookingRequestModel.findById(id).lean().exec();
    return record ? withId(record) : null;
  }

  async updateBooking(change: BookingChange): Promise<boolean> {
    const set = {
      ...(change.status !== undefined ? { status: change.status } : {}),
      ...(change.assigneeId !== undefined
        ? { assigneeId: change.assigneeId }
        : {}),
    };
    const result = await BookingRequestModel.updateOne(
      { _id: change.id, status: change.expectedStatus },
      {
        ...(Object.keys(set).length > 0 ||
        change.confirmedAt !== undefined ||
        change.confirmedVia !== undefined
          ? {
              $set: {
                ...set,
                ...(change.confirmedAt
                  ? { confirmedAt: change.confirmedAt }
                  : {}),
                ...(change.confirmedVia
                  ? { confirmedVia: change.confirmedVia }
                  : {}),
              },
            }
          : {}),
        ...(change.note ? { $push: { notes: change.note } } : {}),
      },
    ).exec();
    return result.modifiedCount === 1;
  }
}
