import type {
  AdminConversation,
  AdminConversationSummary,
} from '@tutwithus/contracts/admin';
import type {
  ConversationFilter,
  VoiceSessionRepository,
} from './voice-session.repository.js';

export type { ConversationFilter } from './voice-session.repository.js';

// Read-only admin view over stored voice sessions and their transcripts.
// Exposed over HTTP by the conversations module.
export class VoiceSessionAdminService {
  constructor(private readonly repository: VoiceSessionRepository) {}

  listConversations(
    filter: ConversationFilter,
  ): Promise<AdminConversationSummary[]> {
    return this.repository.listAdminConversations(filter);
  }

  getConversation(sessionId: string): Promise<AdminConversation | null> {
    return this.repository.findAdminConversation(sessionId);
  }
}
