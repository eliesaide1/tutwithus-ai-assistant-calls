import { Agent, StopResponse } from '@livekit/agents';
import type { UserInputTranscribedEvent } from '@livekit/agents';
import { containsRecognizableWords } from '../core/session/recognizable-transcript.js';

export class TranscriptGatedAgent extends Agent {
  override async onUserTurnCompleted(
    chatCtx: Parameters<Agent['onUserTurnCompleted']>[0],
    newMessage: Parameters<Agent['onUserTurnCompleted']>[1],
  ): Promise<void> {
    if (!containsRecognizableWords(newMessage.textContent)) {
      throw new StopResponse();
    }

    await super.onUserTurnCompleted(chatCtx, newMessage);
  }
}

export function createTranscriptReplyGate(): (
  event: UserInputTranscribedEvent,
) => boolean {
  const seenItemIds = new Set<string>();

  return (event) => {
    if (!event.isFinal || !containsRecognizableWords(event.transcript)) {
      return false;
    }

    if (event.itemId) {
      if (seenItemIds.has(event.itemId)) {
        return false;
      }
      seenItemIds.add(event.itemId);
    }

    return true;
  };
}
