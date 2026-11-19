import type { AdminEscalationUpdateRequest } from '@tutwithus/contracts/admin';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../../http/errors.js';
import type { AdminPrincipal } from '../admin-auth/admin-auth.service.js';
import type { EscalationRecord } from './escalation.model.js';
import type {
  EscalationFilter,
  EscalationRepository,
  EscalationStatus,
  EscalationWithId,
} from './escalation.repository.js';

type Actor = Pick<AdminPrincipal, 'id' | 'role'>;

export type EscalationUpdateResult = {
  status: EscalationStatus;
  statusChanged: boolean;
  assignedToSelf: boolean;
};

type VoiceEscalationInput = {
  sessionId: string;
  reason: EscalationRecord['reason'];
  summary: string;
  contactConsent: true;
};

type EscalationContactResolver = (
  sessionId: string,
  now: Date,
) => Promise<{ verified: boolean; contactPhone?: string }>;

const PRIORITY_BY_REASON: Record<
  EscalationRecord['reason'],
  EscalationRecord['priority']
> = {
  safety: 'urgent',
  complaint: 'high',
  user_requested: 'normal',
  out_of_scope: 'normal',
  technical: 'normal',
};

// Hours until staff should respond. These are working assumptions until
// TutWithUs confirms its escalation SLA (PDF section 1, open question).
const SLA_HOURS: Record<EscalationRecord['priority'], number> = {
  urgent: 1,
  high: 4,
  normal: 24,
  low: 48,
};

export class EscalationService {
  constructor(
    private readonly escalations: EscalationRepository,
    private readonly resolveEscalationContact?: EscalationContactResolver,
  ) {}

  // Use only the number collected at call start or resolved from the verified
  // account; contact details are never accepted from model tool arguments.
  async createFromVoiceSession(
    input: VoiceEscalationInput,
  ): Promise<{ ticketRef: string; priority: EscalationRecord['priority'] }> {
    if (!this.resolveEscalationContact) {
      throw new ApiError(
        503,
        'ESCALATION_VERIFICATION_UNAVAILABLE',
        'Voice session verification is unavailable.',
      );
    }
    const caller = await this.resolveEscalationContact(
      input.sessionId,
      new Date(),
    );
    const contactPhone = caller.contactPhone?.trim();
    const digitCount = contactPhone?.match(/\d/g)?.length ?? 0;
    if (
      !contactPhone ||
      !/^\+?[0-9][0-9\s().-]*$/.test(contactPhone) ||
      digitCount < 8 ||
      digitCount > 15
    ) {
      throw new ApiError(
        409,
        'ESCALATION_CONTACT_UNAVAILABLE',
        'A valid callback phone number is required.',
      );
    }

    const priority = PRIORITY_BY_REASON[input.reason];
    const ticketRef = `ESC-${randomBytes(5).toString('hex').toUpperCase()}`;
    await this.escalations.createEscalation({
      sessionId: input.sessionId,
      ticketRef,
      reason: input.reason,
      summary: input.summary,
      priority,
      status: 'open',
      contactConsent: true,
      contact: {
        phone: contactPhone.replace(/[().\s-]/g, ''),
      },
      notes: [],
      slaDueAt: new Date(Date.now() + SLA_HOURS[priority] * 60 * 60 * 1000),
    });
    return { ticketRef, priority };
  }

  listEscalations(filter: EscalationFilter): Promise<EscalationWithId[]> {
    return this.escalations.listEscalations(filter);
  }

  // Agents may resolve only tickets they claimed. Administrators may resolve
  // any active ticket and reopen closed tickets.
  async updateEscalation(
    actor: Actor,
    id: string,
    update: AdminEscalationUpdateRequest,
  ): Promise<EscalationUpdateResult> {
    const current = await this.escalations.findEscalation(id);
    if (!current) {
      throw new ApiError(
        404,
        'ESCALATION_NOT_FOUND',
        'Escalation was not found.',
      );
    }

    let nextStatus = current.status;
    let assigneeId: string | null | undefined;
    if (update.action === 'claim') {
      if (current.status !== 'open' && current.assigneeId !== actor.id) {
        throw new ApiError(
          409,
          'ESCALATION_ALREADY_CLAIMED',
          'This escalation is already assigned or resolved.',
        );
      }
      nextStatus = 'claimed';
      assigneeId = actor.id;
    } else if (update.action === 'resolve') {
      const agentMayResolve =
        current.status === 'claimed' && current.assigneeId === actor.id;
      if (
        current.status === 'resolved' ||
        (actor.role === 'agent' && !agentMayResolve)
      ) {
        throw new ApiError(
          409,
          'ESCALATION_TRANSITION_INVALID',
          'Claim this escalation before resolving it.',
        );
      }
      nextStatus = 'resolved';
    } else if (update.action === 'reopen') {
      if (current.status !== 'resolved' || actor.role !== 'admin') {
        throw new ApiError(
          409,
          'ESCALATION_TRANSITION_INVALID',
          'Only administrators may reopen a closed escalation.',
        );
      }
      nextStatus = 'open';
      assigneeId = null;
    }

    const statusChanged = nextStatus !== current.status;
    const updated = await this.escalations.updateEscalation({
      id,
      expectedStatus: current.status,
      ...(statusChanged ? { status: nextStatus } : {}),
      ...(assigneeId !== undefined ? { assigneeId } : {}),
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
        'ESCALATION_CHANGED',
        'The escalation changed. Refresh and try again.',
      );
    }
    return {
      status: nextStatus,
      statusChanged,
      assignedToSelf: assigneeId === actor.id,
    };
  }
}
