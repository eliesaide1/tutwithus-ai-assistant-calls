import mongoose from 'mongoose';
import {
  EscalationModel,
  type EscalationNote,
  type EscalationRecord,
} from './escalation.model.js';

export type EscalationStatus = EscalationRecord['status'];
export type EscalationFilter = {
  status?: EscalationStatus;
  priority?: EscalationRecord['priority'];
};
export type EscalationWithId = EscalationRecord & { id: string };
export type EscalationChange = {
  id: string;
  // Optimistic concurrency guard: the update applies only if unchanged.
  expectedStatus: EscalationStatus;
  status?: EscalationStatus;
  assigneeId?: string | null;
  note?: EscalationNote;
};

export type NewEscalation = Omit<EscalationRecord, 'createdAt' | 'updatedAt'>;

export interface EscalationRepository {
  createEscalation(escalation: NewEscalation): Promise<void>;
  listEscalations(filter?: EscalationFilter): Promise<EscalationWithId[]>;
  findEscalation(id: string): Promise<EscalationWithId | null>;
  updateEscalation(change: EscalationChange): Promise<boolean>;
}

function withId(
  value: EscalationRecord & { _id: mongoose.Types.ObjectId },
): EscalationWithId {
  return { ...value, id: value._id.toString() };
}

export class MongoEscalationRepository implements EscalationRepository {
  async createEscalation(escalation: NewEscalation): Promise<void> {
    await EscalationModel.create(escalation);
  }

  async listEscalations(filter: EscalationFilter = {}) {
    const records = await EscalationModel.find(filter)
      .sort({ createdAt: -1, priority: -1 })
      .limit(200)
      .lean()
      .exec();
    return records.map(withId);
  }

  async findEscalation(id: string) {
    const record = await EscalationModel.findById(id).lean().exec();
    return record ? withId(record) : null;
  }

  async updateEscalation(change: EscalationChange): Promise<boolean> {
    const set = {
      ...(change.status !== undefined ? { status: change.status } : {}),
      ...(change.assigneeId !== undefined
        ? { assigneeId: change.assigneeId }
        : {}),
    };
    const result = await EscalationModel.updateOne(
      { _id: change.id, status: change.expectedStatus },
      {
        ...(Object.keys(set).length > 0 ? { $set: set } : {}),
        ...(change.note ? { $push: { notes: change.note } } : {}),
      },
    ).exec();
    return result.modifiedCount === 1;
  }
}
