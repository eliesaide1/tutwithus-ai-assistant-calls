import type { VoiceTranscriptEntry } from '@tutwithus/contracts';

// Plays the agent's Arabic replies one after another, and stops them the moment
// the caller speaks.
//
// Arabic replies arrive as text and are spoken by a separate voice service, so
// OpenAI cannot interrupt them the way it interrupts its own audio. This queue
// does that job in the browser:
//  - a reply is spoken only after its response finished as completed, so a
//    response the server cancelled because the caller spoke is never played;
//  - when the caller starts speaking, the clip being played is stopped and the
//    clips waiting behind it are dropped.

export type AssistantSpeechQueue = {
  // Holds a reply until its response is done. A reply with no response ID is
  // spoken straight away.
  hold(responseId: string | undefined, entry: VoiceTranscriptEntry): void;
  // The response finished. Replies from a cancelled or failed response are dropped.
  responseDone(
    responseId: string | undefined,
    status: string | undefined,
  ): void;
  // The caller started speaking.
  interrupt(): void;
};

type Options = {
  speak: (entry: VoiceTranscriptEntry, signal: AbortSignal) => Promise<void>;
  onError: (error: unknown) => void;
  // Aborted when the whole call ends.
  signal: AbortSignal;
};

// Status values after which the spoken text was not (fully) delivered.
const DROPPED_STATUSES = new Set(['cancelled', 'failed']);

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export function createAssistantSpeechQueue({
  speak,
  onError,
  signal,
}: Options): AssistantSpeechQueue {
  const held = new Map<string, VoiceTranscriptEntry[]>();
  let chain: Promise<void> = Promise.resolve();
  // Bumped on every interruption; queued clips from an older epoch are skipped.
  let epoch = 0;
  let current: AbortController | null = null;

  signal.addEventListener('abort', () => current?.abort(), { once: true });

  function enqueue(entry: VoiceTranscriptEntry): void {
    const queuedEpoch = epoch;
    chain = chain.then(async () => {
      if (queuedEpoch !== epoch || signal.aborted) {
        return;
      }
      const controller = new AbortController();
      current = controller;
      try {
        await speak(entry, controller.signal);
      } catch (error) {
        // Being interrupted is expected, not a failure.
        if (!controller.signal.aborted && !isAbortError(error)) {
          onError(error);
        }
      } finally {
        if (current === controller) {
          current = null;
        }
      }
    });
  }

  return {
    hold(responseId, entry) {
      if (!responseId) {
        enqueue(entry);
        return;
      }
      const entries = held.get(responseId) ?? [];
      entries.push(entry);
      held.set(responseId, entries);
    },
    responseDone(responseId, status) {
      if (!responseId) {
        return;
      }
      const entries = held.get(responseId);
      held.delete(responseId);
      if (!entries || (status !== undefined && DROPPED_STATUSES.has(status))) {
        return;
      }
      entries.forEach(enqueue);
    },
    interrupt() {
      epoch += 1;
      held.clear();
      current?.abort();
    },
  };
}
