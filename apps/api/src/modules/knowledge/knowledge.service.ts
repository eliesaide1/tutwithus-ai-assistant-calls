import type { AdminRole } from '@tutwithus/contracts/admin';
import { ApiError } from '../../http/errors.js';
import { ADMIN_ROLE_POLICIES } from '../admin-auth/admin-auth.policies.js';
import type {
  KnowledgeDocumentSummary,
  KnowledgeRepository,
} from './knowledge.repository.js';

export type KnowledgeStatus = KnowledgeDocumentSummary['status'];
export type ReviewStatus = Extract<
  KnowledgeStatus,
  'draft' | 'in_review' | 'approved' | 'published' | 'archived'
>;

type Transition = {
  from: readonly KnowledgeStatus[];
  roles: readonly AdminRole[];
};

// Administrators can publish a reviewed draft directly. Editors can prepare
// content and submit it for review, but cannot publish it themselves.
const TRANSITIONS: Record<ReviewStatus, Transition> = {
  in_review: {
    from: ['draft', 'ready'],
    roles: ADMIN_ROLE_POLICIES.knowledgeEditors,
  },
  draft: {
    from: ['in_review', 'archived'],
    roles: ADMIN_ROLE_POLICIES.knowledgeEditors,
  },
  approved: {
    from: ['in_review'],
    roles: ADMIN_ROLE_POLICIES.administrators,
  },
  published: {
    from: ['draft', 'in_review', 'approved'],
    roles: ADMIN_ROLE_POLICIES.administrators,
  },
  archived: {
    from: ['published', 'ready', 'approved'],
    roles: ADMIN_ROLE_POLICIES.administrators,
  },
};

export function canTransitionKnowledgeStatus(
  from: KnowledgeStatus,
  to: ReviewStatus,
  role: AdminRole,
): boolean {
  const transition = TRANSITIONS[to];
  return transition.from.includes(from) && transition.roles.includes(role);
}

export class KnowledgeService {
  constructor(private readonly repository: KnowledgeRepository) {}

  listDocuments(after?: string): Promise<KnowledgeDocumentSummary[]> {
    return this.repository.list(after);
  }

  async deleteDocument(sourceId: string): Promise<void> {
    if (!(await this.repository.delete(sourceId))) {
      throw new ApiError(
        404,
        'DOCUMENT_NOT_FOUND',
        'The document was not found.',
      );
    }
  }

  async changeStatus(
    role: AdminRole,
    sourceId: string,
    nextStatus: ReviewStatus,
  ): Promise<void> {
    const current = await this.repository.findBySourceId(sourceId);
    if (!current) {
      throw new ApiError(
        404,
        'DOCUMENT_NOT_FOUND',
        'The document was not found.',
      );
    }
    if (!canTransitionKnowledgeStatus(current.status, nextStatus, role)) {
      throw new ApiError(
        409,
        'KNOWLEDGE_TRANSITION_INVALID',
        'This role cannot make the requested document status change.',
      );
    }

    const updated = await this.repository.setStatus({
      sourceId,
      currentStatus: current.status,
      nextStatus,
    });
    if (!updated) {
      throw new ApiError(
        409,
        'KNOWLEDGE_STATUS_CHANGED',
        'The document status changed. Refresh and try again.',
      );
    }
  }
}
