import { describe, expect, it } from 'vitest';
import {
  ChatMessage,
  StopResponse,
  type UserInputTranscribedEvent,
} from '@livekit/agents';
import {
  createTranscriptReplyGate,
  TranscriptGatedAgent,
} from './transcript-gate.js';

function transcript(
  value: string,
  options: Partial<UserInputTranscribedEvent> = {},
): UserInputTranscribedEvent {
  return {
    type: 'user_input_transcribed',
    transcript: value,
    isFinal: true,
    itemId: 'item-1',
    speakerId: null,
    createdAt: Date.now(),
    language: null,
    ...options,
  };
}

describe('WhatsApp transcript reply gate', () => {
  it('rejects interim, empty, non-speech, and filler-only transcripts', () => {
    const shouldReply = createTranscriptReplyGate();

    expect(shouldReply(transcript('How much?', { isFinal: false }))).toBe(
      false,
    );
    expect(shouldReply(transcript(''))).toBe(false);
    expect(shouldReply(transcript('[noise] (laughter)'))).toBe(false);
    expect(shouldReply(transcript('hmm'))).toBe(false);
    expect(shouldReply(transcript('اممم'))).toBe(false);
  });

  it('accepts a final transcript with words once per input item', () => {
    const shouldReply = createTranscriptReplyGate();
    const input = transcript('How much are the lessons?');

    expect(shouldReply(input)).toBe(true);
    expect(shouldReply(input)).toBe(false);
  });

  it('allows a spoken numeric account ID', () => {
    const shouldReply = createTranscriptReplyGate();

    expect(shouldReply(transcript('123456'))).toBe(true);
  });

  it('accepts a later valid transcript as a separate turn', () => {
    const shouldReply = createTranscriptReplyGate();

    expect(shouldReply(transcript('Hello'))).toBe(true);
    expect(shouldReply(transcript('How much?', { itemId: 'item-2' }))).toBe(
      true,
    );
  });

  it('prevents STT turns without recognizable words from reaching the LLM', async () => {
    const agent = new TranscriptGatedAgent({ instructions: 'Test agent' });
    const message = new ChatMessage({
      role: 'user',
      content: '[noise]',
    });

    await expect(
      agent.onUserTurnCompleted(agent.chatCtx.copy(), message),
    ).rejects.toBeInstanceOf(StopResponse);
  });

  it('allows an STT turn with recognizable words', async () => {
    const agent = new TranscriptGatedAgent({ instructions: 'Test agent' });
    const message = new ChatMessage({
      role: 'user',
      content: 'How much are the lessons?',
    });

    await expect(
      agent.onUserTurnCompleted(agent.chatCtx.copy(), message),
    ).resolves.toBeUndefined();
  });
});
